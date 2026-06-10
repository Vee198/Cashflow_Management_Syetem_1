-- ============================================================
-- clear_demo.sql — ลบข้อมูลตัวอย่าง (dummy) ออกจากฐานข้อมูล
-- ลบเฉพาะแถวที่ source='seed'  → เตรียมรับข้อมูลจริง (Actual GL)
-- *** ไม่แตะ material_purchases (ค่าสีที่อัปโหลดไว้) และข้อมูลจริงที่ import มา ***
-- ใช้:
--   npx wrangler d1 execute cashflow_db --remote --file=./clear_demo.sql
--   npx wrangler d1 execute cashflow_db --local  --file=./clear_demo.sql
-- ============================================================

DELETE FROM payslips           WHERE source = 'seed';
DELETE FROM employees          WHERE source = 'seed';
DELETE FROM budgets            WHERE source = 'seed';
DELETE FROM cash_transactions  WHERE source = 'seed';
DELETE FROM expenses           WHERE source = 'seed';
DELETE FROM inventory_movements WHERE source = 'seed';
DELETE FROM inventory_items    WHERE source = 'seed';
DELETE FROM bills              WHERE source = 'seed';
DELETE FROM invoices           WHERE source = 'seed';
DELETE FROM job_costs          WHERE source = 'seed';
DELETE FROM jobs               WHERE source = 'seed';
DELETE FROM suppliers          WHERE source = 'seed';
DELETE FROM customers          WHERE source = 'seed';

-- ล้างประวัติการนำเข้าของชุด demo (ถ้าต้องการเก็บ log การอัปโหลดจริงไว้ ให้ comment 2 บรรทัดนี้)
DELETE FROM import_rows    WHERE batch_id IN (SELECT id FROM import_batches WHERE source = 'seed');
DELETE FROM import_batches WHERE source = 'seed';
