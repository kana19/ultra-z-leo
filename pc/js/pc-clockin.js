/* pc-clockin.js — PC版 入店記録（月次一覧・インライン編集） */
'use strict';

let att = [];
let editingKey = null;

document.addEventListener('DOMContentLoaded', async () => {
  pcBootstrap('clockin.html', '入店記録');
  document.getElementById('f-month').value = new Date().toISOString().slice(0,7);
  document.getElementById('f-month').addEventListener('change', load);
  document.getElementById('btn-reload').addEventListener('click', load);
  await load();
});

async function load() {
  const month = document.getElementById('f-month').value;
  const res = await callGAS('getAttendanceByMonth', { month }).catch(() => null);
  att = (res && res.status === 'ok' && Array.isArray(res.data)) ? res.data : [];
  att.sort((a,b) => String(b.date).localeCompare(String(a.date)));
  render();
}

function calcWork(ci, co) {
  if (!ci || !co) return '';
  const [h1,m1] = ci.split(':').map(Number);
  const [h2,m2] = co.split(':').map(Number);
  let mins = (h2*60+m2) - (h1*60+m1);
  if (mins < 0) mins += 24*60;
  return `${Math.floor(mins/60)}h${String(mins%60).padStart(2,'0')}m`;
}

function render() {
  const body = document.getElementById('att-body');
  if (att.length === 0) {
    body.innerHTML = `<tr><td colspan="6" class="text-muted" style="text-align:center;padding:30px;">データなし</td></tr>`;
    return;
  }
  body.innerHTML = att.map(it => {
    const key = it.rowIndex;
    const editing = String(editingKey) === String(key);
    if (editing) {
      return `<tr data-key="${key}">
        <td><input type="date" class="pc-input ef-date" value="${escHtml(it.date||'')}"></td>
        <td><input type="text" class="pc-input ef-name" value="${escHtml(it.staffName||'')}" style="width:100%;"></td>
        <td><input type="time" class="pc-input ef-ci" value="${escHtml(it.clockIn||'')}" style="width:84px;"></td>
        <td><input type="time" class="pc-input ef-co" value="${escHtml(it.clockOut||'')}" style="width:84px;"></td>
        <td>—</td>
        <td>
          <button class="pc-btn pc-btn--sm btn-save">確定</button>
          <button class="pc-btn pc-btn--sm pc-btn--ghost btn-cancel">取消</button>
        </td>
      </tr>`;
    }
    return `<tr data-key="${key}">
      <td>${escHtml(it.date||'')}</td>
      <td>${escHtml(it.staffName||'')}</td>
      <td>${escHtml(it.clockIn||'')}</td>
      <td>${escHtml(it.clockOut||'—')}</td>
      <td>${calcWork(it.clockIn, it.clockOut)}</td>
      <td><button class="pc-btn pc-btn--sm btn-edit">編集</button></td>
    </tr>`;
  }).join('');
  bindEvents();
}

function bindEvents() {
  document.querySelectorAll('.btn-edit').forEach(b => b.addEventListener('click', e => {
    editingKey = e.target.closest('tr').dataset.key; render();
  }));
  document.querySelectorAll('.btn-cancel').forEach(b => b.addEventListener('click', () => {
    editingKey = null; render();
  }));
  document.querySelectorAll('.btn-save').forEach(b => b.addEventListener('click', onSave));
}

async function onSave(e) {
  const tr = e.target.closest('tr');
  const orig = att.find(x => String(x.rowIndex) === tr.dataset.key);
  if (!orig) return;
  const data = {
    rowIndex: orig.rowIndex,
    date: tr.querySelector('.ef-date').value,
    staffId: orig.staffId || '',
    staffName: tr.querySelector('.ef-name').value.trim(),
    clockIn: tr.querySelector('.ef-ci').value,
    clockOut: tr.querySelector('.ef-co').value,
  };
  const res = await callGAS('updateAttendance', data).catch(() => null);
  if (res && res.status === 'ok') {
    showToast('保存しました', 'success');
    editingKey = null;
    await load();
  } else {
    showToast('保存失敗', 'error');
  }
}
