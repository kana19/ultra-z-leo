/**
 * pc-invoice.js — 書類発行UI（PC限定・詳細版・→ 05§8-5 2026-08-13）
 *
 * 発行（見積/請求の作成＋PDF出力）は"作り込み・出力"＝PC事務作業（給与計算と同格）。
 * スマホ/iPad は閲覧・確認＋受注→売上反映のみ（発行しない）。帳票は見積・請求の2種（納品書撤廃）。
 *
 * 機能：
 *  - 見積書：宛先/敬称/件名/発行日/有効期限/納期/支払条件＋商品SKU明細（商品名×分類・自由入力可）。
 *    顧客別の見積一覧から「複製」（他得意先へ流用）・「編集」（updateDocument で上書き）。
 *  - 請求書：手入力／見積書から（明細・件名・宛先を反映）／売上から（期間の売上を自由入力明細で取込）。
 *  - PDF：A4書面プレビュー → window.print()（PCの「PDFとして保存」）。
 *
 * app.js（callGAS/uzDocAutomationEnabled/uzGetSettingsOnce/uzEscHtml/showToast/uzGetStoreName）と
 * pc-common.js（pcBootstrap）を用いる。共有グローバル空間のため pci/_pci 接頭辞で衝突回避。
 */
'use strict';

var _pciProducts = [];
var _pciCustomers = [];
var _pciStoreName = '';
var _pciHonorificDefault = '御中';
var _pciDocType = 'estimate';   // estimate | invoice
var _pciLineSeq = 0;
var _pciEditDocId = null;       // 非nullなら「編集中」＝updateDocument で上書き
var _pciSrcMode = 'manual';     // 請求の取込ソース：manual | estimate | sales
var _pciDocs = [];              // 現在の一覧キャッシュ
var _pciSalesRows = [];         // 「売上から」の検索結果（複数選択→明細へまとめる）

var _PCI_LABELS = {
  estimate: { title: '見積書', issueBtn: '見積書を発行', updateBtn: '見積書を更新', listTitle: '発行済みの見積書', date2: '有効期限', date2Field: 'validUntil', grand: 'お見積金額' },
  invoice:  { title: '請求書', issueBtn: '請求書を発行', updateBtn: '請求書を更新', listTitle: '発行済みの請求書', date2: '支払期限', date2Field: 'dueDate', grand: 'ご請求金額' }
};

/* ── 小ヘルパ ─────────────────────────────────────────── */
function _pciEsc(s) { return (typeof uzEscHtml === 'function') ? uzEscHtml(s == null ? '' : String(s)) : String(s == null ? '' : s); }
function _pciToast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'info'); }
function _pciEl(id) { return document.getElementById(id); }
function _pciVal(id) { var el = _pciEl(id); return el ? el.value : ''; }
function _pciYen(n) { return '¥' + (Number(n) || 0).toLocaleString('ja-JP'); }
function _pciToday() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

/* ── 起動 ─────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  if (typeof pcBootstrap === 'function') pcBootstrap('pc-invoice.html', '書類発行');
  if (typeof uzDocAutomationEnabled !== 'function') { _pciShowOff(); return; }
  uzDocAutomationEnabled().then(function (on) {
    if (!on) { _pciShowOff(); return; }
    _pciInit();
  }).catch(function () { _pciShowOff(); });
});

function _pciShowOff() {
  var off = _pciEl('pcinv-off'); if (off) off.hidden = false;
  var main = _pciEl('pcinv-main'); if (main) main.hidden = true;
}

async function _pciInit() {
  var off = _pciEl('pcinv-off'); if (off) off.hidden = true;
  var main = _pciEl('pcinv-main'); if (main) main.hidden = false;

  var idt = _pciEl('pcinv-issue-date'); if (idt) idt.value = _pciToday();

  try {
    var results = await Promise.all([
      callGAS('getProducts', {}),
      callGAS('getCustomers', {}),
      (typeof uzGetSettingsOnce === 'function') ? uzGetSettingsOnce() : uzGetSettings()
    ]);
    var pr = results[0], cs = results[1], settings = results[2];
    _pciProducts = (pr && pr.status === 'ok' && Array.isArray(pr.products)) ? pr.products.filter(function (p) { return p.enabled !== false; }) : [];
    _pciCustomers = (cs && cs.status === 'ok' && Array.isArray(cs.customers)) ? cs.customers : [];
    if (settings) {
      _pciStoreName = settings.storeName || (typeof uzGetStoreName === 'function' ? uzGetStoreName('') : '');
      if (settings.invoiceSettings && settings.invoiceSettings.honorificDefault) _pciHonorificDefault = settings.invoiceSettings.honorificDefault;
    }
  } catch (e) { _pciProducts = []; _pciCustomers = []; }

  _pciFillCustomers();
  var hon = _pciEl('pcinv-honorific'); if (hon) hon.value = _pciHonorificDefault;

  _pciBindTabs();
  _pciBindSrcTabs();
  _pciBindPreview();
  var add = _pciEl('pcinv-addline-btn'); if (add) add.addEventListener('click', function () { _pciAddLine(); });
  var issue = _pciEl('pcinv-issue-btn'); if (issue) issue.addEventListener('click', _pciSubmit);
  var cancel = _pciEl('pcinv-cancel-edit'); if (cancel) cancel.addEventListener('click', _pciCancelEdit);
  var estApply = _pciEl('pcinv-src-est-apply'); if (estApply) estApply.addEventListener('click', _pciApplyEstimate);
  var salesFetch = _pciEl('pcinv-src-sales-fetch'); if (salesFetch) salesFetch.addEventListener('click', _pciFetchSales);
  var salesApply = _pciEl('pcinv-src-sales-apply'); if (salesApply) salesApply.addEventListener('click', _pciApplySalesSelected);
  var salesAll = _pciEl('pcinv-sales-all'); if (salesAll) salesAll.addEventListener('change', _pciToggleAllSales);
  var listCust = _pciEl('pcinv-list-customer'); if (listCust) listCust.addEventListener('change', _pciLoadDocs);

  _pciSetDocType('estimate');
  _pciAddLine();
  _pciRenderTotals();
}

/* ── 宛先（顧客マスタ） ───────────────────────────────── */
function _pciFillCustomers() {
  var sel = _pciEl('pcinv-customer');
  var lst = _pciEl('pcinv-list-customer');
  var opts = ['<option value="">選択してください</option>'];
  var lopts = ['<option value="">すべての顧客</option>'];
  _pciCustomers.forEach(function (c) {
    opts.push('<option value="' + _pciEsc(c.customerId) + '">' + _pciEsc(c.name) + '</option>');
    lopts.push('<option value="' + _pciEsc(c.customerId) + '">' + _pciEsc(c.name) + '</option>');
  });
  if (sel) sel.innerHTML = opts.join('');
  if (lst) lst.innerHTML = lopts.join('');
}
function _pciCustomerById(id) {
  id = String(id || '');
  for (var i = 0; i < _pciCustomers.length; i++) { if (String(_pciCustomers[i].customerId) === id) return _pciCustomers[i]; }
  return null;
}

/* ── 書類種別（見積/請求） ───────────────────────────── */
function _pciBindTabs() {
  document.querySelectorAll('.pcinv-tab').forEach(function (t) {
    t.addEventListener('click', function () { _pciSetDocType(t.getAttribute('data-type')); });
  });
}
function _pciSetDocType(type) {
  if (!_PCI_LABELS[type]) type = 'estimate';
  _pciDocType = type;
  var L = _PCI_LABELS[type];
  document.querySelectorAll('.pcinv-tab').forEach(function (t) {
    var on = t.getAttribute('data-type') === type;
    t.classList.toggle('pcinv-tab--active', on);
    if (on) t.setAttribute('aria-selected', 'true'); else t.removeAttribute('aria-selected');
  });
  var lbl = _pciEl('pcinv-date2-label'); if (lbl) lbl.textContent = L.date2;
  // 請求のみ取込ソースを出す
  var src = _pciEl('pcinv-src'); if (src) src.hidden = (type !== 'invoice');
  if (type === 'invoice') _pciSetSrcMode('manual');
  // 一覧見出し・注記
  var lt = _pciEl('pcinv-list-title-label'); if (lt) lt.textContent = L.listTitle;
  var note = _pciEl('pcinv-list-note');
  if (note) note.textContent = (type === 'estimate')
    ? '見積書は「複製」で他の得意先へ流用、「編集」で内容を上書きできます。'
    : '請求書は「複製」で同型をもう1件作れます。';
  _pciCancelEdit();       // 種別切替で編集状態は解除
  _pciLoadDocs();
}

/* ── 請求の取込ソース ─────────────────────────────────── */
function _pciBindSrcTabs() {
  document.querySelectorAll('.pcinv-src__tab').forEach(function (t) {
    t.addEventListener('click', function () { _pciSetSrcMode(t.getAttribute('data-src')); });
  });
}
function _pciSetSrcMode(mode) {
  if (['manual', 'estimate', 'sales'].indexOf(mode) < 0) mode = 'manual';
  _pciSrcMode = mode;
  document.querySelectorAll('.pcinv-src__tab').forEach(function (t) {
    t.classList.toggle('pcinv-src__tab--active', t.getAttribute('data-src') === mode);
  });
  document.querySelectorAll('.pcinv-src__panel').forEach(function (p) {
    p.classList.toggle('pcinv-src__panel--active', p.getAttribute('data-src-panel') === mode);
  });
  if (mode === 'estimate') _pciFillEstimatePicker();
}

async function _pciFillEstimatePicker() {
  var sel = _pciEl('pcinv-src-est'); if (!sel) return;
  var docs = [];
  try { var res = await callGAS('getDocuments', { docType: 'estimate' }); docs = (res && res.status === 'ok' && Array.isArray(res.documents)) ? res.documents : []; } catch (e) { docs = []; }
  docs.sort(function (a, b) { return String(_pciDocId(b)).localeCompare(String(_pciDocId(a))); });
  var opts = ['<option value="">— 見積書を選択 —</option>'];
  docs.forEach(function (d) {
    var cust = _pciCustomerById(d.customerId);
    var label = _pciDocId(d) + '｜' + (cust ? cust.name : (d.customerId || '宛先未指定')) + '｜' + _pciYen(d['合計']) + (d['件名'] ? '｜' + d['件名'] : '');
    opts.push('<option value="' + _pciEsc(_pciDocId(d)) + '">' + _pciEsc(label) + '</option>');
  });
  sel.innerHTML = opts.join('');
  sel._docs = docs;
}
function _pciApplyEstimate() {
  var sel = _pciEl('pcinv-src-est'); if (!sel) return;
  var id = sel.value; if (!id) return _pciToast('見積書を選んでください', 'error');
  var docs = sel._docs || [];
  var d = docs.filter(function (x) { return _pciDocId(x) === id; })[0];
  if (!d) return;
  _pciPrefill((Array.isArray(d.items) ? d.items : []), {
    customerId: d.customerId || '', subject: d['件名'] || '', deliveryDate: d['納期'] || '', paymentTerms: d['支払条件'] || '', memo: d['メモ'] || ''
  });
  _pciToast('見積書の内容を反映しました。編集して請求書を発行できます。', 'success');
}
/* 売上から：期間で検索 → チェックリスト表示。同じ月の複数行を複数選択して1枚にまとめられる。 */
async function _pciFetchSales() {
  var from = _pciVal('pcinv-src-from'), to = _pciVal('pcinv-src-to'), cc = (_pciVal('pcinv-src-cc') || '').trim();
  if (!from && !to) return _pciToast('期間（自/至）を指定してください', 'error');
  var sales = [];
  try {
    var res = await callGAS('getSalesForInvoice', { fromDate: from, toDate: to, customerCode: cc });
    sales = (res && res.status === 'ok' && Array.isArray(res.sales)) ? res.sales : [];
  } catch (e) { sales = []; }
  _pciSalesRows = sales;
  _pciRenderSalesList();
  if (!sales.length) _pciToast('該当する売上がありませんでした', 'info');
}
function _pciSalesAmt(s) { return Number(s.taxExcluded) || Number(s.unitPrice) || 0; }
function _pciRenderSalesList() {
  var host = _pciEl('pcinv-sales-list'); var bar = _pciEl('pcinv-sales-bar');
  if (!host) return;
  if (!_pciSalesRows.length) { host.innerHTML = ''; if (bar) bar.hidden = true; return; }
  host.innerHTML = _pciSalesRows.map(function (s, i) {
    return '<label class="pcinv-sales-row">' +
      '<input type="checkbox" class="pcinv-sales-cb" data-i="' + i + '" checked>' +
      '<span class="pcinv-sales-row__name">' + _pciEsc(s.productName) + '</span>' +
      '<span class="pcinv-sales-row__meta">' + _pciEsc(s.date) + (s.customerCode ? '・' + _pciEsc(s.customerCode) : '') + '　' + (Number(s.taxRate) || 0) + '%</span>' +
      '<span class="pcinv-sales-row__amt">' + _pciYen(_pciSalesAmt(s)) + '</span>' +
    '</label>';
  }).join('');
  Array.prototype.forEach.call(host.querySelectorAll('.pcinv-sales-cb'), function (cb) { cb.addEventListener('change', _pciUpdateSalesCount); });
  if (bar) bar.hidden = false;
  var all = _pciEl('pcinv-sales-all'); if (all) all.checked = true;
  _pciUpdateSalesCount();
}
function _pciToggleAllSales() {
  var on = _pciEl('pcinv-sales-all').checked;
  Array.prototype.forEach.call(document.querySelectorAll('#pcinv-sales-list .pcinv-sales-cb'), function (cb) { cb.checked = on; });
  _pciUpdateSalesCount();
}
function _pciUpdateSalesCount() {
  var checked = Array.prototype.slice.call(document.querySelectorAll('#pcinv-sales-list .pcinv-sales-cb:checked'));
  var total = 0;
  checked.forEach(function (cb) { var s = _pciSalesRows[Number(cb.getAttribute('data-i'))]; if (s) total += _pciSalesAmt(s); });
  var el = _pciEl('pcinv-sales-count'); if (el) el.textContent = checked.length + '件選択　小計(税抜) ' + _pciYen(total);
  var all = _pciEl('pcinv-sales-all');
  if (all) all.checked = checked.length > 0 && checked.length === _pciSalesRows.length;
}
function _pciApplySalesSelected() {
  var checked = Array.prototype.slice.call(document.querySelectorAll('#pcinv-sales-list .pcinv-sales-cb:checked'));
  if (!checked.length) return _pciToast('請求する売上を選んでください', 'error');
  var items = checked.map(function (cb) {
    var s = _pciSalesRows[Number(cb.getAttribute('data-i'))];
    return { productCode: '', productName: s.productName, quantity: s.quantity || 1, unitPrice: s.unitPrice, taxRate: s.taxRate };
  });
  _pciPrefill(items, {}); // 宛先は据え置き（顧客マスタから選ぶ）
  _pciToast(items.length + '件の売上を明細にまとめました。宛先を選んで発行してください。', 'success');
}

/* ── 明細（品名は常に自由入力可＝マスタ外の見積を想定・マスタSKUは入力補完の"補助"） ───────
   見積は都度の一品・役務など商品マスタに無い品目が多い。ゆえに品名/単価/税率を常時編集可とし、
   マスタSKUは選ぶと各欄を補完する補助ピッカーに徹する（選択後は空へ戻す）。マスタが空でも成立する。 */
function _pciPickerOptions() {
  var opts = ['<option value="">＋ マスタから選ぶ（任意）</option>'];
  _pciProducts.forEach(function (p) {
    var cat = String(p.categoryL1 || '').trim();
    var label = String(p.productName || '') + (cat ? '（' + cat + '）' : '') + '  ' + _pciYen(p.unitPrice) + ' [' + (Number(p.taxRate) || 0) + '%]';
    opts.push('<option value="' + _pciEsc(p.productCode) + '">' + _pciEsc(label) + '</option>');
  });
  return opts.join('');
}

function _pciAddLine(prefill) {
  var host = _pciEl('pcinv-lines'); if (!host) return;
  var id = 'pciln-' + (++_pciLineSeq);
  var wrap = document.createElement('div');
  wrap.className = 'pcinv-line'; wrap.id = id;
  wrap.innerHTML =
    '<div class="pcinv-line__pick"><select class="pcinv-select" id="' + id + '-prod" aria-label="マスタから選ぶ（任意）">' + _pciPickerOptions() + '</select></div>' +
    '<div class="pcinv-line__nums">' +
      '<div><label>品名</label><input type="text" class="pcinv-input" id="' + id + '-name" placeholder="品名（自由入力可）" maxlength="80"></div>' +
      '<div><label>数量</label><input type="number" class="pcinv-input" id="' + id + '-qty" value="1" min="0" step="1" inputmode="numeric"></div>' +
      '<div><label>単価(税抜)</label><input type="number" class="pcinv-input" id="' + id + '-price" value="0" min="0" inputmode="numeric"></div>' +
      '<div><label>税率</label><select class="pcinv-select" id="' + id + '-tax"><option value="10">10%</option><option value="8">8%(軽減)</option><option value="0">0%</option></select></div>' +
      '<div><label>&nbsp;</label><button type="button" class="pcinv-line__del" aria-label="この明細を削除">×</button></div>' +
    '</div>' +
    '<div class="pcinv-line__amount" id="' + id + '-amt">¥0</div>';
  host.appendChild(wrap);

  _pciEl(id + '-prod').addEventListener('change', function () { _pciPickFromMaster(id); });
  _pciEl(id + '-name').addEventListener('input', function () { wrap.dataset.pc = ''; });   // 手編集でマスタ紐付けを外す
  _pciEl(id + '-qty').addEventListener('input', function () { _pciRecalc(id); });
  _pciEl(id + '-price').addEventListener('input', function () { wrap.dataset.pc = ''; _pciRecalc(id); });
  _pciEl(id + '-tax').addEventListener('change', function () { _pciRecalc(id); });
  wrap.querySelector('.pcinv-line__del').addEventListener('click', function () { _pciRemoveLine(id); });

  if (prefill) {
    _pciEl(id + '-name').value = prefill.productName || '';
    _pciEl(id + '-price').value = Number(prefill.unitPrice) || 0;
    if (prefill.quantity != null) _pciEl(id + '-qty').value = prefill.quantity;
    if (prefill.taxRate != null) _pciEl(id + '-tax').value = String(Number(prefill.taxRate) || 0);
    if (prefill.productCode) wrap.dataset.pc = String(prefill.productCode);
    _pciRecalc(id);
  }
  return id;
}

/* マスタSKUを選ぶと品名/単価/税率を補完（補助＝選択後は空へ戻す）。品名/単価は手編集で上書き可。 */
function _pciPickFromMaster(id) {
  var code = _pciVal(id + '-prod'); if (!code) return;
  var p = null;
  for (var i = 0; i < _pciProducts.length; i++) { if (String(_pciProducts[i].productCode) === String(code)) { p = _pciProducts[i]; break; } }
  if (p) {
    _pciEl(id + '-name').value = p.productName || '';
    _pciEl(id + '-price').value = Number(p.unitPrice) || 0;
    _pciEl(id + '-tax').value = String(Number(p.taxRate) || 0);
    _pciEl(id).dataset.pc = p.productCode;
  }
  _pciEl(id + '-prod').value = '';   // 補助ピッカーは選択後に空へ戻す
  _pciRecalc(id);
}

function _pciRecalc(id) {
  var qty = Number(_pciVal(id + '-qty')) || 0;
  var price = Number(_pciVal(id + '-price')) || 0;
  var amtEl = _pciEl(id + '-amt'); if (amtEl) amtEl.textContent = _pciYen(qty * price);
  _pciRenderTotals();
}

function _pciRemoveLine(id) {
  var wrap = _pciEl(id); if (wrap) wrap.parentNode.removeChild(wrap);
  var host = _pciEl('pcinv-lines'); if (host && !host.children.length) _pciAddLine();
  _pciRenderTotals();
}

function _pciCollectLines() {
  var host = _pciEl('pcinv-lines'); if (!host) return [];
  var out = [];
  Array.prototype.forEach.call(host.children, function (wrap) {
    var id = wrap.id;
    var name = (_pciVal(id + '-name') || '').trim();
    var qty = Number(_pciVal(id + '-qty')) || 0;
    var price = Number(_pciVal(id + '-price')) || 0;
    var rate = Number(_pciVal(id + '-tax')) || 0;
    if (!name || qty <= 0) return;   // 品名＋数量があれば有効（マスタ外の自由入力を含む）
    out.push({ productCode: wrap.dataset.pc || '', productName: name, quantity: qty, unitPrice: price, taxRate: rate });
  });
  return out;
}

function _pciComputeTotals(lines) {
  var subtotal = 0, tax = 0;
  lines.forEach(function (it) { var amt = (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0); subtotal += amt; tax += Math.floor(amt * (Number(it.taxRate) || 0) / 100); });
  return { subtotal: subtotal, tax: tax, total: subtotal + tax };
}
function _pciRenderTotals() {
  var t = _pciComputeTotals(_pciCollectLines());
  var a = _pciEl('pcinv-subtotal'); if (a) a.textContent = _pciYen(t.subtotal);
  var b = _pciEl('pcinv-tax'); if (b) b.textContent = _pciYen(t.tax);
  var c = _pciEl('pcinv-total'); if (c) c.textContent = _pciYen(t.total);
}

/* ── フォーム流し込み（複製/編集/取込 共通） ─────────────── */
function _pciPrefill(items, header) {
  header = header || {};
  var host = _pciEl('pcinv-lines'); if (host) host.innerHTML = '';
  (items && items.length ? items : [null]).forEach(function (it) { _pciAddLine(it || undefined); });
  if (header.customerId !== undefined) { var cs = _pciEl('pcinv-customer'); if (cs) cs.value = header.customerId || ''; }
  var setv = function (id, v) { var el = _pciEl(id); if (el && v !== undefined) el.value = v || ''; };
  setv('pcinv-subject', header.subject);
  setv('pcinv-delivery', header.deliveryDate);
  setv('pcinv-terms', header.paymentTerms);
  setv('pcinv-memo', header.memo);
  _pciRenderTotals();
}

/* ── 発行 / 更新 ──────────────────────────────────────── */
async function _pciSubmit() {
  var customerId = _pciVal('pcinv-customer');
  if (!customerId) return _pciToast('宛先を選択してください（未登録なら設定＞顧客マスタで追加）', 'error');
  var lines = _pciCollectLines();
  if (!lines.length) return _pciToast('明細を1件以上入力してください', 'error');
  var L = _PCI_LABELS[_pciDocType];

  var payload = {
    docType: _pciDocType,
    customerId: customerId,
    issueDate: _pciVal('pcinv-issue-date') || _pciToday(),
    subject: (_pciVal('pcinv-subject') || '').trim(),
    deliveryDate: _pciVal('pcinv-delivery') || '',
    paymentTerms: (_pciVal('pcinv-terms') || '').trim(),
    memo: (_pciVal('pcinv-memo') || '').trim(),
    items: lines
  };
  if (L.date2Field) payload[L.date2Field] = _pciVal('pcinv-date2') || '';

  var editing = !!_pciEditDocId;
  if (editing) payload.docId = _pciEditDocId;

  var btn = _pciEl('pcinv-issue-btn'); if (btn) btn.disabled = true;
  try {
    var res = await callGAS(editing ? 'updateDocument' : 'issueDocument', payload);
    if (res && res.status === 'ok') {
      var docId = res.docId || _pciEditDocId || '';
      _pciToast(L.title + (editing ? 'を更新しました ✓' : 'を発行しました ✓（' + docId + '）'), 'success');
      var cust = _pciCustomerById(customerId);
      _pciShowPreview({
        docType: _pciDocType, docId: docId, issueDate: payload.issueDate,
        date2Label: L.date2, date2: payload[L.date2Field] || '',
        subject: payload.subject, deliveryDate: payload.deliveryDate, paymentTerms: payload.paymentTerms,
        customerName: cust ? cust.name : '', honorific: _pciVal('pcinv-honorific'),
        customerAddr: cust ? [cust.postalCode ? '〒' + cust.postalCode : '', cust.address || ''].filter(Boolean).join(' ') : '',
        items: lines.map(function (it) { return { productName: it.productName, quantity: it.quantity, unitPrice: it.unitPrice, taxRate: it.taxRate, amount: (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0) }; }),
        subtotal: (res.subtotal != null ? res.subtotal : _pciComputeTotals(lines).subtotal),
        tax: (res.tax != null ? res.tax : _pciComputeTotals(lines).tax),
        total: (res.total != null ? res.total : _pciComputeTotals(lines).total),
        memo: payload.memo
      });
      _pciCancelEdit();     // 編集/新規いずれもフォームを初期化
      _pciLoadDocs();
    } else {
      _pciToast((res && res.message) || '処理に失敗しました', 'error');
    }
  } catch (e) {
    _pciToast('通信エラーで処理できませんでした', 'error');
  } finally { if (btn) btn.disabled = false; }
}

/* ── 編集/複製 状態 ───────────────────────────────────── */
function _pciEnterEdit(d) {
  _pciEditDocId = _pciDocId(d);
  _pciPrefill((Array.isArray(d.items) ? d.items : []), {
    customerId: d.customerId || '', subject: d['件名'] || '', deliveryDate: d['納期'] || '', paymentTerms: d['支払条件'] || '', memo: d['メモ'] || ''
  });
  var d2 = _pciEl('pcinv-date2'); if (d2) d2.value = d['支払期限'] || d['有効期限'] || '';
  var idt = _pciEl('pcinv-issue-date'); if (idt && d['発行日']) idt.value = String(d['発行日']).slice(0, 10);
  var ind = _pciEl('pcinv-editing'); if (ind) ind.classList.add('pcinv-editing--on');
  var cancel = _pciEl('pcinv-cancel-edit'); if (cancel) cancel.hidden = false;
  var btn = _pciEl('pcinv-issue-btn'); if (btn) btn.textContent = _PCI_LABELS[_pciDocType].updateBtn;
  try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
}
function _pciDuplicate(d) {
  _pciEditDocId = null;   // 複製＝新規発行
  _pciPrefill((Array.isArray(d.items) ? d.items : []), {
    customerId: d.customerId || '', subject: d['件名'] || '', deliveryDate: d['納期'] || '', paymentTerms: d['支払条件'] || '', memo: d['メモ'] || ''
  });
  var idt = _pciEl('pcinv-issue-date'); if (idt) idt.value = _pciToday();   // 複製＝新規ゆえ発行日は当日
  _pciExitEditUI();
  _pciToast('複製しました。宛先を選び直して発行できます。', 'success');
  try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
}
function _pciCancelEdit() {
  _pciEditDocId = null;
  _pciExitEditUI();
  var host = _pciEl('pcinv-lines'); if (host) host.innerHTML = '';
  _pciAddLine();
  ['pcinv-subject', 'pcinv-delivery', 'pcinv-terms', 'pcinv-memo', 'pcinv-date2'].forEach(function (id) { var el = _pciEl(id); if (el) el.value = ''; });
  var idt = _pciEl('pcinv-issue-date'); if (idt) idt.value = _pciToday();   // 新規＝発行日は当日
  _pciSalesRows = []; _pciRenderSalesList();
  _pciRenderTotals();
}
function _pciExitEditUI() {
  var ind = _pciEl('pcinv-editing'); if (ind) ind.classList.remove('pcinv-editing--on');
  var cancel = _pciEl('pcinv-cancel-edit'); if (cancel) cancel.hidden = true;
  var btn = _pciEl('pcinv-issue-btn'); if (btn) btn.textContent = _PCI_LABELS[_pciDocType].issueBtn;
}

/* ── 顧客別一覧 ───────────────────────────────────────── */
function _pciDocId(d) { return d.invoiceId || d.estimateId || d.docId || ''; }
async function _pciLoadDocs() {
  var cont = _pciEl('pcinv-docs-list'); if (!cont) return;
  cont.innerHTML = '<div class="pcinv-empty">読み込み中…</div>';
  var docType = _pciDocType;
  var payload = { docType: docType };
  var cf = _pciVal('pcinv-list-customer'); if (cf) payload.customerId = cf;
  var docs = [];
  try { var res = await callGAS('getDocuments', payload); docs = (res && res.status === 'ok' && Array.isArray(res.documents)) ? res.documents : []; } catch (e) { docs = []; }
  if (docType !== _pciDocType) return;
  _pciDocs = docs;
  _pciRenderDocs(docs);
}
function _pciRenderDocs(docs) {
  var cont = _pciEl('pcinv-docs-list'); if (!cont) return;
  if (!docs.length) { cont.innerHTML = '<div class="pcinv-empty">まだ発行済みの書類はありません。</div>'; return; }
  docs.sort(function (a, b) { return String(_pciDocId(b)).localeCompare(String(_pciDocId(a))); });
  var isEst = _pciDocType === 'estimate';
  cont.innerHTML = docs.map(function (d) {
    var did = _pciDocId(d);
    var cust = _pciCustomerById(d.customerId);
    var cname = cust ? cust.name : (d.customerId ? '(' + d.customerId + ')' : '（宛先未指定）');
    var status = d['ステータス'] || '発行済';
    var subj = d['件名'] ? '｜' + _pciEsc(d['件名']) : '';
    return '' +
      '<div class="pcinv-doc-row" data-docid="' + _pciEsc(did) + '">' +
        '<div class="pcinv-doc-row__main" data-act="preview">' +
          '<div class="pcinv-doc-row__name">' + _pciEsc(cname) + subj + '</div>' +
          '<div class="pcinv-doc-row__meta">' + _pciEsc(did) + '　' + _pciEsc(d['発行日'] || '') + '　' + _pciEsc(status) + '</div>' +
        '</div>' +
        '<span class="pcinv-doc-row__amt">' + _pciYen(d['合計']) + '</span>' +
        '<button type="button" class="pcinv-mini" data-act="dup">複製</button>' +
        (isEst ? '<button type="button" class="pcinv-mini" data-act="edit">編集</button>' : '') +
      '</div>';
  }).join('');
  Array.prototype.forEach.call(cont.querySelectorAll('.pcinv-doc-row'), function (row) {
    var did = row.getAttribute('data-docid');
    var d = docs.filter(function (x) { return _pciDocId(x) === did; })[0];
    row.addEventListener('click', function (e) {
      var act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
      if (!act && e.target && e.target.closest) { var m = e.target.closest('[data-act]'); act = m ? m.getAttribute('data-act') : ''; }
      if (!d) return;
      if (act === 'dup') _pciDuplicate(d);
      else if (act === 'edit') _pciEnterEdit(d);
      else _pciPreviewStored(d);
    });
  });
}
function _pciPreviewStored(d) {
  var L = _PCI_LABELS[_pciDocType];
  var cust = _pciCustomerById(d.customerId);
  var items = (Array.isArray(d.items) ? d.items : []).map(function (it) {
    return { productName: it.productName || '', quantity: it.quantity || 0, unitPrice: it.unitPrice || 0, taxRate: it.taxRate || 0, amount: it.amount != null ? it.amount : (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0) };
  });
  _pciShowPreview({
    docType: _pciDocType, docId: _pciDocId(d), issueDate: d['発行日'] || '',
    date2Label: L.date2, date2: d['支払期限'] || d['有効期限'] || '',
    subject: d['件名'] || '', deliveryDate: d['納期'] || '', paymentTerms: d['支払条件'] || '',
    customerName: cust ? cust.name : (d.customerId || ''), honorific: _pciHonorificDefault,
    customerAddr: cust ? [cust.postalCode ? '〒' + cust.postalCode : '', cust.address || ''].filter(Boolean).join(' ') : '',
    items: items, subtotal: Number(d['小計']) || 0, tax: Number(d['消費税']) || 0, total: Number(d['合計']) || 0, memo: d['メモ'] || ''
  });
}

/* ── プレビュー（印刷用A4書面） ───────────────────────── */
function _pciBindPreview() {
  var close = _pciEl('pcinv-preview-close'); if (close) close.addEventListener('click', _pciClosePreview);
  var print = _pciEl('pcinv-preview-print'); if (print) print.addEventListener('click', function () { window.print(); });
  var modal = _pciEl('pcinv-preview'); if (modal) modal.addEventListener('click', function (e) { if (e.target === modal) _pciClosePreview(); });
}
function _pciClosePreview() {
  var modal = _pciEl('pcinv-preview'); if (modal) { modal.classList.remove('pcinv-modal--open'); modal.setAttribute('aria-hidden', 'true'); }
}
function _pciShowPreview(doc) {
  var area = _pciEl('pcinv-print-area'); var modal = _pciEl('pcinv-preview');
  if (!area || !modal) return;
  var L = _PCI_LABELS[doc.docType] || _PCI_LABELS.estimate;
  var toName = _pciEsc(doc.customerName || '') + (doc.honorific ? '　' + _pciEsc(doc.honorific) : '');
  var rows = (doc.items || []).map(function (it) {
    return '<tr><td>' + _pciEsc(it.productName) + '</td><td class="num">' + (Number(it.quantity) || 0).toLocaleString('ja-JP') + '</td><td class="num">' + _pciYen(it.unitPrice) + '</td><td class="num">' + (Number(it.taxRate) || 0) + '%</td><td class="num">' + _pciYen(it.amount) + '</td></tr>';
  }).join('');
  var metaLines = ['発行日：' + _pciEsc(doc.issueDate || '')];
  if (doc.date2) metaLines.push(_pciEsc(doc.date2Label) + '：' + _pciEsc(doc.date2));
  if (doc.deliveryDate) metaLines.push('納期：' + _pciEsc(doc.deliveryDate));
  if (doc.docId) metaLines.push('No. ' + _pciEsc(doc.docId));

  area.innerHTML =
    '<div class="pcinv-doc">' +
      '<div class="pcinv-doc__title">' + _pciEsc(L.title) + '</div>' +
      (doc.subject ? '<div class="pcinv-doc__subject">件名：' + _pciEsc(doc.subject) + '</div>' : '') +
      '<div class="pcinv-doc__top">' +
        '<div class="pcinv-doc__to"><div class="pcinv-doc__to-name">' + toName + '</div>' +
          (doc.customerAddr ? '<div class="pcinv-doc__to-addr">' + _pciEsc(doc.customerAddr) + '</div>' : '') + '</div>' +
        '<div class="pcinv-doc__from"><div style="font-weight:700;font-size:14px;">' + _pciEsc(_pciStoreName || '') + '</div>' +
          '<div class="pcinv-doc__meta">' + metaLines.join('<br>') + '</div></div>' +
      '</div>' +
      '<div class="pcinv-doc__grand">' + _pciEsc(L.grand) + '　' + _pciYen(doc.total) + '（税込）</div>' +
      '<table class="pcinv-doc__table"><thead><tr><th>品名</th><th>数量</th><th>単価</th><th>税率</th><th>金額</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="5">明細なし</td></tr>') + '</tbody></table>' +
      '<div class="pcinv-doc__sums">' +
        '<div class="pcinv-doc__sum-row"><span>小計（税抜）</span><span>' + _pciYen(doc.subtotal) + '</span></div>' +
        '<div class="pcinv-doc__sum-row"><span>消費税</span><span>' + _pciYen(doc.tax) + '</span></div>' +
        '<div class="pcinv-doc__sum-row pcinv-doc__sum-row--grand"><span>合計</span><span>' + _pciYen(doc.total) + '</span></div>' +
      '</div>' +
      (doc.paymentTerms ? '<div class="pcinv-doc__terms">お支払条件：' + _pciEsc(doc.paymentTerms) + '</div>' : '') +
      (doc.memo ? '<div class="pcinv-doc__memo">備考：' + _pciEsc(doc.memo) + '</div>' : '') +
    '</div>';
  modal.classList.add('pcinv-modal--open');
  modal.setAttribute('aria-hidden', 'false');
}
