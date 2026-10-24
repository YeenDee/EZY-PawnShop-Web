/**
 * Cloudflare Pages Function: /api/users
 * CRUD สำหรับผู้ใช้งาน (Admin) บน Cloudflare D1 พร้อมระบบ Password Hashing (PBKDF2) และ HMAC Token Authentication
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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Sync-Secret',
    'Vary': 'Origin'
  };
}

function bufToHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
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

async function hashPassword(password, saltHex = null) {
  if (!saltHex) {
    const saltBytes = new Uint8Array(16);
    crypto.getRandomValues(saltBytes);
    saltHex = bufToHex(saltBytes);
  }
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: hexToBuf(saltHex),
      iterations: 50000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  return `pbkdf2$${saltHex}$${bufToHex(derivedBits)}`;
}

async function verifyPassword(inputPlain, storedValue) {
  if (!storedValue || !inputPlain) return { valid: false, needsUpgrade: false };
  if (storedValue.startsWith('pbkdf2$')) {
    const parts = storedValue.split('$');
    if (parts.length !== 3) return { valid: false, needsUpgrade: false };
    const [, saltHex] = parts;
    const computed = await hashPassword(inputPlain, saltHex);
    return { valid: timingSafeEqual(computed, storedValue), needsUpgrade: false };
  }
  // Legacy plaintext compatibility: verify and mark for immediate hash upgrade
  const isMatch = timingSafeEqual(inputPlain, storedValue);
  return { valid: isMatch, needsUpgrade: isMatch };
}

async function requireAdminAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const secret = await getSystemSecret(env);
  const payload = await verifyToken(token, secret);
  if (!payload || payload.role !== 'admin') return null;
  return payload;
}

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!env.DB) {
    return new Response(JSON.stringify({ success: false, error: 'D1 binding not found' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // Ensure users table exists and seed default admin ONLY if table is empty
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        user_id   TEXT PRIMARY KEY,
        password  TEXT,
        name      TEXT,
        position  TEXT
      )
    `).run();

    const countRow = await env.DB.prepare(`SELECT COUNT(*) AS cnt FROM users`).first();
    if (!countRow || Number(countRow.cnt) === 0) {
      const defaultHash = await hashPassword('admin123');
      await env.DB.prepare(
        `INSERT OR IGNORE INTO users (user_id, password, name, position) VALUES (?, ?, ?, ?)`
      ).bind('admin', defaultHash, 'ผู้จัดการ ชัยชนะ', 'ผู้จัดการ').run();
    }
  } catch (e) {
    console.error('[users] CREATE/SEED TABLE error:', e);
  }

  // ==================== GET: ดึงรายชื่อผู้ใช้ (ต้องเป็น Admin เท่านั้น และไม่ส่งรหัสผ่านกลับ) ====================
  if (request.method === 'GET') {
    const adminPayload = await requireAdminAuth(request, env);
    if (!adminPayload) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized: กรุณาเข้าสู่ระบบผู้ดูแลระบบ' }), {
        status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    try {
      const { results } = await env.DB.prepare(
        `SELECT user_id AS UserID, name AS Name, position AS Position FROM users ORDER BY user_id`
      ).all();
      return new Response(JSON.stringify({ success: true, users: results || [] }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  // ==================== POST: ล็อกอิน / ยืนยัน OTP / เพิ่ม-แก้ไข-ลบผู้ใช้ ====================
  if (request.method === 'POST') {
    try {
      const data = await request.json();
      const action = String(data.action || 'upsert').toLowerCase();

      // --- 1. Verify login (ขั้นที่ 1: ตรวจสอบรหัสผ่านกับ D1 และออกรหัส OTP ฝั่ง Server) ---
      if (action === 'login') {
        const userId   = String(data.user_id   || data.UserID   || '').trim().replace(/-/g, '');
        const password = String(data.password   || data.Password || '').trim();

        if (!userId || !password) {
          return new Response(JSON.stringify({ success: false, error: 'กรุณาระบุรหัสผู้ใช้และรหัสผ่าน' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const { results } = await env.DB.prepare(
          `SELECT user_id AS UserID, password AS Password, name AS Name, position AS Position
           FROM users WHERE replace(user_id, '-', '') = ?`
        ).bind(userId).all();

        if (results && results.length > 0) {
          const matchedUser = results[0];
          const check = await verifyPassword(password, matchedUser.Password);
          if (check.valid) {
            // อัปเกรดรหัสผ่านเป็น PBKDF2 อัตโนมัติหากเดิมเป็น Plaintext
            if (check.needsUpgrade) {
              const upgradedHash = await hashPassword(password);
              await env.DB.prepare(`UPDATE users SET password = ? WHERE user_id = ?`)
                .bind(upgradedHash, matchedUser.UserID).run();
            }

            const secret = await getSystemSecret(env);
            const rnd = new Uint32Array(1);
            crypto.getRandomValues(rnd);
            const otpCode = String(100000 + (rnd[0] % 900000));
            const otpHash = await hmacSha256Hex(otpCode, secret);

            const otpToken = await signToken({
              sub: matchedUser.UserID,
              name: matchedUser.Name,
              position: matchedUser.Position,
              role: 'admin_otp',
              otpHash,
              exp: Date.now() + 5 * 60 * 1000 // OTP หมดอายุใน 5 นาที
            }, secret);

            return new Response(JSON.stringify({
              success: true,
              otp_required: true,
              otp_token: otpToken,
              otp_preview: otpCode,
              user: {
                UserID: matchedUser.UserID,
                Name: matchedUser.Name,
                Position: matchedUser.Position
              }
            }), {
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }
        }

        return new Response(JSON.stringify({ success: false, error: 'ไม่พบผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }), {
          status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // --- 2. Verify OTP (ขั้นที่ 2: ตรวจสอบ OTP ฝั่ง Server แล้วออก Admin Session Token) ---
      if (action === 'verify_otp') {
        const otpToken = String(data.otp_token || '').trim();
        const enteredOtp = String(data.otp || '').trim();
        const secret = await getSystemSecret(env);

        const payload = await verifyToken(otpToken, secret);
        if (!payload || payload.role !== 'admin_otp') {
          return new Response(JSON.stringify({ success: false, error: 'รหัส OTP หมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่' }), {
            status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const enteredHash = await hmacSha256Hex(enteredOtp, secret);
        if (!timingSafeEqual(enteredHash, payload.otpHash)) {
          return new Response(JSON.stringify({ success: false, error: 'รหัส OTP ไม่ถูกต้อง กรุณากรอกใหม่อีกครั้ง' }), {
            status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const sessionToken = await signToken({
          sub: payload.sub,
          name: payload.name,
          position: payload.position,
          role: 'admin',
          exp: Date.now() + 12 * 60 * 60 * 1000 // อายุเซสชัน 12 ชั่วโมง
        }, secret);

        return new Response(JSON.stringify({
          success: true,
          token: sessionToken,
          user: {
            UserID: payload.sub,
            Name: payload.name,
            Position: payload.position
          }
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // --- คำสั่งจัดการผู้ใช้ (upsert / add / edit / delete) ต้องมีสิทธิ์ Admin เท่านั้น ---
      const adminPayload = await requireAdminAuth(request, env);
      if (!adminPayload) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized: ต้องเข้าสู่ระบบผู้ดูแลระบบก่อนทำรายการนี้' }), {
          status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // --- Upsert (add or edit) ---
      if (action === 'upsert' || action === 'add' || action === 'edit') {
        const users = Array.isArray(data.users) ? data.users : (data.user ? [data.user] : []);
        if (users.length === 0) {
          return new Response(JSON.stringify({ success: false, error: 'ไม่พบข้อมูลผู้ใช้ที่จะบันทึก' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const stmts = [];
        for (const u of users) {
          const userId   = String(u.UserID   || u.user_id   || '').trim();
          const rawPass  = String(u.Password || u.password  || '').trim();
          const name     = String(u.Name     || u.name      || '').trim();
          const position = String(u.Position || u.position  || '').trim();
          if (!userId) continue;

          if (rawPass) {
            const hashedPass = rawPass.startsWith('pbkdf2$') ? rawPass : await hashPassword(rawPass);
            stmts.push(
              env.DB.prepare(
                `INSERT INTO users (user_id, password, name, position) VALUES (?, ?, ?, ?)
                 ON CONFLICT(user_id) DO UPDATE SET
                   password = excluded.password,
                   name     = excluded.name,
                   position = excluded.position`
              ).bind(userId, hashedPass, name, position)
            );
          } else {
            // กรณีแก้ไขชื่อหรือตำแหน่งโดยไม่ได้กรอกรหัสผ่านใหม่ ให้คงรหัสผ่านเดิมไว้
            stmts.push(
              env.DB.prepare(
                `UPDATE users SET name = ?, position = ? WHERE user_id = ?`
              ).bind(name, position, userId)
            );
          }
        }

        if (stmts.length > 0) {
          await env.DB.batch(stmts);
        }
        return new Response(JSON.stringify({ success: true, message: `บันทึกผู้ใช้ ${stmts.length} รายการสำเร็จ` }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // --- Delete ---
      if (action === 'delete') {
        const userId = String(data.user_id || data.UserID || (data.user && data.user.UserID) || '').trim();
        if (!userId) {
          return new Response(JSON.stringify({ success: false, error: 'ไม่พบ UserID ที่จะลบ' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        if (userId === adminPayload.sub) {
          return new Response(JSON.stringify({ success: false, error: 'ไม่สามารถลบบัญชีของตนเองที่กำลังใช้งานอยู่ได้' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        await env.DB.prepare(`DELETE FROM users WHERE user_id = ?`).bind(userId).run();
        return new Response(JSON.stringify({ success: true, message: `ลบผู้ใช้ ${userId} เรียบร้อยแล้ว` }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      return new Response(JSON.stringify({ success: false, error: 'action ไม่ถูกต้อง: ใช้ upsert | delete | login | verify_otp' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
}
