// --- 1. 元素節點 (DOM) ---
const loginContainer = document.getElementById("login-container");
const adminPanel = document.getElementById("admin-panel");
const usernameInput = document.getElementById("username-input"); // 【修改】
const passwordInput = document.getElementById("password-input");
const loginButton = document.getElementById("login-button");
const loginError = document.getElementById("login-error");
const numberEl = document.getElementById("number");
const statusBar = document.getElementById("status-bar");
// ... (其他卡片元素不變) ...

// 【新增】 Super Admin 卡片元素
const superAdminCard = document.getElementById("card-superadmin");
const adminListUI = document.getElementById("admin-list-ui");
const refreshAdminListBtn = document.getElementById("refresh-admin-list");
const newAdminUsernameInput = document.getElementById("new-admin-username");
const newAdminPasswordInput = document.getElementById("new-admin-password");
const newAdminRoleSelect = document.getElementById("new-admin-role");
const addAdminBtn = document.getElementById("add-admin-btn");
const setPwUsernameInput = document.getElementById("set-pw-username");
const setNewPasswordInput = document.getElementById("set-pw-new-password");
const setPwBtn = document.getElementById("set-pw-btn");


// --- 2. 全域變數 ---
let token = sessionStorage.getItem('admin_jwt') || ""; // 【重構】 儲存 JWT
let userRole = sessionStorage.getItem('admin_role') || ""; // 【新增】 儲存角色
let resetAllTimer = null;
let toastTimer = null; 

// --- 3. Socket.io ---
// 【重構】 Socket.io 認證改為動態函式
const socket = io({ 
    autoConnect: false,
    auth: () => {
        // 每一次連線（或重連）時，都使用最新的 JWT
        return { token: token }; 
    }
});

// --- 4. 登入/顯示邏輯 ---
function showLogin() {
    loginContainer.style.display = "block";
    adminPanel.style.display = "none";
    document.title = "後台管理 - 登入";
    token = ""; // 清除 token
    userRole = ""; // 清除角色
    sessionStorage.removeItem('admin_jwt'); // 清除 session
    sessionStorage.removeItem('admin_role');
    socket.disconnect();
}

async function showPanel() {
    loginContainer.style.display = "none";
    adminPanel.style.display = "block";
    document.title = "後台管理 - 控制台";

    // 【新增】 根據角色顯示超級管理員卡片
    if (userRole === 'superadmin') {
        superAdminCard.style.display = "block";
        loadAdmins(); // 載入管理員列表
    } else {
        superAdminCard.style.display = "none";
    }
    
    // 【重構】 先連線，讓 auth 函式帶入 token
    if (!socket.connected) {
        socket.connect();
    }
    
    showToast("ℹ️ 使用預設排版", "info");
    // (移除 GridStack.init)
}

// 【重構】 刪除 checkToken 函式

// 【重構】 修改登入邏輯以使用 JWT
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
            token = data.token; // 儲存拿到的 JWT
            userRole = data.role; // 儲存角色
            sessionStorage.setItem('admin_jwt', token); // 存入 sessionStorage
            sessionStorage.setItem('admin_role', userRole);
            await showPanel(); 
        } else {
            loginError.textContent = data.error || "登入失敗";
            showLogin();
        }
    } catch (err) {
        console.error("Login 失敗:", err);
        loginError.textContent = "網路錯誤或伺服器無回應。";
    }
}

document.addEventListener("DOMContentLoaded", () => { 
    // 【重構】 檢查 sessionStorage 中是否已有 token
    if (token && userRole) {
        console.log("偵測到 sessionStorage 中的 JWT，嘗試直接登入...");
        showPanel(); // 直接顯示面板 (如果 token 過期，API 請求會失敗並退回登入)
    } else {
        showLogin();
    }
});

loginButton.addEventListener("click", attemptLogin);
passwordInput.addEventListener("keyup", (event) => { if (event.key === "Enter") { attemptLogin(); } });
usernameInput.addEventListener("keyup", (event) => { if (event.key === "Enter") { passwordInput.focus(); } });

// --- 5. Toast 通知函式 ---
// (Toast 函式 showToast 不變)

// --- 6. 控制台 Socket 監聽器 ---
socket.on("connect", () => {
    console.log("Socket.io 已連接 (Admin)");
    statusBar.classList.remove("visible");
    showToast("✅ 已連線到伺服器", "success");
});
socket.on("disconnect", () => {
    // ... (不變)
});
socket.on("connect_error", (err) => {
    console.error("Socket 連線失敗:", err.message);
    if (err.message === "Authentication failed") {
        alert("認證已過期或無效，請重新登入。");
        showLogin(); // 【重構】 連線失敗（JWT 過期）時退回登入
    }
});

// ... (其他 socket.on 監聽器不變) ...

// --- 7. API 請求函式 ---
// 【重構】 修改 API 請求以使用 JWT Header
async function apiRequest(endpoint, body, a_returnResponse = false) {
    try {
        const res = await fetch(endpoint, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                // 使用 Bearer Token 傳送 JWT
                "Authorization": `Bearer ${token}` 
            },
            body: JSON.stringify(body), // body 中不再需要傳送 token
        });
        
        const responseData = await res.json(); 

        if (!res.ok) {
            // 401 (未授權) 或 403 (禁止) 通常表示 JWT 過期或無效
            if (res.status === 401 || res.status === 403) {
                alert("認證已過期，請重新登入。");
                showLogin();
            } else {
                const errorMsg = responseData.error || "未知錯誤";
                showToast(`❌ API 錯誤: ${errorMsg}`, "error");
                // alert("發生錯誤：" + errorMsg); // Toast 已顯示
            }
            return false;
        }

        if (a_returnResponse) {
            return responseData; 
        }
        
        return true; 
    } catch (err) {
        showToast(`❌ 網路連線失敗: ${err.message}`, "error");
        // alert("網路連線失敗或伺服器無回應：" + err.message);
        return false;
    }
}

// --- 8. GUI 渲染函式 ---
// (renderPassedListUI 和 renderFeaturedListUI 不變)

// --- 9. 控制台按鈕功能 ---
// (changeNumber, setNumber, reset... 等函式不變,
//  它們會自動使用新的 apiRequest 函式)

// --- 10. 綁定按鈕事件 ---
// (舊的按鈕綁定不變)

// --- 11. 綁定 Enter 鍵 ---
// (舊的 Enter 鍵綁定不變)

// --- 12. 綁定開關 ---
// (舊的開關綁定不變)

// --- 13. 【新增】 Super Admin 功能函式和綁定 ---

// 載入管理員列表
async function loadAdmins() {
    adminListUI.innerHTML = "<li>正在載入...</li>";
    const data = await apiRequest("/api/admin/list", {}, true);
    if (data && data.admins) {
        adminListUI.innerHTML = "";
        data.admins.forEach(admin => {
            const li = document.createElement("li");
            li.innerHTML = `<span>${admin.username} (<strong>${admin.role}</strong>)</span>`;
            
            // 不能刪除自己
            if (admin.username !== (sessionStorage.getItem('admin_jwt') ? jwt_decode(sessionStorage.getItem('admin_jwt')).username : '')) { 
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

// 新增管理員
async function addAdmin() {
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
        loadAdmins(); // 重新載入列表
    }
    // 失敗的 Toast 會由 apiRequest 自動處理
}

// 刪除管理員
async function deleteAdmin(username) {
    if (!confirm(`確定要刪除管理員 ${username} 嗎？此動作無法復原。`)) return;

    const success = await apiRequest("/api/admin/delete", { username });
    if (success) {
        showToast("✅ 管理員已刪除", "success");
        loadAdmins(); // 重新載入列表
    }
}

// 重設密碼
async function setAdminPassword() {
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

// 綁定 Super Admin 按鈕
refreshAdminListBtn.onclick = loadAdmins;
addAdminBtn.onclick = addAdmin;
setPwBtn.onclick = setAdminPassword;

// (簡易的 JWT 解碼函式，用於 UI 顯示，避免引入
// 完整函式庫。注意：這不會驗證簽章！)
function jwt_decode(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}
