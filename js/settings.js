/**
 * ウルトラ財務くん LEO版 PWA — settings.js
 * 設定画面ロジック（localStorage + GAS双方向同期版）
 *
 * 起動時: GAS getSettings → localStorage上書き → UI描画
 * 変更時: localStorage即時保存 → GAS saveSettings（バックグラウンド）
 */

'use strict';

/* ── ストレージキー ──────────────────────────────────────── */
const STORE_NAME_KEY     = 'uz_store_name';
const STAFF_MASTER_KEY   = 'uz_staff_master';
const SERVICE_MASTER_KEY = 'uz_service_master';

/* ── デフォルト値 ────────────────────────────────────────── */
const DEFAULT_STORE_NAME = 'スナック LEO';
const DEFAULT_STAFF = [
  { id: 1, name: 'さくら' },
  { id: 2, name: 'あかね' },
  { id: 3, name: 'みか'   },
  { id: 4, name: 'ゆき'   },
];
const DEFAULT_SERVICES = [
  { code: 'S001', name: '店内売上',     taxRate: 10 },
  { code: 'S002', name: 'テイクアウト', taxRate:  8 },
];
const MAX_SERVICES = 3;

/* ── localStorage アクセサ ───────────────────────────────── */
function getStoreName() {
  return localStorage.getItem(STORE_NAME_KEY) || DEFAULT_STORE_NAME;
}

function _saveStoreName(name) {
  localStorage.setItem(STORE_NAME_KEY, name);
}

function getStaffList() {
  try {
    const saved = localStorage.getItem(STAFF_MASTER_KEY);
    return saved ? JSON.parse(saved) : [...DEFAULT_STAFF];
  } catch { return [...DEFAULT_STAFF]; }
}

function _saveStaffList(list) {
  localStorage.setItem(STAFF_MASTER_KEY, JSON.stringify(list));
}

function getServiceList() {
  try {
    const saved = localStorage.getItem(SERVICE_MASTER_KEY);
    return saved ? JSON.parse(saved) : [...DEFAULT_SERVICES];
  } catch { return [...DEFAULT_SERVICES]; }
}

function _saveServiceList(list) {
  localStorage.setItem(SERVICE_MASTER_KEY, JSON.stringify(list));
}

/* ── GAS 同期 ────────────────────────────────────────────── */

/**
 * 起動時にGASからマスタ設定を取得し、localStorageとUIを更新する。
 * GAS失敗時はlocalStorageのデータをそのまま使用。
 */
async function loadSettingsFromGAS() {
  try {
    const res = await callGAS('getSettings', {});
    if (res && res.status === 'ok' && res.data) {
      const { storeName, staffList, serviceList } = res.data;
      if (storeName   != null) _saveStoreName(storeName);
      if (Array.isArray(staffList))   _saveStaffList(staffList);
      if (Array.isArray(serviceList)) _saveServiceList(serviceList);
      // UIを最新データで再描画
      initStoreName();
      renderStaffList();
      renderServiceList();
      updateGasStatus(true);
    } else {
      updateGasStatus(false);
    }
  } catch {
    updateGasStatus(false);
  }
}

/**
 * 現在のlocalStorage全設定をGASに保存（バックグラウンド・失敗はサイレント）。
 */
async function saveSettingsToGAS() {
  try {
    await callGAS('saveSettings', {
      storeName:   getStoreName(),
      staffList:   getStaffList(),
      serviceList: getServiceList(),
    });
  } catch {
    // localStorageには保存済みのため、GAS失敗はサイレントフェイル
  }
}

function updateGasStatus(connected) {
  const el = document.getElementById('gas-status-val');
  if (!el) return;
  if (connected) {
    el.textContent = '接続済み ✓';
    el.style.color = 'var(--uz-green)';
  } else {
    el.textContent = '未接続（ローカル保存）';
    el.style.color = 'var(--uz-muted)';
  }
}

/* ── 初期化 ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // まずlocalStorageで即時描画
  initStoreName();
  initStaffList();
  initServiceList();
  bindStoreSave();
  bindStaffAdd();
  bindServiceAdd();
  // GASから最新データを取得して上書き
  loadSettingsFromGAS();
});

/* ── 店舗名 ──────────────────────────────────────────────── */
function initStoreName() {
  const input = document.getElementById('store-name-input');
  if (input) input.value = getStoreName();
}

function bindStoreSave() {
  document.getElementById('store-name-save')?.addEventListener('click', () => {
    const input = document.getElementById('store-name-input');
    const name  = input?.value.trim() || '';

    if (!name) return showToast('店舗名を入力してください', 'error');

    _saveStoreName(name);
    showToast('店舗名を保存しました ✓', 'success');
    saveSettingsToGAS();
  });
}

/* ── スタッフマスタ ──────────────────────────────────────── */
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

function deleteStaff(id) {
  const list   = getStaffList();
  const target = list.find(s => s.id === id);
  if (!target) return;

  if (!confirm(`「${target.name}」を削除しますか？\n入退店の記録済みデータには影響しません。`)) return;

  const newList = list.filter(s => s.id !== id);
  _saveStaffList(newList);
  renderStaffList();
  showToast(`${target.name}を削除しました`, 'success');
  saveSettingsToGAS();
}

function bindStaffAdd() {
  const btn   = document.getElementById('staff-add-btn');
  const input = document.getElementById('staff-add-input');
  if (!btn || !input) return;

  const doAdd = () => {
    const name = input.value.trim();
    if (!name) return showToast('スタッフ名を入力してください', 'error');

    const list = getStaffList();

    if (list.some(s => s.name === name)) {
      return showToast('同じ名前のスタッフが既に登録されています', 'error');
    }

    const maxId  = list.length > 0 ? Math.max(...list.map(s => s.id)) : 0;
    const newList = [...list, { id: maxId + 1, name }];
    _saveStaffList(newList);

    input.value = '';
    renderStaffList();
    showToast(`${name}を追加しました ✓`, 'success');
    saveSettingsToGAS();
  };

  btn.addEventListener('click', doAdd);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
}

/* ── サービスマスタ ──────────────────────────────────────── */
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

  html += `
    <div class="staff-row" style="opacity:0.5;">
      <span class="staff-row__name">諸口</span>
      <span class="service-tax-badge">税率 10%</span>
      <span style="font-size:12px;color:var(--uz-muted);padding:0 4px;">固定</span>
    </div>`;

  container.innerHTML = html;

  const addRow = document.getElementById('service-add-row');
  const hint   = document.getElementById('service-limit-hint');
  const atMax  = list.length >= MAX_SERVICES;
  if (addRow) addRow.hidden = atMax;
  if (hint)   hint.hidden   = !atMax;
}

function deleteService(code) {
  const list   = getServiceList();
  const target = list.find(s => s.code === code);
  if (!target) return;

  if (list.length <= 1) return showToast('最低1種のサービスが必要です', 'error');

  if (!confirm(`「${target.name}」を削除しますか？\n登録済みの売上データには影響しません。`)) return;

  const newList = list.filter(s => s.code !== code);
  _saveServiceList(newList);
  renderServiceList();
  showToast(`${target.name}を削除しました`, 'success');
  saveSettingsToGAS();
}

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

    const nums = list
      .map(s => parseInt(s.code.replace('S', '')))
      .filter(n => !isNaN(n) && n < 99);
    const nextNum = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    const code    = `S${String(nextNum).padStart(3, '0')}`;

    const newList = [...list, { code, name, taxRate }];
    _saveServiceList(newList);

    nameInput.value = '';
    taxSelect.value = '10';
    renderServiceList();
    showToast(`${name}を追加しました ✓`, 'success');
    saveSettingsToGAS();
  };

  btn.addEventListener('click', doAdd);
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
}

/* ── XSSエスケープ ───────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
