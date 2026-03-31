/**
 * ウルトラ財務くん LEO版 PWA — clockin.js
 * 入店記録画面ロジック
 */

'use strict';

/* ── ストレージキー ──────────────────────────────────────── */
const STAFF_MASTER_KEY    = 'uz_staff_master';
const ATTENDANCE_DATE_KEY = 'uz_attendance_date';
const ATTENDANCE_DATA_KEY = 'uz_attendance_data';

/* ── スタッフマスタ ──────────────────────────────────────── */
function getStaffMaster() {
  try {
    const saved = localStorage.getItem(STAFF_MASTER_KEY);
    return saved ? JSON.parse(saved) : getDefaultStaff();
  } catch { return getDefaultStaff(); }
}

function getDefaultStaff() {
  return [
    { id: 1, name: 'さくら' },
    { id: 2, name: 'あかね' },
    { id: 3, name: 'みか'   },
    { id: 4, name: 'ゆき'   },
  ];
}

/* ── 勤怠データ（日付をまたいだらリセット） ─────────────── */
function loadAttendance() {
  const savedDate = localStorage.getItem(ATTENDANCE_DATE_KEY);
  const today     = todayStr();

  if (savedDate !== today) {
    // 日付が変わっていたらリセット（ダミーデータで初期化）
    const dummy = [
      { id: 1, name: 'さくら', clockIn: '20:30', clockOut: null,    isActive: true  },
      { id: 2, name: 'あかね', clockIn: '20:00', clockOut: null,    isActive: true  },
      { id: 3, name: 'みか',   clockIn: '19:45', clockOut: '23:00', isActive: false },
    ];
    localStorage.setItem(ATTENDANCE_DATE_KEY, today);
    localStorage.setItem(ATTENDANCE_DATA_KEY, JSON.stringify(dummy));
    return dummy;
  }

  try {
    return JSON.parse(localStorage.getItem(ATTENDANCE_DATA_KEY)) || [];
  } catch { return []; }
}

function saveAttendance(data) {
  localStorage.setItem(ATTENDANCE_DATE_KEY, todayStr());
  localStorage.setItem(ATTENDANCE_DATA_KEY, JSON.stringify(data));
}

/* ── 状態 ────────────────────────────────────────────────── */
let todayAttendance = [];
let selectedName    = '';
let isSubmitting    = false;

/* ── 初期化 ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  todayAttendance = loadAttendance();
  renderQuickSelect();
  renderAttendanceList();
  bindNameInput();
  bindClockInBtn();
});

/* ── クイック選択（未入店スタッフ） ─────────────────────── */
function renderQuickSelect() {
  const container = document.getElementById('quick-staff');
  if (!container) return;

  const staffMaster  = getStaffMaster();
  const activeIds    = todayAttendance.filter(a => a.isActive).map(a => a.id);
  const allTodayIds  = todayAttendance.map(a => a.id);

  // 今日まだ入店記録がないスタッフのみ表示
  const available = staffMaster.filter(s => !allTodayIds.includes(s.id));

  if (available.length === 0) {
    container.innerHTML = `<p style="font-size:13px;color:var(--uz-muted);">全スタッフが入店済みです</p>`;
    return;
  }

  container.innerHTML = available.map(s => `
    <button class="quick-staff-btn"
            data-id="${s.id}"
            data-name="${escHtml(s.name)}"
            type="button"
            onclick="selectQuickStaff(${s.id}, '${escHtml(s.name)}')">
      ${escHtml(s.name)}
    </button>
  `).join('');
}

/* ── クイック選択タップ ──────────────────────────────────── */
function selectQuickStaff(id, name) {
  selectedName = name;

  // ボタンUI更新
  document.querySelectorAll('.quick-staff-btn').forEach(btn => {
    btn.classList.toggle('quick-staff-btn--selected', btn.dataset.name === name);
  });

  // テキストインプットを同期
  const nameInput = document.getElementById('name-input');
  if (nameInput) nameInput.value = name;

  updateClockInBtn();
}

/* ── 名前テキスト入力 ────────────────────────────────────── */
function bindNameInput() {
  const nameInput = document.getElementById('name-input');
  if (!nameInput) return;

  nameInput.addEventListener('input', () => {
    selectedName = nameInput.value.trim();

    // クイック選択ボタンとの同期（一致するものをハイライト）
    document.querySelectorAll('.quick-staff-btn').forEach(btn => {
      btn.classList.toggle('quick-staff-btn--selected', btn.dataset.name === selectedName);
    });

    updateClockInBtn();
  });
}

/* ── 入店ボタン有効化制御 ────────────────────────────────── */
function updateClockInBtn() {
  const btn = document.getElementById('clockin-btn');
  if (!btn) return;
  btn.disabled = !selectedName;
}

/* ── 入店ボタンバインド ──────────────────────────────────── */
function bindClockInBtn() {
  document.getElementById('clockin-btn')?.addEventListener('click', handleClockIn);
}

/* ── 入店処理 ────────────────────────────────────────────── */
async function handleClockIn() {
  if (isSubmitting || !selectedName) return;

  // 重複チェック（同名の在店中スタッフ）
  if (todayAttendance.some(a => a.name === selectedName && a.isActive)) {
    return showToast(`${selectedName}さんはすでに在店中です`, 'error');
  }

  const now = new Date();
  const clockInTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  // IDを採番（スタッフマスタ照合 → なければ臨時ID）
  const master = getStaffMaster().find(s => s.name === selectedName);
  const newId  = master?.id ?? Date.now();

  const newRecord = {
    id:       newId,
    name:     selectedName,
    clockIn:  clockInTime,
    clockOut: null,
    isActive: true,
  };

  isSubmitting = true;
  setClockInBtnLoading(true);

  try {
    // ★ GAS未接続期間はダミー動作
    // await callGAS('clockIn', { staffId: newId, staffName: selectedName });
    await new Promise(r => setTimeout(r, 500));

    todayAttendance.unshift(newRecord);
    saveAttendance(todayAttendance);

    // UI更新
    resetSelection();
    renderQuickSelect();
    renderAttendanceList();
    showToast(`${selectedName}さんの入店を記録しました ✓`, 'success');

  } catch (e) {
    showToast('登録に失敗しました：' + e.message, 'error');
  } finally {
    setClockInBtnLoading(false);
    isSubmitting = false;
  }
}

/* ── 退店処理 ────────────────────────────────────────────── */
async function handleClockOut(id) {
  const record = todayAttendance.find(a => a.id === id);
  if (!record) return;

  if (!confirm(`${record.name}さんを退店記録しますか？`)) return;

  const now = new Date();
  const clockOutTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  try {
    // ★ GAS未接続期間はダミー動作
    // await callGAS('clockOut', { staffId: id });
    await new Promise(r => setTimeout(r, 400));

    record.clockOut = clockOutTime;
    record.isActive = false;
    saveAttendance(todayAttendance);

    renderQuickSelect();
    renderAttendanceList();
    showToast(`${record.name}さんの退店を記録しました`, 'success');

  } catch (e) {
    showToast('退店記録に失敗しました：' + e.message, 'error');
  }
}

/* ── 勤怠リスト描画 ──────────────────────────────────────── */
function renderAttendanceList() {
  const container = document.getElementById('attendance-list');
  if (!container) return;

  if (todayAttendance.length === 0) {
    container.innerHTML = `<p class="uc-empty">本日の入店記録がありません</p>`;
    return;
  }

  // 在店中を先に、退店済みをあとに
  const sorted = [
    ...todayAttendance.filter(a => a.isActive),
    ...todayAttendance.filter(a => !a.isActive),
  ];

  container.innerHTML = sorted.map(a => `
    <div class="attendance-item">
      <span class="attendance-dot ${a.isActive ? 'attendance-dot--active' : 'attendance-dot--out'}"
            aria-hidden="true"></span>
      <div class="attendance-info">
        <div class="attendance-name">${escHtml(a.name)}</div>
        <div class="attendance-time">
          ${a.isActive
            ? `入店 ${escHtml(a.clockIn)} — 在店中`
            : `${escHtml(a.clockIn)} → ${escHtml(a.clockOut)}`}
        </div>
      </div>
      ${a.isActive
        ? `<button class="attendance-clockout-btn"
                   type="button"
                   onclick="handleClockOut(${a.id})">退店記録</button>`
        : `<span style="font-size:12px;color:var(--uz-muted);">退店済み</span>`}
    </div>
  `).join('');
}

/* ── UIリセット ──────────────────────────────────────────── */
function resetSelection() {
  selectedName = '';
  const nameInput = document.getElementById('name-input');
  if (nameInput) nameInput.value = '';
  document.querySelectorAll('.quick-staff-btn').forEach(btn => {
    btn.classList.remove('quick-staff-btn--selected');
  });
  updateClockInBtn();
}

/* ── ヘルパー ────────────────────────────────────────────── */
function setClockInBtnLoading(loading) {
  const btn = document.getElementById('clockin-btn');
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading
    ? '<span class="spinner" style="width:20px;height:20px;border-top-color:#fff;"></span>'
    : '👤 入店記録する';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
