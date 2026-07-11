/* ══════════════════════════════════════════════════════════
   FAX受注管理（警備隊第5隊員 fax_order_ocr）
   正本仕様＝知識MD 05§8-7。§8-1 AI自動確定禁止：取込は下書き(draft)まで、
   確認・修正・確定(confirmed)は人手。GAS呼び出しは app.js の callGAS / callGASPost。
   ══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function loading(on) {
    var ov = document.getElementById('loading-overlay');
    if (ov) ov.setAttribute('aria-hidden', on ? 'false' : 'true');
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function input(value, opts) {
    opts = opts || {};
    var i = document.createElement('input');
    i.type = opts.type || 'text';
    if (opts.inputmode) i.inputMode = opts.inputmode;
    i.value = (value == null ? '' : value);
    i.dataset.field = opts.field || '';
    return i;
  }

  // ── 状態バナー ──────────────────────────────────────────
  async function loadConfig() {
    var box = document.getElementById('fax-status');
    var captureCard = document.getElementById('fax-capture-card');
    var scanBtn = document.getElementById('fax-scan-btn');
    try {
      // 複製元判定を先に確定：getSettings は複製元テンプレGASで __SPREADSHEET_ID__ シグナルを返し
      // callGAS が UZ_DEMO を立てる。getFaxOrderConfig はこのシグナルを握り潰すため先に踏む。
      // ネットワーク失敗（実店舗のオフライン等）でFAX設定取得自体を妨げないよう非致命に握る。
      try { await callGAS('getSettings'); } catch (e) { /* demo判定用の先読みのみ */ }
      var cfg = await callGAS('getFaxOrderConfig');
      if (!cfg || cfg.status !== 'ok') throw new Error('設定取得エラー');
      if (!cfg.enabled) {
        box.className = 'fax-status fax-status--off';
        box.innerHTML = '<b>この機能は未提供です。</b> FAX注文自動管理（fax_order_ocr）は運営ポータルで有効化されていません。';
        if (captureCard) captureCard.style.display = 'none';
        return cfg;
      }
      var warn = [];
      if (!cfg.apiKeyConfigured) warn.push('APIキー未設定');
      if (!cfg.tier2TriggerInstalled) warn.push('メール自動取込トリガー未設置');
      box.className = 'fax-status';
      box.innerHTML =
        '<b>有効</b>　モデル: ' + esc(cfg.model) +
        '　／　今月の処理: ' + cfg.monthlyUsed + ' / ' + cfg.monthlyCap + ' 枚' +
        '　／　メール自動取込: ' + (cfg.tier2TriggerInstalled ? 'ON' : 'OFF') +
        (warn.length ? '<br><span style="color:#b45309">⚠ ' + warn.join('・') + '（運営にご連絡ください）</span>' : '');
      if (scanBtn && !cfg.apiKeyConfigured) { scanBtn.disabled = true; }
      return cfg;
    } catch (e) {
      box.className = 'fax-status fax-status--off';
      box.textContent = '状態の取得に失敗しました：' + e.message;
      return null;
    }
  }

  function esc(s) { return String(s == null ? '' : s); }

  // ── 一覧描画 ────────────────────────────────────────────
  function groupByOrder(orders) {
    var map = {};
    var order = [];
    orders.forEach(function (o) {
      if (!map[o.orderId]) { map[o.orderId] = []; order.push(o.orderId); }
      map[o.orderId].push(o);
    });
    return order.map(function (id) { return { orderId: id, lines: map[id] }; });
  }

  function confBadge(conf) {
    var pct = Math.round((Number(conf) || 0) * 100);
    var b = el('span', 'fax-badge ' + (pct < 80 ? 'fax-badge--warn' : 'fax-badge--conf'), '信頼度 ' + pct + '%');
    return b;
  }

  function renderDraftGroup(grp) {
    var first = grp.lines[0];
    var box = el('div', 'fax-order');

    var head = el('div', 'fax-order__head');
    head.appendChild(el('span', 'fax-order__id', grp.orderId));
    head.appendChild(el('span', 'fax-badge fax-badge--draft', '下書き'));
    head.appendChild(confBadge(first.confidence));
    if (!first.customerId) head.appendChild(el('span', 'fax-badge fax-badge--warn', '顧客未紐付け'));
    var meta = el('div', 'fax-order__meta',
      '取込: ' + (first.tier === 'tier2' ? 'メール自動' : first.tier === 'tier1' ? '撮影' : '—') +
      '　登録: ' + esc(first.createdAt) + (first.memo ? '　メモ: ' + esc(first.memo) : ''));
    head.appendChild(meta);
    box.appendChild(head);

    // 発注元まわり（この受注の全明細に適用）
    var ord = el('div', 'fax-line fax-line--full');
    var supWrap = el('div'); supWrap.appendChild(el('label', null, '発注元 / 先方FAX番号 / 顧客ID / 納品希望日'));
    var row = el('div'); row.style.display = 'grid';
    row.style.gridTemplateColumns = '1fr 1fr 1fr 1fr'; row.style.gap = '6px';
    var iSup = input(first.supplierName, { field: 'supplierName' });
    var iFax = input(first.senderFax, { field: 'senderFax', inputmode: 'tel' });
    var iCid = input(first.customerId, { field: 'customerId' });
    var iDue = input(first.desiredDeliveryDate, { field: 'desiredDeliveryDate', type: 'date' });
    [iSup, iFax, iCid, iDue].forEach(function (i) { row.appendChild(i); });
    supWrap.appendChild(row);
    ord.appendChild(supWrap);
    box.appendChild(ord);
    box._orderInputs = { supplierName: iSup, senderFax: iFax, customerId: iCid, desiredDeliveryDate: iDue };

    // 明細行
    box._lineRows = [];
    grp.lines.forEach(function (ln) {
      var lr = el('div', 'fax-line');
      var w1 = el('div'); w1.appendChild(el('label', null, '商品名'));
      var iName = input(ln.productName, { field: 'productName' }); w1.appendChild(iName);
      var w2 = el('div'); w2.appendChild(el('label', null, '数量'));
      var iQty = input(ln.quantity, { field: 'quantity', type: 'number', inputmode: 'decimal' }); w2.appendChild(iQty);
      var w3 = el('div'); w3.appendChild(el('label', null, '単価'));
      var iPrice = input(ln.unitPrice, { field: 'unitPrice', type: 'number', inputmode: 'decimal' }); w3.appendChild(iPrice);
      lr.appendChild(w1); lr.appendChild(w2); lr.appendChild(w3);
      box.appendChild(lr);
      box._lineRows.push({ rowIndex: ln.rowIndex, productName: iName, quantity: iQty, unitPrice: iPrice });
    });

    // 操作
    var act = el('div', 'fax-actions');
    var bSave = el('button', 'fax-btn', '修正を保存');
    var bConfirm = el('button', 'fax-btn fax-btn--primary', '確定する');
    var bDel = el('button', 'fax-btn fax-btn--danger', '削除');
    bSave.addEventListener('click', function () { saveEdits(grp.orderId, box, false); });
    bConfirm.addEventListener('click', function () { saveEdits(grp.orderId, box, true); });
    bDel.addEventListener('click', function () { removeOrder(grp.orderId); });
    act.appendChild(bSave); act.appendChild(bConfirm); act.appendChild(bDel);
    box.appendChild(act);

    return box;
  }

  function renderConfirmedGroup(grp) {
    var first = grp.lines[0];
    var box = el('div', 'fax-order');
    var head = el('div', 'fax-order__head');
    head.appendChild(el('span', 'fax-order__id', grp.orderId));
    head.appendChild(el('span', 'fax-badge fax-badge--confirmed', '確定'));
    head.appendChild(el('div', 'fax-order__meta',
      esc(first.supplierName || '発注元不明') + '　顧客ID: ' + esc(first.customerId || '—') +
      '　納品希望: ' + esc(first.desiredDeliveryDate || '—') + '　確定: ' + esc(first.confirmedAt)));
    box.appendChild(head);
    grp.lines.forEach(function (ln) {
      var lr = el('div', 'fax-line fax-line--full');
      lr.appendChild(el('div', null,
        esc(ln.productName || '（品名なし）') + '　×' + esc(ln.quantity) + '　@' + esc(ln.unitPrice) + '　= ' + esc(ln.amount) + '円'));
      box.appendChild(lr);
    });
    return box;
  }

  async function loadOrders() {
    var draftBox = document.getElementById('fax-drafts');
    var confBox = document.getElementById('fax-confirmed');
    try {
      var res = await callGAS('getOrders');
      var orders = (res && res.orders) || [];
      var drafts = orders.filter(function (o) { return o.state !== 'confirmed'; });
      var confirmed = orders.filter(function (o) { return o.state === 'confirmed'; });

      draftBox.innerHTML = '';
      if (!drafts.length) draftBox.appendChild(el('div', 'fax-empty', '確認待ちの下書きはありません。'));
      else {
        // §8-1：AI自動確定禁止。プレビューと同時に「正しくなければ修正」を明示する。
        var notice = el('div', 'fax-note', '⚠ これはAIの読み取り結果（下書き）です。AI読み取りが正しくない場合は修正してから「確定する」を押してください。');
        notice.style.cssText = 'margin:0 0 12px;padding:8px 10px;background:#fef9c3;color:#854d0e;border-radius:8px;';
        draftBox.appendChild(notice);
        groupByOrder(drafts).forEach(function (g) { draftBox.appendChild(renderDraftGroup(g)); });
      }

      confBox.innerHTML = '';
      if (!confirmed.length) confBox.appendChild(el('div', 'fax-empty', '—'));
      else groupByOrder(confirmed).forEach(function (g) { confBox.appendChild(renderConfirmedGroup(g)); });
    } catch (e) {
      draftBox.innerHTML = '';
      draftBox.appendChild(el('div', 'fax-empty', '読み込みに失敗しました：' + e.message));
    }
  }

  // ── 修正保存 → （確定） ────────────────────────────────
  async function saveEdits(orderId, box, thenConfirm) {
    loading(true);
    try {
      var ord = box._orderInputs;
      var orderFields = {
        supplierName: ord.supplierName.value,
        senderFax: ord.senderFax.value,
        customerId: ord.customerId.value,
        desiredDeliveryDate: ord.desiredDeliveryDate.value
      };
      // 明細ごとに updateOrder（発注元系フィールドは全明細へ複製）
      for (var i = 0; i < box._lineRows.length; i++) {
        var r = box._lineRows[i];
        var fields = {
          rowIndex: r.rowIndex,
          productName: r.productName.value,
          quantity: r.quantity.value,
          unitPrice: r.unitPrice.value
        };
        Object.keys(orderFields).forEach(function (k) { fields[k] = orderFields[k]; });
        await callGAS('updateOrder', fields);
      }
      if (thenConfirm) {
        var res = await callGAS('saveOrder', { orderId: orderId });
        if (res && res.status !== 'ok') throw new Error(res.message || '確定に失敗');
      }
      await loadOrders();
      await loadConfig();
    } catch (e) {
      alert('保存に失敗しました：' + e.message);
    } finally {
      loading(false);
    }
  }

  async function removeOrder(orderId) {
    if (!confirm('この受注（' + orderId + '）を削除しますか？')) return;
    loading(true);
    try {
      await callGAS('deleteOrder', { orderId: orderId });
      await loadOrders();
    } catch (e) {
      alert('削除に失敗しました：' + e.message);
    } finally {
      loading(false);
    }
  }

  // ── Tier1：撮影して取り込む ────────────────────────────
  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var s = String(reader.result || '');
        var comma = s.indexOf(',');
        resolve({ base64: comma >= 0 ? s.slice(comma + 1) : s, mimeType: file.type || 'image/jpeg' });
      };
      reader.onerror = function () { reject(new Error('ファイル読み込みに失敗')); };
      reader.readAsDataURL(file);
    });
  }

  async function scan() {
    var fileInput = document.getElementById('fax-file');
    var file = fileInput.files && fileInput.files[0];
    if (!file) { alert('先に画像を選択（撮影）してください。'); return; }
    loading(true);
    try {
      var enc = await fileToBase64(file);
      var res = await callGASPost('faxOrderScanTier1', { imageBase64: enc.base64, mimeType: enc.mimeType });
      if (!res || res.status !== 'ok') throw new Error((res && res.message) || '読み取りに失敗');
      fileInput.value = '';
      var conf = Math.round((res.draft && res.draft.confidence || 0) * 100);
      alert('下書きを作成しました（信頼度 ' + conf + '%）。内容を確認・修正して確定してください。');
      await loadOrders();
      await loadConfig();
    } catch (e) {
      alert('読み取りに失敗しました：' + e.message + '\n手入力での登録もご利用いただけます。');
    } finally {
      loading(false);
    }
  }

  // ※「試し読み（保存しない・previewFaxOrder）」は納品時の初期設定＝運営(admin §6)の作業へ移設。
  //   ユーザーPWAは「メール自動取込された下書きの確認・修正・確定」と補助の撮影取込のみを担う。

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('fax-scan-btn');
    if (btn) btn.addEventListener('click', scan);
    loadConfig();
    loadOrders();
  });
})();
