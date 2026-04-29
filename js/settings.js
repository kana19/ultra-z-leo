/**
 * ウルトラZAIMUくん LEO版 PWA — settings.js
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
// storeType：源泉徴収機能の計算方式（hostess / standard / off）
// 顧客UIには出さず、納品時にターゲット社・パートナーがGASスプレッドシート直接編集で設定する
// localStorageにはGAS取得結果をキャッシュするが、ここから編集するUIは提供しない
const STORE_TYPE_KEY     = 'uz_store_type';

/* ── デフォルト値 ────────────────────────────────────────── */
const DEFAULT_STORE_NAME = 'スナック LEO';
const DEFAULT_STAFF = [
  { id: 1, name: 'さくら', employmentType: 'employed' },
  { id: 2, name: 'あかね', employmentType: 'employed' },
  { id: 3, name: 'みか',   employmentType: 'employed' },
  { id: 4, name: 'ゆき',   employmentType: 'employed' },
];
const DEFAULT_SERVICES = [
  { code: 'S001', name: '店内売上',     taxRate: 10 },
  { code: 'S002', name: 'テイクアウト', taxRate:  8 },
];
const MAX_SERVICES = 3;

/* ── パスワード関連ヘルパー（スタッフ枠パスワード）──────────────
 * 戦略思想§3-7「商売の都合優先」+ システム仕様書§10-3 準拠：
 *   - 日常打刻はワンタップ（パスワード入力なし）
 *   - パスワードはやめたスタッフのログイン防止・退職時の枠流用に使用
 *   - オーナーが settings 画面でスタッフ追加・パスワード変更を行う
 * 形式：5桁英数字（半角英大小文字＋数字）
 * ハッシュ：SHA-256・ソルトは staffId（管理ポータルのPINと同等の方式・技術仕様書§3-6）
 * 平文はクライアント・サーバいずれにも保持しない（送信もハッシュ済み）
 */
const STAFF_PW_PATTERN = /^[A-Za-z0-9]{5}$/;

/**
 * スタッフ枠パスワードのバリデーション
 * @param {string} pw
 * @returns {boolean} 5桁英数字に合致すれば true
 */
function validateStaffPassword(pw) {
  return typeof pw === 'string' && STAFF_PW_PATTERN.test(pw);
}

/**
 * スタッフ枠パスワードをハッシュ化（SHA-256・ソルトは staffId）
 * @param {number|string} staffId
 * @param {string} password
 * @returns {Promise<string>} 16進文字列のハッシュ値
 */
async function hashStaffPassword(staffId, password) {
  const salted  = `staff:${staffId}:${password}`;
  const encoded = new TextEncoder().encode(salted);
  const buf     = await crypto.subtle.digest('SHA-256', encoded);
  const bytes   = Array.from(new Uint8Array(buf));
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

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

/**
 * storeType取得（源泉徴収の計算方式）
 * 'hostess' : ホステス報酬特例計算
 * 'standard': 一般報酬計算
 * 'off'     : 源泉徴収機能OFF（UI表示なし）
 * デフォルトは 'off'（未設定時は機能を出さない安全側挙動）
 */
function getStoreType() {
  const raw = (localStorage.getItem(STORE_TYPE_KEY) || '').toLowerCase();
  if (raw === 'hostess' || raw === 'standard') return raw;
  return 'off';
}

function _saveStoreType(val) {
  const v = String(val || '').toLowerCase();
  const normalized = (v === 'hostess' || v === 'standard') ? v : 'off';
  localStorage.setItem(STORE_TYPE_KEY, normalized);
}

// cost.js から参照されるためグローバル公開
window.getStoreType = getStoreType;

/* ── GAS 同期 ────────────────────────────────────────────── */

/**
 * 起動時にGASからマスタ設定を取得し、localStorageとUIを更新する。
 * GAS失敗時はlocalStorageのデータをそのまま使用。
 */
async function loadSettingsFromGAS() {
  try {
    const res = await callGAS('getSettings', {});
    if (res && res.status === 'ok' && res.data) {
      const { storeName, staffList, serviceList, storeType } = res.data;
      if (storeName   != null) _saveStoreName(storeName);
      if (Array.isArray(staffList))   _saveStaffList(staffList);
      if (Array.isArray(serviceList)) _saveServiceList(serviceList);
      // storeType は納品時設定（顧客UIに出さない）。GASから取得して localStorage にキャッシュ
      if (storeType != null) _saveStoreType(storeType);
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
  // コスト科目マスタも並行取得
  loadCostMasterFromGAS();
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

/**
 * スタッフマスタのみをGASに保存（storeName / serviceListに影響しない）。
 */
async function saveStaffListToGAS() {
  try {
    await callGAS('saveStaffList', { staffList: getStaffList() });
  } catch {
    // localStorageには保存済みのため、GAS失敗はサイレントフェイル
  }
}

/* ── コスト科目マスタ GAS同期 ──────────────────────────── */
async function loadCostMasterFromGAS() {
  try {
    const res = await callGAS('getCostMaster', {});
    if (res && res.status === 'ok' && Array.isArray(res.data)) {
      saveCostMasterToStorage(res.data);
      renderCostMaster();
    }
  } catch { /* サイレントフェイル */ }
}

async function saveCostMasterToGAS(list) {
  try {
    await callGAS('saveCostMaster', { costMasterList: list });
  } catch { /* サイレントフェイル */ }
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
  initCostMaster();
  bindStoreSave();
  bindStaffAdd();
  bindServiceAdd();
  bindCostMasterSave();
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

  container.innerHTML = list.map(s => {
    const empType = s.employmentType || 'employed';
    const badge = empType === 'contractor'
      ? `<span class="staff-emp-badge staff-emp-badge--contractor">委託・外注</span>`
      : `<span class="staff-emp-badge staff-emp-badge--employed">雇用</span>`;
    return `
      <div class="staff-row" id="staff-row-${s.id}">
        <span class="staff-row__name">${escHtml(s.name)}</span>
        ${badge}
        <button class="staff-edit-btn"
                type="button"
                onclick="editStaff(${s.id})"
                aria-label="${escHtml(s.name)}を編集">
          編集
        </button>
        <button class="staff-delete-btn"
                type="button"
                onclick="deleteStaff(${s.id})"
                aria-label="${escHtml(s.name)}を削除">
          削除
        </button>
      </div>
    `;
  }).join('');
}

function editStaff(id) {
  const list  = getStaffList();
  const staff = list.find(s => s.id === id);
  if (!staff) return;

  const row = document.getElementById(`staff-row-${id}`);
  if (!row) return;

  const empType = staff.employmentType || 'employed';
  row.innerHTML = `
    <input type="text"
           id="staff-edit-name-${id}"
           class="settings-input"
           style="flex:1;min-width:80px;height:40px;font-size:14px;"
           value="${escHtml(staff.name)}"
           maxlength="20"
           autocomplete="off"
           aria-label="スタッフ名">
    <select id="staff-edit-emp-${id}"
            class="form-select"
            style="height:40px;font-size:13px;flex-shrink:0;"
            aria-label="雇用形態">
      <option value="employed"${empType === 'employed' ? ' selected' : ''}>雇用</option>
      <option value="contractor"${empType === 'contractor' ? ' selected' : ''}>委託・外注</option>
    </select>
    <input type="text"
           id="staff-edit-password-${id}"
           class="settings-input"
           style="flex:1;min-width:120px;height:40px;font-size:14px;"
           placeholder="パスワード変更（任意・5桁英数字）"
           maxlength="5"
           autocomplete="off"
           aria-label="パスワード変更">
    <button class="staff-save-btn"
            type="button"
            onclick="saveEditStaff(${id})"
            aria-label="保存">
      保存
    </button>
    <button class="staff-cancel-btn"
            type="button"
            onclick="renderStaffList()"
            aria-label="キャンセル">
      キャンセル
    </button>
  `;
  document.getElementById(`staff-edit-name-${id}`)?.focus();
}

async function saveEditStaff(id) {
  const nameEl = document.getElementById(`staff-edit-name-${id}`);
  const empEl  = document.getElementById(`staff-edit-emp-${id}`);
  const pwEl   = document.getElementById(`staff-edit-password-${id}`);
  if (!nameEl || !empEl) return;

  const name = nameEl.value.trim();
  if (!name) return showToast('スタッフ名を入力してください', 'error');

  const list = getStaffList();
  if (list.some(s => s.id !== id && s.name === name)) {
    return showToast('同じ名前のスタッフが既に登録されています', 'error');
  }

  // パスワード変更（任意・空欄なら既存の passwordHash を維持）
  const pwInput = pwEl ? pwEl.value.trim() : '';
  let passwordUpdate = null;
  if (pwInput) {
    if (!validateStaffPassword(pwInput)) {
      return showToast('パスワードは5桁の半角英数字で入力してください', 'error');
    }
    const passwordHash = await hashStaffPassword(id, pwInput);
    passwordUpdate = {
      passwordHash,
      passwordUpdatedAt: new Date().toISOString(),
    };
  }

  const newList = list.map(s =>
    s.id === id
      ? { ...s, name, employmentType: empEl.value, ...(passwordUpdate || {}) }
      : s
  );
  _saveStaffList(newList);
  renderStaffList();
  const msg = passwordUpdate
    ? `${name}を更新しました（パスワード変更含む）✓`
    : `${name}を更新しました ✓`;
  showToast(msg, 'success');
  saveStaffListToGAS();
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
  saveStaffListToGAS();
}

function bindStaffAdd() {
  const btn       = document.getElementById('staff-add-btn');
  const input     = document.getElementById('staff-add-input');
  const empSelect = document.getElementById('staff-add-emp');
  const pwInput   = document.getElementById('staff-add-password');
  if (!btn || !input) return;

  const doAdd = async () => {
    const name = input.value.trim();
    if (!name) return showToast('スタッフ名を入力してください', 'error');

    // パスワードバリデーション（5桁英数字必須）
    const password = pwInput ? pwInput.value.trim() : '';
    if (!validateStaffPassword(password)) {
      return showToast('パスワードは5桁の半角英数字で入力してください', 'error');
    }

    const list = getStaffList();

    if (list.some(s => s.name === name)) {
      return showToast('同じ名前のスタッフが既に登録されています', 'error');
    }

    const maxId         = list.length > 0 ? Math.max(...list.map(s => s.id)) : 0;
    const newId         = maxId + 1;
    const employmentType = empSelect ? empSelect.value : 'employed';
    const passwordHash  = await hashStaffPassword(newId, password);
    const passwordUpdatedAt = new Date().toISOString();
    const newList       = [...list, {
      id: newId,
      name,
      employmentType,
      passwordHash,
      passwordUpdatedAt,
    }];
    _saveStaffList(newList);

    input.value = '';
    if (empSelect) empSelect.value = 'employed';
    if (pwInput) pwInput.value = '';
    renderStaffList();
    showToast(`${name}を追加しました ✓`, 'success');
    saveStaffListToGAS();
  };

  btn.addEventListener('click', doAdd);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  if (pwInput) {
    pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  }
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

/* ── コスト科目マスタ UI ─────────────────────────────────── */
function initCostMaster() {
  renderCostMaster();
}

function renderCostMaster() {
  const container = document.getElementById('cost-master-container');
  if (!container) return;

  const master = getCostMaster();

  const TAX_OPTIONS = [
    { value: 10, label: '10%'       },
    { value:  8, label: '8%（軽減）' },
    { value:  0, label: '0%（非課税）' },
  ];

  function taxSelect(id, current) {
    const opts = TAX_OPTIONS.map(o =>
      `<option value="${o.value}"${o.value === current ? ' selected' : ''}>${o.label}</option>`
    ).join('');
    return `<select id="${id}" class="form-select" style="width:120px;height:36px;font-size:13px;">${opts}</select>`;
  }

  // 仕入原価
  const costItems   = master.filter(i => i.divisionCode === '1');
  // 販管費 固定
  const fixedItems  = master.filter(i => i.divisionCode === '2' && i.type === 'fixed');
  // 販管費 任意（行26〜30）
  const customItems = master.filter(i => i.divisionCode === '2' && i.type === 'custom');

  function fixedRow(item) {
    const rowLabel = item.taxRow ? `行${item.taxRow}　` : '';
    return `
      <div class="staff-row" style="align-items:center;gap:8px;flex-wrap:wrap;">
        <span class="staff-row__name" style="flex:1;min-width:120px;font-size:13px;">
          ${rowLabel}${escHtml(item.name)}
        </span>
        ${taxSelect(`cm-tax-${item.code}`, item.taxRate)}
      </div>`;
  }

  function customRow(item) {
    return `
      <div class="staff-row" style="align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-size:12px;color:var(--uz-muted);min-width:32px;flex-shrink:0;">行${item.taxRow}</span>
        <input type="text"
               id="cm-name-${item.code}"
               class="settings-input"
               style="flex:1;min-width:100px;height:36px;font-size:13px;"
               placeholder="任意科目名（空欄で非表示）"
               maxlength="20"
               autocomplete="off"
               value="${escHtml(item.name)}">
        ${taxSelect(`cm-tax-${item.code}`, item.taxRate)}
      </div>`;
  }

  let html = '';

  html += `<div style="padding:8px 16px 4px;font-size:12px;font-weight:700;color:var(--uz-muted);">▸ 仕入原価</div>`;
  html += costItems.map(fixedRow).join('');

  html += `<div style="padding:12px 16px 4px;font-size:12px;font-weight:700;color:var(--uz-muted);">▸ 販管費（固定科目）</div>`;
  html += fixedItems.map(fixedRow).join('');

  html += `<div style="padding:12px 16px 4px;font-size:12px;font-weight:700;color:var(--uz-muted);">▸ 販管費（任意科目 行26〜30）</div>`;
  html += customItems.map(customRow).join('');

  html += `
    <div style="padding:8px 16px 10px;">
      <p style="font-size:12px;color:var(--uz-muted);line-height:1.6;">
        固定科目は名称変更不可・税率のみ変更可。<br>
        任意科目は科目名を入力すると有効になります。<br>
        行番号は確定申告書（収支内訳書）の行番号に対応しています。
      </p>
    </div>`;

  container.innerHTML = html;
}

function bindCostMasterSave() {
  document.getElementById('cost-master-save-btn')?.addEventListener('click', () => {
    const master = getCostMaster();

    const updated = master.map(item => {
      const taxEl  = document.getElementById(`cm-tax-${item.code}`);
      const nameEl = document.getElementById(`cm-name-${item.code}`);

      const taxRate = taxEl ? parseInt(taxEl.value) : item.taxRate;
      const name    = item.type === 'custom' && nameEl
        ? nameEl.value.trim()
        : item.name;

      return { ...item, name, taxRate };
    });

    saveCostMasterToStorage(updated);
    showToast('科目マスタを保存しました ✓', 'success');
    renderCostMaster();
    saveCostMasterToGAS(updated);
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

/* ══════════════════════════════════════════════════════════
   iPad 設定アコーディオン
   ══════════════════════════════════════════════════════════ */

/**
 * 設定セクションアコーディオン切り替え
 * @param {HTMLButtonElement} btn - .settings-accordion-btn
 */
function toggleSettingsAccordion(btn) {
  // iPad以外はアコーディオン不使用（非iPadでは常時展開）
  if (!document.body.classList.contains('is-ipad')) return;

  const bodyId = btn.getAttribute('aria-controls');
  const bodyEl = document.getElementById(bodyId);
  if (!bodyEl) return;

  const isExpanded = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', String(!isExpanded));
  if (isExpanded) {
    bodyEl.setAttribute('hidden', '');
  } else {
    bodyEl.removeAttribute('hidden');
  }
}

// iPad初期状態：補助金・GAS・アプリ情報は折りたたむ
document.addEventListener('DOMContentLoaded', () => {
  if (!document.body.classList.contains('is-ipad')) return;
  ['sec-subsidy-body', 'sec-gas-body', 'sec-info-body'].forEach(id => {
    const bodyEl = document.getElementById(id);
    if (bodyEl) bodyEl.setAttribute('hidden', '');
    const btn = document.querySelector(`[aria-controls="${id}"]`);
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
});
