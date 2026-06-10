// ============================================================
// import.js — รับข้อมูลตาม docs/IMPORT_CONTRACT.md
// ทำ idempotent upsert ด้วยคีย์ (source, external_id)
// เงินที่รับเป็น "บาท" → แปลงเป็นสตางค์ก่อนเก็บ
// รองรับ Python ETL ยิงเข้ามา (ยังไม่ผูกกับรูปแบบ GL ใดๆ)
// ============================================================

const baht = (v) => Math.round((Number(v) || 0) * 100); // บาท → สตางค์

// map entity → ฟังก์ชัน upsert ทีละแถว (คืน 'inserted' | 'updated')
const HANDLERS = {
  customers: async (db, r, source) =>
    upsert(db, `customers`, ['name', 'phone', 'credit_terms_days'], source, r.external_id, {
      name: r.name, phone: r.phone ?? null, credit_terms_days: r.credit_terms_days ?? 30,
    }),

  // ── composite: 1 แถวออเดอร์ → สร้าง ลูกค้า + งาน + ใบแจ้งหนี้ (มัดจำ/ค้างรับ) ──
  order: async (db, r, source) => {
    const custExt = (r.phone && String(r.phone).trim()) ? 'PH-' + String(r.phone).trim() : 'CU-' + (r.customer_name || r.external_id);
    await HANDLERS.customers(db, { external_id: custExt, name: r.customer_name || custExt, phone: r.phone }, source);
    // ต้นทุนรวม = ผลรวมช่องแยก (ไม้+สี+แรง+ส่ง) ถ้ามี; ไม่งั้นใช้ total_cost ที่กรอกตรง
    const comp = (Number(r.cost_wood) || 0) + (Number(r.cost_paint) || 0) + (Number(r.cost_labor) || 0) + (Number(r.cost_shipping) || 0);
    const totalCost = comp > 0 ? comp : (Number(r.total_cost) || 0);
    await HANDLERS.jobs(db, {
      external_id: r.external_id, customer_external_id: custExt, description: r.description,
      quantity: r.quantity, quoted_price: r.total_price, status: r.status ?? 'in_progress',
      started_at: r.issue_date, promised_date: r.due_date,
      production_type: r.production_type, total_cost: totalCost,
      cost_wood: r.cost_wood, cost_paint: r.cost_paint, cost_labor: r.cost_labor, cost_shipping: r.cost_shipping,
    }, source);
    const total = Number(r.total_price) || 0, dep = Number(r.deposit) || 0;
    const st = dep <= 0 ? 'open' : (dep >= total ? 'paid' : 'partial');
    return HANDLERS.invoices(db, {
      external_id: r.external_id, customer_external_id: custExt, job_external_id: r.external_id,
      issue_date: r.issue_date, due_date: r.due_date || r.issue_date,
      amount: r.total_price, amount_paid: r.deposit, status: st,
    }, source);
  },

  suppliers: async (db, r, source) =>
    upsert(db, `suppliers`, ['name', 'category'], source, r.external_id, {
      name: r.name, category: r.category ?? null,
    }),

  jobs: async (db, r, source) => {
    const customer_id = await lookupId(db, 'customers', source, r.customer_external_id);
    return upsert(db, `jobs`,
      ['customer_id', 'description', 'quantity', 'quoted_price_satang', 'status', 'started_at', 'completed_at',
       'production_type', 'total_cost_satang', 'cost_wood_satang', 'cost_paint_satang', 'cost_labor_satang', 'cost_shipping_satang',
       'qty_ordered', 'qty_produced', 'qty_good', 'qty_scrap', 'qty_rework', 'promised_date', 'delivered_date'],
      source, r.external_id, {
        customer_id, description: r.description ?? null, quantity: r.quantity ?? 0,
        quoted_price_satang: baht(r.quoted_price), status: r.status ?? 'quote',
        started_at: r.started_at ?? null, completed_at: r.completed_at ?? null,
        production_type: r.production_type ?? 'self', total_cost_satang: baht(r.total_cost),
        cost_wood_satang: baht(r.cost_wood), cost_paint_satang: baht(r.cost_paint),
        cost_labor_satang: baht(r.cost_labor), cost_shipping_satang: baht(r.cost_shipping),
        qty_ordered: r.qty_ordered ?? r.quantity ?? 0, qty_produced: r.qty_produced ?? 0,
        qty_good: r.qty_good ?? 0, qty_scrap: r.qty_scrap ?? 0, qty_rework: r.qty_rework ?? 0,
        promised_date: r.promised_date ?? null, delivered_date: r.delivered_date ?? null,
      });
  },

  job_costs: async (db, r, source) => {
    const job_id = await lookupId(db, 'jobs', source, r.job_external_id);
    return upsert(db, `job_costs`, ['job_id', 'cost_type', 'amount_satang', 'incurred_at'],
      source, r.external_id, {
        job_id, cost_type: r.cost_type, amount_satang: baht(r.amount), incurred_at: r.incurred_at ?? null,
      });
  },

  invoices: async (db, r, source) => {
    const customer_id = await lookupId(db, 'customers', source, r.customer_external_id);
    const job_id = r.job_external_id ? await lookupId(db, 'jobs', source, r.job_external_id) : null;
    return upsert(db, `invoices`,
      ['customer_id', 'job_id', 'issue_date', 'due_date', 'amount_satang', 'amount_paid_satang', 'status'],
      source, r.external_id, {
        customer_id, job_id, issue_date: r.issue_date, due_date: r.due_date,
        amount_satang: baht(r.amount), amount_paid_satang: baht(r.amount_paid), status: r.status ?? 'open',
      });
  },

  bills: async (db, r, source) => {
    const supplier_id = await lookupId(db, 'suppliers', source, r.supplier_external_id);
    return upsert(db, `bills`,
      ['supplier_id', 'issue_date', 'due_date', 'amount_satang', 'amount_paid_satang', 'category', 'status'],
      source, r.external_id, {
        supplier_id, issue_date: r.issue_date, due_date: r.due_date,
        amount_satang: baht(r.amount), amount_paid_satang: baht(r.amount_paid),
        category: r.category ?? null, status: r.status ?? 'open',
      });
  },

  inventory_items: async (db, r, source) =>
    upsert(db, `inventory_items`,
      ['name', 'category', 'unit', 'unit_cost_satang', 'qty_on_hand', 'reorder_point',
       'safety_stock', 'lead_time_days', 'bin_location', 'abc_class', 'last_counted_at'],
      source, r.external_id, {
        name: r.name, category: r.category, unit: r.unit ?? null,
        unit_cost_satang: baht(r.unit_cost), qty_on_hand: r.qty_on_hand ?? 0, reorder_point: r.reorder_point ?? 0,
        safety_stock: r.safety_stock ?? 0, lead_time_days: r.lead_time_days ?? 0,
        bin_location: r.bin_location ?? null, abc_class: r.abc_class ?? null, last_counted_at: r.last_counted_at ?? null,
      }),

  inventory_movements: async (db, r, source) => {
    const item_id = await lookupId(db, 'inventory_items', source, r.item_external_id);
    const job_id = r.job_external_id ? await lookupId(db, 'jobs', source, r.job_external_id) : null;
    return upsert(db, `inventory_movements`,
      ['item_id', 'movement_type', 'qty', 'unit_cost_satang', 'moved_at', 'job_id'],
      source, r.external_id, {
        item_id, movement_type: r.movement_type, qty: r.qty ?? 0,
        unit_cost_satang: baht(r.unit_cost), moved_at: r.moved_at, job_id,
      });
  },

  expenses: async (db, r, source) =>
    upsert(db, `expenses`, ['category', 'amount_satang', 'spent_at', 'note'], source, r.external_id, {
      category: r.category, amount_satang: baht(r.amount), spent_at: r.spent_at, note: r.note ?? null,
    }),

  material_purchases: async (db, r, source) =>
    upsert(db, `material_purchases`,
      ['purchase_date', 'vendor', 'inv_no', 'brand', 'item_type', 'base', 'color_code', 'qty', 'unit',
       'unit_price_satang', 'total_incl_vat_satang', 'total_excl_vat_satang', 'vat_satang', 'category'],
      source, r.external_id, {
        purchase_date: r.purchase_date ?? null, vendor: r.vendor ?? null, inv_no: r.inv_no ?? null,
        brand: r.brand ?? null, item_type: r.item_type ?? null, base: r.base ?? null, color_code: r.color_code ?? null,
        qty: r.qty ?? 0, unit: r.unit ?? null,
        unit_price_satang: baht(r.unit_price), total_incl_vat_satang: baht(r.total_incl_vat),
        total_excl_vat_satang: baht(r.total_excl_vat), vat_satang: baht(r.vat), category: r.category ?? 'paint',
      }),

  cash_transactions: async (db, r, source) =>
    upsert(db, `cash_transactions`, ['account', 'direction', 'amount_satang', 'txn_date', 'category', 'ref'],
      source, r.external_id, {
        account: r.account, direction: r.direction, amount_satang: baht(r.amount),
        txn_date: r.txn_date, category: r.category ?? null, ref: r.ref ?? null,
      }),

  budgets: async (db, r, source) =>
    upsert(db, `budgets`, ['period', 'category', 'budget_type', 'amount_satang'], source, r.external_id, {
      period: r.period, category: r.category, budget_type: r.budget_type, amount_satang: baht(r.amount),
    }),

  employees: async (db, r, source) =>
    upsert(db, `employees`,
      ['name', 'emp_type', 'department', 'base_salary_satang', 'hourly_rate_satang', 'ot_rate_satang', 'sso_enrolled', 'start_date', 'status'],
      source, r.external_id, {
        name: r.name, emp_type: r.emp_type ?? 'full_time', department: r.department ?? null,
        base_salary_satang: baht(r.base_salary), hourly_rate_satang: baht(r.hourly_rate),
        ot_rate_satang: baht(r.ot_rate), sso_enrolled: r.sso_enrolled === 0 || r.sso_enrolled === '0' ? 0 : 1,
        start_date: r.start_date ?? null, status: r.status ?? 'active',
      }),

  payslips: async (db, r, source) => {
    const emp = await db.prepare(`SELECT * FROM employees WHERE source = ? AND external_id = ?`)
      .bind(source, r.employee_external_id).first();
    const employee_id = emp ? emp.id : null;
    const calc = computePayroll(r, emp);
    return upsert(db, `payslips`,
      ['employee_id', 'period', 'work_days', 'work_hours', 'base_pay_satang', 'ot_hours', 'ot_pay_satang',
       'allowance_satang', 'gross_satang', 'tax_satang', 'sso_satang', 'other_deduction_satang',
       'net_satang', 'employer_sso_satang', 'paid_date'],
      source, r.external_id, {
        employee_id, period: r.period, work_days: r.work_days ?? 0, work_hours: r.work_hours ?? 0,
        base_pay_satang: calc.base, ot_hours: r.ot_hours ?? 0, ot_pay_satang: calc.ot,
        allowance_satang: baht(r.allowance), gross_satang: calc.gross, tax_satang: calc.tax,
        sso_satang: calc.sso, other_deduction_satang: baht(r.other_deduction),
        net_satang: calc.net, employer_sso_satang: calc.employerSso, paid_date: r.paid_date ?? null,
      });
  },
};

// คำนวณเงินเดือน/ค่าแรง + OT + ประกันสังคม (กฎไทย) — ใช้เมื่อ ETL ไม่ได้คำนวณมาให้
// ประกันสังคม: ลูกจ้าง 5% ของค่าจ้าง, ฐานค่าจ้าง 1,650–15,000 บาท → หัก 83–750 บาท/เดือน
// นายจ้างสมทบอีก 5% (เป็นต้นทุนบริษัท)
const SSO_RATE = 0.05, SSO_WAGE_MIN = 165000, SSO_WAGE_MAX = 1500000; // satang
function computeThaiSSO(wageSatang, enrolled = true) {
  if (!enrolled) return 0;
  const base = Math.min(Math.max(wageSatang, SSO_WAGE_MIN), SSO_WAGE_MAX);
  return Math.round(base * SSO_RATE);
}
export function computePayroll(r, emp) {
  const empType = r.emp_type ?? emp?.emp_type ?? 'full_time';
  // ค่าจ้างฐาน: ถ้าส่ง base_pay มาใช้เลย; ไม่งั้นคำนวณ
  let base;
  if (r.base_pay != null) base = baht(r.base_pay);
  else if (empType === 'part_time') {
    const rate = emp ? emp.hourly_rate_satang : baht(r.hourly_rate);
    base = Math.round((r.work_hours || 0) * rate);
  } else {
    base = emp ? emp.base_salary_satang : baht(r.base_salary);
  }
  // OT: ถ้าส่ง ot_pay มาใช้เลย; ไม่งั้น ot_hours × ot_rate (ดีฟอลต์ 1.5x ของค่าแรงรายชม.)
  let ot;
  if (r.ot_pay != null) ot = baht(r.ot_pay);
  else {
    let otRate = emp ? emp.ot_rate_satang : baht(r.ot_rate);
    if (!otRate) {
      const hourly = emp && emp.hourly_rate_satang ? emp.hourly_rate_satang : Math.round(base / 30 / 8);
      otRate = Math.round(hourly * 1.5);
    }
    ot = Math.round((r.ot_hours || 0) * otRate);
  }
  const allowance = baht(r.allowance);
  const gross = base + ot + allowance;
  const enrolled = emp ? !!emp.sso_enrolled : r.sso_enrolled !== 0;
  const sso = r.sso != null ? baht(r.sso) : computeThaiSSO(base + ot, enrolled);
  const employerSso = sso; // นายจ้างสมทบเท่ากัน
  const tax = baht(r.tax); // ภาษีหัก ณ ที่จ่าย — รับจาก ETL/กรอกมือ (คำนวณภาษีบุคคลซับซ้อน)
  const other = baht(r.other_deduction);
  const net = gross - tax - sso - other;
  return { base, ot, gross, tax, sso, employerSso, net };
}

async function lookupId(db, table, source, externalId) {
  if (!externalId) return null;
  const row = await db.prepare(`SELECT id FROM ${table} WHERE source = ? AND external_id = ?`)
    .bind(source, externalId).first();
  return row ? row.id : null;
}

// upsert ตามคีย์ (source, external_id) — คืน 'inserted' หรือ 'updated'
async function upsert(db, table, cols, source, externalId, values) {
  const existing = await db.prepare(`SELECT id FROM ${table} WHERE source = ? AND external_id = ?`)
    .bind(source, externalId).first();
  if (existing) {
    const setSql = cols.map((c) => `${c} = ?`).join(', ');
    await db.prepare(`UPDATE ${table} SET ${setSql} WHERE id = ?`)
      .bind(...cols.map((c) => values[c]), existing.id).run();
    return 'updated';
  } else {
    const allCols = ['source', 'external_id', ...cols];
    const placeholders = allCols.map(() => '?').join(', ');
    await db.prepare(`INSERT INTO ${table} (${allCols.join(', ')}) VALUES (${placeholders})`)
      .bind(source, externalId, ...cols.map((c) => values[c])).run();
    return 'inserted';
  }
}

// ตัวแยก CSV แบบง่าย (รองรับเครื่องหมายคำพูด)
export function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const header = splitCSVLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCSVLine(line);
    const obj = {};
    header.forEach((h, i) => (obj[h.trim()] = cells[i] !== undefined ? cells[i] : null));
    return obj;
  });
}
function splitCSVLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// จุดเข้าหลัก: รับ batch → ประมวลทีละแถว → คืนสรุป
export async function runImport(db, { source, entity, rows }) {
  if (!HANDLERS[entity]) throw new Error(`ไม่รู้จัก entity: ${entity}`);
  const batch = await db.prepare(
    `INSERT INTO import_batches (source, entity, row_count) VALUES (?, ?, ?)`
  ).bind(source, entity, rows.length).run();
  const batchId = batch.meta.last_row_id;

  let inserted = 0, updated = 0, skipped = 0;
  const errors = [];
  for (const r of rows) {
    try {
      const result = await HANDLERS[entity](db, r, source);
      if (result === 'inserted') inserted++; else updated++;
      await db.prepare(
        `INSERT INTO import_rows (batch_id, entity, external_id, payload_json, status) VALUES (?, ?, ?, ?, 'ok')`
      ).bind(batchId, entity, r.external_id ?? null, JSON.stringify(r)).run();
    } catch (e) {
      skipped++;
      errors.push({ external_id: r.external_id, error: String(e.message || e) });
      await db.prepare(
        `INSERT INTO import_rows (batch_id, entity, external_id, payload_json, status, error) VALUES (?, ?, ?, ?, 'error', ?)`
      ).bind(batchId, entity, r.external_id ?? null, JSON.stringify(r), String(e.message || e)).run();
    }
  }
  await db.prepare(
    `UPDATE import_batches SET inserted = ?, updated = ?, skipped = ? WHERE id = ?`
  ).bind(inserted, updated, skipped, batchId).run();

  return { batch_id: batchId, inserted, updated, skipped, errors };
}
