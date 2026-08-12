/**
 * masters-doc.js — 書類発行／FAX受注の土台マスタ（商品・顧客）管理UI
 *
 * 設計（→ 05_将来構想.md §8-5・03_データ仕様.md §1-6）：
 *  - 商品マスタ(products) と 顧客マスタ(customers) は、見積/請求/納品の帳票と
 *    FAX受注OCRの名寄せが共に依存する「土台」。doc_automation ON の店だけ設定画面に出す。
 *  - セクションの表示/非表示は app.js uzApplyFeatureGates（[data-feature="doc_automation"]）が担当。
 *    本ファイルは ON のとき GAS から取得して描画し、CRUD を配線する。
 *  - カテゴリ＝単一所属（1商品=大→中→小の1経路＝金額集計の骨）。タグ（多対多）は採らない。
 *    入力は3段カスケード（既存を datalist で再利用・新しい分類名を打てば追加＝乱立を抑える）。
 *  - 顧客マスタはユーザー主権（日々追加・運営ポータルは触らない）。突合キーは不変ID
 *    （productCode=pr001… / customerId=cs001…）。表示名が変わってもIDで名寄せ・帳票が繋がる。
 *
 * settings.js と同じくグローバル関数イディオム（onclickから参照）。共有グローバル空間のため
 * すべて mdoc / _mdoc 接頭辞で命名し衝突を避ける。GAS/表示ヘルパは app.js を用いる。
 */
'use strict';

var _mdocProducts = [];
var _mdocCustomers = [];

function _mdocEsc(s) {
  return (typeof uzEscHtml === 'function') ? uzEscHtml(s == null ? '' : String(s)) : String(s == null ? '' : s);
}
function _mdocToast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'info'); }
function _mdocVal(id) { var el = document.getElementById(id); return el ? el.value : ''; }
function _mdocClear(ids) { ids.forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ''; }); }

document.addEventListener('DOMContentLoaded', function () {
  // 商品/顧客マスタは doc_automation ON の店のみ。OFFなら何もしない（セクションもゲートで非表示）。
  if (typeof uzDocAutomationEnabled !== 'function') return;
  uzDocAutomationEnabled().then(function (on) {
    if (!on) return;
    _mdocBindProductAdd();
    _mdocBindCustomerAdd();
    mdocLoadProducts();
    mdocLoadCustomers();
  }).catch(function () { /* 判定不能時は何もしない（安全側＝非表示のまま） */ });
});

/* ══════════════════════════════════════════════════════════
   商品マスタ（products）
   ══════════════════════════════════════════════════════════ */
async function mdocLoadProducts() {
  var cont = document.getElementById('products-list-container');
  if (cont && !_mdocProducts.length) cont.innerHTML = '<div class="mdoc-empty">読み込み中...</div>';
  try {
    var res = await callGAS('getProducts', {});
    _mdocProducts = (res && res.status === 'ok' && Array.isArray(res.products)) ? res.products : [];
  } catch (e) { _mdocProducts = []; }
  mdocRenderProducts();
  _mdocRebuildLists();
}

function mdocRenderProducts() {
  var cont = document.getElementById('products-list-container');
  if (!cont) return;
  if (!_mdocProducts.length) {
    cont.innerHTML = '<div class="mdoc-empty">商品がまだありません。下のフォームから追加してください。</div>';
  } else {
    cont.innerHTML = _mdocProducts.map(function (p) {
      var code = _mdocEsc(p.productCode);
      var cat = _mdocEsc(String(p.categoryL1 || '').trim()) || '未分類';
      var price = '¥' + (Number(p.unitPrice) || 0).toLocaleString('ja-JP');
      var sub = cat + '　' + price + '（税' + (Number(p.taxRate) || 0) + '%）' + (p.unit ? ' /' + _mdocEsc(p.unit) : '') +
                (p.aliases ? '　別名:' + _mdocEsc(p.aliases) : '');
      return '' +
        '<div class="mdoc-row" id="product-row-' + code + '">' +
          '<div class="mdoc-row__top">' +
            '<span class="mdoc-row__name">' + _mdocEsc(p.productName) + '</span>' +
            '<button class="staff-edit-btn" type="button" onclick="mdocEditProduct(\'' + code + '\')" aria-label="編集">編集</button>' +
            '<button class="staff-delete-btn" type="button" onclick="mdocDeleteProduct(\'' + code + '\')" aria-label="削除">削除</button>' +
          '</div>' +
          '<div class="mdoc-sub">' + sub + '</div>' +
        '</div>';
    }).join('');
  }
  var badge = document.getElementById('products-count-badge');
  if (badge) { badge.hidden = false; badge.textContent = ' ' + _mdocProducts.length + '件'; }
}

/* 3段カテゴリの datalist を既存商品から再構築（親の入力で子候補を絞る＝カスケード）。 */
function _mdocDistinct(arr) {
  var seen = {}, out = [];
  arr.forEach(function (v) { v = String(v == null ? '' : v).trim(); if (v && !seen[v]) { seen[v] = 1; out.push(v); } });
  return out;
}
function _mdocFillList(id, values) {
  var dl = document.getElementById(id);
  if (!dl) return;
  dl.innerHTML = values.map(function (v) { return '<option value="' + _mdocEsc(v) + '"></option>'; }).join('');
}
/* 分類（categoryL1）と商品名の候補 datalist を既存商品から再構築。
   分類＝単一・値リスト自由拡張。商品名＝既存を選べば表記ゆれ/重複を防ぎ、別分類で価格違いも足せる。
   L2/L3 はスキーマに温存し当UIでは使わない。 */
function _mdocRebuildLists() {
  _mdocFillList('mdoc-cat-list', _mdocDistinct(_mdocProducts.map(function (p) { return p.categoryL1; })));
  _mdocFillList('mdoc-name-list', _mdocDistinct(_mdocProducts.map(function (p) { return p.productName; })));
}

/* 同一商品名の全バリアント（分類ちがい）を返す。 */
function _mdocProductVariants(name) {
  name = String(name == null ? '' : name).trim();
  if (!name) return [];
  return _mdocProducts.filter(function (p) { return String(p.productName || '').trim() === name; });
}
/* (商品名, 分類) の重複を探す（excludeCode は自分自身を除外）。 */
function _mdocFindByNameCat(name, cat, excludeCode) {
  name = String(name || '').trim();
  cat = String(cat || '').trim();
  return _mdocProducts.filter(function (p) {
    return String(p.productName || '').trim() === name
        && String(p.categoryL1 || '').trim() === cat
        && String(p.productCode) !== String(excludeCode || '');
  })[0] || null;
}
/* 分類の代表税率（同分類の最新＝軽減税率等に連動）。無ければ null。 */
function _mdocTaxForCat(cat) {
  cat = String(cat || '').trim();
  if (!cat) return null;
  var t = null;
  _mdocProducts.forEach(function (p) { if (String(p.categoryL1 || '').trim() === cat) t = Number(p.taxRate) || 0; });
  return t;
}

/* 商品名を確定した時：既存商品名なら共有属性（単位・別名）を空欄のとき引き継ぎ、
   登録済みの分類バリアントをヒント表示（「別分類の価格違いを足す」と運用者に分かるように）。 */
function _mdocNameHint(nameId, unitId, aliasId, hintId) {
  var name = (_mdocVal(nameId) || '').trim();
  var hint = document.getElementById(hintId);
  var variants = _mdocProductVariants(name);
  if (!name || !variants.length) { if (hint) { hint.hidden = true; hint.textContent = ''; } return; }
  var src = variants[variants.length - 1];
  var unitEl = document.getElementById(unitId);
  var aliasEl = document.getElementById(aliasId);
  if (unitEl && !String(unitEl.value || '').trim() && src.unit) unitEl.value = src.unit;
  if (aliasEl && !String(aliasEl.value || '').trim() && src.aliases) aliasEl.value = src.aliases;
  var cats = variants.map(function (p) { return String(p.categoryL1 || '').trim() || '未分類'; });
  if (hint) {
    hint.hidden = false;
    hint.textContent = '「' + name + '」は登録済み（分類: ' + cats.join('・') + '）。別の分類を選べば価格違いで追加できます（単位・別名を引き継ぎました）。';
  }
}

/* 分類確定時に標準単価・税率の確認をうながす（分類は金額・税率に連動しやすい＝軽減税率等）。
   ・単価は「同じ商品名の別分類バリアント」を起点にサジェスト（商品に紐づく＝別商品の価格は使わない）。
   ・税率は「その分類の代表税率」をサジェスト（軽減税率＝店内10/テイクアウト8 等）。
   ・補完は単価が空のとき（新規入力時）のみ・既入力は尊重。ヒントは常に確認をうながす。 */
function _mdocCatPriceConfirm(catId, priceId, taxId, hintId, nameId) {
  var cat = (_mdocVal(catId) || '').trim();
  var hint = document.getElementById(hintId);
  var priceEl = document.getElementById(priceId);
  var taxEl = document.getElementById(taxId);
  if (!cat) { if (hint) { hint.hidden = true; hint.textContent = ''; } return; }
  var name = nameId ? (_mdocVal(nameId) || '').trim() : '';
  var priceEmpty = priceEl && !String(priceEl.value || '').trim();
  var taxSug = _mdocTaxForCat(cat);
  var otherVariants = _mdocProductVariants(name).filter(function (p) { return String(p.categoryL1 || '').trim() !== cat; });
  var priceSug = otherVariants.length ? (Number(otherVariants[otherVariants.length - 1].unitPrice) || 0) : null;
  if (priceEmpty) {
    if (priceSug != null && priceEl) priceEl.value = String(priceSug);
    if (taxSug != null && taxEl) taxEl.value = String(taxSug);
  }
  if (hint) {
    var parts = ['分類「' + cat + '」'];
    if (priceSug != null) parts.push('同じ商品の別分類は¥' + priceSug.toLocaleString('ja-JP'));
    if (taxSug != null) parts.push('この分類の税率は通常' + taxSug + '%');
    parts.push('標準単価と税率をご確認ください。');
    hint.hidden = false;
    hint.textContent = parts.join('　');
  }
  if (priceEmpty && priceSug == null && priceEl) priceEl.focus();
}

function _mdocTaxSelect(id, rate) {
  rate = Number(rate) || 0;
  return '<select id="' + id + '" class="form-select" style="width:120px;flex-shrink:0;" aria-label="税率">' +
    '<option value="10"' + (rate === 10 ? ' selected' : '') + '>10%</option>' +
    '<option value="8"' + (rate === 8 ? ' selected' : '') + '>8%（軽減）</option>' +
    '<option value="0"' + (rate === 0 ? ' selected' : '') + '>0%（非課税）</option>' +
    '</select>';
}
function _mdocCatInput(id, listId, ph, v) {
  return '<input type="text" id="' + id + '" class="settings-input mdoc-cat" list="' + listId + '" value="' +
    _mdocEsc(v) + '" placeholder="' + ph + '" maxlength="20" autocomplete="off">';
}

function _mdocBindProductAdd() {
  var btn = document.getElementById('product-add-btn');
  if (!btn) return;
  var cat = document.getElementById('product-add-cat');
  var nameEl = document.getElementById('product-add-name');
  if (nameEl) nameEl.addEventListener('change', function () {
    _mdocNameHint('product-add-name', 'product-add-unit', 'product-add-aliases', 'product-name-hint');
  });
  if (cat) cat.addEventListener('change', function () {
    _mdocCatPriceConfirm('product-add-cat', 'product-add-price', 'product-add-tax', 'product-price-hint', 'product-add-name');
  });
  btn.addEventListener('click', _mdocDoAddProduct);
}

async function _mdocDoAddProduct() {
  var name = (_mdocVal('product-add-name') || '').trim();
  if (!name) return _mdocToast('商品名を入力してください', 'error');
  var cat = (_mdocVal('product-add-cat') || '').trim();
  // (商品名×分類) の重複ガード：同じ組み合わせは1件（別分類なら追加可＝価格違いバリアント）。
  if (_mdocFindByNameCat(name, cat)) {
    return _mdocToast('「' + name + (cat ? '・' + cat : '') + '」は既に登録済みです', 'error');
  }
  var payload = {
    categoryL1: cat,  // 単一分類（L2/L3 は当UIでは未使用）
    categoryL2: '',
    categoryL3: '',
    productName: name,
    unitPrice: Number(_mdocVal('product-add-price')) || 0,
    taxRate: parseInt(_mdocVal('product-add-tax'), 10) || 0,
    unit: (_mdocVal('product-add-unit') || '').trim(),
    aliases: (_mdocVal('product-add-aliases') || '').trim()
  };
  var btn = document.getElementById('product-add-btn');
  btn.disabled = true;
  try {
    var res = await callGAS('addProduct', payload);
    if (res && res.status === 'ok') {
      _mdocClear(['product-add-cat', 'product-add-name', 'product-add-price', 'product-add-unit', 'product-add-aliases']);
      var tax = document.getElementById('product-add-tax'); if (tax) tax.value = '10';
      var ph = document.getElementById('product-price-hint'); if (ph) { ph.hidden = true; ph.textContent = ''; }
      var nh = document.getElementById('product-name-hint'); if (nh) { nh.hidden = true; nh.textContent = ''; }
      _mdocToast(name + 'を追加しました ✓', 'success');
      await mdocLoadProducts();
    } else {
      _mdocToast((res && res.message) || '追加に失敗しました', 'error');
    }
  } catch (e) {
    _mdocToast('通信エラーで追加できませんでした', 'error');
  } finally {
    btn.disabled = false;
  }
}

function mdocEditProduct(code) {
  var p = _mdocProducts.find(function (x) { return String(x.productCode) === String(code); });
  var row = document.getElementById('product-row-' + code);
  if (!p || !row) return;
  var c = _mdocEsc(code);
  row.innerHTML =
    '<div class="mdoc-cat-row">' +
      _mdocCatInput('pe-cat-' + c, 'mdoc-cat-list', '分類（任意）', p.categoryL1) +
      '<input type="text" id="pe-name-' + c + '" class="settings-input" list="mdoc-name-list" value="' + _mdocEsc(p.productName) + '" maxlength="40" placeholder="商品名（正規名）">' +
    '</div>' +
    '<div class="mdoc-cat-row">' +
      '<input type="number" id="pe-price-' + c + '" class="settings-input" style="max-width:160px;" value="' + (Number(p.unitPrice) || 0) + '" min="0" placeholder="標準単価(税抜)">' +
      _mdocTaxSelect('pe-tax-' + c, p.taxRate) +
      '<input type="text" id="pe-unit-' + c + '" class="settings-input" style="max-width:120px;" value="' + _mdocEsc(p.unit) + '" maxlength="8" placeholder="単位">' +
    '</div>' +
    '<p id="pe-price-hint-' + c + '" class="mdoc-price-hint" hidden></p>' +
    '<div class="mdoc-cat-row"><input type="text" id="pe-aliases-' + c + '" class="settings-input" value="' + _mdocEsc(p.aliases) + '" maxlength="120" placeholder="別名（カンマ区切り・任意）"></div>' +
    '<div class="mdoc-cat-row staff-edit__actions">' +
      '<button class="staff-save-btn" type="button" onclick="mdocSaveProduct(\'' + c + '\')">保存</button>' +
      '<button class="staff-cancel-btn" type="button" onclick="mdocRenderProducts()">キャンセル</button>' +
      '<span class="staff-edit__spacer"></span>' +
      '<button class="staff-delete-btn" type="button" onclick="mdocDeleteProduct(\'' + c + '\')">削除</button>' +
    '</div>';
  var catEl = document.getElementById('pe-cat-' + c);
  if (catEl) catEl.addEventListener('change', function () {
    _mdocCatPriceConfirm('pe-cat-' + c, 'pe-price-' + c, 'pe-tax-' + c, 'pe-price-hint-' + c, 'pe-name-' + c);
  });
}

async function mdocSaveProduct(code) {
  var name = (_mdocVal('pe-name-' + code) || '').trim();
  if (!name) return _mdocToast('商品名を入力してください', 'error');
  var cat = (_mdocVal('pe-cat-' + code) || '').trim();
  if (_mdocFindByNameCat(name, cat, code)) {
    return _mdocToast('「' + name + (cat ? '・' + cat : '') + '」は既に登録済みです', 'error');
  }
  var payload = {
    productCode: String(code),
    categoryL1: cat,  // 単一分類。L2/L3 は送らず既存値を温存
    productName: name,
    unitPrice: Number(_mdocVal('pe-price-' + code)) || 0,
    taxRate: parseInt(_mdocVal('pe-tax-' + code), 10) || 0,
    unit: (_mdocVal('pe-unit-' + code) || '').trim(),
    aliases: (_mdocVal('pe-aliases-' + code) || '').trim()
  };
  try {
    var res = await callGAS('updateProduct', payload);
    if (res && res.status === 'ok') {
      _mdocToast(name + 'を更新しました ✓', 'success');
      await mdocLoadProducts();
    } else {
      _mdocToast((res && res.message) || '更新に失敗しました', 'error');
    }
  } catch (e) {
    _mdocToast('通信エラーで更新できませんでした', 'error');
  }
}

async function mdocDeleteProduct(code) {
  var p = _mdocProducts.find(function (x) { return String(x.productCode) === String(code); });
  if (!p) return;
  if (!confirm('「' + p.productName + '」を削除しますか？\n発行済みの帳票には影響しません。')) return;
  try {
    var res = await callGAS('deleteProduct', { productCode: String(code) });
    if (res && res.status === 'ok') {
      _mdocToast(p.productName + 'を削除しました', 'success');
      await mdocLoadProducts();
    } else {
      _mdocToast((res && res.message) || '削除に失敗しました', 'error');
    }
  } catch (e) {
    _mdocToast('通信エラーで削除できませんでした', 'error');
  }
}

/* ══════════════════════════════════════════════════════════
   顧客マスタ（customers・得意先・ユーザー主権）
   ══════════════════════════════════════════════════════════ */
async function mdocLoadCustomers() {
  var cont = document.getElementById('customers-list-container');
  if (cont && !_mdocCustomers.length) cont.innerHTML = '<div class="mdoc-empty">読み込み中...</div>';
  try {
    var res = await callGAS('getCustomers', {});
    _mdocCustomers = (res && res.status === 'ok' && Array.isArray(res.customers)) ? res.customers : [];
  } catch (e) { _mdocCustomers = []; }
  mdocRenderCustomers();
}

function mdocRenderCustomers() {
  var cont = document.getElementById('customers-list-container');
  if (!cont) return;
  if (!_mdocCustomers.length) {
    cont.innerHTML = '<div class="mdoc-empty">得意先がまだありません。下のフォームから追加してください。</div>';
  } else {
    cont.innerHTML = _mdocCustomers.map(function (cst) {
      var id = _mdocEsc(cst.customerId);
      var bits = [];
      if (cst.senderFax) bits.push('FAX:' + _mdocEsc(cst.senderFax));
      if (cst.tel) bits.push('TEL:' + _mdocEsc(cst.tel));
      if (cst.address) bits.push(_mdocEsc(cst.address));
      if (cst.contactPerson) bits.push('担当:' + _mdocEsc(cst.contactPerson));
      var sub = bits.join('　') || '（連絡先未登録）';
      return '' +
        '<div class="mdoc-row" id="customer-row-' + id + '">' +
          '<div class="mdoc-row__top">' +
            '<span class="mdoc-row__name">' + _mdocEsc(cst.name) + '</span>' +
            '<button class="staff-edit-btn" type="button" onclick="mdocEditCustomer(\'' + id + '\')" aria-label="編集">編集</button>' +
            '<button class="staff-delete-btn" type="button" onclick="mdocDeleteCustomer(\'' + id + '\')" aria-label="削除">削除</button>' +
          '</div>' +
          '<div class="mdoc-sub">' + sub + '</div>' +
        '</div>';
    }).join('');
  }
  var badge = document.getElementById('customers-count-badge');
  if (badge) { badge.hidden = false; badge.textContent = ' ' + _mdocCustomers.length + '件'; }
}

function _mdocBindCustomerAdd() {
  var btn = document.getElementById('customer-add-btn');
  if (!btn) return;
  btn.addEventListener('click', _mdocDoAddCustomer);
}

async function _mdocDoAddCustomer() {
  var name = (_mdocVal('customer-add-name') || '').trim();
  if (!name) return _mdocToast('顧客名を入力してください', 'error');
  var payload = {
    name: name,
    senderFax: (_mdocVal('customer-add-fax') || '').trim(),
    tel: (_mdocVal('customer-add-tel') || '').trim(),
    postalCode: (_mdocVal('customer-add-postal') || '').trim(),
    address: (_mdocVal('customer-add-address') || '').trim(),
    email: (_mdocVal('customer-add-email') || '').trim(),
    contactPerson: (_mdocVal('customer-add-contact') || '').trim(),
    memo: (_mdocVal('customer-add-memo') || '').trim()
  };
  var btn = document.getElementById('customer-add-btn');
  btn.disabled = true;
  try {
    var res = await callGAS('addCustomer', payload);
    if (res && res.status === 'ok') {
      _mdocClear(['customer-add-name', 'customer-add-fax', 'customer-add-tel', 'customer-add-postal', 'customer-add-address', 'customer-add-email', 'customer-add-contact', 'customer-add-memo']);
      _mdocToast(name + 'を追加しました ✓', 'success');
      await mdocLoadCustomers();
    } else {
      _mdocToast((res && res.message) || '追加に失敗しました', 'error');
    }
  } catch (e) {
    _mdocToast('通信エラーで追加できませんでした', 'error');
  } finally {
    btn.disabled = false;
  }
}

function mdocEditCustomer(id) {
  var cst = _mdocCustomers.find(function (x) { return String(x.customerId) === String(id); });
  var row = document.getElementById('customer-row-' + id);
  if (!cst || !row) return;
  var i = _mdocEsc(id);
  function inp(field, ph, v, max, w) {
    return '<input type="text" id="ce-' + field + '-' + i + '" class="settings-input"' + (w ? ' style="max-width:' + w + ';"' : '') +
      ' value="' + _mdocEsc(v) + '" maxlength="' + max + '" placeholder="' + ph + '">';
  }
  row.innerHTML =
    '<div class="mdoc-cat-row">' + inp('name', '顧客名（正式宛名）', cst.name, 40) + '</div>' +
    '<div class="mdoc-cat-row">' + inp('fax', '先方FAX番号（受注照合・複数可）', cst.senderFax, 60) + inp('tel', '電話番号', cst.tel, 20) + '</div>' +
    '<div class="mdoc-cat-row">' + inp('postal', '郵便番号', cst.postalCode, 8, '140px') + inp('address', '住所（帳票宛名）', cst.address, 80) + '</div>' +
    '<div class="mdoc-cat-row">' + inp('email', 'メール（任意）', cst.email, 60) + inp('contact', '担当者（任意）', cst.contactPerson, 20) + '</div>' +
    '<div class="mdoc-cat-row">' + inp('memo', 'メモ（任意）', cst.memo, 60) + '</div>' +
    '<div class="mdoc-cat-row staff-edit__actions">' +
      '<button class="staff-save-btn" type="button" onclick="mdocSaveCustomer(\'' + i + '\')">保存</button>' +
      '<button class="staff-cancel-btn" type="button" onclick="mdocRenderCustomers()">キャンセル</button>' +
      '<span class="staff-edit__spacer"></span>' +
      '<button class="staff-delete-btn" type="button" onclick="mdocDeleteCustomer(\'' + i + '\')">削除</button>' +
    '</div>';
}

async function mdocSaveCustomer(id) {
  var name = (_mdocVal('ce-name-' + id) || '').trim();
  if (!name) return _mdocToast('顧客名を入力してください', 'error');
  var payload = {
    customerId: String(id),
    name: name,
    senderFax: (_mdocVal('ce-fax-' + id) || '').trim(),
    tel: (_mdocVal('ce-tel-' + id) || '').trim(),
    postalCode: (_mdocVal('ce-postal-' + id) || '').trim(),
    address: (_mdocVal('ce-address-' + id) || '').trim(),
    email: (_mdocVal('ce-email-' + id) || '').trim(),
    contactPerson: (_mdocVal('ce-contact-' + id) || '').trim(),
    memo: (_mdocVal('ce-memo-' + id) || '').trim()
  };
  try {
    var res = await callGAS('updateCustomer', payload);
    if (res && res.status === 'ok') {
      _mdocToast(name + 'を更新しました ✓', 'success');
      await mdocLoadCustomers();
    } else {
      _mdocToast((res && res.message) || '更新に失敗しました', 'error');
    }
  } catch (e) {
    _mdocToast('通信エラーで更新できませんでした', 'error');
  }
}

async function mdocDeleteCustomer(id) {
  var cst = _mdocCustomers.find(function (x) { return String(x.customerId) === String(id); });
  if (!cst) return;
  if (!confirm('「' + cst.name + '」を削除しますか？\n発行済みの帳票には影響しません。')) return;
  try {
    var res = await callGAS('deleteCustomer', { customerId: String(id) });
    if (res && res.status === 'ok') {
      _mdocToast(cst.name + 'を削除しました', 'success');
      await mdocLoadCustomers();
    } else {
      _mdocToast((res && res.message) || '削除に失敗しました', 'error');
    }
  } catch (e) {
    _mdocToast('通信エラーで削除できませんでした', 'error');
  }
}
