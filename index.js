/* index.js - Optimized v18.8 */
require('dotenv').config();
const { Server } = require("http"), express = require("express"), socketio = require("socket.io");
const Redis = require("ioredis"), helmet = require('helmet'), rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid'), bcrypt = require('bcrypt'), line = require('@line/bot-sdk');
const cron = require('node-cron'), fs = require("fs"), path = require("path"), sqlite3 = require('sqlite3').verbose();

// Config
const { PORT=3000, UPSTASH_REDIS_URL:REDIS_URL, ADMIN_TOKEN, LINE_ACCESS_TOKEN:LAT, LINE_CHANNEL_SECRET:LCS, ALLOWED_ORIGINS } = process.env;
if (!ADMIN_TOKEN || !REDIS_URL) { console.error("❌ Missing Env"); process.exit(1); }
const app = express(), server = Server(app), redis = new Redis(REDIS_URL, { tls:{rejectUnauthorized:false}, retryStrategy:t=>Math.min(t*50,2000) });
const io = socketio(server, { cors:{origin:ALLOWED_ORIGINS?.split(',')||["http://localhost:3000"], methods:["GET","POST"], credentials:true}, pingTimeout:60000 });

// Consts
const KEYS = { CUR:'callsys:number', ISS:'callsys:issued', MODE:'callsys:mode', PASS:'callsys:passed', FEAT:'callsys:featured', LOG:'callsys:admin-log', USR:'callsys:users', NICK:'callsys:nicknames', ROLE:'callsys:user_roles', SESS:'callsys:session:', HIS:'callsys:stats:history', HR:'callsys:stats:hourly:', R_CFG:'callsys:config:roles', H_CFG:'callsys:config:hours', LINE:{ SUB:'callsys:line:notify:', USR:'callsys:line:user:', PWD:'callsys:line:unlock_pwd', ADM:'callsys:line:admin_session:', CTX:'callsys:line:context:', ACT:'callsys:line:active_subs_set', TOK:'callsys:line:cfg:token', SEC:'callsys:line:cfg:secret', AR:'callsys:line:autoreply_rules', CMD:{LOGIN:'callsys:line:cmd:login', STAT:'callsys:line:cmd:status', CAN:'callsys:line:cmd:cancel'}, MSG:{APP:'callsys:line:msg:approach', ARR:'callsys:line:msg:arrival', SUC:'callsys:line:msg:success', PAS:'callsys:line:msg:passed', CAN:'callsys:line:msg:cancel', DEF:'callsys:line:msg:default'} } };
const ROLES = { OPERATOR:{level:1,can:['call','pass','recall','issue','appointment']}, MANAGER:{level:2,can:['call','pass','recall','issue','appointment','stats','settings','users']}, ADMIN:{level:9,can:['*']} };

// DB & Redis Init
const db = new sqlite3.Database(path.join(__dirname,'callsys.db')), dbQ = [];
const dbRun = (s,p=[]) => new Promise((r,j)=>db.run(s,p,function(e){e?j(e):r(this)})), dbAll = (s,p=[]) => new Promise((r,j)=>db.all(s,p,(e,x)=>e?j(e):r(x))), dbGet = (s,p=[]) => new Promise((r,j)=>db.get(s,p,(e,x)=>e?j(e):r(x)));
db.serialize(() => { db.run("PRAGMA journal_mode=WAL;"); db.run("CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY, date_str TEXT, timestamp INTEGER, number INTEGER, action TEXT, operator TEXT, wait_time_min REAL); CREATE INDEX IF NOT EXISTS idx_h_date ON history(date_str);"); db.run("CREATE TABLE IF NOT EXISTS appointments (id INTEGER PRIMARY KEY, number INTEGER, scheduled_time INTEGER, status TEXT DEFAULT 'pending')"); });
setInterval(() => { if(dbQ.length){ const b=[...dbQ]; dbQ.length=0; db.serialize(()=>{ db.run("BEGIN"); const s=db.prepare("INSERT INTO history (date_str, timestamp, number, action, operator, wait_time_min) VALUES (?,?,?,?,?,?)"); b.forEach(x=>s.run(Object.values(x))); s.finalize(); db.run("COMMIT"); }); } }, 5000);
(async()=>{ if(!(await redis.exists(KEYS.R_CFG))) await redis.set(KEYS.R_CFG, JSON.stringify(ROLES)); })();

// Helpers
const getTW = () => { const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit'}).formatToParts(new Date()); return {d:`${p[0].value}-${p[2].value}-${p[4].value}`, h:parseInt(p[6].value)%24}; };
const log = async (n,m) => { const t=new Date().toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei'}); await redis.lpush(KEYS.LOG, `[${t}] [${n}] ${m}`); await redis.ltrim(KEYS.LOG,0,99); io.to("admin").emit("newAdminLog", `[${t}] [${n}] ${m}`); };
let cacheW=0, lastW=0, lineCli=null;
const initLine = async () => { const [t,s] = await redis.mget(KEYS.LINE.TOK, KEYS.LINE.SEC); if(t||LAT) lineCli = new line.Client({channelAccessToken:t||LAT, channelSecret:s||LCS}); }; initLine();
const calcWait = async () => { if(Date.now()-lastW<6e4) return cacheW; const r = await dbAll("SELECT timestamp FROM history WHERE action='call' ORDER BY timestamp DESC LIMIT 20"); if(r.length<2) return (cacheW=0); let t=0; for(let i=0;i<r.length-1;i++) t+=(r[i].timestamp-r[i+1].timestamp); return (lastW=Date.now(), cacheW=Math.ceil((t/(r.length-1)/6e4)*10)/10); };
const bCast = async () => { const [c,i] = (await redis.mget(KEYS.CUR, KEYS.ISS)).map(x=>parseInt(x)||0); if(i<c) await redis.set(KEYS.ISS, c); io.emit("update",c); io.emit("updateQueue",{current:c,issued:Math.max(i,c)}); io.emit("updateWaitTime",await calcWait()); };
const bAppts = async () => io.to("admin").emit("updateAppointments", await dbAll("SELECT * FROM appointments WHERE status='pending' ORDER BY scheduled_time ASC"));

// Middleware & Router
app.use(helmet({contentSecurityPolicy:false}), express.static("public"), express.json(), (req,r,n)=>{ req.user=null; n(); });
const H = fn => async(q,s,n) => { try{ const r=await fn(q,s); if(r!==false) s.json(r||{success:true}); }catch(e){ s.status(500).json({error:e.message}); } };
const auth = async(q,s,n) => { try { const t=q.headers.cookie?.split(';').find(x=>x.trim().startsWith('token='))?.split('=')[1]; const u=t&&JSON.parse(await redis.get(KEYS.SESS+t)); if(!u)throw 0; q.user=u; await redis.expire(KEYS.SESS+t,28800); n(); } catch{s.status(403).json({error:"權限失效"});} };
const perm = p => async(q,s,n) => { if(q.user.role==='super')return n(); const r=JSON.parse(await redis.get(KEYS.R_CFG))||ROLES, ur=r[q.user.userRole||'OPERATOR']; if(ur.level>=9||ur.can.includes(p)||ur.can.includes('*'))return n(); s.status(403).json({error:"權限不足"}); };

// --- Routes ---
app.post("/login", rateLimit({windowMs:9e5,max:100}), H(async q => {
    const {username:u, password:p} = q.body, isS = (u==='superadmin' && p===(ADMIN_TOKEN||"").trim());
    if(!isS && (!await redis.hexists(KEYS.USR,u) || !await bcrypt.compare(p, await redis.hget(KEYS.USR,u)))) throw new Error("驗證失敗");
    const t=uuidv4(), n=await redis.hget(KEYS.NICK,u)||u, r=isS?'ADMIN':(await redis.hget(KEYS.ROLE,u)||'OPERATOR');
    await redis.set(KEYS.SESS+t, JSON.stringify({username:u, role:isS?'super':'normal', userRole:r, nickname:n}), "EX", 28800);
    q.res.setHeader('Set-Cookie', `token=${t}; HttpOnly; Path=/; Max-Age=28800; SameSite=Strict`); return {username:u, nickname:n, role:isS?'super':'normal', userRole:r};
}));

app.post("/api/ticket/take", rateLimit({windowMs:36e5,max:20}), H(async () => {
    if(await redis.get(KEYS.MODE)==='input') throw new Error("手動模式");
    const c=JSON.parse(await redis.get(KEYS.H_CFG))||{enabled:false}, {d,h}=getTW();
    if(c.enabled && (h<c.start || h>=c.end)) throw new Error("非營業時間");
    const t = await redis.incr(KEYS.ISS); await redis.hincrby(KEYS.HR+d, `${h}_i`, 1);
    dbQ.push({d, t:Date.now(), n:t, a:'online_take', o:'User', w:await calcWait()}); bCast(); return {ticket:t};
}));

// Control APIs
const ctl = async (act, {body:{direction:d, number:n}, user}) => {
    let c=parseInt(await redis.get(KEYS.CUR))||0, i=parseInt(await redis.get(KEYS.ISS))||0, nn=0, msg='', {d:dt,h}=getTW();
    if(act==='call') {
        if(d==='next') {
            const apt = await dbGet("SELECT number FROM appointments WHERE status='pending' AND scheduled_time<=? ORDER BY scheduled_time LIMIT 1", [Date.now()]);
            if(apt) { nn=apt.number; await redis.set(KEYS.CUR, nn); await dbRun("UPDATE appointments SET status='called' WHERE number=?", [nn]); msg=`🔔 預約 ${nn}`; bAppts(); }
            else { if((parseInt(await redis.get(KEYS.CUR))||0)>=(parseInt(await redis.get(KEYS.ISS))||0)) return {error:"已無等待"}; nn = await redis.incr(KEYS.CUR); msg=`叫號 ${nn}`; }
        } else { nn = (c>0) ? await redis.decr(KEYS.CUR) : 0; msg=`回退 ${nn}`; }
        checkLine(nn);
    } else if(act==='issue') {
        if(d==='next') { nn=await redis.incr(KEYS.ISS); await redis.hincrby(KEYS.HR+dt,`${h}_i`,1); msg=`發號 ${nn}`; }
        else { if(i>c) { nn=await redis.decr(KEYS.ISS); await redis.hincrby(KEYS.HR+dt,`${h}_i`,-1); msg=`收回 ${nn}`; } else return {error:"無法收回"}; }
    } else if(act.startsWith('set')) {
        nn=parseInt(n); if(isNaN(nn)||nn<0) return {error:"無效"};
        if(act==='set_iss') { await redis.hincrby(KEYS.HR+dt,`${h}_i`, nn-i); await redis.set(KEYS.ISS, nn); msg=`設發號 ${nn}`; }
        else { await redis.mset(KEYS.CUR, nn, ...(nn>i?[KEYS.ISS,nn]:[])); msg=`設叫號 ${nn}`; checkLine(nn); }
    }
    if(msg) { log(user.nickname, msg); dbQ.push({d:dt, t:Date.now(), n:nn||c, a:act, o:user.nickname, w:await calcWait()}); bCast(); } return {number:nn};
};
['call','issue','set-call','set-issue'].forEach(k => app.post(`/api/control/${k}`, auth, perm(k.startsWith('set')?'settings':k.split('-')[0]), H(r => ctl(k.replace('-','_').replace('issue','iss'), r))));

// Lists & Stats
app.post("/api/control/pass-current", auth, perm('pass'), H(async q => { const c=parseInt(await redis.get(KEYS.CUR)); if(!c)throw new Error("無號"); await redis.zadd(KEYS.PASS,c,c); const {d,h}=getTW(); await redis.hincrby(KEYS.HR+d,`${h}_p`,1); ctl('call',{body:{direction:'next'},user:q.user}); io.emit("updatePassed", (await redis.zrange(KEYS.PASS,0,-1)).map(Number)); }));
app.post("/api/control/recall-passed", auth, perm('recall'), H(async q => { const n=parseInt(q.body.number); await redis.zrem(KEYS.PASS, n); await redis.set(KEYS.CUR, n); log(q.user.nickname, `重呼 ${n}`); bCast(); io.emit("updatePassed", (await redis.zrange(KEYS.PASS,0,-1)).map(Number)); }));
app.post("/api/admin/stats", auth, perm('stats'), H(async () => { const {d,h}=getTW(), H=await redis.hgetall(KEYS.HR+d), c=Array(24).fill(0); let t=0; for(let i=0;i<24;i++){ c[i]=Math.max(0,(parseInt(H[`${i}_i`]||H[i]||0))-(parseInt(H[`${i}_p`]||0))); t+=c[i]; } return {history:await dbAll("SELECT * FROM history ORDER BY id DESC LIMIT 50"), hourlyCounts:c, todayCount:t, serverHour:h}; }));
app.post("/reset", auth, perm('settings'), H(async q => { await redis.mset(KEYS.CUR,0,KEYS.ISS,0); await redis.del(KEYS.PASS, KEYS.LINE.ACT); await dbRun("UPDATE appointments SET status='cancelled'"); log(q.user.nickname,"💥 重置"); bCast(); bAppts(); io.emit("updatePassed",[]); }));

// CRUD & Configs
const crud = (u,p,fn) => app.post(u,auth,perm(p),H(fn));
crud("/api/passed/add", 'pass', async q=>{ const n=parseInt(q.body.number); if(n>0) { await redis.zadd(KEYS.PASS, n, n); io.emit("updatePassed", (await redis.zrange(KEYS.PASS,0,-1)).map(Number)); } });
crud("/api/passed/remove", 'pass', async q=>{ await redis.zrem(KEYS.PASS, q.body.number); io.emit("updatePassed", (await redis.zrange(KEYS.PASS,0,-1)).map(Number)); });
crud("/api/passed/clear", 'pass', async q=>{ await redis.del(KEYS.PASS); io.emit("updatePassed",[]); });
crud("/api/featured/add", 'settings', async q=>{ await redis.rpush(KEYS.FEAT, JSON.stringify(q.body)); io.emit("updateFeaturedContents", (await redis.lrange(KEYS.FEAT,0,-1)).map(JSON.parse)); });
crud("/api/featured/get", '*', async ()=> (await redis.lrange(KEYS.FEAT,0,-1)).map(JSON.parse));
crud("/api/featured/edit", 'settings', async q => { const l=await redis.lrange(KEYS.FEAT,0,-1), idx=l.findIndex(x=>x.includes(q.body.oldLinkUrl)); if(idx>=0) await redis.lset(KEYS.FEAT, idx, JSON.stringify({linkText:q.body.newLinkText, linkUrl:q.body.newLinkUrl})); io.emit("updateFeaturedContents", (await redis.lrange(KEYS.FEAT,0,-1)).map(JSON.parse)); });
crud("/api/featured/remove", 'settings', async q=>{ const l=await redis.lrange(KEYS.FEAT,0,-1), t=l.find(x=>x.includes(q.body.linkUrl)); if(t) await redis.lrem(KEYS.FEAT,1,t); io.emit("updateFeaturedContents", (await redis.lrange(KEYS.FEAT,0,-1)).map(JSON.parse)); });
crud("/api/featured/clear", 'settings', async q=>{ await redis.del(KEYS.FEAT); io.emit("updateFeaturedContents",[]); });
crud("/api/admin/users", 'users', async ()=>{ const ks=await redis.hkeys(KEYS.USR); return {users:[{username:'superadmin',nickname:'Super',role:'ADMIN'}, ...await Promise.all(ks.map(async u=>({username:u, nickname:await redis.hget(KEYS.NICK,u)||u, role:await redis.hget(KEYS.ROLE,u)||'OPERATOR'})))]}; });
crud("/api/admin/add-user", 'users', async q=>{ if(await redis.hexists(KEYS.USR, q.body.newUsername)) throw new Error("已存在"); await redis.hset(KEYS.USR, q.body.newUsername, await bcrypt.hash(q.body.newPassword,10)); await redis.hset(KEYS.NICK, q.body.newUsername, q.body.newNickname); await redis.hset(KEYS.ROLE, q.body.newUsername, q.body.newRole||'OPERATOR'); });
crud("/api/admin/del-user", 'users', async q=>{ if(q.body.delUsername==='superadmin') throw 0; await redis.hdel(KEYS.USR, q.body.delUsername); await redis.hdel(KEYS.NICK, q.body.delUsername); await redis.hdel(KEYS.ROLE, q.body.delUsername); });
crud("/api/admin/set-nickname", '*', async q=>{ if(q.user.role!=='super' && q.user.username!==q.body.targetUsername) throw 0; await redis.hset(KEYS.NICK, q.body.targetUsername, q.body.nickname); });
crud("/api/admin/set-role", 'users', async q=>{ if(q.user.role!=='super') throw 0; await redis.hset(KEYS.ROLE, q.body.targetUsername, q.body.newRole); });
crud("/api/admin/roles/get", '*', async ()=> JSON.parse(await redis.get(KEYS.R_CFG)) || ROLES);
crud("/api/admin/roles/update", 'settings', async q=>{ if(q.user.role!=='super') throw 0; await redis.set(KEYS.R_CFG, JSON.stringify(q.body.rolesConfig)); });
crud("/api/admin/stats/clear", 'stats', async q=>{ const {d}=getTW(); await redis.del(KEYS.HR+d); await dbRun("DELETE FROM history WHERE date_str=?",[d]); log(q.user.nickname,"清空今日統計"); });
crud("/api/admin/stats/adjust", 'settings', async q=>{ const {d}=getTW(); await redis.hincrby(KEYS.HR+d, `${q.body.hour}_i`, q.body.delta); });
crud("/api/admin/stats/calibrate", 'settings', async q=>{ 
    const {d,h}=getTW(), [i,p]=await Promise.all([redis.get(KEYS.ISS), redis.zrange(KEYS.PASS,0,-1)]);
    const target=Math.max(0,(parseInt(i)||0)-(p?p.length:0)), H=await redis.hgetall(KEYS.HR+d);
    let curr=0; for(let k=0;k<24;k++) curr+=Math.max(0,(parseInt(H[`${k}_i`]||H[k]||0))-(parseInt(H[`${k}_p`]||0)));
    const diff=target-curr; if(diff!==0) await redis.hincrby(KEYS.HR+d, `${h}_i`, diff); return {success:true, diff};
});
crud("/api/logs/clear", 'stats', async ()=>{ await redis.del(KEYS.LOG); io.to("admin").emit("initAdminLogs",[]); });
crud("/api/appointment/add", 'appointment', async q=>{ const t=new Date(q.body.timeStr).getTime(); if(await dbGet("SELECT id FROM appointments WHERE scheduled_time=? OR number=?",[t,q.body.number])) throw 0; await dbRun("INSERT INTO appointments(number,scheduled_time)VALUES(?,?)",[q.body.number,t]); bAppts(); });
crud("/api/appointment/list", 'appointment', async ()=>({appointments:await dbAll("SELECT * FROM appointments WHERE status='pending' ORDER BY scheduled_time ASC")}));
crud("/api/appointment/remove", 'appointment', async q=>{ await dbRun("DELETE FROM appointments WHERE id=?",[q.body.id]); bAppts(); });
crud("/set-sound-enabled", 'settings', async q=>{ await redis.set("callsys:soundEnabled", q.body.enabled?"1":"0"); io.emit("updateSoundSetting", q.body.enabled); });
crud("/set-public-status", 'settings', async q=>{ await redis.set("callsys:isPublic", q.body.isPublic?"1":"0"); io.emit("updatePublicStatus", q.body.isPublic); });
crud("/set-system-mode", 'settings', async q=>{ await redis.set(KEYS.MODE, q.body.mode); io.emit("updateSystemMode", q.body.mode); });
crud("/api/admin/broadcast", 'settings', async q=>{ io.emit("adminBroadcast", q.body.message); log(q.user.nickname, `廣播: ${q.body.message}`); });
crud("/api/admin/settings/hours/get", '*', async ()=> JSON.parse(await redis.get(KEYS.H_CFG)) || {enabled:false,start:8,end:22});
crud("/api/admin/settings/hours/save", 'settings', async q=>{ await redis.set(KEYS.H_CFG, JSON.stringify(q.body)); });
crud("/api/admin/line-settings/get", 'line', async ()=>({ "LINE Access Token": await redis.get(KEYS.LINE.TOK), "LINE Channel Secret": await redis.get(KEYS.LINE.SEC) }));
crud("/api/admin/line-settings/save", 'line', async q=>{ if(q.body["LINE Access Token"]) await redis.set(KEYS.LINE.TOK, q.body["LINE Access Token"]); if(q.body["LINE Channel Secret"]) await redis.set(KEYS.LINE.SEC, q.body["LINE Channel Secret"]); initLine(); });
crud("/api/admin/line-settings/reset", 'line', async ()=>{ await redis.del(KEYS.LINE.TOK, KEYS.LINE.SEC); initLine(); });
crud("/api/admin/line-settings/get-unlock-pass", 'line', async ()=>({password:await redis.get(KEYS.LINE.PWD)}));
crud("/api/admin/line-settings/save-pass", 'line', async q=>{ await redis.set(KEYS.LINE.PWD, q.body.password); });
crud("/api/admin/line-messages/get", 'line', async ()=>{ const [a,b,c,d,e]=await redis.mget(KEYS.LINE.MSG.APP, KEYS.LINE.MSG.ARR, KEYS.LINE.MSG.SUC, KEYS.LINE.MSG.PAS, KEYS.LINE.MSG.CAN); return {approach:a,arrival:b,success:c,passed:d,cancel:e}; });
crud("/api/admin/line-messages/save", 'line', async q=>{ await redis.mset(KEYS.LINE.MSG.APP,q.body.approach, KEYS.LINE.MSG.ARR,q.body.arrival, KEYS.LINE.MSG.SUC,q.body.success, KEYS.LINE.MSG.PAS,q.body.passed, KEYS.LINE.MSG.CAN,q.body.cancel); });
crud("/api/admin/line-autoreply/list", 'line', async ()=> await redis.hgetall(KEYS.LINE.AR));
crud("/api/admin/line-autoreply/save", 'line', async q=>{ await redis.hset(KEYS.LINE.AR, q.body.keyword.trim(), q.body.reply); });
crud("/api/admin/line-autoreply/edit", 'line', async q=>{ await redis.multi().hdel(KEYS.LINE.AR, q.body.oldKeyword).hset(KEYS.LINE.AR, q.body.newKeyword.trim(), q.body.newReply).exec(); });
crud("/api/admin/line-autoreply/del", 'line', async q=>{ await redis.hdel(KEYS.LINE.AR, q.body.keyword); });
crud("/api/admin/line-default-reply/get", 'line', async ()=>({reply:await redis.get(KEYS.LINE.MSG.DEF)}));
crud("/api/admin/line-default-reply/save", 'line', async q=>{ await redis.set(KEYS.LINE.MSG.DEF, q.body.reply); });
crud("/api/admin/line-system-keywords/get", 'line', async ()=>{ const [a,b,c]=await redis.mget(KEYS.LINE.CMD.LOGIN, KEYS.LINE.CMD.STAT, KEYS.LINE.CMD.CAN); return {login:a,status:b,cancel:c}; });
crud("/api/admin/line-system-keywords/save", 'line', async q=>{ await redis.mset(KEYS.LINE.CMD.LOGIN,q.body.login, KEYS.LINE.CMD.STAT,q.body.status, KEYS.LINE.CMD.CAN,q.body.cancel); });

// Line Webhook
async function checkLine(c) {
    if(!lineCli) return; const t=c+5, [m1,m2,s5,s0]=await Promise.all([redis.get(KEYS.LINE.MSG.APP), redis.get(KEYS.LINE.MSG.ARR), redis.smembers(KEYS.LINE.SUB+t), redis.smembers(KEYS.LINE.SUB+c)]);
    const send=(ids,txt)=> { while(ids.length) lineCli.multicast(ids.splice(0,500),[{type:'text',text:txt}]).catch(console.error); };
    if(s5.length) send(s5, (m1||'🔔 {target}號快到了').replace(/{current}/g,c).replace(/{target}/g,t).replace(/{diff}/g,5));
    if(s0.length) { send(s0, (m2||'🎉 {current}號 到您了').replace(/{current}/g,c)); await redis.del(KEYS.LINE.SUB+c); await redis.srem(KEYS.LINE.ACT,c); s0.forEach(u=>redis.del(KEYS.LINE.USR+u)); }
}
app.post('/callback', (req, res, next) => {
    // 預先檢查 LINE Config，若無則跳過 middleware
    if (!lineCli) return res.status(200).send("Line not configured");
    line.middleware({channelAccessToken:LAT, channelSecret:LCS})(req, res, next);
}, (q,s) => {
    Promise.all(q.body.events.map(async e => {
        if(e.type!=='message' || e.message.type!=='text') return;
        const t=e.message.text.trim(), u=e.source.userId, rp=x=>lineCli.replyMessage(e.replyToken,{type:'text',text:x});
        const [cl,cs,cc] = await redis.mget(KEYS.LINE.CMD.LOGIN, KEYS.LINE.CMD.STAT, KEYS.LINE.CMD.CAN);
        if(t===(cl||'後台登入')) return rp((await redis.get(KEYS.LINE.ADM+u))?`🔗 ${process.env.RENDER_EXTERNAL_URL}/admin.html`:(await redis.set(KEYS.LINE.CTX+u,'WP','EX',120),"請輸入密碼"));
        if((await redis.get(KEYS.LINE.CTX+u))==='WP' && t===(await redis.get(KEYS.LINE.PWD)||`unlock${ADMIN_TOKEN}`)) { await redis.set(KEYS.LINE.ADM+u,1,"EX",600); await redis.del(KEYS.LINE.CTX+u); return rp("🔓 驗證成功"); }
        if((await redis.hget(KEYS.LINE.AR,t))) return rp(await redis.hget(KEYS.LINE.AR,t));
        if((cs||'status,?,查詢').split(',').includes(t.toLowerCase())) { const [n,i,my]=await Promise.all([redis.get(KEYS.CUR),redis.get(KEYS.ISS),redis.get(KEYS.LINE.USR+u)]); return rp(`叫號:${n||0} / 發號:${i||0}${my?`\n您的:${my}`:''}`); }
        if((cc||'cancel,取消').split(',').includes(t.toLowerCase())) { const n=await redis.get(KEYS.LINE.USR+u); if(n){await redis.multi().del(KEYS.LINE.USR+u).srem(KEYS.LINE.SUB+n,u).exec(); return rp(await redis.get(KEYS.LINE.MSG.CAN)||'已取消');} }
        if(/^\d+$/.test(t)) { const n=parseInt(t), c=parseInt(await redis.get(KEYS.CUR))||0; if(n<=c) return rp(await redis.get(KEYS.LINE.MSG.PAS)||'已過號'); await redis.multi().set(KEYS.LINE.USR+u,n,'EX',43200).sadd(KEYS.LINE.SUB+n,u).expire(KEYS.LINE.SUB+n,43200).sadd(KEYS.LINE.ACT,n).exec(); return rp((await redis.get(KEYS.LINE.MSG.SUC)||'設定成功: {number}').replace(/{number}/g,n)); }
        const def = await redis.get(KEYS.LINE.MSG.DEF); if(def) return rp(def);
    })).then(()=>s.json({})).catch(()=>s.status(500).end());
});

// Socket & Init
io.on("connection", async s => {
    s.on("joinRoom", r => s.join(r));
    if(s.handshake.auth.token || s.request.headers.cookie) {
        try { const u=JSON.parse(await redis.get(KEYS.SESS+(s.handshake.auth.token || s.request.headers.cookie.split('token=')[1].split(';')[0]))); if(u){ s.user=u; s.join("admin"); s.emit("initAdminLogs", await redis.lrange(KEYS.LOG,0,99)); bAppts(); } } catch{}
    }
    const [c,i,p,f,sn,pb,m] = await Promise.all([redis.get(KEYS.CUR),redis.get(KEYS.ISS),redis.zrange(KEYS.PASS,0,-1),redis.lrange(KEYS.FEAT,0,-1),redis.get("callsys:soundEnabled"),redis.get("callsys:isPublic"),redis.get(KEYS.MODE)]);
    s.emit("update",Number(c)); s.emit("updateQueue",{current:Number(c),issued:Math.max(Number(i),Number(c))}); s.emit("updatePassed",p.map(Number)); s.emit("updateFeaturedContents",f.map(JSON.parse));
    s.emit("updateSoundSetting",sn==="1"); s.emit("updatePublicStatus",pb!=="0"); s.emit("updateSystemMode",m||'ticketing'); s.emit("updateWaitTime",await calcWait());
});

cron.schedule('0 4 * * *', () => { redis.mset(KEYS.CUR,0,KEYS.ISS,0); redis.del(KEYS.PASS, KEYS.LINE.ACT); dbRun("DELETE FROM history WHERE timestamp < ?", [Date.now()-2592e6]); }, {timezone:"Asia/Taipei"});
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server v18.8 running on ${PORT}`));
