// main.js v8.0
const socket = io();
const numberEl = document.getElementById("number");
const passedListEl = document.getElementById("passedList");
const featuredContainerEl = document.getElementById("featured-container");
const statusBar = document.getElementById("status-bar");
const notifySound = document.getElementById("notify-sound");
const lastUpdatedEl = document.getElementById("last-updated");
const soundPrompt = document.getElementById("sound-prompt");
const passedContainerEl = document.getElementById("passed-container");

// Kiosk
const kioskArea = document.getElementById("kiosk-area");
const btnTakeTicket = document.getElementById("btn-take-ticket");
const kioskWaitingCount = document.getElementById("kiosk-waiting-count");
const ticketModal = document.getElementById("ticket-modal");
const myNewTicketEl = document.getElementById("my-new-ticket");
const modalWaitingCount = document.getElementById("modal-waiting-count");
const btnCloseTicket = document.getElementById("btn-close-ticket");

// Notify
const notifyBtn = document.getElementById("enable-notify-btn");
const myNumInput = document.getElementById("my-number");
const notifyStatus = document.getElementById("notify-status");
const waitTimeEl = document.getElementById("estimated-wait");
const waitMinutesEl = document.getElementById("wait-minutes");

let isSoundEnabled = false, isLocallyMuted = false, ttsEnabled = false;
let myTargetNumber = null, avgServiceTime = 0;
let currentNum = 0, issuedNum = 0;

socket.on("connect", () => { statusBar.classList.remove("visible"); });
socket.on("disconnect", () => { statusBar.classList.add("visible"); lastUpdatedEl.textContent = "連線中斷..."; });

socket.on("update", (num) => {
    handleNewNumber(num);
    currentNum = num;
    updateKioskUI();
});
socket.on("updateIssued", (num) => {
    issuedNum = num;
    updateKioskUI();
});
socket.on("updateKioskMode", (enabled) => {
    kioskArea.style.display = enabled ? "flex" : "none";
    kioskArea.style.flexDirection = "column";
    kioskArea.style.alignItems = "center";
});

socket.on("adminBroadcast", (msg) => { if(!isLocallyMuted) { speakText(msg, 1.0); alert(`📢 公告：${msg}`); } });
socket.on("updateWaitTime", (time) => { avgServiceTime = time; updateWaitTimeUI(); });
socket.on("updateSoundSetting", (isEnabled) => isSoundEnabled = isEnabled);
socket.on("updatePublicStatus", (status) => {
    document.body.classList.toggle("is-closed", !status);
    if (status) socket.connect(); else socket.disconnect();
});
socket.on("updatePassed", (arr) => {
    passedListEl.innerHTML = arr.map(n => `<li>${n}</li>`).join('');
    passedContainerEl.classList.toggle("is-empty", !arr.length);
});
socket.on("updateFeaturedContents", (arr) => {
    featuredContainerEl.innerHTML = arr.length ? arr.map(c => `<a class="featured-link" href="${c.linkUrl}" target="_blank">${c.linkText}</a>`).join('') : '<p class="empty-state-message">暫無精選連結</p>';
});
socket.on("updateTimestamp", (ts) => lastUpdatedEl.textContent = `最後更新: ${new Date(ts).toLocaleTimeString()}`);

// Kiosk Logic
function updateKioskUI() {
    const waiting = Math.max(0, issuedNum - currentNum);
    if(kioskWaitingCount) kioskWaitingCount.textContent = waiting;
}

btnTakeTicket.addEventListener("click", async () => {
    btnTakeTicket.disabled = true;
    try {
        const res = await fetch("/api/kiosk/take-number", { method: "POST" });
        const data = await res.json();
        if(!res.ok) throw new Error(data.error);
        
        myNewTicketEl.textContent = data.yourNumber;
        modalWaitingCount.textContent = data.waitingCount;
        ticketModal.style.display = "flex";
        
        // Auto set reminder
        myNumInput.value = data.yourNumber;
        myTargetNumber = data.yourNumber;
        updateWaitTimeUI();
        
    } catch(e) { alert(e.message); }
    btnTakeTicket.disabled = false;
});
btnCloseTicket.onclick = () => ticketModal.style.display = "none";

// Core Logic
function handleNewNumber(num) {
    playNotificationSound();
    setTimeout(() => { if(String(num) !== numberEl.textContent && isSoundEnabled && !isLocallyMuted) speakText(`${num}號`, 0.9); }, 800);
    
    if (myTargetNumber) {
        const diff = myTargetNumber - num;
        if (diff === 0) {
            if (typeof confetti !== 'undefined') confetti({particleCount: 100, spread: 70, origin: {y: 0.6}});
            if(!isLocallyMuted) speakText("輪到您了", 1.0);
            new Notification("到號通知", { body: "輪到您了！" });
            myTargetNumber = null;
            myNumInput.value = "";
            notifyStatus.textContent = "🎉 已到號！";
        } else if (diff > 0 && diff <= 3) {
            new Notification("叫號提醒", { body: `剩 ${diff} 組！` });
        }
    }
    
    numberEl.textContent = num;
    numberEl.classList.add("updated");
    setTimeout(() => numberEl.classList.remove("updated"), 500);
    updateWaitTimeUI();
}

function updateWaitTimeUI() {
    const myNum = parseInt(myNumInput.value);
    const current = parseInt(numberEl.textContent) || 0;
    if (!myNum || myNum <= current || avgServiceTime <= 0) { waitTimeEl.style.display = "none"; return; }
    waitMinutesEl.textContent = Math.ceil((myNum - current) * avgServiceTime);
    waitTimeEl.style.display = "block";
}

function speakText(text, rate) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-TW'; u.rate = rate;
    window.speechSynthesis.speak(u);
}
function playNotificationSound() {
    if(!notifySound) return;
    notifySound.play().then(()=>{ ttsEnabled=true; updateMuteUI(false); }).catch(()=>{ updateMuteUI(true, true); });
}
function updateMuteUI(isMuted, needsPerm=false) {
    isLocallyMuted = isMuted;
    soundPrompt.style.display = 'block';
    soundPrompt.innerHTML = isMuted ? '<span class="emoji">🔇</span> 點此啟用音效' : '<span class="emoji">🔊</span> 音效已開啟';
    if(!isMuted) soundPrompt.classList.add("is-active"); else soundPrompt.classList.remove("is-active");
}
soundPrompt.onclick = () => { playNotificationSound(); updateMuteUI(!isLocallyMuted); };
notifyBtn.onclick = () => {
    if(!("Notification" in window)) return alert("不支援通知");
    Notification.requestPermission().then(p => {
        if(p==="granted" && myNumInput.value) {
            myTargetNumber = parseInt(myNumInput.value);
            notifyStatus.textContent = "✅ 通知已設定";
            updateWaitTimeUI();
        } else alert("請輸入號碼並允許通知");
    });
};
myNumInput.oninput = updateWaitTimeUI;
try { new QRCode(document.getElementById("qr-code-placeholder"), {text: window.location.href, width:120, height:120}); } catch(e){}
