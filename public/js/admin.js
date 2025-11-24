/*
 * ==========================================
 * 後台邏輯 (admin.js) - v18.7 Final Fix
 * ==========================================
 */

// --- 0. i18n ---
const adminI18n = {
    "zh-TW": {
        "status_disconnected": "連線中斷...", "status_connected": "✅ 已連線",
        "admin_label_current": "目前叫號", "admin_label_issued": "已發號至", "admin_label_waiting": "等待組數",
        "card_title_calling": "叫號控制", "card_title_ticketing": "發號機設定", "card_title_broadcast": "廣播與音效",
        "card_title_editor": "過號與公告", "card_title_logs": "操作日誌", "card_title_system": "系統設定",
        "card_title_stats": "數據分析", "card_title_links": "精選連結", "card_title_online": "在線管理員", "card_title_line": "LINE 通知",
        "btn_prev": "上一號", "btn_next": "下一號", "btn_pass": "過號", "btn_issue_prev": "收回", "btn_issue_next": "發號",
        "btn_set": "設定", "btn_reset_call": "↺ 重置", "btn_broadcast": "發送", "placeholder_broadcast": "輸入內容...",
        "hint_manual_set": "設定目前叫號數字", "label_public_toggle": "🌐 對外開放", "label_sound_toggle": "啟用音效",
        "btn_reset_all": "💥 全域重置", "login_verifying": "驗證中...", "login_fail": "登入失敗", "login_error_server": "伺服器錯誤",
        "toast_permission_denied": "❌ 權限不足", "toast_session_expired": "Session 過期", "toast_mode_switched": "✅ 模式切換",
        "confirm_switch_mode": "切換為「%s」模式？", "mode_ticketing": "線上取號", "mode_input": "手動輸入",
        "toast_num_set": "✅ 號碼已設定", "toast_issued_updated": "✅ 已發號更新", "toast_reset_zero": "✅ 已重置",
        "toast_passed_cleared": "✅ 過號已清空", "toast_featured_cleared": "✅ 連結已清空", "toast_all_reset": "💥 系統重置完成",
        "toast_log_clearing": "🧼 清除日誌...", "alert_positive_int": "請輸入正整數", "alert_link_required": "連結文字和網址必填",
        "alert_url_invalid": "網址格式錯誤", "alert_broadcast_empty": "請輸入內容", "toast_broadcast_sent": "📢 已發送",
        "label_confirm_close": "⚠️ 確認關閉", "toast_stats_cleared": "🗑️ 統計已清空", "toast_report_downloaded": "✅ 下載成功",
        "toast_download_fail": "❌ 下載失敗: ", "toast_line_updated": "✅ LINE設定更新", "toast_line_reset": "↺ 已重置",
        "toast_pwd_saved": "✅ 密碼已儲存", "alert_pwd_empty": "密碼不可空", "btn_confirm_clear": "⚠️ 確認清除",
        "btn_confirm_reset": "⚠️ 確認重置", "list_loading": "載入中...", "list_no_data": "尚無數據", "list_load_fail": "載入失敗",
        "list_no_online": "(無人在線)", "log_no_data": "[尚無日誌]", "btn_clear_log": "清除紀錄", "btn_reset_passed": "清空列表",
        "btn_reset_links": "清空連結", "toast_passed_marked": "⏩ 已過號", "toast_recalled": "↩️ 已重呼"
    },
    "en": { /* English keys omitted for brevity, use previous version if needed */ }
};

let currentAdminLang = localStorage.getItem('callsys_lang') || 'zh-TW';
let at = adminI18n[currentAdminLang] || adminI18n['zh-TW']; // Fallback

function applyAdminI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if(at[key]) el.textContent = at[key];
    });
    const input = document.getElementById("broadcast-msg");
    if(input && at["placeholder_broadcast"]) input.placeholder = at["placeholder_broadcast"];
}

// --- Globals ---
const loginContainer = document.getElementById("login-container");
const adminPanel = document.getElementById("admin-panel");
const usernameInput = document.getElementById("username-input");
const passwordInput = document.getElementById("password-input");
const loginButton = document.getElementById("login-button");
const loginError = document.getElementById("login-error");
const sidebarUserInfo = document.getElementById("sidebar-user-info");

let token = "";
let userRole = "normal";
let username = "";
let uniqueUsername = "";
let toastTimer = null;
let publicToggleConfirmTimer = null;
let editingHour = null;

// --- Socket ---
const socket = io({ autoConnect: false, auth: { token: "" } });

// --- UI Functions ---
function initTabs() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const sections = document.querySelectorAll('.section-group');
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            sections.forEach(sec => {
                if(sec.id === targetId) {
                    sec.classList.add('active');
                    if(targetId === 'section-stats') loadStats();
                } else {
                    sec.classList.remove('active');
                }
            });
        });
    });
}

function showToast(message, type = 'info') {
    const toast = document.getElementById("toast-notification");
    if (!toast) return;
    toast.textContent = message;
    toast.className = type;
    toast.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.classList.remove("show"); }, 3000);
}

function showLogin() {
    loginContainer.style.display = "block";
    adminPanel.style.display = "none";
    socket.disconnect();
}

async function showPanel() {
    loginContainer.style.display = "none";
    adminPanel.style.display = "flex"; 
    if(sidebarUserInfo) sidebarUserInfo.textContent = `Hi, ${username}`;

    if (userRole === 'super') {
        document.getElementById("card-user-management").style.display = "block";
        document.getElementById("clear-log-btn").style.display = "block";
        document.getElementById("btn-export-csv").style.display = "block";
        document.getElementById("mode-switcher-group").style.display = "block";
        document.getElementById("unlock-pwd-group").style.display = "block";
        await loadAdminUsers();
    } else {
        document.getElementById("unlock-pwd-group").style.display = "none";
    }
    
    initTabs(); 
    await loadStats();
    await loadLineSettings();
    
    // Force socket reconnect to get fresh data
    socket.auth.token = token;
    socket.connect();
}

async function attemptLogin() {
    const u = usernameInput.value; const p = passwordInput.value;
    loginError.textContent = at["login_verifying"];
    try {
        const res = await fetch("/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: u, password: p }),
        });
        const data = await res.json();
        if (!res.ok) {
            loginError.textContent = data.error || at["login_fail"];
            showLogin();
        } else {
            token = data.token; userRole = data.role; username = data.nickname; uniqueUsername = data.username;
            await showPanel();
        }
    } catch (err) { loginError.textContent = at["login_error_server"]; }
}

// --- Initialization ---
document.addEventListener("DOMContentLoaded", () => { 
    applyAdminI18n();
    showLogin();
});
loginButton.onclick = attemptLogin;

// --- Socket Handlers ---
socket.on("connect", () => {
    document.getElementById("status-bar").classList.remove("visible");
    showToast(`${at["status_connected"]} (${username})`, "success");
});
socket.on("disconnect", () => {
    document.getElementById("status-bar").classList.add("visible");
    showToast(at["status_disconnected"], "error");
});
socket.on("updateQueue", (data) => {
    document.getElementById("number").textContent = data.current;
    document.getElementById("issued-number").textContent = data.issued;
    document.getElementById("waiting-count").textContent = Math.max(0, data.issued - data.current);
    loadStats();
});
socket.on("update", (num) => { document.getElementById("number").textContent = num; loadStats(); });
socket.on("updatePassed", (numbers) => renderPassedListUI(numbers));
socket.on("updateFeaturedContents", (contents) => renderFeaturedListUI(contents)); // Fixed
socket.on("initAdminLogs", (logs) => renderLogs(logs, true));
socket.on("newAdminLog", (log) => renderLogs([log], false));
socket.on("updateOnlineAdmins", (admins) => renderOnlineAdmins(admins));

// --- Rendering ---
function renderFeaturedListUI(contents) {
    const ui = document.getElementById("featured-list-ui");
    if (!ui) return;
    ui.innerHTML = "";
    if (!Array.isArray(contents) || contents.length === 0) return;
    const fragment = document.createDocumentFragment();
    contents.forEach((item) => {
        const li = document.createElement("li");
        const span = document.createElement("span");
        span.innerHTML = `${item.linkText}<br><small style="color:#666">${item.linkUrl}</small>`;
        li.appendChild(span);
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "delete-item-btn"; deleteBtn.innerHTML = "✕";
        deleteBtn.onclick = async () => { 
            if(confirm("Confirm delete?")) await apiRequest("/api/featured/remove", { linkText: item.linkText, linkUrl: item.linkUrl }); 
        };
        li.appendChild(deleteBtn);
        fragment.appendChild(li);
    });
    ui.appendChild(fragment);
}

function renderPassedListUI(numbers) {
    const ui = document.getElementById("passed-list-ui");
    ui.innerHTML = "";
    if (!Array.isArray(numbers)) return;
    const fragment = document.createDocumentFragment();
    numbers.forEach((number) => {
        const li = document.createElement("li");
        li.style.display = "flex"; li.style.justifyContent = "space-between"; li.style.alignItems = "center";
        const leftDiv = document.createElement("div"); leftDiv.style.display = "flex"; leftDiv.style.gap = "10px"; leftDiv.style.alignItems = "center";
        const numSpan = document.createElement("span"); numSpan.textContent = number; numSpan.style.fontWeight = "bold";
        const recallBtn = document.createElement("button");
        recallBtn.className = "btn-secondary"; recallBtn.style.padding = "2px 8px"; recallBtn.style.fontSize = "0.8rem";
        recallBtn.textContent = "↩️ 重呼";
        recallBtn.onclick = async () => { 
            if(confirm(`確定要插隊重呼 ${number} 號嗎？`)) { 
                await apiRequest("/api/control/recall-passed", { number }); showToast(at["toast_recalled"], "success"); 
            } 
        };
        leftDiv.appendChild(numSpan); leftDiv.appendChild(recallBtn); li.appendChild(leftDiv);
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "delete-item-btn"; deleteBtn.innerHTML = "✕";
        deleteBtn.onclick = async () => { if(confirm("Confirm delete?")) await apiRequest("/api/passed/remove", { number }); };
        li.appendChild(deleteBtn);
        fragment.appendChild(li);
    });
    ui.appendChild(fragment);
}

function renderLogs(logs, isInit) {
    const ui = document.getElementById("admin-log-ui");
    if(isInit) ui.innerHTML = "";
    if(!logs || logs.length === 0) return;
    if(ui.querySelector("li")?.textContent.includes("尚無")) ui.innerHTML = "";
    const fragment = document.createDocumentFragment();
    logs.forEach(log => { const li = document.createElement("li"); li.textContent = log; isInit ? fragment.appendChild(li) : ui.appendChild(li); });
    if(isInit) ui.appendChild(fragment);
    ui.scrollTop = ui.scrollHeight;
}

function renderOnlineAdmins(admins) {
    const ui = document.getElementById("online-users-list");
    if(!ui) return;
    ui.innerHTML = "";
    if (!admins || admins.length === 0) { ui.innerHTML = `<li>${at["list_no_online"]}</li>`; return; }
    const fragment = document.createDocumentFragment();
    admins.forEach(admin => {
        const li = document.createElement("li");
        const icon = admin.role === 'super' ? '👑' : '👤';
        li.innerHTML = `<span>${icon} ${admin.nickname}</span>`;
        fragment.appendChild(li);
    });
    ui.appendChild(fragment);
}

// --- Stats & Chart ---
const statsListUI = document.getElementById("stats-list-ui");
const hourlyChartEl = document.getElementById("hourly-chart");
const statsTodayCount = document.getElementById("stats-today-count");

async function loadStats() {
    if (!statsListUI) return;
    const data = await apiRequest("/api/admin/stats", {}, true);
    if (data && data.success) {
        statsTodayCount.textContent = data.todayCount;
        renderHourlyChart(data.hourlyCounts, data.serverHour);
        statsListUI.innerHTML = "";
        if (!data.history || data.history.length === 0) { statsListUI.innerHTML = `<li>${at["list_no_data"]}</li>`; return; }
        const fragment = document.createDocumentFragment();
        data.history.forEach(item => {
            const li = document.createElement("li");
            li.textContent = `${new Date(item.time).toLocaleTimeString('zh-TW', {hour12:false})} - 號碼 ${item.num} (${item.operator})`;
            fragment.appendChild(li);
        });
        statsListUI.appendChild(fragment);
    }
}

function renderHourlyChart(counts, serverHour) {
    if (!hourlyChartEl || !Array.isArray(counts)) return;
    hourlyChartEl.innerHTML = "";
    const maxVal = Math.max(...counts, 1);
    const currentHour = (typeof serverHour === 'number') ? serverHour : new Date().getHours();
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 24; i++) {
        const val = counts[i]; const percent = (val / maxVal) * 100;
        const col = document.createElement("div"); col.className = "chart-col";
        if (i === currentHour) col.classList.add("current");
        // [Fix] 直接綁定 click 事件
        col.onclick = () => openEditModal(i, val);
        const valDiv = document.createElement("div"); valDiv.className = "chart-val"; valDiv.textContent = val > 0 ? val : "";
        const barDiv = document.createElement("div"); barDiv.className = "chart-bar"; barDiv.style.height = `${Math.max(percent, 2)}%`;
        if (val === 0) barDiv.style.backgroundColor = "#e5e7eb";
        const labelDiv = document.createElement("div"); labelDiv.className = "chart-label"; labelDiv.textContent = i.toString().padStart(2, '0');
        col.appendChild(valDiv); col.appendChild(barDiv); col.appendChild(labelDiv); fragment.appendChild(col);
    }
    hourlyChartEl.appendChild(fragment);
}

// Modal Logic
const modalOverlay = document.getElementById("edit-stats-overlay");
const modalTitle = document.getElementById("modal-title");
const modalCurrentCount = document.getElementById("modal-current-count");
function openEditModal(hour, count) { 
    editingHour = hour; 
    modalTitle.textContent = `編輯 ${hour}:00 - ${hour}:59 數據`; 
    modalCurrentCount.textContent = count; 
    modalOverlay.style.display = "flex"; 
}
function closeEditModal() { modalOverlay.style.display = "none"; editingHour = null; }
async function adjustStat(delta) { 
    if (editingHour === null) return; 
    let current = parseInt(modalCurrentCount.textContent); 
    let next = current + delta; if (next < 0) next = 0; 
    modalCurrentCount.textContent = next; 
    await apiRequest("/api/admin/stats/adjust", { hour: editingHour, delta: delta }); 
    await loadStats(); 
}
document.getElementById("btn-modal-close").onclick = closeEditModal;
document.getElementById("btn-stats-minus").onclick = () => adjustStat(-1);
document.getElementById("btn-stats-plus").onclick = () => adjustStat(1);
if(modalOverlay) modalOverlay.onclick = (e) => { if (e.target === modalOverlay) closeEditModal(); }

// --- API Wrapper ---
async function apiRequest(endpoint, body, a_returnResponse = false) {
    try {
        const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, token }) });
        const responseData = await res.json();
        if (!res.ok) { 
            if(res.status === 403) { showToast(at["toast_permission_denied"], "error"); } else { showToast(responseData.error, "error"); }
            return false; 
        }
        return a_returnResponse ? responseData : true;
    } catch (err) { showToast(err.message, "error"); return false; }
}

// --- Event Bindings ---
document.getElementById("btn-call-prev").onclick = () => apiRequest("/change-number", { direction: "prev" });
document.getElementById("btn-call-next").onclick = () => apiRequest("/change-number", { direction: "next" });
document.getElementById("btn-mark-passed").onclick = async function() {
    this.disabled = true;
    if(await apiRequest("/api/control/pass-current", {})) showToast(at["toast_passed_marked"], "warning");
    this.disabled = false;
};
document.getElementById("add-featured-btn").onclick = async () => {
    const t = document.getElementById("new-link-text").value.trim();
    const u = document.getElementById("new-link-url").value.trim();
    if(!t || !u) return alert("Fields required");
    if(await apiRequest("/api/featured/add", { linkText: t, linkUrl: u })) {
        document.getElementById("new-link-text").value = ""; document.getElementById("new-link-url").value = "";
    }
};
