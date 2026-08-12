/**
 * invoice-issue.js — 書類発行UI（第4隊員 doc_automation・Phase4 Slice2）
 *
 * 設計（→ 05_将来構想.md §8-5・03_データ仕様.md §1-6・引き継ぎ.md 確定済み前提）：
 *  - 見積(estimate)/請求(invoice)/納品(delivery) を発行し、印刷用の書面プレビューを出す。
 *  - 明細＝商品マスタ(products)のSKU（商品名×分類）を参照＝選ぶと単価・税率が入る。
 *    「同じ商品を店内/テイクアウト/卸しで売り分け」は分類ちがいのSKUを選ぶ＝チャネル区分
 *    （売上入力側と同じ考え方・別チャネル列は持たない）。マスタ外は自由入力で足せる。
 *  - 宛名＝顧客マスタ(customers)。敬称は settings.invoiceSettings.honorificDefault を既定に、
 *    発行時に選択（顧客マスタには持たない＝確定済み前提）。
 *  - 金額は明細の 単価×数量（税抜）を合計し、税率別に消費税を算出（GAS issueDocument と一致）。
 *  - doc_automation ON の店だけ本体を出す（OFFは案内のみ）。3デバイス共通・密度可変。
 *
 * グローバル関数イディオム（settings.js / masters-doc.js と同型・onclick から参照）。
 * 共有グローバル空間のため inv / _inv 接頭辞で命名し衝突を避ける。GAS/表示ヘルパは app.js を用いる。
 */
'use strict';

var _invProducts = [];
var _invCustomers = [];
var _invStoreName = '';
var _invHonorificDefault = '御中';
var _invDocType = 'invoice';   // estimate | invoice | delivery
var _invLineSeq = 0;

var _INV_DOC_LABELS = {
  estimate: { title: '見積書', issueBtn: '見積書を発行', listTitle: '発行済みの見積書', date2: '有効期限', date2Field: 'validUntil' },
  invoice:  { title: '請求書', issueBtn: '請求書を発行', listTitle: '発行済みの請求書', date2: '支払期限', date2Field: 'dueDate' },
  delivery: { title: '納品書', issueBtn: '納品書を発行', listTitle: '発行済みの納品書', date2: '', date2Field: '' }
};

/* ── 小ヘルパ ─────────────────────────────────────────── */
function _invEsc(s) { return (typeof uzEscHtml === 'function') ? uzEscHtml(s == null ? '' : String(s)) : String(s == null ? '' : s); }
function _invToast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'info'); }
function _invEl(id) { return document.getElementById(id); }
function _invVal(id) { var el = _invEl(id); return el ? el.value : ''; }
function _invYen(n) { return '¥' + (Number(n) || 0).toLocaleString('ja-JP'); }
function _invTodayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

/* ── 起動 ─────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  if (typeof uzDocAutomationEnabled !== 'function') { _invShowOff(); return; }
  uzDocAutomationEnabled().then(function (on) {
    if (!on) { _invShowOff(); return; }
    _invInit();
  }).catch(function () { _invShowOff(); });
});

function _invShowOff() {
  var off = _invEl('inv-off'); if (off) off.hidden = false;
  var main = _invEl('inv-main'); if (main) main.hidden = true;
}

async function _invInit() {
  var off = _invEl('inv-off'); if (off) off.hidden = true;
  var main = _invEl('inv-main'); if (main) main.hidden = false;

  // 発行日の既定＝今日
  var idt = _invEl('inv-issue-date'); if (idt) idt.value = _invTodayStr();

  // マスタ・設定を並行取得
  try {
    var results = await Promise.all([
      callGAS('getProducts', {}),
      callGAS('getCustomers', {}),
      (typeof uzGetSettingsOnce === 'function') ? uzGetSettingsOnce() : uzGetSettings()
    ]);
    var pr = results[0], cs = results[1], settings = results[2];
    _invProducts = (pr && pr.status === 'ok' && Array.isArray(pr.products)) ? pr.products.filter(function (p) { return p.enabled !== false; }) : [];
    _invCustomers = (cs && cs.status === 'ok' && Array.isArray(cs.customers)) ? cs.customers : [];
    if (settings) {
      _invStoreName = settings.storeName || '';
      if (settings.invoiceSettings && settings.invoiceSettings.honorificDefault) {
        _invHonorificDefault = settings.invoiceSettings.honorificDefault;
      }
    }
  } catch (e) {
    _invProducts = []; _invCustomers = [];
  }

  _invFillCustomers();
  var hon = _invEl('inv-honorific'); if (hon) hon.value = _invHonorificDefault;

  _invBindTypeTabs();
  var add = _invEl('inv-addline-btn'); if (add) add.addEventListener('click', function () { _invAddLine(); });
  var issue = _invEl('inv-issue-btn'); if (issue) issue.addEventListener('click', _invIssue);
  _invBindPreview();

  _invSetDocType('invoice');
  _invAddLine();          // 最初の空明細を1行
  _invRenderTotals();
  _invLoadDocs();
}

/* ── 宛先（顧客マスタ） ───────────────────────────────── */
function _invFillCustomers() {
  var sel = _invEl('inv-customer');
  if (!sel) return;
  var opts = ['<option value="">選択してください</option>'];
  _invCustomers.forEach(function (c) {
    opts.push('<option value="' + _invEsc(c.customerId) + '">' + _invEsc(c.name) + '</option>');
  });
  sel.innerHTML = opts.join('');
}
function _invCustomerById(id) {
  id = String(id || '');
  for (var i = 0; i < _invCustomers.length; i++) {
    if (String(_invCustomers[i].customerId) === id) return _invCustomers[i];
  }
  return null;
}

/* ── 書類種別（見積/請求/納品） ───────────────────────── */
function _invBindTypeTabs() {
  var tabs = document.querySelectorAll('.inv-type-tab');
  tabs.forEach(function (t) {
    t.addEventListener('click', function () { _invSetDocType(t.getAttribute('data-type')); });
  });
}
function _invSetDocType(type) {
  if (!_INV_DOC_LABELS[type]) type = 'invoice';
  _invDocType = type;
  var L = _INV_DOC_LABELS[type];

  document.querySelectorAll('.inv-type-tab').forEach(function (t) {
    var on = t.getAttribute('data-type') === type;
    t.classList.toggle('inv-type-tab--active', on);
    if (on) t.setAttribute('aria-selected', 'true'); else t.removeAttribute('aria-selected');
  });

  // 第2日付（支払期限/有効期限/なし）を出し分け
  var wrap = _invEl('inv-date2-wrap');
  var lbl = _invEl('inv-date2-label');
  if (wrap) wrap.style.display = L.date2 ? '' : 'none';
  if (lbl && L.date2) lbl.textContent = L.date2;

  var ib = _invEl('inv-issue-btn'); if (ib) ib.textContent = L.issueBtn;
  var lt = _invEl('inv-docs-title'); if (lt) lt.textContent = L.listTitle;

  _invLoadDocs();
}

/* ── 明細 ─────────────────────────────────────────────── */
function _invProductOptions() {
  // 商品マスタSKU（商品名×分類）を1行1SKUで並べる。表示＝商品名（分類）¥単価 [税率]。
  var opts = ['<option value="">商品を選択…</option>'];
  _invProducts.forEach(function (p) {
    var cat = String(p.categoryL1 || '').trim();
    var label = String(p.productName || '') + (cat ? '（' + cat + '）' : '') +
                '  ' + _invYen(p.unitPrice) + ' [' + (Number(p.taxRate) || 0) + '%]';
    opts.push('<option value="' + _invEsc(p.productCode) + '">' + _invEsc(label) + '</option>');
  });
  opts.push('<option value="__custom__">その他（自由入力）</option>');
  return opts.join('');
}

function _invAddLine(prefill) {
  var host = _invEl('inv-lines');
  if (!host) return;
  var id = 'invln-' + (++_invLineSeq);
  var wrap = document.createElement('div');
  wrap.className = 'inv-line';
  wrap.id = id;
  wrap.innerHTML =
    '<div class="inv-line__prod">' +
      '<select class="inv-select" id="' + id + '-prod" aria-label="商品">' + _invProductOptions() + '</select>' +
    '</div>' +
    '<div class="inv-line__custom" id="' + id + '-custom">' +
      '<input type="text" class="inv-input" id="' + id + '-cname" placeholder="品名（自由入力）" maxlength="60">' +
      '<input type="number" class="inv-input" id="' + id + '-cprice" placeholder="単価(税抜)" min="0" inputmode="numeric">' +
    '</div>' +
    '<div class="inv-line__nums">' +
      '<div><label>数量</label><input type="number" class="inv-input" id="' + id + '-qty" value="1" min="0" step="1" inputmode="numeric"></div>' +
      '<div><label>単価(税抜)</label><input type="number" class="inv-input" id="' + id + '-price" value="0" min="0" inputmode="numeric" readonly></div>' +
      '<div><label>税率</label>' +
        '<select class="inv-select" id="' + id + '-tax" aria-label="税率">' +
          '<option value="10">10%</option><option value="8">8%(軽減)</option><option value="0">0%</option>' +
        '</select></div>' +
      '<div><label>&nbsp;</label><button type="button" class="inv-line__del" aria-label="この明細を削除">×</button></div>' +
    '</div>' +
    '<div class="inv-line__amount" id="' + id + '-amt">¥0</div>';
  host.appendChild(wrap);

  var prodSel = _invEl(id + '-prod');
  prodSel.addEventListener('change', function () { _invOnProductChange(id); });
  _invEl(id + '-qty').addEventListener('input', function () { _invRecalcLine(id); });
  _invEl(id + '-cprice').addEventListener('input', function () { _invRecalcLine(id); });
  _invEl(id + '-price').addEventListener('input', function () { _invRecalcLine(id); });
  _invEl(id + '-tax').addEventListener('change', function () { _invRecalcLine(id); });
  _invEl(id + '-cname').addEventListener('input', function () { _invRecalcLine(id); });
  wrap.querySelector('.inv-line__del').addEventListener('click', function () { _invRemoveLine(id); });

  if (prefill && prefill.productCode) {
    prodSel.value = prefill.productCode;
    _invOnProductChange(id);
    if (prefill.quantity != null) _invEl(id + '-qty').value = prefill.quantity;
    _invRecalcLine(id);
  }
  return id;
}

function _invOnProductChange(id) {
  var code = _invVal(id + '-prod');
  var wrap = _invEl(id);
  var priceEl = _invEl(id + '-price');
  var taxEl = _invEl(id + '-tax');
  if (code === '__custom__') {
    wrap.classList.add('inv-line--custom');
    priceEl.readOnly = true;                 // 単価は自由入力欄側で入れる
    priceEl.value = _invVal(id + '-cprice') || 0;
  } else {
    wrap.classList.remove('inv-line--custom');
    var p = null;
    for (var i = 0; i < _invProducts.length; i++) { if (String(_invProducts[i].productCode) === String(code)) { p = _invProducts[i]; break; } }
    if (p) {
      priceEl.readOnly = true;
      priceEl.value = Number(p.unitPrice) || 0;
      taxEl.value = String(Number(p.taxRate) || 0);
    } else {
      priceEl.readOnly = false;
      priceEl.value = 0;
    }
  }
  _invRecalcLine(id);
}

function _invRecalcLine(id) {
  var wrap = _invEl(id);
  if (!wrap) return;
  var isCustom = wrap.classList.contains('inv-line--custom');
  if (isCustom) {
    // 自由入力：単価は cprice を price へ反映（集計は price を正とする）
    var cp = Number(_invVal(id + '-cprice')) || 0;
    var pe = _invEl(id + '-price'); if (pe) pe.value = cp;
  }
  var qty = Number(_invVal(id + '-qty')) || 0;
  var price = Number(_invVal(id + '-price')) || 0;
  var amt = qty * price;
  var amtEl = _invEl(id + '-amt'); if (amtEl) amtEl.textContent = _invYen(amt);
  _invRenderTotals();
}

function _invRemoveLine(id) {
  var wrap = _invEl(id);
  if (wrap) wrap.parentNode.removeChild(wrap);
  // 最低1行は残す
  var host = _invEl('inv-lines');
  if (host && !host.children.length) _invAddLine();
  _invRenderTotals();
}

/* DOM から明細行を収集（数量>0 かつ 品名あり を有効行とする）。 */
function _invCollectLines() {
  var host = _invEl('inv-lines');
  if (!host) return [];
  var out = [];
  Array.prototype.forEach.call(host.children, function (wrap) {
    var id = wrap.id;
    var isCustom = wrap.classList.contains('inv-line--custom');
    var code = _invVal(id + '-prod');
    var name = '', pc = '';
    if (isCustom || code === '__custom__') {
      name = (_invVal(id + '-cname') || '').trim();
      pc = '';
    } else if (code) {
      pc = code;
      for (var i = 0; i < _invProducts.length; i++) { if (String(_invProducts[i].productCode) === String(code)) { name = _invProducts[i].productName; break; } }
    }
    var qty = Number(_invVal(id + '-qty')) || 0;
    var price = Number(_invVal(id + '-price')) || 0;
    var rate = Number(_invVal(id + '-tax')) || 0;
    if (!name || qty <= 0) return;
    out.push({ productCode: pc, productName: name, quantity: qty, unitPrice: price, taxRate: rate });
  });
  return out;
}

/* 集計（GAS issueDocument と同じ：税は行ごとに floor(金額×率/100)）。 */
function _invComputeTotals(lines) {
  var subtotal = 0, tax = 0;
  lines.forEach(function (it) {
    var amt = (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
    subtotal += amt;
    tax += Math.floor(amt * (Number(it.taxRate) || 0) / 100);
  });
  return { subtotal: subtotal, tax: tax, total: subtotal + tax };
}

function _invRenderTotals() {
  var t = _invComputeTotals(_invCollectLines());
  var a = _invEl('inv-subtotal'); if (a) a.textContent = _invYen(t.subtotal);
  var b = _invEl('inv-tax'); if (b) b.textContent = _invYen(t.tax);
  var c = _invEl('inv-total'); if (c) c.textContent = _invYen(t.total);
}

/* ── 発行 ─────────────────────────────────────────────── */
async function _invIssue() {
  var customerId = _invVal('inv-customer');
  if (!customerId) return _invToast('宛先を選択してください（未登録なら設定＞顧客マスタで追加）', 'error');
  var lines = _invCollectLines();
  if (!lines.length) return _invToast('明細を1件以上入力してください', 'error');

  var payload = {
    docType: _invDocType,
    customerId: customerId,
    issueDate: _invVal('inv-issue-date') || _invTodayStr(),
    memo: (_invVal('inv-memo') || '').trim(),
    items: lines
  };
  var L = _INV_DOC_LABELS[_invDocType];
  if (L.date2Field) payload[L.date2Field] = _invVal('inv-date2') || '';

  var btn = _invEl('inv-issue-btn');
  if (btn) btn.disabled = true;
  try {
    var res = await callGAS('issueDocument', payload);
    if (res && res.status === 'ok') {
      _invToast(L.title + 'を発行しました ✓（' + (res.docId || '') + '）', 'success');
      // プレビュー（発行直後は敬称を反映）
      var cust = _invCustomerById(customerId);
      _invShowPreview({
        docType: _invDocType,
        docId: res.docId || '',
        issueDate: payload.issueDate,
        date2Field: L.date2Field,
        date2Label: L.date2,
        date2: payload[L.date2Field] || '',
        customerName: cust ? cust.name : '',
        customerAddr: cust ? [cust.postalCode ? '〒' + cust.postalCode : '', cust.address || ''].filter(Boolean).join(' ') : '',
        honorific: _invVal('inv-honorific'),
        items: lines.map(function (it) { return { productName: it.productName, quantity: it.quantity, unitPrice: it.unitPrice, taxRate: it.taxRate, amount: (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0) }; }),
        subtotal: (res.subtotal != null ? res.subtotal : _invComputeTotals(lines).subtotal),
        tax: (res.tax != null ? res.tax : _invComputeTotals(lines).tax),
        total: (res.total != null ? res.total : _invComputeTotals(lines).total),
        memo: payload.memo
      });
      _invResetForm();
      _invLoadDocs();
    } else {
      _invToast((res && res.message) || '発行に失敗しました', 'error');
    }
  } catch (e) {
    _invToast('通信エラーで発行できませんでした', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function _invResetForm() {
  var host = _invEl('inv-lines'); if (host) host.innerHTML = '';
  _invAddLine();
  var memo = _invEl('inv-memo'); if (memo) memo.value = '';
  var d2 = _invEl('inv-date2'); if (d2) d2.value = '';
  _invRenderTotals();
}

/* ── 発行済み一覧 ─────────────────────────────────────── */
async function _invLoadDocs() {
  var cont = _invEl('inv-docs-list');
  if (!cont) return;
  cont.innerHTML = '<div class="inv-empty">読み込み中…</div>';
  var docType = _invDocType;
  var docs = [];
  try {
    var res = await callGAS('getDocuments', { docType: docType });
    docs = (res && res.status === 'ok' && Array.isArray(res.documents)) ? res.documents : [];
  } catch (e) { docs = []; }
  if (docType !== _invDocType) return; // 種別が切り替わっていたら破棄
  _invRenderDocs(docs);
}

function _invDocIdOf(d) { return d.invoiceId || d.estimateId || d.deliveryId || d.docId || ''; }

function _invRenderDocs(docs) {
  var cont = _invEl('inv-docs-list');
  if (!cont) return;
  if (!docs.length) {
    cont.innerHTML = '<div class="inv-empty">まだ発行済みの書類はありません。</div>';
    return;
  }
  // 新しい順（発行日→ID）
  docs.sort(function (a, b) { return String(_invDocIdOf(b)).localeCompare(String(_invDocIdOf(a))); });
  cont.innerHTML = docs.map(function (d) {
    var did = _invDocIdOf(d);
    var cust = _invCustomerById(d.customerId);
    var cname = cust ? cust.name : (d.customerId ? '(' + d.customerId + ')' : '（宛先未指定）');
    var status = d['ステータス'] || '発行済';
    var paid = status === '入金済';
    return '' +
      '<div class="inv-doc-row" data-docid="' + _invEsc(did) + '">' +
        '<div class="inv-doc-row__main">' +
          '<div class="inv-doc-row__name">' + _invEsc(cname) + '</div>' +
          '<div class="inv-doc-row__meta">' + _invEsc(did) + '　' + _invEsc(d['発行日'] || '') + '</div>' +
        '</div>' +
        '<span class="inv-badge ' + (paid ? 'inv-badge--paid' : 'inv-badge--issued') + '">' + _invEsc(status) + '</span>' +
        '<span class="inv-doc-row__amt">' + _invYen(d['合計']) + '</span>' +
      '</div>';
  }).join('');
  // 行クリック → プレビュー再表示
  Array.prototype.forEach.call(cont.querySelectorAll('.inv-doc-row'), function (row) {
    row.addEventListener('click', function () {
      var did = row.getAttribute('data-docid');
      var d = docs.filter(function (x) { return _invDocIdOf(x) === did; })[0];
      if (d) _invPreviewFromStored(d);
    });
  });
}

/* 保存済み書類（getDocuments の行）からプレビューを組む。敬称は保存していないため settings 既定を用いる。 */
function _invPreviewFromStored(d) {
  var L = _INV_DOC_LABELS[_invDocType];
  var cust = _invCustomerById(d.customerId);
  var items = (Array.isArray(d.items) ? d.items : []).map(function (it) {
    return { productName: it.productName || '', quantity: it.quantity || 0, unitPrice: it.unitPrice || 0, taxRate: it.taxRate || 0, amount: it.amount != null ? it.amount : (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0) };
  });
  _invShowPreview({
    docType: _invDocType,
    docId: _invDocIdOf(d),
    issueDate: d['発行日'] || '',
    date2Field: L.date2Field,
    date2Label: L.date2,
    date2: d['支払期限'] || d['有効期限'] || '',
    customerName: cust ? cust.name : (d.customerId || ''),
    customerAddr: cust ? [cust.postalCode ? '〒' + cust.postalCode : '', cust.address || ''].filter(Boolean).join(' ') : '',
    honorific: _invHonorificDefault,
    items: items,
    subtotal: Number(d['小計']) || 0,
    tax: Number(d['消費税']) || 0,
    total: Number(d['合計']) || 0,
    memo: d['メモ'] || ''
  });
}

/* ── プレビュー（印刷用書面） ─────────────────────────── */
function _invBindPreview() {
  var close = _invEl('inv-preview-close');
  if (close) close.addEventListener('click', _invClosePreview);
  var print = _invEl('inv-preview-print');
  if (print) print.addEventListener('click', function () { window.print(); });
  var modal = _invEl('inv-preview');
  if (modal) modal.addEventListener('click', function (e) { if (e.target === modal) _invClosePreview(); });
}
function _invClosePreview() {
  var modal = _invEl('inv-preview');
  if (modal) { modal.classList.remove('inv-modal--open'); modal.setAttribute('aria-hidden', 'true'); }
}

function _invShowPreview(doc) {
  var area = _invEl('inv-print-area');
  var modal = _invEl('inv-preview');
  if (!area || !modal) return;
  var L = _INV_DOC_LABELS[doc.docType] || _INV_DOC_LABELS.invoice;
  var toName = _invEsc(doc.customerName || '') + (doc.honorific ? '　' + _invEsc(doc.honorific) : '');

  var rows = (doc.items || []).map(function (it) {
    return '<tr>' +
      '<td>' + _invEsc(it.productName) + '</td>' +
      '<td class="num">' + (Number(it.quantity) || 0).toLocaleString('ja-JP') + '</td>' +
      '<td class="num">' + _invYen(it.unitPrice) + '</td>' +
      '<td class="num">' + (Number(it.taxRate) || 0) + '%</td>' +
      '<td class="num">' + _invYen(it.amount) + '</td>' +
    '</tr>';
  }).join('');

  var metaLines = ['発行日：' + _invEsc(doc.issueDate || '')];
  if (doc.date2Field && doc.date2) metaLines.push(_invEsc(doc.date2Label) + '：' + _invEsc(doc.date2));
  if (doc.docId) metaLines.push('No. ' + _invEsc(doc.docId));

  area.innerHTML =
    '<div class="inv-doc">' +
      '<div class="inv-doc__title">' + _invEsc(L.title) + '</div>' +
      '<div class="inv-doc__top">' +
        '<div class="inv-doc__to">' +
          '<div class="inv-doc__to-name">' + toName + '</div>' +
          (doc.customerAddr ? '<div class="inv-doc__to-addr">' + _invEsc(doc.customerAddr) + '</div>' : '') +
        '</div>' +
        '<div class="inv-doc__from">' +
          '<div style="font-weight:700;font-size:14px;">' + _invEsc(_invStoreName || '') + '</div>' +
          '<div class="inv-doc__meta">' + metaLines.join('<br>') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="inv-doc__grand">' + _invEsc(L.title === '見積書' ? 'お見積金額' : (L.title === '納品書' ? '納品金額' : 'ご請求金額')) + '　' + _invYen(doc.total) + '（税込）</div>' +
      '<table class="inv-doc__table">' +
        '<thead><tr><th>品名</th><th>数量</th><th>単価</th><th>税率</th><th>金額</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="5">明細なし</td></tr>') + '</tbody>' +
      '</table>' +
      '<div class="inv-doc__sums">' +
        '<div class="inv-doc__sum-row"><span>小計（税抜）</span><span>' + _invYen(doc.subtotal) + '</span></div>' +
        '<div class="inv-doc__sum-row"><span>消費税</span><span>' + _invYen(doc.tax) + '</span></div>' +
        '<div class="inv-doc__sum-row inv-doc__sum-row--grand"><span>合計</span><span>' + _invYen(doc.total) + '</span></div>' +
      '</div>' +
      (doc.memo ? '<div class="inv-doc__memo">備考：' + _invEsc(doc.memo) + '</div>' : '') +
    '</div>';

  modal.classList.add('inv-modal--open');
  modal.setAttribute('aria-hidden', 'false');
}
