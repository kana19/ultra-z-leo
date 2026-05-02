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
