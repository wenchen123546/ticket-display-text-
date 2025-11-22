/*
 * ==========================================
 * 伺服器 (index.js) - v6 Enhanced
 * 改進：O(1) 統計、廣播功能、WakeLock 支援、優雅關機
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

// --- 2. 伺服器實體化 ---
const app = express();
const server = http.createServer(app);
const io = socketio(server, {
    cors: { origin: "*" }, // 建議在生產環境鎖定網域
    pingTimeout: 60000     // 增加容錯
});

// --- 3. 核心設定 & 安全性 ---
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN; 
const REDIS_URL = process.env.UPSTASH_REDIS_URL;
const SALT_ROUNDS = 10; 

// --- 4. 關鍵檢查 ---
if (!ADMIN_TOKEN || !REDIS_URL) {
    console.error("❌ 錯誤： 環境變數未設定 (ADMIN_TOKEN 或 UPSTASH_REDIS_URL)");
    process.exit(1);
}

// --- 5. 連線到 Upstash Redis ---
const redis = new Redis(REDIS_URL, {
    tls: { rejectUnauthorized: false },
    retryStrategy: (times) => Math.min(times * 50, 2000) // 自動重連策略
});
redis.on('connect', () => console.log("✅ Redis 連線成功"));
redis.on('error', (err) => console.error("❌ Redis 錯誤:", err));

redis.defineCommand("decrIfPositive", {
    numberOfKeys: 1,
    lua: `
        local currentValue = tonumber(redis.call("GET", KEYS[1]))
        if currentValue and currentValue > 0 then
            return redis.call("DECR", KEYS[1])
        else
            return currentValue or 0
        end
    `,
});

// --- 6. Redis Keys ---
const KEY_CURRENT_NUMBER = 'callsys:number';
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
const KEY_STATS_DAILY_PREFIX = 'callsys:stats:daily:'; // 【新】每日計數器前綴

const onlineAdmins = new Map();

// --- 7. Middleware ---
app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "script-src": ["'self'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
        "style-src": ["'self'", "https://cdn.jsdelivr.net", "'unsafe-inline'"],
        "connect-src": ["'self'", "https://cdn.jsdelivr.net", "wss:", "ws:"] // 允許 WebSocket
      },
    },
}));
app.use(express.static("public"));
app.use(express.json());

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: "登入嘗試過多" } });

const authMiddleware = async (req, res, next) => {
    try {
        const { token } = req.body; 
        if (!token) return res.status(401).json({ error: "未提供 Token" });

        const sessionKey = `${SESSION_PREFIX}${token}`;
        const sessionData = await redis.get(sessionKey);
        if (!sessionData) return res.status(403).json({ error: "Session 已過期" });

        req.user = JSON.parse(sessionData); 
        await redis.expire(sessionKey, 8 * 60 * 60); // 續約
        next();
    } catch (e) {
        res.status(500).json({ error: "驗證錯誤" });
    }
};

const superAdminAuthMiddleware = (req, res, next) => {
    if (req.user?.role === 'super') next();
    else res.status(403).json({ error: "權限不足" });
};

// --- 8. 邏輯函式 ---

function sanitize(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/<[^>]*>?/gm, '');
}

async function updateTimestamp() {
    const now = new Date().toISOString();
    await redis.set(KEY_LAST_UPDATED, now);
    io.emit("updateTimestamp", now);
}

async function broadcastData(key, eventName, isJSON = false) {
    try {
        const raw = isJSON ? await redis.lrange(key, 0, -1) : await redis.zrange(key, 0, -1);
        const data = isJSON ? raw.map(JSON.parse) : raw.map(Number);
        io.emit(eventName, data);
        await updateTimestamp();
    } catch (e) { console.error(`Broadcast ${eventName} error:`, e); }
}

async function addAdminLog(nickname, message) {
    const log = `[${new Date().toLocaleTimeString('zh-TW', { hour12: false })}] [${nickname}] ${message}`;
    await redis.lpush(KEY_ADMIN_LOG, log);
    await redis.ltrim(KEY_ADMIN_LOG, 0, 99); // 保留 100 筆
    io.emit("newAdminLog", log);
}

// 【優化】 統計功能：同時寫入 List 和 Daily Counter
async function logHistory(number, operator) {
    try {
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
        const record = { num: number, time: now.toISOString(), operator };
        
        const pipeline = redis.multi();
        pipeline.lpush(KEY_HISTORY_STATS, JSON.stringify(record));
        pipeline.ltrim(KEY_HISTORY_STATS, 0, 999);
        // 【優化】 使用 INCR 操作實現 O(1) 每日計數
        pipeline.incr(`${KEY_STATS_DAILY_PREFIX}${dateStr}`); 
        // 設定過期時間 (例如保留 30 天的每日數據)
        pipeline.expire(`${KEY_STATS_DAILY_PREFIX}${dateStr}`, 30 * 86400);
        
        await pipeline.exec();
    } catch (e) { console.error("Log history error:", e); }
}

function broadcastOnlineAdmins() {
    io.emit("updateOnlineAdmins", Array.from(onlineAdmins.values()));
}

// --- 9. API Routes ---

app.post("/login", loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "請輸入帳號密碼" });

    try {
        let isValid = false;
        let role = 'normal';

        if (username === 'superadmin' && password === ADMIN_TOKEN) {
            isValid = true;
            role = 'super';
        } else {
            const storedHash = await redis.hget(KEY_USERS, username);
            if (storedHash) isValid = await bcrypt.compare(password, storedHash);
        }

        if (!isValid) return res.status(403).json({ error: "帳號或密碼錯誤" });

        const sessionToken = uuidv4();
        let nickname = await redis.hget(KEY_NICKNAMES, username);
        
        // 確保 superadmin 也有暱稱
        if (!nickname && username === 'superadmin') {
            nickname = 'Super Admin';
            await redis.hset(KEY_NICKNAMES, 'superadmin', nickname);
        } else if (!nickname) {
            nickname = username;
        }

        const sessionData = JSON.stringify({ username, role, nickname });
        await redis.set(`${SESSION_PREFIX}${sessionToken}`, sessionData, "EX", 28800); // 8hr

        res.json({ success: true, token: sessionToken, role, username, nickname });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 保護路由群組
const protectedAPIs = [
    "/change-number", "/set-number",
    "/api/passed/add", "/api/passed/remove", "/api/passed/clear",
    "/api/featured/add", "/api/featured/remove", "/api/featured/clear",
    "/set-sound-enabled", "/set-public-status", "/reset",
    "/api/logs/clear", "/api/admin/stats", "/api/admin/broadcast" // 【新】
];
app.use(protectedAPIs, apiLimiter, authMiddleware);

app.post("/change-number", async (req, res) => {
    try {
        const { direction } = req.body;
        let num;
        if (direction === "next") {
            num = await redis.incr(KEY_CURRENT_NUMBER);
            await logHistory(num, req.user.nickname);
            addAdminLog(req.user.nickname, `號碼增加為 ${num}`);
        } else if (direction === "prev") {
            num = await redis.decrIfPositive(KEY_CURRENT_NUMBER);
            addAdminLog(req.user.nickname, `號碼回退為 ${num}`);
        } else {
            num = await redis.get(KEY_CURRENT_NUMBER) || 0;
        }
        io.emit("update", num);
        await updateTimestamp();
        res.json({ success: true, number: num });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/set-number", async (req, res) => {
    const num = parseInt(req.body.number);
    if (isNaN(num) || num < 0) return res.status(400).json({ error: "無效號碼" });
    
    await redis.set(KEY_CURRENT_NUMBER, num);
    await logHistory(num, req.user.nickname);
    addAdminLog(req.user.nickname, `手動設定為 ${num}`);
    io.emit("update", num);
    await updateTimestamp();
    res.json({ success: true });
});

// 【新】 廣播功能 API
app.post("/api/admin/broadcast", async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "訊息內容為空" });
    
    const cleanMsg = sanitize(message).substring(0, 50); // 限制長度
    io.emit("adminBroadcast", cleanMsg);
    addAdminLog(req.user.nickname, `📢 發送廣播: "${cleanMsg}"`);
    res.json({ success: true });
});

// 【優化】 統計 API
app.post("/api/admin/stats", async (req, res) => {
    try {
        const dateStr = new Date().toISOString().split('T')[0];
        
        // 平行執行 Redis 查詢以提升效能
        const [historyRaw, todayCount] = await Promise.all([
            redis.lrange(KEY_HISTORY_STATS, 0, 99),
            redis.get(`${KEY_STATS_DAILY_PREFIX}${dateStr}`)
        ]);

        res.json({ 
            success: true, 
            history: historyRaw.map(JSON.parse), 
            todayCount: Number(todayCount || 0) 
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ... (Passed Numbers & Featured Contents logic similar to v5, simplified via broadcastData) ...
app.post("/api/passed/add", async (req, res) => {
    const num = parseInt(req.body.number);
    if (!num) return res.status(400).json({ error: "無效數字" });
    await redis.zadd(KEY_PASSED_NUMBERS, num, num);
    await redis.zremrangebyrank(KEY_PASSED_NUMBERS, 0, -21);
    addAdminLog(req.user.nickname, `過號新增 ${num}`);
    broadcastData(KEY_PASSED_NUMBERS, "updatePassed", false);
    res.json({ success: true });
});

app.post("/api/passed/remove", async (req, res) => {
    await redis.zrem(KEY_PASSED_NUMBERS, req.body.number);
    addAdminLog(req.user.nickname, `過號移除 ${req.body.number}`);
    broadcastData(KEY_PASSED_NUMBERS, "updatePassed", false);
    res.json({ success: true });
});

app.post("/api/passed/clear", async (req, res) => {
    await redis.del(KEY_PASSED_NUMBERS);
    addAdminLog(req.user.nickname, `過號清空`);
    broadcastData(KEY_PASSED_NUMBERS, "updatePassed", false);
    res.json({ success: true });
});

app.post("/api/featured/add", async (req, res) => {
    const { linkText, linkUrl } = req.body;
    if (!linkText || !linkUrl) return res.status(400).json({ error: "參數不足" });
    await redis.rpush(KEY_FEATURED_CONTENTS, JSON.stringify({ linkText: sanitize(linkText), linkUrl }));
    addAdminLog(req.user.nickname, `連結新增 ${linkText}`);
    broadcastData(KEY_FEATURED_CONTENTS, "updateFeaturedContents", true);
    res.json({ success: true });
});

app.post("/api/featured/remove", async (req, res) => {
    // 注意：lrem 需完全匹配 JSON 字串
    const { linkText, linkUrl } = req.body;
    await redis.lrem(KEY_FEATURED_CONTENTS, 1, JSON.stringify({ linkText, linkUrl }));
    addAdminLog(req.user.nickname, `連結移除 ${linkText}`);
    broadcastData(KEY_FEATURED_CONTENTS, "updateFeaturedContents", true);
    res.json({ success: true });
});
app.post("/api/featured/clear", async (req, res) => {
    await redis.del(KEY_FEATURED_CONTENTS);
    addAdminLog(req.user.nickname, `連結清空`);
    broadcastData(KEY_FEATURED_CONTENTS, "updateFeaturedContents", true);
    res.json({ success: true });
});

// System Settings
app.post("/set-sound-enabled", async (req, res) => {
    const { enabled } = req.body;
    await redis.set(KEY_SOUND_ENABLED, enabled ? "1" : "0");
    addAdminLog(req.user.nickname, `音效設為 ${enabled}`);
    io.emit("updateSoundSetting", enabled);
    res.json({ success: true });
});

app.post("/set-public-status", async (req, res) => {
    const { isPublic } = req.body;
    await redis.set(KEY_IS_PUBLIC, isPublic ? "1" : "0");
    addAdminLog(req.user.nickname, `系統設為 ${isPublic ? '開放' : '維護'}`);
    io.emit("updatePublicStatus", isPublic);
    res.json({ success: true });
});

app.post("/reset", async (req, res) => {
    const multi = redis.multi();
    multi.set(KEY_CURRENT_NUMBER, 0);
    multi.del(KEY_PASSED_NUMBERS);
    multi.del(KEY_FEATURED_CONTENTS);
    multi.set(KEY_SOUND_ENABLED, "0");
    multi.set(KEY_IS_PUBLIC, "1");
    multi.del(KEY_ADMIN_LOG);
    multi.del(KEY_HISTORY_STATS); 
    // 注意：這裡不刪除 users 和 nicknames，防止管理員被踢出
    // 也不刪除 KEY_STATS_DAILY 以保留歷史統計（視需求而定）
    await multi.exec();
    
    addAdminLog(req.user.nickname, `💥 系統全域重置`);
    
    // 廣播重置狀態
    io.emit("update", 0);
    io.emit("updatePassed", []);
    io.emit("updateFeaturedContents", []);
    io.emit("updateSoundSetting", false);
    io.emit("updatePublicStatus", true);
    io.emit("initAdminLogs", []);
    await updateTimestamp();
    res.json({ success: true });
});

app.post("/api/logs/clear", async (req, res) => {
    await redis.del(KEY_ADMIN_LOG);
    io.emit("initAdminLogs", []);
    res.json({ success: true });
});

// --- 10. Super Admin APIs ---
app.use(["/api/admin/users", "/api/admin/add-user", "/api/admin/del-user", "/api/admin/set-nickname"], 
    authMiddleware, superAdminAuthMiddleware);

app.post("/api/admin/users", async (req, res) => {
    const nicknames = await redis.hgetall(KEY_NICKNAMES) || {};
    const normalUsers = await redis.hkeys(KEY_USERS) || [];
    
    const list = [{ 
        username: 'superadmin', 
        nickname: nicknames['superadmin'] || 'Super Admin', 
        role: 'super' 
    }];
    normalUsers.forEach(u => list.push({ username: u, nickname: nicknames[u] || u, role: 'normal' }));
    res.json({ success: true, users: list });
});

app.post("/api/admin/add-user", async (req, res) => {
    const { newUsername, newPassword, newNickname } = req.body;
    if(await redis.hexists(KEY_USERS, newUsername)) return res.status(400).json({error: "帳號已存在"});
    
    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await redis.hset(KEY_USERS, newUsername, hash);
    await redis.hset(KEY_NICKNAMES, newUsername, sanitize(newNickname) || newUsername);
    
    addAdminLog(req.user.nickname, `新增管理員 ${newUsername}`);
    res.json({ success: true });
});

app.post("/api/admin/del-user", async (req, res) => {
    const { delUsername } = req.body;
    if (delUsername === 'superadmin') return res.status(400).json({error: "不可刪除超級管理員"});
    await redis.hdel(KEY_USERS, delUsername);
    await redis.hdel(KEY_NICKNAMES, delUsername);
    addAdminLog(req.user.nickname, `刪除管理員 ${delUsername}`);
    res.json({ success: true });
});

app.post("/api/admin/set-nickname", async (req, res) => {
    const { targetUsername, nickname } = req.body;
    await redis.hset(KEY_NICKNAMES, targetUsername, sanitize(nickname));
    addAdminLog(req.user.nickname, `修改 ${targetUsername} 暱稱為 ${nickname}`);
    res.json({ success: true });
});

// --- 11. Socket.io ---
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

            socket.on("disconnect", () => {
                onlineAdmins.delete(socket.id);
                broadcastOnlineAdmins();
            });
        }
    }

    // Send Initial State
    try {
        const pipeline = redis.multi();
        pipeline.get(KEY_CURRENT_NUMBER);
        pipeline.zrange(KEY_PASSED_NUMBERS, 0, -1);
        pipeline.lrange(KEY_FEATURED_CONTENTS, 0, -1);
        pipeline.get(KEY_LAST_UPDATED);
        pipeline.get(KEY_SOUND_ENABLED);
        pipeline.get(KEY_IS_PUBLIC);
        const results = await pipeline.exec();
        
        socket.emit("update", Number(results[0][1] || 0));
        socket.emit("updatePassed", (results[1][1] || []).map(Number));
        socket.emit("updateFeaturedContents", (results[2][1] || []).map(JSON.parse));
        socket.emit("updateTimestamp", results[3][1] || new Date().toISOString());
        socket.emit("updateSoundSetting", results[4][1] === "1");
        socket.emit("updatePublicStatus", results[5][1] !== "0"); // Default true
        
    } catch(e) { console.error("Socket init error:", e); }
});

// --- 12. Graceful Shutdown ---
async function shutdown() {
    console.log('🛑 正在關閉伺服器...');
    io.close(); // 關閉 socket 連線
    await redis.quit(); // 關閉 Redis
    server.close(() => {
        console.log('✅ HTTP 伺服器已關閉');
        process.exit(0);
    });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// --- 13. Start ---
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server v6 ready on port ${PORT}`);
});
