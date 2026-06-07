-- ============================================================
-- seed.sql — ข้อมูลตัวอย่าง: ธุรกิจรับจ้างผลิตประตูไม้
-- เน้นให้เห็น "ต้นทุนค่าสีจมเยอะ" + ลูกหนี้ค้าง + ของตายในคลัง
-- เงิน = สตางค์ (บาท × 100). ช่วงข้อมูล: ม.ค.–พ.ค. 2026 (วันนี้ ~ 4 มิ.ย. 2026)
-- ============================================================

DELETE FROM payslips; DELETE FROM employees; DELETE FROM budgets;
DELETE FROM cash_transactions; DELETE FROM expenses;
DELETE FROM inventory_movements; DELETE FROM inventory_items;
DELETE FROM bills; DELETE FROM invoices; DELETE FROM job_costs; DELETE FROM jobs;
DELETE FROM suppliers; DELETE FROM customers;

-- ── ลูกค้า ──────────────────────────────────────────────────
INSERT INTO customers (id, source, external_id, name, credit_terms_days) VALUES
 (1,'seed','C001','บจก. บ้านสวยพร็อพเพอร์ตี้',30),
 (2,'seed','C002','หจก. รุ่งเรืองก่อสร้าง',45),
 (3,'seed','C003','คุณสมชาย (รับเหมาบ้านเดี่ยว)',15);

-- ── ซัพพลายเออร์ ────────────────────────────────────────────
INSERT INTO suppliers (id, source, external_id, name, category) VALUES
 (1,'seed','S001','สีไม้ทีโอเอ ตัวแทน',  'paint'),
 (2,'seed','S002','โรงไม้เจริญพานิช',     'wood'),
 (3,'seed','S003','ฮาร์ดแวร์บานพับ-มือจับ','hardware');

-- ── พนักงาน ────────────────────────────────────────────────
INSERT INTO employees (id, source, external_id, name, emp_type, department, base_salary_satang, hourly_rate_satang, ot_rate_satang, sso_enrolled, start_date, status) VALUES
 (1,'seed','E001','นายช่าง ก. (ช่างไม้หัวหน้า)','full_time','production',2200000,0,0,1,'2023-01-10','active'),
 (2,'seed','E002','นายช่าง ข. (ช่างพ่นสี)',     'full_time','production',1800000,0,0,1,'2023-05-01','active'),
 (3,'seed','E003','คุณบัญชี ค. (ธุรการ-บัญชี)', 'full_time','office',    2500000,0,0,1,'2022-11-01','active'),
 (4,'seed','E004','นายเด็กฝึก ง. (พาร์ทไทม์)',  'part_time','production',0,6000,9000,1,'2025-09-01','active');

-- ── งาน (jobs) + production fields ──────────────────────────
-- quoted_price = ราคาขาย; qty fields ใช้คำนวณ yield/scrap/OTD/fill rate
INSERT INTO jobs (id,source,external_id,customer_id,description,quantity,quoted_price_satang,status,started_at,completed_at,qty_ordered,qty_produced,qty_good,qty_scrap,qty_rework,promised_date,delivered_date) VALUES
 (1,'seed','JOB-201',1,'ประตูไม้สักบานเดี่ยว 20 บาน',20, 36000000,'delivered','2026-01-08','2026-01-28',20,22,20,2,1,'2026-01-30','2026-01-29'),
 (2,'seed','JOB-202',2,'ประตูไม้แดงพร้อมวงกบ 30 บาน',30, 51000000,'delivered','2026-01-20','2026-02-15',30,33,30,3,2,'2026-02-18','2026-02-22'),
 (3,'seed','JOB-203',3,'ประตูไม้สักทอง 8 บาน',8,      18000000,'delivered','2026-02-10','2026-02-25',8,9,8,1,0,'2026-02-28','2026-02-27'),
 (4,'seed','JOB-204',1,'ประตูบานเลื่อนไม้ 15 บาน',15,  30000000,'delivered','2026-03-05','2026-03-26',15,17,15,2,1,'2026-03-28','2026-04-02'),
 (5,'seed','JOB-205',2,'ประตูไม้พ่นสีพิเศษ 25 บาน',25, 47500000,'delivered','2026-03-25','2026-04-20',25,28,25,3,2,'2026-04-22','2026-04-21'),
 (6,'seed','JOB-206',1,'ประตูไม้สัก+กระจก 12 บาน',12,  27600000,'delivered','2026-04-15','2026-05-08',12,13,12,1,1,'2026-05-10','2026-05-12'),
 (7,'seed','JOB-207',3,'ประตูไม้เนื้อแข็ง 10 บาน',10,  21000000,'done',     '2026-05-05','2026-05-26',10,11,10,1,0,'2026-05-30',NULL),
 (8,'seed','JOB-208',2,'ประตูไม้สักบานคู่ 18 บาน',18,  43200000,'in_progress','2026-05-20',NULL,18,0,0,0,0,'2026-06-25',NULL);

-- แหล่งผลิต + ต้นทุนรวม (ผลิตเอง margin ~30%, สั่งซัพ margin ~12–15%) เพื่อให้ Dashboard เห็นภาพชัด
UPDATE jobs SET production_type='self',       total_cost_satang=25200000 WHERE external_id='JOB-201'; -- 360k, margin 30%
UPDATE jobs SET production_type='outsourced', total_cost_satang=43860000 WHERE external_id='JOB-202'; -- 510k, margin 14%
UPDATE jobs SET production_type='self',       total_cost_satang=12240000 WHERE external_id='JOB-203'; -- 180k, margin 32%
UPDATE jobs SET production_type='outsourced', total_cost_satang=26100000 WHERE external_id='JOB-204'; -- 300k, margin 13%
UPDATE jobs SET production_type='self',       total_cost_satang=34200000 WHERE external_id='JOB-205'; -- 475k, margin 28%
UPDATE jobs SET production_type='outsourced', total_cost_satang=24288000 WHERE external_id='JOB-206'; -- 276k, margin 12%
UPDATE jobs SET production_type='self',       total_cost_satang=14490000 WHERE external_id='JOB-207'; -- 210k, margin 31%
UPDATE jobs SET production_type='outsourced', total_cost_satang=37584000 WHERE external_id='JOB-208'; -- 432k, margin 13%

-- ── ต้นทุนรายงาน (job_costs) — สีเป็นก้อนใหญ่ผิดปกติ ──────────
-- โครงสร้างต่อบานโดยรวม: ไม้สูงสุด, "สี" สูงผิดปกติ (~28–32% ของต้นทุน), ค่าแรง, โสหุ้ย
INSERT INTO job_costs (source,external_id,job_id,cost_type,amount_satang,incurred_at) VALUES
 ('seed','JC-201W',1,'material_wood',12000000,'2026-01-10'),
 ('seed','JC-201P',1,'material_paint',8200000,'2026-01-15'),
 ('seed','JC-201H',1,'material_hardware',2200000,'2026-01-12'),
 ('seed','JC-201L',1,'labor',4500000,'2026-01-28'),
 ('seed','JC-201O',1,'overhead',2400000,'2026-01-28'),

 ('seed','JC-202W',2,'material_wood',17500000,'2026-01-22'),
 ('seed','JC-202P',2,'material_paint',12500000,'2026-02-02'),
 ('seed','JC-202H',2,'material_hardware',3200000,'2026-01-25'),
 ('seed','JC-202L',2,'labor',6800000,'2026-02-15'),
 ('seed','JC-202O',2,'overhead',3600000,'2026-02-15'),

 ('seed','JC-203W',3,'material_wood',6200000,'2026-02-12'),
 ('seed','JC-203P',3,'material_paint',4600000,'2026-02-18'),
 ('seed','JC-203H',3,'material_hardware',900000,'2026-02-13'),
 ('seed','JC-203L',3,'labor',2400000,'2026-02-25'),
 ('seed','JC-203O',3,'overhead',1300000,'2026-02-25'),

 ('seed','JC-204W',4,'material_wood',10000000,'2026-03-07'),
 ('seed','JC-204P',4,'material_paint',7800000,'2026-03-14'),
 ('seed','JC-204H',4,'material_hardware',2600000,'2026-03-09'),
 ('seed','JC-204L',4,'labor',4200000,'2026-03-26'),
 ('seed','JC-204O',4,'overhead',2200000,'2026-03-26'),

 ('seed','JC-205W',5,'material_wood',15000000,'2026-03-27'),
 ('seed','JC-205P',5,'material_paint',14800000,'2026-04-06'),
 ('seed','JC-205H',5,'material_hardware',3000000,'2026-03-29'),
 ('seed','JC-205L',5,'labor',7000000,'2026-04-20'),
 ('seed','JC-205O',5,'overhead',3700000,'2026-04-20'),

 ('seed','JC-206W',6,'material_wood',9200000,'2026-04-17'),
 ('seed','JC-206P',6,'material_paint',8400000,'2026-04-28'),
 ('seed','JC-206H',6,'material_hardware',2800000,'2026-04-19'),
 ('seed','JC-206L',6,'labor',3800000,'2026-05-08'),
 ('seed','JC-206O',6,'overhead',2000000,'2026-05-08'),

 ('seed','JC-207W',7,'material_wood',7000000,'2026-05-07'),
 ('seed','JC-207P',7,'material_paint',6800000,'2026-05-18'),
 ('seed','JC-207H',7,'material_hardware',1600000,'2026-05-09'),
 ('seed','JC-207L',7,'labor',2900000,'2026-05-26'),
 ('seed','JC-207O',7,'overhead',1500000,'2026-05-26');

-- ── ใบแจ้งหนี้ (AR) — มีค้างเกินกำหนด + ครบกำหนดในอนาคต ───────
INSERT INTO invoices (source,external_id,customer_id,job_id,issue_date,due_date,amount_satang,amount_paid_satang,status) VALUES
 ('seed','INV-201',1,1,'2026-01-29','2026-02-28',36000000,36000000,'paid'),
 ('seed','INV-202',2,2,'2026-02-22','2026-04-08',51000000,51000000,'paid'),
 ('seed','INV-203',3,3,'2026-02-27','2026-03-14',18000000,18000000,'paid'),
 ('seed','INV-204',1,4,'2026-04-02','2026-05-02',30000000,15000000,'partial'),
 ('seed','INV-205',2,5,'2026-04-21','2026-06-05',47500000,0,'open'),
 ('seed','INV-206',1,6,'2026-05-12','2026-06-11',27600000,0,'open'),
 ('seed','INV-207',3,3,'2026-02-05','2026-02-20',9000000,0,'open');  -- ค้างเกิน 90 วัน (หนี้เสี่ยงเก็บไม่ได้)

-- ── บิลเจ้าหนี้ (AP) ────────────────────────────────────────
INSERT INTO bills (source,external_id,supplier_id,issue_date,due_date,amount_satang,amount_paid_satang,category,status) VALUES
 ('seed','BILL-301',1,'2026-04-05','2026-05-05',14800000,0,'paint','open'),   -- ค่าสีค้างจ่าย
 ('seed','BILL-302',2,'2026-04-10','2026-06-10',15000000,0,'wood','open'),
 ('seed','BILL-303',1,'2026-05-02','2026-06-02',8400000,0,'paint','open'),
 ('seed','BILL-304',3,'2026-05-08','2026-06-22',2800000,0,'hardware','open'),
 ('seed','BILL-305',2,'2026-03-01','2026-04-01',12000000,12000000,'wood','paid');

-- ── สินค้าคงคลัง (รวมของตาย 1 รายการ) ───────────────────────
INSERT INTO inventory_items (id,source,external_id,name,category,unit,unit_cost_satang,qty_on_hand,reorder_point,safety_stock,lead_time_days,bin_location,abc_class,last_counted_at) VALUES
 (1,'seed','IT-P01','สีพ่นไม้ TOA สีสัก','paint','ลิตร',45000,38,40,15,7,'A-01-1',NULL,'2026-05-20'),
 (2,'seed','IT-P02','น้ำยาเคลือบเงา PU','paint','ลิตร',62000,12,20,8,10,'A-01-2',NULL,'2026-05-20'),
 (3,'seed','IT-W01','ไม้สักแปรรูป','wood','แผ่น',85000,120,60,30,14,'B-02-1',NULL,'2026-05-15'),
 (4,'seed','IT-W02','ไม้แดงแปรรูป','wood','แผ่น',52000,80,40,20,14,'B-02-2',NULL,'2026-05-15'),
 (5,'seed','IT-H01','บานพับสแตนเลส','hardware','ชุด',18000,200,80,40,5,'C-03-1',NULL,'2026-05-10'),
 (6,'seed','IT-P03','สีรองพื้นสูตรเก่า (เลิกใช้)','paint','ลิตร',38000,25,0,0,7,'A-01-9',NULL,'2025-06-01');

-- ── การเคลื่อนไหวสต็อก (รายการ out ล่าสุดใช้เช็คของตาย) ───────
INSERT INTO inventory_movements (source,external_id,item_id,movement_type,qty,unit_cost_satang,moved_at,job_id) VALUES
 ('seed','MV-001',1,'in',100,45000,'2026-01-05',NULL),
 ('seed','MV-002',1,'out',30,45000,'2026-03-20',4),
 ('seed','MV-003',1,'out',32,45000,'2026-05-15',6),
 ('seed','MV-004',2,'in',40,62000,'2026-01-05',NULL),
 ('seed','MV-005',2,'out',15,62000,'2026-04-10',5),
 ('seed','MV-006',3,'in',200,85000,'2026-01-05',NULL),
 ('seed','MV-007',3,'out',80,85000,'2026-04-15',5),
 ('seed','MV-008',5,'in',300,18000,'2026-01-05',NULL),
 ('seed','MV-009',5,'out',100,18000,'2026-04-20',5),
 ('seed','MV-010',6,'in',50,38000,'2025-05-10',NULL),
 ('seed','MV-011',6,'out',25,38000,'2025-05-25',NULL);  -- ใช้ครั้งสุดท้าย พ.ค. 2025 → ของตาย >1 ปี

-- ── ค่าใช้จ่ายดำเนินงาน (รายเดือน) ──────────────────────────
INSERT INTO expenses (source,external_id,category,amount_satang,spent_at,note) VALUES
 ('seed','EX-0301','rent',3500000,'2026-03-01','ค่าเช่าโรงงาน'),
 ('seed','EX-0302','utility',1800000,'2026-03-05','ค่าไฟ-น้ำ'),
 ('seed','EX-0303','transport',900000,'2026-03-10','ค่าขนส่งส่งมอบ'),
 ('seed','EX-0304','marketing',400000,'2026-03-15','โฆษณา'),
 ('seed','EX-0401','rent',3500000,'2026-04-01','ค่าเช่าโรงงาน'),
 ('seed','EX-0402','utility',2100000,'2026-04-05','ค่าไฟ-น้ำ (พ่นสีเยอะ)'),
 ('seed','EX-0403','transport',1100000,'2026-04-10','ค่าขนส่ง'),
 ('seed','EX-0501','rent',3500000,'2026-05-01','ค่าเช่าโรงงาน'),
 ('seed','EX-0502','utility',1950000,'2026-05-05','ค่าไฟ-น้ำ'),
 ('seed','EX-0503','transport',1000000,'2026-05-10','ค่าขนส่ง'),
 ('seed','EX-0504','other',650000,'2026-05-20','ซ่อมเครื่องพ่นสี');

-- ── เงินสดเข้า-ออกจริง (direct method) ──────────────────────
INSERT INTO cash_transactions (source,external_id,account,direction,amount_satang,txn_date,category,ref) VALUES
 ('seed','CT-OPEN','kbank','in',120000000,'2026-01-02','opening','ยอดยกมา'),
 -- มี.ค.
 ('seed','CT-301','kbank','in',36000000,'2026-03-02','customer_payment','INV-201'),
 ('seed','CT-302','kbank','out',12000000,'2026-03-05','supplier_payment','BILL-305'),
 ('seed','CT-303','kbank','out',7800000,'2026-03-28','payroll','เงินเดือน มี.ค.'),
 ('seed','CT-304','kbank','out',6200000,'2026-03-12','opex','ค่าเช่า+ไฟ+ขนส่ง'),
 -- เม.ย.
 ('seed','CT-401','kbank','in',51000000,'2026-04-08','customer_payment','INV-202'),
 ('seed','CT-402','kbank','in',15000000,'2026-04-15','customer_payment','INV-204 บางส่วน'),
 ('seed','CT-403','kbank','out',8800000,'2026-04-28','payroll','เงินเดือน เม.ย.'),
 ('seed','CT-404','kbank','out',6700000,'2026-04-10','opex','ค่าเช่า+ไฟ+ขนส่ง'),
 ('seed','CT-405','kbank','out',12000000,'2026-04-20','supplier_payment','ค่าไม้'),
 -- พ.ค.
 ('seed','CT-501','kbank','in',18000000,'2026-05-04','customer_payment','INV-203'),
 ('seed','CT-502','kbank','out',8600000,'2026-05-28','payroll','เงินเดือน พ.ค.'),
 ('seed','CT-503','kbank','out',6450000,'2026-05-10','opex','ค่าเช่า+ไฟ+ขนส่ง'),
 ('seed','CT-504','kbank','out',14800000,'2026-05-15','supplier_payment','ค่าสีค้าง');

-- ── งบประมาณ (มิ.ย. 2026) ───────────────────────────────────
INSERT INTO budgets (source,external_id,period,category,budget_type,amount_satang) VALUES
 ('seed','BG-601','2026-06','rent','expense',3500000),
 ('seed','BG-602','2026-06','utility','expense',1800000),
 ('seed','BG-603','2026-06','transport','expense',1000000),
 ('seed','BG-604','2026-06','paint','expense',9000000),
 ('seed','BG-605','2026-06','salary','expense',9000000);

-- ── สลิปเงินเดือน (พ.ค. + มิ.ย. 2026) — sso/net คำนวณตามกฎไทย ──
-- ปกส.: 5% ฐาน 1,650–15,000 → พนักงานเงินเดือน >15,000 หัก 750 (75000 สตางค์)
INSERT INTO payslips (source,external_id,employee_id,period,work_days,work_hours,base_pay_satang,ot_hours,ot_pay_satang,allowance_satang,gross_satang,tax_satang,sso_satang,other_deduction_satang,net_satang,employer_sso_satang,paid_date) VALUES
 ('seed','PS-0501',1,'2026-05',26,0,2200000,12,180000,200000,2580000,90000,75000,0,2415000,75000,'2026-05-28'),
 ('seed','PS-0502',2,'2026-05',26,0,1800000,20,225000,150000,2175000,40000,75000,0,2060000,75000,'2026-05-28'),
 ('seed','PS-0503',3,'2026-05',26,0,2500000,0,0,300000,2800000,120000,75000,0,2605000,75000,'2026-05-28'),
 ('seed','PS-0504',4,'2026-05',0,160,960000,10,90000,0,1050000,0,52500,0,997500,52500,'2026-05-28'),
 ('seed','PS-0601',1,'2026-06',26,0,2200000,8,120000,200000,2520000,88000,75000,0,2357000,75000,'2026-06-28'),
 ('seed','PS-0602',2,'2026-06',26,0,1800000,16,180000,150000,2130000,38000,75000,0,2017000,75000,'2026-06-28'),
 ('seed','PS-0603',3,'2026-06',26,0,2500000,0,0,300000,2800000,120000,75000,0,2605000,75000,'2026-06-28'),
 ('seed','PS-0604',4,'2026-06',0,140,840000,6,54000,0,894000,0,44700,0,849300,44700,'2026-06-28');
