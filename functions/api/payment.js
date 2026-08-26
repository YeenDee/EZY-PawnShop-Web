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

      // processSlip: อัปโหลด base64 ขึ้น R2, คืน path URL ("/Slip/BillNo.jpg")
      // ถ้า R2 upload ล้มเหลว → คืน '' และ set r2Warning เพื่อแจ้ง client
      let r2Warning = null;
      async function processSlip(p, bno) {
        let rawSlip = String(p.Slip || p.slip || '');
        if (!rawSlip || rawSlip.length < 200) {
          return rawSlip; // Already a path URL or empty
        }
        const pathUrl = `/Slip/${bno}.jpg`;
        if (env.SLIP_BUCKET) {
          try {
            const base64Data = rawSlip.replace(/^data:image\/\w+;base64,/, '');
            const binaryStr = atob(base64Data);
            const len = binaryStr.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            let contentType = 'image/jpeg';
            if (rawSlip.startsWith('data:image/png')) contentType = 'image/png';
            else if (rawSlip.startsWith('data:image/webp')) contentType = 'image/webp';

            await env.SLIP_BUCKET.put(`Slip/${bno}.jpg`, bytes, {
              httpMetadata: { contentType }
            });
            console.log(`[payment] Saved slip for ${bno} to R2 (Slip/${bno}.jpg)`);
            return pathUrl;
          } catch (r2Err) {
            // R2 upload failed → return empty, set warning (D1 will store '' instead of wrong path)
            const errMsg = r2Err.message || String(r2Err);
            console.error(`[payment] R2 Upload Error for ${bno}: ${errMsg}`);
            r2Warning = `R2 upload failed for ${bno}: ${errMsg}`;
            return ''; // ไม่คืน pathUrl เพราะไฟล์ไม่ได้ถูกอัปโหลดจริง
          }
        }
        return ''; // No R2 bucket binding
      }

      let d1Error = null;
      if (env.DB) {
        try {
          // Table creation statement
          await env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS payments (bill_no TEXT, system_id TEXT, bud_year TEXT, book_no TEXT, doc_no TEXT, bill_type TEXT, bill_date TEXT, slip TEXT, id TEXT, PRIMARY KEY (bill_no, system_id, bud_year, book_no, doc_no))`
          ).run();

          await env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS tickets (system_id TEXT, bud_year TEXT, book_no TEXT, doc_no TEXT, bill_stat TEXT, bill_type TEXT, bill_date TEXT, bill_no TEXT, asstotal TEXT, month_total TEXT, month_int TEXT, totalint TEXT, app_date TEXT, exp_date TEXT, model TEXT, id TEXT, cust_code TEXT, PRIMARY KEY (system_id, bud_year, book_no, doc_no))`
          ).run();

          // Safely ensure columns exist on tickets table in D1
          try { await env.DB.prepare(`ALTER TABLE tickets ADD COLUMN bill_stat TEXT`).run(); } catch(e){}
          try { await env.DB.prepare(`ALTER TABLE tickets ADD COLUMN bill_type TEXT`).run(); } catch(e){}
          try { await env.DB.prepare(`ALTER TABLE tickets ADD COLUMN bill_date TEXT`).run(); } catch(e){}
          try { await env.DB.prepare(`ALTER TABLE tickets ADD COLUMN bill_no TEXT`).run(); } catch(e){}

          const payStmts = [];
          for (const p of payments) {
            const bno = String(p.BillNo || p.bill_no || '');
            if (!bno) continue;
            const slipUrl = await processSlip(p, bno);
            payStmts.push(
              env.DB.prepare(
                `INSERT OR REPLACE INTO payments (bill_no,system_id,bud_year,book_no,doc_no,bill_type,bill_date,slip,id) VALUES(?,?,?,?,?,?,?,?,?)`
              ).bind(
                bno,
                String(p.SystemID || p.system_id || ''),
                String(p.BudYear || p.bud_year || ''),
                String(p.BookNo || p.book_no || ''),
                String(p.DocNo || p.doc_no || ''),
                String(p.BillType || p.bill_type || '9'),
                String(p.BillDate || p.bill_date || ''),
                slipUrl,
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
                `UPDATE tickets SET bill_stat='9', bill_type='9', bill_date=?, bill_no=? WHERE system_id=? AND bud_year=? AND book_no=? AND doc_no=?`
              ).bind(bdate, bno, sysId, budYr, bookNo, docNo)
            );
          }

          if (payStmts.length > 0) {
            await env.DB.batch(payStmts);
          }
        } catch (dbErr) {
          console.error('D1 Payment Insert Error:', dbErr);
          d1Error = dbErr.message || String(dbErr);
        }
      }

      // Also persist to KV if available
      // IMPORTANT: Strip slip from ALL payments (existing + new) before KV put.
      // Previous KV writes may have accumulated base64 slip data.
      let kvError = null;
      if (env.PAWNSHOP_KV) {
        try {
          const raw = await env.PAWNSHOP_KV.get('db_sync_latest');
          let prev = {};
          if (raw) { try { prev = JSON.parse(raw); } catch(e){} }
          // Strip slip from ALL existing payments in KV (clean up accumulated data)
          let curPayments = (prev.payments || []).map(cp => {
            const c = { ...cp }; delete c.Slip; delete c.slip; return c;
          });
          // Merge new payments (also strip slip)
          for (const p of payments) {
            const bno   = String(p.BillNo   || p.bill_no   || '');
            const sysId = String(p.SystemID || p.system_id || '');
            const docNo = String(p.DocNo    || p.doc_no    || '');
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
          if (kvPayload.length > 20_000_000) {
            console.warn(`[payment] KV payload size ${kvPayload.length} bytes — approaching 25MB limit`);
          }
          await env.PAWNSHOP_KV.put('db_sync_latest', kvPayload);
        } catch (kvErr) {
          console.error('[payment] KV put error:', kvErr);
          kvError = kvErr.message || String(kvErr);
        }
      }

      // Collect slip URLs per billNo to return to client
      const slipUrls = {};
      for (const p of payments) {
        const bno = String(p.BillNo || p.bill_no || '');
        if (bno) {
          slipUrls[bno] = `/Slip/${bno}.jpg`;
        }
      }

      return new Response(JSON.stringify({
        success: !d1Error,
        message: d1Error
          ? `เกิดข้อผิดพลาดในการบันทึก D1 Database: ${d1Error}`
          : `บันทึกรายการชำระเงิน ${mainBillNo} (${payments.length} รายการ) ขึ้น Cloudflare สำเร็จ`,
        bill_no: mainBillNo,
        // slip_url: path ของรูปสลิปใน R2 ให้ client อัปเดต Slip field ใน localStorage
        slip_url: r2Warning ? '' : `/Slip/${mainBillNo}.jpg`,
        slip_urls: r2Warning ? {} : slipUrls,
        count: payments.length,
        d1_error: d1Error || undefined,
        kv_warning: kvError ? `KV sync warning: ${kvError}` : undefined,
        r2_warning: r2Warning || undefined
      }), {
        status: d1Error ? 500 : 200,
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
