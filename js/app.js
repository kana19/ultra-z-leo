/**
 * ウルトラZAIMUくん LEO版 PWA — app.js
 * 共通ロジック・GAS通信
 */

'use strict';

// デバイス判定・bodyクラス付与（即時実行）
(function() {
  const ua = navigator.userAgent;
  const isIPad = /iPad/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isPC = !isIPad && window.innerWidth >= 1025;

  if (isIPad) document.body.classList.add('is-ipad');
  if (isPC)   document.body.classList.add('is-pc');
})();

// DOMContentLoaded後にも付与（Safariサイドバーモード対策）
document.addEventListener('DOMContentLoaded', function() {
  const ua = navigator.userAgent;
  const isIPad = /iPad/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

  if (isIPad) {
    document.body.classList.add('is-ipad');
    document.documentElement.classList.add('is-ipad');
  }
});

/* ── GAS設定 ─────────────────────────────────────────────── */
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwBDHj9-p6ZT6ExXrxF1Q-XwiEkNMPwDc0aAuk7zptivRhWhepvaCDsjaIJd7WHh_h9-A/exec';

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

/**
 * アプリ起動時にGASからsettings（storeType・templateId・uiLabels）を取得して
 * localStorageに同期する
 *  - storeType : 源泉徴収UIの出し分けに使う（cost.js参照）
 *  - templateId: 業態テンプレート（hostess-shop / general-shop / non-shop / custom）
 *  - uiLabels  : custom テンプレート時の個別ラベル（JSON）・通常はderiveUILabelsで動的導出
 *
 * 通信失敗時は既存キャッシュを維持・初回失敗時は安全側のデフォルトで動作
 *
 * 実行タイミング：DOMContentLoaded時にバックグラウンドで非同期実行
 * モーダル起動時には既にlocalStorageが最新化されている設計
 */
async function syncSettingsAtStartup() {
  try {
    const res = await callGAS('getSettings', {});
    if (!res || res.status !== 'ok' || !res.data) return;

    const d = res.data;

    // storeType 同期（既存）
    if (typeof d.storeType === 'string') {
      const st = d.storeType.toLowerCase();
      const normalized = (st === 'hostess' || st === 'standard') ? st : 'off';
      localStorage.setItem('uz_store_type', normalized);
    }

    // templateId 同期（新規）
    if (typeof d.templateId === 'string') {
      const valid = ['hostess-shop', 'general-shop', 'non-shop', 'custom'];
      const tid = valid.includes(d.templateId) ? d.templateId : 'general-shop';
      localStorage.setItem('uz_template_id', tid);
    }

    // uiLabels 同期（custom時のみ意味がある・通常は空）
    if (d.uiLabels && typeof d.uiLabels === 'object') {
      localStorage.setItem('uz_ui_labels', JSON.stringify(d.uiLabels));
    }

    // featureVisibility 同期（custom時のみ実値を保存・他テンプレート時は localStorage を空にする）
    // §3-9-3 §3-8 deriveFeatureVisibility が custom 時のみ localStorage を読み出す設計
    if (d.templateId === 'custom' && d.featureVisibility && typeof d.featureVisibility === 'object') {
      localStorage.setItem('uz_feature_visibility', JSON.stringify(d.featureVisibility));
    } else {
      localStorage.removeItem('uz_feature_visibility');
    }

    // staffList 同期（A-2-X-1：コスト入力のスタッフプルダウンで使用）
    if (Array.isArray(d.staffList)) {
      localStorage.setItem('uz_staff_list', JSON.stringify(d.staffList));
    }

    // 取得後にUI用語を反映
    applyUILabels();

    // settings 同期完了イベント発火
    // 各ページが templateId 確定後の表示制御（案件粗利タブ等）を再評価できるよう通知する
    try {
      document.dispatchEvent(new CustomEvent('uz:settings-synced', { detail: { data: d } }));
    } catch (e) { /* CustomEvent 非対応環境は無視 */ }
  } catch (e) {
    console.warn('[app.js] settings起動時同期失敗（キャッシュ値を使用）:', e);
  }
}

// 後方互換用エイリアス（既存呼び出しが残っている場合のため）
async function syncStoreTypeAtStartup() {
  return syncSettingsAtStartup();
}

// 起動時にバックグラウンドで settings を同期（UIブロックなし）
// templateId / uiLabels の即時反映が必要なため、5秒遅延を撤廃し即時実行に変更（A-9整流化）
// 旧版は遅延中にキャッシュ値で初期描画され、UI用語の切替が遅れて見えるバグがあった
document.addEventListener('DOMContentLoaded', function() {
  // 起動直後にもキャッシュ済みのラベルを適用しておく（GASを待たない）
  applyUILabels();
  // GAS同期は即時実行（バックグラウンド・他のGAS呼び出しと並列で走らせて問題なし）
  syncSettingsAtStartup();
});

/* ── 業態テンプレート連動UI用語切替 ───────────────────────
 * 戦略思想§3-2「納品時設定原則」+ 3デバイス統合仕様§6-7 準拠：
 *   - 業態テンプレート(templateId)により入店/出勤等のUI用語を動的に切り替える
 *   - 顧客が直接設定するUIは出さない（管理ポータルから設定される）
 *   - 通常は templateId から動的導出・custom時のみ uz_ui_labels の個別保存値を優先
 * 対象キー：
 *   - clockin_record       : 入店記録 / 出勤記録
 *   - clockin_history      : 入店履歴 / 出勤履歴
 *   - clockin_active       : 入店中 / 出勤中
 *   - clockin_time         : 入店時刻 / 出勤時刻
 *   - clockout_time        : 退店時刻 / 退勤時刻
 *   - clockin_action       : 入店を記録 / 出勤を記録
 *   - clockout_action      : 退店を記録 / 退勤を記録
 *   - clockin_register     : 新規登録（業態共通・A-9で「新規入店登録/新規出勤登録」から統一）
 *   - clockout_done        : 退店済 / 退勤済
 *   - not_clocked_in       : 未入店 / 未出勤
 *   - clockin_label        : 入店 / 出勤
 *   - clockout_label       : 退店 / 退勤
 *   - clockout_unrecorded  : 退店未記録 / 退勤未記録
 *   - attendance_empty     : 本日の入店記録がありません / 本日の出勤記録がありません
 */

const UI_LABELS_KEY  = 'uz_ui_labels';
const TEMPLATE_ID_KEY = 'uz_template_id';

const UI_LABELS_HOSTESS = {
  clockin_record:      '入店記録',
  clockin_history:     '入店履歴',
  clockin_active:      '入店中',
  clockin_time:        '入店時刻',
  clockout_time:       '退店時刻',
  clockin_action:      '入店を記録',
  clockout_action:     '退店を記録',
  clockin_register:    '新規登録',
  clockout_done:       '退店済',
  not_clocked_in:      '未入店',
  clockin_label:       '入店',
  clockout_label:      '退店',
  clockout_unrecorded: '退店未記録',
  attendance_empty:    '本日の入店記録がありません',
};

const UI_LABELS_GENERAL = {
  clockin_record:      '出勤記録',
  clockin_history:     '出勤履歴',
  clockin_active:      '出勤中',
  clockin_time:        '出勤時刻',
  clockout_time:       '退勤時刻',
  clockin_action:      '出勤を記録',
  clockout_action:     '退勤を記録',
  clockin_register:    '新規登録',
  clockout_done:       '退勤済',
  not_clocked_in:      '未出勤',
  clockin_label:       '出勤',
  clockout_label:      '退勤',
  clockout_unrecorded: '退勤未記録',
  attendance_empty:    '本日の出勤記録がありません',
};

/**
 * 現在のtemplateIdを取得（localStorage・デフォルト 'general-shop'）
 * @returns {string}
 */
function getTemplateId() {
  return localStorage.getItem(TEMPLATE_ID_KEY) || 'general-shop';
}

/**
 * templateIdからUI用語ラベルを動的導出する。
 * custom テンプレートの場合のみ、localStorage の uz_ui_labels を読み出して優先する。
 * @param {string} templateId
 * @returns {Object} ラベルマップ
 */
function deriveUILabels(templateId) {
  const tid = templateId || getTemplateId();

  // custom時：個別保存ラベルがあれば優先（無ければ general-shop ベース）
  if (tid === 'custom') {
    try {
      const stored = localStorage.getItem(UI_LABELS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return Object.assign({}, UI_LABELS_GENERAL, parsed);
      }
    } catch (e) {
      console.warn('[app.js] uz_ui_labels の読み込みに失敗:', e);
    }
    return Object.assign({}, UI_LABELS_GENERAL);
  }

  // hostess-shop
  if (tid === 'hostess-shop') return Object.assign({}, UI_LABELS_HOSTESS);

  // general-shop / non-shop / 不明値はすべて general 系
  return Object.assign({}, UI_LABELS_GENERAL);
}

/**
 * DOM内の data-uilabel-key 属性を持つ要素のテキストを業態に応じて書き換える。
 * aria-label 属性についても data-uilabel-aria-key で同様に書き換える。
 *
 * 対象例：
 *   <span data-uilabel-key="clockin_record">入店記録</span>
 *   <input data-uilabel-aria-key="clockin_time" aria-label="入店時刻（時）">
 *
 * 起動時とテンプレート変更後に呼び出す。
 */
function applyUILabels() {
  const labels = deriveUILabels();

  // テキスト書き換え（data-uilabel-key）
  document.querySelectorAll('[data-uilabel-key]').forEach(el => {
    const key = el.getAttribute('data-uilabel-key');
    if (key && labels[key]) {
      el.textContent = labels[key];
    }
  });

  // aria-label 書き換え（data-uilabel-aria-key・suffixで「（時）」等を保持できる）
  document.querySelectorAll('[data-uilabel-aria-key]').forEach(el => {
    const key = el.getAttribute('data-uilabel-aria-key');
    if (!key || !labels[key]) return;
    const suffix = el.getAttribute('data-uilabel-aria-suffix') || '';
    el.setAttribute('aria-label', labels[key] + suffix);
  });

  // title書き換え（data-uilabel-title-key）
  document.querySelectorAll('[data-uilabel-title-key]').forEach(el => {
    const key = el.getAttribute('data-uilabel-title-key');
    if (key && labels[key]) {
      el.title = labels[key];
    }
  });

  // document.title書き換え（body に data-uilabel-title-key）
  const body = document.body;
  if (body && body.dataset && body.dataset.uilabelDocTitleKey) {
    const key = body.dataset.uilabelDocTitleKey;
    const baseSuffix = body.dataset.uilabelDocTitleSuffix || '';
    if (labels[key]) {
      document.title = labels[key] + baseSuffix;
    }
  }
}

/* ── 雇用形態ラベル（3種化対応） ─────────────────────────────
 * 戦略思想§3-9-3 サイクルA：employmentType を3種化（人事台帳の一貫性）
 *   - employed_full : 常勤雇用（社員・正社員ホステス・店長等／集計対象外）
 *   - employed_temp : 臨時アルバイト（短期バイト・週末ヘルプ等／変動費）
 *   - contractor    : 委託・外注（ホステス委託・派遣・外部キャスト等／案件直接費）
 *   - 旧 'employed'・未設定値はすべて 'employed_full' として表示する（後方互換）
 */
function employmentTypeLabel(value) {
  switch (value) {
    case 'employed_full': return '常勤雇用';
    case 'employed_temp': return '臨時アルバイト';
    case 'contractor':    return '委託・外注';
    default:              return '常勤雇用';   // 旧 'employed' 含む後方互換
  }
}

/* ── 機能表示フラグ（featureVisibility）─────────────────────
 * 戦略思想§3-9-3 §3-8 準拠：
 *   - templateId に応じて機能の表示／非表示を導出する
 *   - custom テンプレート時のみ localStorage の uz_feature_visibility を優先
 *   - 通常は templateId から動的導出（管理ポータル設定不要）
 *
 * 2キー（サイクルA：project_grossprofit を廃止し全業態で案件機能を標準搭載）：
 *   - clockin_menu        : 入店記録メニュー
 *   - payroll_menu        : 月末経理メニュー（プレースホルダ・本体未実装）
 */
const FEATURE_VISIBILITY_KEY = 'uz_feature_visibility';

/**
 * templateIdから featureVisibility を動的導出する。
 * custom テンプレートの場合のみ、localStorage の uz_feature_visibility を読み出して優先する。
 * @param {string} templateId
 * @returns {{clockin_menu:boolean, payroll_menu:boolean}}
 */
function deriveFeatureVisibility(templateId) {
  const tid = templateId || getTemplateId();

  if (tid === 'hostess-shop') {
    return { clockin_menu: true,  payroll_menu: true  };
  }
  if (tid === 'general-shop') {
    return { clockin_menu: true,  payroll_menu: false };
  }
  if (tid === 'non-shop') {
    return { clockin_menu: false, payroll_menu: false };
  }
  if (tid === 'custom') {
    try {
      const stored = localStorage.getItem(FEATURE_VISIBILITY_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return Object.assign(
          { clockin_menu: true, payroll_menu: false },
          parsed
        );
      }
    } catch (e) {
      console.warn('[app.js] uz_feature_visibility の読み込みに失敗:', e);
    }
    return { clockin_menu: true, payroll_menu: false };
  }

  // 不明値は安全側のデフォルト
  return { clockin_menu: true, payroll_menu: false };
}

/**
 * 現在の templateId に対応する featureVisibility を取得する。
 * @returns {{clockin_menu:boolean, payroll_menu:boolean}}
 */
function getFeatureVisibility() {
  return deriveFeatureVisibility(getTemplateId());
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
 * 税込金額から税抜・消費税を逆算する（全デバイス共通・3デバイス統合仕様§6-4）
 *
 * §6-4 正規ロジック：税抜 = floor(税込 / (1 + 税率/100))、消費税 = 税込 − 税抜
 * 浮動小数点誤差を避けるため、JS では (1 + rate/100) を経由せず整数演算で実装する：
 *   taxExcluded = floor(taxIncluded * 100 / (100 + rate))
 * これは数学的に等価だが、たとえば 55000 / 1.1 が 49999.99999999999 になる FP誤差を回避する
 * （例：55000円・10% → 税抜 50000・消費税 5000。FP では 5001 になるバグを修正）
 *
 * 極小金額への配慮：税抜が 0 に丸められる場合（例：1円・10%）は税込全額を税抜扱いにし
 * 消費税 0 を返す。負値や `-1` を返さない（§0-3 テスト3）。
 *
 * @param {number} taxIncluded 税込金額（円・整数）
 * @param {number} taxRate     税率（%・10 / 8 / 0 のいずれか）
 * @returns {{ taxExcluded: number, tax: number }}
 */
function calcTax(taxIncluded, taxRate) {
  const inAmt = Number.isFinite(Number(taxIncluded)) ? Math.max(0, Math.floor(Number(taxIncluded))) : 0;
  const rate  = Number.isFinite(Number(taxRate)) ? Number(taxRate) : 0;
  if (rate <= 0) {
    return { taxExcluded: inAmt, tax: 0 };
  }
  const taxExcluded = Math.floor((inAmt * 100) / (100 + rate));
  if (taxExcluded === 0 && inAmt > 0) {
    return { taxExcluded: inAmt, tax: 0 };
  }
  const tax = inAmt - taxExcluded;
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
const _TIME_MINS  = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

/**
 * 時・分セレクト2つのHTML断片を返す
 * @param {string}  idPrefix  'form-clockin' など（-h / -m が付く）
 * @param {string}  value     'HH:MM' または ''
 * @param {boolean} required  false なら先頭に空選択肢を追加
 */
function timeSelectHTML(idPrefix, value, required = false) {
  const parts = (value || '').split(':');
  const selH  = (parts[0] || '').padStart(2, '0');
  const selM  = (parts[1] || '').padStart(2, '0');

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
  const m     = (parts[1] || '').padStart(2, '0');
  hEl.value = h;
  mEl.value = m;
}

/* ── 労働時間計算（日またぎ自動判定） ───────────────────── */
/**
 * 労働時間を計算し、日またぎ・異常判定を返す
 * @param {string} clockIn  'HH:MM'
 * @param {string} clockOut 'HH:MM'
 * @returns {object|null} { minutes, hours, mins, isOvernight, isAbnormal, clockOutDisplay } | null
 *
 * 判定ルール:
 *   - 退店時刻 >= 入店時刻 → 同日退店
 *   - 退店時刻 <  入店時刻 → 翌日退店（+24時間）
 *   - 労働時間が13時間超 → 異常フラグ
 */
const _WORK_ABNORMAL_MINUTES = 13 * 60; // 13時間を超えたら異常

function calcWorkDuration(clockIn, clockOut) {
  if (!clockIn || !clockOut) return null;
  const mIn  = clockIn.match(/^(\d{1,2}):(\d{2})/);
  const mOut = clockOut.match(/^(\d{1,2}):(\d{2})/);
  if (!mIn || !mOut) return null;

  const inMin  = parseInt(mIn[1], 10)  * 60 + parseInt(mIn[2], 10);
  const outMin = parseInt(mOut[1], 10) * 60 + parseInt(mOut[2], 10);

  const isOvernight = outMin < inMin;
  const totalMin    = isOvernight ? (outMin + 24 * 60 - inMin) : (outMin - inMin);

  return {
    minutes: totalMin,
    hours: Math.floor(totalMin / 60),
    mins:  totalMin % 60,
    isOvernight,
    isAbnormal: totalMin > _WORK_ABNORMAL_MINUTES,
    clockOutDisplay: isOvernight ? `翌${clockOut}` : clockOut,
  };
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
  { code: 'C1', taxRow: null, name: '仕入(酒類・食材)', taxRate: 8,  type: 'fixed',  divisionCode: '1' },
  { code: 'C2', taxRow: null, name: '仕入(消耗品)',     taxRate: 10, type: 'fixed',  divisionCode: '1' },
  { code: 'C3', taxRow: null, name: '仕入(その他)',     taxRate: 10, type: 'fixed',  divisionCode: '1' },
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
  { code: '20', taxRow: 20, name: '給料賃金（スポット）', taxRate: 0,  type: 'fixed',  divisionCode: '2' },
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

/* ── 税理士用CSV DL（共通ユーティリティ） ─────────────────── */

/**
 * 月プルダウンの選択肢を生成（直近24ヶ月分、新しい順）
 * @param {HTMLSelectElement} selectEl
 * @param {string} defaultValue 'YYYY-MM'
 */
function buildMonthOptions(selectEl, defaultValue) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  const now = new Date();
  const MIN = '2025-01';
  for (let i = 0; i < 24; i++) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (val < MIN) break;
    const opt = document.createElement('option');
    opt.value       = val;
    opt.textContent = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    selectEl.appendChild(opt);
  }
  if (defaultValue) selectEl.value = defaultValue;
}

/**
 * YYYY-MM の範囲から月リストを生成
 * @param {string} from 'YYYY-MM'
 * @param {string} to   'YYYY-MM'
 * @returns {string[]}
 */
function _buildMonthRange(from, to) {
  const months = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
    if (months.length > 24) break; // 最大2年分
  }
  return months;
}

/**
 * 税理士用CSV（期間指定）をダウンロード
 * @param {string} fromMonth 'YYYY-MM'
 * @param {string} toMonth   'YYYY-MM'
 * @param {HTMLButtonElement|null} btnEl ボタン要素（ローディング表示用）
 */
async function downloadTaxCSVByRange(fromMonth, toMonth, btnEl) {
  if (!fromMonth || !toMonth || fromMonth > toMonth) {
    alert('期間を正しく選択してください(開始月 ≤ 終了月)');
    return;
  }

  const origText = btnEl ? btnEl.textContent : '';
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '取得中...'; }

  try {
    const months = _buildMonthRange(fromMonth, toMonth);

    const results = await Promise.all(
      months.map(mo =>
        callGAS('getSummary', { month: mo })
          .then(r => (r && r.status === 'ok' && r.data) ? r.data : null)
          .catch(() => null)
      )
    );

    // コスト科目マスタ（確定申告行番号対応）
    const master = typeof getCostMaster === 'function' ? getCostMaster() : [];

    // 仕入原価科目（divisionCode:"1"）
    const cogsSubjects = master
      .filter(item => item.divisionCode === '1' && item.name)
      .map(item => ({ name: item.name, row: '-', key: null, div: 'cogs' }));

    // 販管費科目（divisionCode:"2"）
    const sgaSubjects = master
      .filter(item => item.divisionCode === '2' && item.name)
      .sort((a, b) => (a.taxRow ?? 99) - (b.taxRow ?? 99))
      .map(item => ({ name: item.name, row: item.taxRow ? `行${item.taxRow}` : '-', key: null, div: 'sga' }));

    const subjects = [
      { name: '売上(収入)金額', row: '行1',  key: 'sales'  },
      { name: '仕入金額合計',     row: '-',    key: 'cogs'   },
      ...cogsSubjects,
      { name: '粗利',             row: '-',    key: 'gross'  },
      { name: '販管費合計',       row: '-',    key: 'sga'    },
      ...sgaSubjects,
      { name: '経常利益',         row: '行43', key: 'profit' },
    ];

    // ヘッダー行
    const monthLabels = months.map(mo => {
      const [y, mm] = mo.split('-').map(Number);
      return `${y}年${mm}月`;
    });
    const header = ['科目', '行番号', ...monthLabels, '期間合計'];
    const csvRows = [header];

    subjects.forEach(s => {
      const monthly = results.map(d => {
        if (!d) return 0;
        if (s.key === 'sales')  return d.sales  || 0;
        if (s.key === 'cogs')   return d.cogs   || 0;
        if (s.key === 'gross')  return (d.sales || 0) - (d.cogs || 0);
        if (s.key === 'sga')    return d.sga    || 0;
        if (s.key === 'profit') return (d.sales || 0) - (d.cogs || 0) - (d.sga || 0);
        // 内訳科目：sgaBreakdown + cogsBreakdown から検索
        const breakdown = [...(d.sgaBreakdown || []), ...(d.cogsBreakdown || [])];
        const found = breakdown.find(it => it.name === s.name);
        return found ? (found.amount || 0) : 0;
      });
      const total = monthly.reduce((a, b) => a + b, 0);
      csvRows.push([s.name, s.row, ...monthly, total]);
    });

    // CSV文字列生成（BOM付きUTF-8）
    const csv  = csvRows
      .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const bom  = '\uFEFF';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `ultra_zaimu_${fromMonth.replace('-', '')}-${toMonth.replace('-', '')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

  } catch (e) {
    alert('ダウンロードに失敗しました: ' + e.message);
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = origText; }
  }
}
