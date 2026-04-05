/**
 * ウルトラ財務くん LEO版 PWA — sales.js
 * 売上入力画面ロジック
 */

'use strict';

/* ── マスタキー ──────────────────────────────────────────── */
const SERVICE_MASTER_KEY = 'uz_service_master';
const STAFF_MASTER_KEY   = 'uz_staff_master';

const MISC_SERVICE = { code: 'S099', name: '諸口', taxRate: 10 };
const DEFAULT_SERVICES = [
  { code: 'S001', name: '店内売上',     taxRate: 10 },
  { code: 'S002', name: 'テイクアウト', taxRate:  8 },
];

function getServiceMaster() {
  try {
    const saved = localStorage.getItem(SERVICE_MASTER_KEY);
    const list  = saved ? JSON.parse(saved) : DEFAULT_SERVICES;
    return [...list, MISC_SERVICE];
  } catch {
    return [...DEFAULT_SERVICES, MISC_SERVICE];
  }
}

function getStaffMaster() {
  try {
    const saved = localStorage.getItem(STAFF_MASTER_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

/* ── 状態 ────────────────────────────────────────────────── */
let selectedServiceCode = null;
let currentTaxRate      = 10;
let isSubmitting        = false;
let nextRowId           = 1;

/* ── 初期化 ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initDate();
  renderServiceCards();
  bindAmountInput();
  bindTaxButtons();
  bindIndividualToggle();
  bindSubmit();
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

  document.querySelectorAll('#service-cards .radio-card').forEach(card => {
    const checked = card.dataset.code === code;
    card.classList.toggle('radio-card--checked-blue', checked);
    card.setAttribute('aria-checked', String(checked));
  });

  setTaxRate(svc.taxRate);

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
    btn.classList.toggle('tax-btn--active-blue', parseInt(btn.dataset.rate) === rate);
  });
  recalcTax();
}

/* ── 税計算・表示更新 ────────────────────────────────────── */
function recalcTax() {
  const raw = (document.getElementById('amount-input')?.value || '0').replace(/,/g, '');
  const taxIncluded = parseInt(raw) || 0;
  const { taxExcluded, tax } = calcTax(taxIncluded, currentTaxRate);
  const exEl  = document.getElementById('tax-excluded');
  const taxEl = document.getElementById('tax-amount');
  if (exEl)  exEl.textContent  = taxIncluded > 0 ? formatYen(taxExcluded) : '¥—';
  if (taxEl) taxEl.textContent = taxIncluded > 0 ? formatYen(tax)         : '¥—';
  recalcUnallocated();
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

/* ════════════════════════════════════════════════════════════
   個別管理
   ════════════════════════════════════════════════════════════ */

/* ── 個別管理トグルバインド ──────────────────────────────── */
function bindIndividualToggle() {
  const toggle  = document.getElementById('individual-toggle');
  const section = document.getElementById('individual-section');
  if (!toggle || !section) return;

  toggle.addEventListener('change', () => {
    section.hidden = !toggle.checked;
    if (toggle.checked) {
      if (!document.querySelector('.indiv-row')) addIndividualRow();
      recalcUnallocated();
    } else {
      document.getElementById('indiv-rows').innerHTML = '';
      nextRowId = 1;
    }
  });
}

/* ── 顧客オプションHTML生成 ──────────────────────────────── */
function buildCustomerOptions() {
  const staffList = getStaffMaster();
  const opts = staffList.map(s =>
    `<option value="${escHtml(s.name)}">${escHtml(s.name)}</option>`
  ).join('');
  return `<option value="">顧客を選択</option>` +
         opts +
         `<option value="__misc__">諸口</option>` +
         `<option value="__manual__">手入力...</option>`;
}

/* ── 個別行追加 ──────────────────────────────────────────── */
function addIndividualRow() {
  const container = document.getElementById('indiv-rows');
  if (!container) return;

  const id  = nextRowId++;
  const div = document.createElement('div');
  div.className  = 'indiv-row';
  div.dataset.id = id;
  div.innerHTML  = `
    <div class="indiv-row-header">
      <select class="form-select indiv-customer-select"
              onchange="onCustomerSelectChange(${id})"
              aria-label="顧客選択">
        ${buildCustomerOptions()}
      </select>
      <button class="indiv-remove-btn" type="button"
              onclick="removeIndividualRow(${id})"
              aria-label="行を削除">✕</button>
    </div>
    <input type="text"
           id="indiv-manual-${id}"
           class="text-input indiv-manual-input"
           placeholder="顧客名を入力"
           maxlength="30"
           autocomplete="off"
           hidden>
    <div class="indiv-row-body">
      <div class="amount-wrap amount-wrap--blue indiv-amount-wrap">
        <span class="amount-prefix" aria-hidden="true">¥</span>
        <input type="text"
               id="indiv-amount-${id}"
               class="amount-input indiv-amount-input"
               inputmode="numeric"
               pattern="[0-9]*"
               placeholder="0"
               maxlength="10"
               oninput="this.value=this.value.replace(/[^0-9]/g,'');recalcUnallocated()"
               aria-label="金額">
      </div>
      <label class="indiv-uncollected-label">
        <span class="indiv-uncollected-text">売掛</span>
        <label class="switch switch--small">
          <input type="checkbox" id="indiv-uc-${id}" class="indiv-uncollected-chk">
          <span class="switch-slider"></span>
        </label>
      </label>
    </div>
  `;
  container.appendChild(div);
  recalcUnallocated();
}

/* ── 顧客プルダウン変更 ──────────────────────────────────── */
function onCustomerSelectChange(id) {
  const sel    = document.querySelector(`.indiv-row[data-id="${id}"] .indiv-customer-select`);
  const manual = document.getElementById(`indiv-manual-${id}`);
  if (!sel || !manual) return;
  manual.hidden = sel.value !== '__manual__';
  if (manual.hidden) manual.value = '';
}

/* ── 個別行削除 ──────────────────────────────────────────── */
function removeIndividualRow(id) {
  document.querySelector(`.indiv-row[data-id="${id}"]`)?.remove();
  recalcUnallocated();
}

/* ── 残り未割当計算 ──────────────────────────────────────── */
function recalcUnallocated() {
  const toggle = document.getElementById('individual-toggle');
  if (!toggle?.checked) return;

  const total = parseInt(
    (document.getElementById('amount-input')?.value || '0').replace(/,/g, '')
  ) || 0;

  let rowTotal = 0;
  document.querySelectorAll('.indiv-amount-input').forEach(inp => {
    rowTotal += parseInt(inp.value.replace(/[^0-9]/g, '') || '0') || 0;
  });

  const unallocated = total - rowTotal;
  const el = document.getElementById('indiv-unallocated');
  if (!el) return;
  el.textContent = `残り未割当: ${formatYen(unallocated)}`;
  el.style.color = unallocated < 0 ? 'var(--uz-red)' : 'var(--uz-muted)';
}

/* ── 個別行データ収集 ────────────────────────────────────── */
function collectIndividualRows() {
  const rows = [];
  document.querySelectorAll('.indiv-row').forEach(row => {
    const id     = row.dataset.id;
    const sel    = row.querySelector('.indiv-customer-select');
    const manual = document.getElementById(`indiv-manual-${id}`);
    const amtEl  = document.getElementById(`indiv-amount-${id}`);
    const ucEl   = document.getElementById(`indiv-uc-${id}`);

    let customerName = sel?.value || '';
    if (customerName === '__misc__')  customerName = '諸口';
    if (customerName === '__manual__') customerName = manual?.value.trim() || '';

    const amount      = parseInt((amtEl?.value || '0').replace(/[^0-9]/g, '')) || 0;
    const uncollected = ucEl?.checked ?? false;

    rows.push({ customerName, amount, uncollected });
  });
  return rows;
}

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
  const svc      = getServiceMaster().find(s => s.code === selectedServiceCode);
  const mainUC   = document.getElementById('uncollected-toggle')?.checked ?? false;
  const indivOn  = document.getElementById('individual-toggle')?.checked ?? false;

  // ── バリデーション ──
  if (!date)       return showToast('日付を入力してください', 'error');
  if (!svc)        return showToast('サービスを選択してください', 'error');
  if (amount <= 0) return showToast('金額を入力してください', 'error');
  if (svc.code === 'S099' && !miscName) return showToast('品目名を入力してください', 'error');

  let indivRows = [];
  if (indivOn) {
    indivRows = collectIndividualRows();
    for (const r of indivRows) {
      if (!r.customerName) return showToast('顧客名を選択または入力してください', 'error');
      if (r.amount <= 0)   return showToast('個別行の金額を入力してください', 'error');
    }
    const rowTotal = indivRows.reduce((s, r) => s + r.amount, 0);
    if (rowTotal > amount) {
      return showToast(`個別合計（${formatYen(rowTotal)}）が売上合計を超えています`, 'error');
    }
  }

  // 売掛フラグ：メイントグル OR 個別行に1件でもON
  const anyRowUC = indivRows.some(r => r.uncollected);
  const finalUC  = mainUC || anyRowUC;
  const { taxExcluded, tax } = calcTax(amount, currentTaxRate);

  const mainPayload = {
    date,
    serviceCode:  svc.code,
    serviceName:  svc.name,
    miscItemName: miscName,
    amountExTax:  taxExcluded,
    taxRate:      currentTaxRate,
    tax,
    amountInTax:  amount,
    memo,
    uncollected:  finalUC ? 1 : 0,
  };

  isSubmitting = true;
  setSubmitLoading(true);

  try {
    // 1. 売上本体を登録
    const mainRes = await callGAS('addSales', mainPayload);
    if (mainRes.status !== 'ok') throw new Error(mainRes.message || '売上登録エラー');

    // 2. 個別行を並列登録
    if (indivOn && indivRows.length > 0) {
      const results = await Promise.all(
        indivRows.map(r => {
          const { taxExcluded: rEx, tax: rTax } = calcTax(r.amount, currentTaxRate);
          return callGAS('addSales', {
            date,
            serviceCode:  svc.code,
            serviceName:  svc.name,
            miscItemName: '',
            amountExTax:  rEx,
            taxRate:      currentTaxRate,
            tax:          rTax,
            amountInTax:  r.amount,
            memo:         r.customerName,
            uncollected:  r.uncollected ? 1 : 0,
          });
        })
      );
      const failed = results.filter(r => r.status !== 'ok');
      if (failed.length > 0) throw new Error('個別行の登録中にエラーが発生しました');
    }

    setSubmitLoading(false);
    showToast('売上を登録しました ✓', 'success');
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

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
