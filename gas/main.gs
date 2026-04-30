function doGet(e) {
  const action = e.parameter.action;
  const data = JSON.parse(e.parameter.data || '{}');
  // clientId 受け口：全アクションで data.clientId を受領可能（実値は Phase A 管理ポータル実装時に運用開始）
  // 現時点では箱だけ用意し、ログ以外には使用しない
  let result;
  try {
    switch (action) {
      case 'addSales':                  result = addSales(data);                          break;
      case 'addCost':                   result = addCost(data);                           break;
      case 'getSummary':                result = getSummary(data.month);                  break;
      case 'getUnpaid':                 result = getUnpaid();                             break;
      case 'getUncollected':            result = getUnpaid();                             break;
      case 'getHistory':                result = getHistory(data.month);                  break;
      case 'clearUnpaid':               result = clearUnpaid(data);                       break;
      case 'reconcile':                 result = reconcile(data);                         break;
      case 'getSettings':               result = getSettings();                           break;
      case 'saveSettings':              result = saveSettings(data);                      break;
      case 'saveStaffList':             result = saveStaffList(data.staffList || []);     break;
      case 'clockIn':                   result = _doClockInV3(data);                      break;
      case 'clockOut':                  result = _doClockOutV3(data);                     break;
      case 'getAttendance':             result = getAttendance(data);                     break;
      case 'getAttendanceByMonth':      result = _doGetAttendanceByMonthV3(data);         break;
      case 'updateSales':               result = updateSales(data);                       break;
      case 'updateCost':                result = updateCost(data);                        break;
      case 'updateAttendance':          result = _doUpdateAttendanceV3(data);             break;
      case 'getCostMaster':             result = getCostMasterGAS();                      break;
      case 'saveCostMaster':            saveCostMasterGAS(data.costMasterList || []);
                                        result = { status: 'ok' };                       break;
      case 'runAttendanceMigrationV3':  result = setupAttendanceMigrationV3();            break;
      case 'getSalesCategoryRanking':   result = getSalesCategoryRanking_(data.months);   break;
      // §3-9-3 案件粗利機能
      case 'getProjects':               result = getProjects();                           break;
      case 'addProject':                result = addProject(data);                        break;
      case 'updateProject':             result = updateProject(data);                     break;
      case 'deleteProject':             result = deleteProject(data);                     break;
      case 'linkProject':               result = linkProject(data);                       break;
      case 'getProjectGrossProfit':     result = getProjectGrossProfit(data);             break;
      default: result = { status: 'error', message: '不明なアクション: ' + action };
    }
  } catch (err) {
    result = { status: 'error', message: err.message };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 売上追記（20列・T列:projectId 含む）
 * projectId は Phase A 案件粗利機能用。スマホ・iPad側からは送信されない（PC版のみ）
 */
function addSales(data) {
  var date = data.date || '';
  var parts = date.split('-');
  var sheet = getOrCreateSheet('売上');
  sheet.appendRow([
    date, Number(parts[0]) || '', Number(parts[1]) || '',
    data.customerCode || '', data.serviceName || '',
    data.serviceCode  || '', data.serviceName || '',
    data.miscItemName || '',
    Number(data.amountExTax) || 0, Number(data.taxRate) || 0,
    Number(data.tax) || 0, Number(data.amountInTax) || 0,
    data.memo || '', '', '',
    Number(data.uncollected) || 0, '', new Date(), 0,
    String(data.projectId || '')   // T列(20) projectId（案件粗利機能・§3-9-3）
  ]);
  return { status: 'ok' };
}

/**
 * コスト追記（22列・T列:withholdingAmount・U列:clientId・V列:projectId）
 * withholdingAmount は payload で渡された場合のみ格納（通常は0）
 * clientId は Phase A 管理ポータル実装時まで空文字で受領（箱のみ）
 * projectId は §3-9-3 案件粗利機能用。スマホ・iPad側からは送信されない（PC版のみ）
 */
function addCost(data) {
  var date = data.date || '';
  var parts = date.split('-');
  var sheet = getOrCreateSheet('コスト');
  sheet.appendRow([
    date, Number(parts[0]) || '', Number(parts[1]) || '',
    data.divisionCode || '', data.divisionName || '',
    data.itemCode     || '', data.itemName     || '',
    data.miscItemName || '',
    Number(data.taxExcluded) || 0, Number(data.taxRate) || 0,
    Number(data.tax) || 0, Number(data.taxIncluded) || 0,
    data.memo || '', '', '',
    Number(data.unpaid) || 0, '', new Date(), 0,
    Number(data.withholdingAmount) || 0,   // T列(20)
    String(data.clientId || ''),            // U列(21)
    String(data.projectId || '')            // V列(22) projectId（案件粗利機能・§3-9-3）
  ]);
  return { status: 'ok' };
}

function updateSales(data) {
  if (!data.rowIndex) return { status: 'error', message: 'rowIndexが必要です' };
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('売上');
  if (!sheet) return { status: 'error', message: '売上シートが見つかりません' };
  var row   = Number(data.rowIndex);
  var date  = data.date || '';
  var parts = date.split('-');
  sheet.getRange(row,  1).setValue(date);
  sheet.getRange(row,  2).setValue(Number(parts[0]) || '');
  sheet.getRange(row,  3).setValue(Number(parts[1]) || '');
  sheet.getRange(row,  5).setValue(data.serviceName  || '');
  sheet.getRange(row,  6).setValue(data.serviceCode  || '');
  sheet.getRange(row,  7).setValue(data.serviceName  || '');
  sheet.getRange(row,  9).setValue(Number(data.amountExTax)  || 0);
  sheet.getRange(row, 10).setValue(Number(data.taxRate)      || 0);
  sheet.getRange(row, 11).setValue(Number(data.tax)          || 0);
  sheet.getRange(row, 12).setValue(Number(data.amountInTax)  || 0);
  sheet.getRange(row, 13).setValue(data.memo         || '');
  sheet.getRange(row, 16).setValue(Number(data.uncollected)  || 0);
  // payload に含まれていれば T列(projectId) も更新（未送信時は既存値保持）
  if (data.projectId !== undefined) {
    sheet.getRange(row, 20).setValue(String(data.projectId || ''));
  }
  return { status: 'ok' };
}

/**
 * コスト修正（T列:withholdingAmount・U列:clientId・V列:projectId を含む）
 */
function updateCost(data) {
  if (!data.rowIndex) return { status: 'error', message: 'rowIndexが必要です' };
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('コスト');
  if (!sheet) return { status: 'error', message: 'コストシートが見つかりません' };
  var row   = Number(data.rowIndex);
  var date  = data.date || '';
  var parts = date.split('-');
  sheet.getRange(row,  1).setValue(date);
  sheet.getRange(row,  2).setValue(Number(parts[0]) || '');
  sheet.getRange(row,  3).setValue(Number(parts[1]) || '');
  sheet.getRange(row,  4).setValue(data.divisionCode || '');
  sheet.getRange(row,  5).setValue(data.divisionName || '');
  sheet.getRange(row,  6).setValue(data.itemCode     || '');
  sheet.getRange(row,  7).setValue(data.itemName     || '');
  sheet.getRange(row,  8).setValue(data.miscItemName || '');
  sheet.getRange(row,  9).setValue(Number(data.taxExcluded)  || 0);
  sheet.getRange(row, 10).setValue(Number(data.taxRate)      || 0);
  sheet.getRange(row, 11).setValue(Number(data.tax)          || 0);
  sheet.getRange(row, 12).setValue(Number(data.taxIncluded)  || 0);
  sheet.getRange(row, 13).setValue(data.memo         || '');
  sheet.getRange(row, 16).setValue(Number(data.unpaid)       || 0);
  // payload に含まれていれば T列・U列・V列も更新（未送信時は既存値保持）
  if (data.withholdingAmount !== undefined) {
    sheet.getRange(row, 20).setValue(Number(data.withholdingAmount) || 0);
  }
  if (data.clientId !== undefined) {
    sheet.getRange(row, 21).setValue(String(data.clientId || ''));
  }
  if (data.projectId !== undefined) {
    sheet.getRange(row, 22).setValue(String(data.projectId || ''));
  }
  return { status: 'ok' };
}

function updateAttendance(data) {
  if (!data.rowIndex) return { status: 'error', message: 'rowIndexが必要です' };
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('attendance');
  if (!sheet) return { status: 'error', message: 'attendanceシートが見つかりません' };
  var row = Number(data.rowIndex);
  sheet.getRange(row, 1).setValue(data.date           || '');
  sheet.getRange(row, 2).setValue(data.staffId        || '');
  sheet.getRange(row, 3).setValue(data.staffName      || '');
  sheet.getRange(row, 4).setValue(_normalizeEmploymentType_(data.employmentType));
  sheet.getRange(row, 5).setValue(data.clockIn        || '');
  sheet.getRange(row, 6).setValue(data.clockOut       || '');
  return { status: 'ok' };
}

function getSummary(month) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var parts = (month || '').split('-');
  var year = Number(parts[0]);
  var mon  = Number(parts[1]);
  var sales = 0, cogs = 0, sga = 0;
  var salesSheet = ss.getSheetByName('売上');
  if (salesSheet && salesSheet.getLastRow() > 1) {
    salesSheet.getDataRange().getValues().slice(1).forEach(function(r) {
      if (!r[0]) return;
      if (Number(r[1]) === year && Number(r[2]) === mon) {
        sales += Number(r[11]) || 0;
      }
    });
  }
  var costSheet = ss.getSheetByName('コスト');
  if (costSheet && costSheet.getLastRow() > 1) {
    costSheet.getDataRange().getValues().slice(1).forEach(function(r) {
      if (!r[0]) return;
      if (Number(r[1]) === year && Number(r[2]) === mon) {
        var amt = Number(r[11]) || 0;
        if (String(r[3]) === '1') { cogs += amt; }
        else { sga += amt; }
      }
    });
  }
  return { status: 'ok', data: {
    month: month, sales: sales, cogs: cogs,
    grossProfit: sales - cogs, sga: sga,
    operatingProfit: sales - cogs - sga
  }};
}

function getUnpaid() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result = [];
  var tz = Session.getScriptTimeZone();
  function toDateStr(val) {
    if (val instanceof Date) {
      return Utilities.formatDate(val, tz, 'yyyy-MM-dd');
    }
    return String(val || '').replace(/\//g, '-').substring(0, 10);
  }
  var salesSheet = ss.getSheetByName('売上');
  if (salesSheet && salesSheet.getLastRow() > 1) {
    salesSheet.getDataRange().getValues().slice(1).forEach(function(r, i) {
      if (!r[0]) return;
      if (Number(r[15]) === 1 && String(r[16]) !== '消込済み') {
        result.push({
          type: 'uncollected', sheetName: '売上', rowIndex: i + 2,
          date: toDateStr(r[0]),
          itemName: r[6] || r[4] || '不明',
          amount: Number(r[11]) || 0,
          memo: r[12] || ''
        });
      }
    });
  }
  var costSheet = ss.getSheetByName('コスト');
  if (costSheet && costSheet.getLastRow() > 1) {
    costSheet.getDataRange().getValues().slice(1).forEach(function(r, i) {
      if (!r[0]) return;
      if (Number(r[15]) === 1 && String(r[16]) !== '消込済み') {
        result.push({
          type: 'payable', sheetName: 'コスト', rowIndex: i + 2,
          date: toDateStr(r[0]),
          itemName: r[6] || r[4] || '不明',
          amount: Number(r[11]) || 0,
          memo: r[12] || ''
        });
      }
    });
  }
  return { status: 'ok', data: result };
}

function reconcile(data) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(data.sheetName);
  if (!sheet) return { status: 'error', message: 'シートが見つかりません' };
  var rowIndex = Number(data.rowIndex);
  sheet.getRange(rowIndex, 14).setValue(data.paidDate);
  sheet.getRange(rowIndex, 15).setValue(Number(data.paidAmount) || 0);
  sheet.getRange(rowIndex, 16).setValue(0);
  sheet.getRange(rowIndex, 17).setValue('消込済み');
  return { status: 'ok' };
}

function clearUnpaid(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = data.sheetName || (data.type === '未収' ? '売上' : 'コスト');
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { status: 'error', message: 'シートが見つかりません' };
  var rowIndex = Number(data.rowIndex);
  if (rowIndex > 1) {
    sheet.getRange(rowIndex, 16).setValue(0);
    sheet.getRange(rowIndex, 17).setValue('消込済み');
    return { status: 'ok' };
  }
  return { status: 'error', message: '対象レコードが見つかりません' };
}

function getHistory(month) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var results = [];
  var tz = Session.getScriptTimeZone();
  function toDateStr(val) {
    if (val instanceof Date) {
      return Utilities.formatDate(val, tz, 'yyyy-MM-dd');
    }
    return String(val || '').replace(/\//g, '-').substring(0, 10);
  }
  var salesSheet = ss.getSheetByName('売上');
  if (salesSheet && salesSheet.getLastRow() > 1) {
    salesSheet.getDataRange().getValues().slice(1).forEach(function(row, i) {
      if (!row[0]) return;
      var dateStr = toDateStr(row[0]);
      if (month && dateStr.indexOf(month) !== 0) return;
      results.push({
        type: 'sales',
        sheetName: '売上',
        rowIndex: i + 2,
        date: dateStr,
        serviceCode: String(row[5] || ''),
        itemName: String(row[6] || row[4] || ''),
        taxRate: Number(row[9]) || 0,
        amount: Number(row[11]) || 0,
        memo: String(row[12] || ''),
        uncollected: Number(row[15]) || 0,
        projectId: String(row[19] || '')   // T列(20=index 19)・案件粗利機能
      });
    });
  }
  var costSheet = ss.getSheetByName('コスト');
  if (costSheet && costSheet.getLastRow() > 1) {
    costSheet.getDataRange().getValues().slice(1).forEach(function(row, i) {
      if (!row[0]) return;
      var dateStr = toDateStr(row[0]);
      if (month && dateStr.indexOf(month) !== 0) return;
      results.push({
        type: 'cost',
        sheetName: 'コスト',
        rowIndex: i + 2,
        date: dateStr,
        divisionCode: String(row[3] || ''),
        divisionName: String(row[4] || ''),
        itemCode: String(row[5] || ''),
        itemName: String(row[6] || row[4] || ''),
        miscItemName: String(row[7] || ''),
        taxRate: Number(row[9]) || 0,
        amount: Number(row[11]) || 0,
        memo: String(row[12] || ''),
        unpaid: Number(row[15]) || 0,
        withholdingAmount: Number(row[19]) || 0,
        projectId: String(row[21] || '')   // V列(22=index 21)・案件粗利機能
      });
    });
  }
  results.sort(function(a, b) { return b.date.localeCompare(a.date); });
  return { status: 'ok', data: results };
}

/**
 * 売上シートは 20列構成（T列:案件ID 含む）
 * コストシートは 22列構成（T列:withholdingAmount・U列:clientId・V列:案件ID 含む）
 */
function getOrCreateSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === '売上') {
      sheet.appendRow(['日付','年','月','顧客コード','売上対象','サービスコード','サービス','諸口品目名','金額(税抜)','税率','消費税','税込金額','メモ','入金日','入金額','未収フラグ','消込状況','登録日時','ロックフラグ','案件ID']);
    } else if (name === 'コスト') {
      sheet.appendRow(['日付','年','月','区分コード','経費区分','科目コード','科目','諸口科目名','金額(税抜)','税率','消費税','税込金額','メモ','支払日','支払額','未払フラグ','消込状況','登録日時','ロックフラグ','源泉徴収額','クライアントID','案件ID']);
    }
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * settings読み込み
 * B1:storeName / B2:staffList / B3:serviceList / B12:storeType
 * B13:templateId / B14:uiLabels(JSON) / B16:featureVisibility(JSON)
 * storeType 未設定時は 'off' をデフォルトで返す（源泉徴収機能OFF状態・納品時に書き換え）
 * templateId 未設定時は 'general-shop' をデフォルトで返す（業態テンプレート・納品時に書き換え）
 * uiLabels 未設定時は {} をデフォルトで返す（custom時のみ意味がある・通常は空）
 * featureVisibility 未設定時は {} をデフォルトで返す（custom時のみ意味がある・§3-9-3 §3-8）
 */
function getSettings() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('settings');
  if (!sheet) return { status: 'error', message: 'settingsシートが見つかりません' };
  var storeName   = sheet.getRange('B1').getValue();
  var staffJson   = sheet.getRange('B2').getValue();
  var serviceJson = sheet.getRange('B3').getValue();
  var storeTypeRaw = sheet.getRange('B12').getValue();
  var templateIdRaw = sheet.getRange('B13').getValue();
  var uiLabelsJson  = sheet.getRange('B14').getValue();
  var featureVisibilityJson = sheet.getRange('B16').getValue();
  var staffList = [], serviceList = [];
  try { if (staffJson)   staffList   = JSON.parse(staffJson);   } catch(e) {}
  try { if (serviceJson) serviceList = JSON.parse(serviceJson); } catch(e) {}
  // employmentType を3種化（employed_full / employed_temp / contractor）
  // 旧 'employed' および未設定は 'employed_full' に自動マイグレーション（戦略思想§3-9-3 サイクルA）
  staffList = staffList.map(function(s) {
    s.employmentType = _normalizeEmploymentType_(s.employmentType);
    return s;
  });
  // storeType は hostess / standard / off のみ許容。未設定や不正値は 'off' に寄せる
  var storeType = String(storeTypeRaw || '').toLowerCase();
  if (storeType !== 'hostess' && storeType !== 'standard') {
    storeType = 'off';
  }
  // templateId は hostess-shop / general-shop / non-shop / custom のみ許容。未設定や不正値は 'general-shop' に寄せる
  var templateId = String(templateIdRaw || '');
  if (templateId !== 'hostess-shop' && templateId !== 'general-shop' && templateId !== 'non-shop' && templateId !== 'custom') {
    templateId = 'general-shop';
  }
  // uiLabels は JSON 文字列。パース失敗・未設定時は {} を返す
  var uiLabels = {};
  try { if (uiLabelsJson) uiLabels = JSON.parse(uiLabelsJson); } catch(e) {}
  if (!uiLabels || typeof uiLabels !== 'object') uiLabels = {};
  // featureVisibility は JSON 文字列。パース失敗・未設定時は {} を返す
  var featureVisibility = {};
  try { if (featureVisibilityJson) featureVisibility = JSON.parse(featureVisibilityJson); } catch(e) {}
  if (!featureVisibility || typeof featureVisibility !== 'object') featureVisibility = {};
  return { status: 'ok', data: {
    storeName: storeName || '',
    staffList: staffList,
    serviceList: serviceList,
    storeType: storeType,
    templateId: templateId,
    uiLabels: uiLabels,
    featureVisibility: featureVisibility
  }};
}

/**
 * settings保存
 * storeType は B12 に直書き（payload に含まれていれば更新・通常は顧客UIからは送信されない）
 * templateId は B13 に直書き（payload に含まれていれば更新・通常は顧客UIからは送信されない）
 * uiLabels は B14 に JSON.stringify して直書き（payload に含まれていれば更新）
 * 顧客UIには出さず納品時にスプレッドシート直接編集で設定する運用（戦略思想§3-2）
 */
function saveSettings(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('settings');
  if (!sheet) return { status: 'error', message: 'settingsシートが見つかりません' };
  var staffList = (data.staffList || []).map(function(s) {
    s.employmentType = _normalizeEmploymentType_(s.employmentType);
    return s;
  });
  sheet.getRange('A1').setValue('storeName');
  sheet.getRange('B1').setValue(data.storeName || '');
  sheet.getRange('A2').setValue('staffList');
  sheet.getRange('B2').setValue(JSON.stringify(staffList));
  sheet.getRange('A3').setValue('serviceList');
  sheet.getRange('B3').setValue(JSON.stringify(data.serviceList || []));
  // storeType は通常の顧客UIからは送信されないが、送信された場合のみ更新
  if (data.storeType !== undefined) {
    var st = String(data.storeType || '').toLowerCase();
    if (st !== 'hostess' && st !== 'standard') st = 'off';
    sheet.getRange('A12').setValue('storeType');
    sheet.getRange('B12').setValue(st);
  }
  // templateId は通常の顧客UIからは送信されないが、送信された場合のみ更新
  if (data.templateId !== undefined) {
    var tid = String(data.templateId || '');
    if (tid !== 'hostess-shop' && tid !== 'general-shop' && tid !== 'non-shop' && tid !== 'custom') tid = 'general-shop';
    sheet.getRange('A13').setValue('templateId');
    sheet.getRange('B13').setValue(tid);
  }
  // uiLabels は通常の顧客UIからは送信されないが、送信された場合のみ更新
  if (data.uiLabels !== undefined) {
    sheet.getRange('A14').setValue('uiLabels');
    sheet.getRange('B14').setValue(JSON.stringify(data.uiLabels || {}));
  }
  // featureVisibility は custom テンプレート時のみ意味がある（§3-9-3 §3-8）
  if (data.featureVisibility !== undefined) {
    sheet.getRange('A16').setValue('featureVisibility');
    sheet.getRange('B16').setValue(JSON.stringify(data.featureVisibility || {}));
  }
  return { status: 'ok' };
}

/**
 * スタッフリスト保存
 * passwordHash / passwordUpdatedAt はスタッフごとパスワード機能（システム仕様書§10-3）用
 */
function saveStaffList(staffList) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('settings');
  if (!sheet) return { status: 'error', message: 'settingsシートが見つかりません' };
  var normalized = (staffList || []).map(function(s) {
    return {
      id: String(s.id || ''),
      name: String(s.name || ''),
      employmentType: _normalizeEmploymentType_(s.employmentType),
      passwordHash: String(s.passwordHash || ''),
      passwordUpdatedAt: s.passwordUpdatedAt ? String(s.passwordUpdatedAt) : ''
    };
  });
  sheet.getRange('A2').setValue('staffList');
  sheet.getRange('B2').setValue(JSON.stringify(normalized));
  return { status: 'ok' };
}

/**
 * employmentType 正規化（3種化対応）
 *  - 'employed_full' / 'employed_temp' / 'contractor' のみ許容
 *  - 旧 'employed' および未設定は 'employed_full' に寄せる（人事台帳としての一貫性確保）
 *  - 戦略思想§3-9-3 サイクルA：人件費の2段階構造（稼働メモ→月末確定→コスト反映）の前提
 */
function _normalizeEmploymentType_(value) {
  if (value === 'employed_full' || value === 'employed_temp' || value === 'contractor') {
    return value;
  }
  // 旧 'employed' は常勤雇用（社員）として扱う
  return 'employed_full';
}

function clockIn(data) {
  var staffId        = data.staffId;
  var staffName      = data.staffName;
  var employmentType = _normalizeEmploymentType_(data.employmentType);
  var clockInTime    = data.clockInTime;
  var clockOutTime   = data.clockOutTime || '';
  var date           = data.date;
  if (!staffId || !clockInTime || !date) {
    return { status: 'error', message: 'パラメータ不足' };
  }
  var sheet = getOrCreateSheet_('attendance', ['日付','スタッフID','スタッフ名','雇用形態','入店時刻','退店時刻','登録日時','案件ID']);
  sheet.appendRow([date, staffId, staffName, employmentType, clockInTime, clockOutTime, new Date().toISOString(), '']);
  return { status: 'ok', rowIndex: sheet.getLastRow() };
}

function clockOut(data) {
  var staffId      = data.staffId;
  var clockOutTime = data.clockOutTime;
  var rowIndex     = data.rowIndex;
  if (!staffId || !clockOutTime) {
    return { status: 'error', message: 'パラメータ不足' };
  }
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('attendance');
  if (!sheet) return { status: 'error', message: 'attendanceシートが存在しません' };
  var colMap = getAttendanceColMap_(sheet);
  if (rowIndex && rowIndex > 1) {
    var row = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (String(row[colMap.staffId - 1]) === String(staffId) && row[colMap.clockOut - 1] === '') {
      sheet.getRange(rowIndex, colMap.clockOut).setValue(clockOutTime);
      return { status: 'ok' };
    }
  }
  var today  = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  var values = sheet.getDataRange().getValues();
  for (var i = values.length - 1; i >= 1; i--) {
    if (String(values[i][colMap.staffId - 1]) === String(staffId) && values[i][colMap.date - 1] === today && values[i][colMap.clockOut - 1] === '') {
      sheet.getRange(i + 1, colMap.clockOut).setValue(clockOutTime);
      return { status: 'ok' };
    }
  }
  return { status: 'error', message: '対応する入店記録が見つかりません' };
}

function getAttendanceColMap_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = {
    date:           headers.indexOf('日付')      + 1,
    staffId:        headers.indexOf('スタッフID') + 1,
    staffName:      headers.indexOf('スタッフ名') + 1,
    employmentType: headers.indexOf('雇用形態')   + 1,
    clockIn:        headers.indexOf('入店時刻')   + 1,
    clockOut:       headers.indexOf('退店時刻')   + 1,
    projectId:      headers.indexOf('案件ID')    + 1   // 新規・サイクルA（後付け紐付け運用）
  };
  return map;
}

function getAttendance(data) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('attendance');
  if (!sheet) return { status: 'ok', data: { attendance: [], hasUnrecordedClockOut: false } };
  var colMap = getAttendanceColMap_(sheet);
  var today  = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  var values = sheet.getDataRange().getValues();
  var attendance = [], hasUnrecordedClockOut = false;
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var date = row[colMap.date - 1] instanceof Date
      ? Utilities.formatDate(row[colMap.date - 1], 'Asia/Tokyo', 'yyyy-MM-dd')
      : String(row[colMap.date - 1] || '').substring(0, 10);
    var staffId   = row[colMap.staffId - 1];
    var staffName = row[colMap.staffName - 1];
    var employmentType = _normalizeEmploymentType_(colMap.employmentType > 0 ? row[colMap.employmentType - 1] : '');
    var clockIn   = row[colMap.clockIn - 1];
    var clockOut  = row[colMap.clockOut - 1];
    if (!staffId) continue;
    if (date === today) {
      attendance.push({
        rowIndex: i + 1,
        staffId: staffId,
        staffName: staffName,
        employmentType: employmentType,
        clockIn: clockIn,
        clockOut: clockOut !== '' ? clockOut : null,
        isActive: clockOut === ''
      });
    } else if (clockOut === '') {
      hasUnrecordedClockOut = true;
    }
  }
  attendance.sort(function(a, b) {
    if (a.isActive === b.isActive) return 0;
    return a.isActive ? -1 : 1;
  });
  return { status: 'ok', data: {
    attendance: attendance,
    hasUnrecordedClockOut: hasUnrecordedClockOut
  }};
}

function getAttendanceByMonth(month) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('attendance');
    if (!sheet) return { status: 'ok', data: [] };
    var colMap = getAttendanceColMap_(sheet);
    var tz = Session.getScriptTimeZone();
    var values = sheet.getDataRange().getValues();
    var data = [];
    values.slice(1).forEach(function(row, i) {
      if (!row[colMap.date - 1]) return;
      var dateStr = row[colMap.date - 1] instanceof Date
        ? Utilities.formatDate(row[colMap.date - 1], tz, 'yyyy-MM-dd')
        : String(row[colMap.date - 1] || '').substring(0, 10);
      if (month && !dateStr.startsWith(month)) return;
      var employmentType = _normalizeEmploymentType_(colMap.employmentType > 0 ? row[colMap.employmentType - 1] : '');
      var projectId      = colMap.projectId > 0 ? String(row[colMap.projectId - 1] || '') : '';
      data.push({
        rowIndex: i + 2,
        date:           dateStr,
        staffId:        String(row[colMap.staffId - 1]  || ''),
        staffName:      String(row[colMap.staffName - 1] || ''),
        employmentType: employmentType,
        clockIn:        String(row[colMap.clockIn - 1]  || ''),
        clockOut:       row[colMap.clockOut - 1] !== '' ? String(row[colMap.clockOut - 1]) : null,
        projectId:      projectId   // 新規・サイクルA
      });
    });
    data.sort(function(a, b) { return b.date.localeCompare(a.date); });
    return { status: 'ok', data: data };
  } catch(e) {
    return { status: 'error', message: e.message };
  }
}

function getOrCreateSheet_(name, headers) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// =============================================================
// 科目マスタ関連（costmaster_additions）
// =============================================================

var DEFAULT_COST_MASTER_GAS = [
  { code: "C1", taxRow: null, name: "仕入(酒類・食材)", taxRate: 8,  type: "fixed", divisionCode: "1", smartphoneVisible: true },
  { code: "C2", taxRow: null, name: "仕入(消耗品)",     taxRate: 10, type: "fixed", divisionCode: "1", smartphoneVisible: true },
  { code: "C3", taxRow: null, name: "仕入(その他)",     taxRate: 10, type: "fixed", divisionCode: "1", smartphoneVisible: true },
  { code: "8",  taxRow: 8,  name: "租税公課",       taxRate: 0,  type: "fixed", divisionCode: "2", smartphoneVisible: true },
  { code: "9",  taxRow: 9,  name: "荷造運賃",       taxRate: 10, type: "fixed", divisionCode: "2", smartphoneVisible: true },
  { code: "10", taxRow: 10, name: "水道光熱費",     taxRate: 10, type: "fixed", divisionCode: "2", smartphoneVisible: true },
  { code: "11", taxRow: 11, name: "旅費交通費",     taxRate: 10, type: "fixed", divisionCode: "2", smartphoneVisible: true },
  { code: "12", taxRow: 12, name: "通信費",         taxRate: 10, type: "fixed", divisionCode: "2", smartphoneVisible: true },
  { code: "13", taxRow: 13, name: "広告宣伝費",     taxRate: 10, type: "fixed", divisionCode: "2", smartphoneVisible: true },
  { code: "14", taxRow: 14, name: "接待交際費",     taxRate: 10, type: "fixed", divisionCode: "2", smartphoneVisible: true },
  { code: "15", taxRow: 15, name: "損害保険料",     taxRate: 0,  type: "fixed", divisionCode: "2", smartphoneVisible: true },
  { code: "16", taxRow: 16, name: "修繕費",         taxRate: 10, type: "fixed", divisionCode: "2", smartphoneVisible: true },
  { code: "17", taxRow: 17, name: "消耗品費",       taxRate: 10, type: "fixed", divisionCode: "2", smartphoneVisible: true },
  { code: "18", taxRow: 18, name: "減価償却費",     taxRate: 0,  type: "fixed", divisionCode: "2", smartphoneVisible: true },
  { code: "19", taxRow: 19, name: "福利厚生費",     taxRate: 10, type: "fixed", divisionCode: "2", smartphoneVisible: true },
  { code: "20", taxRow: 20, name: "給料賃金",       taxRate: 0,  type: "fixed", divisionCode: "2", smartphoneVisible: true },
  { code: "21", taxRow: 21, name: "外注工賃",       taxRate: 10, type: "fixed", divisionCode: "2", smartphoneVisible: true },
  { code: "22", taxRow: 22, name: "利子割引料",     taxRate: 0,  type: "fixed", divisionCode: "2", smartphoneVisible: true },
  { code: "23", taxRow: 23, name: "地代家賃",       taxRate: 10, type: "fixed", divisionCode: "2", smartphoneVisible: true },
  { code: "24", taxRow: 24, name: "貸倒金",         taxRate: 0,  type: "fixed", divisionCode: "2", smartphoneVisible: true },
  { code: "25", taxRow: 25, name: "税理士等の報酬", taxRate: 10, type: "fixed", divisionCode: "2", smartphoneVisible: true },
  { code: "31", taxRow: 31, name: "雑費",           taxRate: 10, type: "fixed", divisionCode: "2", smartphoneVisible: true }
];

function getCostMasterGAS() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('settings');
    if (!sheet) return DEFAULT_COST_MASTER_GAS;
    var val = sheet.getRange('B4').getValue();
    if (!val || val === '') return DEFAULT_COST_MASTER_GAS;
    var parsed = JSON.parse(val);
    if (!Array.isArray(parsed)) return DEFAULT_COST_MASTER_GAS;
    // smartphoneVisible キーを保証(後方互換性)
    // 戦略思想§3-5・システム仕様書§15-2 準拠
    // 未定義 or true → true / false のみ false
    return parsed.map(function(item) {
      item.smartphoneVisible = item.smartphoneVisible !== false;
      return item;
    });
  } catch (e) {
    Logger.log('getCostMasterGAS error: ' + e);
    return DEFAULT_COST_MASTER_GAS;
  }
}

function saveCostMasterGAS(list) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('settings');
    if (!sheet) {
      sheet = ss.insertSheet('settings');
      sheet.getRange('A1').setValue('storeName');
      sheet.getRange('A2').setValue('staffList');
      sheet.getRange('A3').setValue('serviceList');
      sheet.getRange('A4').setValue('costMasterList');
    }
    sheet.getRange('B4').setValue(JSON.stringify(list));
  } catch (e) {
    Logger.log('saveCostMasterGAS error: ' + e);
    throw e;
  }
}

function initCostMaster() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('settings');
    if (!sheet) {
      sheet = ss.insertSheet('settings');
      sheet.getRange('A1').setValue('storeName');
      sheet.getRange('A2').setValue('staffList');
      sheet.getRange('A3').setValue('serviceList');
      sheet.getRange('A4').setValue('costMasterList');
    }
    var current = sheet.getRange('B4').getValue();
    if (current && current !== '') {
      Logger.log('initCostMaster: B4にすでにデータがあるためスキップ');
      return;
    }
    sheet.getRange('B4').setValue(JSON.stringify(DEFAULT_COST_MASTER_GAS));
    Logger.log('initCostMaster: デフォルト科目マスタを書き込みました(' + DEFAULT_COST_MASTER_GAS.length + '件)');
  } catch (e) {
    Logger.log('initCostMaster error: ' + e);
    throw e;
  }
}

// =============================================================
// Phase A セットアップ
// =============================================================

function setupPhaseA() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var settings = ss.getSheetByName('settings');
  if (!settings) {
    settings = ss.insertSheet('settings');
  }
  settings.getRange('B5').setValue('');        // 住所
  settings.getRange('B6').setValue('');        // 電話番号
  settings.getRange('B7').setValue(false);     // インボイス発行事業者フラグ
  settings.getRange('B8').setValue('');        // T番号
  settings.getRange('B9').setValue('[]');      // bankAccounts(JSON)
  settings.getRange('B10').setValue('');       // ロゴ画像
  settings.getRange('B11').setValue('none');   // 支払期限デフォルトルール

  var customers = ss.getSheetByName('customers');
  if (!customers) {
    customers = ss.insertSheet('customers');
    customers.getRange('A1:F1').setValues([[
      '顧客No', '顧客名', '住所', 'メールアドレス', '作成日時', '更新日時'
    ]]);
    customers.setFrozenRows(1);
    customers.hideColumns(1);
  }

  var invoices = ss.getSheetByName('invoices');
  if (!invoices) {
    invoices = ss.insertSheet('invoices');
    invoices.getRange('A1:K1').setValues([[
      '請求書番号', '発行日', '顧客No', '請求金額(税込)', '対象売上行ID',
      '支払期限', '振込先ID', '備考', 'ステータス', 'PDF URL', '作成日時'
    ]]);
    invoices.setFrozenRows(1);
  }

  var estimates = ss.getSheetByName('estimates');
  if (!estimates) {
    estimates = ss.insertSheet('estimates');
    estimates.getRange('A1:J1').setValues([[
      '見積書番号', '発行日', '顧客No', '有効期限', '見積金額(税込)',
      '明細(JSON)', '備考', 'ステータス', '変換先請求書番号', '作成日時'
    ]]);
    estimates.setFrozenRows(1);
  }

  Logger.log('Phase A セットアップ完了');
}

// =============================================================
// 源泉徴収・clientId マイグレーション
// settings B12 storeType 初期化 + コストシート T列・U列 追加
// =============================================================

/**
 * 源泉徴収機能の初期セットアップ（1回だけ実行）
 * - settings B12 に storeType='off' を初期化（納品時に hostess/standard/off へ書き換え）
 * - コストシートに T列:源泉徴収額・U列:クライアントID を追加
 * - 既存データは0/空文字で埋める
 */
function setupWithholdingAndClientId() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // --- settings B12 storeType 初期化 ---
  var settings = ss.getSheetByName('settings');
  if (!settings) {
    settings = ss.insertSheet('settings');
  }
  var currentStoreType = settings.getRange('B12').getValue();
  if (!currentStoreType || currentStoreType === '') {
    settings.getRange('A12').setValue('storeType');
    settings.getRange('B12').setValue('off');
    Logger.log('settings B12 に storeType="off" を初期化しました');
  } else {
    Logger.log('settings B12 は既に "' + currentStoreType + '" が設定済みのためスキップ');
  }

  // --- コストシート T列・U列 追加 ---
  var cost = ss.getSheetByName('コスト');
  if (!cost) {
    Logger.log('コストシートが存在しないためスキップ（初回入力時に21列で自動作成されます）');
    return;
  }
  var lastCol = cost.getLastColumn();
  var headers = cost.getRange(1, 1, 1, lastCol).getValues()[0];

  // 既に追加済みの場合はスキップ
  if (headers.indexOf('源泉徴収額') >= 0 && headers.indexOf('クライアントID') >= 0) {
    Logger.log('コストシートは既に21列化済みのためスキップ');
    return;
  }

  // 列数が19なら T列・U列を追加
  if (lastCol < 20) {
    cost.getRange(1, 20).setValue('源泉徴収額');
  }
  if (lastCol < 21) {
    cost.getRange(1, 21).setValue('クライアントID');
  }

  // 既存データ行の T列(源泉徴収額)を 0 で埋める
  var lastRow = cost.getLastRow();
  if (lastRow > 1) {
    var tValues = [];
    var uValues = [];
    for (var i = 0; i < lastRow - 1; i++) {
      tValues.push([0]);
      uValues.push(['']);
    }
    cost.getRange(2, 20, lastRow - 1, 1).setValues(tValues);
    cost.getRange(2, 21, lastRow - 1, 1).setValues(uValues);
    Logger.log('既存データ ' + (lastRow - 1) + ' 行に T列=0・U列="" を埋めました');
  }

  Logger.log('setupWithholdingAndClientId 完了');
}

// =============================================================
// 業態テンプレート・スタッフパスワード マイグレーション
// settings B13 templateId 初期化 + B14 uiLabels 初期化 + 既存スタッフリストに passwordHash/passwordUpdatedAt 補完
// =============================================================

/**
 * templateId/uiLabels/passwordHash 機能の初期セットアップ（1回だけ実行）
 * - settings B13 に templateId='general-shop' を初期化（納品時に hostess-shop/general-shop/non-shop/custom へ書き換え）
 * - settings B14 に uiLabels='{}' を初期化（custom時のみ意味がある・通常は空）
 * - 既存スタッフリストに passwordHash=''・passwordUpdatedAt='' を補完
 */
function setupTemplateAndPassword() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // --- settings B13 templateId 初期化 ---
  var settings = ss.getSheetByName('settings');
  if (!settings) {
    settings = ss.insertSheet('settings');
  }
  var currentTemplateId = settings.getRange('B13').getValue();
  if (!currentTemplateId || currentTemplateId === '') {
    settings.getRange('A13').setValue('templateId');
    settings.getRange('B13').setValue('general-shop');
    Logger.log('settings B13 に templateId="general-shop" を初期化しました');
  } else {
    Logger.log('settings B13 は既に "' + currentTemplateId + '" が設定済みのためスキップ');
  }

  // --- settings B14 uiLabels 初期化 ---
  var currentUiLabels = settings.getRange('B14').getValue();
  if (!currentUiLabels || currentUiLabels === '') {
    settings.getRange('A14').setValue('uiLabels');
    settings.getRange('B14').setValue('{}');
    Logger.log('settings B14 に uiLabels="{}" を初期化しました');
  } else {
    Logger.log('settings B14 は既に "' + currentUiLabels + '" が設定済みのためスキップ');
  }

  // --- 既存スタッフリストに passwordHash/passwordUpdatedAt 補完 ---
  var staffJson = settings.getRange('B2').getValue();
  var staffList = [];
  try { if (staffJson) staffList = JSON.parse(staffJson); } catch(e) {}
  if (!Array.isArray(staffList)) staffList = [];
  var filledCount = 0;
  staffList = staffList.map(function(s) {
    var changed = false;
    if (s.passwordHash === undefined) {
      s.passwordHash = '';
      changed = true;
    }
    if (s.passwordUpdatedAt === undefined) {
      s.passwordUpdatedAt = '';
      changed = true;
    }
    if (changed) filledCount++;
    return s;
  });
  if (filledCount > 0) {
    settings.getRange('A2').setValue('staffList');
    settings.getRange('B2').setValue(JSON.stringify(staffList));
    Logger.log('既存スタッフ ' + filledCount + ' 件に passwordHash=""・passwordUpdatedAt="" を補完しました');
  } else {
    Logger.log('既存スタッフリストは既に passwordHash/passwordUpdatedAt が補完済みのためスキップ');
  }

  Logger.log('setupTemplateAndPassword 完了');
}

// =============================================================
// 案件粗利機能（§3-9-3 §9）
// projectsシート（7列・案件マスタ）と関連アクション6個
// 大前提：会計データ構造を1ミリも変えず・projectIdオプショナル後付け・PC版のみ
// =============================================================

/**
 * projects シート取得（無ければ作成）
 * 列：projectId / projectName / customerName / startDate / endDate / status / memo
 */
function _getOrCreateProjectsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('projects');
  if (!sheet) {
    sheet = ss.insertSheet('projects');
    sheet.getRange(1, 1, 1, 7).setValues([
      ['projectId', 'projectName', 'customerName', 'startDate', 'endDate', 'status', 'memo']
    ]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * projectId 生成：'p-' + 8桁ランダム英数字（重複時最大100回リトライ）
 */
function _generateProjectId(existingIds) {
  var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (var attempt = 0; attempt < 100; attempt++) {
    var id = 'p-';
    for (var i = 0; i < 8; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    if (existingIds.indexOf(id) === -1) return id;
  }
  throw new Error('projectId 重複生成上限');
}

/**
 * 日付値を 'yyyy-MM-dd' 文字列に正規化
 */
function _toProjectDateStr(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return String(val || '').substring(0, 10);
}

/**
 * 案件マスタ取得
 */
function getProjects() {
  var sheet = _getOrCreateProjectsSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { status: 'ok', data: [] };

  var values = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var projects = values.map(function(row) {
    return {
      projectId: String(row[0] || ''),
      projectName: String(row[1] || ''),
      customerName: String(row[2] || ''),
      startDate: _toProjectDateStr(row[3]),
      endDate: _toProjectDateStr(row[4]),
      status: String(row[5] || 'active'),
      memo: String(row[6] || '')
    };
  });
  return { status: 'ok', data: projects };
}

/**
 * 案件追加（projectId 自動生成）
 */
function addProject(data) {
  var sheet = _getOrCreateProjectsSheet();
  var lastRow = sheet.getLastRow();
  var existingIds = lastRow >= 2
    ? sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(function(r) { return r[0]; })
    : [];

  var projectId = _generateProjectId(existingIds);
  sheet.appendRow([
    projectId,
    data.projectName || '',
    data.customerName || '',
    data.startDate || '',
    data.endDate || '',
    data.status || 'active',
    data.memo || ''
  ]);
  return { status: 'ok', data: { projectId: projectId } };
}

/**
 * 案件更新
 */
function updateProject(data) {
  if (!data.projectId) return { status: 'error', message: 'projectIdが必要です' };
  var sheet = _getOrCreateProjectsSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { status: 'error', message: '案件が存在しません' };

  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === data.projectId) {
      var rowIdx = i + 2;
      sheet.getRange(rowIdx, 2).setValue(data.projectName || '');
      sheet.getRange(rowIdx, 3).setValue(data.customerName || '');
      sheet.getRange(rowIdx, 4).setValue(data.startDate || '');
      sheet.getRange(rowIdx, 5).setValue(data.endDate || '');
      sheet.getRange(rowIdx, 6).setValue(data.status || 'active');
      sheet.getRange(rowIdx, 7).setValue(data.memo || '');
      return { status: 'ok' };
    }
  }
  return { status: 'error', message: 'projectId が見つかりません' };
}

/**
 * 案件削除
 *  - data.force=false（既定）：紐付け行存在時は warning を返して中止
 *  - data.force=true        ：紐付けされた売上T列・コストV列を空欄化してから案件行を削除
 */
function deleteProject(data) {
  if (!data.projectId) return { status: 'error', message: 'projectIdが必要です' };
  var sheet = _getOrCreateProjectsSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { status: 'error', message: '案件が存在しません' };

  if (!data.force) {
    var linked = _countLinkedRows(data.projectId);
    if (linked > 0) {
      return { status: 'warning', message: linked + '件の紐付け行が存在します', linkedCount: linked };
    }
  } else {
    // force 削除時：紐付けされた売上・コスト行の projectId を空欄化
    _clearProjectIdLinks(data.projectId);
  }

  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === data.projectId) {
      sheet.deleteRow(i + 2);
      return { status: 'ok' };
    }
  }
  return { status: 'error', message: 'projectId が見つかりません' };
}

/**
 * 案件削除（force）時に紐付けされた売上・コスト行の projectId を空欄化する
 * 売上 T列(20)・コスト V列(22) を一括で読んで該当 projectId を ''（空文字）に書き戻す
 */
function _clearProjectIdLinks(projectId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var salesSheet = ss.getSheetByName('売上');
  if (salesSheet && salesSheet.getLastRow() >= 2 && salesSheet.getLastColumn() >= 20) {
    var sRange = salesSheet.getRange(2, 20, salesSheet.getLastRow() - 1, 1);
    var sValues = sRange.getValues();
    var sModified = false;
    for (var i = 0; i < sValues.length; i++) {
      if (sValues[i][0] === projectId) {
        sValues[i][0] = '';
        sModified = true;
      }
    }
    if (sModified) sRange.setValues(sValues);
  }

  var costSheet = ss.getSheetByName('コスト');
  if (costSheet && costSheet.getLastRow() >= 2 && costSheet.getLastColumn() >= 22) {
    var cRange = costSheet.getRange(2, 22, costSheet.getLastRow() - 1, 1);
    var cValues = cRange.getValues();
    var cModified = false;
    for (var j = 0; j < cValues.length; j++) {
      if (cValues[j][0] === projectId) {
        cValues[j][0] = '';
        cModified = true;
      }
    }
    if (cModified) cRange.setValues(cValues);
  }
}

/**
 * 売上T列・コストV列を走査して projectId 紐付け行数をカウント
 */
function _countLinkedRows(projectId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var count = 0;

  var salesSheet = ss.getSheetByName('売上');
  if (salesSheet && salesSheet.getLastRow() >= 2 && salesSheet.getLastColumn() >= 20) {
    var salesIds = salesSheet.getRange(2, 20, salesSheet.getLastRow() - 1, 1).getValues();
    count += salesIds.filter(function(r) { return r[0] === projectId; }).length;
  }

  var costSheet = ss.getSheetByName('コスト');
  if (costSheet && costSheet.getLastRow() >= 2 && costSheet.getLastColumn() >= 22) {
    var costIds = costSheet.getRange(2, 22, costSheet.getLastRow() - 1, 1).getValues();
    count += costIds.filter(function(r) { return r[0] === projectId; }).length;
  }

  return count;
}

/**
 * 既存売上行・コスト行に projectId を紐付ける
 * data.sheetName='売上'→T列(20) / 'コスト'→V列(22)
 */
function linkProject(data) {
  if (!data.sheetName) return { status: 'error', message: 'sheetNameが必要です' };
  if (!data.rowIndex) return { status: 'error', message: 'rowIndexが必要です' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(data.sheetName);
  if (!sheet) return { status: 'error', message: 'シートが見つかりません' };

  var col = data.sheetName === '売上' ? 20 : (data.sheetName === 'コスト' ? 22 : 0);
  if (!col) return { status: 'error', message: 'シート名が不正です（売上/コストのみ）' };
  sheet.getRange(Number(data.rowIndex), col).setValue(String(data.projectId || ''));
  return { status: 'ok' };
}

/**
 * 案件別 売上・原価・粗利集計
 * data.projectId が指定されていればその案件のみ・無指定なら全案件
 * 売上シート T列(20=index 19)・コストシート V列(22=index 21) で紐付け済み行を集計
 */
function getProjectGrossProfit(data) {
  data = data || {};
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var targetId = data.projectId || null;

  // 案件マスタ取得
  var projectsResult = getProjects();
  var projects = projectsResult.data || [];

  // 売上集計（T列(20)＝index 19・税込金額 L列(12)=index 11）
  var salesByProject = {};
  var salesSheet = ss.getSheetByName('売上');
  if (salesSheet && salesSheet.getLastRow() >= 2 && salesSheet.getLastColumn() >= 20) {
    var sRows = salesSheet.getRange(2, 1, salesSheet.getLastRow() - 1, 20).getValues();
    sRows.forEach(function(r) {
      var pid = String(r[19] || '');
      if (!pid) return;
      if (targetId && pid !== targetId) return;
      salesByProject[pid] = (salesByProject[pid] || 0) + (Number(r[11]) || 0);
    });
  }

  // コスト集計（V列(22)＝index 21・税込金額 L列(12)=index 11）
  // 集計対象は4区分のみ（経営判断としての貢献利益概念・固定費は対象外）：
  //   ① 仕入原価系すべて（divisionCode='1' / D列(4)=index 3）
  //   ② 給料賃金（itemCode='20'・臨時雇用分の紐付け運用）
  //   ③ 外注工賃（itemCode='21'）
  //   ④ 税理士等の報酬（itemCode='25'・特定案件支払分の紐付け運用）
  var costByProject = {};
  var costSheet = ss.getSheetByName('コスト');
  if (costSheet && costSheet.getLastRow() >= 2 && costSheet.getLastColumn() >= 22) {
    var cRows = costSheet.getRange(2, 1, costSheet.getLastRow() - 1, 22).getValues();
    cRows.forEach(function(r) {
      var pid = String(r[21] || '');
      if (!pid) return;
      if (targetId && pid !== targetId) return;
      var divCode = String(r[3] || '');   // D列(4) divisionCode = index 3
      var itemCode = String(r[5] || '');  // F列(6) itemCode      = index 5
      var isTargetCost = (divCode === '1') ||
                         (itemCode === '20') ||
                         (itemCode === '21') ||
                         (itemCode === '25');
      if (!isTargetCost) return;
      costByProject[pid] = (costByProject[pid] || 0) + (Number(r[11]) || 0);
    });
  }

  // 統合
  var allIds = {};
  Object.keys(salesByProject).forEach(function(k) { allIds[k] = true; });
  Object.keys(costByProject).forEach(function(k) { allIds[k] = true; });

  var result = [];
  Object.keys(allIds).forEach(function(pid) {
    var project = null;
    for (var i = 0; i < projects.length; i++) {
      if (projects[i].projectId === pid) { project = projects[i]; break; }
    }
    var sales = salesByProject[pid] || 0;
    var cost = costByProject[pid] || 0;
    var gross = sales - cost;
    var rate = sales > 0 ? (gross / sales * 100) : null;
    result.push({
      projectId: pid,
      projectName: project ? project.projectName : '(削除済)',
      customerName: project ? project.customerName : '',
      status: project ? project.status : 'unknown',
      sales: sales,
      cost: cost,
      grossProfit: gross,
      grossProfitRate: rate
    });
  });

  return { status: 'ok', data: result };
}
