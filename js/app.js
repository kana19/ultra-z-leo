/**
 * ウルトラ財務くん LEO版 PWA — app.js
 * 共通ロジック・GAS通信
 */

'use strict';

// デバイス判定・bodyクラス付与（即時実行）
(function() {
  const ua = navigator.userAgent;
  const isIPad = /iPad/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isPC = !isIPad && window.innerWidth >= 1025;

  if (isIPad) document.body.classList.add('is-ipad');
  if (isPC)   document.body.classList.add('is-pc');
})();

// DOMContentLoaded後にも付与（Safariサイドバーモード対策）
document.addEventListener('DOMContentLoaded', function() {
  const ua = navigator.userAgent;
  const isIPad = /iPad/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

  if (isIPad) {
    document.body.classList.add('is-ipad');
    document.documentElement.classList.add('is-ipad');
  }
});

/* ── GAS設定 ─────────────────────────────────────────────── */
const GAS_URL = 'https://script.google.com/macros/s/AKfycby4JMIAB3aX6_mLBoveCMDSXLpjKeMgr70YYkr7dwwhvnfBBcHgm45cSIQucC-L3P_gDA/exec';

/**
 * GASにGETリクエストを送る（CORS回避のためクエリパラメータで送信）
 * @param {string} action
 * @param {Object} data
 * @returns {Promise<Object>}
 */
async function callGAS(action, data = {}) {
  const params = new URLSearchParams({ action, data: JSON.stringify(data) });
  const res = await fetch(`${GAS_URL}?${params}`, { method: 'GET' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

/* ── 金額フォーマット ────────────────────────────────────── */
/**
 * 数値を日本円表示（¥1,234,567）に変換
 * @param {number} amount
 * @returns {string}
 */
function formatYen(amount) {
  if (amount == null || isNaN(amount)) return '¥—';
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('ja-JP');
  return (amount < 0 ? '△¥' : '¥') + formatted;
}

/**
 * 税込→税抜計算
 * @param {number} taxIncluded 税込金額
 * @param {number} taxRate 税率（%）
 * @returns {{ taxExcluded: number, tax: number }}
 */
function calcTax(taxIncluded, taxRate) {
  if (taxRate === 0) return { taxExcluded: taxIncluded, tax: 0 };
  const taxExcluded = Math.floor(taxIncluded / (1 + taxRate / 100));
  const tax = taxIncluded - taxExcluded;
  return { taxExcluded, tax };
}

/* ── 日付ユーティリティ ──────────────────────────────────── */
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 今日の日付文字列（YYYY-MM-DD）を返す
 * @returns {string}
 */
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 月末まで何日あるか返す
 * @returns {number}
 */
function daysUntilMonthEnd() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return lastDay - now.getDate();
}

/**
 * 月末3日前かどうか
 * @returns {boolean}
 */
function isNearMonthEnd() {
  return daysUntilMonthEnd() < 3;
}

/* ── トースト通知 ────────────────────────────────────────── */
let _toastTimer = null;

/**
 * トーストを表示
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 * @param {number} duration ミリ秒
 */
function showToast(message, type = 'info', duration = 2500) {
  let toast = document.getElementById('uz-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'uz-toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `toast toast--${type} toast--show`;
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toast.classList.remove('toast--show');
  }, duration);
}

/* ── ローディング ────────────────────────────────────────── */
/**
 * ローディングオーバーレイ表示
 */
function showLoading() {
  const el = document.getElementById('loading-overlay');
  if (el) el.classList.add('loading-overlay--show');
}

/**
 * ローディングオーバーレイ非表示
 */
function hideLoading() {
  const el = document.getElementById('loading-overlay');
  if (el) el.classList.remove('loading-overlay--show');
}

/* ── 時刻セレクト ────────────────────────────────────────── */
const _TIME_HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const _TIME_MINS  = ['00','05','10','15','20','25','30','35','40','45','50','55'];

/**
 * 時・分セレクト2つのHTML断片を返す
 * @param {string}  idPrefix  'form-clockin' など（-h / -m が付く）
 * @param {string}  value     'HH:MM' または ''
 * @param {boolean} required  false なら先頭に空選択肢を追加
 */
function timeSelectHTML(idPrefix, value, required = false) {
  const parts = (value || '').split(':');
  const selH  = (parts[0] || '').padStart(2, '0');
  const mRaw  = parseInt(parts[1] || '', 10);
  const selM  = isNaN(mRaw) ? '' : String(Math.floor(mRaw / 5) * 5).padStart(2, '0');

  const blankH = required ? '' : '<option value="">--</option>';
  const blankM = required ? '' : '<option value="">--</option>';

  const optsH = blankH + _TIME_HOURS.map(v =>
    `<option value="${v}"${v === selH ? ' selected' : ''}>${v}</option>`
  ).join('');
  const optsM = blankM + _TIME_MINS.map(v =>
    `<option value="${v}"${v === selM ? ' selected' : ''}>${v}</option>`
  ).join('');

  return `<div style="display:flex;align-items:center;gap:6px;">` +
    `<select id="${idPrefix}-h" class="date-input" style="width:72px;">${optsH}</select>` +
    `<span style="color:var(--uz-text);font-weight:600;font-size:16px;">:</span>` +
    `<select id="${idPrefix}-m" class="date-input" style="width:72px;">${optsM}</select>` +
    `</div>`;
}

/**
 * 時刻セレクトの現在値を "HH:MM" で返す（未選択なら ''）
 * @param {string} idPrefix
 * @returns {string}
 */
function getTimeSelectValue(idPrefix) {
  const h = document.getElementById(`${idPrefix}-h`)?.value || '';
  const m = document.getElementById(`${idPrefix}-m`)?.value || '';
  if (!h || !m) return '';
  return `${h}:${m}`;
}

/**
 * 時刻セレクトに値をセット
 * @param {string} idPrefix
 * @param {string} value 'HH:MM' または ''
 */
function setTimeSelect(idPrefix, value) {
  const hEl = document.getElementById(`${idPrefix}-h`);
  const mEl = document.getElementById(`${idPrefix}-m`);
  if (!hEl || !mEl) return;
  if (!value) {
    hEl.value = '';
    mEl.value = '';
    return;
  }
  const parts = value.split(':');
  const h     = (parts[0] || '').padStart(2, '0');
  const mRaw  = parseInt(parts[1] || '', 10);
  const m     = isNaN(mRaw) ? '00' : String(Math.floor(mRaw / 5) * 5).padStart(2, '0');
  hEl.value = h;
  mEl.value = m;
}

/* ── ページナビゲーション ────────────────────────────────── */
/**
 * 指定URLに遷移
 * @param {string} url
 */
function navigate(url) {
  window.location.href = url;
}

/* ── コスト科目マスタ ─────────────────────────────────────── */
const COST_MASTER_KEY = 'uz_cost_master';

/** デフォルト科目マスタ（確定申告行番号対応） */
const DEFAULT_COST_MASTER = [
  // ── 仕入原価（divisionCode:"1"） ──
  { code: 'C1', taxRow: null, name: '仕入(酒類・食材)', taxRate: 8,  type: 'fixed',  divisionCode: '1' },
  { code: 'C2', taxRow: null, name: '仕入(消耗品)',     taxRate: 10, type: 'fixed',  divisionCode: '1' },
  { code: 'C3', taxRow: null, name: '仕入(その他)',     taxRate: 10, type: 'fixed',  divisionCode: '1' },
  // ── 販管費（divisionCode:"2"）固定科目 ──
  { code: '8',  taxRow: 8,  name: '租税公課',       taxRate: 0,  type: 'fixed',  divisionCode: '2' },
  { code: '9',  taxRow: 9,  name: '荷造運賃',       taxRate: 10, type: 'fixed',  divisionCode: '2' },
  { code: '10', taxRow: 10, name: '水道光熱費',     taxRate: 10, type: 'fixed',  divisionCode: '2' },
  { code: '11', taxRow: 11, name: '旅費交通費',     taxRate: 10, type: 'fixed',  divisionCode: '2' },
  { code: '12', taxRow: 12, name: '通信費',         taxRate: 10, type: 'fixed',  divisionCode: '2' },
  { code: '13', taxRow: 13, name: '広告宣伝費',     taxRate: 10, type: 'fixed',  divisionCode: '2' },
  { code: '14', taxRow: 14, name: '接待交際費',     taxRate: 10, type: 'fixed',  divisionCode: '2' },
  { code: '15', taxRow: 15, name: '損害保険料',     taxRate: 0,  type: 'fixed',  divisionCode: '2' },
  { code: '16', taxRow: 16, name: '修繕費',         taxRate: 10, type: 'fixed',  divisionCode: '2' },
  { code: '17', taxRow: 17, name: '消耗品費',       taxRate: 10, type: 'fixed',  divisionCode: '2' },
  { code: '18', taxRow: 18, name: '減価償却費',     taxRate: 0,  type: 'fixed',  divisionCode: '2' },
  { code: '19', taxRow: 19, name: '福利厚生費',     taxRate: 10, type: 'fixed',  divisionCode: '2' },
  { code: '20', taxRow: 20, name: '給料賃金',       taxRate: 0,  type: 'fixed',  divisionCode: '2' },
  { code: '21', taxRow: 21, name: '外注工賃',       taxRate: 10, type: 'fixed',  divisionCode: '2' },
  { code: '22', taxRow: 22, name: '利子割引料',     taxRate: 0,  type: 'fixed',  divisionCode: '2' },
  { code: '23', taxRow: 23, name: '地代家賃',       taxRate: 10, type: 'fixed',  divisionCode: '2' },
  { code: '24', taxRow: 24, name: '貸倒金',         taxRate: 0,  type: 'fixed',  divisionCode: '2' },
  { code: '25', taxRow: 25, name: '税理士等の報酬', taxRate: 10, type: 'fixed',  divisionCode: '2' },
  // ── 販管費（divisionCode:"2"）任意科目（行26〜30） ──
  { code: '26', taxRow: 26, name: '', taxRate: 10, type: 'custom', divisionCode: '2' },
  { code: '27', taxRow: 27, name: '', taxRate: 10, type: 'custom', divisionCode: '2' },
  { code: '28', taxRow: 28, name: '', taxRate: 10, type: 'custom', divisionCode: '2' },
  { code: '29', taxRow: 29, name: '', taxRate: 10, type: 'custom', divisionCode: '2' },
  { code: '30', taxRow: 30, name: '', taxRate: 10, type: 'custom', divisionCode: '2' },
  // ── 販管費（divisionCode:"2"）固定科目（続き） ──
  { code: '31', taxRow: 31, name: '雑費',           taxRate: 10, type: 'fixed',  divisionCode: '2' },
];

/**
 * コスト科目マスタをlocalStorageから取得（なければデフォルト）
 * @returns {Array}
 */
function getCostMaster() {
  try {
    const saved = localStorage.getItem(COST_MASTER_KEY);
    return saved ? JSON.parse(saved) : JSON.parse(JSON.stringify(DEFAULT_COST_MASTER));
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_COST_MASTER));
  }
}

/**
 * コスト科目マスタをlocalStorageに保存
 * @param {Array} list
 */
function saveCostMasterToStorage(list) {
  localStorage.setItem(COST_MASTER_KEY, JSON.stringify(list));
}

/* ── 税理士用CSV DL（共通ユーティリティ） ─────────────────── */

/**
 * 月プルダウンの選択肢を生成（直近24ヶ月分、新しい順）
 * @param {HTMLSelectElement} selectEl
 * @param {string} defaultValue 'YYYY-MM'
 */
function buildMonthOptions(selectEl, defaultValue) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  const now = new Date();
  const MIN = '2025-01';
  for (let i = 0; i < 24; i++) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (val < MIN) break;
    const opt = document.createElement('option');
    opt.value       = val;
    opt.textContent = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    selectEl.appendChild(opt);
  }
  if (defaultValue) selectEl.value = defaultValue;
}

/**
 * YYYY-MM の範囲から月リストを生成
 * @param {string} from 'YYYY-MM'
 * @param {string} to   'YYYY-MM'
 * @returns {string[]}
 */
function _buildMonthRange(from, to) {
  const months = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
    if (months.length > 24) break; // 最大2年分
  }
  return months;
}

/**
 * 税理士用CSV（期間指定）をダウンロード
 * @param {string} fromMonth 'YYYY-MM'
 * @param {string} toMonth   'YYYY-MM'
 * @param {HTMLButtonElement|null} btnEl ボタン要素（ローディング表示用）
 */
async function downloadTaxCSVByRange(fromMonth, toMonth, btnEl) {
  if (!fromMonth || !toMonth || fromMonth > toMonth) {
    alert('期間を正しく選択してください（開始月 ≤ 終了月）');
    return;
  }

  const origText = btnEl ? btnEl.textContent : '';
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '取得中...'; }

  try {
    const months = _buildMonthRange(fromMonth, toMonth);

    const results = await Promise.all(
      months.map(mo =>
        callGAS('getSummary', { month: mo })
          .then(r => (r && r.status === 'ok' && r.data) ? r.data : null)
          .catch(() => null)
      )
    );

    // コスト科目マスタ（確定申告行番号対応）
    const master = typeof getCostMaster === 'function' ? getCostMaster() : [];

    // 仕入原価科目（divisionCode:"1"）
    const cogsSubjects = master
      .filter(item => item.divisionCode === '1' && item.name)
      .map(item => ({ name: item.name, row: '-', key: null, div: 'cogs' }));

    // 販管費科目（divisionCode:"2"）
    const sgaSubjects = master
      .filter(item => item.divisionCode === '2' && item.name)
      .sort((a, b) => (a.taxRow ?? 99) - (b.taxRow ?? 99))
      .map(item => ({ name: item.name, row: item.taxRow ? `行${item.taxRow}` : '-', key: null, div: 'sga' }));

    const subjects = [
      { name: '売上（収入）金額', row: '行1',  key: 'sales'  },
      { name: '仕入金額合計',     row: '-',    key: 'cogs'   },
      ...cogsSubjects,
      { name: '粗利',             row: '-',    key: 'gross'  },
      { name: '販管費合計',       row: '-',    key: 'sga'    },
      ...sgaSubjects,
      { name: '経常利益',         row: '行43', key: 'profit' },
    ];

    // ヘッダー行
    const monthLabels = months.map(mo => {
      const [y, mm] = mo.split('-').map(Number);
      return `${y}年${mm}月`;
    });
    const header = ['科目', '行番号', ...monthLabels, '期間合計'];
    const csvRows = [header];

    subjects.forEach(s => {
      const monthly = results.map(d => {
        if (!d) return 0;
        if (s.key === 'sales')  return d.sales  || 0;
        if (s.key === 'cogs')   return d.cogs   || 0;
        if (s.key === 'gross')  return (d.sales || 0) - (d.cogs || 0);
        if (s.key === 'sga')    return d.sga    || 0;
        if (s.key === 'profit') return (d.sales || 0) - (d.cogs || 0) - (d.sga || 0);
        // 内訳科目：sgaBreakdown + cogsBreakdown から検索
        const breakdown = [...(d.sgaBreakdown || []), ...(d.cogsBreakdown || [])];
        const found = breakdown.find(it => it.name === s.name);
        return found ? (found.amount || 0) : 0;
      });
      const total = monthly.reduce((a, b) => a + b, 0);
      csvRows.push([s.name, s.row, ...monthly, total]);
    });

    // CSV文字列生成（BOM付きUTF-8）
    const csv  = csvRows
      .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const bom  = '\uFEFF';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `ultra_zaimu_${fromMonth.replace('-', '')}-${toMonth.replace('-', '')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

  } catch (e) {
    alert('ダウンロードに失敗しました: ' + e.message);
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = origText; }
  }
}
