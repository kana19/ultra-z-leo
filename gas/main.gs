// ============================================================
// ユーザーGAS テンプレート本体（ultra-z-leo / gas/main.gs）
// SPREADSHEET_ID は prepareUserGasCode（マスタGAS）が各店舗の値に置換する。
// スタンドアロン Apps Script として手動デプロイされるため、
// getActiveSpreadsheet() は使えず openById(SPREADSHEET_ID) で開く。
// ============================================================
const SPREADSHEET_ID = '__SPREADSHEET_ID__';
function _ss_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }

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
      case 'getRecentEntries':          result = getRecentEntries(data.limit);            break;
      case 'clearUnpaid':               result = clearUnpaid(data);                       break;
      case 'reconcile':                 result = reconcile(data);                         break;
      case 'getSettings':               result = getSettings();                           break;
      case 'saveSettings':              result = saveSettings(data);                      break;
      case 'saveQrLocations':           result = saveQrLocations(data);                   break;
      // 6-G フェーズ2：サービス／仕入マスタ追加・更新・削除（枠超過チェック付・サーバ側ID採番）
      case 'addServiceItem':            result = addServiceItem(data);                    break;
      case 'updateServiceItem':         result = updateServiceItem(data);                 break;
      case 'deleteServiceItem':         result = deleteServiceItem(data);                 break;
      case 'addPurchaseItem':           result = addPurchaseItem(data);                   break;
      case 'updatePurchaseItem':        result = updatePurchaseItem(data);                break;
      case 'deletePurchaseItem':        result = deletePurchaseItem(data);                break;
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
      // 指示書15：行削除（売上・コスト両対応・ロック行拒否・売上削除時は紐付け経費のV列を空欄化）
      case 'deleteRow':                 result = deleteRow(data);                         break;
      // A-2タスク：PC版出勤管理 給与計算確定処理（コストシートT列に源泉徴収額を記録）
      case 'confirmPayroll':            result = confirmPayroll(data);                    break;
      // A-1タスク：タイムカードPWA（スタッフ別出勤履歴・スタッフ検証）
      case 'validateStaff':             result = validateStaff(data);                     break;
      case 'getAttendanceForStaff':     result = getAttendanceForStaff(data);             break;
      // 段3：シフト希望（shiftScheduleEnabled・→ 01_商品体系.md §4-6）
      case 'getShifts':                 result = getShifts(data);                         break;
      case 'getShiftsForStaff':         result = getShiftsForStaff(data);                 break;
      case 'saveShift':                 result = saveShift(data);                         break;
      case 'deleteShift':               result = deleteShift(data);                       break;
      // 警備隊第5隊員 FAX注文自動管理（fax_order_ocr・→ 知識MD 05§8-7）
      case 'getOrders':                 result = getOrders(data);                         break;
      case 'saveOrder':                 result = saveOrder(data);                         break;
      case 'updateOrder':               result = updateOrder(data);                       break;
      case 'deleteOrder':               result = deleteOrder(data);                       break;
      case 'faxOrderScanTier1':         result = faxOrderScanTier1(data);                 break;
      case 'previewFaxOrder':           result = previewFaxOrder(data);                   break;
      case 'faxOrderPoll':              result = faxOrderGmailPoll();                     break;
      case 'getFaxOrderConfig':         result = getFaxOrderConfig();                     break;
      case 'setupFaxOrderTrigger':      result = setupFaxOrderTrigger();                  break;
      // 警備隊第4隊員 書類発行自動化＋商品マスタ（doc_automation・→ 知識MD 05§8-5）
      case 'migrateDocAutomationSchema': result = migrateDocAutomationSchema();           break;
      case 'getProducts':               result = getProducts();                           break;
      case 'addProduct':                result = addProduct(data);                        break;
      case 'updateProduct':             result = updateProduct(data);                     break;
      case 'deleteProduct':             result = deleteProduct(data);                     break;
      case 'saveProducts':              result = saveProducts(data);                      break;
      case 'getCustomers':              result = getCustomers();                          break;
      case 'addCustomer':               result = addCustomer(data);                       break;
      case 'updateCustomer':            result = updateCustomer(data);                    break;
      case 'deleteCustomer':            result = deleteCustomer(data);                    break;
      case 'issueDocument':             result = issueDocument(data);                     break;
      case 'getDocuments':              result = getDocuments(data);                      break;
      case 'getInvoicesUnpaid':         result = getInvoicesUnpaid();                     break;
      case 'recordPayment':             result = recordPayment(data);                     break;
      case 'getDocSummary':             result = getDocSummary(data);                     break;
      default: result = { status: 'error', message: '不明なアクション: ' + action };
    }
  } catch (err) {
    result = { status: 'error', message: err.message };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// doPost：GETのURL長制限を超える大きなペイロード（Tier1のFAX撮影base64画像）用。
// body は JSON文字列 {action, data}。Content-Type は text/plain 前提（CORSプリフライト回避）。
function doPost(e) {
  var result;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = body.action;
    var data = body.data || {};
    switch (action) {
      case 'faxOrderScanTier1': result = faxOrderScanTier1(data); break;
      case 'previewFaxOrder':   result = previewFaxOrder(data);   break;
      // 書類発行＋商品マスタ（doc_automation・§8-5）：運営ポータル(admin)は master プロキシ
      // 経由の POST でユーザーGASへ届く。商品マスタは admin が納品時に一括投入するため
      // getProducts（読込）／saveProducts（業種雛形の一括置換）を doPost にも公開する。
      // ※日常の個別 CRUD（addProduct 等）はユーザーPWAが doGet で使う（Phase4）。
      case 'getProducts':       result = getProducts();          break;
      case 'saveProducts':      result = saveProducts(data);     break;
      default: result = { status: 'error', message: 'doPost 未対応アクション: ' + action };
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
  // §6-4 整数演算で税額を再計算（クライアント送信値は参考情報・サーバーが正規値を確定）
  var rate = Number(data.taxRate) || 0;
  var inAmt = Math.max(0, Math.floor(Number(data.amountInTax) || 0));
  var t = calcTax_(inAmt, rate);
  sheet.appendRow([
    date, Number(parts[0]) || '', Number(parts[1]) || '',
    data.customerCode || '', data.serviceName || '',
    data.serviceCode  || '', data.serviceName || '',
    data.miscItemName || '',
    t.taxExcluded, rate,
    t.taxAmount, inAmt,
    data.memo || '', '', '',
    Number(data.uncollected) || 0, new Date(), new Date(), 0,
    salesRowId,                                    // T列(20) 売上行ID（自動採番・取引ペア紐付けモデル）
    isProject                                      // U列(21) 案件化フラグ（戦略思想§3-9-3 2画面分離モデル）
  ]);
  return { status: 'ok', salesRowId: salesRowId, rowIndex: sheet.getLastRow() };
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
  var sheet = _ss_().getSheetByName('売上');
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
  var sheet = _ss_().getSheetByName('売上');
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
 *
 *  人件費系科目（20/21/25）も通常のコスト追記として扱う。スマホ/iPad のスタッフ紐付け都度入力は持たない。
 *  人件費の算出・確定は勤怠管理→PC出勤管理で行う（→ 02§5-9 / 03§5-2）。
 *  PC給与確定（subType==='20a'）の行は H列に「[月次]スタッフ名」を記録する。
 *  PC出勤管理がこの記録を読んで当月の給与確定済みを判定・復元する。
 */
function addCost(data) {
  var date = data.date || '';
  var parts = date.split('-');
  var sheet = getOrCreateSheet('コスト');
  // §6-4 整数演算で税額を再計算（クライアント送信値は参考情報・サーバーが正規値を確定）
  var rate = Number(data.taxRate) || 0;
  var inAmt = Math.max(0, Math.floor(Number(data.taxIncluded) || 0));
  var t = calcTax_(inAmt, rate);

  var itemCode     = String(data.itemCode || '');
  var miscItemName = data.miscItemName || '';

  // PC給与確定行（subType==='20a'）は H列に「[月次]スタッフ名」を記録する（確定状態の復元キー）
  if (String(data.subType || '') === '20a' && String(data.staffName || '')) {
    miscItemName = '[月次]' + String(data.staffName);
  }

  sheet.appendRow([
    date, Number(parts[0]) || '', Number(parts[1]) || '',
    data.divisionCode || '', data.divisionName || '',
    itemCode, data.itemName || '',
    miscItemName,
    t.taxExcluded, rate,
    t.taxAmount, inAmt,
    data.memo || '', '', '',
    Number(data.unpaid) || 0, new Date(), new Date(), 0,
    Number(data.withholdingAmount) || 0,   // T列(20)
    String(data.clientId || ''),            // U列(21)
    String(data.projectId || '')            // V列(22) 紐付け先売上行ID（取引ペア紐付けモデル）
  ]);

  return { status: 'ok', rowIndex: sheet.getLastRow() };
}

function updateSales(data) {
  if (!data.rowIndex) return { status: 'error', message: 'rowIndexが必要です' };
  var ss    = _ss_();
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
  // §6-4 整数演算で税額を再計算（クライアント送信値の tax / amountExTax は無視）
  var _sRate  = Number(data.taxRate) || 0;
  var _sInAmt = Math.max(0, Math.floor(Number(data.amountInTax) || 0));
  var _sTax   = calcTax_(_sInAmt, _sRate);
  sheet.getRange(row,  9).setValue(_sTax.taxExcluded);
  sheet.getRange(row, 10).setValue(_sRate);
  sheet.getRange(row, 11).setValue(_sTax.taxAmount);
  sheet.getRange(row, 12).setValue(_sInAmt);
  sheet.getRange(row, 13).setValue(data.memo         || '');
  sheet.getRange(row, 16).setValue(Number(data.uncollected)  || 0);
  // R列(18) 登録/更新日時：編集時に更新し「最後に登録・編集した順」を保持（→ 02_画面仕様.md §2-2）
  sheet.getRange(row, 18).setValue(new Date());
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
  var ss    = _ss_();
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
  // §6-4 整数演算で税額を再計算（クライアント送信値の tax / taxExcluded は無視）
  var _cRate  = Number(data.taxRate) || 0;
  var _cInAmt = Math.max(0, Math.floor(Number(data.taxIncluded) || 0));
  var _cTax   = calcTax_(_cInAmt, _cRate);
  sheet.getRange(row,  9).setValue(_cTax.taxExcluded);
  sheet.getRange(row, 10).setValue(_cRate);
  sheet.getRange(row, 11).setValue(_cTax.taxAmount);
  sheet.getRange(row, 12).setValue(_cInAmt);
  sheet.getRange(row, 13).setValue(data.memo         || '');
  sheet.getRange(row, 16).setValue(Number(data.unpaid)       || 0);
  // R列(18) 登録/更新日時：編集時に更新し「最後に登録・編集した順」を保持（→ 02_画面仕様.md §2-2）
  sheet.getRange(row, 18).setValue(new Date());
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
  var ss    = _ss_();
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
  var ss = _ss_();
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
  var ss = _ss_();
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
  var ss    = _ss_();
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
  var ss = _ss_();
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
  var ss = _ss_();
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
        updatedAt: (row[17] instanceof Date ? row[17].getTime() : (row[17] ? (new Date(row[17]).getTime() || 0) : 0)), // R列(18=index 17) 登録/更新日時
        createdAt: (row[16] instanceof Date ? row[16].getTime() : (row[16] ? (new Date(row[16]).getTime() || 0) : 0)), // Q列(17=index 16) 作成日時
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
        updatedAt: (row[17] instanceof Date ? row[17].getTime() : (row[17] ? (new Date(row[17]).getTime() || 0) : 0)), // R列(18=index 17) 登録/更新日時
        createdAt: (row[16] instanceof Date ? row[16].getTime() : (row[16] ? (new Date(row[16]).getTime() || 0) : 0)), // Q列(17=index 16) 作成日時
        isLocked: Number(row[18]) === 1         // S列(19=index 18)・ロックフラグ
      });
    });
  }
  results.sort(function(a, b) { return b.date.localeCompare(a.date); });
  return { status: 'ok', data: results };
}

/**
 * 直近入力（ホーム）専用：発生月でフィルタせず、登録/更新日時の新しい順に
 * 売上・コストを横断して直近 limit 件返す（→ 02_画面仕様.md §2-2 登録順）。
 * 先月発生だが今月登録・編集した行もホームの直近入力に反映するため、
 * getHistory（発生月フィルタ）と分離する。
 */
function getRecentEntries(limit) {
  var n = Number(limit) > 0 ? Number(limit) : 20;
  var all = getHistory('').data; // 月指定なし＝全件・各行に createdAt/updatedAt を含む
  all.sort(function(a, b) {
    var ka = Math.max(a.updatedAt || 0, a.createdAt || 0);
    var kb = Math.max(b.updatedAt || 0, b.createdAt || 0);
    if (kb !== ka) return kb - ka;
    return String(b.date).localeCompare(String(a.date));
  });
  return { status: 'ok', data: all.slice(0, n) };
}

/**
 * 売上シートは 21列構成（T列:売上行ID／U列:isProject 含む・取引ペア紐付けモデル親キー＋案件化フラグ）
 * コストシートは 22列構成（T列:withholdingAmount・U列:clientId・V列:紐付け先売上行ID 含む・取引ペア紐付けモデル子キー）
 *  既存スプレッドシートのヘッダ文字列は migration で書き換えないため、旧顧客環境では「案件ID」表記のまま残置される
 *  GAS は列番号アクセスのためヘッダ文字列の差は機能に影響しない
 */
function getOrCreateSheet(name) {
  var ss = _ss_();
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
 * B1:storeName / B2:staffList / B3:serviceList / B4:costMasterList /
 * B5:purchaseMasterList / B16:featureVisibility(JSON) /
 * B17:masterQuota(JSON・v0.5.6 新設) / B18:businessHours(JSON)
 *
 * A-9-X：業態固定概念撤廃に伴い、B12:storeType / B13:templateId / B14:uiLabels の参照を廃止。
 * 既存ユーザーのスプレッドシートに値が残っていても無害（コード側で参照しない）。
 * featureVisibility 未設定時は {} をデフォルトで返す（運営ポータルから設定される）。
 *
 * 6-G フェーズ2（v0.5.6 連動）：
 *   - B4 costMasterList を応答に含める（フロントで枠超過チェック等に使用）
 *   - B5 purchaseMasterList を応答に含める
 *   - B17 masterQuota を応答に含める
 *     未設定（既存ユーザー）は null。フロント側は null 時に上限制御を無効化する
 *     （00_原則.md §6-6 の上限制御は枠数取得不能時はフォールバック動作）
 */
function getSettings() {
  var sheet = _ss_().getSheetByName('settings');
  if (!sheet) return { status: 'error', message: 'settingsシートが見つかりません' };
  var storeName            = sheet.getRange('B1').getValue();
  var staffJson            = sheet.getRange('B2').getValue();
  var serviceJson          = sheet.getRange('B3').getValue();
  var costMasterJson       = sheet.getRange('B4').getValue();
  var purchaseMasterJson   = sheet.getRange('B5').getValue();
  var qrLocationsJson      = sheet.getRange('B6').getValue();
  var invoiceSettingsJson  = sheet.getRange('B7').getValue();
  var featureVisibilityJson = sheet.getRange('B16').getValue();
  var masterQuotaRaw       = sheet.getRange('B17').getValue();
  var businessHoursRaw     = sheet.getRange('B18').getValue();
  var faxPatternsJson      = sheet.getRange('B19').getValue();
  var staffList = [], serviceList = [], costMasterList = [], purchaseMasterList = [];
  try { if (staffJson)            staffList            = JSON.parse(staffJson);          } catch(e) {}
  try { if (serviceJson)          serviceList          = JSON.parse(serviceJson);        } catch(e) {}
  try { if (costMasterJson)       costMasterList       = JSON.parse(costMasterJson);     } catch(e) {}
  try { if (purchaseMasterJson)   purchaseMasterList   = JSON.parse(purchaseMasterJson); } catch(e) {}
  // costMasterList は販管費専用（→ 03_データ仕様.md §1-2）。仕入原価（divisionCode='1'）は含めない。
  // smartphoneVisible キーを保証（販管費マスタのみ搭載・戦略思想§3-5）
  if (Array.isArray(costMasterList)) {
    costMasterList = costMasterList
      .filter(function(item) {
        return !item || !item.divisionCode || String(item.divisionCode) === '2';
      })
      .map(function(item) {
        item.smartphoneVisible = item.smartphoneVisible !== false;
        return item;
      });
  } else {
    costMasterList = [];
  }
  if (!Array.isArray(purchaseMasterList)) purchaseMasterList = [];
  if (!Array.isArray(serviceList)) serviceList = [];
  // qrLocations（段2・QR現地証明の拠点リスト・→ 03_データ仕様.md §6）。
  // 形式：[{code:"01", label:"本店"}, ...]。未設定時は []（validateStaff は空なら accept）。
  var qrLocations = [];
  try { if (qrLocationsJson) qrLocations = JSON.parse(qrLocationsJson); } catch(e) {}
  if (!Array.isArray(qrLocations)) qrLocations = [];
  qrLocations = qrLocations
    .filter(function(l) { return l && l.code; })
    .map(function(l) { return { code: String(l.code), label: String(l.label || '') }; });
  // employmentType を3種化（employed_full / employed_temp / contractor）
  // 旧 'employed' および未設定は 'employed_full' に自動マイグレーション（戦略思想§3-9-3 サイクルA）
  staffList = staffList.map(function(s) {
    s.employmentType = _normalizeEmploymentType_(s.employmentType);
    return s;
  });
  // featureVisibility は JSON 文字列。パース失敗・未設定時は {} を返す
  var featureVisibility = {};
  try { if (featureVisibilityJson) featureVisibility = JSON.parse(featureVisibilityJson); } catch(e) {}
  if (!featureVisibility || typeof featureVisibility !== 'object') featureVisibility = {};
  // masterQuota は JSON 文字列。パース失敗・未設定時は null を返す（6-G フェーズ2）
  // 形式：{serviceMasterQuota:number, purchaseMasterQuota:number, costOptionalQuota:number}
  var masterQuota = null;
  try {
    if (masterQuotaRaw) {
      var mqParsed = (typeof masterQuotaRaw === 'string') ? JSON.parse(masterQuotaRaw) : masterQuotaRaw;
      if (mqParsed && typeof mqParsed === 'object'
          && typeof mqParsed.serviceMasterQuota === 'number'
          && typeof mqParsed.purchaseMasterQuota === 'number') {
        masterQuota = {
          serviceMasterQuota: Math.max(1, Math.floor(Number(mqParsed.serviceMasterQuota) || 5)),
          purchaseMasterQuota: Math.max(1, Math.floor(Number(mqParsed.purchaseMasterQuota) || 3)),
          costOptionalQuota: Math.max(1, Math.floor(Number(mqParsed.costOptionalQuota) || 5))
        };
      }
    }
  } catch(e) { masterQuota = null; }
  // businessHours は JSON 文字列。パース失敗・未設定時は null を返す（A-9：出勤履歴の打刻状態判定で使用）
  // 形式：{open:"HH:MM", close:"HH:MM", closeNextDay:boolean}
  var businessHours = null;
  try {
    if (businessHoursRaw) {
      var bhParsed = (typeof businessHoursRaw === 'string') ? JSON.parse(businessHoursRaw) : businessHoursRaw;
      if (bhParsed && typeof bhParsed === 'object' && bhParsed.open && bhParsed.close) {
        businessHours = {
          open: String(bhParsed.open),
          close: String(bhParsed.close),
          closeNextDay: !!bhParsed.closeNextDay
        };
      }
    }
  } catch(e) { businessHours = null; }
  // faxPatterns（第5隊員 FAX注文自動管理の取引先ひな形・→ 05§8-7 / 03§6）。
  // 形式：[{id, supplierName, senderFax, layoutType, instructions, expansion, aliases, enabled, updatedAt}, ...]
  var faxPatterns = [];
  try { if (faxPatternsJson) faxPatterns = JSON.parse(faxPatternsJson); } catch(e) {}
  if (!Array.isArray(faxPatterns)) faxPatterns = [];
  // invoiceSettings（第4隊員 書類発行の敬称デフォルト等・settings B7・→ 05§8-5）
  var invoiceSettings = { honorificDefault: '御中' };
  try { if (invoiceSettingsJson) invoiceSettings = JSON.parse(invoiceSettingsJson); } catch(e) {}
  if (!invoiceSettings || typeof invoiceSettings !== 'object') invoiceSettings = { honorificDefault: '御中' };
  return { status: 'ok', data: {
    storeName: storeName || '',
    staffList: staffList,
    serviceList: serviceList,
    costMasterList: costMasterList,
    purchaseMasterList: purchaseMasterList,
    qrLocations: qrLocations,
    featureVisibility: featureVisibility,
    masterQuota: masterQuota,
    businessHours: businessHours,
    faxPatterns: faxPatterns,
    invoiceSettings: invoiceSettings
  }};
}

/**
 * settings保存
 * A-9-X：業態固定概念撤廃に伴い、storeType / templateId / uiLabels の受け取りを廃止。
 * 既存ユーザーのスプレッドシート B12 / B13 / B14 セルは触らない（残置しても無害）。
 *
 * 6-G フェーズ2（v0.5.6 連動）：
 *   - serviceList / purchaseMasterList / costMasterList の受口を整理
 *   - 各リスト送信時のみ更新（未送信時は既存値維持）
 *   - スマホ・PC 設定画面のサービスマスタ／仕入マスタ／販管費マスタ編集で使用
 */
function saveSettings(data) {
  var sheet = _ss_().getSheetByName('settings');
  if (!sheet) return { status: 'error', message: 'settingsシートが見つかりません' };
  var staffList = (data.staffList || []).map(function(s) {
    s.employmentType = _normalizeEmploymentType_(s.employmentType);
    return s;
  });
  sheet.getRange('A1').setValue('storeName');
  sheet.getRange('B1').setValue(data.storeName || '');
  sheet.getRange('A2').setValue('staffList');
  sheet.getRange('B2').setValue(JSON.stringify(staffList));
  // serviceList は送信された場合のみ更新（部分更新方式）
  if (data.serviceList !== undefined) {
    sheet.getRange('A3').setValue('serviceList');
    sheet.getRange('B3').setValue(JSON.stringify(data.serviceList || []));
  }
  // costMasterList は送信された場合のみ更新（PC設定画面・運営ポータル経由想定）
  if (data.costMasterList !== undefined) {
    sheet.getRange('A4').setValue('costMasterList');
    sheet.getRange('B4').setValue(JSON.stringify(data.costMasterList || []));
  }
  // purchaseMasterList は送信された場合のみ更新（6-G フェーズ2 で受口追加）
  if (data.purchaseMasterList !== undefined) {
    sheet.getRange('A5').setValue('purchaseMasterList');
    sheet.getRange('B5').setValue(JSON.stringify(data.purchaseMasterList || []));
  }
  // featureVisibility は運営ポータルから送信された場合のみ更新（納品時設定原則）
  if (data.featureVisibility !== undefined) {
    sheet.getRange('A16').setValue('featureVisibility');
    sheet.getRange('B16').setValue(JSON.stringify(data.featureVisibility || {}));
  }
  // businessHours は通常の顧客UIからは送信されないが、運営ポータルから送信された場合のみ更新（A-9）
  // 形式：{open:"HH:MM", close:"HH:MM", closeNextDay:boolean}
  if (data.businessHours !== undefined) {
    sheet.getRange('A18').setValue('businessHours');
    if (data.businessHours && typeof data.businessHours === 'object' && data.businessHours.open && data.businessHours.close) {
      sheet.getRange('B18').setValue(JSON.stringify({
        open: String(data.businessHours.open),
        close: String(data.businessHours.close),
        closeNextDay: !!data.businessHours.closeNextDay
      }));
    } else {
      sheet.getRange('B18').setValue('');
    }
  }
  // faxPatterns は運営ポータルから送信された場合のみ更新（納品時設定原則・→ 05§8-7）
  if (data.faxPatterns !== undefined) {
    sheet.getRange('A19').setValue('faxPatterns');
    sheet.getRange('B19').setValue(JSON.stringify(data.faxPatterns || []));
  }
  // invoiceSettings（敬称デフォルト等・第4隊員 書類発行・→ 05§8-5）は送信時のみ更新
  if (data.invoiceSettings !== undefined) {
    sheet.getRange('A7').setValue('invoiceSettings');
    sheet.getRange('B7').setValue(JSON.stringify(data.invoiceSettings || {}));
  }
  return { status: 'ok' };
}

/**
 * qrLocations 保存（段2・QR現地証明の拠点リスト・settings B6）
 * オーナー拠点管理UI（→ 04_運営ポータル.md §10）から送信される。
 *   - data.qrLocations: [{code:"01", label:"本店"}, ...]
 *   - code は 拠点NN（"01"〜）。重複 code は先勝ちで除去。label 空は許容しない。
 *   - 既定 -01（code:"01"）の初期化はマスタGAS（createUserSpreadsheet）が担う。
 */
function saveQrLocations(data) {
  var sheet = _ss_().getSheetByName('settings');
  if (!sheet) return { status: 'error', message: 'settingsシートが見つかりません' };
  var input = (data && data.qrLocations) || [];
  if (!Array.isArray(input)) return { status: 'error', message: 'qrLocations が不正です' };
  var seen = {};
  var list = [];
  for (var i = 0; i < input.length; i++) {
    var raw = input[i] || {};
    var code = String(raw.code || '').trim();
    var label = String(raw.label || '').trim();
    if (!code || !label) continue;
    // 拠点NN は 2桁ゼロ詰めに正規化（"1"→"01"）
    if (/^\d+$/.test(code)) code = ('0' + code).slice(-2);
    if (seen[code]) continue;
    seen[code] = true;
    list.push({ code: code, label: label });
  }
  sheet.getRange('A6').setValue('qrLocations');
  sheet.getRange('B6').setValue(JSON.stringify(list));
  return { status: 'ok', qrLocations: list };
}

/**
 * サービスマスタに1件追加（6-G フェーズ2 新設）
 *
 * 仕様：
 *   - data.name（必須・1-30文字）/ data.taxRate（必須・0/8/10）を受け取る
 *   - 既存 serviceList を読み込み、masterQuota.serviceMasterQuota との比較で枠超過チェック
 *   - 枠超過時は { status:'error', code:'quota_exceeded', message } を返す
 *   - 通過時は id=sv001〜 を採番（既存 id と衝突しない最小番号）
 *   - serviceList に追記して B3 に保存
 *
 * 設計根拠：00_原則.md §6-6 末尾「枠数超過は層1で警告表示するだけでなく、
 * 層2ユーザーアプリの追加UIでも上限制御する必要がある」
 *
 * 注意：sv001〜のID採番はサーバ側で行う（フロント側で空き番号探索しない）。
 * 並列追加時の衝突を回避するため。
 */
function addServiceItem(data) {
  data = data || {};
  var name = String(data.name || '').trim();
  var taxRate = Number(data.taxRate);
  if (!name) return { status: 'error', message: 'サービス名が空です' };
  if (name.length > 30) return { status: 'error', message: 'サービス名は30文字以内で入力してください' };
  if ([0, 8, 10].indexOf(taxRate) < 0) return { status: 'error', message: '税率は 0 / 8 / 10 のいずれかを指定してください' };

  var sheet = _ss_().getSheetByName('settings');
  if (!sheet) return { status: 'error', message: 'settingsシートが見つかりません' };

  // 既存 serviceList 取得
  var json = sheet.getRange('B3').getValue();
  var list = [];
  try { if (json) list = JSON.parse(json); } catch(e) {}
  if (!Array.isArray(list)) list = [];

  // 枠数チェック
  var quotaRaw = sheet.getRange('B17').getValue();
  var quota = null;
  try {
    if (quotaRaw) {
      var p = (typeof quotaRaw === 'string') ? JSON.parse(quotaRaw) : quotaRaw;
      if (p && typeof p === 'object' && typeof p.serviceMasterQuota === 'number') {
        quota = Math.max(1, Math.floor(p.serviceMasterQuota));
      }
    }
  } catch(e) {}
  // quota が null（既存ユーザーで B17 未投入）は無制限扱い（フォールバック）
  if (quota !== null && list.length >= quota) {
    return {
      status: 'error',
      code: 'quota_exceeded',
      message: '件数枠の上限（' + quota + '件）に達しています。追加するにはターゲット社にご相談ください。',
      currentCount: list.length,
      quota: quota
    };
  }

  // id 採番（sv001〜・既存と衝突しない最小番号）
  var usedIds = {};
  list.forEach(function(it) {
    if (it && it.id) usedIds[String(it.id)] = true;
  });
  var newId = '';
  for (var n = 1; n <= 999; n++) {
    var candidate = 'sv' + ('000' + n).slice(-3);
    if (!usedIds[candidate]) { newId = candidate; break; }
  }
  if (!newId) return { status: 'error', message: 'サービスID の採番に失敗しました（sv999 まで埋まっています）' };

  var newItem = { id: newId, name: name, taxRate: taxRate };
  list.push(newItem);
  sheet.getRange('A3').setValue('serviceList');
  sheet.getRange('B3').setValue(JSON.stringify(list));

  return { status: 'ok', item: newItem, serviceList: list };
}

/**
 * 仕入原価マスタに1件追加（6-G フェーズ2 新設）
 *
 * 仕様：
 *   - data.name（必須・1-30文字）/ data.defaultTaxRate（必須・0/8/10）を受け取る
 *   - 既存 purchaseMasterList を読み込み、masterQuota.purchaseMasterQuota との比較で枠超過チェック
 *   - 枠超過時は { status:'error', code:'quota_exceeded', message } を返す
 *   - 通過時は id=p001〜 を採番（既存 id と衝突しない最小番号）
 *   - purchaseMasterList に追記して B5 に保存
 *
 * フィールド名規約：03_データ仕様.md §1-3 に従い defaultTaxRate を使用
 * （販管費マスタは taxRate、サービスマスタは taxRate、仕入マスタは defaultTaxRate）
 */
function addPurchaseItem(data) {
  data = data || {};
  var name = String(data.name || '').trim();
  // フロントが taxRate を送ってきた場合の互換受け取り
  var rate = (data.defaultTaxRate !== undefined) ? Number(data.defaultTaxRate) : Number(data.taxRate);
  if (!name) return { status: 'error', message: '科目名が空です' };
  if (name.length > 30) return { status: 'error', message: '科目名は30文字以内で入力してください' };
  if ([0, 8, 10].indexOf(rate) < 0) return { status: 'error', message: '税率は 0 / 8 / 10 のいずれかを指定してください' };

  var sheet = _ss_().getSheetByName('settings');
  if (!sheet) return { status: 'error', message: 'settingsシートが見つかりません' };

  var json = sheet.getRange('B5').getValue();
  var list = [];
  try { if (json) list = JSON.parse(json); } catch(e) {}
  if (!Array.isArray(list)) list = [];

  var quotaRaw = sheet.getRange('B17').getValue();
  var quota = null;
  try {
    if (quotaRaw) {
      var p = (typeof quotaRaw === 'string') ? JSON.parse(quotaRaw) : quotaRaw;
      if (p && typeof p === 'object' && typeof p.purchaseMasterQuota === 'number') {
        quota = Math.max(1, Math.floor(p.purchaseMasterQuota));
      }
    }
  } catch(e) {}
  if (quota !== null && list.length >= quota) {
    return {
      status: 'error',
      code: 'quota_exceeded',
      message: '件数枠の上限（' + quota + '件）に達しています。追加するにはターゲット社にご相談ください。',
      currentCount: list.length,
      quota: quota
    };
  }

  var usedIds = {};
  list.forEach(function(it) {
    if (it && it.id) usedIds[String(it.id)] = true;
  });
  var newId = '';
  for (var n = 1; n <= 999; n++) {
    var candidate = 'p' + ('000' + n).slice(-3);
    if (!usedIds[candidate]) { newId = candidate; break; }
  }
  if (!newId) return { status: 'error', message: '仕入科目ID の採番に失敗しました（p999 まで埋まっています）' };

  var newItem = { id: newId, name: name, defaultTaxRate: rate };
  list.push(newItem);
  sheet.getRange('A5').setValue('purchaseMasterList');
  sheet.getRange('B5').setValue(JSON.stringify(list));

  return { status: 'ok', item: newItem, purchaseMasterList: list };
}

/**
 * サービスマスタの1件削除（6-G フェーズ2 新設）
 *
 * 仕様：
 *   - data.id を受け取り、serviceList から該当要素を除去
 *   - 該当なしならエラー
 *   - 履歴データ（売上シート）には影響しない（serviceList から除去するだけ）
 *
 * 注意：既存項目の名称変更は履歴整合性の観点から推奨されない（01_商品体系.md §4-3 設計思想）
 * が、削除は履歴データ自体には影響しない（過去の売上行は serviceCode 文字列のまま残る）
 */
function deleteServiceItem(data) {
  data = data || {};
  var id = String(data.id || '');
  if (!id) return { status: 'error', message: 'id が指定されていません' };

  var sheet = _ss_().getSheetByName('settings');
  if (!sheet) return { status: 'error', message: 'settingsシートが見つかりません' };

  var json = sheet.getRange('B3').getValue();
  var list = [];
  try { if (json) list = JSON.parse(json); } catch(e) {}
  if (!Array.isArray(list)) list = [];

  var filtered = list.filter(function(it) { return String(it && it.id) !== id; });
  if (filtered.length === list.length) {
    return { status: 'error', message: '指定された id のサービスが見つかりません: ' + id };
  }
  sheet.getRange('A3').setValue('serviceList');
  sheet.getRange('B3').setValue(JSON.stringify(filtered));
  return { status: 'ok', serviceList: filtered };
}

/**
 * 仕入原価マスタの1件削除（6-G フェーズ2 新設）
 *
 * 仕様：
 *   - data.id を受け取り、purchaseMasterList から該当要素を除去
 *   - 該当なしならエラー
 *   - 履歴データ（コストシート）には影響しない
 */
function deletePurchaseItem(data) {
  data = data || {};
  var id = String(data.id || '');
  if (!id) return { status: 'error', message: 'id が指定されていません' };

  var sheet = _ss_().getSheetByName('settings');
  if (!sheet) return { status: 'error', message: 'settingsシートが見つかりません' };

  var json = sheet.getRange('B5').getValue();
  var list = [];
  try { if (json) list = JSON.parse(json); } catch(e) {}
  if (!Array.isArray(list)) list = [];

  var filtered = list.filter(function(it) { return String(it && it.id) !== id; });
  if (filtered.length === list.length) {
    return { status: 'error', message: '指定された id の仕入科目が見つかりません: ' + id };
  }
  sheet.getRange('A5').setValue('purchaseMasterList');
  sheet.getRange('B5').setValue(JSON.stringify(filtered));
  return { status: 'ok', purchaseMasterList: filtered };
}

/**
 * サービスマスタの1件更新（6-G フェーズ2 新設）
 *
 * 仕様：
 *   - data.id / data.name / data.taxRate を受け取り、該当要素を更新
 *   - id は変更しない
 */
function updateServiceItem(data) {
  data = data || {};
  var id = String(data.id || '');
  var name = (data.name !== undefined) ? String(data.name).trim() : undefined;
  var taxRate = (data.taxRate !== undefined) ? Number(data.taxRate) : undefined;
  if (!id) return { status: 'error', message: 'id が指定されていません' };
  if (name !== undefined && (name === '' || name.length > 30)) {
    return { status: 'error', message: 'サービス名は 1〜30 文字で入力してください' };
  }
  if (taxRate !== undefined && [0, 8, 10].indexOf(taxRate) < 0) {
    return { status: 'error', message: '税率は 0 / 8 / 10 のいずれかを指定してください' };
  }

  var sheet = _ss_().getSheetByName('settings');
  if (!sheet) return { status: 'error', message: 'settingsシートが見つかりません' };

  var json = sheet.getRange('B3').getValue();
  var list = [];
  try { if (json) list = JSON.parse(json); } catch(e) {}
  if (!Array.isArray(list)) list = [];

  var found = false;
  list = list.map(function(it) {
    if (it && String(it.id) === id) {
      found = true;
      if (name !== undefined) it.name = name;
      if (taxRate !== undefined) it.taxRate = taxRate;
    }
    return it;
  });
  if (!found) return { status: 'error', message: '指定された id のサービスが見つかりません: ' + id };

  sheet.getRange('A3').setValue('serviceList');
  sheet.getRange('B3').setValue(JSON.stringify(list));
  return { status: 'ok', serviceList: list };
}

/**
 * 仕入原価マスタの1件更新（6-G フェーズ2 新設）
 */
function updatePurchaseItem(data) {
  data = data || {};
  var id = String(data.id || '');
  var name = (data.name !== undefined) ? String(data.name).trim() : undefined;
  // 受口フィールド名は defaultTaxRate（taxRate でも受け取る）
  var rate;
  if (data.defaultTaxRate !== undefined) rate = Number(data.defaultTaxRate);
  else if (data.taxRate !== undefined) rate = Number(data.taxRate);
  if (!id) return { status: 'error', message: 'id が指定されていません' };
  if (name !== undefined && (name === '' || name.length > 30)) {
    return { status: 'error', message: '科目名は 1〜30 文字で入力してください' };
  }
  if (rate !== undefined && [0, 8, 10].indexOf(rate) < 0) {
    return { status: 'error', message: '税率は 0 / 8 / 10 のいずれかを指定してください' };
  }

  var sheet = _ss_().getSheetByName('settings');
  if (!sheet) return { status: 'error', message: 'settingsシートが見つかりません' };

  var json = sheet.getRange('B5').getValue();
  var list = [];
  try { if (json) list = JSON.parse(json); } catch(e) {}
  if (!Array.isArray(list)) list = [];

  var found = false;
  list = list.map(function(it) {
    if (it && String(it.id) === id) {
      found = true;
      if (name !== undefined) it.name = name;
      if (rate !== undefined) it.defaultTaxRate = rate;
    }
    return it;
  });
  if (!found) return { status: 'error', message: '指定された id の仕入科目が見つかりません: ' + id };

  sheet.getRange('A5').setValue('purchaseMasterList');
  sheet.getRange('B5').setValue(JSON.stringify(list));
  return { status: 'ok', purchaseMasterList: list };
}

/**
 * スタッフリスト保存（マージ型・PC設定値消失バグ対策）
 *
 * 重要設計方針：
 * スマホ版 settings.js は name / employmentType / passwordHash / passwordUpdatedAt のみを送信し、
 * PC版限定の hourlyWage / dailyWage / monthlyWage / commissionRate / withholdingMode / costCategory / managerMemo
 * は送信しない。旧実装ではスマホ保存時にこれらが消滅していたため、本実装ではマージ処理を実施する。
 *
 * 動作：
 *  1. スプレッドシート既存の staffList を読み込み、id をキーにしたマップを作成
 *  2. 受信した staffList の各要素について、フィールド毎に「明示指定があれば上書き、なければ既存維持」を判定
 *     - undefined : 「送られていない」とみなして既存値を維持
 *     - null      : 「明示的なクリア指示」とみなして空文字または null に
 *     - 値あり    : 上書き
 *  3. 削除されたスタッフはリストから消える（既存挙動と同じ）
 *
 * 保持フィールド：
 *  - 基本3項目（常にスマホ・PCから送信）：id / name / employmentType
 *  - パスワード系（スマホでも明示送信）：passwordHash / passwordUpdatedAt
 *  - PC版限定（スマホからは送信されない）：
 *      withholdingMode（'off' / 'standard' / 'hostess'）
 *      costCategory（'21' / '25'・contractor時のみ意味あり）
 *      hourlyWage / dailyWage / monthlyWage / commissionRate（Number または null）
 *      managerMemo（String）
 *
 * 数値フィールドは「未設定（null）」と「0円」を区別するため null 許容。
 * 0 のままだとPC給与計算で「時給0円で算出」してしまうため意図的に null を維持。
 */
function saveStaffList(staffList) {
  var sheet = _ss_().getSheetByName('settings');
  if (!sheet) return { status: 'error', message: 'settingsシートが見つかりません' };

  // --- 既存staffListを読み込んでマージ用辞書化 ---
  var existingJson = sheet.getRange('B2').getValue();
  var existing = [];
  try { if (existingJson) existing = JSON.parse(existingJson); } catch (e) {}
  if (!Array.isArray(existing)) existing = [];
  var existingById = {};
  existing.forEach(function(s) {
    if (s && s.id) existingById[String(s.id)] = s;
  });

  // --- 受信側 staffList をマージ正規化 ---
  var normalized = (staffList || []).map(function(s) {
    var prev = existingById[String(s.id || '')] || {};

    // 基本3項目（受信側で常に指定される前提・受信値を優先）
    var id   = String(s.id   || prev.id   || '');
    var name = String(s.name || prev.name || '');
    var employmentType = _normalizeEmploymentType_(
      s.employmentType !== undefined ? s.employmentType : prev.employmentType
    );

    // パスワード系（受信側に明示があれば上書き・なければ既存維持）
    var passwordHash      = (s.passwordHash      !== undefined) ? String(s.passwordHash      || '') : String(prev.passwordHash      || '');
    var passwordUpdatedAt = (s.passwordUpdatedAt !== undefined) ? String(s.passwordUpdatedAt || '') : String(prev.passwordUpdatedAt || '');

    // PC版限定フィールド（スマホからは送信されない → undefined → 既存維持）
    var withholdingMode = (s.withholdingMode !== undefined) ? String(s.withholdingMode || '') : String(prev.withholdingMode || '');
    var costCategory    = (s.costCategory    !== undefined) ? String(s.costCategory    || '') : String(prev.costCategory    || '');
    var managerMemo     = (s.managerMemo     !== undefined) ? String(s.managerMemo     || '') : String(prev.managerMemo     || '');

    // 数値フィールド（null許容・「未設定」と「0」を区別）
    var hourlyWage     = _mergeNullableNumber_(s.hourlyWage,     prev.hourlyWage);
    var dailyWage      = _mergeNullableNumber_(s.dailyWage,      prev.dailyWage);
    var monthlyWage    = _mergeNullableNumber_(s.monthlyWage,    prev.monthlyWage);
    var commissionRate = _mergeNullableNumber_(s.commissionRate, prev.commissionRate);

    return {
      id: id,
      name: name,
      employmentType: employmentType,
      passwordHash: passwordHash,
      passwordUpdatedAt: passwordUpdatedAt,
      withholdingMode: withholdingMode,
      costCategory: costCategory,
      hourlyWage: hourlyWage,
      dailyWage: dailyWage,
      monthlyWage: monthlyWage,
      commissionRate: commissionRate,
      managerMemo: managerMemo
    };
  });

  sheet.getRange('A2').setValue('staffList');
  sheet.getRange('B2').setValue(JSON.stringify(normalized));
  return { status: 'ok' };
}

/**
 * 数値フィールドのマージ用ヘルパー
 *  - 受信値が undefined          → 既存値を維持（null 含む）
 *  - 受信値が null               → null（「明示的クリア」を許容）
 *  - 受信値が ''（空文字）         → null（PC版UIで空欄入力された場合）
 *  - 受信値が数値文字列または数値 → Number 化（NaN なら null）
 */
function _mergeNullableNumber_(received, previous) {
  if (received === undefined) {
    // 既存値を維持。既存値が undefined/null/空文字なら null
    if (previous === undefined || previous === null || previous === '') return null;
    var prevNum = Number(previous);
    return isNaN(prevNum) ? null : prevNum;
  }
  if (received === null || received === '') return null;
  var num = Number(received);
  return isNaN(num) ? null : num;
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
  var ss    = _ss_();
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
  return { status: 'error', message: '対応する出勤記録が見つかりません' };
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
  var ss    = _ss_();
  var sheet = ss.getSheetByName('attendance');
  if (!sheet) return { status: 'ok', data: { attendance: [], hasUnrecordedClockOut: false } };
  // attendance は V3 固定列（ヘッダ行なし・行1からデータ）。_doGetAttendanceByMonthV3 と同一レイアウト。
  // A=入店日 / B=スタッフID / C=スタッフ名 / D=雇用形態 / E=入店時刻 / F=退店日 / G=退店時刻 / H=登録日時 / I=案件ID
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return { status: 'ok', data: { attendance: [], hasUnrecordedClockOut: false } };
  var lastCol = Math.max(8, Math.min(10, sheet.getLastColumn()));
  var rows  = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var today = _dateToStr(new Date());
  var attendance = [], hasUnrecordedClockOut = false;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var staffId = row[1];
    if (!staffId) continue;
    var clockInDate  = row[0] instanceof Date ? _dateToStr(row[0]) : String(row[0] || '');
    var clockInTime  = _normalizeTimeStr(row[4]);
    var clockOutTime = _normalizeTimeStr(row[6]);
    var qrLocation   = lastCol >= 10 ? String(row[9] || '') : '';   // J列・拠点NN（段2）
    if (!clockInTime) continue;                  // 入店時刻なし＝無効行（架空入店を除去）
    var isActive = !clockOutTime;                // 退店時刻が空＝出勤中（青/赤/赤点滅）
    // 表示対象：当日の記録（退勤済も含む）／前日以前の未退勤（打刻忘れ＝今も出勤中扱い）。
    // 未来日の未退勤は出勤状況に出さない（当日にまだ出勤していない＝架空の出勤中を防ぐ）。
    var include = (clockInDate === today) ||
                  (isActive && clockInDate && clockInDate < today);
    if (include) {
      attendance.push({
        rowIndex:       i + 1,
        staffId:        String(staffId),
        staffName:      String(row[2] || ''),
        employmentType: _normalizeEmploymentType_(row[3]),
        clockInDate:    clockInDate,
        clockIn:        clockInTime,
        clockOut:       clockOutTime || null,
        isActive:       isActive,
        qrLocation:     qrLocation
      });
    }
    // 前日以前の未退勤は打刻忘れ警告対象
    if (isActive && clockInDate && clockInDate < today) hasUnrecordedClockOut = true;
  }
  // 出勤中を上に、その中で入店日時の新しい順。退勤済（当日）は下。
  attendance.sort(function(a, b) {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    var d = String(b.clockInDate).localeCompare(String(a.clockInDate));
    if (d !== 0) return d;
    return String(b.clockIn).localeCompare(String(a.clockIn));
  });
  return { status: 'ok', data: {
    attendance: attendance,
    hasUnrecordedClockOut: hasUnrecordedClockOut
  }};
}

function getAttendanceByMonth(month) {
  try {
    var ss = _ss_();
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
  var ss    = _ss_();
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

// costMasterList は販管費専用（→ 03_データ仕様.md §1-2）。仕入原価は purchaseMasterList（B5）で別管理。
// このマスタには divisionCode:"1"（仕入原価）を含めない。
var DEFAULT_COST_MASTER_GAS = [
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
    var ss = _ss_();
    var sheet = ss.getSheetByName('settings');
    if (!sheet) return DEFAULT_COST_MASTER_GAS;
    var val = sheet.getRange('B4').getValue();
    if (!val || val === '') return DEFAULT_COST_MASTER_GAS;
    var parsed = JSON.parse(val);
    if (!Array.isArray(parsed)) return DEFAULT_COST_MASTER_GAS;
    // costMasterList は販管費専用（→ 03_データ仕様.md §1-2）。
    // 旧データに仕入原価（divisionCode='1'）が残っていても応答に含めない。
    // divisionCode 未設定の旧データは販管費扱い（後方互換）。
    parsed = parsed.filter(function(item) {
      return !item || !item.divisionCode || String(item.divisionCode) === '2';
    });
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
    var ss = _ss_();
    var sheet = ss.getSheetByName('settings');
    if (!sheet) {
      sheet = ss.insertSheet('settings');
      sheet.getRange('A1').setValue('storeName');
      sheet.getRange('A2').setValue('staffList');
      sheet.getRange('A3').setValue('serviceList');
      sheet.getRange('A4').setValue('costMasterList');
    }
    // costMasterList は販管費専用（→ 03_データ仕様.md §1-2）。
    // フロント経由で仕入原価（divisionCode='1'）が混入しても正本に書き込まない。
    // divisionCode 未設定の旧データは販管費扱い（後方互換）。
    var sanitized = (Array.isArray(list) ? list : []).filter(function(item) {
      return !item || !item.divisionCode || String(item.divisionCode) === '2';
    });
    sheet.getRange('B4').setValue(JSON.stringify(sanitized));
  } catch (e) {
    Logger.log('saveCostMasterGAS error: ' + e);
    throw e;
  }
}

function initCostMaster() {
  try {
    var ss = _ss_();
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
// Phase A セットアップ（廃止・無害化）
//   旧 setupPhaseA は settings B5 に「住所」を書く等、現行スキーマ（B5=purchaseMasterList・
//   B7=invoiceSettings）と衝突する死んだレガシーだった（顧客/請求/見積も旧JP列で作成）。
//   誤実行で settings を破壊し得るため本体を撤去し、正しい migrateDocAutomationSchema
//   （products/customers12列/帳票3シート/invoiceSettings・v0.9.0 準拠）へ委譲する。
// =============================================================

function setupPhaseA() {
  return migrateDocAutomationSchema();
}

// =============================================================
// 源泉徴収・clientId マイグレーション
// コストシート T列・U列 追加（A-9-X：B12 storeType 初期化は撤廃）
// =============================================================

/**
 * 源泉徴収機能の初期セットアップ（1回だけ実行）
 * - コストシートに T列:源泉徴収額・U列:クライアントID を追加
 * - 既存データは0/空文字で埋める
 * A-9-X：源泉徴収はスタッフ個別の withholdingMode で判定するため、storeType 初期化は撤廃。
 */
function setupWithholdingAndClientId() {
  var ss = _ss_();

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
// スタッフパスワード マイグレーション
// 既存スタッフリストに passwordHash/passwordUpdatedAt 補完
// （A-9-X：業態テンプレート B13 templateId / B14 uiLabels 初期化は撤廃）
// =============================================================

/**
 * passwordHash 機能の初期セットアップ（1回だけ実行）
 * - 既存スタッフリストに passwordHash=''・passwordUpdatedAt='' を補完
 */
function setupTemplateAndPassword() {
  var ss = _ss_();
  var settings = ss.getSheetByName('settings');
  if (!settings) {
    settings = ss.insertSheet('settings');
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
 * 税込額・税率から税抜額・消費税額を整数演算で算出（全デバイス共通・3デバイス統合§6-4）
 * クライアント側 js/app.js calcTax と同等の正規ロジック。
 * 浮動小数点の +1 ズレ（55000×10% → 5001 になるバグ）を回避するため、
 * (1 + rate/100) を経由せず taxExcluded = floor(inAmt * 100 / (100 + rate)) で整数演算。
 *
 * 用途：addSales / addCost / updateSales / updateCost / updateRow の K列(消費税)・I列(税抜)
 *       書き込み時に一律呼び出し、クライアントが送る tax / taxExcluded を信頼せず再計算する。
 *
 * @param {number} taxIncluded 税込金額（円・整数。負値はクランプして0として扱う）
 * @param {number} taxRate     税率（%・10/8/0 等）
 * @returns {{taxExcluded:number, taxAmount:number}}
 */
function calcTax_(taxIncluded, taxRate) {
  var inAmt = Math.max(0, Math.floor(Number(taxIncluded) || 0));
  var rate  = Number(taxRate) || 0;
  if (rate <= 0) {
    return { taxExcluded: inAmt, taxAmount: 0 };
  }
  var taxExcluded = Math.floor((inAmt * 100) / (100 + rate));
  if (taxExcluded === 0 && inAmt > 0) {
    return { taxExcluded: inAmt, taxAmount: 0 };
  }
  return { taxExcluded: taxExcluded, taxAmount: inAmt - taxExcluded };
}

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

  var ss = _ss_();
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
            salesRowIndex = m + 2;
            break;
          }
        }
      }
    }
  }

  // ═══ 案件紐付けはコスト行V列(22)で完結する。attendance連動は持たない ═══

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

  var ss = _ss_();
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
 * 紐付け候補取得(双方向対応・指示書5§1-4 / 技術仕様§9-6)
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

  var costSheet = _ss_().getSheetByName('コスト');
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

  var salesSheet = _ss_().getSheetByName('売上');
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
  var sheet = _ss_().getSheetByName('売上');
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
  var sheet = _ss_().getSheetByName('売上');
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

  var ss = _ss_();
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

  var sheet = _ss_().getSheetByName(sheetName);
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
    // §0 統一：calcTax_（整数演算）で再計算
    var _t = calcTax_(inAmt, rate);
    sheet.getRange(rowIndex,  9).setValue(_t.taxExcluded); // I列(税抜)
    sheet.getRange(rowIndex, 10).setValue(rate);           // J列(税率)
    sheet.getRange(rowIndex, 11).setValue(_t.taxAmount);   // K列(消費税)
    sheet.getRange(rowIndex, 12).setValue(inAmt);          // L列(税込)
    if (fields.amount !== undefined) updated.push('amount');
    if (fields.taxRate !== undefined) updated.push('taxRate');
    recalculated = { taxAmount: _t.taxAmount, taxExcluded: _t.taxExcluded };
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

  var ss = _ss_();
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

/**
 * 指示書15：行削除（売上・コスト両対応）
 * 売上削除時は紐付け経費のV列を自動空欄化（経費自体は削除しない・月次管理に残る）
 * S列(19)=1 のロック行は削除拒否（GAS側で防御・フロント側でも削除ボタンを非表示）
 *
 * payload:
 *   - sheetName : "売上" または "コスト"
 *   - rowIndex  : 削除対象の行番号（2以上）
 *
 * レスポンス：
 *   - status: 'ok'
 *   - data.unlinkedCostRows : 売上削除時に空欄化したコスト行番号配列
 *   - data.deletedSalesRowId : 売上削除時の削除した salesRowId
 */
function deleteRow(data) {
  try {
    var sheetName = String(data && data.sheetName || '').trim();
    var rowIndex = parseInt(data && data.rowIndex, 10);

    if (sheetName !== '売上' && sheetName !== 'コスト' && sheetName !== 'attendance') {
      return { status: 'error', message: 'sheetNameが不正です' };
    }
    if (!rowIndex || rowIndex < 2) {
      return { status: 'error', message: 'rowIndexが不正です' };
    }

    var ss = _ss_();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return { status: 'error', message: 'シートが見つかりません: ' + sheetName };
    }

    var lastRow = sheet.getLastRow();
    if (rowIndex > lastRow) {
      return { status: 'error', message: '指定行が存在しません' };
    }

    // ロック行チェック（S列=19・売上/コストのみ。attendance は S列を持たない）
    if (sheetName === '売上' || sheetName === 'コスト') {
      var lockFlag = sheet.getRange(rowIndex, 19).getValue();
      if (lockFlag === 1 || lockFlag === '1') {
        return { status: 'error', message: 'ロック行は削除できません' };
      }
    }

    var unlinkedCostRows = [];
    var deletedSalesRowId = '';

    if (sheetName === '売上') {
      // 売上削除時：紐付け経費のV列を空欄化（経費自体は残す・月次管理に残り続ける）
      var salesRowId = sheet.getRange(rowIndex, 20).getValue(); // T列
      deletedSalesRowId = String(salesRowId || '');

      if (deletedSalesRowId) {
        var costSheet = ss.getSheetByName('コスト');
        if (costSheet) {
          var costLastRow = costSheet.getLastRow();
          if (costLastRow >= 2) {
            var vColRange = costSheet.getRange(2, 22, costLastRow - 1, 1);
            var vValues = vColRange.getValues();
            for (var i = 0; i < vValues.length; i++) {
              if (String(vValues[i][0] || '') === deletedSalesRowId) {
                var costRow = i + 2;
                costSheet.getRange(costRow, 22).setValue('');
                unlinkedCostRows.push(costRow);
              }
            }
          }
        }
      }
    }

    // 物理削除
    sheet.deleteRow(rowIndex);

    return {
      status: 'ok',
      data: {
        sheetName: sheetName,
        rowIndex: rowIndex,
        unlinkedCostRows: unlinkedCostRows,
        deletedSalesRowId: deletedSalesRowId
      }
    };
  } catch (e) {
    return { status: 'error', message: 'deleteRow失敗: ' + e.message };
  }
}

// =============================================================
// confirmPayroll — 給与確定（コストシートT列に源泉徴収額を記録）
// A-2タスク：PC版出勤管理 給与計算確定処理
// =============================================================

/**
 * confirmPayroll
 * フロント（pc-attendance.js _executeConfirm）から呼ばれる。
 * targets配列の各要素について、コストシートT列(col 20)に源泉徴収額を書き込む。
 *
 * リクエスト形式:
 * {
 *   "targets": [
 *     { "sheetName": "コスト", "rowIndex": 5, "withholdingAmount": 3063 },
 *     { "sheetName": "コスト", "rowIndex": 8, "withholdingAmount": 3063 }
 *   ]
 * }
 *
 * 処理内容:
 * 1. 各targetのrowIndexが有効行か確認
 * 2. ロック行(S列=1)は書き込み拒否
 * 3. T列(col 20)にwithholdingAmountを書き込み
 *
 * @param {Object} data - { targets: Array }
 * @return {Object} { status: 'ok', data: { updated: Number, skipped: Array } }
 */
function confirmPayroll(data) {
  var targets = data.targets;
  if (!targets || !Array.isArray(targets) || targets.length === 0) {
    return { status: 'error', message: 'targetsが空です' };
  }

  var ss = _ss_();
  var updated = 0;
  var skipped = [];

  // シート名ごとにグループ化して一括処理
  var bySheet = {};
  targets.forEach(function(t) {
    var name = t.sheetName || 'コスト';
    if (!bySheet[name]) bySheet[name] = [];
    bySheet[name].push(t);
  });

  for (var sheetName in bySheet) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      bySheet[sheetName].forEach(function(t) {
        skipped.push({ rowIndex: t.rowIndex, reason: 'シート未発見: ' + sheetName });
      });
      continue;
    }

    var lastRow = sheet.getLastRow();

    bySheet[sheetName].forEach(function(t) {
      var row = Number(t.rowIndex);

      // 行番号バリデーション（ヘッダー行=1は除外、最終行を超えない）
      if (!row || row < 2 || row > lastRow) {
        skipped.push({ rowIndex: row, reason: '無効な行番号' });
        return;
      }

      // ロックチェック：S列(col 19) = 1 ならロック済み
      var lockFlag = sheet.getRange(row, 19).getValue();
      if (Number(lockFlag) === 1) {
        skipped.push({ rowIndex: row, reason: 'ロック済み' });
        return;
      }

      // T列(col 20) に源泉徴収額を書き込み
      var whAmount = Number(t.withholdingAmount) || 0;
      sheet.getRange(row, 20).setValue(whAmount);
      updated++;
    });
  }

  return {
    status: 'ok',
    data: {
      updated: updated,
      skipped: skipped
    }
  };
}

// =============================================================
// A-1 タイムカードPWA用 GASアクション
// =============================================================

function validateStaff(data) {
  var staffId = String(data && data.staffId || '').trim();
  if (!staffId) {
    return { status: 'ok', data: { valid: false, staffId: staffId } };
  }
  var settings = getSettings();
  if (settings.status !== 'ok') {
    return { status: 'ok', data: { valid: false, staffId: staffId } };
  }
  var staffList = settings.data.staffList || [];
  var found = null;
  for (var i = 0; i < staffList.length; i++) {
    if (String(staffList[i].id || '') === staffId) {
      found = staffList[i];
      break;
    }
  }
  if (!found) {
    return { status: 'ok', data: { valid: false, staffId: staffId } };
  }
  // 段2・QR現地証明：qr 拠点トークンの所属検証（→ 03_データ仕様.md §1-0-3・§6）。
  //   非ブロッキング：qrValid=false でもスタッフ有効性（valid）は独立に true を返す。
  //   front は qrValid を 📍表示の可否判定に使う。qrLocations 未設定時は accept。
  var qr = String(data && data.qr || '').trim();
  var qrLocation = _extractQrLocation_(qr);
  var qrValid = true;
  if (qr) {
    var locs = settings.data.qrLocations;
    if (Array.isArray(locs) && locs.length) {
      qrValid = locs.some(function (l) { return String((l && l.code) || '') === qrLocation; });
    }
  }
  return {
    status: 'ok',
    data: {
      valid: true,
      staffId: staffId,
      staffName: String(found.name || ''),
      storeName: String(settings.data.storeName || ''),
      qrLocation: qrLocation,
      qrValid: qrValid
    }
  };
}

function getAttendanceForStaff(data) {
  var staffId = String(data && data.staffId || '').trim();
  if (!staffId) {
    return { status: 'error', message: 'staffId が必要です' };
  }
  var ss    = _ss_();
  var sheet = ss.getSheetByName('attendance');
  if (!sheet) {
    return { status: 'ok', data: { myRecord: null, todayList: [], myMonthly: [] } };
  }
  var tz      = Session.getScriptTimeZone();
  var today   = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var month   = String(data && data.month || '').trim() || today.substring(0, 7);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { status: 'ok', data: { myRecord: null, todayList: [], myMonthly: [] } };
  }
  var lastCol = Math.max(8, Math.min(10, sheet.getLastColumn()));
  var rows    = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var myRecord  = null;
  var todayMap  = {};
  var myMonthly = [];
  for (var i = 0; i < rows.length; i++) {
    var row          = rows[i];
    var rawDate      = row[0];
    var rowStaffId   = String(row[1] || '');
    var rowStaffName = String(row[2] || '');
    var ciTimeRaw    = row[4];
    var rawCoDate    = row[5];
    var coTimeRaw    = row[6];
    var qrLocation   = String(row[9] || '');   // J列 qrLocation（段2・→ §1-0-3）
    var clockInDate  = rawDate instanceof Date
      ? Utilities.formatDate(rawDate, tz, 'yyyy-MM-dd')
      : String(rawDate || '').substring(0, 10);
    if (!clockInDate || !rowStaffId) continue;
    var clockInTime  = _normalizeTimeStr(ciTimeRaw);
    var clockOutTime = _normalizeTimeStr(coTimeRaw);
    var clockOutDate = rawCoDate instanceof Date
      ? Utilities.formatDate(rawCoDate, tz, 'yyyy-MM-dd')
      : String(rawCoDate || '').substring(0, 10);
    var isActive = (!clockOutTime || clockOutTime === '');
    if (clockInDate === today) {
      if (!todayMap[rowStaffId] || isActive) {
        todayMap[rowStaffId] = { staffName: rowStaffName, isActive: isActive };
      }
      if (rowStaffId === staffId) {
        myRecord = {
          rowIndex: i + 2,
          date: clockInDate,
          clockIn: clockInTime,
          clockOut: clockOutTime || null,
          clockOutDate: clockOutDate || null,
          isActive: isActive,
          qrLocation: qrLocation
        };
      }
    }
    if (rowStaffId === staffId && clockInDate.indexOf(month) === 0) {
      var workMinutes = null;
      if (clockInTime && clockOutTime) {
        var ci = _parseHHMM(clockInTime);
        var co = _parseHHMM(clockOutTime);
        if (ci && co) {
          var diff = (co.h * 60 + co.m) - (ci.h * 60 + ci.m);
          if (clockOutDate && clockOutDate !== clockInDate) diff += 24 * 60;
          if (diff > 0) workMinutes = diff;
        }
      }
      myMonthly.push({
        rowIndex: i + 2,
        date: clockInDate,
        clockIn: clockInTime,
        clockOut: clockOutTime || null,
        clockOutDate: clockOutDate || null,
        workMinutes: workMinutes,
        isActive: isActive,
        qrLocation: qrLocation
      });
    }
  }
  var todayList = [];
  for (var sid in todayMap) {
    todayList.push({
      staffId: sid,
      staffName: todayMap[sid].staffName,
      isActive: todayMap[sid].isActive,
      isSelf: (sid === staffId)
    });
  }
  todayList.sort(function(a, b) {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return 0;
  });
  myMonthly.sort(function(a, b) { return b.date.localeCompare(a.date); });
  return {
    status: 'ok',
    data: {
      myRecord: myRecord,
      todayList: todayList,
      myMonthly: myMonthly
    }
  };
}


/* ═══════════════════════════════════════════════════════════
   段3・シフト希望（shiftScheduleEnabled・→ 01_商品体系.md §4-6）
   shift シート：A id / B 日付 / C スタッフID / D スタッフ名 /
                 E 希望開始 / F 希望終了 / G 種別 / H メモ / I 登録日時
   MVP：スタッフが希望シフトを登録（1スタッフ1日1件・同日既存は上書き）、
        オーナーが月次一覧を閲覧する。実績突合（予定vs実打刻）は次段階。
   ═══════════════════════════════════════════════════════════ */
var SHIFT_HEADERS = ['id','日付','スタッフID','スタッフ名','希望開始','希望終了','種別','メモ','登録日時'];

function _shiftSheet_() {
  return getOrCreateSheet_('shift', SHIFT_HEADERS);
}

function _isValidDateStr_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

function _normalizeShiftRow_(row, rowIndex) {
  var tz = Session.getScriptTimeZone();
  var rawDate = row[1];
  var date = rawDate instanceof Date
    ? Utilities.formatDate(rawDate, tz, 'yyyy-MM-dd')
    : String(rawDate || '').substring(0, 10);
  return {
    id:        String(row[0] || ''),
    date:      date,
    staffId:   String(row[2] || ''),
    staffName: String(row[3] || ''),
    startTime: _normalizeTimeStr(row[4]),
    endTime:   _normalizeTimeStr(row[5]),
    type:      String(row[6] || '希望'),
    note:      String(row[7] || ''),
    rowIndex:  rowIndex
  };
}

function _readShiftRows_() {
  var sheet = _shiftSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { sheet: sheet, list: [] };
  var values = sheet.getRange(2, 1, lastRow - 1, SHIFT_HEADERS.length).getValues();
  var list = [];
  for (var i = 0; i < values.length; i++) {
    var r = _normalizeShiftRow_(values[i], i + 2);
    if (!r.date || !r.staffId) continue;
    list.push(r);
  }
  return { sheet: sheet, list: list };
}

// オーナー：月次の全スタッフ希望シフト一覧（month = YYYY-MM・空なら全件）
function getShifts(data) {
  var month = String(data && data.month || '').trim();
  var read = _readShiftRows_();
  var list = read.list.filter(function (s) {
    return !month || s.date.indexOf(month) === 0;
  });
  list.sort(function (a, b) {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return String(a.staffName).localeCompare(String(b.staffName));
  });
  return { status: 'ok', data: { shifts: list } };
}

// スタッフ：自分の月次希望シフト
function getShiftsForStaff(data) {
  var staffId = String(data && data.staffId || '').trim();
  if (!staffId) return { status: 'error', message: 'staffId が必要です' };
  var month = String(data && data.month || '').trim();
  var read = _readShiftRows_();
  var list = read.list.filter(function (s) {
    return s.staffId === staffId && (!month || s.date.indexOf(month) === 0);
  });
  list.sort(function (a, b) { return a.date.localeCompare(b.date); });
  return { status: 'ok', data: { shifts: list } };
}

// スタッフ：希望シフト登録（1スタッフ1日1件・同日既存は上書き）
function saveShift(data) {
  var date      = String(data && data.date || '').trim();
  var staffId   = String(data && data.staffId || '').trim();
  var staffName = String(data && data.staffName || '').trim();
  var startTime = String(data && data.startTime || '').trim();
  var endTime   = String(data && data.endTime || '').trim();
  var note      = String(data && data.note || '').trim();
  if (!_isValidDateStr_(date)) return { status: 'error', message: '日付が不正です（YYYY-MM-DD）' };
  if (!staffId) return { status: 'error', message: 'staffId が必要です' };
  var read = _readShiftRows_();
  var sheet = read.sheet;
  var existing = null;
  for (var i = 0; i < read.list.length; i++) {
    if (read.list[i].staffId === staffId && read.list[i].date === date) {
      existing = read.list[i];
      break;
    }
  }
  var id = existing ? existing.id : ('sh' + Date.now() + Math.floor(Math.random() * 1000));
  var rowVals = [id, date, staffId, staffName, startTime, endTime, '希望', note, new Date().toISOString()];
  if (existing) {
    sheet.getRange(existing.rowIndex, 1, 1, SHIFT_HEADERS.length).setValues([rowVals]);
  } else {
    sheet.appendRow(rowVals);
  }
  return { status: 'ok', shift: {
    id: id, date: date, staffId: staffId, staffName: staffName,
    startTime: startTime, endTime: endTime, type: '希望', note: note
  }};
}

// スタッフ：希望シフト削除（id 指定・本人のもののみ）
function deleteShift(data) {
  var id      = String(data && data.id || '').trim();
  var staffId = String(data && data.staffId || '').trim();
  if (!id) return { status: 'error', message: 'id が必要です' };
  var read = _readShiftRows_();
  var sheet = read.sheet;
  for (var i = 0; i < read.list.length; i++) {
    if (read.list[i].id === id) {
      if (staffId && read.list[i].staffId !== staffId) {
        return { status: 'error', message: '権限がありません' };
      }
      sheet.deleteRow(read.list[i].rowIndex);
      return { status: 'ok' };
    }
  }
  return { status: 'ok' }; // 既に無い場合も ok（冪等）
}


/* ═══════════════════════════════════════════════════════════
   勤怠v3アクション（旧 attendance_v3.gs を main.gs へ統合）
   prepareUserGasCode は main.gs のみ取得・デプロイするため自己完結化
   ═══════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════
   ヘルパー関数
   ══════════════════════════════════════════════════════════ */

/**
 * 時刻値を {h, m} に変換（Spreadsheet シリアル日時対応）
 */
function _parseHHMM(val) {
  if (val === null || val === undefined || val === '') return null;
  const s = String(val).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return { h: parseInt(m[1], 10), m: parseInt(m[2], 10) };
  if (val instanceof Date) {
    const hm = Utilities.formatDate(val, 'Asia/Tokyo', 'HH:mm').split(':');
    return { h: parseInt(hm[0], 10), m: parseInt(hm[1], 10) };
  }
  const d = new Date(val);
  if (!isNaN(d.getTime())) {
    const hm = Utilities.formatDate(d, 'Asia/Tokyo', 'HH:mm').split(':');
    return { h: parseInt(hm[0], 10), m: parseInt(hm[1], 10) };
  }
  return null;
}

/** {h, m} → "HH:MM" */
function _toHHMM(h, m) {
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/** 時刻値 → "HH:MM"（Spreadsheet シリアル対応） */
function _normalizeTimeStr(val) {
  if (!val) return '';
  const s = String(val).trim();
  if (/^\d{1,2}:\d{2}/.test(s)) return s.slice(0, 5);
  const t = _parseHHMM(val);
  return t ? _toHHMM(t.h, t.m) : '';
}

/** Date → "YYYY-MM-DD" */
function _dateToStr(d) {
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/** "YYYY-MM-DD" または Date → Date（スプレッドシートの日付シリアル対応） */
function _parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  const s = String(val).trim();
  const parts = s.split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** 翌日の "YYYY-MM-DD" を返す */
function _nextDay(dateStr) {
  const d = _parseDate(dateStr);
  if (!d) return String(dateStr);
  d.setDate(d.getDate() + 1);
  return _dateToStr(d);
}

/** clockIn / clockOut 時刻から日跨ぎを判定して退店日を計算 */
function _resolveClockOutDate(clockInDateStr, clockInTime, clockOutTime, explicitClockOutDate) {
  if (explicitClockOutDate) return explicitClockOutDate;
  const ci = _parseHHMM(clockInTime);
  const co = _parseHHMM(clockOutTime);
  if (ci && co && (co.h * 60 + co.m) < (ci.h * 60 + ci.m)) {
    return _nextDay(clockInDateStr);
  }
  return clockInDateStr;
}

/* ══════════════════════════════════════════════════════════
   setupAttendanceMigrationV3
   旧7列 → 新8列 変換
   ══════════════════════════════════════════════════════════ */

function setupAttendanceMigrationV3() {
  const ss    = _ss_();
  const sheet = ss.getSheetByName('attendance');
  if (!sheet) return { status: 'error', message: 'attendance シートが見つかりません' };

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  Logger.log('Migration: rows=' + lastRow + ', cols=' + lastCol);

  if (lastRow < 1) {
    Logger.log('Migration: empty sheet, nothing to do');
    return { status: 'ok', message: 'シートが空のためスキップしました', migrated: 0 };
  }

  // 既に8列なら何もしない
  if (lastCol >= 8) {
    Logger.log('Migration: already 8 columns, skipping');
    return { status: 'ok', message: '既にv3形式（8列）です。スキップしました', migrated: 0 };
  }

  const data    = sheet.getRange(1, 1, lastRow, Math.max(lastCol, 7)).getValues();
  const newData = [];
  let   migrated = 0;

  for (var i = 0; i < data.length; i++) {
    const row = data[i];
    // 旧列: A=日付, B=ID, C=名前, D=雇用形態, E=入店時刻, F=退店時刻, G=登録日時
    const rawDate    = row[0];
    const staffId    = row[1];
    const staffName  = row[2];
    const empType    = row[3];
    const ciTimeRaw  = row[4];
    const coTimeRaw  = row[5];
    const regAt      = row[6];

    // 入店日
    let clockInDate = '';
    if (rawDate instanceof Date) {
      clockInDate = _dateToStr(rawDate);
    } else {
      const d = _parseDate(rawDate);
      clockInDate = d ? _dateToStr(d) : String(rawDate);
    }

    // 入店時刻（24h超の場合は-24して翌日扱い）
    let clockInStr  = '';
    const ciParsed  = _parseHHMM(ciTimeRaw);
    if (ciParsed) {
      if (ciParsed.h >= 24) {
        clockInStr  = _toHHMM(ciParsed.h - 24, ciParsed.m);
        clockInDate = _nextDay(clockInDate);
      } else {
        clockInStr = _toHHMM(ciParsed.h, ciParsed.m);
      }
    }

    // 退店日・退店時刻（24h超またはout<in → 翌日）
    let clockOutDate = '';
    let clockOutStr  = '';
    const hasCoTime  = coTimeRaw !== '' && coTimeRaw !== null && coTimeRaw !== undefined;
    if (hasCoTime) {
      const coParsed = _parseHHMM(coTimeRaw);
      if (coParsed) {
        if (coParsed.h >= 24) {
          clockOutStr  = _toHHMM(coParsed.h - 24, coParsed.m);
          clockOutDate = _nextDay(clockInDate);
        } else {
          clockOutStr  = _toHHMM(coParsed.h, coParsed.m);
          // 退店 < 入店 → 翌日
          if (ciParsed && (coParsed.h * 60 + coParsed.m) < (ciParsed.h * 60 + ciParsed.m)) {
            clockOutDate = _nextDay(clockInDate);
          } else {
            clockOutDate = clockInDate;
          }
        }
      }
    }

    newData.push([
      clockInDate,   // A: 入店日
      staffId,       // B: スタッフID
      staffName,     // C: スタッフ名
      empType,       // D: 雇用形態
      clockInStr,    // E: 入店時刻
      clockOutDate,  // F: 退店日
      clockOutStr,   // G: 退店時刻
      regAt,         // H: 登録日時
    ]);
    migrated++;
    Logger.log('Row ' + (i + 1) + ': ' + clockInDate + ' ' + clockInStr + ' | out: ' + clockOutDate + ' ' + clockOutStr);
  }

  // 一時シートに書き出し
  const tempName  = 'attendance_v3_temp';
  let   tempSheet = ss.getSheetByName(tempName);
  if (tempSheet) ss.deleteSheet(tempSheet);
  tempSheet = ss.insertSheet(tempName);
  if (newData.length > 0) {
    tempSheet.getRange(1, 1, newData.length, 8).setValues(newData);
  }

  // 旧シート削除 → リネーム
  ss.deleteSheet(sheet);
  tempSheet.setName('attendance');

  Logger.log('Migration complete: ' + migrated + ' rows');
  return { status: 'ok', message: migrated + '行をv3形式に変換しました', migrated: migrated };
}

/* ══════════════════════════════════════════════════════════
   clockIn アクション（v3）
   ══════════════════════════════════════════════════════════ */

function _doClockInV3(data) {
  const ss    = _ss_();
  let   sheet = ss.getSheetByName('attendance');
  if (!sheet) sheet = ss.insertSheet('attendance');

  const clockInDate    = data.date          || data.clockInDate  || '';
  const staffId        = data.staffId       || '';
  const staffName      = data.staffName     || '';
  const employmentType = data.employmentType || '';
  const clockInTime    = data.clockInTime   || data.clockIn      || '';
  const clockOutTime   = data.clockOutTime  || data.clockOut     || '';
  const clockOutDate   = clockOutTime
    ? _resolveClockOutDate(clockInDate, clockInTime, clockOutTime, data.clockOutDate || '')
    : '';
  const projectId      = String(data.projectId || '');
  // 段2・QR現地証明（→ 03_データ仕様.md §1-0-3 J列 qrLocation）。
  //   qr トークン {clientId}-{拠点NN} の末尾数値を拠点NNとして抽出。無ければ空文字。
  //   非ブロッキング：qr 不正・空でも打刻は止めない（証拠記録型）。
  const qrLocation     = _extractQrLocation_(data.qr);

  // ── 整合性ガード（→ 02_画面仕様.md §5-11）─────────────────
  // 同一スタッフが「出勤中（未退勤）」の間は新規登録不可（先に退勤を登録）。
  // 同一日で時間帯が重複する登録も不可（架空・矛盾した勤務記録を防ぐ）。
  if (staffId && clockInTime) {
    function _toMin(t) {
      var p = String(t || '').split(':');
      return (p.length >= 2 && p[0] !== '') ? (Number(p[0]) * 60 + Number(p[1])) : null;
    }
    var nIn  = _toMin(clockInTime);
    var nOut = clockOutTime ? _toMin(clockOutTime) : null;
    if (nOut != null && nOut < nIn) nOut += 1440;            // 日跨ぎ
    var nOutEff = (nOut == null) ? (nIn + 1440 * 2) : nOut;  // 未退勤は十分大きく
    var exRows = sheet.getDataRange().getValues();
    for (var er = 0; er < exRows.length; er++) {
      var ex = exRows[er];
      if (String(ex[1]) !== String(staffId)) continue;       // 別スタッフ
      var exInTime = _normalizeTimeStr(ex[4]);
      if (!exInTime) continue;
      var exOutTime = _normalizeTimeStr(ex[6]);
      if (!exOutTime) {
        return { status: 'error', message: 'このスタッフは出勤中です。先に退勤を登録してください。' };
      }
      var exInDate = ex[0] instanceof Date ? _dateToStr(ex[0])
        : String(ex[0] || '').substring(0, 10).replace(/\//g, '-');
      if (exInDate === clockInDate) {
        var eIn  = _toMin(exInTime);
        var eOut = _toMin(exOutTime);
        if (eOut != null && eIn != null && eOut < eIn) eOut += 1440;
        if (eIn != null && nIn != null && nIn < eOut && eIn < nOutEff) {
          return { status: 'error', message: '同じ時間帯に既に出勤記録があります。' };
        }
      }
    }
  }

  sheet.appendRow([
    clockInDate,              // A
    staffId,                  // B
    staffName,                // C
    employmentType,           // D
    clockInTime,              // E
    clockOutDate,             // F
    clockOutTime,             // G
    new Date(),               // H
    projectId,                // I 案件ID（サイクルA・通常は空文字でPC操作で後付け）
    qrLocation,               // J qrLocation 拠点NN（段2・QR現地証明・無ければ空文字）
  ]);

  return { status: 'ok', rowIndex: sheet.getLastRow(), qrLocation: qrLocation };
}

/* ══════════════════════════════════════════════════════════
   QR現地証明ヘルパー（段2・→ 03_データ仕様.md §1-0-3・§6）
   ══════════════════════════════════════════════════════════ */

// qr トークン {clientId}-{拠点NN} から拠点NN（末尾の数値セグメント）を抽出する。
// 例：'ultra-z-leo-01' → '01' ／ 'uz-ab12cd34-02' → '02' ／ 空・不正 → ''。
// clientId 自体がハイフンを含むため、末尾の数値セグメントのみを拠点とみなす。
function _extractQrLocation_(qr) {
  var s = String(qr || '').trim();
  if (!s) return '';
  var m = s.match(/-(\d{1,3})$/);
  return m ? m[1] : '';
}

/* ══════════════════════════════════════════════════════════
   clockOut アクション（v3）
   ══════════════════════════════════════════════════════════ */

function _doClockOutV3(data) {
  const ss    = _ss_();
  const sheet = ss.getSheetByName('attendance');
  if (!sheet) return { status: 'error', message: 'attendance シートが見つかりません' };

  const rowIndex     = Number(data.rowIndex);
  const clockOutTime = data.clockOutTime || data.clockOut || '';

  if (!rowIndex || !clockOutTime) {
    return { status: 'error', message: 'rowIndex と clockOutTime は必須です' };
  }

  // 入店日・入店時刻を取得して退店日を計算
  const rawClockInDate = sheet.getRange(rowIndex, 1).getValue();
  const rawClockInTime = sheet.getRange(rowIndex, 5).getValue();
  const clockInDateStr = rawClockInDate instanceof Date ? _dateToStr(rawClockInDate) : String(rawClockInDate);
  const clockInTime    = _normalizeTimeStr(rawClockInTime);

  const clockOutDate = _resolveClockOutDate(
    clockInDateStr, clockInTime, clockOutTime, data.clockOutDate || ''
  );

  sheet.getRange(rowIndex, 6).setValue(clockOutDate);
  sheet.getRange(rowIndex, 7).setValue(clockOutTime);

  return { status: 'ok' };
}

/* ══════════════════════════════════════════════════════════
   updateAttendance アクション（v3）
   ══════════════════════════════════════════════════════════ */

function _doUpdateAttendanceV3(data) {
  const ss    = _ss_();
  const sheet = ss.getSheetByName('attendance');
  if (!sheet) return { status: 'error', message: 'attendance シートが見つかりません' };

  const rowIndex = Number(data.rowIndex);
  if (!rowIndex) return { status: 'error', message: 'rowIndex は必須です' };

  const clockInDate  = data.date        || data.clockInDate  || '';
  const staffId      = data.staffId     || '';
  const staffName    = data.staffName   || '';
  const clockInTime  = data.clockIn     || data.clockInTime  || '';
  const clockOutTime = (data.clockOut !== undefined) ? (data.clockOut || '') :
                       (data.clockOutTime !== undefined) ? (data.clockOutTime || '') : undefined;

  if (clockInDate)  sheet.getRange(rowIndex, 1).setValue(clockInDate);
  if (staffId)      sheet.getRange(rowIndex, 2).setValue(staffId);
  if (staffName)    sheet.getRange(rowIndex, 3).setValue(staffName);
  if (clockInTime)  sheet.getRange(rowIndex, 5).setValue(clockInTime);

  if (clockOutTime !== undefined) {
    if (!clockOutTime) {
      sheet.getRange(rowIndex, 6).setValue('');
      sheet.getRange(rowIndex, 7).setValue('');
    } else {
      const baseDate = clockInDate ||
        (function() {
          const v = sheet.getRange(rowIndex, 1).getValue();
          return v instanceof Date ? _dateToStr(v) : String(v);
        })();
      const baseCiTime = clockInTime ||
        _normalizeTimeStr(sheet.getRange(rowIndex, 5).getValue());

      const clockOutDate = _resolveClockOutDate(
        baseDate, baseCiTime, clockOutTime, data.clockOutDate || ''
      );
      sheet.getRange(rowIndex, 6).setValue(clockOutDate);
      sheet.getRange(rowIndex, 7).setValue(clockOutTime);
    }
  }

  // I列(9) projectId 更新（payload に含まれる場合のみ・空文字での解除も許容）
  // サイクルA：稼働メモ→案件 後付け紐付けのPC操作経路
  if (data.projectId !== undefined) {
    sheet.getRange(rowIndex, 9).setValue(String(data.projectId || ''));
  }

  return { status: 'ok' };
}

/* ══════════════════════════════════════════════════════════
   getAttendanceByMonth アクション（v3）
   ══════════════════════════════════════════════════════════ */

function _doGetAttendanceByMonthV3(data) {
  const month = data.month || '';
  if (!month) return { status: 'error', message: 'month は必須です (YYYY-MM)' };

  const ss    = _ss_();
  const sheet = ss.getSheetByName('attendance');
  if (!sheet) return { status: 'ok', data: [] };

  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return { status: 'ok', data: [] };

  // I列(9)案件ID・J列(10)qrLocation が存在する場合のみ読み出す（後方互換）
  const lastCol = Math.max(8, Math.min(10, sheet.getLastColumn()));
  const rows   = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const result = [];

  for (var i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawCiDate = row[0];
    const staffId   = row[1];
    const staffName = row[2];
    const empType   = row[3];
    const ciTimeRaw = row[4];
    const rawCoDate = row[5];
    const coTimeRaw = row[6];
    const regAt     = row[7];
    const projectId = lastCol >= 9  ? String(row[8] || '') : '';   // I列・案件ID（サイクルA）
    const qrLocation = lastCol >= 10 ? String(row[9] || '') : '';  // J列・拠点NN（段2・現地証明）

    const clockInDate  = rawCiDate instanceof Date  ? _dateToStr(rawCiDate)  : String(rawCiDate  || '');
    const clockOutDate = rawCoDate instanceof Date   ? _dateToStr(rawCoDate)  : String(rawCoDate  || '');
    const clockInTime  = _normalizeTimeStr(ciTimeRaw);
    const clockOutTime = _normalizeTimeStr(coTimeRaw);

    // 月フィルタ（入店日ベース）
    if (!clockInDate.startsWith(month)) continue;

    const is_overnight = !!(clockOutDate && clockOutDate !== '' && clockOutDate !== clockInDate);

    // 勤務時間（分）
    let workMinutes = null;
    if (clockInTime && clockOutTime) {
      const ci = _parseHHMM(clockInTime);
      const co = _parseHHMM(clockOutTime);
      if (ci && co) {
        let total = (co.h * 60 + co.m) - (ci.h * 60 + ci.m);
        if (is_overnight) total += 24 * 60;
        if (total > 0) workMinutes = total;
      }
    }

    result.push({
      rowIndex:       i + 1,
      date:           clockInDate,
      clockInDate,
      staffId:        String(staffId  || ''),
      staffName:      String(staffName || ''),
      employmentType: String(empType  || ''),
      clockIn:        clockInTime,
      clockOut:       clockOutTime,
      clockOutDate,
      is_overnight,
      workMinutes,
      projectId,                   // I列・案件ID（サイクルA・後付け紐付け運用）
      qrLocation,                  // J列・拠点NN（段2・現地証明・空欄＝なし）
    });
  }

  return { status: 'ok', data: result };
}


/* ═══════════════════════════════════════════════════════════
   売上カテゴリランキング（旧 sales_ranking.gs を統合）
   ═══════════════════════════════════════════════════════════ */


function getSalesCategoryRanking_(months) {
  const monthsNum = parseInt(months, 10) || 1;
  const sheet = _ss_().getSheetByName('sales');
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const lastCol = sheet.getLastColumn();
  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  // ヘッダー行から serviceCode 列を特定
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const COL_DATE         = headers.findIndex(h => /^(日付|発生日|date)/i.test(String(h)));
  const COL_SERVICE_CODE = headers.findIndex(h => /^(サービスコード|serviceCode|service_code)/i.test(String(h)));

  // ヘッダーで見つからない場合のフォールバック（列位置を直接指定）
  const dateCol    = COL_DATE         >= 0 ? COL_DATE         : 0;
  const svcCodeCol = COL_SERVICE_CODE >= 0 ? COL_SERVICE_CODE : 1;

  // 直近 N ヶ月の閾値
  const now       = new Date();
  const threshold = new Date(now.getFullYear(), now.getMonth() - monthsNum, now.getDate());

  const counter = new Map();
  data.forEach(function(row) {
    const rawDate = row[dateCol];
    if (!rawDate) return;
    const date = rawDate instanceof Date ? rawDate : new Date(rawDate);
    if (isNaN(date.getTime()) || date < threshold) return;

    const code = String(row[svcCodeCol] || '').trim();
    if (!code) return;
    counter.set(code, (counter.get(code) || 0) + 1);
  });

  return Array.from(counter.entries())
    .map(function(entry) { return { code: entry[0], count: entry[1] }; })
    .sort(function(a, b) { return b.count - a.count; });
}

// =====================================================================
// 警備隊 第5隊員：FAX注文自動管理（fax_order_ocr）
// 正本仕様＝知識MD 05§8-7 ／ データ＝03§1-6 orders シート ／ フラグ＝03§6 featureVisibility.fax_order_ocr
// 出自＝第1隊員レシートOCR（§8-2）の複製。変えるのは (a)抽出プロンプト＝注文項目 (b)書込先＝orders。
// 2Tier： Tier1＝紙FAXをスマホ撮影（faxOrderScanTier1）／ Tier2＝メール転送FAX自動取込（faxOrderGmailPoll）。
// §8-1 AI自動確定禁止を堅持：取込は「下書き(draft)」まで。確認・修正・確定(confirmed)は人手。
// =====================================================================

// --- 設定（Script Properties・運営が納品時に設定） -------------------
// CLAUDE_API_KEY   : Anthropic APIキー（ターゲット社が一括契約・§8-1 サーバー側管理／PWAに露出しない）
// CLAUDE_MODEL     : 既定 'claude-opus-4-8'（コスト調整は運営がここで切替＝§8-1 コスト管理）
// FAX_MONTHLY_CAP  : 月間の撮影/添付処理上限枚数（既定 500・従量課金の頭打ち）
// FAX_NOTIFY_EMAIL : 着信通知の宛先（未設定なら実行ユーザーのアドレス）
// FAX_GMAIL_QUERY  : Tier2 のGmail検索クエリ（既定 'has:attachment filename:pdf -label:fax-processed newer_than:14d'）
const FAX_PROCESSED_LABEL = 'fax-processed';
const FAX_TRIGGER_HANDLER = 'faxOrderGmailPoll';

function _faxProp_(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return (v === null || v === '') ? fallback : v;
}

function getFaxOrderConfig() {
  var enabled = false;
  try {
    var s = getSettings();
    var fv = (s && s.data && s.data.featureVisibility) || {};
    enabled = fv.fax_order_ocr === true;
  } catch (e) { /* settings 未整備時は false */ }
  var hasTrigger = ScriptApp.getProjectTriggers().some(function(t) {
    return t.getHandlerFunction() === FAX_TRIGGER_HANDLER;
  });
  var quota = _faxQuota_();
  return {
    status: 'ok',
    enabled: enabled,
    apiKeyConfigured: !!_faxProp_('CLAUDE_API_KEY', ''),
    model: _faxProp_('CLAUDE_MODEL', 'claude-opus-4-8'),
    tier2TriggerInstalled: hasTrigger,
    monthlyCap: Number(_faxProp_('FAX_MONTHLY_CAP', '500')),
    monthlyUsed: quota.used,
    month: quota.month
  };
}

// --- コスト上限（月次・撮影/添付枚数基準・§8-2/§8-1） ---------------
function _faxQuota_() {
  var month = Utilities.formatDate(new Date(), _faxTz_(), 'yyyy-MM');
  var key = 'FAX_USED_' + month;
  var used = Number(_faxProp_(key, '0')) || 0;
  return { month: month, key: key, used: used };
}
function _faxTz_() {
  try { return _ss_().getSpreadsheetTimeZone() || 'Asia/Tokyo'; } catch (e) { return 'Asia/Tokyo'; }
}
function _faxConsumeQuota_(n) {
  var cap = Number(_faxProp_('FAX_MONTHLY_CAP', '500')) || 0;
  var q = _faxQuota_();
  if (cap > 0 && q.used + n > cap) {
    throw new Error('FAX注文の月間処理上限（' + cap + '枚）に達しました。上限は運営(FAX_MONTHLY_CAP)で調整できます。');
  }
  PropertiesService.getScriptProperties().setProperty(q.key, String(q.used + n));
}

// --- Claude API 本実装（§8-1：APIキーはGAS側・フロント非露出） -------
// attachments: [{ base64, mimeType }] （image/* は image ブロック・application/pdf は document ブロック）
// 応答テキスト（JSON文字列）を返す。呼び出し側でパースする。
function callClaudeAPI(promptText, attachments) {
  var apiKey = _faxProp_('CLAUDE_API_KEY', '');
  if (!apiKey) throw new Error('CLAUDE_API_KEY が未設定です（運営がScript Propertiesに設定してください）。');
  var model = _faxProp_('CLAUDE_MODEL', 'claude-opus-4-8');

  var content = [];
  (attachments || []).forEach(function(att) {
    var mime = att.mimeType || 'image/jpeg';
    if (mime === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: att.base64 } });
    } else {
      content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: att.base64 } });
    }
  });
  content.push({ type: 'text', text: promptText });

  var payload = {
    model: model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: content }]
  };

  var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(payload)
  });

  var code = resp.getResponseCode();
  if (code !== 200) {
    throw new Error('Claude API エラー HTTP ' + code + ': ' + resp.getContentText().slice(0, 300));
  }
  var body = JSON.parse(resp.getContentText());
  if (body.stop_reason === 'refusal') {
    throw new Error('Claude API が応答を拒否しました（refusal）。');
  }
  var textBlock = (body.content || []).filter(function(b) { return b.type === 'text'; })[0];
  return textBlock ? textBlock.text : '';
}

// --- 抽出（プロンプト＋パース） -------------------------------------
// ひな形（faxPatterns）は「取引先ごとの読み取り方＝readingSpec」。発注書は各社で書式が千差万別
// （1ブロック1注文の産直ギフト／商品行×店舗列のマトリクス発注 等）だが、取引先ごとに毎回同じ書式
// なので、サンプル1枚から確定した readingSpec（自由文）＋商品名エイリアスをプロンプトへ注入し、
// あらゆるパターンをClaudeに読ませる（固定座標マッピングは採らない・→ 05§8-7）。
// レイアウト種別/展開ルールの人手指定は廃止（サンプルから読み方を確定＝readingSpec に内包）。
// _faxExpansionText_ は旧データ(expansion)の後方互換表示にのみ残す。
function _faxExpansionText_(code) {
  switch (String(code)) {
    case 'per_block':    return '1ブロック（明細区切り）＝1注文として読む';
    case 'per_row':      return '表の各行＝1明細として読む';
    case 'matrix_store': return '店舗マトリクス：商品行×店舗列の数量セルごとに明細を1件ずつ展開し、storeName に店舗名を入れる（数量0・空欄の店舗は作らない）';
    default:             return '書式に応じて自動判定';
  }
}

function _faxExtractPrompt_(patterns) {
  var lines = [
    'あなたはFAX注文書を読み取る事務アシスタントです。',
    '添付は1件の受注FAX（PDFまたは画像）です。記載された注文内容を構造化JSONで返してください。',
    '出力は次のJSONのみ（前後に説明文やコードブロック記号を付けない）：',
    '{',
    '  "supplierName": "発注元(取引先)名。読み取れなければ空文字",',
    '  "senderFax": "先方FAX番号。読み取れなければ空文字",',
    '  "desiredDeliveryDate": "納品希望日 YYYY-MM-DD。読み取れなければ空文字",',
    '  "matchedPatternId": "下記の既知ひな形に該当すればそのID。なければ空文字",',
    '  "items": [ { "productName":"商品名", "quantity":数量(数値), "unitPrice":単価(数値・不明は0), "storeName":"店舗/お届け先名(該当時のみ)", "note":"備考(規格・JAN・のし等の付随情報)" } ],',
    '  "confidence": 0.0〜1.0 の読取り信頼度,',
    '  "memo": "全体の注記（判読不能箇所など）"',
    '}',
    '数量・単価は数値のみ（カンマ・単位を除く）。判読できない項目は空文字か0にし、推測で埋めないこと。',
    '表が「商品行×店舗列」のマトリクス形式なら、数量が入った各セルを1明細に展開し、その店舗名を storeName に入れてください（数量0・空欄の店舗は作らない）。'
  ];
  var enabled = (patterns || []).filter(function(p) { return p && p.enabled !== false; });
  if (enabled.length) {
    lines.push('');
    lines.push('■ 既知の取引先ひな形（各取引先のサンプル発注書から確定した「読み取り方」です。このFAXが下記のどれに該当するか判定し、該当すればその読み取り方に厳密に従ってください）：');
    enabled.forEach(function(p, i) {
      lines.push('--- ひな形 ---');
      lines.push('ID: ' + (p.id || ('pat-' + (i + 1))));
      lines.push('取引先名: ' + (p.supplierName || ''));
      if (p.senderFax) lines.push('先方FAX番号: ' + p.senderFax);
      // readingSpec を正とし、旧 instructions は後方互換で流用。旧 expansion があれば読み方へ畳み込む。
      var spec = p.readingSpec || p.instructions || '';
      if (p.expansion && p.expansion !== 'auto') spec += (spec ? '\n' : '') + '（展開ルール）' + _faxExpansionText_(p.expansion);
      if (spec) lines.push('読み取り方: ' + spec);
      if (p.aliases) lines.push('商品名の読み替え（「表記 => 商品マスタの名称/コード」。抽出後に必ず置換して productName に入れる）:\n' + p.aliases);
    });
    lines.push('--- 以上 ---');
    lines.push('該当したひな形のIDを matchedPatternId に入れてください。どのひな形にも該当しなければ matchedPatternId は空文字とし、汎用として最善で読み取ってください（この場合は confidence を控えめにし、人の確認を促してください）。');
  }
  return lines.join('\n');
}

function extractFaxOrder(base64, mimeType, patternsOverride) {
  _faxConsumeQuota_(1);
  // patternsOverride があれば優先（admin初期設定で未保存のreadingSpecを試写するため）。
  var patterns = Array.isArray(patternsOverride) ? patternsOverride : null;
  if (!patterns) {
    patterns = [];
    try { var s = getSettings(); patterns = (s && s.data && s.data.faxPatterns) || []; } catch (e) {}
  }
  var raw = callClaudeAPI(_faxExtractPrompt_(patterns), [{ base64: base64, mimeType: mimeType }]);
  var jsonText = _faxStripToJson_(raw);
  var parsed;
  try { parsed = JSON.parse(jsonText); }
  catch (e) { throw new Error('AI応答のJSON解析に失敗しました。手入力での登録をご利用ください。'); }
  parsed.items = Array.isArray(parsed.items) ? parsed.items : [];
  parsed.confidence = Number(parsed.confidence) || 0;
  return parsed;
}

function _faxStripToJson_(text) {
  if (!text) return '{}';
  var s = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  var a = s.indexOf('{'); var b = s.lastIndexOf('}');
  return (a >= 0 && b > a) ? s.slice(a, b + 1) : s;
}

// --- orders シート（03§1-6・存在時作成） ---------------------------
function _faxOrdersSheet_() {
  var ss = _ss_();
  var sh = ss.getSheetByName('orders');
  if (!sh) {
    sh = ss.insertSheet('orders');
    sh.getRange('A1:Q1').setValues([[
      '受注ID', '明細No', '顧客ID', '発注元', '先方FAX番号', '商品名', '数量', '単価', '金額',
      '納品希望日', '取込Tier', '状態', 'confidence', 'ソース', 'メモ', '登録日時', '確定日時'
    ]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function _faxGenerateOrderId_(date) {
  var ymd = Utilities.formatDate(date || new Date(), _faxTz_(), 'yyyyMMdd');
  var sh = _faxOrdersSheet_();
  var last = sh.getLastRow();
  var prefix = 'fo-' + ymd;
  var n = 0;
  if (last >= 2) {
    var ids = sh.getRange(2, 1, last - 1, 1).getValues();
    var seen = {};
    ids.forEach(function(r) {
      var id = String(r[0] || '');
      if (id.indexOf(prefix) === 0) seen[id] = true;
    });
    n = Object.keys(seen).length;
  }
  return prefix + ('0000' + (n + 1)).slice(-4);
}

// 抽出結果を下書き(draft)として orders に書き込む（§8-1：確定はしない）
function _faxSaveDraft_(extracted, meta) {
  meta = meta || {};
  var sh = _faxOrdersSheet_();
  var now = new Date();
  var orderId = _faxGenerateOrderId_(now);
  var senderFax = extracted.senderFax || meta.senderFax || '';
  var customerId = _faxMatchCustomerByFax_(senderFax);
  var items = (extracted.items && extracted.items.length) ? extracted.items : [{ productName: '', quantity: '', unitPrice: 0, note: '' }];
  var rows = items.map(function(it, i) {
    var qty = Number(it.quantity) || 0;
    var price = Number(it.unitPrice) || 0;
    // 取引先ごとの付随情報（店舗名・規格・JAN・のし等）は 拡張列を持たない現行 orders では
    // メモへ集約する（→ 05§8-7・将来は専用列へ昇格可）。
    var noteParts = [];
    if (it.storeName) noteParts.push('店舗:' + it.storeName);
    if (it.note) noteParts.push(String(it.note));
    var lineNote = noteParts.join(' / ') || extracted.memo || '';
    return [
      orderId, i + 1, customerId, extracted.supplierName || '', senderFax,
      it.productName || '', qty, price, qty * price,
      extracted.desiredDeliveryDate || '', meta.tier || '', 'draft',
      extracted.confidence || 0, meta.source || '', lineNote, now, ''
    ];
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  return { orderId: orderId, customerId: customerId, lineCount: rows.length, confidence: extracted.confidence || 0 };
}

// 先方FAX番号 → 顧客ID 照合（customers シートに「先方FAX番号」列がある前提・無ければ空）
function _faxMatchCustomerByFax_(faxNumber) {
  if (!faxNumber) return '';
  var digits = String(faxNumber).replace(/[^0-9]/g, '');
  if (!digits) return '';
  var ss = _ss_();
  var sh = ss.getSheetByName('customers');
  if (!sh || sh.getLastRow() < 2) return '';
  var values = sh.getDataRange().getValues();
  var header = values[0].map(function(h) { return String(h).trim(); });
  var idCol = header.indexOf('顧客No');
  if (idCol < 0) idCol = header.indexOf('customerId');
  if (idCol < 0) idCol = 0;
  var faxCol = header.indexOf('先方FAX番号');
  if (faxCol < 0) faxCol = header.indexOf('FAX番号');
  if (faxCol < 0) return '';
  for (var i = 1; i < values.length; i++) {
    var rowFax = String(values[i][faxCol] || '').replace(/[^0-9]/g, '');
    if (rowFax && rowFax === digits) return String(values[i][idCol] || '');
  }
  return '';
}

// --- Tier1：スマホ撮影（PWAから base64 で受領） --------------------
function faxOrderScanTier1(data) {
  data = data || {};
  if (!data.imageBase64) throw new Error('画像データ(imageBase64)がありません。');
  var mime = data.mimeType || 'image/jpeg';
  var extracted = extractFaxOrder(data.imageBase64, mime);
  var saved = _faxSaveDraft_(extracted, { tier: 'tier1', source: 'tier1-photo' });
  return { status: 'ok', draft: saved, extracted: extracted };
}

// --- プレビュー抽出（書き込みなし・検証ハーネスの中核） ----------------
// 最新コードの抽出結果を orders に一切残さず返す。用途は3つ（→ 05§8-7 検証ハーネス）：
//   ① ひな形の初期設定：サンプル発注書をアップロードして readingSpec の効きをその場で確認。
//   ② 複製元デモ／dev検証店：新規店を作らず「最新の状態」を試し読み（データを汚さない）。
//   ③ 日常の「試し読み」：確定前に読み取り結果だけ先に見たいとき。
function previewFaxOrder(data) {
  data = data || {};
  if (!data.imageBase64) throw new Error('画像データ(imageBase64)がありません。');
  var mime = data.mimeType || 'image/jpeg';
  // data.patterns（admin初期設定で編集中の未保存ひな形）があればそれで試写する。
  var extracted = extractFaxOrder(data.imageBase64, mime, Array.isArray(data.patterns) ? data.patterns : undefined);
  return { status: 'ok', preview: extracted };
}

// 【GASエディタ実行用】Drive上のサンプルPDF/画像をIDで指定し、最新の抽出結果を Logger に出す。
// PWAも店舗生成も不要の"最速の検証ループ"（ordersへは一切書かない・→ 05§8-7 検証ハーネス）。
// 使い方：fileId を実発注書のDriveファイルIDに置換して実行 → 「実行ログ」で JSON を確認。
function _faxTestExtract_(fileId) {
  fileId = fileId || 'ここにDriveのサンプルファイルIDを貼る';
  var blob = DriveApp.getFileById(fileId).getBlob();
  var base64 = Utilities.base64Encode(blob.getBytes());
  var extracted = extractFaxOrder(base64, blob.getContentType());
  Logger.log(JSON.stringify(extracted, null, 2));
  return extracted;
}

// --- Tier2：メール転送FAX 自動取込（時間主導トリガーで実行） --------
function faxOrderGmailPoll() {
  var query = _faxProp_('FAX_GMAIL_QUERY', 'has:attachment filename:pdf -label:' + FAX_PROCESSED_LABEL + ' newer_than:14d');
  var label = _faxEnsureLabel_(FAX_PROCESSED_LABEL);
  var threads = GmailApp.search(query, 0, 20);
  var processed = 0, drafts = 0, errors = 0;
  threads.forEach(function(thread) {
    try {
      thread.getMessages().forEach(function(msg) {
        var atts = msg.getAttachments({ includeInlineImages: false });
        atts.forEach(function(att) {
          if (att.getContentType() !== 'application/pdf') return;
          var extracted = extractFaxOrder(Utilities.base64Encode(att.getBytes()), 'application/pdf');
          var saved = _faxSaveDraft_(extracted, {
            tier: 'tier2', source: 'gmail:' + msg.getId(),
            senderFax: _faxSenderFaxFromEmail_(msg)
          });
          drafts++;
          _faxNotify_(
            '【FAX受注・下書き作成】' + (extracted.supplierName || '発注元不明'),
            'FAX注文を自動取込し、下書きを作成しました。内容を確認・修正のうえ確定してください。\n' +
            '受注ID: ' + saved.orderId + '\n明細数: ' + saved.lineCount +
            '\n信頼度: ' + Math.round((extracted.confidence || 0) * 100) + '%\n' +
            (saved.customerId ? '照合顧客ID: ' + saved.customerId : '※先方FAX番号が顧客マスタと一致せず未紐付け') +
            '\n件名: ' + msg.getSubject()
          );
        });
      });
      thread.addLabel(label);
      processed++;
    } catch (e) {
      errors++;
      _faxNotify_('【FAX受注・取込エラー】', 'スレッド「' + thread.getFirstMessageSubject() + '」の取込に失敗: ' + e.message);
    }
  });
  return { status: 'ok', threads: processed, drafts: drafts, errors: errors };
}

function _faxSenderFaxFromEmail_(msg) {
  // 件名・本文からFAX番号らしき数字列を拾う（インターネットFAXは件名に発信番号を載せることが多い）
  var text = (msg.getSubject() || '') + ' ' + (msg.getPlainBody() || '').slice(0, 500);
  var m = text.match(/0\d{1,3}[-\s]?\d{2,4}[-\s]?\d{3,4}/);
  return m ? m[0] : '';
}

function _faxEnsureLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function _faxNotify_(subject, body) {
  var to = _faxProp_('FAX_NOTIFY_EMAIL', '');
  if (!to) { try { to = Session.getEffectiveUser().getEmail(); } catch (e) { to = ''; } }
  if (!to) return;
  try { MailApp.sendEmail(to, subject, body); } catch (e) { /* 通知失敗は本処理を止めない */ }
}

// Tier2 の時間主導トリガー設置（納品手順・冪等） -------------------
function setupFaxOrderTrigger() {
  var exists = ScriptApp.getProjectTriggers().some(function(t) {
    return t.getHandlerFunction() === FAX_TRIGGER_HANDLER;
  });
  if (!exists) {
    ScriptApp.newTrigger(FAX_TRIGGER_HANDLER).timeBased().everyMinutes(15).create();
  }
  _faxEnsureLabel_(FAX_PROCESSED_LABEL);
  return { status: 'ok', triggerInstalled: true, everyMinutes: 15 };
}

function removeFaxOrderTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === FAX_TRIGGER_HANDLER) ScriptApp.deleteTrigger(t);
  });
  return { status: 'ok', triggerInstalled: false };
}

// --- 確認UI用アクション（一覧・確定・修正・削除） -----------------
function getOrders(data) {
  data = data || {};
  var sh = _faxOrdersSheet_();
  var last = sh.getLastRow();
  if (last < 2) return { status: 'ok', orders: [] };
  var values = sh.getRange(2, 1, last - 1, 17).getValues();
  var tz = _faxTz_();
  var rows = values.map(function(r, i) {
    return {
      rowIndex: i + 2,
      orderId: r[0], lineNo: r[1], customerId: r[2], supplierName: r[3], senderFax: r[4],
      productName: r[5], quantity: r[6], unitPrice: r[7], amount: r[8], desiredDeliveryDate: r[9],
      tier: r[10], state: r[11], confidence: r[12], source: r[13], memo: r[14],
      createdAt: r[15] instanceof Date ? Utilities.formatDate(r[15], tz, 'yyyy-MM-dd HH:mm') : r[15],
      confirmedAt: r[16] instanceof Date ? Utilities.formatDate(r[16], tz, 'yyyy-MM-dd HH:mm') : r[16]
    };
  });
  if (data.state) rows = rows.filter(function(o) { return o.state === data.state; });
  // 受注一覧の絞込（→ 05§8-5 一覧ビュー）：発注元・顧客・期間（登録日 createdAt の yyyy-MM-dd で比較）
  if (data.supplierName) rows = rows.filter(function(o) { return String(o.supplierName || '').indexOf(data.supplierName) >= 0; });
  if (data.customerId) rows = rows.filter(function(o) { return String(o.customerId) === String(data.customerId); });
  if (data.dateFrom) rows = rows.filter(function(o) { return String(o.createdAt || '').slice(0, 10) >= data.dateFrom; });
  if (data.dateTo) rows = rows.filter(function(o) { return String(o.createdAt || '').slice(0, 10) <= data.dateTo; });
  return { status: 'ok', orders: rows };
}

// 明細行の修正（rowIndex 指定）
function updateOrder(data) {
  data = data || {};
  var sh = _faxOrdersSheet_();
  var idx = Number(data.rowIndex);
  if (!idx || idx < 2 || idx > sh.getLastRow()) throw new Error('対象行が不正です。');
  var map = { customerId: 3, supplierName: 4, senderFax: 5, productName: 6, quantity: 7, unitPrice: 8, desiredDeliveryDate: 10, memo: 15 };
  Object.keys(map).forEach(function(k) {
    if (data[k] !== undefined) sh.getRange(idx, map[k]).setValue(data[k]);
  });
  // 金額は数量×単価で再計算
  var qty = Number(sh.getRange(idx, 7).getValue()) || 0;
  var price = Number(sh.getRange(idx, 8).getValue()) || 0;
  sh.getRange(idx, 9).setValue(qty * price);
  return { status: 'ok', rowIndex: idx };
}

// 確定（§8-1：人手の明示操作で draft → confirmed）。orderId 単位で全明細を確定
function saveOrder(data) {
  data = data || {};
  var orderId = String(data.orderId || '');
  if (!orderId) throw new Error('orderId が必要です。');
  var sh = _faxOrdersSheet_();
  var last = sh.getLastRow();
  if (last < 2) throw new Error('受注データがありません。');
  var range = sh.getRange(2, 1, last - 1, 17);
  var values = range.getValues();
  var now = new Date();
  var n = 0;
  values.forEach(function(r) {
    if (String(r[0]) === orderId) { r[11] = 'confirmed'; r[16] = now; n++; }
  });
  if (!n) throw new Error('該当する受注が見つかりません: ' + orderId);
  range.setValues(values);
  return { status: 'ok', orderId: orderId, confirmedLines: n };
}

// 削除（rowIndex 単一行 or orderId 全明細）
function deleteOrder(data) {
  data = data || {};
  var sh = _faxOrdersSheet_();
  if (data.rowIndex) {
    var idx = Number(data.rowIndex);
    if (idx < 2 || idx > sh.getLastRow()) throw new Error('対象行が不正です。');
    sh.deleteRow(idx);
    return { status: 'ok', deleted: 1 };
  }
  var orderId = String(data.orderId || '');
  if (!orderId) throw new Error('rowIndex または orderId が必要です。');
  var last = sh.getLastRow();
  var values = sh.getRange(2, 1, last - 1, 1).getValues();
  var deleted = 0;
  for (var i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]) === orderId) { sh.deleteRow(i + 2); deleted++; }
  }
  return { status: 'ok', deleted: deleted };
}

// =============================================================
// 警備隊第4隊員 書類発行自動化＋商品マスタ（doc_automation・▲前倒し）
//   正本＝知識MD 05§8-5 / 03§1-6。台帳＝products（商品マスタ・3段カテゴリ）＋
//   customers（顧客マスタ・帳票宛名/OCR照合）。帳票＝invoices/estimates/deliveries。
//   一覧＝受注一覧(getOrders)・未納一覧(getInvoicesUnpaid)・集計(getDocSummary)。
//   マスタGAS v0.9.0 の createUserSpreadsheet と同一スキーマ。既存店は
//   migrateDocAutomationSchema で不足シート・列を後付けする（doc_automation 有効化時）。
// =============================================================

var DOC_SHEET_SPECS_ = {
  products:   ['productCode', '大分類', '中分類', '小分類', 'productName', 'unitPrice', 'taxRate', 'unit', 'aliases', 'enabled'],
  invoices:   ['invoiceId', 'customerId', '発行日', '支払期限', '明細JSON', '小計', '消費税', '合計', 'ステータス', '入金日', '入金額', 'メモ', 'createdAt', 'updatedAt'],
  estimates:  ['estimateId', 'customerId', '発行日', '有効期限', '明細JSON', '小計', '消費税', '合計', 'ステータス', '変換先invoiceId', 'メモ', 'createdAt'],
  deliveries: ['deliveryId', 'customerId', '発行日', '明細JSON', '小計', '消費税', '合計', 'ステータス', '変換先invoiceId', 'メモ', 'createdAt']
};
// customers は既存6列＋帳票宛名6列を末尾追加＝位置保存（→ 03§1-6）。
var CUSTOMERS_HEADERS_ = ['customerId', 'name', 'type', 'memo', 'createdAt', '先方FAX番号', '郵便番号', '住所', '電話番号', 'email', '担当者', 'updatedAt'];

function _docSheet_(name) {
  var ss = _ss_();
  var sh = ss.getSheetByName(name);
  var headers = DOC_SHEET_SPECS_[name];
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// customers を12列へ（既存列位置を保ち不足列だけ末尾追加＝旧データ・稼働照合を壊さない）。
function _customersSheet_() {
  var ss = _ss_();
  var sh = ss.getSheetByName('customers');
  if (!sh) {
    sh = ss.insertSheet('customers');
    sh.getRange(1, 1, 1, CUSTOMERS_HEADERS_.length).setValues([CUSTOMERS_HEADERS_]).setFontWeight('bold');
    sh.setFrozenRows(1);
    return sh;
  }
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function(h){ return String(h).trim(); });
  CUSTOMERS_HEADERS_.forEach(function(key) {
    if (header.indexOf(key) < 0) {
      sh.getRange(1, sh.getLastColumn() + 1).setValue(key).setFontWeight('bold');
      header.push(key);
    }
  });
  return sh;
}

// 明示マイグレーション（doc_automation 有効化時に admin/ユーザーが1回実行）。冪等。
function migrateDocAutomationSchema() {
  _docSheet_('products');
  _customersSheet_();
  _docSheet_('invoices');
  _docSheet_('estimates');
  _docSheet_('deliveries');
  var s = _ss_().getSheetByName('settings');
  if (s && !String(s.getRange('B7').getValue() || '')) {
    s.getRange('A7').setValue('invoiceSettings');
    s.getRange('B7').setValue(JSON.stringify({ honorificDefault: '御中' }));
  }
  return { status: 'ok', migrated: ['products', 'customers', 'invoices', 'estimates', 'deliveries', 'invoiceSettings'] };
}

// ヘッダー行 → { 見出し: 0基点index } マップ
function _headerMap_(sh) {
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var map = {};
  header.forEach(function(h, i) { map[String(h).trim()] = i; });
  return map;
}

// 列値（1基点col）または rowIndex で対象行を特定（見つからねば 0）
function _findRowByCol_(sh, col, value, rowIndex) {
  if (rowIndex) { var ri = Number(rowIndex); if (ri >= 2 && ri <= sh.getLastRow()) return ri; }
  if (value === undefined || value === '' || value === null) return 0;
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var ids = sh.getRange(2, col, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(value)) return i + 2;
  }
  return 0;
}

// ----- 商品マスタ products CRUD -----
function getProducts() {
  var sh = _docSheet_('products');
  var last = sh.getLastRow();
  if (last < 2) return { status: 'ok', products: [] };
  var values = sh.getRange(2, 1, last - 1, 10).getValues();
  var rows = values.map(function(r, i) {
    return {
      rowIndex: i + 2, productCode: r[0], categoryL1: r[1], categoryL2: r[2], categoryL3: r[3],
      productName: r[4], unitPrice: Number(r[5]) || 0, taxRate: Number(r[6]) || 0,
      unit: r[7], aliases: r[8], enabled: r[9] === '' ? true : !!r[9]
    };
  });
  return { status: 'ok', products: rows };
}

function _nextProductCode_(sh) {
  var last = sh.getLastRow();
  var max = 0;
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(function(r) {
      var m = String(r[0] || '').match(/^pr(\d+)$/);
      if (m) max = Math.max(max, Number(m[1]));
    });
  }
  return 'pr' + ('000' + (max + 1)).slice(-3);
}

function addProduct(data) {
  data = data || {};
  var sh = _docSheet_('products');
  var code = String(data.productCode || '') || _nextProductCode_(sh);
  var row = [
    code, data.categoryL1 || '', data.categoryL2 || '', data.categoryL3 || '',
    data.productName || '', Number(data.unitPrice) || 0, Number(data.taxRate) || 0,
    data.unit || '', data.aliases || '', data.enabled === false ? false : true
  ];
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  return { status: 'ok', productCode: code };
}

function updateProduct(data) {
  data = data || {};
  var sh = _docSheet_('products');
  var idx = _findRowByCol_(sh, 1, data.productCode, data.rowIndex);
  if (!idx) throw new Error('対象商品が見つかりません。');
  var map = { categoryL1: 2, categoryL2: 3, categoryL3: 4, productName: 5, unitPrice: 6, taxRate: 7, unit: 8, aliases: 9, enabled: 10 };
  Object.keys(map).forEach(function(k) {
    if (data[k] !== undefined) sh.getRange(idx, map[k]).setValue(data[k]);
  });
  return { status: 'ok', rowIndex: idx };
}

function deleteProduct(data) {
  data = data || {};
  var sh = _docSheet_('products');
  var idx = _findRowByCol_(sh, 1, data.productCode, data.rowIndex);
  if (!idx) throw new Error('対象商品が見つかりません。');
  sh.deleteRow(idx);
  return { status: 'ok', deleted: 1 };
}

// admin 一括投入（業種雛形）：products を丸ごと置換（→ 05§8-5 納品時初期投入）
function saveProducts(data) {
  data = data || {};
  var list = Array.isArray(data.products) ? data.products : [];
  var sh = _docSheet_('products');
  var last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, 10).clearContent();
  if (list.length) {
    var rows = list.map(function(p, i) {
      var code = String(p.productCode || '') || ('pr' + ('000' + (i + 1)).slice(-3));
      return [code, p.categoryL1 || '', p.categoryL2 || '', p.categoryL3 || '', p.productName || '',
              Number(p.unitPrice) || 0, Number(p.taxRate) || 0, p.unit || '', p.aliases || '',
              p.enabled === false ? false : true];
    });
    sh.getRange(2, 1, rows.length, 10).setValues(rows);
  }
  return { status: 'ok', count: list.length };
}

// ----- 顧客マスタ customers CRUD（ヘッダー名で読み書き＝位置保存に追随） -----
function getCustomers() {
  var sh = _customersSheet_();
  var last = sh.getLastRow();
  if (last < 2) return { status: 'ok', customers: [] };
  var map = _headerMap_(sh);
  var values = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var rows = values.map(function(r, i) {
    function g(key) { return map[key] !== undefined ? r[map[key]] : ''; }
    return {
      rowIndex: i + 2, customerId: g('customerId'), name: g('name'), type: g('type'), memo: g('memo'),
      senderFax: g('先方FAX番号'), postalCode: g('郵便番号'), address: g('住所'),
      tel: g('電話番号'), email: g('email'), contactPerson: g('担当者')
    };
  });
  return { status: 'ok', customers: rows };
}

function _nextCustomerId_(sh, map) {
  var last = sh.getLastRow();
  var col = (map['customerId'] !== undefined ? map['customerId'] : 0) + 1;
  var max = 0;
  if (last >= 2) {
    sh.getRange(2, col, last - 1, 1).getValues().forEach(function(r) {
      var m = String(r[0] || '').match(/^cs(\d+)$/);
      if (m) max = Math.max(max, Number(m[1]));
    });
  }
  return 'cs' + ('000' + (max + 1)).slice(-3);
}

function addCustomer(data) {
  data = data || {};
  var sh = _customersSheet_();
  var map = _headerMap_(sh);
  var id = String(data.customerId || '') || _nextCustomerId_(sh, map);
  var now = new Date();
  var obj = {
    customerId: id, name: data.name || '', type: data.type || '', memo: data.memo || '',
    createdAt: now, '先方FAX番号': data.senderFax || '', '郵便番号': data.postalCode || '',
    '住所': data.address || '', '電話番号': data.tel || '', email: data.email || '',
    '担当者': data.contactPerson || '', updatedAt: now
  };
  var width = sh.getLastColumn();
  var row = [];
  for (var c = 0; c < width; c++) row.push('');
  Object.keys(obj).forEach(function(k) { if (map[k] !== undefined) row[map[k]] = obj[k]; });
  sh.getRange(sh.getLastRow() + 1, 1, 1, width).setValues([row]);
  return { status: 'ok', customerId: id };
}

function updateCustomer(data) {
  data = data || {};
  var sh = _customersSheet_();
  var map = _headerMap_(sh);
  var col = (map['customerId'] !== undefined ? map['customerId'] : 0) + 1;
  var idx = _findRowByCol_(sh, col, data.customerId, data.rowIndex);
  if (!idx) throw new Error('対象顧客が見つかりません。');
  var fieldMap = { name: 'name', type: 'type', memo: 'memo', senderFax: '先方FAX番号', postalCode: '郵便番号', address: '住所', tel: '電話番号', email: 'email', contactPerson: '担当者' };
  Object.keys(fieldMap).forEach(function(k) {
    var h = fieldMap[k];
    if (data[k] !== undefined && map[h] !== undefined) sh.getRange(idx, map[h] + 1).setValue(data[k]);
  });
  if (map['updatedAt'] !== undefined) sh.getRange(idx, map['updatedAt'] + 1).setValue(new Date());
  return { status: 'ok', rowIndex: idx };
}

function deleteCustomer(data) {
  data = data || {};
  var sh = _customersSheet_();
  var map = _headerMap_(sh);
  var col = (map['customerId'] !== undefined ? map['customerId'] : 0) + 1;
  var idx = _findRowByCol_(sh, col, data.customerId, data.rowIndex);
  if (!idx) throw new Error('対象顧客が見つかりません。');
  sh.deleteRow(idx);
  return { status: 'ok', deleted: 1 };
}

// ----- 帳票発行（見積/請求/納品・→ 05§8-5） -----
function _genDocId_(sh, prefix, date) {
  var ymd = Utilities.formatDate(date || new Date(), _faxTz_(), 'yyyyMMdd');
  var head = prefix + '-' + ymd + '-';
  var last = sh.getLastRow();
  var n = 0;
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(function(r) {
      if (String(r[0] || '').indexOf(head) === 0) n++;
    });
  }
  return head + ('000' + (n + 1)).slice(-3);
}

// 発行：docType=estimate|invoice|delivery。明細は products の productCode を参照。
// 金額は明細の 単価×数量（税抜）を合計し、税率別に消費税を算出する。
function issueDocument(data) {
  data = data || {};
  var docType = String(data.docType || 'invoice');
  var sheetName = ({ estimate: 'estimates', invoice: 'invoices', delivery: 'deliveries' })[docType];
  if (!sheetName) throw new Error('docType が不正です（estimate/invoice/delivery）。');
  var items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) throw new Error('明細がありません。');
  var subtotal = 0, taxTotal = 0;
  var lines = items.map(function(it) {
    var qty = Number(it.quantity) || 0;
    var price = Number(it.unitPrice) || 0;
    var rate = Number(it.taxRate) || 0;
    var amount = qty * price;
    subtotal += amount;
    taxTotal += Math.floor(amount * rate / 100);
    return { productCode: it.productCode || '', productName: it.productName || '', quantity: qty, unitPrice: price, taxRate: rate, amount: amount };
  });
  var total = subtotal + taxTotal;
  var now = new Date();
  var issueDate = data.issueDate || Utilities.formatDate(now, _faxTz_(), 'yyyy-MM-dd');
  var detailJson = JSON.stringify(lines);
  var memo = data.memo || '';
  var sh = _docSheet_(sheetName);
  var docId, row;
  if (docType === 'invoice') {
    docId = _genDocId_(sh, 'inv', now);
    row = [docId, data.customerId || '', issueDate, data.dueDate || '', detailJson, subtotal, taxTotal, total, '発行済', '', '', memo, now, now];
  } else if (docType === 'estimate') {
    docId = _genDocId_(sh, 'est', now);
    row = [docId, data.customerId || '', issueDate, data.validUntil || '', detailJson, subtotal, taxTotal, total, '発行済', '', memo, now];
  } else {
    docId = _genDocId_(sh, 'dlv', now);
    row = [docId, data.customerId || '', issueDate, detailJson, subtotal, taxTotal, total, '発行済', '', memo, now];
  }
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  return { status: 'ok', docType: docType, docId: docId, subtotal: subtotal, tax: taxTotal, total: total };
}

// 帳票一覧（docType 指定・customerId/status で絞込・明細JSONは配列にして返す）
function getDocuments(data) {
  data = data || {};
  var docType = String(data.docType || 'invoice');
  var sheetName = ({ estimate: 'estimates', invoice: 'invoices', delivery: 'deliveries' })[docType];
  if (!sheetName) throw new Error('docType が不正です。');
  var sh = _docSheet_(sheetName);
  var last = sh.getLastRow();
  if (last < 2) return { status: 'ok', documents: [] };
  var headers = DOC_SHEET_SPECS_[sheetName];
  var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  var tz = _faxTz_();
  var docs = values.map(function(r, i) {
    var o = { rowIndex: i + 2 };
    headers.forEach(function(h, ci) {
      var v = r[ci];
      if (h === '明細JSON') { try { o.items = JSON.parse(v || '[]'); } catch (e) { o.items = []; } return; }
      if (v instanceof Date) v = Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm');
      o[h] = v;
    });
    return o;
  });
  if (data.customerId) docs = docs.filter(function(d) { return String(d.customerId) === String(data.customerId); });
  if (data.status) docs = docs.filter(function(d) { return d['ステータス'] === data.status; });
  return { status: 'ok', documents: docs };
}

// ----- 未納一覧（発行済み請求書の未入金・→ 05§8-5。既存 getUnpaid とは別軸） -----
function getInvoicesUnpaid() {
  var sh = _docSheet_('invoices');
  var last = sh.getLastRow();
  if (last < 2) return { status: 'ok', invoices: [] };
  var values = sh.getRange(2, 1, last - 1, DOC_SHEET_SPECS_.invoices.length).getValues();
  var tz = _faxTz_();
  var today = new Date();
  var rows = [];
  values.forEach(function(r, i) {
    if (r[8] === '入金済') return;
    var due = r[3];
    var dd = null;
    if (due instanceof Date) dd = due;
    else if (due) { var p = new Date(String(due).slice(0, 10)); if (!isNaN(p.getTime())) dd = p; }
    rows.push({
      rowIndex: i + 2, invoiceId: r[0], customerId: r[1],
      issueDate: r[2] instanceof Date ? Utilities.formatDate(r[2], tz, 'yyyy-MM-dd') : r[2],
      dueDate: dd ? Utilities.formatDate(dd, tz, 'yyyy-MM-dd') : (due || ''),
      total: Number(r[7]) || 0, status: r[8] || '発行済',
      daysOverdue: dd ? Math.floor((today - dd) / 86400000) : ''
    });
  });
  return { status: 'ok', invoices: rows };
}

// 消込（入金記録）：invoiceId or rowIndex 指定でステータス=入金済・入金日/額を記録
function recordPayment(data) {
  data = data || {};
  var sh = _docSheet_('invoices');
  var idx = _findRowByCol_(sh, 1, data.invoiceId, data.rowIndex);
  if (!idx) throw new Error('対象請求書が見つかりません。');
  var now = new Date();
  sh.getRange(idx, 10).setValue(data.paidDate || Utilities.formatDate(now, _faxTz_(), 'yyyy-MM-dd'));
  sh.getRange(idx, 11).setValue(data.paidAmount !== undefined ? Number(data.paidAmount) : (Number(sh.getRange(idx, 8).getValue()) || 0));
  sh.getRange(idx, 9).setValue('入金済');
  sh.getRange(idx, 14).setValue(now);
  return { status: 'ok', rowIndex: idx };
}

// ----- 集計（顧客別＝請求ベース／商品別・カテゴリ別＝確定受注ベース・products で名寄せ） -----
function getDocSummary(data) {
  data = data || {};
  var byCustomer = {}, byProduct = {}, byCategory = {};
  var inv = _docSheet_('invoices');
  var il = inv.getLastRow();
  if (il >= 2) {
    inv.getRange(2, 1, il - 1, DOC_SHEET_SPECS_.invoices.length).getValues().forEach(function(r) {
      var cid = String(r[1] || '（未指定）');
      byCustomer[cid] = (byCustomer[cid] || 0) + (Number(r[7]) || 0);
    });
  }
  var prodMap = {};
  getProducts().products.forEach(function(p) { prodMap[p.productName] = p; });
  var ord = _faxOrdersSheet_();
  var ol = ord.getLastRow();
  if (ol >= 2) {
    ord.getRange(2, 1, ol - 1, 17).getValues().forEach(function(r) {
      if (r[11] !== 'confirmed') return;
      var pname = String(r[5] || '');
      var amt = Number(r[8]) || 0;
      byProduct[pname] = (byProduct[pname] || 0) + amt;
      var p = prodMap[pname];
      var cat = p ? [p.categoryL1, p.categoryL2, p.categoryL3].filter(function(x) { return !!x; }).join(' / ') : '（未分類）';
      byCategory[cat] = (byCategory[cat] || 0) + amt;
    });
  }
  return { status: 'ok', byCustomer: byCustomer, byProduct: byProduct, byCategory: byCategory };
}
