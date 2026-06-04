// ============================================================
// analytics.js — สูตรการเงิน/การผลิตทั้งหมดของระบบ (ที่เดียว)
// ฟังก์ชันทั้งหมดเป็น "pure function": รับ array ข้อมูลดิบ → คืนผลลัพธ์
// เพื่อให้ทดสอบได้โดยไม่ต้องต่อ D1 (ดู src/__tests__ ผ่าน seed)
// เงินทุกค่าเป็น "สตางค์" (integer) จนกว่าจะถึงชั้น UI
// อ้างอิงนิยาม/เกณฑ์: SKILL.md
// ============================================================

// ---------- helpers ----------
export const toBaht = (satang) => Math.round(satang) / 100;
const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + (f(x) || 0), 0);
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const ym = (d) => (d || '').slice(0, 7);
const safeDiv = (a, b) => (b ? a / b : 0);

// สถานะสี เขียว/เหลือง/แดง ตามเกณฑ์ใน SKILL.md
function band(value, green, yellow, higherIsBetter = true) {
  if (higherIsBetter) {
    if (value >= green) return 'green';
    if (value >= yellow) return 'yellow';
    return 'red';
  } else {
    if (value <= green) return 'green';
    if (value <= yellow) return 'yellow';
    return 'red';
  }
}

// ============================================================
// A. สภาพคล่อง & เงินสด
// ============================================================
export function cashOnHand(cashTxns) {
  const byAccount = {};
  let total = 0;
  for (const t of cashTxns) {
    const sign = t.direction === 'in' ? 1 : -1;
    const v = sign * t.amount_satang;
    byAccount[t.account] = (byAccount[t.account] || 0) + v;
    total += v;
  }
  return { total_satang: total, by_account: byAccount };
}

// กระแสเงินสดสุทธิเฉลี่ยต่อเดือน (ดู N เดือนล่าสุด) + burn + runway
export function burnAndRunway(cashTxns, asOf, monthsBack = 3) {
  const cutoff = new Date(asOf);
  cutoff.setMonth(cutoff.getMonth() - monthsBack);
  const recent = cashTxns.filter((t) => new Date(t.txn_date) >= cutoff && new Date(t.txn_date) <= new Date(asOf));
  const inflow = sum(recent.filter((t) => t.direction === 'in'), (t) => t.amount_satang);
  const outflow = sum(recent.filter((t) => t.direction === 'out'), (t) => t.amount_satang);
  const months = Math.max(1, monthsBack);
  const avgIn = inflow / months;
  const avgOut = outflow / months;
  const netBurn = avgOut - avgIn; // บวก = เผาเงิน
  const cash = cashOnHand(cashTxns).total_satang;
  let runwayMonths = null; // null = ไม่จำกัด (กระแสบวก)
  if (netBurn > 0) runwayMonths = cash / netBurn;
  return {
    avg_inflow_satang: Math.round(avgIn),
    avg_outflow_satang: Math.round(avgOut),
    net_burn_satang: Math.round(netBurn),
    cash_satang: cash,
    runway_months: runwayMonths === null ? null : Math.round(runwayMonths * 10) / 10,
    status: runwayMonths === null ? 'green' : band(runwayMonths, 6, 3, true),
  };
}

// Current / Quick ratio
export function liquidityRatios({ cash_satang, ar_satang, inventory_satang, ap_satang, short_term_debt_satang = 0 }) {
  const currentAssets = cash_satang + ar_satang + inventory_satang;
  const currentLiab = ap_satang + short_term_debt_satang;
  const current = safeDiv(currentAssets, currentLiab);
  const quick = safeDiv(cash_satang + ar_satang, currentLiab);
  return {
    current_ratio: Math.round(current * 100) / 100,
    quick_ratio: Math.round(quick * 100) / 100,
    current_status: band(current, 1.5, 1.0, true),
    quick_status: band(quick, 1.0, 0.7, true),
  };
}

// ============================================================
// B. Aging & วงจรเงินสด
// ============================================================
function agingBuckets(rows, asOf) {
  const b = { not_due: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 };
  for (const r of rows) {
    const outstanding = r.amount_satang - (r.amount_paid_satang || 0);
    if (outstanding <= 0 || r.status === 'paid' || r.status === 'void') continue;
    const overdue = daysBetween(r.due_date, asOf);
    if (overdue <= 0) b.not_due += outstanding;
    else if (overdue <= 30) b.d1_30 += outstanding;
    else if (overdue <= 60) b.d31_60 += outstanding;
    else if (overdue <= 90) b.d61_90 += outstanding;
    else b.d90_plus += outstanding;
    b.total += outstanding;
  }
  return b;
}
export const arAging = (invoices, asOf) => agingBuckets(invoices, asOf);
export const apAging = (bills, asOf) => agingBuckets(bills, asOf);

// DSO, DPO, DIO, CCC — ใช้ค่าเฉลี่ยช่วง (windowDays)
export function cashConversionCycle({ avgAR, creditSales, avgAP, cogs, avgInventory, windowDays = 90 }) {
  const dso = safeDiv(avgAR, creditSales) * windowDays;
  const dpo = safeDiv(avgAP, cogs) * windowDays;
  const dio = safeDiv(avgInventory, cogs) * windowDays;
  const ccc = dso + dio - dpo;
  const round = (x) => Math.round(x * 10) / 10;
  return { dso: round(dso), dpo: round(dpo), dio: round(dio), ccc: round(ccc) };
}

// ============================================================
// C. ต้นทุน & กำไร
// ============================================================
// COGS แยกหมวด + ไฮไลต์ค่าสี
export function cogsBreakdown(jobCosts) {
  const byType = {};
  for (const c of jobCosts) byType[c.cost_type] = (byType[c.cost_type] || 0) + c.amount_satang;
  const total = sum(Object.values(byType));
  return { by_type: byType, total_satang: total, paint_satang: byType.material_paint || 0 };
}

export function grossMargin(revenueSatang, cogsSatang) {
  const gp = revenueSatang - cogsSatang;
  return {
    revenue_satang: revenueSatang,
    cogs_satang: cogsSatang,
    gross_profit_satang: gp,
    gross_margin_pct: Math.round(safeDiv(gp, revenueSatang) * 1000) / 10,
  };
}

// ★ Paint Cost Analysis — โจทย์เจ้าของ "จมกับค่าสี"
export function paintAnalysis({ jobCosts, jobs, revenueSatang }) {
  const paint = jobCosts.filter((c) => c.cost_type === 'material_paint');
  const paintTotal = sum(paint, (c) => c.amount_satang);
  const cogsTotal = sum(jobCosts, (c) => c.amount_satang);
  const totalDoors = sum(jobs, (j) => j.qty_produced || j.quantity || 0);
  // แนวโน้มรายเดือน
  const byMonth = {};
  for (const c of paint) byMonth[ym(c.incurred_at)] = (byMonth[ym(c.incurred_at)] || 0) + c.amount_satang;
  const months = Object.keys(byMonth).sort();
  const trend = months.map((m) => ({ month: m, paint_satang: byMonth[m] }));
  // เพิ่มขึ้นไหม: เทียบครึ่งหลังกับครึ่งแรก
  let trendDir = 'flat';
  if (months.length >= 2) {
    const half = Math.floor(months.length / 2);
    const firstAvg = sum(months.slice(0, half).map((m) => byMonth[m])) / Math.max(1, half);
    const lastAvg = sum(months.slice(half).map((m) => byMonth[m])) / Math.max(1, months.length - half);
    if (lastAvg > firstAvg * 1.1) trendDir = 'up';
    else if (lastAvg < firstAvg * 0.9) trendDir = 'down';
  }
  const paintToRevenue = safeDiv(paintTotal, revenueSatang) * 100;
  return {
    paint_total_satang: paintTotal,
    paint_pct_of_cogs: Math.round(safeDiv(paintTotal, cogsTotal) * 1000) / 10,
    paint_pct_of_revenue: Math.round(paintToRevenue * 10) / 10,
    paint_per_door_satang: totalDoors ? Math.round(paintTotal / totalDoors) : 0,
    trend,
    trend_direction: trendDir, // up = น่าห่วง
    status: trendDir === 'up' || paintToRevenue > 25 ? 'red' : paintToRevenue > 15 ? 'yellow' : 'green',
  };
}

// สัดส่วนค่าใช้จ่ายต่อยอดขาย รายหมวด
export function expenseToSales(expenses, revenueSatang) {
  const byCat = {};
  for (const e of expenses) byCat[e.category] = (byCat[e.category] || 0) + e.amount_satang;
  const rows = Object.entries(byCat)
    .map(([category, satang]) => ({ category, satang, pct_of_sales: Math.round(safeDiv(satang, revenueSatang) * 1000) / 10 }))
    .sort((a, b) => b.satang - a.satang);
  const totalExp = sum(Object.values(byCat));
  return { rows, total_expense_satang: totalExp, expense_to_sales_pct: Math.round(safeDiv(totalExp, revenueSatang) * 1000) / 10 };
}

// กำไรรายงาน (job profitability) — quote-to-actual
export function jobProfitability(jobs, jobCosts) {
  const costByJob = {};
  for (const c of jobCosts) costByJob[c.job_id] = (costByJob[c.job_id] || 0) + c.amount_satang;
  return jobs
    .map((j) => {
      const cost = costByJob[j.id] || 0;
      const price = j.quoted_price_satang || 0;
      const profit = price - cost;
      return {
        job_id: j.id,
        external_id: j.external_id,
        description: j.description,
        price_satang: price,
        cost_satang: cost,
        profit_satang: profit,
        margin_pct: Math.round(safeDiv(profit, price) * 1000) / 10,
        status: profit < 0 ? 'red' : safeDiv(profit, price) < 0.15 ? 'yellow' : 'green',
      };
    })
    .sort((a, b) => a.margin_pct - b.margin_pct); // โชว์งานแย่สุดก่อน
}

// Break-even (จุดคุ้มทุน) ต่อเดือน
export function breakEven({ fixedCostSatang, revenueSatang, variableCostSatang }) {
  const cmRatio = safeDiv(revenueSatang - variableCostSatang, revenueSatang); // contribution margin ratio
  const bep = safeDiv(fixedCostSatang, cmRatio);
  return { cm_ratio: Math.round(cmRatio * 1000) / 10, break_even_revenue_satang: Math.round(bep) };
}

// ============================================================
// D. Budget & Forecast
// ============================================================
export function budgetVsActual({ budgets, expenses, revenueByMonth, period }) {
  // actual expense by category for the period
  const actualExp = {};
  for (const e of expenses) if (ym(e.spent_at) === period) actualExp[e.category] = (actualExp[e.category] || 0) + e.amount_satang;
  const rows = [];
  for (const b of budgets.filter((x) => x.period === period)) {
    const actual = b.budget_type === 'revenue' ? (revenueByMonth[period] || 0) : (actualExp[b.category] || 0);
    const variance = b.budget_type === 'revenue' ? actual - b.amount_satang : b.amount_satang - actual; // favorable positive
    rows.push({
      category: b.category,
      type: b.budget_type,
      budget_satang: b.amount_satang,
      actual_satang: actual,
      variance_satang: variance,
      variance_pct: Math.round(safeDiv(variance, b.amount_satang) * 1000) / 10,
      status: variance >= 0 ? 'green' : variance >= -0.1 * b.amount_satang ? 'yellow' : 'red',
    });
  }
  return rows;
}

// 13-week rolling cash flow forecast (direct method)
export function thirteenWeekForecast({ openingCashSatang, invoices, bills, recurringWeeklySatang = 0, asOf }) {
  const weeks = [];
  let running = openingCashSatang;
  const start = new Date(asOf);
  for (let w = 0; w < 13; w++) {
    const wStart = new Date(start); wStart.setDate(start.getDate() + w * 7);
    const wEnd = new Date(wStart); wEnd.setDate(wStart.getDate() + 6);
    const inAR = sum(
      invoices.filter((i) => {
        const out = i.amount_satang - (i.amount_paid_satang || 0);
        return out > 0 && new Date(i.due_date) >= wStart && new Date(i.due_date) <= wEnd;
      }),
      (i) => i.amount_satang - (i.amount_paid_satang || 0)
    );
    const outAP = sum(
      bills.filter((b) => {
        const out = b.amount_satang - (b.amount_paid_satang || 0);
        return out > 0 && new Date(b.due_date) >= wStart && new Date(b.due_date) <= wEnd;
      }),
      (b) => b.amount_satang - (b.amount_paid_satang || 0)
    );
    const net = inAR - outAP - recurringWeeklySatang;
    running += net;
    weeks.push({
      week: w + 1,
      start: wStart.toISOString().slice(0, 10),
      inflow_satang: inAR,
      outflow_satang: outAP + recurringWeeklySatang,
      net_satang: net,
      balance_satang: running,
      status: running < 0 ? 'red' : running < (recurringWeeklySatang || 1) * 2 ? 'yellow' : 'green',
    });
  }
  const firstNegative = weeks.find((w) => w.balance_satang < 0);
  return { weeks, first_negative_week: firstNegative ? firstNegative.week : null };
}

// พยากรณ์ระยะยาว 3 ฉากทัศน์ — รอดหรือล่มจม
export function longRangeForecast({ openingCashSatang, avgMonthlyInflow, avgMonthlyOutflow, months = 18, asOf }) {
  const scenarios = {
    base: { inMul: 1.0, outMul: 1.0 },
    optimistic: { inMul: 1.1, outMul: 0.9 },
    pessimistic: { inMul: 0.9, outMul: 1.15 },
  };
  const out = {};
  const start = new Date(asOf);
  for (const [name, s] of Object.entries(scenarios)) {
    let bal = openingCashSatang;
    const series = [];
    let depletionMonth = null;
    for (let m = 0; m < months; m++) {
      const d = new Date(start); d.setMonth(start.getMonth() + m + 1);
      const net = avgMonthlyInflow * s.inMul - avgMonthlyOutflow * s.outMul;
      bal += net;
      const label = d.toISOString().slice(0, 7);
      series.push({ month: label, balance_satang: Math.round(bal) });
      if (bal < 0 && depletionMonth === null) depletionMonth = label;
    }
    out[name] = { series, depletion_month: depletionMonth, survives: depletionMonth === null };
  }
  return out;
}

// ============================================================
// G. Production Analysis
// ============================================================
export function productionMetrics(jobs) {
  const prod = jobs.filter((j) => (j.qty_produced || 0) > 0);
  const totProduced = sum(prod, (j) => j.qty_produced || 0);
  const totGood = sum(prod, (j) => j.qty_good || 0);
  const totScrap = sum(prod, (j) => j.qty_scrap || 0);
  const totRework = sum(prod, (j) => j.qty_rework || 0);
  const totOrdered = sum(prod, (j) => j.qty_ordered || j.quantity || 0);
  // scrap cost: ปันต้นทุนต่อบานของแต่ละงาน × ของเสีย ต้องใช้ jobCosts ภายนอก → ทำใน repo
  const delivered = jobs.filter((j) => j.delivered_date && j.promised_date);
  const onTime = delivered.filter((j) => new Date(j.delivered_date) <= new Date(j.promised_date));
  const leadJobs = jobs.filter((j) => j.started_at && j.completed_at);
  const avgLead = leadJobs.length ? sum(leadJobs, (j) => daysBetween(j.started_at, j.completed_at)) / leadJobs.length : 0;
  const pct = (a, b) => Math.round(safeDiv(a, b) * 1000) / 10;
  const yieldPct = pct(totGood, totProduced);
  const scrapPct = pct(totScrap, totProduced);
  const otdPct = pct(onTime.length, delivered.length);
  return {
    yield_pct: yieldPct,
    scrap_pct: scrapPct,
    rework_pct: pct(totRework, totProduced),
    on_time_delivery_pct: otdPct,
    fill_rate_pct: pct(totGood, totOrdered),
    avg_lead_time_days: Math.round(avgLead * 10) / 10,
    units: { produced: totProduced, good: totGood, scrap: totScrap, rework: totRework, ordered: totOrdered },
    status: {
      yield: band(yieldPct, 95, 90, true),
      scrap: band(scrapPct, 3, 7, false),
      otd: band(otdPct, 95, 85, true),
    },
  };
}

// มูลค่าของเสีย (ต้องป้อน cost ต่อบานต่องาน)
export function scrapCost(jobs, jobCosts) {
  const costByJob = {};
  for (const c of jobCosts) costByJob[c.job_id] = (costByJob[c.job_id] || 0) + c.amount_satang;
  let total = 0;
  for (const j of jobs) {
    const produced = j.qty_produced || 0;
    const scrap = j.qty_scrap || 0;
    if (produced > 0 && scrap > 0) total += Math.round((costByJob[j.id] || 0) / produced * scrap);
  }
  return { scrap_cost_satang: total };
}

// ============================================================
// I. Payroll (เงินเดือน/ค่าแรง)
// ============================================================
export function payrollSummary(payslips, period, revenueSatang = 0) {
  const slips = period ? payslips.filter((p) => p.period === period) : payslips;
  const totGross = sum(slips, (p) => p.gross_satang);
  const totBase = sum(slips, (p) => p.base_pay_satang);
  const totOt = sum(slips, (p) => p.ot_pay_satang);
  const totTax = sum(slips, (p) => p.tax_satang);
  const totSso = sum(slips, (p) => p.sso_satang);
  const totNet = sum(slips, (p) => p.net_satang);
  const totEmployerSso = sum(slips, (p) => p.employer_sso_satang);
  const companyCost = totGross + totEmployerSso; // ต้นทุนบริษัทจริง = จ่ายลูกจ้าง + สมทบ
  const ft = slips.filter((p) => p.emp_type === 'full_time');
  const pt = slips.filter((p) => p.emp_type === 'part_time');
  // แนวโน้มรายเดือน
  const byMonth = {};
  for (const p of payslips) {
    byMonth[p.period] = byMonth[p.period] || { gross: 0, ot: 0, company: 0 };
    byMonth[p.period].gross += p.gross_satang;
    byMonth[p.period].ot += p.ot_pay_satang;
    byMonth[p.period].company += p.gross_satang + p.employer_sso_satang;
  }
  const trend = Object.keys(byMonth).sort().map((m) => ({ month: m, ...byMonth[m] }));
  return {
    period: period || 'ทั้งหมด',
    headcount: slips.length,
    full_time_count: ft.length,
    part_time_count: pt.length,
    total_base_satang: totBase,
    total_ot_satang: totOt,
    total_gross_satang: totGross,
    total_tax_satang: totTax,
    total_sso_satang: totSso,
    total_employer_sso_satang: totEmployerSso,
    total_net_satang: totNet,
    company_cost_satang: companyCost,
    ft_gross_satang: sum(ft, (p) => p.gross_satang),
    pt_gross_satang: sum(pt, (p) => p.gross_satang),
    ot_pct_of_payroll: Math.round(safeDiv(totOt, totGross) * 1000) / 10,
    payroll_to_revenue_pct: Math.round(safeDiv(companyCost, revenueSatang) * 1000) / 10,
    trend,
    status: revenueSatang ? band(safeDiv(companyCost, revenueSatang) * 100, 25, 40, false) : 'green',
  };
}

// ============================================================
// H. Inventory / Warehouse
// ============================================================
export function inventoryValue(items) {
  const byCat = {};
  let total = 0;
  for (const it of items) {
    const v = (it.qty_on_hand || 0) * (it.unit_cost_satang || 0);
    byCat[it.category] = (byCat[it.category] || 0) + v;
    total += v;
  }
  return { total_satang: Math.round(total), by_category: byCat };
}

// แจ้งเตือนของใกล้หมด (ROP)
export function reorderAlerts(items) {
  return items
    .filter((it) => it.reorder_point > 0 && it.qty_on_hand <= it.reorder_point)
    .map((it) => ({
      item_id: it.id, name: it.name, category: it.category,
      qty_on_hand: it.qty_on_hand, reorder_point: it.reorder_point,
      lead_time_days: it.lead_time_days, bin_location: it.bin_location,
    }));
}

// Dead/slow-moving stock — อิงการเคลื่อนไหวล่าสุด (movement out)
export function deadStock(items, movements, asOf, slowDays = 180, deadDays = 365) {
  const lastOut = {};
  for (const m of movements) {
    if (m.movement_type !== 'out') continue;
    if (!lastOut[m.item_id] || m.moved_at > lastOut[m.item_id]) lastOut[m.item_id] = m.moved_at;
  }
  const rows = [];
  for (const it of items) {
    if ((it.qty_on_hand || 0) <= 0) continue;
    const last = lastOut[it.id];
    const idle = last ? daysBetween(last, asOf) : 9999;
    if (idle >= slowDays) {
      rows.push({
        item_id: it.id, name: it.name, category: it.category,
        idle_days: idle === 9999 ? null : idle,
        value_satang: Math.round((it.qty_on_hand || 0) * (it.unit_cost_satang || 0)),
        classification: idle >= deadDays ? 'dead' : 'slow',
      });
    }
  }
  rows.sort((a, b) => b.value_satang - a.value_satang);
  const deadValue = sum(rows.filter((r) => r.classification === 'dead'), (r) => r.value_satang);
  const slowValue = sum(rows.filter((r) => r.classification === 'slow'), (r) => r.value_satang);
  return { rows, dead_value_satang: deadValue, slow_value_satang: slowValue };
}

// ABC analysis — จัดกลุ่มตาม usage value (ใช้ × ต้นทุน) ช่วงที่ผ่านมา
export function abcAnalysis(items, movements, asOf, windowDays = 365) {
  const cutoff = new Date(asOf); cutoff.setDate(cutoff.getDate() - windowDays);
  const usage = {};
  for (const m of movements) {
    if (m.movement_type !== 'out') continue;
    if (new Date(m.moved_at) < cutoff) continue;
    usage[m.item_id] = (usage[m.item_id] || 0) + Math.abs(m.qty || 0);
  }
  const scored = items.map((it) => ({
    item_id: it.id, name: it.name, category: it.category,
    usage_value_satang: Math.round((usage[it.id] || 0) * (it.unit_cost_satang || 0)),
  }));
  const totalValue = sum(scored, (s) => s.usage_value_satang) || 1;
  scored.sort((a, b) => b.usage_value_satang - a.usage_value_satang);
  let cum = 0;
  for (const s of scored) {
    cum += s.usage_value_satang;
    const cumPct = (cum / totalValue) * 100;
    s.abc_class = cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C';
    s.cum_pct = Math.round(cumPct * 10) / 10;
  }
  return scored;
}

// EOQ — ปริมาณสั่งซื้อประหยัดสุด
export function eoq({ annualDemand, orderCostSatang, holdingCostPerUnitSatang }) {
  if (!holdingCostPerUnitSatang) return 0;
  return Math.round(Math.sqrt((2 * annualDemand * orderCostSatang) / holdingCostPerUnitSatang));
}
