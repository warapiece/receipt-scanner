// ── State ──────────────────────────────────────────────
let _sheetUrlCache = ''; // 成功画面でリンクに使う

// ── Settings ────────────────────────────────────────────
function loadSettings() {
  return {
    gasUrl:    localStorage.getItem('gasUrl')    || '',
    sheetUrl:  localStorage.getItem('sheetUrl')  || '',
    sheetName: localStorage.getItem('sheetName') || '',
    setupDone: localStorage.getItem('setupDone') === '1',
  };
}

function persistSettings(gasUrl, sheetUrl, sheetName) {
  localStorage.setItem('gasUrl', gasUrl);
  localStorage.setItem('sheetUrl', sheetUrl);
  localStorage.setItem('sheetName', sheetName);
  localStorage.setItem('setupDone', '1');
}

// ── View Router ─────────────────────────────────────────
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + id).classList.add('active');
  window.scrollTo(0, 0);
}

function showHome() {
  updateHomeBanner();
  showView('home');
}

function showSetup() { showSetupStep(1); showView('setup'); }
function showProcessing() { showView('processing'); }

function showSettings() {
  const s = loadSettings();
  document.getElementById('settings-gas-url').value  = s.gasUrl;
  document.getElementById('settings-sheet-url').value = s.sheetUrl;
  document.getElementById('settings-sheet-name').value = s.sheetName;
  document.getElementById('settings-status').className = 'settings-status';
  document.getElementById('create-sheet-status').className = 'create-sheet-status';
  showView('settings');
}

// ── Home banner ─────────────────────────────────────────
function updateHomeBanner() {
  const s = loadSettings();
  const banner = document.getElementById('home-status-banner');
  if (!s.gasUrl || !s.sheetUrl) {
    banner.className = 'status-banner warn';
    banner.innerHTML = '⚠️ 設定が未完了です <button onclick="showSetup()">セットアップする</button>';
  } else {
    banner.className = 'status-banner ok';
    banner.innerHTML = '✅ 設定済み <button onclick="showSettings()">確認・変更</button>';
  }
}

// ── Setup Wizard ────────────────────────────────────────
let _setupChoice = 'new';
let _setupGasUrl = '';
let _setupSheetUrl = '';

function showSetupStep(n) {
  [1, 2, 3].forEach(i => {
    const el = document.getElementById('setup-step-' + i);
    if (el) el.style.display = i === n ? '' : 'none';
    const prog = document.getElementById('prog-' + i);
    if (prog) {
      const circle = prog.querySelector('.prog-circle');
      circle.classList.remove('active', 'done');
      if (i < n) { circle.classList.add('done'); circle.textContent = '✓'; }
      else { circle.textContent = i; }
      if (i === n) circle.classList.add('active');
    }
  });
}

function selectChoice(type) {
  _setupChoice = type;
  document.getElementById('choice-new').classList.toggle('active', type === 'new');
  document.getElementById('choice-existing').classList.toggle('active', type === 'existing');
  document.getElementById('panel-new').style.display      = type === 'new'      ? '' : 'none';
  document.getElementById('panel-existing').style.display = type === 'existing' ? '' : 'none';
}

function setupStep1Next() {
  const url = document.getElementById('setup-gas-url').value.trim();
  const status = document.getElementById('setup-step1-status');
  if (!url || !url.startsWith('https://script.google.com/macros/s/')) {
    status.textContent = '⚠️ 正しいGAS URLを入力してください（https://script.google.com/macros/s/... の形式）';
    status.className = 'inline-status';
    return;
  }
  status.textContent = '';
  _setupGasUrl = url;
  showSetupStep(2);
}

async function setupCreateSheet() {
  const btn = document.getElementById('btn-setup-create');
  const statusEl = document.getElementById('setup-create-status');
  btn.disabled = true;
  btn.textContent = '作成中...';
  try {
    const result = await callGas(_setupGasUrl, { action: 'create_sheet' });
    _setupSheetUrl = result.spreadsheetUrl;
    statusEl.innerHTML = `✅ 作成しました！<br><a href="${_setupSheetUrl}" target="_blank">スプレッドシートを開く →</a>`;
    statusEl.className = 'create-sheet-status ok';
  } catch(e) {
    statusEl.textContent = '❌ ' + e.message;
    statusEl.className = 'create-sheet-status err';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>➕ スプレッドシートを自動作成する</span>';
  }
}

function setupStep2Next() {
  const status = document.getElementById('setup-step2-status');
  if (_setupChoice === 'existing') {
    _setupSheetUrl = document.getElementById('setup-sheet-url').value.trim();
  }
  if (!_setupSheetUrl) {
    status.textContent = _setupChoice === 'new'
      ? '⚠️ 先に「自動作成する」ボタンを押してください'
      : '⚠️ スプレッドシートのURLを入力してください';
    return;
  }
  status.textContent = '';
  persistSettings(_setupGasUrl, _setupSheetUrl, '');
  document.getElementById('setup-done-summary').innerHTML =
    `<strong>GAS URL:</strong> 設定済み ✅<br><strong>スプレッドシート:</strong> 設定済み ✅`;
  showSetupStep(3);
}

function finishSetup() {
  showHome();
}

function resetSetup() {
  if (!confirm('設定をリセットして初期設定画面に戻りますか？')) return;
  localStorage.clear();
  showView('welcome');
}

// ── Camera / File ─────────────────────────────────────
function triggerCapture() {
  const s = loadSettings();
  if (!s.gasUrl || !s.sheetUrl) {
    showToast('先にセットアップを完了してください');
    showSetup();
    return;
  }
  document.getElementById('file-input').click();
}

function handleFile(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  const s = loadSettings();
  if (!s.gasUrl) { showSetup(); return; }
  _sheetUrlCache = s.sheetUrl;
  showProcessing();
  compressImage(file, 1200)
    .then(b64 => callGas(s.gasUrl, { action: 'ocr', image: b64 }))
    .then(data => { renderReview(data); showView('review'); })
    .catch(err => { showHome(); showToast('読み取り失敗: ' + err.message); });
}

// ── Image Compression ────────────────────────────────
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
          else       { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── GAS API ──────────────────────────────────────────
async function callGas(gasUrl, payload) {
  const res = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

// ── Review Screen ────────────────────────────────────
function renderReview(data) {
  document.getElementById('review-date').value  = data.date  || '';
  document.getElementById('review-store').value = data.store || '';
  document.getElementById('review-total').value = data.total || '';

  const list = document.getElementById('items-list');
  list.innerHTML = '';
  const items = data.items || [];
  document.getElementById('item-count').textContent = items.length + '件';
  items.forEach((item, idx) => list.appendChild(createItemRow(item.name, item.price, idx)));
}

function createItemRow(name, price, idx) {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <input class="item-name" type="text" value="${escHtml(name)}" placeholder="商品名">
    <span class="item-yen">¥</span>
    <input class="item-price" type="number" value="${price}" inputmode="numeric">
    <button class="item-delete" onclick="deleteItem(this)">×</button>
  `;
  return row;
}

function deleteItem(btn) {
  btn.closest('.item-row').remove();
  const count = document.getElementById('items-list').querySelectorAll('.item-row').length;
  document.getElementById('item-count').textContent = count + '件';
}

function recalcTotal() {
  const prices = [...document.getElementById('items-list').querySelectorAll('.item-price')];
  const sum = prices.reduce((s, el) => s + (Number(el.value) || 0), 0);
  if (sum > 0) {
    document.getElementById('review-total').value = sum;
    showToast('品目の合計から再計算しました');
  } else {
    showToast('品目が空のため計算できません');
  }
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Save to Sheet ────────────────────────────────────
async function saveToSheet() {
  const s = loadSettings();
  const date  = document.getElementById('review-date').value.trim();
  const store = document.getElementById('review-store').value.trim();
  const total = Number(document.getElementById('review-total').value);

  if (!total || isNaN(total)) { showToast('合計金額を入力してください'); return; }

  const btn = document.querySelector('.review-actions .btn-primary');
  btn.disabled = true;
  btn.textContent = '保存中...';

  try {
    await callGas(s.gasUrl, {
      action: 'save',
      spreadsheetUrl: s.sheetUrl,
      sheetName: s.sheetName,
      date, store, total,
    });

    // 成功画面
    document.getElementById('success-detail').innerHTML = `
      <div class="detail-date">${date || '日付不明'}</div>
      <div class="detail-store">${store || '店舗名不明'}</div>
      <div class="detail-total">¥${total.toLocaleString()}</div>
    `;
    const link = document.getElementById('success-sheet-link');
    link.href = _sheetUrlCache || s.sheetUrl || '#';
    link.style.display = _sheetUrlCache ? '' : 'none';
    showView('success');
  } catch(e) {
    showToast('保存失敗: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '✅ スプレッドシートに記録する';
  }
}

// ── Settings screen ──────────────────────────────────
function saveSettings() {
  const gasUrl    = document.getElementById('settings-gas-url').value.trim();
  const sheetUrl  = document.getElementById('settings-sheet-url').value.trim();
  const sheetName = document.getElementById('settings-sheet-name').value.trim();
  const statusEl  = document.getElementById('settings-status');

  if (!gasUrl)   { showStatusEl(statusEl, 'GAS URLを入力してください', 'err'); return; }
  if (!sheetUrl) { showStatusEl(statusEl, 'スプレッドシートURLを入力してください', 'err'); return; }

  persistSettings(gasUrl, sheetUrl, sheetName);
  showStatusEl(statusEl, '設定を保存しました ✓', 'ok');
  updateHomeBanner();
}

async function settingsCreateSheet() {
  const gasUrl = document.getElementById('settings-gas-url').value.trim();
  if (!gasUrl) { showToast('先にGAS URLを入力してください'); return; }
  const btn = document.getElementById('btn-create-sheet');
  const statusEl = document.getElementById('create-sheet-status');
  btn.disabled = true;
  btn.textContent = '作成中...';
  try {
    const result = await callGas(gasUrl, { action: 'create_sheet' });
    const url = result.spreadsheetUrl;
    document.getElementById('settings-sheet-url').value = url;
    statusEl.innerHTML = `✅ 作成しました！<br><a href="${url}" target="_blank">スプレッドシートを開く →</a>`;
    statusEl.className = 'create-sheet-status ok';
  } catch(e) {
    statusEl.textContent = '❌ ' + e.message;
    statusEl.className = 'create-sheet-status err';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-create-icon">➕</span> 新規スプレッドシートを作成';
  }
}

function showStatusEl(el, msg, type) {
  el.textContent = msg;
  el.className = 'settings-status ' + type;
}

// ── Toast ────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

// ── Init ─────────────────────────────────────────────
function initApp() {
  const s = loadSettings();
  if (!s.setupDone) {
    showView('welcome');
  } else {
    updateHomeBanner();
    showView('home');
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
