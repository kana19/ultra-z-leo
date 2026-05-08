/* ==========================================
   PC版 出勤管理画面 (pc-attendance.js)
   指示書16 準拠
   A-2-X-5: projectId付き稼働を給与計算から除外＋注釈表示
   A-2-X-6: 給与確定時スポットコスト突合・3択UI
   ========================================== */
'use strict';

(function () {

  /* ---------- 定数・状態 ---------- */
  const EMPLOYMENT_LABELS = {
    employed_full: '常勤雇用',
    employed_part: '臨時バイト',
    employed: '常勤雇用',
    contractor: '委託・外注'
  };
  const WH_LABELS = { off: '対象外', standard: '一般報酬', hostess: 'ホステス特例' };
  const PAY_TYPE_LABELS = { hourly: '時給', daily: '日給', monthly: '月給・歩合' };

  let _staffList = [];
  let _attendanceRecords = [];
  let _costRows = [];
  let _currentMonth = _todayMonth();
  let _selectedStaffId = null;
  let _confirmedStaffIds = new Set();

  /* ---------- 初期化 ---------- */
  document.addEventListener('DOMContentLoaded', async () => {
    if (typeof pcBootstrap === 'function') pcBootstrap('attendance.html', '出勤管理');
    _bindMonthNav();
    _bindFilter();
    _bindPayTypeChange();
    _bindPayrollInputs();
    _bindConfirmBtn();
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
        document.getElementById('attGrid').classList.add('att-grid--no-payroll');
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
    _updateMonthLabel();
  }

  /* ---------- ゾーンA：スタッフ一覧 ---------- */
  function _renderStaffList() {
    const container = document.getElementById('staffList');
    const filter = document.getElementById('staffFilter').value;
    const filtered = filter === 'all'
      ? _staffList
      : _staffList.filter(s => _normalizeEmploymentType(s.employmentType) === filter);

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
    _loadPayroll(staffId);
  }

  /* ---------- ゾーンB：出勤マトリクス ---------- */
  function _buildCostAmountMap() {
    const PAYROLL_CODES = ['20', '21', '25'];
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
    const staffFiltered = filter === 'all'
      ? _staffList
      : _staffList.filter(s => _normalizeEmploymentType(s.employmentType) === filter);

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

  /* ---------- ゾーンC：給与計算セクション ---------- */
  function _loadPayroll(staffId) {
    const staff = _staffList.find(s => s.id === staffId);
    if (!staff) return;

    document.getElementById('payrollEmpty').style.display = 'none';
    document.getElementById('payrollContent').style.display = '';

    const et = _normalizeEmploymentType(staff.employmentType);
    const whLabel = WH_LABELS[staff.withholdingMode || 'off'] || '対象外';
    document.getElementById('prHeader').innerHTML = `
      <div class="att-pr-header__name">${_escHtml(staff.name)}</div>
      <div class="att-pr-header__meta">${EMPLOYMENT_LABELS[et] || et}　/　${whLabel}</div>
    `;

    let defaultPayType = 'hourly';
    if (staff.hourlyWage) defaultPayType = 'hourly';
    else if (staff.dailyWage) defaultPayType = 'daily';
    else if (staff.monthlyWage) defaultPayType = 'monthly';
    document.querySelector(`input[name="payType"][value="${defaultPayType}"]`).checked = true;

    const staffAttendance = _attendanceRecords.filter(r => r.staffId === staffId);
    const { totalHours, totalDays, excludedProject } = _calcStaffTotals(staffAttendance);

    const unitPrice = defaultPayType === 'hourly' ? (staff.hourlyWage || 0)
                    : defaultPayType === 'daily' ? (staff.dailyWage || 0)
                    : (staff.monthlyWage || 0);

    document.getElementById('prUnitPrice').value = unitPrice || '';
    document.getElementById('prWorkHours').value = totalHours.toFixed(1);
    document.getElementById('prWorkDays').value = totalDays;
    _resetBadge('prHoursBadge');
    _resetBadge('prDaysBadge');

    const noteEl = document.getElementById('prProjectExcludeNote');
    if (noteEl) {
      if (excludedProject > 0) {
        noteEl.textContent = '\u203B 案件直接費として計上済みの ' + excludedProject + ' 件を集計から除外しています';
        noteEl.style.display = '';
      } else {
        noteEl.textContent = '';
        noteEl.style.display = 'none';
      }
    }

    _recalcGross();

    const whMode = staff.withholdingMode || 'off';
    const whRadio = document.querySelector(`input[name="whMode"][value="${whMode}"]`);
    if (whRadio) whRadio.checked = true;

    _updateCostPreview(staff);
    document.getElementById('prMemo').value = staff.managerMemo || '';
  }

  function _updateCostPreview(staff) {
    const previewText = document.getElementById('prCostPreviewText');
    const et = _normalizeEmploymentType(staff.employmentType);
    let code, name;
    if (et === 'contractor') {
      const cat = (staff.costCategory === '25') ? '25' : '21';
      code = cat;
      name = (cat === '25') ? '税理士等の報酬' : '外注工賃';
    } else {
      code = '20';
      name = '給料賃金';
    }
    previewText.textContent = `確定時にコストシートへ「${name}（科目${code}）」を自動追記します`;
  }

  /* ---------- 給与計算ロジック ---------- */
  function _recalcGross() {
    const payType = document.querySelector('input[name="payType"]:checked')?.value || 'hourly';
    const unitPrice = Number(document.getElementById('prUnitPrice').value) || 0;
    const hours = Number(document.getElementById('prWorkHours').value) || 0;
    const days = Number(document.getElementById('prWorkDays').value) || 0;

    let gross = 0;
    if (payType === 'hourly') gross = Math.floor(unitPrice * hours);
    else if (payType === 'daily') gross = Math.floor(unitPrice * days);
    else gross = unitPrice;

    document.getElementById('prGrossAmount').value = gross || '';
    _resetBadge('prGrossBadge');
    _recalcWithholding();
  }

  function _recalcWithholding() {
    const whMode = document.querySelector('input[name="whMode"]:checked')?.value || 'off';
    const gross = Number(document.getElementById('prGrossAmount').value) || 0;
    const days = Number(document.getElementById('prWorkDays').value) || 0;

    let whAmount = 0;
    if (whMode === 'hostess') {
      const base = gross - 5000 * days;
      whAmount = base > 0 ? Math.floor(base * 0.1021) : 0;
    } else if (whMode === 'standard') {
      if (gross <= 1000000) {
        whAmount = Math.floor(gross * 0.1021);
      } else {
        whAmount = Math.floor(1000000 * 0.1021 + (gross - 1000000) * 0.2042);
      }
    }

    document.getElementById('prWhAmount').value = whAmount || '';
    _resetBadge('prWhBadge');
    _recalcNet();
  }

  function _recalcNet() {
    const gross = Number(document.getElementById('prGrossAmount').value) || 0;
    const wh = Number(document.getElementById('prWhAmount').value) || 0;
    document.getElementById('prNetAmount').textContent = (gross - wh).toLocaleString();
  }

  /* ---------- A-2-X-6：スポットコスト検出 ---------- */
  function _findSpotCosts(staffName) {
    const PAYROLL_CODES = ['20', '21', '25'];
    return (_costRows || []).filter(r => {
      if (!PAYROLL_CODES.includes(String(r.itemCode || ''))) return false;
      const misc = String(r.miscItemName || '');
      if (!misc.startsWith('[スポット]')) return false;
      const name = misc.replace(/^\[スポット\]/, '').trim();
      if (name !== staffName) return false;
      // V列（projectId/linkedSalesRowId）が空 = 案件未紐付け
      const linked = String(r.projectId || r.linkedSalesRowId || '');
      if (linked) return false;
      return true;
    });
  }

  /* ---------- 確定処理（A-2-X-6改修） ---------- */
  function _bindConfirmBtn() {
    document.getElementById('prConfirmBtn').addEventListener('click', _onConfirm);
    document.getElementById('confirmCancel').addEventListener('click', () => {
      document.getElementById('confirmDialog').style.display = 'none';
    });
    document.getElementById('confirmOk').addEventListener('click', _executeConfirm);

    document.getElementById('taxAdvisorConfirmBtn')?.addEventListener('click', _onTaxAdvisorConfirm);
  }

  function _onConfirm() {
    const staff = _staffList.find(s => s.id === _selectedStaffId);
    if (!staff) return;

    const gross = Number(document.getElementById('prGrossAmount').value) || 0;
    const wh = Number(document.getElementById('prWhAmount').value) || 0;
    const whMode = document.querySelector('input[name="whMode"]:checked')?.value || 'off';
    const net = gross - wh;

    if (gross === 0) {
      alert('算出金額が0円です。');
      return;
    }

    const et = _normalizeEmploymentType(staff.employmentType);
    let costItemCode, costItemName, taxRate;
    if (et === 'contractor') {
      const cat = (staff.costCategory === '25') ? '25' : '21';
      costItemCode = cat;
      costItemName = (cat === '25') ? '税理士等の報酬' : '外注工賃';
      taxRate = 10;
    } else {
      costItemCode = '20';
      costItemName = '給料賃金';
      taxRate = 0;
    }

    // 基本情報を表示
    document.getElementById('confirmBody').innerHTML = `
      <div>スタッフ：${_escHtml(staff.name)}</div>
      <div>算出金額：${gross.toLocaleString()}円</div>
      <div>源泉徴収額：${wh.toLocaleString()}円（${WH_LABELS[whMode] || whMode}）</div>
      <div>差引支給額：${net.toLocaleString()}円</div>
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.1);font-size:12px;">
        コストシートに追記：<strong>${costItemName}（科目${costItemCode}）</strong>
        ${taxRate > 0 ? `　税率${taxRate}%` : '　不課税'}
      </div>
    `;

    // A-2-X-6：スポットコスト検出・3択UI
    const spotCosts = _findSpotCosts(staff.name);
    const spotSection = document.getElementById('confirmSpotSection');
    const choicesSection = document.getElementById('confirmChoices');
    const confirmOkBtn = document.getElementById('confirmOk');

    if (spotCosts.length > 0) {
      const spotTotal = spotCosts.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
      const diff = gross - spotTotal;

      // スポットコスト一覧
      document.getElementById('confirmSpotList').innerHTML = spotCosts.map(r => {
        const dateShort = (r.date || '').substring(5);
        const itemLabel = String(r.itemName || r.itemCode || '');
        return `<div class="att-confirm-spot-row">
          <span class="att-confirm-spot-row__date">${_escHtml(dateShort)}</span>
          <span class="att-confirm-spot-row__name">${_escHtml(itemLabel)}</span>
          <span class="att-confirm-spot-row__amount">${(Number(r.amount) || 0).toLocaleString()}円</span>
        </div>`;
      }).join('');
      document.getElementById('confirmSpotTotal').textContent =
        'スポット合計：' + spotTotal.toLocaleString() + '円';

      // 不足分の説明
      if (diff > 0) {
        document.getElementById('confirmDiffDesc').textContent =
          '算出' + gross.toLocaleString() + '円 − スポット' + spotTotal.toLocaleString() + '円 ＝ 不足分 ' + diff.toLocaleString() + '円を月次一括として確定';
      } else {
        document.getElementById('confirmDiffDesc').textContent =
          'スポット合計が算出金額以上のため、不足分は0円（確定金額0円）';
      }

      // デフォルト選択：不足分がある→diff、ない→skip を推奨
      const defaultMode = diff > 0 ? 'diff' : 'skip';
      const radio = document.querySelector(`input[name="confirmMode"][value="${defaultMode}"]`);
      if (radio) radio.checked = true;

      spotSection.style.display = '';
      choicesSection.style.display = '';
      confirmOkBtn.textContent = '確定';
    } else {
      // スポットなし → 3択不要、全額確定
      spotSection.style.display = 'none';
      choicesSection.style.display = 'none';
      confirmOkBtn.textContent = '確定';
    }

    document.getElementById('confirmDialog').style.display = '';
  }

  async function _executeConfirm() {
    document.getElementById('confirmDialog').style.display = 'none';

    const staff = _staffList.find(s => s.id === _selectedStaffId);
    if (!staff) return;

    const gross = Number(document.getElementById('prGrossAmount').value) || 0;
    const wh = Number(document.getElementById('prWhAmount').value) || 0;
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

    // A-2-X-6：確定モード判定
    const spotCosts = _findSpotCosts(staff.name);
    const hasSpot = spotCosts.length > 0;
    const confirmMode = hasSpot
      ? (document.querySelector('input[name="confirmMode"]:checked')?.value || 'full')
      : 'full'; // スポットなし→全額確定

    if (confirmMode === 'skip') {
      // 「この月は確定しない」
      alert(`${staff.name}の${_currentMonth}月分は確定をスキップしました。`);
      return;
    }

    let confirmAmount = gross;
    let confirmWh = wh;

    if (confirmMode === 'diff' && hasSpot) {
      const spotTotal = spotCosts.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
      confirmAmount = Math.max(0, gross - spotTotal);
      // 源泉徴収は確定金額ベースで再計算
      const whMode = document.querySelector('input[name="whMode"]:checked')?.value || 'off';
      const days = Number(document.getElementById('prWorkDays').value) || 0;
      confirmWh = _calcWithholdingAmount(whMode, confirmAmount, days);
    }

    if (confirmAmount === 0 && confirmMode === 'diff') {
      alert(`${staff.name}：スポット合計が算出金額以上のため、月次一括の追記は不要です。`);
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
      subType: '20a'  // A-2-X-6：月次一括としてH列に[月次]プレフィックス
    };

    try {
      await _callGAS('addCost', costData);

      const memo = document.getElementById('prMemo').value;
      if (memo !== (staff.managerMemo || '')) {
        staff.managerMemo = memo;
        await _callGAS('saveStaffList', { staffList: _staffList });
      }

      _confirmedStaffIds.add(_selectedStaffId);
      _renderStaffList();

      const modeLabel = confirmMode === 'diff' ? '（不足分）' : '';
      alert(`${staff.name}の給与を確定しました${modeLabel}。\n確定金額：${confirmAmount.toLocaleString()}円\nコストシートに「${itemName}（科目${itemCode}）」を追記しました。`);

      // 月次データ再読込（コスト追記が反映されるように）
      await _loadMonth();
    } catch (e) {
      console.error('confirm error:', e);
      alert('確定処理でエラーが発生しました。');
    }
  }

  /** 源泉徴収額の再計算（確定金額ベース） */
  function _calcWithholdingAmount(whMode, amount, days) {
    if (whMode === 'hostess') {
      const base = amount - 5000 * days;
      return base > 0 ? Math.floor(base * 0.1021) : 0;
    } else if (whMode === 'standard') {
      if (amount <= 1000000) {
        return Math.floor(amount * 0.1021);
      } else {
        return Math.floor(1000000 * 0.1021 + (amount - 1000000) * 0.2042);
      }
    }
    return 0;
  }

  /* ---------- 税理士等の報酬 ---------- */
  function _renderTaxAdvisorSection() {
    const container = document.getElementById('taxAdvisorRows');
    const rows = (_costRows || []).filter(r => String(r.itemCode || r.subjectCode || '') === '25');

    if (rows.length === 0) {
      container.innerHTML = '<div style="font-size:11px;color:var(--uz-text-muted);">対象行なし</div>';
      return;
    }

    container.innerHTML = rows.map(r => {
      const amount = Number(r.taxIncluded || r.amountInTax || 0);
      const wh = amount <= 1000000
        ? Math.floor(amount * 0.1021)
        : Math.floor(1000000 * 0.1021 + (amount - 1000000) * 0.2042);
      return `<div class="att-pr-cost-row" style="justify-content:space-between;">
        <span>${_escHtml((r.date || '').substring(5))}　${amount.toLocaleString()}円</span>
        <span>源泉 ${wh.toLocaleString()}円</span>
        <input type="hidden" data-row-index="${r.rowIndex || ''}" data-wh="${wh}">
      </div>`;
    }).join('');
  }

  async function _onTaxAdvisorConfirm() {
    const inputs = document.querySelectorAll('#taxAdvisorRows input[type="hidden"]');
    const targets = [];
    inputs.forEach(inp => {
      if (inp.dataset.rowIndex) {
        targets.push({
          sheetName: 'コスト',
          rowIndex: Number(inp.dataset.rowIndex),
          withholdingAmount: Number(inp.dataset.wh || 0)
        });
      }
    });
    if (targets.length === 0) return;
    try {
      await _callGAS('confirmPayroll', { targets });
      alert('税理士等の報酬：確定しました。');
    } catch (e) {
      alert('確定処理でエラーが発生しました。');
    }
  }

  /* ---------- ポップオーバー ---------- */
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
        clockIn,
        clockOut,
        memo
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

  /* ---------- イベントバインド ---------- */
  function _bindMonthNav() {
    document.getElementById('prevMonth').addEventListener('click', () => {
      _currentMonth = _shiftMonth(_currentMonth, -1);
      _loadMonth();
    });
    document.getElementById('nextMonth').addEventListener('click', () => {
      _currentMonth = _shiftMonth(_currentMonth, 1);
      _loadMonth();
    });
  }

  function _bindFilter() {
    document.getElementById('staffFilter').addEventListener('change', () => {
      _renderStaffList();
      _renderMatrix();
    });
  }

  function _bindPayTypeChange() {
    document.querySelectorAll('input[name="payType"]').forEach(r => {
      r.addEventListener('change', () => {
        const staff = _staffList.find(s => s.id === _selectedStaffId);
        if (!staff) return;
        const payType = r.value;
        const unitPrice = payType === 'hourly' ? (staff.hourlyWage || 0)
                        : payType === 'daily' ? (staff.dailyWage || 0)
                        : (staff.monthlyWage || 0);
        document.getElementById('prUnitPrice').value = unitPrice || '';
        _recalcGross();
      });
    });
    document.querySelectorAll('input[name="whMode"]').forEach(r => {
      r.addEventListener('change', _recalcWithholding);
    });
  }

  function _bindPayrollInputs() {
    ['prUnitPrice', 'prWorkHours', 'prWorkDays'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', () => {
        _markManual(id === 'prWorkHours' ? 'prHoursBadge' : id === 'prWorkDays' ? 'prDaysBadge' : null);
        _recalcGross();
      });
    });
    document.getElementById('prGrossAmount').addEventListener('input', () => {
      _markManual('prGrossBadge');
      _recalcWithholding();
    });
    document.getElementById('prWhAmount').addEventListener('input', () => {
      _markManual('prWhBadge');
      _recalcNet();
    });
  }

  /* ---------- ユーティリティ ---------- */
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
    if (key === 'payroll_section' || key === 'attendance_menu') {
      return tmplId !== 'non-shop';
    }
    return true;
  }

  function _resetBadge(badgeId) {
    if (!badgeId) return;
    const el = document.getElementById(badgeId);
    if (el) { el.textContent = '自動'; el.className = 'att-pr-auto-badge'; }
  }

  function _markManual(badgeId) {
    if (!badgeId) return;
    const el = document.getElementById(badgeId);
    if (el) { el.textContent = '手動'; el.className = 'att-pr-auto-badge att-pr-auto-badge--manual'; }
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