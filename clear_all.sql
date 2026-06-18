-- ============================================================
-- clear_all.sql — ล้างข้อมูล "ทั้งหมด" รวมค่าสี (material_purchases) เพื่อเริ่มต้นใหม่สะอาด
-- *** ใช้เมื่อต้องการรีเซ็ตทั้งระบบก่อนกรอก Actual data จริง ***
-- (ต่างจาก clear_imported.sql ที่เก็บค่าสีไว้ — อันนี้ลบหมดจริงๆ)
-- ใช้:
--   npx wrangler d1 execute cashflow_db --remote --file=./clear_all.sql
--   npx wrangler d1 execute cashflow_db --local  --file=./clear_all.sql
-- ============================================================

DELETE FROM payslips;
DELETE FROM employees;
DELETE FROM budgets;
DELETE FROM cash_transactions;
DELETE FROM expenses;
DELETE FROM inventory_movements;
DELETE FROM inventory_items;
DELETE FROM bills;
DELETE FROM invoices;
DELETE FROM job_costs;
DELETE FROM jobs;
DELETE FROM suppliers;
DELETE FROM customers;
DELETE FROM material_purchases;

-- ล้างประวัติ/เวอร์ชันการนำเข้าทั้งหมด
DELETE FROM import_rows;
DELETE FROM import_batches;

-- (ถ้ามีตาราง cycle_counts) ล้างด้วย
DELETE FROM cycle_counts;
