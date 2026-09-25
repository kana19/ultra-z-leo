/**
 * masters-doc.js — 書類発行／FAX受注の土台マスタ（顧客）管理UI
 *
 * 設計（→ 05_将来構想.md §8-5・03_データ仕様.md §1-6）：
 *  - 顧客マスタ(customers) は、見積/請求の宛名と FAX受注OCRの発注元照合が共に依存する「土台」。
 *    doc_automation ON の店だけ設定画面に出す。
 *  - 書類発行のための商品マスタ(products)は設けない（2026-09-25 金光決定）。請求書は売上登録と連携して発行する。
 *  - セクションの表示/非表示は app.js uzApplyFeatureGates（[data-feature="doc_automation"]）が担当。
 *    本ファイルは ON のとき GAS から取得して描画し、CRUD を配線する。
 *  - 顧客マスタはユーザー主権（日々追加・運営ポータルは触らない）。突合キーは不変ID
 *    （customerId=cs001…）。表示名が変わってもIDで名寄せ・帳票が繋がる。
 *
 * settings.js と同じくグローバル関数イディオム（onclickから参照）。共有グローバル空間のため
 * すべて mdoc / _mdoc 接頭辞で命名し衝突を避ける。GAS/表示ヘルパは app.js を用いる。
 */
'use strict';

var _mdocCustomers = [];

function _mdocEsc(s) {
  return (typeof uzEscHtml === 'function') ? uzEscHtml(s == null ? '' : String(s)) : String(s == null ? '' : s);
}
function _mdocToast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'info'); }
function _mdocVal(id) { var el = document.getElementById(id); return el ? el.value : ''; }
function _mdocClear(ids) { ids.forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ''; }); }

document.addEventListener('DOMContentLoaded', function () {
  // 顧客マスタは doc_automation ON の店のみ。OFFなら何もしない（セクションもゲートで非表示）。
  if (typeof uzDocAutomationEnabled !== 'function') return;
  uzDocAutomationEnabled().then(function (on) {
    if (!on) return;
    _mdocBindCustomerAdd();
    mdocLoadCustomers();
  }).catch(function () { /* 判定不能時は何もしない（安全側＝非表示のまま） */ });
});

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
