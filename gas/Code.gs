/**
 * レシートスキャナー - Google Apps Script バックエンド
 *
 * 【初期設定】
 * 1. スクリプトプロパティに以下を設定してください:
 *    キー: GEMINI_API_KEY
 *    値:   あなたの Gemini API キー (https://aistudio.google.com/app/apikey で取得)
 *
 * 2. デプロイ設定:
 *    - 新しいデプロイ → ウェブアプリ
 *    - 次のユーザーとして実行: 自分
 *    - アクセスできるユーザー: 全員
 *
 * 3. デプロイ後に表示される URL をアプリの設定に貼り付けてください
 */

// ────────────────────────────────────────────────────────
// エントリーポイント
// ────────────────────────────────────────────────────────
function doPost(e) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  };

  try {
    const data = JSON.parse(e.postData.contents);

    let result;
    if (data.action === 'ocr') {
      result = ocrReceipt(data.image);
    } else if (data.action === 'save') {
      result = saveToSheet(data);
    } else {
      result = { error: 'Unknown action: ' + data.action };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  // 動作確認用
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'Receipt Scanner GAS is running.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ────────────────────────────────────────────────────────
// OCR (Gemini API)
// ────────────────────────────────────────────────────────
function ocrReceipt(base64Image) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY がスクリプトプロパティに設定されていません');
  }

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + apiKey;

  const prompt = `このレシート画像を読み取り、以下のJSON形式のみで返してください（説明文や```は不要）:
{
  "date": "YYYY/MM/DD",
  "store": "店舗名",
  "items": [
    {"name": "商品名", "price": 金額(数値)}
  ],
  "total": 合計金額(数値)
}
注意事項:
- 日付が読み取れない場合は今日の日付 (${getTodayString()}) を使用
- 店舗名が不明な場合は空文字
- 金額はすべて整数（円単位）
- 税込合計を "total" に設定`;

  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: 'image/jpeg', data: base64Image } }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
    }
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const statusCode = response.getResponseCode();
  if (statusCode !== 200) {
    throw new Error('Gemini API エラー: HTTP ' + statusCode + ' - ' + response.getContentText());
  }

  const result = JSON.parse(response.getContentText());

  if (!result.candidates || result.candidates.length === 0) {
    throw new Error('Gemini API から応答がありませんでした');
  }

  const text = result.candidates[0].content.parts[0].text.trim();

  // JSON部分を抽出
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('レシートの読み取りに失敗しました。もう一度撮影してください。');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // 型を保証
  parsed.total = Number(parsed.total) || 0;
  if (!Array.isArray(parsed.items)) parsed.items = [];
  parsed.items = parsed.items.map(item => ({
    name: String(item.name || ''),
    price: Number(item.price) || 0,
  }));

  return parsed;
}

// ────────────────────────────────────────────────────────
// スプレッドシートへ書き込み
// ────────────────────────────────────────────────────────
function saveToSheet(data) {
  const { spreadsheetUrl, sheetName, date, store, total } = data;

  if (!spreadsheetUrl) throw new Error('spreadsheetUrl が指定されていません');

  // URL から ID を抽出
  const idMatch = spreadsheetUrl.match(/\/d\/([a-zA-Z0-9\-_]+)/);
  if (!idMatch) throw new Error('スプレッドシートのURLが正しくありません');
  const spreadsheetId = idMatch[1];

  const ss = SpreadsheetApp.openById(spreadsheetId);

  let sheet;
  if (sheetName) {
    sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error('シート「' + sheetName + '」が見つかりません');
  } else {
    sheet = ss.getSheets()[0];
  }

  // A列: 日付, B列: 店舗名, C列: 合計金額
  sheet.appendRow([
    date || getTodayString(),
    store || '',
    Number(total) || 0,
  ]);

  return { success: true };
}

// ────────────────────────────────────────────────────────
// ユーティリティ
// ────────────────────────────────────────────────────────
function getTodayString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return y + '/' + m + '/' + d;
}
