/* pc-transactions.js — PC版 取引一覧（売上・仕入原価・販管費 統合UI）
 * 戦略思想§3-9-3 経営判断UX大原則：
 *   経営者が一画面で過去取引を見渡し・案件紐付け・粗利確認できる主要作業画面。
 *   売上タブ／仕入原価タブ／案件粗利タブ／販管費入力画面 を本画面に統合。
 */
'use strict';

/* =====================
 * 状態
 * ===================== */

let txAllRows = [];           // getHistory の全件（売上・コスト）
let txProjects = [];          // active 案件のみ（紐付けドロップダウン用）
let txAllProjects = [];       // 全案件（フィルタ案件選択肢用）
let txCostMaster = [];        // 全件（divisionCode='1'/'2' 含む）
let txSelectedKeys = new Set(); // "sheetName:rowIndex"

/**
 * 案件粗利機能の表示判定（堅牢化版）：
 *   1. js/app.js の getFeatureVisibility() があれば優先
 *   2. localStorage の templateId フォールバック
 *   3. 何も読めない場合は false
 */
function _txShouldShowProject() {
  if (typeof getFeatureVisibility === 'function') {
    try {
      const fv = getFeatureVisibility();
      return !!(fv && fv.project_grossprofit === true);
    } catch (e) { /* fallthrough */ }
  }
  try {
    const tid = localStorage.getItem('uz_template_id');
    return tid === 'non-shop' || tid === 'custom';
  } catch (e) {
    return false;
  }
}

/**
 * 行が案件紐付けの対象か判定（§3-9-3 経営判断としての貢献利益）
 *  - 売上行：すべて対象
 *  - コスト行：divisionCode='1' / itemCode='20'/'21'/'25' のみ
 */
function _txIsLinkTarget(row) {
  if (!row) return false;
  if (row.type === 'sales') return true;
  if (row.type !== 'cost') return false;
  if (String(row.divisionCode) === '1') return true;
  return ['20', '21', '25'].indexOf(String(row.itemCode)) !== -1;
}

/* =====================
 * 初期化
 * ===================== */

document.addEventListener('DOMContentLoaded', async () => {
  pcBootstrap('transactions.html', '取引一覧');
  txCostMaster = (typeof getCostMaster === 'function') ? getCostMaster() : [];

  // 月フィルタ初期値
  const monthInput = document.getElementById('pc-tx-filter-month');
  monthInput.value = new Date().toISOString().slice(0, 7);

  // 業態別の機能表示制御
  _applyProjectFeatureVisibility();
  document.addEventListener('uz:settings-synced', _applyProjectFeatureVisibility);

  // フィルタ＆ボタンイベント
  document.getElementById('pc-tx-filter-type').addEventListener('change', render);
  document.getElementById('pc-tx-filter-month').addEventListener('change', loadAll);
  document.getElementById('pc-tx-filter-project').addEventListener('change', render);
  document.getElementById('pc-tx-filter-status').addEventListener('change', render);
  document.getElementById('pc-tx-add-btn').addEventListener('click', openNewTxModal);
  document.getElementById('pc-tx-reload-btn').addEventListener('click', loadAll);
  document.getElementById('pc-tx-project-master-btn').addEventListener('click', openProjectMasterModal);
  document.getElementById('pc-tx-bulk-apply').addEventListener('click', applyBulkLink);
  document.getElementById('pc-tx-bulk-project').addEventListener('change', () => {
    const v = document.getElementById('pc-tx-bulk-project').value;
    document.getElementById('pc-tx-bulk-apply').disabled = !v || txSelectedKeys.size === 0;
  });

  await loadAll();
});

function _applyProjectFeatureVisibility() {
  const show = _txShouldShowProject();
  const projectFilter = document.querySelector('.pc-tx-filter-project');
  const masterBtn = document.getElementById('pc-tx-project-master-btn');
  const grossSection = document.getElementById('pc-tx-grossprofit-section');
  if (projectFilter) projectFilter.style.display = show ? '' : 'none';
  if (masterBtn) masterBtn.style.display = show ? '' : 'none';
  if (grossSection && !show) grossSection.style.display = 'none';
}

/* =====================
 * データ取得
 * ===================== */

async function loadAll() {
  const tbody = document.getElementById('pc-tx-tbody');
  tbody.innerHTML = `<tr><td colspan="10" class="pc-loading">読み込み中...</td></tr>`;

  const month = document.getElementById('pc-tx-filter-month').value;
  let historyRes, projectsRes;
  try {
    [historyRes, projectsRes] = await Promise.all([
      callGAS('getHistory', month ? { month } : {}),
      callGAS('getProjects', {})
    ]);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="10" class="pc-error">通信エラー：${escTx(e.message || 'unknown')}</td></tr>`;
    return;
  }

  if (!historyRes || historyRes.status !== 'ok') {
    tbody.innerHTML = `<tr><td colspan="10" class="pc-error">取引取得失敗：${escTx(historyRes && historyRes.message || '不明なエラー')}</td></tr>`;
    return;
  }
  txAllRows = (historyRes.data || []).filter(r => r && (r.type === 'sales' || r.type === 'cost'));

  if (projectsRes && projectsRes.status === 'ok') {
    txAllProjects = projectsRes.data || [];
    txProjects = txAllProjects.filter(p => (p.status || 'active') === 'active');
  } else {
    txAllProjects = [];
    txProjects = [];
  }
  txSelectedKeys.clear();

  populateProjectFilterOptions();
  populateBulkProjectSelect();
  render();
}

function populateProjectFilterOptions() {
  const sel = document.getElementById('pc-tx-filter-project');
  if (!sel) return;
  const cur = sel.value;
  const opts = [
    `<option value="all">全て</option>`,
    `<option value="unlinked">未紐付け</option>`
  ];
  txProjects.forEach(p => {
    const label = p.customerName ? `${p.projectName} (${p.customerName})` : p.projectName;
    opts.push(`<option value="${escTx(p.projectId)}">${escTx(label)}</option>`);
  });
  sel.innerHTML = opts.join('');
  // フィルタ値を維持（選択肢に存在しない場合は all に戻す）
  if (cur && Array.from(sel.options).some(o => o.value === cur)) {
    sel.value = cur;
  } else {
    sel.value = 'all';
  }
}

function populateBulkProjectSelect() {
  const sel = document.getElementById('pc-tx-bulk-project');
  if (!sel) return;
  const opts = [
    `<option value="">案件を選択...</option>`,
    `<option value="__unlink__">— 紐付け解除 —</option>`
  ];
  txProjects.forEach(p => {
    const label = p.customerName ? `${p.projectName} (${p.customerName})` : p.projectName;
    opts.push(`<option value="${escTx(p.projectId)}">${escTx(label)}</option>`);
  });
  sel.innerHTML = opts.join('');
}

/* =====================
 * 描画
 * ===================== */

function render() {
  const showProjectCol = _txShouldShowProject();
  const thead = document.getElementById('pc-tx-thead');
  const tbody = document.getElementById('pc-tx-tbody');

  // ヘッダ
  const checkboxTh = showProjectCol
    ? `<th class="pc-tx-row-checkbox"><input type="checkbox" id="pc-tx-check-all"></th>`
    : '';
  const linkTh = showProjectCol ? `<th>案件紐付け</th>` : '';
  thead.innerHTML = `<tr>
    ${checkboxTh}
    <th style="width:96px;">日付</th>
    <th style="width:80px;">種別</th>
    <th>科目</th>
    <th>品目</th>
    <th class="num" style="width:110px;">税込金額</th>
    <th style="width:60px;">税率</th>
    <th style="width:60px;">状態</th>
    ${linkTh}
    <th style="width:90px;">操作</th>
  </tr>`;

  // フィルタ適用
  const fType = document.getElementById('pc-tx-filter-type').value;
  const fProject = document.getElementById('pc-tx-filter-project').value;
  const fStatus = document.getElementById('pc-tx-filter-status').value;

  let list = txAllRows.slice();
  if (fType === 'sales')      list = list.filter(r => r.type === 'sales');
  if (fType === 'cost-cogs')  list = list.filter(r => r.type === 'cost' && String(r.divisionCode) === '1');
  if (fType === 'cost-sga')   list = list.filter(r => r.type === 'cost' && String(r.divisionCode) === '2');

  if (showProjectCol) {
    if (fProject === 'unlinked') list = list.filter(r => _txIsLinkTarget(r) && !r.projectId);
    else if (fProject !== 'all') list = list.filter(r => r.projectId === fProject);
  }

  if (fStatus === 'unsettled') {
    list = list.filter(r => (r.type === 'sales' ? Number(r.uncollected) === 1 : Number(r.unpaid) === 1));
  } else if (fStatus === 'settled') {
    list = list.filter(r => (r.type === 'sales' ? Number(r.uncollected) !== 1 : Number(r.unpaid) !== 1));
  }

  // 日付降順
  list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  if (list.length === 0) {
    const cols = showProjectCol ? 10 : 8;
    tbody.innerHTML = `<tr><td colspan="${cols}" class="text-muted" style="text-align:center;padding:30px;">該当する取引がありません</td></tr>`;
  } else {
    tbody.innerHTML = list.map(r => renderRow(r, showProjectCol)).join('');
  }

  bindRowEvents(showProjectCol);
  renderGrossProfitSection(showProjectCol, fProject);
  updateBulkBar(showProjectCol);
}

function renderRow(row, showProjectCol) {
  const key = `${row.sheetName}:${row.rowIndex}`;
  const isLinkTarget = _txIsLinkTarget(row);
  const upField = row.type === 'sales' ? 'uncollected' : 'unpaid';
  const upOn = Number(row[upField]) === 1;
  const rowCls = upOn ? 'row--unpaid' : '';

  const typeLabel = row.type === 'sales' ? '売上'
    : (String(row.divisionCode) === '1' ? '仕入原価' : '販管費');
  const typeTagCls = row.type === 'sales' ? 'pc-type-sales' : 'pc-type-cost';

  // 科目表示
  let kamokuDisp = '';
  if (row.type === 'sales') {
    kamokuDisp = row.serviceCode ? escTx(row.serviceCode) : '—';
  } else {
    const m = txCostMaster.find(c => String(c.code) === String(row.itemCode));
    kamokuDisp = m
      ? `${escTx(row.itemCode)} ${escTx(m.name || '')}`
      : escTx(row.itemCode || '—');
  }

  // 品目表示
  const hinmokuDisp = escTx(row.itemName || row.miscItemName || '');

  // 状態表示
  const statusMark = upOn
    ? (row.type === 'sales' ? '<span style="color:var(--uz-gold)">未収</span>' : '<span style="color:var(--uz-red)">未払</span>')
    : '';

  // チェックボックス（紐付け対象のみ・project機能ON時のみ）
  const checkboxTd = showProjectCol
    ? (isLinkTarget
        ? `<td class="pc-tx-row-checkbox"><input type="checkbox" class="pc-tx-row-check" data-key="${escTx(key)}" ${txSelectedKeys.has(key) ? 'checked' : ''}></td>`
        : `<td class="pc-tx-row-checkbox"></td>`)
    : '';

  // 紐付けドロップダウン
  let linkTd = '';
  if (showProjectCol) {
    if (isLinkTarget) {
      linkTd = `<td>${renderLinkSelect(row)}</td>`;
    } else {
      linkTd = `<td><span class="pc-tx-row-link-disabled">— 対象外 —</span></td>`;
    }
  }

  return `<tr data-key="${escTx(key)}" class="${rowCls}">
    ${checkboxTd}
    <td>${escTx(row.date || '')}</td>
    <td><span class="${typeTagCls}">${typeLabel}</span></td>
    <td>${kamokuDisp}</td>
    <td>${hinmokuDisp}</td>
    <td class="num">${formatYen(Number(row.amount) || 0)}</td>
    <td>${Number(row.taxRate) || 0}%</td>
    <td>${statusMark}</td>
    ${linkTd}
    <td><button class="pc-btn pc-btn--sm btn-edit-tx" data-key="${escTx(key)}">編集</button></td>
  </tr>`;
}

function renderLinkSelect(row) {
  const cur = row.projectId || '';
  const opts = [`<option value="">— 紐付け解除 —</option>`];
  txProjects.forEach(p => {
    const sel = p.projectId === cur ? 'selected' : '';
    const label = p.customerName ? `${p.projectName} (${p.customerName})` : p.projectName;
    opts.push(`<option value="${escTx(p.projectId)}" ${sel}>${escTx(label)}</option>`);
  });
  // 紐付け済みだが現在 active リストに無い案件（completed/canceled）を補う
  if (cur && !txProjects.some(p => p.projectId === cur)) {
    const inactive = txAllProjects.find(p => p.projectId === cur);
    if (inactive) {
      const label = inactive.customerName
        ? `${inactive.projectName} (${inactive.customerName}) [${inactive.status}]`
        : `${inactive.projectName} [${inactive.status}]`;
      opts.push(`<option value="${escTx(cur)}" selected>${escTx(label)}</option>`);
    } else {
      opts.push(`<option value="${escTx(cur)}" selected>(削除済)</option>`);
    }
  }
  return `<select class="pc-select pc-tx-link-select"
    data-sheet="${escTx(row.sheetName)}"
    data-row="${escTx(row.rowIndex)}">${opts.join('')}</select>`;
}

function bindRowEvents(showProjectCol) {
  // 編集ボタン
  document.querySelectorAll('.btn-edit-tx').forEach(btn => {
    btn.addEventListener('click', e => {
      const key = e.currentTarget.dataset.key;
      const row = txAllRows.find(r => `${r.sheetName}:${r.rowIndex}` === key);
      if (row) openEditTxModal(row);
    });
  });

  if (!showProjectCol) return;

  // 紐付けドロップダウン（即時反映）
  document.querySelectorAll('.pc-tx-link-select').forEach(sel => {
    sel.addEventListener('change', async e => {
      const sheetName = e.target.dataset.sheet;
      const rowIndex = Number(e.target.dataset.row);
      const projectId = e.target.value;
      let res;
      try {
        res = await callGAS('linkProject', { sheetName, rowIndex, projectId });
      } catch (err) {
        alert('通信エラー：' + (err.message || 'unknown'));
        return;
      }
      if (!res || res.status !== 'ok') {
        alert('紐付け失敗：' + (res && res.message || '不明なエラー'));
        return;
      }
      const target = txAllRows.find(r => r.sheetName === sheetName && Number(r.rowIndex) === rowIndex);
      if (target) target.projectId = projectId;
      showToast(projectId ? '紐付けました' : '紐付けを解除しました', 'success');
      // 粗利集計が表示中なら再描画
      renderGrossProfitSection(true, document.getElementById('pc-tx-filter-project').value);
    });
  });

  // 個別チェックボックス
  document.querySelectorAll('.pc-tx-row-check').forEach(cb => {
    cb.addEventListener('change', e => {
      const key = e.target.dataset.key;
      if (e.target.checked) txSelectedKeys.add(key);
      else txSelectedKeys.delete(key);
      updateBulkBar(true);
    });
  });

  // 全選択
  const checkAll = document.getElementById('pc-tx-check-all');
  if (checkAll) {
    checkAll.addEventListener('change', e => {
      const checked = e.target.checked;
      document.querySelectorAll('.pc-tx-row-check').forEach(cb => {
        cb.checked = checked;
        const key = cb.dataset.key;
        if (checked) txSelectedKeys.add(key);
        else txSelectedKeys.delete(key);
      });
      updateBulkBar(true);
    });
  }
}

function updateBulkBar(showProjectCol) {
  const bar = document.getElementById('pc-tx-bulk-bar');
  const count = document.getElementById('pc-tx-bulk-count');
  const apply = document.getElementById('pc-tx-bulk-apply');
  const sel = document.getElementById('pc-tx-bulk-project');
  if (!bar) return;
  if (!showProjectCol) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = txSelectedKeys.size > 0 ? '' : 'none';
  if (count) count.textContent = `${txSelectedKeys.size}件選択中`;
  if (apply) apply.disabled = txSelectedKeys.size === 0 || !sel || !sel.value;
}

async function applyBulkLink() {
  const sel = document.getElementById('pc-tx-bulk-project');
  if (!sel || !sel.value) {
    alert('案件を選択してください');
    return;
  }
  const projectId = sel.value === '__unlink__' ? '' : sel.value;
  const keys = Array.from(txSelectedKeys);
  if (keys.length === 0) return;

  const msg = projectId
    ? `${keys.length}件の行に案件を紐付けますか？`
    : `${keys.length}件の行の紐付けを解除しますか？`;
  if (!confirm(msg)) return;

  let success = 0, failed = 0;
  for (const key of keys) {
    const idx = key.indexOf(':');
    if (idx < 0) { failed++; continue; }
    const sheetName = key.substring(0, idx);
    const rowIndex = Number(key.substring(idx + 1));
    try {
      const res = await callGAS('linkProject', { sheetName, rowIndex, projectId });
      if (res && res.status === 'ok') {
        success++;
        const target = txAllRows.find(r => r.sheetName === sheetName && Number(r.rowIndex) === rowIndex);
        if (target) target.projectId = projectId;
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
    }
  }

  showToast(`成功 ${success}件 / 失敗 ${failed}件`, failed === 0 ? 'success' : 'error');
  txSelectedKeys.clear();
  render();
}

/* =====================
 * 案件粗利集計（下部）
 * ===================== */

function renderGrossProfitSection(showProjectCol, projectFilter) {
  const section = document.getElementById('pc-tx-grossprofit-section');
  const content = document.getElementById('pc-tx-grossprofit-content');
  if (!section || !content) return;

  if (!showProjectCol) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';

  // 集計対象は紐付け済み行のみ・コスト側は4区分絞り込み
  const salesByProject = {};
  const costByProject = {};
  txAllRows.forEach(r => {
    const pid = r.projectId;
    if (!pid) return;
    if (r.type === 'sales') {
      salesByProject[pid] = (salesByProject[pid] || 0) + (Number(r.amount) || 0);
    } else if (r.type === 'cost' && _txIsLinkTarget(r)) {
      costByProject[pid] = (costByProject[pid] || 0) + (Number(r.amount) || 0);
    }
  });

  let pidList;
  if (projectFilter && projectFilter !== 'all' && projectFilter !== 'unlinked') {
    pidList = [projectFilter];
  } else {
    const set = {};
    Object.keys(salesByProject).forEach(k => set[k] = true);
    Object.keys(costByProject).forEach(k => set[k] = true);
    pidList = Object.keys(set);
  }

  if (pidList.length === 0) {
    content.innerHTML = `<p class="text-muted" style="padding:8px 0;">紐付けされた取引がまだありません。各行の「案件紐付け」ドロップダウンから案件を選択してください。</p>`;
    return;
  }

  const fy = n => '¥' + (Number(n) || 0).toLocaleString('ja-JP');
  const rows = pidList.map(pid => {
    const project = txAllProjects.find(p => p.projectId === pid);
    const name = project ? project.projectName : '(削除済)';
    const customer = project ? (project.customerName || '') : '';
    const sales = salesByProject[pid] || 0;
    const cost = costByProject[pid] || 0;
    const gross = sales - cost;
    const rate = sales > 0 ? (gross / sales * 100).toFixed(1) + '%' : '—';
    const grossCls = gross < 0 ? 'negative' : '';
    return `<tr>
      <td>${escTx(pid)}</td>
      <td>${escTx(name)}</td>
      <td>${escTx(customer)}</td>
      <td class="num">${fy(sales)}</td>
      <td class="num">${fy(cost)}</td>
      <td class="num ${grossCls}">${fy(gross)}</td>
      <td class="num">${rate}</td>
    </tr>`;
  }).join('');

  content.innerHTML = `
    <table class="pc-table">
      <thead>
        <tr>
          <th>案件ID</th>
          <th>案件名</th>
          <th>顧客名</th>
          <th class="num">案件売上</th>
          <th class="num">案件直接費</th>
          <th class="num">案件粗利</th>
          <th class="num">粗利率</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

/* =====================
 * 新規追加モーダル
 * ===================== */

function openNewTxModal() {
  const showProject = _txShouldShowProject();

  const modal = document.createElement('div');
  modal.className = 'pc-modal-overlay';
  modal.innerHTML = `
    <div class="pc-modal">
      <h3>新規取引追加</h3>
      <form id="pc-tx-new-form">
        <div class="pc-form-row">
          <label>種別 <span class="pc-required">*</span></label>
          <select name="txType" id="pc-tx-new-type">
            <option value="sales">売上</option>
            <option value="cost-cogs">仕入原価</option>
            <option value="cost-sga">販管費</option>
          </select>
        </div>
        <div class="pc-form-row">
          <label>日付 <span class="pc-required">*</span></label>
          <input type="date" name="date" value="${todayStr()}" required>
        </div>
        <div id="pc-tx-new-fields"></div>
        <div class="pc-form-row" id="pc-tx-new-project-row" style="${showProject ? '' : 'display:none'}">
          <label>案件紐付け</label>
          <select name="projectId" id="pc-tx-new-project">
            <option value="">— 紐付けなし —</option>
            ${txProjects.map(p => {
              const label = p.customerName ? `${p.projectName} (${p.customerName})` : p.projectName;
              return `<option value="${escTx(p.projectId)}">${escTx(label)}</option>`;
            }).join('')}
          </select>
        </div>
        <div class="pc-modal-actions">
          <button type="button" class="pc-secondary-btn" id="pc-tx-new-cancel">キャンセル</button>
          <button type="submit" class="pc-primary-btn">追加</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#pc-tx-new-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  const typeSel = modal.querySelector('#pc-tx-new-type');
  const fields = modal.querySelector('#pc-tx-new-fields');
  const projectRow = modal.querySelector('#pc-tx-new-project-row');

  function refreshFields() {
    const t = typeSel.value;
    fields.innerHTML = renderNewFieldsByType(t);
    bindNewFieldHooks(modal, t);
    // 紐付け対象でない販管費科目に切り替わった時はプロジェクト行を隠す
    updateProjectRowForCostCode(modal);
  }
  typeSel.addEventListener('change', refreshFields);
  refreshFields();

  modal.querySelector('#pc-tx-new-form').addEventListener('submit', async e => {
    e.preventDefault();
    await submitNewTx(modal);
  });
}

function renderNewFieldsByType(t) {
  if (t === 'sales') {
    return `
      <div class="pc-form-row">
        <label>サービス名（任意）</label>
        <input type="text" name="serviceName" placeholder="例：コンサル支援">
      </div>
      <div class="pc-form-row">
        <label>品目名 <span class="pc-required">*</span></label>
        <input type="text" name="itemName" required placeholder="例：4月分">
      </div>
      <div class="pc-form-row">
        <label>税込金額 <span class="pc-required">*</span></label>
        <input type="number" name="amount" required min="0" step="1">
      </div>
      <div class="pc-form-row">
        <label>税率</label>
        <select name="taxRate">
          <option value="10" selected>10%</option>
          <option value="8">8%</option>
          <option value="0">0%</option>
        </select>
      </div>
      <div class="pc-form-row">
        <label>未収</label>
        <select name="uncollected">
          <option value="0" selected>消込済</option>
          <option value="1">未収</option>
        </select>
      </div>
      <div class="pc-form-row">
        <label>メモ</label>
        <input type="text" name="memo">
      </div>
    `;
  }
  if (t === 'cost-cogs') {
    const cogsMaster = txCostMaster.filter(c => String(c.divisionCode) === '1');
    const itemOpts = cogsMaster.map(c =>
      `<option value="${escTx(c.code)}" data-name="${escTx(c.name)}" data-tax="${Number(c.taxRate) || 0}">${escTx(c.code)} ${escTx(c.name)}</option>`
    ).join('');
    return `
      <div class="pc-form-row">
        <label>科目 <span class="pc-required">*</span></label>
        <select name="itemCode" required>${itemOpts}</select>
      </div>
      <div class="pc-form-row">
        <label>品目名（諸口・任意）</label>
        <input type="text" name="itemName" placeholder="例：酒類仕入">
      </div>
      <div class="pc-form-row">
        <label>税込金額 <span class="pc-required">*</span></label>
        <input type="number" name="amount" required min="0" step="1">
      </div>
      <div class="pc-form-row">
        <label>税率</label>
        <select name="taxRate">
          <option value="10">10%</option>
          <option value="8" selected>8%</option>
          <option value="0">0%</option>
        </select>
      </div>
      <div class="pc-form-row">
        <label>未払</label>
        <select name="unpaid">
          <option value="0" selected>消込済</option>
          <option value="1">未払</option>
        </select>
      </div>
      <div class="pc-form-row">
        <label>メモ</label>
        <input type="text" name="memo">
      </div>
    `;
  }
  // cost-sga
  const sgaMaster = txCostMaster.filter(c => String(c.divisionCode) === '2');
  const itemOpts = ['<option value="">（選択してください）</option>']
    .concat(sgaMaster.map(c =>
      `<option value="${escTx(c.code)}" data-name="${escTx(c.name)}" data-tax="${Number(c.taxRate) || 0}">${escTx(c.code)} ${escTx(c.name || '(未登録)')}</option>`
    )).join('');
  return `
    <div class="pc-form-row">
      <label>科目 <span class="pc-required">*</span></label>
      <select name="itemCode" required id="pc-tx-new-sga-itemcode">${itemOpts}</select>
    </div>
    <div class="pc-form-row">
      <label>品目名（補助・任意）</label>
      <input type="text" name="itemName" placeholder="例：4月分電気代">
    </div>
    <div class="pc-form-row">
      <label>税込金額 <span class="pc-required">*</span></label>
      <input type="number" name="amount" required min="0" step="1">
    </div>
    <div class="pc-form-row">
      <label>税率</label>
      <select name="taxRate">
        <option value="10" selected>10%</option>
        <option value="8">8%</option>
        <option value="0">0%</option>
      </select>
    </div>
    <div class="pc-form-row">
      <label>未払</label>
      <select name="unpaid">
        <option value="0" selected>消込済</option>
        <option value="1">未払</option>
      </select>
    </div>
    <div class="pc-form-row">
      <label>メモ</label>
      <input type="text" name="memo">
    </div>
  `;
}

function bindNewFieldHooks(modal, t) {
  // 科目選択で品目名・税率を補完
  const itemSel = modal.querySelector('select[name="itemCode"]');
  if (itemSel) {
    itemSel.addEventListener('change', () => {
      const opt = itemSel.selectedOptions && itemSel.selectedOptions[0];
      if (!opt) return;
      const name = opt.getAttribute('data-name');
      const tax = opt.getAttribute('data-tax');
      const nameInput = modal.querySelector('input[name="itemName"]');
      const taxSel = modal.querySelector('select[name="taxRate"]');
      if (name && nameInput && !nameInput.value.trim()) nameInput.value = name;
      if (tax !== null && tax !== '' && taxSel) taxSel.value = tax;
      updateProjectRowForCostCode(modal);
    });
  }
}

/**
 * 販管費の場合、紐付け対象外科目（光熱費・通信費等）が選択されたら
 * 案件紐付け行を非表示にする。仕入原価・売上は常に紐付け可。
 */
function updateProjectRowForCostCode(modal) {
  const showProject = _txShouldShowProject();
  if (!showProject) return;
  const t = modal.querySelector('#pc-tx-new-type').value;
  const projectRow = modal.querySelector('#pc-tx-new-project-row');
  if (!projectRow) return;

  if (t === 'sales' || t === 'cost-cogs') {
    projectRow.style.display = '';
    return;
  }
  // cost-sga
  const itemSel = modal.querySelector('select[name="itemCode"]');
  const code = itemSel ? itemSel.value : '';
  const isLinkable = ['20', '21', '25'].indexOf(String(code)) !== -1;
  projectRow.style.display = isLinkable ? '' : 'none';
  if (!isLinkable) {
    const projSel = modal.querySelector('select[name="projectId"]');
    if (projSel) projSel.value = '';
  }
}

async function submitNewTx(modal) {
  const fd = new FormData(modal.querySelector('#pc-tx-new-form'));
  const t = String(fd.get('txType') || 'sales');
  const date = String(fd.get('date') || todayStr());
  const amount = parseInt(fd.get('amount') || '0', 10) || 0;
  const taxRate = parseInt(fd.get('taxRate') || '10', 10);
  const memo = String(fd.get('memo') || '');
  const projectId = String(fd.get('projectId') || '');
  const { taxExcluded, tax: taxAmt } = calcTax(amount, taxRate);

  if (amount <= 0) {
    alert('税込金額は1円以上を入力してください');
    return;
  }

  let res;
  try {
    if (t === 'sales') {
      const serviceName = String(fd.get('serviceName') || '');
      const itemName = String(fd.get('itemName') || '');
      const uncollected = parseInt(fd.get('uncollected') || '0', 10);
      if (!itemName) { alert('品目名は必須です'); return; }
      res = await callGAS('addSales', {
        date, serviceCode: '', serviceName, miscItemName: itemName,
        amountExTax: taxExcluded, taxRate, tax: taxAmt, amountInTax: amount,
        memo, uncollected, projectId
      });
    } else {
      const itemCode = String(fd.get('itemCode') || '');
      const itemName = String(fd.get('itemName') || '');
      const unpaid = parseInt(fd.get('unpaid') || '0', 10);
      const divisionCode = (t === 'cost-cogs') ? '1' : '2';
      const divisionName = (t === 'cost-cogs') ? '原価' : '販管費';
      if (!itemCode) { alert('科目を選択してください'); return; }
      res = await callGAS('addCost', {
        date, divisionCode, divisionName, itemCode, itemName,
        taxExcluded, taxRate, tax: taxAmt, taxIncluded: amount,
        memo, unpaid, projectId
      });
    }
  } catch (e) {
    alert('通信エラー：' + (e.message || 'unknown'));
    return;
  }

  if (!res || res.status !== 'ok') {
    alert('保存失敗：' + (res && res.message || '不明なエラー'));
    return;
  }
  modal.remove();
  showToast('追加しました', 'success');
  await loadAll();
}

/* =====================
 * 編集モーダル
 * ===================== */

function openEditTxModal(row) {
  const showProject = _txShouldShowProject();
  const isSales = row.type === 'sales';
  const upField = isSales ? 'uncollected' : 'unpaid';

  const modal = document.createElement('div');
  modal.className = 'pc-modal-overlay';

  let fieldsHtml;
  if (isSales) {
    fieldsHtml = `
      <div class="pc-form-row">
        <label>品目名</label>
        <input type="text" name="itemName" value="${escTx(row.itemName || '')}">
      </div>
      <div class="pc-form-row">
        <label>税込金額</label>
        <input type="number" name="amount" value="${Number(row.amount) || 0}" min="0" step="1">
      </div>
      <div class="pc-form-row">
        <label>税率</label>
        <select name="taxRate">
          ${[0,8,10].map(v => `<option value="${v}" ${Number(row.taxRate)===v?'selected':''}>${v}%</option>`).join('')}
        </select>
      </div>
      <div class="pc-form-row">
        <label>未収</label>
        <select name="upFlag">
          <option value="0" ${Number(row[upField])!==1?'selected':''}>消込済</option>
          <option value="1" ${Number(row[upField])===1?'selected':''}>未収</option>
        </select>
      </div>
      <div class="pc-form-row">
        <label>メモ</label>
        <input type="text" name="memo" value="${escTx(row.memo || '')}">
      </div>
    `;
  } else {
    const isCogs = String(row.divisionCode) === '1';
    const masterFiltered = txCostMaster.filter(c => String(c.divisionCode) === String(row.divisionCode));
    const itemOpts = masterFiltered.map(c =>
      `<option value="${escTx(c.code)}" ${String(c.code)===String(row.itemCode)?'selected':''}>${escTx(c.code)} ${escTx(c.name || '(未登録)')}</option>`
    ).join('');
    const divOpts = `
      <option value="1" ${isCogs?'selected':''}>仕入原価</option>
      <option value="2" ${!isCogs?'selected':''}>販管費</option>
    `;
    fieldsHtml = `
      <div class="pc-form-row">
        <label>区分</label>
        <select name="divisionCode" disabled>${divOpts}</select>
      </div>
      <div class="pc-form-row">
        <label>科目</label>
        <select name="itemCode">${itemOpts}</select>
      </div>
      <div class="pc-form-row">
        <label>品目名</label>
        <input type="text" name="itemName" value="${escTx(row.itemName || '')}">
      </div>
      <div class="pc-form-row">
        <label>税込金額</label>
        <input type="number" name="amount" value="${Number(row.amount) || 0}" min="0" step="1">
      </div>
      <div class="pc-form-row">
        <label>税率</label>
        <select name="taxRate">
          ${[0,8,10].map(v => `<option value="${v}" ${Number(row.taxRate)===v?'selected':''}>${v}%</option>`).join('')}
        </select>
      </div>
      <div class="pc-form-row">
        <label>未払</label>
        <select name="upFlag">
          <option value="0" ${Number(row[upField])!==1?'selected':''}>消込済</option>
          <option value="1" ${Number(row[upField])===1?'selected':''}>未払</option>
        </select>
      </div>
      <div class="pc-form-row">
        <label>メモ</label>
        <input type="text" name="memo" value="${escTx(row.memo || '')}">
      </div>
    `;
  }

  const projectRow = (showProject && _txIsLinkTarget(row))
    ? `<div class="pc-form-row">
        <label>案件紐付け</label>
        <select name="projectId">
          <option value="">— 紐付けなし —</option>
          ${txProjects.map(p => {
            const label = p.customerName ? `${p.projectName} (${p.customerName})` : p.projectName;
            const sel = p.projectId === row.projectId ? 'selected' : '';
            return `<option value="${escTx(p.projectId)}" ${sel}>${escTx(label)}</option>`;
          }).join('')}
        </select>
      </div>`
    : '';

  modal.innerHTML = `
    <div class="pc-modal">
      <h3>取引編集 — ${isSales ? '売上' : (String(row.divisionCode)==='1' ? '仕入原価' : '販管費')}</h3>
      <form id="pc-tx-edit-form">
        <div class="pc-form-row">
          <label>日付</label>
          <input type="date" name="date" value="${escTx(row.date || todayStr())}" required>
        </div>
        ${fieldsHtml}
        ${projectRow}
        <div class="pc-modal-actions">
          <button type="button" class="pc-secondary-btn" id="pc-tx-edit-cancel">キャンセル</button>
          <button type="submit" class="pc-primary-btn">更新</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#pc-tx-edit-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  modal.querySelector('#pc-tx-edit-form').addEventListener('submit', async e => {
    e.preventDefault();
    await submitEditTx(modal, row);
  });
}

async function submitEditTx(modal, row) {
  const fd = new FormData(modal.querySelector('#pc-tx-edit-form'));
  const date = String(fd.get('date') || row.date);
  const amount = parseInt(fd.get('amount') || '0', 10) || 0;
  const taxRate = parseInt(fd.get('taxRate') || '10', 10);
  const memo = String(fd.get('memo') || '');
  const upFlag = parseInt(fd.get('upFlag') || '0', 10);
  const projectIdRaw = fd.get('projectId');
  const { taxExcluded, tax: taxAmt } = calcTax(amount, taxRate);

  let res;
  try {
    if (row.type === 'sales') {
      const itemName = String(fd.get('itemName') || '');
      const payload = {
        rowIndex: row.rowIndex, date,
        serviceName: itemName, serviceCode: row.serviceCode || '',
        amountExTax: taxExcluded, taxRate, tax: taxAmt, amountInTax: amount,
        memo, uncollected: upFlag
      };
      if (projectIdRaw !== null) payload.projectId = String(projectIdRaw);
      res = await callGAS('updateSales', payload);
    } else {
      const itemCode = String(fd.get('itemCode') || row.itemCode || '');
      const itemName = String(fd.get('itemName') || '');
      const divisionCode = String(row.divisionCode || '2');
      const divisionName = divisionCode === '1' ? '原価' : '販管費';
      const payload = {
        rowIndex: row.rowIndex, date,
        divisionCode, divisionName, itemCode, itemName,
        taxExcluded, taxRate, tax: taxAmt, taxIncluded: amount,
        memo, unpaid: upFlag
      };
      if (projectIdRaw !== null) payload.projectId = String(projectIdRaw);
      res = await callGAS('updateCost', payload);
    }
  } catch (e) {
    alert('通信エラー：' + (e.message || 'unknown'));
    return;
  }

  if (!res || res.status !== 'ok') {
    alert('更新失敗：' + (res && res.message || '不明なエラー'));
    return;
  }
  modal.remove();
  showToast('更新しました', 'success');
  await loadAll();
}

/* =====================
 * 案件マスタ管理モーダル
 * ===================== */

let _txProjectMasterFilter = 'active';

function openProjectMasterModal() {
  const modal = document.createElement('div');
  modal.className = 'pc-modal-overlay';
  modal.id = 'pc-tx-project-master-modal';
  modal.innerHTML = `
    <div class="pc-modal" style="width:720px; max-width:95vw;">
      <h3>案件マスタ管理</h3>
      <div id="pc-tx-pm-body"><div class="pc-loading">読み込み中...</div></div>
      <div class="pc-modal-actions">
        <button type="button" class="pc-secondary-btn" id="pc-tx-pm-close">閉じる</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#pc-tx-pm-close').addEventListener('click', async () => {
    modal.remove();
    // 案件マスタが変更された可能性があるので再取得
    await loadAll();
  });
  modal.addEventListener('click', e => {
    if (e.target === modal) {
      modal.remove();
      loadAll();
    }
  });

  loadProjectMasterIntoModal();
}

async function loadProjectMasterIntoModal() {
  const body = document.querySelector('#pc-tx-pm-body');
  if (!body) return;
  body.innerHTML = '<div class="pc-loading">読み込み中...</div>';
  let res;
  try {
    res = await callGAS('getProjects', {});
  } catch (e) {
    body.innerHTML = `<div class="pc-error">通信エラー：${escTx(e.message || 'unknown')}</div>`;
    return;
  }
  if (!res || res.status !== 'ok') {
    body.innerHTML = `<div class="pc-error">取得失敗：${escTx(res && res.message || '不明なエラー')}</div>`;
    return;
  }
  txAllProjects = res.data || [];
  txProjects = txAllProjects.filter(p => (p.status || 'active') === 'active');
  renderProjectMaster(body);
}

function renderProjectMaster(body) {
  const filtered = _txProjectMasterFilter === 'all'
    ? txAllProjects
    : txAllProjects.filter(p => (p.status || 'active') === _txProjectMasterFilter);

  const filterLabels = { active: '進行中', completed: '完了', canceled: 'キャンセル', all: 'すべて' };
  const filterButtons = ['active', 'completed', 'canceled', 'all'].map(f => {
    const cls = f === _txProjectMasterFilter ? 'pc-filter-btn pc-filter-btn--active' : 'pc-filter-btn';
    return `<button type="button" class="${cls}" data-filter="${f}">${filterLabels[f]}</button>`;
  }).join('');

  const rows = filtered.length === 0
    ? `<tr><td colspan="8" class="pc-empty">該当する案件がありません</td></tr>`
    : filtered.map(p => `
      <tr>
        <td>${escTx(p.projectId)}</td>
        <td>${escTx(p.projectName)}</td>
        <td>${escTx(p.customerName)}</td>
        <td>${escTx(p.startDate)}</td>
        <td>${escTx(p.endDate)}</td>
        <td><span class="pc-status-${escTx(p.status || 'unknown')}">${escTx(p.status || 'unknown')}</span></td>
        <td>${escTx(p.memo)}</td>
        <td>
          <button type="button" class="pc-action-btn" data-action="edit" data-id="${escTx(p.projectId)}">編集</button>
          <button type="button" class="pc-action-btn pc-action-btn--danger" data-action="delete" data-id="${escTx(p.projectId)}">削除</button>
        </td>
      </tr>
    `).join('');

  body.innerHTML = `
    <div class="pc-master-header">
      <button type="button" class="pc-primary-btn" id="pc-tx-pm-add-btn">＋ 新規案件追加</button>
    </div>
    <div class="pc-filter-row">${filterButtons}</div>
    <div style="overflow-x:auto;">
      <table class="pc-table">
        <thead>
          <tr>
            <th>案件ID</th>
            <th>案件名</th>
            <th>顧客名</th>
            <th>開始日</th>
            <th>終了日</th>
            <th>状態</th>
            <th>備考</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  body.querySelector('#pc-tx-pm-add-btn').addEventListener('click', () => openProjectFormModal('add'));
  body.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => openProjectFormModal('edit', btn.dataset.id));
  });
  body.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => deleteProjectFlow(btn.dataset.id));
  });
  body.querySelectorAll('.pc-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _txProjectMasterFilter = btn.dataset.filter;
      renderProjectMaster(body);
    });
  });
}

function openProjectFormModal(mode, projectId) {
  const isEdit = mode === 'edit';
  const target = isEdit ? txAllProjects.find(p => p.projectId === projectId) : null;
  if (isEdit && !target) {
    alert('対象案件が見つかりません');
    return;
  }

  const modal = document.createElement('div');
  modal.className = 'pc-modal-overlay';
  modal.style.zIndex = '10000';
  modal.innerHTML = `
    <div class="pc-modal">
      <h3>${isEdit ? '案件編集' : '新規案件追加'}</h3>
      <form id="pc-tx-project-form">
        <div class="pc-form-row">
          <label>案件名 <span class="pc-required">*</span></label>
          <input type="text" name="projectName" value="${isEdit ? escTx(target.projectName) : ''}" required>
        </div>
        <div class="pc-form-row">
          <label>顧客名</label>
          <input type="text" name="customerName" value="${isEdit ? escTx(target.customerName) : ''}">
        </div>
        <div class="pc-form-row">
          <label>開始日</label>
          <input type="date" name="startDate" value="${isEdit ? escTx(target.startDate) : ''}">
        </div>
        <div class="pc-form-row">
          <label>終了日</label>
          <input type="date" name="endDate" value="${isEdit ? escTx(target.endDate) : ''}">
        </div>
        <div class="pc-form-row">
          <label>状態</label>
          <select name="status">
            <option value="active" ${isEdit && target.status === 'active' ? 'selected' : ''}>進行中</option>
            <option value="completed" ${isEdit && target.status === 'completed' ? 'selected' : ''}>完了</option>
            <option value="canceled" ${isEdit && target.status === 'canceled' ? 'selected' : ''}>キャンセル</option>
          </select>
        </div>
        <div class="pc-form-row">
          <label>備考</label>
          <textarea name="memo" rows="3">${isEdit ? escTx(target.memo) : ''}</textarea>
        </div>
        <div class="pc-modal-actions">
          <button type="button" class="pc-secondary-btn" id="pc-tx-pf-cancel">キャンセル</button>
          <button type="submit" class="pc-primary-btn">${isEdit ? '更新' : '追加'}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#pc-tx-pf-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  modal.querySelector('#pc-tx-project-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      projectName: String(fd.get('projectName') || '').trim(),
      customerName: String(fd.get('customerName') || '').trim(),
      startDate: String(fd.get('startDate') || ''),
      endDate: String(fd.get('endDate') || ''),
      status: String(fd.get('status') || 'active'),
      memo: String(fd.get('memo') || '')
    };
    if (!data.projectName) { alert('案件名は必須です'); return; }
    if (isEdit) data.projectId = projectId;

    const action = isEdit ? 'updateProject' : 'addProject';
    let res;
    try {
      res = await callGAS(action, data);
    } catch (err) {
      alert('通信エラー：' + (err.message || 'unknown'));
      return;
    }
    if (!res || res.status !== 'ok') {
      alert('保存失敗：' + (res && res.message || '不明なエラー'));
      return;
    }
    modal.remove();
    await loadProjectMasterIntoModal();
    showToast(isEdit ? '案件を更新しました' : '案件を追加しました', 'success');
  });
}

async function deleteProjectFlow(projectId) {
  if (!confirm('この案件を削除しますか？')) return;

  let res;
  try {
    res = await callGAS('deleteProject', { projectId });
  } catch (e) {
    alert('通信エラー：' + (e.message || 'unknown'));
    return;
  }

  if (res && res.status === 'warning') {
    const force = confirm(
      `${res.linkedCount}件の売上・コスト行に紐付けられています。\n\n強制削除しますか？\n（紐付けされた行のprojectIdは空欄になり、案件粗利の集計対象から外れます。会計データ自体は削除されません。）`
    );
    if (!force) return;
    try {
      res = await callGAS('deleteProject', { projectId, force: true });
    } catch (e) {
      alert('通信エラー：' + (e.message || 'unknown'));
      return;
    }
  }

  if (!res || res.status !== 'ok') {
    alert('削除失敗：' + (res && res.message || '不明なエラー'));
    return;
  }
  await loadProjectMasterIntoModal();
  showToast('案件を削除しました', 'success');
}

/* =====================
 * ユーティリティ
 * ===================== */

function escTx(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}
