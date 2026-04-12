// ── State ──────────────────────────────────────────────
let currentReceiptData = null;

// ── Settings ────────────────────────────────────────────
function loadSettings() {
  return {
    gasUrl: localStorage.getItem('gasUrl') || '',
    sheetUrl: localStorage.getItem('sheetUrl') || '',
    sheetName: localStorage.getItem('sheetName') || '',
  };
}

function saveSettings() {
  const gasUrl = document.getElementById('settings-gas-url').value.trim();
  const sheetUrl = document.getElementById('settings-sheet-url').value.trim();
  const sheetName = document.getElementById('settings-sheet-name').value.trim();
  const statusEl = document.getElementById('settings-status');

  if (!gasUrl) {
    showStatus(statusEl, 'GAS エンドポイント URL を入力してください', 'err');
    return;
  }
  if (!sheetUrl) {
    showStatus(statusEl, 'スプレッドシート URL を入力してください', 'err');
    return;
  }

  localStorage.setItem('gasUrl', gasUrl);
  localStorage.setItem('sheetUrl', sheetUrl);
  localStorage.setItem('sheetName', sheetName);

  showStatus(statusEl, '設定を保存しました ✓', 'ok');
}

function showStatus(el, msg, type) {
  el.textContent = msg;
  el.className = 'settings-status ' + type;
}

// ── View Router ─────────────────────────────────────────
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + id).classList.add('active');
  window.scrollTo(0, 0);
}

function showHome() { showView('home'); }
function showProcessing() { showView('processing'); }
function showReview() { showView('review'); }
function showSuccess(data) {
  const detail = document.getElementById('success-detail');
  detail.innerHTML = `
    <div class="detail-date">${data.date || '日付不明'}</div>
    <div class="detail-store">${data.store || '店舗名不明'}</div>
    <div class="detail-total">¥${Number(data.total).toLocaleString()}</div>
  `;
  showView('success');
}

function showSettings() {
  const s = loadSettings();
  document.getElementById('settings-gas-url').value = s.gasUrl;
  document.getElementById('settings-sheet-url').value = s.sheetUrl;
  document.getElementById('settings-sheet-name').value = s.sheetName;
  document.getElementById('settings-status').className = 'settings-status';
  showView('settings');
}

// ── Camera / File ────────────────────────────────────────
function triggerCapture() {
  document.getElementById('file-input').click();
}

function handleFile(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  const settings = loadSettings();
  if (!settings.gasUrl) {
    showToast('先に設定でGAS URLを入力してください');
    showSettings();
    return;
  }

  showProcessing();

  compressImage(file, 1200).then(base64 => {
    return callGasOcr(settings.gasUrl, base64);
  }).then(data => {
    currentReceiptData = data;
    renderReview(data);
    showReview();
  }).catch(err => {
    console.error(err);
    showHome();
    showToast('読み取りに失敗しました: ' + err.message);
  });
}

// ── Image Compression ────────────────────────────────────
function compressImage(file, maxSize) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
        resolve(base64);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── GAS API Calls ────────────────────────────────────────
async function callGas(gasUrl, payload) {
  const res = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

async function callGasOcr(gasUrl, base64Image) {
  return await callGas(gasUrl, { action: 'ocr', image: base64Image });
}

async function callGasSave(gasUrl, data) {
  return await callGas(gasUrl, { action: 'save', ...data });
}

// ── Review Screen ────────────────────────────────────────
function renderReview(data) {
  document.getElementById('review-date').value = data.date || '';
  document.getElementById('review-store').value = data.store || '';
  document.getElementById('review-total').value = data.total || '';

  const list = document.getElementById('items-list');
  list.innerHTML = '';
  const items = data.items || [];
  document.getElementById('item-count').textContent = `${items.length}件`;

  items.forEach((item, idx) => {
    list.appendChild(createItemRow(item.name, item.price, idx));
  });
}

function createItemRow(name, price, idx) {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.dataset.idx = idx;
  row.innerHTML = `
    <input class="item-name" type="text" value="${escHtml(name)}" placeholder="商品名">
    <span class="item-yen">¥</span>
    <input class="item-price" type="number" value="${price}" inputmode="numeric">
    <button class="item-delete" onclick="deleteItem(this)" title="削除">×</button>
  `;
  return row;
}

function deleteItem(btn) {
  btn.closest('.item-row').remove();
  updateItemCount();
}

function updateItemCount() {
  const count = document.getElementById('items-list').querySelectorAll('.item-row').length;
  document.getElementById('item-count').textContent = `${count}件`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ── Save to Sheet ────────────────────────────────────────
async function saveToSheet() {
  const settings = loadSettings();
  if (!settings.gasUrl || !settings.sheetUrl) {
    showToast('設定が不完全です');
    showSettings();
    return;
  }

  const date = document.getElementById('review-date').value.trim();
  const store = document.getElementById('review-store').value.trim();
  const total = Number(document.getElementById('review-total').value);

  if (!total || isNaN(total)) {
    showToast('合計金額を入力してください');
    return;
  }

  const saveBtn = document.querySelector('.review-actions .btn-primary');
  saveBtn.disabled = true;
  saveBtn.textContent = '保存中...';

  try {
    await callGasSave(settings.gasUrl, {
      spreadsheetUrl: settings.sheetUrl,
      sheetName: settings.sheetName,
      date,
      store,
      total,
    });
    showSuccess({ date, store, total });
  } catch (err) {
    console.error(err);
    showToast('保存に失敗しました: ' + err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'スプレッドシートに記録';
  }
}

// ── Create New Sheet ─────────────────────────────────────
async function createNewSheet() {
  const gasUrl = document.getElementById('settings-gas-url').value.trim();
  if (!gasUrl) {
    showToast('先にGAS URLを入力してください');
    return;
  }

  const btn = document.getElementById('btn-create-sheet');
  const statusEl = document.getElementById('create-sheet-status');
  btn.disabled = true;
  btn.textContent = '作成中...';
  statusEl.className = 'create-sheet-status';

  try {
    const result = await callGas(gasUrl, { action: 'create_sheet' });
    const url = result.spreadsheetUrl;
    document.getElementById('settings-sheet-url').value = url;
    statusEl.innerHTML = `✅ 作成しました！URLを自動入力しました。<br><a href="${url}" target="_blank">スプレッドシートを開く →</a>`;
    statusEl.className = 'create-sheet-status ok';
    showToast('スプレッドシートを作成しました');
  } catch (err) {
    statusEl.textContent = '❌ 作成に失敗しました: ' + err.message;
    statusEl.className = 'create-sheet-status err';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-create-icon">➕</span> 新規スプレッドシートを作成';
  }
}

// ── Toast ────────────────────────────────────────────────
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
}

// ── Init ─────────────────────────────────────────────────
(function init() {
  const settings = loadSettings();
  if (!settings.gasUrl || !settings.sheetUrl) {
    setTimeout(() => showToast('まず設定でGAS URLとスプレッドシートURLを入力してください'), 800);
  }
})();
