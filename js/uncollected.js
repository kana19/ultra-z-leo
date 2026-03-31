/**
 * ウルトラ財務くん LEO版 PWA — uncollected.js
 * 未収・買掛け一覧画面ロジック
 */

'use strict';

/* ── ダミーデータ（本番はcallGAS('getUncollected')で取得） ─ */
let DUMMY_DATA = [
  {
    id:        1,
    sheetName: '売上',
    rowIndex:  15,
    type:      'uncollected',
    date:      '2026-03-15',
    itemName:  'テーブルチャージ',
    amount:    45_000,
    memo:      '田中様 4名',
  },
  {
    id:        2,
    sheetName: '売上',
    rowIndex:  22,
    type:      'uncollected',
    date:      '2026-03-20',
    itemName:  'ボトルキープ',
    amount:    28_000,
    memo:      '鈴木様',
  },
  {
    id:        3,
    sheetName: '売上',
    rowIndex:  30,
    type:      'uncollected',
    date:      '2026-03-22',
    itemName:  'カラオケ',
    amount:    15_000,
    memo:      '',
  },
  {
    id:        4,
    sheetName: 'コスト',
    rowIndex:  8,
    type:      'payable',
    date:      '2026-03-10',
    itemName:  '酒類・飲料',
    amount:    85_000,
    memo:      '〇〇酒販 月末払い',
  },
  {
    id:        5,
    sheetName: 'コスト',
    rowIndex:  12,
    type:      'payable',
    date:      '2026-03-18',
    itemName:  '光熱費',
    amount:    42_000,
    memo:      '電気代3月分',
  },
];

/* ── 状態 ────────────────────────────────────────────────── */
let openFormId = null; // 現在展開中の消込フォームのID

/* ── 初期化 ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  renderAll();
});

/* ── 全体描画 ────────────────────────────────────────────── */
function renderAll() {
  const uncollected = DUMMY_DATA.filter(d => d.type === 'uncollected');
  const payable     = DUMMY_DATA.filter(d => d.type === 'payable');

  renderSummary(uncollected, payable);
  renderList('uncollected-list', uncollected, 'uncollected');
  renderList('payable-list',     payable,     'payable');
  renderBadge('uncollected-badge', uncollected.length);
  renderBadge('payable-badge',     payable.length);
}

/* ── サマリーカード ──────────────────────────────────────── */
function renderSummary(uncollected, payable) {
  const totalUC = uncollected.reduce((s, d) => s + d.amount, 0);
  const totalPY = payable.reduce((s, d) => s + d.amount, 0);

  const ucEl = document.getElementById('total-uncollected');
  const pyEl = document.getElementById('total-payable');
  if (ucEl) ucEl.textContent = formatYen(totalUC);
  if (pyEl) pyEl.textContent = formatYen(totalPY);
}

/* ── バッジ件数 ──────────────────────────────────────────── */
function renderBadge(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = `${count}件`;
  el.style.display = count > 0 ? 'inline' : 'none';
}

/* ── リスト描画 ──────────────────────────────────────────── */
function renderList(containerId, items, type) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = `<div class="uc-empty">現在、${type === 'uncollected' ? '未収' : '未払い'}はありません</div>`;
    return;
  }

  container.innerHTML = items.map(item => buildItemHTML(item, type)).join('');
}

/* ── アイテムHTML生成 ────────────────────────────────────── */
function buildItemHTML(item, type) {
  const dateStr = formatDate(item.date);
  const isOpen  = openFormId === item.id;
  const btnLabel = type === 'uncollected' ? '入金消込' : '支払消込';
  const confirmLabel = type === 'uncollected' ? '入金消込を確定する' : '支払消込を確定する';
  const formTitle    = type === 'uncollected' ? '入金情報を入力してください' : '支払情報を入力してください';
  const dateLabel    = type === 'uncollected' ? '入金日' : '支払日';
  const amountLabel  = type === 'uncollected' ? '入金額' : '支払額';

  return `
    <div class="uc-item" id="uc-item-${item.id}">
      <div class="uc-item-main">
        <div class="uc-item-info">
          <div class="uc-item-name">${escHtml(item.itemName)}</div>
          <div class="uc-item-meta">${escHtml(dateStr)}${item.memo ? '　' + escHtml(item.memo) : ''}</div>
        </div>
        <div class="uc-item-right">
          <span class="uc-item-amount uc-item-amount--${type}">
            ${formatYen(item.amount)}
          </span>
          <button class="uc-reconcile-btn uc-reconcile-btn--${type} ${isOpen ? 'active' : ''}"
                  type="button"
                  onclick="toggleReconcileForm(${item.id})"
                  aria-expanded="${isOpen}">
            ${isOpen ? '▲ 閉じる' : btnLabel}
          </button>
        </div>
      </div>

      <!-- 消込インラインフォーム -->
      <div class="uc-reconcile-form ${isOpen ? 'uc-reconcile-form--open' : ''}"
           id="reconcile-form-${item.id}"
           aria-hidden="${!isOpen}">
        <p style="font-size:12px;color:var(--uz-muted);margin-bottom:10px;">
          ${escHtml(formTitle)}
        </p>
        <div class="uc-reconcile-form__row">
          <div class="uc-reconcile-form__field">
            <label class="uc-reconcile-form__label" for="paid-date-${item.id}">
              ${escHtml(dateLabel)}
            </label>
            <input type="date"
                   id="paid-date-${item.id}"
                   class="uc-reconcile-input"
                   value="${todayStr()}"
                   aria-label="${escHtml(dateLabel)}">
          </div>
          <div class="uc-reconcile-form__field">
            <label class="uc-reconcile-form__label" for="paid-amount-${item.id}">
              ${escHtml(amountLabel)}
            </label>
            <input type="text"
                   id="paid-amount-${item.id}"
                   class="uc-reconcile-input"
                   inputmode="numeric"
                   pattern="[0-9]*"
                   value="${item.amount}"
                   aria-label="${escHtml(amountLabel)}">
          </div>
        </div>
        <button class="uc-reconcile-confirm-btn uc-reconcile-confirm-btn--${type}"
                type="button"
                onclick="handleReconcile(${item.id}, '${type}')">
          ${escHtml(confirmLabel)}
        </button>
      </div>
    </div>
  `;
}

/* ── 消込フォーム 開閉 ───────────────────────────────────── */
function toggleReconcileForm(id) {
  openFormId = openFormId === id ? null : id;
  renderAll();

  // 展開時はフォームにスクロール
  if (openFormId === id) {
    setTimeout(() => {
      const formEl = document.getElementById(`reconcile-form-${id}`);
      formEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }
}

/* ── 消込処理 ────────────────────────────────────────────── */
async function handleReconcile(id, type) {
  const item      = DUMMY_DATA.find(d => d.id === id);
  if (!item) return;

  const paidDate   = document.getElementById(`paid-date-${id}`)?.value || '';
  const paidAmtRaw = document.getElementById(`paid-amount-${id}`)?.value.replace(/,/g, '') || '0';
  const paidAmount = parseInt(paidAmtRaw) || 0;

  // バリデーション
  if (!paidDate)       return showToast('日付を入力してください', 'error');
  if (paidAmount <= 0) return showToast('金額を入力してください', 'error');

  const confirmMsg = type === 'uncollected'
    ? `${item.itemName}（${formatYen(item.amount)}）の入金消込を確定しますか？`
    : `${item.itemName}（${formatYen(item.amount)}）の支払消込を確定しますか？`;

  if (!confirm(confirmMsg)) return;

  const btn = document.querySelector(`#uc-item-${id} .uc-reconcile-confirm-btn`);
  if (btn) { btn.disabled = true; btn.textContent = '処理中...'; }

  try {
    // ★ GAS未接続期間はダミー動作
    // await callGAS('reconcile', {
    //   sheetName: item.sheetName,
    //   rowIndex:  item.rowIndex,
    //   paidAmount,
    //   paidDate,
    // });
    await new Promise(r => setTimeout(r, 600));

    // ローカルデータから削除
    DUMMY_DATA = DUMMY_DATA.filter(d => d.id !== id);
    openFormId = null;

    renderAll();
    const msg = type === 'uncollected' ? '入金消込を完了しました ✓' : '支払消込を完了しました ✓';
    showToast(msg, 'success');

  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '消込を確定する'; }
    showToast('消込に失敗しました：' + e.message, 'error');
  }
}

/* ── 日付フォーマット ────────────────────────────────────── */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${y}/${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')}`;
}

/* ── XSSエスケープ ───────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
