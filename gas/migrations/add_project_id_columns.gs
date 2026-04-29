/**
 * ウルトラZAIMUくん LEO版 GAS — マイグレーション
 * §3-9-3 PC版4区分構造＋案件粗利機能の本実装に伴う既存スプレッドシート対応
 *
 * 対象：
 *   - 売上シート T列(20) に「案件ID」ヘッダ追加
 *   - コストシート V列(22) に「案件ID」ヘッダ追加
 *   - settingsシート A16 に「featureVisibility」ラベル追加（既存空セル時のみ）
 *
 * 手動実行：GASエディタから addProjectIdColumns() を一度だけ実行
 *   既存データはそのまま・ヘッダ行のみ追加されるため安全
 *   既に追加済みの場合はスキップされる（冪等性あり）
 */
function addProjectIdColumns() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // --- 売上シート T列(20) ヘッダ追加 ---
  var salesSheet = ss.getSheetByName('売上');
  if (salesSheet) {
    var salesLastCol = salesSheet.getLastColumn();
    var salesHeader = salesLastCol >= 20 ? salesSheet.getRange(1, 20).getValue() : '';
    if (salesLastCol < 20 || !salesHeader) {
      salesSheet.getRange(1, 20).setValue('案件ID');
      Logger.log('売上シート T列(20) に「案件ID」ヘッダ追加');
    } else {
      Logger.log('売上シート T列(20) は既に "' + salesHeader + '" が設定済みのためスキップ');
    }
  } else {
    Logger.log('売上シートが存在しないためスキップ（初回入力時に20列で自動作成されます）');
  }

  // --- コストシート V列(22) ヘッダ追加 ---
  var costSheet = ss.getSheetByName('コスト');
  if (costSheet) {
    var costLastCol = costSheet.getLastColumn();
    var costHeader = costLastCol >= 22 ? costSheet.getRange(1, 22).getValue() : '';
    if (costLastCol < 22 || !costHeader) {
      costSheet.getRange(1, 22).setValue('案件ID');
      Logger.log('コストシート V列(22) に「案件ID」ヘッダ追加');
    } else {
      Logger.log('コストシート V列(22) は既に "' + costHeader + '" が設定済みのためスキップ');
    }
  } else {
    Logger.log('コストシートが存在しないためスキップ（初回入力時に22列で自動作成されます）');
  }

  // --- settingsシート A16 ラベル追加 ---
  var settingsSheet = ss.getSheetByName('settings');
  if (settingsSheet) {
    var a16 = settingsSheet.getRange('A16').getValue();
    if (!a16) {
      settingsSheet.getRange('A16').setValue('featureVisibility');
      Logger.log('settingsシート A16 に「featureVisibility」ラベルを追加');
    } else {
      Logger.log('settingsシート A16 は既に "' + a16 + '" が設定済みのためスキップ');
    }
  } else {
    Logger.log('settingsシートが存在しないためスキップ');
  }

  // projectsシートは _getOrCreateProjectsSheet() が初回呼び出し時に自動生成するため不要

  Logger.log('addProjectIdColumns マイグレーション完了');
}
