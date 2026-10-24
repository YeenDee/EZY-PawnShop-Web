/**
 * Cloudflare Pages Function: /api/backup/[[filename]]
 * Handles upload (PUT / POST), download (GET), and delete (DELETE) of daily backup files (.zip / .rar) to R2 Storage.
 * บังคับยืนยันตัวตนด้วย Admin Bearer Token หรือ X-Sync-Secret และป้องกัน Path Traversal
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
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Filename, X-Sync-Secret',
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
    let row = await env.DB.prepare(`SELECT value FROM _sys_secrets WHERE key = 'sync_secret'`).first();
    if (!row || !row.value) {
      await env.DB.prepare(`INSERT OR IGNORE INTO _sys_secrets (key, value) VALUES ('sync_secret', ?)`).bind(syncSecretHeader).run();
      row = await env.DB.prepare(`SELECT value FROM _sys_secrets WHERE key = 'sync_secret'`).first();
    }
    if (row && row.value && timingSafeEqual(syncSecretHeader, row.value)) {
      return { ok: true, role: 'sync' };
    }
  }
  return { ok: false };
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const corsHeaders = getCorsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // ตรวจสอบสิทธิ์ Admin หรือ Sync Worker ทุกกรณี
  const auth = await verifyAdminOrSync(request, env);
  if (!auth.ok) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized: เฉพาะผู้ดูแลระบบเท่านั้น' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // Normalize filename from params, url, or header
  let rawFileName = '';
  if (params && params.filename) {
    rawFileName = Array.isArray(params.filename) ? params.filename.join('/') : String(params.filename);
  }
  if (!rawFileName) {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 3 && pathParts[1] === 'backup') {
      rawFileName = pathParts.slice(2).join('/');
    } else {
      rawFileName = url.searchParams.get('filename') || request.headers.get('X-Filename') || '';
    }
  }

  const fileName = decodeURIComponent(rawFileName).trim();
  // ป้องกัน Path Traversal และอนุญาตเฉพาะไฟล์ .zip / .rar ที่ชื่อปลอดภัย
  if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\') || !/^[a-zA-Z0-9._-]+\.(zip|rar)$/i.test(fileName)) {
    return new Response(JSON.stringify({ success: false, error: 'ชื่อไฟล์สำรองข้อมูลไม่ถูกต้อง (อนุญาตเฉพาะไฟล์ .zip และ .rar)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  const bucket = env.BACKUP_BUCKET || env.R2_BUCKET || env.PAWNSHOP_BACKUPS || env.SLIP_BUCKET || env.BUCKET;

  // ==================== PUT / POST: Upload backup file ====================
  if (request.method === 'PUT' || request.method === 'POST') {
    try {
      const fileBytes = await request.arrayBuffer();
      if (!fileBytes || fileBytes.byteLength === 0) {
        return new Response(JSON.stringify({ success: false, error: 'ไฟล์สำรองข้อมูลว่างเปล่า (0 bytes)' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      let contentType = 'application/zip';
      if (fileName.toLowerCase().endsWith('.rar')) {
        contentType = 'application/x-rar-compressed';
      }

      let r2Saved = false;
      if (bucket) {
        try {
          const objectKey = `Backups/${fileName}`;
          await bucket.put(objectKey, fileBytes, {
            httpMetadata: { contentType },
            customMetadata: {
              uploaded: new Date().toISOString(),
              filename: fileName,
              size: String(fileBytes.byteLength)
            }
          });
          r2Saved = true;
          console.log(`[Backup] Uploaded ${fileName} to R2 (${fileBytes.byteLength} bytes)`);
        } catch (r2Err) {
          console.error(`[Backup] R2 Upload Error:`, r2Err);
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

          const nowISO = new Date().toISOString().replace('T', ' ').substring(0, 19);
          await env.DB.prepare(`
            INSERT INTO backups (filename, uploaded, size, status) VALUES (?, ?, ?, ?)
            ON CONFLICT(filename) DO UPDATE SET
              uploaded = excluded.uploaded,
              size = excluded.size,
              status = excluded.status
          `).bind(fileName, nowISO, fileBytes.byteLength, 'จัดเก็บเรียบร้อย (Cloudflare R2)').run();
        } catch (dbErr) {
          console.error(`[Backup] D1 track error:`, dbErr);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        message: `อัปโหลดไฟล์สำรอง "${fileName}" ขึ้น Cloudflare สำเร็จ`,
        filename: fileName,
        size: fileBytes.byteLength,
        r2_stored: r2Saved
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (err) {
      console.error(`[Backup] Upload error:`, err);
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  // ==================== GET: Download backup file ====================
  if (request.method === 'GET') {
    if (!bucket) {
      return new Response(JSON.stringify({ success: false, error: 'R2 bucket not configured' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    try {
      let object = await bucket.get(`Backups/${fileName}`);
      if (!object) {
        object = await bucket.get(fileName);
      }

      if (!object) {
        return new Response(JSON.stringify({ success: false, error: 'ไม่พบไฟล์สำรองข้อมูลนี้บน R2 Storage' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      headers.set('X-Content-Type-Options', 'nosniff');
      Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));

      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', fileName.toLowerCase().endsWith('.rar') ? 'application/x-rar-compressed' : 'application/zip');
      }

      return new Response(object.body, { headers });
    } catch (err) {
      console.error(`[Backup Download Error]:`, err);
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  // ==================== DELETE: Remove backup file ====================
  if (request.method === 'DELETE') {
    try {
      if (bucket) {
        await bucket.delete(`Backups/${fileName}`);
        await bucket.delete(fileName);
      }
      if (env.DB) {
        try {
          await env.DB.prepare(`DELETE FROM backups WHERE filename = ?`).bind(fileName).run();
        } catch (e) {}
      }
      return new Response(JSON.stringify({ success: true, message: `ลบไฟล์สำรอง ${fileName} สำเร็จ` }), {
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
