#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
EZY Pawnshop 2006 - Cloudflare Pages Direct Upload (No Git Required)
ใช้ Cloudflare Pages Direct Upload API v2 สำหรับ deploy ไฟล์
โดยไม่ต้องใช้ Git หรือ Wrangler
"""

import os, ssl, json, uuid, hashlib, mimetypes, urllib.request, urllib.error, struct

# อ่านค่าจาก option.ini
import configparser
_cfg = configparser.ConfigParser()
_cfg.read(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'option.ini'))

CF_ACCOUNT_ID  = _cfg.get('cloudflare', 'account_id', fallback='')
CF_API_TOKEN   = _cfg.get('cloudflare', 'api_token', fallback='')
PROJECT_NAME   = 'ezy-pawnshop2006'
BASE_DIR       = os.path.dirname(os.path.abspath(__file__))

_ctx = ssl.create_default_context()
_ctx.check_hostname = False
_ctx.verify_mode = ssl.CERT_NONE

# ไฟล์ที่ต้อง deploy ขึ้น Cloudflare Pages
UPLOAD_FILES = [
    ('index.html',                  '/index.html'),
    ('app.js',                      '/app.js'),
    ('app.css',                     '/app.css'),
    ('manifest.json',               '/manifest.json'),
    ('sw.js',                       '/sw.js'),
    ('icon-192.png',                '/icon-192.png'),
    ('icon-512.png',                '/icon-512.png'),
    ('Logo.ico',                    '/Logo.ico'),
    ('pawn_config.json',            '/pawn_config.json'),
    ('Logobank-kb.jpg',             '/Logobank-kb.jpg'),
    ('Logobank-ktb.jpg',            '/Logobank-ktb.jpg'),
    ('functions/api/login.js',      '/functions/api/login.js'),
    ('functions/api/sync.js',       '/functions/api/sync.js'),
    ('functions/api/config.js',     '/functions/api/config.js'),
    ('functions/api/payment.js',    '/functions/api/payment.js'),
]

def cf_request(method, url, body=None, content_type='application/json'):
    headers = {
        'Authorization': f'Bearer {CF_API_TOKEN}',
        'Content-Type': content_type,
    }
    if body and isinstance(body, str):
        body = body.encode('utf-8')
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120, context=_ctx) as r:
            return r.status, json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8'))
        except:
            return e.code, {'error': str(e)}
    except Exception as ex:
        return 0, {'error': str(ex)}

def build_multipart(files):
    bnd = 'CfPagesBound' + uuid.uuid4().hex[:12]
    parts = []
    for local_name, web_path in files:
        full_path = os.path.join(BASE_DIR, local_name)
        if not os.path.exists(full_path):
            print(f'  [skip] ไม่พบไฟล์: {local_name}')
            continue
        with open(full_path, 'rb') as f:
            data = f.read()
        mime = mimetypes.guess_type(local_name)[0] or 'application/octet-stream'
        hdr = (
            f'--{bnd}\r\n'
            f'Content-Disposition: form-data; name="{web_path}"; filename="{os.path.basename(local_name)}"\r\n'
            f'Content-Type: {mime}\r\n\r\n'
        ).encode('utf-8')
        parts.append(hdr + data + b'\r\n')
        print(f'  [+] {web_path}  ({len(data):,} bytes)')
    # ---- Add manifest JSON part (required by Cloudflare) ----
    import hashlib, json
    manifest = {
        "metadata": {"type": "pages_deployment"},
        "files": {}
    }
    for local_name, web_path in files:
        full_path = os.path.join(BASE_DIR, local_name)
        if not os.path.exists(full_path):
            continue
        with open(full_path, 'rb') as f:
            file_bytes = f.read()
        sha256 = hashlib.sha256(file_bytes).hexdigest()
        manifest["files"][web_path] = {"hash": sha256}
    manifest_json = json.dumps(manifest)
    manifest_hdr = (
        f'--{bnd}\r\n'
        f'Content-Disposition: form-data; name="manifest"; filename="manifest.json"\r\n'
        f'Content-Type: application/json\r\n\r\n'
    ).encode('utf-8')
    parts.append(manifest_hdr + manifest_json.encode('utf-8') + b'\r\n')
    # -------------------------------------------------------
    parts.append(f'--{bnd}--\r\n'.encode('utf-8'))
    return b''.join(parts), bnd

print('=' * 60)
print('  EZY Pawnshop 2006 — Cloudflare Pages Direct Upload')
print('=' * 60)
print(f'\n[1] เตรียมไฟล์ทั้งหมด...')
body, bnd = build_multipart(UPLOAD_FILES)

print(f'\n[2] กำลัง deploy ขึ้น Cloudflare Pages "{PROJECT_NAME}"...')
url = f'https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/pages/projects/{PROJECT_NAME}/deployments'
status, result = cf_request(
    'POST', url,
    body=body,
    content_type=f'multipart/form-data; boundary={bnd}'
)

print(f'    HTTP Status: {status}')
if result.get('success'):
    r = result.get('result', {})
    print(f'\n[+] Deploy สำเร็จ!')
    print(f'    ID  : {r.get("id")}')
    print(f'    URL : {r.get("url")}')
    print(f'    สถานะ: {r.get("latest_stage", {}).get("name")}')
else:
    errs = result.get('errors', [])
    for e in errs:
        print(f'\n[!] Error {e.get("code")}: {e.get("message")}')
    
    if any(e.get('code') in [10000, 10014, 9109] for e in errs):
        print("""
╔══════════════════════════════════════════════════════╗
║  Token ปัจจุบันไม่มีสิทธิ์ "Pages:Edit"              ║
║                                                      ║
║  วิธีแก้: ให้ push ผ่าน GitHub แทน                  ║
║                                                      ║
║  1. ไปที่ https://github.com และ login               ║
║  2. สร้าง repo ใหม่ชื่อ "EZY-PawnShop-Web"           ║
║  3. copy URL ของ repo (เช่น                          ║
║     https://github.com/bigyee999/EZY-PawnShop-Web)  ║
║  4. รันคำสั่ง (ใน Git Bash หรือ CMD):                ║
║                                                      ║
║  cd D:\\EZY-PawnShop-Web                             ║
║  git remote add origin [URL จาก GitHub]              ║
║  git push -u origin main                             ║
║                                                      ║
║  Cloudflare Pages จะ build+deploy อัตโนมัติ!        ║
╚══════════════════════════════════════════════════════╝
""")
    else:
        print(f'\n  Full response: {json.dumps(result, ensure_ascii=False, indent=2)[:500]}')

print('=' * 60)
