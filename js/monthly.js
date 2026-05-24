/**
 * monthly.js — iPad 月次管理ページ（売上・コスト統合）
 * ------------------------------------------------------------
 * 入力ロジックの正本は sales.js / cost.js（MD §6-3-B 入力正本1本化）。
 * 本ファイルは「2カラムの器・売上/コストの大タブ切替・売上コスト統合一覧と集計」を担う。
 * sales.js / cost.js の後に読み込み、_loadIpadSalesData / _loadIpadCostData を
 * 月次統合再読込（moLoadMonthly）に差し替えることで、各フォームの submit 後フックを
 * 統合一覧の再描画へ接続する。
 * data-page="monthly" のときのみ動作する。スマホ・他ページには影響しない。
 */
'use strict';

let _moHistory = [];          // 売上・コスト統合（正規化済み）
let _moCurrentMonth = '';

/* ── submit後フックの差し替え ───────────────────────────────
   sales.js/cost.js のモーダル submit は is-ipad 時に
   _loadIpadSalesData(m) / _loadIpadCostData(m) を呼ぶ。
   monthly ページではこれらを統合再読込に上書きして横取りする。 */
if (document.body && document.body.dataset.page === 'monthly') {
  window._loadIpadSalesData = function () { moRelabelSubmit(); return moLoadMonthly(); };
  window._loadIpadCostData  = function () { moRelabelSubmit(); return moLoadMonthly(); };
}

/* submit 後に sales/cost が「登録する」へ戻したボタンラベルを発生日入りへ再同期 */
function moRelabelSubmit() {
  const pairs = [['#sm-sales-date', '#sm-sales-submit'], ['#sm-cost-date', '#sm-cost-submit']];
  pairs.forEach(([dSel, bSel]) => {
    const d = document.querySelector(dSel), b = document.querySelector(bSel);
    if (d && b) {
      const v = (d.value || '').replace(/-/g, '/');
      b.textContent = v ? `発生日 ${v}　登録する` : '登録する';
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.body.dataset.page !== 'monthly') return;
  if (!document.body.classList.contains('is-ipad')) return; // 月次管理はiPad専用UI

  // フォームHTMLが参照するマスタを先に用意（cost.js 側の共通取得）
  if (typeof getCostMaster === 'function') {
    try { costMaster = getCostMaster(); } catch (_) {}
  }
  if (typeof loadCostMasterFromGAS === 'function') loadCostMasterFromGAS();

  moMountForms();
  moBindTabs();
  moInitMonthFilter();
  moBindListFilters();
  moLoadMonthly();
});

/* ── 右カラム：両フォームを各コンテナへ注入＋初期化 ───────── */
async function moMountForms() {
  const salesBox = document.getElementById('mo-form-sales');
  if (salesBox && typeof _buildSalesFormBodyHTML === 'function') {
    salesBox.innerHTML = _buildSalesFormBodyHTML();
    if (typeof _initSalesFormInModal === 'function') await _initSalesFormInModal();
  }
  const costBox = document.getElementById('mo-form-cost');
  if (costBox && typeof _smCostBuildFormBodyHTML === 'function') {
    costBox.innerHTML = _smCostBuildFormBodyHTML();
    if (typeof _smCostInitFormInModal === 'function') _smCostInitFormInModal();
  }

  // iPad最適化：入力した部品が確定ブロックとして上部に積層していく「積層ステッパー」方式。
  // 選んだものがそのまま上に残り、確定ブロックをタップするとその項目だけ再編集できる。
  // 操作UI・税計算・登録は sales.js / cost.js を流用（入力正本1本・MD §6-3-B）。
  moSetupStepper('sales');
  moSetupStepper('cost');

  // 登録ボタンを「発生日 YYYY/MM/DD 登録する」ラベルに統一。
  moSyncSubmitLabel('#sm-sales-date', '#sm-sales-submit');
  moSyncSubmitLabel('#sm-cost-date',  '#sm-cost-submit');
}

/* 発生日入力の値を登録ボタンのラベルへ反映する。 */
function moSyncSubmitLabel(dateSel, btnSel) {
  const dateEl = document.querySelector(dateSel);
  const btn    = document.querySelector(btnSel);
  if (!dateEl || !btn) return;
  const update = () => {
    const v = (dateEl.value || '').replace(/-/g, '/');
    btn.textContent = v ? `発生日 ${v}　登録する` : '登録する';
  };
  dateEl.addEventListener('change', update);
  dateEl.addEventListener('input', update);
  update();
}

/* ── 積層ステッパー ──────────────────────────────────────
   各入力ステップを「未確定＝操作UI表示／確定＝1行ブロックで上部に残す」に切替。
   確定ブロックをタップするとその項目だけ操作UIに戻る（個別再編集）。 */
function moStepDefs(kind) {
  if (kind === 'sales') {
    return [
      { key: 'date',  label: '発生日', sectionSel: '#mo-form-sales .sm-sticky-header',
        value: () => { const v = document.getElementById('sm-sales-date')?.value; return v ? v.replace(/-/g,'/') : ''; } },
      { key: 'item',  label: '区分',   sectionSel: '#mo-form-sales .sales-sm-section:nth-of-type(1)',
        value: () => {
          const c = document.querySelector('#sm-sales-cards .radio-card.radio-card--checked-blue .radio-card__label');
          const t = document.querySelector('#mo-form-sales .sm-taxrate-chip.is-active');
          return c ? c.textContent.trim() + (t ? `（${t.textContent.trim()}）` : '') : '';
        } },
      { key: 'amount', label: '金額',  sectionSel: '#mo-form-sales .sales-sm-section:nth-of-type(3)',
        value: () => { const a = document.getElementById('sm-sales-amount')?.value; return a ? moFmtAmt(a) : ''; } },
    ];
  }
  return [
    { key: 'date',  label: '発生日', sectionSel: '#mo-form-cost .sm-sticky-header',
      value: () => { const v = document.getElementById('sm-cost-date')?.value; return v ? v.replace(/-/g,'/') : ''; } },
    { key: 'item',  label: '科目',   sectionSel: '#mo-form-cost .cost-sm-section:nth-of-type(1)',
      value: () => {
        const div = document.querySelector('#mo-form-cost .division-btn--active');
        const c   = document.querySelector('#sm-cost-item-cards .cost-sm-card.cost-sm-card--active .cost-sm-card__label');
        const t   = document.querySelector('#mo-form-cost .sm-taxrate-chip.is-active');
        if (!c) return '';
        return (div ? div.textContent.trim() + '／' : '') + c.textContent.trim() + (t ? `（${t.textContent.trim()}）` : '');
      } },
    { key: 'amount', label: '金額',  sectionSel: '#mo-form-cost .cost-sm-section:nth-of-type(3)',
      value: () => { const a = document.getElementById('sm-cost-amount')?.value; return a ? moFmtAmt(a) : ''; } },
  ];
}

function moSetupStepper(kind) {
  const formBox = document.getElementById(kind === 'sales' ? 'mo-form-sales' : 'mo-form-cost');
  if (!formBox) return;

  // 確定ブロックの積層コンテナをフォーム先頭に作る
  const stack = document.createElement('div');
  stack.className = 'mo-stack';
  formBox.insertBefore(stack, formBox.firstChild);

  const defs = moStepDefs(kind);
  // 各ステップの「確定済み」状態
  const confirmed = {};

  const render = () => {
    // 確定ブロックを描画
    stack.innerHTML = defs.map(d => {
      if (!confirmed[d.key]) return '';
      const val = d.value();
      return `<button type="button" class="mo-chip" data-step="${d.key}">
        <span class="mo-chip-k">${d.label}</span>
        <span class="mo-chip-v">${_moEsc(val || '未入力')}</span>
        <span class="mo-chip-edit">変更</span>
      </button>`;
    }).join('');

    // 各セクションの表示制御：確定済みは隠す・未確定は表示
    defs.forEach(d => {
      const sec = document.querySelector(d.sectionSel);
      if (sec) sec.style.display = confirmed[d.key] ? 'none' : '';
    });
  };

  // 確定ブロックのタップ＝そのステップを再編集（確定解除して操作UI再表示）
  stack.addEventListener('click', (e) => {
    const chip = e.target.closest('.mo-chip');
    if (!chip) return;
    confirmed[chip.dataset.step] = false;
    render();
  });

  // 各ステップの操作が起きたら確定して積む。ただし金額など自由入力は自動確定しない
  // （入力途中で操作UIが消えるのを防ぐ）。自動確定するのは単発タップで決まるステップのみ。
  const autoConfirmKeys = defs.filter(d => d.key !== 'amount').map(d => d.key);
  const checkConfirm = () => {
    defs.forEach(d => {
      if (confirmed[d.key]) return;
      if (!autoConfirmKeys.includes(d.key)) return; // 金額は自動確定しない
      const v = d.value();
      if (v) confirmed[d.key] = true;
    });
    render();
  };
  formBox.addEventListener('click', () => setTimeout(checkConfirm, 0));
  formBox.addEventListener('input', () => setTimeout(checkConfirm, 0));
  const mo = new MutationObserver(() => setTimeout(checkConfirm, 0));
  mo.observe(formBox, { subtree: true, attributes: true, attributeFilter: ['class', 'value'] });

  render();
}

function moFmtAmt(v) {
  const n = parseInt(String(v ?? '').replace(/[^0-9]/g, ''), 10);
  return '¥' + (isNaN(n) ? 0 : n).toLocaleString('ja-JP');
}

/* ── 売上／コスト 大タブ切替 ────────────────────────────── */
function moBindTabs() {
  document.querySelectorAll('.ipad-input-tabs .ipad-tab[data-motab]').forEach(btn => {
    btn.addEventListener('click', () => moSwitchTab(btn.dataset.motab));
  });
}

function moSwitchTab(tab) {
  document.querySelectorAll('.ipad-input-tabs .ipad-tab[data-motab]').forEach(btn => {
    btn.classList.toggle('ipad-tab--active', btn.dataset.motab === tab);
  });
  const salesBox = document.getElementById('mo-form-sales');
  const costBox  = document.getElementById('mo-form-cost');
  if (salesBox) salesBox.style.display = tab === 'sales' ? '' : 'none';
  if (costBox)  costBox.style.display  = tab === 'cost'  ? '' : 'none';
}

/* ── 月フィルタ（直近12ヶ月） ──────────────────────────── */
function moInitMonthFilter() {
  const sel = document.getElementById('mo-filter-month');
  if (!sel) return;
  const now = new Date();
  _moCurrentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  for (let i = 0; i < 12; i++) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = `${d.getFullYear()}年${d.getMonth()+1}月`;
    sel.appendChild(opt);
  }
  sel.value = _moCurrentMonth;
  sel.addEventListener('change', () => { _moCurrentMonth = sel.value; moLoadMonthly(); });
}

function moBindListFilters() {
  document.getElementById('mo-filter-kind')?.addEventListener('change', moRenderList);
  document.getElementById('mo-filter-state')?.addEventListener('change', moRenderList);
}

/* ── 統合読み込み（売上＋コスト） ──────────────────────── */
async function moLoadMonthly() {
  const month = document.getElementById('mo-filter-month')?.value || _moCurrentMonth;
  _moCurrentMonth = month;

  const tbody = document.getElementById('mo-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="mo-empty">読み込み中...</td></tr>';

  try {
    const [salesRes, costRes] = await Promise.all([
      callGAS('getHistory', { type: 'sales', month }).catch(() => null),
      callGAS('getHistory', { type: 'cost',  month }).catch(() => null),
    ]);

    const salesRows = (salesRes?.status === 'ok' && Array.isArray(salesRes.data)) ? salesRes.data : [];
    const costRows  = (costRes?.status  === 'ok' && Array.isArray(costRes.data))  ? costRes.data  : [];

    _moHistory = [
      ...salesRows.map(r => moNormalize(r, 'sales')),
      ...costRows.map(r  => moNormalize(r, 'cost')),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)));

    moRenderBreakdown();
    moRenderList();
  } catch {
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="mo-empty">読み込みエラー</td></tr>';
  }
}

/* 行を共通スキーマに正規化。
   kind: 'sales' | 'purchase'（仕入原価・D列=1） | 'sga'（販管費・D列=2）
   状況: 売掛（売上未収）/ 買掛（コスト未払）/ 空 */
function moNormalize(r, src) {
  const amount = r.taxIncluded ?? r.amount ?? 0;
  const date   = String(r.date || '');
  const memo   = r.memo || '';

  if (src === 'sales') {
    const name = r.miscItemName
      ? `諸口：${r.miscItemName}`
      : (r.service || r.serviceName || r.item || r.itemName || '—');
    return {
      src, kind: 'sales', kindLabel: '売上',
      date, item: name, memo, amount,
      state: (r.uncollected || r.unpaid) ? '売掛' : '',
      locked: !!r.locked, raw: r,
    };
  }

  // cost：区分コードで仕入原価／販管費を判定
  const div = String(r.divisionCode ?? r.division ?? '');
  const isPurchase = div === '1';
  const name = r.miscItemName
    ? `諸口：${r.miscItemName}`
    : (r.itemName || r.item || r.service || r.serviceName || '—');
  return {
    src, kind: isPurchase ? 'purchase' : 'sga',
    kindLabel: isPurchase ? '仕入原価' : '販管費',
    date, item: name, memo, amount,
    state: (r.unpaid || r.uncollected) ? '買掛' : '',
    locked: !!r.locked, raw: r,
  };
}

/* ── 科目別集計＋区分トータル（▼で内訳をアコーディオン展開） ─ */
function moRenderBreakdown() {
  const box = document.getElementById('mo-breakdown');
  if (!box) return;

  const groups = { sales: {}, purchase: {}, sga: {} };
  const totals = { sales: 0, purchase: 0, sga: 0 };
  _moHistory.forEach(r => {
    groups[r.kind][r.item] = (groups[r.kind][r.item] || 0) + r.amount;
    totals[r.kind] += r.amount;
  });

  const block = (label, kind) => {
    const items = Object.entries(groups[kind]).sort((a, b) => b[1] - a[1]);
    const hasItems = items.length > 0;
    const rows = items.map(([name, amt]) =>
      `<div class="mo-bd-row"><span class="mo-bd-name">${_moEsc(name)}</span>` +
      `<span class="mo-bd-amt">${formatYen(amt)}</span></div>`
    ).join('');
    return `<div class="mo-bd-group" data-kind="${kind}">
      <button type="button" class="mo-bd-head" ${hasItems ? '' : 'disabled'} aria-expanded="false">
        <span class="mo-bd-caret" aria-hidden="true">▶</span>
        <span class="mo-bd-label">${label}</span>
        <span class="mo-bd-total">${formatYen(totals[kind])}</span>
      </button>
      <div class="mo-bd-body" hidden>${rows || '<div class="mo-bd-row mo-bd-row--empty">内訳なし</div>'}</div>
    </div>`;
  };

  box.innerHTML = block('売上', 'sales') + block('仕入原価', 'purchase') + block('販管費', 'sga');

  box.querySelectorAll('.mo-bd-head').forEach(head => {
    head.addEventListener('click', () => {
      if (head.hasAttribute('disabled')) return;
      const body = head.parentElement.querySelector('.mo-bd-body');
      const open = head.getAttribute('aria-expanded') === 'true';
      head.setAttribute('aria-expanded', open ? 'false' : 'true');
      head.querySelector('.mo-bd-caret').textContent = open ? '▶' : '▼';
      if (body) body.hidden = open;
    });
  });
}

/* ── 統合一覧テーブル ─────────────────────────────────── */
function moRenderList() {
  const tbody = document.getElementById('mo-tbody');
  if (!tbody) return;

  const kindVal  = document.getElementById('mo-filter-kind')?.value  || 'all';
  const stateVal = document.getElementById('mo-filter-state')?.value || 'all';

  let rows = _moHistory;
  if (kindVal !== 'all')   rows = rows.filter(r => r.kind === kindVal);
  if (stateVal === 'unpaid') rows = rows.filter(r => r.state !== '');

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="mo-empty">データなし</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const date  = r.date.replace(/(\d{4})-(\d{2})-(\d{2})/, '$2/$3');
    const kCls  = r.kind === 'sales' ? 'mo-tag--sales'
                : r.kind === 'purchase' ? 'mo-tag--purchase' : 'mo-tag--sga';
    const stCls = r.state === '売掛' ? 'mo-state--ar'
                : r.state === '買掛' ? 'mo-state--ap' : '';
    const lock  = r.locked ? ' 🔒' : '';
    return `<tr class="mo-row">
      <td class="mo-td-date">${date}</td>
      <td class="mo-td-kind"><span class="mo-tag ${kCls}">${r.kindLabel}</span></td>
      <td class="mo-td-item">${_moEsc(r.item)}</td>
      <td class="mo-td-memo">${_moEsc(r.memo)}</td>
      <td class="mo-td-amount">${formatYen(r.amount)}</td>
      <td class="mo-td-state"><span class="mo-state ${stCls}">${r.state}</span>${lock}</td>
      <td class="mo-td-edit"></td>
    </tr>`;
  }).join('');
}

function _moEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
