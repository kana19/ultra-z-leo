/* pc-history.js — PC版 履歴・修正（左一覧＋右パネル4種） */
'use strict';

let history = [];
let selectedKey = null;

document.addEventListener('DOMContentLoaded', async () => {
  pcBootstrap('history.html', '履歴・修正');
  document.getElementById('f-month').value = new Date().toISOString().slice(0,7);
  document.getElementById('f-month').addEventListener('change', load);
  document.getElementById('btn-reload').addEventListener('click', load);
  await load();
});

async function load() {
  const month = document.getElementById('f-month').value;
  const res = await callGAS('getHistory', { month }).catch(() => null);
  history = (res && res.status === 'ok' && Array.isArray(res.data)) ? res.data : [];
  history.sort((a,b) => String(b.date).localeCompare(String(a.date)));
  renderList();
  renderDetail();
}

function getLockStatus(dateStr) {
  if (!dateStr) return { locked: true };
  const [dy, dm] = dateStr.split('-').map(Number);
  const n = new Date();
  const ty = n.getFullYear(), tm = n.getMonth()+1, td = n.getDate();
  if (dy === ty && dm === tm) return { locked:false, grace:false };
  const diff = (ty - dy) * 12 + (tm - dm);
  if (diff === 1 && td <= 3) return { locked:false, grace:true };
  if (diff >= 1) return { locked:true };
  return { locked:false };
}

function renderList() {
  const pane = document.getElementById('list-pane');
  if (history.length === 0) {
    pane.innerHTML = `<div class="pc-list-card text-muted" style="text-align:center;">履歴なし</div>`;
    return;
  }
  pane.innerHTML = history.map((it, i) => {
    const key = `${it.type}-${it.rowIndex}`;
    const active = key === selectedKey ? 'active' : '';
    const tagCls = it.type === 'sales' ? 'sales' : (it.type === 'cost' ? 'cost' : 'attend');
    const tagLabel = it.type === 'sales' ? '売上' : (it.type === 'cost' ? 'コスト' : '勤怠');
    const amount = it.type === 'attend' ? '' : formatYen(Number(it.amount)||0);
    const name = it.type === 'attend' ? (it.staffName||'') : (it.itemName||it.serviceName||'');
    return `<div class="pc-list-card ${active}" data-key="${key}" data-idx="${i}">
      <div class="pc-list-card__r1">
        <span>${escHtml(it.date||'')}</span>
        <span>${amount}</span>
      </div>
      <div class="pc-list-card__r2">
        <span class="pc-list-card__tag pc-list-card__tag--${tagCls}">${tagLabel}</span>
        ${escHtml(name)}
      </div>
    </div>`;
  }).join('');
  pane.querySelectorAll('.pc-list-card[data-key]').forEach(c => {
    c.addEventListener('click', () => {
      selectedKey = c.dataset.key;
      renderList();
      renderDetail();
    });
  });
}

function renderDetail() {
  const pane = document.getElementById('detail-pane');
  if (!selectedKey) {
    pane.innerHTML = `<div class="pc-detail-empty">左の一覧から行を選択してください</div>`;
    return;
  }
  const item = history.find(it => `${it.type}-${it.rowIndex}` === selectedKey);
  if (!item) {
    pane.innerHTML = `<div class="pc-detail-empty">データが見つかりません</div>`;
    return;
  }
  const ls = getLockStatus(item.date);

  if (ls.locked) {
    pane.innerHTML = `
      <div class="pc-banner">ロック中: この行は当月・猶予期間を過ぎたため編集できません</div>
      <h3>解除申請</h3>
      <div class="pc-form-row"><label>日付</label><span>${escHtml(item.date||'')}</span></div>
      <div class="pc-form-row"><label>内容</label><span>${escHtml(item.itemName||item.serviceName||item.staffName||'')}</span></div>
      <div class="pc-form-row"><label>金額</label><span>${item.type==='attend'?'—':formatYen(Number(item.amount)||0)}</span></div>
      <div class="pc-form-row"><label>理由</label><textarea class="pc-input" id="unlock-reason" rows="3" style="flex:1;max-width:500px;"></textarea></div>
      <div style="margin-top:16px;">
        <button class="pc-btn" id="btn-unlock">解除申請を送信</button>
      </div>
    `;
    document.getElementById('btn-unlock').addEventListener('click', () => {
      showToast('解除申請を送信しました（オーナー承認待ち）', 'info');
    });
    return;
  }

  // 通常修正パネル
  const isSales = item.type === 'sales';
  const isCost  = item.type === 'cost';
  const isAtt   = item.type === 'attend';

  if (ls.grace) {
    pane.innerHTML = `<div class="pc-banner">猶予期間中: 前月分を修正できます</div>` + editForm(item);
  } else {
    pane.innerHTML = `<div class="pc-banner pc-banner--muted">当月分: 自由に編集できます</div>` + editForm(item);
  }
  bindEditForm(item);
}

function editForm(item) {
  if (item.type === 'attend') {
    return `
      <h3>勤怠修正</h3>
      <div class="pc-form-row"><label>日付</label><input type="date" id="ef-date" class="pc-input" value="${escHtml(item.date||'')}"></div>
      <div class="pc-form-row"><label>スタッフ名</label><input type="text" id="ef-name" class="pc-input" value="${escHtml(item.staffName||'')}"></div>
      <div class="pc-form-row"><label>入店</label><input type="time" id="ef-ci" class="pc-input" value="${escHtml(item.clockIn||'')}"></div>
      <div class="pc-form-row"><label>退店</label><input type="time" id="ef-co" class="pc-input" value="${escHtml(item.clockOut||'')}"></div>
      <div style="margin-top:16px;"><button class="pc-btn" id="btn-save">保存</button></div>
    `;
  }
  const isSales = item.type === 'sales';
  const upField = isSales ? 'uncollected' : 'unpaid';
  const upLabel = isSales ? '未収' : '未払';
  const taxOpts = [0,8,10].map(v => `<option value="${v}" ${Number(item.taxRate)===v?'selected':''}>${v}%</option>`).join('');
  return `
    <h3>${isSales ? '売上' : 'コスト'}修正</h3>
    <div class="pc-form-row"><label>日付</label><input type="date" id="ef-date" class="pc-input" value="${escHtml(item.date||'')}"></div>
    <div class="pc-form-row"><label>品目名</label><input type="text" id="ef-name" class="pc-input" value="${escHtml(item.itemName||'')}"></div>
    <div class="pc-form-row"><label>税込金額</label><input type="number" id="ef-amount" class="pc-input" value="${Number(item.amount)||0}"></div>
    <div class="pc-form-row"><label>税率</label><select id="ef-tax" class="pc-select">${taxOpts}</select></div>
    <div class="pc-form-row"><label>メモ</label><input type="text" id="ef-memo" class="pc-input" value="${escHtml(item.memo||'')}"></div>
    <div class="pc-form-row"><label>${upLabel}</label><input type="checkbox" id="ef-flag" ${Number(item[upField])?'checked':''}></div>
    <div style="margin-top:16px;"><button class="pc-btn" id="btn-save">保存</button></div>
  `;
}

function bindEditForm(item) {
  const btn = document.getElementById('btn-save');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    let res;
    try {
      if (item.type === 'attend') {
        res = await callGAS('updateAttendance', {
          rowIndex: item.rowIndex,
          date: document.getElementById('ef-date').value,
          staffId: item.staffId || '',
          staffName: document.getElementById('ef-name').value.trim(),
          clockIn: document.getElementById('ef-ci').value,
          clockOut: document.getElementById('ef-co').value,
        });
      } else {
        const date = document.getElementById('ef-date').value;
        const name = document.getElementById('ef-name').value.trim();
        const amt  = parseInt(document.getElementById('ef-amount').value || '0', 10) || 0;
        const tax  = parseInt(document.getElementById('ef-tax').value, 10);
        const memo = document.getElementById('ef-memo').value;
        const flag = document.getElementById('ef-flag').checked ? 1 : 0;
        const { taxExcluded, tax: taxAmt } = calcTax(amt, tax);
        if (item.type === 'sales') {
          res = await callGAS('updateSales', {
            rowIndex: item.rowIndex, date,
            serviceName: name, serviceCode: item.serviceCode || '',
            amountExTax: taxExcluded, taxRate: tax, tax: taxAmt, amountInTax: amt,
            memo, uncollected: flag,
          });
        } else {
          res = await callGAS('updateCost', {
            rowIndex: item.rowIndex, date,
            divisionCode: item.divisionCode || '', divisionName: item.divisionName || '',
            itemCode: item.itemCode || '', itemName: name,
            taxExcluded, taxRate: tax, tax: taxAmt, taxIncluded: amt,
            memo, unpaid: flag,
          });
        }
      }
      if (res && res.status === 'ok') {
        showToast('保存しました', 'success');
        await load();
      } else {
        showToast('保存失敗', 'error');
      }
    } catch (e) {
      showToast('エラー: ' + e.message, 'error');
    }
  });
}
