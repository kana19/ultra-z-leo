/**
 * ウルトラ財務くん LEO版 PWA — history.js
 * 入力履歴画面ロジック（GAS getHistory 連携版）
 *
 * GASレスポンス期待形式:
 * {
 *   status: 'ok',
 *   data: [
 *     { type: 'sales'|'cost', date: 'YYYY-MM-DD', itemName: string, memo: string, amount: number }
 *   ]
 * }
 */

'use strict';

/* ── 定数 ────────────────────────────────────────────────── */
const _now       = new Date();
const THIS_YEAR  = _now.getFullYear();
const THIS_MONTH = _now.getMonth() + 1;
const MIN_YEAR   = 2025;

/* ── 状態 ────────────────────────────────────────────────── */
let currentYear  = THIS_YEAR;
let currentMonth = THIS_MONTH;

/* ── 初期化 ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  bindNav();
  loadHistory();
});

/* ── 月ナビゲーション ────────────────────────────────────── */
function bindNav() {
  document.getElementById('hist-prev')?.addEventListener('click', () => moveMonth(-1));
  document.getElementById('hist-next')?.addEventListener('click', () => moveMonth(+1));
}

function moveMonth(dir) {
  let m = currentMonth + dir;
  let y = currentYear;
  if (m < 1)  { y--; m = 12; }
  if (m > 12) { y++; m = 1; }
  if (y < MIN_YEAR) return;
  if (y > THIS_YEAR || (y === THIS_YEAR && m > THIS_MONTH)) return;
  currentYear  = y;
  currentMonth = m;
  loadHistory();
}

function updateNavUI() {
  const monthStr = `${currentYear}年${currentMonth}月`;
  const labelEl  = document.getElementById('hist-label');
  if (labelEl) labelEl.textContent = monthStr;

  const isMin = currentYear === MIN_YEAR && currentMonth === 1;
  const isMax = currentYear === THIS_YEAR && currentMonth === THIS_MONTH;
  const prevBtn = document.getElementById('hist-prev');
  const nextBtn = document.getElementById('hist-next');
  if (prevBtn) prevBtn.disabled = isMin;
  if (nextBtn) nextBtn.disabled = isMax;
}

/* ── GASからデータ取得 ───────────────────────────────────── */
async function loadHistory() {
  updateNavUI();
  showLoading();

  const monthParam = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

  try {
    const res = await callGAS('getHistory', { month: monthParam });
    if (res && res.status === 'ok' && Array.isArray(res.data)) {
      renderHistory(res.data);
    } else {
      renderError();
      showToast('履歴の取得に失敗しました', 'error');
    }
  } catch (e) {
    renderError();
    showToast('GAS接続エラー：' + e.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ── 描画 ────────────────────────────────────────────────── */
function renderHistory(items) {
  const container = document.getElementById('history-list');
  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = `
      <p style="text-align:center;padding:40px 20px;font-size:13px;color:var(--uz-muted);">
        この月の入力履歴はありません
      </p>`;
    return;
  }

  // 日付降順ソート
  const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date));

  // 日付でグループ化
  const groups = {};
  sorted.forEach(item => {
    if (!groups[item.date]) groups[item.date] = [];
    groups[item.date].push(item);
  });

  let html = '';
  Object.keys(groups).forEach(date => {
    html += buildDateHeader(date);
    groups[date].forEach(item => {
      html += buildItemHTML(item);
    });
  });

  container.innerHTML = html;
}

function buildDateHeader(dateStr) {
  const [y, m, d] = dateStr.split(/[-\/]/).map(Number);
  const dow = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `
    <div style="padding:12px 20px 6px;">
      <span style="font-size:12px;font-weight:700;color:var(--uz-muted);letter-spacing:0.06em;">
        ${y}年${m}月${d}日（${dow}）
      </span>
    </div>`;
}

function buildItemHTML(item) {
  const isSales = item.type === 'sales';
  const icon    = isSales ? '💰' : '💸';
  const typeClass = isSales ? 'sales' : 'cost';

  return `
    <div class="history-item">
      <div class="history-item__type history-item__type--${typeClass}">${icon}</div>
      <div class="history-item__info">
        <div class="history-item__name">${escHtml(item.itemName)}</div>
        ${item.memo ? `<div class="history-item__date">${escHtml(item.memo)}</div>` : ''}
      </div>
      <span class="history-item__amount history-item__amount--${typeClass}">
        ${formatYen(item.amount)}
      </span>
    </div>`;
}

function renderError() {
  const container = document.getElementById('history-list');
  if (container) {
    container.innerHTML = `
      <p style="text-align:center;padding:40px 20px;font-size:13px;color:var(--uz-muted);">
        データの取得に失敗しました。<br>通信状態を確認してください。
      </p>`;
  }
}

/* ── XSSエスケープ ───────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
