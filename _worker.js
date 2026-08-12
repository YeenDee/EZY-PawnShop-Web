/**
 * Cloudflare Pages Functions / Worker for EZY Pawnshop 2006
 * Real-Time Cloud SQL Database (Cloudflare D1) & Daily R2 Storage Backup
 * Custom Domain: EZY-Pawnshop2006.rainbow-ocean.site
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Helper: CORS Headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ==================== 1. CLOUDFLARE D1 SQL DATABASE ENDPOINTS ====================
    if (url.pathname === '/api/sync') {
      if (request.method === 'POST') {
        try {
          let bodyText = '';
          try { bodyText = await request.text(); } catch(e){}
          let data = {};
          if (bodyText) {
            try { data = JSON.parse(bodyText); } catch(e){}
          }
          
          // Save to Cloudflare KV as fallback/cache
          if (env.PAWNSHOP_KV) {
            await env.PAWNSHOP_KV.put('db_sync_latest', bodyText);
          }

          // Exec D1 SQL Database queries if env.DB is bound
          if (env.DB) {
            // Auto-create D1 SQL Tables - split statements (D1 exec handles one at a time)
            await env.DB.exec(`CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT, tel TEXT, cust_code TEXT)`);
            try { await env.DB.exec(`ALTER TABLE customers ADD COLUMN cust_code TEXT`); } catch(e){}
            await env.DB.exec(`CREATE TABLE IF NOT EXISTS tickets (system_id TEXT, bud_year TEXT, book_no TEXT, doc_no TEXT, bill_stat TEXT, asstotal TEXT, month_total TEXT, month_int TEXT, totalint TEXT, app_date TEXT, exp_date TEXT, model TEXT, id TEXT, cust_code TEXT, PRIMARY KEY (system_id, bud_year, book_no, doc_no))`);
            try { await env.DB.exec(`ALTER TABLE tickets ADD COLUMN cust_code TEXT`); } catch(e){}
            await env.DB.exec(`CREATE TABLE IF NOT EXISTS payments (bill_no TEXT PRIMARY KEY, system_id TEXT, bud_year TEXT, book_no TEXT, doc_no TEXT, bill_type TEXT, bill_date TEXT, slip TEXT, id TEXT)`);
            await env.DB.exec(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`);

            // Upsert Customers — mapping: id(card_no), cust_code, name, tel
            if (Array.isArray(data.customers)) {
              for (const c of data.customers) {
                const cId = String(c.Id || c.id || c.card_no || '');
                const cCode = String(c.CustCode || c.cust_code || c.custCode || cId);
                const cName = String(c.Name || c.name || ((c.name||'') + ' ' + (c.surname||'')).trim() || '');
                const cTel = String(c.Tel || c.tel || '');
                if (!cId) continue;
                await env.DB.prepare(
                  `INSERT INTO customers (id, cust_code, name, tel) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET cust_code=excluded.cust_code, name=excluded.name, tel=excluded.tel`
                ).bind(cId, cCode, cName, cTel).run();
              }
            }

            // Upsert Tickets — mapping MySQL real fields to D1 columns
            if (Array.isArray(data.tickets)) {
              for (const t of data.tickets) {
                const sysId   = String(t.SystemID  || t.system_id  || '');
                const budYr   = String(t.BudYear   || t.bud_year   || '');
                const bookNo  = String(t.BookNo    || t.book_no    || '');
                const docNo   = String(t.DocNo     || t.doc_no     || '');
                const billSt  = String(t.BillStat  || t.bill_stat  || 'N');
                const assT    = String(t.Asstotal  || t.asstotal   || t.ass_total  || 0);
                const monTot  = String(t.MonthTotal|| t.month_total|| t.month_tot  || 1);
                const monInt  = String(t.MonthInt  || t.month_int  || 0);
                const totInt  = String(t.Totalint  || t.totalint   || t.tot_int    || 0);
                const appDt   = String(t.AppDate   || t.app_date   || '');
                const expDt   = String(t.ExpDate   || t.exp_date   || t.bill_expired || '');
                const model   = String(t.Model     || t.model      || '');
                const custId  = String(t.Id        || t.id         || t.cust_code  || '');
                const custCode= String(t.CustCode  || t.cust_code  || custId);
                if (!sysId || !docNo) continue;
                await env.DB.prepare(
                  `INSERT INTO tickets (system_id, bud_year, book_no, doc_no, bill_stat, asstotal, month_total, month_int, totalint, app_date, exp_date, model, id, cust_code) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(system_id, bud_year, book_no, doc_no) DO UPDATE SET bill_stat=excluded.bill_stat, asstotal=excluded.asstotal, month_total=excluded.month_total, month_int=excluded.month_int, totalint=excluded.totalint, app_date=excluded.app_date, exp_date=excluded.exp_date, model=excluded.model, id=excluded.id, cust_code=excluded.cust_code`
                ).bind(sysId, budYr, bookNo, docNo, billSt, assT, monTot, monInt, totInt, appDt, expDt, model, custId, custCode).run();
              }
            }

            // Upsert Payments
            if (Array.isArray(data.payments)) {
              for (const p of data.payments) {
                const bno = String(p.BillNo || p.bill_no || '');
                if (!bno) continue;
                await env.DB.prepare(
                  `INSERT INTO payments (bill_no, system_id, bud_year, book_no, doc_no, bill_type, bill_date, slip, id) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(bill_no) DO UPDATE SET bill_type=excluded.bill_type, slip=excluded.slip`
                ).bind(bno, String(p.SystemID||p.system_id||''), String(p.BudYear||p.bud_year||''), String(p.BookNo||p.book_no||''), String(p.DocNo||p.doc_no||''), String(p.BillType||p.bill_type||''), String(p.BillDate||p.bill_date||''), String(p.Slip||p.slip||''), String(p.Id||p.id||'')).run();
              }
            }

            // Upsert Config (bank name, color, logo, etc.)
            if (data.config && typeof data.config === 'object') {
              for (const [k, v] of Object.entries(data.config)) {
                await env.DB.prepare(
                  `INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
                ).bind(String(k), String(v ?? '')).run();
              }
            }
          }

          return new Response(JSON.stringify({ success: true, message: 'บันทึกข้อมูลเข้า Cloudflare D1 SQL Database & KV สำเร็จ' }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
        }
      } else {
        // GET /api/sync - Query D1 SQL Database then KV fallback
        try {
          if (env.DB) {
            const { results: customers } = await env.DB.prepare("SELECT id as Id, cust_code as CustCode, name as Name, tel as Tel FROM customers").all();
            const { results: tickets } = await env.DB.prepare("SELECT system_id as SystemID, bud_year as BudYear, book_no as BookNo, doc_no as DocNo, bill_stat as BillStat, asstotal as Asstotal, month_total as MonthTotal, month_int as MonthInt, totalint as Totalint, app_date as AppDate, exp_date as ExpDate, model as Model, id as Id, cust_code as CustCode FROM tickets").all();
            const { results: payments } = await env.DB.prepare("SELECT bill_no as BillNo, system_id as SystemID, bud_year as BudYear, book_no as BookNo, doc_no as DocNo, bill_type as BillType, bill_date as BillDate, slip as Slip, id as Id FROM payments").all();
            // Load config
            let config = {};
            try {
              const { results: cfgRows } = await env.DB.prepare("SELECT key, value FROM config").all();
              if (cfgRows) cfgRows.forEach(r => { config[r.key] = r.value; });
            } catch(e2) {}

            if (customers && customers.length > 0) {
              return new Response(JSON.stringify({ customers, tickets, payments, config, source: 'Cloudflare D1 SQL' }), {
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
              });
            }
          }
        } catch (e) {
          console.error('D1 query fallback:', e);
        }

        // KV Fallback
        let kvData = null;
        if (env.PAWNSHOP_KV) {
          kvData = await env.PAWNSHOP_KV.get('db_sync_latest');
        }
        return new Response(kvData || '{"customers":[],"tickets":[],"payments":[],"config":{}}', {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // ==================== 2. DAILY BACKUP R2 STORAGE ENDPOINTS ====================
    // GET /api/backups - List all daily zip backup files stored in R2 Bucket
    if (url.pathname === '/api/backups') {
      try {
        let files = [];
        if (env.BACKUP_BUCKET) {
          const list = await env.BACKUP_BUCKET.list();
          files = list.objects.map(obj => ({
            filename: obj.key,
            size: obj.size,
            uploaded: obj.uploaded.toISOString().replace('T', ' ').substring(0, 19),
            status: 'จัดเก็บเรียบร้อย (Cloudflare R2)'
          }));
        }
        return new Response(JSON.stringify({ success: true, files }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, files: [], error: err.message }), { headers: corsHeaders });
      }
    }

    // GET / PUT / POST /api/backup/:filename - Manage specific zip backup file
    if (url.pathname.startsWith('/api/backup/')) {
      const filename = url.pathname.replace('/api/backup/', '') || 'pawnshop-backup.zip';
      
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

      if (request.method === 'PUT' || request.method === 'POST') {
        try {
          if (env.BACKUP_BUCKET) {
            await env.BACKUP_BUCKET.put(filename, request.body);
          }
          return new Response(JSON.stringify({ success: true, filename, message: `อัปโหลดไฟล์สำรอง ${filename} ขึ้น R2 สำเร็จ` }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
        }
      }
    }

    // Serve static web assets natively via Cloudflare Pages
    return env.ASSETS ? env.ASSETS.fetch(request) : fetch(request);
  }
};
