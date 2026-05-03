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
      // 戦略思想§3-9-3 取引ペア紐付けモデル（売上行ID＝親キー、コストV列＝子キー）
      case 'linkTransactions':          result = linkTransactions(data);                  break;
      case 'getTransactionsHierarchy':  result = getTransactionsHierarchy(data);          break;
      case 'getLinkCandidates':         result = getLinkCandidates(data);                 break;
      // 戦略思想§3-9-3 2画面分離モデル（月次管理＋案件管理）
      case 'markAsProject':             result = markAsProject(data);                     break;
      case 'unmarkAsProject':           result = unmarkAsProject(data);                   break;
      case 'getProjectSummary':         result = getProjectSummary(data);                 break;
      // PC版月次管理画面（インライン編集保存・ロック解除申請・技術仕様§4-6 §3）
      case 'updateRow':                 result = updateRow(data);                         break;
      case 'requestUnlock':             result = requestUnlock(data);                     break;
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
 * 売上追記（21列・T列:売上行ID／U列:isProject 含む）
 * T列(20) には取引ペア紐付けモデルの 親キー「売上行ID」を自動採番して格納する
 * 形式：s-YYYYMMDDNNNN（接頭辞 s- ＋日付8桁＋当日内連番4桁ゼロ埋め）
 * U列(21) には案件化フラグ（'1'＝案件管理対象／空欄＝月次管理のみ）を格納する
 *  payload に isProject:'1' が明示的に含まれる場合のみ '1' を書き込む（既定は空欄）
 * 戦略思想§3-9-3 2画面分離モデル：月次管理（U列無視・全売上集計）／案件管理（U列='1' のみ）
 */
function addSales(data) {
  var date = data.date || '';
  var parts = date.split('-');
  var sheet = getOrCreateSheet('売上');
  var salesRowId = generateSalesRowId(date);
  var isProject = String(data.isProject) === '1' ? '1' : '';
  sheet.appendRow([
    date, Number(parts[0]) || '', Number(parts[1]) || '',
    data.customerCode || '', data.serviceName || '',
    data.serviceCode  || '', data.serviceName || '',
    data.miscItemName || '',
    Number(data.amountExTax) || 0, Number(data.taxRate) || 0,
    Number(data.tax) || 0, Number(data.amountInTax) || 0,
    data.memo || '', '', '',
    Number(data.uncollected) || 0, '', new Date(), 0,
    salesRowId,                                    // T列(20) 売上行ID（自動採番・取引ペア紐付けモデル）
    isProject                                      // U列(21) 案件化フラグ（戦略思想§3-9-3 2画面分離モデル）
  ]);
  return { status: 'ok', salesRowId: salesRowId };
}

/**
 * 売上行ID 自動採番（取引ペア紐付けモデル）
 * 形式：s-YYYYMMDDNNNN
 *   - 接頭辞 's-' 固定
 *   - YYYYMMDD：売上日付の8桁
 *   - NNNN    ：当日内連番（4桁ゼロ埋め）
 * 採番方式：T列を走査して同日 's-YYYYMMDD' 接頭一致行をカウントし、+1 をゼロ埋め
 * 同一実行コンテキスト内では SpreadsheetApp の同期書き込みで重複は発生しない前提
 */
function generateSalesRowId(date) {
  var ymd = String(date || '').replace(/-/g, '').substring(0, 8);
  if (ymd.length < 8) {
    // 異常系：日付不正時はフォールバックで最低限の形式を返す
    var d = new Date();
    ymd = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyyMMdd');
  }
  var sheet = SpreadsheetApp.getActive().getSheetByName('売上');
  if (!sheet) return 's-' + ymd + '0001';
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 's-' + ymd + '0001';
  var idValues = sheet.getRange(2, 20, lastRow - 1, 1).getValues();
  var prefix = 's-' + ymd;
  var sameDayCount = 0;
  for (var i = 0; i < idValues.length; i++) {
    var id = idValues[i][0];
    if (typeof id === 'string' && id.indexOf(prefix) === 0) {
      sameDayCount++;
    }
  }
  var seq = String(sameDayCount + 1);
  while (seq.length < 4) seq = '0' + seq;
  return prefix + seq;
}

/**
 * 既存売上行への売上行ID 遡及採番（冪等）
 * T列が空欄、または新形式 ^s-\d{12}$ に合致しない行を対象に s-YYYYMMDDNNNN を付番する
 * 旧モデルの projectId（'p-' + 8桁・10文字）が残っている場合も新形式で上書きされる
 * getTransactionsHierarchy 冒頭から呼び出される（実行毎の追加コストは行カウントに比例）
 */
function migrateSalesRowIds() {
  var sheet = SpreadsheetApp.getActive().getSheetByName('売上');
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var dateValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var idValues = sheet.getRange(2, 20, lastRow - 1, 1).getValues();

  // 既存の有効ID（新形式）から日付ごとの最大連番を把握
  var sameDayMaxSeq = {};
  for (var i = 0; i < idValues.length; i++) {
    var id = idValues[i][0];
    if (typeof id === 'string' && /^s-\d{12}$/.test(id)) {
      var ymd = id.substring(2, 10);
      var seq = parseInt(id.substring(10), 10);
      if (!isNaN(seq)) {
        sameDayMaxSeq[ymd] = Math.max(sameDayMaxSeq[ymd] || 0, seq);
      }
    }
  }

  // T列が空欄、または新形式に合致しない行に採番
  var updates = [];
  for (var j = 0; j < idValues.length; j++) {
    var current = idValues[j][0];
    var isValid = (typeof current === 'string' && /^s-\d{12}$/.test(current));
    if (isValid) continue;
    var dateVal = dateValues[j][0];
    var dateStr = (dateVal instanceof Date)
      ? Utilities.formatDate(dateVal, 'Asia/Tokyo', 'yyyy-MM-dd')
      : String(dateVal || '').substring(0, 10);
    if (!dateStr || dateStr.length < 10) continue;
    var ymd2 = dateStr.replace(/-/g, '');
    var nextSeq = (sameDayMaxSeq[ymd2] || 0) + 1;
    sameDayMaxSeq[ymd2] = nextSeq;
    var seqStr = String(nextSeq);
    while (seqStr.length < 4) seqStr = '0' + seqStr;
    updates.push({ row: j + 2, id: 's-' + ymd2 + seqStr });
  }

  for (var k = 0; k < updates.length; k++) {
    sheet.getRange(updates[k].row, 20).setValue(updates[k].id);
  }
}

/**
 * コスト追記（22列・T列:withholdingAmount・U列:clientId・V列:紐付け先売上行ID）
 * withholdingAmount は payload で渡された場合のみ格納（通常は0）
 * clientId は Phase A 管理ポータル実装時まで空文字で受領（箱のみ）
 * V列 は取引ペア紐付けモデルの 子キー（紐付け先売上行ID）
 *  PC版の通常追加経路では空文字を入れて作成し、紐付けは linkTransactions で後付けする
 *  後方互換のため payload.projectId も受け付ける（同一意味で扱う）
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
    String(data.projectId || '')            // V列(22) 紐付け先売上行ID（取引ペア紐付けモデル・§3-9-3）
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
  // 売上T列(20) は売上行ID（自動採番・不変）のため、payload で送られても更新しない
  // 取引ペア紐付けモデルでは売上行ID は採番後 immutable（戦略思想§3-9-3）
  return { status: 'ok' };
}

/**
 * コスト修正（T列:withholdingAmount・U列:clientId・V列:売上行ID を含む）
 * V列 は取引ペア紐付けモデルの 子キー（紐付け先売上行ID）
 * 通常は linkTransactions アクション経由で更新するが、後方互換のため payload.projectId も受け付ける
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
        taxAmount: Number(row[10]) || 0,        // K列(11) 消費税額
        amount: Number(row[11]) || 0,
        memo: String(row[12] || ''),
        uncollected: Number(row[15]) || 0,
        projectId: String(row[19] || ''),       // T列(20=index 19)・既存名義（後方互換のため残置）
        salesRowId: String(row[19] || ''),      // T列(20=index 19)・取引ペア紐付けモデル親キー
        isProject: String(row[20]).trim() === '1', // U列(21=index 20)・案件化フラグ（§3-9-3 2画面分離）
        isLocked:  Number(row[18]) === 1        // S列(19=index 18)・ロックフラグ
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
        taxAmount: Number(row[10]) || 0,        // K列(11) 消費税額
        amount: Number(row[11]) || 0,
        memo: String(row[12] || ''),
        unpaid: Number(row[15]) || 0,
        withholdingAmount: Number(row[19]) || 0,
        projectId: String(row[21] || ''),       // V列(22=index 21)・既存名義（後方互換のため残置）
        linkedSalesRowId: String(row[21] || ''),// V列(22=index 21)・紐付け先売上行ID（projectIdの別名）
        isLocked: Number(row[18]) === 1         // S列(19=index 18)・ロックフラグ
      });
    });
  }
  results.sort(function(a, b) { return b.date.localeCompare(a.date); });
  return { status: 'ok', data: results };
}

/**
 * 売上シートは 21列構成（T列:売上行ID／U列:isProject 含む・取引ペア紐付けモデル親キー＋案件化フラグ）
 * コストシートは 22列構成（T列:withholdingAmount・U列:clientId・V列:紐付け先売上行ID 含む・取引ペア紐付けモデル子キー）
 *  既存スプレッドシートのヘッダ文字列は migration で書き換えないため、旧顧客環境では「案件ID」表記のまま残置される
 *  GAS は列番号アクセスのためヘッダ文字列の差は機能に影響しない
 */
function getOrCreateSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === '売上') {
      sheet.appendRow(['日付','年','月','顧客コード','売上対象','サービスコード','サービス','諸口品目名','金額(税抜)','税率','消費税','税込金額','メモ','入金日','入金額','未収フラグ','消込状況','登録日時','ロックフラグ','売上行ID','isProject']);
    } else if (name === 'コスト') {
      sheet.appendRow(['日付','年','月','区分コード','経費区分','科目コード','科目','諸口科目名','金額(税抜)','税率','消費税','税込金額','メモ','支払日','支払額','未払フラグ','消込状況','登録日時','ロックフラグ','源泉徴収額','クライアントID','紐付け先売上行ID']);
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
// 取引ペア紐付けモデル（戦略思想§3-9-3）
// 売上行ID（売上T列）＝親キー、売上行ID紐付け（コストV列）＝子キー
// 集計対象4区分：仕入原価系すべて／給料賃金（itemCode=20）／外注工賃（21）／税理士等の報酬（25）
// 大前提：会計データ構造（売上20列・コスト22列・getSummary）は1ミリも動かさない
// =============================================================

/**
 * 日付値を 'yyyy-MM-dd' 文字列に正規化（取引ペア紐付けモデル共通ヘルパー）
 *  - Date 型はタイムゾーン Asia/Tokyo で yyyy-MM-dd フォーマット
 *  - 文字列は先頭10文字を返す（'YYYY-MM-DD' 想定）
 */
function toDateStr_(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return String(val || '').substring(0, 10);
}

/**
 * 紐付け対象判定（コスト行の集計対象4区分）
 *  - divisionCode='1'：仕入原価系すべて
 *  - itemCode='20'   ：給料賃金
 *  - itemCode='21'   ：外注工賃
 *  - itemCode='25'   ：税理士等の報酬
 */
function _isLinkableCostRow_(costRow) {
  var divisionCode = String(costRow[3] || '');
  var subjectCode = String(costRow[5] || '');
  if (divisionCode === '1') return true;
  if (subjectCode === '20') return true;
  if (subjectCode === '21') return true;
  if (subjectCode === '25') return true;
  return false;
}

/**
 * 取引ペア紐付け（複数コスト行を1リクエストで処理可能・技術仕様§9-6 / 指示書5§1-5）
 *  - items 配列（推奨）：[{ rowIndex, salesRowId }, ...]
 *    全件 V列 を更新後、対象 salesRowId の親売上行を1度だけ参照して U列='1' に更新する
 *    （複数アイテムが同一 salesRowId を指していても親売上の参照は1回で済ます）
 *  - 後方互換：data.rowIndex + data.salesRowId 形式の単発 payload も内部で items[] に変換して処理
 *  - 紐付け解除（salesRowId 空）の場合、売上側の U列 は変更しない（案件管理画面に残し続ける運用）
 */
function linkTransactions(data) {
  // payload 正規化：items 配列を優先・なければ単発を1要素配列として扱う（後方互換）
  var items;
  if (data && Array.isArray(data.items)) {
    items = data.items;
  } else if (data && data.rowIndex !== undefined) {
    items = [{ rowIndex: data.rowIndex, salesRowId: data.salesRowId }];
  } else {
    return { status: 'error', message: 'invalid payload: items[] または rowIndex+salesRowId が必要' };
  }
  if (items.length === 0) {
    return { status: 'error', message: 'items[] が空です' };
  }

  var ss = SpreadsheetApp.getActive();
  var costSheet = ss.getSheetByName('コスト');
  if (!costSheet) return { status: 'error', message: 'コストシートが見つかりません' };
  var costLastRow = costSheet.getLastRow();

  // バリデーションを一括で行ってから書き込みを開始する（部分書き込みで整合性が崩れるのを防ぐ）
  var normalized = [];
  for (var i = 0; i < items.length; i++) {
    var rIdx = parseInt(items[i].rowIndex, 10);
    var sId  = String(items[i].salesRowId || '').trim();
    if (!rIdx || rIdx < 2) {
      return { status: 'error', message: 'invalid rowIndex at items[' + i + ']' };
    }
    if (rIdx > costLastRow) {
      return { status: 'error', message: 'rowIndex out of range at items[' + i + ']' };
    }
    if (sId !== '' && !/^s-\d{12}$/.test(sId)) {
      return { status: 'error', message: 'invalid salesRowId format at items[' + i + ']' };
    }
    normalized.push({ rowIndex: rIdx, salesRowId: sId });
  }

  // V列書き込み（全件）
  for (var j = 0; j < normalized.length; j++) {
    costSheet.getRange(normalized[j].rowIndex, 22).setValue(normalized[j].salesRowId);
  }

  // 紐付け成立した salesRowId の親売上行を1度だけ参照して U列='1' に
  var salesRowIndex = null;
  var distinctSalesRowIds = {};
  for (var k = 0; k < normalized.length; k++) {
    if (normalized[k].salesRowId) distinctSalesRowIds[normalized[k].salesRowId] = true;
  }
  var salesSheet = ss.getSheetByName('売上');
  if (salesSheet) {
    var sLast = salesSheet.getLastRow();
    if (sLast >= 2) {
      var idValues = salesSheet.getRange(2, 20, sLast - 1, 2).getValues(); // T列・U列
      for (var sid in distinctSalesRowIds) {
        for (var m = 0; m < idValues.length; m++) {
          if (String(idValues[m][0]) === sid) {
            if (String(idValues[m][1]) !== '1') {
              salesSheet.getRange(m + 2, 21).setValue('1');
            }
            // 後方互換のため最後にヒットした行を返す（旧 payload 時の単発相当）
            salesRowIndex = m + 2;
            break;
          }
        }
      }
    }
  }

  return {
    status: 'ok',
    data: {
      linkedCount: normalized.length,
      salesRowIndex: salesRowIndex
    }
  };
}

/**
 * 対象月の取引階層（案件売上＝親、紐付け済みコスト＝子、未紐付けコスト一覧）を1回で返す
 * 戦略思想§3-9-3 2画面分離モデル：U列(isProject)='1' の売上のみを案件管理画面に表示する
 * 戦略思想§5-1「商売の都合優先」：往復回数を1回に抑えて画面描画速度を確保する
 * payload:
 *   - month ：'YYYY-MM' 形式（省略時は当月）
 * response.data:
 *   - month        : 対象月
 *   - salesNodes[] : { salesRowId, salesRowIndex, salesDate, salesItem, salesAmount, memo,
 *                      linkedCosts[], grossProfit, grossProfitRate }（U列='1' のみ）
 *   - unlinkedCosts[] : { rowIndex, date, subject, amount, memo }（4区分のみ・対象月）
 */
function getTransactionsHierarchy(data) {
  // 初回呼び出し時に既存売上行へ売上行ID 遡及採番（冪等処理）
  migrateSalesRowIds();

  var month = String(data && data.month || '').trim();
  var targetYM;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    targetYM = month;
  } else {
    targetYM = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM');
  }

  var ss = SpreadsheetApp.getActive();
  var salesSheet = ss.getSheetByName('売上');
  var costSheet = ss.getSheetByName('コスト');

  var salesData = [];
  if (salesSheet) {
    var sLast = salesSheet.getLastRow();
    if (sLast >= 2) {
      salesData = salesSheet.getRange(2, 1, sLast - 1, 21).getValues();
    }
  }
  var costData = [];
  if (costSheet) {
    var cLast = costSheet.getLastRow();
    if (cLast >= 2) {
      costData = costSheet.getRange(2, 1, cLast - 1, 22).getValues();
    }
  }

  // 対象月の案件売上行を抽出（U列(isProject)='1' かつ 売上行ID は新形式 ^s-\d{12}$ のみ採用）
  var targetSalesRows = [];
  for (var i = 0; i < salesData.length; i++) {
    var row = salesData[i];
    if (String(row[20]) !== '1') continue;   // U列(21)='1' のみ案件管理対象
    var dateStr = toDateStr_(row[0]);
    if (!dateStr || dateStr.indexOf(targetYM) !== 0) continue;
    var salesRowId = String(row[19] || '');
    if (!/^s-\d{12}$/.test(salesRowId)) continue;
    targetSalesRows.push({
      rowIndex: i + 2,
      salesRowId: salesRowId,
      salesDate: dateStr,
      salesItem: String(row[6] || ''),
      salesAmount: Number(row[11] || 0),
      memo: String(row[12] || '')
    });
  }

  // 紐付け済みコストを売上行IDでグルーピング（4区分のみ集計対象）
  var costsByLinkedId = {};
  for (var k = 0; k < costData.length; k++) {
    var crow = costData[k];
    var linkedId = String(crow[21] || '');
    if (!linkedId) continue;
    if (!_isLinkableCostRow_(crow)) continue;
    if (!costsByLinkedId[linkedId]) costsByLinkedId[linkedId] = [];
    costsByLinkedId[linkedId].push({
      rowIndex: k + 2,
      date: toDateStr_(crow[0]),
      subject: String(crow[6] || ''),
      amount: Number(crow[11] || 0)
    });
  }

  // 売上ノード構築（粗利＝売上税込 - 紐付けコスト税込合計）
  var salesNodes = targetSalesRows.map(function(sales) {
    var linkedCosts = costsByLinkedId[sales.salesRowId] || [];
    var costSum = 0;
    for (var n = 0; n < linkedCosts.length; n++) costSum += linkedCosts[n].amount;
    var grossProfit = sales.salesAmount - costSum;
    var grossProfitRate = sales.salesAmount > 0 ? grossProfit / sales.salesAmount : 0;
    return {
      salesRowId: sales.salesRowId,
      salesRowIndex: sales.rowIndex,
      salesDate: sales.salesDate,
      salesItem: sales.salesItem,
      salesAmount: sales.salesAmount,
      memo: sales.memo,
      linkedCosts: linkedCosts,
      grossProfit: grossProfit,
      grossProfitRate: grossProfitRate
    };
  });
  salesNodes.sort(function(a, b) { return b.salesDate.localeCompare(a.salesDate); });

  // 対象月の未紐付けコスト（4区分のみ）
  var unlinkedCosts = [];
  for (var p = 0; p < costData.length; p++) {
    var ucrow = costData[p];
    var udateStr = toDateStr_(ucrow[0]);
    if (!udateStr || udateStr.indexOf(targetYM) !== 0) continue;
    var uLinkedId = String(ucrow[21] || '');
    if (uLinkedId) continue;
    if (!_isLinkableCostRow_(ucrow)) continue;
    unlinkedCosts.push({
      rowIndex: p + 2,
      date: udateStr,
      subject: String(ucrow[6] || ''),
      amount: Number(ucrow[11] || 0),
      memo: String(ucrow[12] || '')
    });
  }
  unlinkedCosts.sort(function(a, b) { return b.date.localeCompare(a.date); });

  return {
    status: 'ok',
    data: {
      month: targetYM,
      salesNodes: salesNodes,
      unlinkedCosts: unlinkedCosts
    }
  };
}

/**
 * 紐付け候補取得（双方向対応・指示書5§1-4 / 技術仕様§9-6）
 *
 * direction='sales-to-cost'（売上→コスト）：
 *   - 範囲：salesDate の前月頭〜salesDate
 *   - 対象：集計対象4区分（divisionCode='1' / itemCode='20','21','25'）
 *   - 他売上に紐付け済みのコスト行は除外、自身に紐付け済みは currentlyLinked=true で残す
 *
 * direction='cost-to-sales'（コスト→売上）：
 *   - 範囲：costDate〜costDate の翌月末
 *   - 対象：T列(売上行ID) が新形式 ^s-\d{12}$ の売上行（未採番行は除外・紐付けキーなし）
 *   - isProject の状態は問わない（既案件への追加紐付け可能・追加紐付けで親売上はそのまま U='1'）
 *
 * 後方互換：direction 省略・salesRowId 単独 payload は sales-to-cost として処理。
 *  ただし戻り値は新スキーマ { status:'ok', data:{ direction, candidates } } 統一（旧 array 形は廃止）
 */
function getLinkCandidates(data) {
  var direction = String(data && data.direction || '').trim();
  // 後方互換：direction 省略時は sales-to-cost として扱う
  if (!direction) direction = 'sales-to-cost';

  if (direction === 'sales-to-cost') return _getLinkCandidatesSalesToCost_(data);
  if (direction === 'cost-to-sales') return _getLinkCandidatesCostToSales_(data);
  return { status: 'error', message: 'invalid direction: ' + direction };
}

/**
 * 売上→コスト候補（前月頭〜salesDate・集計対象4区分・他売上に紐付け済みは除外）
 */
function _getLinkCandidatesSalesToCost_(data) {
  var salesRowId = String(data && data.salesRowId || '').trim();
  if (!/^s-\d{12}$/.test(salesRowId)) {
    return { status: 'error', message: 'invalid salesRowId' };
  }
  // salesDate は payload 優先・なければ salesRowId の埋め込み日付から復元
  var salesDateStr = String(data && data.salesDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(salesDateStr)) {
    var ymd = salesRowId.substring(2, 10);
    salesDateStr = ymd.substring(0, 4) + '-' + ymd.substring(4, 6) + '-' + ymd.substring(6, 8);
  }
  var baseDate = _parseDateStr_(salesDateStr);
  // 範囲：salesDate の前月頭〜salesDate
  var fromDate = new Date(baseDate.getFullYear(), baseDate.getMonth() - 1, 1);
  var fromStr = _fmtDateStr_(fromDate);
  var toStr   = salesDateStr;

  var costSheet = SpreadsheetApp.getActive().getSheetByName('コスト');
  if (!costSheet) return { status: 'ok', data: { direction: 'sales-to-cost', candidates: [] } };
  var lastRow = costSheet.getLastRow();
  if (lastRow < 2) return { status: 'ok', data: { direction: 'sales-to-cost', candidates: [] } };
  var costData = costSheet.getRange(2, 1, lastRow - 1, 22).getValues();

  var candidates = [];
  for (var i = 0; i < costData.length; i++) {
    var row = costData[i];
    var dateStr = toDateStr_(row[0]);
    if (!dateStr || dateStr < fromStr || dateStr > toStr) continue;
    if (!_isLinkableCostRow_(row)) continue;
    // 他売上に紐付け済みは除外。自身に紐付け済みは currentlyLinked=true で残す
    var currentLinkedId = String(row[21] || '');
    if (currentLinkedId && currentLinkedId !== salesRowId) continue;
    candidates.push({
      rowIndex: i + 2,
      date: dateStr,
      subject: String(row[6] || ''),
      divisionCode: String(row[3] || ''),
      itemCode: String(row[5] || ''),
      amount: Number(row[11] || 0),
      memo: String(row[12] || ''),
      currentlyLinked: currentLinkedId === salesRowId
    });
  }
  candidates.sort(function(a, b) { return b.date.localeCompare(a.date); });
  return { status: 'ok', data: { direction: 'sales-to-cost', candidates: candidates } };
}

/**
 * コスト→売上候補（costDate〜翌月末・新形式salesRowIdを持つ売上のみ・isProject状態は問わない）
 */
function _getLinkCandidatesCostToSales_(data) {
  var costDateStr = String(data && data.costDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(costDateStr)) {
    return { status: 'error', message: 'invalid costDate' };
  }
  var baseDate = _parseDateStr_(costDateStr);
  // 範囲：costDate〜翌月末
  var toDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + 2, 0); // 翌月末
  var fromStr = costDateStr;
  var toStr   = _fmtDateStr_(toDate);

  var salesSheet = SpreadsheetApp.getActive().getSheetByName('売上');
  if (!salesSheet) return { status: 'ok', data: { direction: 'cost-to-sales', candidates: [] } };
  var lastRow = salesSheet.getLastRow();
  if (lastRow < 2) return { status: 'ok', data: { direction: 'cost-to-sales', candidates: [] } };
  var salesData = salesSheet.getRange(2, 1, lastRow - 1, 21).getValues();

  var candidates = [];
  for (var i = 0; i < salesData.length; i++) {
    var row = salesData[i];
    var dateStr = toDateStr_(row[0]);
    if (!dateStr || dateStr < fromStr || dateStr > toStr) continue;
    var sId = String(row[19] || '');
    if (!/^s-\d{12}$/.test(sId)) continue;  // T列未採番の過去データは候補から除外
    candidates.push({
      rowIndex: i + 2,
      salesRowId: sId,
      date: dateStr,
      subject: String(row[6] || row[4] || ''),
      amount: Number(row[11] || 0),
      memo: String(row[12] || ''),
      isProject: String(row[20]).trim() === '1'
    });
  }
  candidates.sort(function(a, b) { return a.date.localeCompare(b.date); });
  return { status: 'ok', data: { direction: 'cost-to-sales', candidates: candidates } };
}

function _parseDateStr_(s) {
  var p = String(s || '').split('-');
  return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
}
function _fmtDateStr_(d) {
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
}

// =============================================================
// 2画面分離モデル：案件化フラグ操作・案件サマリ（戦略思想§3-9-3）
// =============================================================

/**
 * 売上を案件化（U列='1'）に切り替える
 *  T列(売上行ID) が空欄または新形式でない場合は救済採番を実施してから U列を更新する
 *  既に他経路（linkTransactions の自動昇格・既存採番済み行）で '1' の場合も冪等に通る
 * payload:
 *   - rowIndex ：売上シートの行番号（2以上）
 */
function markAsProject(data) {
  var rowIndex = parseInt(data && data.rowIndex, 10);
  if (!rowIndex || rowIndex < 2) {
    return { status: 'error', message: 'invalid rowIndex' };
  }
  var sheet = SpreadsheetApp.getActive().getSheetByName('売上');
  if (!sheet) return { status: 'error', message: '売上シートが見つかりません' };
  if (rowIndex > sheet.getLastRow()) {
    return { status: 'error', message: 'rowIndex out of range' };
  }
  // T列が空欄または新形式でない場合、救済採番（既存売上の案件化サポート）
  var currentT = sheet.getRange(rowIndex, 20).getValue();
  var assignedSalesRowId = (typeof currentT === 'string' && /^s-\d{12}$/.test(currentT)) ? currentT : '';
  if (!assignedSalesRowId) {
    var dateVal = sheet.getRange(rowIndex, 1).getValue();
    var dateStr = toDateStr_(dateVal);
    assignedSalesRowId = generateSalesRowId(dateStr);
    sheet.getRange(rowIndex, 20).setValue(assignedSalesRowId);
  }
  sheet.getRange(rowIndex, 21).setValue('1');
  return { status: 'ok', data: { rowIndex: rowIndex, salesRowId: assignedSalesRowId } };
}

/**
 * 売上の案件化を解除（U列を空欄）に切り替える
 *  T列(売上行ID) と紐付け済みコストの V列 は変更しない
 *  → 売上自体は月次管理で集計され続け、紐付け済みコストの会計データ構造も維持される
 * payload:
 *   - rowIndex ：売上シートの行番号（2以上）
 */
function unmarkAsProject(data) {
  var rowIndex = parseInt(data && data.rowIndex, 10);
  if (!rowIndex || rowIndex < 2) {
    return { status: 'error', message: 'invalid rowIndex' };
  }
  var sheet = SpreadsheetApp.getActive().getSheetByName('売上');
  if (!sheet) return { status: 'error', message: '売上シートが見つかりません' };
  if (rowIndex > sheet.getLastRow()) {
    return { status: 'error', message: 'rowIndex out of range' };
  }
  sheet.getRange(rowIndex, 21).setValue('');
  return { status: 'ok', data: { rowIndex: rowIndex } };
}

/**
 * 月次案件集計（件数・売上合計・粗利合計）
 *  - U列='1' の売上のみを母集団とする（戦略思想§3-9-3 2画面分離モデル）
 *  - 紐付けコストは集計対象4区分（仕入原価系／給料賃金／外注工賃／税理士等の報酬）に限る
 *  - 粗利＝案件売上合計 - 紐付けコスト合計
 * payload:
 *   - month ：'YYYY-MM' 形式（省略時は当月）
 */
function getProjectSummary(data) {
  var month = String(data && data.month || '').trim();
  var targetYM;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    targetYM = month;
  } else {
    targetYM = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM');
  }

  var ss = SpreadsheetApp.getActive();
  var salesSheet = ss.getSheetByName('売上');
  var costSheet = ss.getSheetByName('コスト');

  var salesData = [];
  if (salesSheet) {
    var sLast = salesSheet.getLastRow();
    if (sLast >= 2) {
      salesData = salesSheet.getRange(2, 1, sLast - 1, 21).getValues();
    }
  }
  var costData = [];
  if (costSheet) {
    var cLast = costSheet.getLastRow();
    if (cLast >= 2) {
      costData = costSheet.getRange(2, 1, cLast - 1, 22).getValues();
    }
  }

  var projectCount = 0;
  var projectSales = 0;
  var targetSalesRowIds = {};
  for (var i = 0; i < salesData.length; i++) {
    var row = salesData[i];
    if (String(row[20]) !== '1') continue;
    var dateStr = toDateStr_(row[0]);
    if (!dateStr || dateStr.indexOf(targetYM) !== 0) continue;
    var salesRowId = String(row[19] || '');
    if (!/^s-\d{12}$/.test(salesRowId)) continue;
    projectCount++;
    projectSales += Number(row[11] || 0);
    targetSalesRowIds[salesRowId] = true;
  }

  var projectCostTotal = 0;
  for (var j = 0; j < costData.length; j++) {
    var crow = costData[j];
    var linkedTo = String(crow[21] || '');
    if (!linkedTo) continue;
    if (!targetSalesRowIds[linkedTo]) continue;
    if (!_isLinkableCostRow_(crow)) continue;
    projectCostTotal += Number(crow[11] || 0);
  }

  return {
    status: 'ok',
    data: {
      month: targetYM,
      projectCount: projectCount,
      projectSales: projectSales,
      projectGrossProfit: projectSales - projectCostTotal
    }
  };
}

// =============================================================
// PC版月次管理画面：インライン編集保存・ロック解除申請（指示書5§1-2 §1-3 / 技術仕様§4-6 §3）
// =============================================================

/**
 * 月次管理画面のインライン編集保存（部分更新）
 * 既存 updateSales / updateCost とは別系統。スマホ・iPad版の挙動には影響しない
 *
 * payload:
 *   - sheetName : "売上" または "コスト"
 *   - rowIndex  : 対象行番号（2以上）
 *   - fields    : 部分更新フィールド（指定キーのみ書き込み・他は元値維持）
 *       date / amount / taxRate / memo / subjectCode / subjectName
 *
 * 動作仕様（指示書5§1-2）：
 *   1. S列(19)='1' の行は更新拒否（'ロック行は更新できません'）
 *   2. amount または taxRate が含まれる場合、サーバー側で§6-4 整数演算で再計算し
 *      I列(税抜)・J列(税率)・K列(消費税)・L列(税込) をまとめて書き込む
 *   3. subjectCode は F列、subjectName は G列に書き込む（売上・コスト共通）
 *   4. isProject / projectId など案件化系フィールドは fields に紛れ込んでも無視
 *      （markAsProject / linkTransactions / unmarkAsProject 経由の設計を厳守）
 *   5. レスポンス：updatedFields[] と recalculated（再計算した場合のみ）を返す
 */
function updateRow(data) {
  var sheetName = String(data && data.sheetName || '').trim();
  var rowIndex  = parseInt(data && data.rowIndex, 10);
  var fields    = (data && typeof data.fields === 'object' && data.fields) ? data.fields : {};

  if (sheetName !== '売上' && sheetName !== 'コスト') {
    return { status: 'error', message: 'invalid sheetName' };
  }
  if (!rowIndex || rowIndex < 2) {
    return { status: 'error', message: 'invalid rowIndex' };
  }

  var sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet) return { status: 'error', message: sheetName + 'シートが見つかりません' };
  if (rowIndex > sheet.getLastRow()) {
    return { status: 'error', message: 'rowIndex out of range' };
  }

  // ロックチェック：S列(19)=1 は更新拒否
  var lockFlag = Number(sheet.getRange(rowIndex, 19).getValue()) || 0;
  if (lockFlag === 1) {
    return { status: 'error', message: 'ロック行は更新できません' };
  }

  var updated = [];

  // 日付：A・B・C列まとめて更新
  if (fields.date !== undefined) {
    var d = String(fields.date || '');
    var p = d.split('-');
    sheet.getRange(rowIndex, 1).setValue(d);
    sheet.getRange(rowIndex, 2).setValue(Number(p[0]) || '');
    sheet.getRange(rowIndex, 3).setValue(Number(p[1]) || '');
    updated.push('date');
  }

  // 科目コード（F列） / 科目名（G列）
  if (fields.subjectCode !== undefined) {
    sheet.getRange(rowIndex, 6).setValue(String(fields.subjectCode || ''));
    updated.push('subjectCode');
  }
  if (fields.subjectName !== undefined) {
    sheet.getRange(rowIndex, 7).setValue(String(fields.subjectName || ''));
    updated.push('subjectName');
  }

  // メモ（M列）
  if (fields.memo !== undefined) {
    sheet.getRange(rowIndex, 13).setValue(String(fields.memo || ''));
    updated.push('memo');
  }

  // 金額・税率：いずれかが含まれていればサーバー側で§6-4 整数演算で再計算
  var recalculated = null;
  if (fields.amount !== undefined || fields.taxRate !== undefined) {
    // 既存値を読み込み、payload で指定があれば上書き
    var currentRate   = Number(sheet.getRange(rowIndex, 10).getValue()) || 0;
    var currentInAmt  = Number(sheet.getRange(rowIndex, 12).getValue()) || 0;
    var inAmt = (fields.amount !== undefined)
      ? Math.max(0, Math.floor(Number(fields.amount) || 0))
      : currentInAmt;
    var rate  = (fields.taxRate !== undefined)
      ? (Number(fields.taxRate) || 0)
      : currentRate;
    var taxExcluded;
    var tax;
    if (rate <= 0) {
      taxExcluded = inAmt;
      tax = 0;
    } else {
      taxExcluded = Math.floor((inAmt * 100) / (100 + rate));
      if (taxExcluded === 0 && inAmt > 0) {
        taxExcluded = inAmt;
        tax = 0;
      } else {
        tax = inAmt - taxExcluded;
      }
    }
    sheet.getRange(rowIndex,  9).setValue(taxExcluded); // I列(税抜)
    sheet.getRange(rowIndex, 10).setValue(rate);        // J列(税率)
    sheet.getRange(rowIndex, 11).setValue(tax);         // K列(消費税)
    sheet.getRange(rowIndex, 12).setValue(inAmt);       // L列(税込)
    if (fields.amount !== undefined) updated.push('amount');
    if (fields.taxRate !== undefined) updated.push('taxRate');
    recalculated = { taxAmount: tax, taxExcluded: taxExcluded };
  }

  // isProject / projectId などは仕様により無視（書き込まない）

  var resp = {
    status: 'ok',
    data: {
      sheetName: sheetName,
      rowIndex: rowIndex,
      updatedFields: updated
    }
  };
  if (recalculated) resp.data.recalculated = recalculated;
  return resp;
}

/**
 * ロック解除申請（PC版「月次管理」ロック行の解除申請ボタンから呼ばれる・3デバイス統合§3）
 * _unlock_requests シート（なければ作成）に申請レコードを追記する
 * 承認画面（スマホ・iPad）の実装は別指示書で対応（本指示書ではスキーマと append のみ）
 *
 * payload:
 *   - sheetName : "売上" または "コスト"
 *   - rowIndex  : 対象行番号
 *   - reason    : （任意）申請理由
 */
function requestUnlock(data) {
  var sheetName = String(data && data.sheetName || '').trim();
  var rowIndex  = parseInt(data && data.rowIndex, 10);
  var reason    = String(data && data.reason || '');
  var clientId  = String(data && data.clientId || '');

  if (sheetName !== '売上' && sheetName !== 'コスト') {
    return { status: 'error', message: 'invalid sheetName' };
  }
  if (!rowIndex || rowIndex < 2) {
    return { status: 'error', message: 'invalid rowIndex' };
  }

  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('_unlock_requests');
  if (!sheet) {
    sheet = ss.insertSheet('_unlock_requests');
    sheet.appendRow(['clientId', 'sheetName', 'rowIndex', 'reason', 'requestedAt', 'status']);
    sheet.setFrozenRows(1);
  }
  var requestedAt = new Date();
  sheet.appendRow([clientId, sheetName, rowIndex, reason, requestedAt, 'pending']);
  var requestId = sheet.getLastRow(); // 行番号を ID として返す（簡易・ユニーク）
  return { status: 'ok', data: { requestId: requestId } };
}
