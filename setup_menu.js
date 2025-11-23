/*
 * setup_menu.js - 自動建立 LINE 管理員選單 (配合完美版圖片)
 */
require('dotenv').config();
const line = require('@line/bot-sdk');
const fs = require('fs');

// 1. 設定 LINE 連線
const client = new line.Client({
    channelAccessToken: process.env.LINE_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET
});

// 2. 定義按鈕區域 (2列3行，總寬2500x1686)
function createArea(x, y, w, h, action) {
    return { bounds: { x, y, width: w, height: h }, action };
}

// 定義 6 個按鈕的動作 (管理員專用)
const adminMenuAreas = [
    // --- 第一排 ---
    // 左上：查詢進度
    createArea(0, 0, 833, 843, { type: 'message', text: '🔍 查詢進度' }),
    // 中上：過號名單
    createArea(833, 0, 834, 843, { type: 'message', text: '📋 過號名單' }),
    // 右上：設定提醒 (觸發引導文字)
    createArea(1667, 0, 833, 843, { type: 'message', text: '設定提醒' }), 
    
    // --- 第二排 ---
    // 左下：取消提醒
    createArea(0, 843, 833, 843, { type: 'message', text: '❌ 取消提醒' }),
    
    // 中下：即時網頁 (請填入您的 LIFF 網址 或 網站首頁)
    createArea(833, 843, 834, 843, { 
        type: 'uri', 
        uri: process.env.LIFF_URL || 'https://liff.line.me/您的LIFF_ID_或是網址' 
    }), 
    
    // 右下：後台登入 (直接連結到 admin.html)
    // 【重要】請將下方網址修改為您實際的後台網址
    createArea(1667, 843, 833, 843, { 
        type: 'uri', 
        uri: 'https://您的網站網址/admin.html' 
    }) 
];

const richMenuObject = {
    size: { width: 2500, height: 1686 },
    selected: false,
    name: "Admin Menu Final", // 版本名稱
    chatBarText: "管理員功能",
    areas: adminMenuAreas
};

async function setup() {
    try {
        console.log("⏳ 正在建立管理員選單...");
        
        // 1. 建立選單骨架
        const richMenuId = await client.createRichMenu(richMenuObject);
        console.log(`✅ 選單骨架建立成功！ID: ${richMenuId}`);

        // 2. 上傳圖片 (使用最新的完美版檔名)
        const imagePath = './menu_admin_final_perfect.jpg'; 
        
        if (!fs.existsSync(imagePath)) {
            throw new Error(`找不到圖片: ${imagePath}，請確認檔案是否存在於根目錄。`);
        }
        
        await client.setRichMenuImage(richMenuId, fs.createReadStream(imagePath));
        console.log("✅ 圖片上傳成功！");

        console.log("\n========================================");
        console.log("🎉 設定完成！請將下方 ID 複製到您的 .env 檔案中：");
        console.log(`ADMIN_RICH_MENU_ID=${richMenuId}`);
        console.log("========================================\n");

    } catch (error) {
        console.error("❌ 發生錯誤:", error.originalError?.response?.data || error.message);
    }
}

setup();