/**
 * Cloudflare Pages Function: /api/sync
 * Syncs database records between client, Python worker and Cloudflare D1
 */
export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // ==================== POST /api/sync ====================
  if (request.method === 'POST') {
    try {
      let bodyText = '';
      try { bodyText = await request.text(); } catch(e){}
      let data = {};
      if (bodyText) {
        try { data = JSON.parse(bodyText); } catch(e){}
      }

      if (env.DB) {
        const CHUNK = 100;
        const chunkArray = (arr, size) => {
          const chunks = [];
          for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
          return chunks;
        };

        try {
          await env.DB.batch([
            env.DB.prepare(`CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT, tel TEXT, cust_code TEXT)`),
            env.DB.prepare(`CREATE TABLE IF NOT EXISTS tickets (system_id TEXT, bud_year TEXT, book_no TEXT, doc_no TEXT, bill_stat TEXT, bill_type TEXT, bill_date TEXT, bill_no TEXT, asstotal TEXT, month_total TEXT, month_int TEXT, totalint TEXT, app_date TEXT, exp_date TEXT, model TEXT, id TEXT, cust_code TEXT, PRIMARY KEY (system_id, bud_year, book_no, doc_no))`),
            env.DB.prepare(`CREATE TABLE IF NOT EXISTS payments (bill_no TEXT, system_id TEXT, bud_year TEXT, book_no TEXT, doc_no TEXT, bill_type TEXT, bill_date TEXT, slip TEXT, id TEXT, PRIMARY KEY (bill_no, system_id, bud_year, book_no, doc_no))`),
            env.DB.prepare(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`),
          ]);
        } catch(e) {}

        // 1. Upsert Customers
        if (Array.isArray(data.customers) && data.customers.length > 0) {
          const custStmts = [];
          for (const c of data.customers) {
            const cId   = String(c.Id || c.id || c.card_no || '');
            const cCode = String(c.CustCode || c.cust_code || cId);
            const rawName = String(c.Name || c.name || ((c.name||'') + ' ' + (c.surname||'')).trim() || '');
            const cName = rawName.replace(/\s+/g, ' ').trim();
            const cTel  = String(c.Tel  || c.tel  || '');
            if (!cId) continue;
            custStmts.push(
              env.DB.prepare(`INSERT INTO customers (id,cust_code,name,tel) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET cust_code=excluded.cust_code,name=excluded.name,tel=excluded.tel`)
                .bind(cId, cCode, cName, cTel)
            );
          }
          for (const chunk of chunkArray(custStmts, CHUNK)) {
            await env.DB.batch(chunk);
          }
        }

        // 2. Upsert Tickets
        if (Array.isArray(data.tickets) && data.tickets.length > 0) {
          const tickStmts = [];
          for (const t of data.tickets) {
            const sysId   = String(t.SystemID   || t.system_id   || '');
            const budYr   = String(t.BudYear    || t.bud_year    || '');
            const bookNo  = String(t.BookNo     || t.book_no     || '');
            const docNo   = String(t.DocNo      || t.doc_no      || '');
            const billSt  = String(t.BillStat   || t.bill_stat   || 'N');
            const assT    = String(t.Asstotal   || t.asstotal    || 0);
            const monTot  = String(t.MonthTotal || t.month_total || 1);
            const monInt  = String(t.MonthInt   || t.month_int   || 0);
            const totInt  = String(t.Totalint   || t.totalint    || 0);
            const appDt   = String(t.AppDate    || t.app_date    || '');
            const expDt   = String(t.ExpDate    || t.exp_date    || t.bill_expired || '');
            const model   = String(t.Model      || t.model       || '');
            const custId  = String(t.Id         || t.id          || t.cust_code || '');
            const custCode= String(t.CustCode   || t.cust_code   || custId);
            if (!sysId || !docNo) continue;
            tickStmts.push(
              env.DB.prepare(`INSERT INTO tickets (system_id,bud_year,book_no,doc_no,bill_stat,asstotal,month_total,month_int,totalint,app_date,exp_date,model,id,cust_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(system_id,bud_year,book_no,doc_no) DO UPDATE SET bill_stat=excluded.bill_stat,asstotal=excluded.asstotal,month_total=excluded.month_total,month_int=excluded.month_int,totalint=excluded.totalint,app_date=excluded.app_date,exp_date=excluded.exp_date,model=excluded.model,id=excluded.id,cust_code=excluded.cust_code`)
                .bind(sysId, budYr, bookNo, docNo, billSt, assT, monTot, monInt, totInt, appDt, expDt, model, custId, custCode)
            );
          }
          for (const chunk of chunkArray(tickStmts, CHUNK)) {
            await env.DB.batch(chunk);
          }
        }

        // 3. Upsert Payments
        if (Array.isArray(data.payments) && data.payments.length > 0) {
          const payStmts = [];
          for (const p of data.payments) {
            const bno = String(p.BillNo || p.bill_no || '');
            if (!bno) continue;
            payStmts.push(
              env.DB.prepare(`INSERT OR REPLACE INTO payments (bill_no,system_id,bud_year,book_no,doc_no,bill_type,bill_date,slip,id) VALUES(?,?,?,?,?,?,?,?,?)`)
                .bind(bno, String(p.SystemID||p.system_id||''), String(p.BudYear||p.bud_year||''), String(p.BookNo||p.book_no||''), String(p.DocNo||p.doc_no||''), String(p.BillType||p.bill_type||'9'), String(p.BillDate||p.bill_date||''), String(p.Slip||p.slip||''), String(p.Id||p.id||''))
            );
          }
          for (const chunk of chunkArray(payStmts, CHUNK)) {
            await env.DB.batch(chunk);
          }
        }

        // 4. Upsert Config
        if (data.config && typeof data.config === 'object') {
          const cfgStmts = Object.entries(data.config).map(([k, v]) =>
            env.DB.prepare(`INSERT INTO config (key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
              .bind(String(k), String(v ?? ''))
          );
          if (cfgStmts.length > 0) await env.DB.batch(cfgStmts);
        }
      }

      // Also persist to KV if available
      if (env.PAWNSHOP_KV && Array.isArray(data.payments) && data.payments.length > 0) {
        try {
          const raw = await env.PAWNSHOP_KV.get('db_sync_latest');
          let prev = {};
          if (raw) { try { prev = JSON.parse(raw); } catch(e){} }
          // Strip slip from ALL existing payments in KV (clean up accumulated data)
          const existingPayments = (prev.payments || []).map(ep => {
            const e2 = { ...ep }; delete e2.Slip; delete e2.slip; return e2;
          });
          const mergedPayments = [...existingPayments];
          for (const dp of data.payments) {
            const bno   = String(dp.BillNo   || dp.bill_no   || '');
            const sysId = String(dp.SystemID || dp.system_id || '');
            const docNo = String(dp.DocNo    || dp.doc_no    || '');
            // Strip slip (base64 image) from KV to avoid quota exceeded
            const dpKV = { ...dp };
            delete dpKV.Slip;
            delete dpKV.slip;
            const idx = mergedPayments.findIndex(p =>
              String(p.BillNo   || p.bill_no)   === bno &&
              String(p.SystemID || p.system_id) === sysId &&
              String(p.DocNo    || p.doc_no)    === docNo
            );
            if (idx > -1) mergedPayments[idx] = dpKV;
            else mergedPayments.push(dpKV);
          }
          prev.payments = mergedPayments;
          if (data.config) prev.config = { ...(prev.config || {}), ...data.config };
          const kvPayload = JSON.stringify(prev);
          if (kvPayload.length > 20_000_000) {
            console.warn(`[sync] KV payload size ${kvPayload.length} bytes — approaching 25MB limit`);
          }
          await env.PAWNSHOP_KV.put('db_sync_latest', kvPayload);
        } catch(e){
          console.error('[sync] KV put error:', e);
        }
      }

      return new Response(JSON.stringify({ success: true, message: 'บันทึกข้อมูลเข้า Cloudflare D1 SQL Database สำเร็จ' }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
    }
  }

  // ==================== GET /api/sync ====================
  try {
    if (env.DB) {
      const { results: customers } = await env.DB.prepare("SELECT id as Id, cust_code as CustCode, name as Name, tel as Tel FROM customers").all();
      const { results: tickets } = await env.DB.prepare("SELECT system_id as SystemID, bud_year as BudYear, book_no as BookNo, doc_no as DocNo, bill_stat as BillStat, asstotal as Asstotal, month_total as MonthTotal, month_int as MonthInt, totalint as Totalint, app_date as AppDate, exp_date as ExpDate, model as Model, id as Id, cust_code as CustCode FROM tickets").all();
      const { results: payments } = await env.DB.prepare("SELECT bill_no as BillNo, system_id as SystemID, bud_year as BudYear, book_no as BookNo, doc_no as DocNo, bill_type as BillType, bill_date as BillDate, slip as Slip, id as Id FROM payments").all();
      let config = {};
      try {
        const { results: cfgRows } = await env.DB.prepare("SELECT key, value FROM config").all();
        if (cfgRows) cfgRows.forEach(r => { config[r.key] = r.value; });
      } catch(e2) {}

      return new Response(JSON.stringify({
        customers: customers || [],
        tickets: tickets || [],
        payments: payments || [],
        config,
        source: 'Cloudflare D1 SQL'
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  } catch (e) {
    console.error('D1 query fallback:', e);
  }

  // Fallback to KV
  let kvData = null;
  if (env.PAWNSHOP_KV) {
    kvData = await env.PAWNSHOP_KV.get('db_sync_latest');
  }
  return new Response(kvData || '{"customers":[],"tickets":[],"payments":[],"config":{}}', {
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}
