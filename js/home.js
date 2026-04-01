/**
 * ウルトラ財務くん LEO版 PWA — home.js
 * ホーム画面ロジック（ダミーデータ動作版）
 */

'use strict';

/* ── 損益サマリー（GAS取得） ─────────────────────────────── */

const DUMMY_STAFF = [
  { id: 1, name: 'さくら',   clockIn: '20:30', clockOut: null,    isActive: true  },
  { id: 2, name: 'あかね',   clockIn: '20:00', clockOut: null,    isActive: true  },
  { id: 3, name: 'みか',     clockIn: '19:45', clockOut: '23:00', isActive: false },
];

// アラート状態（本番ではGASから取得）
const DUMMY_ALERTS = {
  hasUncollected:       true,   // 未収あり
  uncollectedUrgent:    false,  // 月末3日前ではない
  hasPayable:           true,   // 買掛あり
  payableUrgent:        false,
  hasUnrecordedClockOut: false, // 退店未記録なし
};

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
/**
 * アラートドット要素を生成
 * @param {boolean} urgent 月末3日前フラグ
 * @returns {HTMLElement|null}
 */
function createAlertDot(urgent) {
  const dot = document.createElement('span');
  dot.className = urgent ? 'adot adot--red-blink' : 'adot adot--blue';
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

function renderAlerts() {
  const { hasUncollected, uncollectedUrgent, hasPayable, payableUrgent, hasUnrecordedClockOut } = DUMMY_ALERTS;

  // 売上ボタン：未収ドット
  const salesDot = document.getElementById('dot-uncollected');
  if (salesDot) {
    if (hasUncollected) {
      salesDot.appendChild(createAlertDot(uncollectedUrgent));
      salesDot.setAttribute('title', uncollectedUrgent ? '未収あり（緊急）' : '未収あり');
    }
  }

  // コストボタン：買掛ドット
  const costDot = document.getElementById('dot-payable');
  if (costDot) {
    if (hasPayable) {
      costDot.appendChild(createAlertDot(payableUrgent));
      costDot.setAttribute('title', payableUrgent ? '買掛あり（緊急）' : '買掛あり');
    }
  }

  // 入店記録ボタン：退店未記録ドット
  const clockDot = document.getElementById('dot-clockout');
  if (clockDot) {
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

  const activeStaff = DUMMY_STAFF.filter(s => s.isActive);
  const inactiveStaff = DUMMY_STAFF.filter(s => !s.isActive);
  const displayStaff = [...activeStaff, ...inactiveStaff].slice(0, 3);

  if (displayStaff.length === 0) {
    container.innerHTML = `
      <div class="staff-item">
        <span class="staff-dot staff-dot--off"></span>
        <div class="staff-info">
          <div class="staff-name" style="color:var(--uz-muted)">本日の入店記録なし</div>
        </div>
      </div>`;
    return;
  }

  container.innerHTML = displayStaff.map(s => `
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
        ? `<button class="staff-clockout-btn" data-id="${s.id}" onclick="handleClockOut(${s.id})">退店</button>`
        : ''}
    </div>
  `).join('');
}

/* ── 損益サマリー描画 ────────────────────────────────────── */
function _renderPLValues(pl) {
  const now = new Date();
  const year  = pl.year  ?? now.getFullYear();
  const month = pl.month ?? (now.getMonth() + 1);

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
  const now = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;

  try {
    const res = await callGAS('getPL', { year, month });
    if (res && res.status === 'ok' && res.data) {
      _renderPLValues(res.data);
    } else {
      _renderPLError();
      showToast('損益データの取得に失敗しました', 'error');
    }
  } catch (e) {
    _renderPLError();
    showToast('通信エラー：損益データを取得できません', 'error');
  }
}

/* ── 退店処理（ダミー） ──────────────────────────────────── */
function handleClockOut(staffId) {
  const staff = DUMMY_STAFF.find(s => s.id === staffId);
  if (!staff) return;

  if (!confirm(`${staff.name}さんを退店記録しますか？`)) return;

  // ダミー：本番はcallGAS('clockOut', { staffId })
  const now = new Date();
  staff.clockOut = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  staff.isActive = false;

  renderStaffList();
  showToast(`${staff.name}さんの退店を記録しました`, 'success');
}

/* ── XSSエスケープ ───────────────────────────────────────── */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── 初期化 ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  renderHeaderDate();
  startClock();
  renderAlerts();
  renderStaffList();
  loadPL();
});
