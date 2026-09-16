/* pc-home.js — PC版ホーム：13列×損益P&L + 折れ線グラフ */
'use strict';

const MONTHS = [1,2,3,4,5,6,7,8,9,10,11,12];
const now = new Date();
let selYear = now.getFullYear();
const curMonth = now.getMonth() + 1;

const expandedSections = { sales: false, cogs: false, sga: false };

// v0.16.1（2026-09-16）：会計元帳ビュー state（G シリーズ共通の土台）
const _pcLedgerState = { currentSide: 'recv', lastRp: null };

document.addEventListener('DOMContentLoaded', async () => {
  pcBootstrap('index.html', 'ホーム（損益概観）');
  initYearSelect();
  initTaxDL();
  initLedgerMonthSelect();
  await loadAndRender();
  loadRecentEntries();
  loadLedgerSections();
});

function initTaxDL() {
  const fromSel = document.getElementById('pc-tax-from');
  const toSel   = document.getElementById('pc-tax-to');
  const btn     = document.getElementById('pc-tax-dl-btn');
  if (!fromSel || !toSel || !btn) return;

  const now       = new Date();
  const curMonth  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const fromDef   = `${Math.max(now.getFullYear(), 2025)}-01`;
  buildMonthOptions(fromSel, fromDef);
  buildMonthOptions(toSel,   curMonth);

  btn.addEventListener('click', () => {
    downloadTaxCSVByRange(fromSel.value, toSel.value, btn);
  });
}

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

/**
 * v0.16.1（2026-09-16）：2 段深堀り階層 render（分類 → 科目）
 *   getSummary の応答形式：{name: 分類名, amount: 合計, items:[{name: 科目名, amount: 合計}]}
 *   売上・仕入原価は 2 段（分類レイヤ ▼＋ 科目レイヤ indent）／ 販管費は分類なしゆえ 1 段（items 空配列）。
 *   販管費は items:[] ゆえ分類レイヤ ▼ を出さず科目名として直接表示。
 */
function breakdownRows(monthly, field) {
  // 分類名をユニオン（全月にまたがる分類）
  const catSet = new Set();
  monthly.forEach(d => {
    if (d && Array.isArray(d[field])) {
      d[field].forEach(b => { if (b && b.name) catSet.add(b.name); });
    }
  });
  const cats = [...catSet];
  if (cats.length === 0) {
    return [`<tr class="pl-row--sub"><td>（データなし）</td>${MONTHS.map(() => '<td class="num">—</td>').join('')}<td class="num col-total">—</td></tr>`];
  }
  const rows = [];
  cats.forEach(catName => {
    // 分類レベル 12 ヶ月合計
    const catVals = monthly.map(d => {
      if (!d || !Array.isArray(d[field])) return 0;
      const catObj = d[field].find(b => b.name === catName);
      return catObj ? (Number(catObj.amount) || 0) : 0;
    });
    const catTotal = catVals.reduce((a, b) => a + b, 0);
    const catCells = catVals.map((v, i) => {
      const cur = (selYear === now.getFullYear() && (i + 1) === curMonth);
      return `<td class="num${cur ? ' col-current' : ''}">${v ? formatYen(v) : '—'}</td>`;
    }).join('');
    // 科目名の union（全月分・items[] は分類ごと）
    const itemSet = new Set();
    monthly.forEach(d => {
      if (!d || !Array.isArray(d[field])) return;
      const catObj = d[field].find(b => b.name === catName);
      if (catObj && Array.isArray(catObj.items)) {
        catObj.items.forEach(it => { if (it && it.name) itemSet.add(it.name); });
      }
    });
    const items = [...itemSet];
    if (items.length === 0) {
      // 販管費など分類レイヤなし＝ 分類名を科目名として直接出力（1 段のみ・drillable）
      const key = _makeLedgerKey_(field, catName, catName);
      rows.push(`<tr class="pl-row--sub pl-row--drillable" data-ledger-key="${key}" style="cursor:pointer;"><td style="padding-left:16px;">${escHtml(catName)} <span style="color:var(--uz-text3,#999);font-size:11px;">▸ 明細</span></td>${catCells}<td class="num col-total">${formatYen(catTotal)}</td></tr>`);
    } else {
      // 分類レベル行（▼＋ 分類名・drillable ではない）
      rows.push(`<tr class="pl-row--sub" style="background:rgba(0,0,0,0.03);font-weight:600;"><td style="padding-left:16px;">▼${escHtml(catName)}</td>${catCells}<td class="num col-total">${formatYen(catTotal)}</td></tr>`);
      // 科目レベル行（indent 深く・分類配下の各科目・drillable＝ 3 段目明細展開）
      items.forEach(itemName => {
        const itemVals = monthly.map(d => {
          if (!d || !Array.isArray(d[field])) return 0;
          const catObj = d[field].find(b => b.name === catName);
          if (!catObj || !Array.isArray(catObj.items)) return 0;
          const it = catObj.items.find(i => i.name === itemName);
          return it ? (Number(it.amount) || 0) : 0;
        });
        const itemTotal = itemVals.reduce((a, b) => a + b, 0);
        const itemCells = itemVals.map((v, i) => {
          const cur = (selYear === now.getFullYear() && (i + 1) === curMonth);
          return `<td class="num${cur ? ' col-current' : ''}">${v ? formatYen(v) : '—'}</td>`;
        }).join('');
        const key = _makeLedgerKey_(field, catName, itemName);
        rows.push(`<tr class="pl-row--sub pl-row--drillable" data-ledger-key="${key}" style="cursor:pointer;"><td style="padding-left:36px;color:var(--uz-text2);">${escHtml(itemName)} <span style="color:var(--uz-text3,#999);font-size:11px;">▸ 明細</span></td>${itemCells}<td class="num col-total">${formatYen(itemTotal)}</td></tr>`);
      });
    }
  });
  return rows;
}

// v0.16.1：科目別元帳 3 段目 (取引明細) 深堀り用のキー生成。
//   科目行の data-ledger-key に埋め込み、click 時に field/分類名/科目名 を復元。
function _makeLedgerKey_(field, catName, itemName) {
  return `${field}::${encodeURIComponent(catName)}::${encodeURIComponent(itemName)}`;
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

  // v0.16.1：科目別元帳 3 段目 (取引明細) 深堀り＝ 科目行クリック→ 明細行を tr 挿入
  body.querySelectorAll('.pl-row--drillable').forEach(tr => {
    tr.addEventListener('click', () => togglePcLedgerRow(tr));
  });
}

/**
 * v0.16.1：科目別元帳 3 段目 (取引明細) 深堀り。
 *   科目行をクリック→ 対象月 (会計元帳ビューの pc-ledger-month select 値) の明細を tr 挿入で展開。
 *   再クリック→ 明細行を除去 (toggle)。pl.js の togglePlLedger を Table 構造に移植・全 clientId 同一ロジック。
 *   getHistory 応答から type/divisionCode/itemName で filter→ 発生日昇順で明細行 render。
 *   明細列＝ 発生日 / 相手先/摘要 / 税抜 / 税率 / 消費税 / 税込（金光要求 5 項目＋消費税額）。
 */
async function togglePcLedgerRow(tr) {
  const key = tr.dataset.ledgerKey;
  if (!key) return;
  const nextTr = tr.nextElementSibling;
  const isAlreadyOpen = nextTr && nextTr.classList.contains('pl-row--ledger');
  if (isAlreadyOpen) {
    nextTr.remove();
    return;
  }
  const parts = key.split('::');
  const field = parts[0];
  const catName = decodeURIComponent(parts[1] || '');
  const itemName = decodeURIComponent(parts[2] || '');
  const sel = document.getElementById('pc-ledger-month');
  const monthStr = sel ? sel.value : '';
  if (!monthStr) return;
  const cols = MONTHS.length + 2;   // 科目 + 12 ヶ月 + 年計
  const ledgerTr = document.createElement('tr');
  ledgerTr.className = 'pl-row--ledger';
  ledgerTr.innerHTML = `<td colspan="${cols}" style="padding:0;"><div style="padding:12px;color:var(--uz-text2);font-size:13px;">読み込み中…</div></td>`;
  tr.after(ledgerTr);
  try {
    const res = await callGAS('getHistory', { month: monthStr });
    if (!res || res.status !== 'ok' || !Array.isArray(res.data)) {
      ledgerTr.innerHTML = `<td colspan="${cols}" style="padding:0;"><div style="padding:12px;color:var(--uz-red,#c0392b);font-size:13px;">明細データを取得できませんでした</div></td>`;
      return;
    }
    const filtered = res.data.filter(r => {
      // 種別 filter：field で type/divisionCode 判定
      if (field === 'salesBreakdown' && r.type !== 'sales') return false;
      if (field === 'cogsBreakdown' && !(r.type === 'cost' && String(r.divisionCode) === '1')) return false;
      if (field === 'sgaBreakdown'  && !(r.type === 'cost' && String(r.divisionCode) !== '1')) return false;
      // 科目名 filter：getHistory の r.itemName で照合（pl.js と同じ規約）
      const rowItemName = String(r.itemName || (r.type === 'sales' ? '売上' : '経費')).trim();
      return rowItemName === itemName;
    }).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    if (filtered.length === 0) {
      ledgerTr.innerHTML = `<td colspan="${cols}" style="padding:0;"><div style="padding:12px;text-align:center;color:var(--uz-text2);font-size:13px;">${escHtml(monthStr)} の ${escHtml(itemName)} 明細なし</div></td>`;
      return;
    }
    const rowsHtml = filtered.map(r => {
      const amt  = Number(r.amount) || 0;
      const tax  = Number(r.taxAmount) || 0;
      const rate = Number(r.taxRate) || 0;
      const base = amt - tax;
      const label = r.memo || r.itemName || '';
      return `<tr>
        <td>${escHtml(r.date || '')}</td>
        <td>${escHtml(label)}</td>
        <td class="num">${formatYen(base)}</td>
        <td class="num">${rate}%</td>
        <td class="num">${formatYen(tax)}</td>
        <td class="num">${formatYen(amt)}</td>
      </tr>`;
    }).join('');
    ledgerTr.innerHTML = `<td colspan="${cols}" style="padding:0;">
      <div style="padding:8px 12px;background:rgba(0,0,0,0.02);border-left:3px solid var(--uz-accent,#b8860b);">
        <div style="font-size:12px;color:var(--uz-text2);margin-bottom:6px;">
          <b>${escHtml(catName)}</b> → <b>${escHtml(itemName)}</b>（対象月：${escHtml(monthStr)}・${filtered.length} 件）
        </div>
        <table class="pl-table" style="width:100%;">
          <thead>
            <tr>
              <th style="width:110px;">発生日</th>
              <th>相手先/摘要</th>
              <th class="num" style="width:120px;">税抜</th>
              <th class="num" style="width:80px;">税率</th>
              <th class="num" style="width:120px;">消費税</th>
              <th class="num" style="width:120px;">税込</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </td>`;
  } catch (err) {
    console.warn('[togglePcLedgerRow]', err);
    ledgerTr.innerHTML = `<td colspan="${cols}" style="padding:0;"><div style="padding:12px;color:var(--uz-red,#c0392b);font-size:13px;">エラー：${escHtml(String(err.message || err))}</div></td>`;
  }
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
  const _cs2 = getComputedStyle(document.documentElement);
  const _cS  = _cs2.getPropertyValue('--uz-sales').trim()  || '#333333';
  const _cC  = _cs2.getPropertyValue('--uz-cost').trim()   || '#C0392B';
  const _cI  = _cs2.getPropertyValue('--uz-info').trim()   || '#2980B9';
  const _cT  = _cs2.getPropertyValue('--uz-text').trim()   || '#1A1A1A';
  const _cM  = _cs2.getPropertyValue('--uz-text2').trim()  || '#666666';
  const _cG  = _cs2.getPropertyValue('--uz-border').trim() || 'rgba(0,0,0,0.10)';
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '売上',     data: sales, borderColor: _cS, backgroundColor: _cS + '33', tension: 0.3 },
        { label: '仕入原価', data: cogs,  borderColor: _cC, backgroundColor: _cC + '33', tension: 0.3 },
        { label: '販管費',   data: sga,   borderColor: _cI, backgroundColor: _cI + '33', tension: 0.3 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: _cT } } },
      scales: {
        x: { ticks: { color: _cM }, grid: { color: _cG } },
        y: { ticks: { color: _cM }, grid: { color: _cG } },
      },
    },
  });
}

/* ── 直近入力テーブル ──────────────────────────── */
async function loadRecentEntries() {
  const tbody = document.getElementById('pc-recent-body');
  const empty = document.getElementById('pc-recent-empty');
  if (!tbody) return;

  const n   = new Date();
  const month = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;

  try {
    const [salesRes, costRes] = await Promise.all([
      callGAS('getHistory', { type: 'sales', month }).catch(() => null),
      callGAS('getHistory', { type: 'cost',  month }).catch(() => null),
    ]);

    const items = [];
    if (salesRes && salesRes.status === 'ok' && Array.isArray(salesRes.data)) {
      salesRes.data.forEach(r => items.push({
        name:   r.service || r.serviceName || '売上',
        amount: r.taxIncluded ?? r.amount ?? 0,
        type:   'sales',
        date:   String(r.date || ''),
      }));
    }
    if (costRes && costRes.status === 'ok' && Array.isArray(costRes.data)) {
      costRes.data.forEach(r => items.push({
        name:   r.itemName || r.item || 'コスト',
        amount: r.taxIncluded ?? r.amount ?? 0,
        type:   'cost',
        date:   String(r.date || ''),
      }));
    }

    items.sort((a, b) => b.date.localeCompare(a.date));
    const top = items.slice(0, 15);

    if (top.length === 0) {
      tbody.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    tbody.innerHTML = top.map(it => {
      const md    = it.date.replace(/(\d{4})-(\d{2})-(\d{2})/, '$2/$3');
      const nm    = escHtml(it.name).substring(0, 20);
      const _csR  = getComputedStyle(document.documentElement);
      const _colS = _csR.getPropertyValue('--uz-sales').trim() || '#333333';
      const _colC = _csR.getPropertyValue('--uz-cost').trim()  || '#C0392B';
      const badge = it.type === 'sales'
        ? `<span style="color:${_colS};">売上</span>`
        : `<span style="color:${_colC};">コスト</span>`;
      const color = it.type === 'sales' ? _colS : _colC;
      return `<tr>
        <td style="white-space:nowrap;">${md}</td>
        <td>${badge}</td>
        <td>${nm}</td>
        <td class="num" style="color:${color};">${formatYen(it.amount)}</td>
      </tr>`;
    }).join('');
  } catch {
    tbody.innerHTML = '';
    if (empty) empty.hidden = false;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   会計元帳ビュー（v0.15.0/v0.16.1・IT 導入補助金 インボイス対応類型 登録の会計 1 機能）
   G シリーズ共通の土台＝ ②売掛/買掛元帳＋残高／③税率別消費税集計 の 2 機能を実装。
   ①科目別元帳は上部 P&L テーブルの 2 段深堀り階層 (▼分類→科目) で担保。
   pl.js の実装 (PWA/iPad 側) を PC 版損益概観画面に移植。
   read-only・書込みなし・全 clientId 同一ロジック（特定 clientId ハードコードなし・§◎ 再現性ルール準拠）
   ══════════════════════════════════════════════════════════════════════ */

function initLedgerMonthSelect() {
  const sel = document.getElementById('pc-ledger-month');
  if (!sel) return;
  const n = new Date();
  const curMonthKey = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  // 直近 24 ヶ月を選択肢に
  for (let i = 0; i < 24; i++) {
    const d = new Date(n.getFullYear(), n.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = key;
    if (key === curMonthKey) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => { loadLedgerSections(); });
}

async function loadLedgerSections() {
  const sel = document.getElementById('pc-ledger-month');
  const monthStr = sel ? sel.value : '';
  if (!monthStr) return;
  const body = document.getElementById('pc-ledger-body');
  const taxBody = document.getElementById('pc-tax-body');
  if (body) body.innerHTML = '<div style="padding:16px;text-align:center;color:var(--uz-text2);font-size:13px;">読み込み中…</div>';
  if (taxBody) taxBody.innerHTML = '<div style="padding:16px;text-align:center;color:var(--uz-text2);font-size:13px;">読み込み中…</div>';

  // ②売掛/買掛元帳＋残高（新 API・残高は累計・entries は month 絞込）
  let rp = null;
  try {
    const res = await callGAS('getReceivablePayableLedger', { month: monthStr });
    if (res && res.status === 'ok') rp = res.data;
  } catch (err) {
    console.warn('[getReceivablePayableLedger]', err);
  }
  _pcLedgerState.lastRp = rp;
  renderPcReceivablePayable();
  bindPcLedgerTabs();

  // ③税率別消費税集計（既存 getHistory から client 側算出）
  let history = [];
  try {
    const res = await callGAS('getHistory', { month: monthStr });
    if (res && res.status === 'ok' && Array.isArray(res.data)) history = res.data;
  } catch (err) {
    console.warn('[getHistory]', err);
  }
  renderPcTaxByRate(history);
}

function bindPcLedgerTabs() {
  document.querySelectorAll('.pc-ledger-tab').forEach(btn => {
    if (btn.dataset._pcBound) return;
    btn.dataset._pcBound = '1';
    btn.addEventListener('click', () => {
      _pcLedgerState.currentSide = btn.dataset.side;
      document.querySelectorAll('.pc-ledger-tab').forEach(b => {
        const isActive = (b === btn);
        b.classList.toggle('pc-ledger-tab--active', isActive);
        // ghost/primary の見た目切替
        if (isActive) {
          b.classList.remove('pc-btn--ghost');
        } else {
          b.classList.add('pc-btn--ghost');
        }
      });
      renderPcReceivablePayable();
    });
  });
}

function renderPcReceivablePayable() {
  const body = document.getElementById('pc-ledger-body');
  const recvEl = document.getElementById('pc-ledger-recv-balance');
  const payEl = document.getElementById('pc-ledger-pay-balance');
  const rp = _pcLedgerState.lastRp;
  if (!body || !recvEl || !payEl) return;
  if (!rp) {
    body.innerHTML = '<div style="padding:16px;text-align:center;color:var(--uz-text2);font-size:13px;">元帳データを取得できませんでした。</div>';
    recvEl.textContent = '—';
    payEl.textContent = '—';
    return;
  }
  recvEl.textContent = formatYen(rp.receivableBalance || 0);
  payEl.textContent = formatYen(rp.payableBalance || 0);
  const entries = _pcLedgerState.currentSide === 'pay' ? (rp.payable || []) : (rp.receivable || []);
  if (entries.length === 0) {
    body.innerHTML = '<div style="padding:16px;text-align:center;color:var(--uz-text2);font-size:13px;">当月の発生・消込はありません。</div>';
    return;
  }
  body.innerHTML = `
    <table class="pl-table" style="width:100%;">
      <thead>
        <tr>
          <th style="width:110px;">発生日</th>
          <th>相手先/摘要</th>
          <th class="num" style="width:130px;">税込金額</th>
          <th style="width:150px;">状態</th>
        </tr>
      </thead>
      <tbody>
        ${entries.map(e => {
          const statusHtml = e.reconciled
            ? `<span style="color:var(--uz-green,#28a745);">✓ 消込 ${escHtml(e.paidDate || '')}</span>`
            : `<span style="color:var(--uz-red,#c0392b);">未消込</span>`;
          return `<tr>
            <td>${escHtml(e.date || '')}</td>
            <td>${escHtml(e.itemName || '不明')}</td>
            <td class="num">${formatYen(e.amountIncl || 0)}</td>
            <td>${statusHtml}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

function renderPcTaxByRate(history) {
  const taxBody = document.getElementById('pc-tax-body');
  const estEl = document.getElementById('pc-tax-estimate');
  if (!taxBody || !estEl) return;

  const buckets = { sales: {}, cogs: {}, sga: {} };
  function init(side, rate) {
    if (!buckets[side][rate]) buckets[side][rate] = { base: 0, tax: 0 };
    return buckets[side][rate];
  }
  (history || []).forEach(r => {
    const rate = Number(r.taxRate) || 0;
    const tax = Number(r.taxAmount) || 0;
    const amountIncl = Number(r.amount) || 0;
    const base = amountIncl - tax;
    if (r.type === 'sales') {
      const b = init('sales', rate); b.base += base; b.tax += tax;
    } else if (r.type === 'cost') {
      const side = String(r.divisionCode) === '1' ? 'cogs' : 'sga';
      const b = init(side, rate); b.base += base; b.tax += tax;
    }
  });

  const rateOrder = [10, 8, 0];
  function renderSide(label, byRate) {
    const rates = Object.keys(byRate).map(Number).sort((a, b) =>
      (rateOrder.indexOf(b) - rateOrder.indexOf(a)) || (b - a));
    if (rates.length === 0) {
      return `<div style="margin-bottom:8px;"><div style="font-weight:600;font-size:13px;margin-bottom:4px;">${label}</div>
        <div style="padding:8px 12px;background:rgba(0,0,0,0.02);border-radius:4px;color:var(--uz-text2);font-size:13px;">当月データなし</div></div>`;
    }
    const rows = rates.map(rate => {
      const v = byRate[rate];
      return `<tr><td>${rate}%</td><td class="num">${formatYen(v.base)}</td><td class="num">${formatYen(v.tax)}</td></tr>`;
    }).join('');
    const totalBase = rates.reduce((s, r) => s + byRate[r].base, 0);
    const totalTax = rates.reduce((s, r) => s + byRate[r].tax, 0);
    return `
      <div style="margin-bottom:12px;">
        <div style="font-weight:600;font-size:13px;margin-bottom:4px;">${label}</div>
        <table class="pl-table" style="width:100%;">
          <thead><tr><th style="width:80px;">税率</th><th class="num">課税標準額</th><th class="num">消費税額</th></tr></thead>
          <tbody>${rows}
            <tr style="background:rgba(0,0,0,0.03);font-weight:600;">
              <td>合計</td><td class="num">${formatYen(totalBase)}</td><td class="num">${formatYen(totalTax)}</td>
            </tr>
          </tbody>
        </table>
      </div>`;
  }

  taxBody.innerHTML =
    renderSide('売上', buckets.sales) +
    renderSide('仕入原価', buckets.cogs) +
    renderSide('販管費', buckets.sga);

  const salesTax = Object.values(buckets.sales).reduce((s, v) => s + v.tax, 0);
  const cogsTax = Object.values(buckets.cogs).reduce((s, v) => s + v.tax, 0);
  const sgaTax = Object.values(buckets.sga).reduce((s, v) => s + v.tax, 0);
  const payable = salesTax - cogsTax - sgaTax;
  estEl.innerHTML =
    `純納付見込（当月概算）：<b>${formatYen(payable)}</b>　＝　売上消費税 ${formatYen(salesTax)} − 仕入税額控除 ${formatYen(cogsTax + sgaTax)}`;
}
