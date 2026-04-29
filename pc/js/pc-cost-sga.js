/* pc-cost-sga.js — PC版 販管費入力（divisionCode='2' 専用）
 * 戦略思想§3-9-3 5項目構造の「販管費」独立区分
 * 仕入原価（divisionCode='1'）は sales.html のコストタブで扱うため本画面には表示しない
 */
'use strict';

let sgaItems = [];
let sgaCostMaster = [];
let sgaEditingKey = null;
let sgaNewDraft = null;

document.addEventListener('DOMContentLoaded', async () => {
  pcBootstrap('cost-sga.html', '販管費入力');
  document.getElementById('f-month').value = new Date().toISOString().slice(0,7);
  // 科目マスタを取得し、divisionCode='2' のみを保持（PC版は smartphoneVisible 無視で全件）
  const all = (typeof getCostMaster === 'function') ? getCostMaster() : [];
  sgaCostMaster = (all || []).filter(c => String(c.divisionCode) === '2');
  populateItemCodeFilter();

  document.getElementById('f-month').addEventListener('change', loadSgaItems);
  document.getElementById('f-itemcode').addEventListener('change', renderSga);
  document.getElementById('f-status').addEventListener('change', renderSga);
  document.getElementById('btn-new').addEventListener('click', startSgaNew);
  document.getElementById('btn-reload').addEventListener('click', loadSgaItems);

  await loadSgaItems();
});

function populateItemCodeFilter() {
  const sel = document.getElementById('f-itemcode');
  if (!sel) return;
  const opts = ['<option value="">全て</option>'];
  sgaCostMaster.forEach(c => {
    opts.push(`<option value="${escSga(c.code)}">${escSga(c.code)} ${escSga(c.name)}</option>`);
  });
  sel.innerHTML = opts.join('');
}

async function loadSgaItems() {
  const month = document.getElementById('f-month').value;
  if (!month) return;
  const res = await callGAS('getHistory', { month }).catch(() => null);
  if (res && res.status === 'ok' && Array.isArray(res.data)) {
    // type='cost' かつ divisionCode != '1' のみ（販管費系すべて）
    sgaItems = res.data.filter(it =>
      it && it.type === 'cost' && String(it.divisionCode) !== '1'
    );
  } else {
    sgaItems = [];
  }
  sgaItems.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  renderSga();
}

function getSgaLockStatus(dateStr) {
  if (!dateStr) return { locked: false };
  const [dy, dm] = dateStr.split('-').map(Number);
  const n = new Date();
  const ty = n.getFullYear(), tm = n.getMonth() + 1, td = n.getDate();
  if (dy === ty && dm === tm) return { locked: false };
  const diff = (ty - dy) * 12 + (tm - dm);
  if (diff === 1 && td <= 3) return { locked: false, grace: true };
  if (diff >= 1) return { locked: true };
  return { locked: false };
}

function renderSga() {
  const head = document.getElementById('grid-head');
  const body = document.getElementById('grid-body');
  head.innerHTML = `<tr>
    <th style="width:110px;">日付</th>
    <th>科目</th>
    <th>品目名</th>
    <th class="num" style="width:110px;">税込金額</th>
    <th style="width:70px;">税率</th>
    <th style="width:60px;">未払</th>
    <th style="width:140px;">操作</th>
  </tr>`;

  const itemCodeFilter = document.getElementById('f-itemcode').value;
  const stFilter = document.getElementById('f-status').value;

  let list = sgaItems.slice();
  if (itemCodeFilter) {
    list = list.filter(it => String(it.itemCode) === itemCodeFilter);
  }
  list = list.filter(it => {
    const isUnpaid = Number(it.unpaid) === 1;
    if (stFilter === 'unpaid' && !isUnpaid) return false;
    if (stFilter === 'paid' && isUnpaid) return false;
    return true;
  });

  const rows = [];
  if (sgaNewDraft) rows.push(renderSgaRow(sgaNewDraft, '__new__', true));
  list.forEach(it => {
    const key = it.rowIndex;
    const editing = sgaEditingKey === key;
    rows.push(renderSgaRow(it, key, editing));
  });

  if (rows.length === 0) {
    body.innerHTML = `<tr><td colspan="7" class="text-muted" style="text-align:center;padding:30px;">データがありません</td></tr>`;
  } else {
    body.innerHTML = rows.join('');
  }
  bindSgaRowEvents();
}

function renderSgaRow(it, key, editing) {
  const locked = getSgaLockStatus(it.date).locked;
  const upOn = Number(it.unpaid) === 1;
  const rowCls = [];
  if (upOn) rowCls.push('row--unpaid');
  if (locked && !editing) rowCls.push('row--locked');

  if (editing) {
    const taxOpts = [0, 8, 10].map(v =>
      `<option value="${v}" ${Number(it.taxRate) === v ? 'selected' : ''}>${v}%</option>`
    ).join('');
    const itemOpts = ['<option value="">（未選択）</option>']
      .concat(sgaCostMaster.map(c =>
        `<option value="${escSga(c.code)}" data-name="${escSga(c.name)}" data-tax="${Number(c.taxRate) || 0}" ${String(it.itemCode) === String(c.code) ? 'selected' : ''}>${escSga(c.code)} ${escSga(c.name)}</option>`
      )).join('');
    return `<tr data-key="${key}" class="${rowCls.join(' ')}">
      <td><input type="date" class="pc-input ef-date" value="${escSga(it.date || '')}"></td>
      <td><select class="pc-select ef-itemcode" style="width:100%;">${itemOpts}</select></td>
      <td><input type="text" class="pc-input ef-name" value="${escSga(it.itemName || '')}" style="width:100%;"></td>
      <td class="num"><input type="number" class="pc-input ef-amt" value="${Number(it.amount) || 0}" style="width:100px;text-align:right;"></td>
      <td><select class="pc-select ef-tax">${taxOpts}</select></td>
      <td><input type="checkbox" class="ef-flag" ${upOn ? 'checked' : ''}></td>
      <td>
        <button class="pc-btn pc-btn--sm btn-save">確定</button>
        <button class="pc-btn pc-btn--sm pc-btn--ghost btn-cancel">取消</button>
      </td>
    </tr>`;
  }

  const action = locked
    ? `<button class="pc-btn pc-btn--sm pc-btn--ghost btn-unlock">解除申請</button>`
    : `<button class="pc-btn pc-btn--sm btn-edit">編集</button>` +
      (upOn ? ` <button class="pc-btn pc-btn--sm pc-btn--ghost btn-reconcile">消込</button>` : '');

  // 表示モード：科目名 = costMaster からの逆引き or itemName フォールバック
  const masterEntry = sgaCostMaster.find(c => String(c.code) === String(it.itemCode));
  const itemDisp = masterEntry ? `${escSga(it.itemCode)} ${escSga(masterEntry.name)}` : escSga(it.itemCode || '');

  return `<tr data-key="${key}" class="${rowCls.join(' ')}">
    <td>${escSga(it.date || '')}</td>
    <td>${itemDisp}</td>
    <td>${escSga(it.itemName || '')}</td>
    <td class="num">${formatYen(Number(it.amount) || 0)}</td>
    <td>${Number(it.taxRate) || 0}%</td>
    <td>${upOn ? '●' : ''}</td>
    <td>${action}</td>
  </tr>`;
}

function bindSgaRowEvents() {
  document.querySelectorAll('.btn-edit').forEach(b => b.addEventListener('click', e => {
    const tr = e.target.closest('tr');
    sgaEditingKey = Number(tr.dataset.key) || tr.dataset.key;
    sgaNewDraft = null;
    renderSga();
  }));
  document.querySelectorAll('.btn-cancel').forEach(b => b.addEventListener('click', () => {
    sgaEditingKey = null; sgaNewDraft = null; renderSga();
  }));
  document.querySelectorAll('.btn-save').forEach(b => b.addEventListener('click', onSgaSaveRow));
  document.querySelectorAll('.btn-reconcile').forEach(b => b.addEventListener('click', onSgaReconcile));
  document.querySelectorAll('.btn-unlock').forEach(b => b.addEventListener('click', () => {
    if (typeof showToast === 'function') showToast('解除申請を送信しました（オーナー承認待ち）', 'info');
  }));
  // 編集モード中の科目選択で品目名・税率を自動補完
  document.querySelectorAll('.ef-itemcode').forEach(sel => {
    sel.addEventListener('change', e => {
      const tr = e.target.closest('tr');
      const opt = e.target.selectedOptions && e.target.selectedOptions[0];
      if (!opt) return;
      const name = opt.getAttribute('data-name');
      const tax = opt.getAttribute('data-tax');
      const nameInput = tr.querySelector('.ef-name');
      const taxSel = tr.querySelector('.ef-tax');
      if (name && nameInput && !nameInput.value.trim()) nameInput.value = name;
      if (tax !== null && tax !== '' && taxSel) taxSel.value = tax;
    });
  });
}

function startSgaNew() {
  sgaNewDraft = {
    rowIndex: null,
    date: todayStr(),
    itemCode: '',
    itemName: '',
    amount: 0,
    taxRate: 10,
    unpaid: 0,
    divisionCode: '2'
  };
  sgaEditingKey = '__new__';
  renderSga();
}

async function onSgaSaveRow(e) {
  const tr = e.target.closest('tr');
  const isNew = tr.dataset.key === '__new__';
  const date = tr.querySelector('.ef-date')?.value || todayStr();
  const itemCode = tr.querySelector('.ef-itemcode')?.value?.trim() || '';
  const name = tr.querySelector('.ef-name')?.value?.trim() || '';
  const amt = parseInt(tr.querySelector('.ef-amt')?.value || '0', 10) || 0;
  const tax = parseInt(tr.querySelector('.ef-tax')?.value || '10', 10);
  const flag = tr.querySelector('.ef-flag')?.checked ? 1 : 0;

  if (!itemCode) {
    if (typeof showToast === 'function') showToast('科目を選択してください', 'error');
    return;
  }

  const { taxExcluded, tax: taxAmt } = calcTax(amt, tax);

  let res;
  if (isNew) {
    res = await callGAS('addCost', {
      date,
      divisionCode: '2',
      divisionName: '販管費',
      itemCode,
      itemName: name,
      taxExcluded, taxRate: tax, tax: taxAmt, taxIncluded: amt,
      memo: '', unpaid: flag
    });
  } else {
    const orig = sgaItems.find(it => String(it.rowIndex) === String(tr.dataset.key));
    res = await callGAS('updateCost', {
      rowIndex: orig?.rowIndex,
      date,
      divisionCode: '2',
      divisionName: '販管費',
      itemCode,
      itemName: name,
      taxExcluded, taxRate: tax, tax: taxAmt, taxIncluded: amt,
      memo: orig?.memo || '',
      unpaid: flag
    });
  }

  if (res && res.status === 'ok') {
    if (typeof showToast === 'function') showToast('保存しました', 'success');
    sgaEditingKey = null; sgaNewDraft = null;
    await loadSgaItems();
  } else {
    if (typeof showToast === 'function') showToast('保存失敗: ' + (res?.message || 'エラー'), 'error');
  }
}

async function onSgaReconcile(e) {
  const tr = e.target.closest('tr');
  const it = sgaItems.find(x => String(x.rowIndex) === String(tr.dataset.key));
  if (!it) return;
  if (!confirm('消込しますか？（全額支払）')) return;
  const res = await callGAS('reconcile', {
    sheetName: 'コスト',
    rowIndex: it.rowIndex,
    paidAmount: Number(it.amount) || 0,
    paidDate: todayStr()
  }).catch(() => null);
  if (res && res.status === 'ok') {
    if (typeof showToast === 'function') showToast('消込しました', 'success');
    await loadSgaItems();
  } else {
    if (typeof showToast === 'function') showToast('消込失敗', 'error');
  }
}

function escSga(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}
