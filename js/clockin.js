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
let todayAttendance   = [];
let selectedName      = '';
let pendingClockOutId = null;
let isSubmitting      = false;

/* ── 初期化 ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  todayAttendance = loadAttendance();
  renderQuickSelect();
  renderAttendanceList();
  bindQuickStaffSelect();
  bindAttendanceListActions();
  bindNameInput();
  bindDatetimeInputs();
  bindClockInBtn();
  bindClockOutBtns();
  loadStaffFromGAS();
});

/* ── クイック選択（未入店スタッフ） ─────────────────────── */
function renderQuickSelect() {
  const container = document.getElementById('quick-staff');
  if (!container) return;

  const staffMaster = getStaffMaster();
  const allTodayIds = todayAttendance.map(a => a.id);
  const available   = staffMaster.filter(s => !allTodayIds.includes(s.id));

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
    selectedName   = nameInput.value.trim();
    document.querySelectorAll('.quick-staff-btn').forEach(btn => {
      btn.classList.toggle('quick-staff-btn--selected', btn.dataset.name === selectedName);
    });
    if (selectedName && wasEmpty) showClockInDatetime();
    if (!selectedName) hideClockInDatetime();
    updateClockInBtn();
  });
}

/* ══════════════════════════════════════════════════════════
   入店 — 日時セクション・ボタン
   ══════════════════════════════════════════════════════════ */

function buildClockInBtnText() {
  const dateVal  = document.getElementById('clockin-date-input')?.value || todayStr();
  const timeVal  = document.getElementById('clockin-time-input')?.value || '';
  const dispDate = dateVal.replace(/-/g, '/');
  return timeVal
    ? `入店日時 ${dispDate} ${timeVal}　記録する`
    : `入店日時 ${dispDate}　記録する`;
}

function updateClockInBtn() {
  const btn = document.getElementById('clockin-btn');
  if (!btn) return;
  btn.disabled  = !selectedName;
  btn.innerHTML = selectedName ? buildClockInBtnText() : '👤 記録する';
}

/* ── 日付・時刻変更リスナー（入店・退店両方） ────────────── */
function bindDatetimeInputs() {
  document.getElementById('clockin-date-input')?.addEventListener('change', () => {
    if (selectedName) updateClockInBtn();
  });
  document.getElementById('clockin-time-input')?.addEventListener('change', () => {
    if (selectedName) updateClockInBtn();
  });
  document.getElementById('clockout-date-input')?.addEventListener('change', updateClockOutBtn);
  document.getElementById('clockout-time-input')?.addEventListener('change', updateClockOutBtn);
}

function bindClockInBtn() {
  document.getElementById('clockin-btn')?.addEventListener('click', handleClockIn);
}

function showClockInDatetime() {
  const section = document.getElementById('clockin-datetime-section');
  if (!section) return;

  const wasHidden = section.hasAttribute('hidden');
  section.removeAttribute('hidden');

  // 非表示→表示の初回のみ現在日時をセット（ユーザーが変更した値を上書きしない）
  if (wasHidden) {
    const now    = new Date();
    const dateEl = document.getElementById('clockin-date-input');
    const timeEl = document.getElementById('clockin-time-input');
    if (dateEl) dateEl.value = todayStr();
    if (timeEl) timeEl.value =
      `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  }

  updateClockInBtn();
}

function hideClockInDatetime() {
  const section = document.getElementById('clockin-datetime-section');
  if (section) section.setAttribute('hidden', '');
  const dateEl = document.getElementById('clockin-date-input');
  const timeEl = document.getElementById('clockin-time-input');
  if (dateEl) dateEl.value = '';
  if (timeEl) timeEl.value = '';
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

  const master  = getStaffMaster().find(s => s.name === selectedName);
  const staffId = master?.id ?? Date.now();

  isSubmitting = true;
  setClockInBtnLoading(true);

  try {
    const result = await callGAS('clockIn', { staffId, staffName: selectedName, clockInTime, date });
    if (result.status !== 'ok') throw new Error(result.message || '登録エラー');

    todayAttendance.unshift({
      id:       staffId,
      name:     selectedName,
      clockIn:  clockInTime,
      clockOut: null,
      isActive: true,
      rowIndex: result.rowIndex ?? null,
    });
    saveAttendance(todayAttendance);

    const nameToShow = selectedName;
    resetSelection();
    renderQuickSelect();
    renderAttendanceList();
    showToast(`${nameToShow}さんの入店を記録しました ✓`, 'success');

  } catch (e) {
    showToast('登録に失敗しました：' + e.message, 'error');
  } finally {
    setClockInBtnLoading(false);
    isSubmitting = false;
  }
}

function setClockInBtnLoading(loading) {
  const btn = document.getElementById('clockin-btn');
  if (!btn) return;
  if (loading) {
    btn.disabled  = true;
    btn.innerHTML = '<span class="spinner" style="width:20px;height:20px;border-top-color:#fff;"></span>';
  } else {
    btn.disabled  = !selectedName;
    btn.innerHTML = selectedName ? buildClockInBtnText() : '👤 記録する';
  }
}

/* ══════════════════════════════════════════════════════════
   退店 — 日時セクション・ボタン
   ══════════════════════════════════════════════════════════ */

function buildClockOutBtnText() {
  const dateVal  = document.getElementById('clockout-date-input')?.value || todayStr();
  const timeVal  = document.getElementById('clockout-time-input')?.value || '';
  const dispDate = dateVal.replace(/-/g, '/');
  return timeVal
    ? `退店日時 ${dispDate} ${timeVal}　退店記録する`
    : `退店日時 ${dispDate}　退店記録する`;
}

function updateClockOutBtn() {
  const btn = document.getElementById('clockout-btn');
  if (!btn) return;
  btn.innerHTML = buildClockOutBtnText();
}

function bindClockOutBtns() {
  document.getElementById('clockout-btn')?.addEventListener('click', executeClockOut);
  document.getElementById('clockout-cancel-btn')?.addEventListener('click', cancelClockOut);
}

/* ── 退店記録開始（勤怠リストの「退店記録」ボタンから呼ばれる） */
function startClockOut(id) {
  pendingClockOutId = id;
  const record = todayAttendance.find(a => String(a.id) === String(id));
  if (!record) return;

  const section = document.getElementById('clockout-datetime-section');
  if (!section) return;
  section.removeAttribute('hidden');

  const nameEl = document.getElementById('clockout-staff-name');
  if (nameEl) nameEl.textContent = `${record.name}さん`;

  // 現在日時をセット
  const now    = new Date();
  const dateEl = document.getElementById('clockout-date-input');
  const timeEl = document.getElementById('clockout-time-input');
  if (dateEl) dateEl.value = todayStr();
  if (timeEl) timeEl.value =
    `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  // ボタンバー切り替え：入店→退店
  document.getElementById('clockin-submit-bar')?.setAttribute('hidden', '');
  document.getElementById('clockout-submit-bar')?.removeAttribute('hidden');
  updateClockOutBtn();
}

/* ── 退店記録キャンセル ──────────────────────────────────── */
function cancelClockOut() {
  pendingClockOutId = null;
  const section = document.getElementById('clockout-datetime-section');
  if (section) section.setAttribute('hidden', '');
  const dateEl = document.getElementById('clockout-date-input');
  const timeEl = document.getElementById('clockout-time-input');
  if (dateEl) dateEl.value = '';
  if (timeEl) timeEl.value = '';
  document.getElementById('clockout-submit-bar')?.setAttribute('hidden', '');
  document.getElementById('clockin-submit-bar')?.removeAttribute('hidden');
}

/* ── 退店処理実行 ────────────────────────────────────────── */
async function executeClockOut() {
  if (isSubmitting || !pendingClockOutId) return;

  const id     = pendingClockOutId;
  const record = todayAttendance.find(a => String(a.id) === String(id));
  if (!record) return;

  const now          = new Date();
  const date         = document.getElementById('clockout-date-input')?.value || todayStr();
  const clockOutTime = document.getElementById('clockout-time-input')?.value ||
    `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  isSubmitting = true;
  const btn = document.getElementById('clockout-btn');
  if (btn) {
    btn.disabled  = true;
    btn.innerHTML = '<span class="spinner" style="width:20px;height:20px;border-top-color:#fff;"></span>';
  }

  try {
    const result = await callGAS('clockOut', {
      staffId:     record.id,
      clockOutTime,
      date,
      rowIndex:    record.rowIndex ?? null,
    });
    if (result.status !== 'ok') throw new Error(result.message || '登録エラー');

    record.clockOut = clockOutTime;
    record.isActive = false;
    saveAttendance(todayAttendance);

    const nameToShow = record.name;
    cancelClockOut();
    renderQuickSelect();
    renderAttendanceList();
    showToast(`${nameToShow}さんの退店を記録しました`, 'success');

  } catch (e) {
    showToast('退店記録に失敗しました：' + e.message, 'error');
    if (btn) {
      btn.disabled  = false;
      btn.innerHTML = buildClockOutBtnText();
    }
  } finally {
    isSubmitting = false;
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
                   data-id="${escHtml(String(a.id))}">退店記録</button>`
        : `<span style="font-size:12px;color:var(--uz-muted);">退店済み</span>`}
    </div>
  `).join('');
}

/* ── 勤怠リストのアクション（委譲・1回のみ登録） ─────────── */
function bindAttendanceListActions() {
  const container = document.getElementById('attendance-list');
  if (!container) return;
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.attendance-clockout-btn');
    if (!btn) return;
    startClockOut(btn.dataset.id);
  });
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

/* ── XSSエスケープ ───────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
