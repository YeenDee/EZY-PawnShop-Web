# -*- coding: utf-8 -*-
import csv, getpass, io, json, os, subprocess, tempfile, zipfile
from datetime import datetime
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

MYSQL_EXE = r"D:\AppServ\MySQL\bin\mysql.exe"
MYSQL_HOST = "localhost"
MYSQL_USER = "pawnshop_eps"
MYSQL_DB = "pawnshop"
CLOUDFLARE_URL = "https://ezy-pawnshop-web.pages.dev"
PASSWORD = "passeps"

def mysql_query(query):
    global PASSWORD
    if not os.path.isfile(MYSQL_EXE):
        raise FileNotFoundError(f"ไม่พบ mysql.exe: {MYSQL_EXE}")
    if PASSWORD is None:
        PASSWORD = getpass.getpass(f"MySQL password for {MYSQL_USER}: ")
    cmd=[MYSQL_EXE,"-h",MYSQL_HOST,"-u",MYSQL_USER,f"-p{PASSWORD}",
         "--default-character-set=utf8","--batch","--raw","--skip-column-names",
         MYSQL_DB,"-e",query]
    r=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
    if r.returncode:
        raise RuntimeError("MySQL error: "+r.stderr.decode("utf-8","replace").strip())
    return r.stdout.decode("utf-8","replace")

def rows(query, columns):
    out=[]
    for vals in csv.reader(io.StringIO(mysql_query(query)),delimiter="\t"):
        if not vals: continue
        vals += [""]*(len(columns)-len(vals))
        out.append({c:(None if vals[i]==r"\N" else vals[i]) for i,c in enumerate(columns)})
    return out

def q(v):
    if v is None: return "NULL"
    return "'" + str(v).replace("\\","\\\\").replace("'","''") + "'"

def read_data():
    ticket_cols=["SystemID","BudYear","BookNo","DocNo","BillStat","Asstotal","MonthTotal","MonthInt","Totalint","AppDate","ExpDate","Model","Id","CustCode"]
    tq="""
SELECT SystemID,bud_year BudYear,book_no BookNo,doc_no DocNo,bill_stat BillStat,
ass_total Asstotal,month_tot MonthTotal,month_int MonthInt,tot_int Totalint,
app_date AppDate,bill_expired ExpDate,model Model,cust_code Id,cust_code CustCode
FROM ticket WHERE bill_stat='N'"""
    tickets=rows(tq,ticket_cols)
    codes=rows("SELECT DISTINCT cust_code CustCode FROM ticket WHERE bill_stat='N'",["CustCode"])
    codes=sorted({r["CustCode"] for r in codes if r["CustCode"]})
    customers=[]
    if codes:
        inlist=",".join(q(x) for x in codes)
        customers=rows(f"""
SELECT cust_code Id,TRIM(CONCAT(name,' ',surname)) Name,tel Tel
FROM customer WHERE cust_code IN ({inlist})""",["Id","Name","Tel"])
    for t in tickets:
        t.pop("CustCode",None)
        for k in ("SystemID","BudYear","BookNo","DocNo"):
            t[k]="" if t[k] is None else str(t[k])
    return {"customers":customers,"tickets":tickets,"source":"AppServ MySQL 5.0.24a",
            "sync_time":datetime.now().strftime("%Y-%m-%d %H:%M:%S")}

def request_json(path, method="GET", data=None, content_type="application/json"):
    body=None if data is None else (data if isinstance(data,bytes) else json.dumps(data,ensure_ascii=False).encode("utf-8"))
    req=Request(CLOUDFLARE_URL.rstrip("/")+"/"+path.lstrip("/"),data=body,method=method,
                headers={"Accept":"application/json","Content-Type":content_type})
    try:
        with urlopen(req,timeout=300) as r:
            text=r.read().decode("utf-8","replace")
            return r.status,json.loads(text) if text else {}
    except HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode('utf-8','replace')}") from e
    except URLError as e:
        raise RuntimeError(f"เชื่อม Cloudflare ไม่ได้: {e}") from e

def sync():
    print("[+] อ่าน MySQL...")
    data=read_data()
    print(f"[+] customers={len(data['customers']):,}, tickets={len(data['tickets']):,}")
    status,result=request_json("/api/sync","POST",data)
    print(f"[+] HTTP {status}\n"+json.dumps(result,ensure_ascii=False,indent=2))
    if not result.get("success"): raise RuntimeError("Sync ไม่สำเร็จ")

def verify_d1():
    _,result=request_json("/api/sync")
    print(f"D1 customers: {len(result.get('customers',[])):,}")
    print(f"D1 tickets:   {len(result.get('tickets',[])):,}")
    print("source:",result.get("source"))

def list_r2():
    _,result=request_json("/api/backups")
    print(f"R2 files: {len(result.get('files',[])):,}")
    for x in result.get("files",[]): print(x.get("filename"),x.get("size"),x.get("uploaded"))

def test_zip():
    fd,path=tempfile.mkstemp(suffix=".zip"); os.close(fd)
    try:
        with zipfile.ZipFile(path,"w",zipfile.ZIP_DEFLATED) as z:
            z.writestr("test.txt","EZY Pawnshop R2 test "+datetime.now().isoformat())
        with open(path,"rb") as f: data=f.read()
        name=os.path.basename(path)
        _,result=request_json("/api/backup/"+name,"PUT",data,"application/zip")
        print(json.dumps(result,ensure_ascii=False,indent=2))
    finally:
        try: os.remove(path)
        except OSError: pass

def mock():
    data={"customers":[{"Id":"TEST001","Name":"ทดสอบ EZY Pawnshop","Tel":"0800000000"}],
          "tickets":[{"SystemID":"1","BudYear":"2026","BookNo":"9999","DocNo":"1","BillStat":"N",
          "Asstotal":1000,"MonthTotal":1,"MonthInt":50,"Totalint":50,"AppDate":"2026-08-10 12:00:00",
          "ExpDate":"2026-09-10","Model":"TEST","Id":"TEST001"}]}
    _,result=request_json("/api/sync","POST",data)
    print(json.dumps(result,ensure_ascii=False,indent=2))

def main():
    print("EZY Pawnshop 2006 - Cloudflare Sync")
    print("mysql.exe:",MYSQL_EXE)
    print("Cloudflare:",CLOUDFLARE_URL)
    while True:
        print("\n1 Sync MySQL -> D1/KV\n2 Test ZIP -> R2\n3 Verify D1\n4 List R2\n5 Mock test\n0 Exit")
        c=input("เลือกเมนู: ").strip()
        try:
            if c=="1": sync()
            elif c=="2": test_zip()
            elif c=="3": verify_d1()
            elif c=="4": list_r2()
            elif c=="5": mock()
            elif c=="0": break
            else: print("เลือก 0-5")
        except Exception as e: print("[ERROR]",e)

if __name__=="__main__": main()
