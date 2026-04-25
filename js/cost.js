/**
 * ウルトラ財務くん LEO版 PWA — cost.js
 * コスト入力画面ロジック（科目マスタ連携版）
 */

'use strict';

/* ── 状態 ────────────────────────────────────────────────── */
let costMaster           = [];  // getCostMaster()（app.js）から読み込む
let selectedDivisionCode = '1';
let selectedItemCode     = null;
let _costCurrentTaxRate       = 10;
let _costIsSubmitting         = false;

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
  if (document.body.classList.contains('is-ipad')) initIpadCostPanel();
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
  _costCurrentTaxRate = rate;

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
  const { taxExcluded, tax } = calcTax(taxIncluded, _costCurrentTaxRate);

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
  if (_costIsSubmitting) return;

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

  const { taxExcluded, tax } = calcTax(amount, _costCurrentTaxRate);

  const payload = {
    date,
    divisionCode: selectedDivisionCode,
    divisionName: divisionLabel(selectedDivisionCode),
    itemCode:     item.code,
    itemName:     item.name,
    taxRow:       item.taxRow ?? null,
    miscItemName: miscName,
    taxExcluded,
    taxRate:      _costCurrentTaxRate,
    tax,
    taxIncluded:  amount,
    memo,
    unpaid:       unpaid ? 1 : 0,
  };

  _costIsSubmitting = true;
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
    _costIsSubmitting = false;
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

/* ── iPad コスト入力パネル ─────────────────────────────────── */
let _ipadCostHistory = [];

async function initIpadCostPanel() {
  const wrap = document.getElementById('ipad-sc-wrap');
  if (!wrap) return;

  // form-body を「コストを追加」タブに移動
  const tabAdd   = document.getElementById('ipad-tab-add');
  const formBody = document.querySelector('.form-body');
  if (tabAdd && formBody) tabAdd.appendChild(formBody);

  // タブ切替バインド
  document.querySelectorAll('.ipad-tab').forEach(btn => {
    btn.addEventListener('click', () => _switchIpadCostTab(btn.dataset.tab));
  });

  const now          = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

  _initIpadCostFilterMonth(currentMonth);
  await _loadIpadCostData(currentMonth);
}

function _initIpadCostFilterMonth(currentMonth) {
  const sel = document.getElementById('ipad-filter-month');
  if (!sel) return;
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = `${d.getFullYear()}年${d.getMonth()+1}月`;
    sel.appendChild(opt);
  }
  sel.value = currentMonth;
  sel.addEventListener('change', () => _loadIpadCostData(sel.value));
  document.getElementById('ipad-filter-state')
    ?.addEventListener('change', () => _renderIpadCostList());
}

async function _loadIpadCostData(month) {
  const listEl = document.getElementById('ipad-cost-list');
  if (listEl) listEl.innerHTML = '<div class="ipad-list-empty">読み込み中...</div>';

  try {
    const histRes = await callGAS('getHistory', { type: 'cost', month }).catch(() => null);

    _ipadCostHistory = (histRes?.status === 'ok' && Array.isArray(histRes.data))
      ? histRes.data : [];

    const total      = _ipadCostHistory.reduce((s, r) => s + (r.taxIncluded ?? r.amount ?? 0), 0);
    const unpaidList = _ipadCostHistory.filter(r => r.unpaid || r.uncollected);

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('ipad-month-total',  formatYen(total));
    set('ipad-unpaid-count', unpaidList.length + '件');
    set('ipad-entry-count',  _ipadCostHistory.length + '件');

    _renderIpadCostList();
    _renderIpadPayableTab(unpaidList);
  } catch {
    if (listEl) listEl.innerHTML = '<div class="ipad-list-empty">読み込みエラー</div>';
  }
}

function _renderIpadCostList() {
  const listEl   = document.getElementById('ipad-cost-list');
  const stateVal = document.getElementById('ipad-filter-state')?.value || 'all';
  if (!listEl) return;

  let rows = _ipadCostHistory;
  if (stateVal === 'unpaid') rows = rows.filter(r => r.unpaid || r.uncollected);
  if (stateVal === 'locked') rows = rows.filter(r => r.locked);

  if (rows.length === 0) {
    listEl.innerHTML = '<div class="ipad-list-empty">データなし</div>';
    return;
  }

  listEl.innerHTML = rows.map((r, idx) => {
    const date     = String(r.date || '').replace(/(\d{4})-(\d{2})-(\d{2})/, '$2/$3');
    const name     = _costScEsc(r.itemName || r.item || r.service || '—');
    const amount   = formatYen(r.taxIncluded ?? r.amount ?? 0);
    const isUnpaid = !!(r.unpaid || r.uncollected);
    const isLocked = !!r.locked;
    let cls = 'ipad-list-row';
    if (isUnpaid) cls += ' ipad-list-row--unpaid';
    if (isLocked) cls += ' ipad-list-row--locked';
    const badge = isUnpaid
      ? `<span class="ipad-list-badge ipad-list-badge--unpaid">未払</span>`
      : isLocked
      ? `<span class="ipad-list-badge ipad-list-badge--locked">🔒</span>`
      : '';
    return `<div class="${cls}" data-idx="${idx}" onclick="_onIpadCostRowClick(${idx})">
      <span class="ipad-list-row__date">${date}</span>
      <span class="ipad-list-row__name">${name}</span>
      <span class="ipad-list-row__amount">${amount}</span>
      ${badge}
    </div>`;
  }).join('');
}

function _onIpadCostRowClick(idx) {
  document.querySelectorAll('#ipad-cost-list .ipad-list-row').forEach(el => {
    el.classList.toggle('ipad-list-row--selected', parseInt(el.dataset.idx) === idx);
  });
  const row = _ipadCostHistory[idx];
  if (row?.locked) showToast('この行はロックされています', 'info');
}

function _renderIpadPayableTab(unpaidList) {
  const listEl = document.getElementById('ipad-payable-list');
  if (!listEl) return;

  if (unpaidList.length === 0) {
    listEl.innerHTML = '<div class="ipad-list-empty">買掛データなし</div>';
    return;
  }

  listEl.innerHTML = unpaidList.map((r, idx) => {
    const date   = String(r.date || '').replace(/(\d{4})-(\d{2})-(\d{2})/, '$2/$3');
    const name   = _costScEsc(r.itemName || r.item || r.service || '—');
    const amount = formatYen(r.taxIncluded ?? r.amount ?? 0);
    return `<div class="ipad-unpaid-row" data-idx="${idx}">
      <div class="ipad-unpaid-row__info">
        <div class="ipad-unpaid-row__date">${date}</div>
        <div class="ipad-unpaid-row__name">${name}</div>
      </div>
      <span class="ipad-unpaid-row__amount">${amount}</span>
      <button class="ipad-clear-btn" type="button"
              onclick="_ipadClearCost(${idx}, this)">消込</button>
    </div>`;
  }).join('');
}

async function _ipadClearCost(idx, btn) {
  const unpaidList = _ipadCostHistory.filter(r => r.unpaid || r.uncollected);
  const row = unpaidList[idx];
  if (!row) return;

  btn.disabled = true;
  btn.textContent = '...';

  try {
    const result = await callGAS('reconcile', {
      sheetName:  'cost',
      rowIndex:   row.rowIndex ?? row.row ?? null,
      paidAmount: row.taxIncluded ?? row.amount ?? 0,
      paidDate:   todayStr(),
    });
    if (result.status !== 'ok') throw new Error(result.message || '消込エラー');
    btn.closest('.ipad-unpaid-row').remove();
    showToast('消込しました', 'success');
    const month = document.getElementById('ipad-filter-month')?.value;
    if (month) _loadIpadCostData(month);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '消込';
    showToast('消込に失敗しました：' + e.message, 'error');
  }
}

function _switchIpadCostTab(tab) {
  document.querySelectorAll('.ipad-tab').forEach(btn => {
    btn.classList.toggle('ipad-tab--active', btn.dataset.tab === tab);
  });
  const addEl     = document.getElementById('ipad-tab-add');
  const payableEl = document.getElementById('ipad-tab-payable');
  if (addEl)     addEl.style.display     = tab === 'add' ? '' : 'none';
  if (payableEl) payableEl.style.display = tab === 'add' ? 'none' : '';
}

function _costScEsc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ══════════════════════════════════════════════════════════════
   SheetModal 版 コスト入力（D案ハイブリッド）
   3デバイス統合仕様.md §6-3 準拠
   既存フルページ版（L1〜L457）とは完全独立・DOM / state / 関数名すべて別系統
   諸口・買掛・源泉徴収UI 実装済み
   ══════════════════════════════════════════════════════════════ */

// ── state ─────────────────────────────────────────────
let _smCostSelectedDivisionCode = '2';   // 初期値 = 販管費
let _smCostSelectedItemCode     = null;
let _smCostSelectedTaxRate      = null;
// 諸口・買掛
let _smCostMiscName             = '';
let _smCostUnpaid               = false;
// 源泉徴収（外注工賃・給料賃金 選択時のみ使用）
// settings.storeType が 'off' の場合は一切表示しない（納品時設定・戦略思想§3-2）
let _smCostWithholdingAmount    = 0;      // 計算結果または手入力値（実際にGASへ送る値）
let _smCostWithholdingDays      = null;   // hostess計算時の日数（当月日数を既定・手動上書き可）

// ── モーダル起動 ───────────────────────
/**
 * コスト入力シートモーダルを開く。
 * index.html の「コストを入れる」ボタンから呼ぶ。
 * window.openCostModal として露出し、DevTools Console からの手動起動も可能。
 */
async function openCostModal() {
  // 1. state をリセット（前回入力の残留防止・防御的）
  _smCostResetState();

  // 2. storeType を最新化（GAS同期）
  //    cost.js は他ファイルに依存しない自律設計のため、ここで getSettings を直接叩いて
  //    localStorage の uz_store_type を最新化する。
  //    通信失敗時はキャッシュ値（または 'off'）にフォールバック
  await _smCostSyncStoreType();

  // 3. HTML 生成
  const bodyHtml = _smCostBuildFormBodyHTML();

  // 4. SheetModal 基盤の存在確認（sales 側と同 API）
  if (typeof SheetModal === 'undefined' || typeof SheetModal.open !== 'function') {
    console.error('[cost SheetModal] SheetModal is not available');
    return;
  }

  // 5. モーダルを開く
  SheetModal.open({
    title:    'コスト登録',
    bodyHtml: bodyHtml,
    onRender: _smCostInitFormInModal,
    onClose:  _smCostResetState,
  });
}

/**
 * GAS getSettings を叩いて storeType を localStorage に同期
 * - 成功時：'hostess' / 'standard' / 'off' のいずれかを uz_store_type に保存
 * - 失敗時：既存キャッシュを維持（通信エラーで源泉徴収UIが消えるのを防ぐ）
 */
async function _smCostSyncStoreType() {
  try {
    if (typeof callGAS !== 'function') return;
    const res = await callGAS('getSettings', {});
    if (res && res.status === 'ok' && res.data && typeof res.data.storeType === 'string') {
      const st = res.data.storeType.toLowerCase();
      const normalized = (st === 'hostess' || st === 'standard') ? st : 'off';
      localStorage.setItem('uz_store_type', normalized);
    }
  } catch (e) {
    console.warn('[cost SheetModal] storeType 同期失敗（キャッシュ値を使用）:', e);
  }
}

// ── 状態リセット ───────────────────────────────────────
function _smCostResetState() {
  _smCostSelectedDivisionCode = '2';   // 初期値 = 販管費
  _smCostSelectedItemCode     = null;
  _smCostSelectedTaxRate      = null;
  _smCostMiscName             = '';
  _smCostUnpaid               = false;
  _smCostWithholdingAmount    = 0;
  _smCostWithholdingDays      = null;
}

// ── モーダル HTML 生成 ───────────────────────────────
function _smCostBuildFormBodyHTML() {
  const today = todayStr();
  return `
    <div class="cost-sm-body">

      <section class="cost-sm-section">
        <label class="cost-sm-label" for="sm-cost-date">日付</label>
        <input type="date" id="sm-cost-date" class="sm-date-input" value="${today}">
      </section>

      <section class="cost-sm-section">
        <label class="cost-sm-label">区分</label>
        <div class="cost-sm-division-tabs" role="group" aria-label="区分選択">
          <button type="button" class="cost-sm-division-tab" data-division-code="1">仕入原価</button>
          <button type="button" class="cost-sm-division-tab cost-sm-division-tab--active" data-division-code="2">販管費</button>
        </div>
      </section>

      <section class="cost-sm-section">
        <label class="cost-sm-label">科目を選択</label>
        <div id="sm-cost-item-cards" class="cost-sm-cards"></div>
      </section>

      <!-- 諸口科目名（諸口選択時のみ表示） -->
      <section class="cost-sm-section" id="sm-cost-misc-section" hidden>
        <label class="cost-sm-label" for="sm-cost-misc-name">科目名</label>
        <input type="text"
               id="sm-cost-misc-name"
               class="cost-sm-memo"
               maxlength="40"
               autocomplete="off"
               placeholder="例：備品購入">
      </section>

      <section class="cost-sm-section">
        <div class="sm-taxrate-chips" role="group" aria-label="税率選択">
          <button type="button" class="sm-taxrate-chip" data-tax-rate="10">10%</button>
          <button type="button" class="sm-taxrate-chip" data-tax-rate="8">8%</button>
          <button type="button" class="sm-taxrate-chip" data-tax-rate="0">非課税</button>
        </div>
      </section>

      <section class="cost-sm-section">
        <label class="cost-sm-label" for="sm-cost-amount">金額(税込)</label>
        <div class="cost-sm-amount-wrap">
          <input type="text"
                 id="sm-cost-amount"
                 class="cost-sm-amount-input"
                 inputmode="numeric"
                 placeholder="0"
                 maxlength="12"
                 autocomplete="off">
          <span class="cost-sm-yen">円</span>
        </div>
        <div id="sm-cost-tax-memo" class="sm-tax-memo">内消費税 0 円</div>
      </section>

      <!-- 源泉徴収セクション（外注工賃／給料賃金 選択時のみ・storeType!=off の場合のみ表示） -->
      <section class="cost-sm-section" id="sm-cost-withholding-section" hidden>
        <label class="cost-sm-label">源泉徴収額</label>

        <!-- hostess/standard計算結果の表示（外注工賃選択時） -->
        <div id="sm-cost-withholding-calc" hidden>
          <div class="cost-sm-wh-row" id="sm-cost-wh-days-row" hidden>
            <span class="cost-sm-wh-label">計算期間の日数</span>
            <input type="number"
                   id="sm-cost-wh-days"
                   class="cost-sm-wh-days-input"
                   min="1" max="31"
                   inputmode="numeric">
            <span class="cost-sm-wh-unit">日</span>
          </div>
          <div class="cost-sm-wh-calc-result" id="sm-cost-wh-calc-result">源泉徴収額 0 円</div>
          <div class="cost-sm-wh-formula" id="sm-cost-wh-formula"></div>
        </div>

        <!-- employed（給料賃金）の手入力欄 -->
        <div id="sm-cost-withholding-manual" hidden>
          <div class="cost-sm-amount-wrap">
            <input type="text"
                   id="sm-cost-wh-manual"
                   class="cost-sm-amount-input"
                   inputmode="numeric"
                   placeholder="0"
                   maxlength="10"
                   autocomplete="off">
            <span class="cost-sm-yen">円</span>
          </div>
          <div class="sm-tax-memo">給与所得の源泉徴収額を手入力（税額表の自動計算は搭載しません）</div>
        </div>
      </section>

      <!-- 買掛トグル -->
      <section class="cost-sm-section">
        <label class="cost-sm-unpaid-toggle">
          <input type="checkbox" id="sm-cost-unpaid">
          <span>買掛（未払い）として登録する</span>
        </label>
      </section>

      <section class="cost-sm-section">
        <label class="cost-sm-label" for="sm-cost-memo">メモ<span class="cost-sm-optional">(任意)</span></label>
        <input type="text"
               id="sm-cost-memo"
               class="cost-sm-memo"
               maxlength="200"
               autocomplete="off">
      </section>

      <div class="cost-sm-footer">
        <button type="button" id="sm-cost-submit" class="cost-sm-submit-btn">登録する</button>
      </div>

    </div>`;
}

// ── モーダル初期化 ─────────────────────
/**
 * SheetModal.open の onRender コールバックから引数なしで呼ばれる。
 * この時点でモーダル DOM は document に挿入済みのため、
 * document.getElementById / document.querySelectorAll が利用可能。
 */
function _smCostInitFormInModal() {
  // 1. 状態を初期化（次回オープン時の確実なリセットを保証）
  _smCostSelectedDivisionCode = '2';
  _smCostSelectedItemCode     = null;
  _smCostSelectedTaxRate      = null;
  _smCostMiscName             = '';
  _smCostUnpaid               = false;
  _smCostWithholdingAmount    = 0;
  _smCostWithholdingDays      = null;

  // 2. 科目カードの初期レンダリング（販管費＝divisionCode:'2'）
  _smCostRenderItemCards('2');

  // 3. 各要素のイベントバインド
  _smCostBindDivisionTabs();
  _smCostBindTaxChips();
  _smCostBindAmountInput();
  _smCostBindSubmit();
  _smCostBindMemoInput();
  _smCostBindDateInput();
  _smCostBindMiscNameInput();
  _smCostBindUnpaidToggle();
  _smCostBindWithholdingInputs();

  // 4. 内消費税メモを初期表示（税率未選択なので 0円 表示）
  _smCostRecalcTaxMemo();
}

// ── 区分タブ関連 ───────────────────────
function _smCostBindDivisionTabs() {
  document.querySelectorAll('.cost-sm-division-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const divisionCode = tab.dataset.divisionCode;
      if (!divisionCode) return;
      if (divisionCode === _smCostSelectedDivisionCode) return; // 同一タブなら何もしない
      _smCostSelectDivision(divisionCode);
    });
  });
}

function _smCostSelectDivision(divisionCode) {
  // 1. state 更新
  _smCostSelectedDivisionCode = divisionCode;

  // 2. 区分タブの --active 付け替え
  document.querySelectorAll('.cost-sm-division-tab').forEach(tab => {
    tab.classList.toggle(
      'cost-sm-division-tab--active',
      tab.dataset.divisionCode === divisionCode
    );
  });

  // 3. 科目選択と税率選択をリセット（区分切替で選択を持ち越さない）
  _smCostSelectedItemCode = null;
  _smCostSelectedTaxRate  = null;
  _smCostWithholdingAmount = 0;
  _smCostWithholdingDays   = null;

  // 4. 科目カードを再描画
  _smCostRenderItemCards(divisionCode);

  // 5. 税率チップの is-active を全て解除
  document.querySelectorAll('.sm-taxrate-chip').forEach(chip => {
    chip.classList.remove('is-active');
  });

  // 6. 諸口科目名セクションを隠す・値クリア
  const miscSection = document.getElementById('sm-cost-misc-section');
  if (miscSection) miscSection.hidden = true;
  _smCostMiscName = '';
  const miscInput = document.getElementById('sm-cost-misc-name');
  if (miscInput) miscInput.value = '';

  // 7. 源泉徴収UIを隠す（科目未選択状態に戻る）
  _smCostUpdateWithholdingUI();

  // 8. 内消費税メモを再計算（税率 null → 0円表示）
  _smCostRecalcTaxMemo();

  // 9. エラー枠解除
  document.querySelectorAll('.cost-sm-field-error').forEach(el => {
    el.classList.remove('cost-sm-field-error');
  });
}

function _smCostRenderItemCards(divisionCode) {
  const container = document.getElementById('sm-cost-item-cards');
  if (!container) return;

  // getDivisionItems は既存のフルページ版ヘルパー（L21〜L36）
  // 返り値：指定区分の科目配列（末尾に諸口 MISC_1 / MISC_2 が動的追加済み・空 name はフィルタ済み）
  const items = getDivisionItems(divisionCode);

  container.innerHTML = items.map(item => {
    const isActive = item.code === _smCostSelectedItemCode;
    return `
      <button type="button"
              class="cost-sm-card${isActive ? ' cost-sm-card--active' : ''}"
              data-item-code="${escHtml(item.code)}">
        <span class="cost-sm-card__label">${escHtml(item.name)}</span>
      </button>
    `;
  }).join('');

  // カード click イベントを再バインド（innerHTML 書き換えで失われるため毎回）
  container.querySelectorAll('.cost-sm-card').forEach(card => {
    card.addEventListener('click', () => {
      const itemCode = card.dataset.itemCode;
      if (itemCode) _smCostSelectItem(itemCode);
    });
  });
}

// ── 科目カード・税率チップ ─────────────
function _smCostSelectItem(itemCode) {
  // 1. state 更新
  _smCostSelectedItemCode = itemCode;

  // 2. カードの --active 付け替え
  document.querySelectorAll('.cost-sm-card').forEach(card => {
    card.classList.toggle(
      'cost-sm-card--active',
      card.dataset.itemCode === itemCode
    );
  });

  // 3. 選択された科目オブジェクトを取得
  const items = getDivisionItems(_smCostSelectedDivisionCode);
  const selectedItem = items.find(it => it.code === itemCode);
  if (!selectedItem) return;

  // 4. 諸口判定
  const isMisc = selectedItem.type === 'misc';

  // 諸口科目名セクションの出し分け
  const miscSection = document.getElementById('sm-cost-misc-section');
  if (miscSection) {
    miscSection.hidden = !isMisc;
    if (!isMisc) {
      // 諸口以外に切り替わったら入力値もクリア
      _smCostMiscName = '';
      const miscInput = document.getElementById('sm-cost-misc-name');
      if (miscInput) miscInput.value = '';
    }
  }

  if (isMisc) {
    // 諸口特例：全税率チップを未選択にする
    _smCostSelectedTaxRate = null;
    document.querySelectorAll('.sm-taxrate-chip').forEach(chip => {
      chip.classList.remove('is-active');
    });
  } else {
    // 通常科目：マスタの taxRate を自動選択
    _smCostSetTaxRate(selectedItem.taxRate);
  }

  // 5. 源泉徴収UIの表示切替（科目に応じて）
  _smCostUpdateWithholdingUI();

  // 6. 内消費税メモを再計算
  _smCostRecalcTaxMemo();

  // 7. エラー枠解除
  const cardsContainer = document.getElementById('sm-cost-item-cards');
  if (cardsContainer) cardsContainer.classList.remove('cost-sm-field-error');
}

function _smCostSetTaxRate(taxRate) {
  _smCostSelectedTaxRate = taxRate;

  // 税率チップの is-active 付け替え(sales 側と共通 CSS を流用)
  document.querySelectorAll('.sm-taxrate-chip').forEach(chip => {
    const chipRate = Number(chip.dataset.taxRate);
    chip.classList.toggle('is-active', chipRate === taxRate);
  });

  _smCostRecalcTaxMemo();

  // 税率チップ群のエラー枠解除
  const chipsContainer = document.querySelector('.sm-taxrate-chips');
  if (chipsContainer) chipsContainer.classList.remove('cost-sm-field-error');
}

function _smCostBindTaxChips() {
  document.querySelectorAll('.sm-taxrate-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const taxRate = Number(chip.dataset.taxRate);
      if (!Number.isFinite(taxRate)) return;
      _smCostSetTaxRate(taxRate);
    });
  });
}

// ── 金額・内消費税 ─────────────────────
function _smCostBindAmountInput() {
  const input = document.getElementById('sm-cost-amount');
  if (!input) return;

  input.addEventListener('input', () => {
    // 1. 数字以外を除去
    const raw = input.value.replace(/[^\d]/g, '');
    // 2. 千円区切りフォーマット
    const formatted = raw ? Number(raw).toLocaleString('ja-JP') : '';
    if (input.value !== formatted) {
      input.value = formatted;
    }
    // 3. 内消費税メモ再計算
    _smCostRecalcTaxMemo();
    // 4. 源泉徴収の計算も連動（外注工賃選択時のみ）
    _smCostRecalcWithholding();
    // 5. エラー枠解除
    input.classList.remove('cost-sm-field-error');
  });
}

function _smCostRecalcTaxMemo() {
  const input = document.getElementById('sm-cost-amount');
  const memo  = document.getElementById('sm-cost-tax-memo');
  if (!input || !memo) return;

  const raw = input.value.replace(/[^\d]/g, '');
  const amountInTax = raw ? Number(raw) : 0;

  let taxAmount = 0;
  if (amountInTax > 0 && _smCostSelectedTaxRate !== null) {
    // calcTax は js/app.js の既存ヘルパー（税込→税抜逆算）
    // 3デバイス統合仕様§6-4 準拠：税抜 = floor(税込 / (1 + 税率/100))、内消費税 = 税込 − 税抜
    const result = calcTax(amountInTax, _smCostSelectedTaxRate);
    taxAmount = result.tax;
  }

  memo.textContent = `内消費税 ${taxAmount.toLocaleString('ja-JP')} 円`;
}

// ── バリデーション・送信 ───────────────
/**
 * バリデーション順序：日付→区分→科目→（諸口なら科目名）→税率→金額
 * 返り値：{ ok: true } or { ok: false, errorTarget: Element|null, errorMsg: string }
 */
function _smCostValidate() {
  const dateEl  = document.getElementById('sm-cost-date');
  const dateVal = dateEl ? dateEl.value : '';
  if (!dateVal) {
    return { ok: false, errorTarget: dateEl, errorMsg: '日付を入力してください' };
  }

  if (!_smCostSelectedDivisionCode) {
    const tabs = document.querySelector('.cost-sm-division-tabs');
    return { ok: false, errorTarget: tabs, errorMsg: '区分を選択してください' };
  }

  if (!_smCostSelectedItemCode) {
    const cards = document.getElementById('sm-cost-item-cards');
    return { ok: false, errorTarget: cards, errorMsg: '科目を選択してください' };
  }

  // 諸口選択時は科目名必須
  const items = getDivisionItems(_smCostSelectedDivisionCode);
  const selectedItem = items.find(it => it.code === _smCostSelectedItemCode);
  if (selectedItem && selectedItem.type === 'misc') {
    const miscInput = document.getElementById('sm-cost-misc-name');
    const miscName  = miscInput ? miscInput.value.trim() : '';
    if (!miscName) {
      return { ok: false, errorTarget: miscInput, errorMsg: '科目名を入力してください' };
    }
  }

  if (_smCostSelectedTaxRate === null) {
    const chips = document.querySelector('.sm-taxrate-chips');
    return { ok: false, errorTarget: chips, errorMsg: '税率を選択してください' };
  }

  const amountEl  = document.getElementById('sm-cost-amount');
  const amountRaw = amountEl ? amountEl.value.replace(/[^\d]/g, '') : '';
  const amount    = amountRaw ? Number(amountRaw) : 0;
  if (amount <= 0) {
    return { ok: false, errorTarget: amountEl, errorMsg: '金額を入力してください' };
  }

  return { ok: true };
}

async function _smCostHandleSubmit() {
  const btn = document.getElementById('sm-cost-submit');
  if (!btn || btn.disabled) return;

  // 1. バリデーション
  const validation = _smCostValidate();
  if (!validation.ok) {
    if (validation.errorTarget) {
      validation.errorTarget.classList.add('cost-sm-field-error');
    }
    _smCostShowToast(validation.errorMsg);
    return;
  }

  // 2. 送信値取得
  const dateVal     = document.getElementById('sm-cost-date').value;
  const amountRaw   = document.getElementById('sm-cost-amount').value.replace(/[^\d]/g, '');
  const amountInTax = Number(amountRaw);
  const memoEl      = document.getElementById('sm-cost-memo');
  const memoVal     = memoEl ? memoEl.value : '';
  const miscInput   = document.getElementById('sm-cost-misc-name');
  const miscName    = miscInput && !miscInput.closest('section').hidden
    ? miscInput.value.trim()
    : '';
  const unpaidEl    = document.getElementById('sm-cost-unpaid');
  const unpaidVal   = unpaidEl ? (unpaidEl.checked ? 1 : 0) : 0;

  const items        = getDivisionItems(_smCostSelectedDivisionCode);
  const selectedItem = items.find(it => it.code === _smCostSelectedItemCode);
  if (!selectedItem) {
    _smCostShowToast('科目が不正です');
    return;
  }

  // 3. 税額計算（3デバイス統合仕様§6-4）
  const { taxExcluded, tax } = calcTax(amountInTax, _smCostSelectedTaxRate);

  // 4. 源泉徴収額の確定（UIが出ていない場合は0）
  const whSection = document.getElementById('sm-cost-withholding-section');
  const whVisible = whSection && !whSection.hidden;
  const withholdingAmount = whVisible ? (Number(_smCostWithholdingAmount) || 0) : 0;

  // 5. payload 組立（clientId は箱だけ用意・現フェーズでは空文字固定）
  const payload = {
    date:              dateVal,
    divisionCode:      _smCostSelectedDivisionCode,
    divisionName:      divisionLabel(_smCostSelectedDivisionCode),
    itemCode:          selectedItem.code,
    itemName:          selectedItem.name,
    miscItemName:      miscName,
    taxExcluded:       taxExcluded,
    taxRate:           _smCostSelectedTaxRate,
    tax:               tax,
    taxIncluded:       amountInTax,
    memo:              memoVal,
    unpaid:            unpaidVal,
    withholdingAmount: withholdingAmount,
    clientId:          '',   // Phase A 管理ポータル実装時に実値を入れる・現時点は空
  };

  // 6. GAS 送信
  _smCostSetSubmitLoading(true);
  try {
    const result = await callGAS('addCost', payload);
    if (result?.status !== 'ok') {
      throw new Error(result?.message || '登録エラー');
    }

    if (typeof showToast === 'function') {
      showToast('コストを登録しました ✓', 'success');
    }
    SheetModal.close();
    if (typeof loadAll === 'function') loadAll();

  } catch (err) {
    console.error('[cost SheetModal] addCost error:', err);
    _smCostShowToast('登録に失敗しました：' + (err?.message || '通信エラー'));
  } finally {
    _smCostSetSubmitLoading(false);
  }
}

function _smCostSetSubmitLoading(loading) {
  const btn = document.getElementById('sm-cost-submit');
  if (!btn) return;  // モーダルクローズ後は要素が消えているため null ガード
  btn.disabled    = loading;
  btn.textContent = loading ? '送信中...' : '登録する';
}

/**
 * コスト専用トースト（B-1 準拠・独立実装）
 * モーダル内下部に赤系バナーを fixed 表示・3秒で自動消去
 */
function _smCostShowToast(message) {
  // 既存のコストトーストを削除（連続表示でのスタック防止）
  document.querySelectorAll('.cost-sm-toast').forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className   = 'cost-sm-toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

function _smCostBindSubmit() {
  const btn = document.getElementById('sm-cost-submit');
  if (!btn) return;
  btn.addEventListener('click', () => _smCostHandleSubmit());
}

function _smCostBindMemoInput() {
  const memo = document.getElementById('sm-cost-memo');
  if (!memo) return;
  memo.addEventListener('input', () => {
    memo.classList.remove('cost-sm-field-error');
  });
}

function _smCostBindDateInput() {
  const date = document.getElementById('sm-cost-date');
  if (!date) return;
  const removeErr = () => date.classList.remove('cost-sm-field-error');
  date.addEventListener('change', removeErr);
  date.addEventListener('input',  removeErr);
}

// ── 諸口科目名入力のバインド ─────────────────────────
function _smCostBindMiscNameInput() {
  const el = document.getElementById('sm-cost-misc-name');
  if (!el) return;
  el.addEventListener('input', () => {
    _smCostMiscName = el.value.trim();
    el.classList.remove('cost-sm-field-error');
  });
}

// ── 買掛トグルのバインド ─────────────────────────────
function _smCostBindUnpaidToggle() {
  const el = document.getElementById('sm-cost-unpaid');
  if (!el) return;
  el.addEventListener('change', () => {
    _smCostUnpaid = el.checked;
  });
}

// ══════════════════════════════════════════════════════
// 源泉徴収機能（戦略思想§3-2・システム仕様書§8-5 準拠）
// ══════════════════════════════════════════════════════

/**
 * 源泉徴収UIを出す対象科目コード
 * - '21': 外注工賃 → hostess または standard 計算式（storeTypeで決定）
 * - '20': 給料賃金 → 手入力のみ（計算式なし・税額表は搭載しない）
 * 仕様書§8-5・グレード詳細一覧§2-5 に基づく
 */
/**
 * settings.storeType を localStorage から直接読む（cost.js 単独で完結）
 * settings.js のグローバル関数 getStoreType() への依存を持たない設計
 * - 'hostess' / 'standard' のいずれかなら正規化して返す
 * - 未設定・不正値は 'off' に寄せる（源泉徴収機能OFF・安全側）
 *
 * localStorage への書き込みは settings.js 起動時の loadSettingsFromGAS が担当する
 * 各ページで cost モーダルが開かれた時点で、既に GAS 同期済みのキャッシュが入っている前提
 */
function _smCostReadStoreType() {
  try {
    const raw = (localStorage.getItem('uz_store_type') || '').toLowerCase();
    if (raw === 'hostess' || raw === 'standard') return raw;
  } catch (_) {}
  return 'off';
}

function _smCostGetWithholdingMode(itemCode) {
  const storeType = _smCostReadStoreType();
  if (storeType === 'off') return 'none';           // 機能OFF
  if (itemCode === '21') return storeType;          // 'hostess' or 'standard'
  if (itemCode === '20') return 'manual';           // 給料賃金：手入力
  return 'none';
}

/**
 * 当月日数を返す（hostess計算の既定値）
 * モーダル内の日付入力が指す月の日数
 */
function _smCostGetDaysInMonthOfInput() {
  const dateEl = document.getElementById('sm-cost-date');
  const val = dateEl ? dateEl.value : '';
  const parts = val.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!y || !m) {
    // フォールバック：現在月の日数
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  }
  return new Date(y, m, 0).getDate();
}

/**
 * 源泉徴収UIの表示切替（科目変更時・区分切替時に呼ばれる）
 */
function _smCostUpdateWithholdingUI() {
  const section    = document.getElementById('sm-cost-withholding-section');
  const calcBox    = document.getElementById('sm-cost-withholding-calc');
  const manualBox  = document.getElementById('sm-cost-withholding-manual');
  const daysRow    = document.getElementById('sm-cost-wh-days-row');
  const formulaEl  = document.getElementById('sm-cost-wh-formula');
  if (!section || !calcBox || !manualBox) return;

  const mode = _smCostGetWithholdingMode(_smCostSelectedItemCode);

  if (mode === 'none') {
    section.hidden   = true;
    calcBox.hidden   = true;
    manualBox.hidden = true;
    _smCostWithholdingAmount = 0;
    return;
  }

  section.hidden = false;

  if (mode === 'manual') {
    // 給料賃金：手入力のみ
    calcBox.hidden   = true;
    manualBox.hidden = false;
    // 手入力欄の現在値を反映
    const manualInput = document.getElementById('sm-cost-wh-manual');
    _smCostWithholdingAmount = manualInput
      ? (Number(String(manualInput.value).replace(/[^\d]/g, '')) || 0)
      : 0;
    return;
  }

  // hostess / standard：計算式ベース
  calcBox.hidden   = false;
  manualBox.hidden = true;

  // 日数行は hostess のみ表示
  if (daysRow) daysRow.hidden = (mode !== 'hostess');

  // 日数既定値の設定（まだ入っていなければ当月日数をセット）
  if (mode === 'hostess') {
    const daysInput = document.getElementById('sm-cost-wh-days');
    if (daysInput && (!daysInput.value || _smCostWithholdingDays === null)) {
      const defaultDays = _smCostGetDaysInMonthOfInput();
      daysInput.value = String(defaultDays);
      _smCostWithholdingDays = defaultDays;
    }
  }

  // 計算式の説明表示
  if (formulaEl) {
    if (mode === 'hostess') {
      formulaEl.textContent = '(支払額 − 5,000円 × 日数) × 10.21%';
    } else {
      formulaEl.textContent = '支払額 × 10.21%（100万円超部分は20.42%）';
    }
  }

  _smCostRecalcWithholding();
}

/**
 * 源泉徴収額を再計算して表示（金額・日数変更時にも呼ばれる）
 */
function _smCostRecalcWithholding() {
  const mode = _smCostGetWithholdingMode(_smCostSelectedItemCode);
  const resultEl = document.getElementById('sm-cost-wh-calc-result');

  if (mode === 'none') {
    _smCostWithholdingAmount = 0;
    return;
  }

  if (mode === 'manual') {
    // 手入力モード：入力値をそのまま state に反映
    const manualInput = document.getElementById('sm-cost-wh-manual');
    const raw = manualInput ? String(manualInput.value).replace(/[^\d]/g, '') : '';
    _smCostWithholdingAmount = raw ? Number(raw) : 0;
    return;
  }

  // 支払額（税込）を取得
  const amountInput = document.getElementById('sm-cost-amount');
  const amountRaw = amountInput ? String(amountInput.value).replace(/[^\d]/g, '') : '';
  const amount = amountRaw ? Number(amountRaw) : 0;

  let withholding = 0;
  if (amount > 0) {
    if (mode === 'hostess') {
      const days = _smCostWithholdingDays != null ? _smCostWithholdingDays : _smCostGetDaysInMonthOfInput();
      const base = amount - (5000 * days);
      withholding = base > 0 ? Math.floor(base * 0.1021) : 0;
    } else if (mode === 'standard') {
      // 100万円超部分は20.42%
      if (amount <= 1000000) {
        withholding = Math.floor(amount * 0.1021);
      } else {
        const over = amount - 1000000;
        withholding = Math.floor(1000000 * 0.1021 + over * 0.2042);
      }
    }
  }

  _smCostWithholdingAmount = withholding;
  if (resultEl) {
    resultEl.textContent = `源泉徴収額 ${withholding.toLocaleString('ja-JP')} 円`;
  }
}

/**
 * 源泉徴収UIの各入力要素をバインド
 * - 日数入力（hostess計算時の手動上書き）
 * - 手入力欄（給料賃金選択時）
 */
function _smCostBindWithholdingInputs() {
  const daysInput = document.getElementById('sm-cost-wh-days');
  if (daysInput) {
    daysInput.addEventListener('input', () => {
      const v = Number(String(daysInput.value).replace(/[^\d]/g, ''));
      if (v >= 1 && v <= 31) {
        _smCostWithholdingDays = v;
      } else {
        _smCostWithholdingDays = null;
      }
      _smCostRecalcWithholding();
    });
  }

  const manualInput = document.getElementById('sm-cost-wh-manual');
  if (manualInput) {
    manualInput.addEventListener('input', () => {
      const raw = String(manualInput.value).replace(/[^\d]/g, '');
      manualInput.value = raw ? Number(raw).toLocaleString('ja-JP') : '';
      _smCostWithholdingAmount = raw ? Number(raw) : 0;
    });
  }
}

// ── グローバル露出 ───────────────
// index.html からの onclick="openCostModal()" 呼び出しに対応するため window に露出
window.openCostModal = openCostModal;
