/**
 * Cloudflare Pages Function: /api/sync
 * Syncs database records between authenticated Admin / Python worker and Cloudflare D1
 *
 * D1 = Database หลัก
 * ต้องยืนยันตัวตนด้วย Admin Bearer Token หรือ X-Sync-Secret เท่านั้น
 */

const ALLOWED_ORIGINS = [
  'https://ezy-pawnshop2006.rainbow-ocean.site',
  'https://ezy-pawnshop-web.pages.dev',
  'http://localhost:8000',
  'http://127.0.0.1:8000'
];

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.ezy-pawnshop-web.pages.dev')
    ? origin
    : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Sync-Secret',
    'Vary': 'Origin'
  };
}

function bufToHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  const strA = String(a || '');
  const strB = String(b || '');
  if (strA.length !== strB.length) return false;
  let diff = 0;
  for (let i = 0; i < strA.length; i++) {
    diff |= strA.charCodeAt(i) ^ strB.charCodeAt(i);
  }
  return diff === 0;
}

async function getSystemSecret(env) {
  if (env.AUTH_SECRET) return String(env.AUTH_SECRET);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS _sys_secrets (key TEXT PRIMARY KEY, value TEXT)`).run();
  let row = await env.DB.prepare(`SELECT value FROM _sys_secrets WHERE key = 'jwt_secret'`).first();
  if (!row || !row.value) {
    const rnd = new Uint8Array(32);
    crypto.getRandomValues(rnd);
    const newSecret = bufToHex(rnd);
    await env.DB.prepare(`INSERT OR IGNORE INTO _sys_secrets (key, value) VALUES ('jwt_secret', ?)`).bind(newSecret).run();
    row = await env.DB.prepare(`SELECT value FROM _sys_secrets WHERE key = 'jwt_secret'`).first();
  }
  return row.value;
}

async function hmacSha256Hex(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bufToHex(sig);
}

async function verifyToken(tokenStr, secret) {
  if (!tokenStr || typeof tokenStr !== 'string') return null;
  const parts = tokenStr.split('.');
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const expectedSig = await hmacSha256Hex(b64, secret);
  if (!timingSafeEqual(sig, expectedSig)) return null;
  try {
    const pad = b64.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

async function verifyAdminOrSync(request, env) {
  // 1. Check Admin Bearer Token
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const secret = await getSystemSecret(env);
    const payload = await verifyToken(token, secret);
    if (payload && payload.role === 'admin') {
      return { ok: true, role: 'admin', user: payload.sub };
    }
  }

  // 2. Check X-Sync-Secret header from db_sync.py
  const syncSecretHeader = (request.headers.get('X-Sync-Secret') || '').trim();
  if (syncSecretHeader && syncSecretHeader.length >= 32) {
    if (env.SYNC_SECRET && timingSafeEqual(syncSecretHeader, String(env.SYNC_SECRET))) {
      return { ok: true, role: 'sync' };
    }
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS _sys_secrets (key TEXT PRIMARY KEY, value TEXT)`).run();
    let row = await env.DB.prepare(`SELECT value FROM _sys_secrets WHERE key = 'sync_secret'`).first();
    if (!row || !row.value) {
      await env.DB.prepare(`INSERT OR IGNORE INTO _sys_secrets (key, value) VALUES ('sync_secret', ?)`).bind(syncSecretHeader).run();
      row = await env.DB.prepare(`SELECT value FROM _sys_secrets WHERE key = 'sync_secret'`).first();
    }
    if (row && row.value && timingSafeEqual(syncSecretHeader, row.value)) {
      return { ok: true, role: 'sync' };
    }
  }

  return { ok: false };
}

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);

  // ==================== OPTIONS ====================
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }

  // ==================== ตรวจสอบ D1 Binding ====================
  if (!env.DB) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'D1 binding "DB" not found'
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      }
    );
  }

  // ==================== ตรวจสอบสิทธิ์ Admin หรือ Sync Worker ====================
  const auth = await verifyAdminOrSync(request, env);
  if (!auth.ok) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Unauthorized: ไม่มีสิทธิ์เข้าถึงหรือซิงค์ฐานข้อมูล'
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      }
    );
  }

  // ==================== POST /api/sync ====================
  if (request.method === 'POST') {
    try {

      // ----- อ่านและตรวจสอบ JSON -----
      const bodyText = await request.text();

      if (!bodyText || !bodyText.trim()) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Request body is empty'
          }),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          }
        );
      }

      let data;

      try {
        data = JSON.parse(bodyText);
      } catch (e) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Invalid JSON format'
          }),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          }
        );
      }

      // ==================== สร้างตาราง ====================

      await env.DB.batch([
        env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS customers (
            id TEXT PRIMARY KEY,
            name TEXT,
            tel TEXT,
            cust_code TEXT
          )
        `),

        env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS tickets (
            system_id TEXT,
            bud_year TEXT,
            book_no TEXT,
            doc_no TEXT,
            bill_stat TEXT,
            bill_type TEXT,
            bill_date TEXT,
            bill_no TEXT,
            asstotal TEXT,
            month_total TEXT,
            month_int TEXT,
            totalint TEXT,
            app_date TEXT,
            exp_date TEXT,
            model TEXT,
            id TEXT,
            cust_code TEXT,
            PRIMARY KEY (system_id, bud_year, book_no, doc_no)
          )
        `),

        env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS payments (
            bill_no TEXT,
            system_id TEXT,
            bud_year TEXT,
            book_no TEXT,
            doc_no TEXT,
            bill_type TEXT,
            bill_date TEXT,
            slip TEXT,
            id TEXT,
            PRIMARY KEY (bill_no, system_id, bud_year, book_no, doc_no)
          )
        `),

        env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT
          )
        `)
      ]);

      // Ensure payments table has composite PK (bill_no, system_id, bud_year, book_no, doc_no)
      try {
        const pkInfo = await env.DB.prepare(`PRAGMA table_info(payments)`).all();
        const pkCols = (pkInfo.results || []).filter(c => c.pk > 0);
        if (pkCols.length === 1 && pkCols[0].name === 'bill_no') {
          await env.DB.batch([
            env.DB.prepare(`CREATE TABLE IF NOT EXISTS payments_v2 (bill_no TEXT, system_id TEXT, bud_year TEXT, book_no TEXT, doc_no TEXT, bill_type TEXT, bill_date TEXT, slip TEXT, id TEXT, PRIMARY KEY (bill_no, system_id, bud_year, book_no, doc_no))`),
            env.DB.prepare(`INSERT OR IGNORE INTO payments_v2 SELECT * FROM payments`),
            env.DB.prepare(`DROP TABLE payments`),
            env.DB.prepare(`ALTER TABLE payments_v2 RENAME TO payments`)
          ]);
        }
      } catch(migErr) {}

      const CHUNK = 100;

      const chunkArray = (arr, size) => {
        const chunks = [];

        for (let i = 0; i < arr.length; i += size) {
          chunks.push(arr.slice(i, i + size));
        }

        return chunks;
      };

      // ==================================================
      // 0. CLEAR EXISTING TABLES IF REQUESTED (REPLACE MODE)
      // ==================================================
      if (data.clear_tables === true || data.reset === true || data.replace === true) {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM customers'),
          env.DB.prepare('DELETE FROM tickets')
        ]);
      }

      // ==================================================
      // 1. UPSERT CUSTOMERS
      // ==================================================

      if (Array.isArray(data.customers) && data.customers.length > 0) {

        const custStmts = [];

        for (const c of data.customers) {

          const cId = String(
            c.Id ||
            c.id ||
            c.card_no ||
            ''
          );

          const cCode = String(
            c.CustCode ||
            c.cust_code ||
            cId
          );

          const rawName = String(
            c.Name ||
            c.name ||
            ((c.name || '') + ' ' + (c.surname || '')).trim() ||
            ''
          );

          const cName = rawName
            .replace(/\s+/g, ' ')
            .trim();

          const cTel = String(
            c.Tel ||
            c.tel ||
            ''
          );

          if (!cId) continue;

          custStmts.push(
            env.DB.prepare(`
              INSERT INTO customers
              (id, cust_code, name, tel)

              VALUES (?, ?, ?, ?)

              ON CONFLICT(id) DO UPDATE SET
                cust_code = excluded.cust_code,
                name = excluded.name,
                tel = excluded.tel
            `).bind(
              cId,
              cCode,
              cName,
              cTel
            )
          );
        }

        for (const chunk of chunkArray(custStmts, CHUNK)) {
          await env.DB.batch(chunk);
        }
      }


      // ==================================================
      // 2. UPSERT TICKETS
      // ==================================================

      if (Array.isArray(data.tickets) && data.tickets.length > 0) {

        const tickStmts = [];

        for (const t of data.tickets) {

          const sysId = String(
            t.SystemID ||
            t.system_id ||
            ''
          );

          const budYr = String(
            t.BudYear ||
            t.bud_year ||
            ''
          );

          const bookNo = String(
            t.BookNo ||
            t.book_no ||
            ''
          );

          const docNo = String(
            t.DocNo ||
            t.doc_no ||
            ''
          );

          const billSt = String(
            t.BillStat ||
            t.bill_stat ||
            'N'
          );

          const billType = String(
            t.BillType ||
            t.bill_type ||
            ''
          );

          const billDate = String(
            t.BillDate ||
            t.bill_date ||
            ''
          );

          const billNo = String(
            t.BillNo ||
            t.bill_no ||
            ''
          );

          const assT = String(
            t.Asstotal ||
            t.asstotal ||
            0
          );

          const monTot = String(
            t.MonthTotal ||
            t.month_total ||
            1
          );

          const monInt = String(
            t.MonthInt ||
            t.month_int ||
            0
          );

          const totInt = String(
            t.Totalint ||
            t.totalint ||
            0
          );

          const appDt = String(
            t.AppDate ||
            t.app_date ||
            ''
          );

          const expDt = String(
            t.ExpDate ||
            t.exp_date ||
            t.bill_expired ||
            ''
          );

          const model = String(
            t.Model ||
            t.model ||
            ''
          );

          const custId = String(
            t.Id ||
            t.id ||
            t.cust_code ||
            ''
          );

          const custCode = String(
            t.CustCode ||
            t.cust_code ||
            custId
          );

          if (!sysId || !docNo) continue;


          tickStmts.push(
            env.DB.prepare(`
              INSERT INTO tickets
              (
                system_id,
                bud_year,
                book_no,
                doc_no,
                bill_stat,
                bill_type,
                bill_date,
                bill_no,
                asstotal,
                month_total,
                month_int,
                totalint,
                app_date,
                exp_date,
                model,
                id,
                cust_code
              )

              VALUES
              (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

              ON CONFLICT(system_id, bud_year, book_no, doc_no)
              DO UPDATE SET
                -- ป้องกัน: ถ้า bill_stat เป็น '9' (รอตรวจ), '2' (อนุมัติ), 'I' (ต่อแล้ว)
                -- ห้าม overwrite ด้วยข้อมูลเก่าจาก MySQL (bill_stat='N')
                bill_stat   = CASE WHEN excluded.bill_stat = 'I' THEN 'I' WHEN bill_stat IN ('9','2','I') THEN bill_stat ELSE excluded.bill_stat END,
                bill_type   = CASE WHEN excluded.bill_type = '2' THEN '2' WHEN bill_stat IN ('9','2','I') THEN bill_type ELSE excluded.bill_type END,
                bill_date   = CASE WHEN excluded.bill_type = '2' AND excluded.bill_date != '' THEN excluded.bill_date WHEN bill_stat IN ('9','2','I') THEN bill_date ELSE excluded.bill_date END,
                bill_no     = CASE WHEN excluded.bill_type = '2' AND excluded.bill_no != '' THEN excluded.bill_no WHEN bill_stat IN ('9','2','I') THEN bill_no ELSE excluded.bill_no END,
                asstotal    = excluded.asstotal,
                month_total = excluded.month_total,
                month_int   = excluded.month_int,
                totalint    = excluded.totalint,
                app_date    = excluded.app_date,
                exp_date    = excluded.exp_date,
                model       = excluded.model,
                id          = excluded.id,
                cust_code   = excluded.cust_code
            `).bind(
              sysId,
              budYr,
              bookNo,
              docNo,
              billSt,
              billType,
              billDate,
              billNo,
              assT,
              monTot,
              monInt,
              totInt,
              appDt,
              expDt,
              model,
              custId,
              custCode
            )
          );
        }

        for (const chunk of chunkArray(tickStmts, CHUNK)) {
          await env.DB.batch(chunk);
        }
      }


      // ==================================================
      // 3. UPSERT PAYMENTS
      // ==================================================

      if (Array.isArray(data.payments) && data.payments.length > 0) {

        const payStmts = [];

        for (const p of data.payments) {

          const bno = String(
            p.BillNo ||
            p.bill_no ||
            ''
          );

          if (!bno) continue;

          const bType = String(p.BillType || p.bill_type || '2');
          const bDate = String(p.BillDate || p.bill_date || '');

          payStmts.push(
            env.DB.prepare(`
              UPDATE payments
              SET bill_type = ?,
                  bill_date = CASE WHEN ? != '' THEN ? ELSE bill_date END
              WHERE bill_no = ?
            `).bind(bType, bDate, bDate, bno)
          );

          payStmts.push(
            env.DB.prepare(`
              INSERT OR REPLACE INTO payments
              (
                bill_no,
                system_id,
                bud_year,
                book_no,
                doc_no,
                bill_type,
                bill_date,
                slip,
                id
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              bno,
              String(p.SystemID || p.system_id || ''),
              String(p.BudYear || p.bud_year || ''),
              String(p.BookNo || p.book_no || ''),
              String(p.DocNo || p.doc_no || ''),
              bType,
              bDate,
              String(p.Slip || p.slip || ''),
              String(p.Id || p.id || '')
            )
          );
        }

        for (const chunk of chunkArray(payStmts, CHUNK)) {
          await env.DB.batch(chunk);
        }

        if (env.PAWNSHOP_KV) {
          try {
            const raw = await env.PAWNSHOP_KV.get('db_sync_latest');
            let prev = {};
            if (raw) { try { prev = JSON.parse(raw); } catch(e){} }
            let curPayments = (prev.payments || []).map(cp => ({ ...cp }));
            for (const p of data.payments) {
              const bno   = String(p.BillNo   || p.bill_no   || '');
              const sysId = String(p.SystemID || p.system_id || '');
              const docNo = String(p.DocNo    || p.doc_no    || '');
              const pKV = { ...p, BillType: String(p.BillType || p.bill_type || '2'), bill_type: String(p.BillType || p.bill_type || '2') };
              delete pKV.Slip;
              delete pKV.slip;
              const idx = curPayments.findIndex(cp =>
                String(cp.BillNo   || cp.bill_no)   === bno &&
                String(cp.SystemID || cp.system_id) === sysId &&
                String(cp.DocNo    || cp.doc_no)    === docNo
              );
              if (idx > -1) curPayments[idx] = { ...curPayments[idx], ...pKV };
              else curPayments.push(pKV);
            }
            prev.payments = curPayments;
            await env.PAWNSHOP_KV.put('db_sync_latest', JSON.stringify(prev));
          } catch(e) {}
        }
      }


      // ==================================================
      // 4. UPSERT CONFIG
      // ==================================================

      if (data.config && typeof data.config === 'object') {

        const cfgStmts = Object.entries(data.config)
          .filter(([k]) => !String(k).startsWith('_') && String(k) !== 'runno')
          .map(
            ([k, v]) =>

              env.DB.prepare(`
                INSERT INTO config (key, value)

                VALUES (?, ?)

                ON CONFLICT(key)
                DO UPDATE SET
                  value = excluded.value
              `).bind(
                String(k),
                String(v ?? '')
              )
          );

        if (cfgStmts.length > 0) {
          await env.DB.batch(cfgStmts);
        }
      }


      // ==================================================
      // SUCCESS
      // ==================================================

      return new Response(
        JSON.stringify({
          success: true,
          message: 'บันทึกข้อมูลเข้า Cloudflare D1 SQL Database สำเร็จ'
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      );

    } catch (err) {

      console.error('[sync] POST error:', err);

      return new Response(
        JSON.stringify({
          success: false,
          error: err.message || 'Unknown database error'
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      );
    }
  }


  // ==================== GET /api/sync ====================

  if (request.method === 'GET') {

    try {

      const { results: customers } =
        await env.DB.prepare(`
          SELECT
            id AS Id,
            cust_code AS CustCode,
            name AS Name,
            tel AS Tel
          FROM customers
        `).all();


      const { results: tickets } =
        await env.DB.prepare(`
          SELECT
            system_id AS SystemID,
            bud_year AS BudYear,
            book_no AS BookNo,
            doc_no AS DocNo,
            bill_stat AS BillStat,
            bill_type AS BillType,
            bill_date AS BillDate,
            bill_no AS BillNo,
            asstotal AS Asstotal,
            month_total AS MonthTotal,
            month_int AS MonthInt,
            totalint AS Totalint,
            app_date AS AppDate,
            exp_date AS ExpDate,
            model AS Model,
            id AS Id,
            cust_code AS CustCode
          FROM tickets
        `).all();


      const { results: payments } =
        await env.DB.prepare(`
          SELECT
            bill_no AS BillNo,
            system_id AS SystemID,
            bud_year AS BudYear,
            book_no AS BookNo,
            doc_no AS DocNo,
            bill_type AS BillType,
            bill_date AS BillDate,
            slip AS Slip,
            id AS Id
          FROM payments
        `).all();


      const { results: cfgRows } =
        await env.DB.prepare(`
          SELECT key, value
          FROM config
          WHERE key NOT LIKE '\\_%' ESCAPE '\\' AND key != 'runno'
        `).all();


      const config = {};

      if (cfgRows) {
        cfgRows.forEach(row => {
          if (!String(row.key).startsWith('_') && row.key !== 'runno') {
            config[row.key] = row.value;
          }
        });
      }


      return new Response(
        JSON.stringify({
          success: true,
          customers: customers || [],
          tickets: tickets || [],
          payments: payments || [],
          config,
          source: 'Cloudflare D1 SQL'
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      );

    } catch (err) {

      console.error('[sync] GET error:', err);

      return new Response(
        JSON.stringify({
          success: false,
          error: err.message || 'Failed to read Cloudflare D1'
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      );
    }
  }


  // ==================== METHOD NOT ALLOWED ====================

  return new Response(
    JSON.stringify({
      success: false,
      error: `Method ${request.method} not allowed`
    }),
    {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    }
  );
}
