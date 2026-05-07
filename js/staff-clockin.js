/**
 * clockin.js — スタッフ専用タイムカードPWA
 * 仕様: 02_画面仕様.md §4 (B方式)
 *
 * - GAS_URL は index.html / app.js と共通の定数（同一リポジトリ内で統一）
 * - staffId は URL パラメータ staff=s001 から取得
 * - 財務データへのアクセスは一切行わない
 */

// ─── 設定 ────────────────────────────────────────────────────
// GAS_URL: 既存の app.js と同一のものを使用する
// ビルド時に index.html の GAS_URL と同期させること（コピペ統一）
const GAS_URL = (() => {
  // index.html から読み込まれる app.js の GAS_URL を共用できないため
  // clockin.html は単独動作。既存 app.js の GAS_URL をここにコピーする。
  // ↓ この行だけ、既存 app.js の GAS_URL と同じ値に書き換えること ↓
  return 'https://script.google.com/macros/s/AKfycbwBDHj9-p6ZT6ExXrxF1Q-XwiEkNMPwDc0aAuk7zptivRhWhepvaCDsjaIJd7WHh_h9-A/exec';
})();

const WD = ['日','月','火','水','木','金','土'];

// ─── 状態 ────────────────────────────────────────────────────
let state = {
  staffId:     '',
  staffName:   '',
  storeName:   '',
  templateId:  'general-shop',
  myRecord:    null,   // { rowIndex, date, clockIn, clockOut, isActive }
  todayList:   [],
  myMonthly:   [],
  isPunching:  false,
};

// ─── UI ラベル（業態テンプレート対応）──────────────────────
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
  // {status, data} ラッパー形式
  if (json && json.status === 'ok') return json.data ?? json;
  throw new Error(json?.message || 'GAS エラー');
}

// ─── 初期化 ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  startClock();

  // URL パラメータから staffId 取得
  const params  = new URLSearchParams(location.search);
  const staffId = params.get('staff') || '';

  if (!staffId) {
    showError('URLが正しくありません', 'staff=スタッフIDパラメータが必要です。\nオーナーから共有されたURLを使用してください。');
    return;
  }

  state.staffId = staffId;

  try {
    // validateStaff：staffId の有効性確認
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

    // 出勤データ取得
    await loadAttendanceData();

  } catch (e) {
    showError('接続エラー', '通信に失敗しました。\nWi-Fiや電波状況を確認してください。\n\n' + e.message);
  }
});

// ─── ラベル適用 ──────────────────────────────────────────────
function applyLabels() {
  const el = id => document.getElementById(id);
  el('ui-label-in').textContent   = getLabel('in');
  el('punch-label').textContent   = getLabel('in');
  el('section-today-title').textContent = getLabel('today');
  el('status-text').textContent   = getLabel('inactive');
}

// ─── ヘッダー ────────────────────────────────────────────────
function renderHeader() {
  document.getElementById('header-store').textContent = state.storeName || 'ULTRA ZAIMU';
  document.getElementById('header-name').textContent  = state.staffName;
}

// ─── 時計 ────────────────────────────────────────────────────
function startClock() {
  function tick() {
    const now = new Date();
    const hh  = String(now.getHours()).padStart(2, '0');
    const mm  = String(now.getMinutes()).padStart(2, '0');
    document.getElementById('header-time').textContent = `${hh}:${mm}`;
    const dateEl = document.getElementById('header-date');
    if (dateEl) {
      const mo = now.getMonth() + 1;
      const da = now.getDate();
      const wd = WD[now.getDay()];
      dateEl.textContent = `${mo}/${da}（${wd}）`;
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
  renderPunchBtn();
  renderTodayList();
  renderMonthly();
}

// ─── 描画：打刻ボタン ────────────────────────────────────────
function renderPunchBtn() {
  const rec    = state.myRecord;
  const btn    = document.getElementById('punch-btn');
  const badge  = document.getElementById('status-badge');
  const sText  = document.getElementById('status-text');
  const ciDisp = document.getElementById('clockin-time-display');
  const ciVal  = document.getElementById('ci-time-val');
  const hint   = document.getElementById('punch-hint');
  const icon   = document.getElementById('punch-icon');
  const label  = document.getElementById('punch-label');

  if (rec && rec.isActive) {
    // 出勤中 → 退勤ボタン
    badge.className  = 'status-badge active';
    sText.textContent = getLabel('active');
    ciDisp.style.display = '';
    ciVal.textContent = rec.clockIn || '--:--';
    btn.className    = 'punch-btn clockout-btn';
    icon.textContent = '🔴';
    label.textContent = getLabel('out');
    hint.textContent = 'タップして' + getLabel('out') + 'を記録';

  } else if (rec && !rec.isActive) {
    // 退勤済み
    badge.className  = 'status-badge inactive';
    sText.textContent = '退勤済み';
    ciDisp.style.display = '';
    ciVal.textContent = rec.clockIn || '--:--';
    btn.className    = 'punch-btn disabled-btn';
    icon.textContent = '✅';
    label.textContent = '完了';
    hint.textContent = rec.clockIn + ' 〜 ' + (rec.clockOut || '--:--');

  } else {
    // 未出勤
    badge.className  = 'status-badge inactive';
    sText.textContent = getLabel('inactive');
    ciDisp.style.display = 'none';
    btn.className    = 'punch-btn clockin-btn';
    icon.textContent = '🟢';
    label.textContent = getLabel('in');
    hint.textContent = 'タップして' + getLabel('in') + 'を記録';
  }
}

// ─── 描画：今日の在店状況 ─────────────────────────────────────
function renderTodayList() {
  const card = document.getElementById('today-card');
  if (!state.todayList.length) {
    card.innerHTML = `<div class="today-empty">まだ誰も${getLabel('in')}していません</div>`;
    return;
  }
  card.innerHTML = state.todayList.map(s => {
    const self     = s.isSelf ? 'self-row' : '';
    const activeC  = s.isActive ? 'active-row' : '';
    const initials = (s.staffName || '？').charAt(0);
    const tagText  = s.isActive ? getLabel('active') : getLabel('inactive');
    const tagClass = s.isActive ? 'in' : 'out';
    const selfNote = s.isSelf ? `<div class="self-label">あなた</div>` : '';
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
    const d    = new Date(r.date + 'T00:00:00');
    const da   = d.getDate();
    const wd   = WD[d.getDay()];
    const dur  = r.workMinutes ? fmtMin(r.workMinutes) : '';
    const coTxt = r.clockOut ? r.clockOut : (r.isActive ? `<span style="color:var(--green)">出勤中</span>` : '?');
    return `<div class="monthly-row">
      <div class="monthly-date-col">
        <div class="monthly-date-day">${da}</div>
        <div class="monthly-date-wd">${wd}</div>
      </div>
      <div class="monthly-times">
        <div class="monthly-time-row">${r.clockIn || '--:--'}<span class="sep">〜</span>${coTxt}</div>
        ${r.isActive ? '<div class="monthly-time-active">● 出勤中</div>' : ''}
      </div>
      <div class="monthly-duration">${dur}</div>
    </div>`;
  }).join('');
}

// ─── 打刻タップ ──────────────────────────────────────────────
async function onPunchTap() {
  if (state.isPunching) return;
  const rec = state.myRecord;

  // 退勤済みは無効
  if (rec && !rec.isActive) return;

  state.isPunching = true;
  const btn = document.getElementById('punch-btn');
  btn.classList.add('punching');

  const now  = new Date();
  const hh   = String(now.getHours()).padStart(2, '0');
  const mm   = String(now.getMinutes()).padStart(2, '0');
  const time = `${hh}:${mm}`;
  const date = todayStr();

  try {
    if (!rec) {
      // 出勤打刻
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
        rowIndex:  result.rowIndex || 0,
        date:      date,
        clockIn:   time,
        clockOut:  null,
        isActive:  true,
      };
      showBanner(`${getLabel('in')}しました（${time}）`);

    } else {
      // 退勤打刻
      await callGAS('clockOut', {
        staffId:      state.staffId,
        rowIndex:     rec.rowIndex,
        clockOutTime: time,
      });
      state.myRecord = { ...rec, clockOut: time, isActive: false };
      showBanner(`${getLabel('out')}しました（${time}）`);
    }

    // 最新データを取得して todayList / myMonthly を更新
    await loadAttendanceData();

  } catch (e) {
    showBanner('⚠️ 通信エラー。もう一度試してください。');
    console.error(e);
  } finally {
    setTimeout(() => {
      btn.classList.remove('punching');
      state.isPunching = false;
    }, 500);
  }
}

// ─── バナー通知 ──────────────────────────────────────────────
function showBanner(msg) {
  const el = document.getElementById('banner');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

// ─── ユーティリティ ──────────────────────────────────────────
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da= String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

function fmtMin(min) {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}分`;
  return `${h}h${m > 0 ? m + 'm' : ''}`;
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
