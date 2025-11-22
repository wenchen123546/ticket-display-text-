/*
 * ==========================================
 * 伺服器 (index.js) - v8.0 Kiosk & Line Edition
 * ==========================================
 */

// --- 1. 模組載入 ---
const express = require("express");
const http = require("http");
const socketio = require("socket.io");
const Redis = require("ioredis");
const helmet = require('helmet'); 
const rateLimit = require('express-rate-limit'); 
const { v4: uuidv4 } = require('uuid'); 
const bcrypt = require('bcrypt'); 
const line = require('@line/bot-sdk'); // 新增 Line SDK

// --- 2. 伺服器實體化 ---
const app = express();
const server = http.createServer(app);
const io = socketio(server, {
    cors: { origin: "*" },
    pingTimeout: 60000
});

// --- 3. 核心設定 & 安全性 ---
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN; 
const REDIS_URL = process.env.UPSTASH_REDIS_URL;
const SALT_ROUNDS = 10; 

// LINE 設定 (若無設定則不會崩潰，只是功能無效)
const lineConfig = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'YOUR_TOKEN',
    channelSecret: process.env.LINE_CHANNEL_SECRET || 'YOUR_SECRET'
};

if (!ADMIN_TOKEN || !REDIS_URL) {
    console.error("❌ 錯誤： 環境變數未設定 (ADMIN_TOKEN, UPSTASH_REDIS_URL)");
    process.exit(1);
}

// --- 4. 連線到 Upstash Redis ---
const redis = new Redis(REDIS_URL, {
    tls: { rejectUnauthorized: false },
    retryStrategy: (times) => Math.min(times * 50, 2000)
});
redis.on('connect', () => console.log("✅ Redis 連線成功"));
redis.on('error', (err) => console.error("❌ Redis 錯誤:", err));

// Lua Script: Kiosk 模式下的下一號邏輯
// 只有當 current < lastIssued 時才增加 current
redis.defineCommand("nextNumberKiosk", {
    numberOfKeys: 2, // KEY_CURRENT, KEY_LAST_ISSUED
    lua: `
        local current = tonumber(redis.call("GET", KEYS[1])) or 0
        local issued = tonumber(redis.call("GET", KEYS[2])) or 0
        
        if current < issued then
            return redis.call("INCR", KEYS[1])
        else
            return -1 -- 表示無人候位
        end
    `
});

// --- 5. Redis Keys ---
const KEY_CURRENT_NUMBER = 'callsys:number';
const KEY_LAST_ISSUED = 'callsys:issued'; // 【新】最後發出的號碼
const KEY_KIOSK_MODE = 'callsys:kioskMode'; // 【新】Kiosk 模式開關
const KEY_PASSED_NUMBERS = 'callsys:passed';
const KEY_FEATURED_CONTENTS = 'callsys:featured';
const KEY_LAST_UPDATED = 'callsys:updated';
const KEY_SOUND_ENABLED = 'callsys:soundEnabled';
const KEY_IS_PUBLIC = 'callsys:isPublic'; 
const KEY_ADMIN_LOG = 'callsys:admin-log';
const KEY_USERS = 'callsys:users'; 
const KEY_NICKNAMES = 'callsys:nicknames';
const SESSION_PREFIX = 'callsys:session:';
const KEY_HISTORY_STATS = 'callsys:stats:history';
const KEY_STATS_HOURLY_PREFIX = 'callsys:stats:hourly:'; 

const onlineAdmins = new Map();
let lineClient = null;
try {
    if (process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_CHANNEL_SECRET) {
        lineClient = new line.Client(lineConfig);
        console.log("✅ LINE Bot Client 初始化成功");
    }
} catch (e) { console.warn("⚠️ LINE Bot 初始化失敗:", e.message); }

// --- 6. Middleware ---
app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "script-src": ["'self'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
        "style-src": ["'self'", "https://cdn.jsdelivr.net", "'unsafe-inline'"],
        "connect-src": ["'self'", "https://cdn.jsdelivr.net", "wss:", "ws:"]
      },
    },
}));
app.use(express.static("public"));

// Line Webhook 必須在 express.json() 之前處理 raw body (但此範例用 SDK middleware 簡化)
// 這裡為了簡單，針對 API 路由使用 json parser
app.use('/api', express.json());
app.use('/login', express.json());
app.use('/change-number', express.json());
app.use('/set-number', express.json());
app.use('/set-sound-enabled', express.json());
app.use('/set-public-status', express.json());
app.use('/set-kiosk-mode', express.json()); // 新路由
app.use('/reset', express.json());

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

const authMiddleware = async (req, res, next) => {
    try {
        const { token } = req.body; 
        if (!token) return res.status(401).json({ error: "未提供 Token" });
        const sessionKey = `${SESSION_PREFIX}${token}`;
        const sessionData = await redis.get(sessionKey);
        if (!sessionData) return res.status(403).json({ error: "Session 已過期" });
        req.user = JSON.parse(sessionData); 
        await redis.expire(sessionKey, 8 * 60 * 60); 
        next();
    } catch (e) { res.status(500).json({ error: "驗證錯誤" }); }
};

const superAdminAuthMiddleware = (req, res, next) => {
    if (req.user?.role === 'super') next();
    else res.status(403).json({ error: "權限不足" });
};

// --- 7. 輔助函式 ---
function sanitize(str) { return typeof str === 'string' ? str.replace(/<[^>]*>?/gm, '') : ''; }

async function updateTimestamp() {
    const now = new Date().toISOString();
    await redis.set(KEY_LAST_UPDATED, now);
    io.emit("updateTimestamp", now);
}

function getTaiwanDateInfo() {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei', hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit'
    });
    const parts = formatter.formatToParts(new Date());
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    let hour = parseInt(parts.find(p => p.type === 'hour').value);
    if (hour === 24) hour = 0;
    return { dateStr: `${year}-${month}-${day}`, hour };
}

async function broadcastData(key, eventName, isJSON = false) {
    const raw = isJSON ? await redis.lrange(key, 0, -1) : await redis.zrange(key, 0, -1);
    const data = isJSON ? raw.map(JSON.parse) : raw.map(Number);
    io.emit(eventName, data);
}

async function addAdminLog(nickname, message) {
    const timeString = new Date().toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
    const log = `[${timeString}] [${nickname}] ${message}`;
    await redis.lpush(KEY_ADMIN_LOG, log);
    await redis.ltrim(KEY_ADMIN_LOG, 0, 99); 
    io.emit("newAdminLog", log);
}

async function calculateAverageWaitTime() {
    const historyRaw = await redis.lrange(KEY_HISTORY_STATS, 0, 4); 
    if (historyRaw.length < 2) return 0;
    const history = historyRaw.map(JSON.parse);
    const newest = history[0];
    const oldest = history[history.length - 1];
    const timeDiff = (new Date(newest.time) - new Date(oldest.time)) / 1000 / 60; 
    const numDiff = Math.abs(newest.num - oldest.num);
    if (numDiff === 0 || timeDiff <= 0) return 0;
    return timeDiff / numDiff;
}

async function logHistory(number, operator, delta = 1) {
    if (delta <= 0) return;
    const { dateStr, hour } = getTaiwanDateInfo();
    const record = { num: number, time: new Date().toISOString(), operator };
    await redis.lpush(KEY_HISTORY_STATS, JSON.stringify(record));
    await redis.ltrim(KEY_HISTORY_STATS, 0, 999); 
    await redis.hincrby(`${KEY_STATS_HOURLY_PREFIX}${dateStr}`, hour, delta); 
    await redis.expire(`${KEY_STATS_HOURLY_PREFIX}${dateStr}`, 30 * 86400);
}

async function syncStateToSocket(socket) {
    const pipeline = redis.multi();
    pipeline.get(KEY_CURRENT_NUMBER);
    pipeline.get(KEY_LAST_ISSUED);
    pipeline.get(KEY_KIOSK_MODE);
    pipeline.zrange(KEY_PASSED_NUMBERS, 0, -1);
    pipeline.lrange(KEY_FEATURED_CONTENTS, 0, -1);
    pipeline.get(KEY_SOUND_ENABLED);
    pipeline.get(KEY_IS_PUBLIC);
    const res = await pipeline.exec();
    
    const current = Number(res[0][1] || 0);
    const issued = Number(res[1][1] || 0);
    const isKiosk = res[2][1] === "1";

    socket.emit("update", current);
    socket.emit("updateIssued", issued); // 【新】同步發號
    socket.emit("updateKioskMode", isKiosk); // 【新】同步模式
    socket.emit("updatePassed", (res[3][1] || []).map(Number));
    socket.emit("updateFeaturedContents", (res[4][1] || []).map(JSON.parse));
    socket.emit("updateSoundSetting", res[5][1] === "1");
    socket.emit("updatePublicStatus", res[6][1] !== "0");
    
    const avg = await calculateAverageWaitTime();
    socket.emit("updateWaitTime", avg);
}

// --- 8. API Routes ---

// LINE Webhook
app.post('/callback', line.middleware(lineConfig), async (req, res) => {
    try {
        const events = req.body.events;
        if (events.length > 0) {
            await Promise.all(events.map(async (event) => {
                if (event.type === 'message' && event.message.type === 'text') {
                    const text = event.message.text.trim();
                    if (text === 'status' || text === '查詢' || text === '叫號') {
                        const current = await redis.get(KEY_CURRENT_NUMBER) || 0;
                        const issued = await redis.get(KEY_LAST_ISSUED) || 0;
                        const waiting = Math.max(0, issued - current);
                        
                        await lineClient.replyMessage(event.replyToken, {
                            type: 'text',
                            text: `📊 目前叫號：${current} 號\n🎫 最後發號：${issued} 號\n⏳ 等待人數：${waiting} 人\n\n🔗 查看詳情: https://${req.get('host')}`
                        });
                    }
                }
            }));
        }
        res.status(200).send('OK');
    } catch (err) {
        console.error("Line Webhook Error:", err);
        res.status(500).end();
    }
});

app.post("/login", loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    try {
        let isValid = false, role = 'normal';
        if (username === 'superadmin' && password === ADMIN_TOKEN) {
            isValid = true; role = 'super';
        } else {
            const storedHash = await redis.hget(KEY_USERS, username);
            if (storedHash) isValid = await bcrypt.compare(password, storedHash);
        }
        if (!isValid) return res.status(403).json({ error: "帳號或密碼錯誤" });
        const sessionToken = uuidv4();
        let nickname = await redis.hget(KEY_NICKNAMES, username);
        if (!nickname) nickname = username;
        await redis.set(`${SESSION_PREFIX}${sessionToken}`, JSON.stringify({ username, role, nickname }), "EX", 28800);
        res.json({ success: true, token: sessionToken, role, username, nickname });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const protectedAPIs = [
    "/change-number", "/set-number", "/set-kiosk-mode",
    "/api/passed/add", "/api/passed/remove", "/api/passed/clear",
    "/api/featured/add", "/api/featured/remove", "/api/featured/clear",
    "/set-sound-enabled", "/set-public-status", "/reset",
    "/api/logs/clear", "/api/admin/stats", "/api/admin/broadcast",
    "/api/admin/stats/adjust", "/api/admin/stats/clear", "/api/admin/export-csv"
];
app.use(protectedAPIs, apiLimiter, authMiddleware);

// 前台自助取號 API (Rate Limited 嚴格一點)
const kioskLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 60, message: { error: "取號太頻繁" } });
app.post("/api/kiosk/take-number", kioskLimiter, async (req, res) => {
    const isKiosk = await redis.get(KEY_KIOSK_MODE);
    if (isKiosk !== "1") return res.status(403).json({ error: "自助取號功能未開啟" });
    
    // 取號邏輯：lastIssued + 1
    const newIssued = await redis.incr(KEY_LAST_ISSUED);
    
    // 如果 current 比 issued 還大 (異常狀態)，稍微修正一下，但通常不會發生
    // 這裡只需廣播 updateIssued
    io.emit("updateIssued", newIssued);
    
    // 計算等待人數
    const current = Number(await redis.get(KEY_CURRENT_NUMBER) || 0);
    const waiting = newIssued - current;

    res.json({ success: true, yourNumber: newIssued, waitingCount: waiting });
});

app.post("/set-kiosk-mode", superAdminAuthMiddleware, async (req, res) => {
    const { enabled } = req.body;
    await redis.set(KEY_KIOSK_MODE, enabled ? "1" : "0");
    
    // 如果開啟 Kiosk，且 lastIssued 小於 current，強制同步
    if (enabled) {
        const current = await redis.get(KEY_CURRENT_NUMBER) || 0;
        const issued = await redis.get(KEY_LAST_ISSUED) || 0;
        if (Number(issued) < Number(current)) {
            await redis.set(KEY_LAST_ISSUED, current);
        }
    }

    addAdminLog(req.user.nickname, `自助取號模式設為 ${enabled ? '開啟' : '關閉'}`);
    io.emit("updateKioskMode", enabled);
    
    // 重新廣播一次狀態以確保同步
    const issued = await redis.get(KEY_LAST_ISSUED) || 0;
    io.emit("updateIssued", Number(issued));
    
    res.json({ success: true });
});

app.post("/change-number", async (req, res) => {
    try {
        const { direction } = req.body;
        const isKiosk = await redis.get(KEY_KIOSK_MODE) === "1";
        let num;

        if (direction === "next") {
            if (isKiosk) {
                // Kiosk 模式：不能超過 Issued
                const result = await redis.nextNumberKiosk(KEY_CURRENT_NUMBER, KEY_LAST_ISSUED);
                if (result === -1) return res.status(400).json({ error: "目前無人候位 (已達取號上限)" });
                num = result;
            } else {
                // 一般模式：直接增加，同時同步 Issued，避免切換模式時錯亂
                num = await redis.incr(KEY_CURRENT_NUMBER);
                await redis.set(KEY_LAST_ISSUED, num); 
                io.emit("updateIssued", num);
            }
            await logHistory(num, req.user.nickname, 1);
            addAdminLog(req.user.nickname, `號碼增加為 ${num}`);
        } else if (direction === "prev") {
            // 上一號邏輯不變
            num = await redis.decrIfPositive(KEY_CURRENT_NUMBER);
            await logHistory(num, req.user.nickname, 0); 
            addAdminLog(req.user.nickname, `號碼回退為 ${num}`);
        } else {
            num = await redis.get(KEY_CURRENT_NUMBER) || 0;
        }
        io.emit("update", Number(num));
        const avg = await calculateAverageWaitTime();
        io.emit("updateWaitTime", avg);
        await updateTimestamp();
        res.json({ success: true, number: num });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/set-number", async (req, res) => {
    try {
        const newNum = parseInt(req.body.number);
        if (isNaN(newNum) || newNum < 0) return res.status(400).json({ error: "無效號碼" });
        
        const oldNum = parseInt(await redis.get(KEY_CURRENT_NUMBER)) || 0;
        await redis.set(KEY_CURRENT_NUMBER, newNum);
        
        // 為了防呆，設定號碼時，把 Issued 也同步過去 (除非 Kiosk 模式下 Issued 已經比它大)
        const issued = parseInt(await redis.get(KEY_LAST_ISSUED)) || 0;
        if (newNum > issued) {
            await redis.set(KEY_LAST_ISSUED, newNum);
            io.emit("updateIssued", newNum);
        }

        const diff = newNum - oldNum;
        const delta = diff > 0 ? diff : 0;
        await logHistory(newNum, req.user.nickname, delta);
        addAdminLog(req.user.nickname, `設定為 ${newNum}`);
        
        io.emit("update", newNum);
        io.emit("updateWaitTime", await calculateAverageWaitTime());
        await updateTimestamp();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ... (其他 Pass, Featured API 保持不變，略過重複部分以節省篇幅，邏輯相同) ...
// 為了完整性，這裏列出關鍵修改的 Reset
app.post("/reset", async (req, res) => {
    const multi = redis.multi();
    multi.set(KEY_CURRENT_NUMBER, 0);
    multi.set(KEY_LAST_ISSUED, 0);
    multi.del(KEY_PASSED_NUMBERS);
    multi.del(KEY_FEATURED_CONTENTS);
    multi.set(KEY_SOUND_ENABLED, "0");
    multi.set(KEY_IS_PUBLIC, "1");
    multi.set(KEY_KIOSK_MODE, "0");
    multi.del(KEY_ADMIN_LOG);
    multi.del(KEY_HISTORY_STATS); 
    await multi.exec();
    
    addAdminLog(req.user.nickname, `💥 系統全域重置`);
    io.emit("update", 0);
    io.emit("updateIssued", 0);
    io.emit("updateKioskMode", false);
    io.emit("updatePassed", []);
    io.emit("updateFeaturedContents", []);
    io.emit("updateSoundSetting", false);
    io.emit("updatePublicStatus", true);
    io.emit("initAdminLogs", []);
    io.emit("updateWaitTime", 0);
    await updateTimestamp();
    res.json({ success: true });
});

// 引用原有的 API (CSV, Broadcast, Passed, Featured...) 
// 請確保將原有的 app.post(...) 貼在這裡，不需變更邏輯
// 為節省篇幅，假設此處包含所有原有的輔助 API

// --- User Management & CSV APIs (Copy from original) ---
app.post("/api/admin/export-csv", superAdminAuthMiddleware, async (req, res) => {
     try {
        const { dateStr } = getTaiwanDateInfo();
        const historyRaw = await redis.lrange(KEY_HISTORY_STATS, 0, -1);
        const history = historyRaw.map(JSON.parse);
        let csvContent = "\uFEFF時間,號碼,操作員\n";
        history.forEach(item => {
            const time = new Date(item.time).toLocaleTimeString('zh-TW', { hour12: false });
            csvContent += `${time},${item.num},${item.operator}\n`;
        });
        res.json({ success: true, csvData: csvContent, fileName: `stats_${dateStr}.csv` });
        addAdminLog(req.user.nickname, "📥 下載了 CSV 報表");
    } catch (e) { res.status(500).json({ error: e.message }); }
});
// ... (Include other APIs: broadcast, stats, passed, featured, user management) ...
// 實際上線時請將 v7.0 的其他 API 複製過來，這裏不再贅述

app.post("/api/admin/broadcast", async (req, res) => {
    const { message } = req.body;
    const cleanMsg = sanitize(message).substring(0, 50);
    io.emit("adminBroadcast", cleanMsg);
    addAdminLog(req.user.nickname, `📢 發送廣播: "${cleanMsg}"`);
    res.json({ success: true });
});
app.post("/api/admin/stats", async (req, res) => {
    const { dateStr, hour } = getTaiwanDateInfo();
    const [historyRaw, hourlyData] = await Promise.all([
        redis.lrange(KEY_HISTORY_STATS, 0, 99),
        redis.hgetall(`${KEY_STATS_HOURLY_PREFIX}${dateStr}`)
    ]);
    const hourlyCounts = new Array(24).fill(0);
    let todayTotal = 0;
    if (hourlyData) {
        for (const [hStr, count] of Object.entries(hourlyData)) {
            const h = parseInt(hStr);
            if (h >= 0 && h < 24) { hourlyCounts[h] = parseInt(count); todayTotal += parseInt(count); }
        }
    }
    res.json({ success: true, history: historyRaw.map(JSON.parse), hourlyCounts, todayCount: todayTotal, serverHour: hour });
});
// ... 其他 API 保持不變 ...
// 為了能正常運作，將 admin APIs 補齊:
app.post("/api/passed/add", async (req, res) => { /* ...同 v7.0... */ 
    const num = parseInt(req.body.number);
    if(!num) return res.status(400).json({error:"Err"});
    await redis.zadd(KEY_PASSED_NUMBERS, num, num);
    await redis.zremrangebyrank(KEY_PASSED_NUMBERS, 0, -21);
    broadcastData(KEY_PASSED_NUMBERS, "updatePassed", false);
    res.json({success:true});
});
app.post("/api/passed/remove", async (req, res) => { 
    await redis.zrem(KEY_PASSED_NUMBERS, req.body.number);
    broadcastData(KEY_PASSED_NUMBERS, "updatePassed", false);
    res.json({success:true});
});
app.post("/api/passed/clear", async (req, res) => { 
    await redis.del(KEY_PASSED_NUMBERS);
    broadcastData(KEY_PASSED_NUMBERS, "updatePassed", false);
    res.json({success:true});
});
app.post("/api/featured/add", async (req, res) => { 
    const {linkText, linkUrl} = req.body;
    await redis.rpush(KEY_FEATURED_CONTENTS, JSON.stringify({linkText: sanitize(linkText), linkUrl}));
    broadcastData(KEY_FEATURED_CONTENTS, "updateFeaturedContents", true);
    res.json({success:true});
});
app.post("/api/featured/remove", async (req, res) => { 
    const {linkText, linkUrl} = req.body;
    await redis.lrem(KEY_FEATURED_CONTENTS, 1, JSON.stringify({linkText, linkUrl}));
    broadcastData(KEY_FEATURED_CONTENTS, "updateFeaturedContents", true);
    res.json({success:true});
});
app.post("/api/featured/clear", async (req, res) => { 
    await redis.del(KEY_FEATURED_CONTENTS);
    broadcastData(KEY_FEATURED_CONTENTS, "updateFeaturedContents", true);
    res.json({success:true});
});
app.post("/api/logs/clear", async (req, res) => { await redis.del(KEY_ADMIN_LOG); io.emit("initAdminLogs", []); res.json({success:true}); });
// User Mgmt
app.use(["/api/admin/users", "/api/admin/add-user", "/api/admin/del-user", "/api/admin/set-nickname"], authMiddleware, superAdminAuthMiddleware);
app.post("/api/admin/users", async (req, res) => {
    const nicknames = await redis.hgetall(KEY_NICKNAMES) || {};
    const normalUsers = await redis.hkeys(KEY_USERS) || [];
    const list = [{ username: 'superadmin', nickname: nicknames['superadmin'] || 'Super Admin', role: 'super' }];
    normalUsers.forEach(u => list.push({ username: u, nickname: nicknames[u] || u, role: 'normal' }));
    res.json({ success: true, users: list });
});
app.post("/api/admin/add-user", async (req, res) => {
    const { newUsername, newPassword, newNickname } = req.body;
    if(await redis.hexists(KEY_USERS, newUsername)) return res.status(400).json({error: "Exist"});
    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await redis.hset(KEY_USERS, newUsername, hash);
    await redis.hset(KEY_NICKNAMES, newUsername, sanitize(newNickname) || newUsername);
    res.json({ success: true });
});
app.post("/api/admin/del-user", async (req, res) => {
    const { delUsername } = req.body;
    if (delUsername === 'superadmin') return res.status(400).json({error: "Err"});
    await redis.hdel(KEY_USERS, delUsername);
    await redis.hdel(KEY_NICKNAMES, delUsername);
    res.json({ success: true });
});
app.post("/api/admin/set-nickname", async (req, res) => {
    const { targetUsername, nickname } = req.body;
    await redis.hset(KEY_NICKNAMES, targetUsername, sanitize(nickname));
    res.json({ success: true });
});

// Socket Init
io.on("connection", async (socket) => {
    const token = socket.handshake.auth.token;
    if (token) {
        const session = await redis.get(`${SESSION_PREFIX}${token}`);
        if (session) {
            const user = JSON.parse(session);
            onlineAdmins.set(socket.id, user);
            broadcastOnlineAdmins();
            const logs = await redis.lrange(KEY_ADMIN_LOG, 0, 99);
            socket.emit("initAdminLogs", logs);
            socket.on("disconnect", () => { onlineAdmins.delete(socket.id); broadcastOnlineAdmins(); });
        }
    }
    syncStateToSocket(socket);
});

function broadcastOnlineAdmins() { io.emit("updateOnlineAdmins", Array.from(onlineAdmins.values())); }

async function shutdown() {
    io.close(); await redis.quit();
    server.close(() => { process.exit(0); });
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server v8.0 (Kiosk+Line) ready on port ${PORT}`));
