/**
 * ウルトラ財務くん LEO版 PWA — sales.js
 * 売上入力画面ロジック
 */

'use strict';

/* ── サービスマスタ（設定画面で登録・localStorageで管理） ── */
const SERVICE_MASTER_KEY = 'uz_service_master';

// 諸口は常に末尾に自動付与（削除・変更不可）
const MISC_SERVICE = { code: 'S099', name: '諸口', taxRate: 10 };

const DEFAULT_SERVICES = [
  { code: 'S001', name: '店内売上',     taxRate: 10 },
  { code: 'S002', name: 'テイクアウト', taxRate:  8 },
];

/**
 * サービスマスタを取得（最大3種 + 諸口を末尾に付与）
 * @returns {{ code: string, name: string, taxRate: number }[]}
 */
function getServiceMaster() {
  try {
    const saved = localStorage.getItem(SERVICE_MASTER_KEY);
    const list  = saved ? JSON.parse(saved) : DEFAULT_SERVICES;
    return [...list, MISC_SERVICE]; // 諸口は常に末尾に固定
  } catch {
    return [...DEFAULT_SERVICES, MISC_SERVICE];
  }
}

const ROYAL_CUSTOMERS = [
  { code: 'R001', name: '田中様' },
  { code: 'R002', name: '鈴木様' },
  { code: 'R003', name: '佐藤様' },
  { code: 'R004', name: '高橋様' },
];

/* ── 状態 ────────────────────────────────────────────────── */
let selectedServiceCode = null; // DOMContentLoaded時にマスタ先頭で初期化
let currentTaxRate      = 10;
let isSubmitting        = false;

/* ── 初期化 ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initDate();
  renderServiceCards();
  renderRoyalOptions();
  bindAmountInput();
  bindTaxButtons();
  bindRoyalToggle();
  bindSubmit();

  // 最初のサービスを選択状態にする
  selectService(getServiceMaster()[0].code);
});

/* ── 日付初期化 ──────────────────────────────────────────── */
function initDate() {
  const el = document.getElementById('date-input');
  if (el) el.value = todayStr();
}

/* ── サービスカード描画 ───────────────────────────────────── */
function renderServiceCards() {
  const container = document.getElementById('service-cards');
  if (!container) return;

  container.innerHTML = getServiceMaster().map(svc => `
    <div class="radio-card"
         data-code="${svc.code}"
         role="radio"
         aria-checked="false"
         tabindex="0"
         onclick="selectService('${svc.code}')"
         onkeydown="if(event.key==='Enter'||event.key===' ')selectService('${svc.code}')">
      <div class="radio-card__label">${escHtml(svc.name)}</div>
      <div class="radio-card__sub">税率 ${svc.taxRate}%</div>
    </div>
  `).join('');
}

/* ── サービス選択 ────────────────────────────────────────── */
function selectService(code) {
  const svc = getServiceMaster().find(s => s.code === code);
  if (!svc) return;

  selectedServiceCode = code;

  // カードUI更新
  document.querySelectorAll('#service-cards .radio-card').forEach(card => {
    const checked = card.dataset.code === code;
    card.classList.toggle('radio-card--checked-blue', checked);
    card.setAttribute('aria-checked', String(checked));
  });

  // 税率をサービスデフォルトに戻す
  setTaxRate(svc.taxRate);

  // 諸口フィールドの表示切替
  const miscSection = document.getElementById('misc-section');
  if (miscSection) {
    miscSection.hidden = code !== 'S099';
    if (code !== 'S099') {
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
    btn.classList.toggle('tax-btn--active-blue', active);
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
    // 数字以外を除去
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

/* ── ロイヤル顧客プルダウン生成 ─────────────────────────── */
function renderRoyalOptions() {
  const sel = document.getElementById('royal-customer-select');
  if (!sel) return;

  sel.innerHTML = `<option value="">顧客を選択</option>` +
    ROYAL_CUSTOMERS.map(c =>
      `<option value="${escHtml(c.code)}">${escHtml(c.name)}</option>`
    ).join('');
}

/* ── ロイヤルトグル ──────────────────────────────────────── */
function bindRoyalToggle() {
  const toggle  = document.getElementById('royal-toggle');
  const section = document.getElementById('royal-detail-section');
  if (!toggle || !section) return;

  toggle.addEventListener('change', () => {
    section.hidden = !toggle.checked;
    if (!toggle.checked) {
      const sel = document.getElementById('royal-customer-select');
      const amt = document.getElementById('royal-amount-input');
      if (sel) sel.value = '';
      if (amt) amt.value = '';
    }
  });
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

  const svc = getServiceMaster().find(s => s.code === selectedServiceCode);

  // ── バリデーション ──
  if (!date)   return showToast('日付を入力してください', 'error');
  if (!svc)    return showToast('サービスを選択してください', 'error');
  if (amount <= 0) return showToast('金額を入力してください', 'error');
  if (svc.code === 'S099' && !miscName) return showToast('品目名を入力してください', 'error');

  // ロイヤル
  const royalEnabled    = document.getElementById('royal-toggle')?.checked ?? false;
  const customerCode    = royalEnabled ? (document.getElementById('royal-customer-select')?.value || '') : '';
  const royalAmtRaw     = (document.getElementById('royal-amount-input')?.value || '0').replace(/,/g, '');
  const royalAmount     = royalEnabled ? (parseInt(royalAmtRaw) || 0) : 0;
  const uncollected     = document.getElementById('uncollected-toggle')?.checked ?? false;

  if (royalEnabled && !customerCode) return showToast('ロイヤル顧客を選択してください', 'error');
  if (royalEnabled && royalAmount <= 0) return showToast('ロイヤル金額を入力してください', 'error');
  if (royalEnabled && royalAmount > amount) return showToast('ロイヤル金額が売上を超えています', 'error');

  const { taxExcluded, tax } = calcTax(amount, currentTaxRate);

  const payload = {
    date,
    serviceCode:  svc.code,
    serviceName:  svc.name,
    miscItemName: miscName,
    taxExcluded,
    taxRate:      currentTaxRate,
    tax,
    taxIncluded:  amount,
    memo,
    uncollected:  uncollected ? 1 : 0,
    customerCode,
    royalAmount,
  };

  // ── GAS送信 ──
  isSubmitting = true;
  setSubmitLoading(true);

  try {
    const result = await callGAS('addSales', payload);
    if (result.status !== 'ok') throw new Error(result.message || '登録エラー');

    setSubmitLoading(false);
    showToast('売上を登録しました ✓', 'success');
    setTimeout(() => history.back(), 1200);

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

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
