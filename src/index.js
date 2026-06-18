// ============================================================
// index.js — Cloudflare Worker entry (Hono)
// REST API ใต้ /api/* ; static SPA เสิร์ฟผ่าน assets binding
// อ่าน CLAUDE.md + SKILL.md ก่อนแก้ไขเสมอ
// ============================================================
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as repo from './repo.js';
import * as A from './analytics.js';
import { runImport, parseCSV } from './import.js';

const app = new Hono();
app.use('/api/*', cors());

const ok = (c, data) => c.json({ ok: true, data });
const err = (c, e, code = 400) => c.json({ ok: false, error: String(e?.message || e) }, code);

// ============================================================
// AUTH — login + signed token (HMAC-SHA256) ผ่าน Web Crypto
// token = base64url(payload).base64url(signature); payload = {u, exp}
// ============================================================
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = new TextEncoder();
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return await crypto.subtle.sign('HMAC', key, enc.encode(data));
}
async function makeToken(env, user) {
  const payload = JSON.stringify({ u: user, exp: Date.now() + 1000 * 60 * 60 * 12 }); // 12 ชม.
  const p = b64url(enc.encode(payload));
  const sig = b64url(await hmac(env.AUTH_SECRET || 'dev-secret', p));
  return `${p}.${sig}`;
}
async function verifyToken(env, token) {
  if (!token) return null;
  const [p, sig] = token.split('.');
  if (!p || !sig) return null;
  const expected = b64url(await hmac(env.AUTH_SECRET || 'dev-secret', p));
  if (expected !== sig) return null;
  try {
    const payload = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

app.post('/api/login', async (c) => {
  try {
    const { username, password } = await c.req.json();
    const u = c.env.ADMIN_USER || 'admin';
    const pw = c.env.ADMIN_PASS || 'admin';
    if (username === u && password === pw) return ok(c, { token: await makeToken(c.env, username), user: username });
    return c.json({ ok: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }, 401);
  } catch (e) { return err(c, e); }
});

// middleware: บังคับ token กับทุก /api/* ยกเว้น login และ health
app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === '/api/login' || path === '/api/health') return next();
  const auth = c.req.header('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = await verifyToken(c.env, token);
  if (!payload) return c.json({ ok: false, error: 'unauthorized', auth_required: true }, 401);
  await next();
});

// asOf เริ่มต้น = วันนี้ (override ได้ด้วย ?as_of=YYYY-MM-DD)
const asOfOf = (c) => c.req.query('as_of') || new Date().toISOString().slice(0, 10);

app.get('/api/health', (c) => ok(c, { service: 'cashflow-system', time: new Date().toISOString() }));

// ---------- IMPORT (สำหรับ Python ETL) ----------
app.post('/api/import', async (c) => {
  try {
    const body = await c.req.json();
    if (!body.source || !body.entity || !Array.isArray(body.rows)) throw new Error('ต้องมี source, entity, rows');
    return ok(c, await runImport(c.env.DB, body));
  } catch (e) { return err(c, e); }
});

app.post('/api/import/csv', async (c) => {
  try {
    const entity = c.req.query('entity');
    const source = c.req.query('source');
    if (!entity || !source) throw new Error('ต้องระบุ ?entity= และ ?source=');
    const text = await c.req.text();
    const rows = parseCSV(text);
    return ok(c, await runImport(c.env.DB, { source, entity, rows }));
  } catch (e) { return err(c, e); }
});

// อัปโหลดไฟล์ดิบเก็บไว้ใน R2 (ให้ ETL ดึงไปแปลงทีหลัง)
app.post('/api/import/file', async (c) => {
  try {
    const name = c.req.query('name') || `upload-${Date.now()}`;
    const body = await c.req.arrayBuffer();
    await c.env.FILES.put(`raw/${name}`, body);
    return ok(c, { stored: `raw/${name}`, bytes: body.byteLength });
  } catch (e) { return err(c, e); }
});

app.get('/api/import/batches', async (c) =>
  ok(c, await repo.all(c.env.DB, `SELECT * FROM import_batches ORDER BY id DESC LIMIT 100`)));

// รายละเอียดของเวอร์ชัน/batch หนึ่ง (สำหรับแท็บ Log)
app.get('/api/import/batch/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const batch = await repo.one(c.env.DB, `SELECT * FROM import_batches WHERE id = ?`, id);
    const rows = await repo.all(c.env.DB,
      `SELECT id, entity, external_id, status, error, created_at FROM import_rows WHERE batch_id = ? ORDER BY id LIMIT 500`, id);
    return ok(c, { batch, rows });
  } catch (e) { return err(c, e); }
});

// ---------- DASHBOARD สรุป (หน้าแรก เจ้าของถามบ่อย) ----------
app.get('/api/summary', async (c) => {
  try {
    const db = c.env.DB;
    const asOf = asOfOf(c);
    const [cashTxns, invoices, bills, jobCosts, expenses, items] = await Promise.all([
      repo.getCashTxns(db), repo.getInvoices(db), repo.getBills(db),
      repo.getJobCosts(db), repo.getExpenses(db), repo.getInventoryItems(db),
    ]);
    const revenue = await repo.getTotalRevenue(db);
    const cogs = A.cogsBreakdown(jobCosts);
    const runway = A.burnAndRunway(cashTxns, asOf, 3);
    const liq = A.liquidityRatios({
      cash_satang: runway.cash_satang,
      ar_satang: await repo.getOutstandingAR(db),
      inventory_satang: A.inventoryValue(items).total_satang,
      ap_satang: await repo.getOutstandingAP(db),
    });
    const e2s = A.expenseToSales(expenses, revenue);
    const paint = A.paintAnalysis({ jobCosts, jobs: await repo.getJobs(db), revenueSatang: revenue });
    return ok(c, {
      as_of: asOf,
      cash_on_hand_satang: runway.cash_satang,
      runway,
      liquidity: liq,
      gross_margin: A.grossMargin(revenue, cogs.total_satang),
      expense_to_sales: e2s,
      paint,
    });
  } catch (e) { return err(c, e, 500); }
});

// ---------- DASHBOARD ลูกค้า (เงินสด/รับ/ค้างรับ + ค่าใช้จ่ายแยกหมวด) ----------
app.get('/api/dashboard', async (c) => {
  try {
    const db = c.env.DB;
    const asOf = asOfOf(c);
    const [cashTxns, invoices, expenses, customers, budgets, jobs, purchases, employees] = await Promise.all([
      repo.getCashTxns(db), repo.getInvoices(db), repo.getExpenses(db), repo.getCustomers(db), repo.getBudgets(db), repo.getJobs(db), repo.getMaterialPurchases(db), repo.getEmployees(db),
    ]);
    const cash = A.cashOnHand(cashTxns).total_satang;
    // ── ตัวกรองช่วงวันที่ (from–to) กรองข้อมูลเชิงงวด (ยอดขาย/ต้นทุน/ค่าสี/กำไร); เงินสดในมือ = ยอดคงเหลือปัจจุบัน ไม่กรอง ──
    const from = c.req.query('from'), to = c.req.query('to');
    const rng = from && to;
    const inR = (d) => !rng || (d && d >= from && d <= to);
    const invF = rng ? invoices.filter((i) => inR(i.issue_date)) : invoices;
    const expF = rng ? expenses.filter((e) => inR(e.spent_at)) : expenses;
    const jobF = rng ? jobs.filter((j) => inR(j.started_at)) : jobs;
    const purF = rng ? purchases.filter((p) => inR(p.purchase_date)) : purchases;
    let billed = 0, received = 0;
    for (const i of invF) { if (i.status === 'void') continue; billed += i.amount_satang; received += (i.amount_paid_satang || 0); }
    const eb = A.expenseBuckets(expF);
    let jobsCost = 0, jobsPaint = 0, jw = 0, jl = 0, jsh = 0;
    for (const j of jobF) { jobsCost += j.total_cost_satang || 0; jobsPaint += j.cost_paint_satang || 0; jw += j.cost_wood_satang || 0; jl += j.cost_labor_satang || 0; jsh += j.cost_shipping_satang || 0; }
    const overheadExp = eb.buckets.marketing + eb.buckets.ads + eb.buckets.rent + eb.buckets.overhead;
    let mpAll = 0, mpPaint = 0;
    for (const p of purF) { mpAll += p.total_incl_vat_satang || 0; if (p.category === 'paint') mpPaint += p.total_incl_vat_satang || 0; }
    const xb = eb.by_category;
    // ── COGS (P&L) = ต้นทุนวัสดุ/ผลิต "ที่จ่ายจริง" จาก expenses + material_purchases เท่านั้น ──
    //    ต้นทุนในชีต order (J-M: jobsCost/jobsPaint/jw/jl/jsh) ใช้สำหรับวิเคราะห์กำไรรายออเดอร์ (margin tab) เท่านั้น
    //    *ไม่บวกซ้ำใน P&L* เพื่อเลี่ยงการนับต้นทุน 2-3 รอบ (เคยทำกำไรสุทธิติดลบเทียม)
    // เงินเดือนพนักงาน (auto จาก employees) × จำนวนเดือนที่มีข้อมูลในช่วง — ฝ่ายผลิต→COGS, อื่นๆ→OH
    const monthsSet = new Set();
    for (const j of jobF) { const k = (j.started_at || '').slice(0, 7); if (k) monthsSet.add(k); }
    for (const e of expF) { const k = (e.spent_at || '').slice(0, 7); if (k) monthsSet.add(k); }
    const monthsCount = monthsSet.size || 1;
    const sal = A.employeeSalary(employees);
    const salCogs = sal.cogs * monthsCount, salOh = sal.oh * monthsCount;
    const prodCost = eb.buckets.production + mpAll + salCogs;              // COGS = รายจ่ายหมวดผลิต + วัตถุดิบ + เงินเดือนฝ่ายผลิต
    const paintCost = (xb.paint || 0) + mpPaint;
    const buckets = { production: prodCost, marketing: eb.buckets.marketing, ads: eb.buckets.ads, rent: eb.buckets.rent, overhead: eb.buckets.overhead };
    const ps = A.profitByProductionType(jobF);
    const jobsRevenue = ps.self.revenue + ps.outsourced.revenue;
    const ohTotal = overheadExp + salOh;                                  // OH รวมเงินเดือนสนง./บริหาร
    const cogs_breakdown = [
      { name: 'ค่าสี', satang: paintCost },
      { name: 'ค่าไม้', satang: (xb.wood || 0) },
      { name: 'ค่าแรง', satang: (xb.labor || 0) },
      { name: 'เงินเดือน (ฝ่ายผลิต)', satang: salCogs + (xb.salary || 0) },
      { name: 'วัตถุดิบอื่น/ฮาร์ดแวร์', satang: (mpAll - mpPaint) + (xb.hardware || 0) },
    ].filter((x) => x.satang > 0).sort((a, b) => b.satang - a.satang);
    const oh_breakdown = [
      { name: 'เงินเดือน (สนง./บริหาร)', satang: salOh },
      { name: 'ค่าเช่า', satang: xb.rent || 0 },
      { name: 'ค่าน้ำ-ไฟ', satang: xb.utility || 0 },
      { name: 'การตลาด', satang: xb.marketing || 0 },
      { name: 'โฆษณา (Ads)', satang: xb.ads || 0 },
      { name: 'ค่าขนส่ง', satang: xb.transport || 0 },
      { name: 'อื่นๆ', satang: (xb.other || 0) + (xb.overhead || 0) },
    ].filter((x) => x.satang > 0).sort((a, b) => b.satang - a.satang);
    return ok(c, {
      as_of: asOf, from: from || null, to: to || null,
      cash_on_hand_satang: cash,
      received_satang: received,
      outstanding_satang: billed - received,
      billed_revenue_satang: billed,
      jobs_revenue_satang: jobsRevenue,
      production_cost_satang: prodCost,
      paint_cost_satang: paintCost,
      gross_profit_satang: jobsRevenue - prodCost,                              // กำไรขั้นต้น = ยอดขาย − COGS
      gross_margin_pct: jobsRevenue ? Math.round((jobsRevenue - prodCost) / jobsRevenue * 1000) / 10 : 0,
      net_profit_satang: jobsRevenue - prodCost - ohTotal,                       // กำไรสุทธิ = ยอดขาย − COGS − OH (รวมเงินเดือน)
      cogs_total_satang: prodCost, cogs_breakdown,
      oh_total_satang: ohTotal, oh_breakdown,
      runway: A.burnAndRunway(cashTxns, asOf, 3),
      expense_buckets: { buckets, by_category: eb.by_category, total_satang: prodCost + ohTotal },
      ar_by_customer: A.arByCustomer(invF, customers, asOf),
      ar_aging: A.arAging(invF, asOf),   // อิง "เลยกำหนด" (overdue จาก due_date) ให้สอดคล้องกับตาราง
      ap_summary: A.apFromExpenses(expF, asOf),
      dpo_days: A.apFromExpenses(expF, asOf).dpo_days,
      fixed_variable: A.fixedVariable(expF),
      sales_monthly: A.salesMonthly(invF, budgets),
      production_split: ps,
    });
  } catch (e) { return err(c, e, 500); }
});

// ---------- PAINT / MATERIAL COST ANALYSIS (วิเคราะห์ค่าสี) ----------
app.get('/api/paint-analysis', async (c) => {
  try {
    // ── โมเดลใหม่: ค่าสี/วัสดุ มาจากชีต expenses (หมวด paint/wood/hardware/labor) ──
    //    + รวม legacy material_purchases (ถ้ายังมีข้อมูลเก่า) เพื่อความเข้ากันได้
    const MAT = { paint: 'ค่าสี', wood: 'ค่าไม้', hardware: 'ฮาร์ดแวร์/วัตถุดิบ', labor: 'ค่าแรงผลิต' };
    const exps = await repo.getExpenses(c.env.DB);
    const mapped = exps.filter((e) => MAT[e.category]).map((e) => ({
      vendor: e.vendor || null, brand: null, item_type: MAT[e.category],
      category: e.category, qty: 0, total_incl_vat_satang: e.amount_satang || 0, purchase_date: e.spent_at,
    }));
    const mats = await repo.getMaterialPurchases(c.env.DB);
    const all = [...mapped, ...mats];
    const norm = (s) => (s || '').toString().trim();
    const fv = c.req.query('vendor'), fb = c.req.query('brand'), ft = c.req.query('item_type');
    const match = (val, f) => f === '(ไม่ระบุ)' ? !norm(val) : norm(val) === f;
    const from = c.req.query('from'), to = c.req.query('to');
    let rows = all;
    if (fv) rows = rows.filter((p) => match(p.vendor, fv));
    if (fb) rows = rows.filter((p) => match(p.brand, fb));
    if (ft) rows = rows.filter((p) => match(p.item_type, ft));
    if (from) rows = rows.filter((p) => (p.purchase_date || '') >= from);
    if (to) rows = rows.filter((p) => (p.purchase_date || '') <= to);
    return ok(c, A.materialPurchaseAnalysis(rows));
  } catch (e) { return err(c, e, 500); }
});

// ---------- งบกำไรขาดทุนรายเดือน (P&L) ----------
app.get('/api/pnl', async (c) => {
  try {
    const [jobs, expenses, employees] = await Promise.all([repo.getJobs(c.env.DB), repo.getExpenses(c.env.DB), repo.getEmployees(c.env.DB)]);
    return ok(c, {
      monthly: A.pnlMonthly(jobs, expenses, employees),
      cogs_cats: ['paint', 'wood', 'hardware', 'labor', 'salary'],
      oh_cats: ['rent', 'utility', 'marketing', 'ads', 'transport', 'overhead', 'other', 'salary_oh'],
    });
  } catch (e) { return err(c, e, 500); }
});

// ---------- CASH & LIQUIDITY ----------
app.get('/api/cash', async (c) => {
  try {
    const db = c.env.DB;
    const cashTxns = await repo.getCashTxns(db);
    return ok(c, { on_hand: A.cashOnHand(cashTxns), runway: A.burnAndRunway(cashTxns, asOfOf(c), 3) });
  } catch (e) { return err(c, e, 500); }
});

// ---------- AGING & CCC ----------
app.get('/api/aging', async (c) => {
  try {
    const db = c.env.DB;
    const asOf = asOfOf(c);
    const [invoices, bills, items] = await Promise.all([repo.getInvoices(db), repo.getBills(db), repo.getInventoryItems(db)]);
    const ar = A.arAging(invoices, asOf);
    const ap = A.apAging(bills, asOf);
    const revenue = await repo.getTotalRevenue(db);
    const cogs = await repo.getTotalCOGS(db);
    const ccc = A.cashConversionCycle({
      avgAR: await repo.getOutstandingAR(db), creditSales: revenue,
      avgAP: await repo.getOutstandingAP(db), cogs,
      avgInventory: A.inventoryValue(items).total_satang, windowDays: 90,
    });
    return ok(c, { ar_aging: ar, ap_aging: ap, ccc });
  } catch (e) { return err(c, e, 500); }
});

// ---------- COST / MARGIN / PAINT ----------
app.get('/api/cost', async (c) => {
  try {
    const db = c.env.DB;
    const [jobCosts, jobs, expenses] = await Promise.all([repo.getJobCosts(db), repo.getJobs(db), repo.getExpenses(db)]);
    // ต้นทุนจากชีต order (J-M: cost_wood/paint/labor/shipping) — เลขต้นทุนต่อออเดอร์
    const jc = A.jobCostBreakdown(jobs);
    const revenue = jc.revenue_satang || await repo.getTotalRevenue(db);
    const paintPctRev = revenue ? Math.round(jc.cost_paint_satang / revenue * 1000) / 10 : 0;
    const paintPctCogs = jc.total_satang ? Math.round(jc.cost_paint_satang / jc.total_satang * 1000) / 10 : 0;
    return ok(c, {
      cogs: { total_satang: jc.total_satang, breakdown: jc.breakdown },
      gross_margin: A.grossMargin(revenue, jc.total_satang),
      paint: {
        paint_pct_of_revenue: paintPctRev, paint_pct_of_cogs: paintPctCogs,
        paint_per_door_satang: jc.doors ? Math.round(jc.cost_paint_satang / jc.doors) : 0,
        paint_total_satang: jc.cost_paint_satang, trend: [], trend_direction: 'flat',
        status: paintPctRev > 25 ? 'red' : paintPctRev > 15 ? 'yellow' : 'green',
      },
      expense_to_sales: A.expenseToSales(expenses, revenue),
      job_profitability: A.jobProfitability(jobs, jobCosts),
    });
  } catch (e) { return err(c, e, 500); }
});

// ---------- BUDGET & FORECAST ----------
app.get('/api/budget', async (c) => {
  try {
    const db = c.env.DB;
    const period = c.req.query('period') || new Date().toISOString().slice(0, 7);
    const [budgets, expenses] = await Promise.all([repo.getBudgets(db), repo.getExpenses(db)]);
    const revByMonth = await repo.getRevenueByMonth(db);
    return ok(c, { period, rows: A.budgetVsActual({ budgets, expenses, revenueByMonth: revByMonth, period }) });
  } catch (e) { return err(c, e, 500); }
});

app.get('/api/forecast', async (c) => {
  try {
    const db = c.env.DB;
    const asOf = asOfOf(c);
    const [cashTxns, invoices, bills] = await Promise.all([repo.getCashTxns(db), repo.getInvoices(db), repo.getBills(db)]);
    const runway = A.burnAndRunway(cashTxns, asOf, 3);
    const week13 = A.thirteenWeekForecast({
      openingCashSatang: runway.cash_satang, invoices, bills,
      recurringWeeklySatang: Math.round(runway.avg_outflow_satang / 4.33), asOf,
    });
    const months = Math.max(1, Math.min(60, +c.req.query('months') || 18));
    const longRange = A.longRangeForecast({
      openingCashSatang: runway.cash_satang,
      avgMonthlyInflow: runway.avg_inflow_satang, avgMonthlyOutflow: runway.avg_outflow_satang,
      months, asOf,
    });
    return ok(c, { runway, thirteen_week: week13, long_range: longRange });
  } catch (e) { return err(c, e, 500); }
});

// ---------- PRODUCTION ----------
app.get('/api/production', async (c) => {
  try {
    const db = c.env.DB;
    const [jobs, jobCosts] = await Promise.all([repo.getJobs(db), repo.getJobCosts(db)]);
    return ok(c, { metrics: A.productionMetrics(jobs), scrap_cost: A.scrapCost(jobs, jobCosts) });
  } catch (e) { return err(c, e, 500); }
});

// ---------- INVENTORY / WAREHOUSE ----------
app.get('/api/inventory', async (c) => {
  try {
    const db = c.env.DB;
    const asOf = asOfOf(c);
    const [items, movements] = await Promise.all([repo.getInventoryItems(db), repo.getInventoryMovements(db)]);
    return ok(c, {
      value: A.inventoryValue(items),
      reorder_alerts: A.reorderAlerts(items),
      dead_stock: A.deadStock(items, movements, asOf),
      aging: A.inventoryAging(items, movements, asOf),
      abc: A.abcAnalysis(items, movements, asOf),
      items,
    });
  } catch (e) { return err(c, e, 500); }
});

// ---------- PAYROLL (เงินเดือน) ----------
app.get('/api/payroll', async (c) => {
  try {
    const db = c.env.DB;
    const period = c.req.query('period') || (state_default_period());
    const [payslipsRaw, employees] = await Promise.all([repo.getPayslips(db), repo.getEmployees(db)]);
    const revByMonth = await repo.getRevenueByMonth(db);
    // ถ้าไม่มีสลิปของเดือนนี้ → สร้างจากเงินเดือนในชีตพนักงาน (employees.base_salary) + คิด ปกส. 5% สูงสุด 750
    let payslips = payslipsRaw, fromEmployees = false;
    if (!payslipsRaw.some((p) => p.period === period) && employees.length) {
      fromEmployees = true;
      const sso = (g) => Math.min(75000, Math.round((g || 0) * 0.05));
      payslips = employees.filter((e) => e.status !== 'inactive').map((e) => {
        const base = e.base_salary_satang || 0;
        return { employee_id: e.id, emp_name: e.name, emp_type: e.emp_type, department: e.department, period,
          base_pay_satang: base, ot_pay_satang: 0, gross_satang: base, tax_satang: 0, sso_satang: sso(base),
          other_deduction_satang: 0, net_satang: base - sso(base), employer_sso_satang: sso(base) };
      });
    }
    return ok(c, {
      period, from_employees: fromEmployees,
      summary: A.payrollSummary(payslips, period, revByMonth[period] || 0),
      all_time: A.payrollSummary(payslips, null, await repo.getTotalRevenue(db)),
      employees,
      payslips: payslips.filter((p) => p.period === period),
    });
  } catch (e) { return err(c, e, 500); }
});
function state_default_period() { return new Date().toISOString().slice(0, 7); }

// ---------- FINANCIAL STATEMENTS (งบการเงิน: จริง + dummy) ----------
app.get('/api/financials', async (c) => {
  try {
    const db = c.env.DB;
    const [jobCosts, expenses, cashTxns] = await Promise.all([
      repo.getJobCosts(db), repo.getExpenses(db), repo.getCashTxns(db),
    ]);
    const revenue = await repo.getTotalRevenue(db);
    const cogs = A.cogsBreakdown(jobCosts);
    const cash = A.cashOnHand(cashTxns).total_satang;
    const ar = await repo.getOutstandingAR(db);
    const ap = await repo.getOutstandingAP(db);
    const inv = await repo.getInventoryTotalValue(db);
    // ค่าสมมติ (ยังไม่มีข้อมูลจริง) — หน่วยสตางค์
    const DUMMY = {
      fixedAssetsSatang: 500000000, shortLoanSatang: 100000000, longDebtSatang: 200000000,
      paidInCapitalSatang: 100000000, depreciationSatang: 20000000, interestSatang: 8000000,
    };
    return ok(c, {
      income_statement: A.incomeStatement({
        revenueSatang: revenue, cogs, expenses,
        depreciationSatang: DUMMY.depreciationSatang, interestSatang: DUMMY.interestSatang, taxRate: 0.20,
      }),
      balance_sheet: A.balanceSheet({
        cashSatang: cash, arSatang: ar, inventorySatang: inv, apSatang: ap,
        fixedAssetsSatang: DUMMY.fixedAssetsSatang, shortLoanSatang: DUMMY.shortLoanSatang,
        longDebtSatang: DUMMY.longDebtSatang, paidInCapitalSatang: DUMMY.paidInCapitalSatang,
      }),
      dummy_fields: ['สินทรัพย์ถาวร', 'เงินกู้ระยะสั้น', 'หนี้สินระยะยาว', 'ทุนจดทะเบียน', 'ค่าเสื่อมราคา', 'ดอกเบี้ยจ่าย'],
    });
  } catch (e) { return err(c, e, 500); }
});

// ---------- RECOMMENDATIONS (ที่ปรึกษาการเงินอัตโนมัติ) ----------
app.get('/api/recommendations', async (c) => {
  try {
    const db = c.env.DB;
    const asOf = asOfOf(c);
    const [cashTxns, invoices, bills, jobCosts, jobs, expenses, items, movements, payslips, customers] = await Promise.all([
      repo.getCashTxns(db), repo.getInvoices(db), repo.getBills(db), repo.getJobCosts(db), repo.getJobs(db),
      repo.getExpenses(db), repo.getInventoryItems(db), repo.getInventoryMovements(db), repo.getPayslips(db), repo.getCustomers(db),
    ]);
    const revenue = await repo.getTotalRevenue(db);
    const cogs = A.cogsBreakdown(jobCosts);
    const gm = A.grossMargin(revenue, cogs.total_satang);
    const runway = A.burnAndRunway(cashTxns, asOf, 3);
    const ar = A.arAging(invoices, asOf);
    const ccc = A.cashConversionCycle({
      avgAR: await repo.getOutstandingAR(db), creditSales: revenue, avgAP: await repo.getOutstandingAP(db),
      cogs: cogs.total_satang, avgInventory: A.inventoryValue(items).total_satang, windowDays: 90,
    });
    const paint = A.paintAnalysis({ jobCosts, jobs, revenueSatang: revenue });
    const dead = A.deadStock(items, movements, asOf);
    const reorder = A.reorderAlerts(items);
    const prod = A.productionMetrics(jobs);
    const scrap = A.scrapCost(jobs, jobCosts);
    const e2s = A.expenseToSales(expenses, revenue);
    const pay = A.payrollSummary(payslips, null, revenue);
    const conc = A.customerConcentration(invoices, customers);
    const ctx = {
      gm_pct: gm.gross_margin_pct, dso: ccc.dso, dio: ccc.dio, ccc: ccc.ccc,
      ar_d90: ar.d90_plus, runway_months: runway.runway_months,
      dead_value: dead.dead_value_satang, reorder_count: reorder.length,
      scrap_pct: prod.scrap_pct, scrap_cost: scrap.scrap_cost_satang, otd_pct: prod.on_time_delivery_pct,
      expense_to_sales_pct: e2s.expense_to_sales_pct,
      paint_pct_revenue: paint.paint_pct_of_revenue, paint_trend: paint.trend_direction, paint_total: paint.paint_total_satang,
      ot_pct: pay.ot_pct_of_payroll, top_customer_pct: conc.top_pct, top_customer_name: conc.top_name,
    };
    return ok(c, { recommendations: A.recommendations(ctx), concentration: conc });
  } catch (e) { return err(c, e, 500); }
});

// ---------- รายการดิบ (drill-down) ----------
app.get('/api/list/:entity', async (c) => {
  try {
    const allowed = ['customers', 'suppliers', 'jobs', 'job_costs', 'invoices', 'bills',
      'inventory_items', 'inventory_movements', 'expenses', 'cash_transactions', 'budgets',
      'employees', 'payslips', 'material_purchases'];
    const entity = c.req.param('entity');
    if (!allowed.includes(entity)) throw new Error('entity ไม่ถูกต้อง');
    return ok(c, await repo.all(c.env.DB, `SELECT * FROM ${entity} ORDER BY id DESC LIMIT 500`));
  } catch (e) { return err(c, e); }
});

// ---------- ตารางข้อมูล + ช่วงวันที่ (Data table with date range) ----------
const DATE_COL = {
  invoices: 'issue_date', bills: 'issue_date', expenses: 'spent_at',
  cash_transactions: 'txn_date', job_costs: 'incurred_at', jobs: 'started_at',
  inventory_movements: 'moved_at', payslips: 'period', material_purchases: 'purchase_date',
};
app.get('/api/table/:entity', async (c) => {
  try {
    const allowed = ['customers', 'suppliers', 'jobs', 'job_costs', 'invoices', 'bills',
      'inventory_items', 'inventory_movements', 'expenses', 'cash_transactions', 'budgets',
      'employees', 'payslips', 'material_purchases'];
    const entity = c.req.param('entity');
    if (!allowed.includes(entity)) throw new Error('entity ไม่ถูกต้อง');
    const from = c.req.query('from'), to = c.req.query('to');
    const col = DATE_COL[entity];
    let sql = `SELECT * FROM ${entity}`;
    const binds = [];
    if (col && from && to) { sql += ` WHERE ${col} BETWEEN ? AND ?`; binds.push(from, to); }
    sql += ` ORDER BY id DESC LIMIT 1000`;
    const rows = await repo.all(c.env.DB, sql, ...binds);
    return ok(c, { entity, date_col: col || null, count: rows.length, rows });
  } catch (e) { return err(c, e); }
});

// ---------- บันทึกข้อมูลด้วยมือ (กรอกผ่านหน้าเว็บ) ----------
app.post('/api/manual/:entity', async (c) => {
  try {
    const entity = c.req.param('entity');
    const row = await c.req.json();
    const source = row.source || 'manual';
    const external_id = row.external_id || `${entity}-${Date.now()}`;
    return ok(c, await runImport(c.env.DB, { source, entity, rows: [{ ...row, external_id }] }));
  } catch (e) { return err(c, e); }
});

// fallback: ให้ static assets จัดการ (SPA)
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
// end of worker
