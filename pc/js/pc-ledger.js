/* pc-ledger.js — PC版 未納・消込
 * 04§9 未納集計 + main.gs getUnpaid/reconcile/clearUnpaid の PC UI。
 * getUnpaid → 売掛(type='uncollected')+買掛(type='payable') の未消込行を返す。
 * このUIは書類発行と対（発行→未納→消込の一本道）。
 */
'use strict';

let _pcldgAll = [];
let _pcldgKind = 'all';
let _pcldgActive = null; // 消込対象 {sheetName,rowIndex,amount,type,itemName}

document.addEventListener('DOMContentLoaded', async () => {
  pcRenderSidebar('pc-ledger.html');
  pcApplyNavGates();
  bindKindTabs();
  bindModal();
  await loadUnpaid();
});

function bindKindTabs() {
  document.querySelectorAll('.pcldg-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _pcldgKind = btn.dataset.kind;
      document.querySelectorAll('.pcldg-tab').forEach(b => b.classList.toggle('pcldg-tab--active', b === btn));
      render();
    });
  });
}

async function loadUnpaid() {
  try {
    const res = await callGAS('getUnpaid', {});
    _pcldgAll = (res && res.status === 'ok' && Array.isArray(res.data)) ? res.data : [];
  } catch (e) {
    _pcldgAll = [];
    console.error('getUnpaid failed', e);
  }
  render();
}

function render() {
  const rows = _pcldgAll.filter(r => {
    if (_pcldgKind === 'recv') return r.type === 'uncollected';
    if (_pcldgKind === 'pay')  return r.type === 'payable';
    return true;
  });

  const tbody = document.getElementById('pcldg-tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="pcldg-empty">未納はありません。</td></tr>';
  } else {
    tbody.innerHTML = rows.map((r, i) => {
      const isRecv = r.type === 'uncollected';
      const badge = isRecv ? '<span class="pcldg-badge pcldg-badge--recv">売掛</span>'
                           : '<span class="pcldg-badge pcldg-badge--pay">買掛</span>';
      return `<tr>
        <td>${badge}</td>
        <td>${escHtml(r.date || '')}</td>
        <td>${escHtml(r.itemName || '')}</td>
        <td class="num">${formatYen(r.amount || 0)}</td>
        <td style="color:var(--uz-text2,#64748b); font-size:12px;">${escHtml(r.memo || '')}</td>
        <td style="white-space:nowrap;">
          <button type="button" class="pcldg-mini" onclick="openReconcile(${_pcldgAll.indexOf(r)})">消込</button>
          <button type="button" class="pcldg-mini pcldg-mini--danger" onclick="doClearUnpaid(${_pcldgAll.indexOf(r)})">削除</button>
        </td>
      </tr>`;
    }).join('');
  }

  // 集計
  const sumRecv = _pcldgAll.filter(r => r.type === 'uncollected').reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const sumPay  = _pcldgAll.filter(r => r.type === 'payable').reduce((s, r) => s + (Number(r.amount) || 0), 0);
  document.getElementById('pcldg-sum-recv').textContent = formatYen(sumRecv);
  document.getElementById('pcldg-sum-pay').textContent  = formatYen(sumPay);
  document.getElementById('pcldg-sum-net').textContent  = formatYen(sumRecv - sumPay);
}

/* ── 消込モーダル ── */
function bindModal() {
  document.getElementById('pcldg-modal-cancel').addEventListener('click', closeModal);
  document.getElementById('pcldg-modal-confirm').addEventListener('click', confirmReconcile);
  document.getElementById('pcldg-modal').addEventListener('click', (e) => {
    if (e.target.id === 'pcldg-modal') closeModal();
  });
}

function openReconcile(idx) {
  const r = _pcldgAll[idx];
  if (!r) return;
  _pcldgActive = r;
  const isRecv = r.type === 'uncollected';
  document.getElementById('pcldg-modal-title').textContent = isRecv ? '入金消込' : '支払消込';
  document.getElementById('pcldg-modal-target').innerHTML =
    `${escHtml(r.date || '')} ／ ${escHtml(r.itemName || '')} ／ <b>${formatYen(r.amount || 0)}</b>`;
  const now = new Date();
  document.getElementById('pcldg-paid-date').value = now.toISOString().slice(0, 10);
  document.getElementById('pcldg-paid-amount').value = r.amount || 0;
  const modal = document.getElementById('pcldg-modal');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  document.getElementById('pcldg-modal').setAttribute('aria-hidden', 'true');
  _pcldgActive = null;
}

async function confirmReconcile() {
  if (!_pcldgActive) return;
  const paidDate = document.getElementById('pcldg-paid-date').value;
  const paidAmount = Number(document.getElementById('pcldg-paid-amount').value) || 0;
  if (!paidDate) { showToast('実行日を入力してください', 'error'); return; }
  const btn = document.getElementById('pcldg-modal-confirm');
  btn.disabled = true;
  try {
    const res = await callGAS('reconcile', {
      sheetName: _pcldgActive.sheetName,
      rowIndex:  _pcldgActive.rowIndex,
      paidDate:  paidDate,
      paidAmount: paidAmount
    });
    if (res && res.status === 'ok') {
      showToast('消込しました ✓', 'success');
      closeModal();
      await loadUnpaid();
    } else {
      showToast((res && res.message) || '消込に失敗しました', 'error');
    }
  } catch (e) {
    showToast('通信エラーで消込できませんでした', 'error');
  } finally {
    btn.disabled = false;
  }
}

async function doClearUnpaid(idx) {
  const r = _pcldgAll[idx];
  if (!r) return;
  if (!confirm(`「${r.itemName}」（${formatYen(r.amount || 0)}）の未納状態を削除しますか？\n元データ（売上/コスト）は残ります。`)) return;
  try {
    const res = await callGAS('clearUnpaid', {
      sheetName: r.sheetName,
      rowIndex:  r.rowIndex,
      type:      r.type === 'uncollected' ? '未収' : '未払'
    });
    if (res && res.status === 'ok') {
      showToast('削除しました', 'success');
      await loadUnpaid();
    } else {
      showToast((res && res.message) || '削除に失敗しました', 'error');
    }
  } catch (e) {
    showToast('通信エラーで削除できませんでした', 'error');
  }
}

function escHtml(s) { return typeof uzEscHtml === 'function' ? uzEscHtml(s) : String(s ?? ''); }
