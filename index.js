/*
 * ==========================================
 * 伺服器 (index.js) - v18.15 Optimized
 * ==========================================
 */

const express = require("express");
const http = require("http");
const socketio = require("socket.io");
const Redis = require("ioredis");
const helmet = require('helmet'); 
const rateLimit = require('express-rate-limit'); 
const { v4: uuidv4 } = require('uuid'); 
const bcrypt = require('bcrypt'); 
const line = require('@line/bot-sdk'); 
const cron = require('node-cron'); 

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = socketio(server, { cors: { origin: "*" }, pingTimeout: 60000 });

const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.UPSTASH_REDIS_URL;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN; 

// ... (常量定義、LINE config, redis client 等保持不變) ...

const SALT_ROUNDS = 10; 
const REMIND_BUFFER = 5; 
const MAX_VALID_SERVICE_MINUTES = 20;  

// LINE 設定
const lineConfig = {
    channelAccessToken: process.env.LINE_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET
};
let lineClient = null;
if (lineConfig.channelAccessToken && lineConfig.channelSecret) lineClient = new line.Client(lineConfig);

const redis = new Redis(REDIS_URL, {
    tls: { rejectUnauthorized: false },
    retryStrategy: (times) => Math.min(times * 50, 2000)
});

// --- Redis Keys ---
const KEY_CURRENT_NUMBER = 'callsys:number';
const KEY_LAST_ISSUED = 'callsys:issued'; 
const KEY_SYSTEM_MODE = 'callsys:mode'; 
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
const KEY_LINE_SUB_PREFIX = 'callsys:line:notify:'; 
const KEY_LINE_USER_STATUS = 'callsys:line:user:';
const KEY_LINE_UNLOCK_PWD = 'callsys:line:unlock_pwd';
const KEY_LINE_ADMIN_UNLOCK = 'callsys:line:admin_session:';

const MSG_KEYS = [
    'APPROACH', 'ARRIVAL', 'STATUS', 'PERSONAL', 'PASSED', 
    'SET_OK', 'CANCEL', 'LOGIN_HINT', 'ERR_PASSED', 'ERR_NO_SUB'
].map(k => `KEY_LINE_MSG_${k}`);

// --- 預設文案 (Defaults) ---
// ... (DEFAULT_MSG_* 定義保持不變) ...

const DEFAULT_MSG_APPROACH   = "🔔 叫號提醒！\n\n目前已叫號至 {current} 號。\n您的 {target} 號即將輪到 (剩 {diff} 組)，請準備前往現場！";
const DEFAULT_MSG_ARRIVAL    = "🎉 輪到您了！\n\n目前號碼：{current} 號\n請立即前往櫃台辦理。";
const DEFAULT_MSG_STATUS     = "📊 現場狀況報告\n\n目前叫號：{current} 號\n已發號至：{issued} 號{personal}";
const DEFAULT_MSG_PERSONAL   = "\n\n📌 您正在追蹤：{target} 號\n⏳ 前方還有：{diff} 組";
const DEFAULT_MSG_PASSED     = "📋 目前過號名單：\n\n{list}\n\n若您的號碼在名單中，請儘速洽詢櫃台。";
const DEFAULT_MSG_SET_OK     = "✅ 提醒設定成功！\n\n目標號碼：{target} 號\n目前進度：{current} 號\n前方等待：{diff} 組";
const DEFAULT_MSG_CANCEL     = "🗑️ 已取消對 {target} 號的提醒通知。";
const DEFAULT_MSG_LOGIN_HINT = "🔒 請輸入「解鎖密碼」以驗證身份。";
const DEFAULT_MSG_ERR_PASSED = "⚠️ 設定失敗\n{target} 號已經過號或正在叫號 (目前 {current} 號)。";
const DEFAULT_MSG_ERR_NO_SUB = "ℹ️ 您目前沒有設定任何叫號提醒。";

const onlineAdmins = new Map();

// --- Redis Commands ---
redis.defineCommand("safeNextNumber", { /* ... (保持不變) ... */ });
redis.defineCommand("decrIfPositive", { /* ... (保持不變) ... */ });

// --- Middleware & Setup ---
app.use(helmet({ /* ... (保持不變) ... */ }));
if (lineClient) app.post('/callback', line.middleware(lineConfig), (req, res) => { /* ... (保持不變) ... */ });
app.use(express.static("public"));
app.use(express.json()); 

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const ticketLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: "操作過於頻繁" });

const authMiddleware = async (req, res, next) => { /* ... (保持不變) ... */ };
const superAdminAuthMiddleware = (req, res, next) => { /* ... (保持不變) ... */ };

// --- CRON Job ---
cron.schedule('0 4 * * *', async () => { /* ... (保持不變) ... */ });

// --- CORE UTILITIES ---

function sanitize(str) { if (typeof str !== 'string') return ''; return str.replace(/<[^>]*>?/gm, ''); }
async function updateTimestamp() { /* ... (保持不變) ... */ }
function getTaiwanDateInfo() { /* ... (保持不變) ... */ }
async function addAdminLog(nickname, message) { /* ... (保持不變) ... */ }
function broadcastOnlineAdmins() { /* ... (保持不變) ... */ }
async function calculateSmartWaitTime() { /* ... (保持不變) ... */ }
async function logHistory(number, operator, delta = 1) { /* ... (保持不變) ... */ }

/**
 * 廣播數據給前端並更新時間戳
 * @param {string} key - Redis Key
 * @param {string} eventName - Socket.io Event Name
 * @param {boolean} isJSON - 是否為 JSON 陣列 (lrange)
 */
async function broadcastList(key, eventName, isJSON = false) {
    try {
        const raw = isJSON ? await redis.lrange(key, 0, -1) : await redis.zrange(key, 0, -1);
        const data = isJSON ? raw.map(JSON.parse) : raw.map(Number);
        io.emit(eventName, data);
        await updateTimestamp();
    } catch (e) { console.error(`Broadcast ${eventName} error:`, e); }
}

/**
 * 廣播叫號狀態 (Current/Issued)
 */
async function broadcastQueueStatus() {
    const [current, issued] = await redis.mget(KEY_CURRENT_NUMBER, KEY_LAST_ISSUED);
    const currentNum = parseInt(current) || 0;
    let issuedNum = parseInt(issued) || 0;
    
    if (issuedNum < currentNum) {
        issuedNum = currentNum;
        await redis.set(KEY_LAST_ISSUED, issuedNum);
    }
    
    io.emit("update", currentNum);
    io.emit("updateQueue", { current: currentNum, issued: issuedNum });
    io.emit("updateWaitTime", await calculateSmartWaitTime());
    await updateTimestamp();
}

async function checkAndNotifyLineUsers(currentNum) { /* ... (保持不變) ... */ }

// --- LINE Event Handler ---
async function handleLineEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') return Promise.resolve(null);
    
    const text = event.message.text.trim();
    const userId = event.source.userId;
    const replyToken = event.replyToken;

    // 1. 讀取設定
    const keys = MSG_KEYS.map(k => eval(k)); // Use eval to get KEY_LINE_MSG_... string values
    const results = await redis.mget(keys);

    const msgs = {
        STATUS:     results[2] || DEFAULT_MSG_STATUS,
        PERSONAL:   results[3] || DEFAULT_MSG_PERSONAL,
        PASSED:     results[4] || DEFAULT_MSG_PASSED,
        SET_OK:     results[5] || DEFAULT_MSG_SET_OK,
        CANCEL:     results[6] || DEFAULT_MSG_CANCEL,
        LOGIN_HINT: results[7] || DEFAULT_MSG_LOGIN_HINT,
        ERR_PASSED: results[8] || DEFAULT_MSG_ERR_PASSED,
        ERR_NO_SUB: results[9] || DEFAULT_MSG_ERR_NO_SUB,
    };

    // 2. 後台解鎖功能 (保持不變)

    // 3. 查詢進度 (保持不變)

    // 4. 過號名單 (保持不變)

    // 5. 設定提醒 (保持不變)

    // 6. 取消提醒 (保持不變)
    
    return Promise.resolve(null);
}

/**
 * 統一處理叫號/發號/設定號碼的邏輯
 * @param {string} type - 'call', 'issue', 'set_call', 'set_issue'
 * @param {object} req - Express Request
 * @returns {object} { success: boolean, data: object, error: string }
 */
async function handleNumberControl(type, req) {
    const { direction, number } = req.body;
    const currentNum = parseInt(await redis.get(KEY_CURRENT_NUMBER)) || 0;
    let issuedNum = parseInt(await redis.get(KEY_LAST_ISSUED)) || 0;
    let newNum = 0;
    let logMessage = '';
    let delta = 0;
    const pipeline = redis.multi();

    try {
        switch (type) {
            case 'call':
                if (direction === "next") {
                    const result = await redis.safeNextNumber(KEY_CURRENT_NUMBER, KEY_LAST_ISSUED);
                    if (result === -1) return { success: false, error: "目前已無等待人數，無法跳號" };
                    newNum = result; delta = 1; logMessage = `號碼增加為 ${newNum}`;
                } else if (direction === "prev") {
                    newNum = await redis.decrIfPositive(KEY_CURRENT_NUMBER);
                    logMessage = `號碼回退為 ${newNum}`;
                } else {
                    newNum = currentNum;
                }
                
                await logHistory(newNum, req.user.nickname, delta);
                checkAndNotifyLineUsers(newNum);
                await broadcastQueueStatus();

                return { success: true, number: newNum };

            case 'issue':
                if (direction === "next") {
                    newNum = await redis.incr(KEY_LAST_ISSUED);
                    logMessage = `手動發號增加至 ${newNum}`;
                } else if (direction === "prev") {
                    if (issuedNum > currentNum) {
                        newNum = await redis.decr(KEY_LAST_ISSUED);
                        logMessage = `手動發號回退至 ${newNum}`;
                    } else { return { success: false, error: "已發號碼不可小於目前叫號" }; }
                }
                
                await broadcastQueueStatus();
                return { success: true, issued: newNum };
                
            case 'set_call':
                newNum = parseInt(number);
                if (isNaN(newNum) || newNum < 0) return { success: false, error: "無效號碼" };
                
                pipeline.set(KEY_CURRENT_NUMBER, newNum);
                if (newNum > issuedNum) { pipeline.set(KEY_LAST_ISSUED, newNum); }
                
                delta = Math.max(0, newNum - currentNum);
                logMessage = `手動設定為 ${newNum} (統計增加 ${delta})`;

                await pipeline.exec();
                await logHistory(newNum, req.user.nickname, delta);
                checkAndNotifyLineUsers(newNum);
                await broadcastQueueStatus();

                return { success: true };

            case 'set_issue':
                newNum = parseInt(number);
                if (isNaN(newNum) || newNum < 0) return { success: false, error: "無效號碼" };
                if (newNum < currentNum) return { success: false, error: `發號數 (${newNum}) 不可小於目前叫號 (${currentNum})` };

                await redis.set(KEY_LAST_ISSUED, newNum);
                logMessage = `手動修正發號為 ${newNum}`;
                
                await broadcastQueueStatus();
                return { success: true };
                
            default:
                return { success: false, error: "無效操作類型" };
        }
    } catch (e) {
        console.error(`handleNumberControl ${type} error:`, e);
        return { success: false, error: e.message };
    } finally {
        if (logMessage) await addAdminLog(req.user.nickname, logMessage);
    }
}

// --- Routes ---
app.post("/login", loginLimiter, async (req, res) => { /* ... (保持不變) ... */ });

const protectedAPIs = [
    "/api/control/call", "/api/control/issue", "/api/control/set-call", "/api/control/set-issue",
    "/set-system-mode", "/api/passed/add", "/api/passed/remove", "/api/passed/clear",
    "/api/featured/add", "/api/featured/remove", "/api/featured/clear", 
    "/set-sound-enabled", "/set-public-status", "/reset",
    "/api/logs/clear", "/api/admin/stats", "/api/admin/broadcast", 
    "/api/admin/stats/adjust", "/api/admin/stats/clear", "/api/admin/export-csv", 
    "/api/admin/line-settings/get", "/api/admin/line-settings/save", "/api/admin/line-settings/reset",
    "/api/admin/line-settings/set-unlock-pass", "/api/admin/line-settings/get-unlock-pass",
    "/api/control/pass-current", "/api/control/recall-passed" 
];
app.use(protectedAPIs, apiLimiter, authMiddleware);

// --- API: Number Controls (使用統一處理函式) ---
app.post("/api/control/call", async (req, res) => {
    const result = await handleNumberControl('call', req);
    if (result.success) res.json({ success: true, number: result.number });
    else res.status(400).json({ error: result.error });
});

app.post("/api/control/issue", async (req, res) => {
    const result = await handleNumberControl('issue', req);
    if (result.success) res.json({ success: true, issued: result.issued });
    else res.status(400).json({ error: result.error });
});

app.post("/api/control/set-call", async (req, res) => {
    const result = await handleNumberControl('set_call', req);
    if (result.success) res.json({ success: true });
    else res.status(400).json({ error: result.error });
});

app.post("/api/control/set-issue", async (req, res) => {
    const result = await handleNumberControl('set_issue', req);
    if (result.success) res.json({ success: true });
    else res.status(400).json({ error: result.error });
});

// --- API: LINE Settings (精簡結構，但邏輯不變) ---
app.post("/api/admin/line-settings/get", async (req, res) => { /* ... (保持不變) ... */ });
app.post("/api/admin/line-settings/save", async (req, res) => { /* ... (保持不變) ... */ });
app.post("/api/admin/line-settings/reset", async (req, res) => { /* ... (保持不變) ... */ });
app.post("/api/admin/line-settings/set-unlock-pass", superAdminAuthMiddleware, async (req, res) => { /* ... (保持不變) ... */ });
app.post("/api/admin/line-settings/get-unlock-pass", superAdminAuthMiddleware, async (req, res) => { /* ... (保持不變) ... */ });

// --- API: Other Controls ---
app.post("/api/admin/export-csv", superAdminAuthMiddleware, async (req, res) => { /* ... (保持不變) ... */ });
app.post("/api/ticket/take", ticketLimiter, async (req, res) => {
    try {
        const mode = await redis.get(KEY_SYSTEM_MODE);
        if (mode === 'input') return res.status(400).json({ error: "目前僅開放現場手動取號，請輸入您手上的號碼。" });
        const newTicket = await redis.incr(KEY_LAST_ISSUED);
        const current = await redis.get(KEY_CURRENT_NUMBER);
        if (current === null) await redis.set(KEY_CURRENT_NUMBER, 0);
        await broadcastQueueStatus();
        res.json({ success: true, ticket: newTicket });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/set-system-mode", superAdminAuthMiddleware, async (req, res) => {
    try {
        const { mode } = req.body;
        if (!['ticketing', 'input'].includes(mode)) return res.status(400).json({ error: "無效模式" });
        await redis.set(KEY_SYSTEM_MODE, mode);
        addAdminLog(req.user.nickname, `切換系統模式為: ${mode === 'ticketing' ? '線上取號' : '手動輸入'}`);
        io.emit("updateSystemMode", mode);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/control/pass-current", async (req, res) => {
    try {
        const current = parseInt(await redis.get(KEY_CURRENT_NUMBER)) || 0;
        if (current === 0) return res.status(400).json({ error: "目前無叫號" });

        await redis.zadd(KEY_PASSED_NUMBERS, current, current);
        const nextNum = await redis.safeNextNumber(KEY_CURRENT_NUMBER, KEY_LAST_ISSUED);
        
        // 即使 safeNextNumber 返回 -1，也應該在 logHistory 和 broadcastQueueStatus 中使用 current + 1 之後的實際數值
        // 為了確保 logHistory 統計正確，這裡需要修正 log
        const actualNextNum = nextNum === -1 ? current : nextNum;

        await logHistory(actualNextNum, req.user.nickname, 1);
        addAdminLog(req.user.nickname, `⏩ ${current} 號未到，標記過號，跳至 ${actualNextNum} 號`);

        await broadcastList(KEY_PASSED_NUMBERS, "updatePassed", false);
        checkAndNotifyLineUsers(actualNextNum);
        await broadcastQueueStatus();

        res.json({ success: true, next: actualNextNum });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/control/recall-passed", async (req, res) => {
    try {
        const { number } = req.body;
        const targetNum = parseInt(number);
        if (isNaN(targetNum)) return res.status(400).json({ error: "無效號碼" });
        
        const pipeline = redis.multi();
        pipeline.zrem(KEY_PASSED_NUMBERS, targetNum);
        pipeline.set(KEY_CURRENT_NUMBER, targetNum);
        await pipeline.exec();

        addAdminLog(req.user.nickname, `↩️ 重呼過號 ${targetNum} (插隊辦理)`);

        await broadcastList(KEY_PASSED_NUMBERS, "updatePassed", false);
        await broadcastQueueStatus();
        io.emit("update", targetNum); 

        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/broadcast", async (req, res) => { /* ... (保持不變) ... */ });
app.post("/api/admin/stats", async (req, res) => { /* ... (保持不變) ... */ });
app.post("/api/admin/stats/adjust", async (req, res) => { /* ... (保持不變) ... */ });
app.post("/api/admin/stats/clear", async (req, res) => { /* ... (保持不變) ... */ });

// --- API: List Editors (使用統一廣播函式) ---
app.post("/api/passed/add", async (req, res) => { await redis.zadd(KEY_PASSED_NUMBERS, req.body.number, req.body.number); broadcastList(KEY_PASSED_NUMBERS, "updatePassed", false); res.json({ success: true }); });
app.post("/api/passed/remove", async (req, res) => { await redis.zrem(KEY_PASSED_NUMBERS, req.body.number); broadcastList(KEY_PASSED_NUMBERS, "updatePassed", false); res.json({ success: true }); });
app.post("/api/passed/clear", async (req, res) => { await redis.del(KEY_PASSED_NUMBERS); broadcastList(KEY_PASSED_NUMBERS, "updatePassed", false); res.json({ success: true }); });
app.post("/api/featured/add", async (req, res) => { await redis.rpush(KEY_FEATURED_CONTENTS, JSON.stringify(req.body)); broadcastList(KEY_FEATURED_CONTENTS, "updateFeaturedContents", true); res.json({ success: true }); });
app.post("/api/featured/remove", async (req, res) => { await redis.lrem(KEY_FEATURED_CONTENTS, 1, JSON.stringify(req.body)); broadcastList(KEY_FEATURED_CONTENTS, "updateFeaturedContents", true); res.json({ success: true }); });
app.post("/api/featured/clear", async (req, res) => { await redis.del(KEY_FEATURED_CONTENTS); broadcastList(KEY_FEATURED_CONTENTS, "updateFeaturedContents", true); res.json({ success: true }); });

// --- API: Toggles & Reset ---
app.post("/set-sound-enabled", async (req, res) => { await redis.set(KEY_SOUND_ENABLED, req.body.enabled ? "1" : "0"); addAdminLog(req.user.nickname, `音效設為 ${req.body.enabled}`); io.emit("updateSoundSetting", req.body.enabled); res.json({ success: true }); });
app.post("/set-public-status", async (req, res) => { await redis.set(KEY_IS_PUBLIC, req.body.isPublic ? "1" : "0"); addAdminLog(req.user.nickname, `系統設為 ${req.body.isPublic ? '開放' : '維護'}`); io.emit("updatePublicStatus", req.body.isPublic); res.json({ success: true }); });
app.post("/reset", async (req, res) => { /* ... (保持不變) ... */ });
app.post("/api/logs/clear", async (req, res) => { /* ... (保持不變) ... */ });

// --- API: User Management (保持不變) ---
app.use(["/api/admin/users", "/api/admin/add-user", "/api/admin/del-user", "/api/admin/set-nickname"], authMiddleware, superAdminAuthMiddleware);
app.post("/api/admin/users", async (req, res) => { /* ... (保持不變) ... */ });
app.post("/api/admin/add-user", async (req, res) => { /* ... (保持不變) ... */ });
app.post("/api/admin/del-user", async (req, res) => { /* ... (保持不變) ... */ });
app.post("/api/admin/set-nickname", async (req, res) => { /* ... (保持不變) ... */ });

// --- Socket.io Connection ---
io.on("connection", async (socket) => { /* ... (保持不變) ... */ });

// --- Shutdown Hooks (保持不變) ---
async function shutdown() { /* ... (保持不變) ... */ }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server v18.15 (Optimized) ready on port ${PORT}`);
});
