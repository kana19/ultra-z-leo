/**
 * ウルトラ財務くん LEO版 PWA — clockin.js
 * 入店記録画面ロジック
 */

'use strict';

/* ── ストレージキー ──────────────────────────────────────── */
const STAFF_MASTER_KEY    = 'uz_staff_master';
const ATTENDANCE_DATE_KEY = 'uz_attendance_date';
const ATTENDANCE_DATA_KEY = 'uz_attendance_data';

/* ── スタッフマスタ（localStorageから読む） ──────────────── */
function getStaffMaster() {
  try {
    const saved = localStorage.getItem(STAFF_MASTER_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

/* ── GASからスタッフマスタを取得してlocalStorageに保存 ───── */
async function loadStaffFromGAS() {
  try {
    const res = await callGAS('getSettings', {});
    if (res && res.status === 'ok' && Array.isArray(res.data?.staffList)) {
      localStorage.setItem(STAFF_MASTER_KEY, JSON.stringify(res.data.staffList));
      renderQuickSelect();
    }
  } catch {
    // GAS失敗時はlocalStorageのデータをそのまま使用
  }
}

/* ── 勤怠データ（日付をまたいだらリセット） ─────────────── */
function loadAttendance() {
  const savedDate = localStorage.getItem(ATTENDANCE_DATE_KEY);
  const today     = todayStr();

  if (savedDate !== today) {
    localStorage.setItem(ATTENDANCE_DATE_KEY, today);
    localStorage.setItem(ATTENDANCE_DATA_KEY, JSON.stringify([]));
    return [];
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
  bindQuickStaffSelect();
  bindNameInput();
  bindClockInBtn();
  // GASから最新スタッフリストを取得（バックグラウンド）
  loadStaffFromGAS();
});

/* ── クイック選択（未入店スタッフ） ─────────────────────── */
function renderQuickSelect() {
  const container = document.getElementById('quick-staff');
  if (!container) return;

  const staffMaster = getStaffMaster();
  const allTodayIds = todayAttendance.map(a => a.id);

  // 今日まだ入店記録がないスタッフのみ表示
  const available = staffMaster.filter(s => !allTodayIds.includes(s.id));

  if (staffMaster.length === 0) {
    container.innerHTML = `<p style="font-size:13px;color:var(--uz-muted);">設定からスタッフを登録してください</p>`;
    return;
  }

  if (available.length === 0) {
    container.innerHTML = `<p style="font-size:13px;color:var(--uz-muted);">全スタッフが入店済みです</p>`;
    return;
  }

  container.innerHTML = available.map(s => `
    <button class="quick-staff-btn"
            data-id="${escHtml(String(s.id))}"
            data-name="${escHtml(s.name)}"
            type="button">
      ${escHtml(s.name)}
    </button>
  `).join('');
}

/* ── クイック選択イベント（委譲・1回のみ登録） ────────────── */
function bindQuickStaffSelect() {
  const container = document.getElementById('quick-staff');
  if (!container) return;
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.quick-staff-btn');
    if (!btn) return;
    selectQuickStaff(btn.dataset.id, btn.dataset.name);
  });
}

/* ── クイック選択タップ ──────────────────────────────────── */
function selectQuickStaff(id, name) {
  selectedName = name;

  document.querySelectorAll('.quick-staff-btn').forEach(btn => {
    btn.classList.toggle('quick-staff-btn--selected', btn.dataset.name === name);
  });

  const nameInput = document.getElementById('name-input');
  if (nameInput) nameInput.value = name;

  showClockInDatetime();
  updateClockInBtn();
}

/* ── 名前テキスト入力 ────────────────────────────────────── */
function bindNameInput() {
  const nameInput = document.getElementById('name-input');
  if (!nameInput) return;

  nameInput.addEventListener('input', () => {
    const wasEmpty = !selectedName;
    selectedName = nameInput.value.trim();

    document.querySelectorAll('.quick-staff-btn').forEach(btn => {
      btn.classList.toggle('quick-staff-btn--selected', btn.dataset.name === selectedName);
    });

    if (selectedName && wasEmpty) showClockInDatetime();
    if (!selectedName) hideClockInDatetime();
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

  if (todayAttendance.some(a => a.name === selectedName && a.isActive)) {
    return showToast(`${selectedName}さんはすでに在店中です`, 'error');
  }

  const now         = new Date();
  const date        = document.getElementById('clockin-date-input')?.value || todayStr();
  const clockInTime = document.getElementById('clockin-time-input')?.value ||
    `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  const master = getStaffMaster().find(s => s.name === selectedName);
  const staffId = master?.id ?? Date.now();

  isSubmitting = true;
  setClockInBtnLoading(true);

  try {
    const result = await callGAS('clockIn', { staffId, staffName: selectedName, clockInTime, date });
    if (result.status !== 'ok') throw new Error(result.message || '登録エラー');

    const newRecord = {
      id:       staffId,
      name:     selectedName,
      clockIn:  clockInTime,
      clockOut: null,
      isActive: true,
      rowIndex: result.rowIndex ?? null,
    };

    todayAttendance.unshift(newRecord);
    saveAttendance(todayAttendance);

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
    const result = await callGAS('clockOut', { staffId: record.id, clockOutTime, rowIndex: record.rowIndex ?? null });
    if (result.status !== 'ok') throw new Error(result.message || '登録エラー');

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
  hideClockInDatetime();
  updateClockInBtn();
}

/* ── 入店日時セクション 表示/非表示 ──────────────────────── */
function showClockInDatetime() {
  const section = document.getElementById('clockin-datetime-section');
  if (!section) return;
  const now = new Date();
  const dateEl = document.getElementById('clockin-date-input');
  const timeEl = document.getElementById('clockin-time-input');
  if (dateEl) dateEl.value = todayStr();
  if (timeEl) timeEl.value =
    `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  section.hidden = false;
}

function hideClockInDatetime() {
  const section = document.getElementById('clockin-datetime-section');
  if (section) section.hidden = true;
  const dateEl = document.getElementById('clockin-date-input');
  const timeEl = document.getElementById('clockin-time-input');
  if (dateEl) dateEl.value = '';
  if (timeEl) timeEl.value = '';
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
