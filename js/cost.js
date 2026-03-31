/**
 * ウルトラ財務くん LEO版 PWA — cost.js
 * コスト入力画面ロジック
 */

'use strict';

/* ── マスタデータ（本番はGASから取得） ──────────────────── */
const DIVISION_MASTER = {
  '1': {
    code: '1',
    name: '仕入原価',
    items: [
      { code: 'C101', name: '酒類・飲料',   taxRate:  8 },
      { code: 'C102', name: 'フード材料',   taxRate:  8 },
      { code: 'C103', name: '消耗品',       taxRate: 10 },
      { code: 'C104', name: 'その他仕入',   taxRate: 10 },
      { code: 'C199', name: '諸口',         taxRate: 10 },
    ],
  },
  '2': {
    code: '2',
    name: '販管費',
    items: [
      { code: 'C201', name: '家賃',         taxRate:  0 },
      { code: 'C202', name: '人件費',       taxRate:  0 },
      { code: 'C203', name: '光熱費',       taxRate: 10 },
      { code: 'C204', name: '広告宣伝費',   taxRate: 10 },
      { code: 'C205', name: '通信費',       taxRate: 10 },
      { code: 'C206', name: '消耗品費',     taxRate: 10 },
      { code: 'C207', name: '修繕費',       taxRate: 10 },
      { code: 'C299', name: '諸口',         taxRate: 10 },
    ],
  },
};

/* ── 状態 ────────────────────────────────────────────────── */
let selectedDivisionCode = '1';
let selectedItemCode     = null;
let currentTaxRate       = 8;
let isSubmitting         = false;

/* ── 初期化 ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initDate();
  bindDivisionButtons();
  bindAmountInput();
  bindTaxButtons();
  bindUnpaidToggle();
  bindSubmit();

  // 初期区分を選択
  selectDivision('1');
});

/* ── 日付初期化 ──────────────────────────────────────────── */
function initDate() {
  const el = document.getElementById('date-input');
  if (el) el.value = todayStr();
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

  // ボタンUI更新
  document.querySelectorAll('.division-btn').forEach(btn => {
    btn.classList.toggle('division-btn--active', btn.dataset.div === code);
  });

  // 科目カードを再描画
  renderItemCards(code);
  recalcTax();
}

/* ── 科目カード描画 ──────────────────────────────────────── */
function renderItemCards(divCode) {
  const container = document.getElementById('item-cards');
  if (!container) return;

  const items = DIVISION_MASTER[divCode]?.items || [];

  container.innerHTML = items.map(item => `
    <div class="radio-card"
         data-code="${item.code}"
         role="radio"
         aria-checked="false"
         tabindex="0"
         onclick="selectItem('${item.code}')"
         onkeydown="if(event.key==='Enter'||event.key===' ')selectItem('${item.code}')">
      <div class="radio-card__label">${escHtml(item.name)}</div>
      <div class="radio-card__sub">税率 ${item.taxRate}%</div>
    </div>
  `).join('');
}

/* ── 科目選択 ────────────────────────────────────────────── */
function selectItem(code) {
  const division = DIVISION_MASTER[selectedDivisionCode];
  if (!division) return;

  const item = division.items.find(i => i.code === code);
  if (!item) return;

  selectedItemCode = code;

  // カードUI更新
  document.querySelectorAll('#item-cards .radio-card').forEach(card => {
    const checked = card.dataset.code === code;
    card.classList.toggle('radio-card--checked-red', checked);
    card.setAttribute('aria-checked', String(checked));
  });

  // 税率をアイテムデフォルトに合わせる
  setTaxRate(item.taxRate);

  // 諸口フィールドの表示切替
  const miscSection = document.getElementById('misc-section');
  if (miscSection) {
    const isMisc = code === 'C199' || code === 'C299';
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
  const raw = amountInput ? amountInput.value.replace(/,/g, '') : '0';
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

/* ── 未払トグル（UIのみ、値はsubmit時に読む） ───────────── */
function bindUnpaidToggle() {
  // 現時点ではsubmit時に読み取るだけ
}

/* ── 送信処理 ────────────────────────────────────────────── */
function bindSubmit() {
  const btn = document.getElementById('submit-btn');
  if (btn) btn.addEventListener('click', handleSubmit);
}

async function handleSubmit() {
  if (isSubmitting) return;

  const date     = document.getElementById('date-input')?.value || '';
  const rawAmt   = (document.getElementById('amount-input')?.value || '0').replace(/,/g, '');
  const amount   = parseInt(rawAmt) || 0;
  const memo     = document.getElementById('memo-input')?.value.trim() || '';
  const miscName = document.getElementById('misc-name-input')?.value.trim() || '';
  const unpaid   = document.getElementById('unpaid-toggle')?.checked ?? false;

  const division = DIVISION_MASTER[selectedDivisionCode];
  const item     = division?.items.find(i => i.code === selectedItemCode);

  // ── バリデーション ──
  if (!date)   return showToast('日付を入力してください', 'error');
  if (!item)   return showToast('科目を選択してください', 'error');
  if (amount <= 0) return showToast('金額を入力してください', 'error');

  const isMisc = selectedItemCode === 'C199' || selectedItemCode === 'C299';
  if (isMisc && !miscName) return showToast('科目名を入力してください', 'error');

  const { taxExcluded, tax } = calcTax(amount, currentTaxRate);

  const payload = {
    date,
    divisionCode:  division.code,
    divisionName:  division.name,
    itemCode:      item.code,
    itemName:      item.name,
    miscItemName:  miscName,
    taxExcluded,
    taxRate:       currentTaxRate,
    tax,
    taxIncluded:   amount,
    memo,
    unpaid:        unpaid ? 1 : 0,
  };

  // ── GAS送信 ──
  isSubmitting = true;
  setSubmitLoading(true);

  try {
    // ★ GAS未接続期間はダミー動作。接続後は下のコメントを外す。
    // const result = await callGAS('addCost', payload);
    // if (result.status !== 'ok') throw new Error(result.message || '登録エラー');
    await dummyDelay(700);
    console.log('[addCost] payload:', payload);

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
  btn.disabled = loading;
  btn.innerHTML = loading
    ? '<span class="spinner" style="width:20px;height:20px;border-top-color:#fff;"></span>'
    : '登録する';
}

function dummyDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
