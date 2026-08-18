/**
 * Cloudflare Pages Function: /api/login
 * Real-time direct login against Cloudflare D1 SQL Database
 */
export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, message: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  try {
    let reqBody = {};
    try { reqBody = await request.json(); } catch(e) {}
    const inputId = String(reqBody.id || '').replace(/[^0-9a-zA-Z]/g, '');
    const inputContact = String(reqBody.contact || '').replace(/\D/g, '');

    if (!inputId || !inputContact) {
      return new Response(JSON.stringify({ success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    if (env.DB) {
      // 1. ค้นหาลูกค้าจาก Cloudflare D1 Database
      const { results: custRows } = await env.DB.prepare(
        "SELECT id as Id, cust_code as CustCode, name as Name, tel as Tel FROM customers WHERE id = ? OR cust_code = ?"
      ).bind(inputId, inputId).all();

      if (custRows && custRows.length > 0) {
        const customer = custRows.find(c => {
          const dbTel = String(c.Tel || '').replace(/\D/g, '');
          return (
            dbTel === inputContact ||
            (dbTel.length >= 9 && inputContact.length >= 9 && (dbTel.endsWith(inputContact) || inputContact.endsWith(dbTel))) ||
            (dbTel.includes(inputContact) && inputContact.length >= 8)
          );
        });

        if (customer) {
          // 2. ดึงตั๋วเฉพาะของลูกค้ารายนี้จาก D1
          const cId = customer.Id || inputId;
          const cCode = customer.CustCode || inputId;
          const { results: custTickets } = await env.DB.prepare(
            "SELECT system_id as SystemID, bud_year as BudYear, book_no as BookNo, doc_no as DocNo, bill_stat as BillStat, asstotal as Asstotal, month_total as MonthTotal, month_int as MonthInt, totalint as Totalint, app_date as AppDate, exp_date as ExpDate, model as Model, id as Id, cust_code as CustCode FROM tickets WHERE (id = ? OR cust_code = ? OR id = ? OR cust_code = ?) AND bill_stat = 'N'"
          ).bind(cId, cId, cCode, cCode).all();

          return new Response(JSON.stringify({
            success: true,
            customer,
            tickets: custTickets || []
          }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
      }
    }

    return new Response(JSON.stringify({
      success: false,
      message: 'ไม่พบข้อมูลลูกค้าในระบบ หรือเบอร์โทรศัพท์ไม่ตรงกับที่ลงทะเบียนไว้'
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
