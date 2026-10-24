import http.server
import socket
import socketserver
import threading
import json
import os
import subprocess
import sys
import configparser
from urllib.parse import urlparse

try:
    if sys.stdout is None:
        sys.stdout = open(os.devnull, 'w', encoding='utf-8')
    if sys.stderr is None:
        sys.stderr = open(os.devnull, 'w', encoding='utf-8')
except Exception:
    pass

try:
    import pymysql
    import pymysql.cursors
except Exception:
    pass

import db_sync

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(sys.executable)) if getattr(sys, 'frozen', False) else os.path.dirname(os.path.abspath(__file__))

# อนุญาตเฉพาะไฟล์ Static สำหรับหน้าเว็บเท่านั้น (บล็อกการดาวน์โหลด option.ini, .py, last_cloud_sync.json, .git ฯลฯ)
ALLOWED_STATIC_FILES = {
    '/',
    '/index.html',
    '/app.js',
    '/app.css',
    '/manifest.json',
    '/sw.js',
    '/pawn_config.json',
    '/Logo.ico',
    '/ezy-pawnshop2006.ico',
    '/icon-192.png',
    '/icon-512.png',
    '/Backgroud.png',
    '/Logobank-kb.jpg',
    '/Logobank-ktb.jpg',
    '/logobank.jpg',
    '/logobank.png',
}

ALLOWED_ORIGINS = {
    'https://ezy-pawnshop2006.rainbow-ocean.site',
    'https://EZY-Pawnshop2006.rainbow-ocean.site',
    'https://ezy-pawnshop-web.pages.dev',
    'http://localhost:8000',
    'http://127.0.0.1:8000',
}

def get_sys_gov():
    ini_path = os.path.join(DIRECTORY, 'option.ini')
    if os.path.exists(ini_path):
        try:
            cfg = configparser.ConfigParser()
            cfg.read(ini_path, encoding='utf-8')
            return int(cfg.get('Settings', 'SysGov', fallback='0'))
        except Exception:
            pass
    return 0


class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def log_message(self, format, *args):
        try:
            if sys.stderr is not None:
                super().log_message(format, *args)
        except Exception:
            pass

    def _check_csrf_or_origin(self):
        origin = self.headers.get('Origin', '')
        req_with = self.headers.get('X-Requested-With', '')
        if origin and origin not in ALLOWED_ORIGINS and not origin.endswith('.ezy-pawnshop-web.pages.dev'):
            return False
        if req_with not in ('XMLHttpRequest', 'EZY-PawnShop'):
            return False
        return True

    def do_GET(self):
        parsed_path = urlparse(self.path).path

        if parsed_path == '/api/ping':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps({
                "ok": True,
                "service": "ezy-pawnshop-local-sync",
                "sys_gov": get_sys_gov()
            }, ensure_ascii=False).encode('utf-8'))
            return
        elif parsed_path == '/api/sync':
            if not self._check_csrf_or_origin():
                self.send_response(403)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": "Forbidden"}, ensure_ascii=False).encode('utf-8'))
                return

            sync_file = os.path.join(DIRECTORY, "last_cloud_sync.json")
            if os.path.exists(sync_file):
                try:
                    with open(sync_file, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.end_headers()
                    self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))
                    return
                except Exception:
                    pass
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps({"customers": [], "tickets": [], "payments": []}, ensure_ascii=False).encode('utf-8'))
            return
        elif parsed_path == '/api/backups':
            if not self._check_csrf_or_origin():
                self.send_response(403)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": "Forbidden"}, ensure_ascii=False).encode('utf-8'))
                return

            backup_dir = r"S:\Backup" if os.path.exists(r"S:\Backup") else (r"d:\backup" if os.path.exists(r"d:\backup") else r"D:\Backup")
            files = []
            if os.path.exists(backup_dir):
                for fn in os.listdir(backup_dir):
                    if fn.lower().endswith('.zip'):
                        fp = os.path.join(backup_dir, fn)
                        st = os.stat(fp)
                        dt_str = os.path.basename(fp)
                        files.append({
                            "filename": fn,
                            "size": st.st_size,
                            "uploaded": dt_str,
                            "status": "จัดเก็บในเครื่อง (S:\\Backup)"
                        })
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "files": files}, ensure_ascii=False).encode('utf-8'))
            return

        # บล็อกการเข้าถึงไฟล์ระบบหรือไฟล์ความลับ เช่น /option.ini, /last_cloud_sync.json, /.git, /*.py
        if parsed_path not in ALLOWED_STATIC_FILES:
            self.send_error(403, "Forbidden")
            return

        super().do_GET()

    def do_POST(self):
        if not self._check_csrf_or_origin():
            self.send_response(403)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps({"success": False, "error": "Forbidden: Untrusted Origin or Missing Header"}, ensure_ascii=False).encode('utf-8'))
            return

        if self.path.startswith('/api/sync'):
            try:
                content_len = int(self.headers.get('Content-Length', 0))
                if content_len > 0:
                    self.rfile.read(content_len)

                cust_path = r"S:\AppServ\MySQL\data\PawnShop\customer"
                tick_path = r"S:\AppServ\MySQL\data\PawnShop\ticket"
                
                if not (os.path.exists(cust_path) or os.path.exists(cust_path + ".MYD")):
                    cust_path = r"S:\AppServ\MySQL\data\Pawnshop\customer"
                    tick_path = r"S:\AppServ\MySQL\data\Pawnshop\ticket"

                if not (os.path.exists(cust_path) or os.path.exists(cust_path + ".MYD")):
                    cust_path = r"S:\server\AppServ\MySQL\data\Pawnshop\customer"
                    tick_path = r"S:\server\AppServ\MySQL\data\Pawnshop\ticket"
                
                cust_exists = os.path.exists(cust_path) or os.path.exists(cust_path + ".MYD") or os.path.exists(cust_path + ".ibd")
                tick_exists = os.path.exists(tick_path) or os.path.exists(tick_path + ".MYD") or os.path.exists(tick_path + ".ibd")
                
                # โหลด option.ini ใหม่ทุกครั้งก่อนซิงค์เผื่อมีการแก้ไขค่า
                try:
                    db_sync._MYSQL_CFG, db_sync._CF_CFG = db_sync._load_config()
                    db_sync.MYSQL_HOST     = db_sync._MYSQL_CFG['host']
                    db_sync.MYSQL_USER     = db_sync._MYSQL_CFG['user']
                    db_sync.MYSQL_PASSWORD = db_sync._MYSQL_CFG['password']
                    db_sync.MYSQL_DB       = db_sync._MYSQL_CFG['database']
                    db_sync.CF_SYNC_SECRET = db_sync._CF_CFG.get('sync_secret', '')
                except Exception:
                    pass

                sync_err_msg = ""
                try:
                    res_ok = db_sync.run_db_sync(mock_mode=False)
                    sync_ok = bool(res_ok) if res_ok is not None else True
                except Exception as sync_e:
                    sync_err_msg = str(sync_e)
                    print(f"[!] run_db_sync error: {sync_e}")
                    sync_ok = False
                
                ticket_count = 0
                customer_count = 0
                sync_file = os.path.join(DIRECTORY, "last_cloud_sync.json")
                if os.path.exists(sync_file):
                    try:
                        with open(sync_file, 'r', encoding='utf-8') as f:
                            sdata = json.load(f)
                            ticket_count = len(sdata.get('tickets', []))
                            customer_count = len(sdata.get('customers', []))
                    except Exception:
                        pass

                response_data = {
                    "success": sync_ok,
                    "message": "ซิงค์ข้อมูล MySQL → Cloudflare D1 เรียบร้อยแล้ว" if sync_ok else f"db_sync.py ทำงานผิดพลาด: {sync_err_msg}",
                    "tickets": ticket_count,
                    "customers": customer_count,
                    "cust_found": cust_exists,
                    "tick_found": tick_exists,
                    "cust_path": cust_path,
                    "output": "db_sync.run_db_sync() completed successfully" if sync_ok else f"db_sync failed: {sync_err_msg}",
                    "error_output": sync_err_msg
                }
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps(response_data, ensure_ascii=False).encode('utf-8'))
                
            except subprocess.TimeoutExpired:
                self.send_response(504)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": "db_sync.py timeout (>120s)"}, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False).encode('utf-8'))

        elif self.path.startswith('/api/config'):
            try:
                content_len = int(self.headers.get('Content-Length', 0))
                post_body = self.rfile.read(content_len)
                data = json.loads(post_body.decode('utf-8'))
                raw_cfg = data.get('config', data)
                allowed_keys = {'shop_name', 'bank_name', 'bank_logo', 'bank_color', 'bank_acc', 'bank_acc_name', 'system_id'}
                cfg = {k: v for k, v in raw_cfg.items() if k in allowed_keys} if isinstance(raw_cfg, dict) else {}
                
                pawn_config_file = os.path.join(DIRECTORY, "pawn_config.json")
                with open(pawn_config_file, 'w', encoding='utf-8') as f:
                    json.dump(cfg, f, ensure_ascii=False, indent=2)
                
                sync_file = os.path.join(DIRECTORY, "last_cloud_sync.json")
                if os.path.exists(sync_file):
                    try:
                        with open(sync_file, 'r', encoding='utf-8') as f:
                            sync_data = json.load(f)
                        sync_data['config'] = cfg
                        with open(sync_file, 'w', encoding='utf-8') as f:
                            json.dump(sync_data, f, ensure_ascii=False, indent=2)
                    except Exception:
                        pass
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "message": "อัปเดต pawn_config.json เรียบร้อยแล้ว"}, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False).encode('utf-8'))
        else:
            self.send_error(404, "File not found")

    def end_headers(self):
        origin = self.headers.get('Origin', '')
        allow_origin = origin if (origin in ALLOWED_ORIGINS or origin.endswith('.ezy-pawnshop-web.pages.dev')) else 'http://localhost:8000'
        self.send_header('Access-Control-Allow-Origin', allow_origin)
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Authorization, X-Sync-Secret')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

class ThreadingServerV4(socketserver.ThreadingTCPServer):
    allow_reuse_address = False
    daemon_threads = True

class ThreadingServerV6(socketserver.ThreadingTCPServer):
    address_family = socket.AF_INET6
    allow_reuse_address = False
    daemon_threads = True

if __name__ == '__main__':
    os.chdir(DIRECTORY)
    # Bind เฉพาะ Loopback (::1 และ 127.0.0.1) เท่านั้น เพื่อป้องกันเครื่องอื่นในวง LAN เข้าถึงพอร์ต 8000
    try:
        httpd_v6 = ThreadingServerV6(("::1", PORT), CustomHandler)
        t_v6 = threading.Thread(target=httpd_v6.serve_forever, daemon=True)
        t_v6.start()
    except Exception:
        pass

    with ThreadingServerV4(("127.0.0.1", PORT), CustomHandler) as httpd:
        print(f"[*] Custom EZY Pawnshop Server running at http://127.0.0.1:{PORT} (DIR: {DIRECTORY})")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[*] Server stopping...")
            httpd.shutdown()
