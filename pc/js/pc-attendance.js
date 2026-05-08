/* ==========================================
   PC版 出勤管理画面 (pc-attendance.js)
   指示書16 準拠
   ========================================== */
'use strict';

(function () {

  /* ---------- 定数・状態 ---------- */
  const EMPLOYMENT_LABELS = {
    employed_full: '常勤雇用',
    employed_part: '臨時バイト',
    employed: '常勤雇用', // 後方互換
    contractor: '委託・外注'
  };
  const WH_LABELS = { off: '対象外', standard: '一般報酬', hostess: 'ホステス特例' };
  const PAY_TYPE_LABELS = { hourly: '時給', daily: '日給', monthly: '月給・歩合' };

  let _staffList = [];
  let _attendanceRecords = [];
  let _costRows = []; // 月次コスト行キャッシュ
  let _currentMonth = _todayMonth();
  let _selectedStaffId = null;
  let _confirmedStaffIds = new Set();

  /* ---------- 初期化 ---------- */
  document.addEventListener('DOMContentLoaded', async () => {
    // pc-common.js の共通ブート（サイドバー・ヘッダー描画）
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

      // featureVisibility チェック
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
      // _callGAS は {status:'ok', data:X} の X を返す
      // getAttendanceByMonth → 配列（直接）  ※v3: records プロパティなし
      // getHistory → 配列（直接）
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
    _renderStaffList(); // アクティブ更新
    _renderMatrix();    // マトリクスもハイライト更新
    _loadPayroll(staffId);
  }

  /* ---------- ゾーンB：出勤マトリクス ---------- */

  /** 給与系コスト行から日付×スタッフ名→金額のマップを構築（金額由来セル表示用） */
  function _buildCostAmountMap() {
    const PAYROLL_CODES = ['20', '21', '25'];
    const map = {}; // key: 'YYYY-MM-DD|スタッフ名' → amount
    (_costRows || []).forEach(r => {
      if (!PAYROLL_CODES.includes(String(r.itemCode || ''))) return;
      const misc = String(r.miscItemName || '');
      // H列からスタッフ名を抽出（[スポット]・[月次]プレフィックスを除去）
      const staffName = misc.replace(/^\[スポット\]/, '').replace(/^\[月次\]/, '').trim();
      if (!staffName) return;
      const key = r.date + '|' + staffName;
      map[key] = (map[key] || 0) + (Number(r.amount) || 0);
    });
    return map;
  }

  /** 金額を簡潔表示（万単位 or 千単位 or そのまま） */
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

    // ヘッダー
    let headHtml = '<tr><th class="att-th-name">スタッフ</th>';
    for (let d = 1; d <= daysInMonth; d++) headHtml += `<th>${d}</th>`;
    headHtml += '<th class="att-th-total">合計H</th><th class="att-th-total">日数</th></tr>';
    thead.innerHTML = headHtml;

    // ボディ
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
          // 打刻由来と金額由来を分離
          const clockRecs = dayRecs.filter(r => r.clockIn);    // 時刻あり＝打刻由来
          const moneyRecs = dayRecs.filter(r => !r.clockIn);   // 時刻なし＝金額由来

          let cellParts = [];
          let hasProject = false;

          // 打刻由来行の表示
          clockRecs.forEach(r => {
            const isPending = !r.clockOut;
            const timeStr = r.clockIn + '〜' + (r.clockOut || '');
            const hours = _calcHours(r.clockIn, r.clockOut, r.date, r.clockOutDate);
            if (!isPending && hours > 0) staffHours += hours;
            if (r.projectId) hasProject = true;
            cellParts.push(`<div class="${isPending ? 'att-pending-line' : ''}">${_escHtml(timeStr)}</div>`);
          });

          // 金額由来行の表示（★ ¥金額）
          moneyRecs.forEach(r => {
            if (r.projectId) hasProject = true;
            const costKey = dateStr + '|' + (r.staffName || s.name);
            const amount = costAmountMap[costKey] || 0;
            const display = amount > 0 ? '★ ' + _fmtAmountShort(amount) : '★';
            cellParts.push(`<div class="att-money-line">${display}</div>`);
          });

          // 日数カウント：打刻由来がある日のみカウント（金額由来のみの日は除外）
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

    // フッター（集計行）
    tfoot.innerHTML = `<tr>
      <td>合計</td>
      ${Array(daysInMonth).fill('<td></td>').join('')}
      <td>${totalHours.toFixed(1)}</td>
      <td>${totalDays}</td>
    </tr>`;

    // 日別セルのクリックイベント
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

    // ① ヘッダー
    const et = _normalizeEmploymentType(staff.employmentType);
    const whLabel = WH_LABELS[staff.withholdingMode || 'off'] || '対象外';
    document.getElementById('prHeader').innerHTML = `
      <div class="att-pr-header__name">${_escHtml(staff.name)}</div>
      <div class="att-pr-header__meta">${EMPLOYMENT_LABELS[et] || et}　/　${whLabel}</div>
    `;

    // ② 給与算出方式
    let defaultPayType = 'hourly';
    if (staff.hourlyWage) defaultPayType = 'hourly';
    else if (staff.dailyWage) defaultPayType = 'daily';
    else if (staff.monthlyWage) defaultPayType = 'monthly';
    document.querySelector(`input[name="payType"][value="${defaultPayType}"]`).checked = true;

    // ③ 自動流し込み
    const staffAttendance = _attendanceRecords.filter(r => r.staffId === staffId);
    const { totalHours, totalDays } = _calcStaffTotals(staffAttendance);

    const unitPrice = defaultPayType === 'hourly' ? (staff.hourlyWage || 0)
                    : defaultPayType === 'daily' ? (staff.dailyWage || 0)
                    : (staff.monthlyWage || 0);

    document.getElementById('prUnitPrice').value = unitPrice || '';
    document.getElementById('prWorkHours').value = totalHours.toFixed(1);
    document.getElementById('prWorkDays').value = totalDays;
    _resetBadge('prHoursBadge');
    _resetBadge('prDaysBadge');

    _recalcGross();

    // ④ 源泉徴収区分
    const whMode = staff.withholdingMode || 'off';
    const whRadio = document.querySelector(`input[name="whMode"][value="${whMode}"]`);
    if (whRadio) whRadio.checked = true;

    // ⑥ コスト自動追記プレビュー
    _updateCostPreview(staff);

    // ⑦ 経営メモ
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
    else gross = unitPrice; // 月給・歩合は単価=金額

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

  /* ---------- 確定処理 ---------- */
  function _bindConfirmBtn() {
    document.getElementById('prConfirmBtn').addEventListener('click', _onConfirm);
    document.getElementById('confirmCancel').addEventListener('click', () => {
      document.getElementById('confirmDialog').style.display = 'none';
    });
    document.getElementById('confirmOk').addEventListener('click', _executeConfirm);

    // 税理士一括確定
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

    // 科目判定：contractor時はcostCategory参照（21:外注工賃 / 25:税理士等の報酬）、それ以外は20:給料賃金
    let itemCode, itemName;
    if (isContractor) {
      const cat = (staff.costCategory === '25') ? '25' : '21';
      itemCode = cat;
      itemName = (cat === '25') ? '税理士等の報酬' : '外注工賃';
    } else {
      itemCode = '20';
      itemName = '給料賃金';
    }

    // コストシート追記用データ
    const [y, m] = _currentMonth.split('-').map(Number);
    // 月末日をコスト計上日とする(給与計算の慣行)
    const lastDay = new Date(y, m, 0).getDate();
    const costDate = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const costData = {
      date: costDate,
      divisionCode: '2',           // 販管費
      divisionName: '販管費',
      itemCode: itemCode,
      itemName: itemName,
      miscItemName: '',
      taxRate: isContractor ? 10 : 0,  // 委託・外注は課税、給料賃金は不課税
      taxIncluded: gross,
      memo: `${staff.name}　${y}年${m}月分`,
      unpaid: 0,
      withholdingAmount: wh,
      clientId: '',
      projectId: ''
    };

    try {
      await _callGAS('addCost', costData);

      // 経営メモ保存
      const memo = document.getElementById('prMemo').value;
      if (memo !== (staff.managerMemo || '')) {
        staff.managerMemo = memo;
        await _callGAS('saveStaffList', { staffList: _staffList });
      }

      _confirmedStaffIds.add(_selectedStaffId);
      _renderStaffList();
      alert(`${staff.name}の給与を確定しました。\nコストシートに「${itemName}（科目${itemCode}）」を追記しました。`);
    } catch (e) {
      console.error('confirm error:', e);
      alert('確定処理でエラーが発生しました。');
    }
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

  /* ---------- ポップオーバー（日別セル編集） ---------- */
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

    // ポジション
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
      await _loadMonth(); // 再描画
    } catch (e) {
      console.error('save day cell error:', e);
      alert('保存に失敗しました。');
    }
  }

  // ポップオーバー外クリックで閉じる
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
    // 日跨ぎ
    if (dateOut && dateOut !== dateIn) mins += 24 * 60;
    else if (mins < 0) mins += 24 * 60;
    return Math.max(0, mins / 60);
  }

  function _calcStaffTotals(records) {
    let totalHours = 0;
    const uniqueDates = new Set();
    records.forEach(r => {
      if (r.clockOut) {
        totalHours += _calcHours(r.clockIn, r.clockOut, r.date, r.clockOutDate);
      }
      uniqueDates.add(r.date);
    });
    return { totalHours: Math.round(totalHours * 10) / 10, totalDays: uniqueDates.size };
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
    // プリセット既定値
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
      // callGAS が {status, data} ラッパーを返す場合は data を取り出す
      if (res && res.status === 'ok' && res.data !== undefined) return res.data;
      return res;
    }
    // フォールバック（app.js の callGAS が利用不可の場合）
    const gasUrl = window.GAS_URL || '';
    if (!gasUrl) throw new Error('GAS_URL not set');
    const url = gasUrl + '?action=' + action + '&data=' + encodeURIComponent(JSON.stringify(data || {}));
    const resp = await fetch(url);
    const json = await resp.json();
    if (json.status !== 'ok') throw new Error(json.message || 'GAS error');
    return json.data || json;
  }

})();
