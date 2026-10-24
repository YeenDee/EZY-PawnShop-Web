/**
 * Cloudflare Pages Function: /api/payment
 * Instant endpoint for customer payment submission and admin approval
 * - Customer token: บังคับสถานะ bill_type = '9' และ bill_stat = '9' (ป้องกันการปลอมสถานะอนุมัติ)
 * - Admin token: อนุญาตให้อัปเดตสถานะเป็น '2' / 'I' (อนุมัติการชำระ)
 * - สุ่มรหัสท้ายชื่อไฟล์สลิป (Unguessable Token) เพื่อป้องกันการไล่เดาชื่อไฟล์สลิปของผู้อื่น (IDOR)
 */

const ALLOWED_ORIGINS = [
  'https://ezy-pawnshop2006.rainbow-ocean.site',
  'https://ezy-pawnshop-web.pages.dev',
  'http://localhost:8000',
  'http://127.0.0.1:8000'
];

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.ezy-pawnshop-web.pages.dev')
    ? origin
    : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Vary': 'Origin'
  };
}

function bufToHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  const strA = String(a || '');
  const strB = String(b || '');
  if (strA.length !== strB.length) return false;
  let diff = 0;
  for (let i = 0; i < strA.length; i++) {
    diff |= strA.charCodeAt(i) ^ strB.charCodeAt(i);
  }
  return diff === 0;
}

async function getSystemSecret(env) {
  if (env.AUTH_SECRET) return String(env.AUTH_SECRET);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS _sys_secrets (key TEXT PRIMARY KEY, value TEXT)`).run();
  let row = await env.DB.prepare(`SELECT value FROM _sys_secrets WHERE key = 'jwt_secret'`).first();
  if (!row || !row.value) {
    const rnd = new Uint8Array(32);
    crypto.getRandomValues(rnd);
    const newSecret = bufToHex(rnd);
    await env.DB.prepare(`INSERT OR IGNORE INTO _sys_secrets (key, value) VALUES ('jwt_secret', ?)`).bind(newSecret).run();
    row = await env.DB.prepare(`SELECT value FROM _sys_secrets WHERE key = 'jwt_secret'`).first();
  }
  return row.value;
}

async function hmacSha256Hex(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bufToHex(sig);
}

async function verifyToken(tokenStr, secret) {
  if (!tokenStr || typeof tokenStr !== 'string') return null;
  const parts = tokenStr.split('.');
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const expectedSig = await hmacSha256Hex(b64, secret);
  if (!timingSafeEqual(sig, expectedSig)) return null;
  try {
    const pad = b64.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

async function requireUserAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const secret = await getSystemSecret(env);
  const payload = await verifyToken(token, secret);
  if (!payload || (payload.role !== 'customer' && payload.role !== 'admin')) return null;
  return payload;
}

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // POST: Customer submits payment slip or Admin approves payment
  if (request.method === 'POST') {
    if (!env.DB) {
      return new Response(JSON.stringify({ success: false, error: 'D1 binding not found' }), {
        status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const authUser = await requireUserAuth(request, env);
    if (!authUser) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized: กรุณาเข้าสู่ระบบก่อนทำรายการชำระเงิน' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const isAdmin = authUser.role === 'admin';

    try {
      const data = await request.json();
      
      const payments = Array.isArray(data.payments) && data.payments.length > 0
        ? data.payments
        : (data.payment ? [data.payment] : (data.bill_no || data.BillNo ? [data] : []));

      const tickets = Array.isArray(data.tickets) && data.tickets.length > 0
        ? data.tickets
        : (data.ticket ? [data.ticket] : []);

      if (payments.length === 0) {
        return new Response(JSON.stringify({ success: false, error: 'ไม่พบรหัสรับชำระ (BillNo)' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      const mainBillNo = String(payments[0].BillNo || payments[0].bill_no || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!mainBillNo) {
        return new Response(JSON.stringify({ success: false, error: 'รูปแบบรหัสรับชำระไม่ถูกต้อง' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // สร้างรหัสสุ่ม 8 ไบต์ (16 hex chars) ต่อท้ายชื่อไฟล์สลิปเพื่อป้องกันการไล่เดา URL (IDOR)
      const rndBytes = new Uint8Array(8);
      crypto.getRandomValues(rndBytes);
      const slipToken = bufToHex(rndBytes);

      let r2Warning = null;
      const uploadedCache = new Map();

      async function processSlip(p, bno) {
        const safeBno = String(bno || '').replace(/[^a-zA-Z0-9_-]/g, '');
        let rawSlip = String(p.Slip || p.slip || '');
        if (!rawSlip || rawSlip.length < 200) {
          // กรณีเป็น path เดิมอยู่แล้ว ตรวจสอบว่าเป็น path ที่ปลอดภัยเท่านั้น
          if (rawSlip.startsWith('/Slip/') && !rawSlip.includes('..')) {
            return rawSlip;
          }
          return '';
        }

        if (uploadedCache.has(safeBno)) {
          return uploadedCache.get(safeBno);
        }

        // ตรวจสอบว่าเป็น data URL ของรูปภาพที่อนุญาตเท่านั้น
        if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(rawSlip)) {
          r2Warning = 'รูปแบบไฟล์สลิปไม่ถูกต้อง (รองรับเฉพาะ JPG, PNG, WEBP)';
          return '';
        }

        const fileNameWithToken = `${safeBno}_${slipToken}.jpg`;
        const pathUrl = `/Slip/${fileNameWithToken}`;

        if (env.SLIP_BUCKET) {
          try {
            const base64Data = rawSlip.replace(/^data:image\/\w+;base64,/, '');
            const binaryStr = atob(base64Data);
            const len = binaryStr.length;
            if (len > 10 * 1024 * 1024) {
              r2Warning = 'ขนาดไฟล์สลิปเกิน 10MB';
              return '';
            }
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            let contentType = 'image/jpeg';
            if (rawSlip.startsWith('data:image/png')) contentType = 'image/png';
            else if (rawSlip.startsWith('data:image/webp')) contentType = 'image/webp';

            await env.SLIP_BUCKET.put(`Slip/${fileNameWithToken}`, bytes, {
              httpMetadata: { contentType }
            });
            uploadedCache.set(safeBno, pathUrl);
            return pathUrl;
          } catch (r2Err) {
            const errMsg = r2Err.message || String(r2Err);
            console.error(`[payment] R2 Upload Error for ${safeBno}: ${errMsg}`);
            r2Warning = `R2 upload failed for ${safeBno}: ${errMsg}`;
            return '';
          }
        }
        return '';
      }

      let d1Error = null;
      const slipUrls = {};

      if (env.DB) {
        try {
          await env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS payments (bill_no TEXT, system_id TEXT, bud_year TEXT, book_no TEXT, doc_no TEXT, bill_type TEXT, bill_date TEXT, slip TEXT, id TEXT, PRIMARY KEY (bill_no, system_id, bud_year, book_no, doc_no))`
          ).run();

          await env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS tickets (system_id TEXT, bud_year TEXT, book_no TEXT, doc_no TEXT, bill_stat TEXT, bill_type TEXT, bill_date TEXT, bill_no TEXT, asstotal TEXT, month_total TEXT, month_int TEXT, totalint TEXT, app_date TEXT, exp_date TEXT, model TEXT, id TEXT, cust_code TEXT, PRIMARY KEY (system_id, bud_year, book_no, doc_no))`
          ).run();

          try { await env.DB.prepare(`ALTER TABLE tickets ADD COLUMN bill_stat TEXT`).run(); } catch(e){}
          try { await env.DB.prepare(`ALTER TABLE tickets ADD COLUMN bill_type TEXT`).run(); } catch(e){}
          try { await env.DB.prepare(`ALTER TABLE tickets ADD COLUMN bill_date TEXT`).run(); } catch(e){}
          try { await env.DB.prepare(`ALTER TABLE tickets ADD COLUMN bill_no TEXT`).run(); } catch(e){}

          try {
            const pkInfo = await env.DB.prepare(`PRAGMA table_info(payments)`).all();
            const pkCols = (pkInfo.results || []).filter(c => c.pk > 0);
            if (pkCols.length === 1 && pkCols[0].name === 'bill_no') {
              await env.DB.batch([
                env.DB.prepare(`CREATE TABLE IF NOT EXISTS payments_v2 (bill_no TEXT, system_id TEXT, bud_year TEXT, book_no TEXT, doc_no TEXT, bill_type TEXT, bill_date TEXT, slip TEXT, id TEXT, PRIMARY KEY (bill_no, system_id, bud_year, book_no, doc_no))`),
                env.DB.prepare(`INSERT OR IGNORE INTO payments_v2 SELECT * FROM payments`),
                env.DB.prepare(`DROP TABLE payments`),
                env.DB.prepare(`ALTER TABLE payments_v2 RENAME TO payments`)
              ]);
            }
          } catch(migErr) {}

          const payStmts = [];
          for (const p of payments) {
            const bno = String(p.BillNo || p.bill_no || '').replace(/[^a-zA-Z0-9_-]/g, '');
            if (!bno) continue;
            const slipUrl = await processSlip(p, bno);
            if (slipUrl) slipUrls[bno] = slipUrl;

            // ป้องกันการปลอมสถานะ: ลูกค้าส่งได้เฉพาะ '9' (รอตรวจสอบ) เท่านั้น! เฉพาะ Admin จึงตั้งเป็น '2' ได้
            const bType = isAdmin ? String(p.BillType || p.bill_type || '2') : '9';
            const ownerId = isAdmin ? String(p.Id || p.id || '') : String(authUser.sub || p.Id || p.id || '');

            payStmts.push(
              env.DB.prepare(
                `UPDATE payments SET bill_type = ?, bill_date = CASE WHEN ? != '' THEN ? ELSE bill_date END WHERE bill_no = ?`
              ).bind(bType, String(p.BillDate || p.bill_date || ''), String(p.BillDate || p.bill_date || ''), bno)
            );
            payStmts.push(
              env.DB.prepare(
                `INSERT OR REPLACE INTO payments (bill_no,system_id,bud_year,book_no,doc_no,bill_type,bill_date,slip,id) VALUES(?,?,?,?,?,?,?,?,?)`
              ).bind(
                bno,
                String(p.SystemID || p.system_id || ''),
                String(p.BudYear || p.bud_year || ''),
                String(p.BookNo || p.book_no || ''),
                String(p.DocNo || p.doc_no || ''),
                bType,
                String(p.BillDate || p.bill_date || ''),
                slipUrl,
                ownerId
              )
            );
          }

          for (const t of tickets) {
            if (!t.DocNo && !t.doc_no) continue;
            const bno = String(t.BillNo || t.bill_no || mainBillNo).replace(/[^a-zA-Z0-9_-]/g, '');
            const bdate = String(t.BillDate || t.bill_date || payments[0].BillDate || payments[0].bill_date || '');
            const sysId = String(t.SystemID || t.system_id || '');
            const budYr = String(t.BudYear || t.bud_year || '');
            const bookNo = String(t.BookNo || t.book_no || '');
            const docNo = String(t.DocNo || t.doc_no || '');

            // ป้องกันการปลอมสถานะตั๋ว: ลูกค้าตั้งได้เฉพาะ '9' (รอตรวจสอบ) เท่านั้น
            const tBillStat = isAdmin ? String(t.BillStat || t.bill_stat || 'I') : '9';
            const tBillType = isAdmin ? String(t.BillType || t.bill_type || '2') : '9';

            if (isAdmin) {
              payStmts.push(
                env.DB.prepare(
                  `UPDATE tickets SET bill_stat=?, bill_type=?, bill_date=?, bill_no=? WHERE system_id=? AND bud_year=? AND book_no=? AND doc_no=?`
                ).bind(tBillStat, tBillType, bdate, bno, sysId, budYr, bookNo, docNo)
              );
            } else {
              // ตรวจสอบความเป็นเจ้าของตั๋วสำหรับลูกค้า
              const custId = String(authUser.sub || '');
              const custCode = String(authUser.custCode || custId);
              payStmts.push(
                env.DB.prepare(
                  `UPDATE tickets SET bill_stat='9', bill_type='9', bill_date=?, bill_no=?
                   WHERE system_id=? AND bud_year=? AND book_no=? AND doc_no=?
                   AND (id=? OR cust_code=? OR replace(id,'-','')=replace(?,'-',''))`
                ).bind(bdate, bno, sysId, budYr, bookNo, docNo, custId, custCode, custId)
              );
            }
          }

          if (payStmts.length > 0) {
            await env.DB.batch(payStmts);
          }
        } catch (dbErr) {
          console.error('D1 Payment Insert Error:', dbErr);
          d1Error = dbErr.message || String(dbErr);
        }
      }

      let kvError = null;
      if (env.PAWNSHOP_KV) {
        try {
          const raw = await env.PAWNSHOP_KV.get('db_sync_latest');
          let prev = {};
          if (raw) { try { prev = JSON.parse(raw); } catch(e){} }
          let curPayments = (prev.payments || []).map(cp => {
            const c = { ...cp }; delete c.Slip; delete c.slip; return c;
          });
          for (const p of payments) {
            const bno   = String(p.BillNo   || p.bill_no   || '').replace(/[^a-zA-Z0-9_-]/g, '');
            const sysId = String(p.SystemID || p.system_id || '');
            const docNo = String(p.DocNo    || p.doc_no    || '');
            const enforcedType = isAdmin ? String(p.BillType || p.bill_type || '2') : '9';
            const pKV = { ...p, BillType: enforcedType, bill_type: enforcedType };
            delete pKV.Slip;
            delete pKV.slip;
            const idx = curPayments.findIndex(cp =>
              String(cp.BillNo   || cp.bill_no)   === bno &&
              String(cp.SystemID || cp.system_id) === sysId &&
              String(cp.DocNo    || cp.doc_no)    === docNo
            );
            if (idx > -1) curPayments[idx] = pKV;
            else curPayments.push(pKV);
          }
          prev.payments = curPayments;
          const kvPayload = JSON.stringify(prev);
          await env.PAWNSHOP_KV.put('db_sync_latest', kvPayload);
        } catch (kvErr) {
          console.error('[payment] KV put error:', kvErr);
          kvError = kvErr.message || String(kvErr);
        }
      }

      const mainSlipUrl = slipUrls[mainBillNo] || '';

      return new Response(JSON.stringify({
        success: !d1Error,
        message: d1Error
          ? `เกิดข้อผิดพลาดในการบันทึก D1 Database: ${d1Error}`
          : `บันทึกรายการชำระเงิน ${mainBillNo} (${payments.length} รายการ) ขึ้น Cloudflare สำเร็จ`,
        bill_no: mainBillNo,
        slip_url: r2Warning ? '' : mainSlipUrl,
        slip_urls: r2Warning ? {} : slipUrls,
        count: payments.length,
        d1_error: d1Error || undefined,
        kv_warning: kvError ? `KV sync warning: ${kvError}` : undefined,
        r2_warning: r2Warning || undefined
      }), {
        status: d1Error ? 500 : 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
}
