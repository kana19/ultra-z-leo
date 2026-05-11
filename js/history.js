/**
 * ウルトラZAIMUくん LEO版 PWA — history.js
 * 履歴・修正画面ロジック
 *
 * タブ1：売上・コスト（getHistory）
 *   ※ GAS側で以下のフィールドを含めてください：
 *   { type, rowIndex, date, serviceCode?, divisionCode?, divisionName?, itemCode?,
 *     itemName, taxRate, amount(=taxIncluded), memo, uncollected?(売上) / unpaid?(コスト) }
 *
 * タブ2：入店履歴（getAttendanceByMonth）
 *   ※ GAS側で rowIndex を含めてください：
 *   { rowIndex, date, staffId, staffName, clockIn, clockOut }
 *
 * 業態テンプレート連動：
 *   動的生成するテキスト（ボタン・履歴行・トースト・モーダル等）は
 *   app.js の deriveUILabels() からラベルを取得して書き換える。
 */

'use strict';

/* ── 定数 ────────────────────────────────────────────────── */
const _now       = new Date();
const THIS_YEAR  = _now.getFullYear();
const THIS_MONTH = _now.getMonth() + 1;
const MIN_YEAR   = 2025;

/* ── 状態 ────────────────────────────────────────────────── */
let currentYear  = THIS_YEAR;
let currentMonth = THIS_MONTH;
let activeTab    = 'salescost';

// 修正フォーム用キャッシュ（renderのたびに再構築）
let editableItems = []; // 売上・コスト行
let attendItems   = []; // 入店履歴行

// 修正フォームの状態
let currentEditItem = null;
let isEditSaving    = false;

// 新規入店登録フォーム
let _ciStaffList = []; // localStorage から読み込み

/* ── 新規入店登録：時刻セレクト（0〜29h / 5分刻み） ─────── */
const _CI_HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const _CI_MINS  = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

function buildCITimeSelectHTML(idPrefix) {
  const blank = '<option value="">--</option>';
  const optsH = blank + _CI_HOURS.map(v => `<option value="${v}">${v}</option>`).join('');
  const optsM = blank + _CI_MINS.map(v  => `<option value="${v}">${v}</option>`).join('');
  return `<div style="display:flex;align-items:center;gap:6px;">` +
    `<select id="${idPrefix}-h" class="date-input" style="width:72px;">${optsH}</select>` +
    `<span style="color:var(--uz-text);font-weight:600;font-size:16px;">:</span>` +
    `<select id="${idPrefix}-m" class="date-input" style="width:72px;">${optsM}</select>` +
    `</div>`;
}

/** 退店時刻の「時」option HTMLを入店時刻基準で生成 */
function buildClockOutHourOptionsHTML(ciH) {
  const ciHInt = parseInt(ciH, 10);
  let html = '<option value="">--</option>';
  if (isNaN(ciHInt) || ciHInt === 0) {
    for (let h = 0; h <= 23; h++) {
      html += `<option value="${String(h).padStart(2, '0')}">${String(h).padStart(2, '0')}</option>`;
    }
    return html;
  }
  for (let h = ciHInt; h <= 23; h++) {
    html += `<option value="${String(h).padStart(2, '0')}">${String(h).padStart(2, '0')}</option>`;
  }
  html += '<option value="" disabled>── 翌日 ──</option>';
  for (let h = 0; h < ciHInt; h++) {
    html += `<option value="${String(h).padStart(2, '0')}">${String(h).padStart(2, '0')}</option>`;
  }
  return html;
}

/** 退店時刻の「時」セレクトを入店時刻基準で再生成（既存値保持） */
function _refreshClockOutHourSelect(ciHId, coHId) {
  const coHSel = document.getElementById(coHId);
  if (!coHSel) return;
  const prevValue = coHSel.value;
  const ciH = document.getElementById(ciHId)?.value || '';
  coHSel.innerHTML = buildClockOutHourOptionsHTML(ciH);
  if (prevValue && !isNaN(parseInt(prevValue, 10))) {
    const match = Array.from(coHSel.options).find(o => o.value === prevValue && !o.disabled);
    if (match) coHSel.value = prevValue;
  }
}

function _getStaffFromStorage() {
  try {
    const saved = localStorage.getItem('uz_staff_master');
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

/* ── 初期化 ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  bindTabs();
  bindNav();
  bindEditPanel();
  bindListClicks();
  bindFilterBtns();
  document.getElementById('ci-open-btn')?.addEventListener('click', openCIModal);
  if (location.hash === '#attendance') {
    switchTab('attendance');
  }
  loadAll();
  updateIpadApprovalBanner();
});

/* ── タブ切り替え ────────────────────────────────────────── */
function bindTabs() {
  document.getElementById('tab-salescost')?.addEventListener('click',  () => switchTab('salescost'));
  document.getElementById('tab-attendance')?.addEventListener('click', () => switchTab('attendance'));
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.hist-tab').forEach(btn => {
    const on = btn.id === `tab-${tab}`;
    btn.classList.toggle('hist-tab--active', on);
    btn.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('.hist-tab-content').forEach(panel => {
    panel.classList.toggle('hist-tab-content--active', panel.id === `panel-${tab}`);
  });
}

/* ── 月ナビゲーション ────────────────────────────────────── */
function bindNav() {
  document.getElementById('hist-prev')?.addEventListener('click', () => moveMonth(-1));
  document.getElementById('hist-next')?.addEventListener('click', () => moveMonth(+1));
}

function moveMonth(dir) {
  let m = currentMonth + dir;
  let y = currentYear;
  if (m < 1)  { y--; m = 12; }
  if (m > 12) { y++; m = 1;  }
  if (y < MIN_YEAR) return;
  if (y > THIS_YEAR || (y === THIS_YEAR && m > THIS_MONTH)) return;
  currentYear  = y;
  currentMonth = m;
  loadAll();
}

function updateNavUI() {
  const labelEl = document.getElementById('hist-label');
  if (labelEl) labelEl.textContent = `${currentYear}年${currentMonth}月`;
  const isMin = currentYear === MIN_YEAR  && currentMonth === 1;
  const isMax = currentYear === THIS_YEAR && currentMonth === THIS_MONTH;
  if (document.getElementById('hist-prev')) document.getElementById('hist-prev').disabled = isMin;
  if (document.getElementById('hist-next')) document.getElementById('hist-next').disabled = isMax;
}

/* ── GASからデータ取得 ───────────────────────────────────── */
async function loadAll() {
  updateNavUI();
  showLoading();
  editableItems = [];
  attendItems   = [];

  const monthParam = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

  try {
    const [histResult, attendResult] = await Promise.allSettled([
      callGAS('getHistory',           { month: monthParam }),
      callGAS('getAttendanceByMonth', { month: monthParam }),
    ]);

    if (histResult.status === 'fulfilled' &&
        histResult.value?.status === 'ok' &&
        Array.isArray(histResult.value.data)) {
      renderSalesCost(histResult.value.data);
    } else {
      renderSalesCostError();
    }

    if (attendResult.status === 'fulfilled' &&
        attendResult.value?.status === 'ok' &&
        Array.isArray(attendResult.value.data)) {
      renderAttendance(attendResult.value.data);
    } else {
      renderAttendanceError();
    }

  } catch (e) {
    renderSalesCostError();
    renderAttendanceError();
    showToast('GAS接続エラー：' + e.message, 'error');
  } finally {
    hideLoading();
  }
}

/* ══════════════════════════════════════════════════════════
   ロック判定
   ══════════════════════════════════════════════════════════ */

/**
 * 指定日付のロック状態を返す
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {{ locked:boolean, grace:boolean, daysLeft:number|null }}
 *
 * ロックルール:
 *   当月         → 自由に修正可（locked:false, grace:false）
 *   翌月1〜3日   → 猶予期間（locked:false, grace:true, daysLeft:残日数）
 *   翌月4日以降  → 完全ロック（locked:true）
 */
function getLockStatus(dateStr) {
  if (!dateStr) return { locked: true, grace: false, daysLeft: null };
  const [dy, dm] = dateStr.split('-').map(Number);
  const now = new Date();
  const ty  = now.getFullYear();
  const tm  = now.getMonth() + 1;
  const td  = now.getDate();

  // 当月
  if (dy === ty && dm === tm) return { locked: false, grace: false, daysLeft: null };

  // データ月の翌月を計算
  const ny = dm === 12 ? dy + 1 : dy;
  const nm = dm === 12 ? 1       : dm + 1;

  // 今日がデータ月の翌月1〜3日
  if (ty === ny && tm === nm && td <= 3) {
    return { locked: false, grace: true, daysLeft: 4 - td };
  }

  return { locked: true, grace: false, daysLeft: null };
}

/**
 * ロック状態に応じたボタン/バッジHTMLを返す
 * @param {object} ls  - getLockStatus()の戻り値
 * @param {number} idx - キャッシュ配列のインデックス
 * @param {string} scope - 'sc'（売上コスト）| 'at'（入店）
 */
function buildLockWidget(ls, idx, scope) {
  if (ls.locked) {
    return `<span class="hist-locked-badge">修正不可</span>`;
  }
  const btnClass = ls.grace ? 'hist-edit-btn hist-edit-btn--grace' : 'hist-edit-btn';
  return `<button class="${btnClass}" type="button" data-idx="${idx}" data-scope="${scope}">修正</button>`;
}

/* ── リストのクリック委譲（1回だけ登録） ────────────────── */
function bindListClicks() {
  document.getElementById('history-list')?.addEventListener('click', e => {
    // iPad：テーブル行クリック
    const row = e.target.closest('.ipad-hist-row[data-scope="sc"]');
    if (row) {
      const idx = parseInt(row.dataset.idx, 10);
      if (!isNaN(idx) && editableItems[idx]) {
        document.querySelectorAll('.ipad-hist-row--selected').forEach(r => r.classList.remove('ipad-hist-row--selected'));
        row.classList.add('ipad-hist-row--selected');
        renderIpadRightPanel(editableItems[idx]);
      }
      return;
    }

    // スマホ：修正ボタンクリック
    const btn = e.target.closest('.hist-edit-btn[data-scope="sc"]');
    if (!btn) return;
    const idx2 = parseInt(btn.dataset.idx, 10);
    if (!isNaN(idx2) && editableItems[idx2]) {
      if (document.body.classList.contains('is-ipad')) {
        renderIpadRightPanel(editableItems[idx2]);
      } else {
        openEditForm(editableItems[idx2]);
      }
    }
  });

  document.getElementById('attendance-list')?.addEventListener('click', e => {
    // iPad：テーブル行クリック
    const row = e.target.closest('.ipad-hist-row[data-scope="at"]');
    if (row) {
      const idx = parseInt(row.dataset.idx, 10);
      if (!isNaN(idx) && attendItems[idx]) {
        document.querySelectorAll('.ipad-hist-row--selected').forEach(r => r.classList.remove('ipad-hist-row--selected'));
        row.classList.add('ipad-hist-row--selected');
        renderIpadRightPanel(attendItems[idx]);
      }
      return;
    }

    const editBtn = e.target.closest('.hist-edit-btn[data-scope="at"]');
    if (editBtn) {
      const idx = parseInt(editBtn.dataset.idx, 10);
      if (!isNaN(idx) && attendItems[idx]) {
        if (document.body.classList.contains('is-ipad')) {
          renderIpadRightPanel(attendItems[idx]);
        } else {
          openEditForm(attendItems[idx]);
        }
      }
      return;
    }

    const coBtn = e.target.closest('.ci-clockout-btn');
    if (coBtn) {
      quickClockOut(
        parseInt(coBtn.dataset.rowIndex, 10),
        coBtn.dataset.staffId   || '',
        coBtn.dataset.staffName || ''
      );
    }
  });
}

/* ══════════════════════════════════════════════════════════
   タブ1：売上・コスト描画
   ══════════════════════════════════════════════════════════ */

/* ── フィルター状態 ──────────────────────────────────────── */
let _currentFilter   = 'all';
let _allSalesCostItems = [];

function bindFilterBtns() {
  document.querySelectorAll('.hist-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _currentFilter = btn.dataset.filter;
      document.querySelectorAll('.hist-filter-btn').forEach(b =>
        b.classList.toggle('hist-filter-btn--active', b.dataset.filter === _currentFilter)
      );
      _renderFilteredList();
    });
  });
}

function _renderFilteredList() {
  const container = document.getElementById('history-list');
  const totalEl   = document.getElementById('hist-filter-total');
  if (!container) return;

  editableItems = [];

  let filtered = _allSalesCostItems;
  if (_currentFilter === 'uncollected') {
    filtered = _allSalesCostItems.filter(r => r.type === 'sales' && Number(r.uncollected) === 1);
  } else if (_currentFilter === 'payable') {
    filtered = _allSalesCostItems.filter(r => r.type === 'cost' && Number(r.unpaid) === 1);
  }

  /* フィルター時の合計金額表示 */
  if (totalEl) {
    if (_currentFilter !== 'all' && filtered.length > 0) {
      const total = filtered.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      totalEl.textContent = `合計 ${formatYen(total)}`;
      totalEl.style.display = '';
    } else {
      totalEl.style.display = 'none';
    }
  }

  if (filtered.length === 0) {
    container.innerHTML = `<p style="text-align:center;padding:40px 20px;font-size:13px;color:var(--uz-text3);">該当するデータがありません</p>`;
    return;
  }

  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date));

  /* iPad：フラットテーブル表示 */
  if (document.body.classList.contains('is-ipad')) {
    let html = `<table class="ipad-hist-flat-table">
      <thead><tr>
        <th>日付</th><th>種別</th><th>内容</th><th>メモ</th><th class="ipad-td-r">金額</th><th>状態</th><th></th>
      </tr></thead><tbody>`;

    sorted.forEach(item => {
      const idx     = editableItems.push(item) - 1;
      const isSales = item.type === 'sales';
      const typeLabel = isSales
        ? '<span style="color:var(--uz-text2);font-size:12px;">売上</span>'
        : '<span style="color:var(--uz-text2);font-size:12px;">経費</span>';
      const md  = (item.date || '').replace(/(\d{4})-(\d{2})-(\d{2})/, '$2/$3');
      const ls  = getLockStatus(item.date);
      const status = ls.locked
        ? '<span style="font-size:11px;color:var(--uz-text3);">🔒</span>'
        : ls.grace
          ? `<span style="font-size:11px;color:var(--uz-danger);">残${ls.daysLeft}日</span>`
          : '<span style="font-size:11px;color:var(--uz-text2);">✓</span>';
      const dot = buildTimerDotHTML(item);
      const rowBg = isSales ? '' : 'background:var(--uz-surface);';

      html += `<tr class="ipad-hist-row" data-idx="${idx}" data-scope="sc" style="${rowBg}">
        <td style="white-space:nowrap;">${md}</td>
        <td>${typeLabel}</td>
        <td>${escHtml((item.itemName || '').substring(0, 16))}</td>
        <td style="font-size:12px;color:var(--uz-text3);">${escHtml((item.memo || '').substring(0, 12))}</td>
        <td class="ipad-td-r" style="font-weight:600;">${formatYen(item.amount)}</td>
        <td style="text-align:center;">${status}</td>
        <td style="text-align:center;">${dot}</td>
      </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
    return;
  }

  /* スマホ：行型表示 */
  const groups = {};
  sorted.forEach(item => {
    if (!groups[item.date]) groups[item.date] = [];
    groups[item.date].push(item);
  });

  let html = '';
  Object.keys(groups).forEach(date => {
    html += buildDateHeader(date);
    groups[date].forEach(item => {
      const idx = editableItems.push(item) - 1;
      html += buildSalesCostItemHTML(item, idx);
    });
  });

  container.innerHTML = html;
}

function renderSalesCost(items) {
  _allSalesCostItems = items || [];
  _currentFilter     = 'all';
  document.querySelectorAll('.hist-filter-btn').forEach(b =>
    b.classList.toggle('hist-filter-btn--active', b.dataset.filter === 'all')
  );
  const totalEl = document.getElementById('hist-filter-total');
  if (totalEl) totalEl.style.display = 'none';

  if (!_allSalesCostItems.length) {
    const container = document.getElementById('history-list');
    if (container) container.innerHTML = `<p style="text-align:center;padding:40px 20px;font-size:13px;color:var(--uz-text3);">この月の売上・コスト履歴はありません</p>`;
    return;
  }
  _renderFilteredList();
}

function renderSalesCostError() {
  const container = document.getElementById('history-list');
  if (container) container.innerHTML = `
    <p style="text-align:center;padding:40px 20px;font-size:13px;color:var(--uz-muted);">
      データの取得に失敗しました。<br>通信状態を確認してください。
    </p>`;
}

/* ── カラータイマードット（売掛・買掛） ──────────────────── */
function buildTimerDotHTML(item) {
  const hasFlag = item.type === 'sales'
    ? Number(item.uncollected) === 1
    : Number(item.unpaid)      === 1;
  if (!hasFlag) return '<span class="hist-row__timer"></span>';

  const now  = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  let bizDays = 0;
  const cur = new Date(now); cur.setHours(0,0,0,0);
  const end = new Date(last); end.setHours(0,0,0,0);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) bizDays++;
    cur.setDate(cur.getDate() + 1);
  }

  let cls = 'hist-timer-dot--blue';
  if (bizDays <= 1) cls = 'hist-timer-dot--blink';
  else if (bizDays <= 3) cls = 'hist-timer-dot--red';

  return `<span class="hist-row__timer"><span class="hist-timer-dot ${cls}"></span></span>`;
}

/* ── 日付ヘッダー ────────────────────────────────────────── */
function buildDateHeader(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const days = ['日','月','火','水','木','金','土'];
  const dow = new Date(y, m - 1, d).getDay();
  return `<div class="hist-date-header">${y}年${m}月${d}日（${days[dow]}）</div>`;
}

/* ── 売上・コスト行HTML（行型） ──────────────────────────── */
function buildSalesCostItemHTML(item, idx) {
  const isSales = item.type === 'sales';
  const ls      = getLockStatus(item.date);
  const widget  = buildLockWidget(ls, idx, 'sc');
  const dot     = buildTimerDotHTML(item);
  const rowCls  = isSales ? 'hist-row--sales' : 'hist-row--cost';
  const name    = escHtml((item.itemName || '').substring(0, 30));
  const memo    = item.memo ? `<div class="hist-row__memo">${escHtml((item.memo).substring(0, 20))}</div>` : '';

  return `
    <div class="hist-row ${rowCls}" data-idx="${idx}">
      <div class="hist-row__name">
        ${name}
        ${memo}
      </div>
      <span class="hist-row__amount">${formatYen(item.amount)}</span>
      <div class="hist-row__edit">${widget}</div>
      ${dot}
    </div>`;
}

/* ══════════════════════════════════════════════════════════
   タブ2：入店履歴描画
   ══════════════════════════════════════════════════════════ */

function renderAttendance(items) {
  const container = document.getElementById('attendance-list');
  if (!container) return;
  attendItems = [];

  const labels = deriveUILabels();

  if (items.length === 0) {
    container.innerHTML = `
      <p style="text-align:center;padding:40px 20px;font-size:13px;color:var(--uz-muted);">
        この月の${escHtml(labels.clockin_history)}はありません
      </p>`;
    return;
  }

  // iPad：フラットテーブル表示
  if (document.body.classList.contains('is-ipad')) {
    const allRecs = [...items].sort((a, b) => b.date.localeCompare(a.date));

    let html = `<table class="ipad-hist-flat-table">
      <thead><tr>
        <th>日付</th><th>スタッフ</th><th>${escHtml(labels.clockin_time)}</th><th>${escHtml(labels.clockout_time)}</th><th>勤務時間</th><th>状態</th>
      </tr></thead><tbody>`;

    allRecs.forEach(r => {
      const enriched = { ...r, type: 'attendance' };
      const atIdx = attendItems.push(enriched) - 1;

      const md = (r.date || '').replace(/(\d{4})-(\d{2})-(\d{2})/, '$2/$3');
      const clockIn  = parseTimeStr(r.clockIn)  || '—';
      const clockOut = parseTimeStr(r.clockOut) || '';
      const dur = clockOut ? calcWorkDuration(clockIn, clockOut) : null;
      const wMin = r.workMinutes || dur?.minutes;
      let durLabel = '—';
      if (wMin && !dur?.isAbnormal) {
        const wh = Math.floor(wMin / 60);
        const wm = wMin % 60;
        durLabel = wm > 0 ? `${wh}h${wm}m` : `${wh}h`;
      }

      const isActive = !clockOut;
      const statusBadge = isActive
        ? `<span style="color:var(--uz-green);font-size:12px;">${escHtml(labels.clockin_active)}</span>`
        : `<span style="font-size:12px;color:var(--uz-muted);">${escHtml(labels.clockout_done)}</span>`;

      html += `<tr class="ipad-hist-row" data-idx="${atIdx}" data-scope="at">
        <td style="white-space:nowrap;">${md}</td>
        <td>${escHtml((r.staffName || '不明').substring(0, 8))}</td>
        <td>${escHtml(clockIn)}</td>
        <td>${clockOut ? escHtml(clockOut) : '—'}</td>
        <td style="font-size:12px;color:var(--uz-muted);">${durLabel}</td>
        <td>${statusBadge}</td>
      </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
    return;
  }

  // スマホ：従来のスタッフカード表示
  const staffMap = {};
  items.forEach(item => {
    const name = item.staffName || '不明';
    if (!staffMap[name]) staffMap[name] = [];
    staffMap[name].push(item);
  });

  Object.values(staffMap).forEach(recs => recs.sort((a, b) => b.date.localeCompare(a.date)));

  const staffNames = Object.keys(staffMap).sort((a, b) =>
    staffMap[b][0].date.localeCompare(staffMap[a][0].date));

  let html = '';
  staffNames.forEach(name => {
    const recs      = staffMap[name];
    const hasActive = recs.some(r => !parseTimeStr(r.clockOut));

    html += `
      <div class="attend-staff-card">
        <div class="attend-staff-header">
          <span class="attendance-dot ${hasActive ? 'attendance-dot--active' : 'attendance-dot--out'}"
                aria-hidden="true"></span>
          <span class="attend-staff-name">${escHtml(name)}</span>
        </div>`;

    recs.forEach(r => {
      const enriched = { ...r, type: 'attendance' };
      const atIdx    = attendItems.push(enriched) - 1;

      const [y, m, d] = r.date.split(/[-\/]/).map(Number);
      const dow        = WEEKDAYS[new Date(y, m - 1, d).getDay()];
      const dateLabel  = `${m}/${d}（${dow}）`;
      const clockIn    = parseTimeStr(r.clockIn);
      const clockOut   = parseTimeStr(r.clockOut);

      const isOvernightFlag = r.is_overnight === true ||
        (clockOut ? calcWorkDuration(clockIn, clockOut)?.isOvernight : false);
      const dur = clockOut ? calcWorkDuration(clockIn, clockOut) : null;

      let timeStr;
      if (clockOut) {
        if (dur?.isAbnormal) {
          timeStr = `<span class="attend-time-abnormal">${escHtml(clockIn)} → ${escHtml(dur.clockOutDisplay)}</span>`;
        } else if (isOvernightFlag) {
          timeStr = `${escHtml(clockIn)} → <span class="attend-time-overnight">翌</span>${escHtml(clockOut)}`;
        } else {
          timeStr = `${escHtml(clockIn)} → ${escHtml(clockOut)}`;
        }
        const wMin = r.workMinutes || dur?.minutes;
        if (wMin && !dur?.isAbnormal) {
          const wh = Math.floor(wMin / 60);
          const wm = wMin % 60;
          const durLabel = wm > 0 ? `${wh}時間${wm}分` : `${wh}時間`;
          timeStr += ` <span style="font-size:11px;color:var(--uz-muted);">(${durLabel})</span>`;
        }
      } else {
        timeStr = `${escHtml(clockIn)} — ${escHtml(labels.clockout_unrecorded)}`;
      }

      const isActive   = !clockOut;
      const ls         = getLockStatus(r.date);
      const widget     = buildLockWidget(ls, atIdx, 'at');

      const clockoutBtn = (isActive && !ls.locked)
        ? `<button class="ci-clockout-btn"
                   type="button"
                   data-row-index="${enriched.rowIndex || ''}"
                   data-staff-id="${escHtml(String(enriched.staffId || ''))}"
                   data-staff-name="${escHtml(enriched.staffName || '')}"
                   aria-label="${escHtml(enriched.staffName || '')}の${escHtml(labels.clockout_action)}">
             ${escHtml(labels.clockout_action)}
           </button>`
        : '';

      html += `
        <div class="attend-record-row">
          <div class="attend-record-date">${dateLabel}</div>
          <div class="attend-record-times">${timeStr}</div>
          <span class="attend-status ${isActive ? 'attend-status--active' : 'attend-status--out'}">
            ${isActive ? escHtml(labels.clockin_active) : escHtml(labels.clockout_done)}
          </span>
          ${clockoutBtn}
          ${widget}
        </div>`;
    });

    html += `</div>`;
  });

  container.innerHTML = html;
}

function renderAttendanceError() {
  const container = document.getElementById('attendance-list');
  const labels = deriveUILabels();
  if (container) container.innerHTML = `
    <p style="text-align:center;padding:40px 20px;font-size:13px;color:var(--uz-muted);">
      ${escHtml(labels.clockin_history)}の取得に失敗しました。<br>通信状態を確認してください。
    </p>`;
}

/* ══════════════════════════════════════════════════════════
   修正フォーム
   ══════════════════════════════════════════════════════════ */

function bindEditPanel() {
  document.getElementById('edit-cancel-btn')?.addEventListener('click', closeEditForm);
  document.getElementById('edit-backdrop')?.addEventListener('click',   closeEditForm);
  document.getElementById('edit-save-btn')?.addEventListener('click',   saveEdit);
}

function openEditForm(item) {
  if (!item) return;

  // rowIndex チェック（GAS未更新の場合に案内）
  if (!item.rowIndex) {
    showToast(
      'rowIndex が取得できません。GAS の getHistory / getAttendanceByMonth に rowIndex を追加してください。',
      'error', 5000
    );
    return;
  }

  currentEditItem = item;

  const titleEl = document.getElementById('edit-panel-title');
  const bodyEl  = document.getElementById('edit-form-body');
  if (!titleEl || !bodyEl) return;

  if (item.type === 'sales') {
    titleEl.textContent = '売上を修正';
    bodyEl.innerHTML    = buildSalesFormHTML(item);
  } else if (item.type === 'cost') {
    titleEl.textContent = 'コストを修正';
    bodyEl.innerHTML    = buildCostFormHTML(item);
  } else {
    // attendance
    const labels = deriveUILabels();
    titleEl.textContent = `${labels.clockin_record}を修正`;
    bodyEl.innerHTML    = buildAttendanceFormHTML(item);
    // 退店時刻の時プルダウンを入店時刻基準で再生成
    _refreshClockOutHourSelect('ef-clockin-h', 'ef-clockout-h');
    document.getElementById('ef-clockin-h')?.addEventListener('change', () => {
      _refreshClockOutHourSelect('ef-clockin-h', 'ef-clockout-h');
    });
  }

  bindTaxCalc();

  document.getElementById('edit-backdrop')?.classList.add('edit-backdrop--show');
  document.getElementById('edit-panel')?.classList.add('edit-panel--open');
  document.getElementById('edit-save-btn').disabled = false;
  document.getElementById('edit-save-btn').textContent = '保存する';
}

function closeEditForm() {
  currentEditItem = null;
  document.getElementById('edit-backdrop')?.classList.remove('edit-backdrop--show');
  document.getElementById('edit-panel')?.classList.remove('edit-panel--open');
}

/* ── フォームHTML生成 ────────────────────────────────────── */

function taxToggleGroupHTML(taxRate) {
  return `<div class="tax-toggle-group" role="group" aria-label="税率">
    ${[0, 8, 10].map(r => `
      <button type="button"
              class="tax-toggle${r === taxRate ? ' tax-toggle--active' : ''}"
              data-rate="${r}">${r}%</button>
    `).join('')}
  </div>`;
}

function buildSalesFormHTML(item) {
  const rate = Number(item.taxRate) || 10;
  return `
    <div class="edit-field">
      <label class="edit-label">日付</label>
      <input type="date" id="ef-date" class="edit-input"
             value="${escHtml(item.date || '')}">
    </div>
    <div class="edit-field">
      <label class="edit-label">サービス名</label>
      <input type="text" id="ef-name" class="edit-input"
             value="${escHtml(item.itemName || '')}" maxlength="40">
    </div>
    <div class="edit-field">
      <label class="edit-label">税率</label>
      ${taxToggleGroupHTML(rate)}
    </div>
    <div class="edit-field">
      <label class="edit-label">税込金額</label>
      <input type="number" id="ef-amount" class="edit-input"
             value="${Number(item.amount) || 0}" inputmode="numeric" min="0">
      <div id="ef-tax-note" class="edit-tax-note"></div>
    </div>
    <div class="edit-field">
      <label class="edit-label">メモ</label>
      <input type="text" id="ef-memo" class="edit-input"
             value="${escHtml(item.memo || '')}" maxlength="100">
    </div>
    <div class="edit-field">
      <label class="edit-label">未収</label>
      <label class="edit-toggle-wrap">
        <input type="checkbox" id="ef-flag" ${Number(item.uncollected) ? 'checked' : ''}>
        <span class="edit-toggle-label">未収あり</span>
      </label>
    </div>`;
}

function buildCostFormHTML(item) {
  const rate = Number(item.taxRate) || 10;
  return `
    <div class="edit-field">
      <label class="edit-label">日付</label>
      <input type="date" id="ef-date" class="edit-input"
             value="${escHtml(item.date || '')}">
    </div>
    <div class="edit-field">
      <label class="edit-label">科目名</label>
      <input type="text" id="ef-name" class="edit-input"
             value="${escHtml(item.itemName || '')}" maxlength="40">
    </div>
    <div class="edit-field">
      <label class="edit-label">税率</label>
      ${taxToggleGroupHTML(rate)}
    </div>
    <div class="edit-field">
      <label class="edit-label">税込金額</label>
      <input type="number" id="ef-amount" class="edit-input"
             value="${Number(item.amount) || 0}" inputmode="numeric" min="0">
      <div id="ef-tax-note" class="edit-tax-note"></div>
    </div>
    <div class="edit-field">
      <label class="edit-label">メモ</label>
      <input type="text" id="ef-memo" class="edit-input"
             value="${escHtml(item.memo || '')}" maxlength="100">
    </div>
    <div class="edit-field">
      <label class="edit-label">未払</label>
      <label class="edit-toggle-wrap">
        <input type="checkbox" id="ef-flag" ${Number(item.unpaid) ? 'checked' : ''}>
        <span class="edit-toggle-label">未払あり</span>
      </label>
    </div>`;
}

function buildAttendanceFormHTML(item) {
  const labels   = deriveUILabels();
  const clockIn  = parseTimeStr(item.clockIn)  || '';
  const clockOut = parseTimeStr(item.clockOut) || '';
  return `
    <div class="edit-field">
      <label class="edit-label">スタッフ名</label>
      <div class="edit-readonly">${escHtml(item.staffName || '')}</div>
    </div>
    <div class="edit-field">
      <label class="edit-label">日付</label>
      <input type="date" id="ef-date" class="edit-input"
             value="${escHtml(item.date || '')}">
    </div>
    <div class="edit-field">
      <label class="edit-label">${escHtml(labels.clockin_time)}</label>
      ${timeSelectHTML('ef-clockin', clockIn, true)}
    </div>
    <div class="edit-field">
      <label class="edit-label">${escHtml(labels.clockout_time)}
        <span style="font-size:11px;font-weight:400;color:var(--uz-muted);margin-left:4px;">任意</span>
      </label>
      ${timeSelectHTML('ef-clockout', clockOut, false)}
    </div>`;
}

/* ── 税率トグル・税額リアルタイム表示 ───────────────────── */
function bindTaxCalc() {
  document.querySelectorAll('.tax-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tax-toggle').forEach(b => b.classList.remove('tax-toggle--active'));
      btn.classList.add('tax-toggle--active');
      updateTaxNote();
    });
  });
  document.getElementById('ef-amount')?.addEventListener('input', updateTaxNote);
  updateTaxNote();
}

function getSelectedTaxRate() {
  return Number(document.querySelector('.tax-toggle--active')?.dataset.rate ?? 10);
}

function updateTaxNote() {
  const el = document.getElementById('ef-tax-note');
  if (!el) return;
  const taxInc = parseInt(document.getElementById('ef-amount')?.value || '0', 10) || 0;
  const rate   = getSelectedTaxRate();
  // 全デバイス共通の §6-4 整数演算実装（calcTax）を経由する
  // 旧 floor(taxInc / (1 + rate/100)) は 55000円・10% で 5001円 になる FP誤差バグ
  const { taxExcluded: taxExc, tax } = calcTax(taxInc, rate);
  el.textContent = `税抜 ¥${taxExc.toLocaleString()}  /  消費税 ¥${tax.toLocaleString()}`;
}

/* ── 保存処理 ─────────────────────────────────────────────── */
async function saveEdit() {
  if (isEditSaving || !currentEditItem) return;

  const item = currentEditItem;
  isEditSaving = true;
  const saveBtn = document.getElementById('edit-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '保存中...'; }

  try {
    let result;

    if (item.type === 'sales') {
      const date        = document.getElementById('ef-date')?.value         || item.date;
      const serviceName = document.getElementById('ef-name')?.value?.trim() || item.itemName;
      const taxRate     = getSelectedTaxRate();
      const taxInc      = parseInt(document.getElementById('ef-amount')?.value || '0', 10) || 0;
      const { taxExcluded: taxExc, tax } = calcTax(taxInc, taxRate);
      const memo        = document.getElementById('ef-memo')?.value        || '';
      const uncollected = document.getElementById('ef-flag')?.checked      ? 1 : 0;

      result = await callGAS('updateSales', {
        rowIndex:    item.rowIndex,
        date,
        serviceName,
        serviceCode: item.serviceCode  || '',
        amountExTax: taxExc,
        taxRate,
        tax,
        amountInTax: taxInc,
        memo,
        uncollected,
      });

    } else if (item.type === 'cost') {
      const date      = document.getElementById('ef-date')?.value         || item.date;
      const itemName  = document.getElementById('ef-name')?.value?.trim() || item.itemName;
      const taxRate   = getSelectedTaxRate();
      const taxInc    = parseInt(document.getElementById('ef-amount')?.value || '0', 10) || 0;
      const { taxExcluded: taxExc, tax } = calcTax(taxInc, taxRate);
      const memo      = document.getElementById('ef-memo')?.value      || '';
      const unpaid    = document.getElementById('ef-flag')?.checked    ? 1 : 0;

      result = await callGAS('updateCost', {
        rowIndex:     item.rowIndex,
        date,
        divisionCode: item.divisionCode || '',
        divisionName: item.divisionName || '',
        itemCode:     item.itemCode     || '',
        itemName,
        taxExcluded:  taxExc,
        taxRate,
        tax,
        taxIncluded:  taxInc,
        memo,
        unpaid,
      });

    } else {
      // attendance
      const labels   = deriveUILabels();
      const date     = document.getElementById('ef-date')?.value || item.date;
      const clockIn  = getTimeSelectValue('ef-clockin');
      const clockOut = getTimeSelectValue('ef-clockout');

      if (!clockIn) {
        showToast(`${labels.clockin_time}を選択してください`, 'error');
        isEditSaving = false;
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '保存する'; }
        return;
      }

      result = await callGAS('updateAttendance', {
        rowIndex:  item.rowIndex,
        date,
        staffId:   item.staffId   || '',
        staffName: item.staffName || '',
        clockIn,
        clockOut,
      });

      // 労働時間の異常チェック（保存はブロックしない・警告のみ）
      if (result?.status === 'ok' && clockOut) {
        const dur = calcWorkDuration(clockIn, clockOut);
        if (dur?.isAbnormal) {
          closeEditForm();
          alert(`⚠️ 労働時間が${dur.hours}時間${dur.mins}分です。\n異常値の可能性があります。\n保存されましたが確認してください。`);
          await loadAll();
          return;
        }
      }
    }

    if (result?.status !== 'ok') throw new Error(result?.message || '登録エラー');

    closeEditForm();
    showToast('修正を保存しました ✓', 'success');
    await loadAll(); // 一覧をリロード

  } catch (e) {
    showToast('保存に失敗しました：' + e.message, 'error');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '保存する'; }
  } finally {
    isEditSaving = false;
  }
}

/* ── 共通：日付ヘッダー ──────────────────────────────────── */
function buildDateHeader(dateStr) {
  const [y, m, d] = dateStr.split(/[-\/]/).map(Number);
  const dow = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `
    <div style="padding:12px 20px 6px;">
      <span style="font-size:12px;font-weight:700;color:var(--uz-muted);letter-spacing:0.06em;">
        ${y}年${m}月${d}日（${dow}）
      </span>
    </div>`;
}

/* ── 時刻文字列正規化（GASのシリアル日時対応） ──────────── */
function parseTimeStr(val) {
  if (!val) return '';
  const s = String(val).trim();
  if (!s) return '';

  // パターン1: "HH:MM" or "HH:MM:SS" 形式（そのまま返す）
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s.slice(0, 5);

  // パターン2: GASのシリアル日時（例: "Sat Dec 30 1899 20:21:00 GMT+0900"）
  // ブラウザ依存のnew Date()を避け、正規表現でHH:MMを直接抽出
  const serialMatch = s.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/);
  if (serialMatch && /Dec 30 1899|1899\/12\/30|1899-12-30/.test(s)) {
    return `${serialMatch[1].padStart(2, '0')}:${serialMatch[2]}`;
  }

  // パターン3: ISO形式（例: "2026-04-17T10:30:00.000Z"）
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime()))
      return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
  }

  // パターン4: その他Date文字列（フォールバック）
  const d = new Date(s);
  if (!isNaN(d.getTime()))
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

  return '';
}

/* ══════════════════════════════════════════════════════════
   新規入店登録フォーム
   ══════════════════════════════════════════════════════════ */

/** シートモーダルに差し込むフォーム HTML を生成 */
function _buildCIFormBodyHTML() {
  const labels = deriveUILabels();
  return `
    <div class="ci-section" aria-label="${escHtml(labels.clockin_register)}">
      <div class="ci-row ci-row--radio">
        <label class="ci-radio-label">
          <input type="radio" name="ci-mode" id="ci-mode-registered" value="registered" checked>
          <span>登録済みから選ぶ</span>
        </label>
        <label class="ci-radio-label">
          <input type="radio" name="ci-mode" id="ci-mode-manual" value="manual">
          <span>未登録を手入力</span>
        </label>
      </div>
      <div id="ci-registered-wrap" class="ci-row">
        <label class="ci-field-label" for="ci-staff-select">スタッフ</label>
        <select id="ci-staff-select" class="ci-select" aria-label="スタッフを選択">
          <option value="">スタッフを選択...</option>
        </select>
      </div>
      <div id="ci-manual-wrap" class="ci-row" style="display:none;">
        <label class="ci-field-label" for="ci-staff-name">スタッフ名</label>
        <input type="text" id="ci-staff-name" class="ci-input"
               placeholder="スタッフ名を入力" maxlength="20" autocomplete="off"
               aria-label="スタッフ名">
      </div>
      <div class="ci-row">
        <label class="ci-field-label" for="ci-emp-type">雇用形態</label>
        <select id="ci-emp-type" class="ci-select" aria-label="雇用形態">
          <option value="">選択してください</option>
          <option value="employed_full">常勤雇用（社員）</option>
          <option value="employed_temp">臨時アルバイト</option>
          <option value="contractor">委託・外注</option>
        </select>
      </div>
      <div class="ci-row">
        <label class="ci-field-label" for="ci-date">日付</label>
        <input type="date" id="ci-date" class="ci-date-input" aria-label="日付">
      </div>
      <div class="ci-row">
        <label class="ci-field-label">${escHtml(labels.clockin_time)}</label>
        <div id="ci-clockin-wrap"></div>
      </div>
      <div class="ci-row">
        <label class="ci-field-label">${escHtml(labels.clockout_time)}<span class="ci-optional">任意</span></label>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <div id="ci-clockout-wrap"></div>
          <span id="ci-next-day-badge" class="ci-badge-nextday" style="display:none;">翌日</span>
        </div>
      </div>
      <div id="ci-error-toast"></div>
      <div class="ci-row ci-row--submit">
        <button id="ci-submit-btn" type="button" class="ci-submit-btn">登録する</button>
      </div>
    </div>`;
}

/** SheetModal の onRender で呼ぶ：フォーム初期化＋イベントバインド */
function _initCIFormInModal() {
  // スタッフリスト更新してプルダウンに反映
  _ciStaffList = _getStaffFromStorage();
  const sel = document.getElementById('ci-staff-select');
  if (sel) {
    sel.innerHTML = '<option value="">スタッフを選択...</option>';
    _ciStaffList.forEach((s, i) => {
      const opt = document.createElement('option');
      opt.value       = String(i);
      opt.textContent = s.name;
      sel.appendChild(opt);
    });
  }

  // 今日の日付
  const dateInput = document.getElementById('ci-date');
  if (dateInput) dateInput.value = todayStr();

  // 時刻セレクト描画
  const ciWrap = document.getElementById('ci-clockin-wrap');
  if (ciWrap) ciWrap.innerHTML = buildCITimeSelectHTML('ci-clockin');
  const coWrap = document.getElementById('ci-clockout-wrap');
  if (coWrap) coWrap.innerHTML = buildCITimeSelectHTML('ci-clockout');

  // ラジオ切り替え
  document.querySelectorAll('input[name="ci-mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isRegistered = radio.value === 'registered';
      document.getElementById('ci-registered-wrap').style.display = isRegistered ? '' : 'none';
      document.getElementById('ci-manual-wrap').style.display     = isRegistered ? 'none' : '';
      if (isRegistered) {
        _applyStaffEmpType();
      } else {
        const empSel = document.getElementById('ci-emp-type');
        if (empSel) empSel.value = '';
      }
    });
  });

  // スタッフ変更 → 雇用形態自動反映
  document.getElementById('ci-staff-select')?.addEventListener('change', _applyStaffEmpType);

  // ボタンラベル動的更新（分・退店時刻・日付）
  ['ci-date', 'ci-clockin-m', 'ci-clockout-h', 'ci-clockout-m'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', updateCIBtnLabel);
  });
  // 入店時刻「時」変更 → 退店プルダウン再生成
  document.getElementById('ci-clockin-h')?.addEventListener('change', () => {
    _refreshClockOutHourSelect('ci-clockin-h', 'ci-clockout-h');
    updateCIBtnLabel();
  });

  // 登録ボタン
  document.getElementById('ci-submit-btn')?.addEventListener('click', submitClockIn);

  // バリデーションエラー赤枠の解除
  document.getElementById('ci-emp-type')?.addEventListener('change', e => {
    e.target.classList.remove('ci-field-error');
  });
  document.getElementById('ci-clockin-wrap')?.addEventListener('change', () => {
    document.getElementById('ci-clockin-wrap')?.classList.remove('ci-field-error');
  });

  // 入店時刻を現在時刻（5分刻み）でセット
  const { hour, min } = getCurrentTimeRounded();
  const ciH = document.getElementById('ci-clockin-h');
  const ciM = document.getElementById('ci-clockin-m');
  if (ciH) ciH.value = String(hour).padStart(2, '0');
  if (ciM) ciM.value = String(min).padStart(2, '0');

  // 入店時刻基準で退店プルダウン初期化
  _refreshClockOutHourSelect('ci-clockin-h', 'ci-clockout-h');
  updateCIBtnLabel();
}

function _applyStaffEmpType() {
  const sel   = document.getElementById('ci-staff-select');
  const empSel = document.getElementById('ci-emp-type');
  if (!sel || !empSel) return;
  const idx   = parseInt(sel.value, 10);
  if (isNaN(idx) || !_ciStaffList[idx]) { empSel.value = ''; return; }
  // employmentType 3種化（サイクルA）：旧 'employed' / 未設定は employed_full に寄せる
  const raw = _ciStaffList[idx].employmentType;
  empSel.value = (raw === 'employed_full' || raw === 'employed_temp' || raw === 'contractor')
    ? raw
    : 'employed_full';
}

/**
 * 入店・退店時刻から日跨ぎかどうかを返す
 * @returns {boolean|null} true=日跨ぎ / false=同日 / null=退店未選択
 */
function isOvernightCI(ciH, ciM, coH, coM) {
  if (coH === '' || coM === '') return null;
  const inMin  = Number(ciH) * 60 + Number(ciM);
  const outMin = Number(coH) * 60 + Number(coM);
  return outMin < inMin;
}

/** 翌日バッジの表示/非表示を更新 */
function _updateOvernightBadge() {
  const badge = document.getElementById('ci-next-day-badge');
  if (!badge) return;
  const ciH = document.getElementById('ci-clockin-h')?.value  || '';
  const ciM = document.getElementById('ci-clockin-m')?.value  || '';
  const coH = document.getElementById('ci-clockout-h')?.value || '';
  const coM = document.getElementById('ci-clockout-m')?.value || '';
  const overnight = isOvernightCI(ciH, ciM, coH, coM);
  badge.style.display = overnight === true ? 'inline-block' : 'none';
}

function updateCIBtnLabel() {
  const btn = document.getElementById('ci-submit-btn');
  if (!btn) return;

  const labels   = deriveUILabels();
  const dateVal  = document.getElementById('ci-date')?.value || '';
  const clockIn  = getTimeSelectValue('ci-clockin');
  const clockOut = getTimeSelectValue('ci-clockout');

  const datePart = dateVal ? dateVal.replace(/-/g, '/') : '日付未選択';
  const ciPart   = clockIn || '時刻未選択';

  let coPart;
  if (!clockOut) {
    coPart = labels.clockout_unrecorded;
  } else {
    const ciH = document.getElementById('ci-clockin-h')?.value  || '';
    const ciM = document.getElementById('ci-clockin-m')?.value  || '';
    const coH = document.getElementById('ci-clockout-h')?.value || '';
    const coM = document.getElementById('ci-clockout-m')?.value || '';
    const overnight = isOvernightCI(ciH, ciM, coH, coM);
    coPart = overnight === true ? `翌 ${clockOut} ${labels.clockout_label}` : `${clockOut} ${labels.clockout_label}`;
  }

  btn.textContent = `${datePart} ${ciPart} ${labels.clockin_label} / ${coPart} 登録する`;

  _updateOvernightBadge();
}

/** エラートースト表示（3秒後自動非表示） */
function _showCIError(message) {
  const toast = document.getElementById('ci-error-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.style.display = 'block';
  clearTimeout(toast._timeoutId);
  toast._timeoutId = setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

/** 全フィールドの赤枠解除 */
function _clearCIFieldErrors() {
  document.querySelectorAll('.ci-field-error').forEach(el => el.classList.remove('ci-field-error'));
  const toast = document.getElementById('ci-error-toast');
  if (toast) toast.style.display = 'none';
}

/**
 * バリデーション実行
 * @returns {{ type:'error', field:Element, message:string } | { type:'confirm' } | null}
 */
function _validateCIForm() {
  _clearCIFieldErrors();

  const labels = deriveUILabels();

  // 雇用形態チェック
  const empEl = document.getElementById('ci-emp-type');
  if (!empEl?.value) {
    return { type: 'error', field: empEl, message: '雇用形態を選択してください' };
  }

  // 入店時刻チェック
  const ciH = document.getElementById('ci-clockin-h');
  const ciM = document.getElementById('ci-clockin-m');
  if (!ciH?.value || !ciM?.value) {
    return { type: 'error', field: document.getElementById('ci-clockin-wrap'), message: `${labels.clockin_time}を選択してください` };
  }

  // スタッフ未指定チェック（任意・confirmのみ）
  const mode        = document.querySelector('input[name="ci-mode"]:checked')?.value || 'registered';
  const staffSelect = document.getElementById('ci-staff-select');
  const staffInput  = document.getElementById('ci-staff-name');
  const noStaff     = mode === 'registered'
    ? !staffSelect?.value
    : !(staffInput?.value?.trim());
  if (noStaff) {
    return { type: 'confirm' };
  }

  return null;
}

async function submitClockIn() {
  // バリデーション
  const validation = _validateCIForm();
  if (validation?.type === 'error') {
    validation.field?.classList.add('ci-field-error');
    _showCIError(validation.message);
    return;
  }
  if (validation?.type === 'confirm') {
    if (!window.confirm('スタッフ名無しで登録しますか？')) return;
  }

  const labels = deriveUILabels();
  const mode = document.querySelector('input[name="ci-mode"]:checked')?.value || 'registered';

  let staffName, staffId;

  if (mode === 'registered') {
    const sel = document.getElementById('ci-staff-select');
    const idx = parseInt(sel?.value, 10);
    if (!isNaN(idx) && _ciStaffList[idx]) {
      staffName = _ciStaffList[idx].name;
      staffId   = String(_ciStaffList[idx].id);
    } else {
      staffName = '';
      staffId   = '';
    }
  } else {
    staffName = document.getElementById('ci-staff-name')?.value.trim() || '';
    staffId   = '';
  }

  const employmentType = document.getElementById('ci-emp-type')?.value || '';
  const date           = document.getElementById('ci-date')?.value     || '';
  if (!date) return showToast('日付を選択してください', 'error');

  const clockIn = getTimeSelectValue('ci-clockin');

  const clockOut = getTimeSelectValue('ci-clockout'); // 任意

  // 退店時刻の異常チェック
  if (clockOut) {
    const dur = calcWorkDuration(clockIn, clockOut);
    if (dur?.isAbnormal) {
      if (!confirm(`⚠️ 労働時間が${dur.hours}時間${dur.mins}分です。\n異常値の可能性があります。続けますか？`)) return;
    }
  }

  // 日跨ぎ判定・退店日計算
  let clockOutDate = date;
  if (clockOut) {
    const [ciH, ciM] = clockIn.split(':').map(Number);
    const [coH, coM] = clockOut.split(':').map(Number);
    if (coH * 60 + coM < ciH * 60 + ciM) {
      const d = new Date(date);
      d.setDate(d.getDate() + 1);
      clockOutDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }

  const btn = document.getElementById('ci-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = '登録中...'; }

  try {
    const result = await callGAS('clockIn', {
      staffId,
      staffName,
      employmentType,
      date,
      clockInTime:  clockIn,
      clockOutTime: clockOut || '',
      clockOutDate: clockOut ? clockOutDate : '',
    });

    if (result?.status !== 'ok') throw new Error(result?.message || '登録エラー');

    showToast(`${staffName} の${labels.clockin_label}を記録しました ✓`, 'success');
    closeCIModal();
    await loadAttendanceOnly();

  } catch (e) {
    showToast('登録に失敗しました：' + e.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      updateCIBtnLabel();
    }
  }
}

/* ══════════════════════════════════════════════════════════
   シートモーダル（SheetModal 利用）
   ══════════════════════════════════════════════════════════ */

function getCurrentTimeRounded() {
  const now = new Date();
  return {
    hour: now.getHours(),
    min:  Math.floor(now.getMinutes() / 5) * 5,
  };
}

function openCIModal() {
  const labels = deriveUILabels();
  SheetModal.open({
    title:    labels.clockin_register,
    bodyHtml: _buildCIFormBodyHTML(),
    onRender: _initCIFormInModal,
  });
}

function closeCIModal() {
  SheetModal.close();
}

async function loadAttendanceOnly() {
  attendItems = [];
  const monthParam = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
  try {
    const result = await callGAS('getAttendanceByMonth', { month: monthParam });
    if (result?.status === 'ok' && Array.isArray(result.data)) {
      renderAttendance(result.data);
    } else {
      renderAttendanceError();
    }
  } catch {
    renderAttendanceError();
  }
}

async function quickClockOut(rowIndex, staffId, staffName) {
  if (!rowIndex) {
    showToast('rowIndex が取得できません。GAS の getAttendanceByMonth に rowIndex を追加してください。', 'error', 4000);
    return;
  }
  const labels = deriveUILabels();
  if (!confirm(`${staffName} の${labels.clockout_label}を現在時刻で記録しますか？`)) return;

  const now          = new Date();
  const clockOutTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // 日跨ぎ判定：attendItems から入店レコードを取得
  const record     = attendItems.find(it => it.rowIndex === rowIndex);
  const clockIn    = parseTimeStr(record?.clockIn) || '';
  const clockInDate = record?.date || todayStr();
  let   clockOutDate = clockInDate;

  if (clockIn) {
    const [ciH, ciM] = clockIn.split(':').map(Number);
    const [coH, coM] = clockOutTime.split(':').map(Number);
    if (coH * 60 + coM < ciH * 60 + ciM) {
      const d = new Date(clockInDate);
      d.setDate(d.getDate() + 1);
      clockOutDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }

  showLoading();
  try {
    const result = await callGAS('clockOut', { rowIndex, staffId, clockOutTime, clockOutDate });
    if (result?.status !== 'ok') throw new Error(result?.message || '記録エラー');
    showToast(`${staffName} の${labels.clockout_label}を記録しました ✓`, 'success');
    await loadAttendanceOnly();
  } catch (e) {
    showToast(`${labels.clockout_label}記録に失敗しました：` + e.message, 'error');
  } finally {
    hideLoading();
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
   iPad 右パネル（4状態）
   ══════════════════════════════════════════════════════════ */

let _ipadSelectedRecord = null;

/**
 * ロック状態 + localStorage申請状態を合わせて返す
 * @returns {'editable'|'grace'|'locked'|'pending'}
 */
function getLockState(record) {
  const ls = getLockStatus(record.date);
  if (!ls.locked) {
    return ls.grace ? 'grace' : 'editable';
  }
  const key = `lock_pending_${record.type}_${record.rowIndex}`;
  const pending = localStorage.getItem(key);
  if (pending === 'pending' || pending === 'approved') return 'pending';
  return 'locked';
}

function renderIpadRightPanel(record) {
  const panel = document.querySelector('.ipad-right-panel');
  if (!panel) return;

  _ipadSelectedRecord = record;
  currentEditItem = record;

  const state = getLockState(record);
  const ls    = getLockStatus(record.date);

  // ロック済み・申請中：詳細表示＋ロック操作ボタン
  if (state === 'locked' || state === 'pending') {
    const detail = _buildIpadRecordDetail(record);
    let actionHTML = '';
    if (state === 'locked') {
      actionHTML = `
        <div class="ipad-locked-note">🔒 このレコードはロック済みです</div>
        <button class="ipad-right-action-btn ipad-right-action-btn--unlock"
                type="button" id="ipad-right-unlock-btn">ロック解除を申請</button>`;
    } else {
      actionHTML = `
        <span class="ipad-pending-badge">申請中</span>
        <p class="form-hint" style="margin-bottom:12px;margin-top:8px;">
          解除申請が送信されています。承認後に修正できます。
        </p>
        <div class="ipad-approve-btns">
          <button class="ipad-right-action-btn ipad-right-action-btn--approve"
                  type="button" id="ipad-right-approve-btn">承認する</button>
          <button class="ipad-right-action-btn ipad-right-action-btn--reject"
                  type="button" id="ipad-right-reject-btn">却下</button>
        </div>`;
    }

    panel.innerHTML = `
      <div class="ipad-right-panel__header">操作パネル</div>
      ${detail}
      ${actionHTML}
    `;

    document.getElementById('ipad-right-unlock-btn')?.addEventListener('click', () => {
      requestUnlock(_ipadSelectedRecord.type, _ipadSelectedRecord.rowIndex);
      renderIpadRightPanel(_ipadSelectedRecord);
    });
    document.getElementById('ipad-right-approve-btn')?.addEventListener('click', () => {
      approveUnlock(_ipadSelectedRecord.type, _ipadSelectedRecord.rowIndex);
      renderIpadRightPanel(_ipadSelectedRecord);
    });
    document.getElementById('ipad-right-reject-btn')?.addEventListener('click', () => {
      rejectUnlock(_ipadSelectedRecord.type, _ipadSelectedRecord.rowIndex);
      renderIpadRightPanel(_ipadSelectedRecord);
    });
    return;
  }

  // 編集可能（editable / grace）：修正フォームを右パネルに直接表示
  const graceNote = state === 'grace'
    ? `<p class="form-hint" style="margin:0 0 8px;color:var(--uz-red);">猶予期間中（期限まであと${ls.daysLeft}日）</p>`
    : '';

  let formHTML = '';
  if (record.type === 'sales') {
    formHTML = buildSalesFormHTML(record);
  } else if (record.type === 'cost') {
    formHTML = buildCostFormHTML(record);
  } else {
    formHTML = buildAttendanceFormHTML(record);
  }

  panel.innerHTML = `
    <div class="ipad-right-panel__header">修正</div>
    <div class="ipad-right-form-body">
      ${graceNote}
      ${formHTML}
      <button id="ipad-right-save-btn" type="button" class="edit-save-btn" style="margin-top:12px;">保存する</button>
    </div>
  `;

  // 税率トグル・税額表示
  bindTaxCalc();

  // 入店履歴の退店時刻セレクト制御
  if (record.type === 'attendance') {
    _refreshClockOutHourSelect('ef-clockin-h', 'ef-clockout-h');
    document.getElementById('ef-clockin-h')?.addEventListener('change', () => {
      _refreshClockOutHourSelect('ef-clockin-h', 'ef-clockout-h');
    });
  }

  // 保存ボタン
  document.getElementById('ipad-right-save-btn')?.addEventListener('click', () => {
    saveEdit();
  });
}

function _buildIpadRecordDetail(record) {
  const labels = deriveUILabels();
  let rows = '';
  if (record.type === 'sales') {
    rows = `
      <div class="ipad-record-detail__row">
        <span class="ipad-record-detail__key">種別</span>
        <span class="ipad-record-detail__val">売上</span>
      </div>
      <div class="ipad-record-detail__row">
        <span class="ipad-record-detail__key">日付</span>
        <span class="ipad-record-detail__val">${escHtml(record.date || '—')}</span>
      </div>
      <div class="ipad-record-detail__row">
        <span class="ipad-record-detail__key">サービス</span>
        <span class="ipad-record-detail__val">${escHtml(record.itemName || '—')}</span>
      </div>
      <div class="ipad-record-detail__row">
        <span class="ipad-record-detail__key">税込金額</span>
        <span class="ipad-record-detail__val" style="color:var(--uz-gold);">${formatYen(record.amount)}</span>
      </div>
      ${record.memo ? `<div class="ipad-record-detail__row">
        <span class="ipad-record-detail__key">メモ</span>
        <span class="ipad-record-detail__val">${escHtml(record.memo)}</span>
      </div>` : ''}`;
  } else if (record.type === 'cost') {
    rows = `
      <div class="ipad-record-detail__row">
        <span class="ipad-record-detail__key">種別</span>
        <span class="ipad-record-detail__val">コスト</span>
      </div>
      <div class="ipad-record-detail__row">
        <span class="ipad-record-detail__key">日付</span>
        <span class="ipad-record-detail__val">${escHtml(record.date || '—')}</span>
      </div>
      <div class="ipad-record-detail__row">
        <span class="ipad-record-detail__key">科目</span>
        <span class="ipad-record-detail__val">${escHtml(record.itemName || '—')}</span>
      </div>
      <div class="ipad-record-detail__row">
        <span class="ipad-record-detail__key">税込金額</span>
        <span class="ipad-record-detail__val" style="color:var(--uz-red);">${formatYen(record.amount)}</span>
      </div>
      ${record.memo ? `<div class="ipad-record-detail__row">
        <span class="ipad-record-detail__key">メモ</span>
        <span class="ipad-record-detail__val">${escHtml(record.memo)}</span>
      </div>` : ''}`;
  } else {
    // attendance
    rows = `
      <div class="ipad-record-detail__row">
        <span class="ipad-record-detail__key">種別</span>
        <span class="ipad-record-detail__val">${escHtml(labels.clockin_record)}</span>
      </div>
      <div class="ipad-record-detail__row">
        <span class="ipad-record-detail__key">日付</span>
        <span class="ipad-record-detail__val">${escHtml(record.date || '—')}</span>
      </div>
      <div class="ipad-record-detail__row">
        <span class="ipad-record-detail__key">スタッフ</span>
        <span class="ipad-record-detail__val">${escHtml(record.staffName || '—')}</span>
      </div>
      <div class="ipad-record-detail__row">
        <span class="ipad-record-detail__key">${escHtml(labels.clockin_label)}</span>
        <span class="ipad-record-detail__val">${escHtml(parseTimeStr(record.clockIn) || '—')}</span>
      </div>
      <div class="ipad-record-detail__row">
        <span class="ipad-record-detail__key">${escHtml(labels.clockout_label)}</span>
        <span class="ipad-record-detail__val">${escHtml(parseTimeStr(record.clockOut) || '未記録')}</span>
      </div>`;
  }
  return `<div class="ipad-record-detail">${rows}</div>`;
}

function requestUnlock(type, rowIndex) {
  localStorage.setItem(`lock_pending_${type}_${rowIndex}`, 'pending');
  showToast('ロック解除を申請しました', 'success');
  updateIpadApprovalBanner();
}

function approveUnlock(type, rowIndex) {
  localStorage.setItem(`lock_pending_${type}_${rowIndex}`, 'approved');
  showToast('申請を承認しました', 'success');
  updateIpadApprovalBanner();
}

function rejectUnlock(type, rowIndex) {
  localStorage.removeItem(`lock_pending_${type}_${rowIndex}`);
  showToast('申請を却下しました', 'success');
  updateIpadApprovalBanner();
}

function updateIpadApprovalBanner() {
  const banner = document.getElementById('approval-banner');
  if (!banner) return;
  const pendingKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('lock_pending_') && localStorage.getItem(key) === 'pending') {
      pendingKeys.push(key);
    }
  }
  if (pendingKeys.length > 0) {
    const detail = document.getElementById('approval-banner__detail');
    if (detail) detail.textContent = `${pendingKeys.length}件の解除申請があります`;
    banner.style.display = '';
  } else {
    banner.style.display = 'none';
  }
}
