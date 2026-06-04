# ระบบบริหารกระแสเงินสด — ธุรกิจรับจ้างผลิตประตูไม้

Webapp บน **Cloudflare Workers + D1 + R2** (Node.js / Hono) สำหรับติดตามกระแสเงินสด, ต้นทุน,
สินค้าคงคลัง, การผลิต และเงินเดือน — ออกแบบให้ทั้ง **นักบัญชี** และ **วิศวกรหน้างาน** ใช้ง่าย (ไทยเป็นหลัก)

> 📌 ก่อนแก้โค้ด **อ่าน `CLAUDE.md` และ `SKILL.md` ทุกครั้ง** (กติกาโปรเจกต์ + นิยามสูตรการเงิน)

---

## ฟีเจอร์
- **ภาพรวม** — เงินสดในมือ, runway, สภาพคล่อง, กำไรขั้นต้น, ค่าใช้จ่าย/ยอดขาย, ค่าสี
- **เงินสด & สภาพคล่อง** — ยอดรายบัญชี, burn rate, current/quick ratio
- **อายุหนี้ (AR/AP)** + **วงจรเงินสด (CCC = DSO+DIO−DPO)**
- **ต้นทุน & ค่าสี** — COGS รายหมวด, gross margin, ★วิเคราะห์ต้นทุนสี (โจทย์เจ้าของ), กำไรรายงาน
- **การผลิต** — Yield, Scrap (+มูลค่า), Rework, On-time delivery, Fill rate, Lead time
- **คลังสินค้า** — มูลค่าสต็อก, แจ้งเตือนของใกล้หมด (ROP), ของตาย/ของช้า, **ABC analysis**, cycle count
- **เงินเดือน** — ประจำ/พาร์ทไทม์, OT, ภาษีหัก ณ ที่จ่าย, **ประกันสังคม** (กฎไทย 5% สูงสุด 750), ต้นทุนบริษัทจริง
- **งบประมาณ vs จริง** + variance
- **พยากรณ์** — 13-week rolling cash flow + ระยะยาว 18 เดือน 3 ฉากทัศน์ (รอด/ล่มจม)
- **นำเข้าข้อมูล** — กรอกมือ + อัปโหลด CSV + REST API ให้ Python ETL (ดู `docs/IMPORT_CONTRACT.md`)
- **2 โหมด:** พื้นฐาน (สำหรับเจ้าของ) / ขั้นสูง (KPI ครบ)
- **เข้าสู่ระบบ** — user/password (ดีฟอลต์ `admin`/`admin` — ⚠ เปลี่ยนก่อนใช้จริง)

---

## ติดตั้ง & รันบนเครื่อง (local)

```bash
npm install

# สร้าง D1 (ครั้งแรก) แล้วนำ database_id ที่ได้ไปวางใน wrangler.toml
npx wrangler d1 create cashflow_db
npx wrangler r2 bucket create cashflow-files

# สร้างตาราง + ใส่ข้อมูลตัวอย่าง (local)
npm run setup:local        # = db:init:local + db:seed:local

# รัน
npm run dev                # เปิด http://localhost:8787  (login: admin / admin)
```

## Deploy ขึ้น Cloudflare

```bash
# ตั้งรหัสผ่าน/secret จริงก่อน (อย่าใช้ admin/admin)
npx wrangler secret put ADMIN_PASS
npx wrangler secret put AUTH_SECRET

npm run db:init:remote
npm run db:seed:remote     # (ถ้าต้องการข้อมูลตัวอย่าง — ข้ามได้ถ้าใช้ข้อมูลจริง)
npm run deploy
```

---

## ตรวจสอบความถูกต้อง (verify)

```bash
node test/verify.mjs       # โหลด schema+seed เข้า SQLite แล้วรันสูตรการเงินจริง (22 เคส)
```

---

## นำเข้าข้อมูลจริง (เมื่อมี GL แล้ว)

ระบบ **ไม่ผูกกับรูปแบบไฟล์ GL** — เขียน Python ETL แปลงไฟล์ดิบให้ตรง `docs/IMPORT_CONTRACT.md` แล้วยิง:

```bash
curl -X POST http://localhost:8787/api/import \
  -H "Authorization: Bearer <token จาก /api/login>" \
  -H "Content-Type: application/json" \
  -d '{"source":"gl_2026q2","entity":"invoices","rows":[ ... ]}'
```

ทุกแถวใช้คีย์ `(source, external_id)` ทำ **upsert** → ยิงไฟล์เดิมซ้ำได้ ไม่เบิ้ลข้อมูล

---

## โครงสร้าง
```
CLAUDE.md  SKILL.md          ← อ่านทุกครั้ง
schema.sql  seed.sql
wrangler.toml  package.json
src/   index.js analytics.js repo.js import.js
public/ index.html           ← Dashboard ไทย (SPA + login)
docs/  IMPORT_CONTRACT.md  RESEARCH.md
test/  verify.mjs
```

## หมายเหตุความปลอดภัย
- เปลี่ยน `ADMIN_USER`/`ADMIN_PASS`/`AUTH_SECRET` ก่อนใช้งานจริงเสมอ
- token เป็น HMAC-SHA256 อายุ 12 ชม. — เหมาะกับใช้งานภายใน; ถ้าเปิดสาธารณะควรเพิ่ม HTTPS-only cookie + rate limit
- ระบบให้ "ข้อมูลเพื่อการตัดสินใจ" ไม่ใช่คำแนะนำการเงิน/บัญชีแบบฟันธง
```
