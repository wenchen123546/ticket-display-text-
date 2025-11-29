/* ==========================================
 * 後台邏輯 (admin.js) - v19.8 Language Switch Fixes
 * ========================================== */
const $ = i => document.getElementById(i), $$ = s => document.querySelectorAll(s);
const mk = (t, c, h, e={}, k=[]) => { 
    const x=document.createElement(t); if(c)x.className=c; if(h)x.innerHTML=h; 
    Object.entries(e).forEach(([k,v])=>x[k.startsWith('on')?k.toLowerCase():k]=v); 
    k.forEach(c=>c&&x.append(c)); return x; 
};
const toast = (m, t='info') => { const e=$("toast-notification"); if(!e)return; e.textContent=m; e.className=`show ${t}`; setTimeout(()=>e.className="",3000); };
let curLang=localStorage.getItem('callsys_lang')||'zh-TW', T, userRole, username, uniqueUser, cachedLine, isDark=localStorage.getItem('callsys_admin_theme')==='dark';
const socket = io({ autoConnect: false }), globalRoleConfig = {};

const i18n = {
    "zh-TW":{status_conn:"✅ 已連線",status_dis:"⚠️ 連線中斷",saved:"✅ 已儲存",denied:"❌ 權限不足",confirm:"⚠️ 確認",recall:"↩️ 重呼",edit:"✎ 編輯",del:"✕ 刪除",save:"✓ 儲存",cancel:"✕ 取消",login_title:"請登入",ph_account:"帳號",ph_password:"密碼",login_btn:"登入",logout:"登出",dash_curr:"目前叫號",dash_issued:"已發號至",dash_wait:"等待組數",btn_next:"下一號 ▶",btn_prev:"◀ 上一號",btn_pass:"過號",btn_reset_call:"↺ 重置叫號",btn_recall:"➖ 收回",btn_issue:"發號 ➕",btn_fix:"修正",btn_reset_issue:"↺ 重置發號",btn_clear_passed:"清空過號",lbl_today:"今日人次",btn_calibrate:"校正",btn_clear_stats:"🗑️ 清空統計",btn_clear_logs:"清除日誌",lbl_mode:"取號模式",mode_online:"線上取號",mode_manual:"手動輸入",btn_reset_all:"💥 全域重置",btn_save_roles:"儲存權限變更",btn_restore:"恢復預設值",role_operator:"操作員",role_manager:"經理",role_admin:"管理員",msg_recall_confirm:"確定要重呼 %s 嗎？",msg_sent:"📢 已發送",perm_role:"角色權限",perm_call:"叫號/指揮",perm_issue:"發號",perm_stats:"數據/日誌",perm_settings:"系統設定",perm_line:"LINE設定",perm_appointment:"預約管理",perm_users:"帳號管理",empty:"[ 空 ]",no_logs:"[ 無日誌 ]",no_appt:"暫無預約",loading:"載入中...",wait:"等待..."},
    "en":{status_conn:"✅ Connected",status_dis:"⚠️ Disconnected",saved:"✅ Saved",denied:"❌ Denied",confirm:"⚠️ Confirm",recall:"↩️ Recall",edit:"✎ Edit",del:"✕ Del",save:"✓ Save",cancel:"✕ Cancel",login_title:"Login",ph_account:"Username",ph_password:"Password",login_btn:"Login",logout:"Logout",dash_curr:"Current Serving",dash_issued:"Last Issued",dash_wait:"Waiting",btn_next:"Next ▶",btn_prev:"◀ Prev",btn_pass:"Pass",btn_reset_call:"↺ Reset Call",btn_recall:"➖ Recall",btn_issue:"Issue ➕",btn_fix:"Fix",btn_reset_issue:"↺ Reset Issue",btn_clear_passed:"Clear Passed",lbl_today:"Today Count",btn_calibrate:"Calibrate",btn_clear_stats:"🗑️ Clear Stats",btn_clear_logs:"Clear Logs",lbl_mode:"Mode",mode_online:"Online Ticket",mode_manual:"Manual Input",btn_reset_all:"💥 Factory Reset",btn_save_roles:"Save Roles",btn_restore:"Restore",role_operator:"Operator",role_manager:"Manager",role_admin:"Admin",msg_recall_confirm:"Recall %s?",msg_sent:"📢 Sent",perm_role:"Role",perm_call:"Control",perm_issue:"Ticketing",perm_stats:"Stats",perm_settings:"Settings",perm_line:"Line Config",perm_appointment:"Booking",perm_users:"Users",empty:"[ Empty ]",no_logs:"[ No Logs ]",no_appt:"No Appt",loading:"Loading...",wait:"Waiting..."}
};

async function req(u, d={}, b=null) {
    if(b) b.disabled=true;
    try {
        const r = await fetch(u, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(d)});
        const res = await r.json();
        if(!r.ok) { if(r.status===403 && !res.error?.includes("權限")) logout(); toast(`❌ ${res.error||'Error'}`, "error"); return null; }
        return res;
    } catch(e) { toast(`❌ ${e.message}`, "error"); return null; } finally { if(b) setTimeout(()=>b.disabled=false,300); }
}

const confirmBtn = (el, txt, act) => {
    if(!el) return; let t, c=5; 
    // [Fix] 嚴格比對，只有在字典裡找到對應的 key 才設定 data-k，避免將「✕」等符號誤設為 key
    const foundKey = Object.keys(T).find(k=>T[k]===txt);
    if(foundKey) el.dataset.k = foundKey;

    el.onclick = e => { e.stopPropagation(); if(el.classList.contains("ing")) { act(); reset(); } else { el.classList.add("ing"); el.textContent=`${T.confirm} (${c})`; t=setInterval(()=>{ c--; el.textContent=`${T.confirm} (${c})`; if(c<=0) reset(); },1000); } };
    const reset=()=>{ clearInterval(t); el.classList.remove("ing"); el.textContent=(el.dataset.k ? T[el.dataset.k] : txt); c=5; };
};

const updateLangUI = () => {
    T = i18n[curLang]||i18n["zh-TW"];
    
    // 1. 更新一般文字
    $$('[data-i18n]').forEach(e => {
        // [Fix] 只有當新翻譯存在時才更新，避免 undefined
        const val = T[e.dataset.i18n];
        if(val) e.textContent = val;
        else if(!e.dataset.i18nPh) e.textContent = e.dataset.i18n; // Fallback
    });

    // 2. 更新 Placeholder
    $$('[data-i18n-ph]').forEach(e => e.placeholder = T[e.dataset.i18nPh]||"");

    // 3. 更新動態按鈕 (防止符號按鈕變空白)
    $$('button[data-k]').forEach(b => {
        if(!b.classList.contains('ing')) {
            const val = T[b.dataset.k];
            if(val) b.textContent = val;
        }
    });

    if(uniqueUser) {
        if($("sidebar-user-info")) $("sidebar-user-info").textContent = username;
        // 重新載入列表以套用新語言
        if(checkPerm('users')) loadUsers();
        if(checkPerm('stats')) loadStats();
        if(checkPerm('appointment')) loadAppts();
        if(isSuper()) loadRoles();
        if(checkPerm('settings')) req("/api/featured/get").then(l=>renderList("featured-list-ui",l,renderFeatured));
        if($("section-settings")?.classList.contains("active") && checkPerm('line')) cachedLine ? renderLine() : req("/api/admin/line-settings/get").then(r=>{cachedLine=r;renderLine()});
    }
};

const renderList = (id, list, fn, emptyK="empty") => {
    const ul=$(id); if(!ul) return; ul.innerHTML="";
    if(!list?.length) return ul.innerHTML=`<li class="list-item center sub">${T[emptyK]||T.empty}</li>`;
    const f=document.createDocumentFragment(); list.forEach(x=>{const el=fn(x); if(el)f.append(el)}); ul.append(f);
};

const checkPerm = p => isSuper() || (globalRoleConfig[userRole]?.can||[]).some(x=>x==='*'||x===p);
const isSuper = () => uniqueUser==='superadmin' || ['super','ADMIN'].includes(userRole);

const checkSession = async () => {
    uniqueUser=localStorage.getItem('callsys_user'); userRole=localStorage.getItem('callsys_role'); username=localStorage.getItem('callsys_nick');
    if(uniqueUser==='superadmin' && userRole!=='ADMIN') localStorage.setItem('callsys_role', userRole='ADMIN');
    
    const m = $("edit-stats-overlay"); if(m) m.style.display = "none";

    if(uniqueUser) {
        $("login-container").style.display="none"; 
        $("admin-panel").style.display="flex";
        
        Object.assign(globalRoleConfig, await req("/api/admin/roles/get"));
        
        $$('[data-perm]').forEach(e => {
            const allowed = checkPerm(e.dataset.perm);
            if(e.classList.contains('admin-card')) e.style.display = allowed ? 'flex' : 'none';
            else e.style.display = allowed ? '' : 'none';
        });
        
        ['card-role-management','btn-export-csv','mode-switcher-group','unlock-pwd-group','resetNumber','resetIssued','resetPassed','resetFeaturedContents','btn-clear-logs','btn-clear-stats','btn-reset-line-msg','resetAll'].forEach(id=>$(id)&&($(id).style.display=isSuper()?"block":"none"));
        
        socket.connect(); 
        updateLangUI(); // [Important] 初始化 T 與介面語言
        upgradeModeUI(); // [Important] 在 T 初始化後再建立 UI
        
        if(!document.querySelector('.section-group.active')) {
            const firstNav = document.querySelector('.nav-btn:not([style*="display: none"])');
            if(firstNav) firstNav.click();
        }
    } else { 
        $("login-container").style.display="block"; 
        $("admin-panel").style.display="none"; 
        socket.disconnect(); 
    }
};

const logout = () => { localStorage.clear(); document.cookie="token=;expires=0;path=/;"; location.reload(); };

/* --- Socket & Realtime --- */
socket.on("connect", () => { $("status-bar").classList.remove("visible"); toast(`${T.status_conn} (${username})`, "success"); });
socket.on("disconnect", () => $("status-bar").classList.add("visible"));
socket.on("updateQueue", d => { if($("number")) $("number").textContent=d.current; if($("issued-number")) $("issued-number").textContent=d.issued; if($("waiting-count")) $("waiting-count").textContent=Math.max(0, d.issued-d.current); if(checkPerm('stats')) loadStats(); });
socket.on("update", n => { if($("number")) $("number").textContent=n; if(checkPerm('stats')) loadStats(); });
socket.on("initAdminLogs", l => checkPerm('stats') && renderLogs(l,1));
socket.on("newAdminLog", l => checkPerm('stats') && renderLogs([l],0));
socket.on("updatePublicStatus", b => { if($("public-toggle")) $("public-toggle").checked=b });
socket.on("updateSoundSetting", b => { if($("sound-toggle")) $("sound-toggle").checked=b });
socket.on("updateSystemMode", m => { $$('input[name="systemMode"]').forEach(r=>r.checked=(r.value===m)); $$('.segmented-option').forEach(l=>l.classList.toggle('active', l.querySelector('input').value===m)); });
socket.on("updateAppointments", l => checkPerm('appointment') && renderAppts(l));
socket.on("updatePassed", l => renderList("passed-list-ui", l, n => mk("li","list-item",null,{},[mk("span","list-main-text",`${n} #`,{style:"color:var(--primary)"}), mk("div","list-actions",null,{},[mk("button","btn-secondary",T.recall,{onclick:()=>confirm(T.msg_recall_confirm.replace('%s',n))&&req("/api/control/recall-passed",{number:n})}), (b=>{confirmBtn(b,T.del,()=>req("/api/passed/remove",{number:n}));return b})(mk("button","btn-secondary",T.del))])]), "empty"));
socket.on("updateFeaturedContents", l => checkPerm('settings') && renderList("featured-list-ui", l, renderFeatured, "empty"));
socket.on("updateOnlineAdmins", l => checkPerm('users') && renderList("online-users-list", (l||[]).sort((a,b)=>a.role==='super'?-1:1), u => {
    const d=u.nickname||u.username, g=`linear-gradient(135deg,hsl(${d.charCodeAt(0)%360},75%,60%),hsl(${(d.charCodeAt(0)+50)%360},75%,50%))`;
    return mk("li","user-card-item online-mode",null,{},[mk("div","user-card-header",null,{},[mk("div","user-avatar-fancy",d[0].toUpperCase(),{style:`background:${g}`}), mk("div","user-info-fancy",null,{},[mk("div","user-nick-fancy",null,{},[mk("span","status-pulse-indicator"),mk("span",null,d)]),mk("div","user-id-fancy",`@${u.username}`),mk("div",`role-badge-fancy ${u.role?.toLowerCase()||'op'}`,u.role)])]), mk("div","user-card-actions",null,{style:"justify-content:flex-end;opacity:.7;font-size:.8em"},[mk("span",null,"🟢 Active")])]);
}));

/* --- Logic & Renderers --- */
function upgradeModeUI() {
    const c=$('#card-sys .control-group:nth-of-type(3)'); if(!c) return; 
    if(c.querySelector('.segmented-control')) return;
    const w=mk('div','segmented-control'), radios=c.querySelectorAll('input[type="radio"]');
    if(!radios.length) return;
    
    // [Fix] 重構 HTML 結構：將 input 放在 label 內，文字放在 span 內並加上 data-i18n
    // 這樣 updateLangUI 更新文字時，才不會把 input 元素覆蓋掉
    radios.forEach(r=>{ 
        const l=mk('label','segmented-option');
        const txtKey = r.value==='ticketing'?'mode_online':'mode_manual';
        const sp = mk('span', null, T[txtKey]||r.value);
        sp.dataset.i18n = txtKey;
        
        l.append(r); // Input first
        l.append(sp); // Then text
        w.append(l); 
        l.onclick=()=>updateSeg(w); 
    });
    
    const t=c.querySelector('label:not(.segmented-option)'); c.innerHTML=''; if(t)c.append(t); c.append(w); updateSeg(w);
}
const updateSeg = w => w.querySelectorAll('input').forEach(r=>r.closest('label').classList.toggle('active',r.checked));

const renderFeatured = i => {
    const v=mk("div","list-info",null,{},[mk("span","list-main-text",i.linkText),mk("span","list-sub-text",i.linkUrl)]);
    const f=mk("div","edit-form-wrapper",{style:"display:none"},{},[mk("input",null,null,{value:i.linkText}),mk("input",null,null,{value:i.linkUrl}),mk("div","edit-form-actions",null,{},[mk("button","btn-secondary",T.cancel,{onclick:()=>{f.style.display="none";v.style.display="flex";a.style.display="flex"}}),mk("button","btn-secondary success",T.save,{onclick:async()=>{if(await req("/api/featured/edit",{oldLinkText:i.linkText,oldLinkUrl:i.linkUrl,newLinkText:f.children[0].value,newLinkUrl:f.children[1].value}))toast(T.saved,"success")}}) ])]);
    const a=mk("div","list-actions",null,{},[mk("button","btn-secondary",T.edit,{onclick:()=>{f.style.display="flex";v.style.display="none";a.style.display="none"}}),mk("button","btn-secondary",T.del,{onclick:()=>req("/api/featured/remove",i)})]);
    return mk("li","list-item",null,{},[v,a,f]);
};

async function loadAppts() { renderAppts((await req("/api/appointment/list"))?.appointments); }
function renderAppts(l) {
    renderList("appointment-list-ui", l, a => {
        const d=new Date(a.scheduled_time), btn=mk("button","btn-secondary",T.del); confirmBtn(btn,T.del,()=>req("/api/appointment/remove",{id:a.id}));
        return mk("li","list-item",null,{},[mk("div","list-info",null,{},[mk("span","list-main-text",`${a.number} #`,{style:"color:var(--primary)"}),mk("span","list-sub-text",`📅 ${d.toLocaleDateString()} ${d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`)]), mk("div","list-actions",null,{},[btn])]);
    }, "no_appt");
}

async function loadUsers() {
    const d=await req("/api/admin/users"); if(!d?.users) return;
    renderList("user-list-ui", d.users, u => {
        const isMe=u.username===uniqueUser, sup=isSuper(), g=`linear-gradient(135deg,hsl(${u.username.charCodeAt(0)%360},75%,60%),hsl(${(u.username.charCodeAt(0)+50)%360},75%,50%))`;
        const act=mk("div","user-card-actions"), form=mk("div","edit-form-wrapper",{style:"display:none"},{},[mk("input",null,null,{value:u.nickname,placeholder:T.ph_nick,style:"margin-bottom:10px"}), mk("div","edit-form-actions",null,{},[mk("button","btn-secondary",T.cancel,{onclick:e=>{e.stopPropagation();form.style.display="none"}}),mk("button","btn-secondary success",T.save,{onclick:async e=>{e.stopPropagation();if(await req("/api/admin/set-nickname",{targetUsername:u.username,nickname:form.children[0].value})){toast(T.saved,"success");loadUsers()}}})])]);
        if(isMe||sup) { const b=mk("button","btn-action-icon","✎",{title:T.edit}); b.onclick=()=>form.style.display="flex"; act.append(b); }
        if(u.username!=='superadmin'&&sup) {
            // [Fix] 讓角色下拉選單也能翻譯
            const s=mk("select","role-select",null,{onchange:async()=>await req("/api/admin/set-role",{targetUsername:u.username,newRole:s.value})&&toast(T.saved)&&loadUsers()});
            ['OPERATOR','MANAGER','ADMIN'].forEach(r=>s.add(new Option(T['role_'+r.toLowerCase()]||r, r, false, u.role===r)));
            
            const b=mk("button","btn-action-icon danger","✕"); confirmBtn(b,"✕",async()=>await req("/api/admin/del-user",{delUsername:u.username})&&loadUsers());
            const w=mk("div",null,null,{style:"display:flex;gap:8px;align-items:center"},[s,b]); act.append(w);
        }
        return mk("li","user-card-item",null,{},[mk("div","user-card-header",null,{},[mk("div","user-avatar-fancy",(u.nickname||u.username)[0].toUpperCase(),{style:`background:${g}`}),mk("div","user-info-fancy",null,{},[mk("div","user-nick-fancy",u.nickname||u.username),mk("div","user-id-fancy",`@${u.username}`),mk("div",`role-badge-fancy ${u.role?.toLowerCase()}`,u.role)])]), act, form]);
    }, "loading");
    if($("add-user-container-fixed")) $("add-user-container-fixed").remove();
    if($("card-user-management")?.querySelector('.admin-card')) {
        const [u,p,n,r] = [mk("input",null,null,{placeholder:T.ph_account}),mk("input",null,null,{type:"password",placeholder:"Pwd"}),mk("input",null,null,{placeholder:T.ph_nick}),mk("select")];
        ['OPERATOR','MANAGER','ADMIN'].forEach(o=>r.add(new Option(T['role_'+o.toLowerCase()]||o,o)));
        const btn=mk("button","btn-hero btn-add-user-fancy",`+ ${T.lbl_add_user||'Add User'}`,{onclick:async()=>u.value&&p.value?(await req("/api/admin/add-user",{newUsername:u.value,newPassword:p.value,newNickname:n.value,newRole:r.value})&&(toast(T.saved,"success")||loadUsers()||(u.value=p.value=n.value=""))):toast("Missing info","error")});
        $("card-user-management").querySelector('.admin-card').append(mk("div","add-user-container",null,{id:"add-user-container-fixed"},[mk("div","add-user-grid",null,{},[u,p,n,r,btn])]));
    }
}

async function loadRoles() {
    const c=globalRoleConfig||await req("/api/admin/roles/get"), ctr=$("role-editor-content"); if(!c||!ctr)return; ctr.innerHTML="";
    const roles=['OPERATOR','MANAGER'], perms=[{k:'call',t:T.perm_call},{k:'issue',t:T.perm_issue},{k:'stats',t:T.perm_stats},{k:'settings',t:T.perm_settings},{k:'appointment',t:T.perm_appointment},{k:'line',t:T.perm_line},{k:'users',t:T.perm_users}];
    const ths=roles.map(r=>mk("th",`th-role role-${r==='OPERATOR'?'op':'mgr'}`,null,{innerHTML:`<div class="th-content"><span class="th-icon">${r==='OPERATOR'?'🎮':'🛡️'}</span><span>${T['role_'+r.toLowerCase()]}</span></div>`}));
    const trs=perms.map(p=>mk("tr",null,null,{},[mk("td","td-perm-name",p.t),...roles.map(r=>mk("td","td-check",null,{},[mk("label","custom-check",null,{},[mk("input","role-chk",null,{type:"checkbox",dataset:{role:r,perm:p.k},checked:(c[r]?.can||[]).includes(p.k)}),mk("span","checkmark")])]))]));
    ctr.append(mk("div","perm-table-wrapper",null,{},[mk("table","perm-matrix",null,{},[mk("thead",null,null,{},[mk("tr",null,null,{},[mk("th",null,"Perm / Role"),...ths])]),mk("tbody",null,null,{},trs)])]));
}

async function loadStats() {
    try {
        const d=await req("/api/admin/stats"); if(!d?.hourlyCounts) return;
        if($("stats-today-count")) $("stats-today-count").textContent=d.todayCount||0;
        const chart=$("hourly-chart");
        if(chart) {
            const max=Math.max(...d.hourlyCounts,1); chart.innerHTML="";
            d.hourlyCounts.forEach((v,i)=>chart.append(mk("div",`chart-col ${i===d.serverHour?'current':''}`,null,{onclick:()=>openStatModal(i,v)},[mk("div","chart-val",v||""),mk("div","chart-bar",null,{style:`height:${Math.max(v/max*100,2)}%;background:${v?null:'var(--border-color)'}`}),mk("div","chart-label",String(i).padStart(2,'0'))])));
        }
        renderList("stats-list-ui",d.history||[],h=>mk("li","list-item",null,{innerHTML:`${new Date(h.timestamp).toLocaleTimeString()} - <b style="color:var(--primary)">${h.number}</b> <small>(${h.operator})</small>`}),"no_logs");
    } catch(e){}
}

function renderLine() {
    renderList("line-settings-list-ui", Object.keys(cachedLine||{}), k=>{
        const v=cachedLine[k]||"", row=mk("div","line-setting-row",{style:"display:flex;width:100%;justify-content:space-between"},{},[mk("div","line-setting-info",null,{},[mk("div","line-setting-label",k.split(':').pop()),mk("code","line-setting-preview",v||"(未設定)",{style:v?"color:var(--text-sub)":"opacity:.5"})]),mk("button","btn-secondary",T.edit,{onclick:()=>{row.style.display="none";edt.style.display="block"}})]), edt=mk("div","line-edit-box",{style:"display:none"},{},[mk("textarea",null,null,{value:v}),mk("div",null,null,{style:"display:flex;gap:8px;justify-content:flex-end;margin-top:4px"},[mk("button","btn-secondary",T.cancel,{onclick:()=>{edt.style.display="none";row.style.display="flex"}}),mk("button","btn-secondary success",T.save,{onclick:async()=>{if(await req("/api/admin/line-settings/save",{[k]:edt.children[0].value})){cachedLine[k]=edt.children[0].value;toast(T.saved,"success");renderLine()}}})])]);
        return mk("li","list-item",null,{},[row,edt]);
    }, "empty");
    req("/api/admin/line-settings/get-unlock-pass").then(r=>{if($("line-unlock-pwd")&&r)$("line-unlock-pwd").value=r.password||""});
}

function renderLogs(logs, init) {
    const ul=$("admin-log-ui"); if(!ul)return; if(init)ul.innerHTML="";
    if(!logs?.length && init) return ul.innerHTML=`<li class='list-item'>${T.no_logs}</li>`;
    logs.forEach(m => { const li=mk("li","list-item",m,{style:"font-family:monospace;font-size:0.8rem"}); init?ul.append(li):ul.prepend(li); });
    while(ul.children.length>50) ul.lastChild.remove();
}

/* --- Event Bindings --- */
const bindings = {
    "btn-call-prev": ["/api/control/call",{direction:"prev"}], "btn-call-next": ["/api/control/call",{direction:"next"}],
    "btn-mark-passed": ["/api/control/pass-current"], "btn-issue-prev": ["/api/control/issue",{direction:"prev"}], "btn-issue-next": ["/api/control/issue",{direction:"next"}],
    "btn-refresh-stats": loadStats,
    "btn-broadcast": async()=>{ const m=$("broadcast-msg").value; if(m&&await req("/api/admin/broadcast",{message:m})) { toast(T.msg_sent,"success"); $("broadcast-msg").value=""; } },
    "btn-add-appt": async()=>{ const n=$("appt-number").value, t=$("appt-time").value; if(n&&t&&await req("/api/appointment/add",{number:+n,timeStr:t})) { toast(T.saved,"success"); $("appt-number").value=""; $("appt-time")._flatpickr?.clear(); } },
    "btn-save-roles": async()=>{ const c={OPERATOR:{level:1,can:[]},MANAGER:{level:2,can:[]},ADMIN:{level:9,can:['*']}}; $$(".role-chk:checked").forEach(k=>c[k.dataset.role].can.push(k.dataset.perm)); if(await req("/api/admin/roles/update",{rolesConfig:c})) { toast(T.saved,"success"); Object.assign(globalRoleConfig,c); $$('[data-perm]').forEach(e=>e.style.display=checkPerm(e.dataset.perm)?'':'none'); } },
    "btn-save-unlock-pwd": async()=>{ if(await req("/api/admin/line-settings/save-pass",{password:$("line-unlock-pwd").value})) toast(T.saved,"success"); },
    "btn-export-csv": async()=>{ const d=await req("/api/admin/export-csv",{date:new Date().toLocaleDateString("zh-TW")}); if(d?.csvData) { const a=mk("a",null,null,{href:URL.createObjectURL(new Blob(["\uFEFF"+d.csvData],{type:'text/csv'})),download:d.fileName}); a.click(); } },
    "login-button": async()=>{ const r=await req("/login",{username:$("username-input").value,password:$("password-input").value}); if(r){localStorage.setItem('callsys_user',r.username);localStorage.setItem('callsys_role',r.userRole);localStorage.setItem('callsys_nick',r.nickname);checkSession();}else $("login-error").textContent=T.login_fail; },
    "btn-logout": logout, "btn-logout-mobile": logout,
    "admin-theme-toggle": ()=>{ isDark=!isDark; applyTheme(); }, "admin-theme-toggle-mobile": ()=>{ isDark=!isDark; applyTheme(); }
};
const applyTheme=()=>{ document.body.classList.toggle('dark-mode',isDark); localStorage.setItem('callsys_admin_theme',isDark?'dark':'light'); ["admin-theme-toggle","admin-theme-toggle-mobile"].forEach(i=>$(i)&&($(i).textContent=isDark?'☀️':'🌙')); };

document.addEventListener("DOMContentLoaded", () => {
    applyTheme();
    
    const m = $("edit-stats-overlay");
    if(m) {
        m.style.display = "none";
        bindClick("btn-modal-close",()=>m.style.display="none");
        window.openStatModal=(h,v)=>{$("modal-current-count").textContent=v;eHr=h;m.style.display="flex"};
        ["btn-stats-minus","btn-stats-plus"].forEach((id,i)=>bindClick(id,async()=>{if(eHr!=null){await req("/api/admin/stats/adjust",{hour:eHr,delta:i?1:-1});$("modal-current-count").textContent=Math.max(0,+($("modal-current-count").textContent)+(i?1:-1));loadStats()}}));
    }

    $$('.nav-btn').forEach(b=>b.onclick=()=>{
        $$('.nav-btn').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        $$('.section-group').forEach(s=>s.classList.remove('active'));
        const t=$(b.dataset.target);
        if(t){
            t.classList.add('active');
            if(b.dataset.target==='section-stats') loadStats();
            if(b.dataset.target==='section-settings'){
                loadAppts();
                loadUsers();
                if(checkPerm('line')) cachedLine ? renderLine() : loadLineSettings();
            }
        }
    });

    Object.entries(bindings).forEach(([id, act]) => $(id)?.addEventListener("click", typeof act==="function" ? act : async()=>{
        const n=$("number"), v=n?parseInt(n.textContent):0; if(n&&act[0].includes('call')&&act[1]?.direction) {n.textContent=v+(act[1].direction==='next'?1:-1); n.style.opacity=".6";}
        try{ await req(act[0], act[1]); } catch(e){if(n)n.textContent=v} finally{if(n)n.style.opacity="1"}
    }));
    const adj=d=>async()=>{const n=$("number"),c=+n.textContent,t=c+d; if(t>0){n.textContent=t; n.style.opacity=".6"; if(await req("/api/control/set-call",{number:t}))toast(`${T.saved}: ${t}`,"success"); else n.textContent=c; n.style.opacity="1";}};
    bindClick("btn-call-add-1",adj(1)); bindClick("btn-call-add-5",adj(5));
    bindClick("setNumber",()=>reqVal("manualNumber","/api/control/set-call","number"));
    bindClick("setIssuedNumber",()=>reqVal("manualIssuedNumber","/api/control/set-issue","number"));
    bindClick("add-passed-btn",()=>reqVal("new-passed-number","/api/passed/add","number"));
    bindClick("add-featured-btn",async()=>{const t=$("new-link-text"),u=$("new-link-url"); if(t.value&&u.value&&await req("/api/featured/add",{linkText:t.value,linkUrl:u.value})){t.value="";u.value=""}});
    
    const resets={resetNumber:'set-call',resetIssued:'set-issue',resetPassed:'/api/passed/clear',resetFeaturedContents:'/api/featured/clear',resetAll:'/reset',btn_clear_logs:'/api/logs/clear',btn_clear_stats:'/api/admin/stats/clear',btn_reset_line_msg:'/api/admin/line-settings/reset'};
    Object.entries(resets).forEach(([id, api]) => {
        const el=$(id), u=api.startsWith('/')?api:`/api/control/${api}`;
        confirmBtn(el,el?.textContent.trim(),async()=>{ await req(u,id.startsWith('reset')&&!u.includes('clear')&&!u.includes('reset')?{number:0}:{}); if(id==='btn-clear-stats'){$("stats-today-count").textContent="0";$("hourly-chart").innerHTML="";toast(T.saved,"success");} if(id==='btn-clear-logs'){$("admin-log-ui").innerHTML="";toast(T.saved,"success")} });
    });

    bindClick("btn-calibrate-stats",async()=>confirm(`${T.confirm} ${T.btn_calibrate}?`)&&toast(`${T.msg_calibrated} (Diff: ${(await req("/api/admin/stats/calibrate"))?.diff})`,"success")&&loadStats());

    ["admin-lang-selector","admin-lang-selector-mobile"].forEach(i=>{const e=$(i);if(e){e.value=curLang;e.onchange=()=>{curLang=e.value;localStorage.setItem('callsys_lang',curLang);updateLangUI()}}});
    if($("appt-time")) flatpickr("#appt-time",{enableTime:true,dateFormat:"Y-m-d H:i",time_24hr:true,locale:"zh_tw",minDate:"today",disableMobile:"true"});
    $("sound-toggle")?.addEventListener("change",e=>req("/set-sound-enabled",{enabled:e.target.checked}));
    $("public-toggle")?.addEventListener("change",e=>req("/set-public-status",{isPublic:e.target.checked}));
    $$('input[name="systemMode"]').forEach(r=>r.onchange=()=>confirm(T.confirm+" Switch?")?req("/set-system-mode",{mode:r.value}):(r.checked=!r.checked));
    document.addEventListener("keydown",e=>{ if(document.activeElement.tagName==="INPUT" || document.activeElement.tagName==="TEXTAREA"){if(e.key==="Enter"&&!e.shiftKey)({username:"login-button",manualNumber:"setNumber",manualIssuedNumber:"setIssuedNumber"}[document.activeElement.id.split('-')[0]]?$(document.activeElement.id.split('-')[0]+"btn")?.click():null);return} if(e.key==="ArrowRight")$("btn-call-next")?.click();if(e.key==="ArrowLeft")$("btn-call-prev")?.click();if(e.key.toLowerCase()==="p")$("btn-mark-passed")?.click(); });

    checkSession();
});

function bindClick(i,f){$(i)?.addEventListener("click",f)}
async function reqVal(id,u,k){const el=$(id),v=el.value;if(v&&await req(u,{[k]:v})){el.value="";toast(T.saved,"success")}}
