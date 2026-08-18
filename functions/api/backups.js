/**
 * Cloudflare Pages Function: /api/backups
 * Lists all backup zip files in Cloudflare R2 Bucket
 */
export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let files = [];
    if (env.BACKUP_BUCKET) {
      const list = await env.BACKUP_BUCKET.list();
      files = list.objects.map(obj => ({
        filename: obj.key,
        size: obj.size,
        uploaded: obj.uploaded.toISOString()
      }));
    }
    return new Response(JSON.stringify({ success: true, files }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, files: [], error: err.message }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}
