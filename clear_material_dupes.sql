-- ============================================================
-- clear_material_dupes.sql — ล้างค่าสีซ้ำ (material_purchases)
-- ใช้เมื่อเผลออัปโหลดไฟล์ค่าสี "คนละชื่อไฟล์" (คนละ source) จนข้อมูลเบิ้ล
-- หลักการ: เก็บ 1 แถวต่อ external_id (แถวที่ใส่ล่าสุด = id มากสุด) ลบที่เหลือ
-- ปลอดภัยเพราะ external_id เดียวกัน = รายการซื้อเดียวกัน (ETL ให้รหัสตามลำดับแถว)
-- ใช้:
--   npx wrangler d1 execute cashflow_db --remote --file=./clear_material_dupes.sql
--   npx wrangler d1 execute cashflow_db --local  --file=./clear_material_dupes.sql
-- ============================================================

-- ล้างประวัติ import ของแถวค่าสีที่กำลังจะถูกลบ
DELETE FROM import_rows
WHERE entity = 'material_purchases'
  AND external_id IN (
    SELECT external_id FROM material_purchases
  )
  AND batch_id IN (
    SELECT b.id FROM import_batches b
    WHERE b.entity = 'material_purchases'
      AND b.source NOT IN (
        SELECT source FROM material_purchases
        GROUP BY source ORDER BY MAX(id) DESC LIMIT 1
      )
  );

-- เก็บเฉพาะแถวล่าสุดต่อ external_id ลบตัวซ้ำที่เหลือ
DELETE FROM material_purchases
WHERE id NOT IN (
  SELECT MAX(id) FROM material_purchases GROUP BY external_id
);

-- ลบ batch เก่าที่ไม่มีแถวเหลืออยู่แล้ว
DELETE FROM import_batches
WHERE entity = 'material_purchases'
  AND source NOT IN (SELECT DISTINCT source FROM material_purchases);
