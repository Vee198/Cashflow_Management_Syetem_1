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

// Inventory Aging — จัดกลุ่มมูลค่าสต็อกตามจำนวนวันที่ไม่เคลื่อนไหว (อิง movement out ล่าสุด)
export function inventoryAging(items, movements, asOf) {
  const lastOut = {};
  for (const m of movements) {
    if (m.movement_type !== 'out') continue;
    if (!lastOut[m.item_id] || m.moved_at > lastOut[m.item_id]) lastOut[m.item_id] = m.moved_at;
  }
  const buckets = { d0_30: 0, d31_60: 0, d61_90: 0, d91_180: 0, d180_plus: 0, total: 0 };
  const rows = [];
  for (const it of items) {
    const val = Math.round((it.qty_on_hand || 0) * (it.unit_cost_satang || 0));
    if (val <= 0) continue;
    const last = lastOut[it.id];
    const idle = last ? daysBetween(last, asOf) : 9999;
    let b;
    if (idle <= 30) b = 'd0_30';
    else if (idle <= 60) b = 'd31_60';
    else if (idle <= 90) b = 'd61_90';
    else if (idle <= 180) b = 'd91_180';
    else b = 'd180_plus';
    buckets[b] += val; buckets.total += val;
    rows.push({
      item_id: it.id, name: it.name, category: it.category, bin_location: it.bin_location,
      qty_on_hand: it.qty_on_hand, unit: it.unit, idle_days: idle === 9999 ? null : idle,
      value_satang: val, bucket: b, last_out: last || null,
    });
  }
  rows.sort((a, b) => b.value_satang - a.value_satang);
  return { buckets, rows };
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

// ============================================================
// J. งบการเงิน (Financial Statements) — จริง + dummy ส่วนที่ขาด
// ============================================================
// งบกำไรขาดทุน (Income Statement)
export function incomeStatement({ revenueSatang, cogs, expenses, depreciationSatang = 0, interestSatang = 0, taxRate = 0.20 }) {
  const cogsTotal = cogs.total_satang;
  const grossProfit = revenueSatang - cogsTotal;
  const opexByCat = {};
  for (const e of expenses) opexByCat[e.category] = (opexByCat[e.category] || 0) + e.amount_satang;
  const opexTotal = sum(Object.values(opexByCat));
  const ebitda = grossProfit - opexTotal;
  const ebit = ebitda - depreciationSatang;
  const ebt = ebit - interestSatang;
  const tax = ebt > 0 ? Math.round(ebt * taxRate) : 0;
  const netProfit = ebt - tax;
  const r1 = (x) => Math.round(safeDiv(x, revenueSatang) * 1000) / 10;
  return {
    revenue: revenueSatang, cogs: cogsTotal, cogs_by_type: cogs.by_type,
    gross_profit: grossProfit, gross_margin_pct: r1(grossProfit),
    opex_by_cat: opexByCat, opex_total: opexTotal,
    ebitda, depreciation: depreciationSatang, ebit,
    interest: interestSatang, ebt, tax,
    net_profit: netProfit, net_margin_pct: r1(netProfit),
  };
}

// งบดุล (Balance Sheet) — สินทรัพย์จริง + รายการสมมติ; ส่วนของเจ้าของ = สินทรัพย์ − หนี้สิน (balancing)
export function balanceSheet({ cashSatang, arSatang, inventorySatang, apSatang,
  fixedAssetsSatang = 0, otherCurrentSatang = 0, shortLoanSatang = 0, longDebtSatang = 0, paidInCapitalSatang = 0 }) {
  const currentAssets = cashSatang + arSatang + inventorySatang + otherCurrentSatang;
  const totalAssets = currentAssets + fixedAssetsSatang;
  const currentLiab = apSatang + shortLoanSatang;
  const totalLiab = currentLiab + longDebtSatang;
  const equity = totalAssets - totalLiab;
  const retained = equity - paidInCapitalSatang;
  return {
    assets: { cash: cashSatang, ar: arSatang, inventory: inventorySatang, other_current: otherCurrentSatang, current_total: currentAssets, fixed: fixedAssetsSatang, total: totalAssets },
    liabilities: { ap: apSatang, short_loan: shortLoanSatang, current_total: currentLiab, long_debt: longDebtSatang, total: totalLiab },
    equity: { paid_in: paidInCapitalSatang, retained, total: equity },
    balanced: Math.abs(totalAssets - (totalLiab + equity)) < 100,
  };
}

// ============================================================
// L. Dashboard ฉบับลูกค้า (เงินสด/รับ/ค้างรับ, ค่าใช้จ่ายแยกหมวด)
// ============================================================
// ยอดค้างรับรายลูกค้า — ลูกค้ารายไหนค้างจ่ายเท่าไร
export function arByCustomer(invoices, customers, asOf) {
  const nameById = {}, phoneById = {};
  for (const c of customers) { nameById[c.id] = c.name; phoneById[c.id] = c.phone; }
  const m = {};
  for (const i of invoices) {
    const out = i.amount_satang - (i.amount_paid_satang || 0);
    if (out <= 0 || i.status === 'paid' || i.status === 'void') continue;
    if (!m[i.customer_id]) m[i.customer_id] = { outstanding: 0, overdue: 0, first_issue: null };
    m[i.customer_id].outstanding += out;
    if (asOf && new Date(i.due_date) < new Date(asOf)) m[i.customer_id].overdue += out;
    // วันที่รับงานเก่าสุดที่ยังค้าง (ใช้คำนวณจำนวนวันที่ค้างมาแล้ว)
    if (i.issue_date && (!m[i.customer_id].first_issue || i.issue_date < m[i.customer_id].first_issue)) m[i.customer_id].first_issue = i.issue_date;
  }
  const today = asOf ? new Date(asOf) : null;
  return Object.entries(m)
    .map(([id, v]) => ({
      customer: nameById[id] || ('#' + id), phone: phoneById[id] || '',
      outstanding_satang: v.outstanding, overdue_satang: v.overdue,
      first_issue_date: v.first_issue,
      days_outstanding: (today && v.first_issue) ? Math.max(0, Math.floor((today - new Date(v.first_issue)) / 86400000)) : null,
    }))
    .sort((a, b) => b.outstanding_satang - a.outstanding_satang);
}

// AR Aging — แยกยอดค้างรับตามอายุ (นับจากวันที่รับงาน issue_date) เป็นช่วง 0-30 / 31-60 / 61-90 / 90+
export function arAgingByIssue(invoices, asOf) {
  const b = { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
  const now = asOf ? new Date(asOf) : new Date();
  for (const i of invoices) {
    const out = i.amount_satang - (i.amount_paid_satang || 0);
    if (out <= 0 || i.status === 'paid' || i.status === 'void') continue;
    const base = i.issue_date || i.due_date; if (!base) continue;
    const days = Math.floor((now - new Date(base)) / 86400000);
    if (days <= 30) b.d0_30 += out; else if (days <= 60) b.d31_60 += out; else if (days <= 90) b.d61_90 += out; else b.d90p += out;
  }
  return b;
}

// ค่าใช้จ่ายแยกหมวดธุรกิจ: ต้นทุนผลิต / การตลาด / Ads / ค่าเช่า / โสหุ้ย
const EXP_BUCKET = {
  paint: 'production', wood: 'production', hardware: 'production', labor: 'production',
  marketing: 'marketing', ads: 'ads', rent: 'rent',
  utility: 'overhead', overhead: 'overhead', transport: 'overhead', other: 'overhead', salary: 'production',
};
export function expenseBuckets(expenses) {
  const b = { production: 0, marketing: 0, ads: 0, rent: 0, overhead: 0 };
  const byCat = {};
  for (const e of expenses) {
    const bk = EXP_BUCKET[e.category] || 'overhead';
    b[bk] += e.amount_satang;
    byCat[e.category] = (byCat[e.category] || 0) + e.amount_satang;
  }
  const total = sum(Object.values(b));
  return { buckets: b, by_category: byCat, total_satang: total };
}

// AP (เจ้าหนี้การค้า) จาก expenses ที่ซื้อเชื่อ (credit_term_days>0; =0 คือจ่ายเงินสด ไม่เป็น AP)
// ประเมินยอดค้างจ่าย (ยังไม่ถึงกำหนด) + aging ตามวันที่จะครบกำหนด + DPO (เครดิตเทอมเฉลี่ยถ่วงน้ำหนัก)
export function apFromExpenses(expenses, asOf) {
  const today = asOf ? new Date(asOf) : new Date();
  const aging = { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
  let outstanding = 0, wTerm = 0, creditTotal = 0;
  for (const e of expenses) {
    const term = e.credit_term_days || 0;
    const amt = e.amount_satang || 0;
    if (term > 0) { creditTotal += amt; wTerm += amt * term; }
    if (term <= 0 || !e.spent_at) continue;
    const due = new Date(new Date(e.spent_at).getTime() + term * 86400000);
    if (due > today) {                                    // ยังไม่ถึงกำหนด = ยังค้างจ่าย (AP)
      outstanding += amt;
      const d = Math.floor((due - today) / 86400000);
      if (d <= 30) aging.d0_30 += amt; else if (d <= 60) aging.d31_60 += amt; else if (d <= 90) aging.d61_90 += amt; else aging.d90p += amt;
    }
  }
  return { ap_outstanding_satang: outstanding, aging, dpo_days: creditTotal ? Math.round(wTerm / creditTotal) : 0, credit_total_satang: creditTotal };
}

// ต้นทุนรายงาน (Job Costing) — รวมจากคอลัมน์ต้นทุนในชีต order/jobs (cost_wood/paint/labor/shipping)
// ใช้ในแท็บ "ต้นทุน & ค่าสี" (เลขต้นทุนต่อออเดอร์ที่กรอกในชีต order J-M)
export function jobCostBreakdown(jobs) {
  let wood = 0, paint = 0, labor = 0, shipping = 0, total = 0, doors = 0, revenue = 0;
  for (const j of jobs) {
    wood += j.cost_wood_satang || 0; paint += j.cost_paint_satang || 0;
    labor += j.cost_labor_satang || 0; shipping += j.cost_shipping_satang || 0;
    total += j.total_cost_satang || 0;
    doors += j.quantity || j.qty_ordered || 0;
    revenue += j.quoted_price_satang || 0;
  }
  if (!total) total = wood + paint + labor + shipping;
  const breakdown = [
    { name: 'ค่าไม้', satang: wood }, { name: 'ค่าสี', satang: paint },
    { name: 'ค่าแรง', satang: labor }, { name: 'ค่าส่ง', satang: shipping },
  ].filter((x) => x.satang > 0).sort((a, b) => b.satang - a.satang);
  return { cost_wood_satang: wood, cost_paint_satang: paint, cost_labor_satang: labor, cost_shipping_satang: shipping,
    total_satang: total, doors, revenue_satang: revenue, breakdown };
}

// เงินเดือนพนักงานต่อเดือน (ดึงจากชีต employees อัตโนมัติ) — แยกฝ่ายผลิต(เข้า COGS) vs สนง./บริหาร(เข้า OH)
export function employeeSalary(employees) {
  let cogs = 0, oh = 0;
  for (const e of employees || []) {
    if (e.status && e.status !== 'active') continue;
    const sal = e.base_salary_satang || 0;
    if ((e.department || '') === 'production') cogs += sal; else oh += sal;
  }
  return { cogs, oh, per_month: cogs + oh };
}

// งบกำไรขาดทุนรายเดือน (สำหรับแท็บ P&L) — รายได้จาก jobs(quoted, ตาม started_at), ต้นทุน/ค่าใช้จ่ายจาก expenses(ตาม spent_at)
// + เงินเดือนพนักงาน (auto จาก employees) เข้าทุกเดือนที่มีข้อมูล: ฝ่ายผลิต→cats.salary(COGS), อื่นๆ→cats.salary_oh(OH)
// คืน category ดิบรายเดือน ให้ frontend รวมช่วง + แยก COGS/OH + คำนวณ vertical/horizontal เอง
export function pnlMonthly(jobs, expenses, employees) {
  const m = {};
  const ens = (k) => { if (!m[k]) m[k] = { revenue: 0, cats: {} }; return m[k]; };
  for (const j of jobs) { const k = ym(j.started_at); if (k) ens(k).revenue += j.quoted_price_satang || 0; }
  for (const e of expenses) { const k = ym(e.spent_at); if (!k) continue; const o = ens(k); o.cats[e.category] = (o.cats[e.category] || 0) + (e.amount_satang || 0); }
  const sal = employeeSalary(employees);
  if (sal.per_month > 0) for (const k of Object.keys(m)) {
    if (sal.cogs) m[k].cats.salary = (m[k].cats.salary || 0) + sal.cogs;
    if (sal.oh) m[k].cats.salary_oh = (m[k].cats.salary_oh || 0) + sal.oh;
  }
  return Object.keys(m).sort().map((k) => ({ month: k, revenue: m[k].revenue, cats: m[k].cats }));
}

// แยกค่าใช้จ่ายคงที่ (fixed) vs ผันแปร (variable) — ตามคอลัมน์ expense_kind
export function fixedVariable(expenses) {
  let fixed = 0, variable = 0, unset = 0;
  for (const e of expenses) {
    const amt = e.amount_satang || 0;
    if (e.expense_kind === 'fixed') fixed += amt;
    else if (e.expense_kind === 'variable') variable += amt;
    else unset += amt;
  }
  return { fixed, variable, unset };
}

// ยอดขายรายเดือน: ประมาณการ (budget) vs จริง (invoiced)
export function salesMonthly(invoices, budgets) {
  const actual = {}, budget = {};
  for (const i of invoices) { if (i.status === 'void') continue; const m = ym(i.issue_date); actual[m] = (actual[m] || 0) + i.amount_satang; }
  for (const b of budgets) { if (b.budget_type !== 'revenue') continue; budget[b.period] = (budget[b.period] || 0) + b.amount_satang; }
  const months = [...new Set([...Object.keys(actual), ...Object.keys(budget)])].sort();
  return months.map((m) => ({ month: m, actual_satang: actual[m] || 0, budget_satang: budget[m] || 0 }));
}

// กำไรแยกตามแหล่งผลิต: ผลิตเอง (self) vs สั่งซัพพลายเออร์ผลิต (outsourced)
export function profitByProductionType(jobs) {
  const blank = () => ({ revenue: 0, cost: 0, profit: 0, count: 0, doors: 0 });
  const self_ = blank(), out = blank();
  const monthly = {};
  for (const j of jobs) {
    const rev = j.quoted_price_satang || 0, cost = j.total_cost_satang || 0;
    const isOut = j.production_type === 'outsourced';
    const t = isOut ? out : self_;
    t.revenue += rev; t.cost += cost; t.profit += rev - cost; t.count += 1; t.doors += j.quantity || 0;
    const m = ym(j.started_at);
    if (m) {
      if (!monthly[m]) monthly[m] = { self_profit: 0, out_profit: 0 };
      if (isOut) monthly[m].out_profit += rev - cost; else monthly[m].self_profit += rev - cost;
    }
  }
  const months = Object.keys(monthly).sort();
  return {
    self: self_, outsourced: out,
    total_profit: self_.profit + out.profit,
    self_margin_pct: self_.revenue ? Math.round(safeDiv(self_.profit, self_.revenue) * 1000) / 10 : 0,
    out_margin_pct: out.revenue ? Math.round(safeDiv(out.profit, out.revenue) * 1000) / 10 : 0,
    monthly: months.map((m) => ({ month: m, ...monthly[m] })),
  };
}

// วิเคราะห์ต้นทุนสี/วัตถุดิบ แยกราย ร้านค้า / แบรนด์ / ชนิดสี (+ รายเดือน)
export function materialPurchaseAnalysis(purchases) {
  const amt = (p) => p.total_incl_vat_satang || 0;
  const isUnspec = (n) => ['(ไม่ระบุ)', '-', '?', ''].includes((n || '').toString().trim());
  const total = sum(purchases, amt);
  const paintTotal = sum(purchases.filter((p) => p.category === 'paint'), amt);
  const byDim = (key) => {
    const m = {};
    for (const p of purchases) {
      const k = (p[key] || '(ไม่ระบุ)').toString().trim() || '(ไม่ระบุ)';
      if (!m[k]) m[k] = { name: k, satang: 0, qty: 0, count: 0 };
      m[k].satang += amt(p); m[k].qty += p.qty || 0; m[k].count += 1;
    }
    // (ไม่ระบุ) ไปล่างสุดเสมอ; ที่เหลือเรียงยอดซื้อมาก→น้อย
    return Object.values(m).sort((a, b) => {
      const au = isUnspec(a.name), bu = isUnspec(b.name);
      if (au !== bu) return au ? 1 : -1;
      return b.satang - a.satang;
    });
  };
  // ร้าน/แบรนด์หลัก = ที่มีจำนวนครั้งซื้อมากสุด (ไม่นับ "ไม่ระบุ")
  const topByCount = (rows) => [...rows].filter((x) => !isUnspec(x.name)).sort((a, b) => b.count - a.count)[0] || null;
  const by_vendor = byDim('vendor'), by_brand = byDim('brand');
  const byMonth = {};
  for (const p of purchases) {
    const k = ym(p.purchase_date); if (!k) continue;
    if (!byMonth[k]) byMonth[k] = { paint: 0, other: 0 };
    if (p.category === 'paint') byMonth[k].paint += amt(p); else byMonth[k].other += amt(p);
  }
  const monthly = Object.keys(byMonth).sort().map((m) => ({ month: m, ...byMonth[m] }));
  return {
    total_satang: total, paint_total_satang: paintTotal, count: purchases.length,
    by_vendor, by_brand, by_type: byDim('item_type'), by_category: byDim('category'),
    top_vendor_by_count: topByCount(by_vendor), top_brand_by_count: topByCount(by_brand),
    monthly,
  };
}

// ============================================================
// K. Recommendation Engine + Customer Concentration (#15/#18)
// ============================================================
// การกระจุกตัวของลูกค้า — ลูกค้ารายใหญ่คิดเป็นกี่ % ของยอดขาย
export function customerConcentration(invoices, customers) {
  const nameById = {};
  for (const c of customers) nameById[c.id] = c.name;
  const byCust = {}; let total = 0;
  for (const i of invoices) {
    if (i.status === 'void') continue;
    byCust[i.customer_id] = (byCust[i.customer_id] || 0) + i.amount_satang;
    total += i.amount_satang;
  }
  const rows = Object.entries(byCust)
    .map(([id, s]) => ({ customer: nameById[id] || ('#' + id), satang: s, pct: Math.round(safeDiv(s, total) * 1000) / 10 }))
    .sort((a, b) => b.satang - a.satang);
  return { rows, top_name: rows[0] ? rows[0].customer : '-', top_pct: rows[0] ? rows[0].pct : 0, total_satang: total };
}

// ที่ปรึกษาการเงินอัตโนมัติ — กฎเชิงผลกระทบ คืนรายการคำแนะนำเรียงตามความรุนแรง
export function recommendations(ctx) {
  const money = (s) => '฿' + Math.round((s || 0) / 100).toLocaleString('en-US');
  const recs = [];
  const add = (severity, title, detail, action, impact, scoreGain) =>
    recs.push({ severity, title, detail, action, impact: impact || '', score_gain: scoreGain || '' });

  if (ctx.paint_pct_revenue > 25 || ctx.paint_trend === 'up')
    add('red', 'ต้นทุนค่าสีสูงผิดปกติ',
      `ค่าสีคิดเป็น ${ctx.paint_pct_revenue}% ของยอดขาย${ctx.paint_trend === 'up' ? ' และมีแนวโน้มเพิ่มขึ้น' : ''}`,
      'เจรจาราคากับซัพพลายเออร์สี/เทียบเจ้าใหม่ ลดการพ่นซ้ำ และทบทวนปริมาณสีต่อบาน',
      `ลดค่าสีได้ 10% ≈ ประหยัด ${money(Math.round(ctx.paint_total * 0.10))}`, '+0.2');
  if (ctx.gm_pct < 15)
    add('red', 'กำไรขั้นต้นต่ำ', `กำไรขั้นต้นเพียง ${ctx.gm_pct}% (เกณฑ์ปลอดภัย 15–30%)`,
      'ใช้แท็บ BOM ตั้งราคาจากต้นทุนจริง + กำไรเป้าหมาย และทบทวนงานที่ขาดทุน (แท็บกำไรรายงาน)',
      'ปรับ margin +5% เพิ่มกำไรทั้งกิจการอย่างมีนัยสำคัญ', '+0.4');
  else if (ctx.gm_pct < 30)
    add('yellow', 'กำไรขั้นต้นยังเพิ่มได้', `กำไรขั้นต้น ${ctx.gm_pct}%`,
      'คุมต้นทุนวัตถุดิบหลัก (ไม้/สี) และเพิ่มสัดส่วนงานมาร์จิ้นสูง', '', '+0.2');
  if (ctx.ar_d90 > 0)
    add('red', 'ลูกหนี้ค้างเกิน 90 วัน', `มียอดค้างเกิน 90 วัน ${money(ctx.ar_d90)} เสี่ยงเป็นหนี้สูญ`,
      'ติดตามทวงถามด่วน พิจารณาตั้งสำรองหนี้สงสัยจะสูญ และทบทวนเครดิตลูกค้ารายนี้',
      `เก็บได้ = เงินสด +${money(ctx.ar_d90)}`, '');
  if (ctx.dso > 60)
    add('red', 'เก็บเงินลูกค้าช้า', `DSO ${ctx.dso} วัน (ควร ≤ 45)`,
      'วางบิลทันทีที่ส่งมอบ ตั้งเงื่อนไขมัดจำ/วางบิลเป็นงวด และติดตามลูกหนี้เชิงรุก',
      'ลด DSO เหลือ 45 วัน ช่วยให้เงินสดเข้าเร็วขึ้น', '+0.3');
  else if (ctx.dso > 45)
    add('yellow', 'การเก็บเงินช้ากว่าเทอม', `DSO ${ctx.dso} วัน`,
      'ติดตามลูกหนี้ที่ใกล้ครบกำหนดล่วงหน้า', '', '+0.1');
  if (ctx.runway_months !== null && ctx.runway_months < 3)
    add('red', 'เงินสำรองต่ำมาก', `Runway เหลือ ${ctx.runway_months} เดือน`,
      'ชะลอรายจ่ายไม่จำเป็น เร่งเก็บลูกหนี้ เจรจาขยายเครดิตเจ้าหนี้ และเตรียมวงเงินสำรอง', '', '+0.3');
  else if (ctx.runway_months !== null && ctx.runway_months < 6)
    add('yellow', 'เงินสำรองค่อนข้างตึง', `Runway ${ctx.runway_months} เดือน`,
      'คุมกระแสเงินสดและติดตามพยากรณ์ 13 สัปดาห์ใกล้ชิด', '', '+0.1');
  if (ctx.scrap_pct > 7)
    add('red', 'ของเสียสูง', `Scrap ${ctx.scrap_pct}% (มูลค่า ${money(ctx.scrap_cost)})`,
      'หาสาเหตุของเสีย (วัตถุดิบ/ฝีมือ/เครื่องจักร) และเพิ่ม QC ระหว่างผลิต',
      `ลดของเสียครึ่งหนึ่ง ≈ ประหยัด ${money(Math.round(ctx.scrap_cost / 2))}`, '');
  if (ctx.dead_value > 0)
    add('yellow', 'มีของตายจมในคลัง', `มูลค่าของไม่เคลื่อนไหวเกิน 1 ปี ${money(ctx.dead_value)}`,
      'ระบายสต็อก/ลดราคา/นำไปใช้กับงานอื่น เพื่อปลดเงินที่จม', `ปลดเงินจม ${money(ctx.dead_value)}`, '');
  if (ctx.reorder_count > 0)
    add('yellow', 'วัตถุดิบใกล้หมด', `${ctx.reorder_count} รายการถึงจุดสั่งซื้อ (ROP)`,
      'สั่งซื้อตามจุด ROP เพื่อกันสายการผลิตหยุด (ดูแท็บคลังสินค้า)', '', '');
  if (ctx.otd_pct >= 0 && ctx.otd_pct < 85)
    add('yellow', 'ส่งมอบไม่ตรงเวลา', `On-time delivery ${ctx.otd_pct}%`,
      'ทบทวนการวางแผนผลิต/lead time และสื่อสารวันส่งกับลูกค้าตามจริง',
      'ส่งตรงเวลาช่วยให้เก็บเงินเร็วขึ้น (ลด DSO)', '');
  if (ctx.expense_to_sales_pct > 80)
    add('yellow', 'ค่าใช้จ่ายต่อยอดขายสูง', `${ctx.expense_to_sales_pct}% ของยอดขาย`,
      'ตรวจหมวดที่กินสัดส่วนมาก (แท็บต้นทุน) แล้วหาทางลด', '', '');
  if (ctx.ot_pct > 20)
    add('yellow', 'ค่าล่วงเวลา (OT) สูง', `OT ${ctx.ot_pct}% ของค่าจ้าง`,
      'ทบทวนการวางแผนกำลังคน/คิวงาน อาจคุ้มกว่าจ้างเพิ่มหรือกระจายงาน', '', '');
  if (ctx.top_customer_pct > 40)
    add('yellow', 'พึ่งพาลูกค้ารายเดียวมาก', `${ctx.top_customer_name} คิดเป็น ${ctx.top_customer_pct}% ของยอดขาย`,
      'กระจายฐานลูกค้าเพื่อลดความเสี่ยงหากเสียลูกค้ารายนี้', '', '');

  const rank = { red: 3, yellow: 2, green: 1 };
  recs.sort((a, b) => rank[b.severity] - rank[a.severity]);
  if (!recs.length)
    add('green', 'สถานะการเงินแข็งแรง', 'ไม่พบสัญญาณความเสี่ยงสำคัญจาก KPI ปัจจุบัน',
      'รักษาวินัยการเงินและติดตาม Financial Score อย่างต่อเนื่อง', '', '');
  return recs;
}
