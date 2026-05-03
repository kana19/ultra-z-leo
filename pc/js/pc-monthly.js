/**
 * ウルトラZAIMUくんレオ PC版 — pc-monthly.js
 * 月次管理画面のロジック
 * 戦略思想メモ§3-9-3 / 3デバイス統合仕様§8-3 / 技術仕様書§9-4 準拠
 */
'use strict';

/* ── 状態 ──────────────────────────────────────────────── */
let _monthlyData = [];                 // 統合後の全行配列（並び順は date 昇順／同日内 sales→cost）
let _settings = { costMaster: [], serviceList: [] };
let _filterState = {
  month:   _todayYM(),
  status:  'all',
  type:    'all',
  project: 'all',
};
let _draftRows = [];                   // 未確定ドラフト行配列
let _editingRowKey = null;             // 編集中の rowKey（同時編集は1行のみ）
let _editingDraft = {};                // 編集中の途中値（保存時は破棄）
let _draftSeq = 0;                     // ドラフトIDカウンタ

/* ── ユーティリティ ──────────────────────────────────────── */
function _todayYM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function _escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}

function _formatYenPlain(n) {
  const v = Number(n);
  if (!isFinite(v)) return '0';
  return v.toLocaleString('ja-JP');
}

function _calcTaxAmount(amountInclTax, taxRate) {
  const a = Number(amountInclTax) || 0;
  const r = Number(taxRate) || 0;
  if (r === 0 || a === 0) return 0;
  const ex = Math.floor(a / (1 + r / 100));
  return a - ex;
}

function _rowKey(row) {
  return row.source === 'draft'
    ? `draft-${row.draftId}`
    : `row-${row.source}-${row.rowIndex}`;
}

/* ── 種別分類 ────────────────────────────────────────────── */
function _classifyCost(divisionCode, itemCode) {
  const dv = String(divisionCode || '');
  const ic = String(itemCode || '');
  if (dv === '1') return { type: '仕入原価', typeCode: 'shi' };
  if (dv === '2' && ic === '21') return { type: '委託・外注', typeCode: 'gai' };
  if (dv === '2' && ic === '20') return { type: '人件費', typeCode: 'jin' };
  return { type: '販管費', typeCode: 'h' };
}

/* ── 起動 ────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', initMonthly);

async function initMonthly() {
  pcBootstrap('monthly.html', '月次管理');
  buildMonthDropdown(_filterState.month);
  bindFilterEvents();
  bindAddButtons();
  await loadMonthlyData(_filterState.month);
}

function buildMonthDropdown(currentMonth) {
  const sel = document.getElementById('filter-month');
  if (!sel) return;
  sel.innerHTML = '';
  const now = new Date();
  // 過去12ヶ月＋当月（仕様§2-5・既定=当月）
  const months = [];
  for (let i = 0; i <= 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ v, label: `${d.getFullYear()}年${d.getMonth() + 1}月` });
  }
  for (const m of months) {
    const opt = document.createElement('option');
    opt.value = m.v;
    opt.textContent = m.label;
    if (m.v === currentMonth) opt.selected = true;
    sel.appendChild(opt);
  }
}

/* ── データ取得・統合 ────────────────────────────────────── */
async function loadMonthlyData(month) {
  const tbody = document.getElementById('monthly-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="loading">読み込み中…</td></tr>';

  try {
    const [historyRes, settingsRes] = await Promise.all([
      callGAS('getHistory', { month }).catch(() => null),
      callGAS('getSettings').catch(() => null),
    ]);
    const history = (historyRes && historyRes.status === 'ok' && Array.isArray(historyRes.data))
      ? historyRes.data : [];
    const settings = (settingsRes && settingsRes.status === 'ok' && settingsRes.data)
      ? settingsRes.data : {};

    _settings.costMaster = (typeof getCostMaster === 'function') ? getCostMaster() : [];
    if (settings.costMasterList && Array.isArray(settings.costMasterList) && settings.costMasterList.length) {
      _settings.costMaster = settings.costMasterList;
    }
    _settings.serviceList = Array.isArray(settings.serviceList) ? settings.serviceList : [];

    _monthlyData = mergeAndClassify(history);
    generateDisplayCodes(_monthlyData);
    // 月切替時は編集状態とドラフトを破棄
    _editingRowKey = null;
    _editingDraft = {};
    _draftRows = [];
    renderTable();
  } catch (err) {
    console.error('[pc-monthly] loadMonthlyData failed', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="loading">読み込みに失敗しました：${_escHtml(err.message || err)}</td></tr>`;
  }
}

function mergeAndClassify(historyRows) {
  const out = [];
  for (const r of historyRows) {
    if (r.type === 'sales') {
      out.push({
        source:     'sales',
        rowIndex:   Number(r.rowIndex),
        sheetName:  '売上',
        date:       String(r.date || ''),
        type:       '売上',
        typeCode:   'u',
        subject:    String(r.itemName || ''),
        subjectCode: String(r.serviceCode || ''),
        amount:     Number(r.amount) || 0,
        taxRate:    Number(r.taxRate) || 0,
        taxAmount:  _calcTaxAmount(r.amount, r.taxRate),
        memo:       String(r.memo || ''),
        // sales の isProject は U列（getHistory 未返却）。初期は false。
        // markAsProject 実行直後にクライアント状態で true にする（ページリロードで消える既知制限）
        isProject:  false,
        isUnpaid:   Number(r.uncollected) === 1,
        // S列（ロックフラグ）は getHistory 未返却のため常に false（解除申請ボタン非表示）
        isLocked:   false,
        salesRowId: String(r.projectId || ''),     // 売上のT列＝salesRowId（親キー）
        displayCode: '',
      });
    } else if (r.type === 'cost') {
      const cls = _classifyCost(r.divisionCode, r.itemCode);
      const linkedTo = String(r.projectId || ''); // V列＝紐付け先売上行ID（コストにとっての isProject 根拠）
      out.push({
        source:     'cost',
        rowIndex:   Number(r.rowIndex),
        sheetName:  'コスト',
        date:       String(r.date || ''),
        type:       cls.type,
        typeCode:   cls.typeCode,
        subject:    String(r.itemName || ''),
        subjectCode: String(r.itemCode || ''),
        divisionCode: String(r.divisionCode || ''),
        amount:     Number(r.amount) || 0,
        taxRate:    Number(r.taxRate) || 0,
        taxAmount:  _calcTaxAmount(r.amount, r.taxRate),
        memo:       String(r.memo || ''),
        isProject:  linkedTo.length > 0,           // V列に値あり＝紐付け済み＝案件
        isUnpaid:   Number(r.unpaid) === 1,
        isLocked:   false,                          // S列未対応（同上）
        salesRowId: linkedTo,                       // コスト側は紐付け先salesRowId
        displayCode: '',
      });
    }
  }
  return out;
}

function generateDisplayCodes(rows) {
  // date 昇順、同日内 sales→cost の順にソート（仕様§2-3 step1）
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.source !== b.source) return a.source === 'sales' ? -1 : 1;
    return a.rowIndex - b.rowIndex;
  });
  // 種別記号ごとに月内連番（仕様§2-3 step2-4）
  const counters = { u: 0, shi: 0, h: 0, gai: 0, jin: 0 };
  for (const r of rows) {
    counters[r.typeCode] = (counters[r.typeCode] || 0) + 1;
    const yymmdd = String(r.date || '').slice(2, 10).replace(/-/g, '');
    const n = counters[r.typeCode];
    const seq = n < 100 ? String(n).padStart(2, '0') : String(n).padStart(3, '0');
    r.displayCode = `${yymmdd}-${r.typeCode}-${seq}`;
  }
}

/* ── フィルタ ────────────────────────────────────────────── */
function applyFilters(rows) {
  return rows.filter(r => {
    if (_filterState.status === 'unpaid' && !r.isUnpaid) return false;
    if (_filterState.status === 'locked' && !r.isLocked) return false;
    if (_filterState.type !== 'all' && r.type !== _filterState.type) return false;
    if (_filterState.project === 'project' && !r.isProject) return false;
    if (_filterState.project === 'normal' && r.isProject) return false;
    return true;
  });
}

function bindFilterEvents() {
  const monthSel = document.getElementById('filter-month');
  monthSel?.addEventListener('change', async () => {
    _filterState.month = monthSel.value;
    await loadMonthlyData(_filterState.month);
  });
  ['filter-status', 'filter-type', 'filter-project'].forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener('change', () => {
      const key = id.replace('filter-', '');
      _filterState[key] = el.value;
      renderTable();
    });
  });
}

/* ── 描画 ────────────────────────────────────────────────── */
function renderTable() {
  const tbody = document.getElementById('monthly-tbody');
  if (!tbody) return;
  const rows = applyFilters(_monthlyData);
  const html = rows.map(r => renderRow(r)).join('') + _draftRows.map(d => renderDraftRow(d)).join('');
  tbody.innerHTML = html || '<tr><td colspan="9" class="loading">該当する行がありません</td></tr>';
  bindRowEvents();
}

function renderRow(row) {
  const key = _rowKey(row);
  const isEditing = _editingRowKey === key;
  const classes = [
    isEditing ? 'pc-row--editing' : '',
    row.isUnpaid ? 'pc-row--unpaid' : '',
    row.isLocked ? 'pc-row--locked' : '',
  ].filter(Boolean).join(' ');

  // セル：編集中はinput/select、それ以外はテキスト
  const cellDate    = isEditing
    ? `<input type="date" class="pc-edit-input" data-field="date" value="${_escHtml(row.date)}">`
    : _escHtml(row.date);
  const cellSubject = isEditing
    ? renderSubjectSelect(row, 'edit')
    : _escHtml(row.subject);
  const cellAmount  = isEditing
    ? `<input type="number" class="pc-edit-input pc-edit-input--num" data-field="amount" value="${row.amount}">`
    : _formatYenPlain(row.amount);
  const cellTaxRate = isEditing
    ? renderTaxRateSelect(row.taxRate, 'edit')
    : `${row.taxRate}%`;
  const cellTax     = _formatYenPlain(row.taxAmount);
  const cellMemo    = isEditing
    ? `<input type="text" class="pc-edit-input" data-field="memo" value="${_escHtml(row.memo)}">`
    : _escHtml(row.memo);

  const codeCell = `${_escHtml(row.displayCode)}${row.isProject ? ' <span class="pc-row--project-marker" title="案件">🔶</span>' : ''}`;

  // 操作列
  let actionsHtml = '';
  if (isEditing) {
    actionsHtml = `
      <button type="button" class="pc-action-btn pc-action-btn--save" data-action="save-edit">保存</button>
      <button type="button" class="pc-action-btn" data-action="cancel-edit">取消</button>
    `;
  } else {
    if (row.source === 'sales' && !row.isProject && !row.isLocked) {
      actionsHtml += `<button type="button" class="pc-action-btn pc-action-btn--project" data-action="mark-project">案件化</button>`;
    }
    if (row.isUnpaid && !row.isLocked) {
      actionsHtml += `<button type="button" class="pc-action-btn pc-action-btn--reconcile" data-action="reconcile">消込</button>`;
    }
    if (row.isLocked) {
      // S列未対応のため事実上非表示（条件で常にfalse）。次フェーズで isLocked が来たら自動的に表示される
      actionsHtml += `<button type="button" class="pc-action-btn" data-action="request-unlock">解除申請</button>`;
    }
  }

  return `
    <tr class="${classes}" data-row-key="${_escHtml(key)}" data-source="${row.source}" data-row-index="${row.rowIndex}">
      <td>${codeCell}</td>
      <td data-field-cell="date">${cellDate}</td>
      <td>${_escHtml(row.type)}</td>
      <td data-field-cell="subject">${cellSubject}</td>
      <td class="num" data-field-cell="amount">${cellAmount}</td>
      <td data-field-cell="taxRate">${cellTaxRate}</td>
      <td class="num">${cellTax}</td>
      <td data-field-cell="memo">${cellMemo}</td>
      <td class="pc-row--actions">${actionsHtml}</td>
    </tr>
  `;
}

function renderDraftRow(draft) {
  const key = _rowKey(draft);
  const cls = _classifyCost(draft.divisionCode, draft.itemCode || draft.subjectCode);
  const typeLabel = draft.source === 'sales' ? '売上' : cls.type;

  return `
    <tr class="pc-row--draft" data-row-key="${_escHtml(key)}" data-draft-id="${draft.draftId}">
      <td><span class="pc-text-muted">（新規）</span></td>
      <td><input type="date" class="pc-edit-input" data-field="date" value="${_escHtml(draft.date)}"></td>
      <td>${_escHtml(typeLabel)}</td>
      <td>${renderSubjectSelect(draft, 'draft')}</td>
      <td class="num"><input type="number" class="pc-edit-input pc-edit-input--num" data-field="amount" value="${draft.amount || ''}" placeholder="0"></td>
      <td>${renderTaxRateSelect(draft.taxRate, 'draft')}</td>
      <td class="num">${_formatYenPlain(_calcTaxAmount(draft.amount, draft.taxRate))}</td>
      <td><input type="text" class="pc-edit-input" data-field="memo" value="${_escHtml(draft.memo)}" placeholder="メモ"></td>
      <td class="pc-row--actions">
        <button type="button" class="pc-action-btn pc-action-btn--save" data-action="commit-draft">登録</button>
        <button type="button" class="pc-action-btn" data-action="discard-draft">取消</button>
      </td>
    </tr>
  `;
}

function renderSubjectSelect(row, mode) {
  if (row.source === 'sales') {
    const opts = (_settings.serviceList || []).map(s => {
      const code = String(s.code || s.serviceCode || '');
      const name = String(s.name || s.serviceName || '');
      const sel = (row.subjectCode === code || row.subject === name) ? 'selected' : '';
      return `<option value="${_escHtml(code)}" data-name="${_escHtml(name)}" ${sel}>${_escHtml(name)}</option>`;
    }).join('');
    return `<select class="pc-edit-input" data-field="subjectCode">${opts || '<option value="">（マスタ未設定）</option>'}</select>`;
  }
  // cost
  const opts = (_settings.costMaster || [])
    .filter(it => it && it.name)
    .map(it => {
      const code = String(it.code || '');
      const name = String(it.name || '');
      const sel = (row.subjectCode === code || row.subject === name) ? 'selected' : '';
      return `<option value="${_escHtml(code)}" data-name="${_escHtml(name)}" data-tax="${it.taxRate || 0}" data-div="${_escHtml(it.divisionCode || '')}" ${sel}>${_escHtml(name)}</option>`;
    }).join('');
  return `<select class="pc-edit-input" data-field="subjectCode">${opts || '<option value="">（科目マスタ未設定）</option>'}</select>`;
}

function renderTaxRateSelect(currentRate, mode) {
  const r = Number(currentRate) || 0;
  const opts = [10, 8, 0].map(v => {
    const sel = v === r ? 'selected' : '';
    return `<option value="${v}" ${sel}>${v}%</option>`;
  }).join('');
  return `<select class="pc-edit-input" data-field="taxRate">${opts}</select>`;
}

/* ── 行イベントバインド ──────────────────────────────────── */
function bindRowEvents() {
  const tbody = document.getElementById('monthly-tbody');
  if (!tbody) return;

  // 編集セルクリック → 編集開始
  tbody.querySelectorAll('tr[data-row-key]').forEach(tr => {
    const key = tr.getAttribute('data-row-key');
    const isDraft = key.startsWith('draft-');

    if (!isDraft) {
      // 既存行：編集可能セルをクリックでstartEdit
      tr.querySelectorAll('td[data-field-cell]').forEach(td => {
        const field = td.getAttribute('data-field-cell');
        if (!isFieldEditable(field, tr.getAttribute('data-source'))) return;
        td.addEventListener('click', (e) => {
          // 既にinputが入っていれば素通り
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
          startEdit(key, field);
        });
      });
    }

    // 編集中入力のキー操作
    tr.querySelectorAll('.pc-edit-input').forEach(inp => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (isDraft) discardDraftRow(key.replace('draft-', ''));
          else cancelEdit();
        } else if (e.key === 'Enter' && !e.shiftKey) {
          // 同列の次行へ移動
          e.preventDefault();
          const field = inp.getAttribute('data-field');
          moveEditToNextRow(tr, field);
        }
      });
      // 編集中値を _editingDraft に蓄積（送信は保存ボタン依存・現指示書では破棄）
      inp.addEventListener('input', () => {
        if (isDraft) {
          const draftId = key.replace('draft-', '');
          const d = _draftRows.find(x => String(x.draftId) === String(draftId));
          if (d) {
            const field = inp.getAttribute('data-field');
            captureFieldValue(d, inp, field);
            updateDraftTaxDisplay(tr, d);
          }
        } else {
          const field = inp.getAttribute('data-field');
          captureFieldValue(_editingDraft, inp, field);
        }
      });
    });

    // 操作ボタン
    tr.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.getAttribute('data-action');
        const rowKey = tr.getAttribute('data-row-key');
        switch (action) {
          case 'mark-project':   onMarkAsProject(rowKey);   break;
          case 'reconcile':      onReconcile(rowKey);       break;
          case 'request-unlock': onRequestUnlock(rowKey);   break;
          case 'save-edit':      commitEdit();              break;
          case 'cancel-edit':    cancelEdit();              break;
          case 'commit-draft':   commitDraftRow(rowKey.replace('draft-', '')); break;
          case 'discard-draft':  discardDraftRow(rowKey.replace('draft-', '')); break;
        }
      });
      // 戦略思想§1-4「AI自動確定の禁止」：登録系ボタンはEnter/space ではなくマウスクリック・space のみ反応
      // ブラウザ既定で button は Enter/Space に反応するため、ドラフト登録ボタンに限り Enter を抑止
      if (btn.getAttribute('data-action') === 'commit-draft') {
        btn.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            // Enter での誤確定を防ぐ：何もしない
          }
        });
      }
    });
  });
}

function isFieldEditable(field, source) {
  // 仕様§2-4 「編集 可」列：date / subject(=subjectCode) / amount / taxRate / memo
  const editable = ['date', 'subject', 'amount', 'taxRate', 'memo'];
  return editable.includes(field);
}

function captureFieldValue(target, inp, field) {
  let v = inp.value;
  if (field === 'amount') v = Number(v) || 0;
  if (field === 'taxRate') v = Number(v) || 0;
  if (field === 'subject') field = 'subjectCode';
  // selectで data-name を持つ場合は表示用 subject 名も同期
  if (inp.tagName === 'SELECT' && field === 'subjectCode') {
    const opt = inp.options[inp.selectedIndex];
    if (opt && opt.dataset && opt.dataset.name) {
      target.subject = opt.dataset.name;
    }
    if (opt && opt.dataset && opt.dataset.tax !== undefined) {
      target.taxRate = Number(opt.dataset.tax) || 0;
    }
    if (opt && opt.dataset && opt.dataset.div !== undefined) {
      target.divisionCode = String(opt.dataset.div || '');
    }
  }
  target[field] = v;
}

function updateDraftTaxDisplay(tr, draft) {
  const taxCell = tr.querySelector('td.num + td.num + td.num') || tr.querySelectorAll('td.num')[1];
  // 「金額(税込)」「消費税」両方が num。消費税は 7番目（0-index 6）の <td class="num">。
  const numCells = tr.querySelectorAll('td.num');
  if (numCells && numCells.length >= 2) {
    numCells[numCells.length - 1].textContent = _formatYenPlain(_calcTaxAmount(draft.amount, draft.taxRate));
  }
  // 種別表示はドラフト切替時に再描画したい場合のみ上書き（ここでは触らない）
}

/* ── インライン編集 ──────────────────────────────────────── */
function startEdit(rowKey, field) {
  if (_editingRowKey === rowKey) return;
  // 別行を編集中ならまずキャンセル
  if (_editingRowKey) cancelEdit();
  _editingRowKey = rowKey;
  // 元値を退避
  const row = _monthlyData.find(r => _rowKey(r) === rowKey);
  if (!row) { _editingRowKey = null; return; }
  _editingDraft = { ...row };
  renderTable();
  // 当該フィールドにフォーカス
  setTimeout(() => {
    const tr = document.querySelector(`tr[data-row-key="${CSS.escape(rowKey)}"]`);
    if (!tr) return;
    const target = tr.querySelector(`[data-field="${field === 'subject' ? 'subjectCode' : field}"]`);
    if (target) {
      target.focus();
      if (target.tagName === 'INPUT' && target.type !== 'date') {
        try { target.select(); } catch (_) {}
      }
    }
  }, 0);
}

function commitEdit() {
  // 仕様§2-6：本指示書範囲では updateRow 未実装。警告トースト表示してドラフト変更を破棄
  showToast('編集保存機能は次指示書で実装予定', 'info', 3000);
  cancelEdit();
}

function cancelEdit() {
  _editingRowKey = null;
  _editingDraft = {};
  renderTable();
}

function moveEditToNextRow(currentTr, field) {
  const allRows = _monthlyData;
  if (!allRows.length) return;
  const currentKey = currentTr.getAttribute('data-row-key');
  const idx = allRows.findIndex(r => _rowKey(r) === currentKey);
  if (idx < 0 || idx >= allRows.length - 1) {
    cancelEdit();
    return;
  }
  const nextKey = _rowKey(allRows[idx + 1]);
  startEdit(nextKey, field);
}

/* ── ドラフト行 ──────────────────────────────────────────── */
function bindAddButtons() {
  document.getElementById('btn-add-sales')?.addEventListener('click', () => addDraftRow('sales'));
  document.getElementById('btn-add-cost')?.addEventListener('click', () => addDraftRow('cost'));
}

function addDraftRow(source) {
  // 既に編集中の行があれば破棄して新規ドラフトに集中
  if (_editingRowKey) cancelEdit();
  _draftSeq++;
  const today = (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0, 10);
  const draft = {
    source: 'draft',
    realSource: source,            // 'sales' or 'cost'
    draftId: _draftSeq,
    date: today,
    subject: '',
    subjectCode: '',
    divisionCode: source === 'cost' ? '2' : '',
    amount: 0,
    taxRate: source === 'sales' ? 10 : 10,
    memo: '',
  };
  _draftRows.push(draft);
  renderTable();
}

async function commitDraftRow(draftId) {
  const draft = _draftRows.find(d => String(d.draftId) === String(draftId));
  if (!draft) return;
  const errors = validateDraftRow(draft);
  if (errors.length) {
    showToast(errors[0], 'error', 3000);
    return;
  }

  try {
    let res;
    if (draft.realSource === 'sales') {
      const tax = _calcTaxAmount(draft.amount, draft.taxRate);
      res = await callGAS('addSales', {
        date: draft.date,
        customerCode: '',
        serviceCode: draft.subjectCode || '',
        serviceName: draft.subject || '',
        miscItemName: '',
        amountExTax: (Number(draft.amount) || 0) - tax,
        taxRate: Number(draft.taxRate) || 0,
        tax: tax,
        amountInTax: Number(draft.amount) || 0,
        memo: draft.memo || '',
        uncollected: 0,
      });
    } else {
      // コスト科目マスタから divisionCode / divisionName / itemName を補完
      const cm = (_settings.costMaster || []).find(it => String(it.code) === String(draft.subjectCode));
      const divisionCode = (cm && cm.divisionCode) || draft.divisionCode || '2';
      const divisionName = divisionCode === '1' ? '仕入原価' : '販管費';
      const itemName = (cm && cm.name) || draft.subject || '';
      const tax = _calcTaxAmount(draft.amount, draft.taxRate);
      res = await callGAS('addCost', {
        date: draft.date,
        divisionCode: divisionCode,
        divisionName: divisionName,
        itemCode: draft.subjectCode || '',
        itemName: itemName,
        miscItemName: '',
        taxExcluded: (Number(draft.amount) || 0) - tax,
        taxRate: Number(draft.taxRate) || 0,
        tax: tax,
        taxIncluded: Number(draft.amount) || 0,
        memo: draft.memo || '',
        unpaid: 0,
        withholdingAmount: 0,
        clientId: '',
        projectId: '',
      });
    }
    if (!res || res.status !== 'ok') {
      showToast(`登録失敗：${(res && res.message) || '不明なエラー'}`, 'error', 3500);
      return;
    }
    showToast('登録しました', 'success', 2000);
    discardDraftRow(draftId);
    await loadMonthlyData(_filterState.month);
  } catch (err) {
    console.error('[pc-monthly] commitDraftRow', err);
    showToast(`登録失敗：${err.message || err}`, 'error', 3500);
  }
}

function discardDraftRow(draftId) {
  _draftRows = _draftRows.filter(d => String(d.draftId) !== String(draftId));
  renderTable();
}

function validateDraftRow(draft) {
  const errs = [];
  if (!draft.date || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) errs.push('発生日を入力してください');
  if (!draft.subjectCode && !draft.subject) errs.push('科目を選択してください');
  const amt = Number(draft.amount) || 0;
  if (amt <= 0) errs.push('金額を入力してください');
  return errs;
}

/* ── アクションボタン ────────────────────────────────────── */
async function onMarkAsProject(rowKey) {
  const row = _monthlyData.find(r => _rowKey(r) === rowKey);
  if (!row || row.source !== 'sales') return;
  if (!confirm('この売上を案件として管理しますか？')) return;
  try {
    const res = await callGAS('markAsProject', { rowIndex: row.rowIndex });
    if (!res || res.status !== 'ok') {
      showToast(`案件化失敗：${(res && res.message) || '不明なエラー'}`, 'error', 3500);
      return;
    }
    // 楽観的更新：当該行の isProject を true に。salesRowId が新規採番されていれば反映
    row.isProject = true;
    if (res.data && res.data.salesRowId) row.salesRowId = String(res.data.salesRowId);
    showToast('案件化しました', 'success', 2000);
    renderTable();
  } catch (err) {
    console.error('[pc-monthly] onMarkAsProject', err);
    showToast(`案件化失敗：${err.message || err}`, 'error', 3500);
  }
}

async function onReconcile(rowKey) {
  const row = _monthlyData.find(r => _rowKey(r) === rowKey);
  if (!row) return;
  const today = (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0, 10);
  const paidDate = prompt('入金日（YYYY-MM-DD）', today);
  if (paidDate === null) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) {
    showToast('日付形式が不正です', 'error', 2500);
    return;
  }
  const paidAmountStr = prompt('入金額', String(row.amount));
  if (paidAmountStr === null) return;
  const paidAmount = Number(paidAmountStr);
  if (!isFinite(paidAmount) || paidAmount < 0) {
    showToast('金額が不正です', 'error', 2500);
    return;
  }
  try {
    const res = await callGAS('reconcile', {
      sheetName: row.sheetName,
      rowIndex: row.rowIndex,
      paidDate: paidDate,
      paidAmount: paidAmount,
    });
    if (!res || res.status !== 'ok') {
      showToast(`消込失敗：${(res && res.message) || '不明なエラー'}`, 'error', 3500);
      return;
    }
    row.isUnpaid = false;
    showToast('消込しました', 'success', 2000);
    renderTable();
  } catch (err) {
    console.error('[pc-monthly] onReconcile', err);
    showToast(`消込失敗：${err.message || err}`, 'error', 3500);
  }
}

function onRequestUnlock(rowKey) {
  // 仕様§2-10：UIは仕込んでおき onclick で「未実装機能：次フェーズで対応」のトースト表示に留める
  showToast('解除申請機能は次フェーズで実装予定', 'info', 3000);
}
