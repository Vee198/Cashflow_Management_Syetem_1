// ============================================================
// verify.mjs — โหลด schema+seed เข้า SQLite ในหน่วยความจำ
// แล้วรันฟังก์ชันใน analytics.js เทียบกับข้อมูลจริง เพื่อตรวจความถูกต้อง
// รัน: node test/verify.mjs
// ============================================================
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import * as A from '../src/analytics.js';

const ROOT = new URL('..', import.meta.url).pathname;
const db = new DatabaseSync(':memory:');
db.exec(readFileSync(ROOT + 'schema.sql', 'utf8'));
db.exec(readFileSync(ROOT + 'seed.sql', 'utf8'));

const q = (sql) => db.prepare(sql).all();
const asOf = '2026-06-04';
const baht = (s) => '฿' + (Math.round(s) / 100).toLocaleString('en-US');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name} ${detail}`); }
  else { fail++; console.log(`  ✗ FAIL: ${name} ${detail}`); }
}

// ---------- load ----------
const cash = q('SELECT * FROM cash_transactions');
const invoices = q('SELECT * FROM invoices');
const bills = q('SELECT * FROM bills');
const jobs = q('SELECT * FROM jobs');
const jobCosts = q('SELECT * FROM job_costs');
const expenses = q('SELECT * FROM expenses');
const items = q('SELECT * FROM inventory_items');
const moves = q('SELECT * FROM inventory_movements');
const payslips = q('SELECT p.*, e.name AS emp_name, e.emp_type FROM payslips p LEFT JOIN employees e ON e.id=p.employee_id');
const revenue = q("SELECT COALESCE(SUM(amount_satang),0) s FROM invoices WHERE status!='void'")[0].s;

console.log('\n=== A. เงินสด & Runway ===');
const coh = A.cashOnHand(cash);
const rw = A.burnAndRunway(cash, asOf, 3);
console.log(`  เงินสดในมือ = ${baht(coh.total_satang)} | เผาสุทธิ/เดือน = ${baht(rw.net_burn_satang)} | runway = ${rw.runway_months} เดือน (${rw.status})`);
check('เงินสด > 0', coh.total_satang > 0);
check('runway เป็นตัวเลขหรือ null', rw.runway_months === null || typeof rw.runway_months === 'number');

console.log('\n=== B. Aging & CCC ===');
const ar = A.arAging(invoices, asOf);
const ap = A.apAging(bills, asOf);
console.log(`  AR รวมค้าง = ${baht(ar.total)} | เกิน90วัน = ${baht(ar.d90_plus)} | AP รวมค้าง = ${baht(ap.total)}`);
check('มีลูกหนี้ค้างเกิน 90 วัน (INV-207)', ar.d90_plus > 0, `= ${baht(ar.d90_plus)}`);
const ccc = A.cashConversionCycle({ avgAR: ar.total, creditSales: revenue, avgAP: ap.total, cogs: A.cogsBreakdown(jobCosts).total_satang, avgInventory: A.inventoryValue(items).total_satang, windowDays: 90 });
console.log(`  DSO=${ccc.dso} DIO=${ccc.dio} DPO=${ccc.dpo} → CCC=${ccc.ccc} วัน`);
check('CCC คำนวณได้', !isNaN(ccc.ccc));

console.log('\n=== C. ต้นทุน & ค่าสี ===');
const cogs = A.cogsBreakdown(jobCosts);
const gm = A.grossMargin(revenue, cogs.total_satang);
const paint = A.paintAnalysis({ jobCosts, jobs, revenueSatang: revenue });
console.log(`  ยอดขาย=${baht(revenue)} COGS=${baht(cogs.total_satang)} กำไรขั้นต้น=${gm.gross_margin_pct}%`);
console.log(`  ค่าสีรวม=${baht(paint.paint_total_satang)} | %ยอดขาย=${paint.paint_pct_of_revenue}% | %COGS=${paint.paint_pct_of_cogs}% | ต่อบาน=${baht(paint.paint_per_door_satang)} | แนวโน้ม=${paint.trend_direction} (${paint.status})`);
check('ค่าสี > 0', paint.paint_total_satang > 0);
check('ค่าสีเป็นสัดส่วนสูง (>20% COGS)', paint.paint_pct_of_cogs > 20, `= ${paint.paint_pct_of_cogs}%`);
check('paint trend มีข้อมูลรายเดือน', paint.trend.length >= 4);

console.log('\n=== ค่าใช้จ่ายต่อยอดขาย ===');
const e2s = A.expenseToSales(expenses, revenue);
console.log(`  ค่าใช้จ่ายรวม=${baht(e2s.total_expense_satang)} = ${e2s.expense_to_sales_pct}% ของยอดขาย | หมวดบนสุด: ${e2s.rows[0].category} ${e2s.rows[0].pct_of_sales}%`);
check('expense-to-sales > 0', e2s.expense_to_sales_pct > 0);

console.log('\n=== กำไรรายงาน (job profitability) ===');
const jp = A.jobProfitability(jobs, jobCosts);
console.log(`  งานแย่สุด: ${jp[0].external_id} margin ${jp[0].margin_pct}% | งานดีสุด: ${jp[jp.length-1].external_id} margin ${jp[jp.length-1].margin_pct}%`);
check('คำนวณกำไรครบทุกงาน', jp.length === jobs.length);

console.log('\n=== D. งบประมาณ & พยากรณ์ ===');
const budgets = q('SELECT * FROM budgets');
const revByMonth = {}; q("SELECT substr(issue_date,1,7) m, SUM(amount_satang) s FROM invoices WHERE status!='void' GROUP BY m").forEach(r=>revByMonth[r.m]=r.s);
const bva = A.budgetVsActual({ budgets, expenses, revenueByMonth: revByMonth, period: '2026-06' });
check('budget vs actual คืนแถว', bva.length > 0, `= ${bva.length} หมวด`);
const w13 = A.thirteenWeekForecast({ openingCashSatang: rw.cash_satang, invoices, bills, recurringWeeklySatang: Math.round(rw.avg_outflow_satang/4.33), asOf });
console.log(`  13-week: สัปดาห์ที่เงินติดลบครั้งแรก = ${w13.first_negative_week ?? 'ไม่มี (ไม่ติดลบ)'} | ยอดสิ้นสัปดาห์13 = ${baht(w13.weeks[12].balance_satang)}`);
check('13-week คืน 13 สัปดาห์', w13.weeks.length === 13);
const lr = A.longRangeForecast({ openingCashSatang: rw.cash_satang, avgMonthlyInflow: rw.avg_inflow_satang, avgMonthlyOutflow: rw.avg_outflow_satang, months: 18, asOf });
console.log(`  ระยะยาว: base=${lr.base.depletion_month ?? 'รอด'} | ดีขึ้น=${lr.optimistic.depletion_month ?? 'รอด'} | แย่ลง=${lr.pessimistic.depletion_month ?? 'รอด'}`);
check('3 ฉากทัศน์ครบ', lr.base && lr.optimistic && lr.pessimistic);

console.log('\n=== G. การผลิต ===');
const pm = A.productionMetrics(jobs);
const sc = A.scrapCost(jobs, jobCosts);
console.log(`  Yield=${pm.yield_pct}% Scrap=${pm.scrap_pct}% Rework=${pm.rework_pct}% OTD=${pm.on_time_delivery_pct}% Fill=${pm.fill_rate_pct}% Lead=${pm.avg_lead_time_days}วัน`);
console.log(`  มูลค่าของเสีย = ${baht(sc.scrap_cost_satang)}`);
check('yield อยู่ระหว่าง 0–100', pm.yield_pct > 0 && pm.yield_pct <= 100);
check('OTD คำนวณได้', pm.on_time_delivery_pct >= 0);
check('scrap cost > 0', sc.scrap_cost_satang > 0);

console.log('\n=== H. คลังสินค้า ===');
const iv = A.inventoryValue(items);
const ra = A.reorderAlerts(items);
const ds = A.deadStock(items, moves, asOf);
const abc = A.abcAnalysis(items, moves, asOf);
console.log(`  มูลค่าสต็อก=${baht(iv.total_satang)} | ของใกล้หมด=${ra.length}รายการ | ของตาย=${baht(ds.dead_value_satang)} ของช้า=${baht(ds.slow_value_satang)}`);
console.log(`  ABC: A=${abc.filter(x=>x.abc_class==='A').length} B=${abc.filter(x=>x.abc_class==='B').length} C=${abc.filter(x=>x.abc_class==='C').length}`);
check('ตรวจพบของใกล้หมด (สี PU ต่ำกว่า ROP)', ra.length > 0, `= ${ra.length} รายการ`);
check('ตรวจพบของตาย (สีรองพื้นเลิกใช้)', ds.dead_value_satang > 0, `= ${baht(ds.dead_value_satang)}`);
check('ABC จัดกลุ่มครบทุกชิ้น', abc.length === items.length);

console.log('\n=== I. เงินเดือน ===');
const ps = A.payrollSummary(payslips, '2026-06', revByMonth['2026-06'] || 0);
console.log(`  มิ.ย.: ${ps.headcount}คน (ประจำ${ps.full_time_count}/พาร์ท${ps.part_time_count}) | Gross=${baht(ps.total_gross_satang)} | Net=${baht(ps.total_net_satang)}`);
console.log(`  ปกส.ลูกจ้าง=${baht(ps.total_sso_satang)} นายจ้างสมทบ=${baht(ps.total_employer_sso_satang)} | ต้นทุนบริษัทจริง=${baht(ps.company_cost_satang)} | OT=${ps.ot_pct_of_payroll}%`);
check('headcount = 4', ps.headcount === 4);
check('ต้นทุนบริษัท > gross (รวมสมทบ)', ps.company_cost_satang > ps.total_gross_satang);
check('net < gross (หักภาษี+ปกส.)', ps.total_net_satang < ps.total_gross_satang);
// ตรวจกฎ ปกส.: พนักงานเงินเดือนสูงต้องหัก 750 บาท = 75000 สตางค์
check('ปกส.สูงสุด 750 บาท/คน', payslips.every(p => p.sso_satang <= 75000));

console.log(`\n========================================`);
console.log(`ผลทดสอบ: ผ่าน ${pass} / ล้มเหลว ${fail}`);
console.log(`========================================`);
process.exit(fail ? 1 : 0);
