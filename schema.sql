-- ============================================================
-- schema.sql — โครงสร้างฐานข้อมูล D1 (SQLite)
-- ระบบบริหารกระแสเงินสด ธุรกิจรับจ้างผลิตประตูไม้
-- เงินทั้งหมดเก็บเป็น "สตางค์" (integer) คอลัมน์ลงท้าย _satang
-- วันที่เก็บเป็น TEXT รูปแบบ YYYY-MM-DD
-- ============================================================

PRAGMA foreign_keys = ON;

-- ── Staging / Import layer ──────────────────────────────────
CREATE TABLE IF NOT EXISTS import_batches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT NOT NULL,
  entity        TEXT NOT NULL,
  row_count     INTEGER DEFAULT 0,
  inserted      INTEGER DEFAULT 0,
  updated       INTEGER DEFAULT 0,
  skipped       INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS import_rows (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id      INTEGER NOT NULL REFERENCES import_batches(id),
  entity        TEXT NOT NULL,
  external_id   TEXT,
  payload_json  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ok',  -- ok | error
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Master data ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  source            TEXT,
  external_id       TEXT,
  name              TEXT NOT NULL,
  phone             TEXT,
  credit_terms_days INTEGER DEFAULT 30,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, external_id)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT,
  external_id   TEXT,
  name          TEXT NOT NULL,
  category      TEXT,                 -- paint | wood | hardware | other
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, external_id)
);

-- ── Jobs (ใบสั่งผลิต / งานรับจ้าง) ───────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  source              TEXT,
  external_id         TEXT,
  customer_id         INTEGER REFERENCES customers(id),
  description         TEXT,
  quantity            INTEGER DEFAULT 0,    -- จำนวนบานที่สั่ง (= qty_ordered ถ้าไม่ระบุ)
  quoted_price_satang INTEGER DEFAULT 0,
  status              TEXT DEFAULT 'quote', -- quote|in_progress|done|delivered
  started_at          TEXT,
  completed_at        TEXT,
  -- ── แหล่งผลิต + ต้นทุน (แยกผลิตเอง/สั่งซัพ) ──────────────────
  production_type     TEXT DEFAULT 'self',  -- self = ผลิตเอง | outsourced = สั่งซัพพลายเออร์ผลิต
  total_cost_satang   INTEGER DEFAULT 0,    -- ต้นทุนรวม = ไม้+สี+แรง+ส่ง (คำนวณตอน import) หรือกรอกตรง
  cost_wood_satang    INTEGER DEFAULT 0,    -- ค่าไม้ (หรือยอดจ่ายซัพ กรณี outsourced)
  cost_paint_satang   INTEGER DEFAULT 0,    -- ค่าสี
  cost_labor_satang   INTEGER DEFAULT 0,    -- ค่าแรง
  cost_shipping_satang INTEGER DEFAULT 0,   -- ค่าส่ง
  -- ── Production analysis fields ──────────────────────────────
  qty_ordered         INTEGER DEFAULT 0,    -- จำนวนที่ลูกค้าสั่ง
  qty_produced        INTEGER DEFAULT 0,    -- จำนวนที่ผลิตจริง (รวมเสีย)
  qty_good            INTEGER DEFAULT 0,    -- ผ่าน QC (ของดี)
  qty_scrap           INTEGER DEFAULT 0,    -- ของเสียทิ้ง (scrap)
  qty_rework          INTEGER DEFAULT 0,    -- ต้องแก้ซ่อม (rework)
  promised_date       TEXT,                 -- วันนัดส่งที่สัญญาไว้
  delivered_date      TEXT,                 -- วันส่งมอบจริง
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, external_id)
);

CREATE TABLE IF NOT EXISTS job_costs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT,
  external_id   TEXT,
  job_id        INTEGER NOT NULL REFERENCES jobs(id),
  cost_type     TEXT NOT NULL,        -- material_wood|material_paint|material_hardware|labor|overhead
  amount_satang INTEGER NOT NULL DEFAULT 0,
  incurred_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, external_id)
);

-- ── AR / AP ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  source             TEXT,
  external_id        TEXT,
  customer_id        INTEGER REFERENCES customers(id),
  job_id             INTEGER REFERENCES jobs(id),
  issue_date         TEXT NOT NULL,
  due_date           TEXT NOT NULL,
  amount_satang      INTEGER NOT NULL DEFAULT 0,
  amount_paid_satang INTEGER NOT NULL DEFAULT 0,
  status             TEXT DEFAULT 'open',   -- open|paid|partial|void
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, external_id)
);

CREATE TABLE IF NOT EXISTS bills (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  source             TEXT,
  external_id        TEXT,
  supplier_id        INTEGER REFERENCES suppliers(id),
  issue_date         TEXT NOT NULL,
  due_date           TEXT NOT NULL,
  amount_satang      INTEGER NOT NULL DEFAULT 0,
  amount_paid_satang INTEGER NOT NULL DEFAULT 0,
  category           TEXT,                  -- paint|wood|hardware|utility|other
  status             TEXT DEFAULT 'open',
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, external_id)
);

-- ── Inventory ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  source           TEXT,
  external_id      TEXT,
  name             TEXT NOT NULL,
  category         TEXT NOT NULL,           -- paint|wood|hardware
  unit             TEXT,
  unit_cost_satang INTEGER DEFAULT 0,
  qty_on_hand      REAL DEFAULT 0,
  reorder_point    REAL DEFAULT 0,          -- จุดสั่งซื้อ (ROP)
  -- ── Warehouse / WMS fields (best-practice) ──────────────────
  safety_stock     REAL DEFAULT 0,          -- สต็อกกันชน (กันของขาดช่วง lead time)
  lead_time_days   INTEGER DEFAULT 0,       -- เวลารอสินค้าจากซัพพลายเออร์ (วัน)
  bin_location     TEXT,                    -- ตำแหน่งเก็บในคลัง เช่น A-01-3
  abc_class        TEXT,                    -- A|B|C (คำนวณได้/ระบุได้)
  last_counted_at  TEXT,                    -- วันนับสต็อกล่าสุด (cycle count)
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, external_id)
);

-- บันทึกการนับสต็อกแบบ cycle counting (นับทีละส่วนบ่อยๆ แทนนับทั้งปีครั้งเดียว)
CREATE TABLE IF NOT EXISTS cycle_counts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id          INTEGER NOT NULL REFERENCES inventory_items(id),
  counted_at       TEXT NOT NULL,
  system_qty       REAL DEFAULT 0,          -- ยอดในระบบ ณ เวลานับ
  counted_qty      REAL DEFAULT 0,          -- ยอดนับจริง
  variance_qty     REAL DEFAULT 0,          -- ส่วนต่าง (counted - system)
  counted_by       TEXT,
  note             TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  source           TEXT,
  external_id      TEXT,
  item_id          INTEGER NOT NULL REFERENCES inventory_items(id),
  movement_type    TEXT NOT NULL,           -- in|out|adjust
  qty              REAL NOT NULL DEFAULT 0,
  unit_cost_satang INTEGER DEFAULT 0,
  moved_at         TEXT NOT NULL,
  job_id           INTEGER REFERENCES jobs(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, external_id)
);

-- ── การซื้อสี/วัตถุดิบ (เก็บทุกพารามิเตอร์จาก dataset) ───────
CREATE TABLE IF NOT EXISTS material_purchases (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  source                TEXT,
  external_id           TEXT,
  purchase_date         TEXT,                 -- วันที่
  vendor                TEXT,                 -- ร้านค้า
  inv_no                TEXT,                 -- เลข Inv
  brand                 TEXT,                 -- แบรนด์
  item_type             TEXT,                 -- ชนิดสี
  base                  TEXT,                 -- เบส
  color_code            TEXT,                 -- รหัสสี
  qty                   REAL DEFAULT 0,       -- จำนวน
  unit                  TEXT,                 -- หน่วย
  unit_price_satang     INTEGER DEFAULT 0,    -- ราคา (ต่อหน่วย)
  total_incl_vat_satang INTEGER DEFAULT 0,    -- ราคารวมภาษี
  total_excl_vat_satang INTEGER DEFAULT 0,    -- ราคาก่อนภาษี
  vat_satang            INTEGER DEFAULT 0,    -- ยอดภาษี
  category              TEXT DEFAULT 'paint', -- paint|wood|hardware|other (จัดกลุ่ม)
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_mp_date   ON material_purchases(purchase_date);
CREATE INDEX IF NOT EXISTS idx_mp_vendor ON material_purchases(vendor);
CREATE INDEX IF NOT EXISTS idx_mp_brand  ON material_purchases(brand);

-- ── Operating expenses ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS expenses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT,
  external_id   TEXT,
  category      TEXT NOT NULL,        -- salary|rent|utility|transport|paint|wood|hardware|labor|marketing|ads|other
  amount_satang INTEGER NOT NULL DEFAULT 0,
  spent_at      TEXT NOT NULL,        -- วันที่ซื้อ/จ่าย
  note          TEXT,
  credit_term_days INTEGER DEFAULT 0, -- เครดิตเทอม (วัน) — 0 = จ่ายเงินสดทันที, >0 = ซื้อเชื่อ (AP)
  expense_kind  TEXT,                 -- fixed = ค่าใช้จ่ายคงที่ | variable = ผันแปร
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, external_id)
);

-- ── Payroll (เงินเดือน/ค่าแรง) ───────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  source             TEXT,
  external_id        TEXT,
  name               TEXT NOT NULL,
  emp_type           TEXT NOT NULL DEFAULT 'full_time', -- full_time | part_time
  department         TEXT,                  -- production|office|sales|...
  base_salary_satang INTEGER DEFAULT 0,     -- เงินเดือน/เดือน (พนักงานประจำ)
  hourly_rate_satang INTEGER DEFAULT 0,     -- ค่าแรง/ชม. (พาร์ทไทม์)
  ot_rate_satang     INTEGER DEFAULT 0,     -- ค่า OT ต่อชม. (ถ้าไม่ระบุ ระบบคิด 1.5x)
  sso_enrolled       INTEGER DEFAULT 1,     -- อยู่ประกันสังคมไหม (1/0)
  start_date         TEXT,
  status             TEXT DEFAULT 'active', -- active | inactive
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, external_id)
);

CREATE TABLE IF NOT EXISTS payslips (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  source              TEXT,
  external_id         TEXT,
  employee_id         INTEGER NOT NULL REFERENCES employees(id),
  period              TEXT NOT NULL,         -- YYYY-MM
  work_days           REAL DEFAULT 0,        -- วันทำงาน (พาร์ทไทม์ใช้คิดฐาน)
  work_hours          REAL DEFAULT 0,        -- ชม.ทำงาน (พาร์ทไทม์)
  base_pay_satang     INTEGER DEFAULT 0,     -- ค่าจ้างฐาน (ก่อน OT)
  ot_hours            REAL DEFAULT 0,
  ot_pay_satang       INTEGER DEFAULT 0,
  allowance_satang    INTEGER DEFAULT 0,     -- เบี้ยเลี้ยง/ค่าตำแหน่ง
  gross_satang        INTEGER DEFAULT 0,     -- รวมก่อนหัก = base + ot + allowance
  tax_satang          INTEGER DEFAULT 0,     -- ภาษีหัก ณ ที่จ่าย
  sso_satang          INTEGER DEFAULT 0,     -- ประกันสังคม (ส่วนลูกจ้าง 5%, สูงสุด 750)
  other_deduction_satang INTEGER DEFAULT 0,  -- หักอื่นๆ (เบิกล่วงหน้า ฯลฯ)
  net_satang          INTEGER DEFAULT 0,     -- รับสุทธิ = gross - tax - sso - other
  employer_sso_satang INTEGER DEFAULT 0,     -- ส่วนนายจ้างสมทบ (ต้นทุนบริษัทเพิ่ม)
  paid_date           TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, external_id)
);

-- ── Cash (direct method) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS cash_transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT,
  external_id   TEXT,
  account       TEXT NOT NULL,        -- kbank|scb|cash|...
  direction     TEXT NOT NULL,        -- in|out
  amount_satang INTEGER NOT NULL DEFAULT 0,
  txn_date      TEXT NOT NULL,
  category      TEXT,                 -- customer_payment|supplier_payment|payroll|...
  ref           TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, external_id)
);

-- ── Budget ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budgets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT,
  external_id   TEXT,
  period        TEXT NOT NULL,        -- YYYY-MM
  category      TEXT NOT NULL,
  budget_type   TEXT NOT NULL,        -- revenue|expense
  amount_satang INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, external_id)
);

-- ── Indexes ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_inv_due       ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_inv_status    ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_bill_due      ON bills(due_date);
CREATE INDEX IF NOT EXISTS idx_bill_status   ON bills(status);
CREATE INDEX IF NOT EXISTS idx_jobcost_job   ON job_costs(job_id);
CREATE INDEX IF NOT EXISTS idx_jobcost_type  ON job_costs(cost_type);
CREATE INDEX IF NOT EXISTS idx_cash_date     ON cash_transactions(txn_date);
CREATE INDEX IF NOT EXISTS idx_exp_date      ON expenses(spent_at);
CREATE INDEX IF NOT EXISTS idx_exp_cat       ON expenses(category);
CREATE INDEX IF NOT EXISTS idx_mov_item      ON inventory_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_mov_date      ON inventory_movements(moved_at);
CREATE INDEX IF NOT EXISTS idx_pay_period    ON payslips(period);
CREATE INDEX IF NOT EXISTS idx_pay_emp       ON payslips(employee_id);
