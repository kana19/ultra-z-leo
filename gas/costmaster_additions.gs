/**
 * ウルトラ財務くん LEO版 GAS — costmaster_additions.gs
 * コスト科目マスタ GAS対応追加コード
 *
 * 既存の doGet / doPost に下記を追加してください。
 */

/* ── 科目マスタ デフォルト値 ─────────────────────────────── */
const DEFAULT_COST_MASTER_GAS = [
  // 仕入原価（divisionCode:"1"）
  { code: 'C1', taxRow: null, name: '仕入（酒類・食材）', taxRate: 8,  type: 'fixed',  divisionCode: '1' },
  { code: 'C2', taxRow: null, name: '仕入（消耗品）',     taxRate: 10, type: 'fixed',  divisionCode: '1' },
  { code: 'C3', taxRow: null, name: '仕入（その他）',     taxRate: 10, type: 'fixed',  divisionCode: '1' },
  // 販管費 固定科目（divisionCode:"2"）
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
  { code: '20', taxRow: 20, name: '給料賃金',       taxRate: 0,  type: 'fixed',  divisionCode: '2' },
  { code: '21', taxRow: 21, name: '外注工賃',       taxRate: 10, type: 'fixed',  divisionCode: '2' },
  { code: '22', taxRow: 22, name: '利子割引料',     taxRate: 0,  type: 'fixed',  divisionCode: '2' },
  { code: '23', taxRow: 23, name: '地代家賃',       taxRate: 10, type: 'fixed',  divisionCode: '2' },
  { code: '24', taxRow: 24, name: '貸倒金',         taxRate: 0,  type: 'fixed',  divisionCode: '2' },
  { code: '25', taxRow: 25, name: '税理士等の報酬', taxRate: 10, type: 'fixed',  divisionCode: '2' },
  // 任意科目（行26〜30）
  { code: '26', taxRow: 26, name: '', taxRate: 10, type: 'custom', divisionCode: '2' },
  { code: '27', taxRow: 27, name: '', taxRate: 10, type: 'custom', divisionCode: '2' },
  { code: '28', taxRow: 28, name: '', taxRate: 10, type: 'custom', divisionCode: '2' },
  { code: '29', taxRow: 29, name: '', taxRate: 10, type: 'custom', divisionCode: '2' },
  { code: '30', taxRow: 30, name: '', taxRate: 10, type: 'custom', divisionCode: '2' },
  // 固定科目（続き）
  { code: '31', taxRow: 31, name: '雑費',           taxRate: 10, type: 'fixed',  divisionCode: '2' },
];

/**
 * 科目マスタを初期化（settingsシート B4 に JSON保存）
 * 初回のみ呼び出す。既存データがある場合は上書きしない。
 */
function initCostMaster() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('settings') || ss.insertSheet('settings');

  const existing = sheet.getRange('B4').getValue();
  if (existing && existing.toString().startsWith('[')) {
    Logger.log('costMaster already initialized. Skip.');
    return;
  }

  sheet.getRange('A4').setValue('costMasterList');
  sheet.getRange('B4').setValue(JSON.stringify(DEFAULT_COST_MASTER_GAS));
  Logger.log('costMaster initialized.');
}

/**
 * 科目マスタを取得
 * settingsシート B4 の JSON を返す。なければデフォルトを返す。
 * @returns {Array}
 */
function getCostMasterGAS() {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('settings');
    if (!sheet) return DEFAULT_COST_MASTER_GAS;

    const val = sheet.getRange('B4').getValue();
    if (val && val.toString().startsWith('[')) {
      return JSON.parse(val);
    }
    return DEFAULT_COST_MASTER_GAS;
  } catch (e) {
    Logger.log('getCostMasterGAS error: ' + e.message);
    return DEFAULT_COST_MASTER_GAS;
  }
}

/**
 * 科目マスタを保存
 * settingsシート B4 に JSON保存
 * @param {Array} list
 */
function saveCostMasterGAS(list) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('settings') || ss.insertSheet('settings');
  sheet.getRange('A4').setValue('costMasterList');
  sheet.getRange('B4').setValue(JSON.stringify(list));
}

/* ── doGet への追加分（既存の doGet の case 分岐に追記してください） ── */
/*

  case 'getCostMaster':
    return jsonResponse({ status: 'ok', data: getCostMasterGAS() });

  case 'saveCostMaster':
    saveCostMasterGAS(data.costMasterList || []);
    return jsonResponse({ status: 'ok' });

*/

/* ── jsonResponse ヘルパー（既存のものがあれば不要） ─────── */
/*
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
*/
