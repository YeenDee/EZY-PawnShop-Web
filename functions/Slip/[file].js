/**
 * Cloudflare Pages Function: /Slip/[file]
 * Serves payment slip images from Cloudflare R2 bucket (SLIP_BUCKET) with strict path validation & security headers
 */
export async function onRequest(context) {
  const { env, params } = context;
  const rawName = String(params.file || '').trim();

  // ป้องกัน Path Traversal และอนุญาตเฉพาะนามสกุลรูปภาพที่ปลอดภัย
  if (!rawName || !/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(rawName)) {
    return new Response('Invalid file name', { status: 400 });
  }

  if (!env.SLIP_BUCKET) {
    return new Response('R2 SLIP_BUCKET not configured', { status: 503 });
  }

  try {
    const objectKey = `Slip/${rawName}`;
    const object = await env.SLIP_BUCKET.get(objectKey);

    if (!object) {
      return new Response('Slip image not found', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'private, max-age=3600');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");

    if (rawName.toLowerCase().endsWith('.png')) {
      headers.set('Content-Type', 'image/png');
    } else if (rawName.toLowerCase().endsWith('.webp')) {
      headers.set('Content-Type', 'image/webp');
    } else {
      headers.set('Content-Type', 'image/jpeg');
    }

    return new Response(object.body, { headers });
  } catch (err) {
    console.error('[Slip R2 Get Error]:', err);
    return new Response('Error retrieving slip image', { status: 500 });
  }
}
