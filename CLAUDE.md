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
| Object storage | **Cloudflare R2** | ไฟล์ import/export, ใบกำกับ |
| Frontend | **Vanilla JS + Chart.js** (static assets) | SPA ไฟล์เดียว เสิร์ฟผ่าน Worker assets |

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
│   ├── index.js         ← Worker entry (Hono routes)
│   ├── analytics.js     ← สูตรการเงินทั้งหมด (runway, aging, forecast)
│   ├── repo.js          ← query helpers (เข้าถึง D1)
│   └── import.js        ← รับข้อมูลตาม IMPORT CONTRACT
├── public/
│   └── index.html       ← Dashboard ภาษาไทย (SPA)
└── docs/
    ├── IMPORT_CONTRACT.md  ← สเปกไฟล์ให้ Python ETL ยิงเข้ามา
    └── RESEARCH.md         ← สรุปงานวิจัย feature + ที่มา
```

---

## 3. ข้อตกลงเรื่องข้อมูล (สำคัญมาก — ยังไม่มี GL)

ตอนนี้ **ยังไม่มี General Ledger (GL)** และยังไม่รู้รูปแบบไฟล์จริง
→ ระบบจึงออกแบบให้ **ไม่ผูกกับรูปแบบไฟล์ใดไฟล์หนึ่ง**

- มี **staging layer** (`import_batches`, `import_rows`) เป็นประตูทางเข้าเดียว
- Python ETL (เขียนทีหลัง) มีหน้าที่แปลงไฟล์ดิบ → **CSV/JSON ตาม `docs/IMPORT_CONTRACT.md`**
- ระบบ map staging → ตารางจริง (jobs, invoices, bills, ฯลฯ) ผ่าน `src/import.js`
- ทุก row เก็บ `source` + `external_id` ไว้กันข้อมูลซ้ำ (idempotent upsert)

> **อย่า hard-code โครงสร้างไฟล์ GL.** ถ้าต้องรับฟิลด์ใหม่ ให้แก้ที่ IMPORT_CONTRACT ก่อน

---

## 4. คอนเวนชันโค้ด

- **เงิน:** เก็บเป็น **สตางค์ (integer)** ในคอลัมน์ `*_satang` เพื่อเลี่ยง floating point; แปลงเป็นบาทที่ชั้น UI เท่านั้น
- **วันที่:** `YYYY-MM-DD` (TEXT) ตามมาตรฐาน SQLite
- **สกุลเงิน:** THB เท่านั้น (ยังไม่รองรับหลายสกุล)
- **โซนเวลา:** Asia/Bangkok (UTC+7) สำหรับการแสดงผล
- **API:** REST ใต้ `/api/*`, ตอบ JSON, ใช้ HTTP status ปกติ
- **Naming:** ตาราง/คอลัมน์ = snake_case อังกฤษ; ป้าย UI = ไทย
- **สูตรการเงินทั้งหมดอยู่ใน `src/analytics.js` ที่เดียว** — ห้ามกระจายสูตรไปทั่ว

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
6. **Inventory turnover / มูลค่าสต็อก / ของค้างนาน**
7. **สัดส่วนค่าใช้จ่ายต่อยอดขาย** (expense-to-sales) รายหมวด
8. **วิเคราะห์ต้นทุนการผลิต & ต้นทุนสี** — โจทย์เฉพาะของเจ้าของ ("จมกับค่าสี")
9. **Budget vs Actual + variance**
10. **พยากรณ์แนวโน้มเงินสด** — base/optimistic/pessimistic → "รอดหรือล่มจม"
11. **กำไรรายงาน (job profitability)** — งานไหนทำกำไร/ขาดทุน

---

## 7. หลักการตัดสินใจ

- **ความเรียบง่าย > ความครบ** — ถ้า feature ทำให้ 2 เจ้าของงง ให้ตัดหรือซ่อนหลัง "โหมดขั้นสูง"
- **ตัวเลขต้องตรวจสอบย้อนได้** — ทุก KPI กดดูที่มา (drill-down) ได้
- **อย่าให้คำแนะนำการเงิน/กฎหมายแบบฟันธง** — ระบบให้ข้อมูลเพื่อให้เจ้าของตัดสินใจเอง
- **Idempotent imports** — ยิงไฟล์เดิมซ้ำได้ ไม่เบิ้ลข้อมูล
