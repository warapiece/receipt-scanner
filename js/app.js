// ── State ──────────────────────────────────────────────
let _currentMode = 'beginner'; // 'beginner' | 'pro'
let _sheetUrlCache = '';

// ── Settings ────────────────────────────────────────────
function loadSettings() {
  return {
    gasUrl:   localStorage.getItem('gasUrl')   || '',
    sheetUrl: localStorage.getItem('sheetUrl') || '',
    sheetName:localStorage.getItem('sheetName')|| '',
  };
}

function persistSettings(gasUrl, sheetUrl, sheetName) {
  localStorage.setItem('gasUrl',    gasUrl);
  localStorage.setItem('sheetUrl',  sheetUrl);
  localStorage.setItem('sheetName', sheetName);
}

// ── View Router ─────────────────────────────────────────
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + id).classList.add('active');
  window.scrollTo(0, 0);
}

function showHome() {
  const s = loadSettings();
  const banner = document.getElementById('setup-banner');
  banner.style.display = (!s.gasUrl || !s.sheetUrl) ? '' : 'none';
  showView('home');
}

function showSettings() {
  const s = loadSettings();
  document.getElementById('s-gas').value   = s.gasUrl;
  document.getElementById('s-sheet').value = s.sheetUrl;
  document.getElementById('s-name').value  = s.sheetName;
  document.getElementById('save-status').className   = 'save-status';
  document.getElementById('create-status').className = 'create-status';
  document.getElementById('create-status').textContent = '';
  showView('settings');
}

// ── Mode Toggle ─────────────────────────────────────────
function setMode(mode) {
  _currentMode = mode;
  localStorage.setItem('mode', mode);

  document.getElementById('mode-btn-beginner').classList.toggle('active', mode === 'beginner');
  document.getElementById('mode-btn-pro').classList.toggle('active', mode === 'pro');
  document.getElementById('home-beginner').style.display = mode === 'beginner' ? '' : 'none';
  document.getElementById('home-pro').style.display      = mode === 'pro'      ? '' : 'none';
}

// ── Camera / File ────────────────────────────────────────
function triggerCapture() {
  const s = loadSettings();
  if (!s.gasUrl || !s.sheetUrl) {
    showToast('先に設定を完了してください');
    showSettings();
    return;
  }
  document.getElementById('file-input').click();
}

function handleFile(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  const s = loadSettings();
  if (!s.gasUrl || !s.sheetUrl) { showSettings(); return; }
  _sheetUrlCache = s.sheetUrl;

  showView('processing');

  compressImage(file, 1200)
    .then(b64 => callGas(s.gasUrl, { action: 'ocr', image: b64 }))
    .then(data => {
      renderReview(data);
      showView(_currentMode === 'pro' ? 'review-pro' : 'review-beginner');
    })
    .catch(err => {
      showHome();
      showToast('読み取り失敗: ' + err.message);
    });
}

// ── Image Compression ─────────────────────────────────────
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

// ── GAS API ───────────────────────────────────────────────
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

// ── Review ────────────────────────────────────────────────
function renderReview(data) {
  // Beginner fields
  document.getElementById('b-date').value     = data.date  || '';
  document.getElementById('b-store').value    = data.store || '';
  document.getElementById('b-category').value = '';
  document.getElementById('b-total').value    = data.total || '';

  // Pro fields
  document.getElementById('p-date').value     = data.date  || '';
  document.getElementById('p-store').value    = data.store || '';
  document.getElementById('p-category').value = '';
  document.getElementById('p-total').value    = data.total || '';

  const list = document.getElementById('items-list');
  list.innerHTML = '';
  const items = data.items || [];
  document.getElementById('item-count').textContent = items.length + '件';
  items.forEach(item => list.appendChild(createItemRow(item.name, item.price)));
}

function createItemRow(name, price) {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <input class="item-name"  type="text"   value="${escHtml(name)}" placeholder="商品名">
    <span  class="item-yen">¥</span>
    <input class="item-price" type="number" value="${price || ''}" inputmode="numeric">
    <button class="item-del" onclick="deleteItem(this)">×</button>
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
    document.getElementById('p-total').value = sum;
    showToast('品目の合計から再計算しました');
  } else {
    showToast('品目が空のため計算できません');
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Save to Sheet ─────────────────────────────────────────
async function saveToSheet(mode) {
  const s = loadSettings();
  const prefix   = mode === 'pro' ? 'p' : 'b';
  const date     = document.getElementById(prefix + '-date').value.trim();
  const store    = document.getElementById(prefix + '-store').value.trim();
  const category = document.getElementById(prefix + '-category').value;
  const total    = Number(document.getElementById(prefix + '-total').value);

  if (!category) { showToast('内容を選択してください'); return; }
  if (!total || isNaN(total)) { showToast('金額を入力してください'); return; }

  const viewId = mode === 'pro' ? 'view-review-pro' : 'view-review-beginner';
  const btn = document.querySelector('#' + viewId + ' .btn-record');
  btn.disabled = true;
  btn.textContent = '保存中...';

  try {
    await callGas(s.gasUrl, {
      action: 'save',
      spreadsheetUrl: s.sheetUrl,
      sheetName: s.sheetName,
      date, store, category, total,
    });

    document.getElementById('success-card').innerHTML = `
      <div class="s-date">${date || '日付不明'}</div>
      <div class="s-store">${store || '店舗名不明'}</div>
      <div class="s-category">${category || ''}</div>
      <div class="s-total">¥${total.toLocaleString()}</div>
    `;
    const link = document.getElementById('sheet-link');
    const url = _sheetUrlCache || s.sheetUrl;
    link.href = url || '#';
    link.style.display = url ? '' : 'none';
    showView('success');
  } catch(e) {
    showToast('保存失敗: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = mode === 'pro' ? 'スプレッドシートに記録する' : '記録する';
  }
}

// ── Settings Screen ───────────────────────────────────────
function saveSettings() {
  const gasUrl    = document.getElementById('s-gas').value.trim();
  const sheetUrl  = document.getElementById('s-sheet').value.trim();
  const sheetName = document.getElementById('s-name').value.trim();
  const statusEl  = document.getElementById('save-status');

  if (!gasUrl)   { showSaveStatus(statusEl, 'GAS URLを入力してください', 'err'); return; }
  if (!sheetUrl) { showSaveStatus(statusEl, 'スプレッドシートURLを入力してください', 'err'); return; }

  persistSettings(gasUrl, sheetUrl, sheetName);
  showSaveStatus(statusEl, '設定を保存しました ✓', 'ok');

  // Update banner
  const banner = document.getElementById('setup-banner');
  banner.style.display = 'none';
}

function showSaveStatus(el, msg, type) {
  el.textContent = msg;
  el.className = 'save-status ' + type;
}

async function createSheet() {
  const gasUrl = document.getElementById('s-gas').value.trim();
  if (!gasUrl) { showToast('先にGAS URLを入力してください'); return; }

  const btn = document.getElementById('btn-create');
  const statusEl = document.getElementById('create-status');
  btn.disabled = true;
  btn.textContent = '作成中...';

  try {
    const result = await callGas(gasUrl, { action: 'create_sheet' });
    const url = result.spreadsheetUrl;
    document.getElementById('s-sheet').value = url;
    statusEl.innerHTML = `✅ 作成しました！<br><a href="${url}" target="_blank" style="color:var(--success)">スプレッドシートを開く →</a>`;
    statusEl.className = 'create-status ok';
  } catch(e) {
    statusEl.textContent = '❌ ' + e.message;
    statusEl.className = 'create-status err';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '➕ 新規作成する';
  }
}

// ── Toast ─────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

// ── Init ──────────────────────────────────────────────────
function initApp() {
  const savedMode = localStorage.getItem('mode') || 'beginner';
  setMode(savedMode);
  showHome();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
