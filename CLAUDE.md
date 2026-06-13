# CLAUDE.md — Cashflow System (ระบบบริหารกระแสเงินสด)

> **อ่านไฟล์นี้ทุกครั้งก่อนเริ่มงาน** และอ่าน `SKILL.md` คู่กันเสมอ
> ไฟล์นี้คือ "กติกาของโปรเจกต์" — สถาปัตยกรรม, คอนเวนชัน, วิธีรัน, และข้อตกลงเรื่องข้อมูล

---

## 1. โปรเจกต์นี้คืออะไร

Webapp สำหรับบริหาร **กระแสเงินสด (Cashflow), สินค้าคงคลัง (Inventory), และอายุหนี้ (Aging)**
ของธุรกิจ **รับจ้างผลิตประตูไม้ (job-shop / make-to-order)**

ผู้ใช้งานหลัก 2 คน — ต้องเข้าใจง่ายทั้งคู่ ไม่เอนเอียงไปสายใดสายหนึ่ง:
- **นักบัญชี** — ต้องการศัพท์การเงินที่ถูกต้อง (DSO, CCC, gross margin, variance)
- **วิศวกรหน้างาน** — ต้องการภาพ/ภาษาง่าย ("เงินจะหมดเดือนไหน", "งานไหนขาดทุน")

> **กฎ UX:** ทุกตัวเลขสำคัญต้องมีทั้ง **ศัพท์การเงิน** + **คำอธิบายภาษาคนทั่วไป** (tooltip)
> ภาษาเริ่มต้น = **ไทย**

---

## 2. สถาปัตยกรรม (Tech Stack)

| ชั้น | เทคโนโลยี | หมายเหตุ |
|------|-----------|----------|
| Runtime | **Cloudflare Workers** (Node.js compat) | API |
| Framework | **Hono** | router น้ำหนักเบา |
| Database | **Cloudflare D1** (SQLite) | ข้อมูลหลัก |
| Object storage | **Cloudflare R2** | ไฟล์ import/export (ปิดไว้ก่อน — ฟีเจอร์เสริม ต้องเปิด R2 ใน Dashboard ก่อน) |
| Frontend | **Vanilla JS + Chart.js** (static assets) | SPA ไฟล์เดียว เสิร์ฟผ่าน Worker assets |
| Auth | **HMAC-SHA256 token** (Web Crypto) | login user/password, token อายุ 12 ชม. |

โครงสร้างโฟลเดอร์:
```
Cashflow_System/
├── CLAUDE.md            ← ไฟล์นี้ (อ่านทุกครั้ง)
├── SKILL.md             ← โดเมนความรู้การเงิน (อ่านทุกครั้ง)
├── README.md            ← วิธีติดตั้ง/รัน
├── package.json
├── wrangler.toml        ← config Worker + D1 + R2
├── schema.sql           ← โครงตาราง D1
├── seed.sql             ← ข้อมูลตัวอย่าง (ประตูไม้ + ต้นทุนสีเยอะ)
├── src/
│   ├── index.js         ← Worker entry (Hono routes + login/auth middleware)
│   ├── analytics.js     ← สูตรการเงิน/การผลิต/เงินเดือนทั้งหมด (pure functions)
│   ├── repo.js          ← query helpers (เข้าถึง D1)
│   └── import.js        ← รับข้อมูลตาม IMPORT CONTRACT + คำนวณเงินเดือน (computePayroll)
├── public/
│   └── index.html       ← Dashboard ภาษาไทย (SPA) + หน้า login + 2 โหมด
├── test/
│   └── verify.mjs       ← โหลด schema+seed เข้า SQLite แล้วรันสูตรจริง (22 เคส)
└── docs/
    ├── IMPORT_CONTRACT.md  ← สเปกไฟล์ให้ Python ETL ยิงเข้ามา (13 entity)
    └── RESEARCH.md         ← สรุปงานวิจัย feature + ที่มา
```

> ตรวจความถูกต้องของสูตรก่อน deploy ได้ตลอด: `node test/verify.mjs` (ควรได้ ผ่าน 22/0)

---

## 3. ข้อตกลงเรื่องข้อมูล (สำคัญมาก — ยังไม่มี GL)

ตอนนี้ **ยังไม่มี General Ledger (GL)** และยังไม่รู้รูปแบบไฟล์จริง
→ ระบบจึงออกแบบให้ **ไม่ผูกกับรูปแบบไฟล์ใดไฟล์หนึ่ง**

- มี **staging layer** (`import_batches`, `import_rows`) เป็นประตูทางเข้าเดียว
- Python ETL (เขียนทีหลัง) มีหน้าที่แปลงไฟล์ดิบ → **CSV/JSON ตาม `docs/IMPORT_CONTRACT.md`**
- ระบบ map staging → ตารางจริง (jobs, invoices, bills, ฯลฯ) ผ่าน `src/import.js`
- ทุก row เก็บ `source` + `external_id` ไว้กันข้อมูลซ้ำ (idempotent upsert)
- **ล้างข้อมูล demo:** `clear_demo.sql` ลบเฉพาะ `source='seed'` (เก็บ `material_purchases`/ค่าสีที่อัปโหลด และข้อมูลจริงที่ import ไว้) — ใช้ก่อนรับ Actual GL; **เลิกรัน `npm run db:seed:remote` บน production** (มันใส่ dummy กลับ)

> **อย่า hard-code โครงสร้างไฟล์ GL.** ถ้าต้องรับฟิลด์ใหม่ ให้แก้ที่ IMPORT_CONTRACT ก่อน

### อัปเดตข้อมูลเพิ่มรายเดือน (incremental) — ไม่ต้อง ETL ใหม่หมด
- กันซ้ำด้วย `(source, external_id)`; ค่าสี `external_id = MP-{ลำดับแถว}`, `source = ชื่อไฟล์ที่อัปโหลด`
- **วิธีหลัก (แนะนำ):** เก็บ `dataset.csv` ไฟล์เดียว → **เติมแถวใหม่ต่อท้ายอย่างเดียว** (ห้ามแทรกกลาง/เรียงใหม่/ลบ) → `python etl/etl_dataset_to_template.py dataset.csv` → อัปโหลด **ชื่อไฟล์เดิม** ⇒ แถวเก่า upsert ทับ (ไม่เบิ้ล) เพิ่มเฉพาะแถวใหม่
  - ⚠️ แทรกกลาง/เรียงใหม่ = ลำดับเลื่อน → `external_id` เปลี่ยน → ของเก่าเบิ้ล
- **วิธีเร็ว:** ไฟล์เฉพาะเดือนใหม่ (เช่น `dataset_2026-05.csv`) ใส่เฉพาะแถวใหม่ → อัปโหลด **ชื่อไฟล์ใหม่ (source ใหม่)**; ห้ามมีแถวซ้ำกับไฟล์ก่อนหน้า (คนละ source = นับ 2 ครั้ง)
- ออเดอร์/รายจ่าย/เงินสด: หลักการเดียวกัน — กรอกต่อท้ายชีตเดิม รหัส/`external_id` ไม่ซ้ำ แล้วอัปโหลดชื่อไฟล์เดิม
- **กัน user ทำผิดในไฟล์ Excel:** ชีต "วิธีใช้" มีบล็อกคำเตือน "เติมท้ายอย่างเดียว ห้ามแทรก/เรียง/ลบ" + ทุกชีตข้อมูลมี comment ที่หัว A1 ย้ำกติกา; worst case ทำผิด = แก้ไฟล์ให้ถูกแล้วอัปโหลดชื่อเดิมใหม่ทั้งไฟล์ ระบบทับเป็นชุดล่าสุด

---

## 4. คอนเวนชันโค้ด

- **เงิน:** เก็บเป็น **สตางค์ (integer)** ในคอลัมน์ `*_satang` เพื่อเลี่ยง floating point; แปลงเป็นบาทที่ชั้น UI เท่านั้น
- **วันที่:** `YYYY-MM-DD` (TEXT) ตามมาตรฐาน SQLite
- **สกุลเงิน:** THB เท่านั้น (ยังไม่รองรับหลายสกุล)
- **โซนเวลา:** Asia/Bangkok (UTC+7) สำหรับการแสดงผล
- **API:** REST ใต้ `/api/*`, ตอบ JSON, ใช้ HTTP status ปกติ
- **Naming:** ตาราง/คอลัมน์ = snake_case อังกฤษ; ป้าย UI = ไทย
- **สูตรการเงินทั้งหมดอยู่ใน `src/analytics.js` ที่เดียว** — ห้ามกระจายสูตรไปทั่ว
- **Auth:** ทุก `/api/*` (ยกเว้น `/api/login`, `/api/health`) ต้องมี `Authorization: Bearer <token>`; รหัส/secret ตั้งผ่าน env (`ADMIN_USER`/`ADMIN_PASS`/`AUTH_SECRET`) — **ดีฟอลต์ admin/admin ต้องเปลี่ยนก่อนใช้จริง**
- **เงินเดือน:** ประกันสังคมคิด 5% ฐาน 1,650–15,000 บาท (สูงสุด 750/เดือน), นายจ้างสมทบเท่ากัน; ภาษีบุคคลรับจาก ETL/กรอกมือ (ไม่เดาเอง)

---

## 5. วิธีรัน (ดู README.md ฉบับเต็ม)

```bash
npm install
npx wrangler d1 create cashflow_db          # ครั้งแรก แล้วเอา id ใส่ wrangler.toml
npx wrangler d1 execute cashflow_db --local --file=./schema.sql
npx wrangler d1 execute cashflow_db --local --file=./seed.sql
npm run dev                                  # http://localhost:8787
```

Deploy:
```bash
npx wrangler d1 execute cashflow_db --remote --file=./schema.sql
npx wrangler deploy
```

---

## 6. ฟีเจอร์หลัก (ดูเหตุผล/ที่มาใน docs/RESEARCH.md)

1. **เงินสดในมือ & สภาพคล่อง** — ยอดเงินรวมทุกบัญชี, current ratio, quick ratio
2. **Runway / Burn rate** — เงินสดพอใช้อีกกี่เดือน
3. **13-week rolling cash flow forecast** (direct method) — หัวใจของการพยากรณ์
4. **AR Aging / DSO** และ **AP Aging / DPO**
5. **Cash Conversion Cycle** = DSO + DIO − DPO
6. **สัดส่วนค่าใช้จ่ายต่อยอดขาย** (expense-to-sales) รายหมวด
7. **วิเคราะห์ต้นทุนการผลิต & ต้นทุนสี** — โจทย์เฉพาะของเจ้าของ ("จมกับค่าสี")
8. **Budget vs Actual + variance**
9. **พยากรณ์แนวโน้มเงินสด** — base/optimistic/pessimistic → "รอดหรือล่มจม"
10. **กำไรรายงาน (job profitability)** — งานไหนทำกำไร/ขาดทุน + break-even
11. **วิเคราะห์การผลิต (Production)** — Yield, Scrap (+มูลค่า), Rework, On-time delivery, Fill rate, Lead time
12. **คลังสินค้า / WMS** — มูลค่าสต็อก, แจ้งเตือนของใกล้หมด (ROP+safety stock), ของตาย/ของช้า, **ABC analysis**, cycle counting, EOQ
13. **เงินเดือน (Payroll)** — ประจำ/พาร์ทไทม์, OT, ภาษีหัก ณ ที่จ่าย, **ประกันสังคม** (กฎไทย 5% สูงสุด 750), ต้นทุนบริษัทจริง (รวมนายจ้างสมทบ)

> สูตร/นิยามทั้งหมดอยู่ใน **SKILL.md** (A=เงินสด, B=aging/CCC, C=ต้นทุน&สี, D=งบ&พยากรณ์, G=การผลิต, H=คลัง, I=เงินเดือน)
> หน้าจอแบ่ง **2 โหมด**: พื้นฐาน (สำหรับเจ้าของ 2 คน) / ขั้นสูง (KPI ครบสำหรับนักบัญชี-นักวิเคราะห์)

### โครงหน้าจอ (UI) ปัจจุบัน
- **แบรนด์:** บริษัท **WAYTHAI-FORYOU** (โลโก้ + ชื่อ บน header และหน้า login)
- **ธีม:** พาสเทลธรรมชาติ — ครีม/เขียว sage/น้ำตาลไม้/ทอง (ฟอนต์ Sarabun + Playfair Display); ตัวแปรสีอยู่ใน `:root` ของ `public/index.html`
- **การ์ด KPI สื่อความหมายด้วยสี+เครื่องหมาย:** เขียว **✓** (ดี) / เหลือง **▲** (เฝ้าระวัง) / แดง **▼** (เสี่ยง) — เครื่องหมายอยู่หน้าตัวเลขในฟังก์ชัน `card()` ของ `public/index.html`; ใช้ +/− เฉพาะค่ากระแสเงินสด
- **กราฟโดนัท/พาย ไม่มีแกน x/y** (`mkChart()` ตัด `options.scales` อัตโนมัติ); แท็บ **"วิเคราะห์ค่าสี" เป็น interactive** — คลิกแบรนด์/ร้าน/ชนิด กรองทั้งหน้า (`state.paintFilter` + `/api/paint-analysis?vendor=&brand=&item_type=`)
- **แท็บ:** ภาพรวม · **💡 คำแนะนำ** · เงินสด · อายุหนี้ · ต้นทุน&ค่าสี · **วิเคราะห์ค่าสี** · **BOM/ตั้งราคา** · การผลิต · คลังสินค้า · **รายละเอียดสต็อก · อายุสต็อก** · เงินเดือน · **ข้อมูล (ตาราง) · ประวัติ/เวอร์ชัน** · [ขั้นสูง: วงจรเงินสด · กำไรรายงาน · ABC/ของตาย · **งบการเงิน**] · นำเข้าข้อมูล
- **💡 ที่ปรึกษาการเงินอัตโนมัติ (Recommendation engine):** `/api/recommendations` + `A.recommendations(ctx)` — อ่าน KPI ทั้งหมด (ค่าสี/margin/DSO/AR90+/runway/scrap/ของตาย/ROP/OTD/OT/ลูกค้ากระจุก) แล้วจัดอันดับสิ่งที่ควรทำตามความรุนแรง + ผลกระทบเป็นเงิน + ผลต่อ Financial Score; รวม **Customer Concentration** (`A.customerConcentration()`)
- **Excel Template (`public/WAYTHAI-FORYOU_Template.xlsx`) — ฉบับย่อ 4 ชีต** (ตาม requirement ลูกค้า): ① ออเดอร์ ② รายจ่าย ③ เงินสด ④ พนักงาน + ชีตวิธีใช้; แถว1=ชื่อไทย แถว2=ชื่อฟิลด์ระบบ แถว3+=ข้อมูล; dropdown + ช่องบังคับสีเหลือง; สร้างด้วย openpyxl (`/tmp/build_template4.py`)
  - **ชีต "order" = composite:** 1 แถว → import.js handler `order` สร้าง customer(+phone) + job + invoice; **มัดจำ → amount_paid, ยอดค้างรับ = total_price − deposit**
  - **แยกแหล่งผลิต (`production_type`): self=ผลิตเอง / outsourced=สั่งซัพ** + **ต้นทุนแยก ค่าไม้/ค่าสี/ค่าแรง/ค่าส่ง** (`jobs.cost_wood/paint/labor/shipping_satang`); import รวมเป็น `total_cost_satang` → คำนวณ **กำไรแยกผลิตเอง vs สั่งซัพ** (`A.profitByProductionType`) + บรรทัดสรุปแนะนำ; ถ้าออเดอร์เดียวมีทั้ง 2 แหล่ง แยกเป็น 2 แถว (รหัสต่างกัน)
  - **ETL (`etl/etl_to_template.py`):** แปลงไฟล์ออเดอร์ของลูกค้า (export Google Sheets เป็น CSV/XLSX) → กรอกลงชีต order ของ Template อัตโนมัติ (จับคู่หัวคอลัมน์ไทย + แปลง ผลิตเอง/สั่งซัพ); `pip install pandas openpyxl` แล้ว `python etl/etl_to_template.py <ไฟล์>`
  - **seed.sql** ตั้ง 4 งานผลิตเอง (margin ~30%) + 4 งานสั่งซัพ (margin ~13%) เป็น dummy ให้เห็นภาพการเปรียบเทียบ
  - **ลูกค้าไม่เน้นสต็อก:** ซ่อนแท็บ คลังสินค้า/รายละเอียดสต็อก/อายุสต็อก/ABC ออกจากเมนู (โค้ด/ข้อมูลยังอยู่ เปิดกลับได้)
- **แท็บนำเข้าข้อมูล:** ① อัปโหลด Excel Template (อ่านทุกชีตด้วย SheetJS ฝั่ง browser → POST /api/import ตามลำดับ dependency) ② กรอกทีละรายการ ③ CSV — ทุก fetch แนบ `Authorization: Bearer`
- **แท็บประวัติ/เวอร์ชัน (Log):** อิง `import_batches`/`import_rows` — แต่ละครั้งที่นำเข้า = 1 เวอร์ชัน (เวลา/source/จำนวน) กดดูรายการในแต่ละเวอร์ชันได้ (`/api/import/batch/:id`) — เป็นแบบ "ดูย้อนหลัง" ยังไม่สลับชุด active
- **BOM / ตั้งราคา (Pricing Calculator):** เครื่องคิดเลขฝั่ง client (`runBOM()`) — ใส่ต้นทุน (ไม้/สี/ฮาร์ดแวร์/ค่าแรง/โสหุ้ย%/อื่นๆ) + กำไรที่ต้องการ% → ราคาขายแนะนำ = ต้นทุน ÷ (1−margin) + Markup + VAT 7% + เตือน "ถ้าลืมคิดโสหุ้ย ราคาต่ำไปเท่าไร" + Pie โครงสร้างต้นทุน
- **Date range (from–to):** ตัวกรองช่วงวันที่มุมขวาบน ใช้กับ **แท็บข้อมูล (ตาราง)** ผ่าน `/api/table/:entity?from=&to=` (filter ตามคอลัมน์วันที่ของแต่ละ entity) — แท็บอื่นยังใช้ `as_of`
- **Inventory Detail / Aging:** รายละเอียดสต็อกทุกรายการ (มูลค่า/ROP/ABC/bin) + อายุสต็อกแยกช่วง 0–30/31–60/61–90/91–180/180+ วัน (`A.inventoryAging()`) — เน้นว่า "สต็อก = เงินจม"
- **งบการเงิน (ขั้นสูง):** งบกำไรขาดทุน + งบดุล (`/api/financials`, `A.incomeStatement()`/`A.balanceSheet()`) — รายได้/COGS/ค่าใช้จ่าย/AR/AP/เงินสด/สต็อก = จริง; สินทรัพย์ถาวร/เงินกู้/ดอกเบี้ย/ค่าเสื่อม/ภาษี/ทุน = **ค่าสมมติ** (ติดป้าย "สมมติ"); ส่วนของเจ้าของคำนวณให้สมดุล
  - **แท็บ "ภาพรวม" (หัวข้อ "Insight Analysis") — Dashboard ฉบับลูกค้า:** การ์ดแยกชัด **เงินสดในมือ / ยอดรับเข้าแล้ว / ยอดค้างรับ / กำไรสุทธิ / Runway / ค่าสี** → Financial Score → พยากรณ์ → Scenario Simulator → **ยอดค้างรับรายลูกค้า** → **ยอดขายรายเดือน (จริง)** + **ค่าใช้จ่ายแยกหมวด (ผลิต/การตลาด/Ads/เช่า/OH)** → งบ vs จริง
  - ข้อมูลหน้านี้มาจาก **`/api/dashboard`** — **ต้นทุนผลิต + ค่าสี = ออเดอร์ (`jobs.total_cost`/`cost_paint`) + วัตถุดิบที่ซื้อ (รายจ่ายหมวด paint/wood/hardware/labor)**; **ค่าใช้จ่ายอื่น (OH/ตลาด/Ads/เช่า) จากชีตรายจ่าย**; **กำไรสุทธิ = กำไรงาน − ค่าใช้จ่ายอื่น − วัตถุดิบที่ซื้อ**; margin/ค่าสี% อิงรายได้จากงาน (`jobs_revenue`)
  - **ตาราง `material_purchases` (เก็บทุกพารามิเตอร์การซื้อสี):** วันที่/ร้านค้า/Inv/แบรนด์/ชนิดสี/เบส/รหัสสี/จำนวน/หน่วย/ราคา/รวมภาษี/ก่อนภาษี/VAT/หมวด → ชีต **material_purchases** ใน Template + แท็บ **"วิเคราะห์ค่าสี"** (`/api/paint-analysis`, `A.materialPurchaseAnalysis`) แยกราย **ร้านค้า/แบรนด์/ชนิดสี** + แนวโน้มรายเดือน — **หมวด=paint ทุกแถว, ตารางเรียงมาก→น้อย (ไม่ระบุล่างสุด), การ์ดร้าน/แบรนด์หลัก = จำนวนครั้งมากสุด**
  - dashboard นับ `material_purchases` (หมวด paint→ค่าสี, ทั้งหมด→ต้นทุนผลิต) ด้วย
  - **การ์ดสรุป COGS / OH แตกย่อย:** ภาพรวมมีตาราง COGS รวม (ไม้/สี/แรง/ส่ง/วัตถุดิบ) + OH รวม (เช่า/น้ำไฟ/การตลาด/Ads/ขนส่ง/อื่นๆ) — `cogs_breakdown`/`oh_breakdown` ใน `/api/dashboard`
  - **Date range กรองทั้ง dashboard:** `/api/dashboard?from=&to=` กรอง invoices/expenses/jobs/material ตามช่วง (เงินสดในมือ=ยอดคงเหลือปัจจุบัน ไม่กรอง); เปลี่ยน from/to บน header → re-render ภาพรวมทันที
  - **กันข้อมูลซ้ำ:** อัปโหลด Excel ใช้ `source` ตามชื่อไฟล์ → อัปไฟล์เดิมซ้ำ = upsert ไม่เบิ้ล; ล้างของซ้ำเดิมด้วย `clear_imported.sql` (เก็บ material_purchases)
  - **เงินเดือน:** ถ้าไม่มี payslip รายเดือน ระบบสร้างสลิปจาก `employees.base_salary` ให้ (คิด ปกส. 5% สูงสุด 750) — `from_employees:true`
  - **ETL (`etl/etl_dataset_to_template.py`):** อ่าน `dataset.csv` → กรอกชีต material_purchases **แบบละเอียดทุกแถว/ทุกคอลัมน์** + จัดหมวดอัตโนมัติ; การอัปโหลดในเว็บ **ทยอยส่งทีละ 400 แถว** (กัน Worker timeout เมื่อมีพันแถว)
- **วันที่ใน Template (กัน format พลาด):** ทุกช่องวันที่ (order.issue/due, expenses.spent_at, cash.txn_date, material.purchase_date) หัวระบุ **"(วว/ดด/ปปปป)"** + **data validation เป็น date (ค.ศ 2020–2035)** + prompt/error เตือนถ้าผิด/ใช้ พ.ศ; ช่อง `account` หัวมีตัวอย่าง "(kbank/scb/เงินสด)" + dropdown
- **อ่านวันที่ตอน import (`toISO()` ใน index.html):** รองรับ Date object (ใช้ UTC กัน timezone เพี้ยน 1 วัน), `dd/mm/yyyy`, `yyyy-mm-dd`, และแปลง **พ.ศ→ค.ศ อัตโนมัติ** (ปี>2200 ลบ 543); ใช้กับทุกฟิลด์ใน `DATE_KEYS`
- **Financial Score (เต็ม 5):** เฉลี่ยจาก 6 ตัวชี้วัด — Gross Margin, Current Ratio, DIO, CCC, Runway, DSO (ฟังก์ชัน `financialScore()`); แสดงดาว + แถบย่อยรายตัว
- **พยากรณ์กระแสเงินสด:** การ์ด 13 สัปดาห์ (มีสีสถานะ) + ระยะยาวเลือกช่วง **3/6/9/12/24/36 เดือน** (`renderLongRange()`, `/api/forecast?months=`) แบบ **Base/Best/Worst case**
- **โครงสร้างต้นทุน:** Pie แยก วัตถุดิบ / สี / ค่าแรงทางตรง (DL) / โสหุ้ย (OH)
- **Scenario Simulator (gamification):** สไลเดอร์ปรับระดับใช้จ่าย 60–200% → ฉายเงินสดถึงสิ้นปี + ดัชนีสุขภาพการเงิน + คำตัดสินทางการ (🟢แข็งแรง/🟡เฝ้าระวัง/🟠เสี่ยง/🔴วิกฤต) + เตือนเกินงบ — `runForecastGame()` คำนวณฝั่ง client
- **Wording:** ใช้ภาษาทางการ (ไม่ใช้คำกันเองอย่าง "ย่อยยับ")
- **PWA (ติดตั้งบนมือถือ iOS/Android):** `public/manifest.webmanifest` + `public/sw.js` (service worker: HTML network-first, static cache-first, /api/* ไม่แคช) + ไอคอน `icon-192/512.png` + meta apple-* ใน `<head>` + ปุ่ม "ติดตั้งแอป" (beforeinstallprompt) ใน header — เสิร์ฟผ่าน Cloudflare assets; **อัปเดต index.html แล้วควรขยับ `CACHE` version ใน sw.js**

---

## 7. หลักการตัดสินใจ

- **ความเรียบง่าย > ความครบ** — ถ้า feature ทำให้ 2 เจ้าของงง ให้ตัดหรือซ่อนหลัง "โหมดขั้นสูง"
- **ตัวเลขต้องตรวจสอบย้อนได้** — ทุก KPI กดดูที่มา (drill-down) ได้
- **อย่าให้คำแนะนำการเงิน/กฎหมายแบบฟันธง** — ระบบให้ข้อมูลเพื่อให้เจ้าของตัดสินใจเอง
- **Idempotent imports** — ยิงไฟล์เดิมซ้ำได้ ไม่เบิ้ลข้อมูล
