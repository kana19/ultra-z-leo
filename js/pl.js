/**
 * ウルトラ財務くん LEO版 PWA — pl.js
 * 損益サマリー画面ロジック（GAS getSummary 連携版）
 */

'use strict';

/* ── GASレスポンスキャッシュ ─────────────────────────────── */
const gasCache = {};

async function fetchSummary(monthStr) {
  if (gasCache[monthStr] !== undefined) return gasCache[monthStr];
  try {
    const res = await callGAS('getSummary', { month: monthStr });
    const data = (res && res.status === 'ok' && res.data) ? res.data : null;
    gasCache[monthStr] = data;
    return data;
  } catch (e) {
    gasCache[monthStr] = null;
    return null;
  }
}

/* ── 定数 ────────────────────────────────────────────────── */
const _now       = new Date();
const THIS_YEAR  = _now.getFullYear();
const THIS_MONTH = _now.getMonth() + 1;
const MIN_YEAR   = 2025;

/* ── 状態 ────────────────────────────────────────────────── */
let currentTab    = 'monthly';
let currentPeriod = `${THIS_YEAR}-${String(THIS_MONTH).padStart(2, '0')}`;
let currentYear   = THIS_YEAR;
let compareMode   = false;
const expandState = {};

/* ── 初期化 ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  bindTabs();
  bindPeriodNav();
  bindCompareBtn();
  bindYtdCompareBtn();
  bindTaxDownload();
  renderAll();
});

/* ── タブ切替 ────────────────────────────────────────────── */
function bindTabs() {
  document.querySelectorAll('.pl-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      document.querySelectorAll('.pl-tab').forEach(b =>
        b.classList.toggle('pl-tab--active', b === btn)
      );
      compareMode = false;
      updateCompareBtn();
      renderAll();
    });
  });
}

/* ── 期間ナビゲーション ──────────────────────────────────── */
function bindPeriodNav() {
  document.getElementById('period-prev')?.addEventListener('click', () => movePeriod(-1));
  document.getElementById('period-next')?.addEventListener('click', () => movePeriod(+1));
  document.getElementById('ytd-prev')?.addEventListener('click',    () => moveYear(-1));
  document.getElementById('ytd-next')?.addEventListener('click',    () => moveYear(+1));
}

function movePeriod(dir) {
  const [y, m] = currentPeriod.split('-').map(Number);
  let newM = m + dir;
  let newY = y;
  if (newM < 1)  { newY--; newM = 12; }
  if (newM > 12) { newY++; newM = 1; }
  if (newY < MIN_YEAR) return;
  if (newY > THIS_YEAR || (newY === THIS_YEAR && newM > THIS_MONTH)) return;
  currentPeriod = `${newY}-${String(newM).padStart(2, '0')}`;
  compareMode   = false;
  updateCompareBtn();
  renderAll();
}

function moveYear(dir) {
  const newYear = currentYear + dir;
  if (newYear < MIN_YEAR || newYear > THIS_YEAR) return;
  currentYear = newYear;
  renderAll();
}

/* ── 比較モード ──────────────────────────────────────────── */
function bindCompareBtn() {
  document.getElementById('compare-btn')?.addEventListener('click', () => {
    compareMode = !compareMode;
    updateCompareBtn();
    renderAll();
  });
}

function updateCompareBtn() {
  const btn = document.getElementById('compare-btn');
  if (!btn) return;
  btn.classList.toggle('pl-compare-btn--active', compareMode);
  btn.setAttribute('aria-pressed', String(compareMode));
  btn.textContent = compareMode ? '前年同月比 ON' : '前年同月比';
}

function bindYtdCompareBtn() {
  document.getElementById('ytd-compare-btn')?.addEventListener('click', () => {
    compareMode = !compareMode;
    const btn = document.getElementById('ytd-compare-btn');
    if (btn) {
      btn.classList.toggle('pl-compare-btn--active', compareMode);
      btn.setAttribute('aria-pressed', String(compareMode));
      btn.textContent = compareMode ? '前年比較 ON' : '前年比較';
    }
    renderAll();
  });
}

/* ── 描画エントリ ────────────────────────────────────────── */
function renderAll() {
  if (currentTab === 'monthly') {
    renderMonthly();
  } else {
    renderYTD();
  }
}

/* ── 月次描画 ────────────────────────────────────────────── */
async function renderMonthly() {
  showSection('monthly-section');
  hideSection('ytd-section');

  const [y, m] = currentPeriod.split('-').map(Number);

  const labelEl = document.getElementById('period-label');
  if (labelEl) labelEl.textContent = `${y}年${m}月`;

  const isMin = y === MIN_YEAR && m === 1;
  const isMax = y === THIS_YEAR && m === THIS_MONTH;
  const prevBtn = document.getElementById('period-prev');
  const nextBtn = document.getElementById('period-next');
  if (prevBtn) prevBtn.disabled = isMin;
  if (nextBtn) nextBtn.disabled = isMax;

  showLoading('pl-table');

  const data = await fetchSummary(currentPeriod);

  const prevKey  = `${y - 1}-${String(m).padStart(2, '0')}`;
  const prevData = compareMode ? await fetchSummary(prevKey) : null;

  const infoBanner = document.getElementById('compare-info');
  if (infoBanner) {
    infoBanner.classList.toggle('pl-compare-info--show', compareMode);
    if (compareMode) {
      infoBanner.textContent = prevData
        ? `比較対象: ${y - 1}年${m}月`
        : '前年同月のデータがありません';
    }
  }

  if (!data) {
    renderEmpty('pl-table');
    return;
  }

  const gross  = data.sales - data.cogs;
  const profit = gross - data.sga;

  const plData = {
    sales:  { total: data.sales, breakdown: data.salesBreakdown, key: 'sales' },
    cogs:   { total: data.cogs,  breakdown: data.cogsBreakdown,  key: 'cogs'  },
    gross:  { total: gross },
    sga:    { total: data.sga,   breakdown: data.sgaBreakdown,   key: 'sga'   },
    profit: { total: profit },
  };

  let prevPlData = null;
  if (prevData) {
    const prevGross  = prevData.sales - prevData.cogs;
    const prevProfit = prevGross - prevData.sga;
    prevPlData = {
      sales: prevData.sales, cogs: prevData.cogs,
      gross: prevGross, sga: prevData.sga, profit: prevProfit,
    };
  }

  renderPLTable(plData, prevPlData);
}

/* ── 年度累計描画 ────────────────────────────────────────── */
async function renderYTD() {
  showSection('ytd-section');
  hideSection('monthly-section');

  const ytdLabel = document.getElementById('ytd-label');
  if (ytdLabel) ytdLabel.textContent = `${currentYear}年（1〜12月）`;

  const ytdPrev = document.getElementById('ytd-prev');
  const ytdNext = document.getElementById('ytd-next');
  if (ytdPrev) ytdPrev.disabled = currentYear <= MIN_YEAR;
  if (ytdNext) ytdNext.disabled = currentYear >= THIS_YEAR;

  showLoading('ytd-pl-table');

  const [current, previous] = await Promise.all([
    aggregateYear(currentYear),
    compareMode ? aggregateYear(currentYear - 1) : Promise.resolve(null),
  ]);

  const gross  = current.sales - current.cogs;
  const profit = gross - current.sga;

  const plData = {
    sales:  { total: current.sales, breakdown: current.salesBreakdown, key: 'sales-ytd' },
    cogs:   { total: current.cogs,  breakdown: current.cogsBreakdown,  key: 'cogs-ytd'  },
    gross:  { total: gross },
    sga:    { total: current.sga,   breakdown: current.sgaBreakdown,   key: 'sga-ytd'   },
    profit: { total: profit },
  };

  let prevPlData = null;
  if (compareMode && previous && previous.sales > 0) {
    const prevGross  = previous.sales - previous.cogs;
    const prevProfit = prevGross - previous.sga;
    prevPlData = {
      sales: previous.sales, cogs: previous.cogs,
      gross: prevGross, sga: previous.sga, profit: prevProfit,
    };
  }

  const infoBanner = document.getElementById('compare-info');
  if (infoBanner) {
    infoBanner.classList.toggle('pl-compare-info--show', compareMode);
    if (compareMode) {
      infoBanner.textContent = prevPlData
        ? `比較対象: ${currentYear - 1}年（年度累計）`
        : `${currentYear - 1}年のデータがありません`;
    }
  }

  renderPLTable(plData, prevPlData, 'ytd-pl-table');
  renderTaxDeclaration(current);
}

/* ── 年度集計（月別にfetchして合算） ────────────────────── */
async function aggregateYear(year) {
  const maxMonth = (year === THIS_YEAR) ? THIS_MONTH : 12;
  const monthKeys = [];
  for (let mm = 1; mm <= maxMonth; mm++) {
    monthKeys.push(`${year}-${String(mm).padStart(2, '0')}`);
  }

  const results = await Promise.all(monthKeys.map(fetchSummary));

  let sales = 0, cogs = 0, sga = 0;
  const salesBreakdown = {}, cogsBreakdown = {}, sgaBreakdown = {};

  results.forEach(d => {
    if (!d) return;
    sales += d.sales || 0;
    cogs  += d.cogs  || 0;
    sga   += d.sga   || 0;
    (d.salesBreakdown || []).forEach(i => {
      salesBreakdown[i.name] = (salesBreakdown[i.name] || 0) + i.amount;
    });
    (d.cogsBreakdown || []).forEach(i => {
      cogsBreakdown[i.name] = (cogsBreakdown[i.name] || 0) + i.amount;
    });
    (d.sgaBreakdown || []).forEach(i => {
      sgaBreakdown[i.name] = (sgaBreakdown[i.name] || 0) + i.amount;
    });
  });

  const toArr = obj => Object.entries(obj)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);

  return {
    sales, cogs, sga,
    salesBreakdown: toArr(salesBreakdown),
    cogsBreakdown:  toArr(cogsBreakdown),
    sgaBreakdown:   toArr(sgaBreakdown),
  };
}

/* ── PLテーブル描画 ──────────────────────────────────────── */
function renderPLTable(plData, prevData, tableId = 'pl-table') {
  const container = document.getElementById(tableId);
  if (!container) return;

  const rows = [
    {
      key:        plData.sales.key || 'sales',
      label:      '売上',
      value:      plData.sales.total,
      prevValue:  prevData?.sales,
      breakdown:  plData.sales.breakdown,
      expandable: true,
      type:       'normal',
    },
    {
      key:        plData.cogs.key || 'cogs',
      label:      '仕入原価',
      value:      plData.cogs.total,
      prevValue:  prevData?.cogs,
      breakdown:  plData.cogs.breakdown,
      expandable: true,
      type:       'normal',
    },
    {
      key:        'gross',
      label:      '粗利',
      value:      plData.gross.total,
      prevValue:  prevData?.gross,
      expandable: false,
      type:       'result',
    },
    {
      key:        plData.sga?.key || 'sga',
      label:      '販管費',
      value:      plData.sga.total,
      prevValue:  prevData?.sga,
      breakdown:  plData.sga.breakdown,
      expandable: true,
      type:       'normal',
    },
    {
      key:        'profit',
      label:      '経常利益',
      value:      plData.profit.total,
      prevValue:  prevData?.profit,
      expandable: false,
      type:       'profit',
    },
  ];

  container.innerHTML = rows.map(row => buildRowHTML(row, prevData)).join('');
}

function buildRowHTML(row, prevData) {
  const { key, label, value, prevValue, breakdown, expandable, type } = row;

  let wrapClass = 'pl-row-wrap';
  if (type === 'result') wrapClass += ' pl-row-wrap--result';
  if (type === 'profit')
    wrapClass += value >= 0 ? ' pl-row-wrap--profit' : ' pl-row-wrap--loss';

  let diffHTML = '';
  if (compareMode && prevValue != null) {
    const diff    = value - prevValue;
    const diffPct = prevValue !== 0 ? Math.round(diff / prevValue * 100) : 0;
    const sign    = diff >= 0 ? '+' : '';
    const isGood  = (type === 'profit' || key.startsWith('sales') || key === 'gross')
      ? diff >= 0
      : diff <= 0;
    const displayCls = isGood ? 'up' : 'down';
    diffHTML = `
      <div class="pl-main-row__diff pl-main-row__diff--show pl-main-row__diff--${displayCls}">
        前年比 ${sign}${formatYen(diff)}（${sign}${diffPct}%）
      </div>`;
  }

  const isExpanded = !!expandState[key];
  const iconClass  = isExpanded ? 'pl-expand-icon pl-expand-icon--open' : 'pl-expand-icon';
  const expandIcon = expandable
    ? `<span class="${iconClass}" aria-hidden="true">›</span>` : '';

  const clickAttr = expandable
    ? `onclick="toggleBreakdown('${key}')" role="button" tabindex="0" aria-expanded="${isExpanded}"`
    : '';

  let breakdownHTML = '';
  if (expandable && breakdown?.length > 0) {
    const items = breakdown
      .map(b => `
        <div class="pl-breakdown-item">
          <span class="pl-breakdown-item__name">${escHtml(b.name)}</span>
          <span class="pl-breakdown-item__value">${formatYen(b.amount)}</span>
        </div>`)
      .join('');
    breakdownHTML = `
      <div class="pl-breakdown" id="breakdown-${key}" ${isExpanded ? '' : 'hidden'}>
        ${items}
      </div>`;
  }

  return `
    <div class="${wrapClass}">
      <div class="pl-main-row${expandable ? '' : ' pl-main-row--static'}" ${clickAttr} id="row-${key}">
        <div class="pl-main-row__left">
          <span class="pl-main-row__label">${escHtml(label)}</span>
          ${expandIcon}
        </div>
        <div class="pl-main-row__right">
          <span class="pl-main-row__value">${formatYen(value)}</span>
          ${diffHTML}
        </div>
      </div>
      ${breakdownHTML}
    </div>`;
}

/* ── 内訳展開トグル ──────────────────────────────────────── */
function toggleBreakdown(key) {
  expandState[key] = !expandState[key];

  const breakdown = document.getElementById(`breakdown-${key}`);
  const rowEl     = document.getElementById(`row-${key}`);
  const icon      = rowEl?.querySelector('.pl-expand-icon');

  if (breakdown) breakdown.hidden = !expandState[key];
  if (icon)      icon.classList.toggle('pl-expand-icon--open', expandState[key]);
  if (rowEl)     rowEl.setAttribute('aria-expanded', String(!!expandState[key]));
}

/* ── ヘルパー ────────────────────────────────────────────── */
function showSection(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = false;
}

function hideSection(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = true;
}

function showLoading(tableId) {
  const el = document.getElementById(tableId);
  if (el) el.innerHTML = '<div class="pl-empty">読み込み中...</div>';
}

function renderEmpty(tableId) {
  const el = document.getElementById(tableId);
  if (el) el.innerHTML = '<div class="pl-empty">この月のデータはまだありません。<br>売上・コストを入力してください。</div>';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── 確定申告サマリー描画 ────────────────────────────────── */
function renderTaxDeclaration(yearData) {
  const section = document.getElementById('tax-declaration-section');
  const table   = document.getElementById('tax-declaration-table');
  if (!section || !table) return;

  if (!yearData || (yearData.sales === 0 && yearData.cogs === 0 && yearData.sga === 0)) {
    section.hidden = true;
    return;
  }

  const master = getCostMaster();

  // 内訳名 → taxRow マップ（名前で検索）
  const nameToRow = {};
  master.forEach(item => {
    if (item.name && item.taxRow != null) nameToRow[item.name] = item.taxRow;
  });

  // 仕入原価内訳
  const cogsItems = (yearData.cogsBreakdown || []).map(i => ({
    row:    nameToRow[i.name] ?? null,
    name:   i.name,
    amount: i.amount,
  }));

  // 販管費内訳（taxRowでソート）
  const sgaItems = (yearData.sgaBreakdown || []).map(i => ({
    row:    nameToRow[i.name] ?? null,
    name:   i.name,
    amount: i.amount,
  })).sort((a, b) => {
    if (a.row == null && b.row == null) return 0;
    if (a.row == null) return 1;
    if (b.row == null) return -1;
    return a.row - b.row;
  });

  const gross  = yearData.sales - yearData.cogs;
  const profit = gross - yearData.sga;

  function rowHTML(label, amount, rowNo, isTotal) {
    const rowLabel = rowNo != null ? `<span style="font-size:11px;color:var(--uz-muted);margin-right:4px;">行${rowNo}</span>` : '';
    const style    = isTotal
      ? 'font-weight:700;border-top:1px solid var(--uz-border);padding-top:6px;'
      : '';
    return `
      <div class="pl-breakdown-item" style="${style}">
        <span class="pl-breakdown-item__name" style="font-size:13px;">
          ${rowLabel}${escHtml(label)}
        </span>
        <span class="pl-breakdown-item__value">${formatYen(amount)}</span>
      </div>`;
  }

  let html = '';

  html += `<div style="padding:4px 0 2px;font-size:12px;color:var(--uz-muted);padding-left:4px;">▸ 売上金額</div>`;
  html += rowHTML('売上（収入）金額', yearData.sales, 1, true);

  html += `<div style="padding:8px 0 2px;font-size:12px;color:var(--uz-muted);padding-left:4px;">▸ 仕入原価</div>`;
  cogsItems.forEach(i => { html += rowHTML(i.name, i.amount, i.row, false); });
  html += rowHTML('仕入原価　合計', yearData.cogs, null, true);

  html += `<div style="padding:8px 0 2px;font-size:12px;color:var(--uz-muted);padding-left:4px;">▸ 粗利</div>`;
  html += rowHTML('粗利', gross, null, true);

  html += `<div style="padding:8px 0 2px;font-size:12px;color:var(--uz-muted);padding-left:4px;">▸ 販管費</div>`;
  sgaItems.forEach(i => { html += rowHTML(i.name, i.amount, i.row, false); });
  html += rowHTML('販管費　合計', yearData.sga, null, true);

  html += `<div style="padding:8px 0 2px;font-size:12px;color:var(--uz-muted);padding-left:4px;">▸ 経常利益</div>`;
  html += rowHTML('経常利益', profit, 43, true);

  table.innerHTML = html;
  section.hidden  = false;
}

/* ── 税理士用DLボタン ────────────────────────────────────── */
function bindTaxDownload() {
  const btn     = document.getElementById('tax-download-btn');
  const fromSel = document.getElementById('tax-from-month');
  const toSel   = document.getElementById('tax-to-month');
  if (!btn) return;

  // 期間プルダウン初期化
  const now      = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  // デフォルト開始：当年1月（2025年以前なら2025-01）
  const defaultFrom = `${Math.max(now.getFullYear(), 2025)}-01`;
  buildMonthOptions(fromSel, defaultFrom);
  buildMonthOptions(toSel,   curMonth);

  btn.addEventListener('click', () => {
    const from = fromSel?.value || curMonth;
    const to   = toSel?.value   || curMonth;
    downloadTaxCSVByRange(from, to, btn);
  });
}
