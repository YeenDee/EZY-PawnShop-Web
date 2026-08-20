/**
 * Cloudflare Pages Function: /api/config
 * Fast endpoint to read and update bank & shop configuration
 */
export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // GET: Read config
  if (request.method === 'GET') {
    let config = {};
    if (env.DB) {
      try {
        const { results } = await env.DB.prepare("SELECT key, value FROM config").all();
        if (results && results.length > 0) {
          results.forEach(r => { config[r.key] = r.value; });
          return new Response(JSON.stringify({ success: true, config }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
      } catch(e) {}
    }
    if (env.PAWNSHOP_KV) {
      try {
        const raw = await env.PAWNSHOP_KV.get('db_sync_latest');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.config) {
            return new Response(JSON.stringify({ success: true, config: parsed.config }), {
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }
        }
      } catch(e) {}
    }
    return new Response(JSON.stringify({ success: true, config }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // POST: Update config
  if (request.method === 'POST') {
    try {
      const data = await request.json();
      const cfg = data.config || data;

      if (env.DB && typeof cfg === 'object') {
        const stmts = [
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`),
          ...Object.entries(cfg).map(([k, v]) =>
            env.DB.prepare(`INSERT INTO config (key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
              .bind(String(k), String(v ?? ''))
          )
        ];
        await env.DB.batch(stmts);
      }

      if (env.PAWNSHOP_KV && typeof cfg === 'object') {
        try {
          const raw = await env.PAWNSHOP_KV.get('db_sync_latest');
          let prev = {};
          if (raw) { try { prev = JSON.parse(raw); } catch(e){} }
          prev.config = { ...(prev.config || {}), ...cfg };
          await env.PAWNSHOP_KV.put('db_sync_latest', JSON.stringify(prev));
        } catch(e) {}
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
