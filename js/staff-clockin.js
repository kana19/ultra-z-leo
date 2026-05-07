/**
 * staff-clockin.js v2 — スタッフ専用タイムカードPWA
 * v2追加: 時刻調整機能（デフォルト現在時刻ワンタップ・時刻変更モード）
 */

// ─── 設定 ────────────────────────────────────────────────────
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwBDHj9-p6ZT6ExXrxF1Q-XwiEkNMPwDc0aAuk7zptivRhWhepvaCDsjaIJd7WHh_h9-A/exec';
const WD = ['日','月','火','水','木','金','土'];

// ─── 状態 ────────────────────────────────────────────────────
let state = {
  staffId:        '',
  staffName:      '',
  storeName:      '',
  templateId:     'general-shop',
  myRecord:       null,
  todayList:      [],
  myMonthly:      [],
  isPunching:     false,
  isEditingTime:  false,   // 時刻編集モード
  editHour:       0,
  editMin:        0,
};

// ─── UI ラベル ────────────────────────────────────────────────
const UI_LABELS = {
  'hostess-shop': { in: '入店', out: '退店', today: '今日の入店状況', active: '入店中', inactive: '未入店' },
  'general-shop': { in: '出勤', out: '退勤', today: '今日の出勤状況', active: '出勤中', inactive: '未出勤' },
};
function getLabel(key) {
  const t = UI_LABELS[state.templateId] || UI_LABELS['general-shop'];
  return t[key] || '';
}

// ─── GAS 呼び出し ────────────────────────────────────────────
async function callGAS(action, data = {}) {
  const payload = JSON.stringify(data);
  const url = `${GAS_URL}?action=${encodeURIComponent(action)}&data=${encodeURIComponent(payload)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  if (json && json.status === 'ok') return json.data ?? json;
  throw new Error(json?.message || 'GAS エラー');
}

// ─── 初期化 ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  startClock();
  const params  = new URLSearchParams(location.search);
  const staffId = params.get('staff') || '';
  if (!staffId) {
    showError('URLが正しくありません', 'staff=スタッフIDパラメータが必要です。\nオーナーから共有されたURLを使用してください。');
    return;
  }
  state.staffId = staffId;
  try {
    const vResult = await callGAS('validateStaff', { staffId });
    if (!vResult || !vResult.valid) {
      showError('スタッフが見つかりません', `スタッフID「${staffId}」は登録されていません。\nオーナーに確認してください。`);
      return;
    }
    state.staffName  = vResult.staffName;
    state.storeName  = vResult.storeName;
    state.templateId = vResult.templateId || 'general-shop';
    applyLabels();
    renderHeader();
    hideLoading();
    await loadAttendanceData();
  } catch (e) {
    showError('接続エラー', '通信に失敗しました。\nWi-Fiや電波状況を確認してください。\n\n' + e.message);
  }
});

// ─── ラベル適用 ──────────────────────────────────────────────
function applyLabels() {
  document.getElementById('section-today-title').textContent = getLabel('today');
}

// ─── ヘッダー ────────────────────────────────────────────────
function renderHeader() {
  document.getElementById('header-store').textContent = state.storeName || 'ULTRA ZAIMU';
  document.getElementById('header-name').textContent  = state.staffName;
}

// ─── 時計（ヘッダー & 打刻エリア同期）───────────────────────
function startClock() {
  function tick() {
    const now = new Date();
    const hh  = String(now.getHours()).padStart(2, '0');
    const mm  = String(now.getMinutes()).padStart(2, '0');
    const timeStr = `${hh}:${mm}`;
    // ヘッダー時計
    const htEl = document.getElementById('header-time');
    if (htEl) htEl.textContent = timeStr;
    const hdEl = document.getElementById('header-date');
    if (hdEl) {
      const mo = now.getMonth() + 1;
      const da = now.getDate();
      const wd = WD[now.getDay()];
      hdEl.textContent = `${mo}/${da}（${wd}）`;
    }
    // 打刻エリアの現在時刻表示（編集モード中は更新しない）
    if (!state.isEditingTime) {
      const ptEl = document.getElementById('punch-current-time');
      if (ptEl) ptEl.textContent = timeStr;
    }
  }
  tick();
  setInterval(tick, 10000);
}

// ─── 出勤データ取得 ──────────────────────────────────────────
async function loadAttendanceData() {
  const today = todayStr();
  const month = today.substring(0, 7);
  const result = await callGAS('getAttendanceForStaff', { staffId: state.staffId, month });
  state.myRecord  = result.myRecord  || null;
  state.todayList = result.todayList || [];
  state.myMonthly = result.myMonthly || [];
  renderAll();
}

// ─── 描画：全体 ──────────────────────────────────────────────
function renderAll() {
  renderPunchArea();
  renderTodayList();
  renderMonthly();
}

// ─── 描画：打刻エリア ────────────────────────────────────────
function renderPunchArea() {
  const rec      = state.myRecord;
  const area     = document.getElementById('punch-area');
  const isDone   = rec && !rec.isActive;
  const isActive = rec && rec.isActive;

  // 退勤済みは完了表示のみ
  if (isDone) {
    area.innerHTML = `
      <div class="status-badge inactive" style="margin-bottom:12px">
        <span class="status-dot"></span><span>退勤済み</span>
      </div>
      <div class="done-display">
        <div class="done-icon">✅</div>
        <div class="done-times">${rec.clockIn} 〜 ${rec.clockOut || '--:--'}</div>
        <div class="done-label">本日の勤務記録完了</div>
      </div>`;
    return;
  }

  // 出勤中 or 未出勤
  const badgeClass = isActive ? 'active' : 'inactive';
  const badgeText  = isActive ? getLabel('active') : getLabel('inactive');
  const btnClass   = isActive ? 'clockout-btn' : 'clockin-btn';
  const btnLabel   = isActive ? getLabel('out') : getLabel('in');
  const btnIcon    = isActive ? '🔴' : '🟢';
  const ciInfo     = isActive
    ? `<div class="ci-info">${getLabel('in')}：<span class="ci-time">${rec.clockIn}</span></div>`
    : '';

  area.innerHTML = `
    <div class="status-badge ${badgeClass}">
      <span class="status-dot"></span><span>${badgeText}</span>
    </div>
    ${ciInfo}

    <!-- 現在時刻大表示 -->
    <div class="current-time-display" id="current-time-block">
      <div class="current-time-big" id="punch-current-time">--:--</div>
      <div class="current-time-label">現在時刻</div>
    </div>

    <!-- 打刻ボタン -->
    <button class="punch-btn ${btnClass}" id="punch-btn" onclick="onPunchTap()">
      <span class="punch-btn-icon">${btnIcon}</span>
      <span class="punch-btn-label">${btnLabel}</span>
    </button>

    <!-- 時刻変更ボタン -->
    <button class="time-edit-trigger" id="time-edit-trigger" onclick="openTimeEdit()">
      🕐 時刻を変更して${btnLabel}
    </button>

    <!-- 時刻編集パネル（初期非表示）-->
    <div class="time-edit-panel" id="time-edit-panel" style="display:none">
      <div class="time-edit-title">時刻を入力</div>
      <div class="time-spinner-row">
        <div class="time-spinner-col">
          <button class="spin-btn" onclick="adjustTime('h',1)">▲</button>
          <div class="spin-val" id="edit-hh">00</div>
          <button class="spin-btn" onclick="adjustTime('h',-1)">▼</button>
        </div>
        <div class="time-colon">:</div>
        <div class="time-spinner-col">
          <button class="spin-btn" onclick="adjustTime('m',15)">▲</button>
          <div class="spin-val" id="edit-mm">00</div>
          <button class="spin-btn" onclick="adjustTime('m',-15)">▼</button>
        </div>
      </div>
      <div class="time-edit-hint">▲▼は時間±1・分±15分</div>
      <div class="time-edit-actions">
        <button class="time-cancel-btn" onclick="closeTimeEdit()">キャンセル</button>
        <button class="time-confirm-btn" id="time-confirm-btn" onclick="onPunchWithEditedTime()">
          この時刻で${btnLabel}
        </button>
      </div>
    </div>`;

  // 時計を再同期
  const now = new Date();
  const el  = document.getElementById('punch-current-time');
  if (el) el.textContent = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}

// ─── 時刻編集モード ──────────────────────────────────────────
function openTimeEdit() {
  const now = new Date();
  state.editHour      = now.getHours();
  state.editMin       = Math.floor(now.getMinutes() / 5) * 5; // 5分単位に丸め
  state.isEditingTime = true;
  document.getElementById('time-edit-panel').style.display = '';
  document.getElementById('time-edit-trigger').style.display = 'none';
  document.getElementById('current-time-block').style.display = 'none';
  document.getElementById('punch-btn').style.display = 'none';
  updateSpinner();
}

function closeTimeEdit() {
  state.isEditingTime = false;
  document.getElementById('time-edit-panel').style.display = 'none';
  document.getElementById('time-edit-trigger').style.display = '';
  document.getElementById('current-time-block').style.display = '';
  document.getElementById('punch-btn').style.display = '';
}

function adjustTime(unit, delta) {
  if (unit === 'h') {
    state.editHour = (state.editHour + delta + 24) % 24;
  } else {
    state.editMin = (state.editMin + delta + 60) % 60;
  }
  updateSpinner();
}

function updateSpinner() {
  document.getElementById('edit-hh').textContent = String(state.editHour).padStart(2, '0');
  document.getElementById('edit-mm').textContent = String(state.editMin).padStart(2, '0');
}

function getEditedTime() {
  return `${String(state.editHour).padStart(2,'0')}:${String(state.editMin).padStart(2,'0')}`;
}

// ─── 打刻タップ（現在時刻）────────────────────────────────────
async function onPunchTap() {
  if (state.isPunching) return;
  const now  = new Date();
  const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  await executePunch(time);
}

// ─── 打刻タップ（編集時刻）──────────────────────────────────
async function onPunchWithEditedTime() {
  if (state.isPunching) return;
  closeTimeEdit();
  await executePunch(getEditedTime());
}

// ─── 打刻実行（共通）────────────────────────────────────────
async function executePunch(time) {
  if (state.isPunching) return;
  state.isPunching = true;
  const btn = document.getElementById('punch-btn');
  if (btn) btn.classList.add('punching');
  const rec  = state.myRecord;
  const date = todayStr();
  try {
    if (!rec) {
      // 出勤
      const settings = await callGAS('getSettings', {});
      const staff = (settings.staffList || []).find(s => s.id === state.staffId) || {};
      const result = await callGAS('clockIn', {
        staffId:        state.staffId,
        staffName:      state.staffName,
        employmentType: staff.employmentType || 'employed_full',
        date:           date,
        clockInTime:    time,
      });
      state.myRecord = {
        rowIndex: result.rowIndex || 0,
        date:     date,
        clockIn:  time,
        clockOut: null,
        isActive: true,
      };
      showBanner(`${getLabel('in')}しました（${time}）`);
    } else {
      // 退勤
      await callGAS('clockOut', {
        staffId:      state.staffId,
        rowIndex:     rec.rowIndex,
        clockOutTime: time,
      });
      state.myRecord = { ...rec, clockOut: time, isActive: false };
      showBanner(`${getLabel('out')}しました（${time}）`);
    }
    await loadAttendanceData();
  } catch (e) {
    showBanner('⚠️ 通信エラー。もう一度試してください。');
    console.error(e);
  } finally {
    setTimeout(() => {
      const b = document.getElementById('punch-btn');
      if (b) b.classList.remove('punching');
      state.isPunching = false;
    }, 500);
  }
}

// ─── 描画：今日の在店状況 ────────────────────────────────────
function renderTodayList() {
  const card = document.getElementById('today-card');
  if (!state.todayList.length) {
    card.innerHTML = `<div class="today-empty">まだ誰も${getLabel('in')}していません</div>`;
    return;
  }
  card.innerHTML = state.todayList.map(s => {
    const self    = s.isSelf ? 'self-row' : '';
    const activeC = s.isActive ? 'active-row' : '';
    const initials= (s.staffName || '？').charAt(0);
    const tagText = s.isActive ? getLabel('active') : getLabel('inactive');
    const tagClass= s.isActive ? 'in' : 'out';
    const selfNote= s.isSelf ? `<div class="self-label">あなた</div>` : '';
    return `<div class="staff-row ${self} ${activeC}">
      <div class="staff-avatar">${initials}</div>
      <div class="staff-info">
        <div class="staff-name-text">${esc(s.staffName)}</div>
        ${selfNote}
      </div>
      <div class="staff-status-tag ${tagClass}">${tagText}</div>
    </div>`;
  }).join('');
}

// ─── 描画：当月勤怠 ──────────────────────────────────────────
function renderMonthly() {
  const list  = document.getElementById('monthly-list');
  const count = document.getElementById('monthly-count');
  const today = todayStr();
  const month = today.substring(0, 7);
  const mo    = parseInt(month.split('-')[1], 10);
  document.getElementById('monthly-title-text').textContent = `${mo}月の記録`;
  count.textContent = `${state.myMonthly.length}日`;
  if (!state.myMonthly.length) {
    list.innerHTML = '<div class="monthly-empty">記録がありません</div>';
    return;
  }
  list.innerHTML = state.myMonthly.map(r => {
    const d   = new Date(r.date + 'T00:00:00');
    const da  = d.getDate();
    const wd  = WD[d.getDay()];
    const dur = r.workMinutes ? fmtMin(r.workMinutes) : '';
    const coTxt = r.clockOut
      ? r.clockOut
      : (r.isActive ? `<span style="color:var(--green)">${getLabel('active')}</span>` : '?');
    return `<div class="monthly-row">
      <div class="monthly-date-col">
        <div class="monthly-date-day">${da}</div>
        <div class="monthly-date-wd">${wd}</div>
      </div>
      <div class="monthly-times">
        <div class="monthly-time-row">${r.clockIn || '--:--'}<span class="sep">〜</span>${coTxt}</div>
        ${r.isActive ? `<div class="monthly-time-active">● ${getLabel('active')}</div>` : ''}
      </div>
      <div class="monthly-duration">${dur}</div>
    </div>`;
  }).join('');
}

// ─── バナー通知 ──────────────────────────────────────────────
function showBanner(msg) {
  const el = document.getElementById('banner');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3500);
}

// ─── ユーティリティ ──────────────────────────────────────────
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtMin(min) {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h === 0 ? `${m}分` : `${h}h${m > 0 ? m+'m' : ''}`;
}
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function hideLoading() {
  const el = document.getElementById('loading-screen');
  el.classList.add('hidden');
  setTimeout(() => el.style.display = 'none', 400);
  document.getElementById('main-screen').classList.add('show');
}
function showError(title, msg) {
  const el = document.getElementById('loading-screen');
  el.classList.add('hidden');
  setTimeout(() => el.style.display = 'none', 400);
  document.getElementById('error-title').textContent = title;
  document.getElementById('error-msg').textContent   = msg;
  document.getElementById('error-screen').classList.add('show');
}
