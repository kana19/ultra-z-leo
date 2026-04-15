/**
 * ウルトラ財務くん LEO版 PWA — cost.js
 * コスト入力画面ロジック（科目マスタ連携版）
 */

'use strict';

/* ── 状態 ────────────────────────────────────────────────── */
let costMaster           = [];  // getCostMaster()（app.js）から読み込む
let selectedDivisionCode = '1';
let selectedItemCode     = null;
let currentTaxRate       = 10;
let isSubmitting         = false;

/* ── 区分ごとの選択可能科目リスト ────────────────────────── */
/**
 * 指定区分の科目リストを返す（空のcustom除外・末尾に諸口追加）
 * @param {string} divCode
 * @returns {Array}
 */
function getDivisionItems(divCode) {
  const items = costMaster
    .filter(i => i.divisionCode === divCode)
    .filter(i => i.name && i.name.trim() !== '');

  items.push({
    code:         `MISC_${divCode}`,
    taxRow:       null,
    name:         '諸口',
    taxRate:      10,
    type:         'misc',
    divisionCode: divCode,
  });

  return items;
}

function divisionLabel(code) {
  return code === '1' ? '仕入原価' : '販管費';
}

/* ── 初期化 ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  costMaster = getCostMaster();   // app.js の共通関数
  loadCostMasterFromGAS();        // バックグラウンドで最新取得

  initDate();
  bindDivisionButtons();
  bindAmountInput();
  bindTaxButtons();
  bindUnpaidToggle();
  bindSubmit();
  selectDivision('1');
});

/* ── GASから最新マスタを取得（バックグラウンド） ─────────── */
async function loadCostMasterFromGAS() {
  try {
    const res = await callGAS('getCostMaster', {});
    if (res && res.status === 'ok' && Array.isArray(res.data)) {
      saveCostMasterToStorage(res.data);
      costMaster = res.data;
      renderItemCards(selectedDivisionCode);
    }
  } catch { /* サイレントフェイル */ }
}

/* ── 日付初期化 ──────────────────────────────────────────── */
function initDate() {
  const el = document.getElementById('date-input');
  if (el) {
    el.value = todayStr();
    el.addEventListener('change', updateSubmitBtnDate);
  }
  updateSubmitBtnDate();
}

function buildSubmitBtnText() {
  const dateVal = document.getElementById('date-input')?.value || todayStr();
  return `発生日 ${dateVal.replace(/-/g, '/')}　登録する`;
}

function updateSubmitBtnDate() {
  const btn = document.getElementById('submit-btn');
  if (!btn || btn.disabled) return;
  btn.innerHTML = buildSubmitBtnText();
}

/* ── 区分ボタン ──────────────────────────────────────────── */
function bindDivisionButtons() {
  document.querySelectorAll('.division-btn').forEach(btn => {
    btn.addEventListener('click', () => selectDivision(btn.dataset.div));
  });
}

function selectDivision(code) {
  selectedDivisionCode = code;
  selectedItemCode     = null;

  document.querySelectorAll('.division-btn').forEach(btn => {
    btn.classList.toggle('division-btn--active', btn.dataset.div === code);
  });

  renderItemCards(code);
  recalcTax();
}

/* ── 科目カード描画 ──────────────────────────────────────── */
function renderItemCards(divCode) {
  const container = document.getElementById('item-cards');
  if (!container) return;

  const items = getDivisionItems(divCode);

  container.innerHTML = items.map(item => `
    <div class="radio-card"
         data-code="${escHtml(item.code)}"
         role="radio"
         aria-checked="false"
         tabindex="0"
         onclick="selectItem('${escHtml(item.code)}')"
         onkeydown="if(event.key==='Enter'||event.key===' ')selectItem('${escHtml(item.code)}')">
      <div class="radio-card__label">${escHtml(item.name)}</div>
      <div class="radio-card__sub">${item.taxRow ? `行${item.taxRow}　` : ''}税率 ${item.taxRate}%</div>
    </div>
  `).join('');
}

/* ── 科目選択 ────────────────────────────────────────────── */
function selectItem(code) {
  const items = getDivisionItems(selectedDivisionCode);
  const item  = items.find(i => i.code === code);
  if (!item) return;

  selectedItemCode = code;

  document.querySelectorAll('#item-cards .radio-card').forEach(card => {
    const checked = card.dataset.code === code;
    card.classList.toggle('radio-card--checked-red', checked);
    card.setAttribute('aria-checked', String(checked));
  });

  setTaxRate(item.taxRate);

  const miscSection = document.getElementById('misc-section');
  if (miscSection) {
    const isMisc = item.type === 'misc';
    miscSection.hidden = !isMisc;
    if (!isMisc) {
      const miscInput = document.getElementById('misc-name-input');
      if (miscInput) miscInput.value = '';
    }
  }
}

/* ── 税率セット ──────────────────────────────────────────── */
function setTaxRate(rate) {
  currentTaxRate = rate;

  document.querySelectorAll('.tax-btn').forEach(btn => {
    const active = parseInt(btn.dataset.rate) === rate;
    btn.classList.toggle('tax-btn--active-red', active);
  });

  recalcTax();
}

/* ── 税計算・表示更新 ────────────────────────────────────── */
function recalcTax() {
  const amountInput = document.getElementById('amount-input');
  const raw         = amountInput ? amountInput.value.replace(/,/g, '') : '0';
  const taxIncluded = parseInt(raw) || 0;
  const { taxExcluded, tax } = calcTax(taxIncluded, currentTaxRate);

  const exEl  = document.getElementById('tax-excluded');
  const taxEl = document.getElementById('tax-amount');
  if (exEl)  exEl.textContent  = taxIncluded > 0 ? formatYen(taxExcluded) : '¥—';
  if (taxEl) taxEl.textContent = taxIncluded > 0 ? formatYen(tax)         : '¥—';
}

/* ── 金額入力バインド ────────────────────────────────────── */
function bindAmountInput() {
  const el = document.getElementById('amount-input');
  if (!el) return;
  el.addEventListener('input', () => {
    el.value = el.value.replace(/[^0-9]/g, '');
    recalcTax();
  });
}

/* ── 税率ボタンバインド ──────────────────────────────────── */
function bindTaxButtons() {
  document.querySelectorAll('.tax-btn').forEach(btn => {
    btn.addEventListener('click', () => setTaxRate(parseInt(btn.dataset.rate)));
  });
}

/* ── 未払トグル ──────────────────────────────────────────── */
function bindUnpaidToggle() { /* submit時に読み取り */ }

/* ── 送信処理 ────────────────────────────────────────────── */
function bindSubmit() {
  document.getElementById('submit-btn')?.addEventListener('click', handleSubmit);
}

async function handleSubmit() {
  if (isSubmitting) return;

  const date     = document.getElementById('date-input')?.value || '';
  const rawAmt   = (document.getElementById('amount-input')?.value || '0').replace(/,/g, '');
  const amount   = parseInt(rawAmt) || 0;
  const memo     = document.getElementById('memo-input')?.value.trim() || '';
  const miscName = document.getElementById('misc-name-input')?.value.trim() || '';
  const unpaid   = document.getElementById('unpaid-toggle')?.checked ?? false;

  const items = getDivisionItems(selectedDivisionCode);
  const item  = items.find(i => i.code === selectedItemCode);

  if (!date)       return showToast('日付を入力してください', 'error');
  if (!item)       return showToast('科目を選択してください', 'error');
  if (amount <= 0) return showToast('金額を入力してください', 'error');
  if (item.type === 'misc' && !miscName) return showToast('科目名を入力してください', 'error');

  const { taxExcluded, tax } = calcTax(amount, currentTaxRate);

  const payload = {
    date,
    divisionCode: selectedDivisionCode,
    divisionName: divisionLabel(selectedDivisionCode),
    itemCode:     item.code,
    itemName:     item.name,
    taxRow:       item.taxRow ?? null,
    miscItemName: miscName,
    taxExcluded,
    taxRate:      currentTaxRate,
    tax,
    taxIncluded:  amount,
    memo,
    unpaid:       unpaid ? 1 : 0,
  };

  isSubmitting = true;
  setSubmitLoading(true);

  try {
    const result = await callGAS('addCost', payload);
    if (result.status !== 'ok') throw new Error(result.message || '登録エラー');
    setSubmitLoading(false);
    showToast('コストを登録しました ✓', 'success');
    setTimeout(() => navigate('index.html'), 1200);
  } catch (e) {
    setSubmitLoading(false);
    showToast('登録に失敗しました：' + e.message, 'error');
  } finally {
    isSubmitting = false;
  }
}

/* ── ヘルパー ────────────────────────────────────────────── */
function setSubmitLoading(loading) {
  const btn = document.getElementById('submit-btn');
  if (!btn) return;
  btn.disabled  = loading;
  btn.innerHTML = loading
    ? '<span class="spinner" style="width:20px;height:20px;border-top-color:var(--uz-gold);"></span>'
    : buildSubmitBtnText();
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
