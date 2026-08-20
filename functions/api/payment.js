/**
 * Cloudflare Pages Function: /api/payment
 * Instant endpoint for customer payment submission (lightweight, ~50KB)
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

  // POST: Customer submits payment slip
  if (request.method === 'POST') {
    try {
      const data = await request.json();
      const p = data.payment || data;
      const t = data.ticket;

      const billNo = String(p.BillNo || p.bill_no || '');
      if (!billNo) {
        return new Response(JSON.stringify({ success: false, error: 'ไม่พบรหัสรับชำระ (BillNo)' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      if (env.DB) {
        try {
          await env.DB.batch([
            env.DB.prepare(`CREATE TABLE IF NOT EXISTS payments (bill_no TEXT PRIMARY KEY, system_id TEXT, bud_year TEXT, book_no TEXT, doc_no TEXT, bill_type TEXT, bill_date TEXT, slip TEXT, id TEXT)`),
            env.DB.prepare(`INSERT INTO payments (bill_no,system_id,bud_year,book_no,doc_no,bill_type,bill_date,slip,id) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(bill_no) DO UPDATE SET bill_type=excluded.bill_type,bill_date=excluded.bill_date,slip=excluded.slip`)
              .bind(billNo, String(p.SystemID||p.system_id||''), String(p.BudYear||p.bud_year||''), String(p.BookNo||p.book_no||''), String(p.DocNo||p.doc_no||''), String(p.BillType||p.bill_type||'9'), String(p.BillDate||p.bill_date||''), String(p.Slip||p.slip||''), String(p.Id||p.id||''))
          ]);

          if (t && t.DocNo) {
            await env.DB.prepare(`UPDATE tickets SET bill_type='9', bill_date=?, bill_no=? WHERE system_id=? AND bud_year=? AND book_no=? AND doc_no=?`)
              .bind(String(t.BillDate||p.BillDate||''), billNo, String(t.SystemID||p.SystemID||''), String(t.BudYear||p.BudYear||''), String(t.BookNo||p.BookNo||''), String(t.DocNo||p.DocNo||''))
              .run();
          }
        } catch(dbErr) {
          console.error('D1 Payment Insert Error:', dbErr);
        }
      }

      // Also persist to KV if available
      if (env.PAWNSHOP_KV) {
        try {
          const raw = await env.PAWNSHOP_KV.get('db_sync_latest');
          let prev = {};
          if (raw) { try { prev = JSON.parse(raw); } catch(e){} }
          const curPayments = prev.payments || [];
          const idx = curPayments.findIndex(cp => cp.BillNo === billNo);
          if (idx > -1) curPayments[idx] = p;
          else curPayments.push(p);
          prev.payments = curPayments;
          await env.PAWNSHOP_KV.put('db_sync_latest', JSON.stringify(prev));
        } catch(kvErr){}
      }

      return new Response(JSON.stringify({
        success: true,
        message: `บันทึกรายการชำระเงิน ${billNo} ขึ้น Cloudflare สำเร็จ`,
        bill_no: billNo
      }), {
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
