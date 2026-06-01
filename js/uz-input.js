/**
 * uz-input.js — 売上・コスト入力フォーム（正本・積層ステッパー・単一系統）
 * ==================================================================
 * 02_画面仕様.md §5-10。入力フォームの唯一の正本エンジン。
 * スマホモーダル・iPad月次管理右カラム・iPad取引(履歴)右カラムの全面で、
 * 本エンジンが .uzf-host に同一の積層ステッパーを描画する（単一系統共有）。
 *
 * 設計（02 §5-10 / §5-9）：
 *   ・選択タブは固定、選択済み項目（発生日・区分/科目・税率・金額）は
 *     上部に積層して常時可視。テンキー入力中も選択を覆わない。
 *   ・確定（登録）ボタンを押すまで一連で視認できる。
 *   ・OSキーボード/OSカレンダーを一切呼ばない（自作テンキー・自作カレンダー）。
 *   ・配色はモノトーン濃淡のみ（uz-input.css・トークン経由）。
 *
 * 依存（全てグローバル）：getServiceMaster / getDivisionItems / calcTax /
 *   callGAS / todayStr / formatYen / showToast。送信は callGAS('addSales'/'addCost')。
 *
 * 公開：
 *   UzInput.mount(hostEl, kind, { onSubmitted, autoClose })  欄に常設描画
 *   UzInput.openModal(kind, { onSubmitted })                 SheetModal で開く
 * 既存の openSalesModal / openCostModal はホーム・取引タブのボタンが呼ぶため、
 * 本エンジンのモーダル起動に差し替える（sales.js / cost.js を編集しない）。
 */
'use strict';

(function () {
  const ESC = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const fmtAmt = v => {
    const n = parseInt(String(v ?? '').replace(/[^0-9]/g, ''), 10);
    return '¥' + (isNaN(n) ? 0 : n).toLocaleString('ja-JP');
  };
  const fmtDate = s => (s ? String(s).replace(/-/g, '/') : '');
  const today = () => (typeof todayStr === 'function')
    ? todayStr() : new Date().toISOString().slice(0, 10);
  const isMisc = code => /MISC/i.test(String(code || ''));
  const divLabel = code => (code === '1' ? '仕入原価' : '販管費');

  function newState(kind) {
    const base = {
      kind, date: today(), taxRate: null, miscName: '',
      amount: '', memo: '', unpaid: false, editing: 'item',
      calView: null, opts: {},
    };
    if (kind === 'sales') Object.assign(base, { svcCode: '', svcName: '' });
    else Object.assign(base, { divCode: '2', itemCode: '', itemName: '' });
    return base;
  }

  function itemResolved(s) {
    return s.kind === 'sales' ? !!s.svcCode : !!s.itemCode;
  }

  function getItems(s) {
    try {
      if (s.kind === 'sales') {
        return (typeof getServiceMaster === 'function') ? getServiceMaster() : [];
      }
      return (typeof getDivisionItems === 'function')
        ? getDivisionItems(s.divCode, { filterBySmartphoneVisible: true }) : [];
    } catch (_) { return []; }
  }

  /* ── 描画 ─────────────────────────────────────────────── */
  function render(host) {
    const s = host.__uzf;
    if (!s) return;

    const itemLabel = s.kind === 'sales'
      ? (s.svcName ? s.svcName + (s.miscName ? `（${s.miscName}）` : '') : '')
      : (s.itemName ? `${divLabel(s.divCode)}／${s.itemName}` + (s.miscName ? `（${s.miscName}）` : '') : '');

    const blocks = [];
    blocks.push(chip('date', '発生日', fmtDate(s.date)));
    if (itemResolved(s)) {
      const taxTxt = s.taxRate != null ? `（${s.taxRate === 0 ? '非課税' : s.taxRate + '%'}）` : '';
      blocks.push(chip('item', s.kind === 'sales' ? '区分' : '科目', itemLabel + taxTxt));
    }
    if (s.amount && parseInt(s.amount, 10) > 0) {
      blocks.push(chip('amount', '金額', fmtAmt(s.amount)));
    }

    let editor = '';
    if (s.editing === 'date') editor = editorDate();
    else if (s.editing === 'item') editor = editorItem(s);
    else if (s.editing === 'amount') editor = editorAmount(s);

    const ready = itemResolved(s) && s.amount && parseInt(s.amount, 10) > 0;
    const tail = ready ? editorTail(s) : '';

    const canReset = itemResolved(s) || (s.amount && parseInt(s.amount, 10) > 0);
    const resetBtn = canReset ? `<button type="button" class="uzf-reset">入力をリセット</button>` : '';

    host.innerHTML =
      `<div class="uzf-stack">${blocks.join('')}</div>` +
      `<div class="uzf-editor">${editor}</div>` +
      resetBtn + tail;

    bind(host);
  }

  function chip(step, label, value) {
    return `<button type="button" class="uzf-chip" data-step="${step}">
      <span class="uzf-chip-k">${label}</span>
      <span class="uzf-chip-v">${ESC(value || '未入力')}</span>
      <span class="uzf-chip-edit">変更</span>
    </button>`;
  }

  function editorDate() {
    return `<div class="uzf-ed-head">発生日を選択</div><div class="uzf-cal"></div>`;
  }

  function editorItem(s) {
    let divTabs = '';
    if (s.kind === 'cost') {
      divTabs = `<div class="uzf-divtabs">
        <button type="button" class="uzf-divtab ${s.divCode === '1' ? 'is-active' : ''}" data-div="1">仕入原価</button>
        <button type="button" class="uzf-divtab ${s.divCode === '2' ? 'is-active' : ''}" data-div="2">販管費</button>
      </div>`;
    }
    const items = getItems(s);
    const sel = s.kind === 'sales' ? s.svcCode : s.itemCode;
    // 列数：売上品目・仕入原価科目は2列、件数が多い販管費（区分2）のみ3列。
    const colsCls = (s.kind === 'cost' && s.divCode === '2') ? 'uzf-cards--3' : 'uzf-cards--2';
    const cards = items.map(it => `
      <button type="button" class="uzf-card ${it.code === sel ? 'is-active' : ''}" data-code="${ESC(it.code)}" data-name="${ESC(it.name)}" data-tax="${it.taxRate ?? 10}">
        ${ESC(it.name)}
      </button>`).join('');
    const miscBox = (sel && isMisc(sel))
      ? `<div class="uzf-misc"><label class="uzf-misc-label">品目名（任意）</label>
          <input type="text" class="uzf-misc-input" maxlength="50" value="${ESC(s.miscName)}" placeholder="例：手土産代"></div>`
      : '';
    const taxChips = sel
      ? `<div class="uzf-ed-sub">税率</div>
         <div class="uzf-taxchips">
           ${[10, 8, 0].map(r => `<button type="button" class="uzf-taxchip ${s.taxRate === r ? 'is-active' : ''}" data-rate="${r}">${r === 0 ? '非課税' : r + '%'}</button>`).join('')}
         </div>` : '';
    return `${divTabs}
      <div class="uzf-ed-head">${s.kind === 'sales' ? 'サービスを選択' : '科目を選択'}</div>
      <div class="uzf-cards ${colsCls}">${cards}</div>
      ${miscBox}${taxChips}`;
  }

  function editorAmount(s) {
    const disp = s.amount ? fmtAmt(s.amount) : '¥0';
    const tax = (s.taxRate != null && s.amount && typeof calcTax === 'function')
      ? calcTax(parseInt(s.amount, 10), s.taxRate).tax : 0;
    const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', 'del'];
    const keyHtml = keys.map(k => k === 'del'
      ? `<button type="button" class="uzf-key uzf-key--del" data-key="del">←</button>`
      : `<button type="button" class="uzf-key" data-key="${k}">${k}</button>`).join('');
    return `<div class="uzf-ed-head">金額（税込）</div>
      <div class="uzf-amount-disp">${disp}<span class="uzf-amount-yen">円</span></div>
      <div class="uzf-amount-tax">内消費税 ${tax.toLocaleString('ja-JP')} 円</div>
      <div class="uzf-keypad">${keyHtml}
        <button type="button" class="uzf-key uzf-key--clear" data-key="clear">クリア</button>
      </div>`;
  }

  function editorTail(s) {
    const stateLabel = s.kind === 'sales' ? '売掛（未入金）として登録' : '買掛（未払い）として登録';
    return `<div class="uzf-tail">
      <label class="uzf-toggle">
        <input type="checkbox" class="uzf-unpaid" ${s.unpaid ? 'checked' : ''}>
        <span>${stateLabel}</span>
      </label>
      <label class="uzf-memo-label">メモ（任意）</label>
      <textarea class="uzf-memo" rows="2" placeholder="">${ESC(s.memo)}</textarea>
      <button type="button" class="uzf-submit">発生日 ${fmtDate(s.date)}　登録する</button>
    </div>`;
  }

  /* ── 結線 ─────────────────────────────────────────────── */
  function bind(host) {
    const s = host.__uzf;

    host.querySelectorAll('.uzf-chip').forEach(c =>
      c.addEventListener('click', () => { s.editing = c.dataset.step; render(host); }));

    if (s.editing === 'date') renderCalendar(host);

    host.querySelectorAll('.uzf-divtab').forEach(tab =>
      tab.addEventListener('click', () => {
        s.divCode = tab.dataset.div;
        s.itemCode = ''; s.itemName = ''; s.taxRate = null; s.miscName = '';
        render(host);
      }));

    host.querySelectorAll('.uzf-card').forEach(card =>
      card.addEventListener('click', () => {
        if (s.kind === 'sales') { s.svcCode = card.dataset.code; s.svcName = card.dataset.name; }
        else { s.itemCode = card.dataset.code; s.itemName = card.dataset.name; }
        s.taxRate = parseInt(card.dataset.tax, 10);
        if (!isMisc(card.dataset.code)) s.miscName = '';
        render(host);
      }));

    const misc = host.querySelector('.uzf-misc-input');
    if (misc) misc.addEventListener('input', () => { s.miscName = misc.value; });

    host.querySelectorAll('.uzf-taxchip').forEach(chip =>
      chip.addEventListener('click', () => {
        s.taxRate = parseInt(chip.dataset.rate, 10);
        s.editing = 'amount';
        render(host);
      }));

    host.querySelectorAll('.uzf-key').forEach(key =>
      key.addEventListener('click', () => {
        const k = key.dataset.key;
        let cur = String(s.amount || '');
        if (k === 'clear') cur = '';
        else if (k === 'del') cur = cur.slice(0, -1);
        else cur = (cur + k).replace(/^0+(?=\d)/, '');
        if (cur.length > 12) cur = cur.slice(0, 12);
        s.amount = cur;
        render(host);
      }));

    const unpaid = host.querySelector('.uzf-unpaid');
    if (unpaid) unpaid.addEventListener('change', () => { s.unpaid = unpaid.checked; });

    const memo = host.querySelector('.uzf-memo');
    if (memo) memo.addEventListener('input', () => { s.memo = memo.value; });

    const submit = host.querySelector('.uzf-submit');
    if (submit) submit.addEventListener('click', () => submitForm(host));

    const reset = host.querySelector('.uzf-reset');
    if (reset) reset.addEventListener('click', () => {
      const opts = s.opts;
      host.__uzf = newState(s.kind);
      host.__uzf.opts = opts;
      render(host);
    });
  }

  /* ── 自作カレンダー ───────────────────────────────────── */
  function renderCalendar(host) {
    const cal = host.querySelector('.uzf-cal');
    if (!cal) return;
    const s = host.__uzf;
    const base = s.calView || (s.date ? new Date(s.date) : new Date());
    s.calView = base;
    const y = base.getFullYear(), m = base.getMonth();
    const startDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const sel = s.date ? new Date(s.date) : null;

    const dows = ['日', '月', '火', '水', '木', '金', '土'];
    let cells = dows.map(d => `<div class="uzf-cal-dow">${d}</div>`).join('');
    for (let i = 0; i < startDow; i++) cells += `<div class="uzf-cal-cell uzf-cal-empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const isSel = sel && sel.getFullYear() === y && sel.getMonth() === m && sel.getDate() === d;
      cells += `<button type="button" class="uzf-cal-cell ${isSel ? 'is-sel' : ''}" data-day="${d}">${d}</button>`;
    }
    cal.innerHTML = `
      <div class="uzf-cal-bar">
        <button type="button" class="uzf-cal-nav" data-nav="-1">‹</button>
        <span class="uzf-cal-title">${y}年${m + 1}月</span>
        <button type="button" class="uzf-cal-nav" data-nav="1">›</button>
      </div>
      <div class="uzf-cal-grid">${cells}</div>`;

    cal.querySelectorAll('.uzf-cal-nav').forEach(b => b.addEventListener('click', () => {
      s.calView = new Date(y, m + parseInt(b.dataset.nav, 10), 1);
      renderCalendar(host);
    }));
    cal.querySelectorAll('.uzf-cal-cell[data-day]').forEach(c => c.addEventListener('click', () => {
      const dd = parseInt(c.dataset.day, 10);
      s.date = `${y}-${String(m + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      s.editing = itemResolved(s) ? (s.amount ? null : 'amount') : 'item';
      render(host);
    }));
  }

  /* ── 登録 ─────────────────────────────────────────────── */
  async function submitForm(host) {
    const s = host.__uzf;
    const amount = parseInt(s.amount || '0', 10);
    if (!itemResolved(s)) { toast('科目を選択してください'); return; }
    if (!amount || amount <= 0) { toast('金額を入力してください'); return; }
    if (s.taxRate == null) { toast('税率を選択してください'); return; }

    const { taxExcluded, tax } = calcTax(amount, s.taxRate);
    const btn = host.querySelector('.uzf-submit');
    if (btn) { btn.disabled = true; btn.textContent = '登録中...'; }

    try {
      let result;
      if (s.kind === 'sales') {
        result = await callGAS('addSales', {
          date: s.date, serviceCode: s.svcCode, serviceName: s.svcName,
          miscItemName: isMisc(s.svcCode) ? s.miscName : '',
          amountExTax: taxExcluded, taxRate: s.taxRate, tax, amountInTax: amount,
          memo: s.memo, uncollected: s.unpaid ? 1 : 0,
        });
      } else {
        result = await callGAS('addCost', {
          date: s.date, divisionCode: s.divCode, divisionName: divLabel(s.divCode),
          itemCode: s.itemCode, itemName: s.itemName,
          miscItemName: isMisc(s.itemCode) ? s.miscName : '',
          taxExcluded, taxRate: s.taxRate, tax, taxIncluded: amount,
          memo: s.memo, unpaid: s.unpaid ? 1 : 0, staffId: '', staffName: '', clientId: '',
        });
      }
      if (result?.status !== 'ok') throw new Error(result?.message || '登録エラー');
      toast(s.kind === 'sales' ? '売上を登録しました ✓' : 'コストを登録しました ✓');

      const opts = s.opts;
      try { opts.onSubmitted && opts.onSubmitted(); } catch (_) {}
      if (opts.autoClose && window.SheetModal) { SheetModal.close(); return; }

      host.__uzf = newState(s.kind);
      host.__uzf.opts = opts;
      render(host);
    } catch (e) {
      toast('登録に失敗しました：' + (e?.message || '通信エラー'));
      if (btn) { btn.disabled = false; btn.textContent = `発生日 ${fmtDate(s.date)}　登録する`; }
    }
  }

  function toast(msg) {
    if (typeof showToast === 'function') { showToast(msg, 'info'); return; }
    let t = document.getElementById('uzf-toast');
    if (!t) { t = document.createElement('div'); t.id = 'uzf-toast'; t.className = 'uzf-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* ── 公開 API ─────────────────────────────────────────── */
  /* 販管費（区分2）は costMaster（グローバル）に依存する。仕入原価（区分1）は
     別ソース（purchaseMaster）。cost フォーム mount 時に costMaster を確実にロードし、
     非同期ロード完了後に科目選択中の host を再描画する（→ cost.js getDivisionItems）。*/
  const _hosts = new Set();
  function _ensureCostMaster() {
    try { if (typeof getCostMaster === 'function') costMaster = getCostMaster(); } catch (_) {}
    if (typeof loadCostMasterFromGAS === 'function') {
      try {
        const p = loadCostMasterFromGAS();
        if (p && typeof p.then === 'function') p.then(_refreshItemStep).catch(() => {});
      } catch (_) {}
    }
  }
  function _refreshItemStep() {
    _hosts.forEach(h => {
      if (h.isConnected && h.__uzf && h.__uzf.kind === 'cost' && h.__uzf.editing === 'item') render(h);
    });
  }

  function mount(host, kind, opts = {}) {
    if (!host) return;
    host.classList.add('uzf-host');
    host.__uzf = newState(kind);
    host.__uzf.opts = opts || {};
    _hosts.add(host);
    if (kind === 'cost') _ensureCostMaster();
    render(host);
  }

  function openModal(kind, opts = {}) {
    if (!window.SheetModal) return;
    SheetModal.open({
      title: kind === 'sales' ? '売上登録' : 'コスト登録',
      bodyHtml: '<div class="uzf-host" data-uzf-modal="1"></div>',
      onRender: () => {
        const host = document.querySelector('.uzf-host[data-uzf-modal="1"]');
        if (host) mount(host, kind, Object.assign({ autoClose: true }, opts));
      },
    });
  }

  window.UzInput = { mount, openModal };

  /* 既存のホーム・取引タブのボタン（onclick="openSalesModal()"）を正本に差し替え。
     送信後はアクティブ画面の一覧再描画フックを呼ぶ（history は _loadIpadSalesData=loadAll）。*/
  function afterEntry(kind) {
    if (kind === 'sales' && typeof window._loadIpadSalesData === 'function') window._loadIpadSalesData();
    else if (kind === 'cost' && typeof window._loadIpadCostData === 'function') window._loadIpadCostData();
  }
  window.openSalesModal = () => openModal('sales', { onSubmitted: () => afterEntry('sales') });
  window.openCostModal  = () => openModal('cost',  { onSubmitted: () => afterEntry('cost') });

  /* 旧フォーム生成関数（sales.js / cost.js）の呼び出し元（iPad の sales.html /
     cost.html パネル等）も正本ステッパーに載せる安全網。host を返して mount する。*/
  function _mountPending(kind) {
    document.querySelectorAll(`.uzf-host[data-uzf-pending="${kind}"]`).forEach(h => {
      h.removeAttribute('data-uzf-pending');
      mount(h, kind, { onSubmitted: () => afterEntry(kind) });
    });
  }
  window._buildSalesFormBodyHTML  = () => '<div class="uzf-host" data-uzf-pending="sales"></div>';
  window._smCostBuildFormBodyHTML = () => '<div class="uzf-host" data-uzf-pending="cost"></div>';
  window._initSalesFormInModal    = () => _mountPending('sales');
  window._smCostInitFormInModal   = () => _mountPending('cost');
})();
