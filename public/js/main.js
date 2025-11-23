const socket = io();
const numberEl = document.getElementById("number");
const prefixEl = document.getElementById("prefix-display");
const passedListEl = document.getElementById("passedList");
const queueTabsEl = document.getElementById("queue-tabs");
const queueTitleEl = document.getElementById("queue-title-display");
const soundBtn = document.getElementById("sound-prompt");

let currentQueues = [];
let activeQueueId = null;
let passedData = {}; // { queueId: [1, 2] }
let isSoundEnabled = false;

// --- Socket Events ---
socket.on("connect", () => {
    document.getElementById("connection-status").textContent = "✅ 已連線";
    document.body.classList.remove("maintenance");
});

socket.on("disconnect", () => {
    document.getElementById("connection-status").textContent = "❌ 連線中斷";
});

socket.on("updateState", (data) => {
    // data: { queues: [], isMulti: bool, sound: bool, isPublic: bool }
    if (!data.isPublic) {
        document.body.classList.add("maintenance");
        return;
    }
    document.body.classList.remove("maintenance");
    
    currentQueues = data.queues;
    renderTabs(data.isMulti);
    
    // 如果目前選的 Queue 被刪除了，重置為第一個
    if (activeQueueId && !currentQueues.find(q => q.id === activeQueueId)) {
        activeQueueId = null;
    }
    if (!activeQueueId && currentQueues.length > 0) {
        setActiveQueue(currentQueues[0].id);
    } else {
        updateDisplay(); // 更新當前數字
    }
});

socket.on("updatePassed", (data) => {
    passedData[data.queueId] = data.numbers;
    if (activeQueueId === data.queueId) {
        renderPassed(data.numbers);
    }
});

// --- Logic ---
function renderTabs(isMulti) {
    queueTabsEl.innerHTML = "";
    if (!isMulti) {
        queueTabsEl.classList.add("hidden");
        return;
    }
    queueTabsEl.classList.remove("hidden");
    
    currentQueues.forEach(q => {
        const btn = document.createElement("div");
        btn.className = `queue-tab ${q.id === activeQueueId ? 'active' : ''}`;
        btn.textContent = q.name;
        btn.onclick = () => setActiveQueue(q.id);
        queueTabsEl.appendChild(btn);
    });
}

function setActiveQueue(id) {
    activeQueueId = id;
    const queue = currentQueues.find(q => q.id === id);
    if (!queue) return;

    // Update UI
    queueTitleEl.textContent = queue.name;
    prefixEl.textContent = queue.prefix;
    
    // Update Tabs Style
    Array.from(queueTabsEl.children).forEach(child => {
        child.classList.toggle('active', child.textContent === queue.name);
    });

    updateDisplay();
}

function updateDisplay() {
    const queue = currentQueues.find(q => q.id === activeQueueId);
    if (!queue) return;

    const newNum = queue.current_num;
    if (numberEl.textContent !== String(newNum)) {
        numberEl.textContent = newNum;
        numberEl.classList.add("updated");
        setTimeout(() => numberEl.classList.remove("updated"), 500);
        
        if (isSoundEnabled) playSound(newNum);
    }
    
    renderPassed(passedData[activeQueueId] || []);
}

function renderPassed(numbers) {
    passedListEl.innerHTML = "";
    if (!numbers || numbers.length === 0) {
        document.getElementById("passed-empty-msg").style.display = "block";
    } else {
        document.getElementById("passed-empty-msg").style.display = "none";
        numbers.forEach(n => {
            const li = document.createElement("li");
            li.textContent = n;
            passedListEl.appendChild(li);
        });
    }
}

function playSound(num) {
    if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(`${num}號，請到櫃台`);
        u.lang = 'zh-TW';
        window.speechSynthesis.speak(u);
    }
}

// 啟用音效 (瀏覽器限制需互動)
soundBtn.addEventListener("click", () => {
    isSoundEnabled = !isSoundEnabled;
    soundBtn.innerHTML = isSoundEnabled ? '<span class="emoji">🔊</span> 音效已開' : '<span class="emoji">🔇</span> 啟用音效';
    if(isSoundEnabled) {
        // 播放一個無聲片段解鎖 Audio Context
        const u = new SpeechSynthesisUtterance("");
        window.speechSynthesis.speak(u);
    }
});

// --- LIFF Init (若有設定) ---
// 你需要在 index.js 的 settings 中回傳 LIFF ID，此處簡化處理
// fetch('/api/init-data')... then liff.init(...)
