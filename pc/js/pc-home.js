/* pc-home.js — PC版ホーム：13列×損益P&L + 折れ線グラフ */
'use strict';

const MONTHS = [1,2,3,4,5,6,7,8,9,10,11,12];
const now = new Date();
let selYear = now.getFullYear();
const curMonth = now.getMonth() + 1;

const expandedSections = { sales: false, cogs: false, sga: false };

document.addEventListener('DOMContentLoaded', async () => {
  pcBootstrap('index.html', 'ホーム（損益概観）');
  initYearSelect();
  await loadAndRender();
});

function initYearSelect() {
  const sel = document.getElementById('pc-year');
  for (let y = 2025; y <= now.getFullYear(); y++) {
    const opt = document.createElement('option');
    opt.value = y; opt.textContent = `${y}年`;
    if (y === selYear) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', async () => {
    selYear = Number(sel.value);
    await loadAndRender();
  });
}

async function loadAndRender() {
  document.getElementById('pc-status').textContent = '読み込み中…';
  const months = MONTHS.map(m => `${selYear}-${String(m).padStart(2,'0')}`);
  const results = await Promise.all(
    months.map(mo => callGAS('getSummary', { month: mo }).catch(() => null))
  );
  const monthly = results.map(r => (r && r.status === 'ok' && r.data) ? r.data : null);
  document.getElementById('pc-status').textContent = '';
  renderTable(monthly);
  renderChart(monthly);
}

function renderTable(monthly) {
  // ヘッダ
  const head = document.getElementById('pl-head');
  head.innerHTML = `<th>科目</th>` +
    MONTHS.map(m => {
      const cur = (selYear === now.getFullYear() && m === curMonth);
      return `<th class="num${cur ? ' col-current' : ''}">${m}月</th>`;
    }).join('') +
    `<th class="num col-total">年計</th>`;

  // セクション構築
  const body = document.getElementById('pl-body');
  const rows = [];

  // 売上
  rows.push(sectionRow('sales', '売上'));
  if (expandedSections.sales) {
    rows.push(...breakdownRows(monthly, 'salesBreakdown'));
  }
  // 売上原価
  rows.push(sectionRow('cogs', '売上原価'));
  if (expandedSections.cogs) {
    rows.push(...breakdownRows(monthly, 'cogsBreakdown'));
  }
  // 粗利
  rows.push(sumRow('粗利', monthly.map(d => d ? (Number(d.sales)||0) - (Number(d.cogs)||0) : 0)));

  // 販管費
  rows.push(sectionRow('sga', '販売管理費'));
  if (expandedSections.sga) {
    rows.push(...breakdownRows(monthly, 'sgaBreakdown'));
  }
  // 営業利益 = 粗利 - 販管費
  const opVals = monthly.map(d => d ? ((Number(d.sales)||0) - (Number(d.cogs)||0) - (Number(d.sga)||0)) : 0);
  rows.push(sumRow('営業利益', opVals));
  // 経常利益 (≒営業利益、簡易)
  rows.push(sumRow('経常利益', opVals));

  body.innerHTML = rows.join('');

  // アコーディオン
  body.querySelectorAll('.pl-row--section').forEach(tr => {
    tr.addEventListener('click', () => {
      const k = tr.dataset.key;
      expandedSections[k] = !expandedSections[k];
      renderTable(monthly);
      renderChart(monthly);
    });
  });
}

function sectionRow(key, label) {
  const monthKeys = { sales: 'sales', cogs: 'cogs', sga: 'sga' };
  // 値は再計算必要 — この関数では外から値渡されてないので別関数に
  return '';  // placeholder, replaced below
}

// 再実装（monthly を参照できるクロージャが必要）
function renderTableWithMonthly(monthly) {}

// ↑ 簡略化のため再構成
function sectionRowHtml(key, label, monthly, field) {
  const vals = monthly.map(d => d ? (Number(d[field]) || 0) : 0);
  const total = vals.reduce((a,b) => a+b, 0);
  const open = expandedSections[key] ? 'open' : '';
  const cells = vals.map((v, i) => {
    const cur = (selYear === now.getFullYear() && (i+1) === curMonth);
    return `<td class="num${cur ? ' col-current' : ''}">${v ? formatYen(v) : '—'}</td>`;
  }).join('');
  return `<tr class="pl-row--section ${open}" data-key="${key}"><td>${label}</td>${cells}<td class="num col-total">${formatYen(total)}</td></tr>`;
}

function sumRow(label, vals) {
  const total = vals.reduce((a,b) => a+b, 0);
  const cls = total < 0 ? 'pl-row--sum neg' : 'pl-row--sum';
  const cells = vals.map((v, i) => {
    const cur = (selYear === now.getFullYear() && (i+1) === curMonth);
    return `<td class="num${cur ? ' col-current' : ''}">${v ? formatYen(v) : '—'}</td>`;
  }).join('');
  return `<tr class="${cls}"><td>${label}</td>${cells}<td class="num col-total">${formatYen(total)}</td></tr>`;
}

function breakdownRows(monthly, field) {
  // 科目名をユニオン
  const nameSet = new Set();
  monthly.forEach(d => {
    if (d && Array.isArray(d[field])) {
      d[field].forEach(b => { if (b && b.name) nameSet.add(b.name); });
    }
  });
  const names = [...nameSet];
  if (names.length === 0) {
    return [`<tr class="pl-row--sub"><td>（データなし）</td>${MONTHS.map(() => '<td class="num">—</td>').join('')}<td class="num col-total">—</td></tr>`];
  }
  return names.map(name => {
    const vals = monthly.map(d => {
      if (!d || !Array.isArray(d[field])) return 0;
      const item = d[field].find(b => b.name === name);
      return item ? (Number(item.amount) || 0) : 0;
    });
    const total = vals.reduce((a,b) => a+b, 0);
    const cells = vals.map((v, i) => {
      const cur = (selYear === now.getFullYear() && (i+1) === curMonth);
      return `<td class="num${cur ? ' col-current' : ''}">${v ? formatYen(v) : '—'}</td>`;
    }).join('');
    return `<tr class="pl-row--sub"><td>${escHtml(name)}</td>${cells}<td class="num col-total">${formatYen(total)}</td></tr>`;
  });
}

/* ↑ renderTable を置き換え */
function renderTable(monthly) {
  const head = document.getElementById('pl-head');
  head.innerHTML = `<th>科目</th>` +
    MONTHS.map(m => {
      const cur = (selYear === now.getFullYear() && m === curMonth);
      return `<th class="num${cur ? ' col-current' : ''}">${m}月</th>`;
    }).join('') +
    `<th class="num col-total">年計</th>`;

  const body = document.getElementById('pl-body');
  const rows = [];

  rows.push(sectionRowHtml('sales', '売上', monthly, 'sales'));
  if (expandedSections.sales) rows.push(...breakdownRows(monthly, 'salesBreakdown'));

  rows.push(sectionRowHtml('cogs', '売上原価', monthly, 'cogs'));
  if (expandedSections.cogs) rows.push(...breakdownRows(monthly, 'cogsBreakdown'));

  rows.push(sumRow('粗利', monthly.map(d => d ? (Number(d.sales)||0) - (Number(d.cogs)||0) : 0)));

  rows.push(sectionRowHtml('sga', '販売管理費', monthly, 'sga'));
  if (expandedSections.sga) rows.push(...breakdownRows(monthly, 'sgaBreakdown'));

  const opVals = monthly.map(d => d ? ((Number(d.sales)||0) - (Number(d.cogs)||0) - (Number(d.sga)||0)) : 0);
  rows.push(sumRow('営業利益', opVals));
  rows.push(sumRow('経常利益', opVals));

  body.innerHTML = rows.join('');

  body.querySelectorAll('.pl-row--section').forEach(tr => {
    tr.addEventListener('click', () => {
      const k = tr.dataset.key;
      expandedSections[k] = !expandedSections[k];
      renderTable(monthly);
    });
  });
}

/* ── チャート ──────────────────────────────── */
let chartInstance = null;
function renderChart(monthly) {
  const ctx = document.getElementById('pl-chart');
  if (!ctx || typeof Chart === 'undefined') return;
  const labels = MONTHS.map(m => `${m}月`);
  const sales = monthly.map(d => d ? (Number(d.sales)||0) : 0);
  const cogs  = monthly.map(d => d ? (Number(d.cogs) ||0) : 0);
  const sga   = monthly.map(d => d ? (Number(d.sga)  ||0) : 0);

  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '売上',     data: sales, borderColor: '#D4AF37', backgroundColor: 'rgba(212,175,55,0.2)', tension: 0.3 },
        { label: '仕入原価', data: cogs,  borderColor: '#E05050', backgroundColor: 'rgba(224,80,80,0.2)', tension: 0.3 },
        { label: '販管費',   data: sga,   borderColor: '#6A9FD4', backgroundColor: 'rgba(106,159,212,0.2)', tension: 0.3 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#E8E0CC' } } },
      scales: {
        x: { ticks: { color: '#A09070' }, grid: { color: 'rgba(212,175,55,0.1)' } },
        y: { ticks: { color: '#A09070' }, grid: { color: 'rgba(212,175,55,0.1)' } },
      },
    },
  });
}
