#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
EZY Pawnshop 2006 - Cloud Sync & Backup Tool

ส่งข้อมูลจาก MySQL หน้าร้านไปยัง Cloudflare Pages Function:
    POST /api/sync

ส่งไฟล์ ZIP สำรองข้อมูลไปยัง R2 ผ่าน:
    PUT /api/backup/<filename>

Cloudflare Worker/Pages URL:
    https://ezy-pawnshop-web.pages.dev

หมายเหตุ:
- เวอร์ชันนี้ไม่ใช้ Cloudflare Account API Token จากเครื่องหน้าร้าน
- เครื่องหน้าร้านคุยกับ Pages Function เท่านั้น
- Pages Function เป็นผู้เขียนข้อมูลลง D1/KV และ R2
"""

import os
import sys
import json
import datetime
import zipfile
import urllib.request
import urllib.error
import urllib.parse
import http.client


# ============================================================
# CONFIGURATION
# ============================================================

# MySQL Server Settings
MYSQL_HOST = 'server'
MYSQL_USER = 'pawnshop_eps'
MYSQL_PASSWORD = 'passeps'
MYSQL_DB = 'pawnshop'

# Cloudflare Pages Function
CLOUDFLARE_BASE_URL = 'https://ezy-pawnshop-web.pages.dev'

SYNC_URL = CLOUDFLARE_BASE_URL + '/api/sync'
BACKUP_URL = CLOUDFLARE_BASE_URL + '/api/backup/'

# Local System Paths
LOCAL_DB_DIR = (
    r"S:\AppServ\MySQL\data\PawnShop"
    if os.path.exists(r"S:\AppServ\MySQL\data\PawnShop")
    else (
        r"D:\AppServ\MySQL\data\PawnShop"
        if os.path.exists(r"D:\AppServ\MySQL\data\PawnShop")
        else r"S:\server\AppServ\MySQL\data\Pawnshop"
    )
)

LOCAL_BACKUP_DIR = (
    r"S:\Backup"
    if os.path.exists(r"S:\Backup")
    else (
        r"D:\backup"
        if os.path.exists(r"D:\backup")
        else r"D:\Backup"
    )
)


# ============================================================
# HTTP HELPERS
# ============================================================

def http_post_json(url, payload, timeout=60):
    """POST JSON ไปยัง Cloudflare Pages Function"""
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')

    req = urllib.request.Request(
        url,
        data=body,
        headers={
            'Content-Type': 'application/json; charset=utf-8',
            'Accept': 'application/json',
        },
        method='POST'
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            response_body = response.read().decode('utf-8', errors='replace')
            return response.status, response_body

    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8', errors='replace')
        return e.code, error_body

    except Exception as e:
        return None, str(e)


def upload_file_to_worker(url, filepath, timeout=300, chunk_size=1024 * 1024):
    """
    PUT ไฟล์ ZIP แบบ streaming ไปยัง Cloudflare Worker/R2 endpoint
    ไม่โหลดไฟล์ทั้งก้อนเข้า RAM
    """
    parsed = urllib.parse.urlsplit(url)

    if parsed.scheme != 'https':
        raise ValueError('BACKUP URL ต้องเป็น HTTPS')

    host = parsed.netloc
    path = parsed.path or '/'

    file_size = os.path.getsize(filepath)

    conn = http.client.HTTPSConnection(host, timeout=timeout)

    try:
        conn.putrequest('PUT', path)
        conn.putheader('Content-Type', 'application/zip')
        conn.putheader('Content-Length', str(file_size))
        conn.putheader('Accept', 'application/json')
        conn.endheaders()

        sent = 0
        last_percent = -1

        with open(filepath, 'rb') as f:
            while True:
                chunk = f.read(chunk_size)
                if not chunk:
                    break

                conn.send(chunk)
                sent += len(chunk)

                percent = int(sent * 100 / file_size) if file_size else 100

                # แสดงทุก 10%
                if percent // 10 != last_percent // 10 or percent == 100:
                    print(f"    [Uploading {percent}%]")
                    last_percent = percent

        response = conn.getresponse()
        response_body = response.read().decode('utf-8', errors='replace')

        return response.status, response_body

    finally:
        conn.close()


# ============================================================
# MYSQL
# ============================================================

def get_mysql_connection(custom_pass=None):
    """เชื่อมต่อ MySQL โดยพยายาม PyMySQL ก่อน แล้วค่อย mysql.connector"""
    #pwd = custom_pass if custom_pass is not None else MYSQL_PASSWORD
    
    # 1. PyMySQL
    try:
        import pymysql

        conn = pymysql.connect(
            host=MYSQL_HOST,
            user=MYSQL_USER,
            password=MYSQL_PASSWORD,
            database=MYSQL_DB,
            charset='tis620',
            cursorclass=pymysql.cursors.DictCursor
        )
        print("[+] เชื่อมต่อ MySQL ด้วย PyMySQL สำเร็จ")
        return conn, 'pymysql'

    except Exception as e1:
        print(f"    PyMySQL: เชื่อมต่อไม่ได้ ({e1})")

    # 2. mysql.connector
    try:
        import mysql.connector

        conn = mysql.connector.connect(
            host=MYSQL_HOST,
            user=MYSQL_USER,
            password=MYSQL_PASSWORD,
            database=MYSQL_DB
        )
        print("[+] เชื่อมต่อ MySQL ด้วย mysql.connector สำเร็จ")
        return conn, 'mysql.connector'

    except Exception as e2:
        print(f"[!] mysql.connector: เชื่อมต่อไม่ได้ ({e2})")

    return None, None


def get_rows(cursor, driver, sql, params=None):
    """คืนผล SELECT เป็น list ของ dict ทั้ง PyMySQL และ mysql.connector"""
    cursor.execute(sql, params or ())

    if driver == 'pymysql':
        return cursor.fetchall()

    columns = [desc[0] for desc in cursor.description]
    rows = cursor.fetchall()
    return [dict(zip(columns, row)) for row in rows]


# ============================================================
# DATA SYNC
# ============================================================

def build_sync_payload(mock_mode=False):
    customers_data = []
    tickets_data = []
    payments_data = []

    if mock_mode:
        print("[โหมดทดสอบ] ใช้ข้อมูลจำลอง")

        customers_data = [
            {"Id": "1-2345-67890-12-3", "Name": "สมชาย ใจดี", "Tel": "0812345678"},
            {"Id": "3-1002-34567-89-0", "Name": "สมศรี มีสุข", "Tel": "0898765432"},
        ]

        tickets_data = [
            {
                "SystemID": 1, "BudYear": 2569, "BookNo": 1, "DocNo": 1001,
                "BillStat": "N", "Asstotal": 45000,
                "Id": "1-2345-67890-12-3",
                "Model": "สร้อยคอทองคำ 1 บาท"
            },
            {
                "SystemID": 1, "BudYear": 2569, "BookNo": 1, "DocNo": 1002,
                "BillStat": "N", "Asstotal": 20000,
                "Id": "1-2345-67890-12-3",
                "Model": "แหวนเพชร 0.5 กะรัต"
            },
            {
                "SystemID": 2, "BudYear": 2569, "BookNo": 2, "DocNo": 2001,
                "BillStat": "N", "Asstotal": 12000,
                "Id": "3-1002-34567-89-0",
                "Model": "iPad Air 5"
            }
        ]

    else:
        conn, driver = get_mysql_connection()

        if conn is None:
            print("[!] ไม่สามารถเชื่อมต่อ MySQL ได้")
            return None

        try:
            cursor = conn.cursor()

            print("[*] ดึงข้อมูล ticket ที่ bill_stat = 'N' ...")
            tickets_data = get_rows(
                cursor,
                driver,
                "SELECT * FROM ticket WHERE bill_stat = 'N'"
            )
            print(f"    พบตั๋วจำนำ {len(tickets_data)} รายการ")

            active_cust_ids = list({
                t.get('Id')
                for t in tickets_data
                if t.get('Id')
            })

            if active_cust_ids:
                print("[*] ดึงข้อมูล customer ที่เกี่ยวข้อง ...")

                placeholders = ','.join(['%s'] * len(active_cust_ids))

                customers_data = get_rows(
                    cursor,
                    driver,
                    f"SELECT * FROM customer WHERE Id IN ({placeholders})",
                    tuple(active_cust_ids)
                )

                print(f"    พบลูกค้า {len(customers_data)} รายการ")

            # payments เป็น optional
            try:
                print("[*] ดึงข้อมูล payments ...")
                payments_data = get_rows(
                    cursor,
                    driver,
                    "SELECT * FROM payments"
                )
                print(f"    พบ payments {len(payments_data)} รายการ")
            except Exception:
                # ถ้าหน้าร้านไม่มีตาราง payments ให้ข้าม
                payments_data = []
                print("    ไม่พบตาราง payments / ข้ามส่วนนี้")

            cursor.close()
            conn.close()

        except Exception as e:
            try:
                conn.close()
            except Exception:
                pass

            print(f"[!] เกิดข้อผิดพลาดขณะอ่าน MySQL: {e}")
            return None

    payload = {
        "sync_time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "customers": customers_data,
        "tickets": tickets_data,
        "payments": payments_data,
        "mode": "mock" if mock_mode else "production"
    }

    return payload


def run_db_sync(mock_mode=False):
    print("\n" + "=" * 60)
    print(" EZY Pawnshop 2006 - Cloud Sync")
    print("=" * 60)

    payload = build_sync_payload(mock_mode)

    if payload is None:
        print("[!] ยกเลิกการ Sync เพราะอ่านข้อมูล MySQL ไม่สำเร็จ")
        return False

    payload_str = json.dumps(payload, ensure_ascii=False, indent=2)

    # เก็บสำเนา local
    local_sync_file = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "last_cloud_sync.json"
    )

    try:
        with open(local_sync_file, 'w', encoding='utf-8') as f:
            f.write(payload_str)

        print(f"[*] บันทึกสำเนาไว้ที่: {local_sync_file}")
    except Exception as e:
        print(f"[!] บันทึกสำเนา local ไม่สำเร็จ: {e}")

    print(f"[*] กำลังส่งข้อมูลไปยัง:")
    print(f"    {SYNC_URL}")

    status, result = http_post_json(SYNC_URL, payload)

    print(f"[*] HTTP Status: {status}")

    if status and 200 <= status < 300:
        try:
            response_json = json.loads(result)
            print("[+] Cloud Sync สำเร็จ")
            print(f"    Response: {json.dumps(response_json, ensure_ascii=False)}")
        except Exception:
            print(f"[+] Cloud Sync สำเร็จ: {result}")

        print(
            f"    ลูกค้า: {len(payload.get('customers', []))} รายการ | "
            f"ตั๋ว: {len(payload.get('tickets', []))} รายการ | "
            f"Payments: {len(payload.get('payments', []))} รายการ"
        )
        return True

    print("[!] Cloud Sync ไม่สำเร็จ")
    print(f"    Response: {result}")
    return False


# ============================================================
# R2 BACKUP
# ============================================================

def find_backup_file(date_str=None):
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
            f"PawnShop-{date_str}.zip",
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
            f"PawnShop_{ce_date_underscore}.zip",
        ])

    if not os.path.exists(LOCAL_BACKUP_DIR):
        return None

    # หาไฟล์ตามชื่อก่อน
    for filename in candidate_filenames:
        filepath = os.path.join(LOCAL_BACKUP_DIR, filename)
        if os.path.isfile(filepath):
            return filepath

    # ถ้าไม่ตรงชื่อ ให้เอา ZIP ล่าสุด
    all_zips = [
        f for f in os.listdir(LOCAL_BACKUP_DIR)
        if f.lower().endswith('.zip')
        and os.path.isfile(os.path.join(LOCAL_BACKUP_DIR, f))
    ]

    if all_zips:
        all_zips.sort(
            key=lambda x: os.path.getmtime(
                os.path.join(LOCAL_BACKUP_DIR, x)
            ),
            reverse=True
        )
        return os.path.join(LOCAL_BACKUP_DIR, all_zips[0])

    return None


def create_mock_zip():
    """สร้าง ZIP จำลองสำหรับทดสอบเท่านั้น"""
    os.makedirs(LOCAL_BACKUP_DIR, exist_ok=True)

    filename = "pawnshop_test_backup.zip"
    filepath = os.path.join(LOCAL_BACKUP_DIR, filename)

    with zipfile.ZipFile(filepath, 'w') as zipf:
        zipf.writestr(
            "customer.myd",
            "mock customer database binary data"
        )
        zipf.writestr(
            "ticket.myd",
            "mock ticket database binary data"
        )

    return filepath


def run_db_backup(date_str=None, mock_mode=False):
    print("\n" + "=" * 60)
    print(" EZY Pawnshop 2006 - Daily Cloud Backup")
    print("=" * 60)

    print(f"[*] โฟลเดอร์ Backup: {LOCAL_BACKUP_DIR}")

    filepath = find_backup_file(date_str)

    if filepath is None and mock_mode:
        print("[โหมดทดสอบ] ไม่พบ ZIP จริง")
        print("[*] กำลังสร้าง ZIP จำลอง...")
        filepath = create_mock_zip()
        print(f"[+] สร้างไฟล์จำลอง: {filepath}")

    if filepath is None:
        print("[!] ไม่พบไฟล์ ZIP Backup")
        return False

    filename = os.path.basename(filepath)
    file_size = os.path.getsize(filepath)
    file_size_mb = file_size / (1024 * 1024)

    print(f"[*] พบไฟล์: {filepath}")
    print(f"    ขนาด: {file_size_mb:.2f} MB")

    # URL encode ชื่อไฟล์ เพื่อรองรับช่องว่าง/อักขระพิเศษ
    encoded_filename = urllib.parse.quote(filename, safe='')
    upload_url = BACKUP_URL + encoded_filename

    print("[*] กำลัง Upload ไป Cloudflare R2 ผ่าน Pages Function")
    print(f"    {upload_url}")

    try:
        status, result = upload_file_to_worker(
            upload_url,
            filepath
        )

        print(f"[*] HTTP Status: {status}")

        if status and 200 <= status < 300:
            try:
                response_json = json.loads(result)
                print(
                    "[+] Backup สำเร็จ: "
                    + json.dumps(response_json, ensure_ascii=False)
                )
            except Exception:
                print(f"[+] Backup สำเร็จ: {result}")

            print(f"[+] ไฟล์ {filename} ถูกส่งเข้า R2 แล้ว")
            return True

        print("[!] Upload Backup ไม่สำเร็จ")
        print(f"    Response: {result}")
        return False

    except Exception as e:
        print(f"[!] Upload Backup เกิดข้อผิดพลาด: {e}")
        return False


# ============================================================
# CHECK R2
# ============================================================

def check_cloud_backups():
    """เรียก GET /api/backups เพื่อดูไฟล์ใน R2"""
    url = CLOUDFLARE_BASE_URL + '/api/backups'

    print("\n[*] ตรวจสอบไฟล์ Backup ใน Cloudflare R2 ...")
    print(f"    {url}")

    req = urllib.request.Request(
        url,
        headers={'Accept': 'application/json'},
        method='GET'
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            body = response.read().decode('utf-8', errors='replace')

        data = json.loads(body)

        if not data.get('success'):
            print("[!] Cloudflare แจ้งว่าไม่สำเร็จ")
            print(body)
            return False

        files = data.get('files', [])

        print(f"[+] พบไฟล์ใน R2 จำนวน {len(files)} รายการ")

        for item in files:
            size_mb = item.get('size', 0) / (1024 * 1024)
            print(
                f"    - {item.get('filename')} "
                f"({size_mb:.2f} MB) "
                f"{item.get('uploaded', '')}"
            )

        return True

    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        print(f"[!] HTTP Error {e.code}: {body}")
        return False

    except Exception as e:
        print(f"[!] ตรวจสอบ R2 ไม่สำเร็จ: {e}")
        return False


# ============================================================
# MENU
# ============================================================

def show_menu():
    while True:
        print("\n" + "=" * 60)
        print(" EZY Pawnshop 2006 - Cloud Sync Tool")
        print("=" * 60)
        print(" 1. ส่งข้อมูล MySQL ขึ้น Cloud (D1 + KV)")
        print(" 2. สำรองข้อมูล ZIP ขึ้น Cloud (R2)")
        print(" 3. ทำทั้งสองรายการ")
        print(" 4. ตรวจสอบไฟล์ Backup ใน R2")
        print(" 5. ทดสอบด้วยข้อมูลจำลอง")
        print(" 6. ออกจากโปรแกรม")
        print("=" * 60)

        choice = input("กรุณาเลือกรายการ (1-6): ").strip()

        if choice == '1':
            run_db_sync(mock_mode=False)

        elif choice == '2':
            run_db_backup(mock_mode=False)

        elif choice == '3':
            sync_ok = run_db_sync(mock_mode=False)
            backup_ok = run_db_backup(mock_mode=False)

            print("\nสรุป:")
            print(f"    Sync : {'สำเร็จ' if sync_ok else 'ไม่สำเร็จ'}")
            print(f"    R2   : {'สำเร็จ' if backup_ok else 'ไม่สำเร็จ'}")

        elif choice == '4':
            check_cloud_backups()

        elif choice == '5':
            print("\n--- ทดสอบ Sync Mock ---")
            run_db_sync(mock_mode=True)

            print("\n--- ทดสอบ Backup Mock ---")
            run_db_backup(mock_mode=True)

        elif choice == '6':
            print("สวัสดีครับ")
            break

        else:
            print("[!] ตัวเลือกไม่ถูกต้อง กรุณาเลือก 1-6")

        input("\nกด Enter เพื่อกลับเมนูหลัก...")


# ============================================================
# COMMAND LINE
# ============================================================

if __name__ == '__main__':
    if len(sys.argv) > 1:
        cmd = sys.argv[1].lower()

        if cmd == 'sync':
            run_db_sync(mock_mode=('--mock' in sys.argv))

        elif cmd == 'backup':
            date_arg = (
                sys.argv[2]
                if len(sys.argv) > 2 and not sys.argv[2].startswith('--')
                else None
            )
            run_db_backup(
                date_str=date_arg,
                mock_mode=('--mock' in sys.argv)
            )

        elif cmd == 'check':
            check_cloud_backups()

        else:
            print(
                "คำสั่งที่ใช้งานได้:\n"
                "  python db_sync_test.py sync\n"
                "  python db_sync_test.py sync --mock\n"
                "  python db_sync_test.py backup\n"
                "  python db_sync_test.py backup --mock\n"
                "  python db_sync_test.py check"
            )
    else:
        show_menu()
