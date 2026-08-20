/**
 * Cloudflare Pages Advanced Mode Worker: _worker.js
 * Handles all /api/* routes directly with D1 database and delegates static files to env.ASSETS
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ==================== 1. API: /api/config ====================
    if (url.pathname === '/api/config') {
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
              const p = JSON.parse(raw);
              if (p.config) config = p.config;
            }
          } catch(e) {}
        }
        return new Response(JSON.stringify({ success: true, config }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

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
          return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
        }
      }
    }

    // ==================== 2. API: /api/payment ====================
    if (url.pathname === '/api/payment') {
      if (request.method === 'POST') {
        try {
          const data = await request.json();
          const p = data.payment || (Array.isArray(data.payments) ? data.payments[0] : data);
          const t = data.ticket || (Array.isArray(data.tickets) ? data.tickets[0] : null);

          const billNo = String(p?.BillNo || p?.bill_no || '');
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
            } catch(e) {}
          }

          return new Response(JSON.stringify({ success: true, message: `บันทึกการชำระเงิน ${billNo} ขึ้น Cloudflare สำเร็จ`, bill_no: billNo }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        } catch(err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
        }
      }
    }

    // ==================== 3. API: /api/login ====================
    if (url.pathname === '/api/login') {
      if (request.method === 'POST') {
        try {
          const data = await request.json();
          const inputId = String(data.id || '').trim();
          const inputContact = String(data.contact || '').trim();
          const plainId = inputId.replace(/[^0-9a-zA-Z]/g, '');
          const plainContact = inputContact.replace(/[^0-9]/g, '');

          if (env.DB) {
            const { results: matchedCusts } = await env.DB.prepare(`
              SELECT id as Id, cust_code as CustCode, name as Name, tel as Tel
              FROM customers
              WHERE id = ? OR cust_code = ? OR replace(id, '-', '') = ? OR replace(cust_code, '-', '') = ?
            `).bind(inputId, inputId, plainId, plainId).all();

            if (matchedCusts && matchedCusts.length > 0) {
              const customer = matchedCusts[0];
              const dbTel = String(customer.Tel || '').replace(/\D/g, '');
              const phoneValid = !plainContact || !dbTel || dbTel === plainContact ||
                (dbTel.length >= 9 && plainContact.length >= 9 && (dbTel.endsWith(plainContact) || plainContact.endsWith(dbTel)));

              if (phoneValid) {
                const { results: tickets } = await env.DB.prepare(`
                  SELECT system_id as SystemID, bud_year as BudYear, book_no as BookNo, doc_no as DocNo, bill_stat as BillStat, asstotal as Asstotal, month_total as MonthTotal, month_int as MonthInt, totalint as Totalint, app_date as AppDate, exp_date as ExpDate, model as Model, id as Id, cust_code as CustCode
                  FROM tickets
                  WHERE id = ? OR cust_code = ? OR replace(id, '-', '') = ? OR replace(cust_code, '-', '') = ?
                `).bind(customer.Id, customer.CustCode || customer.Id, plainId, plainId).all();

                return new Response(JSON.stringify({ success: true, customer, tickets: tickets || [] }), {
                  headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
              }
            }
          }

          return new Response(JSON.stringify({ success: false, error: 'ไม่พบข้อมูลลูกค้า หรือเบอร์โทรศัพท์ไม่ตรงกับในระบบ' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        } catch(err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
        }
      }
    }

    // ==================== 4. API: /api/sync ====================
    if (url.pathname === '/api/sync') {
      if (request.method === 'POST') {
        try {
          const data = await request.json();
          if (env.DB) {
            const CHUNK = 100;
            const chunkArray = (arr, size) => {
              const chunks = [];
              for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
              return chunks;
            };

            await env.DB.batch([
              env.DB.prepare(`CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT, tel TEXT, cust_code TEXT)`),
              env.DB.prepare(`CREATE TABLE IF NOT EXISTS tickets (system_id TEXT, bud_year TEXT, book_no TEXT, doc_no TEXT, bill_stat TEXT, asstotal TEXT, month_total TEXT, month_int TEXT, totalint TEXT, app_date TEXT, exp_date TEXT, model TEXT, id TEXT, cust_code TEXT, PRIMARY KEY (system_id, bud_year, book_no, doc_no))`),
              env.DB.prepare(`CREATE TABLE IF NOT EXISTS payments (bill_no TEXT PRIMARY KEY, system_id TEXT, bud_year TEXT, book_no TEXT, doc_no TEXT, bill_type TEXT, bill_date TEXT, slip TEXT, id TEXT)`),
              env.DB.prepare(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`),
            ]);

            if (Array.isArray(data.customers) && data.customers.length > 0) {
              const custStmts = [];
              for (const c of data.customers) {
                const cId = String(c.Id || c.id || '');
                if (!cId) continue;
                custStmts.push(
                  env.DB.prepare(`INSERT INTO customers (id,cust_code,name,tel) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET cust_code=excluded.cust_code,name=excluded.name,tel=excluded.tel`)
                    .bind(cId, String(c.CustCode||c.cust_code||cId), String(c.Name||c.name||'').trim(), String(c.Tel||c.tel||''))
                );
              }
              for (const chunk of chunkArray(custStmts, CHUNK)) await env.DB.batch(chunk);
            }

            if (Array.isArray(data.tickets) && data.tickets.length > 0) {
              const tickStmts = [];
              for (const t of data.tickets) {
                if (!t.SystemID || !t.DocNo) continue;
                tickStmts.push(
                  env.DB.prepare(`INSERT INTO tickets (system_id,bud_year,book_no,doc_no,bill_stat,asstotal,month_total,month_int,totalint,app_date,exp_date,model,id,cust_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(system_id,bud_year,book_no,doc_no) DO UPDATE SET bill_stat=excluded.bill_stat,asstotal=excluded.asstotal,month_total=excluded.month_total,month_int=excluded.month_int,totalint=excluded.totalint,app_date=excluded.app_date,exp_date=excluded.exp_date,model=excluded.model,id=excluded.id,cust_code=excluded.cust_code`)
                    .bind(String(t.SystemID), String(t.BudYear||''), String(t.BookNo||''), String(t.DocNo), String(t.BillStat||'N'), String(t.Asstotal||0), String(t.MonthTotal||1), String(t.MonthInt||0), String(t.Totalint||0), String(t.AppDate||''), String(t.ExpDate||''), String(t.Model||''), String(t.Id||''), String(t.CustCode||''))
                );
              }
              for (const chunk of chunkArray(tickStmts, CHUNK)) await env.DB.batch(chunk);
            }

            if (Array.isArray(data.payments) && data.payments.length > 0) {
              const payStmts = [];
              for (const p of data.payments) {
                const bno = String(p.BillNo || p.bill_no || '');
                if (!bno) continue;
                payStmts.push(
                  env.DB.prepare(`INSERT INTO payments (bill_no,system_id,bud_year,book_no,doc_no,bill_type,bill_date,slip,id) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(bill_no) DO UPDATE SET bill_type=excluded.bill_type,bill_date=excluded.bill_date,slip=excluded.slip`)
                    .bind(bno, String(p.SystemID||''), String(p.BudYear||''), String(p.BookNo||''), String(p.DocNo||''), String(p.BillType||'9'), String(p.BillDate||''), String(p.Slip||''), String(p.Id||''))
                );
              }
              for (const chunk of chunkArray(payStmts, CHUNK)) await env.DB.batch(chunk);
            }

            if (data.config && typeof data.config === 'object') {
              const cfgStmts = Object.entries(data.config).map(([k, v]) =>
                env.DB.prepare(`INSERT INTO config (key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
                  .bind(String(k), String(v ?? ''))
              );
              if (cfgStmts.length > 0) await env.DB.batch(cfgStmts);
            }
          }

          if (env.PAWNSHOP_KV && Array.isArray(data.payments) && data.payments.length > 0) {
            try {
              const raw = await env.PAWNSHOP_KV.get('db_sync_latest');
              let prev = {};
              if (raw) { try { prev = JSON.parse(raw); } catch(e){} }
              prev.payments = [...(prev.payments || []).filter(p => !data.payments.some(dp => dp.BillNo === p.BillNo)), ...data.payments];
              if (data.config) prev.config = { ...(prev.config || {}), ...data.config };
              await env.PAWNSHOP_KV.put('db_sync_latest', JSON.stringify(prev));
            } catch(e){}
          }

          return new Response(JSON.stringify({ success: true, message: 'บันทึกข้อมูลเข้า Cloudflare สำเร็จ' }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        } catch(err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
        }
      }

      if (request.method === 'GET') {
        if (env.DB) {
          try {
            const { results: customers } = await env.DB.prepare("SELECT id as Id, cust_code as CustCode, name as Name, tel as Tel FROM customers").all();
            const { results: tickets } = await env.DB.prepare("SELECT system_id as SystemID, bud_year as BudYear, book_no as BookNo, doc_no as DocNo, bill_stat as BillStat, asstotal as Asstotal, month_total as MonthTotal, month_int as MonthInt, totalint as Totalint, app_date as AppDate, exp_date as ExpDate, model as Model, id as Id, cust_code as CustCode FROM tickets").all();
            const { results: payments } = await env.DB.prepare("SELECT bill_no as BillNo, system_id as SystemID, bud_year as BudYear, book_no as BookNo, doc_no as DocNo, bill_type as BillType, bill_date as BillDate, slip as Slip, id as Id FROM payments").all();
            let config = {};
            try {
              const { results: cfgRows } = await env.DB.prepare("SELECT key, value FROM config").all();
              if (cfgRows) cfgRows.forEach(r => { config[r.key] = r.value; });
            } catch(e) {}

            return new Response(JSON.stringify({
              customers: customers || [],
              tickets: tickets || [],
              payments: payments || [],
              config,
              source: 'Cloudflare D1 SQL'
            }), {
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          } catch(e) {}
        }

        let kvData = null;
        if (env.PAWNSHOP_KV) {
          kvData = await env.PAWNSHOP_KV.get('db_sync_latest');
        }
        return new Response(kvData || '{"customers":[],"tickets":[],"payments":[],"config":{}}', {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // ==================== 5. STATIC ASSETS FALLBACK ====================
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  }
};
