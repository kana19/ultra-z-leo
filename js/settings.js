/**
 * ウルトラ財務くん LEO版 PWA — settings.js
 * 設定画面ロジック（localStorageで永続化）
 */

'use strict';

/* ── ストレージキー ──────────────────────────────────────── */
const STORE_NAME_KEY   = 'uz_store_name';
const STAFF_MASTER_KEY = 'uz_staff_master';
const SERVICE_MASTER_KEY = 'uz_service_master';

/* ── デフォルト値 ────────────────────────────────────────── */
const DEFAULT_STORE_NAME = 'スナック LEO';
const DEFAULT_STAFF = [
  { id: 1, name: 'さくら' },
  { id: 2, name: 'あかね' },
  { id: 3, name: 'みか'   },
  { id: 4, name: 'ゆき'   },
];

// 諸口は常に自動付与のため設定不要（sales.jsと一致させること）
const DEFAULT_SERVICES = [
  { code: 'S001', name: '店内売上',     taxRate: 10 },
  { code: 'S002', name: 'テイクアウト', taxRate:  8 },
];
const MAX_SERVICES = 3; // 諸口を除く最大登録数

/* ── ストア名 ────────────────────────────────────────────── */
function getStoreName() {
  return localStorage.getItem(STORE_NAME_KEY) || DEFAULT_STORE_NAME;
}

function saveStoreName(name) {
  const trimmed = name.trim();
  if (!trimmed) return false;
  localStorage.setItem(STORE_NAME_KEY, trimmed);
  return true;
}

/* ── スタッフマスタ ──────────────────────────────────────── */
function getStaffList() {
  try {
    const saved = localStorage.getItem(STAFF_MASTER_KEY);
    return saved ? JSON.parse(saved) : [...DEFAULT_STAFF];
  } catch { return [...DEFAULT_STAFF]; }
}

function saveStaffList(list) {
  localStorage.setItem(STAFF_MASTER_KEY, JSON.stringify(list));
}

function generateStaffId(list) {
  return list.length > 0 ? Math.max(...list.map(s => s.id)) + 1 : 1;
}

/* ── サービスマスタ ──────────────────────────────────────── */
function getServiceList() {
  try {
    const saved = localStorage.getItem(SERVICE_MASTER_KEY);
    return saved ? JSON.parse(saved) : [...DEFAULT_SERVICES];
  } catch { return [...DEFAULT_SERVICES]; }
}

function saveServiceList(list) {
  localStorage.setItem(SERVICE_MASTER_KEY, JSON.stringify(list));
}

function generateServiceCode(list) {
  const nums = list
    .map(s => parseInt(s.code.replace('S', '')))
    .filter(n => !isNaN(n) && n < 99); // S099（諸口）は除外
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `S${String(max + 1).padStart(3, '0')}`;
}

/* ── 初期化 ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initStoreName();
  initStaffList();
  initServiceList();
  bindStoreSave();
  bindStaffAdd();
  bindServiceAdd();
});

/* ── 店舗名初期化 ────────────────────────────────────────── */
function initStoreName() {
  const input = document.getElementById('store-name-input');
  if (input) input.value = getStoreName();
}

/* ── 店舗名保存バインド ──────────────────────────────────── */
function bindStoreSave() {
  document.getElementById('store-name-save')?.addEventListener('click', () => {
    const input = document.getElementById('store-name-input');
    const name  = input?.value || '';

    if (!name.trim()) {
      return showToast('店舗名を入力してください', 'error');
    }

    saveStoreName(name.trim());
    showToast('店舗名を保存しました ✓', 'success');
  });
}

/* ── スタッフ一覧描画 ────────────────────────────────────── */
function initStaffList() {
  renderStaffList();
}

function renderStaffList() {
  const container = document.getElementById('staff-list-container');
  if (!container) return;

  const list = getStaffList();

  if (list.length === 0) {
    container.innerHTML = `
      <div style="padding:16px;color:var(--uz-muted);font-size:13px;text-align:center;">
        スタッフが登録されていません
      </div>`;
    return;
  }

  container.innerHTML = list.map(s => `
    <div class="staff-row" id="staff-row-${s.id}">
      <span class="staff-row__name">${escHtml(s.name)}</span>
      <button class="staff-delete-btn"
              type="button"
              onclick="deleteStaff(${s.id})"
              aria-label="${escHtml(s.name)}を削除">
        削除
      </button>
    </div>
  `).join('');
}

/* ── スタッフ削除 ────────────────────────────────────────── */
function deleteStaff(id) {
  const list   = getStaffList();
  const target = list.find(s => s.id === id);
  if (!target) return;

  if (!confirm(`「${target.name}」を削除しますか？\n入退店の記録済みデータには影響しません。`)) return;

  saveStaffList(list.filter(s => s.id !== id));
  renderStaffList();
  showToast(`${target.name}を削除しました`, 'success');
}

/* ── スタッフ追加バインド ────────────────────────────────── */
function bindStaffAdd() {
  const btn   = document.getElementById('staff-add-btn');
  const input = document.getElementById('staff-add-input');
  if (!btn || !input) return;

  const doAdd = () => {
    const name = input.value.trim();
    if (!name) return showToast('スタッフ名を入力してください', 'error');

    const list = getStaffList();

    // 重複チェック
    if (list.some(s => s.name === name)) {
      return showToast('同じ名前のスタッフが既に登録されています', 'error');
    }

    const newStaff = { id: generateStaffId(list), name };
    list.push(newStaff);
    saveStaffList(list);

    input.value = '';
    renderStaffList();
    showToast(`${name}を追加しました ✓`, 'success');
  };

  btn.addEventListener('click', doAdd);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') doAdd();
  });
}

/* ── サービス一覧描画 ────────────────────────────────────── */
function initServiceList() {
  renderServiceList();
}

function renderServiceList() {
  const container = document.getElementById('service-list-container');
  if (!container) return;

  const list = getServiceList();

  let html = list.map(s => `
    <div class="staff-row" id="service-row-${escHtml(s.code)}">
      <span class="staff-row__name">${escHtml(s.name)}</span>
      <span class="service-tax-badge">税率 ${s.taxRate}%</span>
      <button class="staff-delete-btn"
              type="button"
              onclick="deleteService('${escHtml(s.code)}')"
              aria-label="${escHtml(s.name)}を削除">削除</button>
    </div>
  `).join('');

  // 諸口は固定表示（削除不可）
  html += `
    <div class="staff-row" style="opacity:0.5;">
      <span class="staff-row__name">諸口</span>
      <span class="service-tax-badge">税率 10%</span>
      <span style="font-size:12px;color:var(--uz-muted);padding:0 4px;">固定</span>
    </div>`;

  container.innerHTML = html;

  // 上限に達したら追加フォームを非表示
  const addRow = document.getElementById('service-add-row');
  if (addRow) {
    const atMax = list.length >= MAX_SERVICES;
    addRow.hidden = atMax;
    const hint = document.getElementById('service-limit-hint');
    if (hint) hint.hidden = !atMax;
  }
}

/* ── サービス削除 ────────────────────────────────────────── */
function deleteService(code) {
  const list   = getServiceList();
  const target = list.find(s => s.code === code);
  if (!target) return;

  if (list.length <= 1) {
    return showToast('最低1種のサービスが必要です', 'error');
  }

  if (!confirm(`「${target.name}」を削除しますか？\n登録済みの売上データには影響しません。`)) return;

  saveServiceList(list.filter(s => s.code !== code));
  renderServiceList();
  showToast(`${target.name}を削除しました`, 'success');
}

/* ── サービス追加バインド ────────────────────────────────── */
function bindServiceAdd() {
  const btn       = document.getElementById('service-add-btn');
  const nameInput = document.getElementById('service-add-name');
  const taxSelect = document.getElementById('service-add-tax');
  if (!btn || !nameInput || !taxSelect) return;

  const doAdd = () => {
    const name    = nameInput.value.trim();
    const taxRate = parseInt(taxSelect.value);

    if (!name) return showToast('サービス名を入力してください', 'error');

    const list = getServiceList();

    if (list.length >= MAX_SERVICES) {
      return showToast(`サービスは最大${MAX_SERVICES}種まで登録できます`, 'error');
    }
    if (list.some(s => s.name === name)) {
      return showToast('同じ名前のサービスが既に登録されています', 'error');
    }

    const newService = { code: generateServiceCode(list), name, taxRate };
    list.push(newService);
    saveServiceList(list);

    nameInput.value  = '';
    taxSelect.value  = '10';
    renderServiceList();
    showToast(`${name}を追加しました ✓`, 'success');
  };

  btn.addEventListener('click', doAdd);
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') doAdd();
  });
}

/* ── XSSエスケープ ───────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
