/* pc-common.js — PC版共通：サイドバー生成・ヘッダー時刻・直近履歴 */
'use strict';

/**
 * PC版サイドバー4区分構造（§3-9-3）
 *   - type: 'item'    単独メニュー（区分外・例：ホーム）
 *   - type: 'section' 区分見出し＋配下メニュー
 *
 * children の各項目：
 *   - href            遷移先
 *   - label           表示ラベル
 *   - visibilityFlag  featureVisibility のキー名（無ければ常時表示）
 *   - placeholder     true なら遷移せずトースト表示（実装予定機能）
 *
 * 4区分定義（§3-9-3 §1-3）：
 *   ① 売上・仕入原価     sales.html（案件粗利タブはタブ内で実装）
 *   ② 雇用・委託・外注   clockin.html / 月末経理プレースホルダ
 *   ③ 履歴・修正         history.html
 *   ④ 設定               settings.html
 */
const PC_NAV = [
  { type: 'item', href: 'index.html', label: 'ホーム' },
  {
    type: 'section',
    label: '売上・仕入原価',
    children: [
      { href: 'sales.html', label: '売上・コスト入力' }
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

  const html = `
    <aside class="pc-sidebar">
      <div class="pc-sidebar__logo">ウルトラZAIMUくん</div>
      <nav class="pc-nav">${navHtml}</nav>
      <div class="pc-recent" id="pc-recent">
        <div class="pc-recent__title">直近入力履歴</div>
        <div id="pc-recent-list" class="text-muted" style="font-size:11px;">読み込み中...</div>
      </div>
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

/* ── 直近入力履歴 ──────────────────────────── */
async function pcLoadRecent() {
  const el = document.getElementById('pc-recent-list');
  if (!el) return;
  const month = new Date().toISOString().slice(0,7);
  try {
    const res = await callGAS('getHistory', { month }).catch(() => null);
    if (!res || res.status !== 'ok' || !Array.isArray(res.data)) {
      el.textContent = '履歴なし';
      return;
    }
    const items = res.data
      .filter(it => it.type === 'sales' || it.type === 'cost')
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 10);

    if (items.length === 0) { el.textContent = '履歴なし'; return; }

    el.innerHTML = items.map(it => {
      const tag = it.type === 'sales' ? 'sales' : 'cost';
      const label = it.type === 'sales' ? '売上' : 'コスト';
      const amt = formatYen(Number(it.amount) || 0);
      return `
        <div class="pc-recent__item">
          <div class="pc-recent__row1">
            <span>${escHtml(it.date || '')}</span>
            <span>${amt}</span>
          </div>
          <div class="pc-recent__row2">
            <span class="pc-recent__tag pc-recent__tag--${tag}">${label}</span>
            ${escHtml(it.itemName || it.divisionName || '')}
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    el.textContent = '取得失敗';
  }
}

/* ── PC版ページブート ──────────────────────── */
function pcBootstrap(activeHref, title) {
  const app = document.getElementById('pc-app');
  if (!app) return;
  app.insertAdjacentHTML('afterbegin', pcRenderSidebar(activeHref));
  const main = document.getElementById('pc-main');
  if (main) main.insertAdjacentHTML('afterbegin', pcRenderHeader(title));
  pcStartClock();
  pcLoadRecent();
  pcBindPlaceholders();
}
