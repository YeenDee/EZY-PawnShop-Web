/**
 * Cloudflare Pages Function: /api/backup/[[filename]]
 * Handles upload (PUT / POST), download (GET), and delete (DELETE) of daily backup files (.zip / .rar) to R2 Storage.
 */
export async function onRequest(context) {
  const { request, env, params } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Filename',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
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
  const bucket = env.BACKUP_BUCKET || env.R2_BUCKET || env.PAWNSHOP_BACKUPS || env.SLIP_BUCKET || env.BUCKET;

  // ==================== PUT / POST: Upload backup file ====================
  if (request.method === 'PUT' || request.method === 'POST') {
    if (!fileName) {
      return new Response(JSON.stringify({ success: false, error: 'กรุณาระบุชื่อไฟล์สำรองข้อมูล' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

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

      // 1. Save to R2 bucket if configured
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
      } else {
        console.warn(`[Backup] No R2 bucket binding found (BACKUP_BUCKET / R2_BUCKET / SLIP_BUCKET)`);
      }

      // 2. Track in D1 database if configured
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
    if (!fileName) {
      return new Response(JSON.stringify({ success: false, error: 'กรุณาระบุชื่อไฟล์ที่จะดาวน์โหลด' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

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
    if (!fileName) {
      return new Response(JSON.stringify({ success: false, error: 'กรุณาระบุชื่อไฟล์ที่จะลบ' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

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
