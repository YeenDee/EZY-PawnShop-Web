/**
 * Cloudflare Pages Function: /api/config
 * Fast endpoint to read and update bank & shop configuration
 * GET = Public (สำหรับแสดงชื่อร้านและเลขบัญชีรับโอน)
 * POST = ต้องยืนยันตัวตนด้วย Admin Bearer Token เท่านั้น
 */

const ALLOWED_ORIGINS = [
  'https://ezy-pawnshop2006.rainbow-ocean.site',
  'https://ezy-pawnshop-web.pages.dev',
  'http://localhost:8000',
  'http://127.0.0.1:8000'
];

const ALLOWED_CONFIG_KEYS = new Set([
  'shop_name',
  'bank_name',
  'bank_logo',
  'bank_color',
  'bank_acc',
  'bank_acc_name',
  'system_id'
]);

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.ezy-pawnshop-web.pages.dev')
    ? origin
    : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

  // GET: Read public bank & shop config
  if (request.method === 'GET') {
    let config = {};
    if (env.DB) {
      try {
        const { results } = await env.DB.prepare("SELECT key, value FROM config").all();
        if (results && results.length > 0) {
          results.forEach(r => {
            if (ALLOWED_CONFIG_KEYS.has(r.key)) {
              config[r.key] = r.value;
            }
          });
          if (Object.keys(config).length > 0) {
            return new Response(JSON.stringify({ success: true, config }), {
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }
        }
      } catch(e) {}
    }
    if (env.PAWNSHOP_KV) {
      try {
        const raw = await env.PAWNSHOP_KV.get('db_sync_latest');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.config && typeof parsed.config === 'object') {
            Object.entries(parsed.config).forEach(([k, v]) => {
              if (ALLOWED_CONFIG_KEYS.has(k)) config[k] = v;
            });
            return new Response(JSON.stringify({ success: true, config }), {
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }
        }
      } catch(e) { console.error('[config] KV GET error:', e.message || e); }
    }
    return new Response(JSON.stringify({ success: true, config }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // POST: Update config (Admin Only!)
  if (request.method === 'POST') {
    if (!env.DB) {
      return new Response(JSON.stringify({ success: false, error: 'D1 binding not found' }), {
        status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const adminPayload = await requireAdminAuth(request, env);
    if (!adminPayload) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized: เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถแก้ไขการตั้งค่าได้' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    try {
      const data = await request.json();
      const rawCfg = data.config || data;
      const cfg = {};

      if (rawCfg && typeof rawCfg === 'object') {
        Object.entries(rawCfg).forEach(([k, v]) => {
          if (ALLOWED_CONFIG_KEYS.has(k)) {
            cfg[k] = String(v ?? '').trim();
          }
        });
      }

      if (Object.keys(cfg).length === 0) {
        return new Response(JSON.stringify({ success: false, error: 'ไม่พบข้อมูลการตั้งค่าที่ถูกต้อง' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      if (env.DB) {
        const stmts = [
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`),
          ...Object.entries(cfg).map(([k, v]) =>
            env.DB.prepare(`INSERT INTO config (key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
              .bind(String(k), String(v ?? ''))
          )
        ];
        await env.DB.batch(stmts);
      }

      if (env.PAWNSHOP_KV) {
        try {
          const raw = await env.PAWNSHOP_KV.get('db_sync_latest');
          let prev = {};
          if (raw) { try { prev = JSON.parse(raw); } catch(e){} }
          prev.config = { ...(prev.config || {}), ...cfg };
          await env.PAWNSHOP_KV.put('db_sync_latest', JSON.stringify(prev));
        } catch(e) { console.error('[config] KV POST error:', e.message || e); }
      }

      return new Response(JSON.stringify({ success: true, message: 'บันทึกการตั้งค่าขึ้น Cloudflare สำเร็จ' }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    } catch(err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
}
