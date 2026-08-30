/**
 * Cloudflare Pages Function: /api/backups
 * Lists all backup files stored in Cloudflare R2 / D1
 */
export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method === 'GET') {
    try {
      const bucket = env.BACKUP_BUCKET || env.R2_BUCKET || env.PAWNSHOP_BACKUPS || env.SLIP_BUCKET || env.BUCKET;
      const filesMap = new Map();

      // 1. List from R2 bucket
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

      // 2. Also check D1 backups table
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
