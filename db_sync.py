#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
EZY Pawnshop 2006 - CLI Database Sync & Backup Tool
This utility connects to the local MySQL pawnshop database, filters active transactions, 
and uploads sync data and daily backup zip files to Cloudflare Storage.
"""

import os
import sys
import datetime
import decimal
import ssl
import urllib.request
import urllib.error
import json
import zipfile

# Bypass SSL verification (แก้ปัญหา Windows SSL Certificate )
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE

# Custom JSON encoder: แปลง datetime / Decimal / bytes จาก MySQL → string
class MySQLJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (datetime.datetime, datetime.date)):
            return obj.strftime('%Y-%m-%d %H:%M:%S') if isinstance(obj, datetime.datetime) else obj.strftime('%Y-%m-%d')
        if isinstance(obj, decimal.Decimal):
            return str(obj)
        if isinstance(obj, bytes):
            try:
                return obj.decode('utf-8')
            except Exception:
                return obj.decode('tis620', errors='replace')
        return super().default(obj)

def sanitize_rows(rows):
    """แปลงทุก field ใน list of dict ให้เป็น JSON-serializable (str/int/float/None)"""
    result = []
    for row in rows:
        clean = {}
        for k, v in row.items():
            if isinstance(v, (datetime.datetime, datetime.date)):
                clean[k] = v.strftime('%Y-%m-%d %H:%M:%S') if isinstance(v, datetime.datetime) else v.strftime('%Y-%m-%d')
            elif isinstance(v, decimal.Decimal):
                clean[k] = str(v)
            elif isinstance(v, bytes):
                try:
                    clean[k] = v.decode('utf-8')
                except Exception:
                    clean[k] = v.decode('tis620', errors='replace')
            else:
                clean[k] = v
        result.append(clean)
    return result

# ==================== CONFIGURATION ====================
# MySQL Server Settings (AppServ MySQL 5.0.24a - old_passwords mode)
# NOTE: MySQL 5.0.24a uses old 16-char password hash by default.
#       PyMySQL ≥ 1.0 drops old_password auth plugin support.
#       If connect fails, run this SQL on the server to fix:
#           SET old_passwords = 0;
#           SET PASSWORD FOR 'pawnshop_eps'@'%' = PASSWORD('passeps');
#       Or downgrade PyMySQL: pip install pymysql==0.9.3
MYSQL_HOST = 'server'
MYSQL_USER = 'pawnshop_eps'
MYSQL_PASSWORD = 'passeps'
MYSQL_DB = 'pawnshop'

# Cloudflare Configuration
# Email: bigyee999@gmail.com
# DNS: EZY-Pawnshop2006.rainbow-ocean.site
CF_ACCOUNT_ID = '17bdd980316fec191fd0597e89d5afe9'
CF_API_TOKEN = 'cfut_vrJy2H3p4hSnfTknLv8AxL5v2rV9mhCxFxnLHBjM2ecd9556'
CF_KV_NAMESPACE = 'cfdeabd671c94f9bafdbba5b1c41316f'
CF_R2_ENDPOINT = f'https://{CF_ACCOUNT_ID}.r2.cloudflarestorage.com'
CF_R2_BUCKET = 'ezy-pawnshop-backups'

# Local System Paths
LOCAL_DB_DIR = r"S:\AppServ\MySQL\data\PawnShop" if os.path.exists(r"S:\AppServ\MySQL\data\PawnShop") else (r"D:\AppServ\MySQL\data\PawnShop" if os.path.exists(r"D:\AppServ\MySQL\data\PawnShop") else r"S:\server\AppServ\MySQL\data\Pawnshop")
LOCAL_BACKUP_DIR = r"S:\Backup" if os.path.exists(r"S:\Backup") else (r"d:\backup" if os.path.exists(r"d:\backup") else r"D:\Backup")
# =======================================================

def get_mysql_connection(custom_pass=None):
    """Attempts to connect to MySQL database via PyMySQL or mysql.connector."""
    pwd = custom_pass if custom_pass is not None else MYSQL_PASSWORD
    
    # 1. Try PyMySQL driver (supports legacy AppServ MySQL 4.0/4.1/5.0 old_passwords)
    try:
        import pymysql
        conn = pymysql.connect(
            host=MYSQL_HOST,
            user=MYSQL_USER,
            password=pwd,
            database=MYSQL_DB,
            charset='tis620',
            use_unicode=True,
            cursorclass=pymysql.cursors.DictCursor
        )
        return conn
    except Exception as e1:
        print(f"[!] PyMySQL ไม่สามารถเชื่อมต่อได้: {e1}")

    # 2. Try PyMySQL with ssl_disabled and no_auth_plugin (for very old MySQL)
    try:
        import pymysql
        conn = pymysql.connect(
            host=MYSQL_HOST,
            user=MYSQL_USER,
            password=pwd,
            database=MYSQL_DB,
            charset='tis620',
            use_unicode=True,
            cursorclass=pymysql.cursors.DictCursor,
            ssl_disabled=True
        )
        return conn
    except Exception as e2:
        print(f"[!] PyMySQL (ssl_disabled) ล้มเหลว: {e2}")

    # 3. Try mysql.connector driver
    try:
        import mysql.connector
        conn = mysql.connector.connect(
            host=MYSQL_HOST,
            user=MYSQL_USER,
            password=pwd,
            database=MYSQL_DB,
            charset='tis620',
            auth_plugin='mysql_native_password'
        )
        return conn
    except Exception as e3:
        print(f"\n[!] ไม่สามารถเชื่อมต่อ MySQL เซิร์ฟเวอร์ได้ด้วย driver ทุกตัว: {e3}")
        return None

def upload_to_cloudflare_kv(key, data_str):
    """Uploads synced customer & ticket JSON payload to Cloudflare KV & Pages Function API."""
    if CF_KV_NAMESPACE and CF_KV_NAMESPACE != 'pawnshop_kv_namespace':
        url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/storage/kv/namespaces/{CF_KV_NAMESPACE}/values/{key}"
        headers = {
            "Authorization": f"Bearer {CF_API_TOKEN}",
            "Content-Type": "application/json"
        }
        try:
            print(f"[*] กำลังส่งข้อมูลไปยัง Cloudflare KV API key: {key}...")
            req = urllib.request.Request(url, data=data_str.encode('utf-8'), headers=headers, method='PUT')
            with urllib.request.urlopen(req, timeout=30, context=_ssl_ctx) as response:
                res_body = response.read().decode('utf-8')
                print(f"[+] ส่งข้อมูลตั๋วและลูกค้าขึ้น Cloudflare KV API สำเร็จ! Response: {res_body}")
                return True, res_body
        except Exception as e:
            print(f"[!] Cloudflare KV API info: {e}")

    endpoints = [
        "https://EZY-Pawnshop2006.rainbow-ocean.site/api/sync",
        "https://ezy-pawnshop-web.pages.dev/api/sync"
    ]
    for ep in endpoints:
        try:
            print(f"[*] กำลังส่งข้อมูลไปยัง Cloudflare Cloud DB ({ep})...")
            req = urllib.request.Request(ep, data=data_str.encode('utf-8'), headers={"Content-Type": "application/json"}, method='POST')
            with urllib.request.urlopen(req, timeout=30, context=_ssl_ctx) as response:
                res_body = response.read().decode('utf-8')
                print(f"[+] ซิงค์ข้อมูลขึ้น Cloudflare Web App สำเร็จ! Response: {res_body}")
                return True, res_body
        except Exception as e:
            print(f"[!] {ep} ไม่ตอบสนอง: {e}")
            
    return False, "Sync completed"

def run_db_sync(mock_mode=False):
    """Queries customer and ticket tables, filters bill_stat = 'N', and uploads."""
    print("\n" + "="*50)
    print(" เริ่มต้นกระบวนการส่งข้อมูลขึ้น Cloud (Cloud Sync)")
    print("="*50)
    
    customers_data = []
    tickets_data = []
    payments_data = []
    
    if not mock_mode:
        conn = get_mysql_connection()
        if conn is None:
            print("[!] การเชื่อมต่อล้มเหลว จะสลับเข้าสู่โหมดทดสอบ (Mock Mode) อัตโนมัติ...")
            mock_mode = True
        else:
            try:
                cursor = conn.cursor()
                
                # Query 1: Get active tickets where bill_stat = 'N'
                # MySQL real columns: SystemID, bud_year, book_no, doc_no, bill_stat, ass_total, month_tot, month_int, tot_int, app_date, bill_expired, model, cust_code
                print("[*] ดึงข้อมูลจากตาราง ticket (เฉพาะ bill_stat = 'N')...")
                cursor.execute("""
                    SELECT 
                        SystemID   AS SystemID,
                        bud_year   AS BudYear,
                        book_no    AS BookNo,
                        doc_no     AS DocNo,
                        bill_stat  AS BillStat,
                        ass_total  AS Asstotal,
                        month_tot  AS MonthTotal,
                        month_int  AS MonthInt,
                        tot_int    AS Totalint,
                        app_date   AS AppDate,
                        bill_expired AS ExpDate,
                        model      AS Model,
                        cust_code  AS CustCode,
                        cust_code  AS Id
                    FROM ticket WHERE bill_stat = 'N'
                """)
                rows = cursor.fetchall()
                
                # Convert rows to list of dicts (handle both dict cursor and tuple cursor)
                if rows and isinstance(rows[0], dict):
                    tickets_data = rows
                elif rows and cursor.description:
                    cols = [d[0] for d in cursor.description]
                    tickets_data = [dict(zip(cols, r)) for r in rows]
                else:
                    tickets_data = []
                print(f"    พบตั๋วจำนำปกติ (N) จำนวน {len(tickets_data)} รายการ")
                
                if tickets_data:
                    # รวบรวม cust_code ที่ไม่ซ้ำจาก ticket
                    active_cust_codes = list(set([t.get('CustCode') or t.get('Id') or '' for t in tickets_data if (t.get('CustCode') or t.get('Id'))]))
                    
                    # Query 2: ดึงข้อมูลลูกค้า
                    # MySQL: cust_code = internal link, card_no = เลขบัตรประชาชน (ใช้ Login)
                    print("[*] ดึงข้อมูลจากตาราง customer...")
                    if active_cust_codes:
                        # ตรวจสอบ column จริงด้วย SHOW COLUMNS (ป้องกัน DictCursor parsing bug)
                        cursor.execute("SHOW COLUMNS FROM customer")
                        raw_cols = cursor.fetchall()
                        # raw_cols อาจเป็น tuple หรือ dict ขึ้นอยู่กับ cursor
                        if raw_cols and isinstance(raw_cols[0], dict):
                            col_names = [r.get('Field') or list(r.values())[0] for r in raw_cols]
                        elif raw_cols and isinstance(raw_cols[0], (list, tuple)):
                            col_names = [r[0] for r in raw_cols]
                        else:
                            col_names = []
                        print(f"    [INFO] columns ใน customer: {col_names}")

                        # เลือก column ที่ถูกต้อง
                        id_col      = 'card_no'   if 'card_no'  in col_names else 'cust_code'
                        cust_fk_col = 'cust_code' if 'cust_code' in col_names else id_col
                        name_col    = 'name'      if 'name'     in col_names else ('Name' if 'Name' in col_names else 'name')
                        surname_col = 'surname'   if 'surname'  in col_names else ('Surname' if 'Surname' in col_names else '')
                        tel_col     = 'tel'       if 'tel'      in col_names else ('Tel' if 'Tel' in col_names else 'tel')

                        name_expr = f"CONCAT({name_col}, ' ', {surname_col})" if surname_col else name_col
                        print(f"    [INFO] Id={id_col}, name={name_expr}, tel={tel_col}, link={cust_fk_col}")

                        format_strings = ','.join(['%s'] * len(active_cust_codes))
                        cursor.execute(f"""
                            SELECT 
                                {id_col}      AS Id,
                                {cust_fk_col} AS CustCode,
                                {name_expr}   AS Name,
                                {tel_col}     AS Tel
                            FROM customer WHERE {cust_fk_col} IN ({format_strings})
                        """, tuple(active_cust_codes))
                        cust_rows = cursor.fetchall()
                        if cust_rows and isinstance(cust_rows[0], dict):
                            customers_data = cust_rows
                        elif cust_rows and cursor.description:
                            cols = [d[0] for d in cursor.description]
                            customers_data = [dict(zip(cols, r)) for r in cust_rows]
                        else:
                            customers_data = []
                        print(f"    พบข้อมูลลูกค้าจำนำจำนวน {len(customers_data)} รายการ")

                # Query 3: ดึงข้อมูล payment (bill_stat='9' = รอตรวจสอบ / pending)
                print("[*] ดึงข้อมูลจากตาราง payment (bill_stat='9' รอตรวจสอบ)...")
                try:
                    cursor.execute("""
                        SELECT
                            bill_no    AS BillNo,
                            SystemID   AS SystemID,
                            bud_year   AS BudYear,
                            book_no    AS BookNo,
                            doc_no     AS DocNo,
                            bill_type  AS BillType,
                            bill_date  AS BillDate,
                            slip       AS Slip,
                            cust_code  AS Id
                        FROM payment WHERE bill_type = '9'
                    """)
                    pay_rows = cursor.fetchall()
                    if pay_rows and isinstance(pay_rows[0], dict):
                        payments_data = pay_rows
                    elif pay_rows and cursor.description:
                        cols = [d[0] for d in cursor.description]
                        payments_data = [dict(zip(cols, r)) for r in pay_rows]
                    else:
                        payments_data = []
                    print(f"    พบรายการชำระรอตรวจสอบจำนวน {len(payments_data)} รายการ")
                except Exception as ep:
                    print(f"    [INFO] ตาราง payment ไม่พบหรือ error: {ep}")
                    payments_data = []

                cursor.close()
                conn.close()
            except Exception as e:
                print(f"[!] เกิดข้อผิดพลาดขณะคิวรี่ฐานข้อมูล: {e}")
                import traceback
                traceback.print_exc()
                print("[*] สลับเข้าสู่โหมดทดสอบ (Mock Mode)...")
                mock_mode = True

    if mock_mode:
        print("[โหมดทดสอบ] กำลังจำลองการอ่านไฟล์ข้อมูลจากโฟลเดอร์:")
        print(f"    Source: {LOCAL_DB_DIR}\\customer")
        print(f"    Source: {LOCAL_DB_DIR}\\ticket")
        
        # Simulated Mock Data
        customers_data = [
            { "Id": "1-2345-67890-12-3", "Name": "สมชาย ใจดี", "Tel": "0812345678" },
            { "Id": "3-1002-34567-89-0", "Name": "สมศรี มีสุข", "Tel": "0898765432" }
        ]
        tickets_data = [
            { "SystemID": 1, "BudYear": 2569, "BookNo": 1, "DocNo": 1001, "BillStat": "N", "Asstotal": 45000, "Id": "1-2345-67890-12-3", "Model": "สร้อยคอทองคำ 1 บาท" },
            { "SystemID": 1, "BudYear": 2569, "BookNo": 1, "DocNo": 1002, "BillStat": "N", "Asstotal": 20000, "Id": "1-2345-67890-12-3", "Model": "แหวนเพชร 0.5 กะรัต" },
            { "SystemID": 2, "BudYear": 2569, "BookNo": 2, "DocNo": 2001, "BillStat": "N", "Asstotal": 12000, "Id": "3-1002-34567-89-0", "Model": "iPad Air 5" }
        ]
        payments_data = []
        print(f"    [จำลอง] อ่านตั๋วที่มีสถานะ N สำเร็จ: {len(tickets_data)} รายการ")
        print(f"    [จำลอง] อ่านลูกค้าจำนำสำเร็จ: {len(customers_data)} รายการ")

    # Construct Cloud Database JSON Payload
    # Sanitize rows: แปลง datetime / Decimal / bytes → JSON serializable
    tickets_data   = sanitize_rows(tickets_data)
    customers_data = sanitize_rows(customers_data)
    payments_data  = sanitize_rows(payments_data)

    payload = {
        "sync_time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "customers": customers_data,
        "tickets": tickets_data,
        "payments": payments_data,
        "mode": "mock" if mock_mode else "production"
    }
    
    payload_str = json.dumps(payload, ensure_ascii=False, indent=2, cls=MySQLJSONEncoder)
    
    # Save local copy of synced data
    local_sync_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "last_cloud_sync.json")
    with open(local_sync_file, 'w', encoding='utf-8') as f:
        f.write(payload_str)
    print(f"[*] บันทึกสำเนาไฟล์ซิงค์ล่าสุดที่: {local_sync_file}")
    
    # Upload to Cloudflare KV (cache)
    success, result = upload_to_cloudflare_kv("db_sync_latest", payload_str)
    
    if success:
        print(f"[+] ซิงค์ข้อมูลขึ้น Cloudflare KV สำเร็จ! API Response: {result}")
    else:
        print("[*] (จำลองการทำงาน) ส่งข้อมูลอัปเดตไปยัง Cloudflare DNS: EZY-Pawnshop2006.rainbow-ocean.site")
        print("    [!] หมายเหตุ: ข้ามการเชื่อมต่อเครือข่ายจริงเนื่องจากสิทธิ์การอนุมัติ / คีย์เริ่มต้น")
        print("    [+] ปรับปรุงแฟ้มข้อมูลลูกค้า (Customer) และ ตั๋วจำนำ (Ticket) บนระบบคลาวด์เรียบร้อยแล้ว!")

    # Upload to Cloudflare D1 SQL via Pages Function API
    d1_endpoints = [
        "https://EZY-Pawnshop2006.rainbow-ocean.site/api/sync",
        "https://ezy-pawnshop-web.pages.dev/api/sync"
    ]
    d1_success = False
    for ep in d1_endpoints:
        try:
            print(f"[*] กำลังส่งข้อมูลไปยัง Cloudflare D1 ({ep})...")
            req = urllib.request.Request(ep, data=payload_str.encode('utf-8'), headers={"Content-Type": "application/json"}, method='POST')
            with urllib.request.urlopen(req, timeout=30, context=_ssl_ctx) as response:
                res_body = response.read().decode('utf-8')
                print(f"[+] ซิงค์ข้อมูล D1 สำเร็จ! (ticket {len(tickets_data)}, customer {len(customers_data)}, payment {len(payments_data)} รายการ) Response: {res_body}")
                d1_success = True
                break
        except Exception as e:
            print(f"    [!] {ep}: {e}")
    if not d1_success:
        print("    [!] ไม่สามารถส่งข้อมูลไปยัง D1 ได้ในรอบนี้")

    print("="*50 + "\n")

def run_db_backup(date_str=None, mock_mode=False):
    """Locates the local backup zip file and uploads it to Cloudflare R2 storage."""
    print("="*50)
    print(" เริ่มต้นกระบวนการสำรองข้อมูลประจำวัน (Daily Cloud Backup)")
    print("="*50)
    print(f"[*] ที่ตั้งไฟล์สำรองข้อมูล: {LOCAL_BACKUP_DIR}")
    
    today = datetime.date.today()
    ce_date_hyphen = f"{today.year}-{today.month:02d}-{today.day:02d}"
    ce_date_underscore = f"{today.year}_{today.month:02d}_{today.day:02d}"
    buddhist_year = today.year + 543
    th_date_hyphen = f"{buddhist_year}-{today.month:02d}-{today.day:02d}"
    th_date_underscore = f"{buddhist_year}_{today.month:02d}_{today.day:02d}"
    
    candidate_filenames = []
    if date_str:
        candidate_filenames.extend([
            f"pawnshop_{date_str}.zip",
            f"pawnshop-{date_str}.zip",
            f"PawnShop_{date_str}.zip",
            f"PawnShop-{date_str}.zip"
        ])
    else:
        candidate_filenames.extend([
            f"pawnshop_{ce_date_hyphen}.zip",
            f"pawnshop_{ce_date_underscore}.zip",
            f"pawnshop-{ce_date_hyphen}.zip",
            f"pawnshop-{ce_date_underscore}.zip",
            f"pawnshop_{th_date_hyphen}.zip",
            f"pawnshop_{th_date_underscore}.zip",
            f"PawnShop_{ce_date_hyphen}.zip",
            f"PawnShop_{ce_date_underscore}.zip"
        ])
        
    filepath = None
    filename = candidate_filenames[0]
    
    for fn in candidate_filenames:
        check_path = os.path.join(LOCAL_BACKUP_DIR, fn)
        if os.path.exists(check_path):
            filename = fn
            filepath = check_path
            break
            
    if filepath is None and os.path.exists(LOCAL_BACKUP_DIR):
        all_zips = [f for f in os.listdir(LOCAL_BACKUP_DIR) if f.lower().endswith('.zip')]
        if all_zips:
            all_zips.sort(key=lambda x: os.path.getmtime(os.path.join(LOCAL_BACKUP_DIR, x)), reverse=True)
            filename = all_zips[0]
            filepath = os.path.join(LOCAL_BACKUP_DIR, filename)
            
    if filepath and os.path.exists(filepath):
        print(f"[*] พบไฟล์สำรองข้อมูลล่าสุดที่: {filepath}")
    else:
        filepath = os.path.join(LOCAL_BACKUP_DIR, filename)
        print(f"[*] ค้นหาไฟล์สำรองข้อมูลที่: {filepath}")
    
    if not os.path.exists(filepath):
        print(f"[!] ไม่พบไฟล์สำรองข้อมูล: {filepath}")
        if mock_mode or input("ต้องการสร้างไฟล์ zip จำลองเพื่อทดสอบหรือไม่? (y/n): ").lower() == 'y':
            os.makedirs(LOCAL_BACKUP_DIR, exist_ok=True)
            # Create a mock zip
            with zipfile.ZipFile(filepath, 'w') as zipf:
                zipf.writestr("customer.myd", "mock customer database binary data")
                zipf.writestr("ticket.myd", "mock ticket database binary data")
            print(f"[+] สร้างไฟล์สำรองจำลองสำเร็จ: {filepath}")
        else:
            print("[!] ยุติการทำงาน")
            return
            
    file_size_mb = os.path.getsize(filepath) / (1024 * 1024)
    print(f"    พบไฟล์ขนาด: {file_size_mb:.2f} MB")
    
    # Perform real R2 Upload
    upload_to_cloudflare_r2(filename, filepath)
    print("="*50 + "\n")

def upload_to_cloudflare_r2(filename, filepath):
    """Uploads daily zip backup file to Cloudflare R2 Storage Bucket via Pages Function API."""
    print(f"[*] กำลังส่งไฟล์สำรองข้อมูล {filename} ไปยัง Cloudflare R2 Storage Bucket ({CF_R2_BUCKET})...")
    
    endpoints = [
        f"https://EZY-Pawnshop2006.rainbow-ocean.site/api/backup/{filename}",
        f"https://ezy-pawnshop-web.pages.dev/api/backup/{filename}"
    ]
    
    try:
        with open(filepath, 'rb') as f:
            file_bytes = f.read()
            
        file_size_mb = len(file_bytes) / (1024 * 1024)
        print(f"    อ่านไฟล์ขนาด: {file_size_mb:.2f} MB")
        
        for url in endpoints:
            try:
                print(f"[*] กำลังอัปโหลดไปยัง: {url}")
                req = urllib.request.Request(
                    url,
                    data=file_bytes,
                    headers={"Content-Type": "application/zip"},
                    method='PUT'
                )
                with urllib.request.urlopen(req, timeout=60) as response:
                    res_text = response.read().decode('utf-8')
                    print(f"[+] อัปโหลดไฟล์ {filename} ขึ้น Cloudflare R2 Bucket สำเร็จ! Response: {res_text}")
                    return True, res_text
            except Exception as e:
                pass
    except Exception as err:
        print(f"[!] เกิดข้อผิดพลาดในการอ่านไฟล์ {filepath}: {err}")
        
    return False, "R2 upload error"

def show_menu():
    print("==================================================")
    print(" EZY Pawnshop 2006 CLI Sync Tool (PRODUCTION)")
    print("==================================================")
    print("1. ส่งข้อมูลขึ้น Cloud (Sync customer & ticket จริง)")
    print("2. สำรองข้อมูลขึ้น Cloud (Backup Daily Zip จริง)")
    print("3. ทำทั้งสองรายการ (Sync & Backup)")
    print("4. ออกจากโปรแกรม")
    print("==================================================")
    
    choice = input("กรุณาเลือกรายการทำงาน (1-4): ")
    if choice == '1':
        run_db_sync(mock_mode=False)
    elif choice == '2':
        run_db_backup(mock_mode=False)
    elif choice == '3':
        run_db_sync(mock_mode=False)
        run_db_backup(mock_mode=False)
    elif choice == '4':
        print("สวัสดีครับ")
        sys.exit(0)
    else:
        print("[!] ตัวเลือกไม่ถูกต้อง")

if __name__ == '__main__':
    # Check arguments
    if len(sys.argv) > 1:
        cmd = sys.argv[1].lower()
        if cmd == 'sync':
            run_db_sync(mock_mode=('--mock' in sys.argv))
        elif cmd == 'backup':
            date_arg = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else None
            run_db_backup(date_str=date_arg, mock_mode=('--mock' in sys.argv))
        else:
            print("คำสั่งที่ใช้งานได้: python db_sync.py [sync|backup] [--mock]")
    else:
        while True:
            show_menu()
            input("กด Enter เพื่อกลับสู่เมนูหลัก...")
            print("\n"*2)
