/**
 * Cloudflare Pages Function: /api/login
 * Handles customer and admin authentication against D1 SQL database
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

  if (request.method === 'POST') {
    try {
      const data = await request.json();
      const inputId = String(data.id || '').trim();
      const inputContact = String(data.contact || '').trim();

      const plainId = inputId.replace(/[^0-9a-zA-Z]/g, '');
      const plainContact = inputContact.replace(/[^0-9]/g, '');

      if (!plainId) {
        return new Response(JSON.stringify({ success: false, error: 'กรุณาระบุเลขบัตรประชาชน หรือรหัสลูกค้า' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      if (env.DB) {
        // Query D1 customer
        const { results: matchedCusts } = await env.DB.prepare(`
          SELECT id as Id, cust_code as CustCode, name as Name, tel as Tel
          FROM customers
          WHERE id = ? OR cust_code = ? OR replace(id, '-', '') = ? OR replace(cust_code, '-', '') = ?
        `).bind(inputId, inputId, plainId, plainId).all();

        if (matchedCusts && matchedCusts.length > 0) {
          const customer = matchedCusts[0];
          const dbTel = String(customer.Tel || '').replace(/\D/g, '');

          // Verify phone if contact provided
          const phoneValid = !plainContact || !dbTel || dbTel === plainContact ||
            (dbTel.length >= 9 && plainContact.length >= 9 && (dbTel.endsWith(plainContact) || plainContact.endsWith(dbTel)));

          if (phoneValid) {
            // Query tickets for this customer
            const { results: tickets } = await env.DB.prepare(`
              SELECT system_id as SystemID, bud_year as BudYear, book_no as BookNo, doc_no as DocNo, bill_stat as BillStat, bill_type as BillType, bill_date as BillDate, bill_no as BillNo, asstotal as Asstotal, month_total as MonthTotal, month_int as MonthInt, totalint as Totalint, app_date as AppDate, exp_date as ExpDate, model as Model, id as Id, cust_code as CustCode
              FROM tickets
              WHERE id = ? OR cust_code = ? OR replace(id, '-', '') = ? OR replace(cust_code, '-', '') = ?
            `).bind(customer.Id, customer.CustCode || customer.Id, plainId, plainId).all();

            return new Response(JSON.stringify({
              success: true,
              customer,
              tickets: tickets || []
            }), {
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }
        }
      }

      return new Response(JSON.stringify({
        success: false,
        error: 'ไม่พบข้อมูลลูกค้า หรือเบอร์โทรศัพท์ไม่ตรงกับในระบบ'
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
