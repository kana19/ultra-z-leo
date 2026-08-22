/**
 * ledger.js — 取引管理（第4隊員 doc_automation・Phase4 Slice3・→ 05§8-5 一覧・集計ビュー）
 *
 * 発行した請求・受注のデータを「見る・追う」3ビュー：
 *  - 未納一覧（請求・入金管理）：getInvoicesUnpaid の未入金分を 顧客/金額/支払期限/経過日数 で並べ、
 *    消込（recordPayment）できる。既存 getUnpaid（売掛買掛）とは別軸＝発行済み請求書の入金管理。
 *  - 受注一覧：getOrders を 状態/発注元 で絞り込む（§8-7 FAX取込結果もここに集約）。
 *  - 売掛・受注集計：getDocSummary の 顧客別（請求ベース）/商品別/カテゴリ別（確定受注ベース）。
 *
 * 3デバイス共通・密度可変・集計/消込は PC 主戦場（02§1）。doc_automation ON の店だけ本体を出す。
 * グローバル関数イディオム（onclick 参照）。共有空間のため lg / _lg 接頭辞で命名し衝突を避ける。
 */
'use strict';

var _lgUnpaid = [];
var _lgOrders = [];
var _lgCustomers = [];
var _lgLoaded = { unpaid: false, orders: false, summary: false };
var _lgTab = 'unpaid';

/* ── 小ヘルパ ─────────────────────────────────────────── */
function _lgEsc(s) { return (typeof uzEscHtml === 'function') ? uzEscHtml(s == null ? '' : String(s)) : String(s == null ? '' : s); }
function _lgToast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'info'); }
function _lgEl(id) { return document.getElementById(id); }
function _lgVal(id) { var el = _lgEl(id); return el ? el.value : ''; }
function _lgYen(n) { return '¥' + (Number(n) || 0).toLocaleString('ja-JP'); }
function _lgTodayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function _lgCustomerName(id) {
  id = String(id || '');
  for (var i = 0; i < _lgCustomers.length; i++) { if (String(_lgCustomers[i].customerId) === id) return _lgCustomers[i].name; }
  return id ? '(' + id + ')' : '（未指定）';
}

/* ── 起動 ─────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  if (typeof uzDocAutomationEnabled !== 'function') { _lgShowOff(); return; }
  uzDocAutomationEnabled().then(function (on) {
    if (!on) { _lgShowOff(); return; }
    _lgInit();
  }).catch(function () { _lgShowOff(); });
});

function _lgShowOff() {
  var off = _lgEl('lg-off'); if (off) off.hidden = false;
  var main = _lgEl('lg-main'); if (main) main.hidden = true;
}

async function _lgInit() {
  var off = _lgEl('lg-off'); if (off) off.hidden = true;
  var main = _lgEl('lg-main'); if (main) main.hidden = false;

  // 顧客マスタは名寄せ（未納・集計の顧客名表示）に使う
  try {
    var cs = await callGAS('getCustomers', {});
    _lgCustomers = (cs && cs.status === 'ok' && Array.isArray(cs.customers)) ? cs.customers : [];
  } catch (e) { _lgCustomers = []; }

  _lgBindTabs();
  var st = _lgEl('lg-order-state'); if (st) st.addEventListener('change', _lgRenderOrders);
  var sup = _lgEl('lg-order-supplier'); if (sup) sup.addEventListener('input', _lgRenderOrders);

  _lgSetTab('unpaid');   // 既定＝お金の回収（未納）
}

/* ── タブ ─────────────────────────────────────────────── */
function _lgBindTabs() {
  document.querySelectorAll('.lg-tab').forEach(function (t) {
    t.addEventListener('click', function () { _lgSetTab(t.getAttribute('data-tab')); });
  });
}
function _lgSetTab(tab) {
  if (['unpaid', 'orders', 'summary'].indexOf(tab) < 0) tab = 'unpaid';
  _lgTab = tab;
  document.querySelectorAll('.lg-tab').forEach(function (t) {
    var on = t.getAttribute('data-tab') === tab;
    t.classList.toggle('lg-tab--active', on);
    if (on) t.setAttribute('aria-selected', 'true'); else t.removeAttribute('aria-selected');
  });
  ['unpaid', 'orders', 'summary'].forEach(function (k) {
    var p = _lgEl('lg-panel-' + k);
    if (p) { var on = k === tab; p.classList.toggle('lg-panel--active', on); p.hidden = !on; }
  });
  // 初回だけ読み込み（以後はキャッシュ描画・消込後は明示リロード）
  if (tab === 'unpaid' && !_lgLoaded.unpaid) _lgLoadUnpaid();
  if (tab === 'orders' && !_lgLoaded.orders) _lgLoadOrders();
  if (tab === 'summary' && !_lgLoaded.summary) _lgLoadSummary();
}

/* ══════════════════════════════════════════════════════════
   未納一覧（請求・入金管理）
   ══════════════════════════════════════════════════════════ */
async function _lgLoadUnpaid() {
  var cont = _lgEl('lg-unpaid-list');
  if (cont) cont.innerHTML = '<div class="lg-empty">読み込み中…</div>';
  try {
    var res = await callGAS('getInvoicesUnpaid', {});
    _lgUnpaid = (res && res.status === 'ok' && Array.isArray(res.invoices)) ? res.invoices : [];
  } catch (e) { _lgUnpaid = []; }
  _lgLoaded.unpaid = true;
  _lgRenderUnpaid();
}

function _lgRenderUnpaid() {
  var cont = _lgEl('lg-unpaid-list');
  var bar = _lgEl('lg-unpaid-summary');
  if (!cont) return;
  var total = 0;
  _lgUnpaid.forEach(function (r) { total += Number(r.total) || 0; });
  if (bar) bar.innerHTML = '未納 <b>' + _lgUnpaid.length + '件</b>　合計 <span class="lg-amt">' + _lgYen(total) + '</span>';

  if (!_lgUnpaid.length) {
    cont.innerHTML = '<div class="lg-empty">未入金の請求書はありません。</div>';
    return;
  }
  // 経過日数の多い順（回収の優先度）
  _lgUnpaid.sort(function (a, b) { return (Number(b.daysOverdue) || -9999) - (Number(a.daysOverdue) || -9999); });
  cont.innerHTML = _lgUnpaid.map(function (r) {
    var od = Number(r.daysOverdue);
    var badge, btxt;
    if (!isNaN(od) && od > 0) { badge = 'lg-badge--overdue'; btxt = od + '日超過'; }
    else if (!isNaN(od) && od >= -7) { badge = 'lg-badge--soon'; btxt = (od === 0 ? '本日期限' : Math.abs(od) + '日後'); }
    else { badge = 'lg-badge--ok'; btxt = '発行済'; }
    var due = r.dueDate ? ('期限 ' + _lgEsc(r.dueDate)) : '期限なし';
    return '' +
      '<div class="lg-row" data-inv="' + _lgEsc(r.invoiceId) + '">' +
        '<div class="lg-row__main">' +
          '<div class="lg-row__name">' + _lgEsc(_lgCustomerName(r.customerId)) + '</div>' +
          '<div class="lg-row__meta">' + _lgEsc(r.invoiceId) + '　' + due + '</div>' +
        '</div>' +
        '<span class="lg-badge ' + badge + '">' + btxt + '</span>' +
        '<span class="lg-row__amt">' + _lgYen(r.total) + '</span>' +
        '<button type="button" class="lg-btn lg-btn--ghost" onclick="_lgTogglePay(\'' + _lgEsc(r.invoiceId) + '\')">消込</button>' +
      '</div>' +
      '<div class="lg-pay" id="lg-pay-' + _lgEsc(r.invoiceId) + '">' +
        '<div class="lg-pay__row">' +
          '<div class="lg-pay__field"><label>入金日</label><input type="date" class="lg-input" id="lg-paydate-' + _lgEsc(r.invoiceId) + '" value="' + _lgTodayStr() + '"></div>' +
          '<div class="lg-pay__field"><label>入金額</label><input type="number" class="lg-input" id="lg-payamt-' + _lgEsc(r.invoiceId) + '" value="' + (Number(r.total) || 0) + '" min="0" inputmode="numeric"></div>' +
        '</div>' +
        '<div class="lg-pay__actions">' +
          '<button type="button" class="lg-btn" onclick="_lgDoPay(\'' + _lgEsc(r.invoiceId) + '\')">入金を記録</button>' +
          '<button type="button" class="lg-btn lg-btn--ghost" onclick="_lgTogglePay(\'' + _lgEsc(r.invoiceId) + '\')">キャンセル</button>' +
        '</div>' +
      '</div>';
  }).join('');
}

function _lgTogglePay(invId) {
  var el = _lgEl('lg-pay-' + invId);
  if (el) el.classList.toggle('lg-pay--open');
}

async function _lgDoPay(invId) {
  var paidDate = _lgVal('lg-paydate-' + invId) || _lgTodayStr();
  var paidAmount = Number(_lgVal('lg-payamt-' + invId));
  var payload = { invoiceId: invId, paidDate: paidDate };
  if (!isNaN(paidAmount)) payload.paidAmount = paidAmount;
  try {
    var res = await callGAS('recordPayment', payload);
    if (res && res.status === 'ok') {
      _lgToast('入金を記録しました ✓', 'success');
      _lgLoadUnpaid();          // 再取得（消込済は一覧から消える）
    } else {
      _lgToast((res && res.message) || '入金記録に失敗しました', 'error');
    }
  } catch (e) {
    _lgToast('通信エラーで記録できませんでした', 'error');
  }
}

/* ══════════════════════════════════════════════════════════
   受注一覧（orders・§8-7 取込結果も集約）
   ══════════════════════════════════════════════════════════ */
async function _lgLoadOrders() {
  var cont = _lgEl('lg-orders-list');
  if (cont) cont.innerHTML = '<div class="lg-empty">読み込み中…</div>';
  try {
    var res = await callGAS('getOrders', {});
    _lgOrders = (res && res.status === 'ok' && Array.isArray(res.orders)) ? res.orders : [];
  } catch (e) { _lgOrders = []; }
  _lgLoaded.orders = true;
  _lgRenderOrders();
}

function _lgRenderOrders() {
  var cont = _lgEl('lg-orders-list');
  var bar = _lgEl('lg-orders-summary');
  if (!cont) return;
  var state = _lgVal('lg-order-state');
  var sup = (_lgVal('lg-order-supplier') || '').trim();
  var rows = _lgOrders.filter(function (o) {
    if (state && o.state !== state) return false;
    if (sup && String(o.supplierName || '').indexOf(sup) < 0) return false;
    return true;
  });
  var total = 0;
  rows.forEach(function (o) { total += Number(o.amount) || 0; });
  if (bar) bar.innerHTML = '受注 <b>' + rows.length + '明細</b>　合計 <span class="lg-amt">' + _lgYen(total) + '</span>';

  if (!rows.length) {
    cont.innerHTML = '<div class="lg-empty">該当する受注はありません。</div>';
    return;
  }
  // 新しい順（登録日）
  rows.sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
  cont.innerHTML = rows.map(function (o) {
    var st = o.state === 'confirmed' ? { c: 'lg-badge--confirmed', t: '確定' } : { c: 'lg-badge--draft', t: '下書き' };
    var who = o.supplierName || _lgCustomerName(o.customerId);
    var meta = [];
    if (o.quantity != null) meta.push('数量' + o.quantity);
    if (o.desiredDeliveryDate) meta.push('納期' + _lgEsc(o.desiredDeliveryDate));
    if (o.createdAt) meta.push(_lgEsc(String(o.createdAt).slice(0, 10)));
    // 受注→売上に反映（受注→売上→請求書の一本道・05§8-5/§8-7）。反映済みは印を出し二重起票を防ぐ。
    var reflected = String(o.memo || '').indexOf('売上反映済') >= 0;
    var action = reflected
      ? '<span class="lg-badge lg-badge--ok">売上反映済</span>'
      : '<button type="button" class="lg-btn lg-btn--ghost" onclick="_lgReflectToSales(' + Number(o.rowIndex) + ',\'' + _lgEsc(o.orderId) + '\')">売上に反映</button>';
    return '' +
      '<div class="lg-row">' +
        '<div class="lg-row__main">' +
          '<div class="lg-row__name">' + _lgEsc(o.productName || '（品名なし）') + '</div>' +
          '<div class="lg-row__meta">' + _lgEsc(who) + '　' + meta.join('・') + '</div>' +
        '</div>' +
        '<span class="lg-badge ' + st.c + '">' + st.t + '</span>' +
        '<span class="lg-row__amt">' + _lgYen(o.amount) + '</span>' +
        action +
      '</div>';
  }).join('');
}

/* 受注を売上へ反映（受注→売上→請求書の一本道・→ 05§8-5/§8-7）。
   二重起票防止＝確認ダイアログ＋GAS側の反映済み印。反映後は一覧を再取得して印を表示する。 */
async function _lgReflectToSales(rowIndex, orderId) {
  if (!window.confirm('この受注を売上に反映します。よろしいですか？\n（反映後、請求書は「取引管理→売上から」で作成できます）')) return;
  try {
    var res = await callGAS('orderToSales', { rowIndex: rowIndex, orderId: orderId });
    if (res && res.status === 'ok') {
      _lgToast('売上に反映しました ✓', 'success');
      _lgLoadOrders();   // 再取得＝反映済み表示へ
    } else {
      _lgToast((res && res.message) || '反映に失敗しました', 'error');
    }
  } catch (e) {
    _lgToast('通信エラーで反映できませんでした', 'error');
  }
}

/* ══════════════════════════════════════════════════════════
   売掛・受注集計（getDocSummary）
   ══════════════════════════════════════════════════════════ */
async function _lgLoadSummary() {
  var body = _lgEl('lg-summary-body');
  if (body) body.innerHTML = '<div class="lg-empty">読み込み中…</div>';
  var sum = { byCustomer: {}, byProduct: {}, byCategory: {} };
  try {
    var res = await callGAS('getDocSummary', {});
    if (res && res.status === 'ok') {
      sum.byCustomer = res.byCustomer || {};
      sum.byProduct = res.byProduct || {};
      sum.byCategory = res.byCategory || {};
    }
  } catch (e) { /* 空のまま */ }
  _lgLoaded.summary = true;
  _lgRenderSummary(sum);
}

/* {key:amount} を金額降順の [name, amount] へ（顧客はIDを名前へ解決）。 */
function _lgSortMap(map, resolveName) {
  var arr = Object.keys(map || {}).map(function (k) { return { name: resolveName ? _lgCustomerName(k) : k, amount: Number(map[k]) || 0 }; });
  arr.sort(function (a, b) { return b.amount - a.amount; });
  return arr;
}
function _lgSumBlock(title, arr) {
  var total = 0;
  arr.forEach(function (r) { total += r.amount; });
  var rows = arr.length
    ? arr.map(function (r) { return '<tr><td class="name">' + _lgEsc(r.name) + '</td><td class="num">' + _lgYen(r.amount) + '</td></tr>'; }).join('')
    : '<tr><td class="name" colspan="2" style="color:var(--uz-muted);">データがありません</td></tr>';
  return '' +
    '<div class="lg-sum-block">' +
      '<h3>' + _lgEsc(title) + '</h3>' +
      '<table class="lg-sum-table"><tbody>' + rows + '</tbody></table>' +
      (arr.length ? '<div class="lg-sum-total"><span>合計</span><span>' + _lgYen(total) + '</span></div>' : '') +
    '</div>';
}
function _lgRenderSummary(sum) {
  var body = _lgEl('lg-summary-body');
  if (!body) return;
  body.innerHTML =
    _lgSumBlock('顧客別（発行済み請求）', _lgSortMap(sum.byCustomer, true)) +
    _lgSumBlock('商品別（確定受注）', _lgSortMap(sum.byProduct, false)) +
    _lgSumBlock('カテゴリ別（確定受注）', _lgSortMap(sum.byCategory, false));
}
