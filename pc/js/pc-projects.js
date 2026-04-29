/* pc-projects.js — PC版 案件粗利タブ（戦略思想§3-9-3 軸B 管理会計） */
'use strict';

async function loadProjectGrossProfit() {
  const body = document.getElementById('project-grossprofit-body');
  if (!body) return;

  body.innerHTML = '<div class="pc-loading">読み込み中...</div>';

  let res;
  try {
    res = await callGAS('getProjectGrossProfit', {});
  } catch (e) {
    body.innerHTML = `<div class="pc-error">通信エラー：${escHtmlPg(e.message || 'unknown')}</div>`;
    return;
  }
  if (!res || res.status !== 'ok') {
    body.innerHTML = `<div class="pc-error">取得失敗：${escHtmlPg(res && res.message || '不明なエラー')}</div>`;
    return;
  }
  renderProjectGrossProfitTable(body, Array.isArray(res.data) ? res.data : []);
}

function renderProjectGrossProfitTable(container, projects) {
  if (!projects || projects.length === 0) {
    container.innerHTML = `
      <div class="pc-empty">
        <p>紐付けられた案件がまだありません。</p>
        <p class="pc-empty__hint">売上・仕入原価の各タブから「案件ID」列に案件を紐付けると、ここに案件別の粗利が表示されます。</p>
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

function escHtmlPg(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}
