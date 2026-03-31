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

/* ── ページナビゲーション ────────────────────────────────── */
/**
 * 指定URLに遷移
 * @param {string} url
 */
function navigate(url) {
  window.location.href = url;
}
