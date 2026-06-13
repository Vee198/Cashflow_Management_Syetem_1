-- ============================================================
-- clear_imported.sql — ล้างข้อมูลที่ import (แก้ปัญหาข้อมูลซ้ำจากการอัปโหลดหลายครั้ง)
-- *** เก็บ material_purchases (ค่าสีที่อัปโหลดไว้) ไว้ตามที่ลูกค้าต้องการ ***
-- หลังรัน → อัปโหลดไฟล์ข้อมูลใหม่ "ครั้งเดียว" (ระบบใช้ source ตามชื่อไฟล์ อัปซ้ำจะ upsert ไม่เบิ้ลอีก)
-- ใช้:
--   npx wrangler d1 execute cashflow_db --remote --file=./clear_imported.sql
--   npx wrangler d1 execute cashflow_db --local  --file=./clear_imported.sql
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
-- material_purchases: ไม่ลบ (เก็บค่าสีไว้)

-- ล้างประวัติ import ของชุดอื่น แต่เก็บของ material_purchases
DELETE FROM import_rows    WHERE entity != 'material_purchases';
DELETE FROM import_batches WHERE entity != 'material_purchases';
