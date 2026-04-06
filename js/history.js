/**
 * ウルトラ財務くん LEO版 PWA — history.js
 * 入力履歴画面ロジック（タブ分け対応版）
 *
 * タブ1：売上・コスト
 *   getHistory レスポンス: { status:'ok', data:[{ type:'sales'|'cost', date:'YYYY-MM-DD', itemName:string, memo:string, amount:number }] }
 *
 * タブ2：入店履歴
 *   getAttendanceByMonth レスポンス: { status:'ok', data:[{ date:'YYYY-MM-DD', staffId, staffName:string, clockIn:string, clockOut:string|null }] }
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
let activeTab    = 'salescost'; // 'salescost' | 'attendance'

/* ── 初期化 ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  bindTabs();
  bindNav();
  loadAll();
});

/* ── タブ切り替え ────────────────────────────────────────── */
function bindTabs() {
  document.getElementById('tab-salescost')?.addEventListener('click', () => switchTab('salescost'));
  document.getElementById('tab-attendance')?.addEventListener('click', () => switchTab('attendance'));
}

function switchTab(tab) {
  activeTab = tab;

  document.querySelectorAll('.hist-tab').forEach(btn => {
    const isActive = btn.id === `tab-${tab}`;
    btn.classList.toggle('hist-tab--active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
  document.querySelectorAll('.hist-tab-content').forEach(panel => {
    const isActive = panel.id === `panel-${tab}`;
    panel.classList.toggle('hist-tab-content--active', isActive);
  });
}

/* ── 月ナビゲーション ────────────────────────────────────── */
function bindNav() {
  document.getElementById('hist-prev')?.addEventListener('click', () => moveMonth(-1));
  document.getElementById('hist-next')?.addEventListener('click', () => moveMonth(+1));
}

function moveMonth(dir) {
  let m = currentMonth + dir;
  let y = currentYear;
  if (m < 1)  { y--; m = 12; }
  if (m > 12) { y++; m = 1;  }
  if (y < MIN_YEAR) return;
  if (y > THIS_YEAR || (y === THIS_YEAR && m > THIS_MONTH)) return;
  currentYear  = y;
  currentMonth = m;
  loadAll();
}

function updateNavUI() {
  const monthStr = `${currentYear}年${currentMonth}月`;
  const labelEl  = document.getElementById('hist-label');
  if (labelEl) labelEl.textContent = monthStr;

  const isMin   = currentYear === MIN_YEAR  && currentMonth === 1;
  const isMax   = currentYear === THIS_YEAR && currentMonth === THIS_MONTH;
  const prevBtn = document.getElementById('hist-prev');
  const nextBtn = document.getElementById('hist-next');
  if (prevBtn) prevBtn.disabled = isMin;
  if (nextBtn) nextBtn.disabled = isMax;
}

/* ── GASからデータ取得 ───────────────────────────────────── */
async function loadAll() {
  updateNavUI();
  showLoading();

  const monthParam = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

  try {
    const [histResult, attendResult] = await Promise.allSettled([
      callGAS('getHistory',            { month: monthParam }),
      callGAS('getAttendanceByMonth',  { month: monthParam }),
    ]);

    // タブ1：売上・コスト
    if (
      histResult.status === 'fulfilled' &&
      histResult.value?.status === 'ok' &&
      Array.isArray(histResult.value.data)
    ) {
      renderSalesCost(histResult.value.data);
    } else {
      renderSalesCostError();
    }

    // タブ2：入店履歴
    if (
      attendResult.status === 'fulfilled' &&
      attendResult.value?.status === 'ok' &&
      Array.isArray(attendResult.value.data)
    ) {
      renderAttendance(attendResult.value.data);
    } else {
      renderAttendanceError();
    }

  } catch (e) {
    renderSalesCostError();
    renderAttendanceError();
    showToast('GAS接続エラー：' + e.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ══════════════════════════════════════════════════════════
   タブ1：売上・コスト描画
   ══════════════════════════════════════════════════════════ */

function renderSalesCost(items) {
  const container = document.getElementById('history-list');
  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = `
      <p style="text-align:center;padding:40px 20px;font-size:13px;color:var(--uz-muted);">
        この月の売上・コスト履歴はありません
      </p>`;
    return;
  }

  // 日付降順ソート→グループ化
  const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date));
  const groups = {};
  sorted.forEach(item => {
    if (!groups[item.date]) groups[item.date] = [];
    groups[item.date].push(item);
  });

  let html = '';
  Object.keys(groups).forEach(date => {
    html += buildDateHeader(date);
    groups[date].forEach(item => { html += buildSalesCostItemHTML(item); });
  });

  container.innerHTML = html;
}

function renderSalesCostError() {
  const container = document.getElementById('history-list');
  if (container) {
    container.innerHTML = `
      <p style="text-align:center;padding:40px 20px;font-size:13px;color:var(--uz-muted);">
        データの取得に失敗しました。<br>通信状態を確認してください。
      </p>`;
  }
}

function buildSalesCostItemHTML(item) {
  const isSales   = item.type === 'sales';
  const icon      = isSales ? '💰' : '💸';
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

/* ══════════════════════════════════════════════════════════
   タブ2：入店履歴描画（スタッフ単位・日付グループ）
   ══════════════════════════════════════════════════════════ */

function renderAttendance(items) {
  const container = document.getElementById('attendance-list');
  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = `
      <p style="text-align:center;padding:40px 20px;font-size:13px;color:var(--uz-muted);">
        この月の入店履歴はありません
      </p>`;
    return;
  }

  // スタッフ名でグループ化 → 各スタッフ内は日付降順
  const staffMap = {};
  items.forEach(item => {
    const name = item.staffName || item.itemName || '不明';
    if (!staffMap[name]) staffMap[name] = [];
    staffMap[name].push(item);
  });

  // スタッフ内日付降順ソート
  Object.values(staffMap).forEach(records => {
    records.sort((a, b) => b.date.localeCompare(a.date));
  });

  // スタッフを最新入店日降順で並べる
  const staffNames = Object.keys(staffMap).sort((a, b) => {
    return staffMap[b][0].date.localeCompare(staffMap[a][0].date);
  });

  let html = '';
  staffNames.forEach(name => {
    const records = staffMap[name];
    const hasActive = records.some(r => !r.clockOut);

    html += `
      <div class="attend-staff-card">
        <div class="attend-staff-header">
          <span class="attendance-dot ${hasActive ? 'attendance-dot--active' : 'attendance-dot--out'}"
                aria-hidden="true"></span>
          <span class="attend-staff-name">${escHtml(name)}</span>
        </div>`;

    records.forEach(r => {
      const [y, m, d] = r.date.split(/[-\/]/).map(Number);
      const dow       = WEEKDAYS[new Date(y, m - 1, d).getDay()];
      const dateLabel = `${m}/${d}（${dow}）`;
      const clockIn   = parseTimeStr(r.clockIn);
      const clockOut  = parseTimeStr(r.clockOut);
      const timeStr   = clockOut
        ? `${escHtml(clockIn)} → ${escHtml(clockOut)}`
        : `${escHtml(clockIn)} — 退店未記録`;
      const isActive  = !clockOut;

      html += `
        <div class="attend-record-row">
          <div class="attend-record-date">${dateLabel}</div>
          <div class="attend-record-times">${timeStr}</div>
          <span class="attend-status ${isActive ? 'attend-status--active' : 'attend-status--out'}">
            ${isActive ? '在店中' : '退店済'}
          </span>
        </div>`;
    });

    html += `</div>`;
  });

  container.innerHTML = html;
}

function renderAttendanceError() {
  const container = document.getElementById('attendance-list');
  if (container) {
    container.innerHTML = `
      <p style="text-align:center;padding:40px 20px;font-size:13px;color:var(--uz-muted);">
        入店履歴の取得に失敗しました。<br>通信状態を確認してください。
      </p>`;
  }
}

/* ── 共通：日付ヘッダー ──────────────────────────────────── */
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

/* ── 時刻文字列正規化（GASのシリアル日時対応） ──────────── */
/**
 * GASから返ってくる時刻値を "HH:MM" 形式に正規化する
 *   "HH:MM" / "HH:MM:SS"             → そのままスライス
 *   "Sat Dec 30 1899 00:14:00 GMT+09" → Date.toString()形式 → getHours/getMinutes（ローカル時刻）
 *   "1899-12-29T15:14:00.000Z"        → ISO文字列 → getUTCHours/getUTCMinutes（UTC時刻が実際の時刻）
 *   null / "" / undefined             → ""
 */
function parseTimeStr(val) {
  if (!val) return '';
  const s = String(val).trim();
  if (!s) return '';

  // すでに "HH:MM" または "HH:MM:SS" 形式
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
    return s.slice(0, 5);
  }

  // ISO文字列形式（例: "1899-12-29T15:14:00.000Z"）
  // GASのシリアル時刻はUTC時刻が実際の時刻になる
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const h = d.getUTCHours();
      const m = d.getUTCMinutes();
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }

  // Date.toString()形式（例: "Sat Dec 30 1899 00:14:00 GMT+0900"）
  // JSがローカル時刻として解釈するのでgetHours/getMinutesでOK
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const h = d.getHours();
    const m = d.getMinutes();
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  return '';
}

/* ── XSSエスケープ ───────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
