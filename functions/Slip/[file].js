/**
 * Cloudflare Pages Function: /Slip/[file]
 * Serves payment slip images from Cloudflare R2 bucket (SLIP_BUCKET)
 */
export async function onRequest(context) {
  const { request, env, params } = context;
  const fileName = params.file;

  if (!fileName) {
    return new Response('File name required', { status: 400 });
  }

  // Check R2 bucket binding
  if (!env.SLIP_BUCKET) {
    return new Response('R2 SLIP_BUCKET not configured', { status: 503 });
  }

  try {
    const objectKey = `Slip/${fileName}`;
    const object = await env.SLIP_BUCKET.get(objectKey);

    if (!object) {
      return new Response('Slip image not found', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    
    // Default content type if not set
    if (!headers.has('Content-Type')) {
      if (fileName.toLowerCase().endsWith('.png')) {
        headers.set('Content-Type', 'image/png');
      } else if (fileName.toLowerCase().endsWith('.webp')) {
        headers.set('Content-Type', 'image/webp');
      } else {
        headers.set('Content-Type', 'image/jpeg');
      }
    }

    return new Response(object.body, { headers });
  } catch (err) {
    console.error('[Slip R2 Get Error]:', err);
    return new Response('Error retrieving slip image', { status: 500 });
  }
}
