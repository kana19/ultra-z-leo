/**
 * ウルトラ財務くん LEO版 PWA — home.js
 * ホーム画面ロジック
 */

'use strict';

/* ── ストレージキー（clockin.js と共有） ─────────────────── */
const ATTENDANCE_DATE_KEY = 'uz_attendance_date';
const ATTENDANCE_DATA_KEY = 'uz_attendance_data';

/* ── 状態 ────────────────────────────────────────────────── */
let todayAttendance = []; // { id, name, clockIn, clockOut, isActive, rowIndex }

/* ── 時計（リアルタイム） ────────────────────────────────── */
function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  const timeEl = document.getElementById('header-time');
  if (timeEl) timeEl.textContent = `${hh}:${mm}:${ss}`;
}

function startClock() {
  updateClock();
  setInterval(updateClock, 1000);
}

/* ── ヘッダー日付 ────────────────────────────────────────── */
function renderHeaderDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const w = ['日', '月', '火', '水', '木', '金', '土'][now.getDay()];

  const el = document.getElementById('header-date');
  if (el) el.textContent = `${y}年${m}月${d}日（${w}）`;
}

/* ── アラートドット描画 ──────────────────────────────────── */
function createAlertDot(urgent) {
  const dot = document.createElement('span');
  dot.className = urgent ? 'adot adot--red-blink' : 'adot adot--blue';
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

function renderAlerts(alerts) {
  const { hasUncollected, uncollectedUrgent, hasPayable, payableUrgent, hasUnrecordedClockOut } = alerts;
  const nearEnd = isNearMonthEnd();

  const salesDot = document.getElementById('dot-uncollected');
  if (salesDot) {
    salesDot.innerHTML = '';
    if (hasUncollected) {
      salesDot.appendChild(createAlertDot(uncollectedUrgent ?? nearEnd));
      salesDot.setAttribute('title', (uncollectedUrgent ?? nearEnd) ? '未収あり（緊急）' : '未収あり');
    }
  }

  const costDot = document.getElementById('dot-payable');
  if (costDot) {
    costDot.innerHTML = '';
    if (hasPayable) {
      costDot.appendChild(createAlertDot(payableUrgent ?? nearEnd));
      costDot.setAttribute('title', (payableUrgent ?? nearEnd) ? '買掛あり（緊急）' : '買掛あり');
    }
  }

  const clockDot = document.getElementById('dot-clockout');
  if (clockDot) {
    clockDot.innerHTML = '';
    if (hasUnrecordedClockOut) {
      clockDot.appendChild(createAlertDot(true));
      clockDot.setAttribute('title', '退店未記録（24時間経過）');
    }
  }
}

/* ── 勤怠リスト描画 ──────────────────────────────────────── */
function renderStaffList() {
  const container = document.getElementById('staff-list');
  if (!container) return;

  const active   = todayAttendance.filter(s => s.isActive);
  const inactive = todayAttendance.filter(s => !s.isActive);
  const display  = [...active, ...inactive].slice(0, 3);

  if (display.length === 0) {
    container.innerHTML = `
      <div class="staff-item">
        <span class="staff-dot staff-dot--off"></span>
        <div class="staff-info">
          <div class="staff-name" style="color:var(--uz-muted)">本日の入店記録なし</div>
        </div>
      </div>`;
    return;
  }

  container.innerHTML = display.map(s => `
    <div class="staff-item">
      <span class="staff-dot${s.isActive ? '' : ' staff-dot--off'}"></span>
      <div class="staff-info">
        <div class="staff-name">${escapeHtml(s.name)}</div>
        <div class="staff-time">
          ${s.isActive
            ? `入店 ${escapeHtml(s.clockIn)} — 在店中`
            : `${escapeHtml(s.clockIn)} → ${escapeHtml(s.clockOut)}`}
        </div>
      </div>
      ${s.isActive
        ? `<button class="staff-clockout-btn" type="button" onclick="handleClockOut(${s.id})">退店</button>`
        : ''}
    </div>
  `).join('');
}

/* ── 勤怠データをlocalStorageから即時描画 ────────────────── */
function renderStaffFromLocalStorage() {
  const savedDate = localStorage.getItem(ATTENDANCE_DATE_KEY);
  if (savedDate !== todayStr()) return; // 日付違いは無視

  try {
    const saved = JSON.parse(localStorage.getItem(ATTENDANCE_DATA_KEY)) || [];
    todayAttendance = saved;
    renderStaffList();
  } catch { /* localStorageが壊れていても無視 */ }
}

/* ── GAS から勤怠データを取得 ────────────────────────────── */
async function loadAttendance() {
  try {
    const res = await callGAS('getAttendance', { date: todayStr() });
    if (res && res.status === 'ok' && res.data) {
      const { attendance, hasUnrecordedClockOut } = res.data;

      // GASデータで todayAttendance を上書き
      todayAttendance = attendance.map(r => ({
        id:       r.staffId,
        name:     r.staffName,
        clockIn:  r.clockIn,
        clockOut: r.clockOut || null,
        isActive: r.isActive,
        rowIndex: r.rowIndex ?? null,
      }));

      // localStorageを最新データで更新（clockin.jsと共有）
      localStorage.setItem(ATTENDANCE_DATE_KEY, todayStr());
      localStorage.setItem(ATTENDANCE_DATA_KEY, JSON.stringify(todayAttendance));

      renderStaffList();

      // 退店未記録フラグをアラートに反映（他フラグは既描画のまま更新）
      if (hasUnrecordedClockOut) {
        const clockDot = document.getElementById('dot-clockout');
        if (clockDot && !clockDot.hasChildNodes()) {
          clockDot.appendChild(createAlertDot(true));
          clockDot.setAttribute('title', '退店未記録（24時間経過）');
        }
      }
    }
  } catch {
    // GAS失敗時はlocalStorageの描画をそのまま維持
  }
}

/* ── GAS から未収・買掛フラグを取得してアラート描画 ─────── */
async function loadAlerts() {
  // まず退店未記録なし・未収なし・買掛なしで初期描画
  renderAlerts({
    hasUncollected:        false,
    uncollectedUrgent:     false,
    hasPayable:            false,
    payableUrgent:         false,
    hasUnrecordedClockOut: false,
  });

  try {
    const res = await callGAS('getUncollected', {});
    if (res && res.status === 'ok' && Array.isArray(res.data)) {
      const nearEnd       = isNearMonthEnd();
      const hasUncollected = res.data.some(r => r.type === 'uncollected');
      const hasPayable     = res.data.some(r => r.type === 'payable');

      renderAlerts({
        hasUncollected,
        uncollectedUrgent:     hasUncollected && nearEnd,
        hasPayable,
        payableUrgent:         hasPayable && nearEnd,
        hasUnrecordedClockOut: false, // loadAttendance 側で更新
      });
    }
  } catch {
    // GAS失敗時はアラートなし表示のまま
  }
}

/* ── 損益サマリー描画 ────────────────────────────────────── */
function _renderPLValues(pl) {
  const now = new Date();
  const monthRaw = pl.month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [year, month] = String(monthRaw).includes('-')
    ? String(monthRaw).split('-').map(Number)
    : [pl.year ?? now.getFullYear(), Number(monthRaw)];

  const monthLabel = document.getElementById('pl-month-label');
  if (monthLabel) monthLabel.textContent = `${year}年${month}月（当月累計）`;

  const rows = [
    { id: 'pl-sales',  value: pl.sales           },
    { id: 'pl-cogs',   value: pl.cogs             },
    { id: 'pl-gross',  value: pl.grossProfit      },
    { id: 'pl-sga',    value: pl.sga              },
    { id: 'pl-profit', value: pl.operatingProfit  },
  ];

  rows.forEach(({ id, value }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = formatYen(value);
    el.classList.toggle('pl-value--negative', value < 0);
  });
}

function _renderPLError() {
  const monthLabel = document.getElementById('pl-month-label');
  if (monthLabel) monthLabel.textContent = 'データ取得エラー';

  ['pl-sales', 'pl-cogs', 'pl-gross', 'pl-sga', 'pl-profit'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '¥—';
  });
}

async function loadPL() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');

  try {
    const res = await callGAS('getSummary', { month: `${year}-${month}` });
    if (res && res.status === 'ok' && res.data) {
      _renderPLValues(res.data);
    } else {
      _renderPLError();
    }
  } catch {
    _renderPLError();
  }
}

/* ── 退店処理（ホーム画面から） ──────────────────────────── */
async function handleClockOut(staffId) {
  const record = todayAttendance.find(s => s.id === staffId);
  if (!record) return;

  if (!confirm(`${record.name}さんを退店記録しますか？`)) return;

  const now = new Date();
  const clockOutTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  try {
    const result = await callGAS('clockOut', {
      staffId:     record.id,
      clockOutTime,
      rowIndex:    record.rowIndex ?? null,
    });
    if (result.status !== 'ok') throw new Error(result.message || '登録エラー');

    record.clockOut = clockOutTime;
    record.isActive = false;

    // localStorageを更新してclockIn画面と同期
    localStorage.setItem(ATTENDANCE_DATE_KEY, todayStr());
    localStorage.setItem(ATTENDANCE_DATA_KEY, JSON.stringify(todayAttendance));

    renderStaffList();
    showToast(`${record.name}さんの退店を記録しました`, 'success');

  } catch (e) {
    showToast('退店記録に失敗しました：' + e.message, 'error');
  }
}

/* ── XSSエスケープ ───────────────────────────────────────── */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── 確定申告タイマー ────────────────────────────────────── */
function renderTaxTimer() {
  const now   = new Date();
  const month = now.getMonth() + 1;
  const day   = now.getDate();
  const el    = document.getElementById('tax-timer');
  if (!el) return;

  const inPeriod = (month === 2 && day >= 16) || (month === 3 && day <= 15);
  if (!inPeriod) { el.style.display = 'none'; return; }

  const deadline = new Date(now.getFullYear(), 2, 15); // 3/15
  const diffMs   = deadline - now;
  const diffDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

  if (diffDays <= 3) {
    el.className = 'tax-timer-red';
    el.textContent = `確定申告期限まであと ${diffDays}日！（3/15締切）`;
  } else {
    el.className = 'tax-timer-blue';
    el.textContent = `確定申告受付中　あと ${diffDays}日（3/15締切）`;
  }
  el.style.display = 'block';
}

/* ── 初期化 ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  renderHeaderDate();
  startClock();
  renderTaxTimer();

  // localStorageで即時描画 → GASで上書き
  renderStaffFromLocalStorage();
  loadAttendance();
  loadAlerts();
  loadPL();
});
