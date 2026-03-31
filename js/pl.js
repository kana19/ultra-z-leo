/**
 * ウルトラ財務くん LEO版 PWA — pl.js
 * 損益サマリー画面ロジック（ダミーデータ版）
 */

'use strict';

/* ── ダミーデータ（本番はcallGAS('getPL', {year, month})で取得） ── */
const DUMMY_MONTHLY = {
  '2026-03': {
    sales: 1_248_000,
    salesBreakdown: [
      { name: 'テーブルチャージ', amount: 480_000 },
      { name: 'カラオケ',         amount: 320_000 },
      { name: 'ボトルキープ',     amount: 298_000 },
      { name: 'ソフトドリンク',   amount: 150_000 },
    ],
    cogs: 392_000,
    cogsBreakdown: [
      { name: '酒類・飲料',   amount: 280_000 },
      { name: 'フード材料',   amount:  82_000 },
      { name: '消耗品',       amount:  30_000 },
    ],
    sga: 480_000,
    sgaBreakdown: [
      { name: '家賃',       amount: 200_000 },
      { name: '人件費',     amount: 180_000 },
      { name: '光熱費',     amount:  45_000 },
      { name: '広告宣伝費', amount:  30_000 },
      { name: '通信費',     amount:  15_000 },
      { name: '消耗品費',   amount:  10_000 },
    ],
  },
  '2026-02': {
    sales: 980_000,
    salesBreakdown: [
      { name: 'テーブルチャージ', amount: 380_000 },
      { name: 'カラオケ',         amount: 260_000 },
      { name: 'ボトルキープ',     amount: 220_000 },
      { name: 'ソフトドリンク',   amount: 120_000 },
    ],
    cogs: 312_000,
    cogsBreakdown: [
      { name: '酒類・飲料', amount: 220_000 },
      { name: 'フード材料', amount:  62_000 },
      { name: '消耗品',     amount:  30_000 },
    ],
    sga: 472_000,
    sgaBreakdown: [
      { name: '家賃',       amount: 200_000 },
      { name: '人件費',     amount: 170_000 },
      { name: '光熱費',     amount:  52_000 },
      { name: '広告宣伝費', amount:  20_000 },
      { name: '通信費',     amount:  15_000 },
      { name: '消耗品費',   amount:  15_000 },
    ],
  },
  '2026-01': {
    sales: 850_000,
    salesBreakdown: [
      { name: 'テーブルチャージ', amount: 320_000 },
      { name: 'カラオケ',         amount: 220_000 },
      { name: 'ボトルキープ',     amount: 190_000 },
      { name: 'ソフトドリンク',   amount: 120_000 },
    ],
    cogs: 260_000,
    cogsBreakdown: [
      { name: '酒類・飲料', amount: 185_000 },
      { name: 'フード材料', amount:  45_000 },
      { name: '消耗品',     amount:  30_000 },
    ],
    sga: 465_000,
    sgaBreakdown: [
      { name: '家賃',       amount: 200_000 },
      { name: '人件費',     amount: 165_000 },
      { name: '光熱費',     amount:  55_000 },
      { name: '通信費',     amount:  15_000 },
      { name: '消耗品費',   amount:  30_000 },
    ],
  },
  // 前年同月比用
  '2025-03': {
    sales: 1_120_000, cogs: 365_000, sga: 460_000,
    salesBreakdown: [], cogsBreakdown: [], sgaBreakdown: [],
  },
  '2025-02': {
    sales:   910_000, cogs: 295_000, sga: 455_000,
    salesBreakdown: [], cogsBreakdown: [], sgaBreakdown: [],
  },
  '2025-01': {
    sales:   780_000, cogs: 240_000, sga: 450_000,
    salesBreakdown: [], cogsBreakdown: [], sgaBreakdown: [],
  },
};

/* 利用可能な月リスト（新しい順） */
const AVAILABLE_MONTHS = ['2026-03', '2026-02', '2026-01'];

/* ── 状態 ────────────────────────────────────────────────── */
let currentTab      = 'monthly'; // 'monthly' | 'ytd'
let currentPeriod   = '2026-03'; // 月次: YYYY-MM / 年度累計: YYYY
let currentYear     = 2026;
let compareMode     = false;
const expandState   = {};        // { 'sales': true, 'cogs': false, ... }

/* ── 初期化 ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  bindTabs();
  bindPeriodNav();
  bindCompareBtn();
  bindYtdCompareBtn();
  renderAll();
});

/* ── タブ切替 ────────────────────────────────────────────── */
function bindTabs() {
  document.querySelectorAll('.pl-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      // タブUI更新
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
  const idx = AVAILABLE_MONTHS.indexOf(currentPeriod);
  const next = idx - dir; // 新しい順リストなので逆向き
  if (next < 0 || next >= AVAILABLE_MONTHS.length) return;
  currentPeriod = AVAILABLE_MONTHS[next];
  compareMode   = false;
  updateCompareBtn();
  renderAll();
}

function moveYear(dir) {
  const newYear = currentYear + dir;
  if (newYear < 2025 || newYear > 2026) return;
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

/* ── 年度累計タブの比較ボタン ────────────────────────────── */
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
function renderMonthly() {
  showSection('monthly-section');
  hideSection('ytd-section');

  const [y, m] = currentPeriod.split('-').map(Number);
  const data   = DUMMY_MONTHLY[currentPeriod];
  const label  = `${y}年${m}月`;

  // 期間ラベル更新
  const labelEl = document.getElementById('period-label');
  if (labelEl) labelEl.textContent = label;

  // prev/nextボタンの有効無効
  const idx = AVAILABLE_MONTHS.indexOf(currentPeriod);
  const prevBtn = document.getElementById('period-prev');
  const nextBtn = document.getElementById('period-next');
  if (prevBtn) prevBtn.disabled = idx >= AVAILABLE_MONTHS.length - 1;
  if (nextBtn) nextBtn.disabled = idx <= 0;

  // 前年同月データ
  const prevKey  = `${y - 1}-${String(m).padStart(2, '0')}`;
  const prevData = compareMode ? DUMMY_MONTHLY[prevKey] : null;

  // 比較インフォバナー
  const infoBanner = document.getElementById('compare-info');
  if (infoBanner) {
    infoBanner.classList.toggle('pl-compare-info--show', compareMode && !!prevData);
    if (compareMode && prevData) {
      infoBanner.textContent = `比較対象: ${y - 1}年${m}月`;
    }
    if (compareMode && !prevData) {
      infoBanner.textContent = '前年同月のデータがありません';
      infoBanner.classList.add('pl-compare-info--show');
    }
  }

  if (!data) {
    renderEmpty('pl-table');
    return;
  }

  const gross  = data.sales - data.cogs;
  const profit = gross - data.sga;

  const plData = {
    sales:  { total: data.sales,  breakdown: data.salesBreakdown, key: 'sales' },
    cogs:   { total: data.cogs,   breakdown: data.cogsBreakdown,  key: 'cogs'  },
    gross:  { total: gross },
    sga:    { total: data.sga,    breakdown: data.sgaBreakdown,   key: 'sga'   },
    profit: { total: profit },
  };

  let prevPlData = null;
  if (prevData) {
    const prevGross  = prevData.sales - prevData.cogs;
    const prevProfit = prevGross - prevData.sga;
    prevPlData = {
      sales:  prevData.sales,
      cogs:   prevData.cogs,
      gross:  prevGross,
      sga:    prevData.sga,
      profit: prevProfit,
    };
  }

  renderPLTable(plData, prevPlData);
}

/* ── 年度累計描画 ────────────────────────────────────────── */
function renderYTD() {
  showSection('ytd-section');
  hideSection('monthly-section');

  const ytdLabel = document.getElementById('ytd-label');
  if (ytdLabel) ytdLabel.textContent = `${currentYear}年（1〜12月）`;

  const ytdPrev = document.getElementById('ytd-prev');
  const ytdNext = document.getElementById('ytd-next');
  if (ytdPrev) ytdPrev.disabled = currentYear <= 2025;
  if (ytdNext) ytdNext.disabled = currentYear >= 2026;

  // 当年の全月を集計
  const current  = aggregateYear(currentYear);
  const previous = aggregateYear(currentYear - 1);

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
  if (compareMode && previous.sales > 0) {
    const prevGross  = previous.sales - previous.cogs;
    const prevProfit = prevGross - previous.sga;
    prevPlData = {
      sales: previous.sales, cogs: previous.cogs,
      gross: prevGross, sga: previous.sga, profit: prevProfit,
    };
  }

  // 比較インフォバナー
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
}

/* ── 年度集計 ────────────────────────────────────────────── */
function aggregateYear(year) {
  let sales = 0, cogs = 0, sga = 0;
  const salesBreakdown = {}, cogsBreakdown = {}, sgaBreakdown = {};

  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    const d   = DUMMY_MONTHLY[key];
    if (!d) continue;

    sales += d.sales;
    cogs  += d.cogs;
    sga   += d.sga;

    // 内訳を名前でマージ
    [...(d.salesBreakdown || [])].forEach(i => {
      salesBreakdown[i.name] = (salesBreakdown[i.name] || 0) + i.amount;
    });
    [...(d.cogsBreakdown || [])].forEach(i => {
      cogsBreakdown[i.name] = (cogsBreakdown[i.name] || 0) + i.amount;
    });
    [...(d.sgaBreakdown || [])].forEach(i => {
      sgaBreakdown[i.name] = (sgaBreakdown[i.name] || 0) + i.amount;
    });
  }

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
      key:       plData.sales.key || 'sales',
      label:     '売上',
      value:     plData.sales.total,
      prevValue: prevData?.sales,
      breakdown: plData.sales.breakdown,
      expandable: true,
      type:      'normal',
    },
    {
      key:       plData.cogs.key || 'cogs',
      label:     '仕入原価',
      value:     plData.cogs.total,
      prevValue: prevData?.cogs,
      breakdown: plData.cogs.breakdown,
      expandable: true,
      type:      'normal',
    },
    {
      key:       'gross',
      label:     '粗利',
      value:     plData.gross.total,
      prevValue: prevData?.gross,
      expandable: false,
      type:      'result',
    },
    {
      key:       plData.sga?.key || 'sga',
      label:     '販管費',
      value:     plData.sga.total,
      prevValue: prevData?.sga,
      breakdown: plData.sga.breakdown,
      expandable: true,
      type:      'normal',
    },
    {
      key:       'profit',
      label:     '経常利益',
      value:     plData.profit.total,
      prevValue: prevData?.profit,
      expandable: false,
      type:      'profit',
    },
  ];

  container.innerHTML = rows.map(row => buildRowHTML(row, prevData)).join('');
}

function buildRowHTML(row, prevData) {
  const { key, label, value, prevValue, breakdown, expandable, type } = row;

  // ラッパークラス
  let wrapClass = 'pl-row-wrap';
  if (type === 'result') wrapClass += ' pl-row-wrap--result';
  if (type === 'profit')
    wrapClass += value >= 0 ? ' pl-row-wrap--profit' : ' pl-row-wrap--loss';

  // diff計算
  let diffHTML = '';
  if (compareMode && prevValue != null) {
    const diff    = value - prevValue;
    const diffPct = prevValue !== 0 ? Math.round(diff / prevValue * 100) : 0;
    const sign    = diff >= 0 ? '+' : '';
    const cls     = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
    // 売上・粗利・利益はup=良い、コストはdown=良い
    const isGood = type === 'profit' || key.startsWith('sales') || key === 'gross'
      ? diff >= 0
      : diff <= 0;
    const displayCls = isGood ? 'up' : 'down';
    diffHTML = `
      <div class="pl-main-row__diff pl-main-row__diff--show pl-main-row__diff--${displayCls}">
        前年比 ${sign}${formatYen(diff)}（${sign}${diffPct}%）
      </div>`;
  }

  // 展開アイコン
  const isExpanded  = !!expandState[key];
  const iconClass   = isExpanded ? 'pl-expand-icon pl-expand-icon--open' : 'pl-expand-icon';
  const expandIcon  = expandable
    ? `<span class="${iconClass}" aria-hidden="true">›</span>` : '';

  // クリックハンドラ
  const clickAttr = expandable
    ? `onclick="toggleBreakdown('${key}')" role="button" tabindex="0" aria-expanded="${isExpanded}"`
    : '';

  // 内訳HTML
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
