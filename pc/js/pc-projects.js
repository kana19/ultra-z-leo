/* pc-projects.js — PC版 案件粗利タブ
 * 戦略思想§3-9-3 軸B 管理会計
 * サブビュー：粗利レポート / 案件マスタ管理 / 紐付け作業
 */
'use strict';

/* =====================
 * サブビュー切替
 * ===================== */

/**
 * 案件粗利タブを開いたとき／タブ切替直後に呼ぶ。
 * サブビュー切替ボタンをバインドし、初期表示は「粗利レポート」。
 */
function initProjectSubviews() {
  const navButtons = document.querySelectorAll('.pc-project-subview-nav .pc-subview-btn');
  navButtons.forEach(btn => {
    // 多重バインド回避
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';

    btn.addEventListener('click', () => {
      const target = btn.dataset.subview;
      navButtons.forEach(b => b.classList.toggle('pc-subview-btn--active', b === btn));
      document.querySelectorAll('.pc-project-subview').forEach(panel => {
        panel.style.display = panel.dataset.subviewPanel === target ? '' : 'none';
      });
      if (target === 'report') loadProjectGrossProfit();
      if (target === 'master') loadProjectMaster();
      if (target === 'link') loadProjectLink();
    });
  });

  // 初期は「粗利レポート」
  const reportBtn = document.querySelector('.pc-subview-btn[data-subview="report"]');
  const masterPanel = document.querySelector('[data-subview-panel="master"]');
  const linkPanel = document.querySelector('[data-subview-panel="link"]');
  navButtons.forEach(b => b.classList.toggle('pc-subview-btn--active', b === reportBtn));
  if (masterPanel) masterPanel.style.display = 'none';
  if (linkPanel) linkPanel.style.display = 'none';
  const reportPanel = document.querySelector('[data-subview-panel="report"]');
  if (reportPanel) reportPanel.style.display = '';
  loadProjectGrossProfit();
}

/* =====================
 * 粗利レポート（既存）
 * ===================== */

async function loadProjectGrossProfit() {
  const panel = document.querySelector('[data-subview-panel="report"]');
  if (!panel) return;

  panel.innerHTML = '<div class="pc-loading">読み込み中...</div>';

  let res;
  try {
    res = await callGAS('getProjectGrossProfit', {});
  } catch (e) {
    panel.innerHTML = `<div class="pc-error">通信エラー：${escHtmlPg(e.message || 'unknown')}</div>`;
    return;
  }
  if (!res || res.status !== 'ok') {
    panel.innerHTML = `<div class="pc-error">取得失敗：${escHtmlPg(res && res.message || '不明なエラー')}</div>`;
    return;
  }
  renderProjectGrossProfitTable(panel, Array.isArray(res.data) ? res.data : []);
}

function renderProjectGrossProfitTable(container, projects) {
  if (!projects || projects.length === 0) {
    container.innerHTML = `
      <div class="pc-empty">
        <p>紐付けられた案件がまだありません。</p>
        <p class="pc-empty__hint">「案件マスタ管理」サブビューで案件を登録し、「紐付け作業」サブビューで既存の売上・コスト行に紐付けると、ここに案件別の粗利が表示されます。</p>
      </div>
    `;
    return;
  }

  const fy = n => '¥' + (Number(n) || 0).toLocaleString('ja-JP');
  const fr = r => (r === null || r === undefined) ? '—' : (Number(r).toFixed(1) + '%');

  const rows = projects.map(p => `
    <tr>
      <td>${escHtmlPg(p.projectId)}</td>
      <td>${escHtmlPg(p.projectName)}</td>
      <td>${escHtmlPg(p.customerName)}</td>
      <td class="num">${fy(p.sales)}</td>
      <td class="num">${fy(p.cost)}</td>
      <td class="num ${Number(p.grossProfit) < 0 ? 'negative' : ''}">${fy(p.grossProfit)}</td>
      <td class="num">${fr(p.grossProfitRate)}</td>
      <td><span class="pc-status-${escHtmlPg(p.status || 'unknown')}">${escHtmlPg(p.status || 'unknown')}</span></td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div class="pc-project-grossprofit">
      <h2>案件別 売上・原価・粗利</h2>
      <p class="pc-note">案件Noで紐付けされた売上行・コスト行を横串で集計しています。科目区分は問いません（外注工賃・給料賃金・材料費等すべて含む）。青色申告決算書の損益計算には影響しません。</p>
      <table class="pc-table">
        <thead>
          <tr>
            <th>案件ID</th>
            <th>案件名</th>
            <th>顧客名</th>
            <th class="num">案件売上</th>
            <th class="num">案件原価</th>
            <th class="num">案件粗利</th>
            <th class="num">粗利率</th>
            <th>状態</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

/* =====================
 * 案件マスタ管理
 * ===================== */

let projectMasterCache = [];
let projectMasterFilter = 'active';

async function loadProjectMaster() {
  const panel = document.querySelector('[data-subview-panel="master"]');
  if (!panel) return;

  panel.innerHTML = '<div class="pc-loading">読み込み中...</div>';

  let res;
  try {
    res = await callGAS('getProjects', {});
  } catch (e) {
    panel.innerHTML = `<div class="pc-error">通信エラー：${escHtmlPg(e.message || 'unknown')}</div>`;
    return;
  }
  if (!res || res.status !== 'ok') {
    panel.innerHTML = `<div class="pc-error">取得失敗：${escHtmlPg(res && res.message || '不明なエラー')}</div>`;
    return;
  }
  projectMasterCache = Array.isArray(res.data) ? res.data : [];
  renderProjectMaster(panel);
}

function renderProjectMaster(panel) {
  const filtered = projectMasterFilter === 'all'
    ? projectMasterCache
    : projectMasterCache.filter(p => (p.status || 'active') === projectMasterFilter);

  const filterLabels = { active: '進行中', completed: '完了', canceled: 'キャンセル', all: 'すべて' };
  const filterButtons = ['active', 'completed', 'canceled', 'all'].map(f => {
    const cls = f === projectMasterFilter ? 'pc-filter-btn pc-filter-btn--active' : 'pc-filter-btn';
    return `<button class="${cls}" data-filter="${f}">${filterLabels[f]}</button>`;
  }).join('');

  const rows = filtered.length === 0
    ? `<tr><td colspan="8" class="pc-empty">該当する案件がありません</td></tr>`
    : filtered.map(p => `
      <tr>
        <td>${escHtmlPg(p.projectId)}</td>
        <td>${escHtmlPg(p.projectName)}</td>
        <td>${escHtmlPg(p.customerName)}</td>
        <td>${escHtmlPg(p.startDate)}</td>
        <td>${escHtmlPg(p.endDate)}</td>
        <td><span class="pc-status-${escHtmlPg(p.status || 'unknown')}">${escHtmlPg(p.status || 'unknown')}</span></td>
        <td>${escHtmlPg(p.memo)}</td>
        <td>
          <button class="pc-action-btn" data-action="edit" data-id="${escHtmlPg(p.projectId)}">編集</button>
          <button class="pc-action-btn pc-action-btn--danger" data-action="delete" data-id="${escHtmlPg(p.projectId)}">削除</button>
        </td>
      </tr>
    `).join('');

  panel.innerHTML = `
    <div class="pc-project-master">
      <div class="pc-master-header">
        <h2>案件マスタ管理</h2>
        <button class="pc-primary-btn" id="pc-project-add-btn">＋ 新規案件追加</button>
      </div>
      <div class="pc-filter-row">${filterButtons}</div>
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

  // イベントバインド
  const addBtn = panel.querySelector('#pc-project-add-btn');
  if (addBtn) addBtn.addEventListener('click', () => openProjectModal('add'));

  panel.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => openProjectModal('edit', btn.dataset.id));
  });
  panel.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => deleteProjectFlow(btn.dataset.id));
  });
  panel.querySelectorAll('.pc-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      projectMasterFilter = btn.dataset.filter;
      renderProjectMaster(panel);
    });
  });
}

/**
 * 新規追加・編集モーダルを開く
 * mode='add' / mode='edit' (projectId 必須)
 */
function openProjectModal(mode, projectId) {
  const isEdit = mode === 'edit';
  const target = isEdit ? projectMasterCache.find(p => p.projectId === projectId) : null;
  if (isEdit && !target) {
    alert('対象案件が見つかりません');
    return;
  }

  const modal = document.createElement('div');
  modal.className = 'pc-modal-overlay';
  modal.innerHTML = `
    <div class="pc-modal">
      <h3>${isEdit ? '案件編集' : '新規案件追加'}</h3>
      <form id="pc-project-form">
        <div class="pc-form-row">
          <label>案件名 <span class="pc-required">*</span></label>
          <input type="text" name="projectName" value="${isEdit ? escHtmlPg(target.projectName) : ''}" required>
        </div>
        <div class="pc-form-row">
          <label>顧客名</label>
          <input type="text" name="customerName" value="${isEdit ? escHtmlPg(target.customerName) : ''}">
        </div>
        <div class="pc-form-row">
          <label>開始日</label>
          <input type="date" name="startDate" value="${isEdit ? escHtmlPg(target.startDate) : ''}">
        </div>
        <div class="pc-form-row">
          <label>終了日</label>
          <input type="date" name="endDate" value="${isEdit ? escHtmlPg(target.endDate) : ''}">
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
          <textarea name="memo" rows="3">${isEdit ? escHtmlPg(target.memo) : ''}</textarea>
        </div>
        <div class="pc-modal-actions">
          <button type="button" class="pc-secondary-btn" id="pc-modal-cancel">キャンセル</button>
          <button type="submit" class="pc-primary-btn">${isEdit ? '更新' : '追加'}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#pc-modal-cancel').addEventListener('click', () => modal.remove());
  // オーバーレイクリックで閉じる（モーダル本体クリックは無視）
  modal.addEventListener('click', e => {
    if (e.target === modal) modal.remove();
  });

  modal.querySelector('#pc-project-form').addEventListener('submit', async (e) => {
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
    if (!data.projectName) {
      alert('案件名は必須です');
      return;
    }
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
    await loadProjectMaster();
    if (typeof showToast === 'function') {
      showToast(isEdit ? '案件を更新しました' : '案件を追加しました', 'success');
    }
  });
}

/**
 * 削除フロー（紐付けあり時は警告→強制削除可）
 */
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
  await loadProjectMaster();
  if (typeof showToast === 'function') showToast('案件を削除しました', 'success');
}

/* =====================
 * 紐付け作業
 * ===================== */

let linkRowsCache = [];
let linkProjectsCache = [];   // active のみ
let linkFilterStatus = 'unlinked';   // 'unlinked' / 'linked' / 'all'
let linkFilterMonth = 'all';
let linkFilterType = 'all';   // 'all' / 'sales' / 'cost'
let linkSelectedRows = new Set();   // "sheetName:rowIndex" 形式

async function loadProjectLink() {
  const panel = document.querySelector('[data-subview-panel="link"]');
  if (!panel) return;

  panel.innerHTML = '<div class="pc-loading">読み込み中...</div>';

  let projectsRes, historyRes;
  try {
    [projectsRes, historyRes] = await Promise.all([
      callGAS('getProjects', {}),
      callGAS('getHistory', {})
    ]);
  } catch (e) {
    panel.innerHTML = `<div class="pc-error">通信エラー：${escHtmlPg(e.message || 'unknown')}</div>`;
    return;
  }

  if (!projectsRes || projectsRes.status !== 'ok' || !historyRes || historyRes.status !== 'ok') {
    panel.innerHTML = `<div class="pc-error">取得失敗</div>`;
    return;
  }

  linkProjectsCache = (projectsRes.data || []).filter(p => (p.status || 'active') === 'active');
  linkRowsCache = (historyRes.data || []).filter(r => r.type === 'sales' || r.type === 'cost');
  linkSelectedRows.clear();

  renderProjectLink(panel);
}

function renderProjectLink(panel) {
  // 月の選択肢（YYYY-MM 単位、降順）
  const months = Array.from(new Set(
    linkRowsCache.map(r => String(r.date || '').substring(0, 7)).filter(Boolean)
  )).sort().reverse();
  const monthOptions =
    `<option value="all" ${linkFilterMonth === 'all' ? 'selected' : ''}>すべての月</option>` +
    months.map(m => `<option value="${escHtmlPg(m)}" ${linkFilterMonth === m ? 'selected' : ''}>${escHtmlPg(m)}</option>`).join('');

  // フィルタ適用
  let filtered = linkRowsCache.slice();
  if (linkFilterStatus === 'unlinked') filtered = filtered.filter(r => !r.projectId);
  if (linkFilterStatus === 'linked')   filtered = filtered.filter(r => !!r.projectId);
  if (linkFilterMonth !== 'all')        filtered = filtered.filter(r => String(r.date || '').substring(0, 7) === linkFilterMonth);
  if (linkFilterType !== 'all')         filtered = filtered.filter(r => r.type === linkFilterType);

  // 日付降順
  filtered.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  // 案件ドロップダウン共通
  const projectOptions = (currentId) => {
    const opts = [`<option value="">— 紐付け解除 —</option>`];
    linkProjectsCache.forEach(p => {
      const sel = p.projectId === currentId ? 'selected' : '';
      const label = p.customerName
        ? `${escHtmlPg(p.projectName)} (${escHtmlPg(p.customerName)})`
        : escHtmlPg(p.projectName);
      opts.push(`<option value="${escHtmlPg(p.projectId)}" ${sel}>${label}</option>`);
    });
    return opts.join('');
  };

  const fy = n => '¥' + (Number(n) || 0).toLocaleString('ja-JP');

  const rows = filtered.length === 0
    ? `<tr><td colspan="7" class="pc-empty">該当する行がありません</td></tr>`
    : filtered.map(r => {
        const key = `${r.sheetName}:${r.rowIndex}`;
        const checked = linkSelectedRows.has(key) ? 'checked' : '';
        const label = r.type === 'sales' ? '売上' : 'コスト';
        return `
          <tr>
            <td><input type="checkbox" class="pc-link-row-check" data-key="${escHtmlPg(key)}" ${checked}></td>
            <td>${escHtmlPg(r.date)}</td>
            <td><span class="pc-type-${r.type}">${label}</span></td>
            <td>${escHtmlPg(r.itemName)}</td>
            <td class="num">${fy(r.amount)}</td>
            <td>${escHtmlPg(r.memo || '')}</td>
            <td>
              <select class="pc-link-project-select" data-sheet="${escHtmlPg(r.sheetName)}" data-row="${escHtmlPg(r.rowIndex)}">
                ${projectOptions(r.projectId || '')}
              </select>
            </td>
          </tr>
        `;
      }).join('');

  panel.innerHTML = `
    <div class="pc-project-link">
      <div class="pc-master-header">
        <div>
          <h2>紐付け作業</h2>
          <p class="pc-note">過去の売上・コスト行に案件を紐付けると、案件粗利レポートで集計対象になります。会計上の損益計算には影響しません。</p>
        </div>
      </div>
      <div class="pc-filter-row">
        <label>表示
          <select id="pc-link-filter-status">
            <option value="unlinked" ${linkFilterStatus === 'unlinked' ? 'selected' : ''}>未紐付けのみ</option>
            <option value="linked"   ${linkFilterStatus === 'linked'   ? 'selected' : ''}>紐付け済みのみ</option>
            <option value="all"      ${linkFilterStatus === 'all'      ? 'selected' : ''}>すべて</option>
          </select>
        </label>
        <label>月
          <select id="pc-link-filter-month">${monthOptions}</select>
        </label>
        <label>種別
          <select id="pc-link-filter-type">
            <option value="all"   ${linkFilterType === 'all'   ? 'selected' : ''}>すべて</option>
            <option value="sales" ${linkFilterType === 'sales' ? 'selected' : ''}>売上のみ</option>
            <option value="cost"  ${linkFilterType === 'cost'  ? 'selected' : ''}>コストのみ</option>
          </select>
        </label>
      </div>
      <div class="pc-bulk-action-row">
        <span class="pc-bulk-count">${linkSelectedRows.size}件選択中</span>
        <select id="pc-bulk-project-select">
          <option value="">案件を選択...</option>
          <option value="__unlink__">— 紐付け解除 —</option>
          ${linkProjectsCache.map(p => {
            const label = p.customerName
              ? `${escHtmlPg(p.projectName)} (${escHtmlPg(p.customerName)})`
              : escHtmlPg(p.projectName);
            return `<option value="${escHtmlPg(p.projectId)}">${label}</option>`;
          }).join('')}
        </select>
        <button class="pc-primary-btn" id="pc-bulk-apply-btn" ${linkSelectedRows.size === 0 ? 'disabled' : ''}>一括適用</button>
      </div>
      <table class="pc-table">
        <thead>
          <tr>
            <th><input type="checkbox" id="pc-link-check-all"></th>
            <th>日付</th>
            <th>種別</th>
            <th>品目</th>
            <th class="num">金額</th>
            <th>メモ</th>
            <th>案件紐付け</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  // フィルタ変更（再描画＋選択クリア）
  panel.querySelector('#pc-link-filter-status').addEventListener('change', e => {
    linkFilterStatus = e.target.value;
    linkSelectedRows.clear();
    renderProjectLink(panel);
  });
  panel.querySelector('#pc-link-filter-month').addEventListener('change', e => {
    linkFilterMonth = e.target.value;
    linkSelectedRows.clear();
    renderProjectLink(panel);
  });
  panel.querySelector('#pc-link-filter-type').addEventListener('change', e => {
    linkFilterType = e.target.value;
    linkSelectedRows.clear();
    renderProjectLink(panel);
  });

  // 個別ドロップダウン変更（即時 linkProject）
  panel.querySelectorAll('.pc-link-project-select').forEach(sel => {
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
      // キャッシュ更新（再描画なし・該当行のみ反映）
      const target = linkRowsCache.find(r => r.sheetName === sheetName && Number(r.rowIndex) === rowIndex);
      if (target) target.projectId = projectId;
      if (typeof showToast === 'function') {
        showToast(projectId ? '紐付けました' : '紐付けを解除しました', 'success');
      }
    });
  });

  // 個別チェックボックス（再描画なしで部分更新）
  panel.querySelectorAll('.pc-link-row-check').forEach(cb => {
    cb.addEventListener('change', e => {
      const key = e.target.dataset.key;
      if (e.target.checked) linkSelectedRows.add(key);
      else linkSelectedRows.delete(key);
      const countEl = panel.querySelector('.pc-bulk-count');
      const applyBtn = panel.querySelector('#pc-bulk-apply-btn');
      if (countEl) countEl.textContent = `${linkSelectedRows.size}件選択中`;
      if (applyBtn) applyBtn.disabled = linkSelectedRows.size === 0;
    });
  });

  // 全選択チェックボックス
  const checkAll = panel.querySelector('#pc-link-check-all');
  if (checkAll) {
    checkAll.addEventListener('change', e => {
      const checked = e.target.checked;
      panel.querySelectorAll('.pc-link-row-check').forEach(cb => {
        cb.checked = checked;
        const key = cb.dataset.key;
        if (checked) linkSelectedRows.add(key);
        else linkSelectedRows.delete(key);
      });
      const countEl = panel.querySelector('.pc-bulk-count');
      const applyBtn = panel.querySelector('#pc-bulk-apply-btn');
      if (countEl) countEl.textContent = `${linkSelectedRows.size}件選択中`;
      if (applyBtn) applyBtn.disabled = linkSelectedRows.size === 0;
    });
  }

  // 一括適用
  const applyBtn = panel.querySelector('#pc-bulk-apply-btn');
  if (applyBtn) {
    applyBtn.addEventListener('click', async () => {
      const sel = panel.querySelector('#pc-bulk-project-select');
      if (!sel || !sel.value) {
        alert('案件を選択してください');
        return;
      }
      const projectId = sel.value === '__unlink__' ? '' : sel.value;
      const selectedKeys = Array.from(linkSelectedRows);
      const msg = projectId
        ? `${selectedKeys.length}件の行に案件を紐付けますか？`
        : `${selectedKeys.length}件の行の紐付けを解除しますか？`;
      if (!confirm(msg)) return;

      let success = 0, failed = 0;
      for (const key of selectedKeys) {
        const idx = key.indexOf(':');
        if (idx < 0) { failed++; continue; }
        const sheetName = key.substring(0, idx);
        const rowIndex = Number(key.substring(idx + 1));
        try {
          const res = await callGAS('linkProject', { sheetName, rowIndex, projectId });
          if (res && res.status === 'ok') {
            success++;
            const target = linkRowsCache.find(r => r.sheetName === sheetName && Number(r.rowIndex) === rowIndex);
            if (target) target.projectId = projectId;
          } else {
            failed++;
          }
        } catch (e) {
          failed++;
        }
      }

      if (typeof showToast === 'function') {
        showToast(`成功 ${success}件 / 失敗 ${failed}件`, failed === 0 ? 'success' : 'error');
      }
      linkSelectedRows.clear();
      renderProjectLink(panel);
    });
  }
}

/* =====================
 * ユーティリティ
 * ===================== */

function escHtmlPg(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}
