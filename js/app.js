/**
 * ウルトラ財務くん LEO版 PWA — app.js
 * 共通ロジック・GAS通信
 */

'use strict';

/* ── GAS設定 ─────────────────────────────────────────────── */
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwy8WQIb-WYK-FDq2CKcjvJ8BSkEk8Ew0K-b0s05qoyi9Q7-quaatgI9L_vkU7W3Xd93g/exec';

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
  { code: 'C1', taxRow: null, name: '仕入（酒類・食材）', taxRate: 8,  type: 'fixed',  divisionCode: '1' },
  { code: 'C2', taxRow: null, name: '仕入（消耗品）',     taxRate: 10, type: 'fixed',  divisionCode: '1' },
  { code: 'C3', taxRow: null, name: '仕入（その他）',     taxRate: 10, type: 'fixed',  divisionCode: '1' },
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
