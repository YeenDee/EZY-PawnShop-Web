/**
 * Cloudflare Pages Function: /api/login
 * Real-time direct query to D1 SQL database for customer authentication
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

  if (request.method === 'POST') {
    try {
      const body = await request.json();
      const inputId = String(body.id || '').replace(/[^0-9a-zA-Z]/g, '');
      const inputContact = String(body.contact || '').replace(/[^0-9]/g, '');

      if (!inputId) {
        return new Response(JSON.stringify({ success: false, error: 'กรุณาระบุเลขประจำตัวประชาชน' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      if (env.DB) {
        const { results: matchedCusts } = await env.DB.prepare(
          "SELECT id as Id, cust_code as CustCode, name as Name, tel as Tel FROM customers WHERE REPLACE(id, '-', '') = ? OR REPLACE(cust_code, '-', '') = ? OR id = ? OR cust_code = ?"
        ).bind(inputId, inputId, inputId, inputId).all();

        if (matchedCusts && matchedCusts.length > 0) {
          let matchedCustomer = null;

          if (!inputContact) {
            matchedCustomer = matchedCusts[0];
          } else {
            for (const c of matchedCusts) {
              const dbTel = String(c.Tel || '').replace(/\D/g, '');
              if (
                dbTel === inputContact ||
                (dbTel.length >= 9 && inputContact.length >= 9 && (dbTel.endsWith(inputContact) || inputContact.endsWith(dbTel))) ||
                (dbTel.includes(inputContact) && inputContact.length >= 8) ||
                !dbTel
              ) {
                matchedCustomer = c;
                break;
              }
            }
          }

          if (matchedCustomer) {
            const custCode = matchedCustomer.CustCode || matchedCustomer.Id;
            const custId = matchedCustomer.Id;
            const { results: tickets } = await env.DB.prepare(
              "SELECT system_id as SystemID, bud_year as BudYear, book_no as BookNo, doc_no as DocNo, bill_stat as BillStat, asstotal as Asstotal, month_total as MonthTotal, month_int as MonthInt, totalint as Totalint, app_date as AppDate, exp_date as ExpDate, model as Model, id as Id, cust_code as CustCode FROM tickets WHERE cust_code = ? OR id = ? OR cust_code = ?"
            ).bind(custCode, custId, custId).all();

            return new Response(JSON.stringify({
              success: true,
              customer: matchedCustomer,
              tickets: tickets || []
            }), {
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }
        }
      }

      return new Response(JSON.stringify({
        success: false,
        error: 'ไม่พบข้อมูลลูกค้าในระบบ กรุณาติดต่อโรงรับจำนำฯ ใน วัน - เวลาทำการ จ.-ศ. 09.00 – 15.00 น.'
      }), {
        status: 404,
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
