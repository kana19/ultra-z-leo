/* pc-transactions.js — PC版 取引一覧（取引ペア紐付けモデル・インライン編集）
 * 戦略思想§3-9-3：売上行ID＝親キー、コストV列＝子キー
 * 戦略思想§3-5・3デバイス統合§8-1：PC本格UIはインライン編集（Excelライク・Tab次セル・Enter確定・Esc取消）
 *
 *   - 売上を親、紐付けコストを子として階層表示
 *   - 各セルはクリックで編集モードに切り替わる
 *   - 紐付け候補は対象売上行の前後1ヶ月・集計対象4区分のみ（ポップオーバー UI 維持）
 *   - 紐付けはユーザー明示操作（チェック→「紐付ける」ボタン）
 *   - 会計データ構造は1ミリも動かさない（売上20列・コスト22列・getSummary 不変）
 *   - updateSales / updateCost は部分更新非対応のため、行の現状フィールド全件 + 変更フィールドを送信する
 */
'use strict';

(function() {
  let currentMonth = '';
  let salesNodes = [];           // [{ salesRowId, salesRowIndex, salesDate, salesItem, salesAmount, memo, linkedCosts[], grossProfit, grossProfitRate }]
  let unlinkedCosts = [];        // [{ rowIndex, date, subject, amount, memo }]
  let _txCostMaster = [];        // app.js getCostMaster() 結果（divisionCode 1/2 統合）
  let _txServiceMaster = [];     // settings.serviceList
  let _activeEdit = null;        // { kind:'sales'|'cost'|'sales-new'|'cost-new', rowIndex, field, original, el }
  let _newRowDraft = null;       // 新規行下書き（kind='sales-new'/'cost-new'・rowIndex なし・全セル編集中）

  // 諸口（既存スマホ版と同じ・ハードコード）
  const MISC_SERVICE = { code: 'S099', name: '諸口', taxRate: 10 };

  document.addEventListener('DOMContentLoaded', async () => {
    pcBootstrap('transactions.html', '取引一覧');
    _txCostMaster = (typeof getCostMaster === 'function') ? getCostMaster() : [];
    initMonthSelector();
    bindToolbarEvents();
    // サービスマスタ：localStorage → GAS フォールバック
    if (typeof getServiceList === 'function') {
      try { _txServiceMaster = getServiceList(); } catch (e) { /* noop */ }
    }
    if (!_txServiceMaster || !_txServiceMaster.length) {
      try {
        const sRes = await callGAS('getSettings', {});
        if (sRes && sRes.status === 'ok' && sRes.data && Array.isArray(sRes.data.serviceList)) {
          _txServiceMaster = sRes.data.serviceList;
        }
      } catch (e) { /* offline */ }
    }
    if (!_txServiceMaster || !_txServiceMaster.length) {
      _txServiceMaster = [
        { code: 'S001', name: '店内売上', taxRate: 10 },
        { code: 'S002', name: 'テイクアウト', taxRate: 8 }
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
      const opts = [];
      for (let i = 0; i < 24; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const v = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        opts.push(`<option value="${v}"${v === currentMonth ? ' selected' : ''}>${d.getFullYear()}年${d.getMonth() + 1}月</option>`);
      }
      sel.innerHTML = opts.join('');
    }
  }

  function bindToolbarEvents() {
    document.getElementById('tx-month').addEventListener('change', async (e) => {
      currentMonth = e.target.value;
      await loadAndRender();
    });
    document.getElementById('tx-reload').addEventListener('click', loadAndRender);
    document.getElementById('tx-add-sales-row').addEventListener('click', addNewSalesRow);
    document.getElementById('tx-add-cost-row').addEventListener('click', addNewCostRow);
    // ポップオーバー外側クリックで閉じる
    document.addEventListener('click', (e) => {
      const popover = document.getElementById('link-popover');
      if (!popover || popover.style.display !== 'block') return;
      if (popover.contains(e.target)) return;
      if (e.target.classList && e.target.classList.contains('btn-link')) return;
      popover.style.display = 'none';
    });
  }

  /* ─────────────────────────────────────────
   * データ取得・描画
   * ───────────────────────────────────────── */

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
      _newRowDraft = null;
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
    const draftHtml = (_newRowDraft && _newRowDraft.kind === 'sales-new')
      ? renderNewSalesRow(_newRowDraft) : '';
    if (!salesNodes.length && !draftHtml) {
      root.innerHTML = '<div class="tx-empty">対象月の売上はありません</div>';
      return;
    }
    root.innerHTML = draftHtml + salesNodes.map(renderSalesNode).join('');
    bindHierarchyEvents();
    if (_newRowDraft && _newRowDraft.kind === 'sales-new') focusFirstEditable('sales-new');
  }

  function renderSalesNode(sales) {
    const linkedCount = (sales.linkedCosts || []).length;
    const profitText = linkedCount > 0
      ? `粗利 ${formatYen(sales.grossProfit)}（${(sales.grossProfitRate * 100).toFixed(0)}%）`
      : '粗利 — （未紐付け）';
    const profitClass = linkedCount > 0 ? 'has-profit' : 'no-profit';
    const ri = sales.salesRowIndex;

    const childRows = (sales.linkedCosts || []).map(c => {
      const fullCost = findCostFull(c.rowIndex);
      return renderEditableCostRow(c, fullCost, /*isChild*/ true);
    }).join('');

    return `
      <div class="tx-sales-node ${profitClass}" data-sales-row-id="${escTx(sales.salesRowId)}" data-sales-row="${ri}">
        <div class="tx-parent-row" data-row-kind="sales" data-row-index="${ri}">
          <span class="tx-tree-marker">■</span>
          <span class="tx-cell" data-field="date" data-cell-type="date">${escTx(sales.salesDate)}</span>
          <span class="tx-cell" data-field="serviceCode" data-cell-type="service" data-display="売上：${escTx(sales.salesItem)}">売上：${escTx(sales.salesItem)}</span>
          <span class="tx-cell tx-amount" data-field="amount" data-cell-type="amount">${formatYen(sales.salesAmount)}</span>
          <span class="tx-cell" data-field="memo" data-cell-type="text">${escTx(sales.memo || '')}</span>
          <span class="tx-profit">${profitText}</span>
          <button class="pc-btn pc-btn--sm btn-link" data-sales-row-id="${escTx(sales.salesRowId)}">＋ 経費を紐付け</button>
        </div>
        <div class="tx-children">${childRows}</div>
      </div>
    `;
  }

  function renderEditableCostRow(c, fullCost, isChild) {
    const ri = c.rowIndex;
    const subjectDisplay = c.subject || (fullCost ? fullCost.subject : '');
    const amount = (typeof c.amount === 'number') ? c.amount : (fullCost ? fullCost.amount : 0);
    const memoVal = (fullCost && typeof fullCost.memo === 'string') ? fullCost.memo : '';
    return `
      <div class="tx-child-row" data-row-kind="cost" data-row-index="${ri}">
        <span class="tx-tree-marker">${isChild ? '└' : ''}</span>
        <span class="tx-cell" data-field="date" data-cell-type="date">${escTx(c.date)}</span>
        <span class="tx-cell" data-field="itemCode" data-cell-type="cost-item" data-display="${escTx(subjectDisplay)}">${escTx(subjectDisplay)}</span>
        <span class="tx-cell tx-amount" data-field="amount" data-cell-type="amount">${formatYen(amount)}</span>
        <span class="tx-cell" data-field="memo" data-cell-type="text">${escTx(memoVal)}</span>
        ${isChild ? `<button class="pc-btn pc-btn--sm btn-unlink" data-cost-row="${ri}">紐付け解除</button>` : ''}
      </div>
    `;
  }

  function renderUnlinkedCosts() {
    const root = document.getElementById('tx-unlinked-costs');
    const draftHtml = (_newRowDraft && _newRowDraft.kind === 'cost-new')
      ? renderNewCostRow(_newRowDraft) : '';
    if (!unlinkedCosts.length && !draftHtml) {
      root.innerHTML = '<div class="tx-empty-small">未紐付けの集計対象4区分コストはありません</div>';
      return;
    }
    root.innerHTML = draftHtml + unlinkedCosts.map(c => {
      return renderEditableCostRow(c, c, /*isChild*/ false);
    }).join('');
    bindUnlinkedEvents();
    if (_newRowDraft && _newRowDraft.kind === 'cost-new') focusFirstEditable('cost-new');
  }

  /* hierarchy 配下の linkedCosts は { rowIndex, date, subject, amount } のみ（memo を含まず）
   * インライン編集時の「現状フィールド合成」用に full row を hierarchy 走査でも探す */
  function findCostFull(rowIndex) {
    for (const c of unlinkedCosts) {
      if (c.rowIndex === rowIndex) return c;
    }
    for (const s of salesNodes) {
      for (const lc of (s.linkedCosts || [])) {
        if (lc.rowIndex === rowIndex) return lc;
      }
    }
    return null;
  }

  /* ─────────────────────────────────────────
   * 新規行ドラフト（売上・コスト）
   * ───────────────────────────────────────── */

  function addNewSalesRow() {
    if (_newRowDraft) {
      showToast('編集中の新規行があります。先に確定または取消してください', 'info');
      return;
    }
    const today = todayStr();
    const firstSvc = (_txServiceMaster && _txServiceMaster.length) ? _txServiceMaster[0] : MISC_SERVICE;
    _newRowDraft = {
      kind: 'sales-new',
      date: today,
      serviceCode: firstSvc.code,
      serviceName: firstSvc.name,
      miscItemName: '',
      amount: 0,
      taxRate: Number(firstSvc.taxRate) || 10,
      memo: '',
      uncollected: 0
    };
    renderHierarchy();
  }

  function addNewCostRow() {
    if (_newRowDraft) {
      showToast('編集中の新規行があります。先に確定または取消してください', 'info');
      return;
    }
    const linkableMaster = _txCostMaster.filter(c => c.name && (
      String(c.divisionCode) === '1' ||
      String(c.code) === '20' ||
      String(c.code) === '21' ||
      String(c.code) === '25'
    ));
    const firstItem = linkableMaster[0] || _txCostMaster.find(c => c.name) || { code: '', name: '', divisionCode: '2', taxRate: 10 };
    _newRowDraft = {
      kind: 'cost-new',
      date: todayStr(),
      divisionCode: String(firstItem.divisionCode || '2'),
      divisionName: String(firstItem.divisionCode) === '1' ? '原価' : '販管費',
      itemCode: String(firstItem.code || ''),
      itemName: String(firstItem.name || ''),
      miscItemName: '',
      amount: 0,
      taxRate: Number(firstItem.taxRate) || 10,
      memo: '',
      unpaid: 0
    };
    renderUnlinkedCosts();
  }

  function renderNewSalesRow(d) {
    const submitDisabled = Number(d.amount) > 0 ? '' : 'disabled';
    return `
      <div class="tx-sales-node tx-row-new" data-row-kind="sales-new" data-draft-type="sales">
        <div class="tx-parent-row" data-row-kind="sales-new">
          <span class="tx-tree-marker">●</span>
          <span class="tx-cell" data-field="date" data-cell-type="date">${escTx(d.date)}</span>
          <span class="tx-cell" data-field="serviceCode" data-cell-type="service" data-display="売上：${escTx(d.serviceName)}">売上：${escTx(d.serviceName)}</span>
          <span class="tx-cell tx-amount" data-field="amount" data-cell-type="amount">${formatYen(d.amount)}</span>
          <span class="tx-cell" data-field="memo" data-cell-type="text">${escTx(d.memo || '')}</span>
          <span class="tx-profit">税率 ${d.taxRate}%</span>
          <div class="tx-row-actions">
            <button class="btn-draft-submit" type="button" ${submitDisabled}>登録</button>
            <button class="btn-draft-cancel" type="button">取消</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderNewCostRow(d) {
    const subjectDisplay = `[${d.divisionCode === '1' ? '仕入原価' : '販管費'}] ${d.itemCode} ${d.itemName}`;
    const submitDisabled = Number(d.amount) > 0 ? '' : 'disabled';
    return `
      <div class="tx-unlinked-row tx-row-new" data-row-kind="cost-new" data-draft-type="cost">
        <span class="tx-cell" data-field="date" data-cell-type="date">${escTx(d.date)}</span>
        <span class="tx-cell" data-field="itemCode" data-cell-type="cost-item" data-display="${escTx(subjectDisplay)}">${escTx(subjectDisplay)}</span>
        <span class="tx-cell tx-amount" data-field="amount" data-cell-type="amount">${formatYen(d.amount)}</span>
        <span class="tx-cell" data-field="memo" data-cell-type="text">${escTx(d.memo || '')}</span>
        <div class="tx-row-actions">
          <button class="btn-draft-submit" type="button" ${submitDisabled}>登録</button>
          <button class="btn-draft-cancel" type="button">取消</button>
        </div>
      </div>
    `;
  }

  function focusFirstEditable(kind) {
    const sel = (kind === 'sales-new') ? '[data-row-kind="sales-new"]' : '[data-row-kind="cost-new"]';
    const root = document.querySelector(sel);
    if (!root) return;
    const cell = root.querySelector('.tx-cell[data-field="amount"]');
    if (cell) startEdit(cell);
  }

  /* ─────────────────────────────────────────
   * インライン編集
   * ───────────────────────────────────────── */

  function bindHierarchyEvents() {
    // セルクリック → 編集開始
    document.querySelectorAll('#tx-hierarchy .tx-cell').forEach(cell => {
      cell.addEventListener('click', () => startEdit(cell));
    });
    // 紐付けボタン
    document.querySelectorAll('#tx-hierarchy .btn-link').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (_activeEdit) commitEdit(true);
        const salesRowId = btn.dataset.salesRowId;
        await openLinkPopover(btn, salesRowId);
      });
    });
    // 紐付け解除ボタン
    document.querySelectorAll('#tx-hierarchy .btn-unlink').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const costRow = parseInt(btn.dataset.costRow, 10);
        if (!confirm('この経費の紐付けを解除しますか？')) return;
        await unlinkCost(costRow);
      });
    });
    // 新規行 登録ボタン（明示確定）
    document.querySelectorAll('#tx-hierarchy .btn-draft-submit').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await handleDraftSubmit();
      });
    });
    // 新規行 取消ボタン
    document.querySelectorAll('#tx-hierarchy .btn-draft-cancel').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        cancelNewRow();
      });
    });
  }

  function bindUnlinkedEvents() {
    document.querySelectorAll('#tx-unlinked-costs .tx-cell').forEach(cell => {
      cell.addEventListener('click', () => startEdit(cell));
    });
    document.querySelectorAll('#tx-unlinked-costs .btn-draft-submit').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await handleDraftSubmit();
      });
    });
    document.querySelectorAll('#tx-unlinked-costs .btn-draft-cancel').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        cancelNewRow();
      });
    });
  }

  function startEdit(cell) {
    if (_activeEdit && _activeEdit.el === cell) return;
    if (_activeEdit) commitEdit(true);
    const rowEl = cell.closest('[data-row-kind]');
    if (!rowEl) return;
    const kind = rowEl.dataset.rowKind;
    const rowIndex = parseInt(rowEl.dataset.rowIndex || '0', 10);
    const field = cell.dataset.field;
    const cellType = cell.dataset.cellType;

    const ctx = currentRowContext(kind, rowIndex);
    if (!ctx) return;

    const inputHtml = buildEditorHtml(cellType, field, ctx);
    const original = (cell.dataset.display !== undefined) ? cell.dataset.display : cell.textContent;
    cell.classList.add('is-editing');
    cell.innerHTML = inputHtml;

    const inputEl = cell.querySelector('input,select');
    if (!inputEl) return;
    if (inputEl.tagName === 'INPUT' && (inputEl.type === 'number' || inputEl.type === 'text')) {
      try { inputEl.select(); } catch (e) { /* noop */ }
    }
    inputEl.focus();

    _activeEdit = { kind, rowIndex, field, original, el: cell, inputEl };

    inputEl.addEventListener('keydown', onEditKeydown);
    inputEl.addEventListener('blur', onEditBlur);
  }

  function buildEditorHtml(cellType, field, ctx) {
    if (cellType === 'date') {
      const v = ctx.date || todayStr();
      return `<input type="date" value="${escTx(v)}">`;
    }
    if (cellType === 'amount') {
      const v = Number(ctx.amount || 0);
      return `<input type="number" min="0" step="1" value="${v}">`;
    }
    if (cellType === 'text') {
      const v = ctx[field] || '';
      return `<input type="text" value="${escTx(v)}">`;
    }
    if (cellType === 'service') {
      const cur = ctx.serviceCode || '';
      const opts = _txServiceMaster.map(s =>
        `<option value="${escTx(s.code)}" data-name="${escTx(s.name)}" data-tax="${Number(s.taxRate) || 0}"${s.code === cur ? ' selected' : ''}>${escTx(s.name)}（${Number(s.taxRate) || 0}%）</option>`
      ).join('');
      const miscSel = cur === MISC_SERVICE.code ? ' selected' : '';
      return `<select>
        ${opts}
        <option value="${MISC_SERVICE.code}" data-name="${MISC_SERVICE.name}" data-tax="${MISC_SERVICE.taxRate}"${miscSel}>${MISC_SERVICE.name}（${MISC_SERVICE.taxRate}%）</option>
      </select>`;
    }
    if (cellType === 'cost-item') {
      const cur = ctx.itemCode || '';
      // 全科目表示（PC版は smartphoneVisible 無視・3デバイス統合§12）。
      // 経費区分プレフィックス [仕入原価]/[販管費] を付与して 1セレクトに統合
      const opts = _txCostMaster
        .filter(c => c.name)
        .map(c => {
          const prefix = String(c.divisionCode) === '1' ? '[仕入原価]' : '[販管費]';
          return `<option value="${escTx(c.code)}" data-name="${escTx(c.name)}" data-tax="${Number(c.taxRate) || 0}" data-division="${escTx(c.divisionCode)}"${c.code === cur ? ' selected' : ''}>${prefix} ${escTx(c.code)} ${escTx(c.name)}</option>`;
        }).join('');
      return `<select>${opts}</select>`;
    }
    return `<input type="text" value="">`;
  }

  /**
   * 行の現状コンテキストを返す（updateSales/updateCost 部分更新非対応のため全フィールド合成に使う）
   * kind: 'sales' | 'cost' | 'sales-new' | 'cost-new'
   */
  function currentRowContext(kind, rowIndex) {
    if (kind === 'sales-new' || kind === 'cost-new') {
      return _newRowDraft || null;
    }
    if (kind === 'sales') {
      const sales = salesNodes.find(s => s.salesRowIndex === rowIndex);
      if (!sales) return null;
      // hierarchy には serviceCode が含まれないため、salesItem からは復元できない
      // 編集時は GAS getSettings の serviceList で逆引きする（serviceName 一致）
      const svc = _txServiceMaster.find(s => s.name === sales.salesItem) || MISC_SERVICE;
      return {
        rowIndex: sales.salesRowIndex,
        date: sales.salesDate,
        serviceCode: svc.code,
        serviceName: svc.name,
        miscItemName: '',
        amount: Number(sales.salesAmount || 0),
        taxRate: Number(svc.taxRate) || 10,
        memo: sales.memo || '',
        uncollected: 0
      };
    }
    if (kind === 'cost') {
      const c = findCostFull(rowIndex);
      if (!c) return null;
      // hierarchy linkedCosts は { rowIndex, date, subject, amount }（memo なし）
      // unlinkedCosts は memo 付き。両方共通で引ける形に正規化
      const item = _txCostMaster.find(m => m.name === c.subject) ||
                   _txCostMaster.find(m => String(m.code) === String(c.subject));
      const itemCode = item ? String(item.code) : '';
      const divisionCode = item ? String(item.divisionCode || '2') : '2';
      const taxRate = item ? Number(item.taxRate || 10) : 10;
      return {
        rowIndex: c.rowIndex,
        date: c.date,
        divisionCode,
        divisionName: divisionCode === '1' ? '原価' : '販管費',
        itemCode,
        itemName: item ? item.name : c.subject,
        miscItemName: '',
        amount: Number(c.amount || 0),
        taxRate,
        memo: c.memo || '',
        unpaid: 0
      };
    }
    return null;
  }

  function onEditKeydown(e) {
    const isDraft = _activeEdit && (_activeEdit.kind === 'sales-new' || _activeEdit.kind === 'cost-new');
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isDraft) {
        // draft 行：Enter は「登録」ボタン同等動作（金額0なら commit のみで何も起きない）
        Promise.resolve(commitEdit(true)).then(() => {
          if (_newRowDraft && Number(_newRowDraft.amount) > 0) submitNewRowDraft();
        });
      } else {
        commitEdit(false);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (isDraft) {
        // draft 行：Esc は「取消」ボタン同等動作（行ごと破棄）
        cancelNewRow();
      } else {
        cancelEdit();
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const dir = e.shiftKey ? -1 : 1;
      Promise.resolve(commitEdit(false)).then(() => moveCellFocus(dir));
    }
  }

  function onEditBlur() {
    // blur 直後に Tab キーで別セル開始の場合があるため少し遅延（_activeEdit が次セルに既に切り替わっていれば既存処理を信頼）
    setTimeout(() => {
      if (_activeEdit && _activeEdit.inputEl && !document.body.contains(_activeEdit.inputEl)) return;
      if (_activeEdit) commitEdit(false);
    }, 30);
  }

  /**
   * 編集を確定する。値変更があれば GAS に書き込む。
   * silent=true は呼び出し側都合（次の編集に切り替えたい等）でトーストを出さないモード
   */
  async function commitEdit(silent) {
    if (!_activeEdit) return;
    const a = _activeEdit;
    _activeEdit = null;
    if (!a.inputEl) return;

    const newRaw = a.inputEl.value;
    const cell = a.el;
    cell.classList.remove('is-editing');

    // 新規ドラフト行：値を draft に反映し、当該セルの表示と「登録」ボタン disabled 状態だけ更新する。
    // 全体再描画はしない（フォーカス維持のため）。明示「登録」ボタンが押されるまで送信しない。
    if (a.kind === 'sales-new' || a.kind === 'cost-new') {
      applyDraftEdit(a.field, a.inputEl);
      if (_newRowDraft) {
        updateDraftCellDisplay(cell, a.field);
        updateDraftSubmitState();
      }
      return;
    }

    // 既存行のセル編集確定
    const ctx = currentRowContext(a.kind, a.rowIndex);
    if (!ctx) {
      cell.textContent = a.original;
      return;
    }
    let normalized = newRaw;
    if (cell.dataset.cellType === 'amount') normalized = String(Number(newRaw) || 0);
    if (a.field === 'serviceCode') {
      const opt = a.inputEl.selectedOptions && a.inputEl.selectedOptions[0];
      if (opt) {
        ctx.serviceCode = opt.value;
        ctx.serviceName = opt.dataset.name || '';
        ctx.taxRate = Number(opt.dataset.tax) || 10;
      }
    } else if (a.field === 'itemCode') {
      const opt = a.inputEl.selectedOptions && a.inputEl.selectedOptions[0];
      if (opt) {
        ctx.itemCode = opt.value;
        ctx.itemName = opt.dataset.name || '';
        ctx.divisionCode = opt.dataset.division || '2';
        ctx.divisionName = ctx.divisionCode === '1' ? '原価' : '販管費';
        ctx.taxRate = Number(opt.dataset.tax) || 10;
      }
    } else if (a.field === 'amount') {
      ctx.amount = Number(normalized) || 0;
    } else {
      ctx[a.field] = newRaw;
    }
    // 元の表示値と比較して変更があれば送信
    const oldDisplay = String(a.original || '').trim();
    const newDisplay = composeCellDisplay(a.kind, a.field, ctx);
    if (oldDisplay === newDisplay) {
      // 変更なし → 表示復元
      cell.textContent = a.original;
      return;
    }

    showLoading();
    try {
      const res = (a.kind === 'sales')
        ? await callGAS('updateSales', buildSalesPayload(ctx))
        : await callGAS('updateCost', buildCostPayload(ctx));
      if (!res || res.status !== 'ok') throw new Error(res && res.message || '更新失敗');
      if (!silent) showToast('更新しました', 'success');
      await loadAndRender();
    } catch (err) {
      console.error('[pc-transactions] commitEdit error:', err);
      showToast('更新に失敗しました：' + (err.message || 'unknown'), 'error');
      cell.textContent = a.original;
    } finally {
      hideLoading();
    }
  }

  function cancelEdit() {
    if (!_activeEdit) return;
    const a = _activeEdit;
    _activeEdit = null;
    a.el.classList.remove('is-editing');
    a.el.textContent = a.original;
  }

  /**
   * Tab/Shift+Tab：行内の次/前のセルへ移動
   */
  function moveCellFocus(dir) {
    const lastEdited = document.querySelector('.tx-cell.is-editing');
    if (lastEdited) return; // commitEdit が動いて新しい編集中になっていれば何もしない
    const allCells = Array.from(document.querySelectorAll('.tx-cell'));
    if (!allCells.length) return;
    // 直前の編集セルが既に textContent に戻っているため、フォーカスは確定値の隣セルから推定
    // シンプル化：何もしない（ユーザーは次セルをクリックで開始）
  }

  function composeCellDisplay(kind, field, ctx) {
    if (field === 'date') return String(ctx.date || '').trim();
    if (field === 'amount') return formatYen(Number(ctx.amount || 0)).trim();
    if (field === 'memo') return String(ctx.memo || '').trim();
    if (field === 'serviceCode') return ('売上：' + (ctx.serviceName || '')).trim();
    if (field === 'itemCode') return (ctx.itemName || '').trim();
    return String(ctx[field] || '').trim();
  }

  function buildSalesPayload(ctx) {
    const amount = Number(ctx.amount || 0);
    const taxRate = Number(ctx.taxRate || 10);
    const { taxExcluded, tax } = (typeof calcTax === 'function')
      ? calcTax(amount, taxRate)
      : { taxExcluded: amount, tax: 0 };
    return {
      rowIndex: ctx.rowIndex,
      date: ctx.date,
      serviceCode: ctx.serviceCode || '',
      serviceName: ctx.serviceName || '',
      miscItemName: ctx.miscItemName || '',
      amountExTax: taxExcluded,
      taxRate,
      tax,
      amountInTax: amount,
      memo: ctx.memo || '',
      uncollected: Number(ctx.uncollected || 0)
    };
  }

  function buildCostPayload(ctx) {
    const amount = Number(ctx.amount || 0);
    const taxRate = Number(ctx.taxRate || 10);
    const { taxExcluded, tax } = (typeof calcTax === 'function')
      ? calcTax(amount, taxRate)
      : { taxExcluded: amount, tax: 0 };
    return {
      rowIndex: ctx.rowIndex,
      date: ctx.date,
      divisionCode: ctx.divisionCode || '2',
      divisionName: ctx.divisionName || (ctx.divisionCode === '1' ? '原価' : '販管費'),
      itemCode: ctx.itemCode || '',
      itemName: ctx.itemName || '',
      miscItemName: ctx.miscItemName || '',
      taxExcluded,
      taxRate,
      tax,
      taxIncluded: amount,
      memo: ctx.memo || '',
      unpaid: Number(ctx.unpaid || 0)
    };
  }

  function applyDraftEdit(field, inputEl) {
    if (!_newRowDraft) return false;
    const before = _newRowDraft[field];
    if (field === 'serviceCode') {
      const opt = inputEl.selectedOptions && inputEl.selectedOptions[0];
      if (opt) {
        _newRowDraft.serviceCode = opt.value;
        _newRowDraft.serviceName = opt.dataset.name || '';
        _newRowDraft.taxRate = Number(opt.dataset.tax) || 10;
      }
    } else if (field === 'itemCode') {
      const opt = inputEl.selectedOptions && inputEl.selectedOptions[0];
      if (opt) {
        _newRowDraft.itemCode = opt.value;
        _newRowDraft.itemName = opt.dataset.name || '';
        _newRowDraft.divisionCode = opt.dataset.division || '2';
        _newRowDraft.divisionName = _newRowDraft.divisionCode === '1' ? '原価' : '販管費';
        _newRowDraft.taxRate = Number(opt.dataset.tax) || 10;
      }
    } else if (field === 'amount') {
      _newRowDraft.amount = Number(inputEl.value) || 0;
    } else {
      _newRowDraft[field] = inputEl.value;
    }
    return before !== _newRowDraft[field];
  }

  /**
   * draft セルの表示を更新する（全体再描画せずフォーカスを維持するため）
   */
  function updateDraftCellDisplay(cell, field) {
    if (!_newRowDraft) return;
    const d = _newRowDraft;
    if (field === 'date') {
      cell.textContent = d.date || '';
    } else if (field === 'amount') {
      cell.textContent = formatYen(Number(d.amount) || 0);
    } else if (field === 'memo') {
      cell.textContent = d.memo || '';
    } else if (field === 'serviceCode') {
      const display = '売上：' + (d.serviceName || '');
      cell.textContent = display;
      cell.dataset.display = display;
      const profit = cell.parentElement && cell.parentElement.querySelector('.tx-profit');
      if (profit) profit.textContent = '税率 ' + (Number(d.taxRate) || 10) + '%';
    } else if (field === 'itemCode') {
      const display = `[${d.divisionCode === '1' ? '仕入原価' : '販管費'}] ${d.itemCode} ${d.itemName}`;
      cell.textContent = display;
      cell.dataset.display = display;
    }
  }

  /**
   * draft 行の「登録」ボタン disabled 状態を amount に応じて更新する
   */
  function updateDraftSubmitState() {
    if (!_newRowDraft) return;
    const sectionSel = (_newRowDraft.kind === 'sales-new') ? '#tx-hierarchy' : '#tx-unlinked-costs';
    const btn = document.querySelector(sectionSel + ' .btn-draft-submit');
    if (!btn) return;
    btn.disabled = !(Number(_newRowDraft.amount) > 0);
  }

  /**
   * 「登録」ボタンクリック時：編集中セルがあれば先に commit してから submit する
   */
  async function handleDraftSubmit() {
    if (_activeEdit) await commitEdit(true);
    if (!_newRowDraft) return;
    if (!(Number(_newRowDraft.amount) > 0)) return;
    await submitNewRowDraft();
  }

  async function submitNewRowDraft() {
    if (!_newRowDraft) return;
    const d = _newRowDraft;
    showLoading();
    try {
      let res;
      if (d.kind === 'sales-new') {
        const { taxExcluded, tax } = (typeof calcTax === 'function')
          ? calcTax(d.amount, d.taxRate)
          : { taxExcluded: d.amount, tax: 0 };
        res = await callGAS('addSales', {
          date: d.date,
          serviceCode: d.serviceCode,
          serviceName: d.serviceName,
          miscItemName: d.miscItemName || '',
          amountExTax: taxExcluded,
          taxRate: d.taxRate,
          tax,
          amountInTax: d.amount,
          memo: d.memo || '',
          uncollected: Number(d.uncollected || 0)
        });
      } else {
        const { taxExcluded, tax } = (typeof calcTax === 'function')
          ? calcTax(d.amount, d.taxRate)
          : { taxExcluded: d.amount, tax: 0 };
        res = await callGAS('addCost', {
          date: d.date,
          divisionCode: d.divisionCode,
          divisionName: d.divisionName,
          itemCode: d.itemCode,
          itemName: d.itemName,
          miscItemName: d.miscItemName || '',
          taxExcluded,
          taxRate: d.taxRate,
          tax,
          taxIncluded: d.amount,
          memo: d.memo || '',
          unpaid: Number(d.unpaid || 0),
          clientId: ''
        });
      }
      if (!res || res.status !== 'ok') throw new Error(res && res.message || '登録失敗');
      _newRowDraft = null;
      showToast(d.kind === 'sales-new' ? '売上を登録しました' : 'コストを登録しました', 'success');
      await loadAndRender();
    } catch (err) {
      console.error('[pc-transactions] submitNewRowDraft error:', err);
      showToast('登録に失敗しました：' + (err.message || 'unknown'), 'error');
    } finally {
      hideLoading();
    }
  }

  function cancelNewRow() {
    _newRowDraft = null;
    if (_activeEdit) {
      _activeEdit.el.classList.remove('is-editing');
      _activeEdit = null;
    }
    renderHierarchy();
    renderUnlinkedCosts();
  }

  /* ─────────────────────────────────────────
   * 紐付けポップオーバー（性質上テーブルインラインでは表現できないため UI 維持）
   * ───────────────────────────────────────── */

  async function openLinkPopover(anchorBtn, salesRowId) {
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
    });
    const applyBtn = document.getElementById('popover-apply');
    if (applyBtn) {
      applyBtn.addEventListener('click', async () => {
        const checkedRows = Array.from(popover.querySelectorAll('input[type=checkbox]:checked'))
          .map(cb => parseInt(cb.value, 10));
        const toUnlink = candidates
          .filter(c => c.currentlyLinked && checkedRows.indexOf(c.rowIndex) === -1)
          .map(c => c.rowIndex);
        const currentlyLinkedSet = {};
        candidates.forEach(c => { if (c.currentlyLinked) currentlyLinkedSet[c.rowIndex] = true; });
        const toLink = checkedRows.filter(r => !currentlyLinkedSet[r]);
        await applyLinkChanges(salesRowId, toLink, toUnlink);
        popover.style.display = 'none';
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
        const res = await callGAS('linkTransactions', { rowIndex, salesRowId });
        if (!res || res.status !== 'ok') throw new Error(res && res.message || 'link failed');
      }
      for (const rowIndex of toUnlink) {
        const res = await callGAS('linkTransactions', { rowIndex, salesRowId: '' });
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
      const res = await callGAS('linkTransactions', { rowIndex, salesRowId: '' });
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
   * ユーティリティ
   * ───────────────────────────────────────── */
  function escTx(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
  }

})();
