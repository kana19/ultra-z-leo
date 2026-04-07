/**
 * ウルトラ財務くん LEO版 PWA — history.js
 * 履歴・修正画面ロジック
 *
 * タブ1：売上・コスト（getHistory）
 *   ※ GAS側で以下のフィールドを含めてください：
 *   { type, rowIndex, date, serviceCode?, divisionCode?, divisionName?, itemCode?,
 *     itemName, taxRate, amount(=taxIncluded), memo, uncollected?(売上) / unpaid?(コスト) }
 *
 * タブ2：入店履歴（getAttendanceByMonth）
 *   ※ GAS側で rowIndex を含めてください：
 *   { rowIndex, date, staffId, staffName, clockIn, clockOut }
 */

'use strict';

/* ── 定数 ────────────────────────────────────────────────── */
const _now       = new Date();
const THIS_YEAR  = _now.getFullYear();
const THIS_MONTH = _now.getMonth() + 1;
const MIN_YEAR   = 2025;

/* ── 状態 ────────────────────────────────────────────────── */
let currentYear  = THIS_YEAR;
let currentMonth = THIS_MONTH;
let activeTab    = 'salescost';

// 修正フォーム用キャッシュ（renderのたびに再構築）
let editableItems = []; // 売上・コスト行
let attendItems   = []; // 入店履歴行

// 修正フォームの状態
let currentEditItem = null;
let isEditSaving    = false;

/* ── 初期化 ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  bindTabs();
  bindNav();
  bindEditPanel();
  bindListClicks(); // 委譲リスナーは1回だけ登録
  loadAll();
});

/* ── タブ切り替え ────────────────────────────────────────── */
function bindTabs() {
  document.getElementById('tab-salescost')?.addEventListener('click',  () => switchTab('salescost'));
  document.getElementById('tab-attendance')?.addEventListener('click', () => switchTab('attendance'));
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.hist-tab').forEach(btn => {
    const on = btn.id === `tab-${tab}`;
    btn.classList.toggle('hist-tab--active', on);
    btn.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('.hist-tab-content').forEach(panel => {
    panel.classList.toggle('hist-tab-content--active', panel.id === `panel-${tab}`);
  });
}

/* ── 月ナビゲーション ────────────────────────────────────── */
function bindNav() {
  document.getElementById('hist-prev')?.addEventListener('click', () => moveMonth(-1));
  document.getElementById('hist-next')?.addEventListener('click', () => moveMonth(+1));
}

function moveMonth(dir) {
  let m = currentMonth + dir;
  let y = currentYear;
  if (m < 1)  { y--; m = 12; }
  if (m > 12) { y++; m = 1;  }
  if (y < MIN_YEAR) return;
  if (y > THIS_YEAR || (y === THIS_YEAR && m > THIS_MONTH)) return;
  currentYear  = y;
  currentMonth = m;
  loadAll();
}

function updateNavUI() {
  const labelEl = document.getElementById('hist-label');
  if (labelEl) labelEl.textContent = `${currentYear}年${currentMonth}月`;
  const isMin = currentYear === MIN_YEAR  && currentMonth === 1;
  const isMax = currentYear === THIS_YEAR && currentMonth === THIS_MONTH;
  if (document.getElementById('hist-prev')) document.getElementById('hist-prev').disabled = isMin;
  if (document.getElementById('hist-next')) document.getElementById('hist-next').disabled = isMax;
}

/* ── GASからデータ取得 ───────────────────────────────────── */
async function loadAll() {
  updateNavUI();
  showLoading();
  editableItems = [];
  attendItems   = [];

  const monthParam = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

  try {
    const [histResult, attendResult] = await Promise.allSettled([
      callGAS('getHistory',           { month: monthParam }),
      callGAS('getAttendanceByMonth', { month: monthParam }),
    ]);

    if (histResult.status === 'fulfilled' &&
        histResult.value?.status === 'ok' &&
        Array.isArray(histResult.value.data)) {
      renderSalesCost(histResult.value.data);
    } else {
      renderSalesCostError();
    }

    if (attendResult.status === 'fulfilled' &&
        attendResult.value?.status === 'ok' &&
        Array.isArray(attendResult.value.data)) {
      renderAttendance(attendResult.value.data);
    } else {
      renderAttendanceError();
    }

  } catch (e) {
    renderSalesCostError();
    renderAttendanceError();
    showToast('GAS接続エラー：' + e.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ══════════════════════════════════════════════════════════
   ロック判定
   ══════════════════════════════════════════════════════════ */

/**
 * 指定日付のロック状態を返す
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {{ locked:boolean, grace:boolean, daysLeft:number|null }}
 *
 * ロックルール:
 *   当月         → 自由に修正可（locked:false, grace:false）
 *   翌月1〜3日   → 猶予期間（locked:false, grace:true, daysLeft:残日数）
 *   翌月4日以降  → 完全ロック（locked:true）
 */
function getLockStatus(dateStr) {
  if (!dateStr) return { locked: true, grace: false, daysLeft: null };
  const [dy, dm] = dateStr.split('-').map(Number);
  const now = new Date();
  const ty  = now.getFullYear();
  const tm  = now.getMonth() + 1;
  const td  = now.getDate();

  // 当月
  if (dy === ty && dm === tm) return { locked: false, grace: false, daysLeft: null };

  // データ月の翌月を計算
  const ny = dm === 12 ? dy + 1 : dy;
  const nm = dm === 12 ? 1       : dm + 1;

  // 今日がデータ月の翌月1〜3日
  if (ty === ny && tm === nm && td <= 3) {
    return { locked: false, grace: true, daysLeft: 4 - td };
  }

  return { locked: true, grace: false, daysLeft: null };
}

/**
 * ロック状態に応じたボタン/バッジHTMLを返す
 * @param {object} ls  - getLockStatus()の戻り値
 * @param {number} idx - キャッシュ配列のインデックス
 * @param {string} scope - 'sc'（売上コスト）| 'at'（入店）
 */
function buildLockWidget(ls, idx, scope) {
  if (ls.locked) {
    return `<span class="hist-locked-badge">修正不可</span>`;
  }
  const btnClass = ls.grace ? 'hist-edit-btn hist-edit-btn--grace' : 'hist-edit-btn';
  const badge    = ls.grace
    ? `<span class="hist-grace-badge">期限まであと${ls.daysLeft}日</span>`
    : '';
  return `
    <div style="display:flex;flex-direction:column;align-items:flex-end;">
      <button class="${btnClass}"
              type="button"
              data-idx="${idx}"
              data-scope="${scope}">修正</button>
      ${badge}
    </div>`;
}

/* ── リストのクリック委譲（1回だけ登録） ────────────────── */
function bindListClicks() {
  document.getElementById('history-list')?.addEventListener('click', e => {
    const btn = e.target.closest('.hist-edit-btn[data-scope="sc"]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    if (!isNaN(idx) && editableItems[idx]) openEditForm(editableItems[idx]);
  });

  document.getElementById('attendance-list')?.addEventListener('click', e => {
    const btn = e.target.closest('.hist-edit-btn[data-scope="at"]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    if (!isNaN(idx) && attendItems[idx]) openEditForm(attendItems[idx]);
  });
}

/* ══════════════════════════════════════════════════════════
   タブ1：売上・コスト描画
   ══════════════════════════════════════════════════════════ */

function renderSalesCost(items) {
  const container = document.getElementById('history-list');
  if (!container) return;
  editableItems = [];

  if (items.length === 0) {
    container.innerHTML = `
      <p style="text-align:center;padding:40px 20px;font-size:13px;color:var(--uz-muted);">
        この月の売上・コスト履歴はありません
      </p>`;
    return;
  }

  const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date));
  const groups = {};
  sorted.forEach(item => {
    if (!groups[item.date]) groups[item.date] = [];
    groups[item.date].push(item);
  });

  let html = '';
  Object.keys(groups).forEach(date => {
    html += buildDateHeader(date);
    groups[date].forEach(item => {
      const idx = editableItems.push(item) - 1;
      html += buildSalesCostItemHTML(item, idx);
    });
  });

  container.innerHTML = html;
}

function renderSalesCostError() {
  const container = document.getElementById('history-list');
  if (container) container.innerHTML = `
    <p style="text-align:center;padding:40px 20px;font-size:13px;color:var(--uz-muted);">
      データの取得に失敗しました。<br>通信状態を確認してください。
    </p>`;
}

function buildSalesCostItemHTML(item, idx) {
  const isSales   = item.type === 'sales';
  const icon      = isSales ? '💰' : '💸';
  const typeClass = isSales ? 'sales' : 'cost';
  const ls        = getLockStatus(item.date);
  const widget    = buildLockWidget(ls, idx, 'sc');

  return `
    <div class="history-item">
      <div class="history-item__type history-item__type--${typeClass}">${icon}</div>
      <div class="history-item__info">
        <div class="history-item__name">${escHtml(item.itemName)}</div>
        ${item.memo ? `<div class="history-item__date">${escHtml(item.memo)}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
        <span class="history-item__amount history-item__amount--${typeClass}">
          ${formatYen(item.amount)}
        </span>
        ${widget}
      </div>
    </div>`;
}

/* ══════════════════════════════════════════════════════════
   タブ2：入店履歴描画
   ══════════════════════════════════════════════════════════ */

function renderAttendance(items) {
  const container = document.getElementById('attendance-list');
  if (!container) return;
  attendItems = [];

  if (items.length === 0) {
    container.innerHTML = `
      <p style="text-align:center;padding:40px 20px;font-size:13px;color:var(--uz-muted);">
        この月の入店履歴はありません
      </p>`;
    return;
  }

  // スタッフ名でグループ化
  const staffMap = {};
  items.forEach(item => {
    const name = item.staffName || '不明';
    if (!staffMap[name]) staffMap[name] = [];
    staffMap[name].push(item);
  });

  Object.values(staffMap).forEach(recs => recs.sort((a, b) => b.date.localeCompare(a.date)));

  const staffNames = Object.keys(staffMap).sort((a, b) =>
    staffMap[b][0].date.localeCompare(staffMap[a][0].date));

  let html = '';
  staffNames.forEach(name => {
    const recs      = staffMap[name];
    const hasActive = recs.some(r => !parseTimeStr(r.clockOut));

    html += `
      <div class="attend-staff-card">
        <div class="attend-staff-header">
          <span class="attendance-dot ${hasActive ? 'attendance-dot--active' : 'attendance-dot--out'}"
                aria-hidden="true"></span>
          <span class="attend-staff-name">${escHtml(name)}</span>
        </div>`;

    recs.forEach(r => {
      // type: 'attendance' を付与してキャッシュに積む
      const enriched = { ...r, type: 'attendance' };
      const atIdx    = attendItems.push(enriched) - 1;

      const [y, m, d] = r.date.split(/[-\/]/).map(Number);
      const dow        = WEEKDAYS[new Date(y, m - 1, d).getDay()];
      const dateLabel  = `${m}/${d}（${dow}）`;
      const clockIn    = parseTimeStr(r.clockIn);
      const clockOut   = parseTimeStr(r.clockOut);
      const timeStr    = clockOut
        ? `${escHtml(clockIn)} → ${escHtml(clockOut)}`
        : `${escHtml(clockIn)} — 退店未記録`;
      const isActive   = !clockOut;
      const ls         = getLockStatus(r.date);
      const widget     = buildLockWidget(ls, atIdx, 'at');

      html += `
        <div class="attend-record-row">
          <div class="attend-record-date">${dateLabel}</div>
          <div class="attend-record-times">${timeStr}</div>
          <span class="attend-status ${isActive ? 'attend-status--active' : 'attend-status--out'}">
            ${isActive ? '在店中' : '退店済'}
          </span>
          ${widget}
        </div>`;
    });

    html += `</div>`;
  });

  container.innerHTML = html;
}

function renderAttendanceError() {
  const container = document.getElementById('attendance-list');
  if (container) container.innerHTML = `
    <p style="text-align:center;padding:40px 20px;font-size:13px;color:var(--uz-muted);">
      入店履歴の取得に失敗しました。<br>通信状態を確認してください。
    </p>`;
}

/* ══════════════════════════════════════════════════════════
   修正フォーム
   ══════════════════════════════════════════════════════════ */

function bindEditPanel() {
  document.getElementById('edit-cancel-btn')?.addEventListener('click', closeEditForm);
  document.getElementById('edit-backdrop')?.addEventListener('click',   closeEditForm);
  document.getElementById('edit-save-btn')?.addEventListener('click',   saveEdit);
}

function openEditForm(item) {
  if (!item) return;

  // rowIndex チェック（GAS未更新の場合に案内）
  if (!item.rowIndex) {
    showToast(
      'rowIndex が取得できません。GAS の getHistory / getAttendanceByMonth に rowIndex を追加してください。',
      'error', 5000
    );
    return;
  }

  currentEditItem = item;

  const titleEl = document.getElementById('edit-panel-title');
  const bodyEl  = document.getElementById('edit-form-body');
  if (!titleEl || !bodyEl) return;

  if (item.type === 'sales') {
    titleEl.textContent = '売上を修正';
    bodyEl.innerHTML    = buildSalesFormHTML(item);
  } else if (item.type === 'cost') {
    titleEl.textContent = 'コストを修正';
    bodyEl.innerHTML    = buildCostFormHTML(item);
  } else {
    // attendance
    titleEl.textContent = '入店記録を修正';
    bodyEl.innerHTML    = buildAttendanceFormHTML(item);
  }

  bindTaxCalc();

  document.getElementById('edit-backdrop')?.classList.add('edit-backdrop--show');
  document.getElementById('edit-panel')?.classList.add('edit-panel--open');
  document.getElementById('edit-save-btn').disabled = false;
  document.getElementById('edit-save-btn').textContent = '保存する';
}

function closeEditForm() {
  currentEditItem = null;
  document.getElementById('edit-backdrop')?.classList.remove('edit-backdrop--show');
  document.getElementById('edit-panel')?.classList.remove('edit-panel--open');
}

/* ── フォームHTML生成 ────────────────────────────────────── */

function taxToggleGroupHTML(taxRate) {
  return `<div class="tax-toggle-group" role="group" aria-label="税率">
    ${[0, 8, 10].map(r => `
      <button type="button"
              class="tax-toggle${r === taxRate ? ' tax-toggle--active' : ''}"
              data-rate="${r}">${r}%</button>
    `).join('')}
  </div>`;
}

function buildSalesFormHTML(item) {
  const rate = Number(item.taxRate) || 10;
  return `
    <div class="edit-field">
      <label class="edit-label">日付</label>
      <input type="date" id="ef-date" class="edit-input"
             value="${escHtml(item.date || '')}">
    </div>
    <div class="edit-field">
      <label class="edit-label">サービス名</label>
      <input type="text" id="ef-name" class="edit-input"
             value="${escHtml(item.itemName || '')}" maxlength="40">
    </div>
    <div class="edit-field">
      <label class="edit-label">税率</label>
      ${taxToggleGroupHTML(rate)}
    </div>
    <div class="edit-field">
      <label class="edit-label">税込金額</label>
      <input type="number" id="ef-amount" class="edit-input"
             value="${Number(item.amount) || 0}" inputmode="numeric" min="0">
      <div id="ef-tax-note" class="edit-tax-note"></div>
    </div>
    <div class="edit-field">
      <label class="edit-label">メモ</label>
      <input type="text" id="ef-memo" class="edit-input"
             value="${escHtml(item.memo || '')}" maxlength="100">
    </div>
    <div class="edit-field">
      <label class="edit-label">未収</label>
      <label class="edit-toggle-wrap">
        <input type="checkbox" id="ef-flag" ${Number(item.uncollected) ? 'checked' : ''}>
        <span class="edit-toggle-label">未収あり</span>
      </label>
    </div>`;
}

function buildCostFormHTML(item) {
  const rate = Number(item.taxRate) || 10;
  return `
    <div class="edit-field">
      <label class="edit-label">日付</label>
      <input type="date" id="ef-date" class="edit-input"
             value="${escHtml(item.date || '')}">
    </div>
    <div class="edit-field">
      <label class="edit-label">科目名</label>
      <input type="text" id="ef-name" class="edit-input"
             value="${escHtml(item.itemName || '')}" maxlength="40">
    </div>
    <div class="edit-field">
      <label class="edit-label">税率</label>
      ${taxToggleGroupHTML(rate)}
    </div>
    <div class="edit-field">
      <label class="edit-label">税込金額</label>
      <input type="number" id="ef-amount" class="edit-input"
             value="${Number(item.amount) || 0}" inputmode="numeric" min="0">
      <div id="ef-tax-note" class="edit-tax-note"></div>
    </div>
    <div class="edit-field">
      <label class="edit-label">メモ</label>
      <input type="text" id="ef-memo" class="edit-input"
             value="${escHtml(item.memo || '')}" maxlength="100">
    </div>
    <div class="edit-field">
      <label class="edit-label">未払</label>
      <label class="edit-toggle-wrap">
        <input type="checkbox" id="ef-flag" ${Number(item.unpaid) ? 'checked' : ''}>
        <span class="edit-toggle-label">未払あり</span>
      </label>
    </div>`;
}

function buildAttendanceFormHTML(item) {
  const clockIn  = parseTimeStr(item.clockIn)  || '';
  const clockOut = parseTimeStr(item.clockOut) || '';
  return `
    <div class="edit-field">
      <label class="edit-label">スタッフ名</label>
      <div class="edit-readonly">${escHtml(item.staffName || '')}</div>
    </div>
    <div class="edit-field">
      <label class="edit-label">日付</label>
      <input type="date" id="ef-date" class="edit-input"
             value="${escHtml(item.date || '')}">
    </div>
    <div class="edit-field">
      <label class="edit-label">入店時刻</label>
      ${timeSelectHTML('ef-clockin', clockIn, true)}
    </div>
    <div class="edit-field">
      <label class="edit-label">退店時刻
        <span style="font-size:11px;font-weight:400;color:var(--uz-muted);margin-left:4px;">任意</span>
      </label>
      ${timeSelectHTML('ef-clockout', clockOut, false)}
    </div>`;
}

/* ── 税率トグル・税額リアルタイム表示 ───────────────────── */
function bindTaxCalc() {
  document.querySelectorAll('.tax-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tax-toggle').forEach(b => b.classList.remove('tax-toggle--active'));
      btn.classList.add('tax-toggle--active');
      updateTaxNote();
    });
  });
  document.getElementById('ef-amount')?.addEventListener('input', updateTaxNote);
  updateTaxNote();
}

function getSelectedTaxRate() {
  return Number(document.querySelector('.tax-toggle--active')?.dataset.rate ?? 10);
}

function updateTaxNote() {
  const el = document.getElementById('ef-tax-note');
  if (!el) return;
  const taxInc = parseInt(document.getElementById('ef-amount')?.value || '0', 10) || 0;
  const rate   = getSelectedTaxRate();
  if (rate === 0) {
    el.textContent = `税抜 ¥${taxInc.toLocaleString()}  /  消費税 ¥0`;
  } else {
    const taxExc = Math.floor(taxInc / (1 + rate / 100));
    el.textContent = `税抜 ¥${taxExc.toLocaleString()}  /  消費税 ¥${(taxInc - taxExc).toLocaleString()}`;
  }
}

/* ── 保存処理 ─────────────────────────────────────────────── */
async function saveEdit() {
  if (isEditSaving || !currentEditItem) return;

  const item = currentEditItem;
  isEditSaving = true;
  const saveBtn = document.getElementById('edit-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '保存中...'; }

  try {
    let result;

    if (item.type === 'sales') {
      const date        = document.getElementById('ef-date')?.value         || item.date;
      const serviceName = document.getElementById('ef-name')?.value?.trim() || item.itemName;
      const taxRate     = getSelectedTaxRate();
      const taxInc      = parseInt(document.getElementById('ef-amount')?.value || '0', 10) || 0;
      const taxExc      = taxRate === 0 ? taxInc : Math.floor(taxInc / (1 + taxRate / 100));
      const tax         = taxInc - taxExc;
      const memo        = document.getElementById('ef-memo')?.value        || '';
      const uncollected = document.getElementById('ef-flag')?.checked      ? 1 : 0;

      result = await callGAS('updateSales', {
        rowIndex:    item.rowIndex,
        date,
        serviceName,
        serviceCode: item.serviceCode  || '',
        amountExTax: taxExc,
        taxRate,
        tax,
        amountInTax: taxInc,
        memo,
        uncollected,
      });

    } else if (item.type === 'cost') {
      const date      = document.getElementById('ef-date')?.value         || item.date;
      const itemName  = document.getElementById('ef-name')?.value?.trim() || item.itemName;
      const taxRate   = getSelectedTaxRate();
      const taxInc    = parseInt(document.getElementById('ef-amount')?.value || '0', 10) || 0;
      const taxExc    = taxRate === 0 ? taxInc : Math.floor(taxInc / (1 + taxRate / 100));
      const tax       = taxInc - taxExc;
      const memo      = document.getElementById('ef-memo')?.value      || '';
      const unpaid    = document.getElementById('ef-flag')?.checked    ? 1 : 0;

      result = await callGAS('updateCost', {
        rowIndex:     item.rowIndex,
        date,
        divisionCode: item.divisionCode || '',
        divisionName: item.divisionName || '',
        itemCode:     item.itemCode     || '',
        itemName,
        taxExcluded:  taxExc,
        taxRate,
        tax,
        taxIncluded:  taxInc,
        memo,
        unpaid,
      });

    } else {
      // attendance
      const date     = document.getElementById('ef-date')?.value || item.date;
      const clockIn  = getTimeSelectValue('ef-clockin');
      const clockOut = getTimeSelectValue('ef-clockout');

      if (!clockIn) {
        showToast('入店時刻を選択してください', 'error');
        isEditSaving = false;
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '保存する'; }
        return;
      }

      result = await callGAS('updateAttendance', {
        rowIndex:  item.rowIndex,
        date,
        staffId:   item.staffId   || '',
        staffName: item.staffName || '',
        clockIn,
        clockOut,
      });
    }

    if (result?.status !== 'ok') throw new Error(result?.message || '登録エラー');

    closeEditForm();
    showToast('修正を保存しました ✓', 'success');
    await loadAll(); // 一覧をリロード

  } catch (e) {
    showToast('保存に失敗しました：' + e.message, 'error');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '保存する'; }
  } finally {
    isEditSaving = false;
  }
}

/* ── 共通：日付ヘッダー ──────────────────────────────────── */
function buildDateHeader(dateStr) {
  const [y, m, d] = dateStr.split(/[-\/]/).map(Number);
  const dow = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `
    <div style="padding:12px 20px 6px;">
      <span style="font-size:12px;font-weight:700;color:var(--uz-muted);letter-spacing:0.06em;">
        ${y}年${m}月${d}日（${dow}）
      </span>
    </div>`;
}

/* ── 時刻文字列正規化（GASのシリアル日時対応） ──────────── */
function parseTimeStr(val) {
  if (!val) return '';
  const s = String(val).trim();
  if (!s) return '';
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s.slice(0, 5);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime()))
      return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime()))
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  return '';
}

/* ── XSSエスケープ ───────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
