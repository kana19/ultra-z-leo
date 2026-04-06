/**
 * ウルトラ財務くん LEO版 PWA — clockin.js
 * 入店記録画面ロジック
 *
 * 目的：スタッフの記録忘れ修正・未登録スタッフの手動記録
 * 入店・退店を1画面で同時設定・修正できる仕様
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
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

async function loadStaffFromGAS() {
  try {
    const res = await callGAS('getSettings', {});
    if (res?.status === 'ok' && Array.isArray(res.data?.staffList)) {
      localStorage.setItem(STAFF_MASTER_KEY, JSON.stringify(res.data.staffList));
      renderStaffButtons();
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
let todayAttendance      = [];
let selectedStaffId      = null;
let selectedName         = '';
let editingAttendanceIdx = null; // null=新規, number=修正中のインデックス
let isSubmitting         = false;

/* ── 初期化 ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  todayAttendance = loadAttendance();
  renderStaffButtons();
  renderAttendanceList();
  bindNameInput();
  bindFormInputs();
  bindSubmitBtn();
  loadStaffFromGAS();
});

/* ══════════════════════════════════════════════════════════
   スタッフ選択ボタン
   ══════════════════════════════════════════════════════════ */

function renderStaffButtons() {
  const container = document.getElementById('staff-btns');
  if (!container) return;

  const master = getStaffMaster();
  if (master.length === 0) {
    container.innerHTML = `<p style="font-size:13px;color:var(--uz-muted);">設定からスタッフを登録してください</p>`;
    return;
  }

  container.innerHTML = master.map(s => `
    <button class="quick-staff-btn"
            type="button"
            data-id="${escHtml(String(s.id))}"
            data-name="${escHtml(s.name)}">
      ${escHtml(s.name)}
    </button>
  `).join('');

  container.addEventListener('click', e => {
    const btn = e.target.closest('.quick-staff-btn');
    if (!btn) return;
    selectStaff(btn.dataset.id, btn.dataset.name);
  });
}

function selectStaff(id, name) {
  selectedStaffId      = id;
  selectedName         = name;
  editingAttendanceIdx = null;

  // ボタンハイライト
  document.querySelectorAll('.quick-staff-btn').forEach(btn => {
    btn.classList.toggle('quick-staff-btn--selected', btn.dataset.id === id);
  });

  // テキスト入力欄に反映
  const nameInput = document.getElementById('name-input');
  if (nameInput) nameInput.value = name;

  showFormSection();
  setFormDefaults();
  updateSubmitBtn();
}

/* ── テキスト入力（マスタ外スタッフ） ───────────────────── */
function bindNameInput() {
  const nameInput = document.getElementById('name-input');
  if (!nameInput) return;
  nameInput.addEventListener('input', () => {
    selectedName         = nameInput.value.trim();
    selectedStaffId      = null;
    editingAttendanceIdx = null;

    // ボタンハイライト解除
    document.querySelectorAll('.quick-staff-btn').forEach(btn => {
      btn.classList.remove('quick-staff-btn--selected');
    });

    if (selectedName) {
      showFormSection();
      // フォームが空の場合のみデフォルトをセット
      if (!document.getElementById('form-date')?.value) {
        setFormDefaults();
      }
    } else {
      hideFormSection();
    }
    updateSubmitBtn();
  });
}

/* ══════════════════════════════════════════════════════════
   入力フォーム
   ══════════════════════════════════════════════════════════ */

function showFormSection() {
  document.getElementById('entry-form-section')?.removeAttribute('hidden');
  document.getElementById('submit-bar')?.removeAttribute('hidden');
}

function hideFormSection() {
  document.getElementById('entry-form-section')?.setAttribute('hidden', '');
  document.getElementById('submit-bar')?.setAttribute('hidden', '');
}

function setFormDefaults() {
  const now  = new Date();
  const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const dateEl = document.getElementById('form-date');
  const inEl   = document.getElementById('form-clockin');
  const outEl  = document.getElementById('form-clockout');
  if (dateEl) dateEl.value = todayStr();
  if (inEl)   inEl.value   = hhmm;
  if (outEl)  outEl.value  = '';
}

function loadRecordIntoForm(record, idx) {
  selectedStaffId      = String(record.id);
  selectedName         = record.name;
  editingAttendanceIdx = idx;

  // ボタンハイライト
  document.querySelectorAll('.quick-staff-btn').forEach(btn => {
    btn.classList.toggle('quick-staff-btn--selected', btn.dataset.id === selectedStaffId);
  });
  const nameInput = document.getElementById('name-input');
  if (nameInput) nameInput.value = record.name;

  const dateEl = document.getElementById('form-date');
  const inEl   = document.getElementById('form-clockin');
  const outEl  = document.getElementById('form-clockout');
  if (dateEl) dateEl.value = record.date     || todayStr();
  if (inEl)   inEl.value   = record.clockIn  || '';
  if (outEl)  outEl.value  = record.clockOut || '';

  showFormSection();
  updateSubmitBtn();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function loadRecordForClockOut(record, idx) {
  loadRecordIntoForm(record, idx);
  // 退店時刻が未設定なら現在時刻をデフォルトセット
  const outEl = document.getElementById('form-clockout');
  if (outEl && !outEl.value) {
    const now  = new Date();
    outEl.value = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  }
  updateSubmitBtn();
}

function bindFormInputs() {
  document.getElementById('form-date')?.addEventListener('change',    updateSubmitBtn);
  document.getElementById('form-clockin')?.addEventListener('change', updateSubmitBtn);
  document.getElementById('form-clockout')?.addEventListener('change', updateSubmitBtn);
}

/* ── 登録ボタンテキスト生成 ──────────────────────────────── */
function buildSubmitBtnText() {
  const date    = document.getElementById('form-date')?.value    || todayStr();
  const clockIn = document.getElementById('form-clockin')?.value || '';
  const clockOut= document.getElementById('form-clockout')?.value || '';
  const dispDate = date.replace(/-/g, '/');
  const inStr   = clockIn  || '--:--';
  const outStr  = clockOut ? `${clockOut} 退店` : '退店未記録';
  return `${dispDate} ${inStr} 入店 / ${outStr}　登録する`;
}

function updateSubmitBtn() {
  const btn = document.getElementById('submit-btn');
  if (!btn) return;
  btn.disabled    = !selectedName;
  btn.textContent = selectedName ? buildSubmitBtnText() : '登録する';
}

function bindSubmitBtn() {
  document.getElementById('submit-btn')?.addEventListener('click', handleSubmit);
}

/* ══════════════════════════════════════════════════════════
   登録処理
   ══════════════════════════════════════════════════════════ */

async function handleSubmit() {
  if (isSubmitting || !selectedName) return;

  const date     = document.getElementById('form-date')?.value    || todayStr();
  const clockIn  = document.getElementById('form-clockin')?.value  || '';
  const clockOut = document.getElementById('form-clockout')?.value || '';

  if (!clockIn) {
    showToast('入店時刻を入力してください', 'error');
    return;
  }

  const master  = getStaffMaster().find(s => String(s.id) === String(selectedStaffId));
  const staffId = master?.id ?? (selectedStaffId || Date.now());
  const isEdit  = editingAttendanceIdx !== null;
  const existingRecord = isEdit ? todayAttendance[editingAttendanceIdx] : null;

  isSubmitting = true;
  const btn = document.getElementById('submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = '登録中...'; }

  try {
    const result = await callGAS('clockIn', {
      staffId,
      staffName:    selectedName,
      clockInTime:  clockIn,
      clockOutTime: clockOut || null,
      date,
      rowIndex:     existingRecord?.rowIndex ?? null,
    });
    if (result.status !== 'ok') throw new Error(result.message || '登録エラー');

    const newRecord = {
      id:       staffId,
      name:     selectedName,
      date,
      clockIn,
      clockOut:  clockOut || null,
      isActive:  !clockOut,
      rowIndex:  result.rowIndex ?? existingRecord?.rowIndex ?? null,
    };

    if (isEdit) {
      todayAttendance[editingAttendanceIdx] = newRecord;
    } else {
      todayAttendance.unshift(newRecord);
    }
    saveAttendance(todayAttendance);

    const nameToShow = selectedName;
    resetForm();
    renderAttendanceList();
    showToast(`${nameToShow}さんの記録を登録しました ✓`, 'success');

  } catch (e) {
    showToast('登録に失敗しました：' + e.message, 'error');
  } finally {
    isSubmitting = false;
    updateSubmitBtn();
  }
}

function resetForm() {
  selectedStaffId      = null;
  selectedName         = '';
  editingAttendanceIdx = null;

  document.querySelectorAll('.quick-staff-btn').forEach(btn => {
    btn.classList.remove('quick-staff-btn--selected');
  });
  const nameInput = document.getElementById('name-input');
  if (nameInput) nameInput.value = '';

  const dateEl = document.getElementById('form-date');
  const inEl   = document.getElementById('form-clockin');
  const outEl  = document.getElementById('form-clockout');
  if (dateEl) dateEl.value = '';
  if (inEl)   inEl.value   = '';
  if (outEl)  outEl.value  = '';

  hideFormSection();
  updateSubmitBtn();
}

/* ══════════════════════════════════════════════════════════
   本日の勤怠一覧
   ══════════════════════════════════════════════════════════ */

function renderAttendanceList() {
  const container = document.getElementById('attendance-list');
  if (!container) return;

  if (todayAttendance.length === 0) {
    container.innerHTML = `<p class="uc-empty">本日の入店記録がありません</p>`;
    return;
  }

  // 在店中を先に表示
  const sorted = [
    ...todayAttendance.filter(a => a.isActive || !a.clockOut),
    ...todayAttendance.filter(a => !a.isActive && a.clockOut),
  ];

  container.innerHTML = sorted.map(a => {
    const realIdx      = todayAttendance.indexOf(a);
    const isActive     = a.isActive || !a.clockOut;
    const clockOutDisp = a.clockOut || '未記録';
    const dotClass     = isActive ? 'attendance-dot--active' : 'attendance-dot--out';

    return `
      <div class="attendance-item">
        <span class="attendance-dot ${dotClass}" aria-hidden="true"></span>
        <div class="attendance-info">
          <div class="attendance-name">${escHtml(a.name)}</div>
          <div class="attendance-time">
            入店 ${escHtml(a.clockIn)}&nbsp;&nbsp;/&nbsp;&nbsp;退店 ${escHtml(clockOutDisp)}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;flex-shrink:0;">
          <button class="attendance-edit-btn"
                  type="button"
                  data-idx="${realIdx}"
                  style="font-size:12px;padding:4px 10px;border-radius:6px;
                         background:var(--uz-surface2);color:var(--uz-text);
                         border:1px solid var(--uz-border);cursor:pointer;
                         font-family:var(--font-main);white-space:nowrap;">
            修正
          </button>
          ${isActive ? `
          <button class="attendance-clockout-btn"
                  type="button"
                  data-idx="${realIdx}"
                  style="font-size:12px;padding:4px 10px;border-radius:6px;
                         background:var(--uz-red);color:#fff;
                         border:none;cursor:pointer;
                         font-family:var(--font-main);white-space:nowrap;">
            退店を記録
          </button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.attendance-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      loadRecordIntoForm(todayAttendance[idx], idx);
    });
  });

  container.querySelectorAll('.attendance-clockout-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      loadRecordForClockOut(todayAttendance[idx], idx);
    });
  });
}

/* ── XSSエスケープ ───────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
