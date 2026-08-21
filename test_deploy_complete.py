# ตัวอย่างเช็คว่า API ทำงานหรือยัง
import urllib.request, ssl, json
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def test(url, payload):
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data,
        headers={'Content-Type':'application/json','User-Agent':'Mozilla/5.0'},
        method='POST')
    try:
        with urllib.request.urlopen(req, timeout=15, context=ctx) as r:
            print(url, r.status, r.read().decode())
    except urllib.error.HTTPError as e:
        print(url, e.code, e.read().decode())

test('https://ezy-pawnshop-web.pages.dev/api/config', {'config':{'test':'ok'}})
test('https://ezy-pawnshop-web.pages.dev/api/sync',   {'config':{'test':'ok'}})
test('https://ezy-pawnshop-web.pages.dev/api/login',  {'username':'admin','password':'admin123'})