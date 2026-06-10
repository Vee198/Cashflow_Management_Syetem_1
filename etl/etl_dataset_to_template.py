# -*- coding: utf-8 -*-
"""ETL: dataset.csv (ประวัติซื้อสี/วัตถุดิบ) -> ชีต material_purchases ของ WAYTHAI-FORYOU_Template.xlsx
เก็บทุกคอลัมน์แบบละเอียดทุกแถว + จัดหมวด paint/wood/hardware/other
ใช้:  pip install openpyxl ; python etl/etl_dataset_to_template.py dataset.csv
"""
import sys, os, csv, datetime
from openpyxl import load_workbook
SRC = sys.argv[1] if len(sys.argv) > 1 else "dataset.csv"
BASE = os.path.join(os.path.dirname(__file__), "..")
TEMPLATE = os.path.join(BASE, "WAYTHAI-FORYOU_Template.xlsx")
OUT = os.path.join(BASE, "WAYTHAI-FORYOU_Template_filled.xlsx")
SRCMAP = {"purchase_date":"วันที่","vendor":"ร้านค้า","inv_no":"เลข Inv","brand":"แบรนด์","item_type":"ชนิดสี","base":"เบส","color_code":"รหัสสี","qty":"จำนวน","unit":"หน่วย","unit_price":"ราคา","total_incl_vat":"ราคารวมภาษี","total_excl_vat":"ราคาก่อนภาษี","vat":"ยอดภาษี"}
FIELDS = ["external_id","purchase_date","vendor","inv_no","brand","item_type","base","color_code","qty","unit","unit_price","total_incl_vat","total_excl_vat","vat","category"]
PAINT=["เงา","ด้าน","ทินเนอร์","รองพื้น","ย้อม","แลคเกอร์","เคลือบ","ยูรีเทน","น้ำมัน","สี","พื้น","ใส","แชล"]
HARDWARE=["กระดาษทราย","ทราย","บานพับ","มือจับ","น็อต","สกรู","กาว","ลูกล้อ"]
WOOD=["ประตู","บาน","วงกบ","ไม้"]
def classify(t):
    return "paint"   # ตามที่ลูกค้าระบุ: หมวดทุกแถวเป็น paint
def norm_date(v):
    v=str(v).strip()
    for fmt in ("%d/%m/%Y","%Y-%m-%d","%d-%m-%Y"):
        try: return datetime.datetime.strptime(v,fmt).strftime("%Y-%m-%d")
        except ValueError: pass
    return ""
def num(v):
    s=str(v).replace(",","").replace("฿","").strip()
    try: return float(s)
    except ValueError: return ""
def main():
    if not os.path.exists(SRC): print("ไม่พบไฟล์:",SRC); return
    rows=list(csv.DictReader(open(SRC,encoding="utf-8-sig")))
    wb=load_workbook(TEMPLATE); ws=wb["material_purchases"]; rr=3
    for i,r in enumerate(rows,start=1):
        v={"external_id":f"MP-{i:05d}","purchase_date":norm_date(r.get(SRCMAP["purchase_date"])),
           "vendor":str(r.get(SRCMAP["vendor"],"")).strip(),"inv_no":str(r.get(SRCMAP["inv_no"],"")).strip(),
           "brand":str(r.get(SRCMAP["brand"],"")).strip(),"item_type":str(r.get(SRCMAP["item_type"],"")).strip(),
           "base":str(r.get(SRCMAP["base"],"")).strip(),"color_code":str(r.get(SRCMAP["color_code"],"")).strip(),
           "qty":num(r.get(SRCMAP["qty"])),"unit":str(r.get(SRCMAP["unit"],"")).strip(),
           "unit_price":num(r.get(SRCMAP["unit_price"])),"total_incl_vat":num(r.get(SRCMAP["total_incl_vat"])),
           "total_excl_vat":num(r.get(SRCMAP["total_excl_vat"])),"vat":num(r.get(SRCMAP["vat"])),
           "category":classify(r.get(SRCMAP["item_type"]))}
        for ci,f in enumerate(FIELDS,start=1): ws.cell(row=rr,column=ci,value=v[f])
        rr+=1
    wb.save(OUT); print(f"OK wrote {rr-3} rows -> {OUT}")
if __name__=="__main__": main()
