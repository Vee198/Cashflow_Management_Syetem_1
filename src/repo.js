// ============================================================
// repo.js — ชั้นเข้าถึงข้อมูล D1 (query helpers)
// ดึงข้อมูลดิบจาก D1 → ส่งให้ analytics.js คำนวณ
// ============================================================

export async function all(db, sql, ...params) {
  const { results } = await db.prepare(sql).bind(...params).all();
  return results || [];
}
export async function one(db, sql, ...params) {
  return await db.prepare(sql).bind(...params).first();
}

// ---------- raw fetchers ----------
export const getCashTxns = (db) => all(db, `SELECT * FROM cash_transactions ORDER BY txn_date`);
export const getInvoices = (db) => all(db, `SELECT * FROM invoices`);
export const getBills = (db) => all(db, `SELECT * FROM bills`);
export const getJobs = (db) => all(db, `SELECT * FROM jobs`);
export const getJobCosts = (db) => all(db, `SELECT * FROM job_costs`);
export const getExpenses = (db) => all(db, `SELECT * FROM expenses`);
export const getInventoryItems = (db) => all(db, `SELECT * FROM inventory_items`);
export const getInventoryMovements = (db) => all(db, `SELECT * FROM inventory_movements`);
export const getBudgets = (db) => all(db, `SELECT * FROM budgets`);
export const getCustomers = (db) => all(db, `SELECT * FROM customers`);
export const getSuppliers = (db) => all(db, `SELECT * FROM suppliers`);
export const getEmployees = (db) => all(db, `SELECT * FROM employees`);
export const getMaterialPurchases = (db) => all(db, `SELECT * FROM material_purchases`);
export const getPayslips = (db) => all(db, `SELECT p.*, e.name AS emp_name, e.emp_type, e.department FROM payslips p LEFT JOIN employees e ON e.id = p.employee_id`);

// รายได้ (recognized) = ยอด invoice ที่ไม่ void; รายเดือน
export async function getRevenueByMonth(db) {
  const rows = await all(
    db,
    `SELECT substr(issue_date,1,7) AS m, SUM(amount_satang) AS s
     FROM invoices WHERE status != 'void' GROUP BY m`
  );
  const map = {};
  for (const r of rows) map[r.m] = r.s;
  return map;
}

export async function getTotalRevenue(db) {
  const r = await one(db, `SELECT COALESCE(SUM(amount_satang),0) AS s FROM invoices WHERE status != 'void'`);
  return r?.s || 0;
}

// ยอดลูกหนี้/เจ้าหนี้คงค้างปัจจุบัน
export async function getOutstandingAR(db) {
  const r = await one(db, `SELECT COALESCE(SUM(amount_satang - amount_paid_satang),0) AS s
                           FROM invoices WHERE status NOT IN ('paid','void')`);
  return r?.s || 0;
}
export async function getOutstandingAP(db) {
  const r = await one(db, `SELECT COALESCE(SUM(amount_satang - amount_paid_satang),0) AS s
                           FROM bills WHERE status NOT IN ('paid','void')`);
  return r?.s || 0;
}
export async function getInventoryTotalValue(db) {
  const r = await one(db, `SELECT COALESCE(SUM(qty_on_hand * unit_cost_satang),0) AS s FROM inventory_items`);
  return Math.round(r?.s || 0);
}
export async function getTotalCOGS(db) {
  const r = await one(db, `SELECT COALESCE(SUM(amount_satang),0) AS s FROM job_costs`);
  return r?.s || 0;
}
