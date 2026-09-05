import http.server
import socketserver
import json
import os
import subprocess
import sys

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        if self.path.startswith('/api/sync'):
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
                except Exception as e:
                    pass
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps({"customers": [], "tickets": [], "payments": []}, ensure_ascii=False).encode('utf-8'))
            return
        elif self.path.startswith('/api/backups'):
            backup_dir = r"S:\Backup" if os.path.exists(r"S:\Backup") else (r"d:\backup" if os.path.exists(r"d:\backup") else r"D:\Backup")
            files = []
            if os.path.exists(backup_dir):
                for fn in os.listdir(backup_dir):
                    if fn.lower().endswith('.zip'):
                        fp = os.path.join(backup_dir, fn)
                        st = os.stat(fp)
                        mtime = st.st_mtime
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
        super().do_GET()

    # do_OPTIONS is handled uniformly at end of class

    def do_POST(self):
        if self.path == '/api/sync':
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
                
                # รัน db_sync.run_db_sync() ตรงๆ (อ่าน config จาก option.ini [mysql] แล้วซิงค์ตรงเข้า Cloudflare D1)
                import db_sync
                try:
                    db_sync.run_db_sync(mock_mode=False)
                    sync_ok = True
                except Exception as sync_e:
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
                    "message": "ซิงค์ข้อมูล MySQL → Cloudflare D1 เรียบร้อยแล้ว" if sync_ok else "db_sync.py ทำงานแต่อาจมีข้อผิดพลาด",
                    "tickets": ticket_count,
                    "customers": customer_count,
                    "cust_found": cust_exists,
                    "tick_found": tick_exists,
                    "cust_path": cust_path,
                    "output": "db_sync.run_db_sync() completed successfully" if sync_ok else "db_sync failed",
                    "error_output": ""
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

        elif self.path == '/api/config':
            try:
                content_len = int(self.headers.get('Content-Length', 0))
                post_body = self.rfile.read(content_len)
                data = json.loads(post_body.decode('utf-8'))
                cfg = data.get('config', data)
                
                # 1. Update pawn_config.json
                pawn_config_file = os.path.join(DIRECTORY, "pawn_config.json")
                with open(pawn_config_file, 'w', encoding='utf-8') as f:
                    json.dump(cfg, f, ensure_ascii=False, indent=2)
                
                # 2. Update config in last_cloud_sync.json if exists
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
                self.wfile.write(json.dumps({"success": True, "message": "อัปเดต pawn_config.json เรียบร้อยแล้ว (WEB APPLICATION PORTAL Version 1.0)"}, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False).encode('utf-8'))
        else:
            self.send_error(404, "File not found")

    def end_headers(self):
        # Enable CORS and Chrome Private Network Access (PNA)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Authorization, *')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

if __name__ == '__main__':
    os.chdir(DIRECTORY)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
        print(f"[*] Custom EZY Pawnshop Server running at http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[*] Server stopping...")
            httpd.shutdown()
