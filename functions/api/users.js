/**
 * Cloudflare Pages Function: /api/users
 * CRUD สำหรับผู้ใช้งาน (Admin) บน Cloudflare D1
 * GET  → รายชื่อผู้ใช้ทั้งหมด (ไม่ส่ง password กลับ)
 * POST → { action: 'upsert'|'delete', user: {...} }
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

  if (!env.DB) {
    return new Response(JSON.stringify({ success: false, error: 'D1 binding not found' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // Ensure users table exists
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        user_id   TEXT PRIMARY KEY,
        password  TEXT,
        name      TEXT,
        position  TEXT
      )
    `).run();
  } catch (e) {
    console.error('[users] CREATE TABLE error:', e);
  }

  // ==================== GET: ดึงรายชื่อผู้ใช้ ====================
  if (request.method === 'GET') {
    try {
      const { results } = await env.DB.prepare(
        `SELECT user_id AS UserID, password AS Password, name AS Name, position AS Position FROM users ORDER BY user_id`
      ).all();
      return new Response(JSON.stringify({ success: true, users: results || [] }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  // ==================== POST: เพิ่ม/แก้ไข/ลบผู้ใช้ ====================
  if (request.method === 'POST') {
    try {
      const data = await request.json();
      const action = String(data.action || 'upsert').toLowerCase();

      // --- Upsert (add or edit) ---
      if (action === 'upsert' || action === 'add' || action === 'edit') {
        const users = Array.isArray(data.users) ? data.users : (data.user ? [data.user] : []);
        if (users.length === 0) {
          return new Response(JSON.stringify({ success: false, error: 'ไม่พบข้อมูลผู้ใช้ที่จะบันทึก' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const stmts = users.map(u => {
          const userId   = String(u.UserID   || u.user_id   || '').trim();
          const password = String(u.Password || u.password  || '').trim();
          const name     = String(u.Name     || u.name      || '').trim();
          const position = String(u.Position || u.position  || '').trim();
          return env.DB.prepare(
            `INSERT INTO users (user_id, password, name, position) VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
               password = excluded.password,
               name     = excluded.name,
               position = excluded.position`
          ).bind(userId, password, name, position);
        });

        await env.DB.batch(stmts);
        return new Response(JSON.stringify({ success: true, message: `บันทึกผู้ใช้ ${users.length} รายการสำเร็จ` }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // --- Delete ---
      if (action === 'delete') {
        const userId = String(data.user_id || data.UserID || (data.user && data.user.UserID) || '').trim();
        if (!userId) {
          return new Response(JSON.stringify({ success: false, error: 'ไม่พบ UserID ที่จะลบ' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        await env.DB.prepare(`DELETE FROM users WHERE user_id = ?`).bind(userId).run();
        return new Response(JSON.stringify({ success: true, message: `ลบผู้ใช้ ${userId} เรียบร้อยแล้ว` }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // --- Verify login (ใช้สำหรับ admin login check กับ D1) ---
      if (action === 'login') {
        const userId   = String(data.user_id   || data.UserID   || '').trim().replace(/-/g, '');
        const password = String(data.password   || data.Password || '').trim();
        const { results } = await env.DB.prepare(
          `SELECT user_id AS UserID, name AS Name, position AS Position
           FROM users WHERE replace(user_id,'-','') = ? AND password = ?`
        ).bind(userId, password).all();

        if (results && results.length > 0) {
          return new Response(JSON.stringify({ success: true, user: results[0] }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        } else {
          return new Response(JSON.stringify({ success: false, error: 'ไม่พบผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }), {
            status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
      }

      return new Response(JSON.stringify({ success: false, error: 'action ไม่ถูกต้อง: ใช้ upsert | delete | login' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
}
