/* pc-sales.js — PC版 売上・コスト入力（タブ切替・インライン編集テーブル） */
'use strict';

let currentTab = 'sales';
let items = [];
let costMaster = [];
let editingKey = null;
let newDraft = null;

document.addEventListener('DOMContentLoaded', async () => {
  pcBootstrap('sales.html', '売上・コスト入力');
  // 月フィルタ初期値
  document.getElementById('f-month').value = new Date().toISOString().slice(0,7);
  costMaster = getCostMaster();

  bindTabs();
  document.getElementById('f-month').addEventListener('change', loadItems);
  document.getElementById('f-division').addEventListener('change', render);
  document.getElementById('f-status').addEventListener('change', render);
  document.getElementById('btn-new').addEventListener('click', startNew);
  document.getElementById('btn-reload').addEventListener('click', loadItems);

  await loadItems();
});

function bindTabs() {
  document.querySelectorAll('.pc-tab').forEach(t => {
    t.addEventListener('click', async () => {
      document.querySelectorAll('.pc-tab').forEach(b => b.classList.toggle('active', b === t));
      currentTab = t.dataset.tab;
      editingKey = null; newDraft = null;
      await loadItems();
    });
  });
}

async function loadItems() {
  const month = document.getElementById('f-month').value;
  if (!month) return;
  const type = currentTab;
  const res = await callGAS('getHistory', { type, month }).catch(() => null);
  if (res && res.status === 'ok' && Array.isArray(res.data)) {
    items = res.data.filter(it => it.type === type);
  } else {
    items = [];
  }
  items.sort((a,b) => String(b.date).localeCompare(String(a.date)));
  render();
}

function getLockStatus(dateStr) {
  if (!dateStr) return { locked:false };
  const [dy, dm] = dateStr.split('-').map(Number);
  const n = new Date();
  const ty = n.getFullYear(), tm = n.getMonth()+1, td = n.getDate();
  if (dy === ty && dm === tm) return { locked:false };
  // 翌月4日以降ロック
  const diff = (ty - dy) * 12 + (tm - dm);
  if (diff === 1 && td <= 3) return { locked:false, grace:true };
  if (diff >= 1) return { locked:true };
  return { locked:false };
}

function render() {
  const head = document.getElementById('grid-head');
  const body = document.getElementById('grid-body');

  if (currentTab === 'sales') {
    head.innerHTML = `<tr>
      <th style="width:110px;">日付</th>
      <th>サービス</th>
      <th>品目名</th>
      <th class="num" style="width:110px;">税込金額</th>
      <th style="width:70px;">税率</th>
      <th style="width:60px;">未収</th>
      <th style="width:140px;">操作</th>
    </tr>`;
  } else {
    head.innerHTML = `<tr>
      <th style="width:110px;">日付</th>
      <th style="width:80px;">区分</th>
      <th>科目</th>
      <th>品目名</th>
      <th class="num" style="width:110px;">税込金額</th>
      <th style="width:70px;">税率</th>
      <th style="width:60px;">未払</th>
      <th style="width:140px;">操作</th>
    </tr>`;
  }

  const divFilter = document.getElementById('f-division').value;
  const stFilter  = document.getElementById('f-status').value;

  let list = items.slice();
  list = list.filter(it => {
    if (divFilter === 'misc' && !(/諸口/.test(it.itemName || ''))) return false;
    if (divFilter === 'fixed' && /諸口/.test(it.itemName || '')) return false;
    const locked = getLockStatus(it.date).locked;
    const isUP = currentTab === 'sales' ? Number(it.uncollected) : Number(it.unpaid);
    if (stFilter === 'unpaid' && !isUP) return false;
    if (stFilter === 'locked' && !locked) return false;
    return true;
  });

  const rows = [];
  if (newDraft) rows.push(renderRow(newDraft, '__new__', true));
  list.forEach(it => {
    const key = it.rowIndex;
    const editing = editingKey === key;
    rows.push(renderRow(it, key, editing));
  });

  if (rows.length === 0) {
    const cols = currentTab === 'sales' ? 7 : 8;
    body.innerHTML = `<tr><td colspan="${cols}" class="text-muted" style="text-align:center;padding:30px;">データがありません</td></tr>`;
  } else {
    body.innerHTML = rows.join('');
  }
  bindRowEvents();
}

function renderRow(it, key, editing) {
  const locked = getLockStatus(it.date).locked;
  const upField = currentTab === 'sales' ? 'uncollected' : 'unpaid';
  const upOn = Number(it[upField]) === 1;
  const rowCls = [];
  if (upOn) rowCls.push('row--unpaid');
  if (locked && !editing) rowCls.push('row--locked');

  if (editing) {
    const taxOpts = [0,8,10].map(v => `<option value="${v}" ${Number(it.taxRate)===v?'selected':''}>${v}%</option>`).join('');
    if (currentTab === 'sales') {
      return `<tr data-key="${key}" class="${rowCls.join(' ')}">
        <td><input type="date" class="pc-input ef-date" value="${escHtml(it.date||'')}"></td>
        <td><input type="text" class="pc-input ef-svc" value="${escHtml(it.serviceName||it.itemName||'')}" style="width:100%;"></td>
        <td><input type="text" class="pc-input ef-name" value="${escHtml(it.itemName||'')}" style="width:100%;"></td>
        <td class="num"><input type="number" class="pc-input ef-amt" value="${Number(it.amount)||0}" style="width:100px;text-align:right;"></td>
        <td><select class="pc-select ef-tax">${taxOpts}</select></td>
        <td><input type="checkbox" class="ef-flag" ${upOn?'checked':''}></td>
        <td>
          <button class="pc-btn pc-btn--sm btn-save">確定</button>
          <button class="pc-btn pc-btn--sm pc-btn--ghost btn-cancel">取消</button>
        </td>
      </tr>`;
    } else {
      const divOpts = ['1','2'].map(v => `<option value="${v}" ${String(it.divisionCode)===v?'selected':''}>${v==='1'?'原価':'販管費'}</option>`).join('');
      return `<tr data-key="${key}" class="${rowCls.join(' ')}">
        <td><input type="date" class="pc-input ef-date" value="${escHtml(it.date||'')}"></td>
        <td><select class="pc-select ef-div">${divOpts}</select></td>
        <td><input type="text" class="pc-input ef-itemcode" value="${escHtml(it.itemCode||'')}" placeholder="科目コード" style="width:100%;"></td>
        <td><input type="text" class="pc-input ef-name" value="${escHtml(it.itemName||'')}" style="width:100%;"></td>
        <td class="num"><input type="number" class="pc-input ef-amt" value="${Number(it.amount)||0}" style="width:100px;text-align:right;"></td>
        <td><select class="pc-select ef-tax">${taxOpts}</select></td>
        <td><input type="checkbox" class="ef-flag" ${upOn?'checked':''}></td>
        <td>
          <button class="pc-btn pc-btn--sm btn-save">確定</button>
          <button class="pc-btn pc-btn--sm pc-btn--ghost btn-cancel">取消</button>
        </td>
      </tr>`;
    }
  }

  // 表示モード
  const action = locked
    ? `<button class="pc-btn pc-btn--sm pc-btn--ghost btn-unlock">解除申請</button>`
    : `<button class="pc-btn pc-btn--sm btn-edit">編集</button>` +
      (upOn ? ` <button class="pc-btn pc-btn--sm pc-btn--ghost btn-reconcile">消込</button>` : '');

  if (currentTab === 'sales') {
    return `<tr data-key="${key}" class="${rowCls.join(' ')}">
      <td>${escHtml(it.date||'')}</td>
      <td>${escHtml(it.serviceName||'')}</td>
      <td>${escHtml(it.itemName||'')}</td>
      <td class="num">${formatYen(Number(it.amount)||0)}</td>
      <td>${Number(it.taxRate)||0}%</td>
      <td>${upOn?'●':''}</td>
      <td>${action}</td>
    </tr>`;
  } else {
    const divName = String(it.divisionCode)==='1' ? '原価' : '販管費';
    return `<tr data-key="${key}" class="${rowCls.join(' ')}">
      <td>${escHtml(it.date||'')}</td>
      <td>${divName}</td>
      <td>${escHtml(it.itemCode||'')}</td>
      <td>${escHtml(it.itemName||'')}</td>
      <td class="num">${formatYen(Number(it.amount)||0)}</td>
      <td>${Number(it.taxRate)||0}%</td>
      <td>${upOn?'●':''}</td>
      <td>${action}</td>
    </tr>`;
  }
}

function bindRowEvents() {
  document.querySelectorAll('.btn-edit').forEach(b => b.addEventListener('click', e => {
    const tr = e.target.closest('tr'); editingKey = tr.dataset.key; newDraft = null; render();
  }));
  document.querySelectorAll('.btn-cancel').forEach(b => b.addEventListener('click', () => {
    editingKey = null; newDraft = null; render();
  }));
  document.querySelectorAll('.btn-save').forEach(b => b.addEventListener('click', onSaveRow));
  document.querySelectorAll('.btn-reconcile').forEach(b => b.addEventListener('click', onReconcile));
  document.querySelectorAll('.btn-unlock').forEach(b => b.addEventListener('click', () => {
    showToast('解除申請を送信しました（オーナー承認待ち）', 'info');
  }));
}

function startNew() {
  newDraft = {
    rowIndex: null,
    date: todayStr(),
    itemName: '',
    serviceName: '',
    amount: 0,
    taxRate: 10,
    uncollected: 0,
    unpaid: 0,
    divisionCode: '2',
    itemCode: '',
  };
  editingKey = '__new__';
  render();
}

async function onSaveRow(e) {
  const tr = e.target.closest('tr');
  const isNew = tr.dataset.key === '__new__';
  const date = tr.querySelector('.ef-date')?.value || todayStr();
  const name = tr.querySelector('.ef-name')?.value?.trim() || '';
  const amt  = parseInt(tr.querySelector('.ef-amt')?.value || '0', 10) || 0;
  const tax  = parseInt(tr.querySelector('.ef-tax')?.value || '10', 10);
  const flag = tr.querySelector('.ef-flag')?.checked ? 1 : 0;
  const { taxExcluded, tax: taxAmt } = calcTax(amt, tax);

  let res;
  if (currentTab === 'sales') {
    const svc = tr.querySelector('.ef-svc')?.value?.trim() || '';
    if (isNew) {
      res = await callGAS('addSales', {
        date, serviceCode: '', serviceName: svc, miscItemName: name,
        amountExTax: taxExcluded, taxRate: tax, tax: taxAmt, amountInTax: amt,
        memo: '', uncollected: flag,
      });
    } else {
      const orig = items.find(it => String(it.rowIndex) === tr.dataset.key);
      res = await callGAS('updateSales', {
        rowIndex: orig?.rowIndex, date,
        serviceName: svc, serviceCode: orig?.serviceCode || '',
        amountExTax: taxExcluded, taxRate: tax, tax: taxAmt, amountInTax: amt,
        memo: orig?.memo || '', uncollected: flag,
      });
    }
  } else {
    const div  = tr.querySelector('.ef-div')?.value || '2';
    const icode = tr.querySelector('.ef-itemcode')?.value?.trim() || '';
    if (isNew) {
      res = await callGAS('addCost', {
        date, divisionCode: div, itemCode: icode, itemName: name,
        taxExcluded, taxRate: tax, tax: taxAmt, taxIncluded: amt,
        memo: '', unpaid: flag,
      });
    } else {
      const orig = items.find(it => String(it.rowIndex) === tr.dataset.key);
      res = await callGAS('updateCost', {
        rowIndex: orig?.rowIndex, date,
        divisionCode: div, divisionName: div==='1'?'原価':'販管費',
        itemCode: icode, itemName: name,
        taxExcluded, taxRate: tax, tax: taxAmt, taxIncluded: amt,
        memo: orig?.memo || '', unpaid: flag,
      });
    }
  }

  if (res && res.status === 'ok') {
    showToast('保存しました', 'success');
    editingKey = null; newDraft = null;
    await loadItems();
  } else {
    showToast('保存失敗: ' + (res?.message || 'エラー'), 'error');
  }
}

async function onReconcile(e) {
  const tr = e.target.closest('tr');
  const it = items.find(x => String(x.rowIndex) === tr.dataset.key);
  if (!it) return;
  if (!confirm('消込しますか？（全額入金/支払）')) return;
  const res = await callGAS('reconcile', {
    sheetName: currentTab === 'sales' ? '売上' : 'コスト',
    rowIndex: it.rowIndex,
    paidAmount: Number(it.amount) || 0,
    paidDate: todayStr(),
  }).catch(() => null);
  if (res && res.status === 'ok') {
    showToast('消込しました', 'success');
    await loadItems();
  } else {
    showToast('消込失敗', 'error');
  }
}
