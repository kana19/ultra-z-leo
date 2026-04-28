/* pc-common.js — PC版共通：サイドバー生成・ヘッダー時刻・直近履歴 */
'use strict';

const PC_NAV = [
  { href: 'index.html',    label: 'ホーム' },
  { href: 'sales.html',    label: '売上・コスト入力' },
  { href: 'clockin.html',  label: '入店記録' },
  { href: 'history.html',  label: '履歴・修正' },
  { href: 'settings.html', label: '設定' },
];

function pcRenderSidebar(activeHref) {
  const navHtml = PC_NAV.map(n =>
    `<a href="${n.href}" class="${n.href === activeHref ? 'active' : ''}">${n.label}</a>`
  ).join('');

  const html = `
    <aside class="pc-sidebar">
      <div class="pc-sidebar__logo">ウルトラ財務くん</div>
      <nav class="pc-nav">${navHtml}</nav>
      <div class="pc-recent" id="pc-recent">
        <div class="pc-recent__title">直近入力履歴</div>
        <div id="pc-recent-list" class="text-muted" style="font-size:11px;">読み込み中...</div>
      </div>
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
}
