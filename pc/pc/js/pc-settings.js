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
  let svcs = settings?.serviceList ?? settings?.services ?? [];
  if (typeof svcs === 'string') { try { svcs = JSON.parse(svcs); } catch { svcs = []; } }
  if (!Array.isArray(svcs)) svcs = [];
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

/**
 * employmentType 正規化（3種化対応・サイクルA）
 *   旧 'employed' および未設定はすべて 'employed_full' に寄せる
 */
function normalizeEmpType(value) {
  if (value === 'employed_full' || value === 'employed_temp' || value === 'contractor') return value;
  return 'employed_full';
}

/**
 * costCategory 正規化
 *   contractor時のコスト科目：'21'（外注工賃）/ '25'（税理士等の報酬）
 *   未設定・不正値は '21' にフォールバック
 */
function normalizeCostCategory(value) {
  if (value === '21' || value === '25') return value;
  return '21';
}

function renderStaff() {
  let staff = settings?.staffList ?? settings?.staff ?? [];
  if (typeof staff === 'string') { try { staff = JSON.parse(staff); } catch { staff = []; } }
  if (!Array.isArray(staff)) staff = [];
  const body = document.getElementById('staff-body');
  if (staff.length === 0) {
    body.innerHTML = `<tr><td colspan="5" class="text-muted" style="text-align:center;padding:20px;">登録なし</td></tr>`;
    return;
  }
  body.innerHTML = staff.map(s => {
    const empType = normalizeEmpType(s.employmentType);
    const costCat = normalizeCostCategory(s.costCategory);
    const sid = escHtml(String(s.id || ''));
    const empOpts = [
      ['employed_full', '常勤雇用(社員)'],
      ['employed_temp', '臨時アルバイト'],
      ['contractor',    '委託・外注']
    ].map(([v, label]) =>
      `<option value="${v}"${v === empType ? ' selected' : ''}>${label}</option>`
    ).join('');
    const costOpts = [
      ['21', '21:外注工賃'],
      ['25', '25:税理士等の報酬']
    ].map(([v, label]) =>
      `<option value="${v}"${v === costCat ? ' selected' : ''}>${label}</option>`
    ).join('');
    const costSelectDisabled = empType !== 'contractor';
    return `<tr>
      <td>${sid}</td>
      <td>${escHtml(s.name||'')}</td>
      <td>
        <select class="pc-select staff-emp-select" data-staff-id="${sid}" style="width:180px;">
          ${empOpts}
        </select>
      </td>
      <td>
        <select class="pc-select staff-cost-select" data-staff-id="${sid}" style="width:180px;"${costSelectDisabled ? ' disabled' : ''}>
          ${costOpts}
        </select>
      </td>
      <td>${escHtml(s.note||'')}</td>
    </tr>`;
  }).join('');

  // 雇用形態セレクトに変更ハンドラを束ねる(インライン保存)
  body.querySelectorAll('.staff-emp-select').forEach(sel => {
    sel.addEventListener('change', () => saveStaffEmpType(sel));
  });
  // コスト科目セレクトに変更ハンドラを束ねる(インライン保存)
  body.querySelectorAll('.staff-cost-select').forEach(sel => {
    sel.addEventListener('change', () => saveStaffCostCategory(sel));
  });
}

/**
 * 雇用形態セレクトを変更したらその場でGASに保存する
 *  - 全員分の最新 staffList を再構築して saveStaffList で送信
 *  - 楽観的に settings.staffList を更新
 *  - 委託・外注以外に変更時はコスト科目セレクトを非活性化
 */
async function saveStaffEmpType(selectEl) {
  const targetId = selectEl.dataset.staffId;
  const newType = normalizeEmpType(selectEl.value);
  let list = settings?.staffList ?? settings?.staff ?? [];
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = []; } }
  if (!Array.isArray(list)) list = [];

  const updated = list.map(s => {
    if (String(s.id) === String(targetId)) {
      return { ...s, employmentType: newType };
    }
    return s;
  });

  selectEl.disabled = true;
  let res;
  try {
    res = await callGAS('saveStaffList', { staffList: updated });
  } catch (e) {
    selectEl.disabled = false;
    showToast('通信エラー：' + (e.message || 'unknown'), 'error');
    return;
  }
  selectEl.disabled = false;

  if (res && res.status === 'ok') {
    settings.staffList = updated;
    // 同じ行のコスト科目セレクトの活性状態を更新
    const costSel = document.querySelector(`.staff-cost-select[data-staff-id="${targetId}"]`);
    if (costSel) costSel.disabled = (newType !== 'contractor');
    showToast('雇用形態を保存しました', 'success');
  } else {
    showToast('保存失敗：' + (res && res.message || '不明なエラー'), 'error');
  }
}

/**
 * コスト科目セレクトを変更したらその場でGASに保存する
 *  - contractor のスタッフのみ意味を持つ
 *  - 21:外注工賃 / 25:税理士等の報酬
 */
async function saveStaffCostCategory(selectEl) {
  const targetId = selectEl.dataset.staffId;
  const newCat = normalizeCostCategory(selectEl.value);
  let list = settings?.staffList ?? settings?.staff ?? [];
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = []; } }
  if (!Array.isArray(list)) list = [];

  const updated = list.map(s => {
    if (String(s.id) === String(targetId)) {
      return { ...s, costCategory: newCat };
    }
    return s;
  });

  selectEl.disabled = true;
  let res;
  try {
    res = await callGAS('saveStaffList', { staffList: updated });
  } catch (e) {
    selectEl.disabled = false;
    showToast('通信エラー：' + (e.message || 'unknown'), 'error');
    return;
  }
  selectEl.disabled = false;

  if (res && res.status === 'ok') {
    settings.staffList = updated;
    showToast('コスト科目を保存しました', 'success');
  } else {
    showToast('保存失敗：' + (res && res.message || '不明なエラー'), 'error');
  }
}
