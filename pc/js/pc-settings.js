/* pc-settings.js — PC版 設定（店舗情報・サービスマスタ・仕入マスタ・販管費マスタ・スタッフマスタ）
 *
 * 6-G フェーズ2（v0.5.6 連動）：
 *   - getSettings 応答から masterQuota / purchaseMasterList を取得
 *   - サービスマスタ・仕入マスタに「＋追加」「削除」ボタン
 *   - 枠超過時は追加抑止（モーダル＋ヒント表示）
 *   - サーバ側 addServiceItem / deleteServiceItem / addPurchaseItem / deletePurchaseItem を使用
 *   - 販管費マスタ（コード8〜31）は既存のインライン編集＋一括保存方式を維持
 */
'use strict';

let settings = null;
let costMaster = [];
let purchaseList = [];
let masterQuota = { serviceMasterQuota: 5, serviceChannelQuota: 5, purchaseMasterQuota: 3, purchaseCategoryQuota: 3, costOptionalQuota: 5 };
let qrLocations = [];          // 段2・拠点リスト（settings B6）
let qrProofEnabled = false;    // 段2・QR現地証明の有効可否（featureVisibility）
// 2026-08-27：新マスタ（大分類・仕入先）用の PC 側 state
let serviceChannelList = [];
let purchaseCategoryList = [];
let suppliersList = [];

document.addEventListener('DOMContentLoaded', async () => {
  pcBootstrap('pc-settings.html', '設定');
  await loadAll();
  document.getElementById('btn-save-cm').addEventListener('click', saveCM);
  document.getElementById('svc-add-btn').addEventListener('click', addService);
  document.getElementById('pur-add-btn').addEventListener('click', addPurchase);
  const svcNameInput = document.getElementById('svc-add-name');
  if (svcNameInput) svcNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') addService(); });
  const purNameInput = document.getElementById('pur-add-name');
  if (purNameInput) purNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') addPurchase(); });
  const qrlocBtn = document.getElementById('qrloc-add-btn');
  if (qrlocBtn) qrlocBtn.addEventListener('click', addQrLocation);
  const qrlocInput = document.getElementById('qrloc-add-name');
  if (qrlocInput) qrlocInput.addEventListener('keydown', e => { if (e.key === 'Enter') addQrLocation(); });
  bindStaffAdd();
  // 2026-08-27：新マスタ管理UI のイベントバインド
  bindPcServiceChannelAdd();
  bindPcPurchaseCategoryAdd();
  bindPcSupplierAdd();
  bindPcCustomersCsvIO();
});

async function loadAll() {
  const [settingsData, cmRes] = await Promise.all([
    uzGetSettings(),                                  // ②共通化：取得+{status,data}展開を集約
    callGAS('getCostMaster', {}).catch(() => null),
  ]);
  settings = settingsData || {};
  // 6-G フェーズ2：マスタ件数枠を取得（未投入の既存ユーザーは上限制御を無効化）
  if (settings.masterQuota && typeof settings.masterQuota === 'object') {
    masterQuota = {
      serviceMasterQuota: Number(settings.masterQuota.serviceMasterQuota) || 5,
      serviceChannelQuota: Number(settings.masterQuota.serviceChannelQuota) || 5,
      purchaseMasterQuota: Number(settings.masterQuota.purchaseMasterQuota) || 3,
      purchaseCategoryQuota: Number(settings.masterQuota.purchaseCategoryQuota) || 3,
      costOptionalQuota: Number(settings.masterQuota.costOptionalQuota) || 5
    };
  } else if (settings.masterQuota === null) {
    // B17未投入の既存ユーザー → 上限制御を無効化（03_データ仕様.md §1-4-2）
    masterQuota = { serviceMasterQuota: null, serviceChannelQuota: null, purchaseMasterQuota: null, purchaseCategoryQuota: null, costOptionalQuota: null };
  }
  // 2026-08-27：大分類マスタを取得（getSettings 応答から・空配列で無害運転）
  serviceChannelList = Array.isArray(settings.serviceChannelList) ? settings.serviceChannelList : [];
  purchaseCategoryList = Array.isArray(settings.purchaseCategoryList) ? settings.purchaseCategoryList : [];
  // 6-G フェーズ2：仕入マスタを取得（getSettings 応答から優先・なければ空）
  if (Array.isArray(settings.purchaseMasterList)) {
    purchaseList = settings.purchaseMasterList;
  } else {
    purchaseList = [];
  }
  // 段2：拠点リスト（B6）と qrProofEnabled を取得（拠点管理カードの表示判定に使用）
  qrLocations = Array.isArray(settings.qrLocations) ? settings.qrLocations : [];
  qrProofEnabled = !!(settings.featureVisibility && settings.featureVisibility.qrProofEnabled);
  // 販管費マスタは既存通り getCostMaster 経由（getSettings の costMasterList より優先）
  // GAS生データは type/divisionCode が欠落しうるため normalizeCostMasterList で正規化する（→ app.js）
  let cmRaw;
  if (cmRes && cmRes.status === 'ok' && Array.isArray(cmRes.data) && cmRes.data.length > 0) {
    cmRaw = cmRes.data;
  } else if (Array.isArray(settings.costMasterList) && settings.costMasterList.length > 0) {
    cmRaw = settings.costMasterList;
  } else {
    cmRaw = getCostMaster();
  }
  costMaster = (typeof normalizeCostMasterList === 'function')
    ? normalizeCostMasterList(cmRaw)
    : cmRaw;
  saveCostMasterToStorage(costMaster);
  renderServices();
  renderPurchases();
  renderPcServiceChannels();
  renderPcPurchaseCategories();
  renderQrLocations();
  renderCM();
  renderStaff();
  renderBasicInfo();
  // 2026-08-27：仕入先マスタは別アクションで並列取得（getSettings 応答に含まれない）
  loadPcSuppliers();
}

/* ── 基本情報セクション（読み取り専用・スマホ版と表記統一） ── */
function renderBasicInfo() {
  // 店舗名
  const storeEl = document.getElementById('info-store-name');
  if (storeEl) {
    const name = settings?.storeName || localStorage.getItem('uz_store_name') || '';
    storeEl.textContent = name || '—';
  }

  // 営業時間（businessHours があれば「19:00 〜 翌03:00」形式・無ければ行ごと非表示）
  const row = document.getElementById('info-business-hours-row');
  const val = document.getElementById('info-business-hours');
  if (row && val) {
    let formatted = null;
    try {
      const bh = settings?.businessHours;
      if (bh && bh.open && bh.close && typeof formatBusinessHours === 'function') {
        formatted = formatBusinessHours(bh);
      } else if (typeof getBusinessHours === 'function' && typeof formatBusinessHours === 'function') {
        formatted = formatBusinessHours(getBusinessHours());
      }
    } catch { formatted = null; }
    // 営業時間の役割（打刻忘れ判定の基準）を機能説明として併記。営業時間表示時のみ。
    const hint = document.getElementById('info-business-hours-hint');
    if (formatted) {
      val.textContent = formatted;
      row.hidden = false;
      if (hint) hint.hidden = false;
    } else {
      row.hidden = true;
      if (hint) hint.hidden = true;
    }
  }

  bindVersionTapDebug();
}

/* ── バージョン5タップで GAS接続情報を展開（隠しコマンド・スマホ版と統一） ── */
function bindVersionTapDebug() {
  const ver = document.getElementById('info-version');
  const dbg = document.getElementById('info-debug');
  if (!ver || !dbg || ver.dataset.tapBound === '1') return;
  ver.dataset.tapBound = '1';

  let count = 0;
  let timer = null;
  ver.addEventListener('click', () => {
    count++;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { count = 0; }, 1200);
    if (count >= 5) {
      count = 0;
      dbg.hidden = !dbg.hidden;
      if (!dbg.hidden) {
        const statusEl = document.getElementById('gas-status-val');
        if (statusEl) {
          statusEl.textContent = '接続済み ✓';
          statusEl.style.color = 'var(--uz-green)';
        }
        const urlEl = document.getElementById('gas-url-val');
        try {
          if (urlEl && typeof GAS_URL === 'string') urlEl.textContent = GAS_URL;
        } catch { /* ignore */ }
      }
    }
  });
}

/* ── サービスマスタ ─────────────────────────────────────── */
function getServiceListFromState() {
  let svcs = settings?.serviceList ?? settings?.services ?? [];
  if (typeof svcs === 'string') { try { svcs = JSON.parse(svcs); } catch { svcs = []; } }
  if (!Array.isArray(svcs)) svcs = [];
  return svcs;
}

/* 2026-08-29：分類選択肢を「サービス販売チャネル大分類」から <option> で生成（後方互換：既存 category からも収集）。 */
function _svcCatOptions_(selected) {
  const names = new Set();
  (serviceChannelList || []).forEach(c => { if (c && c.name) names.add(String(c.name).trim()); });
  getServiceListFromState().forEach(s => { if (s && s.category) names.add(String(s.category).trim()); });
  const sel = String(selected || '').trim();
  if (sel) names.add(sel);
  return `<option value="">（分類なし）</option>` +
    [...names].filter(Boolean).map(n =>
      `<option value="${escHtml(n)}"${n === sel ? ' selected' : ''}>${escHtml(n)}</option>`
    ).join('');
}

function _refreshSvcAddCatOptions_() {
  const sel = document.getElementById('svc-add-cat');
  if (sel) sel.innerHTML = _svcCatOptions_('');
}

function renderServices() {
  const svcs = getServiceListFromState();
  const body = document.getElementById('svc-body');
  const quota = masterQuota.serviceMasterQuota;

  if (svcs.length === 0) {
    body.innerHTML = `<tr><td colspan="5" class="text-muted" style="text-align:center;padding:20px;">登録なし</td></tr>`;
  } else {
    body.innerHTML = svcs.map(s => {
      const idKey = escHtml(String(s.id || s.code || ''));
      return `<tr id="svc-row-${idKey}">
        <td>${idKey}</td>
        <td>${escHtml(s.name||'')}</td>
        <td>
          <select class="pc-select" style="width:100%;" onchange="updateServiceCategory('${idKey}', this.value)" title="分類を変更するとホーム損益の集計に反映">
            ${_svcCatOptions_(s.category || '')}
          </select>
        </td>
        <td>${Number(s.taxRate)||0}%</td>
        <td><button class="pc-btn pc-btn--ghost" type="button" onclick="deleteService('${idKey}')">削除</button></td>
      </tr>`;
    }).join('');
  }
  _refreshSvcAddCatOptions_();

  const badge = document.getElementById('svc-count-badge');
  const quotaUnlimited = (quota == null || !isFinite(quota));
  if (badge) {
    badge.hidden = false;
    badge.textContent = quotaUnlimited ? ` ${svcs.length}件` : ` ${svcs.length}/${quota}`;
  }
  const addRow = document.getElementById('svc-add-row');
  const hint = document.getElementById('svc-limit-hint');
  const atMax = !quotaUnlimited && svcs.length >= quota;
  if (addRow) addRow.style.display = atMax ? 'none' : '';
  if (hint) {
    hint.hidden = !atMax;
    if (atMax) hint.textContent = `件数枠の上限（${quota}件）に達しています。追加するにはターゲット社にご相談ください。`;
  }
}

async function addService() {
  const nameEl = document.getElementById('svc-add-name');
  const taxEl  = document.getElementById('svc-add-tax');
  const catEl  = document.getElementById('svc-add-cat');
  const btn    = document.getElementById('svc-add-btn');
  const name = nameEl.value.trim();
  const taxRate = parseInt(taxEl.value);
  const category = catEl ? String(catEl.value || '').trim() : '';
  if (!name) return showToast('サービス名を入力してください', 'error');
  if (name.length > 30) return showToast('サービス名は30文字以内で入力してください', 'error');

  const list = getServiceListFromState();
  if (masterQuota.serviceMasterQuota != null && isFinite(masterQuota.serviceMasterQuota)
      && list.length >= masterQuota.serviceMasterQuota) {
    return showToast(`件数枠の上限（${masterQuota.serviceMasterQuota}件）に達しています`, 'error');
  }
  if (list.some(s => s.name === name)) {
    return showToast('同じ名前のサービスが既に登録されています', 'error');
  }

  btn.disabled = true;
  try {
    const res = await callGAS('addServiceItem', { name, taxRate, category });
    if (res && res.status === 'ok' && Array.isArray(res.serviceList)) {
      settings.serviceList = res.serviceList;
      nameEl.value = '';
      taxEl.value = '10';
      if (catEl) catEl.value = '';
      renderServices();
      showToast(`${name}を追加しました`, 'success');
    } else if (res && res.code === 'quota_exceeded') {
      showToast(res.message || '件数枠の上限に達しています', 'error');
      if (typeof res.quota === 'number') {
        masterQuota.serviceMasterQuota = res.quota;
      }
      renderServices();
    } else {
      showToast((res && res.message) || '追加に失敗しました', 'error');
    }
  } catch (e) {
    showToast('通信エラー：' + (e.message || 'unknown'), 'error');
  } finally {
    btn.disabled = false;
  }
}

/* 2026-08-29：分類の変更は inline dropdown で即保存（updateServiceItem＝サーバ真実源）。 */
async function updateServiceCategory(id, category) {
  const list = getServiceListFromState();
  const target = list.find(s => String(s.id || s.code) === String(id));
  if (!target) return;
  try {
    const res = await callGAS('updateServiceItem', {
      id: String(id),
      name: target.name,
      taxRate: Number(target.taxRate) || 10,
      category: String(category || '').trim()
    });
    if (res && res.status === 'ok' && Array.isArray(res.serviceList)) {
      settings.serviceList = res.serviceList;
      renderServices();
      showToast(category ? `分類を「${category}」に設定` : '分類を解除', 'success');
    } else {
      showToast((res && res.message) || '更新に失敗しました', 'error');
    }
  } catch (e) {
    showToast('通信エラー：' + (e.message || 'unknown'), 'error');
  }
}

async function deleteService(id) {
  const list = getServiceListFromState();
  const target = list.find(s => String(s.id || s.code) === String(id));
  if (!target) return;
  if (list.length <= 1) return showToast('最低1種のサービスが必要です', 'error');
  if (!confirm(`「${target.name}」を削除しますか？\n登録済みの売上データには影響しません。`)) return;
  try {
    const res = await callGAS('deleteServiceItem', { id: String(target.id || target.code) });
    if (res && res.status === 'ok' && Array.isArray(res.serviceList)) {
      settings.serviceList = res.serviceList;
      renderServices();
      showToast(`${target.name}を削除しました`, 'success');
    } else {
      showToast((res && res.message) || '削除に失敗しました', 'error');
    }
  } catch (e) {
    showToast('通信エラー：' + (e.message || 'unknown'), 'error');
  }
}

/* ── 仕入原価マスタ（6-G フェーズ2 新設）─────────────── */
/* 2026-08-29：分類選択肢を「仕入原価大分類」から <option> で生成（後方互換：既存 category からも収集）。 */
function _purCatOptions_(selected) {
  const names = new Set();
  (purchaseCategoryList || []).forEach(c => { if (c && c.name) names.add(String(c.name).trim()); });
  (purchaseList || []).forEach(p => { if (p && p.category) names.add(String(p.category).trim()); });
  const sel = String(selected || '').trim();
  if (sel) names.add(sel);
  return `<option value="">（分類なし）</option>` +
    [...names].filter(Boolean).map(n =>
      `<option value="${escHtml(n)}"${n === sel ? ' selected' : ''}>${escHtml(n)}</option>`
    ).join('');
}

function _refreshPurAddCatOptions_() {
  const sel = document.getElementById('pur-add-cat');
  if (sel) sel.innerHTML = _purCatOptions_('');
}

function renderPurchases() {
  const body = document.getElementById('pur-body');
  const quota = masterQuota.purchaseMasterQuota;

  if (!Array.isArray(purchaseList) || purchaseList.length === 0) {
    body.innerHTML = `<tr><td colspan="5" class="text-muted" style="text-align:center;padding:20px;">登録なし</td></tr>`;
  } else {
    body.innerHTML = purchaseList.map(p => {
      const idKey = escHtml(String(p.id || ''));
      const rate = (p.defaultTaxRate !== undefined) ? p.defaultTaxRate : (p.taxRate !== undefined ? p.taxRate : 10);
      return `<tr id="pur-row-${idKey}">
        <td>${idKey}</td>
        <td>${escHtml(p.name||'')}</td>
        <td>
          <select class="pc-select" style="width:100%;" onchange="updatePurchaseCategory('${idKey}', this.value)" title="分類を変更するとホーム損益の集計に反映">
            ${_purCatOptions_(p.category || '')}
          </select>
        </td>
        <td>${Number(rate)||0}%</td>
        <td><button class="pc-btn pc-btn--ghost" type="button" onclick="deletePurchase('${idKey}')">削除</button></td>
      </tr>`;
    }).join('');
  }
  _refreshPurAddCatOptions_();

  const badge = document.getElementById('pur-count-badge');
  const quotaUnlimited = (quota == null || !isFinite(quota));
  if (badge) {
    badge.hidden = false;
    badge.textContent = quotaUnlimited ? ` ${purchaseList.length}件` : ` ${purchaseList.length}/${quota}`;
  }
  const addRow = document.getElementById('pur-add-row');
  const hint = document.getElementById('pur-limit-hint');
  const atMax = !quotaUnlimited && purchaseList.length >= quota;
  if (addRow) addRow.style.display = atMax ? 'none' : '';
  if (hint) {
    hint.hidden = !atMax;
    if (atMax) hint.textContent = `件数枠の上限（${quota}件）に達しています。追加するにはターゲット社にご相談ください。`;
  }
}

async function addPurchase() {
  const nameEl = document.getElementById('pur-add-name');
  const taxEl  = document.getElementById('pur-add-tax');
  const catEl  = document.getElementById('pur-add-cat');
  const btn    = document.getElementById('pur-add-btn');
  const name = nameEl.value.trim();
  const taxRate = parseInt(taxEl.value);
  const category = catEl ? String(catEl.value || '').trim() : '';
  if (!name) return showToast('科目名を入力してください', 'error');
  if (name.length > 30) return showToast('科目名は30文字以内で入力してください', 'error');

  if (masterQuota.purchaseMasterQuota != null && isFinite(masterQuota.purchaseMasterQuota)
      && purchaseList.length >= masterQuota.purchaseMasterQuota) {
    return showToast(`件数枠の上限（${masterQuota.purchaseMasterQuota}件）に達しています`, 'error');
  }
  if (purchaseList.some(p => p.name === name)) {
    return showToast('同じ名前の科目が既に登録されています', 'error');
  }

  btn.disabled = true;
  try {
    const res = await callGAS('addPurchaseItem', { name, defaultTaxRate: taxRate, category });
    if (res && res.status === 'ok' && Array.isArray(res.purchaseMasterList)) {
      purchaseList = res.purchaseMasterList;
      nameEl.value = '';
      taxEl.value = '10';
      if (catEl) catEl.value = '';
      renderPurchases();
      showToast(`${name}を追加しました`, 'success');
    } else if (res && res.code === 'quota_exceeded') {
      showToast(res.message || '件数枠の上限に達しています', 'error');
      if (typeof res.quota === 'number') {
        masterQuota.purchaseMasterQuota = res.quota;
      }
      renderPurchases();
    } else {
      showToast((res && res.message) || '追加に失敗しました', 'error');
    }
  } catch (e) {
    showToast('通信エラー：' + (e.message || 'unknown'), 'error');
  } finally {
    btn.disabled = false;
  }
}

/* 2026-08-29：分類の変更は inline dropdown で即保存（updatePurchaseItem＝サーバ真実源）。 */
async function updatePurchaseCategory(id, category) {
  const target = (purchaseList || []).find(p => String(p.id) === String(id));
  if (!target) return;
  const rate = (target.defaultTaxRate !== undefined) ? target.defaultTaxRate : (target.taxRate !== undefined ? target.taxRate : 10);
  try {
    const res = await callGAS('updatePurchaseItem', {
      id: String(id),
      name: target.name,
      defaultTaxRate: Number(rate) || 10,
      category: String(category || '').trim()
    });
    if (res && res.status === 'ok' && Array.isArray(res.purchaseMasterList)) {
      purchaseList = res.purchaseMasterList;
      renderPurchases();
      showToast(category ? `分類を「${category}」に設定` : '分類を解除', 'success');
    } else {
      showToast((res && res.message) || '更新に失敗しました', 'error');
    }
  } catch (e) {
    showToast('通信エラー：' + (e.message || 'unknown'), 'error');
  }
}

async function deletePurchase(id) {
  const target = purchaseList.find(p => String(p.id) === String(id));
  if (!target) return;
  if (!confirm(`「${target.name}」を削除しますか？\n登録済みのコストデータには影響しません。`)) return;
  try {
    const res = await callGAS('deletePurchaseItem', { id: String(target.id) });
    if (res && res.status === 'ok' && Array.isArray(res.purchaseMasterList)) {
      purchaseList = res.purchaseMasterList;
      renderPurchases();
      showToast(`${target.name}を削除しました`, 'success');
    } else {
      showToast((res && res.message) || '削除に失敗しました', 'error');
    }
  } catch (e) {
    showToast('通信エラー：' + (e.message || 'unknown'), 'error');
  }
}

/* ── 拠点管理（段2・QR現地証明・→ 04_運営ポータル.md §10）─────
 * 拠点リスト（settings B6）の追加(-02,-03…)・削除。保存は saveQrLocations（全件置換）。
 * カードは qrProofEnabled 時のみ表示。QR画像は api.qrserver.com で生成。 */
function _pcQrStaffUrl(code) {
  // pc/pc-settings.html から見た親ディレクトリ（{clientId}/）の staff-clockin.html
  const cid = (typeof detectClientId === 'function' && detectClientId()) || '';
  const dir = (location.pathname || '/').replace(/[^\/]*$/, '').replace(/pc\/$/, '');
  const token = (cid ? cid : '') + '-' + code;
  return location.origin + dir + 'staff-clockin.html?qr=' + encodeURIComponent(token);
}

function _pcQrImgSrc(code) {
  return 'https://api.qrserver.com/v1/create-qr-code/?size=160x160&data='
       + encodeURIComponent(_pcQrStaffUrl(code));
}

function _pcNextQrCode(list) {
  let max = 0;
  (list || []).forEach(l => {
    const n = parseInt(l && l.code, 10);
    if (isFinite(n) && n > max) max = n;
  });
  return ('0' + (max + 1)).slice(-2);
}

function renderQrLocations() {
  const card = document.getElementById('qrloc-card');
  if (card) card.hidden = !qrProofEnabled;
  const body = document.getElementById('qrloc-body');
  if (!body) return;
  const cid = (typeof detectClientId === 'function' && detectClientId()) || '';
  if (!Array.isArray(qrLocations) || qrLocations.length === 0) {
    body.innerHTML = `<tr><td colspan="4" class="text-muted" style="text-align:center;padding:20px;">登録なし</td></tr>`;
    return;
  }
  body.innerHTML = qrLocations.map(l => {
    const code   = escHtml(String(l.code || ''));
    const token  = (cid ? escHtml(cid) : '') + '-' + code;
    const isBase = String(l.code) === '01';
    const delBtn = isBase
      ? '<span class="text-muted" style="font-size:12px;">既定</span>'
      : `<button class="pc-btn pc-btn--ghost" type="button" onclick="deleteQrLocation('${code}')">削除</button>`;
    return `<tr>
      <td><img src="${_pcQrImgSrc(l.code)}" alt="${escHtml(l.label)}のQR" width="56" height="56" loading="lazy" style="border:1px solid var(--uz-border);border-radius:6px;background:#fff;"></td>
      <td>${escHtml(l.label || '')}</td>
      <td style="font-family:var(--font-mono,monospace);font-size:12px;">${token}</td>
      <td>${delBtn}</td>
    </tr>`;
  }).join('');
}

async function _pcPersistQrLocations(list, okMsg) {
  try {
    const res = await callGAS('saveQrLocations', { qrLocations: list });
    if (res && res.status === 'ok' && Array.isArray(res.qrLocations)) {
      qrLocations = res.qrLocations;
      renderQrLocations();
      if (okMsg) showToast(okMsg, 'success');
      return true;
    }
    showToast((res && res.message) || '保存に失敗しました', 'error');
  } catch (e) {
    showToast('通信エラー：' + (e.message || 'unknown'), 'error');
  }
  return false;
}

async function addQrLocation() {
  const input = document.getElementById('qrloc-add-name');
  const btn   = document.getElementById('qrloc-add-btn');
  if (!input) return;
  const label = input.value.trim();
  if (!label) return showToast('拠点名を入力してください', 'error');
  if (label.length > 20) return showToast('拠点名は20文字以内で入力してください', 'error');
  if (qrLocations.some(l => l.label === label)) {
    return showToast('同じ名前の拠点が既に登録されています', 'error');
  }
  const code = _pcNextQrCode(qrLocations);
  if (btn) btn.disabled = true;
  const ok = await _pcPersistQrLocations(qrLocations.concat([{ code, label }]), `${label}（-${code}）を追加しました`);
  if (ok) input.value = '';
  if (btn) btn.disabled = false;
}

async function deleteQrLocation(code) {
  if (String(code) === '01') return showToast('既定拠点（-01）は削除できません', 'error');
  const loc = qrLocations.find(l => String(l.code) === String(code));
  if (!loc) return;
  if (!confirm(`「${loc.label}」を削除しますか？\nこの拠点のQRは無効になります（過去の打刻記録には影響しません）。`)) return;
  await _pcPersistQrLocations(qrLocations.filter(l => String(l.code) !== String(code)), `${loc.label}を削除しました`);
}

/* ── 販管費マスタ（既存維持・販管費専用に役割明確化）─────── */
function renderCM() {
  const body = document.getElementById('cm-body');
  // 仕入原価行（divisionCode='1'）を除外して販管費のみ表示
  // 既存データの divisionCode が未設定の場合は販管費扱い（後方互換）
  const filtered = costMaster.filter(row => {
    return !row.divisionCode || row.divisionCode === '2';
  });
  body.innerHTML = filtered.map((row) => {
    const i = costMaster.indexOf(row);
    const fixed = row.type === 'fixed';
    const taxOpts = [0,8,10].map(v => `<option value="${v}" ${Number(row.taxRate)===v?'selected':''}>${v}%</option>`).join('');
    const nameCell = fixed
      ? `<input type="text" class="pc-input cm-name" value="${escHtml(row.name||'')}" data-i="${i}" disabled style="width:100%;opacity:0.6;">`
      : `<input type="text" class="pc-input cm-name" value="${escHtml(row.name||'')}" data-i="${i}" placeholder="任意科目名" style="width:100%;">`;
    const visChecked = (row.smartphoneVisible === false) ? '' : ' checked';
    return `<tr>
      <td>${escHtml(row.code||'')}</td>
      <td>${nameCell}</td>
      <td><select class="pc-select cm-tax" data-i="${i}">${taxOpts}</select></td>
      <td style="text-align:center;"><input type="checkbox" class="cm-vis" data-i="${i}" style="width:18px;height:18px;accent-color:var(--uz-gold,#b8860b);cursor:pointer;"${visChecked}></td>
      <td>${fixed ? '固定' : '任意'}</td>
    </tr>`;
  }).join('');
}

async function saveCM() {
  document.querySelectorAll('.cm-name').forEach(inp => {
    const i = Number(inp.dataset.i);
    if (costMaster[i] && costMaster[i].type !== 'fixed') costMaster[i].name = inp.value.trim();
  });
  document.querySelectorAll('.cm-tax').forEach(sel => {
    const i = Number(sel.dataset.i);
    if (costMaster[i]) costMaster[i].taxRate = Number(sel.value);
  });
  document.querySelectorAll('.cm-vis').forEach(chk => {
    const i = Number(chk.dataset.i);
    if (costMaster[i]) costMaster[i].smartphoneVisible = chk.checked;
  });
  saveCostMasterToStorage(costMaster);
  // costMasterList は販管費専用（→ 03_データ仕様.md §1-2）。仕入原価を正本に書き戻さない。
  const sanitized = costMaster.filter(row => !row.divisionCode || row.divisionCode === '2');
  const res = await callGAS('saveCostMaster', { costMasterList: sanitized }).catch(() => null);
  if (res && res.status === 'ok') {
    showToast('販管費マスタを保存しました', 'success');
  } else {
    showToast('保存失敗（ローカルには保存）', 'error');
  }
}


/* ══════════════════════════════════════════════════════════════
   スタッフマスタ（追加・編集・削除・パスワード対応）
   - スタッフマスタ登録者＝月次給与計算対象（出勤管理→確定で計上）
   - コスト科目は会計上の計上先：委託・外注のみ 21/25、雇用系は20固定
     （給与計算正本 pc-attendance.js _getStaffCostCode と一致）
   - 給与単価（hourlyWage/dailyWage/monthlyWage）・源泉区分（withholdingMode）
     ・経営メモ（managerMemo）はPC版出勤管理で設定する領域。
     ここでの編集・追加時はスプレッドで既存値を必ず保持し、消さない。
   ══════════════════════════════════════════════════════════════ */
const STAFF_PW_PATTERN = /^[A-Za-z0-9]{5}$/;
function validateStaffPassword(pw) { return typeof pw === 'string' && STAFF_PW_PATTERN.test(pw); }
async function hashStaffPassword(staffId, password) {
  const salted  = `staff:${staffId}:${password}`;
  const encoded = new TextEncoder().encode(salted);
  const buf     = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function normalizeEmpType(value) {
  if (value === 'employed_full' || value === 'employed_temp' || value === 'contractor') return value;
  if (value === 'employed') return 'employed_full';
  return 'employed_full';
}

/* コスト科目：委託・外注のみ 21/25。雇用系は給与計算側で20固定のため参照されない */
function normalizeCostCategory(value) {
  return (value === '25') ? '25' : '21';
}

function empTypeLabel(empType) {
  if (empType === 'contractor') return '委託・外注';
  if (empType === 'employed_temp') return '臨時アルバイト';
  return '常勤雇用';
}

function getStaffArray() {
  let staff = settings?.staffList ?? settings?.staff ?? [];
  if (typeof staff === 'string') { try { staff = JSON.parse(staff); } catch { staff = []; } }
  if (!Array.isArray(staff)) staff = [];
  return staff;
}

// 次のスタッフID（sNNN）。既存の sNNN・旧数値IDの双方から最大連番を求める（→ 03_データ仕様.md §2）。
function _nextStaffIdPc(list) {
  let max = 0;
  (list || []).forEach(s => {
    const raw = String((s && s.id) != null ? s.id : '');
    const m = /^s(\d+)$/i.exec(raw);
    if (m) max = Math.max(max, parseInt(m[1], 10));
    else if (/^\d+$/.test(raw)) max = Math.max(max, parseInt(raw, 10));
  });
  return 's' + String(max + 1).padStart(3, '0');
}

function renderStaff() {
  const staff = getStaffArray();
  const body = document.getElementById('staff-body');
  if (!body) return;
  if (staff.length === 0) {
    body.innerHTML = `<tr><td colspan="5" class="text-muted" style="text-align:center;padding:20px;">登録なし</td></tr>`;
    return;
  }
  body.innerHTML = staff.map(s => {
    const empType = normalizeEmpType(s.employmentType);
    const sid = escHtml(String(s.id || ''));
    const isContractor = empType === 'contractor';
    const costLabel = isContractor
      ? ((normalizeCostCategory(s.costCategory) === '25') ? '25：税理士等の報酬' : '21：外注工賃')
      : '20：給料賃金';
    return `<tr id="staff-row-${sid}">
      <td>${sid}</td>
      <td>${escHtml(s.name || '')}</td>
      <td>${empTypeLabel(empType)}</td>
      <td>${costLabel}</td>
      <td><button class="pc-btn pc-btn--ghost" type="button" onclick="editStaff('${sid}')">編集</button></td>
    </tr>`;
  }).join('');
}

function editStaff(id) {
  const staff = getStaffArray().find(s => String(s.id) === String(id));
  if (!staff) return;
  const row = document.getElementById(`staff-row-${id}`);
  if (!row) return;
  const empType = normalizeEmpType(staff.employmentType);
  const costCat = normalizeCostCategory(staff.costCategory);
  const costDisabled = empType !== 'contractor';
  row.innerHTML = `
    <td colspan="5">
      <div class="staff-edit-cell">
        <div class="staff-edit-line">
          <input type="text" id="staff-edit-name-${id}" class="pc-input" style="flex:1;min-width:140px;" value="${escHtml(staff.name || '')}" maxlength="20" placeholder="スタッフ名">
          <select id="staff-edit-emp-${id}" class="pc-select" style="width:160px;" onchange="onEditEmpChange('${id}')">
            <option value="employed_full"${empType === 'employed_full' ? ' selected' : ''}>常勤雇用（社員）</option>
            <option value="employed_temp"${empType === 'employed_temp' ? ' selected' : ''}>臨時アルバイト</option>
            <option value="contractor"${empType === 'contractor' ? ' selected' : ''}>委託・外注</option>
          </select>
          <select id="staff-edit-cost-${id}" class="pc-select" style="width:170px;"${costDisabled ? ' disabled' : ''}>
            <option value="21"${costCat === '21' ? ' selected' : ''}>21：外注工賃</option>
            <option value="25"${costCat === '25' ? ' selected' : ''}>25：税理士等の報酬</option>
          </select>
        </div>
        <div class="staff-edit-line">
          <input type="text" id="staff-edit-password-${id}" class="pc-input" style="flex:1;min-width:200px;" placeholder="パスワード変更（任意・5桁英数字）" maxlength="5" autocomplete="off">
          <button class="pc-btn" type="button" onclick="saveEditStaff('${id}')">保存</button>
          <button class="pc-btn pc-btn--ghost" type="button" onclick="renderStaff()">キャンセル</button>
          <button class="pc-btn pc-btn--danger" type="button" onclick="deleteStaff('${id}')">削除</button>
        </div>
        <p class="pc-note" style="margin:2px 0 0;color:var(--uz-muted);font-size:11px;">給与単価・源泉区分・経営メモは出勤管理で設定します（ここでの編集では変更されません）。</p>
      </div>
    </td>`;
  document.getElementById(`staff-edit-name-${id}`)?.focus();
}

/* 編集モード：雇用形態に応じてコスト科目セレクトの活性を切替（委託・外注のみ活性） */
function onEditEmpChange(id) {
  const empEl  = document.getElementById(`staff-edit-emp-${id}`);
  const costEl = document.getElementById(`staff-edit-cost-${id}`);
  if (!empEl || !costEl) return;
  costEl.disabled = (normalizeEmpType(empEl.value) !== 'contractor');
}

async function saveEditStaff(id) {
  const nameEl = document.getElementById(`staff-edit-name-${id}`);
  const empEl  = document.getElementById(`staff-edit-emp-${id}`);
  const costEl = document.getElementById(`staff-edit-cost-${id}`);
  const pwEl   = document.getElementById(`staff-edit-password-${id}`);
  if (!nameEl || !empEl) return;

  const name = nameEl.value.trim();
  if (!name) return showToast('スタッフ名を入力してください', 'error');

  const list = getStaffArray();
  if (list.some(s => String(s.id) !== String(id) && s.name === name)) {
    return showToast('同じ名前のスタッフが既に登録されています', 'error');
  }

  const pwInput = pwEl ? pwEl.value.trim() : '';
  let passwordUpdate = null;
  if (pwInput) {
    if (!validateStaffPassword(pwInput)) {
      return showToast('パスワードは5桁の半角英数字で入力してください', 'error');
    }
    passwordUpdate = {
      passwordHash: await hashStaffPassword(id, pwInput),
      passwordUpdatedAt: new Date().toISOString(),
    };
  }

  const empType = normalizeEmpType(empEl.value);
  const costCategory = (empType === 'contractor') ? normalizeCostCategory(costEl ? costEl.value : '21') : '21';

  // 既存フィールド（給与単価・源泉区分・経営メモ等）は ...s で必ず保持
  const updated = list.map(s =>
    String(s.id) === String(id)
      ? { ...s, name, employmentType: empType, costCategory, ...(passwordUpdate || {}) }
      : s
  );

  const res = await callGAS('saveStaffList', { staffList: updated }).catch(() => null);
  if (res && res.status === 'ok') {
    settings.staffList = updated;
    renderStaff();
    showToast(passwordUpdate ? `${name}を更新しました（パスワード変更含む）` : `${name}を更新しました`, 'success');
  } else {
    showToast('保存失敗：' + (res && res.message || '不明なエラー'), 'error');
  }
}

async function deleteStaff(id) {
  const list = getStaffArray();
  const target = list.find(s => String(s.id) === String(id));
  if (!target) return;
  if (!confirm(`「${target.name}」を削除しますか？\n出退勤の記録済みデータには影響しません。`)) return;
  const updated = list.filter(s => String(s.id) !== String(id));
  const res = await callGAS('saveStaffList', { staffList: updated }).catch(() => null);
  if (res && res.status === 'ok') {
    settings.staffList = updated;
    renderStaff();
    showToast(`${target.name}を削除しました`, 'success');
  } else {
    showToast('削除失敗：' + (res && res.message || '不明なエラー'), 'error');
  }
}

function bindStaffAdd() {
  const btn       = document.getElementById('staff-add-btn');
  const nameInput = document.getElementById('staff-add-name');
  const empSelect = document.getElementById('staff-add-emp');
  const costSelect= document.getElementById('staff-add-cost');
  const pwInput   = document.getElementById('staff-add-password');
  if (!btn || !nameInput) return;

  if (empSelect && costSelect) {
    empSelect.addEventListener('change', () => {
      costSelect.disabled = (normalizeEmpType(empSelect.value) !== 'contractor');
    });
  }

  const doAdd = async () => {
    const name = nameInput.value.trim();
    if (!name) return showToast('スタッフ名を入力してください', 'error');

    const password = pwInput ? pwInput.value.trim() : '';
    if (!validateStaffPassword(password)) {
      return showToast('パスワードは5桁の半角英数字で入力してください', 'error');
    }

    const list = getStaffArray();
    if (list.some(s => s.name === name)) {
      return showToast('同じ名前のスタッフが既に登録されています', 'error');
    }

    // スタッフIDは sNNN 形式で採番（打刻URL・validateStaff・attendance B列と一致・→ 03_データ仕様.md §2）
    const newId = _nextStaffIdPc(list);
    const empType = normalizeEmpType(empSelect ? empSelect.value : '');
    const costCategory = (empType === 'contractor') ? normalizeCostCategory(costSelect ? costSelect.value : '21') : '21';
    const passwordHash = await hashStaffPassword(newId, password);

    // 給与単価・源泉区分は出勤管理で設定する領域。新規追加時は既定値で初期化
    const updated = [...list, {
      id: newId, name, employmentType: empType, costCategory,
      withholdingMode: 'off', hourlyWage: 0, dailyWage: 0, monthlyWage: 0, managerMemo: '',
      passwordHash, passwordUpdatedAt: new Date().toISOString(),
    }];

    btn.disabled = true;
    const res = await callGAS('saveStaffList', { staffList: updated }).catch(() => null);
    btn.disabled = false;
    if (res && res.status === 'ok') {
      settings.staffList = updated;
      nameInput.value = '';
      if (empSelect) empSelect.value = 'employed_full';
      if (costSelect) { costSelect.value = '21'; costSelect.disabled = true; }
      if (pwInput) pwInput.value = '';
      renderStaff();
      showToast(`${name}を追加しました`, 'success');
    } else {
      showToast('追加失敗：' + (res && res.message || '不明なエラー'), 'error');
    }
  };

  btn.addEventListener('click', doAdd);
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  if (pwInput) pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
}

/* ============================================================
 * 2026-08-27：新マスタ管理UI（PC版・→ PWA settings.js と同型・独自 id で衝突回避）
 * - サービス販売チャネル大分類（→ 03§1-1-2）
 * - 仕入原価大分類（→ 03§1-3-2）
 * - 仕入先マスタ（→ 03§1-6-2・集計付）
 * - 顧客CSV I/O（→ 03§1-6-1）
 * ============================================================ */

/* ── サービス販売チャネル大分類 ─────────────────── */
function renderPcServiceChannels() {
  const tbody = document.getElementById('pc-schannel-body');
  if (!tbody) return;
  const list = serviceChannelList || [];
  const quota = masterQuota.serviceChannelQuota;
  const unlimited = (quota == null || !isFinite(quota));
  tbody.innerHTML = list.length ? list.map(ch => `
    <tr>
      <td>${uzEscHtml(ch.id || '')}</td>
      <td>${uzEscHtml(ch.name || '')}</td>
      <td>${Number(ch.taxRate) || 0}%</td>
      <td><button type="button" class="pc-btn" style="background:#c00;color:#fff;" onclick="deletePcServiceChannel('${uzEscHtml(String(ch.id))}')">削除</button></td>
    </tr>
  `).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--uz-muted);">未設定（売上入力にチャネル選択は出ません＝後方互換）</td></tr>';
  const badge = document.getElementById('pc-schannel-count-badge');
  if (badge) { badge.hidden = false; badge.textContent = unlimited ? ` ${list.length}件` : ` ${list.length}/${quota}`; }
  const addRow = document.getElementById('pc-schannel-add-row');
  const hint = document.getElementById('pc-schannel-limit-hint');
  const atMax = !unlimited && list.length >= quota;
  if (addRow) addRow.hidden = atMax;
  if (hint) { hint.hidden = !atMax; if (atMax) hint.textContent = `件数枠の上限（${quota}件）に達しています`; }
}

function bindPcServiceChannelAdd() {
  const btn = document.getElementById('pc-schannel-add-btn');
  const nameInput = document.getElementById('pc-schannel-add-name');
  const taxSelect = document.getElementById('pc-schannel-add-tax');
  if (!btn || !nameInput) return;
  const doAdd = async () => {
    const name = nameInput.value.trim();
    const taxRate = parseInt(taxSelect.value, 10);
    if (!name) return showToast('チャネル名を入力してください', 'error');
    if (name.length > 30) return showToast('チャネル名は30文字以内で入力してください', 'error');
    const quota = masterQuota.serviceChannelQuota;
    if (quota != null && isFinite(quota) && serviceChannelList.length >= quota) {
      return showToast(`件数枠の上限（${quota}件）に達しています`, 'error');
    }
    if (serviceChannelList.some(c => c.name === name)) return showToast('同じ名前のチャネルが既に登録されています', 'error');
    btn.disabled = true;
    try {
      const res = await callGAS('addServiceChannel', { name, taxRate });
      if (res && res.status === 'ok' && Array.isArray(res.serviceChannelList)) {
        serviceChannelList = res.serviceChannelList;
        try { localStorage.setItem('uz_service_channel_list', JSON.stringify(serviceChannelList)); } catch {}
        nameInput.value = ''; taxSelect.value = '10';
        renderPcServiceChannels();
        renderServices();  // 2026-08-29：サービスマスタの分類ドロップダウンを新チャネルで再描画
        showToast(`${name}を追加しました`, 'success');
      } else if (res && res.code === 'quota_exceeded') {
        showToast(res.message || '件数枠の上限に達しています', 'error');
      } else {
        showToast((res && res.message) || '追加に失敗しました', 'error');
      }
    } catch (e) { showToast('通信エラー：' + (e.message || 'unknown'), 'error'); }
    finally { btn.disabled = false; }
  };
  btn.addEventListener('click', doAdd);
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
}

async function deletePcServiceChannel(id) {
  const target = serviceChannelList.find(c => String(c.id) === String(id));
  if (!target) return;
  if (!confirm(`「${target.name}」を削除しますか？\n登録済みの売上データには影響しません。`)) return;
  try {
    const res = await callGAS('deleteServiceChannel', { id: String(id) });
    if (res && res.status === 'ok' && Array.isArray(res.serviceChannelList)) {
      serviceChannelList = res.serviceChannelList;
      try { localStorage.setItem('uz_service_channel_list', JSON.stringify(serviceChannelList)); } catch {}
      renderPcServiceChannels();
      renderServices();  // 2026-08-29：サービスマスタの分類ドロップダウン再描画
      showToast(`${target.name}を削除しました`, 'success');
    } else {
      showToast((res && res.message) || '削除に失敗しました', 'error');
    }
  } catch (e) { showToast('通信エラー：' + (e.message || 'unknown'), 'error'); }
}

/* ── 仕入原価大分類 ─────────────────── */
function renderPcPurchaseCategories() {
  const tbody = document.getElementById('pc-pcat-body');
  if (!tbody) return;
  const list = purchaseCategoryList || [];
  const quota = masterQuota.purchaseCategoryQuota;
  const unlimited = (quota == null || !isFinite(quota));
  tbody.innerHTML = list.length ? list.map(c => `
    <tr>
      <td>${uzEscHtml(c.id || '')}</td>
      <td>${uzEscHtml(c.name || '')}</td>
      <td><button type="button" class="pc-btn" style="background:#c00;color:#fff;" onclick="deletePcPurchaseCategory('${uzEscHtml(String(c.id))}')">削除</button></td>
    </tr>
  `).join('') : '<tr><td colspan="3" style="text-align:center;color:var(--uz-muted);">未設定（品目マスタで categoryId 紐付けのみ）</td></tr>';
  const badge = document.getElementById('pc-pcat-count-badge');
  if (badge) { badge.hidden = false; badge.textContent = unlimited ? ` ${list.length}件` : ` ${list.length}/${quota}`; }
  const addRow = document.getElementById('pc-pcat-add-row');
  const hint = document.getElementById('pc-pcat-limit-hint');
  const atMax = !unlimited && list.length >= quota;
  if (addRow) addRow.hidden = atMax;
  if (hint) { hint.hidden = !atMax; if (atMax) hint.textContent = `件数枠の上限（${quota}件）に達しています`; }
}

function bindPcPurchaseCategoryAdd() {
  const btn = document.getElementById('pc-pcat-add-btn');
  const nameInput = document.getElementById('pc-pcat-add-name');
  if (!btn || !nameInput) return;
  const doAdd = async () => {
    const name = nameInput.value.trim();
    if (!name) return showToast('大分類名を入力してください', 'error');
    if (name.length > 30) return showToast('大分類名は30文字以内で入力してください', 'error');
    const quota = masterQuota.purchaseCategoryQuota;
    if (quota != null && isFinite(quota) && purchaseCategoryList.length >= quota) {
      return showToast(`件数枠の上限（${quota}件）に達しています`, 'error');
    }
    if (purchaseCategoryList.some(c => c.name === name)) return showToast('同じ名前の大分類が既に登録されています', 'error');
    btn.disabled = true;
    try {
      const res = await callGAS('addPurchaseCategory', { name });
      if (res && res.status === 'ok' && Array.isArray(res.purchaseCategoryList)) {
        purchaseCategoryList = res.purchaseCategoryList;
        try { localStorage.setItem('uz_purchase_category_list', JSON.stringify(purchaseCategoryList)); } catch {}
        nameInput.value = '';
        renderPcPurchaseCategories();
        renderPurchases();  // 2026-08-29：仕入原価マスタの分類ドロップダウン再描画
        showToast(`${name}を追加しました`, 'success');
      } else if (res && res.code === 'quota_exceeded') {
        showToast(res.message || '件数枠の上限に達しています', 'error');
      } else {
        showToast((res && res.message) || '追加に失敗しました', 'error');
      }
    } catch (e) { showToast('通信エラー：' + (e.message || 'unknown'), 'error'); }
    finally { btn.disabled = false; }
  };
  btn.addEventListener('click', doAdd);
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
}

async function deletePcPurchaseCategory(id) {
  const target = purchaseCategoryList.find(c => String(c.id) === String(id));
  if (!target) return;
  if (!confirm(`「${target.name}」を削除しますか？\n仕入原価品目の紐付けは自動で解除されます。`)) return;
  try {
    const res = await callGAS('deletePurchaseCategory', { id: String(id) });
    if (res && res.status === 'ok' && Array.isArray(res.purchaseCategoryList)) {
      purchaseCategoryList = res.purchaseCategoryList;
      try { localStorage.setItem('uz_purchase_category_list', JSON.stringify(purchaseCategoryList)); } catch {}
      renderPcPurchaseCategories();
      renderPurchases();  // 2026-08-29：仕入原価マスタの分類ドロップダウン再描画
      showToast(`${target.name}を削除しました`, 'success');
    } else {
      showToast((res && res.message) || '削除に失敗しました', 'error');
    }
  } catch (e) { showToast('通信エラー：' + (e.message || 'unknown'), 'error'); }
}

/* ── 仕入先マスタ ─────────────────── */
async function loadPcSuppliers() {
  try {
    const res = await callGAS('getSuppliers', {});
    if (res && res.status === 'ok' && Array.isArray(res.suppliers)) {
      suppliersList = res.suppliers;
      try { localStorage.setItem('uz_suppliers_list', JSON.stringify(suppliersList)); } catch {}
      renderPcSuppliers();
    }
  } catch {}
}

function renderPcSuppliers() {
  const tbody = document.getElementById('pc-suppliers-body');
  if (!tbody) return;
  const list = suppliersList || [];
  tbody.innerHTML = list.length ? list.map(s => `
    <tr>
      <td><a href="#" onclick="togglePcSupplierAggregate('${uzEscHtml(String(s.supplierId))}');return false;" style="color:var(--uz-accent);text-decoration:underline;">${uzEscHtml(s.name || '')}</a>
        <div id="pc-supplier-agg-${uzEscHtml(String(s.supplierId))}" class="pc-note" style="margin-top:6px;" hidden></div>
      </td>
      <td>${uzEscHtml(s.tel || '')}</td>
      <td>${uzEscHtml(s.fax || '')}</td>
      <td><button type="button" class="pc-btn" style="background:#c00;color:#fff;" onclick="deletePcSupplier('${uzEscHtml(String(s.supplierId))}')">削除</button></td>
    </tr>
  `).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--uz-muted);">未登録（下のフォームで追加）</td></tr>';
  const badge = document.getElementById('pc-suppliers-count-badge');
  if (badge) { badge.hidden = false; badge.textContent = ` ${list.length}件`; }
}

function bindPcSupplierAdd() {
  const btn = document.getElementById('pc-supplier-add-btn');
  const g = k => document.getElementById(`pc-supplier-add-${k}`);
  if (!btn || !g('name')) return;
  btn.addEventListener('click', async () => {
    const name = g('name').value.trim();
    if (!name) return showToast('仕入先名を入力してください', 'error');
    const payload = {
      name, tel: g('tel').value.trim(), fax: g('fax').value.trim(),
      postalCode: g('postal').value.trim(), address: g('address').value.trim(),
      email: g('email').value.trim(), invoiceRegNo: g('invoice').value.trim(),
      bankAccount: g('bank').value.trim(), aliases: g('aliases').value.trim(),
      memo: g('memo').value.trim()
    };
    btn.disabled = true;
    try {
      const res = await callGAS('addSupplier', payload);
      if (res && res.status === 'ok') {
        ['name','tel','fax','postal','address','email','invoice','bank','aliases','memo'].forEach(k => { const el = g(k); if (el) el.value = ''; });
        await loadPcSuppliers();
        showToast(`${name}を追加しました`, 'success');
      } else {
        showToast((res && res.message) || '追加に失敗しました', 'error');
      }
    } catch (e) { showToast('通信エラー：' + (e.message || 'unknown'), 'error'); }
    finally { btn.disabled = false; }
  });
}

async function deletePcSupplier(id) {
  const target = suppliersList.find(s => String(s.supplierId) === String(id));
  if (!target) return;
  if (!confirm(`「${target.name}」を削除しますか？\n過去のコストデータには影響しません。`)) return;
  try {
    const res = await callGAS('deleteSupplier', { supplierId: String(id) });
    if (res && res.status === 'ok') {
      await loadPcSuppliers();
      showToast(`${target.name}を削除しました`, 'success');
    } else {
      showToast((res && res.message) || '削除に失敗しました', 'error');
    }
  } catch (e) { showToast('通信エラー：' + (e.message || 'unknown'), 'error'); }
}

async function togglePcSupplierAggregate(id) {
  const box = document.getElementById(`pc-supplier-agg-${id}`);
  if (!box) return;
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  box.textContent = '読み込み中…';
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  try {
    const res = await callGAS('getSupplierAggregate', { supplierId: String(id), month: monthKey });
    if (res && res.status === 'ok') {
      const yen = n => (Number(n) || 0).toLocaleString('ja-JP');
      const recent = (res.history || []).slice(0, 5).map(h => {
        const d = h.date instanceof Date ? h.date : (typeof h.date === 'string' ? h.date.substring(0, 10) : '');
        const dstr = d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : d;
        return `<div>${uzEscHtml(String(dstr))}｜¥${yen(h.amount)}｜${uzEscHtml(h.itemName || '')}</div>`;
      }).join('');
      box.innerHTML = `
        <div style="padding:8px;background:#f5f5f5;border-radius:4px;">
          <div><strong>${uzEscHtml(monthKey)}</strong> 仕入額：<strong>¥${yen(res.monthly)}</strong></div>
          <div>累計仕入額：<strong>¥${yen(res.lifetime)}</strong></div>
          ${recent ? `<div style="margin-top:6px;"><strong>直近履歴：</strong></div>${recent}` : '<div style="margin-top:4px;color:var(--uz-muted);">履歴なし</div>'}
        </div>
      `;
    } else {
      box.textContent = (res && res.message) || '集計取得に失敗しました';
    }
  } catch { box.textContent = '通信エラー'; }
}

/* ── 顧客マスタ CSV I/O ─────────────────── */
function bindPcCustomersCsvIO() {
  const exportBtn = document.getElementById('pc-customers-export-btn');
  const importFile = document.getElementById('pc-customers-import-file');
  const modeSelect = document.getElementById('pc-customers-import-mode');
  const report = document.getElementById('pc-customers-import-report');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      exportBtn.disabled = true;
      try {
        const res = await callGAS('exportCustomersCSV', {});
        if (res && res.status === 'ok' && typeof res.csv === 'string') {
          const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const ts = new Date().toISOString().substring(0, 10);
          a.href = url; a.download = `customers_${ts}.csv`;
          document.body.appendChild(a); a.click(); a.remove();
          URL.revokeObjectURL(url);
          showToast(`顧客マスタ ${res.count}件を書き出しました`, 'success');
        } else {
          showToast((res && res.message) || 'エクスポート失敗', 'error');
        }
      } catch { showToast('通信エラー', 'error'); }
      finally { exportBtn.disabled = false; }
    });
  }
  if (importFile) {
    importFile.addEventListener('change', async () => {
      const file = importFile.files && importFile.files[0];
      if (!file) return;
      const duplicateBehavior = modeSelect ? modeSelect.value : 'warn';
      const reader = new FileReader();
      reader.onload = async () => {
        const csv = String(reader.result || '');
        try {
          const res = await callGAS('importCustomersCSV', { csv, duplicateBehavior });
          if (res && res.status === 'ok' && res.report) {
            const r = res.report;
            const msg = `取込 ${r.imported}件・更新 ${r.updated}件・スキップ ${r.skipped}件`;
            if (report) {
              report.hidden = false;
              report.innerHTML = `<strong>${uzEscHtml(msg)}</strong>` + (r.warnings && r.warnings.length ? `<br>${r.warnings.map(w => uzEscHtml(w)).join('<br>')}` : '');
            }
            showToast(msg, 'success');
          } else {
            showToast((res && res.message) || 'インポート失敗', 'error');
          }
        } catch { showToast('通信エラー', 'error'); }
        importFile.value = '';
      };
      reader.readAsText(file, 'utf-8');
    });
  }
}
