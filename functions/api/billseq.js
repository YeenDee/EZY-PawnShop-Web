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

    // Ensure config table exists
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`
    ).run();

    // Atomic increment of key 'runno': INSERT '1' if not exists, else UPDATE value + 1
    await env.DB.prepare(
      `INSERT INTO config (key, value) VALUES ('runno', '1')
       ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`
    ).run();

    // Read back the current 'runno' value
    const row = await env.DB.prepare(
      `SELECT value FROM config WHERE key = 'runno'`
    ).first();

    const seq = row ? parseInt(row.value, 10) : 1;
    const billNo = `${prefix}-${String(seq).padStart(4, '0')}`;

    // Clean up any legacy runno_Oxxxx or last_bill_no keys if present
    try {
      await env.DB.prepare(`DELETE FROM config WHERE key LIKE 'runno_O%' OR key = 'last_bill_no'`).run();
    } catch(e) {}

    console.log(`[billseq] Generated ${billNo} (runno=${seq})`);

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
