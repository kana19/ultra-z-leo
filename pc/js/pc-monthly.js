/**
 * ウルトラZAIMUくんレオ PC版 — pc-monthly.js
 * 月次管理画面のロジック
 * 戦略思想§3-9-3 / §1-4 / §4-3 / 3デバイス統合§6-4 §8-3 §8-4 / 技術仕様§4-5 §4-6 §9-4 §9-4-1 §9-5 §9-6 準拠
 */
'use strict';

/* ── 状態 ──────────────────────────────────────────────── */
let _monthlyData = [];                 // 統合後の全行配列（並び：date desc, rowIndex asc）
let _settings = { costMaster: [], serviceList: [] };
let _filterState = {
  month:   _todayYM(),
  status:  'all',
  type:    'all',
  project: 'all',
};
let _draftRows = [];                   // 未確定ドラフト行配列（テーブル最上段に表示）
let _editingRowKey = null;             // 編集中の rowKey（同時編集は1行のみ）
let _editingDraft = {};                // 編集中の途中値
let _draftSeq = 0;                     // ドラフトIDカウンタ
let _modalState = null;                // 紐付け候補モーダル状態 { direction, candidates, onConfirm, onClose, keydownHandler }

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

// 内消費税は app.js の calcTax(taxIncluded, taxRate)（§6-4 整数演算実装）を経由
function _calcTaxAmount(amountInclTax, taxRate) {
  return calcTax(amountInclTax, taxRate).tax;
}

function _rowKey(row) {
  return row.source === 'draft'
    ? `draft-${row.draftId}`
    : `row-${row.source}-${row.rowIndex}`;
}

/* ── 種別分類（コスト科目→typeCode・指示書5§2-1 / 集計対象4区分判定） ── */
function _classifyCost(divisionCode, itemCode) {
  const dv = String(divisionCode || '');
  const ic = String(itemCode || '');
  if (dv === '1') return { type: '仕入原価', typeCode: 'shi' };
  if (dv === '2' && ic === '21') return { type: '委託・外注', typeCode: 'gai' };
  if (dv === '2' && ic === '20') return { type: '人件費', typeCode: 'jin' };
  return { type: '販管費', typeCode: 'h' };
}

// 紐付け対象判定（GAS と同じ条件・指示書5§3-2）
function _isLinkableCost(row) {
  if (row.source !== 'cost') return false;
  if (row.divisionCode === '1') return true;
  if (row.subjectCode === '21' || row.subjectCode === '20' || row.subjectCode === '25') return true;
  return false;
}

/* ── 起動 ────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', initMonthly);

async function initMonthly() {
  pcBootstrap('monthly.html', '月次管理');
  buildMonthDropdown(_filterState.month);
  bindFilterEvents();
  bindAddButtons();
  bindModalEvents();
  await loadMonthlyData(_filterState.month);
}

function buildMonthDropdown(currentMonth) {
  const sel = document.getElementById('filter-month');
  if (!sel) return;
  sel.innerHTML = '';
  const now = new Date();
  // 過去12ヶ月＋当月（既定=当月）
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
    _sortRows(_monthlyData);
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
      const salesRowId = String(r.salesRowId || r.projectId || '');
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
        taxAmount:  (typeof r.taxAmount === 'number' && r.taxAmount > 0)
                       ? r.taxAmount
                       : _calcTaxAmount(r.amount, r.taxRate),
        memo:       String(r.memo || ''),
        isProject:  !!r.isProject,                  // U列='1' を GAS が boolean 化して返す
        isUnpaid:   Number(r.uncollected) === 1,
        isLocked:   !!r.isLocked,                   // S列=1 を GAS が boolean 化して返す
        salesRowId: salesRowId,
      });
    } else if (r.type === 'cost') {
      const cls = _classifyCost(r.divisionCode, r.itemCode);
      const linkedTo = String(r.linkedSalesRowId !== undefined ? r.linkedSalesRowId : (r.projectId || ''));
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
        taxAmount:  (typeof r.taxAmount === 'number' && r.taxAmount > 0)
                       ? r.taxAmount
                       : _calcTaxAmount(r.amount, r.taxRate),
        memo:       String(r.memo || ''),
        isProject:  linkedTo.length > 0,            // V列に値あり＝紐付け済み＝案件
        isUnpaid:   Number(r.unpaid) === 1,
        isLocked:   !!r.isLocked,
        salesRowId: linkedTo,
      });
    }
  }
  return out;
}

// 並び順：発生日 desc（直近が最上段）・同日内は rowIndex asc で安定（戦略思想§4-3）
function _sortRows(rows) {
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.rowIndex - b.rowIndex;
  });
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
  // ドラフト行を最上段（指示書5§2-2 step3 / §3-5）
  const draftHtml = _draftRows.map(d => renderDraftRow(d)).join('');
  const rowHtml   = rows.map(r => renderRow(r)).join('');
  tbody.innerHTML = (draftHtml + rowHtml) || '<tr><td colspan="9" class="loading">該当する行がありません</td></tr>';
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

  // 案件列：🔶（isProject=true）／空（false）
  const cellProject = row.isProject
    ? `<span class="pc-project-cell is-project" title="案件">🔶</span>`
    : `<span class="pc-project-cell"></span>`;

  // 操作列
  let actionsHtml = '';
  if (isEditing) {
    actionsHtml = `
      <button type="button" class="pc-action-btn pc-action-btn--save" data-action="save-edit">保存</button>
      <button type="button" class="pc-action-btn" data-action="cancel-edit">取消</button>
    `;
  } else if (row.isLocked) {
    // ロック行は「解除申請」のみ（編集不可）
    actionsHtml = `<button type="button" class="pc-action-btn pc-action-btn--unlock" data-action="request-unlock">解除申請</button>`;
  } else {
    // 案件化／解除ボタン
    //  - 売上 + !isProject：案件化（売上→コスト紐付けモーダルを開く）
    //  - 売上 + isProject ：解除（案件登録解除・指示書7§2）
    //  - コスト + !isProject + isLinkable：案件化（コスト→売上紐付けモーダルを開く）
    if (row.source === 'sales') {
      if (row.isProject) {
        actionsHtml += `<button type="button" class="btn-unmark-project" data-action="unmark-project">解除</button>`;
      } else {
        actionsHtml += `<button type="button" class="pc-action-btn pc-action-btn--project" data-action="mark-project">案件化</button>`;
      }
    } else if (row.source === 'cost' && !row.isProject && _isLinkableCost(row)) {
      actionsHtml += `<button type="button" class="pc-action-btn pc-action-btn--project" data-action="mark-project">案件化</button>`;
    }
    if (row.isUnpaid) {
      actionsHtml += `<button type="button" class="pc-action-btn pc-action-btn--reconcile" data-action="reconcile">消込</button>`;
    }
  }

  return `
    <tr class="${classes}" data-row-key="${_escHtml(key)}" data-source="${row.source}" data-row-index="${row.rowIndex}">
      <td data-field-cell="date">${cellDate}</td>
      <td>${_escHtml(row.type)}</td>
      <td data-field-cell="subject">${cellSubject}</td>
      <td class="num" data-field-cell="amount">${cellAmount}</td>
      <td data-field-cell="taxRate">${cellTaxRate}</td>
      <td class="num">${cellTax}</td>
      <td data-field-cell="memo">${cellMemo}</td>
      <td>${cellProject}</td>
      <td class="pc-row--actions">${actionsHtml}</td>
    </tr>
  `;
}

function renderDraftRow(draft) {
  const key = _rowKey(draft);
  const isCost = draft.realSource === 'cost';
  const cls = _classifyCost(draft.divisionCode, draft.subjectCode);
  // 種別表示：売上は固定、コストは区分タブUI（§1：戦略思想§1-4 / 技術仕様§9-4）
  const typeCellHtml = isCost
    ? renderCostDivisionTabs(draft)
    : `<span>売上</span>`;
  // 科目セル：コストは区分連動絞り込みプルダウン、売上はサービスマスタプルダウン
  const subjectCellHtml = isCost
    ? renderCostSubjectSelectFiltered(draft)
    : renderSubjectSelect(draft, 'draft');
  const draftTax = _calcTaxAmount(draft.amount, draft.taxRate);
  const submitDisabled = _isDraftValid(draft) ? '' : 'disabled';

  return `
    <tr class="pc-row--draft" data-row-key="${_escHtml(key)}" data-draft-id="${draft.draftId}">
      <td><input type="date" class="pc-edit-input" data-field="date" value="${_escHtml(draft.date)}"></td>
      <td>${typeCellHtml}</td>
      <td>${subjectCellHtml}</td>
      <td class="num"><input type="number" class="pc-edit-input pc-edit-input--num" data-field="amount" value="${draft.amount || ''}" placeholder="0"></td>
      <td>${renderTaxRateSelect(draft.taxRate, 'draft')}</td>
      <td class="num">${_formatYenPlain(draftTax)}</td>
      <td><input type="text" class="pc-edit-input" data-field="memo" value="${_escHtml(draft.memo)}" placeholder="メモ"></td>
      <td><span class="pc-project-cell"></span></td>
      <td class="pc-row--actions">
        <button type="button" class="pc-action-btn pc-action-btn--save" data-action="commit-draft" ${submitDisabled}>登録</button>
        <button type="button" class="pc-action-btn" data-action="discard-draft">取消</button>
      </td>
    </tr>
  `;
}

/**
 * コストドラフト行の区分タブ（仕入原価 / 販管費）
 * 区分未選択時はどちらも非アクティブ・科目プルダウンは disabled になる
 * クリック時 selectDraftDivision() で区分切替＋科目リセット＋再描画
 */
function renderCostDivisionTabs(draft) {
  const cur = String(draft.divisionCode || '');
  return `
    <div class="pc-division-tabs" role="tablist">
      <button type="button" class="pc-division-tab ${cur === '1' ? 'is-active' : ''}"
              data-action="select-division" data-division-code="1" role="tab">仕入原価</button>
      <button type="button" class="pc-division-tab ${cur === '2' ? 'is-active' : ''}"
              data-action="select-division" data-division-code="2" role="tab">販管費</button>
    </div>
  `;
}

/**
 * コストドラフト用 区分連動科目プルダウン（§1：技術仕様§9-4 §13-3）
 *  - 区分未選択：disabled・「先に区分を選択してください」
 *  - 区分=1（仕入原価）：costMaster の divisionCode='1' のみ＋諸口
 *  - 区分=2（販管費）  ：costMaster の divisionCode!='1' のみ＋諸口
 *  PC版は smartphoneVisible フラグ無視（全科目表示・技術仕様§3-3 §13-3）
 */
function renderCostSubjectSelectFiltered(draft) {
  const div = String(draft.divisionCode || '');
  if (!div) {
    return `<select class="pc-edit-input" data-field="subjectCode" disabled>
              <option value="">先に区分を選択してください</option>
            </select>`;
  }
  const items = (_settings.costMaster || [])
    .filter(it => it && it.name && String(it.name).trim() !== '')
    .filter(it => {
      const itDiv = String(it.divisionCode || '');
      return div === '1' ? itDiv === '1' : itDiv !== '1';
    });
  // 諸口を末尾に追加（divisionCode に紐付く）
  items.push({
    code: `MISC_${div}`, name: '諸口', taxRate: 10,
    divisionCode: div, type: 'misc',
  });
  const opts = ['<option value="">（科目を選択）</option>'].concat(
    items.map(it => {
      const code = String(it.code || '');
      const name = String(it.name || '');
      const sel = (String(draft.subjectCode || '') === code) ? 'selected' : '';
      return `<option value="${_escHtml(code)}" data-name="${_escHtml(name)}" data-tax="${Number(it.taxRate) || 0}" data-div="${_escHtml(it.divisionCode || div)}" ${sel}>${_escHtml(name)}</option>`;
    })
  ).join('');
  return `<select class="pc-edit-input" data-field="subjectCode">${opts}</select>`;
}

/**
 * ドラフト行の登録ボタン活性化判定（§1-7 / 戦略思想§1-4 §1-5-2）
 *  - 発生日：YYYY-MM-DD 形式
 *  - 区分タブ：コストは divisionCode 必須（売上は不要）
 *  - 科目：subjectCode 必須
 *  - 税率：taxRate が数値（0% も valid）
 *  - 金額：0円超の整数
 * いずれか満たさない場合は false → 登録ボタン disabled でAI自動確定を物理的に阻止
 */
function _isDraftValid(draft) {
  if (!draft) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(draft.date || ''))) return false;
  const isCost = draft.realSource === 'cost';
  if (isCost && !String(draft.divisionCode || '')) return false;
  if (!String(draft.subjectCode || '')) return false;
  const rate = Number(draft.taxRate);
  if (!Number.isFinite(rate)) return false;
  const amt = Number(draft.amount);
  if (!Number.isFinite(amt) || amt <= 0) return false;
  return true;
}

/**
 * ドラフト行の区分タブクリックハンドラ
 *  - 同一タブクリックは no-op
 *  - 異なるタブ選択時：subjectCode / subject をリセットし、taxRate を初期 10% に戻す
 *  - 行を再描画して科目プルダウンを再生成
 */
function selectDraftDivision(draftId, divisionCode) {
  const d = _draftRows.find(x => String(x.draftId) === String(draftId));
  if (!d) return;
  if (String(d.divisionCode || '') === String(divisionCode)) return;
  d.divisionCode = String(divisionCode);
  d.subjectCode = '';
  d.subject = '';
  d.taxRate = 10;
  renderTable();
}

/**
 * ドラフト行の登録ボタン disabled 状態のみ更新（DOM部分更新・focus保持用）
 * 入力中（amount/memo/date/taxRate/subjectCode の input イベント）から呼ばれる
 */
function _updateDraftSubmitState(tr, draft) {
  const btn = tr.querySelector('button[data-action="commit-draft"]');
  if (!btn) return;
  if (_isDraftValid(draft)) btn.removeAttribute('disabled');
  else btn.setAttribute('disabled', 'disabled');
}

function renderSubjectSelect(row, mode) {
  if (row.realSource === 'sales' || row.source === 'sales') {
    const opts = (_settings.serviceList || []).map(s => {
      const code = String(s.code || s.serviceCode || '');
      const name = String(s.name || s.serviceName || '');
      const sel = (row.subjectCode === code || row.subject === name) ? 'selected' : '';
      return `<option value="${_escHtml(code)}" data-name="${_escHtml(name)}" ${sel}>${_escHtml(name)}</option>`;
    }).join('');
    return `<select class="pc-edit-input" data-field="subjectCode">${opts || '<option value="">（マスタ未設定）</option>'}</select>`;
  }
  // cost：行の divisionCode で絞り込む（§3-3 #4 区分連動絞り込み）
  // 既存行の編集では区分自体は変更不可とし、同区分内での科目変更のみ許容する
  const rowDiv = String(row.divisionCode || '');
  const opts = (_settings.costMaster || [])
    .filter(it => it && it.name)
    .filter(it => {
      if (!rowDiv) return true; // 区分不明は全件表示（後方互換）
      const itDiv = String(it.divisionCode || '');
      return rowDiv === '1' ? itDiv === '1' : itDiv !== '1';
    })
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

  tbody.querySelectorAll('tr[data-row-key]').forEach(tr => {
    const key = tr.getAttribute('data-row-key');
    const isDraft = key.startsWith('draft-');

    if (!isDraft) {
      const row = _monthlyData.find(r => _rowKey(r) === key);
      // ロック行は編集モードに入らない・クリックでトースト
      if (row && row.isLocked) {
        tr.querySelectorAll('td[data-field-cell]').forEach(td => {
          td.addEventListener('click', () => {
            showToast('ロックされています', 'info', 2000);
          });
        });
      } else {
        // 編集可能セルクリックで startEdit
        tr.querySelectorAll('td[data-field-cell]').forEach(td => {
          const field = td.getAttribute('data-field-cell');
          if (!isFieldEditable(field, tr.getAttribute('data-source'))) return;
          td.addEventListener('click', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
            startEdit(key, field);
          });
        });
      }
    }

    // 編集中入力のキー操作
    tr.querySelectorAll('.pc-edit-input').forEach(inp => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (isDraft) discardDraftRow(key.replace('draft-', ''));
          else cancelEdit();
        } else if (e.key === 'Enter' && !e.shiftKey) {
          // 仕様§3-4：Tab/Enter は次セルへフォーカスを動かすだけ・自動保存しない
          e.preventDefault();
          if (!isDraft) {
            const field = inp.getAttribute('data-field');
            moveEditToNextRow(tr, field);
          }
          // ドラフト行はEnter抑止（誤確定防止・§1-4 / §3-5）
        }
      });
      inp.addEventListener('input', () => {
        if (isDraft) {
          const draftId = key.replace('draft-', '');
          const d = _draftRows.find(x => String(x.draftId) === String(draftId));
          if (d) {
            const field = inp.getAttribute('data-field');
            captureFieldValue(d, inp, field);
            updateDraftTaxDisplay(tr, d);
            // §1-7：登録ボタン活性化条件をリアルタイム判定
            _updateDraftSubmitState(tr, d);
            // 科目プルダウン変更時は税率セレクトの表示も同期（taxRate は既に更新済み）
            if (field === 'subjectCode') {
              const taxSel = tr.querySelector('select[data-field="taxRate"]');
              if (taxSel) taxSel.value = String(Number(d.taxRate) || 0);
            }
          }
        } else {
          const field = inp.getAttribute('data-field');
          captureFieldValue(_editingDraft, inp, field);
        }
      });
    });

    tr.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.getAttribute('data-action');
        const rowKey = tr.getAttribute('data-row-key');
        switch (action) {
          case 'mark-project':    onMarkAsProject(rowKey);   break;
          case 'unmark-project':  onUnmarkAsProject(rowKey); break;
          case 'reconcile':       onReconcile(rowKey);       break;
          case 'request-unlock':  onRequestUnlock(rowKey);   break;
          case 'save-edit':       commitEdit();              break;
          case 'cancel-edit':     cancelEdit();              break;
          case 'commit-draft':    commitDraftRow(rowKey.replace('draft-', '')); break;
          case 'discard-draft':   discardDraftRow(rowKey.replace('draft-', '')); break;
          case 'select-division': {
            const draftId = rowKey.replace('draft-', '');
            const divCode = btn.getAttribute('data-division-code');
            selectDraftDivision(draftId, divCode);
            break;
          }
        }
      });
      // §1-4 AI自動確定禁止：登録・案件化系ボタンは Enter キーで反応させない
      const action = btn.getAttribute('data-action');
      if (action === 'commit-draft' || action === 'mark-project' || action === 'unmark-project') {
        btn.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
          }
        });
      }
    });
  });
}

function isFieldEditable(field, source) {
  // 仕様§2-4 / §3-4：date / subject(=subjectCode) / amount / taxRate / memo
  return ['date', 'subject', 'amount', 'taxRate', 'memo'].includes(field);
}

function captureFieldValue(target, inp, field) {
  let v = inp.value;
  if (field === 'amount') v = Number(v) || 0;
  if (field === 'taxRate') v = Number(v) || 0;
  if (field === 'subject') field = 'subjectCode';
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
  const numCells = tr.querySelectorAll('td.num');
  // 金額・消費税の2列が num。最後の num が消費税列
  if (numCells && numCells.length >= 2) {
    numCells[numCells.length - 1].textContent = _formatYenPlain(_calcTaxAmount(draft.amount, draft.taxRate));
  }
}

/* ── インライン編集 ──────────────────────────────────────── */
function startEdit(rowKey, field) {
  if (_editingRowKey === rowKey) return;
  if (_editingRowKey) cancelEdit();
  const row = _monthlyData.find(r => _rowKey(r) === rowKey);
  if (!row) return;
  if (row.isLocked) {
    showToast('ロックされています', 'info', 2000);
    return;
  }
  _editingRowKey = rowKey;
  _editingDraft = { ...row };
  renderTable();
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

// 「保存」ボタン押下のみで updateRow を呼ぶ（Tab/Enter/フォーカス外しでは送信しない・§1-4 / §3-4）
async function commitEdit() {
  const rowKey = _editingRowKey;
  if (!rowKey) return;
  const row = _monthlyData.find(r => _rowKey(r) === rowKey);
  if (!row) { cancelEdit(); return; }

  // 編集ドラフトから fields 構築
  // amount / taxRate は常に送信（指示書7§1：GAS 側 calcTax_ 整数演算で K列消費税を毎回正規化するため）
  // date / memo / subjectCode / subjectName は変更があった場合のみ送信
  const fields = {};
  if (_editingDraft.date && _editingDraft.date !== row.date) fields.date = _editingDraft.date;
  fields.amount  = Number(_editingDraft.amount)  || 0;
  fields.taxRate = Number(_editingDraft.taxRate) || 0;
  if (_editingDraft.memo !== undefined && _editingDraft.memo !== row.memo) {
    fields.memo = _editingDraft.memo;
  }
  if (_editingDraft.subjectCode && _editingDraft.subjectCode !== row.subjectCode) {
    fields.subjectCode = _editingDraft.subjectCode;
    fields.subjectName = _editingDraft.subject || '';
  }

  try {
    const res = await callGAS('updateRow', {
      sheetName: row.sheetName,
      rowIndex: row.rowIndex,
      fields: fields,
    });
    if (!res || res.status !== 'ok') {
      const msg = (res && res.message) || '不明なエラー';
      showToast(`保存失敗：${msg}`, 'error', 3500);
      return;
    }
    // ローカル state にも反映
    Object.assign(row, {
      date:    fields.date    !== undefined ? fields.date    : row.date,
      amount:  fields.amount,
      taxRate: fields.taxRate,
      memo:    fields.memo    !== undefined ? fields.memo    : row.memo,
      subjectCode: fields.subjectCode !== undefined ? fields.subjectCode : row.subjectCode,
      subject:     fields.subjectName !== undefined ? fields.subjectName : row.subject,
    });
    if (res.data && res.data.recalculated) {
      row.taxAmount = Number(res.data.recalculated.taxAmount) || 0;
    } else {
      row.taxAmount = _calcTaxAmount(row.amount, row.taxRate);
    }
    showToast('保存しました', 'success', 2000);
    cancelEdit();
  } catch (err) {
    console.error('[pc-monthly] commitEdit', err);
    showToast(`保存失敗：${err.message || err}`, 'error', 3500);
  }
}

function cancelEdit() {
  _editingRowKey = null;
  _editingDraft = {};
  renderTable();
}

function moveEditToNextRow(currentTr, field) {
  // フィルタ後の表示順での次行に移動
  const visibleRows = applyFilters(_monthlyData);
  const currentKey = currentTr.getAttribute('data-row-key');
  const idx = visibleRows.findIndex(r => _rowKey(r) === currentKey);
  if (idx < 0 || idx >= visibleRows.length - 1) {
    cancelEdit();
    return;
  }
  const nextKey = _rowKey(visibleRows[idx + 1]);
  startEdit(nextKey, field);
}

/* ── ドラフト行 ──────────────────────────────────────────── */
function bindAddButtons() {
  document.getElementById('btn-add-sales')?.addEventListener('click', () => addDraftRow('sales'));
  document.getElementById('btn-add-cost')?.addEventListener('click', () => addDraftRow('cost'));
}

function addDraftRow(source) {
  if (_editingRowKey) cancelEdit();
  _draftSeq++;
  const today = (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0, 10);
  const draft = {
    source: 'draft',
    realSource: source,
    draftId: _draftSeq,
    date: today,
    subject: '',
    subjectCode: '',
    // §1：コストは初期 区分未選択（販管費/仕入原価のタブで明示選択させる）
    divisionCode: '',
    amount: 0,
    taxRate: 10,
    memo: '',
  };
  // 最上段に挿入（§2-2 step3）
  _draftRows.unshift(draft);
  renderTable();
}

async function commitDraftRow(draftId) {
  const draft = _draftRows.find(d => String(d.draftId) === String(draftId));
  if (!draft) return;
  // §1-7：disabled の登録ボタン誤発火対策（キーボード経由等）も含む二重防御
  if (!_isDraftValid(draft)) {
    const errors = validateDraftRow(draft);
    showToast(errors[0] || '入力に不足があります', 'error', 3000);
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
      // 区分タブで明示選択された divisionCode を最優先とする（マスタ未登録の諸口にも対応）
      const cm = (_settings.costMaster || []).find(it => String(it.code) === String(draft.subjectCode));
      const divisionCode = String(draft.divisionCode || (cm && cm.divisionCode) || '2');
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
  // §1：コストは区分タブ未選択を弾く
  if (draft.realSource === 'cost' && !String(draft.divisionCode || '')) {
    errs.push('区分（仕入原価／販管費）を選択してください');
  }
  if (!draft.subjectCode && !draft.subject) errs.push('科目を選択してください');
  const rate = Number(draft.taxRate);
  if (!Number.isFinite(rate)) errs.push('税率を選択してください');
  const amt = Number(draft.amount) || 0;
  if (amt <= 0) errs.push('金額を入力してください');
  return errs;
}

/* ── 案件化フロー（売上→コスト・コスト→売上 の双方向） ─── */
async function onMarkAsProject(rowKey) {
  const row = _monthlyData.find(r => _rowKey(r) === rowKey);
  if (!row) return;
  if (row.source === 'sales') {
    await onMarkAsProjectFromSales(row);
  } else if (row.source === 'cost') {
    await onMarkAsProjectFromCost(row);
  }
}

// 案件登録解除（指示書7§2 / 戦略思想§1-5-2 AI自動確定禁止：提案ボタン → 確認モーダル → 確定の3ステップ）
//  - 売上行の U列 を空欄に戻す（GAS unmarkAsProject）
//  - 紐付け済みコストの V列（紐付け先売上行ID）は GAS 側で意図的に保持
//    → 紐付け解除は別途案件管理画面または各コストの個別操作で実施
async function onUnmarkAsProject(rowKey) {
  const row = _monthlyData.find(r => _rowKey(r) === rowKey);
  if (!row) return;
  if (row.source !== 'sales' || !row.isProject) return;

  const message = `${row.date} / ${row.subject} / ¥${_formatYenPlain(row.amount)} の案件登録を解除します。紐付け済みのコストの紐付けは別途解除が必要です。`;
  openZeroCandidatesPrompt({
    message: message,
    target: null,
    confirmLabel: '解除する',
    onConfirm: async () => {
      try {
        const res = await callGAS('unmarkAsProject', {
          rowIndex: row.rowIndex,
          sheetName: '売上',
        });
        if (!res || res.status !== 'ok') {
          throw new Error((res && res.message) || '解除に失敗しました');
        }
        row.isProject = false;
        showToast('案件登録を解除しました', 'success', 2000);
        closeLinkCandidatesModal();
        renderTable();
      } catch (err) {
        console.error('[pc-monthly] onUnmarkAsProject', err);
        showLinkCandidatesError(err.message || String(err));
      }
    }
  });
}

// 売上→コスト方向：候補をチェックボックスで複数選択 → 確定
async function onMarkAsProjectFromSales(row) {
  // salesRowId が空の場合は markAsProject 呼び出し時に GAS が救済採番する。
  // ただし候補取得には salesDate が必要・getLinkCandidates の現実装は salesRowId を必須とするため
  // T列未採番行は先に markAsProject を呼んで採番してから候補取得 → 改めて確定の2段構えにする…
  // が複雑になるため、本指示書では salesRowId が無い行は自動採番のみ実施・候補なしダイアログに進める
  const candidates = await fetchLinkCandidatesForSales(row);
  if (candidates === null) return; // エラー時はトースト済み

  if (candidates.length === 0) {
    // 候補ゼロ：「経費0件案件として登録しますか？」ダイアログ（§3-1 step3）
    openZeroCandidatesPrompt({
      message: '該当範囲に紐付け候補がありません。経費0件案件として登録しますか？',
      target: { kind: 'sales', date: row.date, subject: row.subject, amount: row.amount, memo: row.memo },
      confirmLabel: '登録する',
      onConfirm: async () => {
        await callMarkAndLink(row, []);
      }
    });
    return;
  }

  openLinkCandidatesModal({
    direction: 'sales-to-cost',
    hint: `「${row.date} の前月頭〜${row.date}」までに発生した集計対象4区分の経費`,
    target: { kind: 'sales', date: row.date, subject: row.subject, amount: row.amount, memo: row.memo },
    candidates: candidates,
    onConfirm: async (selectedCostRowIndexes) => {
      await callMarkAndLink(row, selectedCostRowIndexes);
    }
  });
}

async function fetchLinkCandidatesForSales(row) {
  if (!row.salesRowId) {
    // salesRowId 未採番の場合は候補取得不可・ゼロ件として扱う
    return [];
  }
  try {
    const res = await callGAS('getLinkCandidates', {
      direction: 'sales-to-cost',
      salesRowId: row.salesRowId,
      salesDate: row.date,
    });
    if (!res || res.status !== 'ok') {
      showToast(`候補取得失敗：${(res && res.message) || '不明なエラー'}`, 'error', 3500);
      return null;
    }
    return (res.data && Array.isArray(res.data.candidates)) ? res.data.candidates : [];
  } catch (err) {
    console.error('[pc-monthly] fetchLinkCandidatesForSales', err);
    showToast(`候補取得失敗：${err.message || err}`, 'error', 3500);
    return null;
  }
}

// 案件化＋紐付けの GAS 呼び出し（売上→コスト確定時）
async function callMarkAndLink(salesRow, selectedCostRowIndexes) {
  try {
    // 1. markAsProject（U列='1' 化＋必要なら T列救済採番）
    const markRes = await callGAS('markAsProject', { rowIndex: salesRow.rowIndex });
    if (!markRes || markRes.status !== 'ok') {
      throw new Error((markRes && markRes.message) || '案件化に失敗しました');
    }
    const newSalesRowId = (markRes.data && markRes.data.salesRowId) || salesRow.salesRowId;
    salesRow.isProject = true;
    if (newSalesRowId) salesRow.salesRowId = String(newSalesRowId);

    // 2. linkTransactions（複数 items 一括・§1-5）
    if (selectedCostRowIndexes && selectedCostRowIndexes.length > 0) {
      const items = selectedCostRowIndexes.map(rIdx => ({
        rowIndex: rIdx,
        salesRowId: salesRow.salesRowId,
      }));
      const linkRes = await callGAS('linkTransactions', { items });
      if (!linkRes || linkRes.status !== 'ok') {
        throw new Error((linkRes && linkRes.message) || '紐付けに失敗しました');
      }
      // ローカル state：選択コスト行に🔶を反映
      for (const rIdx of selectedCostRowIndexes) {
        const c = _monthlyData.find(r => r.source === 'cost' && r.rowIndex === rIdx);
        if (c) {
          c.isProject = true;
          c.salesRowId = salesRow.salesRowId;
        }
      }
    }
    showToast('案件化しました', 'success', 2000);
    closeLinkCandidatesModal();
    renderTable();
  } catch (err) {
    console.error('[pc-monthly] callMarkAndLink', err);
    showLinkCandidatesError(err.message || String(err));
  }
}

// コスト→売上方向：候補をラジオで単一選択 → 確定
async function onMarkAsProjectFromCost(row) {
  const candidates = await fetchLinkCandidatesForCost(row);
  if (candidates === null) return;

  if (candidates.length === 0) {
    // §3-2 step3：閉じるのみのダイアログ（経費0件案件は概念上売上案件化時のみ）
    openZeroCandidatesPrompt({
      message: '該当範囲に売上候補がありません。',
      target: { kind: 'cost', date: row.date, type: row.type, subject: row.subject, amount: row.amount, memo: row.memo },
      confirmLabel: null,                  // 確定ボタン非表示
      onConfirm: null
    });
    return;
  }

  openLinkCandidatesModal({
    direction: 'cost-to-sales',
    hint: `「${row.date} 〜 ${row.date} の翌月末」までに発生した売上`,
    target: { kind: 'cost', date: row.date, type: row.type, subject: row.subject, amount: row.amount, memo: row.memo },
    candidates: candidates,
    onConfirm: async (selectedSalesRowId) => {
      // selectedSalesRowId はラジオ選択された売上の rowIndex
      await callMarkAndLinkFromCost(row, selectedSalesRowId);
    }
  });
}

async function fetchLinkCandidatesForCost(row) {
  try {
    const res = await callGAS('getLinkCandidates', {
      direction: 'cost-to-sales',
      costRowIndex: row.rowIndex,
      costDate: row.date,
    });
    if (!res || res.status !== 'ok') {
      showToast(`候補取得失敗：${(res && res.message) || '不明なエラー'}`, 'error', 3500);
      return null;
    }
    return (res.data && Array.isArray(res.data.candidates)) ? res.data.candidates : [];
  } catch (err) {
    console.error('[pc-monthly] fetchLinkCandidatesForCost', err);
    showToast(`候補取得失敗：${err.message || err}`, 'error', 3500);
    return null;
  }
}

async function callMarkAndLinkFromCost(costRow, selectedSalesRowIndex) {
  try {
    const sales = _findSalesByRowIndex(selectedSalesRowIndex) || _findSalesInCandidates(selectedSalesRowIndex);
    if (!sales || !sales.salesRowId) {
      // ローカルにいない（フィルタ外・別月）売上の場合は markAsProject の戻り salesRowId を信頼
      const markRes = await callGAS('markAsProject', { rowIndex: selectedSalesRowIndex });
      if (!markRes || markRes.status !== 'ok') {
        throw new Error((markRes && markRes.message) || '案件化に失敗しました');
      }
      const newSalesRowId = String((markRes.data && markRes.data.salesRowId) || '');
      if (!newSalesRowId) throw new Error('salesRowId が取得できませんでした');
      const linkRes = await callGAS('linkTransactions', {
        items: [{ rowIndex: costRow.rowIndex, salesRowId: newSalesRowId }],
      });
      if (!linkRes || linkRes.status !== 'ok') {
        throw new Error((linkRes && linkRes.message) || '紐付けに失敗しました');
      }
      costRow.isProject = true;
      costRow.salesRowId = newSalesRowId;
      showToast('案件として紐付けました', 'success', 2000);
      closeLinkCandidatesModal();
      renderTable();
      return;
    }

    // ローカルに見つかった場合：markAsProject → linkTransactions
    const markRes = await callGAS('markAsProject', { rowIndex: sales.rowIndex });
    if (!markRes || markRes.status !== 'ok') {
      throw new Error((markRes && markRes.message) || '案件化に失敗しました');
    }
    const linkRes = await callGAS('linkTransactions', {
      items: [{ rowIndex: costRow.rowIndex, salesRowId: sales.salesRowId }],
    });
    if (!linkRes || linkRes.status !== 'ok') {
      throw new Error((linkRes && linkRes.message) || '紐付けに失敗しました');
    }
    sales.isProject = true;
    costRow.isProject = true;
    costRow.salesRowId = sales.salesRowId;
    showToast('案件として紐付けました', 'success', 2000);
    closeLinkCandidatesModal();
    renderTable();
  } catch (err) {
    console.error('[pc-monthly] callMarkAndLinkFromCost', err);
    showLinkCandidatesError(err.message || String(err));
  }
}

function _findSalesByRowIndex(rowIndex) {
  return _monthlyData.find(r => r.source === 'sales' && r.rowIndex === Number(rowIndex));
}
function _findSalesInCandidates(rowIndex) {
  if (!_modalState || !Array.isArray(_modalState.candidates)) return null;
  const c = _modalState.candidates.find(x => Number(x.rowIndex) === Number(rowIndex));
  if (!c) return null;
  return { rowIndex: c.rowIndex, salesRowId: c.salesRowId };
}

/* ── 紐付け候補モーダル（共通UI・指示書5§2-4 / §3-3） ─── */
function bindModalEvents() {
  const modal = document.getElementById('pc-link-candidates-modal');
  if (!modal) return;
  modal.addEventListener('click', (e) => {
    const action = e.target && e.target.dataset && e.target.dataset.action;
    if (action === 'cancel') {
      closeLinkCandidatesModal();
    } else if (action === 'confirm') {
      handleModalConfirm();
    }
  });
}

function openLinkCandidatesModal({ direction, hint, target, candidates, onConfirm }) {
  const modal = document.getElementById('pc-link-candidates-modal');
  const list  = document.getElementById('pc-link-candidates-list');
  const hintEl = document.getElementById('pc-link-candidates-hint');
  const errEl  = document.getElementById('pc-link-candidates-error');
  if (!modal || !list || !hintEl) return;

  // §2 対象取引情報ヘッダー（売上案件化時・コスト案件化時 共通）
  _renderModalTargetHeader(target);
  hintEl.textContent = hint || '';
  if (errEl) { errEl.hidden = true; errEl.textContent = ''; }

  const inputType = direction === 'cost-to-sales' ? 'radio' : 'checkbox';
  const inputName = 'pc-link-cand';

  list.innerHTML = candidates.map((c, i) => {
    const checked = (direction === 'sales-to-cost' && c.currentlyLinked) ? 'checked' : '';
    const projectFlag = (direction === 'cost-to-sales' && c.isProject)
      ? `<span class="pc-link-candidates-row__project-flag" title="既に案件化済み">🔶</span>`
      : '';
    const hashCls = (direction === 'sales-to-cost' && c.currentlyLinked) ? 'is-current-link' : '';
    const valueAttr = (direction === 'cost-to-sales')
      ? String(c.rowIndex)        // ラジオ：売上 rowIndex
      : String(c.rowIndex);       // チェックボックス：コスト rowIndex
    return `
      <label class="pc-link-candidates-row ${hashCls}">
        <input type="${inputType}" name="${inputName}" value="${valueAttr}" ${checked}>
        <span>${_escHtml(c.date || '')}</span>
        <span>${_escHtml(c.subject || '')}${projectFlag}</span>
        <span class="pc-link-candidates-row__amount">${_formatYenPlain(c.amount || 0)}</span>
        <span class="pc-link-candidates-row__memo">${_escHtml(c.memo || '')}</span>
      </label>
    `;
  }).join('');

  _modalState = { direction, candidates, onConfirm, mode: 'list' };

  // ESC キー
  const keydownHandler = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeLinkCandidatesModal();
    }
  };
  document.addEventListener('keydown', keydownHandler);
  _modalState.keydownHandler = keydownHandler;

  modal.hidden = false;
}

// 候補ゼロ用の特殊モーダル（「経費0件案件として登録しますか？」 or 「該当範囲に売上候補がありません」）
function openZeroCandidatesPrompt({ message, target, confirmLabel, onConfirm }) {
  const modal = document.getElementById('pc-link-candidates-modal');
  const list  = document.getElementById('pc-link-candidates-list');
  const hintEl = document.getElementById('pc-link-candidates-hint');
  const errEl  = document.getElementById('pc-link-candidates-error');
  const confirmBtn = document.getElementById('pc-link-candidates-confirm');
  if (!modal || !list || !hintEl) return;

  // §2 対象取引情報ヘッダー（候補0件時もどの取引に対する確認かを明示）
  _renderModalTargetHeader(target);
  hintEl.textContent = '';
  if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
  list.innerHTML = `<div class="pc-link-candidates-empty">${_escHtml(message)}</div>`;

  if (confirmBtn) {
    if (confirmLabel) {
      confirmBtn.hidden = false;
      confirmBtn.textContent = confirmLabel;
    } else {
      confirmBtn.hidden = true;
    }
  }

  _modalState = { direction: 'zero', onConfirm, mode: 'zero' };

  const keydownHandler = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeLinkCandidatesModal();
    }
  };
  document.addEventListener('keydown', keydownHandler);
  _modalState.keydownHandler = keydownHandler;

  modal.hidden = false;
}

async function handleModalConfirm() {
  if (!_modalState) return;
  const direction = _modalState.direction;
  const onConfirm = _modalState.onConfirm;
  if (!onConfirm) return;

  if (_modalState.mode === 'zero') {
    // 経費0件案件として登録
    await onConfirm();
    return;
  }

  if (direction === 'sales-to-cost') {
    const list = document.getElementById('pc-link-candidates-list');
    const checked = list ? list.querySelectorAll('input[type="checkbox"]:checked') : [];
    const selected = Array.from(checked).map(i => Number(i.value)).filter(n => !isNaN(n));
    await onConfirm(selected);
    return;
  }

  if (direction === 'cost-to-sales') {
    const list = document.getElementById('pc-link-candidates-list');
    const r = list ? list.querySelector('input[type="radio"]:checked') : null;
    if (!r) {
      showLinkCandidatesError('売上を1件選択してください');
      return;
    }
    const selectedRowIndex = Number(r.value);
    if (isNaN(selectedRowIndex)) {
      showLinkCandidatesError('選択値が不正です');
      return;
    }
    await onConfirm(selectedRowIndex);
    return;
  }
}

function closeLinkCandidatesModal() {
  const modal = document.getElementById('pc-link-candidates-modal');
  if (modal) modal.hidden = true;
  if (_modalState && _modalState.keydownHandler) {
    document.removeEventListener('keydown', _modalState.keydownHandler);
  }
  // confirm ボタンの非表示状態を戻す
  const confirmBtn = document.getElementById('pc-link-candidates-confirm');
  if (confirmBtn) {
    confirmBtn.hidden = false;
    confirmBtn.textContent = '確定';
  }
  // 対象取引情報ヘッダーをクリア（次回オープン時の混入防止）
  const targetEl = document.getElementById('pc-link-candidates-target');
  if (targetEl) {
    targetEl.innerHTML = '';
    targetEl.hidden = true;
  }
  _modalState = null;
}

/**
 * 候補プルダウンモーダルの対象取引情報ヘッダーを描画（指示書6§2 / 技術仕様§9-4-1）
 *  target = null/undefined → 非表示
 *  target = { kind: 'sales'|'cost', date, type?, subject, amount, memo }
 *    - kind='sales' → 「対象売上：YYYY-MM-DD / 科目 / ¥金額 / メモ」
 *    - kind='cost'  → 「対象コスト：YYYY-MM-DD / 種別 / 科目 / ¥金額 / メモ」
 *  メモ空欄時は区切り「/」ごと省略
 */
function _renderModalTargetHeader(target) {
  const targetEl = document.getElementById('pc-link-candidates-target');
  if (!targetEl) return;
  if (!target) {
    targetEl.innerHTML = '';
    targetEl.hidden = true;
    return;
  }
  const labelText = target.kind === 'sales' ? '対象売上：' : '対象コスト：';
  const sep = `<span class="pc-link-candidates-target__sep">/</span>`;
  const parts = [
    `<span class="pc-link-candidates-target__label">${_escHtml(labelText)}</span>`,
    `<span class="pc-link-candidates-target__date">${_escHtml(target.date || '')}</span>`,
  ];
  if (target.kind === 'cost' && target.type) {
    parts.push(sep);
    parts.push(`<span class="pc-link-candidates-target__type">${_escHtml(target.type)}</span>`);
  }
  parts.push(sep);
  parts.push(`<span class="pc-link-candidates-target__subject">${_escHtml(target.subject || '')}</span>`);
  parts.push(sep);
  parts.push(`<span class="pc-link-candidates-target__amount">¥${_formatYenPlain(target.amount || 0)}</span>`);
  const memoTrim = String(target.memo || '').trim();
  if (memoTrim) {
    parts.push(sep);
    parts.push(`<span class="pc-link-candidates-target__memo">${_escHtml(memoTrim)}</span>`);
  }
  targetEl.innerHTML = parts.join('');
  targetEl.hidden = false;
}

function showLinkCandidatesError(msg) {
  const errEl = document.getElementById('pc-link-candidates-error');
  if (!errEl) {
    showToast(msg, 'error', 3500);
    return;
  }
  errEl.textContent = msg;
  errEl.hidden = false;
}

/* ── アクションボタン（消込・解除申請） ──────────────────── */
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

async function onRequestUnlock(rowKey) {
  const row = _monthlyData.find(r => _rowKey(r) === rowKey);
  if (!row) return;
  const reason = prompt('解除申請の理由（任意）', '');
  if (reason === null) return; // キャンセル
  try {
    const res = await callGAS('requestUnlock', {
      sheetName: row.sheetName,
      rowIndex: row.rowIndex,
      reason: reason || '',
    });
    if (!res || res.status !== 'ok') {
      showToast(`解除申請失敗：${(res && res.message) || '不明なエラー'}`, 'error', 3500);
      return;
    }
    showToast('解除申請を送信しました', 'success', 2500);
  } catch (err) {
    console.error('[pc-monthly] onRequestUnlock', err);
    showToast(`解除申請失敗：${err.message || err}`, 'error', 3500);
  }
}
