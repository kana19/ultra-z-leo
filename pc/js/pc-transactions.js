/* pc-transactions.js — PC版 取引一覧（取引ペア紐付けモデル）
 * 戦略思想§3-9-3：売上行ID＝親キー、コストV列＝子キー
 *   - 売上を親、紐付けコストを子として階層表示
 *   - 紐付け候補は対象売上行の前後1ヶ月・集計対象4区分のみ
 *   - 紐付けはユーザー明示操作（チェック→「紐付ける」ボタン）
 *   - 会計データ構造は1ミリも動かさない（売上20列・コスト22列・getSummary 不変）
 */
'use strict';

(function() {
  let currentMonth = '';
  let salesNodes = [];
  let unlinkedCosts = [];
  let _txCostMaster = [];
  let _txServiceMaster = [];
  let _activePopoverSalesRowId = null;

  document.addEventListener('DOMContentLoaded', async () => {
    pcBootstrap('transactions.html', '取引一覧');
    _txCostMaster = (typeof getCostMaster === 'function') ? getCostMaster() : [];
    initMonthSelector();
    bindEvents();
    // サービスマスタを GAS から取得（PC側 localStorage に未保存の場合のフォールバック）
    try {
      const sRes = await callGAS('getSettings', {});
      if (sRes && sRes.status === 'ok' && sRes.data && Array.isArray(sRes.data.serviceList)) {
        _txServiceMaster = sRes.data.serviceList;
      }
    } catch (e) { /* offline or first load */ }
    if (!_txServiceMaster.length) {
      _txServiceMaster = [
        { code: 'S001', name: '店内売上',     taxRate: 10 },
        { code: 'S002', name: 'テイクアウト', taxRate:  8 }
      ];
    }
    await loadAndRender();
  });

  function initMonthSelector() {
    const sel = document.getElementById('tx-month');
    const now = new Date();
    currentMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    if (typeof buildMonthOptions === 'function') {
      buildMonthOptions(sel, currentMonth);
    } else {
      // 直近24ヶ月をフォールバック生成
      const opts = [];
      for (let i = 0; i < 24; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const v = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        opts.push(`<option value="${v}"${v === currentMonth ? ' selected' : ''}>${d.getFullYear()}年${d.getMonth() + 1}月</option>`);
      }
      sel.innerHTML = opts.join('');
    }
  }

  function bindEvents() {
    document.getElementById('tx-month').addEventListener('change', async (e) => {
      currentMonth = e.target.value;
      await loadAndRender();
    });
    document.getElementById('tx-reload').addEventListener('click', loadAndRender);
    document.getElementById('tx-add-sales').addEventListener('click', openSalesModal);
    document.getElementById('tx-add-cost').addEventListener('click', openCostModal);
    // ポップオーバーの外側クリックで閉じる
    document.addEventListener('click', (e) => {
      const popover = document.getElementById('link-popover');
      if (!popover) return;
      if (popover.style.display !== 'block') return;
      if (popover.contains(e.target)) return;
      if (e.target.classList && e.target.classList.contains('btn-link')) return;
      popover.style.display = 'none';
      _activePopoverSalesRowId = null;
    });
  }

  async function loadAndRender() {
    showLoading();
    try {
      const res = await callGAS('getTransactionsHierarchy', { month: currentMonth });
      if (res && res.status === 'ok' && res.data) {
        salesNodes = Array.isArray(res.data.salesNodes) ? res.data.salesNodes : [];
        unlinkedCosts = Array.isArray(res.data.unlinkedCosts) ? res.data.unlinkedCosts : [];
      } else {
        salesNodes = [];
        unlinkedCosts = [];
      }
      renderHierarchy();
      renderUnlinkedCosts();
    } catch (err) {
      console.error('[pc-transactions] loadAndRender error:', err);
      showToast('取引一覧の取得に失敗しました', 'error');
    } finally {
      hideLoading();
    }
  }

  function renderHierarchy() {
    const root = document.getElementById('tx-hierarchy');
    if (!salesNodes.length) {
      root.innerHTML = '<div class="tx-empty">対象月の売上はありません</div>';
      return;
    }
    root.innerHTML = salesNodes.map(renderSalesNode).join('');
    bindHierarchyEvents();
  }

  function renderSalesNode(sales) {
    const linkedCount = (sales.linkedCosts || []).length;
    const profitText = linkedCount > 0
      ? `粗利 ${formatYen(sales.grossProfit)}（${(sales.grossProfitRate * 100).toFixed(0)}%）`
      : '粗利 — （未紐付け）';
    const profitClass = linkedCount > 0 ? 'has-profit' : 'no-profit';

    const childRows = (sales.linkedCosts || []).map(c => `
      <div class="tx-child-row" data-cost-row="${c.rowIndex}">
        <span class="tx-tree-marker">└</span>
        <span class="tx-date">${escTx(c.date)}</span>
        <span class="tx-subject">${escTx(c.subject)}</span>
        <span class="tx-amount">${formatYen(c.amount)}</span>
        <button class="pc-btn pc-btn--sm btn-unlink" data-cost-row="${c.rowIndex}">紐付け解除</button>
      </div>
    `).join('');

    return `
      <div class="tx-sales-node ${profitClass}" data-sales-row-id="${escTx(sales.salesRowId)}" data-sales-row="${sales.salesRowIndex}">
        <div class="tx-parent-row">
          <span class="tx-tree-marker">■</span>
          <span class="tx-date">${escTx(sales.salesDate)}</span>
          <span class="tx-subject">売上：${escTx(sales.salesItem)}</span>
          <span class="tx-amount">${formatYen(sales.salesAmount)}</span>
          <span class="tx-profit">${profitText}</span>
          <button class="pc-btn pc-btn--sm btn-link" data-sales-row-id="${escTx(sales.salesRowId)}">＋ 経費を紐付け</button>
        </div>
        <div class="tx-children">${childRows}</div>
      </div>
    `;
  }

  function renderUnlinkedCosts() {
    const root = document.getElementById('tx-unlinked-costs');
    if (!unlinkedCosts.length) {
      root.innerHTML = '<div class="tx-empty-small">未紐付けの集計対象4区分コストはありません</div>';
      return;
    }
    root.innerHTML = unlinkedCosts.map(c => `
      <div class="tx-unlinked-row" data-cost-row="${c.rowIndex}">
        <span class="tx-date">${escTx(c.date)}</span>
        <span class="tx-subject">${escTx(c.subject)}</span>
        <span class="tx-amount">${formatYen(c.amount)}</span>
      </div>
    `).join('');
  }

  function bindHierarchyEvents() {
    document.querySelectorAll('.btn-link').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const salesRowId = btn.dataset.salesRowId;
        await openLinkPopover(btn, salesRowId);
      });
    });
    document.querySelectorAll('.btn-unlink').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const costRow = parseInt(btn.dataset.costRow, 10);
        if (!confirm('この経費の紐付けを解除しますか？')) return;
        await unlinkCost(costRow);
      });
    });
  }

  async function openLinkPopover(anchorBtn, salesRowId) {
    _activePopoverSalesRowId = salesRowId;
    showLoading();
    try {
      const res = await callGAS('getLinkCandidates', { salesRowId: salesRowId });
      const candidates = (res && res.status === 'ok' && Array.isArray(res.data))
        ? res.data
        : [];
      renderLinkPopover(anchorBtn, salesRowId, candidates);
    } catch (err) {
      console.error('[pc-transactions] getLinkCandidates error:', err);
      showToast('候補の取得に失敗しました', 'error');
    } finally {
      hideLoading();
    }
  }

  function renderLinkPopover(anchorBtn, salesRowId, candidates) {
    const popover = document.getElementById('link-popover');
    if (!candidates.length) {
      popover.innerHTML = `
        <div class="popover-header">紐付け候補（前後1ヶ月・集計対象4区分のみ）</div>
        <div class="popover-empty">候補となるコストがありません</div>
        <div class="popover-footer"><button id="popover-close" class="pc-btn pc-btn--ghost">閉じる</button></div>
      `;
    } else {
      const rows = candidates.map(c => `
        <label class="popover-row">
          <input type="checkbox" value="${c.rowIndex}" ${c.currentlyLinked ? 'checked' : ''}>
          <span class="tx-date">${escTx(c.date)}</span>
          <span class="tx-subject">${escTx(c.subject)}</span>
          <span class="tx-amount">${formatYen(c.amount)}</span>
        </label>
      `).join('');
      popover.innerHTML = `
        <div class="popover-header">紐付け候補（前後1ヶ月・集計対象4区分のみ）</div>
        <div class="popover-body">${rows}</div>
        <div class="popover-footer">
          <button id="popover-apply" class="pc-btn">紐付ける</button>
          <button id="popover-close" class="pc-btn pc-btn--ghost">閉じる</button>
        </div>
      `;
    }

    const rect = anchorBtn.getBoundingClientRect();
    popover.style.top = (window.scrollY + rect.bottom + 4) + 'px';
    popover.style.left = (window.scrollX + Math.max(8, rect.left - 240)) + 'px';
    popover.style.display = 'block';

    document.getElementById('popover-close').addEventListener('click', () => {
      popover.style.display = 'none';
      _activePopoverSalesRowId = null;
    });
    const applyBtn = document.getElementById('popover-apply');
    if (applyBtn) {
      applyBtn.addEventListener('click', async () => {
        const checkedRows = Array.from(popover.querySelectorAll('input[type=checkbox]:checked'))
          .map(cb => parseInt(cb.value, 10));
        // 解除対象：currentlyLinked だが今回チェックされていない行
        const toUnlink = candidates
          .filter(c => c.currentlyLinked && checkedRows.indexOf(c.rowIndex) === -1)
          .map(c => c.rowIndex);
        // 紐付け対象：チェックされているが currentlyLinked=false の行
        const currentlyLinkedSet = {};
        candidates.forEach(c => { if (c.currentlyLinked) currentlyLinkedSet[c.rowIndex] = true; });
        const toLink = checkedRows.filter(r => !currentlyLinkedSet[r]);

        await applyLinkChanges(salesRowId, toLink, toUnlink);
        popover.style.display = 'none';
        _activePopoverSalesRowId = null;
      });
    }
  }

  async function applyLinkChanges(salesRowId, toLink, toUnlink) {
    if (!toLink.length && !toUnlink.length) {
      showToast('変更はありません', 'info');
      return;
    }
    showLoading();
    try {
      for (const rowIndex of toLink) {
        const res = await callGAS('linkTransactions', { rowIndex: rowIndex, salesRowId: salesRowId });
        if (!res || res.status !== 'ok') throw new Error(res && res.message || 'link failed');
      }
      for (const rowIndex of toUnlink) {
        const res = await callGAS('linkTransactions', { rowIndex: rowIndex, salesRowId: '' });
        if (!res || res.status !== 'ok') throw new Error(res && res.message || 'unlink failed');
      }
      showToast('紐付けを更新しました', 'success');
      await loadAndRender();
    } catch (err) {
      console.error('[pc-transactions] applyLinkChanges error:', err);
      showToast('紐付けの更新に失敗しました', 'error');
    } finally {
      hideLoading();
    }
  }

  async function unlinkCost(rowIndex) {
    showLoading();
    try {
      const res = await callGAS('linkTransactions', { rowIndex: rowIndex, salesRowId: '' });
      if (!res || res.status !== 'ok') throw new Error(res && res.message || 'unlink failed');
      showToast('紐付けを解除しました', 'success');
      await loadAndRender();
    } catch (err) {
      console.error('[pc-transactions] unlinkCost error:', err);
      showToast('紐付け解除に失敗しました', 'error');
    } finally {
      hideLoading();
    }
  }

  /* ─────────────────────────────────────────
   * 売上追加モーダル（既存スマホ版 sales.js の addSales 呼び出しパターンに準拠）
   * ───────────────────────────────────────── */

  function openSalesModal() {
    const services = _txServiceMaster.length
      ? _txServiceMaster
      : [{ code: 'S001', name: '店内売上', taxRate: 10 }];
    const svcOpts = services.map(s =>
      `<option value="${escTx(s.code)}" data-name="${escTx(s.name)}" data-tax="${Number(s.taxRate) || 0}">${escTx(s.name)}（${Number(s.taxRate) || 0}%）</option>`
    ).join('');

    const m = document.getElementById('modal-sales');
    m.innerHTML = `
      <div class="tx-modal-backdrop"></div>
      <div class="tx-modal-panel">
        <h3>売上を追加</h3>
        <form id="tx-sales-form">
          <div class="pc-form-row"><label>日付 <span class="pc-required">*</span></label>
            <input type="date" name="date" value="${todayStr()}" required>
          </div>
          <div class="pc-form-row"><label>サービス <span class="pc-required">*</span></label>
            <select name="serviceCode" id="tx-sales-service" required>${svcOpts}</select>
          </div>
          <div class="pc-form-row"><label>品目名（任意・諸口）</label>
            <input type="text" name="miscItemName" placeholder="例：4月分・追加メニュー">
          </div>
          <div class="pc-form-row"><label>税込金額 <span class="pc-required">*</span></label>
            <input type="number" name="amount" min="1" step="1" required>
          </div>
          <div class="pc-form-row"><label>税率</label>
            <select name="taxRate" id="tx-sales-tax">
              <option value="10">10%</option>
              <option value="8">8%</option>
              <option value="0">0%</option>
            </select>
          </div>
          <div class="pc-form-row"><label>未収</label>
            <select name="uncollected">
              <option value="0" selected>消込済</option>
              <option value="1">未収</option>
            </select>
          </div>
          <div class="pc-form-row"><label>メモ</label>
            <input type="text" name="memo">
          </div>
          <div class="pc-modal-actions">
            <button type="button" class="pc-btn pc-btn--ghost" id="tx-sales-cancel">キャンセル</button>
            <button type="submit" class="pc-btn">登録する</button>
          </div>
        </form>
      </div>
    `;
    m.style.display = 'block';
    bindSalesModalEvents();
  }

  function bindSalesModalEvents() {
    const m = document.getElementById('modal-sales');
    const svcSel = m.querySelector('#tx-sales-service');
    const taxSel = m.querySelector('#tx-sales-tax');
    // サービス選択でデフォルト税率を補完
    if (svcSel && taxSel) {
      const applyTax = () => {
        const opt = svcSel.selectedOptions[0];
        if (opt && opt.dataset.tax) taxSel.value = opt.dataset.tax;
      };
      svcSel.addEventListener('change', applyTax);
      applyTax();
    }
    m.querySelector('#tx-sales-cancel').addEventListener('click', () => closeModal('modal-sales'));
    m.querySelector('.tx-modal-backdrop').addEventListener('click', () => closeModal('modal-sales'));
    m.querySelector('#tx-sales-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await submitSalesModal();
    });
  }

  async function submitSalesModal() {
    const m = document.getElementById('modal-sales');
    const fd = new FormData(m.querySelector('#tx-sales-form'));
    const date = String(fd.get('date') || todayStr());
    const amount = parseInt(fd.get('amount') || '0', 10) || 0;
    if (amount <= 0) { alert('税込金額は1円以上で入力してください'); return; }
    const taxRate = parseInt(fd.get('taxRate') || '10', 10);
    const serviceCode = String(fd.get('serviceCode') || '');
    const svc = _txServiceMaster.find(s => s.code === serviceCode);
    const serviceName = svc ? svc.name : '';
    const miscItemName = String(fd.get('miscItemName') || '');
    const uncollected = parseInt(fd.get('uncollected') || '0', 10);
    const memo = String(fd.get('memo') || '');
    const { taxExcluded, tax } = calcTax(amount, taxRate);

    showLoading();
    try {
      const res = await callGAS('addSales', {
        date,
        serviceCode,
        serviceName,
        miscItemName,
        amountExTax: taxExcluded,
        taxRate,
        tax,
        amountInTax: amount,
        memo,
        uncollected
      });
      if (!res || res.status !== 'ok') throw new Error(res && res.message || '登録に失敗しました');
      showToast('売上を登録しました', 'success');
      closeModal('modal-sales');
      await loadAndRender();
    } catch (err) {
      console.error('[pc-transactions] addSales error:', err);
      showToast('登録に失敗しました：' + (err.message || 'unknown'), 'error');
    } finally {
      hideLoading();
    }
  }

  /* ─────────────────────────────────────────
   * コスト追加モーダル（既存スマホ版 cost.js の addCost 呼び出しパターンに準拠）
   * 仕入原価／販管費 切替・科目マスタは PC側 全件表示（smartphoneVisible 無視）
   * ───────────────────────────────────────── */

  function openCostModal() {
    const m = document.getElementById('modal-cost');
    m.innerHTML = `
      <div class="tx-modal-backdrop"></div>
      <div class="tx-modal-panel">
        <h3>コストを追加</h3>
        <form id="tx-cost-form">
          <div class="pc-form-row"><label>日付 <span class="pc-required">*</span></label>
            <input type="date" name="date" value="${todayStr()}" required>
          </div>
          <div class="pc-form-row"><label>区分 <span class="pc-required">*</span></label>
            <select name="divisionCode" id="tx-cost-division">
              <option value="1">仕入原価</option>
              <option value="2" selected>販管費</option>
            </select>
          </div>
          <div class="pc-form-row"><label>科目 <span class="pc-required">*</span></label>
            <select name="itemCode" id="tx-cost-item" required></select>
          </div>
          <div class="pc-form-row"><label>品目名（諸口・任意）</label>
            <input type="text" name="miscItemName" placeholder="任意">
          </div>
          <div class="pc-form-row"><label>税込金額 <span class="pc-required">*</span></label>
            <input type="number" name="amount" min="1" step="1" required>
          </div>
          <div class="pc-form-row"><label>税率</label>
            <select name="taxRate" id="tx-cost-tax">
              <option value="10">10%</option>
              <option value="8">8%</option>
              <option value="0">0%</option>
            </select>
          </div>
          <div class="pc-form-row"><label>未払</label>
            <select name="unpaid">
              <option value="0" selected>消込済</option>
              <option value="1">未払</option>
            </select>
          </div>
          <div class="pc-form-row"><label>メモ</label>
            <input type="text" name="memo">
          </div>
          <div class="pc-modal-actions">
            <button type="button" class="pc-btn pc-btn--ghost" id="tx-cost-cancel">キャンセル</button>
            <button type="submit" class="pc-btn">登録する</button>
          </div>
        </form>
      </div>
    `;
    m.style.display = 'block';
    bindCostModalEvents();
  }

  function bindCostModalEvents() {
    const m = document.getElementById('modal-cost');
    const divSel = m.querySelector('#tx-cost-division');
    const itemSel = m.querySelector('#tx-cost-item');
    const taxSel = m.querySelector('#tx-cost-tax');

    const refreshItems = () => {
      const div = divSel.value;
      const items = _txCostMaster.filter(c => String(c.divisionCode) === String(div) && c.name);
      itemSel.innerHTML = items.map(c =>
        `<option value="${escTx(c.code)}" data-name="${escTx(c.name)}" data-tax="${Number(c.taxRate) || 0}">${escTx(c.code)} ${escTx(c.name)}</option>`
      ).join('');
      applyItemDefaults();
    };
    const applyItemDefaults = () => {
      const opt = itemSel.selectedOptions[0];
      if (opt && opt.dataset.tax) taxSel.value = opt.dataset.tax;
    };
    divSel.addEventListener('change', refreshItems);
    itemSel.addEventListener('change', applyItemDefaults);
    refreshItems();

    m.querySelector('#tx-cost-cancel').addEventListener('click', () => closeModal('modal-cost'));
    m.querySelector('.tx-modal-backdrop').addEventListener('click', () => closeModal('modal-cost'));
    m.querySelector('#tx-cost-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await submitCostModal();
    });
  }

  async function submitCostModal() {
    const m = document.getElementById('modal-cost');
    const fd = new FormData(m.querySelector('#tx-cost-form'));
    const date = String(fd.get('date') || todayStr());
    const divisionCode = String(fd.get('divisionCode') || '2');
    const divisionName = divisionCode === '1' ? '原価' : '販管費';
    const itemCode = String(fd.get('itemCode') || '');
    if (!itemCode) { alert('科目を選択してください'); return; }
    const item = _txCostMaster.find(c => String(c.code) === itemCode);
    const itemName = item ? item.name : '';
    const miscItemName = String(fd.get('miscItemName') || '');
    const amount = parseInt(fd.get('amount') || '0', 10) || 0;
    if (amount <= 0) { alert('税込金額は1円以上で入力してください'); return; }
    const taxRate = parseInt(fd.get('taxRate') || '10', 10);
    const unpaid = parseInt(fd.get('unpaid') || '0', 10);
    const memo = String(fd.get('memo') || '');
    const { taxExcluded, tax } = calcTax(amount, taxRate);

    showLoading();
    try {
      const res = await callGAS('addCost', {
        date,
        divisionCode,
        divisionName,
        itemCode,
        itemName,
        miscItemName,
        taxExcluded,
        taxRate,
        tax,
        taxIncluded: amount,
        memo,
        unpaid,
        clientId: ''
      });
      if (!res || res.status !== 'ok') throw new Error(res && res.message || '登録に失敗しました');
      showToast('コストを登録しました', 'success');
      closeModal('modal-cost');
      await loadAndRender();
    } catch (err) {
      console.error('[pc-transactions] addCost error:', err);
      showToast('登録に失敗しました：' + (err.message || 'unknown'), 'error');
    } finally {
      hideLoading();
    }
  }

  function closeModal(id) {
    const m = document.getElementById(id);
    if (m) {
      m.style.display = 'none';
      m.innerHTML = '';
    }
  }

  function escTx(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
  }

})();
