/* pc-settings.js — PC版 設定（店舗情報・サービスマスタ・科目マスタ・スタッフマスタ） */
'use strict';

let settings = null;
let costMaster = [];

document.addEventListener('DOMContentLoaded', async () => {
  pcBootstrap('settings.html', '設定');
  await loadAll();
  document.getElementById('btn-save-store').addEventListener('click', saveStore);
  document.getElementById('btn-save-cm').addEventListener('click', saveCM);
});

async function loadAll() {
  const [sRes, cmRes] = await Promise.all([
    callGAS('getSettings', {}).catch(() => null),
    callGAS('getCostMaster', {}).catch(() => null),
  ]);
  settings = (sRes && sRes.status === 'ok' && sRes.data) ? sRes.data : {};
  if (cmRes && cmRes.status === 'ok' && Array.isArray(cmRes.data) && cmRes.data.length > 0) {
    costMaster = cmRes.data;
  } else {
    costMaster = getCostMaster();
  }
  renderStore();
  renderServices();
  renderCM();
  renderStaff();
}

function renderStore() {
  const name = settings?.storeName || localStorage.getItem('uz_store_name') || '';
  const owner = settings?.ownerName || '';
  document.getElementById('s-store').value = name;
  document.getElementById('s-owner').value = owner;
}

async function saveStore() {
  const storeName = document.getElementById('s-store').value.trim();
  const ownerName = document.getElementById('s-owner').value.trim();
  localStorage.setItem('uz_store_name', storeName);
  const res = await callGAS('saveSettings', { storeName, ownerName }).catch(() => null);
  if (res && res.status === 'ok') {
    showToast('店舗情報を保存しました', 'success');
  } else {
    showToast('保存失敗（ローカルには保存）', 'error');
  }
}

function renderServices() {
  const svcs = Array.isArray(settings?.services) ? settings.services : [];
  const body = document.getElementById('svc-body');
  if (svcs.length === 0) {
    body.innerHTML = `<tr><td colspan="3" class="text-muted" style="text-align:center;padding:20px;">登録なし</td></tr>`;
    return;
  }
  body.innerHTML = svcs.map(s => `<tr>
    <td>${escHtml(s.code||'')}</td>
    <td>${escHtml(s.name||'')}</td>
    <td>${Number(s.taxRate)||0}%</td>
  </tr>`).join('');
}

function renderCM() {
  const body = document.getElementById('cm-body');
  body.innerHTML = costMaster.map((row, i) => {
    const fixed = row.type === 'fixed';
    const divName = row.divisionCode === '1' ? '原価' : '販管費';
    const taxOpts = [0,8,10].map(v => `<option value="${v}" ${Number(row.taxRate)===v?'selected':''}>${v}%</option>`).join('');
    const nameCell = fixed
      ? `<input type="text" class="pc-input cm-name" value="${escHtml(row.name||'')}" data-i="${i}" disabled style="width:100%;opacity:0.6;">`
      : `<input type="text" class="pc-input cm-name" value="${escHtml(row.name||'')}" data-i="${i}" placeholder="任意科目名" style="width:100%;">`;
    return `<tr>
      <td>${escHtml(row.code||'')}</td>
      <td>${divName}</td>
      <td>${nameCell}</td>
      <td><select class="pc-select cm-tax" data-i="${i}">${taxOpts}</select></td>
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
  saveCostMasterToStorage(costMaster);
  const res = await callGAS('saveCostMaster', { costMasterList: costMaster }).catch(() => null);
  if (res && res.status === 'ok') {
    showToast('科目マスタを保存しました', 'success');
  } else {
    showToast('保存失敗（ローカルには保存）', 'error');
  }
}

function renderStaff() {
  const staff = Array.isArray(settings?.staff) ? settings.staff : [];
  const body = document.getElementById('staff-body');
  if (staff.length === 0) {
    body.innerHTML = `<tr><td colspan="3" class="text-muted" style="text-align:center;padding:20px;">登録なし</td></tr>`;
    return;
  }
  body.innerHTML = staff.map(s => `<tr>
    <td>${escHtml(s.id||'')}</td>
    <td>${escHtml(s.name||'')}</td>
    <td>${escHtml(s.note||'')}</td>
  </tr>`).join('');
}
