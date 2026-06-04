# RESEARCH.md — งานวิจัยฟีเจอร์ & เหตุผลออกแบบ

สรุปจากการค้นคว้า best practice ของการบริหารกระแสเงินสด/ต้นทุน สำหรับ SME รับจ้างผลิต (job-shop)
ใช้เป็นเหตุผลรองรับฟีเจอร์ในระบบ

---

## 1. ปัญหา 3 ด้านที่เจ้าของเจอ — และฟีเจอร์ที่ตอบ

### Cashflow (กระแสเงินสด)
ปัญหาคลาสสิกของ SME คือ "กำไรในกระดาษแต่ไม่มีเงินสด" เพราะเงินไปจมในลูกหนี้และสต็อก
แนวทางมาตรฐานที่ค้นพบ:
- ติดตาม **current cash position, operating cash flow, burn rate, runway** เป็นตัวหลัก
- ทำ **13-week rolling cash flow forecast (direct method)** — เครื่องมือมาตรฐานสำหรับมองเงินตึงล่วงหน้า ความแม่นสูงใน 4–6 สัปดาห์แรก
- ตั้ง **executive cash dashboard** รวมยอดเงิน + พยากรณ์สภาพคล่อง

### Inventory (สินค้าคงคลัง)
- **Inventory turnover / DIO** วัดว่าของเปลี่ยนเป็นเงินเร็วแค่ไหน — สำคัญมากตอนรายได้ตก
- งานผลิตที่มี lead time ยาวจะมี cash conversion cycle ยาวและซับซ้อน → ต้องเฝ้าของค้าง/ของช้า
- เฝ้า **มูลค่าสต็อกสี/ไม้** แยกหมวด เพราะเป็นเงินจมก้อนใหญ่

### Aging (อายุหนี้)
- เฝ้า **DSO, average days delinquent, AR turnover** และ aging buckets
- กรณีศึกษา: SME ลด DSO จาก 75 → 42 วันใน 6 เดือนด้วย dashboard เฝ้า AR aging → เงินสดเข้าเพิ่ม ~$150k/เดือน, working capital +25%
- แยก dashboard: Collections (ลูกหนี้ค้าง) และ AP efficiency (จ่ายเจ้าหนี้)

---

## 2. ต้นทุน & Margin สำหรับ job-shop (โจทย์ "จมกับค่าสี")

- **Job costing** เหมาะกับงาน custom ที่แต่ละชิ้นต่างกัน (เช่นเฟอร์นิเจอร์/ประตูสั่งทำ): แยก วัตถุดิบ + ค่าแรงทางตรง + โสหุ้ย ราย job เพื่อรู้ว่างานนั้นกำไรจริงไหม
- **Unit COGS** (ต้นทุนต่อหน่วย) คือฐานของการตั้งราคา — ถ้าไม่รู้ต้นทุนต่อบาน ตั้งราคาผิดแน่
- **Overhead absorption / capacity utilization:** ถ้าเดินเครื่องต่ำกว่า 80% ของกำลังผลิต โสหุ้ยคงที่จะถูกปันลงของน้อยชิ้น → ต้นทุนต่อบานสูงขึ้น margin หด
- อุตสาหกรรมสี/เคลือบเน้น GM% สูง (เป้า 85%+) ผ่าน volume + คุมต้นทุนวัตถุดิบต่อหน่วย → จึงต้องเฝ้า **ค่าสีต่อบาน** และ **ค่าสี % ของยอดขาย** เป็นพิเศษ

**สรุปสู่ฟีเจอร์ "Paint Cost Analysis":** ตอบ 4 คำถาม — สัดส่วนค่าสี, แนวโน้ม, ต่อหน่วย, และสต็อกสีค้าง (ดู SKILL.md C3)

---

## 3. KPI ที่นักวิเคราะห์ Finance/Accounting/Data แนะนำ (ตอบโจทย์ข้อ 7)

| KPI | ช่วยเรื่อง | อยู่ในระบบ |
|-----|-----------|-----------|
| Gross / Contribution margin ราย product line | รู้ว่าประตูแบบไหนทำเงิน | ✓ |
| Break-even point | ต้องขายเท่าไรถึงเท่าทุน | ✓ |
| Cash Conversion Cycle (CCC) | เงินจมในวงจรกี่วัน | ✓ |
| DSO / DPO / DIO | คุมการเก็บ-จ่าย-สต็อก | ✓ |
| Expense-to-sales ratio รายหมวด | จับหมวดที่กินกำไร | ✓ |
| Budget vs Actual variance | คุมไม่ให้จ่ายเกินงบ | ✓ |
| Quote-to-actual costing | จับงานที่ประเมินราคาพลาด | ✓ (job margin) |
| Customer concentration | ความเสี่ยงลูกค้ากระจุก | ✓ |
| Cash flow at risk (จาก aging) | เงินที่เสี่ยงเก็บไม่ได้ | ✓ |
| What-if / scenario | ปรับสมมติฐานดูผลต่อ runway | ✓ |

---

## 4. หลักการ UX สำหรับผู้ใช้ 2 สาย (บัญชี + วิศวกร)
- ทุก KPI แสดง **ศัพท์การเงิน + คำแปลภาษาคน** (tooltip)
- ใช้สถานะสี เขียว/เหลือง/แดง แทนการตีความตัวเลขเอง
- หน้าแรก = สรุป 5 ตัวเลขที่เจ้าของถามบ่อย: เงินในมือ, runway, สภาพคล่อง, ค่าใช้จ่าย/ยอดขาย, ค่าสี
- drill-down ได้ทุกตัวเลข

---

## แหล่งอ้างอิง (Sources)
- [Custom Dashboards for SME Cash Flow Management — Phoenix Strategy Group](https://www.phoenixstrategy.group/blog/custom-dashboards-sme-cash-flow-management)
- [24 Cash Flow Metrics and KPIs — NetSuite](https://www.netsuite.com/portal/resource/articles/accounting/cashflow-metrics.shtml)
- [10 Critical Cash Flow KPIs & Metrics — Ramp](https://ramp.com/blog/cash-flow-metrics)
- [Cash Conversion Cycle (CCC) — Fathom](https://www.fathomhq.com/kpi-glossary/cash-conversion-cycle)
- [KPIs & Dashboards in AP/AR Software — Business-Software.com](https://www.business-software.com/blog/kpis-dashboards-you-need-in-ap-ar-software-to-monitor-cash-health/)
- [Job Costing Guide for Manufacturers — Statii](https://www.statii.co.uk/blog/job-costing-in-manufacturing-guide)
- [Job Costing Defined — NetSuite](https://www.netsuite.com/portal/resource/articles/accounting/job-costing.shtml)
- [Paint Manufacturing KPIs — Financial Models Lab](https://financialmodelslab.com/blogs/kpi-metrics/paint-manufacturing)
- [The 6 Methods of Cost Accounting — JMCO](https://www.jmco.com/articles/manufacturing/6-methods-of-cost-accounting/)
- [13-Week Rolling Cash Flow Forecast (Direct Method) — Beancount.io](https://beancount.io/blog/2026/05/09/13-week-rolling-cash-flow-forecast-direct-method-spot-cash-crunches-small-business-guide)
- [13-Week Cash Flow Forecast Guide — Abacum](https://www.abacum.ai/blog/13-week-cash-flow)
