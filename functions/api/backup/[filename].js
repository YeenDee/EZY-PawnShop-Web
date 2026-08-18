/**
 * Cloudflare Pages Function: /api/backup/:filename
 * Uploads or downloads a specific backup zip file from Cloudflare R2
 */
export async function onRequest(context) {
  const { request, env, params } = context;
  const filename = params.filename || 'pawnshop-backup.zip';

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // GET - Download file
  if (request.method === 'GET') {
    if (env.BACKUP_BUCKET) {
      const object = await env.BACKUP_BUCKET.get(filename);
      if (object) {
        return new Response(object.body, {
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${filename}"`,
            ...corsHeaders
          }
        });
      }
    }
    return new Response('File not found', { status: 404, headers: corsHeaders });
  }

  // PUT / POST - Upload file
  if (request.method === 'PUT' || request.method === 'POST') {
    try {
      if (env.BACKUP_BUCKET) {
        await env.BACKUP_BUCKET.put(filename, request.body);
      }
      return new Response(JSON.stringify({ success: true, filename, message: `อัปโหลดไฟล์สำรอง ${filename} ขึ้น R2 สำเร็จ` }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: corsHeaders
      });
    }
  }

  return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
}
