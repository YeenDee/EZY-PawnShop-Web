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
      
      const payments = Array.isArray(data.payments) && data.payments.length > 0
        ? data.payments
        : (data.payment ? [data.payment] : (data.bill_no || data.BillNo ? [data] : []));

      const tickets = Array.isArray(data.tickets) && data.tickets.length > 0
        ? data.tickets
        : (data.ticket ? [data.ticket] : []);

      if (payments.length === 0) {
        return new Response(JSON.stringify({ success: false, error: 'ไม่พบรหัสรับชำระ (BillNo)' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      const mainBillNo = String(payments[0].BillNo || payments[0].bill_no || '');

      if (env.DB) {
        try {
          // Table creation statement
          const createTableStmt = env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS payments (bill_no TEXT, system_id TEXT, bud_year TEXT, book_no TEXT, doc_no TEXT, bill_type TEXT, bill_date TEXT, slip TEXT, id TEXT, PRIMARY KEY (bill_no, system_id, bud_year, book_no, doc_no))`
          );

          const payStmts = [createTableStmt];
          for (const p of payments) {
            const bno = String(p.BillNo || p.bill_no || '');
            if (!bno) continue;
            payStmts.push(
              env.DB.prepare(
                `INSERT INTO payments (bill_no,system_id,bud_year,book_no,doc_no,bill_type,bill_date,slip,id) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(bill_no,system_id,bud_year,book_no,doc_no) DO UPDATE SET bill_type=excluded.bill_type,bill_date=excluded.bill_date,slip=excluded.slip`
              ).bind(
                bno,
                String(p.SystemID || p.system_id || ''),
                String(p.BudYear || p.bud_year || ''),
                String(p.BookNo || p.book_no || ''),
                String(p.DocNo || p.doc_no || ''),
                String(p.BillType || p.bill_type || '9'),
                String(p.BillDate || p.bill_date || ''),
                String(p.Slip || p.slip || ''),
                String(p.Id || p.id || '')
              )
            );
          }

          for (const t of tickets) {
            if (!t.DocNo && !t.doc_no) continue;
            const bno = String(t.BillNo || t.bill_no || mainBillNo);
            const bdate = String(t.BillDate || t.bill_date || payments[0].BillDate || payments[0].bill_date || '');
            const sysId = String(t.SystemID || t.system_id || '');
            const budYr = String(t.BudYear || t.bud_year || '');
            const bookNo = String(t.BookNo || t.book_no || '');
            const docNo = String(t.DocNo || t.doc_no || '');

            payStmts.push(
              env.DB.prepare(
                `UPDATE tickets SET bill_type='9', bill_date=?, bill_no=? WHERE system_id=? AND bud_year=? AND book_no=? AND doc_no=?`
              ).bind(bdate, bno, sysId, budYr, bookNo, docNo)
            );
          }

          await env.DB.batch(payStmts);
        } catch (dbErr) {
          console.error('D1 Payment Insert Error:', dbErr);
        }
      }

      // Also persist to KV if available
      // NOTE: Strip slip (base64 image) before KV to avoid quota exceeded.
      //       Slip is already saved in D1. KV stores metadata only.
      let kvError = null;
      if (env.PAWNSHOP_KV) {
        try {
          const raw = await env.PAWNSHOP_KV.get('db_sync_latest');
          let prev = {};
          if (raw) { try { prev = JSON.parse(raw); } catch(e){} }
          let curPayments = prev.payments || [];
          for (const p of payments) {
            const bno   = String(p.BillNo   || p.bill_no   || '');
            const sysId = String(p.SystemID || p.system_id || '');
            const docNo = String(p.DocNo    || p.doc_no    || '');
            // Strip slip (base64) — can be large and cause quota exceeded
            const pKV = { ...p };
            delete pKV.Slip;
            delete pKV.slip;
            const idx = curPayments.findIndex(cp =>
              String(cp.BillNo   || cp.bill_no)   === bno &&
              String(cp.SystemID || cp.system_id) === sysId &&
              String(cp.DocNo    || cp.doc_no)    === docNo
            );
            if (idx > -1) curPayments[idx] = pKV;
            else curPayments.push(pKV);
          }
          prev.payments = curPayments;
          const kvPayload = JSON.stringify(prev);
          // KV value limit: 25 MB. Warn in logs if approaching.
          if (kvPayload.length > 20_000_000) {
            console.warn(`[payment] KV payload size ${kvPayload.length} bytes — approaching 25MB limit`);
          }
          await env.PAWNSHOP_KV.put('db_sync_latest', kvPayload);
        } catch (kvErr) {
          // Surface KV error — do NOT swallow silently
          console.error('[payment] KV put error:', kvErr);
          kvError = kvErr.message || String(kvErr);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        message: `บันทึกรายการชำระเงิน ${mainBillNo} (${payments.length} รายการ) ขึ้น Cloudflare สำเร็จ`,
        bill_no: mainBillNo,
        count: payments.length,
        // Include KV warning if it failed (D1 still succeeded)
        kv_warning: kvError ? `KV sync warning: ${kvError}` : undefined
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
