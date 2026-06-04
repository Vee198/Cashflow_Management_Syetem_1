# IMPORT CONTRACT — สเปกข้อมูลสำหรับ Python ETL

> ระบบนี้ **ยังไม่มี GL** และยังไม่รู้รูปแบบไฟล์ดิบ
> เอกสารนี้คือ "ปลายทาง" ที่ Python ETL ของคุณต้องแปลงไฟล์ดิบให้ตรงตามนี้
> ETL ไม่ต้องรู้จักโครงสร้าง DB ภายใน — แค่ส่งข้อมูลตาม schema ด้านล่าง

---

## หลักการ
1. ส่งข้อมูลเป็น **CSV หรือ JSON** ทีละ "ชนิด" (entity) ผ่าน 1 endpoint เดียว
2. ทุกแถวต้องมี `source` และ `external_id` → ระบบทำ **upsert** (ยิงซ้ำไม่เบิ้ล)
3. เงินส่งเป็น **บาท (ทศนิยม 2 ตำแหน่ง)** — ระบบแปลงเป็นสตางค์เอง
4. วันที่รูปแบบ `YYYY-MM-DD`

---

## Endpoint
```
POST /api/import
Content-Type: application/json

{
  "source": "gl_export_2026q2",     // ชื่อชุดข้อมูล (กันซ้ำ)
  "entity": "invoices",              // ชนิดข้อมูล (ดูตาราง)
  "rows": [ { ... }, { ... } ]       // อาร์เรย์ของแถว
}
```
ตอบกลับ: `{ "batch_id", "inserted", "updated", "skipped", "errors": [...] }`

> อัปโหลดไฟล์ดิบเก็บไว้ก่อนได้ที่ `POST /api/import/file` (เก็บลง R2) แล้วค่อยให้ ETL ดึงไปแปลง

---

## ชนิดข้อมูล (entity) และฟิลด์

### 1. `customers`
| field | type | required | หมายเหตุ |
|-------|------|----------|----------|
| external_id | string | ✓ | รหัสลูกค้าจากระบบต้นทาง |
| name | string | ✓ | ชื่อลูกค้า |
| credit_terms_days | int | | เทอมเครดิต (วัน) |

### 2. `suppliers`
| external_id | string | ✓ | |
| name | string | ✓ | |
| category | string | | เช่น `paint`, `wood`, `hardware` |

### 3. `jobs` (ใบสั่งผลิต / งานรับจ้าง)
| external_id | string | ✓ | เลขที่งาน |
| customer_external_id | string | ✓ | อ้างถึงลูกค้า |
| description | string | | เช่น "ประตูไม้สัก 20 บาน" |
| quantity | int | | จำนวนบาน |
| quoted_price | number | | ราคาที่เสนอ (บาท) |
| status | string | | `quote`/`in_progress`/`done`/`delivered` |
| started_at | date | | วันเริ่มผลิต |
| completed_at | date | | วันผลิตเสร็จ |
| qty_ordered | int | | จำนวนที่ลูกค้าสั่ง (ใช้คำนวณ fill rate) |
| qty_produced | int | | จำนวนที่ผลิตจริง รวมของเสีย (ใช้คำนวณ yield/scrap) |
| qty_good | int | | จำนวนของดีผ่าน QC |
| qty_scrap | int | | จำนวนของเสียทิ้ง |
| qty_rework | int | | จำนวนที่ต้องแก้ซ่อม |
| promised_date | date | | วันนัดส่งที่สัญญา (ใช้คำนวณ on-time delivery) |
| delivered_date | date | | วันส่งมอบจริง |

> **Production Analysis** ใช้ฟิลด์กลุ่มนี้: Yield = qty_good/qty_produced, Scrap rate = qty_scrap/qty_produced,
> On-time delivery = delivered_date ≤ promised_date, Fill rate = qty_good/qty_ordered, Lead time = completed_at − started_at

### 4. `job_costs` (ต้นทุนรายงาน — แยกหมวด)
| external_id | string | ✓ | |
| job_external_id | string | ✓ | อ้างถึงงาน |
| cost_type | string | ✓ | `material_wood`/`material_paint`/`material_hardware`/`labor`/`overhead` |
| amount | number | ✓ | บาท |
| incurred_at | date | | |
> **สำคัญ:** ค่าสีต้องใช้ `cost_type = material_paint` เพื่อให้ Paint Cost Analysis ทำงาน

### 5. `invoices` (ลูกหนี้ / AR)
| external_id | string | ✓ | เลขที่ใบแจ้งหนี้ |
| customer_external_id | string | ✓ | |
| job_external_id | string | | ผูกกับงาน (ถ้ามี) |
| issue_date | date | ✓ | |
| due_date | date | ✓ | |
| amount | number | ✓ | ยอดรวม (บาท) |
| amount_paid | number | | ที่ชำระแล้ว |
| status | string | | `open`/`paid`/`partial`/`void` |

### 6. `bills` (เจ้าหนี้ / AP)
| external_id | string | ✓ | |
| supplier_external_id | string | ✓ | |
| issue_date | date | ✓ | |
| due_date | date | ✓ | |
| amount | number | ✓ | |
| amount_paid | number | | |
| category | string | | `paint`/`wood`/`hardware`/`utility`/`other` |
| status | string | | `open`/`paid`/`partial` |

### 7. `inventory_items`
| external_id | string | ✓ | |
| name | string | ✓ | |
| category | string | ✓ | `paint`/`wood`/`hardware` |
| unit | string | | เช่น `ลิตร`, `แผ่น` |
| unit_cost | number | | ต้นทุนต่อหน่วย (บาท) |
| qty_on_hand | number | | คงเหลือปัจจุบัน |
| reorder_point | number | | จุดสั่งซื้อ (ROP) |
| safety_stock | number | | สต็อกกันชน |
| lead_time_days | int | | เวลารอของจากซัพ (วัน) |
| bin_location | string | | ตำแหน่งเก็บ เช่น `A-01-3` |
| abc_class | string | | `A`/`B`/`C` (ถ้าไม่ส่ง ระบบคำนวณให้) |
| last_counted_at | date | | วันนับสต็อกล่าสุด |

### 8. `inventory_movements`
| external_id | string | ✓ | |
| item_external_id | string | ✓ | |
| movement_type | string | ✓ | `in`/`out`/`adjust` |
| qty | number | ✓ | |
| unit_cost | number | | |
| moved_at | date | ✓ | |
| job_external_id | string | | เบิกไปใช้กับงานไหน |

### 9. `expenses` (ค่าใช้จ่ายดำเนินงาน)
| external_id | string | ✓ | |
| category | string | ✓ | `salary`/`rent`/`utility`/`transport`/`paint`/`marketing`/`other` |
| amount | number | ✓ | |
| spent_at | date | ✓ | |
| note | string | | |

### 10. `cash_transactions` (เงินสดเข้า-ออกจริง — direct method)
| external_id | string | ✓ | |
| account | string | ✓ | เช่น `kbank`, `cash`, `scb` |
| direction | string | ✓ | `in`/`out` |
| amount | number | ✓ | |
| txn_date | date | ✓ | |
| category | string | | เช่น `customer_payment`/`supplier_payment`/`payroll` |
| ref | string | | อ้างอิงเอกสาร |

### 11. `budgets`
| external_id | string | ✓ | |
| period | string | ✓ | `YYYY-MM` |
| category | string | ✓ | ตรงกับหมวด expenses/revenue |
| budget_type | string | ✓ | `revenue`/`expense` |
| amount | number | ✓ | |

### 12. `employees` (พนักงาน)
| external_id | string | ✓ | รหัสพนักงาน |
| name | string | ✓ | ชื่อ |
| emp_type | string | ✓ | `full_time`/`part_time` |
| department | string | | `production`/`office`/`sales` |
| base_salary | number | | เงินเดือน/เดือน (พนักงานประจำ) |
| hourly_rate | number | | ค่าแรง/ชม. (พาร์ทไทม์) |
| ot_rate | number | | ค่า OT/ชม. (ไม่ส่ง = คิด 1.5× ของค่าแรงรายชม.) |
| sso_enrolled | int | | อยู่ประกันสังคม 1/0 (ดีฟอลต์ 1) |
| start_date | date | | |
| status | string | | `active`/`inactive` |

### 13. `payslips` (สลิปเงินเดือนรายเดือน)
| external_id | string | ✓ | |
| employee_external_id | string | ✓ | อ้างถึงพนักงาน |
| period | string | ✓ | `YYYY-MM` |
| work_days | number | | วันทำงาน |
| work_hours | number | | ชม.ทำงาน (พาร์ทไทม์ใช้คิดฐาน) |
| base_pay | number | | ค่าจ้างฐาน (ไม่ส่ง = ระบบคำนวณจาก emp) |
| ot_hours | number | | จำนวนชม. OT |
| ot_pay | number | | ค่า OT (ไม่ส่ง = ot_hours × ot_rate) |
| allowance | number | | เบี้ยเลี้ยง/ค่าตำแหน่ง |
| tax | number | | ภาษีหัก ณ ที่จ่าย (กรอก/ETL คำนวณ) |
| sso | number | | ประกันสังคม (ไม่ส่ง = ระบบคิด 5% สูงสุด 750) |
| other_deduction | number | | หักอื่นๆ |
| paid_date | date | | |

> **ระบบคำนวณให้อัตโนมัติถ้าไม่ส่งมา:** base_pay (จากประเภทพนักงาน), ot_pay (1.5×), sso (5% ฐาน 1,650–15,000 → 83–750 บาท),
> gross = base+ot+allowance, net = gross − tax − sso − other, และ employer_sso (นายจ้างสมทบ 5% = ต้นทุนบริษัทเพิ่ม)
> **ภาษีบุคคลธรรมดา** ซับซ้อน (ลดหย่อน) จึงให้ ETL/กรอกมือเป็นหลัก

---

## ตัวอย่าง (JSON)
```json
{
  "source": "gl_export_2026q2",
  "entity": "job_costs",
  "rows": [
    {"external_id":"JC-1001","job_external_id":"JOB-220","cost_type":"material_paint","amount":18500.00,"incurred_at":"2026-05-12"},
    {"external_id":"JC-1002","job_external_id":"JOB-220","cost_type":"material_wood","amount":42000.00,"incurred_at":"2026-05-10"}
  ]
}
```

## ตัวอย่าง (CSV — ส่งเป็น text/csv ที่ /api/import/csv?entity=job_costs&source=...)
```csv
external_id,job_external_id,cost_type,amount,incurred_at
JC-1001,JOB-220,material_paint,18500.00,2026-05-12
JC-1002,JOB-220,material_wood,42000.00,2026-05-10
```

---

## ลำดับการ import ที่แนะนำ (เพราะมี FK อ้างกัน)
1. `customers`, `suppliers`, `inventory_items`
2. `jobs`
3. `job_costs`, `invoices`, `bills`, `inventory_movements`
4. `expenses`, `cash_transactions`, `budgets`
