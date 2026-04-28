/* pc-monthend.js — PC版 月末経理（ホステス源泉確定・税理士等報酬源泉確定・給与計算） */
'use strict';

document.addEventListener('DOMContentLoaded', () => {
  pcBootstrap('monthend.html', '月末経理');
  document.getElementById('f-month').value = new Date().toISOString().slice(0, 7);
  document.getElementById('f-month').addEventListener('change', load);
  document.getElementById('btn-reload').addEventListener('click', load);
  document.getElementById('btn-confirm').addEventListener('click', () => {
    console.log('TODO: 確定処理・実装は指示書Cで完成する');
  });
  load();
});

function load() {
  console.log('TODO: 月末経理データ取得・実装は指示書Bで完成する');
}
