/**
 * uz-numpad.js — アプリ内蔵テンキー（金額入力・OSキーボードを呼ばない）
 * ------------------------------------------------------------------
 * 02_画面仕様.md §5-10。売上・コストの金額入力は単一系統を共有するため、
 * 本コンポーネントは sales.js / cost.js を改変せず自己装着する。
 *
 * 対象欄: .sales-sm-amount-input / .cost-sm-amount-input / [data-uz-numpad]
 *   - 装着時に readonly + inputmode=none を付与し OSキーボードを開かせない。
 *   - キー入力は「生の数字」を input.value に書いて input イベントを発火する。
 *     これにより既存の桁区切り整形（_bindSalesAmountFormatting /
 *     _smCostBindAmountInput）と内消費税再計算（_smRefreshTaxDisplay /
 *     _smCostRecalcTaxMemo）がそのまま動作する。
 *
 * 適用面: スマホ売上/コストモーダル・iPad月次管理右カラム・iPad売上/コストページ。
 * SheetModal / iPadパネルは金額欄を動的注入するため、委譲 + MutationObserver で捕捉する。
 */
'use strict';

(function () {
  const SELECTOR = '.sales-sm-amount-input, .cost-sm-amount-input, [data-uz-numpad]';
  const MAXLEN = 12;

  let _activeInput = null;
  let _pad = null;

  function _isTarget(el) {
    return el && el.matches && el.matches(SELECTOR);
  }

  /* 金額欄に OSキーボード抑止属性を付与（1欄1回） */
  function _prep(el) {
    if (!el || el.dataset.uzNumpadReady === '1') return;
    el.readOnly = true;
    el.inputMode = 'none';
    el.setAttribute('readonly', '');
    el.setAttribute('inputmode', 'none');
    el.dataset.uzNumpadReady = '1';
  }

  function _prepAll(root) {
    (root || document).querySelectorAll(SELECTOR).forEach(_prep);
  }

  function _raw(el) {
    return (el.value || '').replace(/[^0-9]/g, '');
  }

  /* 生の数字を入れ、既存の整形・税再計算ハンドラを input で起動させる */
  function _setRaw(el, raw) {
    raw = raw.replace(/^0+(?=\d)/, '');         // 先頭ゼロ除去
    if (raw.length > MAXLEN) raw = raw.slice(0, MAXLEN);
    el.value = raw;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function _buildPad() {
    if (_pad) return _pad;
    const pad = document.createElement('div');
    pad.className = 'uz-numpad';
    pad.setAttribute('role', 'group');
    pad.setAttribute('aria-label', '金額テンキー');

    const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    pad.innerHTML =
      '<div class="uz-numpad__bar">' +
        '<span class="uz-numpad__bar-label">金額</span>' +
        '<span class="uz-numpad__bar-value" id="uz-numpad-echo">0</span>' +
        '<button type="button" class="uz-numpad__done" data-k="done">完了</button>' +
      '</div>' +
      '<div class="uz-numpad__keys">' +
        digits.map(n => '<button type="button" class="uz-numpad__key" data-k="' + n + '">' + n + '</button>').join('') +
        '<button type="button" class="uz-numpad__key uz-numpad__key--sub" data-k="000">000</button>' +
        '<button type="button" class="uz-numpad__key" data-k="0">0</button>' +
        '<button type="button" class="uz-numpad__key uz-numpad__key--sub" data-k="back" aria-label="一文字削除">⌫</button>' +
      '</div>';

    /* キー押下でフォーカスが移って閉じないよう既定動作を抑止 */
    pad.addEventListener('pointerdown', e => { e.preventDefault(); }, { passive: false });
    pad.addEventListener('click', _onKey);

    document.body.appendChild(pad);
    _pad = pad;
    return pad;
  }

  function _echo(el) {
    const e = document.getElementById('uz-numpad-echo');
    if (!e) return;
    const raw = _raw(el);
    e.textContent = raw ? Number(raw).toLocaleString() : '0';
  }

  function _onKey(ev) {
    const btn = ev.target.closest('[data-k]');
    if (!btn || !_activeInput) return;
    const k = btn.dataset.k;
    if (k === 'done') { close(); return; }

    let raw = _raw(_activeInput);
    if (k === 'back')      raw = raw.slice(0, -1);
    else if (k === '000')  raw = raw + '000';
    else                   raw = raw + k;

    _setRaw(_activeInput, raw);
    _echo(_activeInput);
  }

  function open(el) {
    if (!_isTarget(el)) return;
    _prep(el);
    _activeInput = el;
    const pad = _buildPad();
    el.classList.add('uz-numpad-focus');
    requestAnimationFrame(() => {
      pad.classList.add('uz-numpad--open');
      document.body.classList.add('uz-numpad-active');
      _echo(el);
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
    });
  }

  function close() {
    if (_pad) _pad.classList.remove('uz-numpad--open');
    document.body.classList.remove('uz-numpad-active');
    if (_activeInput) _activeInput.classList.remove('uz-numpad-focus');
    _activeInput = null;
  }

  /* ── 委譲：金額欄のタップでテンキー、他フィールドへ移れば閉じる ── */
  document.addEventListener('focusin', e => {
    if (_isTarget(e.target)) open(e.target);
    else if (_activeInput && _pad && !_pad.contains(e.target)) close();
  });

  document.addEventListener('click', e => {
    if (_isTarget(e.target)) { open(e.target); return; }
    if (_activeInput && _pad && !_pad.contains(e.target) && e.target !== _activeInput) close();
  }, true);

  /* ── 動的注入される金額欄を準備・消滅時にテンキーを閉じる ── */
  const mo = new MutationObserver(muts => {
    for (const m of muts) {
      if (m.addedNodes) m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (_isTarget(node)) _prep(node);
        _prepAll(node);
      });
    }
    if (_activeInput && !document.body.contains(_activeInput)) close();
  });

  function _start() {
    _prepAll(document);
    mo.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _start);
  else _start();

  window.UzNumpad = { open, close };
})();
