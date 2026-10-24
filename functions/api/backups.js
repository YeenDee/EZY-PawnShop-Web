/**
 * Cloudflare Pages Function: /api/backups
 * Lists all backup files stored in Cloudflare R2 / D1 (Admin Only)
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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Sync-Secret',
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

async function verifyAdminOrSync(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ') && env.DB) {
    const token = authHeader.slice(7).trim();
    const secret = await getSystemSecret(env);
    const payload = await verifyToken(token, secret);
    if (payload && payload.role === 'admin') {
      return { ok: true, role: 'admin' };
    }
  }
  const syncSecretHeader = (request.headers.get('X-Sync-Secret') || '').trim();
  if (syncSecretHeader && syncSecretHeader.length >= 32 && env.DB) {
    if (env.SYNC_SECRET && timingSafeEqual(syncSecretHeader, String(env.SYNC_SECRET))) {
      return { ok: true, role: 'sync' };
    }
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS _sys_secrets (key TEXT PRIMARY KEY, value TEXT)`).run();
    const row = await env.DB.prepare(`SELECT value FROM _sys_secrets WHERE key = 'sync_secret'`).first();
    if (row && row.value && timingSafeEqual(syncSecretHeader, row.value)) {
      return { ok: true, role: 'sync' };
    }
  }
  return { ok: false };
}

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method === 'GET') {
    const auth = await verifyAdminOrSync(request, env);
    if (!auth.ok) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized: เฉพาะผู้ดูแลระบบเท่านั้น' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    try {
      const bucket = env.BACKUP_BUCKET || env.R2_BUCKET || env.PAWNSHOP_BACKUPS || env.SLIP_BUCKET || env.BUCKET;
      const filesMap = new Map();

      if (bucket && typeof bucket.list === 'function') {
        try {
          const listed = await bucket.list({ prefix: 'Backups/' });
          if (listed && Array.isArray(listed.objects)) {
            listed.objects.forEach(obj => {
              const cleanName = obj.key.replace(/^Backups\//, '');
              if (cleanName) {
                filesMap.set(cleanName, {
                  filename: cleanName,
                  uploaded: obj.uploaded ? new Date(obj.uploaded).toISOString().replace('T', ' ').substring(0, 19) : '',
                  size: obj.size || 0,
                  status: 'จัดเก็บเรียบร้อย (Cloudflare R2)'
                });
              }
            });
          }
        } catch (r2Err) {
          console.warn('[backups] R2 list error:', r2Err);
        }
      }

      if (env.DB) {
        try {
          await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS backups (
              filename  TEXT PRIMARY KEY,
              uploaded  TEXT,
              size      INTEGER,
              status    TEXT
            )
          `).run();

          const { results } = await env.DB.prepare(
            `SELECT filename, uploaded, size, status FROM backups ORDER BY uploaded DESC`
          ).all();

          if (results && Array.isArray(results)) {
            results.forEach(r => {
              if (!filesMap.has(r.filename)) {
                filesMap.set(r.filename, {
                  filename: r.filename,
                  uploaded: r.uploaded || '',
                  size: r.size || 0,
                  status: r.status || 'จัดเก็บเรียบร้อย (Cloudflare R2)'
                });
              }
            });
          }
        } catch (dbErr) {
          console.warn('[backups] D1 list error:', dbErr);
        }
      }

      const files = Array.from(filesMap.values());
      return new Response(JSON.stringify({ success: true, files }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (err) {
      console.error('[backups] Error:', err);
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
}
