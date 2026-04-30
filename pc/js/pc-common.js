/* pc-common.js — PC版共通：サイドバー生成・ヘッダー時刻 */
'use strict';

/**
 * PC版サイドバー5項目構造（戦略思想§3-9-3 経営判断UX大原則・取引一覧統合化）
 *   - type: 'item'    単独メニュー（区分外・例：ホーム）
 *   - type: 'section' 区分見出し＋配下メニュー
 *
 * children の各項目：
 *   - href            遷移先
 *   - label           表示ラベル
 *   - visibilityFlag  featureVisibility のキー名（無ければ常時表示）
 *   - placeholder     true なら遷移せずトースト表示（実装予定機能）
 *
 * 5項目定義：
 *   ① ホーム（独立メニュー）
 *   ② 売上・仕入原価・販管費 → 取引一覧（transactions.html）に統合
 *   ③ 雇用・委託・外注       入店記録 / 月末経理プレースホルダ
 *   ④ 履歴・修正             history.html
 *   ⑤ 設定                   settings.html
 */
const PC_NAV = [
  { type: 'item', href: 'index.html', label: 'ホーム' },
  {
    type: 'section',
    label: '売上・仕入原価・販管費',
    children: [
      { href: 'transactions.html', label: '取引一覧' }
    ]
  },
  {
    type: 'section',
    label: '雇用・委託・外注',
    children: [
      { href: 'clockin.html', label: '入店記録', visibilityFlag: 'clockin_menu' },
      { href: '#payroll-placeholder', label: '月末経理（実装予定）', visibilityFlag: 'payroll_menu', placeholder: true }
    ]
  },
  {
    type: 'section',
    label: '履歴・修正',
    children: [
      { href: 'history.html', label: '履歴・修正' }
    ]
  },
  {
    type: 'section',
    label: '設定',
    children: [
      { href: 'settings.html', label: '設定' }
    ]
  }
];

function pcRenderSidebar(activeHref) {
  // featureVisibility 取得（app.js の getFeatureVisibility を参照）
  const fv = (typeof getFeatureVisibility === 'function')
    ? getFeatureVisibility()
    : { project_grossprofit: false, clockin_menu: true, payroll_menu: false };

  const navHtml = PC_NAV.map(n => {
    if (n.type === 'item') {
      const cls = n.href === activeHref ? 'active' : '';
      return `<a href="${n.href}" class="pc-nav__link ${cls}">${escHtml(n.label)}</a>`;
    }
    if (n.type === 'section') {
      const childrenHtml = (n.children || [])
        .filter(c => !c.visibilityFlag || fv[c.visibilityFlag] !== false)
        .map(c => {
          if (c.placeholder) {
            return `<a href="#" class="pc-nav__link pc-sidebar__nav-item--placeholder" data-pc-placeholder="1">${escHtml(c.label)}</a>`;
          }
          const cls = c.href === activeHref ? 'active' : '';
          return `<a href="${c.href}" class="pc-nav__link ${cls}">${escHtml(c.label)}</a>`;
        }).join('');
      // children が全て非表示の場合は section ごと非表示
      if (!childrenHtml) return '';
      return `
        <div class="pc-sidebar__section-label">${escHtml(n.label)}</div>
        <div class="pc-sidebar__section-children">${childrenHtml}</div>
      `;
    }
    return '';
  }).join('');

  // 直近入力履歴サイドバーは廃止（取引一覧画面が同等機能を担うため）
  const html = `
    <aside class="pc-sidebar">
      <div class="pc-sidebar__logo">ウルトラZAIMUくん</div>
      <nav class="pc-nav">${navHtml}</nav>
    </aside>
  `;
  return html;
}

/**
 * プレースホルダ項目クリック時の挙動：遷移せずに通知表示
 */
function pcBindPlaceholders() {
  document.querySelectorAll('[data-pc-placeholder="1"]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      const msg = '実装予定の機能です';
      if (typeof showToast === 'function') {
        showToast(msg, 'info');
      } else {
        alert(msg);
      }
    });
  });
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
  pcBindPlaceholders();
}
