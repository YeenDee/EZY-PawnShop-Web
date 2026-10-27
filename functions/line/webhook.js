/**
 * Cloudflare Pages Function: /line/webhook (and /api/line-webhook)
 * Handles LINE Messaging API Webhook events (verifying customer 6-digit OTP & replying via LINE Reply API)
 * as well as OTP registration/status checks from /api/login.
 */

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

async function hmacSha256Base64(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  const bytes = new Uint8Array(sig);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

async function sendLineReply(replyToken, channelToken, textMessage) {
  if (!replyToken || !channelToken || replyToken === '00000000000000000000000000000000') {
    return;
  }
  try {
    await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${channelToken}`
      },
      body: JSON.stringify({
        replyToken,
        messages: [
          {
            type: 'text',
            text: textMessage
          }
        ]
      })
    });
  } catch (e) {
    console.error('[LINE Reply Error]:', e);
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    return new Response(JSON.stringify({
      ok: true,
      service: 'EZY Pawnshop 2006 LINE Webhook',
      message: 'Webhook endpoint is active.'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const rawBody = await request.text();
    if (!rawBody) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let payload = {};
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (env.DB) {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS _otp_sessions (
          session_id TEXT PRIMARY KEY,
          otp_code TEXT,
          id_card TEXT,
          cust_code TEXT,
          status TEXT,
          line_user_id TEXT,
          created_at INTEGER,
          expires_at INTEGER
        )
      `).run();
    }

    // 1. Handle internal/cross-domain OTP registration or status check
    if (payload.action === 'register_otp' && env.DB && payload.session_id && payload.otp_code) {
      const now = Date.now();
      const exp = Number(payload.expires_at) || (now + 5 * 60 * 1000);
      await env.DB.prepare(`
        INSERT OR IGNORE INTO _otp_sessions (session_id, otp_code, id_card, cust_code, status, line_user_id, created_at, expires_at)
        VALUES (?, ?, ?, ?, 'PENDING', '', ?, ?)
      `).bind(
        String(payload.session_id),
        String(payload.otp_code),
        String(payload.id_card || ''),
        String(payload.cust_code || payload.id_card || ''),
        now,
        exp
      ).run();
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (payload.action === 'check_otp' && env.DB && payload.session_id) {
      const row = await env.DB.prepare(
        `SELECT session_id, status, expires_at FROM _otp_sessions WHERE session_id = ?`
      ).bind(String(payload.session_id)).first();
      const verified = Boolean(row && row.status === 'VERIFIED' && Number(row.expires_at) > Date.now());
      return new Response(JSON.stringify({
        success: true,
        verified,
        status: row ? row.status : 'EXPIRED'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 2. Load LINE Channel Access Token & Channel Secret from D1 _sys_secrets
    let channelToken = String(env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();
    let channelSecret = String(env.LINE_CHANNEL_SECRET || '').trim();

    if (env.DB) {
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS _sys_secrets (key TEXT PRIMARY KEY, value TEXT)`).run();
      const tokenRow = await env.DB.prepare(`SELECT value FROM _sys_secrets WHERE key = 'line_channel_token'`).first();
      const secretRow = await env.DB.prepare(`SELECT value FROM _sys_secrets WHERE key = 'line_channel_secret'`).first();
      if (tokenRow && tokenRow.value && String(tokenRow.value).trim()) {
        channelToken = String(tokenRow.value).trim();
      }
      if (secretRow && secretRow.value && String(secretRow.value).trim()) {
        channelSecret = String(secretRow.value).trim();
      }
    }

    // Verify X-Line-Signature if Channel Secret is configured
    const lineSignature = request.headers.get('X-Line-Signature') || request.headers.get('x-line-signature') || '';
    if (channelSecret && lineSignature) {
      const expectedSig = await hmacSha256Base64(rawBody, channelSecret);
      if (!timingSafeEqual(lineSignature, expectedSig)) {
        return new Response(JSON.stringify({ success: false, error: 'Invalid LINE signature' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    const events = Array.isArray(payload.events) ? payload.events : [];
    if (events.length === 0) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const now = Date.now();

    for (const ev of events) {
      if (ev.type === 'message' && ev.message && ev.message.type === 'text') {
        const replyToken = ev.replyToken;
        const lineUserId = (ev.source && ev.source.userId) ? String(ev.source.userId) : '';
        const text = String(ev.message.text || '').trim();

        const otpMatch = text.match(/\b(\d{6})\b/);
        if (otpMatch && env.DB) {
          const otpCode = otpMatch[1];

          const session = await env.DB.prepare(`
            SELECT session_id, otp_code, id_card, cust_code, status, expires_at
            FROM _otp_sessions
            WHERE otp_code = ? AND status = 'PENDING' AND expires_at > ?
            ORDER BY created_at DESC
            LIMIT 1
          `).bind(otpCode, now).first();

          if (session && session.session_id) {
            await env.DB.prepare(`
              UPDATE _otp_sessions
              SET status = 'VERIFIED', line_user_id = ?
              WHERE session_id = ?
            `).bind(lineUserId, session.session_id).run();

            await sendLineReply(
              replyToken,
              channelToken,
              `✅ ยืนยันรหัส OTP (${otpCode}) สำเร็จเรียบร้อยแล้ว!\n\nเซิร์ฟเวอร์ได้อนุมัติสิทธิ์เข้าสู่ระบบ (authToken) ให้ท่านแล้ว กรุณากลับไปที่หน้าเว็บไซต์ ระบบจะเข้าสู่หน้าหลักอัตโนมัติครับ`
            );
          } else {
            await sendLineReply(
              replyToken,
              channelToken,
              `❌ รหัส OTP (${otpCode}) ไม่ถูกต้อง หรือหมดอายุแล้ว (เกิน 5 นาที)\n\nกรุณากดปุ่มเข้าสู่ระบบบนหน้าเว็บไซต์เพื่อขอรหัส OTP ใหม่อีกครั้งครับ`
            );
          }
        } else if (/otp|รหัส|ยืนยัน/i.test(text)) {
          await sendLineReply(
            replyToken,
            channelToken,
            `🔐 กรุณานำรหัส OTP ตัวเลข 6 หลัก ที่แสดงบนหน้าเว็บไซต์ พิมพ์ส่งเข้ามาในแชทนี้เพื่อยืนยันตัวตนเข้าสู่ระบบครับ`
          );
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
