/**
 * Cloudflare Pages Function: /api/billseq
 * Atomic server-side BillNo sequence generator
 * ป้องกัน Race Condition: ทุก request ได้ sequence number ที่ไม่ซ้ำกัน
 *
 * POST body: { prefix: "O260826" }
 * Response:  { success: true, bill_no: "O260826-0001", seq: 1 }
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

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  if (!env.DB) {
    return new Response(JSON.stringify({ success: false, error: 'D1 binding not found' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  try {
    const body = await request.json();
    const prefix = String(body.prefix || '').trim();
    if (!prefix || !/^O\d{6}$/.test(prefix)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid prefix format. Expected: O + YYMMDD (e.g. O260826)' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const kvKey = `runno_${prefix}`;

    // Ensure config table exists
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`
    ).run();

    // Atomic increment: INSERT seq=1 if not exists, else UPDATE seq+1
    // D1 does not support RETURNING in batch, so we do two steps:
    // 1. Upsert with increment
    // 2. Read current value
    await env.DB.prepare(
      `INSERT INTO config (key, value) VALUES (?, '1')
       ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`
    ).bind(kvKey).run();

    // Read back the current value
    const row = await env.DB.prepare(
      `SELECT value FROM config WHERE key = ?`
    ).bind(kvKey).first();

    const seq = row ? parseInt(row.value, 10) : 1;
    const billNo = `${prefix}-${String(seq).padStart(4, '0')}`;

    // Update general runno and last_bill_no in config table
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO config (key, value) VALUES ('runno', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(String(seq)),
        env.DB.prepare(`INSERT INTO config (key, value) VALUES ('last_bill_no', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(billNo)
      ]);
    } catch(e) {}

    console.log(`[billseq] Generated ${billNo} (key=${kvKey}, seq=${seq})`);

    return new Response(JSON.stringify({
      success: true,
      bill_no: billNo,
      prefix,
      seq
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (err) {
    console.error('[billseq] Error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}
