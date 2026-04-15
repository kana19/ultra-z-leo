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

/* ── 時刻文字列正規化（GASのシリアル日時 "1899-12-29T..." 対応） */
function parseTimeStr(val) {
  if (!val) return '';
  const s = String(val).trim();
  // "HH:MM" または "HH:MM:SS" 形式
  if (/^\d{1,2}:\d{2}/.test(s)) return s.slice(0, 5);
  // ISO日時形式（GASのシリアル時刻は UTC "1899-12-30T HH:MM:SS" として来る）
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const h = d.getUTCHours();
    const m = d.getUTCMinutes();
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return '';
}

/* ── 現在のHH:MM文字列 ───────────────────────────────────── */
function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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
let clockoutExpandedIdx  = null; // カード内退店入力を展開中のインデックス
let isSubmitting         = false;

/* ── 初期化 ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  todayAttendance = loadAttendance();
  initFormSelects();
  renderStaffButtons();
  renderAttendanceList();
  bindNameInput();
  bindFormInputs();
  bindSubmitBtn();
  loadStaffFromGAS();
});

/* ── 時刻セレクト初期化（オプション注入） ───────────────── */
function initFormSelects() {
  const hInEl  = document.getElementById('form-clockin-h');
  const mInEl  = document.getElementById('form-clockin-m');
  const hOutEl = document.getElementById('form-clockout-h');
  const mOutEl = document.getElementById('form-clockout-m');

  const hourOpts = _TIME_HOURS.map(v => `<option value="${v}">${v}</option>`).join('');
  const minOpts  = _TIME_MINS.map(v  => `<option value="${v}">${v}</option>`).join('');

  if (hInEl)  hInEl.innerHTML  = hourOpts;
  if (mInEl)  mInEl.innerHTML  = minOpts;
  if (hOutEl) hOutEl.innerHTML = `<option value="">--</option>${hourOpts}`;
  if (mOutEl) mOutEl.innerHTML = `<option value="">--</option>${minOpts}`;
}

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
  // スタッフ選択時は必ず現在日時をセット（値をリセットしてから）
  setFormDefaults(true);
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
        setFormDefaults(true);
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

/**
 * フォームにデフォルト値をセット
 * @param {boolean} forceReset - trueなら既存値を上書きする
 */
function setFormDefaults(forceReset = false) {
  const dateEl = document.getElementById('form-date');
  if (forceReset || !dateEl?.value) {
    if (dateEl) dateEl.value = todayStr();
  }
  if (forceReset || !getTimeSelectValue('form-clockin')) {
    setTimeSelect('form-clockin', nowHHMM());
  }
  if (forceReset) {
    setTimeSelect('form-clockout', '');
  }
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
  if (dateEl) dateEl.value = record.date || todayStr();
  setTimeSelect('form-clockin',  parseTimeStr(record.clockIn)  || '');
  setTimeSelect('form-clockout', parseTimeStr(record.clockOut) || '');

  showFormSection();
  updateSubmitBtn();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bindFormInputs() {
  document.getElementById('form-date')?.addEventListener('change',       updateSubmitBtn);
  document.getElementById('form-clockin-h')?.addEventListener('change',  updateSubmitBtn);
  document.getElementById('form-clockin-m')?.addEventListener('change',  updateSubmitBtn);
  document.getElementById('form-clockout-h')?.addEventListener('change', updateSubmitBtn);
  document.getElementById('form-clockout-m')?.addEventListener('change', updateSubmitBtn);
}

/* ── 登録ボタンテキスト生成 ──────────────────────────────── */
function buildSubmitBtnText() {
  const date     = document.getElementById('form-date')?.value || todayStr();
  const clockIn  = getTimeSelectValue('form-clockin');
  const clockOut = getTimeSelectValue('form-clockout');
  const dispDate = date.replace(/-/g, '/');
  const inStr    = clockIn  || '--:--';
  const outStr   = clockOut ? `${clockOut} 退店` : '退店未記録';
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
   登録処理（上部フォーム）
   ══════════════════════════════════════════════════════════ */

async function handleSubmit() {
  if (isSubmitting || !selectedName) return;

  const date     = document.getElementById('form-date')?.value || todayStr();
  const clockIn  = getTimeSelectValue('form-clockin');
  const clockOut = getTimeSelectValue('form-clockout');

  if (!clockIn) {
    showToast('入店時刻を選択してください', 'error');
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
  if (dateEl) dateEl.value = '';
  setTimeSelect('form-clockin',  '');
  setTimeSelect('form-clockout', '');

  hideFormSection();
  updateSubmitBtn();
}

/* ══════════════════════════════════════════════════════════
   本日の勤怠一覧（カード内退店入力展開対応）
   ══════════════════════════════════════════════════════════ */

/**
 * 「退店を記録」ボタンの表示条件：
 *   退店未記録 かつ 現在時刻 >= 入店時刻
 */
function canShowClockOutBtn(record) {
  if (record.clockOut) return false;
  const clockInTime = parseTimeStr(record.clockIn);
  if (!clockInTime) return true; // 入店時刻不明なら表示する
  return nowHHMM() >= clockInTime;
}

function renderAttendanceList() {
  const container = document.getElementById('attendance-list');
  if (!container) return;

  if (todayAttendance.length === 0) {
    container.innerHTML = `<p class="uc-empty">本日の入店記録がありません</p>`;
    return;
  }

  // 在店中を先に表示
  const sorted = [
    ...todayAttendance.filter(a =>  a.isActive || !a.clockOut),
    ...todayAttendance.filter(a => !a.isActive &&  a.clockOut),
  ];

  container.innerHTML = sorted.map(a => {
    const realIdx      = todayAttendance.indexOf(a);
    const isActive     = a.isActive || !a.clockOut;
    const clockInDisp  = parseTimeStr(a.clockIn)  || a.clockIn  || '—';
    const clockOutDisp = parseTimeStr(a.clockOut) || (a.clockOut ? a.clockOut : '未記録');
    const dotClass     = isActive ? 'attendance-dot--active' : 'attendance-dot--out';
    const showCoBtn    = canShowClockOutBtn(a);
    const isExpanded   = clockoutExpandedIdx === realIdx;

    return `
      <div class="attendance-item" style="flex-wrap:wrap;gap:6px;padding-bottom:${isExpanded ? '12px' : '10px'};">
        <span class="attendance-dot ${dotClass}" aria-hidden="true"></span>
        <div class="attendance-info" style="flex:1;min-width:0;">
          <div class="attendance-name">${escHtml(a.name)}</div>
          <div class="attendance-time">
            入店 ${escHtml(clockInDisp)}&nbsp;&nbsp;/&nbsp;&nbsp;退店 ${escHtml(clockOutDisp)}
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
          ${showCoBtn ? `
          <button class="attendance-clockout-btn"
                  type="button"
                  data-idx="${realIdx}"
                  style="font-size:12px;padding:4px 10px;border-radius:6px;
                         background:#16a34a;color:#fff;
                         border:none;cursor:pointer;
                         font-family:var(--font-main);white-space:nowrap;">
            退店を記録
          </button>` : ''}
        </div>
        ${isExpanded ? `
        <div class="clockout-inline-form"
             data-idx="${realIdx}"
             style="width:100%;display:flex;gap:8px;align-items:center;flex-wrap:wrap;
                    padding-top:8px;border-top:1px solid var(--uz-border);margin-top:2px;">
          ${timeSelectHTML(`inline-clockout-${realIdx}`, nowHHMM(), true)}
          <button class="clockout-inline-submit"
                  type="button"
                  data-idx="${realIdx}"
                  style="padding:6px 14px;border-radius:6px;background:#16a34a;
                         color:#fff;border:none;cursor:pointer;font-size:13px;
                         font-family:var(--font-main);white-space:nowrap;font-weight:600;">
            記録する
          </button>
          <button class="clockout-inline-cancel"
                  type="button"
                  data-idx="${realIdx}"
                  style="padding:6px 10px;border-radius:6px;background:none;
                         color:var(--uz-muted);border:1px solid var(--uz-border);
                         cursor:pointer;font-size:12px;font-family:var(--font-main);">
            ✕
          </button>
        </div>` : ''}
      </div>
    `;
  }).join('');

  // 修正ボタン
  container.querySelectorAll('.attendance-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      clockoutExpandedIdx = null;
      loadRecordIntoForm(todayAttendance[idx], idx);
    });
  });

  // 「退店を記録」→カード内フォーム展開
  container.querySelectorAll('.attendance-clockout-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      clockoutExpandedIdx = (clockoutExpandedIdx === idx) ? null : idx;
      renderAttendanceList();
      // 展開したインプットにフォーカス
      if (clockoutExpandedIdx === idx) {
        setTimeout(() => {
          document.getElementById(`inline-clockout-${idx}-h`)?.focus();
        }, 50);
      }
    });
  });

  // カード内「記録する」ボタン
  container.querySelectorAll('.clockout-inline-submit').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx     = parseInt(btn.dataset.idx, 10);
      const timeVal = getTimeSelectValue(`inline-clockout-${idx}`);
      if (!timeVal) {
        showToast('退店時刻を選択してください', 'error');
        return;
      }
      handleInlineClockOut(idx, timeVal);
    });
  });

  // カード内キャンセルボタン
  container.querySelectorAll('.clockout-inline-cancel').forEach(btn => {
    btn.addEventListener('click', () => {
      clockoutExpandedIdx = null;
      renderAttendanceList();
    });
  });
}

/* ── カード内退店記録処理 ────────────────────────────────── */
async function handleInlineClockOut(idx, clockOutTime) {
  if (isSubmitting) return;
  const record = todayAttendance[idx];
  if (!record) return;

  const date    = record.date || todayStr();
  const staffId = record.id;

  isSubmitting = true;

  // ボタンを一時的に無効化
  const submitBtn = document.querySelector(`.clockout-inline-submit[data-idx="${idx}"]`);
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '...'; }

  try {
    const result = await callGAS('clockOut', {
      staffId,
      clockOutTime,
      date,
      rowIndex: record.rowIndex ?? null,
    });
    if (result.status !== 'ok') throw new Error(result.message || '登録エラー');

    record.clockOut = clockOutTime;
    record.isActive = false;
    saveAttendance(todayAttendance);

    clockoutExpandedIdx = null;
    renderAttendanceList();
    showToast(`${record.name}さんの退店を記録しました ✓`, 'success');

  } catch (e) {
    showToast('退店記録に失敗しました：' + e.message, 'error');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '記録する'; }
  } finally {
    isSubmitting = false;
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

/* ══════════════════════════════════════════════════════════
   iPad 入店記録パネル
   ══════════════════════════════════════════════════════════ */

let _ipadCiSelectedStaff = null; // { id, name, attendIdx } — 選択中スタッフ

document.addEventListener('DOMContentLoaded', () => {
  if (!document.body.classList.contains('is-ipad')) return;
  initIpadClockInPanel();
});

function initIpadClockInPanel() {
  // 時刻セレクト初期化
  _ipadCiInitSelects();

  // タブ切り替え
  document.querySelectorAll('[data-ci-tab]').forEach(btn => {
    btn.addEventListener('click', () => _ipadCiSwitchTab(btn.dataset.ciTab));
  });

  // 入店記録ボタン
  document.getElementById('ipad-ci-submit-in')?.addEventListener('click', _ipadCiSubmitIn);

  // 退店記録ボタン
  document.getElementById('ipad-ci-submit-out')?.addEventListener('click', _ipadCiSubmitOut);

  // スタッフカード描画（今日の勤怠は既にtodayAttendanceに入っている）
  renderIpadStaffCards();
}

function _ipadCiInitSelects() {
  const hourOpts = _TIME_HOURS.map(v => `<option value="${v}">${v}</option>`).join('');
  const minOpts  = _TIME_MINS.map(v  => `<option value="${v}">${v}</option>`).join('');
  const blankOpt = `<option value="">--</option>`;

  ['ipad-ci-in-h', 'ipad-co-out-h'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = hourOpts;
  });
  ['ipad-ci-in-m', 'ipad-co-out-m'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = minOpts;
  });
  // 退店（入店タブ内）はオプション
  const outH = document.getElementById('ipad-ci-out-h');
  const outM = document.getElementById('ipad-ci-out-m');
  if (outH) outH.innerHTML = blankOpt + hourOpts;
  if (outM) outM.innerHTML = blankOpt + minOpts;
}

function _ipadCiGetTimeVal(hId, mId) {
  const h = document.getElementById(hId)?.value;
  const m = document.getElementById(mId)?.value;
  if (!h || !m) return '';
  return `${h}:${m}`;
}

function _ipadCiSetTimeVal(hId, mId, hhMM) {
  if (!hhMM) {
    const hEl = document.getElementById(hId);
    const mEl = document.getElementById(mId);
    if (hEl) hEl.value = '';
    if (mEl) mEl.value = '';
    return;
  }
  const [h, m] = hhMM.split(':');
  const hEl = document.getElementById(hId);
  const mEl = document.getElementById(mId);
  if (hEl) hEl.value = h;
  if (mEl) mEl.value = m;
}

function renderIpadStaffCards() {
  const container = document.getElementById('ipad-staff-cards');
  if (!container) return;

  const master = getStaffMaster();
  if (master.length === 0) {
    container.innerHTML = `<p class="ipad-list-empty">設定からスタッフを登録してください</p>`;
    return;
  }

  container.innerHTML = master.map(s => {
    const attend = todayAttendance.find(a => String(a.id) === String(s.id));
    const isActive  = attend && (!attend.clockOut);
    const isOut     = attend && attend.clockOut;
    const statusLabel = isActive ? '在店中' : (isOut ? '退店済' : '未入店');
    const badgeClass  = isActive ? 'ipad-staff-card__badge--active' : 'ipad-staff-card__badge--inactive';
    const cardClass   = isActive ? 'ipad-staff-card ipad-staff-card--active' : 'ipad-staff-card ipad-staff-card--inactive';
    const timeInfo    = isActive ? `入店 ${parseTimeStr(attend.clockIn) || '—'}` :
                        isOut    ? `入店 ${parseTimeStr(attend.clockIn) || '—'} / 退店 ${parseTimeStr(attend.clockOut)}` : '';

    return `
      <div class="${cardClass}"
           data-staff-id="${escHtml(String(s.id))}"
           data-staff-name="${escHtml(s.name)}"
           role="button"
           tabindex="0"
           aria-label="${escHtml(s.name)}">
        <div class="ipad-staff-card__name">${escHtml(s.name)}</div>
        <span class="ipad-staff-card__badge ${badgeClass}">${statusLabel}</span>
        ${timeInfo ? `<div class="ipad-staff-card__time">${escHtml(timeInfo)}</div>` : ''}
      </div>`;
  }).join('');

  container.querySelectorAll('[data-staff-id]').forEach(card => {
    card.addEventListener('click', () => {
      _ipadCiSelectCard(card.dataset.staffId, card.dataset.staffName);
    });
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') _ipadCiSelectCard(card.dataset.staffId, card.dataset.staffName);
    });
  });
}

function _ipadCiSelectCard(staffId, staffName) {
  _ipadCiSelectedStaff = { id: staffId, name: staffName };

  // カードハイライト
  document.querySelectorAll('#ipad-staff-cards [data-staff-id]').forEach(c => {
    const isSelected = c.dataset.staffId === staffId;
    c.classList.toggle('ipad-staff-card--selected', isSelected);
    if (isSelected) {
      // active/inactive クラスは維持しつつ selected を追加
    }
  });

  // 右パネル表示
  document.getElementById('ipad-ci-empty').style.display     = 'none';
  document.getElementById('ipad-ci-operation').style.display = '';

  // スタッフ名表示
  const header = document.getElementById('ipad-ci-staff-header');
  if (header) header.textContent = staffName;

  // 今日の勤怠状況を確認
  const attend = todayAttendance.find(a => String(a.id) === String(staffId));
  const isActive = attend && !attend.clockOut;

  // 入店タブのデフォルト時刻セット
  const ciDate = document.getElementById('ipad-ci-date');
  if (ciDate) ciDate.value = todayStr();
  _ipadCiSetTimeVal('ipad-ci-in-h', 'ipad-ci-in-m', nowHHMM());
  _ipadCiSetTimeVal('ipad-ci-out-h', 'ipad-ci-out-m', '');

  // 退店タブの表示制御
  const outTab = document.querySelector('[data-ci-tab="out"]');
  if (outTab) {
    outTab.disabled = !isActive;
    outTab.style.opacity = isActive ? '1' : '0.4';
  }

  // 退店タブ時刻セット（在店中なら現在時刻）
  if (isActive) {
    _ipadCiSetTimeVal('ipad-co-out-h', 'ipad-co-out-m', nowHHMM());
  }

  // 在店中なら退店タブをデフォルトに、それ以外は入店タブ
  _ipadCiSwitchTab(isActive ? 'out' : 'in');
}

function _ipadCiSwitchTab(tab) {
  document.querySelectorAll('[data-ci-tab]').forEach(btn => {
    btn.classList.toggle('ipad-tab--active', btn.dataset.ciTab === tab);
  });
  document.getElementById('ipad-ci-tab-in').style.display  = tab === 'in'  ? '' : 'none';
  document.getElementById('ipad-ci-tab-out').style.display = tab === 'out' ? '' : 'none';
}

async function _ipadCiSubmitIn() {
  if (isSubmitting || !_ipadCiSelectedStaff) return;

  const date     = document.getElementById('ipad-ci-date')?.value || todayStr();
  const clockIn  = _ipadCiGetTimeVal('ipad-ci-in-h', 'ipad-ci-in-m');
  const clockOut = _ipadCiGetTimeVal('ipad-ci-out-h', 'ipad-ci-out-m');

  if (!clockIn) { showToast('入店時刻を選択してください', 'error'); return; }

  const master  = getStaffMaster().find(s => String(s.id) === String(_ipadCiSelectedStaff.id));
  const staffId = master?.id ?? (_ipadCiSelectedStaff.id || Date.now());

  isSubmitting = true;
  const btn = document.getElementById('ipad-ci-submit-in');
  if (btn) { btn.disabled = true; btn.textContent = '登録中...'; }

  try {
    const result = await callGAS('clockIn', {
      staffId,
      staffName:    _ipadCiSelectedStaff.name,
      clockInTime:  clockIn,
      clockOutTime: clockOut || null,
      date,
      rowIndex:     null,
    });
    if (result.status !== 'ok') throw new Error(result.message || '登録エラー');

    const newRecord = {
      id: staffId, name: _ipadCiSelectedStaff.name,
      date, clockIn, clockOut: clockOut || null,
      isActive: !clockOut, rowIndex: result.rowIndex ?? null,
    };
    todayAttendance.unshift(newRecord);
    saveAttendance(todayAttendance);

    showToast(`${_ipadCiSelectedStaff.name}さんの入店を記録しました ✓`, 'success');
    renderAttendanceList();
    renderIpadStaffCards();
    _ipadCiSelectedStaff = null;
    document.getElementById('ipad-ci-empty').style.display     = '';
    document.getElementById('ipad-ci-operation').style.display = 'none';

  } catch (e) {
    showToast('登録に失敗しました：' + e.message, 'error');
  } finally {
    isSubmitting = false;
    if (btn) { btn.disabled = false; btn.textContent = '入店を記録する'; }
  }
}

async function _ipadCiSubmitOut() {
  if (isSubmitting || !_ipadCiSelectedStaff) return;

  const clockOut = _ipadCiGetTimeVal('ipad-co-out-h', 'ipad-co-out-m');
  if (!clockOut) { showToast('退店時刻を選択してください', 'error'); return; }

  const attend = todayAttendance.find(a => String(a.id) === String(_ipadCiSelectedStaff.id));
  if (!attend) { showToast('入店記録が見つかりません', 'error'); return; }

  isSubmitting = true;
  const btn = document.getElementById('ipad-ci-submit-out');
  if (btn) { btn.disabled = true; btn.textContent = '記録中...'; }

  try {
    const result = await callGAS('clockOut', {
      staffId:      attend.id,
      clockOutTime: clockOut,
      date:         attend.date || todayStr(),
      rowIndex:     attend.rowIndex ?? null,
    });
    if (result.status !== 'ok') throw new Error(result.message || '登録エラー');

    attend.clockOut = clockOut;
    attend.isActive = false;
    saveAttendance(todayAttendance);

    showToast(`${_ipadCiSelectedStaff.name}さんの退店を記録しました ✓`, 'success');
    renderAttendanceList();
    renderIpadStaffCards();
    _ipadCiSelectedStaff = null;
    document.getElementById('ipad-ci-empty').style.display     = '';
    document.getElementById('ipad-ci-operation').style.display = 'none';

  } catch (e) {
    showToast('退店記録に失敗しました：' + e.message, 'error');
  } finally {
    isSubmitting = false;
    if (btn) { btn.disabled = false; btn.textContent = '退店を記録する'; }
  }
}
