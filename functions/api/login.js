/**
 * Cloudflare Pages Function: /api/login
 * Handles customer authentication and server-side OTP verification (with LINE Reply API integration)
 * against D1 SQL database, issuing a signed Customer Bearer authToken upon verification.
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

async function signToken(payloadObj, secret) {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(payloadObj));
  let bin = '';
  jsonBytes.forEach(b => { bin += String.fromCharCode(b); });
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sig = await hmacSha256Hex(b64, secret);
  return `${b64}.${sig}`;
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

async function ensureOtpTable(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS _otp_sessions (
      session_id TEXT PRIMARY KEY,
      otp_code TEXT,
      id_card TEXT,
      cust_code TEXT,
      status TEXT,
      line_user_id TEXT,
      created_at INTEGER,
      expires_at INTEGER
    )
  `).run();
}

async function getLineSettings(env) {
  let lineToken = String(env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();
  let lineOaId = '';
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS _sys_secrets (key TEXT PRIMARY KEY, value TEXT)`).run();
    const tokenRow = await env.DB.prepare(`SELECT value FROM _sys_secrets WHERE key = 'line_channel_token'`).first();
    if (tokenRow && tokenRow.value && String(tokenRow.value).trim()) {
      lineToken = String(tokenRow.value).trim();
    }
    const oaRow = await env.DB.prepare(`SELECT value FROM config WHERE key = 'line_oa_id'`).first();
    if (oaRow && oaRow.value) {
      lineOaId = String(oaRow.value).trim();
    }
  } catch (e) {}
  return {
    lineRequired: Boolean(lineToken),
    lineOaId
  };
}

async function issueCustomerAuthResponse(env, secret, payload, corsHeaders) {
  const custId = String(payload.sub || '');
  const custCode = String(payload.custCode || custId);
  const plainId = custId.replace(/[^0-9a-zA-Z]/g, '');

  const { results: matchedCusts } = await env.DB.prepare(`
    SELECT id as Id, cust_code as CustCode, name as Name, tel as Tel
    FROM customers
    WHERE id = ? OR cust_code = ? OR replace(id, '-', '') = ? OR replace(cust_code, '-', '') = ?
  `).bind(custId, custCode, plainId, plainId).all();

  if (!matchedCusts || matchedCusts.length === 0) {
    return new Response(JSON.stringify({ success: false, error: 'ไม่พบข้อมูลลูกค้าในระบบ' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  const customer = matchedCusts[0];
  const { results: tickets } = await env.DB.prepare(`
    SELECT system_id as SystemID, bud_year as BudYear, book_no as BookNo, doc_no as DocNo, bill_stat as BillStat, bill_type as BillType, bill_date as BillDate, bill_no as BillNo, asstotal as Asstotal, month_total as MonthTotal, month_int as MonthInt, totalint as Totalint, app_date as AppDate, exp_date as ExpDate, model as Model, id as Id, cust_code as CustCode
    FROM tickets
    WHERE id = ? OR cust_code = ? OR replace(id, '-', '') = ? OR replace(cust_code, '-', '') = ?
  `).bind(customer.Id, customer.CustCode || customer.Id, plainId, plainId).all();

  const sessionToken = await signToken({
    sub: customer.Id,
    custCode: customer.CustCode || customer.Id,
    role: 'customer',
    exp: Date.now() + 4 * 60 * 60 * 1000 // อายุเซสชันลูกค้า 4 ชั่วโมง
  }, secret);

  return new Response(JSON.stringify({
    success: true,
    verified: true,
    token: sessionToken,
    customer,
    tickets: tickets || []
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method === 'POST') {
    try {
      const data = await request.json();
      const action = String(data.action || 'login').toLowerCase();

      if (!env.DB) {
        return new Response(JSON.stringify({ success: false, error: 'ฐานข้อมูล D1 ไม่พร้อมใช้งาน' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // ==================== AUTO-POLLING: CHECK IF OTP WAS VERIFIED VIA LINE REPLY API ====================
      if (action === 'check_otp') {
        const otpToken = String(data.otp_token || '').trim();
        const secret = await getSystemSecret(env);
        const payload = await verifyToken(otpToken, secret);

        if (!payload || payload.role !== 'customer_otp' || !payload.sessionId) {
          return new Response(JSON.stringify({ success: false, expired: true, error: 'รหัส OTP หมดอายุแล้ว' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        await ensureOtpTable(env);
        const session = await env.DB.prepare(
          `SELECT session_id, status, expires_at FROM _otp_sessions WHERE session_id = ?`
        ).bind(payload.sessionId).first();

        if (session && session.status === 'VERIFIED' && Number(session.expires_at) > Date.now()) {
          // ลบเซสชัน OTP ทันทีเพื่อป้องกันการใช้ซ้ำ (One-Time Use) และออก authToken ให้ลูกค้า
          await env.DB.prepare(`DELETE FROM _otp_sessions WHERE session_id = ?`).bind(payload.sessionId).run();
          return await issueCustomerAuthResponse(env, secret, payload, corsHeaders);
        }

        return new Response(JSON.stringify({
          success: true,
          verified: false,
          status: session ? session.status : 'EXPIRED'
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // ==================== STEP 2: VERIFY OTP & ISSUE CUSTOMER authToken ====================
      if (action === 'verify_otp') {
        const otpToken = String(data.otp_token || '').trim();
        const enteredOtp = String(data.otp || '').trim();
        const secret = await getSystemSecret(env);

        const payload = await verifyToken(otpToken, secret);
        if (!payload || payload.role !== 'customer_otp') {
          return new Response(JSON.stringify({ success: false, error: 'รหัส OTP หมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        await ensureOtpTable(env);
        const { lineRequired } = await getLineSettings(env);
        let session = null;
        if (payload.sessionId) {
          session = await env.DB.prepare(
            `SELECT session_id, status, expires_at FROM _otp_sessions WHERE session_id = ?`
          ).bind(payload.sessionId).first();
        }

        // กรณีตั้งค่า LINE Token ไว้แล้ว บังคับให้ต้องส่งรหัส OTP ยืนยันผ่านแชท LINE OA ก่อน
        if (lineRequired) {
          if (!session || session.status !== 'VERIFIED') {
            return new Response(JSON.stringify({
              success: false,
              error: 'กรุณาส่งรหัส OTP 6 หลักนี้ไปยังแชท LINE ของร้านเพื่อยืนยันตัวตนก่อนครับ (เมื่อบอทตอบกลับใน LINE แล้ว ระบบจะเข้าสู่หน้าหลักอัตโนมัติ)'
            }), {
              status: 401,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }
        } else {
          // Fallback กรณีแอดมินยังไม่ได้ตั้งค่า LINE Token: ตรวจสอบรหัส 6 หลักที่กรอกกับ Hash บนเซิร์ฟเวอร์
          const enteredHash = await hmacSha256Hex(enteredOtp, secret);
          if (!timingSafeEqual(enteredHash, payload.otpHash)) {
            return new Response(JSON.stringify({ success: false, error: 'รหัส OTP ไม่ถูกต้อง กรุณากรอกใหม่อีกครั้ง' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }
        }

        if (payload.sessionId) {
          await env.DB.prepare(`DELETE FROM _otp_sessions WHERE session_id = ?`).bind(payload.sessionId).run();
        }

        return await issueCustomerAuthResponse(env, secret, payload, corsHeaders);
      }

      // ==================== STEP 1: CHECK CUSTOMER ID & PHONE -> GENERATE OTP ====================
      const inputId = String(data.id || '').trim();
      const inputContact = String(data.contact || '').trim();

      const plainId = inputId.replace(/[^0-9a-zA-Z]/g, '');
      const plainContact = inputContact.replace(/[^0-9]/g, '');

      // บังคับต้องระบุทั้งเลขบัตรประชาชน/รหัสลูกค้า และเบอร์โทรศัพท์อย่างน้อย 9 หลัก
      if (!plainId || !plainContact || plainContact.length < 9) {
        return new Response(JSON.stringify({
          success: false,
          error: 'กรุณาระบุเลขบัตรประชาชน และเบอร์โทรศัพท์มือถือให้ครบถ้วน'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      const { results: matchedCusts } = await env.DB.prepare(`
        SELECT id as Id, cust_code as CustCode, name as Name, tel as Tel
        FROM customers
        WHERE id = ? OR cust_code = ? OR replace(id, '-', '') = ? OR replace(cust_code, '-', '') = ?
      `).bind(inputId, inputId, plainId, plainId).all();

      if (matchedCusts && matchedCusts.length > 0) {
        const customer = matchedCusts[0];
        const dbTel = String(customer.Tel || '').replace(/\D/g, '');

        const phoneValid = dbTel.length >= 9 && (
          dbTel === plainContact ||
          (dbTel.endsWith(plainContact.slice(-9)) && plainContact.endsWith(dbTel.slice(-9)))
        );

        if (phoneValid) {
          const secret = await getSystemSecret(env);
          await ensureOtpTable(env);

          const now = Date.now();
          const exp = now + 5 * 60 * 1000; // OTP หมดอายุใน 5 นาที

          // ล้างเซสชัน OTP ที่หมดอายุแล้วออกจาก D1
          await env.DB.prepare(`DELETE FROM _otp_sessions WHERE expires_at < ?`).bind(now).run();

          // สุ่มรหัส OTP 6 หลัก และ Session ID
          const rnd = new Uint32Array(1);
          crypto.getRandomValues(rnd);
          const otpCode = String(100000 + (rnd[0] % 900000));

          const sidBytes = new Uint8Array(16);
          crypto.getRandomValues(sidBytes);
          const sessionId = bufToHex(sidBytes);

          await env.DB.prepare(`
            INSERT INTO _otp_sessions (session_id, otp_code, id_card, cust_code, status, line_user_id, created_at, expires_at)
            VALUES (?, ?, ?, ?, 'PENDING', '', ?, ?)
          `).bind(
            sessionId,
            otpCode,
            customer.Id,
            customer.CustCode || customer.Id,
            now,
            exp
          ).run();

          const otpHash = await hmacSha256Hex(otpCode, secret);
          const otpToken = await signToken({
            sub: customer.Id,
            custCode: customer.CustCode || customer.Id,
            sessionId,
            role: 'customer_otp',
            otpHash,
            exp
          }, secret);

          const { lineRequired, lineOaId } = await getLineSettings(env);

          return new Response(JSON.stringify({
            success: true,
            otp_required: true,
            otp_token: otpToken,
            otp_preview: otpCode,
            line_required: lineRequired,
            line_oa_id: lineOaId
          }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
      }

      return new Response(JSON.stringify({
        success: false,
        error: 'ไม่พบข้อมูลลูกค้า หรือเบอร์โทรศัพท์ไม่ตรงกับในระบบ'
      }), {
        status: 404,
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
