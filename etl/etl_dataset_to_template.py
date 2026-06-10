# -*- coding: utf-8 -*-
"""
ETL: ประวัติซื้อสี/วัตถุดิบ (dataset.csv) → ชีต 'expenses' ของ WAYTHAI-FORYOU_Template.xlsx
- แยกหมวด: paint (สี/ทินเนอร์/รองพื้น/ย้อมไม้) · wood (ประตู/ขนาด) · hardware (กระดาษทราย/อุปกรณ์) · other
- รวมยอด "รายเดือน × หมวด" (ลดจำนวนแถวจาก 2,000+ เหลือหลักสิบ เพื่อให้ import ไว ไม่ค้าง)
- amount ใช้ 'ราคารวมภาษี' (เงินที่จ่ายจริง)

วิธีใช้:
  pip install openpyxl
  python etl/etl_dataset_to_template.py dataset.csv
  → ได้ WAYTHAI-FORYOU_Template_filled.xlsx → อัปโหลดในแท็บ 'นำเข้าข้อมูล'
"""
import sys, os, csv, datetime
from collections import defaultdict
from openpyxl import load_workbook

SRC = sys.argv[1] if len(sys.argv) > 1 else "dataset.csv"
BASE = os.path.join(os.path.dirname(__file__), "..")
TEMPLATE = os.path.join(BASE, "WAYTHAI-FORYOU_Template.xlsx")
OUT = os.path.join(BASE, "WAYTHAI-FORYOU_Template_filled.xlsx")

PAINT = ["เงา", "ด้าน", "ทินเนอร์", "รองพื้น", "ย้อม", "แลคเกอร์", "เคลือบ", "ยูรีเทน", "น้ำมัน", "สี", "พื้น", "ใส", "แชล"]
HARDWARE = ["กระดาษทราย", "ทราย", "บานพับ", "มือจับ", "น็อต", "สกรู", "กาว", "ลูกล้อ"]
WOOD = ["ประตู", "บาน", "วงกบ", "ไม้"]


def classify(t):
    s = str(t)
    if any(k in s for k in HARDWARE):
        return "hardware"
    # ขนาดประตู เช่น 80x200 / 100x200
    digits = s.replace("X", "x")
    if "x" in digits and any(ch.isdigit() for ch in digits):
        return "wood"
    if any(k in s for k in WOOD):
        return "wood"
    if any(k in s for k in PAINT):
        return "paint"
    return "paint"   # ส่วนใหญ่เป็นของจากร้านสี → เดาเป็น paint


def parse_date(v):
    v = str(v).strip()
    if not v:
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.datetime.strptime(v, fmt)
        except ValueError:
            pass
    return None


def num(v):
    s = str(v).replace(",", "").replace("฿", "").strip()
    try:
        return float(s)
    except ValueError:
        return 0.0


def main():
    if not os.path.exists(SRC):
        print("ไม่พบไฟล์:", SRC)
        return
    rows = list(csv.DictReader(open(SRC, encoding="utf-8-sig")))
    agg = defaultdict(float)       # (period, category) -> amount
    cnt = defaultdict(int)
    skipped = 0
    for r in rows:
        d = parse_date(r.get("วันที่"))
        if not d:
            skipped += 1
            continue
        period = d.strftime("%Y-%m")
        cat = classify(r.get("ชนิดสี"))
        amt = num(r.get("ราคารวมภาษี")) or (num(r.get("ราคา")) * num(r.get("จำนวน")))
        agg[(period, cat)] += amt
        cnt[(period, cat)] += 1

    wb = load_workbook(TEMPLATE)
    ws = wb["expenses"]   # คอลัมน์: external_id, spent_at, category, amount, note
    rr = 3
    total_by_cat = defaultdict(float)
    for (period, cat), amt in sorted(agg.items()):
        ws.cell(row=rr, column=1, value=f"PUR-{period}-{cat}")
        ws.cell(row=rr, column=2, value=f"{period}-15")
        ws.cell(row=rr, column=3, value=cat)
        ws.cell(row=rr, column=4, value=round(amt, 2))
        ws.cell(row=rr, column=5, value=f"รวมซื้อ{cat} เดือน {period} ({cnt[(period,cat)]} รายการ)")
        total_by_cat[cat] += amt
        rr += 1
    wb.save(OUT)
    print(f"✓ เขียน {rr-3} แถว (รวมรายเดือน×หมวด) → {OUT}")
    print(f"  ข้ามแถววันที่ไม่ถูกต้อง: {skipped} แถว")
    for cat, t in sorted(total_by_cat.items(), key=lambda x: -x[1]):
        print(f"  รวม {cat}: ฿{t:,.0f}")


if __name__ == "__main__":
    main()
