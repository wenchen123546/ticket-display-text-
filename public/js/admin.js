// --- 1. 元素節點 (DOM) ---
const loginContainer = document.getElementById("login-container");
const adminPanel = document.getElementById("admin-panel");
const usernameInput = document.getElementById("username-input"); 
const passwordInput = document.getElementById("password-input");
const loginButton = document.getElementById("login-button");
const loginError = document.getElementById("login-error");
const numberEl = document.getElementById("number");
const statusBar = document.getElementById("status-bar");
// (主要控制台卡片元素)
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
const resetAllConfirmBtn = document.getElementById("resetAllConfirm");
const logoutBtn = document.getElementById("logout-btn"); // 登出按鈕

const superAdminCard = document.getElementById("card-superadmin");


// --- 2. 全域變數 ---
// 【錯誤修正】 移除全域 token 變數，因為它會造成狀態不同步
// let token = sessionStorage.getItem('admin_jwt') || ""; // <-- 移除
let userRole = sessionStorage.getItem('admin_role') || ""; 
let resetAllTimer = null;
let toastTimer = null; 
let timedConfirmTimers = {}; // <-- 【UX 修正】 儲存多個計時器

// --- 3. Socket.io ---
// 【錯誤修正】
// 1. 移除 autoConnect: false
// 2. 修改 auth 函式，使其 *每次重連時* 都從 sessionStorage 讀取最新的 Token
//    而不是依賴那個會被清除的全域變數。
const socket = io({ 
    auth: () => {
        return { token: sessionStorage.getItem('admin_jwt') }; 
    }
});

// --- 4. Toast 通知函式 ---
function showToast(message, type = 'info') {
    const toast = document.getElementById("toast-notification");
    if (!toast) return;
    
    toast.textContent = message;
    toast.className = type; 
    
    toast.classList.add("show");
    
    if (toastTimer) clearTimeout(toastTimer);
    
    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}

// --- 5. 登入/顯示邏輯 ---
function showLogin() {
    loginContainer.style.display = "block";
    adminPanel.style.display = "none";
    document.title = "後台管理 - 登入";
    // token = ""; // <-- 移除 (全域變數已刪除)
    userRole = ""; 
    sessionStorage.removeItem('admin_jwt'); 
    sessionStorage.removeItem('admin_role');
    sessionStorage.removeItem('admin_username'); // <-- 【安全修正】 登出時清除
    socket.disconnect(); // 主動斷開連線
}

async function showPanel() {
    loginContainer.style.display = "none";
    adminPanel.style.display = "block";
    document.title = "後台管理 - 控制台";

    // 【錯誤修正】
    // userRole 必須從 sessionStorage 重新讀取，才是最準確的
    userRole = sessionStorage.getItem('admin_role');

    if (userRole === 'superadmin') {
        superAdminCard.style.display = "block";
        initSuperAdminBindings(); 
        loadAdmins(); 
    } else {
        superAdminCard.style.display = "none";
    }
    
    // 【錯誤修正】
    // 登入成功或頁面載入時，呼叫 socket.connect() 來觸發連線
    // (如果已連線，它會自動忽略；如果已斷線，它會觸發使用新 Token 的重連)
    if (!socket.connected) {
        socket.connect();
    }
}

async function attemptLogin() {
    const username = usernameInput.value;
    const password = passwordInput.value;
    if (!username || !password) {
        loginError.textContent = "請輸入使用者名稱和密碼。";
        return;
    }

    loginError.textContent = "驗證中...";
    try {
        const res = await fetch("/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: username, password: password }),
        });

        const data = await res.json();

        if (res.ok && data.token) {
            // 【錯誤修正】
            // 登入成功時，*只* 更新 sessionStorage
            // token = data.token; // <-- 移除 (全域變數已刪除)
            // userRole = data.role; // <-- 移除 (全域變數已刪除)
            
            sessionStorage.setItem('admin_jwt', data.token); 
            sessionStorage.setItem('admin_role', data.role);
            sessionStorage.setItem('admin_username', data.username);
            
            await showPanel(); // showPanel 會處理 socket.connect()
        } else {
            loginError.textContent = data.error || "登入失敗";
            // showLogin(); // <-- 移除，讓使用者可以重試
        }
    } catch (err) {
        console.error("Login 失敗:", err);
        loginError.textContent = "網路錯誤或伺服器無回應。";
    }
}

document.addEventListener("DOMContentLoaded", () => { 
    // 【錯誤修正】
    // 檢查 sessionStorage 中是否有 token，而不是檢查全域變數
    const tokenFromStorage = sessionStorage.getItem('admin_jwt');
    const roleFromStorage = sessionStorage.getItem('admin_role');

    if (tokenFromStorage && roleFromStorage) {
        console.log("偵測到 sessionStorage 中的 JWT，嘗試直接登入...");
        showPanel(); // 這將觸發 socket.connect()
    } else {
        showLogin();
    }
});

loginButton.addEventListener("click", attemptLogin);
passwordInput.addEventListener("keyup", (event) => { if (event.key === "Enter") { attemptLogin(); } });
usernameInput.addEventListener("keyup", (event) => { if (event.key === "Enter") { passwordInput.focus(); } });

// --- 6. 控制台 Socket 監聽器 ---
socket.on("connect", () => {
    console.log("Socket.io 已連接 (Admin)");
    statusBar.classList.remove("visible");
    showToast("✅ 已連線到伺服器", "success");
});
socket.on("disconnect", () => {
    console.warn("Socket.io 已斷線");
    statusBar.classList.add("visible");
    showToast("❌ 已從伺服器斷線", "error");
});


// --- 【!!! 關鍵錯誤修正 !!!】 ---
socket.on("connect_error", (err) => {
    console.error("Socket 連線失敗:", err.message);
    
    // 檢查錯誤是否為「認證失敗」(由我們伺服器 index.js:453 回傳的)
    if (err.message.includes("Authentication failed")) {
        // --- 這是「永久」的認證錯誤 (例如 Token 過期) ---
        // 1. 停止重試
        socket.disconnect(); 
        
        // 2. 準備錯誤訊息
        let alertMessage = `後台即時連線(Socket.io)失敗。\n\n錯誤: ${err.message}\n\n`;
        alertMessage += "原因：您的認證無效或已過期，請您重新登入。";
        
        // 3. 提示使用者並強制登出
        alert(alertMessage);
        showLogin(); 
        
    } else {
        // --- 這是「暫時」的網路錯誤 ---
        // (例如 "xhr poll error", "websocket error", 502 Bad Gateway)
        //
        // 4. 【!!!】 *不要* 呼叫 showLogin()！
        //
        // 我們什麼都不做，只在控制台顯示警告。
        // `socket.io` 會在背景自動重試連線。
        // 當 Render 伺服器喚醒後，重試就會成功。
        console.warn("偵測到暫時性網路錯誤，Socket.io 將在背景自動重試...");
        // (此時 'disconnect' 事件會自動觸發，顯示紅色狀態列)
    }
});
// --- 【錯誤修正結束】 ---


socket.on("initAdminLogs", (logs) => {
    adminLogUI.innerHTML = "";
    if (!logs || logs.length === 0) {
        adminLogUI.innerHTML = "<li>[目前尚無日誌]</li>";
        return;
    }
    const fragment = document.createDocumentFragment();
    logs.forEach(logMsg => {
        const li = document.createElement("li");
        li.textContent = logMsg;
        fragment.appendChild(li);
    });
    adminLogUI.appendChild(fragment);
    adminLogUI.scrollTop = adminLogUI.scrollHeight; 
});

socket.on("newAdminLog", (logMessage) => {
    const firstLi = adminLogUI.querySelector("li");
    if (firstLi && firstLi.textContent.includes("[目前尚無日誌]")) {
        adminLogUI.innerHTML = "";
    }
    
    const li = document.createElement("li");
    li.textContent = logMessage;
    adminLogUI.prepend(li); 
});

socket.on("update", (num) => {
    numberEl.textContent = num;
});
socket.on("updatePassed", (numbers) => {
    renderPassedListUI(numbers);
});
socket.on("updateFeaturedContents", (contents) => {
    renderFeaturedListUI(contents);
});
socket.on("updateSoundSetting", (isEnabled) => {
    console.log("收到音效設定:", isEnabled);
    soundToggle.checked = isEnabled;
});
socket.on("updatePublicStatus", (isPublic) => {
    console.log("收到公開狀態:", isPublic);
    publicToggle.checked = isPublic;
});
socket.on("updateTimestamp", (timestamp) => {
    console.log("Timestamp updated:", timestamp);
});


// --- 7. API 請求函式 ---
async function apiRequest(endpoint, body, a_returnResponse = false) {
    // 【錯誤修正】 
    // API 請求的 Token 應 *永遠* 從 sessionStorage 讀取
    const tokenFromStorage = sessionStorage.getItem('admin_jwt');

    try {
        const res = await fetch(endpoint, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${tokenFromStorage}` // <-- 使用最新的 Token
            },
            body: JSON.stringify(body), 
        });
        
        const responseData = await res.json(); 

        if (!res.ok) {
            
            // 【UX 修正】 改用 showToast
            if (res.status === 401 || res.status === 403) {
                showToast("❌ 認證無效或已過期，請重新登入", "error"); 
                
                // 【錯誤修正】
                // 如果 API 請求失敗 (例如 Token 過期)，我們應呼叫 showLogin()
                // 但要延遲一下，讓使用者看到 toast
                setTimeout(showLogin, 2000); 

            } else {
                const errorMsg = responseData.error || "未知錯誤";
                showToast(`❌ API 錯誤: ${errorMsg}`, "error");
            }
            return false;
        }

        if (a_returnResponse) {
            return responseData; 
        }
        
        return true; 
    } catch (err) {
        showToast(`❌ 網路連線失敗: ${err.message}`, "error");
        return false;
    }
}

// --- 8. GUI 渲染函式 ---
function renderPassedListUI(numbers) {
    passedListUI.innerHTML = ""; 
    if (!Array.isArray(numbers)) return;
    const fragment = document.createDocumentFragment();
    numbers.forEach((number) => {
        const li = document.createElement("li");
        li.innerHTML = `<span>${number}</span>`;
        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "delete-item-btn";
        deleteBtn.textContent = "×";
        deleteBtn.onclick = async () => {
            if (confirm(`確定要刪除過號 ${number} 嗎？`)) {
                deleteBtn.disabled = true;
                await apiRequest("/api/passed/remove", { number: number });
            }
        };
        li.appendChild(deleteBtn);
        fragment.appendChild(li);
    });
    passedListUI.appendChild(fragment);
}

function renderFeaturedListUI(contents) {
    featuredListUI.innerHTML = "";
    if (!Array.isArray(contents)) return;
    
    const fragment = document.createDocumentFragment();
    
    contents.forEach((item) => {
        const li = document.createElement("li");
        const span = document.createElement("span");
        const textNode = document.createTextNode(item.linkText);
        span.appendChild(textNode);
        span.appendChild(document.createElement("br"));
        const small = document.createElement("small");
        small.style.color = "#666";
        small.textContent = item.linkUrl; 
        span.appendChild(small);
        li.appendChild(span);

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "delete-item-btn";
        deleteBtn.textContent = "×";
        
        deleteBtn.onclick = async () => {
            if (confirm(`確定要刪除連結 ${item.linkText} 嗎？`)) { 
                deleteBtn.disabled = true;
                await apiRequest("/api/featured/remove", {
                    linkText: item.linkText,
                    linkUrl: item.linkUrl
                });
            }
        };
        li.appendChild(deleteBtn);
        fragment.appendChild(li);
    });
    featuredListUI.appendChild(fragment);
}

// --- 9. 控制台按鈕功能 ---

// 【UX 修正】 通用危險操作確認函式
function requestTimedConfirmation(btnId, confirmBtnId, actionFunction, timeout = 5000) {
    const btn = document.getElementById(btnId);
    const confirmBtn = document.getElementById(confirmBtnId);
    
    if (!btn || !confirmBtn) return;
    
    // 清除同一個按鈕的上一個計時器 (如果有的話)
    if (timedConfirmTimers[btnId]) {
        clearTimeout(timedConfirmTimers[btnId]);
    }
    
    btn.style.display = "none";
    confirmBtn.style.display = "block";
    
    // 綁定一次性的點擊事件
    confirmBtn.onclick = () => {
        clearTimeout(timedConfirmTimers[btnId]);
        timedConfirmTimers[btnId] = null;
        confirmBtn.style.display = "none";
        btn.style.display = "block";
        actionFunction(); // 執行真正的危險操作
    };
    
    // 設定 5 秒後自動取消
    timedConfirmTimers[btnId] = setTimeout(() => {
        confirmBtn.style.display = "none";
        btn.style.display = "block";
        timedConfirmTimers[btnId] = null;
        confirmBtn.onclick = null; // 移除點擊事件
    }, timeout);
}


async function changeNumber(direction) {
    await apiRequest("/change-number", { direction });
}
async function setNumber() {
    const num = document.getElementById("manualNumber").value;
    if (num === "") return;
    const success = await apiRequest("/set-number", { number: num });
    if (success) {
        document.getElementById("manualNumber").value = "";
        showToast("✅ 號碼已設定", "success");
    }
}
async function resetNumber() {
    if (!confirm("確定要將「目前號碼」重置為 0 嗎？")) return;
    const success = await apiRequest("/set-number", { number: 0 });
    if (success) {
        document.getElementById("manualNumber").value = "";
        showToast("✅ 號碼已重置為 0", "success");
    }
}

// 【UX 修正】 移除以下三個舊的函式
/*
async function resetPassed_fixed() { ... }
async function resetFeaturedContents_fixed() { ... }
async function clearAdminLog() { ... }
*/

function cancelResetAll() {
    resetAllConfirmBtn.style.display = "none";
    resetAllBtn.style.display = "block";
    if (resetAllTimer) {
        clearTimeout(resetAllTimer);
        resetAllTimer = null;
    }
}
async function confirmResetAll() {
    const success = await apiRequest("/reset", {});
    if (success) {
        document.getElementById("manualNumber").value = "";
        showToast("💥 所有資料已重置", "success");
    }
    cancelResetAll();
}
function requestResetAll() {
    resetAllBtn.style.display = "none";
    resetAllConfirmBtn.style.display = "block";
    resetAllTimer = setTimeout(() => {
        cancelResetAll();
    }, 5000);
}


// --- 10. 綁定按鈕事件 ---
document.getElementById("next").onclick = () => changeNumber("next");
document.getElementById("prev").onclick = () => changeNumber("prev");
document.getElementById("setNumber").onclick = setNumber;
document.getElementById("resetNumber").onclick = resetNumber;

// 【UX 修正】 改用新的防呆機制
document.getElementById("resetPassed").onclick = () => {
    requestTimedConfirmation("resetPassed", "resetPassedConfirm", async () => {
        const success = await apiRequest("/api/passed/clear", {});
        if (success) showToast("✅ 過號列表已清空", "success");
    });
};

document.getElementById("resetFeaturedContents").onclick = () => {
    requestTimedConfirmation("resetFeaturedContents", "resetFeaturedContentsConfirm", async () => {
        const success = await apiRequest("/api/featured/clear", {});
        if (success) showToast("✅ 精選連結已清空", "success");
    });
};

document.getElementById("clear-log-btn").onclick = () => {
    requestTimedConfirmation("clear-log-btn", "clear-log-btn-confirm", async () => {
        showToast("🧼 正在清除日誌...", "info");
        await apiRequest("/api/logs/clear", {});
        // 清除成功後，後端會觸發 initAdminLogs，自動更新 UI
    });
};

resetAllBtn.onclick = requestResetAll;
resetAllConfirmBtn.onclick = confirmResetAll;
if (logoutBtn) logoutBtn.onclick = showLogin;

addPassedBtn.onclick = async () => {
    const num = Number(newPassedNumberInput.value);
    if (num <= 0 || !Number.isInteger(num)) {
        alert("請輸入有效的正整數。");
        return;
    }
    addPassedBtn.disabled = true;
    const success = await apiRequest("/api/passed/add", { number: num });
    if (success) {
        newPassedNumberInput.value = "";
    }
    addPassedBtn.disabled = false;
};
addFeaturedBtn.onclick = async () => {
    const text = newLinkTextInput.value.trim();
    const url = newLinkUrlInput.value.trim();
    if (!text || !url) {
        alert("「連結文字」和「網址」都必須填寫。");
        return;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        alert("網址請務必以 http:// 或 https:// 開頭。");
        return;
    }
    addFeaturedBtn.disabled = true;
    const success = await apiRequest("/api/featured/add", {
        linkText: text,
        linkUrl: url
    });
    if (success) {
        newLinkTextInput.value = "";
        newLinkUrlInput.value = "";
    }
    addFeaturedBtn.disabled = false;
};

// --- 11. 綁定 Enter 鍵 ---
newPassedNumberInput.addEventListener("keyup", (event) => { if (event.key === "Enter") { addPassedBtn.click(); } });
newLinkTextInput.addEventListener("keyup", (event) => { if (event.key === "Enter") { newLinkUrlInput.focus(); } });
newLinkUrlInput.addEventListener("keyup", (event) => { if (event.key === "Enter") { addFeaturedBtn.click(); } });

// --- 12. 綁定開關 ---
soundToggle.addEventListener("change", () => {
    const isEnabled = soundToggle.checked;
    apiRequest("/set-sound-enabled", { enabled: isEnabled });
});
publicToggle.addEventListener("change", () => {
    const isPublic = publicToggle.checked;
    if (!isPublic) {
        if (!confirm("確定要關閉前台嗎？\n所有使用者將會看到「維護中」畫面。")) {
            publicToggle.checked = true; 
            return;
        }
    }
    apiRequest("/set-public-status", { isPublic: isPublic });
});

// --- 13. Super Admin 功能函式和綁定 ---

async function loadAdmins() {
    const adminListUI = document.getElementById("admin-list-ui");
    if (!adminListUI) return; 
    
    adminListUI.innerHTML = "<li>正在載入...</li>";
    const data = await apiRequest("/api/admin/list", {}, true);
    
    if (data && data.admins) {
        adminListUI.innerHTML = "";
        
        // 【安全修正】 從 sessionStorage 讀取
        const myUsername = sessionStorage.getItem('admin_username');

        data.admins.forEach(admin => {
            const li = document.createElement("li");
            li.innerHTML = `<span>${admin.username} (<strong>${admin.role}</strong>)</span>`;
            
            if (admin.username !== myUsername) { 
                const deleteBtn = document.createElement("button");
                deleteBtn.type = "button";
                deleteBtn.className = "delete-item-btn";
                deleteBtn.textContent = "×";
                deleteBtn.onclick = () => deleteAdmin(admin.username);
                li.appendChild(deleteBtn);
            }
            adminListUI.appendChild(li);
        });
    } else {
        adminListUI.innerHTML = "<li>載入失敗</li>";
    }
}

async function addAdmin() {
    const newAdminUsernameInput = document.getElementById("new-admin-username");
    const newAdminPasswordInput = document.getElementById("new-admin-password");
    const newAdminRoleSelect = document.getElementById("new-admin-role");

    const username = newAdminUsernameInput.value;
    const password = newAdminPasswordInput.value;
    const role = newAdminRoleSelect.value;

    if (!username || !password) {
        showToast("❌ 使用者名稱和密碼為必填", "error");
        return;
    }

    const success = await apiRequest("/api/admin/add", { username, password, role });
    if (success) {
        showToast("✅ 管理員已新增", "success");
        newAdminUsernameInput.value = "";
        newAdminPasswordInput.value = "";
        loadAdmins(); 
    }
}

async function setAdminPassword() {
    const setPwUsernameInput = document.getElementById("set-pw-username");
    const setNewPasswordInput = document.getElementById("set-pw-new-password");
    
    const username = setPwUsernameInput.value;
    const newPassword = setNewPasswordInput.value;

    if (!username || !newPassword) {
        showToast("❌ 請輸入使用者名稱和新密碼", "error");
        return;
    }

    if (!confirm(`確定要重設 ${username} 的密碼嗎？`)) return;

    const success = await apiRequest("/api/admin/set-password", { username, newPassword });
    if (success) {
        showToast(`✅ ${username} 的密碼已重設`, "success");
        setPwUsernameInput.value = "";
        setNewPasswordInput.value = "";
    }
}

async function deleteAdmin(username) {
    if (!confirm(`確定要刪除管理員 ${username} 嗎？此動作無法復原。`)) return;
    
    const success = await apiRequest("/api/admin/delete", { username });
    if (success) {
        showToast(`🗑️ 管理員 ${username} 已刪除`, "success");
        loadAdmins(); 
    }
}

// 【最終修正】 初始化 Super Admin 按鈕綁定
function initSuperAdminBindings() {
    const refreshAdminListBtn = document.getElementById("refresh-admin-list");
    const addAdminBtn = document.getElementById("add-admin-btn");
    const setPwBtn = document.getElementById("set-pw-btn");
    
    if (refreshAdminListBtn) refreshAdminListBtn.onclick = loadAdmins;
    if (addAdminBtn) addAdminBtn.onclick = addAdmin;
    if (setPwBtn) setPwBtn.onclick = setAdminPassword;
}


// 【安全修正】 移除整個不安全的 jwt_decode 函式
/*
function jwt_decode(token) { ... }
*/
