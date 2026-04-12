/**
 * レシートスキャナー - Google Apps Script バックエンド
 * ※ APIキー不要・完全無料で動作します
 *
 * 【初期設定】
 * 1. GASエディタで「サービスを追加」→ Drive API を有効化
 *    (左メニュー「サービス」→ + → Drive API → 追加)
 *
 * 2. デプロイ設定:
 *    「デプロイ」→「新しいデプロイ」→「ウェブアプリ」
 *    - 次のユーザーとして実行: 自分
 *    - アクセスできるユーザー: 全員
 *
 * 3. デプロイ後のURLをアプリ設定に貼り付けてください
 */

// ────────────────────────────────────────────────────────
// エントリーポイント
// ────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    let result;

    if (data.action === 'ocr') {
      result = ocrReceipt(data.image);
    } else if (data.action === 'save') {
      result = saveToSheet(data);
    } else if (data.action === 'create_sheet') {
      result = createNewSpreadsheet();
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

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'Receipt Scanner GAS is running.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ────────────────────────────────────────────────────────
// OCR: Google Drive の無料OCR機能を使用（APIキー不要）
// ────────────────────────────────────────────────────────
function ocrReceipt(base64Image) {
  // base64画像をBlobに変換
  const imageBytes = Utilities.base64Decode(base64Image);
  const blob = Utilities.newBlob(imageBytes, 'image/jpeg', 'receipt_temp.jpg');

  // Google DriveのOCR機能でGoogleドキュメントとして取り込む（無料）
  const file = Drive.Files.insert(
    {
      title: 'receipt_temp_ocr',
      mimeType: 'application/vnd.google-apps.document'
    },
    blob,
    {
      ocr: true,
      ocrLanguage: 'ja'   // 日本語OCR
    }
  );

  // テキスト抽出
  const doc = DocumentApp.openById(file.id);
  const rawText = doc.getBody().getText();

  // 一時ファイルを削除
  DriveApp.getFileById(file.id).setTrashed(true);

  // テキストを解析してJSON化
  return parseReceiptText(rawText);
}

// ────────────────────────────────────────────────────────
// レシートテキスト解析
// ────────────────────────────────────────────────────────
function parseReceiptText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // 日付を探す (YYYY/MM/DD, YYYY-MM-DD, YYYY年MM月DD日 など)
  let date = getTodayString();
  const datePatterns = [
    /(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/,
    /(\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
  ];
  for (const line of lines) {
    for (const pat of datePatterns) {
      const m = line.match(pat);
      if (m) {
        const y = m[1].length === 2 ? '20' + m[1] : m[1];
        date = y + '/' + String(m[2]).padStart(2,'0') + '/' + String(m[3]).padStart(2,'0');
        break;
      }
    }
    if (date !== getTodayString()) break;
  }

  // 店舗名（最初の非数字行）
  let store = '';
  for (const line of lines) {
    if (!/^\d/.test(line) && line.length > 1 && !/合計|小計|税|領収|レシート|\*/.test(line)) {
      store = line;
      break;
    }
  }

  // 品目と金額を抽出
  const items = [];
  const itemPattern = /^(.+?)\s+[¥￥\\]?\s*(\d{2,6})\s*$/;
  const amountPattern = /[¥￥\\]?\s*(\d{2,6})/;

  for (const line of lines) {
    const m = line.match(itemPattern);
    if (m) {
      const name = m[1].trim();
      const price = parseInt(m[2], 10);
      // 日付や合計行を除外
      if (!/(合計|小計|税|レシート|領収|年|月|日)/.test(name) && price < 100000) {
        items.push({ name, price });
      }
    }
  }

  // 合計金額を探す（「合計」「お会計」「税込」などの行の金額）
  let total = 0;
  const totalKeywords = /合計|お会計|税込|total|お支払/i;
  for (const line of lines) {
    if (totalKeywords.test(line)) {
      const m = line.match(/(\d{3,6})/g);
      if (m) {
        // 最大の数値を合計とみなす
        const nums = m.map(Number);
        const candidate = Math.max(...nums);
        if (candidate > total) total = candidate;
      }
    }
  }

  // 合計が見つからない場合は品目の合計
  if (total === 0 && items.length > 0) {
    total = items.reduce((s, i) => s + i.price, 0);
  }

  // 合計がまだ0なら全行から最大の金額を探す
  if (total === 0) {
    for (const line of lines) {
      const m = line.match(/(\d{3,6})/g);
      if (m) {
        const nums = m.map(Number).filter(n => n >= 100 && n < 100000);
        if (nums.length > 0) total = Math.max(total, Math.max(...nums));
      }
    }
  }

  return {
    date,
    store,
    items,
    total,
    rawText // デバッグ用（アプリ側では非表示）
  };
}

// ────────────────────────────────────────────────────────
// スプレッドシートへ書き込み
// ────────────────────────────────────────────────────────
function saveToSheet(data) {
  const { spreadsheetUrl, sheetName, date, store, total } = data;

  if (!spreadsheetUrl) throw new Error('spreadsheetUrl が指定されていません');

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
// 新規スプレッドシート作成
// ────────────────────────────────────────────────────────
function createNewSpreadsheet() {
  const ss = SpreadsheetApp.create('レシート記録_' + getTodayString());
  const sheet = ss.getSheets()[0];
  sheet.setName('レシート');

  // ヘッダー行を追加
  sheet.appendRow(['日付', '店舗名', '合計金額（円）']);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  sheet.setFrozenRows(1);

  // 列幅を調整
  sheet.setColumnWidth(1, 120);
  sheet.setColumnWidth(2, 180);
  sheet.setColumnWidth(3, 150);

  // C列を数値フォーマットに設定
  sheet.getRange('C2:C1000').setNumberFormat('#,##0');

  const url = ss.getUrl();
  return { success: true, spreadsheetUrl: url };
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
