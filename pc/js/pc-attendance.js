/* ==========================================
   PC版 出勤管理画面 (pc-attendance.js)
   A-2-Y: ゾーンC給与テーブル横並び再構築
   A-2-X-5: projectId付き稼働を給与計算から除外
   A-2-X-6: 給与確定時スポットコスト突合・3択UI
   ========================================== */
'use strict';

(function () {

  /* ---------- 定数・ラベル ---------- */
  const EMPLOYMENT_LABELS = {
    employed_full: '常勤雇用',
    employed_part: '臨時バイト',
    employed: '常勤雇用',
    contractor: '委託・外注'
  };
  const WH_LABELS = { off: '対象外', standard: '一般報酬', hostess: 'ホステス特例' };
  const PAY_TYPE_OPTIONS = [
    { value: 'hourly', label: '時給' },
    { value: 'daily', label: '日給' },
    { value: 'monthly', label: '月給' }
  ];
  const WH_OPTIONS = [
    { value: 'off', label: '対象外' },
    { value: 'standard', label: '一般' },
    { value: 'hostess', label: 'ホステス' }
  ];
  const PAYROLL_CODES = ['20', '21', '25'];

  /* ---------- 状態 ---------- */
  let _staffList = [];
  let _attendanceRecords = [];
  let _costRows = [];
  let _currentMonth = _todayMonth();
  let _selectedStaffId = null;
  let _confirmedStaffIds = new Set();

  // 給与テーブル：スタッフごとの計算状態を保持
  // { staffId: { payType, unitPrice, hours, days, gross, whMode, whAmount, net, spotTotal, excludedProject, status } }
  let _payrollState = {};
  let _confirmTarget = null; // 確定ダイアログ対象 { staffId } or { bulk: true, staffIds: [] }

  /* ---------- 初期化 ---------- */
  document.addEventListener('DOMContentLoaded', async () => {
    if (typeof pcBootstrap === 'function') pcBootstrap('attendance.html', '出勤管理');
    _bindMonthNav();
    _bindFilter();
    _bindConfirmDialog();
    _bindBulkConfirm();
    _bindMemoSave();
    await _loadAll();
  });

  async function _loadAll() {
    try {
      const settings = await _callGAS('getSettings');
      _staffList = (settings.staffList || []).map(_normalizeStaff);
      const fv = settings.featureVisibility || {};
      const tmplId = settings.templateId || 'general-shop';
      const showPayroll = _resolveFeature(fv, tmplId, 'payroll_section');
      if (!showPayroll) {
        document.getElementById('zoneC').classList.add('att-zone-c--hidden');
        document.getElementById('attUpper').classList.add('att-upper--full');
      }
      _renderStaffList();
      await _loadMonth();
    } catch (e) {
      console.error('init error:', e);
    }
  }

  async function _loadMonth() {
    try {
      const [attRes, histRes] = await Promise.all([
        _callGAS('getAttendanceByMonth', { month: _currentMonth }),
        _callGAS('getHistory', { month: _currentMonth })
      ]);
      _attendanceRecords = Array.isArray(attRes) ? attRes : (attRes.records || attRes.data || []);
      const histArr = Array.isArray(histRes) ? histRes : (histRes.data || []);
      _costRows = histArr.filter(r => r.type === 'cost');
    } catch (e) {
      console.error('loadMonth error:', e);
      _attendanceRecords = [];
      _costRows = [];
    }
    _renderMatrix();
    _buildPayrollState();
    _renderPayrollTable();
    _updateMonthLabel();
  }

  /* ==========================================
     ゾーンA：スタッフ一覧
     ========================================== */
  function _renderStaffList() {
    const container = document.getElementById('staffList');
    const filter = document.getElementById('staffFilter').value;
    const filtered = _getFilteredStaff(filter);

    container.innerHTML = filtered.map(s => {
      const et = _normalizeEmploymentType(s.employmentType);
      const etLabel = EMPLOYMENT_LABELS[et] || et;
      const payBadge = _getPayBadge(s);
      const isActive = s.id === _selectedStaffId;
      const isConfirmed = _confirmedStaffIds.has(s.id);
      return `<div class="att-staff-card${isActive ? ' att-staff-card--active' : ''}${isConfirmed ? ' att-staff-card--confirmed' : ''}"
                   data-staff-id="${_escHtml(s.id)}">
        <div class="att-staff-card__info">
          <div class="att-staff-card__name">${_escHtml(s.name)}</div>
          <div class="att-staff-card__meta">
            <span>${etLabel}</span>
            ${payBadge ? `<span class="att-staff-card__badge ${payBadge.cls}">${payBadge.label}</span>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');

    container.querySelectorAll('.att-staff-card').forEach(el => {
      el.addEventListener('click', () => _onStaffSelect(el.dataset.staffId));
    });
  }

  function _getPayBadge(s) {
    if (s.hourlyWage) return { label: '時給', cls: 'att-staff-card__badge--hourly' };
    if (s.dailyWage) return { label: '日給', cls: 'att-staff-card__badge--daily' };
    if (s.monthlyWage) return { label: '月給', cls: 'att-staff-card__badge--monthly' };
    return null;
  }

  function _onStaffSelect(staffId) {
    _selectedStaffId = staffId;
    _renderStaffList();
    _renderMatrix();
    _showMemoBar(staffId);
  }

  function _showMemoBar(staffId) {
    const bar = document.getElementById('memoBar');
    const staff = _staffList.find(s => s.id === staffId);
    if (!staff) { bar.style.display = 'none'; return; }
    document.getElementById('memoLabel').textContent = staff.name + ' 経営メモ';
    document.getElementById('memoInput').value = staff.managerMemo || '';
    bar.style.display = '';
  }

  function _bindMemoSave() {
    document.getElementById('memoSave').addEventListener('click', async () => {
      const staff = _staffList.find(s => s.id === _selectedStaffId);
      if (!staff) return;
      const memo = document.getElementById('memoInput').value;
      staff.managerMemo = memo;
      try {
        await _callGAS('saveStaffList', { staffList: _staffList });
        alert(staff.name + ' のメモを保存しました。');
      } catch (e) {
        alert('保存に失敗しました。');
      }
    });
  }

  /* ==========================================
     ゾーンB：出勤マトリクス（既存ロジック維持）
     ========================================== */
  function _buildCostAmountMap() {
    const map = {};
    (_costRows || []).forEach(r => {
      if (!PAYROLL_CODES.includes(String(r.itemCode || ''))) return;
      const misc = String(r.miscItemName || '');
      const staffName = misc.replace(/^\[スポット\]/, '').replace(/^\[月次\]/, '').trim();
      if (!staffName) return;
      const key = r.date + '|' + staffName;
      map[key] = (map[key] || 0) + (Number(r.amount) || 0);
    });
    return map;
  }

  function _fmtAmountShort(amount) {
    if (amount >= 10000) return '¥' + (amount / 10000).toFixed(amount % 10000 === 0 ? 0 : 1) + '万';
    if (amount >= 1000) return '¥' + (amount / 1000).toFixed(amount % 1000 === 0 ? 0 : 1) + '千';
    return '¥' + amount.toLocaleString();
  }

  function _renderMatrix() {
    const filter = document.getElementById('staffFilter').value;
    const staffFiltered = _getFilteredStaff(filter);
    const daysInMonth = _getDaysInMonth(_currentMonth);
    const thead = document.getElementById('matrixHead');
    const tbody = document.getElementById('matrixBody');
    const tfoot = document.getElementById('matrixFoot');
    const costAmountMap = _buildCostAmountMap();

    let headHtml = '<tr><th class="att-th-name">スタッフ</th>';
    for (let d = 1; d <= daysInMonth; d++) headHtml += `<th>${d}</th>`;
    headHtml += '<th class="att-th-total">合計H</th><th class="att-th-total">日数</th></tr>';
    thead.innerHTML = headHtml;

    let totalHours = 0, totalDays = 0;
    tbody.innerHTML = staffFiltered.map(s => {
      const staffRecords = _attendanceRecords.filter(r => r.staffId === s.id);
      let staffHours = 0, staffDays = 0;
      const dayCells = [];

      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = _currentMonth + '-' + String(d).padStart(2, '0');
        const dayRecs = staffRecords.filter(r => r.date === dateStr);

        if (dayRecs.length === 0) {
          dayCells.push(`<td class="att-day-cell" data-staff="${_escHtml(s.id)}" data-date="${dateStr}"></td>`);
        } else {
          const clockRecs = dayRecs.filter(r => r.clockIn);
          const moneyRecs = dayRecs.filter(r => !r.clockIn);
          let cellParts = [];
          let hasProject = false;

          clockRecs.forEach(r => {
            const isPending = !r.clockOut;
            const timeStr = r.clockIn + '〜' + (r.clockOut || '');
            const hours = _calcHours(r.clockIn, r.clockOut, r.date, r.clockOutDate);
            if (!isPending && hours > 0) staffHours += hours;
            if (r.projectId) hasProject = true;
            cellParts.push(`<div class="${isPending ? 'att-pending-line' : ''}">${_escHtml(timeStr)}</div>`);
          });

          moneyRecs.forEach(r => {
            if (r.projectId) hasProject = true;
            const costKey = dateStr + '|' + (r.staffName || s.name);
            const amount = costAmountMap[costKey] || 0;
            const display = amount > 0 ? '★ ' + _fmtAmountShort(amount) : '★';
            cellParts.push(`<div class="att-money-line">${display}</div>`);
          });

          if (clockRecs.length > 0) staffDays++;

          const hasPending = clockRecs.some(r => !r.clockOut);
          const hasMoneyOnly = clockRecs.length === 0 && moneyRecs.length > 0;
          let cellClass = 'att-day-cell';
          if (dayRecs.length > 0) cellClass += ' att-day-cell--active';
          if (hasPending) cellClass += ' att-day-cell--pending';
          if (hasMoneyOnly) cellClass += ' att-day-cell--money-only';
          if (hasProject) cellClass += ' att-day-cell--project';

          dayCells.push(`<td class="${cellClass}" data-staff="${_escHtml(s.id)}" data-date="${dateStr}">${cellParts.join('')}</td>`);
        }
      }

      totalHours += staffHours;
      totalDays += staffDays;

      const isSelected = s.id === _selectedStaffId;
      return `<tr class="${isSelected ? 'att-row--selected' : ''}">
        <td class="att-td-name">${_escHtml(s.name)}</td>
        ${dayCells.join('')}
        <td class="att-td-total">${staffHours.toFixed(1)}</td>
        <td class="att-td-total">${staffDays}</td>
      </tr>`;
    }).join('');

    tfoot.innerHTML = `<tr>
      <td>合計</td>
      ${Array(daysInMonth).fill('<td></td>').join('')}
      <td>${totalHours.toFixed(1)}</td>
      <td>${totalDays}</td>
    </tr>`;

    tbody.querySelectorAll('.att-day-cell').forEach(td => {
      td.addEventListener('click', e => _openDayCellPopover(e, td.dataset.staff, td.dataset.date));
    });
  }

  /* ==========================================
     ゾーンC：給与テーブル（A-2-Y 新規）
     ========================================== */

  /** 全スタッフの給与計算状態を構築 */
  function _buildPayrollState() {
    const filter = document.getElementById('staffFilter').value;
    const staffFiltered = _getFilteredStaff(filter);
    const newState = {};

    staffFiltered.forEach(s => {
      const prev = _payrollState[s.id] || {};
      const staffAtt = _attendanceRecords.filter(r => r.staffId === s.id);
      const { totalHours, totalDays, excludedProject } = _calcStaffTotals(staffAtt);

      // デフォルト算出方式
      let payType = prev.payType || (s.hourlyWage ? 'hourly' : s.dailyWage ? 'daily' : s.monthlyWage ? 'monthly' : 'hourly');
      const unitPrice = prev.unitPrice !== undefined ? prev.unitPrice :
        (payType === 'hourly' ? (s.hourlyWage || 0) : payType === 'daily' ? (s.dailyWage || 0) : (s.monthlyWage || 0));
      const hours = prev.hours !== undefined ? prev.hours : totalHours;
      const days = prev.days !== undefined ? prev.days : totalDays;

      // 算出金額
      let gross;
      if (prev.gross !== undefined) {
        gross = prev.gross;
      } else {
        gross = _calcGross(payType, unitPrice, hours, days);
      }

      // 源泉徴収
      const whMode = prev.whMode || (s.withholdingMode || 'off');
      const whAmount = prev.whAmount !== undefined ? prev.whAmount : _calcWithholdingAmount(whMode, gross, days);
      const net = gross - whAmount;

      // スポットコスト検出
      const spotCosts = _findSpotCosts(s.name);
      const spotTotal = spotCosts.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

      // 確定状態（月次一括が既に存在するか）
      const hasMonthly = _hasMonthlyConfirmed(s.name);
      const status = prev.status || (hasMonthly ? 'confirmed' : 'pending');

      newState[s.id] = {
        payType, unitPrice, hours, days, gross, whMode, whAmount, net,
        spotTotal, spotCosts, excludedProject, status,
        autoHours: totalHours, autoDays: totalDays
      };
    });

    _payrollState = newState;
  }

  /** 給与テーブルをレンダリング */
  function _renderPayrollTable() {
    const filter = document.getElementById('staffFilter').value;
    const staffFiltered = _getFilteredStaff(filter);
    const thead = document.getElementById('payrollHead');
    const tbody = document.getElementById('payrollBody');
    const tfoot = document.getElementById('payrollFoot');

    if (staffFiltered.length === 0) {
      thead.innerHTML = '';
      tbody.innerHTML = '<tr><td style="padding:20px;color:var(--uz-text-muted);">スタッフなし</td></tr>';
      tfoot.innerHTML = '';
      return;
    }

    // ヘッダー：項目ラベル列 + スタッフ列
    thead.innerHTML = '<tr><th class="att-pt-label"></th>' +
      staffFiltered.map(s => {
        const et = _normalizeEmploymentType(s.employmentType);
        const etLabel = EMPLOYMENT_LABELS[et] || et;
        return `<th>${_escHtml(s.name)}<br><span style="font-weight:400;font-size:10px;color:var(--uz-text-muted)">${etLabel}</span></th>`;
      }).join('') +
      '<th style="min-width:80px;">合計</th></tr>';

    // 行の定義
    const rows = [
      { key: 'payType', label: '算出方式' },
      { key: 'unitPrice', label: '単価' },
      { key: 'hours', label: '実労働時間' },
      { key: 'days', label: '出勤日数' },
      { key: 'excludeNote', label: '' },
      { key: 'gross', label: '算出金額' },
      { key: 'spotTotal', label: 'スポット既計上' },
      { key: 'whMode', label: '源泉区分' },
      { key: 'whAmount', label: '源泉徴収額' },
      { key: 'net', label: '差引支給額' },
      { key: 'costTarget', label: '科目' },
      { key: 'status', label: 'ステータス' },
      { key: 'action', label: '' }
    ];

    let bodyHtml = '';
    let sumGross = 0, sumSpot = 0, sumWh = 0, sumNet = 0;

    rows.forEach(row => {
      bodyHtml += '<tr>';
      bodyHtml += `<td class="att-pt-label">${row.label}</td>`;

      staffFiltered.forEach(s => {
        const st = _payrollState[s.id] || {};
        const sid = _escHtml(s.id);

        switch (row.key) {
          case 'payType':
            bodyHtml += `<td class="att-pt-val">
              <select class="att-pt-select" data-staff="${sid}" data-field="payType">
                ${PAY_TYPE_OPTIONS.map(o => `<option value="${o.value}"${st.payType === o.value ? ' selected' : ''}>${o.label}</option>`).join('')}
              </select></td>`;
            break;
          case 'unitPrice':
            bodyHtml += `<td class="att-pt-val att-pt-val--editable" data-staff="${sid}" data-field="unitPrice">${_fmtNum(st.unitPrice)}</td>`;
            break;
          case 'hours':
            bodyHtml += `<td class="att-pt-val att-pt-val--editable" data-staff="${sid}" data-field="hours">${(st.hours || 0).toFixed(1)}</td>`;
            break;
          case 'days':
            bodyHtml += `<td class="att-pt-val att-pt-val--editable" data-staff="${sid}" data-field="days">${st.days || 0}</td>`;
            break;
          case 'excludeNote':
            bodyHtml += `<td class="att-pt-val">${st.excludedProject > 0 ? `<span class="att-pt-exclude-note">※${st.excludedProject}件 案件除外</span>` : ''}</td>`;
            break;
          case 'gross':
            bodyHtml += `<td class="att-pt-val att-pt-val--gross att-pt-val--editable" data-staff="${sid}" data-field="gross">${_fmtYen(st.gross)}</td>`;
            break;
          case 'spotTotal':
            bodyHtml += `<td class="att-pt-val att-pt-val--spot">${st.spotTotal > 0 ? _fmtYen(st.spotTotal) : '—'}</td>`;
            break;
          case 'whMode':
            bodyHtml += `<td class="att-pt-val">
              <select class="att-pt-wh-select" data-staff="${sid}" data-field="whMode">
                ${WH_OPTIONS.map(o => `<option value="${o.value}"${st.whMode === o.value ? ' selected' : ''}>${o.label}</option>`).join('')}
              </select></td>`;
            break;
          case 'whAmount':
            bodyHtml += `<td class="att-pt-val att-pt-val--editable" data-staff="${sid}" data-field="whAmount">${_fmtYen(st.whAmount)}</td>`;
            break;
          case 'net':
            bodyHtml += `<td class="att-pt-val att-pt-val--net">${_fmtYen(st.net)}</td>`;
            break;
          case 'costTarget': {
            const et = _normalizeEmploymentType(s.employmentType);
            let label;
            if (et === 'contractor') {
              label = (s.costCategory === '25') ? '税理士等の報酬(25)' : '外注工賃(21)';
            } else {
              label = '給料賃金(20)';
            }
            bodyHtml += `<td class="att-pt-val" style="font-size:10px;color:var(--uz-text-muted)">${label}</td>`;
            break;
          }
          case 'status':
            bodyHtml += `<td class="att-pt-status">${_renderStatusBadge(st.status)}</td>`;
            break;
          case 'action':
            bodyHtml += `<td class="att-pt-confirm-cell">
              <button class="att-pt-confirm-btn" data-staff="${sid}"${st.status === 'confirmed' ? ' disabled' : ''}>
                ${st.status === 'confirmed' ? '確定済' : '確定'}
              </button></td>`;
            break;
        }
      });

      // 合計列
      if (row.key === 'gross') {
        staffFiltered.forEach(s => { sumGross += (_payrollState[s.id] || {}).gross || 0; });
        bodyHtml += `<td class="att-pt-val att-pt-val--gross">${_fmtYen(sumGross)}</td>`;
      } else if (row.key === 'spotTotal') {
        staffFiltered.forEach(s => { sumSpot += (_payrollState[s.id] || {}).spotTotal || 0; });
        bodyHtml += `<td class="att-pt-val att-pt-val--spot">${sumSpot > 0 ? _fmtYen(sumSpot) : '—'}</td>`;
      } else if (row.key === 'whAmount') {
        staffFiltered.forEach(s => { sumWh += (_payrollState[s.id] || {}).whAmount || 0; });
        bodyHtml += `<td class="att-pt-val">${_fmtYen(sumWh)}</td>`;
      } else if (row.key === 'net') {
        staffFiltered.forEach(s => { sumNet += (_payrollState[s.id] || {}).net || 0; });
        bodyHtml += `<td class="att-pt-val att-pt-val--net">${_fmtYen(sumNet)}</td>`;
      } else {
        bodyHtml += '<td></td>';
      }

      bodyHtml += '</tr>';
    });

    tbody.innerHTML = bodyHtml;
    tfoot.innerHTML = '';

    // イベントバインド
    _bindPayrollTableEvents();
  }

  function _bindPayrollTableEvents() {
    // セレクト変更
    document.querySelectorAll('.att-pt-select, .att-pt-wh-select').forEach(sel => {
      sel.addEventListener('change', e => {
        const sid = e.target.dataset.staff;
        const field = e.target.dataset.field;
        const st = _payrollState[sid];
        if (!st) return;
        st[field] = e.target.value;
        if (field === 'payType') {
          const staff = _staffList.find(s => s.id === sid);
          if (staff) {
            st.unitPrice = e.target.value === 'hourly' ? (staff.hourlyWage || 0)
              : e.target.value === 'daily' ? (staff.dailyWage || 0)
              : (staff.monthlyWage || 0);
          }
          st.gross = _calcGross(st.payType, st.unitPrice, st.hours, st.days);
        }
        if (field === 'whMode') {
          st.whAmount = _calcWithholdingAmount(st.whMode, st.gross, st.days);
        }
        st.net = st.gross - st.whAmount;
        _renderPayrollTable();
      });
    });

    // 編集可能セルクリック→インライン入力
    document.querySelectorAll('.att-pt-val--editable').forEach(td => {
      td.addEventListener('click', e => _startInlineEdit(td));
    });

    // 個別確定ボタン
    document.querySelectorAll('.att-pt-confirm-btn').forEach(btn => {
      btn.addEventListener('click', () => _onConfirmSingle(btn.dataset.staff));
    });
  }

  /** インライン編集 */
  function _startInlineEdit(td) {
    if (td.querySelector('.att-pt-input')) return;
    const sid = td.dataset.staff;
    const field = td.dataset.field;
    const st = _payrollState[sid];
    if (!st) return;

    const currentVal = st[field] || 0;
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'att-pt-input';
    input.value = field === 'hours' ? currentVal.toFixed(1) : currentVal;
    if (field === 'hours') input.step = '0.5';

    td.textContent = '';
    td.appendChild(input);
    input.focus();
    input.select();

    const finish = () => {
      const val = Number(input.value) || 0;
      st[field] = val;
      // 依存再計算
      if (['unitPrice', 'hours', 'days'].includes(field)) {
        st.gross = _calcGross(st.payType, st.unitPrice, st.hours, st.days);
        st.whAmount = _calcWithholdingAmount(st.whMode, st.gross, st.days);
      }
      if (field === 'gross') {
        st.whAmount = _calcWithholdingAmount(st.whMode, st.gross, st.days);
      }
      if (field === 'whAmount') {
        // 手動上書き — そのまま
      }
      st.net = st.gross - st.whAmount;
      _renderPayrollTable();
    };

    input.addEventListener('blur', finish);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { input.blur(); }
      if (e.key === 'Escape') {
        st[field] = currentVal;
        _renderPayrollTable();
      }
    });
  }

  /* ---------- 確定処理 ---------- */
  function _onConfirmSingle(staffId) {
    const staff = _staffList.find(s => s.id === staffId);
    const st = _payrollState[staffId];
    if (!staff || !st) return;

    if (st.gross === 0) {
      alert('算出金額が0円です。');
      return;
    }

    _confirmTarget = { staffId };
    _showConfirmDialog(staff, st);
  }

  function _showConfirmDialog(staff, st) {
    const et = _normalizeEmploymentType(staff.employmentType);
    const whLabel = WH_LABELS[st.whMode] || '対象外';
    let costItemCode, costItemName;
    if (et === 'contractor') {
      const cat = (staff.costCategory === '25') ? '25' : '21';
      costItemCode = cat;
      costItemName = (cat === '25') ? '税理士等の報酬' : '外注工賃';
    } else {
      costItemCode = '20';
      costItemName = '給料賃金';
    }

    document.getElementById('confirmTitle').textContent = staff.name + ' 給与確定';
    document.getElementById('confirmBody').innerHTML = `
      <div>算出金額：${st.gross.toLocaleString()}円</div>
      <div>源泉徴収額：${st.whAmount.toLocaleString()}円（${whLabel}）</div>
      <div>差引支給額：${st.net.toLocaleString()}円</div>
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.1);font-size:11px;">
        コスト追記：<strong>${costItemName}（科目${costItemCode}）</strong>
      </div>`;

    // スポットコスト突合
    const spotCosts = st.spotCosts || [];
    const spotSection = document.getElementById('confirmSpotSection');
    const choicesSection = document.getElementById('confirmChoices');

    if (spotCosts.length > 0) {
      const spotTotal = st.spotTotal;
      const diff = st.gross - spotTotal;

      document.getElementById('confirmSpotList').innerHTML = spotCosts.map(r => {
        const dateShort = (r.date || '').substring(5);
        const itemLabel = String(r.itemName || r.itemCode || '');
        return `<div class="att-confirm-spot-row">
          <span class="att-confirm-spot-row__date">${_escHtml(dateShort)}</span>
          <span class="att-confirm-spot-row__name">${_escHtml(itemLabel)}</span>
          <span class="att-confirm-spot-row__amount">${(Number(r.amount) || 0).toLocaleString()}円</span>
        </div>`;
      }).join('');
      document.getElementById('confirmSpotTotal').textContent = 'スポット合計：' + spotTotal.toLocaleString() + '円';

      if (diff > 0) {
        document.getElementById('confirmDiffDesc').textContent =
          '算出' + st.gross.toLocaleString() + '円 − スポット' + spotTotal.toLocaleString() + '円 ＝ 不足分 ' + diff.toLocaleString() + '円を月次一括として確定';
      } else {
        document.getElementById('confirmDiffDesc').textContent =
          'スポット合計が算出金額以上のため、不足分は0円（確定金額0円）';
      }

      const defaultMode = diff > 0 ? 'diff' : 'skip';
      const radio = document.querySelector(`input[name="confirmMode"][value="${defaultMode}"]`);
      if (radio) radio.checked = true;

      spotSection.style.display = '';
      choicesSection.style.display = '';
    } else {
      spotSection.style.display = 'none';
      choicesSection.style.display = 'none';
    }

    document.getElementById('confirmDialog').style.display = '';
  }

  async function _executeConfirm() {
    document.getElementById('confirmDialog').style.display = 'none';

    if (_confirmTarget && _confirmTarget.staffId) {
      await _executeSingleConfirm(_confirmTarget.staffId);
    } else if (_confirmTarget && _confirmTarget.bulk) {
      for (const sid of _confirmTarget.staffIds) {
        await _executeSingleConfirm(sid);
      }
    }
    _confirmTarget = null;
    await _loadMonth();
  }

  async function _executeSingleConfirm(staffId) {
    const staff = _staffList.find(s => s.id === staffId);
    const st = _payrollState[staffId];
    if (!staff || !st) return;

    const et = _normalizeEmploymentType(staff.employmentType);
    const isContractor = et === 'contractor';
    let itemCode, itemName;
    if (isContractor) {
      const cat = (staff.costCategory === '25') ? '25' : '21';
      itemCode = cat;
      itemName = (cat === '25') ? '税理士等の報酬' : '外注工賃';
    } else {
      itemCode = '20';
      itemName = '給料賃金';
    }

    // 確定モード判定
    const spotCosts = st.spotCosts || [];
    const hasSpot = spotCosts.length > 0;
    const confirmMode = hasSpot
      ? (document.querySelector('input[name="confirmMode"]:checked')?.value || 'full')
      : 'full';

    if (confirmMode === 'skip') {
      st.status = 'skipped';
      return;
    }

    let confirmAmount = st.gross;
    let confirmWh = st.whAmount;

    if (confirmMode === 'diff' && hasSpot) {
      confirmAmount = Math.max(0, st.gross - st.spotTotal);
      confirmWh = _calcWithholdingAmount(st.whMode, confirmAmount, st.days);
    }

    if (confirmAmount === 0 && confirmMode === 'diff') {
      st.status = 'skipped';
      return;
    }

    const [y, m] = _currentMonth.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const costDate = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const costData = {
      date: costDate,
      divisionCode: '2',
      divisionName: '販管費',
      itemCode: itemCode,
      itemName: itemName,
      miscItemName: '',
      taxRate: isContractor ? 10 : 0,
      taxIncluded: confirmAmount,
      memo: `${staff.name}　${y}年${m}月分`,
      unpaid: 0,
      withholdingAmount: confirmWh,
      clientId: '',
      projectId: '',
      staffId: staff.id,
      staffName: staff.name,
      subType: '20a'
    };

    try {
      await _callGAS('addCost', costData);

      // メモ保存
      const memo = document.getElementById('memoInput');
      if (_selectedStaffId === staffId && memo && memo.value !== (staff.managerMemo || '')) {
        staff.managerMemo = memo.value;
        await _callGAS('saveStaffList', { staffList: _staffList });
      }

      st.status = 'confirmed';
      _confirmedStaffIds.add(staffId);
      _renderStaffList();
    } catch (e) {
      console.error('confirm error:', e);
      alert(staff.name + ' の確定処理でエラーが発生しました。');
    }
  }

  /* ---------- 一括確定 ---------- */
  function _bindBulkConfirm() {
    document.getElementById('bulkConfirmBtn').addEventListener('click', _onBulkConfirm);
  }

  function _onBulkConfirm() {
    const pending = [];
    Object.entries(_payrollState).forEach(([sid, st]) => {
      if (st.status === 'pending' && st.gross > 0) pending.push(sid);
    });

    if (pending.length === 0) {
      alert('確定可能なスタッフがいません。');
      return;
    }

    const names = pending.map(sid => {
      const s = _staffList.find(x => x.id === sid);
      return s ? s.name : sid;
    });

    // 一括時はスポットありスタッフは diff 推奨をデフォルトとする
    _confirmTarget = { bulk: true, staffIds: pending };

    document.getElementById('confirmTitle').textContent = '一括給与確定';
    document.getElementById('confirmBody').innerHTML = `
      <div>対象スタッフ：${names.join('、')}</div>
      <div style="margin-top:8px;">各スタッフの算出金額で一括確定します。</div>
      <div style="margin-top:4px;font-size:11px;color:var(--uz-text-muted);">
        スポット既計上ありのスタッフは「不足分のみ確定」が適用されます。
      </div>`;

    document.getElementById('confirmSpotSection').style.display = 'none';
    document.getElementById('confirmChoices').style.display = 'none';

    // 一括時は「diff」をデフォルトにセット
    const radio = document.querySelector('input[name="confirmMode"][value="diff"]');
    if (radio) radio.checked = true;

    document.getElementById('confirmDialog').style.display = '';
  }

  /* ---------- ダイアログバインド ---------- */
  function _bindConfirmDialog() {
    document.getElementById('confirmCancel').addEventListener('click', () => {
      document.getElementById('confirmDialog').style.display = 'none';
      _confirmTarget = null;
    });
    document.getElementById('confirmOk').addEventListener('click', _executeConfirm);
  }

  /* ---------- スポットコスト検出 ---------- */
  function _findSpotCosts(staffName) {
    return (_costRows || []).filter(r => {
      if (!PAYROLL_CODES.includes(String(r.itemCode || ''))) return false;
      const misc = String(r.miscItemName || '');
      if (!misc.startsWith('[スポット]')) return false;
      const name = misc.replace(/^\[スポット\]/, '').trim();
      if (name !== staffName) return false;
      const linked = String(r.projectId || r.linkedSalesRowId || '');
      if (linked) return false;
      return true;
    });
  }

  /** 月次一括が既に確定済みかチェック */
  function _hasMonthlyConfirmed(staffName) {
    return (_costRows || []).some(r => {
      if (!PAYROLL_CODES.includes(String(r.itemCode || ''))) return false;
      const misc = String(r.miscItemName || '');
      return misc.startsWith('[月次]') && misc.replace(/^\[月次\]/, '').trim() === staffName;
    });
  }

  /* ==========================================
     ポップオーバー（日別セル編集）
     ========================================== */
  let _popoverTarget = null;

  function _openDayCellPopover(event, staffId, date) {
    const pop = document.getElementById('dayCellPopover');
    const staff = _staffList.find(s => s.id === staffId);
    const records = _attendanceRecords.filter(r => r.staffId === staffId && r.date === date);

    document.getElementById('popoverHeader').textContent =
      `${staff ? staff.name : staffId}　${date.substring(5).replace('-', '/')}`;

    const rec = records[0] || {};
    document.getElementById('popClockIn').value = rec.clockIn || '';
    document.getElementById('popClockOut').value = rec.clockOut || '';
    document.getElementById('popMemo').value = rec.memo || '';

    _popoverTarget = { staffId, date, rowIndex: rec.rowIndex };

    const rect = event.currentTarget.getBoundingClientRect();
    pop.style.top = Math.min(rect.bottom + 4, window.innerHeight - 300) + 'px';
    pop.style.left = Math.min(rect.left, window.innerWidth - 260) + 'px';
    pop.style.display = '';

    document.getElementById('popCancel').onclick = () => pop.style.display = 'none';
    document.getElementById('popSave').onclick = () => _saveDayCell(pop);
  }

  async function _saveDayCell(pop) {
    if (!_popoverTarget) return;
    const clockIn = document.getElementById('popClockIn').value;
    const clockOut = document.getElementById('popClockOut').value;
    const memo = document.getElementById('popMemo').value;

    try {
      await _callGAS('updateAttendance', {
        rowIndex: _popoverTarget.rowIndex,
        staffId: _popoverTarget.staffId,
        date: _popoverTarget.date,
        clockIn, clockOut, memo
      });
      pop.style.display = 'none';
      await _loadMonth();
    } catch (e) {
      console.error('save day cell error:', e);
      alert('保存に失敗しました。');
    }
  }

  document.addEventListener('click', e => {
    const pop = document.getElementById('dayCellPopover');
    if (pop.style.display !== 'none' && !pop.contains(e.target) && !e.target.closest('.att-day-cell')) {
      pop.style.display = 'none';
    }
  });

  /* ==========================================
     イベントバインド
     ========================================== */
  function _bindMonthNav() {
    document.getElementById('prevMonth').addEventListener('click', () => {
      _currentMonth = _shiftMonth(_currentMonth, -1);
      _payrollState = {};
      _confirmedStaffIds.clear();
      _loadMonth();
    });
    document.getElementById('nextMonth').addEventListener('click', () => {
      _currentMonth = _shiftMonth(_currentMonth, 1);
      _payrollState = {};
      _confirmedStaffIds.clear();
      _loadMonth();
    });
  }

  function _bindFilter() {
    document.getElementById('staffFilter').addEventListener('change', () => {
      _renderStaffList();
      _renderMatrix();
      _buildPayrollState();
      _renderPayrollTable();
    });
  }

  /* ==========================================
     ユーティリティ
     ========================================== */
  function _getFilteredStaff(filter) {
    return filter === 'all'
      ? _staffList
      : _staffList.filter(s => _normalizeEmploymentType(s.employmentType) === filter);
  }

  function _normalizeStaff(s) {
    return {
      ...s,
      employmentType: _normalizeEmploymentType(s.employmentType),
      withholdingMode: s.withholdingMode || 'off',
      costCategory: (s.costCategory === '25') ? '25' : '21',
      hourlyWage: Number(s.hourlyWage) || 0,
      dailyWage: Number(s.dailyWage) || 0,
      monthlyWage: Number(s.monthlyWage) || 0,
      managerMemo: s.managerMemo || ''
    };
  }

  function _normalizeEmploymentType(et) {
    if (et === 'employed') return 'employed_full';
    return et || 'employed_full';
  }

  function _calcHours(clockIn, clockOut, dateIn, dateOut) {
    if (!clockIn || !clockOut) return 0;
    const [h1, m1] = clockIn.split(':').map(Number);
    const [h2, m2] = clockOut.split(':').map(Number);
    let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (dateOut && dateOut !== dateIn) mins += 24 * 60;
    else if (mins < 0) mins += 24 * 60;
    return Math.max(0, mins / 60);
  }

  function _calcStaffTotals(records) {
    let totalHours = 0;
    const uniqueDates = new Set();
    let excludedProject = 0;

    records.forEach(r => {
      if (r.projectId) { excludedProject++; return; }
      if (r.clockIn && r.clockOut) {
        totalHours += _calcHours(r.clockIn, r.clockOut, r.date, r.clockOutDate);
      }
      if (r.clockIn) uniqueDates.add(r.date);
    });
    return {
      totalHours: Math.round(totalHours * 10) / 10,
      totalDays: uniqueDates.size,
      excludedProject
    };
  }

  function _calcGross(payType, unitPrice, hours, days) {
    if (payType === 'hourly') return Math.floor(unitPrice * hours);
    if (payType === 'daily') return Math.floor(unitPrice * days);
    return unitPrice; // monthly
  }

  function _calcWithholdingAmount(whMode, amount, days) {
    if (whMode === 'hostess') {
      const base = amount - 5000 * days;
      return base > 0 ? Math.floor(base * 0.1021) : 0;
    } else if (whMode === 'standard') {
      if (amount <= 1000000) return Math.floor(amount * 0.1021);
      return Math.floor(1000000 * 0.1021 + (amount - 1000000) * 0.2042);
    }
    return 0;
  }

  function _renderStatusBadge(status) {
    if (status === 'confirmed') return '<span class="att-pt-status-badge att-pt-status-badge--confirmed">確定済</span>';
    if (status === 'skipped') return '<span class="att-pt-status-badge att-pt-status-badge--skipped">スキップ</span>';
    return '<span class="att-pt-status-badge att-pt-status-badge--pending">未確定</span>';
  }

  function _fmtNum(n) { return (n || 0).toLocaleString(); }
  function _fmtYen(n) { return (n || 0).toLocaleString() + '円'; }

  function _getDaysInMonth(monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }

  function _todayMonth() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function _shiftMonth(monthStr, delta) {
    const [y, m] = monthStr.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function _updateMonthLabel() {
    const [y, m] = _currentMonth.split('-').map(Number);
    document.getElementById('monthLabel').textContent = `${y}年${m}月`;
  }

  function _resolveFeature(fv, tmplId, key) {
    if (fv && fv[key] !== undefined) return fv[key];
    if (key === 'payroll_section' || key === 'attendance_menu') return tmplId !== 'non-shop';
    return true;
  }

  function _escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  async function _callGAS(action, data) {
    if (typeof callGAS === 'function') {
      const res = await callGAS(action, data || {});
      if (res && res.status === 'ok' && res.data !== undefined) return res.data;
      return res;
    }
    const gasUrl = window.GAS_URL || '';
    if (!gasUrl) throw new Error('GAS_URL not set');
    const url = gasUrl + '?action=' + action + '&data=' + encodeURIComponent(JSON.stringify(data || {}));
    const resp = await fetch(url);
    const json = await resp.json();
    if (json.status !== 'ok') throw new Error(json.message || 'GAS error');
    return json.data || json;
  }

})();
