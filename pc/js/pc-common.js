/* pc-common.js — PC版共通：サイドバー生成・ヘッダー時刻 */
'use strict';

// PC版サイドバーメニュー定義（戦略思想メモ§3-9-3 確定の4項目構造）
// 順序・href・ラベルはここで一元管理する
const PC_NAV = [
  { href: 'monthly.html',    label: '月次管理',  icon: '○' },
  { href: 'projects.html',   label: '案件管理',  icon: '★' },
  { href: 'attendance.html', label: '出勤管理',  icon: '👤', visibilityKey: 'attendance_menu' },
  { href: 'settings.html',   label: '設定',      icon: '⚙' }
];

function pcRenderSidebar(activeHref) {
  // featureVisibility 取得（app.js の getFeatureVisibility を参照）
  const fv = (typeof getFeatureVisibility === 'function')
    ? getFeatureVisibility()
    : { clockin_menu: true, payroll_menu: false };

  // 業態別ラベル取得（app.js の deriveUILabels を参照）
  const uiLabels = (typeof deriveUILabels === 'function') ? deriveUILabels() : {};

  const navHtml = PC_NAV
    .filter(n => !n.visibilityKey || fv[n.visibilityKey] !== false)
    .map(n => {
      const cls = n.href === activeHref ? 'pc-nav__link active' : 'pc-nav__link';
      const labelText = (n.uiLabelKey && uiLabels[n.uiLabelKey]) ? uiLabels[n.uiLabelKey] : n.label;
      const iconHtml = n.icon ? `<span class="pc-nav__icon" aria-hidden="true">${n.icon}</span>` : '';
      return `<a href="${n.href}" class="${cls}">${iconHtml}<span>${escHtml(labelText)}</span></a>`;
    }).join('');

  // 店名ロゴ（クリックで損益概観 index.html へ遷移）
  const html = `
    <aside class="pc-sidebar">
      <a href="index.html" class="pc-sidebar-logo">
        <span class="pc-sidebar-logo-text">ウルトラZAIMUくん</span>
        <span class="pc-sidebar-logo-sub">LEO</span>
      </a>
      <nav class="pc-nav">${navHtml}</nav>
    </aside>
  `;
  return html;
}

function pcRenderHeader(title) {
  const now = new Date();
  const storeName = (typeof localStorage !== 'undefined' && localStorage.getItem('uz_store_name')) || 'LEO';
  return `
    <header class="pc-header">
      <div class="pc-header__title">${title}</div>
      <div class="pc-header__meta">
        <span>${escHtml(storeName)}</span>
        <span style="margin-left:16px;" id="pc-clock">${fmtDateTime(now)}</span>
      </div>
    </header>
  `;
}

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}

function fmtDateTime(d) {
  const W = ['日','月','火','水','木','金','土'];
  const y = d.getFullYear(), m = d.getMonth()+1, day = d.getDate();
  const h = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  return `${y}/${m}/${day}(${W[d.getDay()]}) ${h}:${mm}`;
}

function pcStartClock() {
  setInterval(() => {
    const el = document.getElementById('pc-clock');
    if (el) el.textContent = fmtDateTime(new Date());
  }, 30000);
}

/* ── PC版ページブート ──────────────────────── */
function pcBootstrap(activeHref, title) {
  const app = document.getElementById('pc-app');
  if (!app) return;
  app.insertAdjacentHTML('afterbegin', pcRenderSidebar(activeHref));
  const main = document.getElementById('pc-main');
  if (main) main.insertAdjacentHTML('afterbegin', pcRenderHeader(title));
  pcStartClock();
}

/* ──────────────────────────────────────────────────────────
   削除確認モーダル（指示書15・月次管理＋案件管理 共通）
   戦略思想§1-5-2 AI自動確定禁止：必ず「削除ボタン→ダイアログ→削除する」の3ステップ
   呼び出し元は monthly.html / projects.html に同じ ID で配置されたモーダルDOMを共有
   options:
     - sheetName : '売上' or 'コスト'
     - rowIndex  : 対象行番号
     - date / type / subject / amount / memo : 対象行の表示情報
     - isProject (bool) / linkedCostCount (number) : 警告メッセージ制御
     - modalTitle (string・省略時 '行を削除しますか？')
     - onConfirm (async function) : 削除確定時に呼ばれる（実 GAS 呼び出し＋再描画は呼び出し元の責務）
   ────────────────────────────────────────────────────────── */
let _pcDeleteModalState = null;

function _pcFmtYen(n) {
  const v = Number(n);
  if (!isFinite(v)) return '0';
  return v.toLocaleString('ja-JP');
}

function openDeleteConfirmModal(options) {
  if (!options) return;
  const modal = document.getElementById('pc-delete-confirm-modal');
  if (!modal) return;
  const titleEl = document.getElementById('pc-delete-confirm-title');
  const targetEl = document.getElementById('pc-delete-target-info');
  const warnEl = document.getElementById('pc-delete-warning');
  const errEl = document.getElementById('pc-delete-confirm-error');
  const confirmBtn = document.getElementById('pc-delete-confirm-btn');

  if (titleEl) titleEl.textContent = options.modalTitle || '行を削除しますか？';

  // 対象情報の組み立て
  if (targetEl) {
    const date = escHtml(options.date || '');
    const type = escHtml(options.type || '');
    const subject = escHtml(options.subject || '');
    const amount = _pcFmtYen(options.amount || 0);
    const memo = String(options.memo || '').trim();
    const memoHtml = memo
      ? `<div class="pc-delete-target-info__memo">メモ：${escHtml(memo)}</div>`
      : '';
    targetEl.innerHTML = `
      <div class="pc-delete-target-info__label">削除対象</div>
      <div class="pc-delete-target-info__main">${date} / ${type} / ${subject} / ¥${amount}</div>
      ${memoHtml}
    `;
  }

  // 警告メッセージ：売上案件・経費紐付けあり時のみ表示
  if (warnEl) {
    if (options.isProject && Number(options.linkedCostCount) > 0) {
      warnEl.textContent = `⚠ この売上は案件化されています。紐付けされた${Number(options.linkedCostCount)}件の経費の紐付けは自動的に解除されます（経費自体は月次管理に残ります）。`;
      warnEl.hidden = false;
    } else {
      warnEl.textContent = '';
      warnEl.hidden = true;
    }
  }

  if (errEl) { errEl.hidden = true; errEl.textContent = ''; }

  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.style.opacity = '';
    confirmBtn.style.cursor = '';
  }

  // 既存リスナーがあれば一旦破棄してから登録（多重呼び出し防止）
  _pcCloseDeleteConfirmModalCleanup();

  const onClick = async (e) => {
    const action = e.target?.dataset?.action;
    if (action === 'cancel') {
      closeDeleteConfirmModal();
    } else if (action === 'confirm') {
      if (typeof options.onConfirm === 'function') {
        // 二重実行防止
        if (confirmBtn) {
          confirmBtn.disabled = true;
          confirmBtn.style.opacity = '0.45';
          confirmBtn.style.cursor = 'not-allowed';
        }
        try {
          await options.onConfirm();
        } catch (err) {
          showDeleteConfirmError(err && err.message ? err.message : String(err));
          if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.style.opacity = '';
            confirmBtn.style.cursor = '';
          }
        }
      } else {
        closeDeleteConfirmModal();
      }
    }
  };
  const onKeydown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeDeleteConfirmModal(); }
  };

  modal.addEventListener('click', onClick);
  document.addEventListener('keydown', onKeydown);
  _pcDeleteModalState = { modal, onClick, onKeydown };

  modal.hidden = false;
}

function closeDeleteConfirmModal() {
  const modal = document.getElementById('pc-delete-confirm-modal');
  if (modal) modal.hidden = true;
  _pcCloseDeleteConfirmModalCleanup();
}

function _pcCloseDeleteConfirmModalCleanup() {
  if (!_pcDeleteModalState) return;
  const { modal, onClick, onKeydown } = _pcDeleteModalState;
  if (modal && onClick) modal.removeEventListener('click', onClick);
  if (onKeydown) document.removeEventListener('keydown', onKeydown);
  _pcDeleteModalState = null;
}

function showDeleteConfirmError(msg) {
  const errEl = document.getElementById('pc-delete-confirm-error');
  if (errEl) { errEl.textContent = msg || ''; errEl.hidden = !msg; }
}
