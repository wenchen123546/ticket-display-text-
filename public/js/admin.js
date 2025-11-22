// admin.js v8.0
const loginContainer = document.getElementById("login-container");
const adminPanel = document.getElementById("admin-panel");
const usernameInput = document.getElementById("username-input"); 
const passwordInput = document.getElementById("password-input");
const loginButton = document.getElementById("login-button");
const loginError = document.getElementById("login-error");
const numberEl = document.getElementById("number");
const statusBar = document.getElementById("status-bar");

// Kiosk & Status
const kioskStatusDisplay = document.getElementById("kiosk-status-display");
const issuedNumberEl = document.getElementById("issued-number");
const waitingCountEl = document.getElementById("waiting-count");
const kioskToggleGroup = document.getElementById("kiosk-toggle-group");
const kioskToggle = document.getElementById("kiosk-toggle");

// Chart
const ctx = document.getElementById('statsChart');
let statsChartInstance = null;

// ... (Other standard DOM elements like logs, passed list, etc. - assuming exist) ...
const passedListUI = document.getElementById("passed-list-ui");
const newPassedNumberInput = document.getElementById("new-passed-number");
const addPassedBtn = document.getElementById("add-passed-btn");
const featuredListUI = document.getElementById("featured-list-ui");
const newLinkTextInput = document.getElementById("new-link-text");
const newLinkUrlInput = document.getElementById("new-link-url");
const addFeaturedBtn = document.getElementById("add-featured-btn");
const soundToggle = document.getElementById("sound-toggle");
const publicToggle = document.getElementById("public-toggle"); 
const adminLogUI = document.getElementById("admin-log-ui");
const clearLogBtn = document.getElementById("clear-log-btn");
const resetAllBtn = document.getElementById("resetAll");
const onlineUsersList = document.getElementById("online-users-list"); 
const statsTodayCount = document.getElementById("stats-today-count");
const btnRefreshStats = document.getElementById("btn-refresh-stats");
const btnClearStats = document.getElementById("btn-clear-stats"); 
const btnExportCsv = document.getElementById("btn-export-csv");
const broadcastInput = document.getElementById("broadcast-msg");
const broadcastBtn = document.getElementById("btn-broadcast");
// User management DOM
const userManagementCard = document.getElementById("card-user-management");
const userListUI = document.getElementById("user-list-ui");
const newUserUsernameInput = document.getElementById("new-user-username");
const newUserNicknameInput = document.getElementById("new-user-nickname");
const newUserPasswordInput = document.getElementById("new-user-password");
const addUserBtn = document.getElementById("add-user-btn");

let token = "", userRole = "normal", username = "", uniqueUsername = "";
let currentNum = 0, issuedNum = 0;

const socket = io({ autoConnect: false, auth: { token: "" } });

// Login Logic
function showLogin() {
    loginContainer.style.display = "block";
    adminPanel.style.display = "none";
    socket.disconnect();
}
async function showPanel() {
    if (userRole === 'super') {
        if(userManagementCard) { userManagementCard.style.display = "block"; await loadAdminUsers(); }
        if(clearLogBtn) clearLogBtn.style.display = "block";
        if(btnExportCsv) btnExportCsv.style.display = "block";
        if(kioskToggleGroup) kioskToggleGroup.style.display = "flex"; // Show Kiosk toggle for super
    }
    loginContainer.style.display = "none";
    adminPanel.style.display = "block";
    document.title = `後台 - ${username}`;
    await loadStats(); 
    socket.connect();
}
async function attemptLogin(u, p) {
    try {
        const res = await fetch("/login", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({username:u, password:p}) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        token = data.token; userRole = data.role; username = data.nickname; uniqueUsername = data.username;
        socket.auth.token = token;
        await showPanel();
    } catch (err) { loginError.textContent = err.message || "登入失敗"; }
}
loginButton.onclick = () => attemptLogin(usernameInput.value, passwordInput.value);

// API Helper
async function apiRequest(endpoint, body, returnJson=false) {
    try {
        const res = await fetch(endpoint, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({...body, token}) });
        const data = await res.json();
        if(!res.ok) { alert(data.error || "Error"); return false; }
        return returnJson ? data : true;
    } catch(e) { console.error(e); return false; }
}

// Socket Events
socket.on("connect", () => { statusBar.classList.remove("visible"); });
socket.on("disconnect", () => { statusBar.classList.add("visible"); });
socket.on("update", (n) => { 
    currentNum = n; numberEl.textContent = n; 
    updateKioskStatus();
});
socket.on("updateIssued", (n) => {
    issuedNum = n;
    updateKioskStatus();
});
socket.on("updateKioskMode", (enabled) => {
    kioskToggle.checked = enabled;
    kioskStatusDisplay.style.display = enabled ? "block" : "none";
});
socket.on("updateOnlineAdmins", (admins) => {
    onlineUsersList.innerHTML = admins.map(a => `<li>${a.role==='super'?'👑':'👤'} ${a.nickname}</li>`).join('');
});
socket.on("newAdminLog", (msg) => {
    const li = document.createElement("li"); li.textContent = msg;
    adminLogUI.insertBefore(li, adminLogUI.firstChild);
});
socket.on("initAdminLogs", (logs) => {
    adminLogUI.innerHTML = logs.map(l => `<li>${l}</li>`).join('');
});
// ... passed, featured, sound, public updates ... 
socket.on("updatePassed", (arr) => {
    passedListUI.innerHTML = arr.map(n => `<li><span>${n}</span> <button class="delete-item-btn" onclick="removePassed(${n})">×</button></li>`).join('');
});
socket.on("updateFeaturedContents", (arr) => {
    featuredListUI.innerHTML = arr.map(c => `<li><span>${c.linkText}</span> <button class="delete-item-btn" onclick="removeFeatured('${c.linkText}','${c.linkUrl}')">×</button></li>`).join('');
});
socket.on("updateSoundSetting", (v) => soundToggle.checked = v);
socket.on("updatePublicStatus", (v) => publicToggle.checked = v);

function updateKioskStatus() {
    issuedNumberEl.textContent = issuedNum;
    const waiting = Math.max(0, issuedNum - currentNum);
    waitingCountEl.textContent = waiting;
}

// Controls
document.getElementById("next").onclick = async () => {
    const res = await apiRequest("/change-number", { direction: "next" }, true);
    if(!res.success && res.error) alert(res.error); // Show error if limit reached
};
document.getElementById("prev").onclick = () => apiRequest("/change-number", { direction: "prev" });
document.getElementById("setNumber").onclick = () => apiRequest("/set-number", { number: document.getElementById("manualNumber").value });
document.getElementById("resetNumber").onclick = () => confirm("重置號碼？") && apiRequest("/set-number", { number: 0 });

// Toggle Listeners
kioskToggle.addEventListener("change", () => {
    if(confirm(`確定要${kioskToggle.checked?'開啟':'關閉'}自助取號模式？`)) {
        apiRequest("/set-kiosk-mode", { enabled: kioskToggle.checked });
    } else {
        kioskToggle.checked = !kioskToggle.checked;
    }
});
soundToggle.addEventListener("change", () => apiRequest("/set-sound-enabled", { enabled: soundToggle.checked }));
publicToggle.addEventListener("change", () => apiRequest("/set-public-status", { isPublic: publicToggle.checked }));

// Chart.js Implementation
async function loadStats() {
    const data = await apiRequest("/api/admin/stats", {}, true);
    if (data && data.success) {
        statsTodayCount.textContent = data.todayCount;
        renderChart(data.hourlyCounts);
    }
}

function renderChart(dataArray) {
    if (statsChartInstance) statsChartInstance.destroy();
    const labels = Array.from({length: 24}, (_, i) => i.toString().padStart(2, '0'));
    statsChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '每小時叫號數',
                data: dataArray,
                backgroundColor: '#2563eb',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
    });
}

btnRefreshStats.onclick = loadStats;
// ... Other buttons (CSV, Clear Stats, Reset All, etc.) logic ... 
// Simply bind click to apiRequest like above.
