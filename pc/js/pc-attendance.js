// PC版「出勤管理」メニュー
// 戦略思想メモ§3-9-3 確定の4項目構造・メニュー3
// 月次勤怠＋給与計算セクション統合は次回指示書で実装

document.addEventListener('DOMContentLoaded', () => {
  if (typeof pcBootstrap === 'function') {
    pcBootstrap('attendance.html', '出勤管理');
  }
});
