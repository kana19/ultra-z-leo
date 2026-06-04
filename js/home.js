/**
 * ウルトラZAIMUくん LEO版 PWA — home.js
 * ホーム画面ロジック
 */

'use strict';

/* ── ストレージキー（clockin.js と共有） ─────────────────── */
const ATTENDANCE_DATE_KEY = 'uz_attendance_date';
const ATTENDANCE_DATA_KEY = 'uz_attendance_data';

/* ── 状態 ────────────────────────────────────────────────── */
let todayAttendance = []; // { id, name, clockIn, clockOut, isActive, rowIndex }
let _userPickedHomeTab = false; // ユーザーが手動でホームタブを選んだか（true の間は自動判定で上書きしない）

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

/* ── カラータイマー状態判定 ──────────────────────────────── */
function _getTimerState(hasItem) {
  return window.uzTimer.stateAR(hasItem);
}

/* カラータイマークラスをドット要素に付与する
   ボタン本体ではなく、ボタン内の dot 要素にクラスを当てる。
   消灯時（state=null）はクラスなし=ダークグレー縁のみ。
   history.js buildTimerDotHTML と同じ表現を採用。 */
function _applyTimerClass(dotEl, state) {
  window.uzTimer.apply(dotEl, state);
}

/* ── アラートドット描画（補助） ─────────────────────────── */
function createAlertDot(urgent) {
  const dot = document.createElement('span');
  dot.className = urgent ? 'adot adot--red-blink' : 'adot adot--blue';
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

function renderAlerts(alerts) {
  const { hasUncollected, hasPayable, hasUnrecordedClockOut,
          uncollectedItems, payableItems } = alerts;
  const now = new Date();
  /* 各項目の月末を期限に最緊急状態を代表表示（期限超過＋未処理は点滅を維持）。
     項目配列がない場合は従来の当月末判定にフォールバック。 */
  const stateU = uncollectedItems ? window.uzTimer.mostUrgentAR(uncollectedItems, now)
                                  : _getTimerState(hasUncollected);
  const stateP = payableItems ? window.uzTimer.mostUrgentAR(payableItems, now)
                              : _getTimerState(hasPayable);
  /* カラータイマーはボタン内のドット要素（id=dot-uncollected/dot-payable）に当てる */
  _applyTimerClass(document.getElementById('dot-uncollected'), stateU);
  _applyTimerClass(document.getElementById('dot-payable'),     stateP);
  const clockDot = document.getElementById('dot-clockout');
  if (clockDot) {
    clockDot.innerHTML = '';
    if (hasUnrecordedClockOut) {
      clockDot.appendChild(createAlertDot(true));
      clockDot.setAttribute('title', '退勤未記録（24時間経過）');
    }
  }
}

/* ── 勤怠リスト描画 ──────────────────────────────────────── */
function renderStaffList() {
  const container = document.getElementById('staff-list');
  if (!container) return;

  // 業態テンプレートのUI用語を取得（出勤中/入店中・退勤/退店等）
  const labels = (typeof deriveUILabels === 'function') ? deriveUILabels() : {
    clockin_active: '出勤中',
    clockout_label: '退勤',
    attendance_empty: '本日の出勤記録がありません',
  };

  if (todayAttendance.length === 0) {
    container.innerHTML = `
      <div class="staff-item">
        <span class="staff-marker staff-marker--off">☆</span>
        <div class="staff-info">
          <div class="staff-name" style="color:var(--uz-muted)">${escapeHtml(labels.attendance_empty || '本日の出勤記録がありません')}</div>
        </div>
      </div>`;
    return;
  }

  // 日付ごとにグループ化（同一日は日付見出しを1回だけ・各行に重複表示しない・§3）
  const groups = _groupAttendanceByDate(todayAttendance.slice(0, 12));
  container.innerHTML = groups.map(g => {
    const head = `<div class="hist-date-header" style="margin:0;">${g.label}</div>`;
    return head + g.items.map(_homeAttendRowHTML).join('');
  }).join('');
}

/* ホーム出勤状況の1行（名前｜出勤｜→｜退勤｜0.0h｜カラータイマー）。スマホ・iPad共有。 */
function _homeAttendRowHTML(s) {
  const ci = escapeHtml(s.clockIn || '—');
  if (s.isActive) {
    const dot = window.uzTimer.dotHTML(window.uzTimer.stateWork(window.uzTimer.workedMin(s.clockInDate || todayStr(), s.clockIn, new Date()), false), 'home');
    return `<div class="home-attend-row">
      <span class="ha-name">${escapeHtml(s.name)}</span>
      <span class="ha-in">${ci}</span>
      <span class="ha-arrow">→</span>
      <span class="ha-out">—</span>
      <span class="ha-dur"></span>
      <span class="ha-dot">${dot}</span>
    </div>`;
  }
  const co  = escapeHtml(s.clockOut || '—');
  const dur = _calcDurH(s.clockIn, s.clockOut);
  return `<div class="home-attend-row">
    <span class="ha-name ha-name--off">${escapeHtml(s.name)}</span>
    <span class="ha-in">${ci}</span>
    <span class="ha-arrow">→</span>
    <span class="ha-out">${co}</span>
    <span class="ha-dur">${dur}</span>
    <span class="ha-dot">${window.uzTimer.dotHTML('gray', 'home')}</span>
  </div>`;
}

/* 退店時刻−入店時刻の勤務時間を "X.XXh" で返す（日跨ぎは+24h補正）。 */
function _calcDurH(inStr, outStr) {
  if (!inStr || !outStr) return '';
  const [ih, im] = String(inStr).split(':').map(Number);
  const [oh, om] = String(outStr).split(':').map(Number);
  if ([ih, im, oh, om].some(Number.isNaN)) return '';
  let mins = (oh * 60 + om) - (ih * 60 + im);
  if (mins < 0) mins += 1440;
  return (mins / 60).toFixed(2) + 'h';
}

/* 出勤状況を入店日でグループ化（日付降順・各日内は出勤中→入店時刻降順）。
   出勤中（未退勤）は前日以前でも表示対象。各日の見出しは1回だけ出す。 */
function _groupAttendanceByDate(records) {
  const sorted = [...records].sort((a, b) => {
    const d = String(b.clockInDate || '').localeCompare(String(a.clockInDate || ''));
    if (d !== 0) return d;
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return String(b.clockIn || '').localeCompare(String(a.clockIn || ''));
  });
  const W = ['日','月','火','水','木','金','土'];
  const groups = [];
  let cur = null;
  for (const s of sorted) {
    const dt = s.clockInDate || todayStr();
    if (!cur || cur.date !== dt) {
      const [y, m, d] = dt.split('-').map(Number);
      const dow = (y && m && d) ? W[new Date(y, m - 1, d).getDay()] : '';
      cur = { date: dt, label: `${m}月${d}日(${dow})`, items: [] };
      groups.push(cur);
    }
    cur.items.push(s);
  }
  return groups;
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
        id:          r.staffId,
        name:        r.staffName,
        clockInDate: r.clockInDate || todayStr(),
        clockIn:     r.clockIn,
        clockOut:    r.clockOut || null,
        isActive:    r.isActive,
        rowIndex:    r.rowIndex ?? null,
      }));

      // localStorageを最新データで更新（clockin.jsと共有）
      localStorage.setItem(ATTENDANCE_DATE_KEY, todayStr());
      localStorage.setItem(ATTENDANCE_DATA_KEY, JSON.stringify(todayAttendance));

      renderStaffList();
      _autoSwitchTab(); // 出勤データ取得後に自動タブ判定（スマホ・§3）
      // iPad：右カラムの出勤状況を再描画し、出勤中がいれば出勤状況タブを既定表示（§2-2/§3）
      if (document.body.classList.contains('is-ipad')) {
        _renderIpadAttendance();
        switchIpadRightTab(todayAttendance.some(s => s.isActive) ? 'attend' : 'recent', true);
      }

      // 退店未記録フラグをアラートに反映（他フラグは既描画のまま更新）
      if (hasUnrecordedClockOut) {
        const clockDot = document.getElementById('dot-clockout');
        if (clockDot && !clockDot.hasChildNodes()) {
          clockDot.appendChild(createAlertDot(true));
          clockDot.setAttribute('title', '退勤未記録（24時間経過）');
        }
      }
    }
  } catch {
    // GAS失敗時はlocalStorageの描画をそのまま維持
  }
}

/* ── GAS から未収・買掛フラグを取得してカラータイマー更新 ─ */
async function loadAlerts() {
  renderAlerts({ hasUncollected: false, hasPayable: false, hasUnrecordedClockOut: false });
  try {
    const res = await callGAS('getUncollected', {});
    if (res && res.status === 'ok' && Array.isArray(res.data)) {
      const uncollectedItems = res.data.filter(r => r.type === 'uncollected');
      const payableItems     = res.data.filter(r => r.type === 'payable');
      renderAlerts({
        hasUncollected: uncollectedItems.length > 0,
        hasPayable:     payableItems.length > 0,
        uncollectedItems, payableItems,
        hasUnrecordedClockOut: false
      });
    }
  } catch { /* GAS失敗時はタイマーなし */ }
}

/* ── 損益サマリー描画 ────────────────────────────────────── */

/* 科目別内訳（アコーディオン開閉時に参照・データ層 uzFetchBreakdown が供給） */
let _plBreakdown = { sales: [], cogs: [], sga: [] };

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

/* 科目別内訳をデータ層から取得して保持（集計の正本は app.js uzFetchBreakdown） */
async function _loadBreakdown(month) {
  _plBreakdown = await uzFetchBreakdown(month);
}

/* アコーディオン開閉は app.js 共通 togglePlAccordion を使用（内訳は _plBreakdown を参照） */

async function loadPL() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const monthStr = `${year}-${month}`;

  try {
    const [summary] = await Promise.all([
      uzFetchSummary(monthStr),
      _loadBreakdown(monthStr),   /* 内訳を並行取得（データ層） */
    ]);
    if (summary) {
      _renderPLValues(summary);
    } else {
      _renderPLError();
    }
  } catch {
    _renderPLError();
  }
}

/* ── 退勤処理（ホーム画面から） ──────────────────────────── */
async function handleClockOut(staffId) {
  const record = todayAttendance.find(s => s.id === staffId);
  if (!record) return;

  if (!confirm(`${record.name}さんを退勤記録しますか？`)) return;

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
    showToast(`${record.name}さんの退勤を記録しました`, 'success');

  } catch (e) {
    showToast('退勤記録に失敗しました：' + e.message, 'error');
  }
}

/* ── XSSエスケープ ───────────────────────────────────────── */
function escapeHtml(str) {
  return uzEscHtml(str);
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

  // タブ初期表示（損益）
  switchHomeTab('pl', true);

  // localStorageで即時描画 → GASで上書き
  renderStaffFromLocalStorage();
  loadAttendance();
  loadAlerts();
  loadPL();

  if (document.body.classList.contains('is-ipad')) {
    initIpadHome();
  }
});

/* iPad ホーム右カラム：直近入力／出勤状況 タブ切替（§2-2）
 * auto=true はシステム自動判定（手動選択済みなら従う）・auto省略=ユーザー手動 */
let _userPickedIpadTab = false;
function switchIpadRightTab(which, auto) {
  const rec = document.getElementById('ipad-rt-panel-recent');
  const att = document.getElementById('ipad-rt-panel-attend');
  const tr  = document.getElementById('ipad-rt-tab-recent');
  const ta  = document.getElementById('ipad-rt-tab-attend');
  if (!rec || !att) return;
  if (auto && _userPickedIpadTab) return;
  if (!auto) _userPickedIpadTab = true;
  const showAttend = (which === 'attend');
  rec.style.display = showAttend ? 'none' : '';
  att.style.display = showAttend ? '' : 'none';
  tr?.classList.toggle('active', !showAttend);
  ta?.classList.toggle('active', showAttend);
}
window.switchIpadRightTab = switchIpadRightTab;

/* ── iPad ホームダッシュボード ────────────────────────────── */
async function initIpadHome() {
  if (!document.body.classList.contains('is-ipad')) return;
  const dashboard = document.getElementById('ipad-home-dashboard');
  if (!dashboard) return;

  const now          = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

  // 月選択プルダウン初期化
  _initMonthSelect(currentMonth);

  // 年度選択プルダウン初期化（年度累計タブ用）
  _initYearSelect(now.getFullYear());

  // 損益タブ初期状態（月次）
  _ipadPLTab = 'monthly';

  // 確定申告タイマー
  _renderIpadTaxTimer();

  // 税理士・銀行提出用CSV：プルダウンを常時表示で初期化
  const fromSel = document.getElementById('ipad-tax-from');
  const toSel   = document.getElementById('ipad-tax-to');
  if (fromSel && !fromSel.options.length) {
    const fromDefault = `${Math.max(now.getFullYear(), 2025)}-01`;
    buildMonthOptions(fromSel, fromDefault);
    buildMonthOptions(toSel,   currentMonth);
  }

  // 税理士用CSV DL実行ボタン
  document.getElementById('ipad-tax-dl-exec')?.addEventListener('click', () => {
    const from = document.getElementById('ipad-tax-from')?.value;
    const to   = document.getElementById('ipad-tax-to')?.value;
    downloadTaxCSVByRange(from, to, document.getElementById('ipad-tax-dl-exec'));
  });

  // 当月損益を表示
  const summary = await callGAS('getSummary', { month: currentMonth }).catch(() => null);
  if (summary && summary.status === 'ok' && summary.data) {
    _renderIpadPLRows(summary.data);
  }

  // 直近入力を右カラムに表示
  _renderIpadRecentEntries(currentMonth);

  // 月次損益グラフ（タブ連動：初期=月次損益→当月の日次推移）
  _renderIpadPLChart();

  // iPad出勤状況を左カラムに表示
  _renderIpadAttendance();
}

function _initMonthSelect(currentMonth) {
  const sel = document.getElementById('ipad-month-select');
  if (!sel) return;
  const now = new Date();
  for (let i = 0; i < 13; i++) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = `${d.getFullYear()}年${d.getMonth()+1}月`;
    sel.appendChild(opt);
  }
  sel.value = currentMonth;
  sel.addEventListener('change', async () => {
    const res = await callGAS('getSummary', { month: sel.value }).catch(() => null);
    if (res && res.status === 'ok' && res.data) _renderIpadPLRows(res.data);
    if (_ipadPLTab === 'monthly') _renderIpadPLChart();
  });
}

/* ── 年度累計タブ ──────────────────────────────────────────
 * pl.js の aggregateYear / renderYTD と同一の暦年(1〜12月)集計を移植。
 * 当年は1〜当月まで、過去年は1〜12月を月別 getSummary で並行fetchして合算。
 */
let _ipadPLTab = 'monthly';
const _IPAD_MIN_YEAR = 2025;

function _initYearSelect(currentYear) {
  const sel = document.getElementById('ipad-year-select');
  if (!sel) return;
  const thisYear = new Date().getFullYear();
  for (let y = thisYear; y >= _IPAD_MIN_YEAR; y--) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = `${y}年（年度累計）`;
    sel.appendChild(opt);
  }
  sel.value = String(currentYear);
  sel.addEventListener('change', () => {
    _renderIpadYTD(Number(sel.value));
    if (_ipadPLTab === 'ytd') _renderIpadPLChart();
  });
}

/* 損益タブ切替（月次 / 年度累計） */
function switchIpadPLTab(tab) {
  _ipadPLTab = tab;
  const tMonthly = document.getElementById('ipad-pl-tab-monthly');
  const tYtd     = document.getElementById('ipad-pl-tab-ytd');
  const monthSel = document.getElementById('ipad-month-select');
  const yearSel  = document.getElementById('ipad-year-select');

  if (tMonthly) tMonthly.classList.toggle('active', tab === 'monthly');
  if (tYtd)     tYtd.classList.toggle('active',     tab === 'ytd');
  if (monthSel) monthSel.style.display = (tab === 'monthly') ? '' : 'none';
  if (yearSel)  yearSel.style.display  = (tab === 'ytd')     ? '' : 'none';

  if (tab === 'monthly') {
    const m = monthSel?.value;
    if (m) {
      callGAS('getSummary', { month: m }).catch(() => null).then(res => {
        if (res && res.status === 'ok' && res.data) _renderIpadPLRows(res.data);
      });
    }
  } else {
    _renderIpadYTD(Number(yearSel?.value) || new Date().getFullYear());
  }

  // グラフもタブ連動（月次損益＝日次／年度累計＝12ヶ月累計）
  _renderIpadPLChart();
}

/* 年度累計を集計して①損益テーブルに描画 */
async function _renderIpadYTD(year) {
  const now      = new Date();
  const thisYear = now.getFullYear();
  const maxMonth = (year === thisYear) ? (now.getMonth() + 1) : 12;

  const monthKeys = [];
  for (let mm = 1; mm <= maxMonth; mm++) {
    monthKeys.push(`${year}-${String(mm).padStart(2, '0')}`);
  }

  const results = await Promise.all(
    monthKeys.map(k => callGAS('getSummary', { month: k }).catch(() => null))
  );

  let sales = 0, cogs = 0, sga = 0;
  results.forEach(r => {
    if (!r || r.status !== 'ok' || !r.data) return;
    const d = r.data;
    sales += d.sales ?? 0;
    cogs  += d.cogs  ?? 0;
    sga   += d.sga   ?? 0;
  });

  const gross  = sales - cogs;
  const profit = gross - sga;
  _renderIpadPLRows({ sales, cogs, sga, grossProfit: gross, operatingProfit: profit });
}

function _renderIpadPLRows(d) {
  const sales  = d.sales           ?? 0;
  const cogs   = d.cogs            ?? 0;
  const sga    = d.sga             ?? 0;
  const gross  = d.grossProfit     ?? (sales - cogs);
  const profit = d.operatingProfit ?? (gross - sga);

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = formatYen(v); };
  set('ipad-pl-sales',  sales);
  set('ipad-pl-cogs',   cogs);
  set('ipad-pl-gross',  gross);
  set('ipad-pl-sga',    sga);
  set('ipad-pl-profit', profit);

  const profEl = document.getElementById('ipad-pl-profit');
  if (profEl) profEl.style.color = '';
}

function _renderIpadTaxTimer() {
  const el = document.getElementById('ipad-tax-timer-right');
  if (!el) return;
  const now = new Date();
  const m   = now.getMonth() + 1;
  const d   = now.getDate();
  const inPeriod = (m === 2 && d >= 16) || (m === 3 && d <= 15);
  if (!inPeriod) { el.style.display = 'none'; return; }
  const deadline = new Date(now.getFullYear(), 2, 15);
  const diffDays = Math.max(0, Math.ceil((deadline - now) / 86400000));
  el.className   = diffDays <= 3 ? 'tax-timer-red' : 'tax-timer-blue';
  el.textContent = diffDays <= 3
    ? `確定申告期限まであと ${diffDays}日！（3/15締切）`
    : `確定申告受付中　あと ${diffDays}日（3/15締切）`;
  el.style.display = 'block';
}

/* ── iPad 直近入力テーブル ──────────────────────────── */
/* 直近入力の行データ正規化（登録順＝updatedAt・新規/編集判定・→ 02_画面仕様.md §2-2） */
function _recentItem(r) {
  const type    = r.type === 'cost' ? 'cost' : 'sales';
  const created = Number(r.createdAt) || 0;
  const updated = Number(r.updatedAt) || 0;
  const sortKey = updated || created || 0;
  const edited  = !!(created && updated && (updated - created > 60000));
  const regDate = updated ? new Date(updated) : (created ? new Date(created) : null);
  const regMd   = regDate ? `${String(regDate.getMonth() + 1).padStart(2, '0')}/${String(regDate.getDate()).padStart(2, '0')}` : '—';
  const occMd   = String(r.date || '').replace(/(\d{4})-(\d{2})-(\d{2})/, '$2/$3');
  const name    = type === 'sales' ? (r.itemName || r.serviceName || '売上') : (r.itemName || 'コスト');
  const divLbl  = type === 'sales' ? '売上' : (String(r.divisionCode) === '1' ? '仕入' : '販管費');
  return {
    type, sortKey, date: String(r.date || ''), regMd, occMd, name,
    memo: r.memo || '', amount: (r.amount ?? r.taxIncluded ?? 0), edited,
    opBadge:  `<span class="recent-op recent-op--${edited ? 'edit' : 'new'}">${edited ? '編集' : '新規'}</span>`,
    divBadge: `<span class="recent-div recent-div--${type}">${divLbl}</span>`,
    amtCls:   type === 'sales' ? 'recent-sales' : 'recent-cost',
  };
}

async function _renderIpadRecentEntries(month) {
  const tbody = document.getElementById('ipad-recent-body');
  const empty = document.getElementById('ipad-recent-empty');
  if (!tbody) return;

  try {
    const res  = await callGAS('getRecentEntries', { limit: 15 }).catch(() => null);
    const data = (res && res.status === 'ok' && Array.isArray(res.data)) ? res.data : [];
    const items = data.map(_recentItem);

    // 登録順（最後に登録・編集した順）の新しい順（→ §2-2・先月発生分も登録が新しければ表示）
    items.sort((a, b) => (b.sortKey - a.sortKey) || b.date.localeCompare(a.date));
    const top = items.slice(0, 15);

    if (top.length === 0) {
      tbody.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    tbody.innerHTML = top.map(it => `<tr>
        <td class="ipad-rc-reg">${it.regMd}</td>
        <td>${it.opBadge}</td>
        <td class="ipad-rc-occ">${it.occMd}</td>
        <td>${it.divBadge}</td>
        <td class="ipad-rc-item">${escapeHtml(it.name).substring(0, 12)}</td>
        <td class="ipad-rc-memo">${escapeHtml(it.memo).substring(0, 16)}</td>
        <td class="${it.amtCls} ipad-td-r">${formatYen(it.amount)}</td>
      </tr>`).join('');
  } catch {
    tbody.innerHTML = '';
    if (empty) empty.hidden = false;
  }
}

/* ── iPad 出勤状況（ダッシュボード右カラム） ──────── */
async function _renderIpadAttendance() {
  const container = document.getElementById('ipad-staff-list');
  if (!container) return;

  if (todayAttendance.length === 0) {
    container.innerHTML = '<div style="padding:14px;font-size:13px;color:var(--uz-text2);">本日の出勤記録がありません</div>';
    return;
  }

  const groups = _groupAttendanceByDate(todayAttendance.slice(0, 12));
  container.innerHTML = groups.map(g => {
    const head = `<div class="hist-date-header" style="margin:0;padding:8px 14px 4px;">${g.label}</div>`;
    return head + g.items.map(_homeAttendRowHTML).join('');
  }).join('');
}

/* ── iPad 月次損益グラフ ────────────────────────────── */
let _ipadChart = null;

/* y軸目盛りの万円表記 */
function _yenTick(v) {
  const abs = Math.abs(v);
  if (abs >= 10000) return (v < 0 ? '-' : '') + Math.round(abs / 10000) + '万';
  return v;
}
/* 累計マーカー用のコンパクト金額（5.8万／-1.2万／0） */
function _yenShort(v) {
  const abs = Math.abs(v);
  if (abs >= 10000) return (v < 0 ? '-' : '') + (Math.round(abs / 1000) / 10) + '万';
  return String(Math.round(v));
}

/* チャート見出し・凡例をモード別に差し替える */
function _setChartHeader(title, legendHTML) {
  const t  = document.querySelector('.ipad-dash-section--chart .ipad-dash-header__title');
  const lg = document.querySelector('.ipad-dash-section--chart .ipad-chart-legend');
  if (t)  t.textContent  = title;
  if (lg) lg.innerHTML   = legendHTML;
}

/* タブ連動ディスパッチャ：月次損益＝日次／年度累計＝12ヶ月累計 */
function _renderIpadPLChart() {
  if (_ipadPLTab === 'ytd') {
    const y = Number(document.getElementById('ipad-year-select')?.value) || new Date().getFullYear();
    _renderYearlyCumulativeChart(y);
  } else {
    const now = new Date();
    const m = document.getElementById('ipad-month-select')?.value
      || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    _renderDailyChart(m);
  }
}

/* 月次損益タブ：選択月の「日次推移」。売上＝折れ線／仕入原価・販管費＝積み上げ棒。
   表（単月損益）とグラフ（その月の日次）の集計単位を一致させる（→ 経営の見える化）。 */
async function _renderDailyChart(month) {
  const canvas  = document.getElementById('ipad-pl-chart');
  const loading = document.getElementById('ipad-chart-loading');
  if (!canvas || typeof Chart === 'undefined') return;
  if (loading) loading.style.display = '';

  const [y, m] = String(month).split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();

  const res = await callGAS('getHistory', { month }).catch(() => null);
  if (loading) loading.style.display = 'none';

  const sales = Array(daysInMonth).fill(0);
  const cogs  = Array(daysInMonth).fill(0);
  const sga   = Array(daysInMonth).fill(0);
  if (res && res.status === 'ok' && Array.isArray(res.data)) {
    res.data.forEach(r => {
      const d = parseInt(String(r.date).slice(8, 10), 10);
      if (!(d >= 1 && d <= daysInMonth)) return;
      const amt = Number(r.amount) || 0;
      if (r.type === 'sales') sales[d - 1] += amt;
      else if (r.type === 'cost') {
        if (String(r.divisionCode) === '1') cogs[d - 1] += amt;
        else                                 sga[d - 1]  += amt;
      }
    });
  }
  const labels = Array.from({ length: daysInMonth }, (_, i) => String(i + 1));

  _setChartHeader(`日次推移（${m}月）`,
    `<span class="ipad-legend-item"><i class="ipad-legend-dot" data-c="profit"></i>売上</span>` +
    `<span class="ipad-legend-item"><i class="ipad-legend-dot" data-c="cogs"></i>仕入原価</span>` +
    `<span class="ipad-legend-item"><i class="ipad-legend-dot" data-c="sga"></i>販管費</span>`);

  if (_ipadChart) { _ipadChart.destroy(); _ipadChart = null; }
  const _cs = getComputedStyle(document.documentElement);
  const _cMuted = _cs.getPropertyValue('--uz-text2').trim() || '#666666';
  const _cGrid  = _cs.getPropertyValue('--uz-border').trim() || 'rgba(0,0,0,0.10)';

  _ipadChart = new Chart(canvas, {
    data: {
      labels,
      datasets: [
        { type: 'bar',  label: '仕入原価', data: cogs, backgroundColor: '#C9CDD2', borderWidth: 0, stack: 'cost', order: 3 },
        { type: 'bar',  label: '販管費',   data: sga,  backgroundColor: '#8A929B', borderWidth: 0, stack: 'cost', order: 3 },
        { type: 'line', label: '売上',     data: sales, stack: 'sales',
          borderColor: '#4A90D9', backgroundColor: '#4A90D9', borderWidth: 2,
          pointRadius: 2, pointHoverRadius: 4, tension: 0.3, fill: false, order: 1 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatYen(ctx.parsed.y)}` } },
      },
      scales: {
        x: { stacked: true, ticks: { color: _cMuted, font: { size: 9 }, autoSkip: false, maxRotation: 0 }, grid: { color: _cGrid } },
        y: { stacked: true, beginAtZero: true, ticks: { color: _cMuted, font: { size: 10 }, callback: _yenTick }, grid: { color: _cGrid } },
      },
    },
  });
}

/* 年度累計タブ：12ヶ月の積み上げ棒（仕入原価・販管費・経常利益）に
   経常利益の累積折れ線を重ね、各マーカーに累計額を記載する（→ YTDは累積カーブが世界標準）。 */
async function _renderYearlyCumulativeChart(year) {
  const canvas  = document.getElementById('ipad-pl-chart');
  const loading = document.getElementById('ipad-chart-loading');
  if (!canvas || typeof Chart === 'undefined') return;
  if (loading) loading.style.display = '';

  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) => {
      const m = String(i + 1).padStart(2, '0');
      return callGAS('getSummary', { month: `${year}-${m}` }).catch(() => null);
    })
  );
  if (loading) loading.style.display = 'none';

  const labels   = results.map((_, i) => `${i + 1}月`);
  const cogsData = results.map(r => (r && r.status === 'ok' && r.data) ? (r.data.cogs ?? 0) : 0);
  const sgaData  = results.map(r => (r && r.status === 'ok' && r.data) ? (r.data.sga  ?? 0) : 0);
  const profitData = results.map(r => {
    if (!r || r.status !== 'ok' || !r.data) return 0;
    const d = r.data;
    return d.operatingProfit ?? ((d.sales ?? 0) - (d.cogs ?? 0) - (d.sga ?? 0));
  });
  // 経常利益の累積
  let run = 0;
  const cumProfit = profitData.map(p => (run += p));
  // データのある最終月（累計ラベルはここまで描く）
  let lastIdx = -1;
  results.forEach((r, i) => { if (r && r.status === 'ok' && r.data &&
    ((r.data.sales ?? 0) || (r.data.cogs ?? 0) || (r.data.sga ?? 0))) lastIdx = i; });

  _setChartHeader('年度累計推移',
    `<span class="ipad-legend-item"><i class="ipad-legend-dot" data-c="cogs"></i>仕入原価</span>` +
    `<span class="ipad-legend-item"><i class="ipad-legend-dot" data-c="sga"></i>販管費</span>` +
    `<span class="ipad-legend-item"><i class="ipad-legend-dot" data-c="profit"></i>経常利益</span>` +
    `<span class="ipad-legend-item"><i style="display:inline-block;width:12px;height:0;border-top:2px solid #2C3E50;vertical-align:middle;margin-right:3px;"></i>累計</span>`);

  if (_ipadChart) { _ipadChart.destroy(); _ipadChart = null; }
  const _cs = getComputedStyle(document.documentElement);
  const _cMuted = _cs.getPropertyValue('--uz-text2').trim() || '#666666';
  const _cGrid  = _cs.getPropertyValue('--uz-border').trim() || 'rgba(0,0,0,0.10)';
  const _cText  = _cs.getPropertyValue('--uz-text').trim()  || '#1a1a1a';

  // 累計マーカーに数字を描くプラグイン（経常利益累計の系列のみ・データのある月まで）
  const cumLabel = {
    id: 'cumLabel',
    afterDatasetsDraw(chart) {
      const idx = chart.data.datasets.findIndex(d => d.label === '経常利益（累計）');
      if (idx < 0 || lastIdx < 0) return;
      const meta = chart.getDatasetMeta(idx);
      const ctx  = chart.ctx;
      ctx.save();
      ctx.font = 'bold 10px sans-serif';
      ctx.fillStyle = _cText;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      meta.data.forEach((pt, i) => {
        if (i > lastIdx) return;
        ctx.fillText(_yenShort(cumProfit[i]), pt.x, pt.y - 5);
      });
      ctx.restore();
    },
  };

  _ipadChart = new Chart(canvas, {
    data: {
      labels,
      datasets: [
        { type: 'bar',  label: '仕入原価', data: cogsData,   backgroundColor: '#C9CDD2', borderWidth: 0, stack: 's', order: 3 },
        { type: 'bar',  label: '販管費',   data: sgaData,    backgroundColor: '#8A929B', borderWidth: 0, stack: 's', order: 3 },
        { type: 'bar',  label: '経常利益', data: profitData, backgroundColor: '#4A90D9', borderWidth: 0, stack: 's',
          order: 3, borderRadius: { topLeft: 3, topRight: 3 } },
        { type: 'line', label: '経常利益（累計）', data: cumProfit, stack: 'cum',
          borderColor: '#2C3E50', backgroundColor: '#2C3E50', borderWidth: 2,
          pointRadius: 3, pointHoverRadius: 5, tension: 0.25, fill: false, order: 1 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 16 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatYen(ctx.parsed.y)}` } },
      },
      scales: {
        x: { stacked: true, ticks: { color: _cMuted, font: { size: 10 } }, grid: { color: _cGrid } },
        y: { stacked: true, ticks: { color: _cMuted, font: { size: 10 }, callback: _yenTick }, grid: { color: _cGrid } },
      },
    },
    plugins: [cumLabel],
  });
}

function _ipadToggleTaxDLPanel() {
  const panel   = document.getElementById('ipad-tax-dl-panel');
  const fromSel = document.getElementById('ipad-tax-from');
  const toSel   = document.getElementById('ipad-tax-to');
  if (!panel) return;

  if (panel.hidden) {
    // 初回表示時にプルダウンを生成
    if (!fromSel?.options.length) {
      const now      = new Date();
      const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const fromDefault = `${Math.max(now.getFullYear(), 2025)}-01`;
      buildMonthOptions(fromSel, fromDefault);
      buildMonthOptions(toSel,   curMonth);
    }
    panel.hidden = false;
  } else {
    panel.hidden = true;
  }
}

function _ipadCopyPL() {
  const rows = [
    ['売上',     document.getElementById('ipad-pl-sales')?.textContent   || '—'],
    ['仕入原価', document.getElementById('ipad-pl-cogs')?.textContent    || '—'],
    ['粗利',     document.getElementById('ipad-pl-gross')?.textContent   || '—'],
    ['販管費',   document.getElementById('ipad-pl-sga')?.textContent     || '—'],
    ['経常利益', document.getElementById('ipad-pl-profit')?.textContent  || '—'],
  ];
  const text = rows.map(r => `${r[0]}\t${r[1]}`).join('\n');
  navigator.clipboard?.writeText(text)
    .then(() => showToast('損益データをコピーしました', 'success'))
    .catch(() => showToast('コピーに失敗しました', 'error'));
}

async function loadSidebarRecent() {
  const container = document.getElementById('sidebar-recent');
  if (!container) return;

  try {
    const res  = await callGAS('getRecentEntries', { limit: 8 }).catch(() => null);
    const data = (res && res.status === 'ok' && Array.isArray(res.data)) ? res.data : [];
    const items = data.map(_recentItem);

    // 登録順（最後に登録・編集した順）の新しい順（→ §2-2・先月発生分も登録が新しければ表示）
    items.sort((a, b) => (b.sortKey - a.sortKey) || b.date.localeCompare(a.date));
    const top = items.slice(0, 8);

    if (top.length === 0) {
      container.innerHTML = '<div class="sidebar-recent__title">記録なし</div>';
      return;
    }

    container.innerHTML = `<div class="sidebar-recent__title">最近の入力</div>`
      + top.map(it => {
          const color = it.type === 'sales' ? 'var(--uz-gold)' : 'var(--uz-red)';
          return `<div class="sidebar-recent__item">
            <span class="sidebar-recent__item-name">${it.regMd} ${it.opBadge} ${escapeHtml(it.name).substring(0, 10)}</span>
            <span class="sidebar-recent__item-amt" style="color:${color}">${formatYen(it.amount)}</span>
          </div>`;
        }).join('');
  } catch {
    container.innerHTML = '';
  }
}

/* ── ホームタブ切替 ──────────────────────────────────────── */

/**
 * タブ切替
 * tab: 'pl' | 'attendance'
 * auto: true=自動判定（強制上書きしない）
 */
function switchHomeTab(tab, auto) {
  const tabPl   = document.getElementById('tab-pl');
  const tabAtt  = document.getElementById('tab-attendance');
  const panelPl = document.getElementById('panel-pl');
  const panelAt = document.getElementById('panel-attendance');
  if (!tabPl || !tabAtt || !panelPl || !panelAt) return;

  // 自動判定はユーザーが手動選択済みのときのみ従う（システム既定 'pl' は上書き可）
  if (auto && _userPickedHomeTab) return;
  if (!auto) _userPickedHomeTab = true;

  if (tab === 'pl') {
    tabPl.classList.add('active');
    tabAtt.classList.remove('active');
    panelPl.style.display = '';
    panelAt.style.display = 'none';
  } else {
    tabAtt.classList.add('active');
    tabPl.classList.remove('active');
    panelAt.style.display = '';
    panelPl.style.display = 'none';
  }
}

/**
 * 出勤データ取得後に自動タブ判定
 * 仕様（02_画面仕様.md §3）：
 *   1名以上出勤中 → 出勤状況タブをデフォルト表示
 *   出勤中ゼロ   → 損益タブをデフォルト表示
 */
function _autoSwitchTab() {
  const hasActive = todayAttendance.some(s => s.isActive);
  switchHomeTab(hasActive ? 'attendance' : 'pl', true);
}

/**
 * 出勤バナー通知
 * msg: 「〇〇さんが出勤しました」等
 */
function showAttendanceBanner(msg) {
  const el = document.getElementById('home-attendance-banner');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 4000);
}
