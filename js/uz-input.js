/**
 * uz-input.js — 売上・コスト入力フォーム（正本・全項目並列＋積層スタッキング・単一系統）
 * ==================================================================
 * 02_画面仕様.md §5-10。入力フォームの唯一の正本エンジン。
 * スマホモーダル・iPad月次管理(history)右カラムの全面で .uzf-host に描画する。
 *
 * 設計（§5-10 / §5-9）：
 *   ・発生日／区分・科目／金額の全項目を最初から並べる（選択しなくてもラインナップ）。
 *   ・選択しても高さは変わらない（要素の出現/消滅で積み上がらない・インクリメンタル更新）。
 *   ・スクロールで各項目を確認・入力でき、確定見出し（ヘッダー）は上部に到達すると
 *     固定され積み下がる（sticky スタッキング）。テンキー入力中も上部に確定項目が見える。
 *   ・発生日は常時編集可能（カレンダーが常設のため「変更」が常に効く）。
 *   ・OSキーボード/OSカレンダーを一切呼ばない。配色はモノトーン濃淡（uz-input.css）。
 *
 * 依存（全てグローバル）：getServiceMaster / getDivisionItems / getCostMaster /
 *   loadCostMasterFromGAS / calcTax / callGAS / todayStr / formatYen / showToast。
 *
 * 公開：UzInput.mount(hostEl, kind, { onSubmitted, autoClose }) / UzInput.openModal(kind, opts)
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
  const today = () => (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0, 10);
  const isMisc = code => /MISC/i.test(String(code || ''));
  const divLabel = code => (code === '1' ? '仕入原価' : '販管費');

  function newState(kind) {
    const base = {
      kind, date: today(), taxRate: null, miscName: '',
      amount: '', memo: '', unpaid: false, calView: null, opts: {},
      // v0.16.1【k1/k2】：大分類 chip（登録時属性・売上=serviceChannel／仕入原価=purchaseCategory）
      //   sales: channelId+channelName／cost: categoryId+categoryName （仕入原価タブのみ有効）
      categoryId: '', categoryName: '',
      // v0.17.0：入金・支払日（空＝発生日に追従）と口座（口座マスタ accountList）
      paidDate: '', paidDateTouched: false, paidCalView: null, origUnpaid: false, origPaidDate: '',
      accountCode: '', accountName: '',
    };
    if (kind === 'sales') Object.assign(base, { svcCode: '', svcName: '' });
    else Object.assign(base, { divCode: '2', itemCode: '', itemName: '' });
    return base;
  }
  // v0.16.1：大分類マスタ safe-getter（sales.js/cost.js の _get*ListSafe_ と同型・localStorage フォールバック）
  function _getServiceChannelList() {
    try {
      if (typeof getServiceChannelList === 'function') return getServiceChannelList();
      const s = localStorage.getItem('uz_service_channel_list');
      return s ? (JSON.parse(s) || []) : [];
    } catch (_) { return []; }
  }
  function _getPurchaseCategoryList() {
    try {
      if (typeof getPurchaseCategoryList === 'function') return getPurchaseCategoryList();
      const s = localStorage.getItem('uz_purchase_category_list');
      return s ? (JSON.parse(s) || []) : [];
    } catch (_) { return []; }
  }
  // v0.17.0：口座マスタ（settings B10）safe-getter
  function _getAccountList() {
    try {
      const s = localStorage.getItem('uz_account_list');
      return s ? (JSON.parse(s) || []) : [];
    } catch (_) { return []; }
  }
  // 入金・支払日の表示値：掛（未消込）は空・未指定は発生日（新規・現金取引の既定）
  function paidHeadValue(s) {
    if (s.unpaid) return '未消込';
    return fmtDate(s.paidDate || s.date);
  }
  // 大分類は sales と cost(divCode='1' 仕入原価) のみ・cost の販管費は分類なし（(b) 確定・零細事業者思想）。
  function getCategoryList(s) {
    if (s.kind === 'sales') return _getServiceChannelList();
    if (s.kind === 'cost' && s.divCode === '1') return _getPurchaseCategoryList();
    return [];
  }
  function itemResolved(s) {
    if (s.editId) return s.kind === 'sales' ? !!(s.svcCode || s.svcName) : !!(s.itemCode || s.itemName);
    return s.kind === 'sales' ? !!s.svcCode : !!s.itemCode;
  }
  function getItems(s) {
    try {
      if (s.kind === 'sales') return (typeof getServiceMaster === 'function') ? getServiceMaster() : [];
      return (typeof getDivisionItems === 'function') ? getDivisionItems(s.divCode, { filterBySmartphoneVisible: true }) : [];
    } catch (_) { return []; }
  }

  /* ── 値（見出し用） ───────────────────────────────────── */
  function itemHeadValue(s) {
    let label;
    if (s.kind === 'sales') label = s.svcName ? s.svcName + (s.miscName ? `（${s.miscName}）` : '') : '';
    else label = s.itemName ? `${divLabel(s.divCode)}／${s.itemName}` + (s.miscName ? `（${s.miscName}）` : '') : '';
    return label || '未選択';
  }
  function itemTaxLabel(s) {
    return (s.taxRate == null) ? '' : (s.taxRate === 0 ? '非課税' : s.taxRate + '%');
  }
  function amountHeadValue(s) {
    return (s.amount && parseInt(s.amount, 10) > 0) ? fmtAmt(s.amount) : '¥0';
  }
  function amountTaxLabel(s) {
    const tax = (s.taxRate != null && s.amount && typeof calcTax === 'function')
      ? calcTax(parseInt(s.amount, 10), s.taxRate).tax : 0;
    return `内消費税 ${tax.toLocaleString('ja-JP')} 円`;
  }
  function colsCls(s) {
    return (s.kind === 'cost' && s.divCode === '2') ? 'uzf-cards--3' : 'uzf-cards--2';
  }

  /* ── 部分HTML ─────────────────────────────────────────── */
  function cardsHTML(s) {
    const items = getItems(s);
    const sel = s.kind === 'sales' ? s.svcCode : s.itemCode;
    return items.map(it => `
      <button type="button" class="uzf-card ${it.code === sel ? 'is-active' : ''}" data-code="${ESC(it.code)}" data-name="${ESC(it.name)}" data-tax="${it.taxRate ?? 10}">
        ${ESC(it.name)}
      </button>`).join('') || '<div class="uzf-cards-empty">科目がありません</div>';
  }
  function taxchipsHTML(s) {
    return [10, 8, 0].map(r =>
      `<button type="button" class="uzf-taxchip ${s.taxRate === r ? 'is-active' : ''}" data-rate="${r}">${r === 0 ? '非課税' : r + '%'}</button>`).join('');
  }
  // v0.16.1【k1/k2】：大分類 chip（登録時属性）レンダラ。cost.js/sales.js の chip と同型（税率上書き源）。
  function catchipsHTML(s) {
    const list = getCategoryList(s);
    if (!list.length) return '';
    return list.map(c => {
      const cid = String(c.id || c.channelId || '');
      const nm = String(c.name || '');
      const tax = Number(c.taxRate) || 0;
      const active = s.categoryId && String(s.categoryId) === cid ? ' is-active' : '';
      return `<button type="button" class="uzf-taxchip${active}" data-cat-id="${ESC(cid)}" data-cat-name="${ESC(nm)}" data-cat-tax="${tax}">${ESC(nm)}<span style="opacity:.6;margin-left:4px;">(${tax}%)</span></button>`;
    }).join('');
  }
  // v0.17.0：口座 chip（口座マスタ）。同じ chip の再タップで解除。
  function accchipsHTML(s) {
    const list = _getAccountList();
    if (!list.length) return '<div class="uzf-cards-empty">設定の口座マスタで口座を登録すると選べます</div>';
    const cur = String(s.accountCode || '');
    const chips = list.map(a => {
      const id = String(a.id || a.code || '');
      const nm = String(a.name || '');
      return `<button type="button" class="uzf-taxchip${id === cur ? ' is-active' : ''}" data-acc-id="${ESC(id)}" data-acc-name="${ESC(nm)}">${ESC(nm)}</button>`;
    });
    // マスタから削除済みの口座で登録された行は名称スナップショットを残す
    if (cur && !list.some(a => String(a.id || a.code || '') === cur)) {
      chips.push(`<button type="button" class="uzf-taxchip is-active" data-acc-id="${ESC(cur)}" data-acc-name="${ESC(s.accountName)}">${ESC(s.accountName || cur)}</button>`);
    }
    return chips.join('');
  }
  function keypadHTML() {
    const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', 'del'];
    return keys.map(k => k === 'del'
      ? `<button type="button" class="uzf-key uzf-key--del" data-key="del">←</button>`
      : `<button type="button" class="uzf-key" data-key="${k}">${k}</button>`).join('');
  }
  // which：'date'（発生日）／'paid'（入金・支払日・v0.17.0）。同じカレンダー部品を 2 つの日付で使う。
  function calKeys(which) {
    return which === 'paid' ? { view: 'paidCalView', date: 'paidDate' } : { view: 'calView', date: 'date' };
  }
  function calInnerHTML(s, which) {
    const k = calKeys(which);
    const cur = s[k.date] || (which === 'paid' ? s.date : '');
    const base = s[k.view] || (cur ? new Date(cur) : new Date());
    s[k.view] = base;
    const y = base.getFullYear(), m = base.getMonth();
    const startDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const sel = cur ? new Date(cur) : null;
    const dows = ['日', '月', '火', '水', '木', '金', '土'];
    let cells = dows.map(d => `<div class="uzf-cal-dow">${d}</div>`).join('');
    for (let i = 0; i < startDow; i++) cells += `<div class="uzf-cal-cell uzf-cal-empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const isSel = sel && sel.getFullYear() === y && sel.getMonth() === m && sel.getDate() === d;
      cells += `<button type="button" class="uzf-cal-cell ${isSel ? 'is-sel' : ''}" data-day="${d}">${d}</button>`;
    }
    return `<div class="uzf-cal-bar">
        <button type="button" class="uzf-cal-nav" data-nav="-1">‹</button>
        <span class="uzf-cal-title">${y}年${m + 1}月</span>
        <button type="button" class="uzf-cal-nav" data-nav="1">›</button>
      </div><div class="uzf-cal-grid">${cells}</div>`;
  }

  /* ── スケルトン（全項目を一度だけ描画・以降はインクリメンタル更新） ── */
  function buildSkeleton(host) {
    const s = host.__uzf;
    const stateLabel = s.kind === 'sales' ? '売掛（未入金）' : '買掛（未払い）';
    const editLabel = s.editId ? '保存する' : '登録する';
    host.innerHTML =
      `<div class="uzf-head" data-stick="0" data-go="date">
         <span class="uzf-sh-k">発生日</span><span class="uzf-sh-v" data-v="date">${fmtDate(s.date)}</span>
       </div>
       <div class="uzf-body"><div class="uzf-cal" data-cal="date">${calInnerHTML(s, 'date')}</div></div>

       <div class="uzf-head" data-stick="1" data-go="item">
         <span class="uzf-sh-k">${s.kind === 'sales' ? '区分' : '科目'}</span><span class="uzf-sh-v" data-v="item">未選択</span><span class="uzf-sh-tax" data-v="itemtax"></span>
       </div>
       <div class="uzf-body">
         ${s.kind === 'cost' ? `<div class="uzf-divtabs">
           <button type="button" class="uzf-divtab ${s.divCode === '1' ? 'is-active' : ''}" data-div="1">仕入原価</button>
           <button type="button" class="uzf-divtab ${s.divCode === '2' ? 'is-active' : ''}" data-div="2">販管費</button>
         </div>` : ''}
         <div class="uzf-cards ${colsCls(s)}" data-cards>${cardsHTML(s)}</div>
         <div class="uzf-misc" data-misc hidden>
           <input type="text" class="uzf-misc-input" maxlength="50" placeholder="品目名（任意）">
         </div>
         <!-- v0.16.1【k1/k2】：大分類 chip（登録時属性・売上=serviceChannel／仕入原価=purchaseCategory・空なら hidden） -->
         <div class="uzf-cat-wrap" data-cat-wrap hidden style="margin-top:10px;">
           <div class="uzf-ed-sub" style="font-size:12px;color:var(--uz-muted);">大分類（任意・選ぶと税率上書き）</div>
           <div class="uzf-taxchips" data-cat-chips role="group" aria-label="大分類選択">${catchipsHTML(s)}</div>
         </div>
         <div class="uzf-ed-sub">税率</div>
         <div class="uzf-taxchips" data-tax-chips>${taxchipsHTML(s)}</div>
       </div>

       <div class="uzf-head" data-stick="2" data-go="amount">
         <span class="uzf-sh-k">金額</span><span class="uzf-sh-v" data-v="amount">¥0</span><span class="uzf-sh-tax" data-v="amounttax">内消費税 0 円</span>
       </div>
       <div class="uzf-body">
         <div class="uzf-amount-disp" data-amt>¥0<span class="uzf-amount-yen">円</span></div>
         <div class="uzf-keypad">${keypadHTML()}</div>
         <div class="uzf-keypad-last">
           <button type="button" class="uzf-key uzf-key--clear" data-key="clear">クリア</button>
         </div>
         <textarea class="uzf-memo" rows="1" placeholder="メモ（任意）"></textarea>
       </div>

       <div class="uzf-head" data-stick="3" data-go="paid">
         <span class="uzf-sh-k">${s.kind === 'sales' ? '入金日' : '支払日'}</span><span class="uzf-sh-v" data-v="paid">${paidHeadValue(s)}</span><span class="uzf-sh-tax" data-v="account">${ESC(s.accountName)}</span>
       </div>
       <div class="uzf-body">
         <div class="uzf-cal" data-cal="paid"${s.unpaid ? ' hidden' : ''}>${calInnerHTML(s, 'paid')}</div>
         <div class="uzf-ed-sub" data-paid-note${s.unpaid ? '' : ' hidden'}>${s.kind === 'sales' ? '売掛' : '買掛'}のため未消込です。☑を外すと${s.kind === 'sales' ? '入金日' : '支払日'}を選べます。</div>
         <div class="uzf-ed-sub">口座</div>
         <div class="uzf-taxchips" data-acc-chips role="group" aria-label="口座選択">${accchipsHTML(s)}</div>
       </div>

       <div class="uzf-tail">
         <label class="uzf-toggle"><input type="checkbox" class="uzf-unpaid"><span>${stateLabel}</span></label>
         <button type="button" class="uzf-submit" disabled>${editLabel}</button>
         ${(s.opts && s.opts.onDelete) ? `<button type="button" class="uzf-delete">削除する</button>` : ''}
         ${(s.opts && s.opts.onCancel) ? `<button type="button" class="uzf-cancel">取消（新規登録に戻る）</button>` : ''}
       </div>`;
  }

  /* ── 部分更新 ─────────────────────────────────────────── */
  const $ = (host, sel) => host.querySelector(sel);
  function setHead(host, key, val) { const el = $(host, `[data-v="${key}"]`); if (el) el.textContent = val; }
  function updateAmountUI(host) {
    const s = host.__uzf;
    const amt = $(host, '[data-amt]');
    if (amt) amt.innerHTML = (s.amount ? fmtAmt(s.amount) : '¥0') + '<span class="uzf-amount-yen">円</span>';
    setHead(host, 'amount', amountHeadValue(s));
    setHead(host, 'amounttax', amountTaxLabel(s));
  }
  function updateReady(host) {
    const s = host.__uzf;
    const ok = itemResolved(s) && s.amount && parseInt(s.amount, 10) > 0 && s.taxRate != null;
    const btn = $(host, '.uzf-submit'); if (btn) btn.disabled = !ok;
  }
  function updateTaxActive(host) {
    const s = host.__uzf;
    host.querySelectorAll('.uzf-taxchip').forEach(c => c.classList.toggle('is-active', parseInt(c.dataset.rate, 10) === s.taxRate));
  }
  function updateMiscBox(host) {
    const s = host.__uzf;
    const box = $(host, '[data-misc]');
    if (!box) return;
    const sel = s.kind === 'sales' ? s.svcCode : s.itemCode;
    const show = sel && isMisc(sel);
    box.hidden = !show;
    const inp = box.querySelector('.uzf-misc-input');
    if (inp && !show) inp.value = '';
    if (inp && show) inp.value = s.miscName || '';
  }
  function rebuildCards(host) {
    const s = host.__uzf;
    const box = $(host, '[data-cards]');
    if (!box) return;
    box.className = 'uzf-cards ' + colsCls(s);
    box.innerHTML = cardsHTML(s);
  }
  // v0.16.1【k1/k2】：大分類 chip の rebuild＋wrap 表示制御。
  //   list 空／販管費タブは wrap を hidden＝ chip DOM を隠す（cost.js/sales.js の hidden 属性運用と同型）。
  function rebuildCategoryChips(host) {
    const s = host.__uzf;
    const wrap = $(host, '[data-cat-wrap]');
    const box = $(host, '[data-cat-chips]');
    if (!wrap || !box) return;
    const list = getCategoryList(s);
    if (!list.length) { wrap.hidden = true; box.innerHTML = ''; return; }
    wrap.hidden = false;
    box.innerHTML = catchipsHTML(s);
  }
  function updateCategoryActive(host) {
    const s = host.__uzf;
    host.querySelectorAll('.uzf-taxchip[data-cat-id]').forEach(c => {
      c.classList.toggle('is-active', !!s.categoryId && String(c.dataset.catId) === String(s.categoryId));
    });
  }

  /* ── 操作（インクリメンタル：scrollを保ったまま該当部のみ更新） ── */
  function selectItem(host, card) {
    const s = host.__uzf;
    if (s.kind === 'sales') { s.svcCode = card.dataset.code; s.svcName = card.dataset.name; }
    else { s.itemCode = card.dataset.code; s.itemName = card.dataset.name; }
    // v0.16.1：大分類 chip 選択中は大分類 taxRate 優先＝ 科目 taxRate 上書きしない。
    //   大分類未選択時のみ 科目マスタの taxRate をデフォルトとして反映（v0.16.1 hotfix【c】方針の一貫）。
    if (!s.categoryId) s.taxRate = parseInt(card.dataset.tax, 10);
    if (!isMisc(card.dataset.code)) s.miscName = '';
    host.querySelectorAll('.uzf-card').forEach(c => c.classList.toggle('is-active', c === card));
    updateMiscBox(host);
    updateTaxActive(host);
    setHead(host, 'item', itemHeadValue(s));
    setHead(host, 'itemtax', itemTaxLabel(s));
    updateAmountUI(host);
    updateReady(host);
  }
  // v0.16.1【k1/k2】：大分類 chip 選択。トグル動作＝ 同じ大分類再タップで解除（税率は科目マスタへ戻す）。
  function selectCategory(host, chip) {
    const s = host.__uzf;
    const cid = String(chip.dataset.catId || '');
    const nm = String(chip.dataset.catName || '');
    const tax = parseInt(chip.dataset.catTax, 10);
    if (s.categoryId === cid) {
      // 解除：categoryId クリア＋ 税率は科目マスタの taxRate へ戻す（現在選択中の科目があれば）
      s.categoryId = '';
      s.categoryName = '';
      const items = getItems(s);
      const sel = s.kind === 'sales' ? s.svcCode : s.itemCode;
      const cur = items.find(it => it.code === sel);
      if (cur && [0, 8, 10].indexOf(Number(cur.taxRate)) >= 0) {
        s.taxRate = Number(cur.taxRate);
      }
    } else {
      s.categoryId = cid;
      s.categoryName = nm;
      if (Number.isFinite(tax) && [0, 8, 10].indexOf(tax) >= 0) s.taxRate = tax;
    }
    updateCategoryActive(host);
    updateTaxActive(host);
    setHead(host, 'itemtax', itemTaxLabel(s));
    updateAmountUI(host);
    updateReady(host);
  }
  function selectTax(host, chip) {
    const s = host.__uzf;
    s.taxRate = parseInt(chip.dataset.rate, 10);
    updateTaxActive(host);
    setHead(host, 'itemtax', itemTaxLabel(s));
    updateAmountUI(host);
    updateReady(host);
  }
  function selectDiv(host, tab) {
    const s = host.__uzf;
    s.divCode = tab.dataset.div;
    s.itemCode = ''; s.itemName = ''; s.taxRate = null; s.miscName = '';
    // v0.16.1：区分切替で大分類もクリア（大分類は仕入原価専用・販管費は分類なし・(b) 確定）
    s.categoryId = ''; s.categoryName = '';
    host.querySelectorAll('.uzf-divtab').forEach(t => t.classList.toggle('is-active', t === tab));
    rebuildCards(host);
    rebuildCategoryChips(host);
    updateMiscBox(host);
    updateTaxActive(host);
    setHead(host, 'item', itemHeadValue(s));
    setHead(host, 'itemtax', itemTaxLabel(s));
    updateAmountUI(host);
    updateReady(host);
  }
  function pressKey(host, key) {
    const s = host.__uzf;
    const k = key.dataset.key;
    let cur = String(s.amount || '');
    if (k === 'clear') cur = '';
    else if (k === 'del') cur = cur.slice(0, -1);
    else cur = (cur + k).replace(/^0+(?=\d)/, '');
    if (cur.length > 12) cur = cur.slice(0, 12);
    s.amount = cur;
    updateAmountUI(host);
    updateReady(host);
  }
  function calWhich(el) {
    const cal = el.closest('.uzf-cal');
    return (cal && cal.dataset.cal === 'paid') ? 'paid' : 'date';
  }
  function rerenderCal(host, which) {
    const cal = $(host, `.uzf-cal[data-cal="${which}"]`);
    if (cal) cal.innerHTML = calInnerHTML(host.__uzf, which);
  }
  function selectDay(host, cell) {
    const s = host.__uzf;
    const which = calWhich(cell);
    const k = calKeys(which);
    const base = s[k.view] || new Date();
    const y = base.getFullYear(), m = base.getMonth();
    const dd = parseInt(cell.dataset.day, 10);
    const ymd = `${y}-${String(m + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    s[k.date] = ymd;
    const cal = cell.closest('.uzf-cal');
    if (cal) cal.querySelectorAll('.uzf-cal-cell.is-sel').forEach(c => c.classList.remove('is-sel'));
    cell.classList.add('is-sel');
    if (which === 'paid') {
      s.paidDateTouched = true;
    } else {
      setHead(host, 'date', fmtDate(s.date));
      // 入金・支払日は手で選ぶまで発生日に追従（掛なし＝現金取引の既定）
      if (!s.unpaid && !s.paidDateTouched) {
        s.paidDate = s.date;
        s.paidCalView = null;
        rerenderCal(host, 'paid');
      }
    }
    setHead(host, 'paid', paidHeadValue(s));
  }
  function navCal(host, nav) {
    const s = host.__uzf;
    const which = calWhich(nav);
    const k = calKeys(which);
    const base = s[k.view] || new Date();
    s[k.view] = new Date(base.getFullYear(), base.getMonth() + parseInt(nav.dataset.nav, 10), 1);
    rerenderCal(host, which);
  }
  // 掛☑の切替：☑＝未消込（入金・支払日なし）／☑なし＝新規は発生日・既存の掛行は消込＝当日が既定
  function toggleUnpaid(host, checked) {
    const s = host.__uzf;
    s.unpaid = !!checked;
    if (s.unpaid) {
      s.paidDate = '';
    } else if (s.editId && s.origUnpaid) {
      s.paidDate = today();
      s.paidDateTouched = true;
    } else if (s.editId && s.origPaidDate) {
      s.paidDate = s.origPaidDate;
    } else if (!s.paidDateTouched || !s.paidDate) {
      s.paidDate = s.date;
    }
    s.paidCalView = null;
    const cal = $(host, '.uzf-cal[data-cal="paid"]');
    if (cal) { cal.hidden = s.unpaid; cal.innerHTML = calInnerHTML(s, 'paid'); }
    const note = $(host, '[data-paid-note]'); if (note) note.hidden = !s.unpaid;
    setHead(host, 'paid', paidHeadValue(s));
  }
  function selectAccount(host, chip) {
    const s = host.__uzf;
    const id = String(chip.dataset.accId || '');
    if (s.accountCode === id) { s.accountCode = ''; s.accountName = ''; }
    else { s.accountCode = id; s.accountName = String(chip.dataset.accName || ''); }
    host.querySelectorAll('.uzf-taxchip[data-acc-id]').forEach(c => {
      c.classList.toggle('is-active', !!s.accountCode && String(c.dataset.accId) === s.accountCode);
    });
    setHead(host, 'account', s.accountName);
  }
  function resetForm(host) {
    const opts = host.__uzf.opts;
    host.__uzf = newState(host.__uzf.kind);
    host.__uzf.opts = opts;
    buildSkeleton(host);
  }

  /* ── 登録後・修正の詳細表示①（§5-10）─────────────────────
     全項目を入力順に読み取り専用で並べ、同寸の「編集」「閉じる（新規登録）」を持つ。
     「編集」は直前登録行の黒帯積層編集へ／「閉じる」は新規入力に戻る。 */
  function buildDetailHTML(s) {
    const itemKey  = s.kind === 'sales' ? '区分' : '科目';
    const memoRow  = s.memo
      ? `<div class="uzf-head uzf-head--ro"><span class="uzf-sh-k">メモ</span><span class="uzf-sh-v">${escapeHtmlUzf(s.memo)}</span></div>`
      : '';
    const stateRow = s.unpaid
      ? `<div class="uzf-head uzf-head--ro"><span class="uzf-sh-k">状態</span><span class="uzf-sh-v">${s.kind === 'sales' ? '売掛（未入金）' : '買掛（未払い）'}</span></div>`
      : `<div class="uzf-head uzf-head--ro"><span class="uzf-sh-k">${s.kind === 'sales' ? '入金日' : '支払日'}</span><span class="uzf-sh-v">${paidHeadValue(s)}</span></div>`;
    const accountRow = s.accountName
      ? `<div class="uzf-head uzf-head--ro"><span class="uzf-sh-k">口座</span><span class="uzf-sh-v">${escapeHtmlUzf(s.accountName)}</span></div>`
      : '';
    return `<div class="uzf-detail">
      <div class="uzf-head uzf-head--ro"><span class="uzf-sh-k">発生日</span><span class="uzf-sh-v">${fmtDate(s.date)}</span></div>
      <div class="uzf-head uzf-head--ro"><span class="uzf-sh-k">${itemKey}</span><span class="uzf-sh-v">${escapeHtmlUzf(itemHeadValue(s))}</span><span class="uzf-sh-tax">${itemTaxLabel(s)}</span></div>
      <div class="uzf-head uzf-head--ro"><span class="uzf-sh-k">金額</span><span class="uzf-sh-v">${amountHeadValue(s)}</span><span class="uzf-sh-tax">${amountTaxLabel(s)}</span></div>
      ${memoRow}
      ${stateRow}
      ${accountRow}
      <div class="uzf-det-actions">
        <button type="button" class="uzf-detbtn uzf-det-edit">編集</button>
        <button type="button" class="uzf-detbtn uzf-det-close">閉じる（新規登録）</button>
      </div>
    </div>`;
  }
  function escapeHtmlUzf(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function showDetail(host, savedRecord) {
    host.__uzfSaved = savedRecord || null;
    host.innerHTML = buildDetailHTML(host.__uzf);
  }
  function _detailEdit(host) {
    const rec  = host.__uzfSaved;
    const opts = (host.__uzf && host.__uzf.opts) || {};
    if (!rec) { resetForm(host); return; }
    if (!rec.rowIndex) {
      // rowIndex 不明（旧GAS等）：新規入力へフォールバック
      toast('編集できる行が特定できませんでした。新規入力に戻ります');
      mount(host, rec.type === 'cost' ? 'cost' : 'sales', opts);
      return;
    }
    mountEdit(host, rec, opts);
  }
  function _detailClose(host) {
    const kind = (host.__uzf && host.__uzf.kind) || 'sales';
    const opts = (host.__uzf && host.__uzf.opts) || {};
    mount(host, kind, opts);
  }

  /* ── 登録 ─────────────────────────────────────────────── */
  async function submitForm(host) {
    const s = host.__uzf;
    const amount = parseInt(s.amount || '0', 10);
    if (!itemResolved(s)) { toast('科目を選択してください'); return; }
    if (!amount || amount <= 0) { toast('金額を入力してください'); return; }
    if (s.taxRate == null) { toast('税率を選択してください'); return; }

    const { taxExcluded, tax } = calcTax(amount, s.taxRate);
    // v0.17.0：入金・支払日（掛は空）・口座。修正時は空のまま送れば日付は書き換えない
    //   （日付を記録していない旧経路の消込行に発生日を捏造しない）。
    const paidDate = s.unpaid ? '' : (s.editId ? (s.paidDate || '') : (s.paidDate || s.date));
    const salesCat = { serviceChannelCode: s.categoryId || '', serviceChannelName: s.categoryName || '' };
    const costCat = {
      purchaseCategoryCode: (s.divCode === '1') ? (s.categoryId || '') : '',
      purchaseCategoryName: (s.divCode === '1') ? (s.categoryName || '') : '',
    };
    const acc = { accountCode: s.accountCode || '', accountName: s.accountName || '' };
    const btn = $(host, '.uzf-submit');
    if (btn) { btn.disabled = true; btn.dataset.busy = '1'; btn.textContent = s.editId ? '保存中...' : '登録中...'; }
    try {
      let result;
      if (s.editId) {
        // ── 修正（更新）：GAS updateSales / updateCost（契約は従来の saveEdit と同一） ──
        if (s.kind === 'sales') {
          // v0.17.0：paidDate を送る＝ GAS は消込として処理（☑を外す＝消込・付ける＝掛へ戻す）＋分類・口座も保存
          result = await callGAS('updateSales', Object.assign({
            rowIndex: s.editId, date: s.date,
            serviceName: s.svcName, serviceCode: s.svcCode || '',
            amountExTax: taxExcluded, taxRate: s.taxRate, tax, amountInTax: amount,
            memo: s.memo, uncollected: s.unpaid ? 1 : 0, paidDate,
          }, salesCat, acc));
        } else {
          result = await callGAS('updateCost', Object.assign({
            rowIndex: s.editId, date: s.date,
            divisionCode: s.divCode, divisionName: divLabel(s.divCode),
            itemCode: s.itemCode || '', itemName: s.itemName,
            taxExcluded, taxRate: s.taxRate, tax, taxIncluded: amount,
            memo: s.memo, unpaid: s.unpaid ? 1 : 0, paidDate,
          }, costCat, acc));
        }
        if (result?.status !== 'ok') throw new Error(result?.message || '更新エラー');
        toast('修正を保存しました ✓');
        try { s.opts.onSubmitted && s.opts.onSubmitted(); } catch (_) {}
        return;
      }
      if (s.kind === 'sales') {
        result = await callGAS('addSales', {
          date: s.date, serviceCode: s.svcCode, serviceName: s.svcName,
          miscItemName: isMisc(s.svcCode) ? s.miscName : '',
          amountExTax: taxExcluded, taxRate: s.taxRate, tax, amountInTax: amount,
          memo: s.memo, uncollected: s.unpaid ? 1 : 0,
          // v0.16.1【k2】：大分類（登録時属性）＝ シート V/W 列に書込＝ getSummary で分類集計
          serviceChannelCode: s.categoryId || '',
          serviceChannelName: s.categoryName || '',
          // v0.17.0：入金日（掛なしのみ）・入金口座
          paidDate, accountCode: acc.accountCode, accountName: acc.accountName,
        });
      } else {
        result = await callGAS('addCost', {
          date: s.date, divisionCode: s.divCode, divisionName: divLabel(s.divCode),
          itemCode: s.itemCode, itemName: s.itemName,
          miscItemName: isMisc(s.itemCode) ? s.miscName : '',
          taxExcluded, taxRate: s.taxRate, tax, taxIncluded: amount,
          memo: s.memo, unpaid: s.unpaid ? 1 : 0, staffId: '', staffName: '', clientId: '',
          // v0.16.1【k1】：仕入原価大分類（登録時属性・仕入原価タブのみ・販管費は空文字）＝ シート W/X 列に書込
          purchaseCategoryCode: (s.divCode === '1') ? (s.categoryId || '') : '',
          purchaseCategoryName: (s.divCode === '1') ? (s.categoryName || '') : '',
          // v0.17.0：支払日（掛なしのみ）・支払口座
          paidDate, accountCode: acc.accountCode, accountName: acc.accountName,
        });
      }
      if (result?.status !== 'ok') throw new Error(result?.message || '登録エラー');
      toast(s.kind === 'sales' ? '売上を登録しました ✓' : 'コストを登録しました ✓');
      try { s.opts.onSubmitted && s.opts.onSubmitted(); } catch (_) {}
      // §5-10 登録後の表示フロー：全項目（入力順）を読み取り専用で並べた詳細表示①へ切替。
      // 「編集」＝直前登録行の編集状態／「閉じる（新規登録）」＝新規入力に戻る。
      const _rowIndex = (result && result.rowIndex) ? result.rowIndex : null;
      const saved = (s.kind === 'sales')
        ? { type: 'sales', rowIndex: _rowIndex, date: s.date,
            serviceCode: s.svcCode, serviceName: s.svcName, itemName: s.svcName,
            taxRate: s.taxRate, amount: String(amount), memo: s.memo,
            uncollected: s.unpaid ? 1 : 0,
            // v0.16.1【k2】：登録時属性（大分類）を保存＝ 編集モードでの復元用
            serviceChannelCode: s.categoryId || '',
            serviceChannelName: s.categoryName || '',
            paidDate, accountCode: acc.accountCode, accountName: acc.accountName }
        : { type: 'cost', rowIndex: _rowIndex, date: s.date,
            divisionCode: s.divCode, itemCode: s.itemCode, itemName: s.itemName,
            taxRate: s.taxRate, amount: String(amount), memo: s.memo,
            unpaid: s.unpaid ? 1 : 0,
            // v0.16.1【k1】：登録時属性（仕入原価大分類・仕入原価のみ）を保存
            purchaseCategoryCode: (s.divCode === '1') ? (s.categoryId || '') : '',
            purchaseCategoryName: (s.divCode === '1') ? (s.categoryName || '') : '',
            paidDate, accountCode: acc.accountCode, accountName: acc.accountName };
      showDetail(host, saved);
    } catch (e) {
      toast('登録に失敗しました：' + (e?.message || '通信エラー'));
      if (btn) { btn.disabled = false; delete btn.dataset.busy; btn.textContent = s.editId ? '保存する' : '登録する'; }
    }
  }

  function toast(msg) {
    if (typeof showToast === 'function') { showToast(msg, 'info'); return; }
    let t = document.getElementById('uzf-toast');
    if (!t) { t = document.createElement('div'); t.id = 'uzf-toast'; t.className = 'uzf-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* ── 結線（イベント委譲：部分更新後も再バインド不要） ── */
  function bindAll(host) {
    if (host.__uzfBound) return;
    host.__uzfBound = true;
    host.addEventListener('click', e => {
      let el;
      if ((el = e.target.closest('.uzf-card'))) return selectItem(host, el);
      // v0.16.1【k1/k2】：大分類 chip（.uzf-taxchip[data-cat-id]）を通常 tax chip より先に判定
      if ((el = e.target.closest('.uzf-taxchip[data-cat-id]'))) return selectCategory(host, el);
      // v0.17.0：口座 chip も通常 tax chip より先に判定
      if ((el = e.target.closest('.uzf-taxchip[data-acc-id]'))) return selectAccount(host, el);
      if ((el = e.target.closest('.uzf-taxchip'))) return selectTax(host, el);
      if ((el = e.target.closest('.uzf-divtab'))) return selectDiv(host, el);
      if ((el = e.target.closest('.uzf-key'))) return pressKey(host, el);
      if ((el = e.target.closest('.uzf-cal-cell[data-day]'))) return selectDay(host, el);
      if ((el = e.target.closest('.uzf-cal-nav'))) return navCal(host, el);
      if ((el = e.target.closest('.uzf-det-edit'))) return _detailEdit(host);
      if ((el = e.target.closest('.uzf-det-close'))) return _detailClose(host);
      if ((el = e.target.closest('.uzf-submit'))) return submitForm(host);
      if ((el = e.target.closest('.uzf-delete'))) { try { host.__uzf.opts.onDelete && host.__uzf.opts.onDelete(); } catch (_) {} return; }
      if ((el = e.target.closest('.uzf-cancel'))) { try { host.__uzf.opts.onCancel && host.__uzf.opts.onCancel(); } catch (_) {} return; }
      if ((el = e.target.closest('.uzf-head[data-go]'))) {
        const body = el.nextElementSibling;
        if (body) body.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
    host.addEventListener('input', e => {
      const s = host.__uzf;
      if (e.target.classList.contains('uzf-misc-input')) { s.miscName = e.target.value; setHead(host, 'item', itemHeadValue(s)); }
      else if (e.target.classList.contains('uzf-memo')) s.memo = e.target.value;
    });
    host.addEventListener('change', e => {
      if (e.target.classList.contains('uzf-unpaid')) toggleUnpaid(host, e.target.checked);
    });
  }

  /* ── 販管費マスタ（costMaster）ロード保証＋ロード後にカード再構築 ── */
  const _hosts = new Set();
  function _ensureCostMaster() {
    try { if (typeof getCostMaster === 'function') costMaster = getCostMaster(); } catch (_) {}
    if (typeof loadCostMasterFromGAS === 'function') {
      try {
        const p = loadCostMasterFromGAS();
        if (p && typeof p.then === 'function') p.then(() => {
          _hosts.forEach(h => { if (h.isConnected && h.__uzf && h.__uzf.kind === 'cost') rebuildCards(h); });
        }).catch(() => {});
      } catch (_) {}
    }
  }

  /* ── 公開 API ─────────────────────────────────────────── */
  function mount(host, kind, opts = {}) {
    if (!host) return;
    host.classList.add('uzf-host');
    host.__uzf = newState(kind);
    host.__uzf.opts = opts || {};
    _hosts.add(host);
    buildSkeleton(host);
    bindAll(host);
    if (kind === 'cost') _ensureCostMaster();
    // v0.16.1【k1/k2】：大分類 chip wrap の表示制御（list があれば unhide）＋ 最新 settings を非同期取得
    //   →キャッシュ更新後に chip を再描画（新規 PWA でホーム未経由時の空返却事故を根治）。
    rebuildCategoryChips(host);
    if (typeof uzGetSettings === 'function') {
      Promise.resolve(uzGetSettings()).then(d => {
        if (!d) return;
        try {
          if (Array.isArray(d.serviceChannelList)) {
            localStorage.setItem('uz_service_channel_list', JSON.stringify(d.serviceChannelList));
          }
          if (Array.isArray(d.purchaseCategoryList)) {
            localStorage.setItem('uz_purchase_category_list', JSON.stringify(d.purchaseCategoryList));
          }
          if (Array.isArray(d.accountList)) {
            localStorage.setItem('uz_account_list', JSON.stringify(d.accountList));
          }
        } catch (_) {}
        if (host.isConnected) {
          rebuildCategoryChips(host);
          const accBox = $(host, '[data-acc-chips]');
          if (accBox) accBox.innerHTML = accchipsHTML(host.__uzf);
        }
      }).catch(() => {});
    }
  }

  /* 修正（編集）モード：既存レコードでプリフィルして同一エンジンで描画。
     送信は updateSales / updateCost（契約は従来 saveEdit と同一）。
     カードはコード一致で自動ハイライト。旧・自由入力名（コードなし）も保持して保存可。 */
  function mountEdit(host, record, opts = {}) {
    if (!host || !record) return;
    const kind = record.type === 'cost' ? 'cost' : 'sales';
    host.classList.add('uzf-host');
    const s = newState(kind);
    s.opts = opts || {};
    s.editId = record.rowIndex;
    s.date = record.date || s.date;
    s.calView = s.date ? new Date(s.date) : null;
    s.taxRate = (record.taxRate != null && record.taxRate !== '') ? Number(record.taxRate) : null;
    s.amount = String(parseInt(record.amount, 10) || '');
    s.memo = record.memo || '';
    if (kind === 'sales') {
      s.svcCode = record.serviceCode || '';
      s.svcName = record.itemName || record.serviceName || '';
      s.unpaid = Number(record.uncollected) === 1;
      // v0.16.1【k2】：編集モードで登録時属性（大分類）を復元
      s.categoryId = String(record.serviceChannelCode || '');
      s.categoryName = String(record.serviceChannelName || '');
    } else {
      s.divCode = String(record.divisionCode || '2') === '1' ? '1' : '2';
      s.itemCode = record.itemCode || '';
      s.itemName = record.itemName || '';
      s.unpaid = Number(record.unpaid) === 1;
      // v0.16.1【k1】：編集モードで登録時属性（仕入原価大分類・仕入原価タブのみ）を復元
      if (s.divCode === '1') {
        s.categoryId = String(record.purchaseCategoryCode || '');
        s.categoryName = String(record.purchaseCategoryName || '');
      }
    }
    // v0.17.0：入金・支払日と口座を復元。記録なしの現金取引は発生日が既定、
    //   日付を記録していない旧経路の消込行は空のまま（日付を捏造しない）。
    s.origUnpaid = s.unpaid;
    s.origPaidDate = String(record.paidDate || '');
    s.paidDate = s.unpaid ? '' : (s.origPaidDate || (record.reconciled ? '' : s.date));
    s.paidDateTouched = !!s.origPaidDate;
    s.accountCode = String(record.accountCode || '');
    s.accountName = String(record.accountName || '');
    host.__uzf = s;
    _hosts.add(host);
    buildSkeleton(host);
    bindAll(host);
    if (kind === 'cost') _ensureCostMaster();
    // v0.16.1【k1/k2】：大分類 chip の描画・活性反映（プリフィル値の categoryId を is-active に）
    rebuildCategoryChips(host);
    updateCategoryActive(host);
    // プリフィル値をヘッド・金額・税率・活性に反映
    setHead(host, 'item', itemHeadValue(s));
    setHead(host, 'itemtax', itemTaxLabel(s));
    updateTaxActive(host);
    updateAmountUI(host);
    updateReady(host);
    const memo = $(host, '.uzf-memo'); if (memo) memo.value = s.memo;
    const unp = $(host, '.uzf-unpaid'); if (unp) unp.checked = !!s.unpaid;
  }

  function openModal(kind, opts = {}) {
    if (!window.SheetModal) return;
    SheetModal.open({
      title: kind === 'sales' ? '売上登録' : 'コスト登録',
      bodyHtml: '<div class="uzf-host" data-uzf-modal="1"></div>',
      onRender: () => {
        const sheet = document.querySelector('.sm-sheet');
        if (sheet) sheet.classList.add('sm-sheet--tall');
        const host = document.querySelector('.uzf-host[data-uzf-modal="1"]');
        if (host) mount(host, kind, Object.assign({ autoClose: true }, opts));
      },
    });
  }

  window.UzInput = { mount, mountEdit, openModal };

  function afterEntry(kind) {
    if (kind === 'sales' && typeof window._loadIpadSalesData === 'function') window._loadIpadSalesData();
    else if (kind === 'cost' && typeof window._loadIpadCostData === 'function') window._loadIpadCostData();
  }
  window.openSalesModal = () => openModal('sales', { onSubmitted: () => afterEntry('sales') });
  window.openCostModal  = () => openModal('cost',  { onSubmitted: () => afterEntry('cost') });

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
