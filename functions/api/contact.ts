/**
 * Contact form → Notion (+ optional acknowledgement email via Resend).
 *
 * POST /api/contact   body: { name, email, subject?, message, hp? }
 *   Creates a row in the "Contact" Notion database.
 *
 * Spam protection: honeypot (hp), per-IP rate limit, length + link caps.
 *
 * Runtime env (Cloudflare Pages project settings, NOT build-time):
 *   NOTION_TOKEN, NOTION_CONTACT_DB_ID, RESEND_API_KEY (optional),
 *   COMMENTS (existing KV namespace, reused for rate limiting).
 */
interface Env {
  COMMENTS: KVNamespace;
  NOTION_TOKEN?: string;
  NOTION_CONTACT_DB_ID?: string;
  RESEND_API_KEY?: string;
}

const FROM_EMAIL = 'The Wealthy Monk <no-reply@wealthymonk.org>';
const AUTHOR_NAME = 'Aditya';
const SITE_URL = 'https://wealthymonk.org';

const MAX_NAME = 100, MAX_EMAIL = 200, MAX_SUBJECT = 200, MAX_MESSAGE = 5000;
const MIN_MESSAGE = 5, MAX_URLS = 2, RATE_LIMIT_SECONDS = 60;
const NOTION_VERSION = '2022-06-28';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
}
function cleanText(s: string): string { return s.replace(/[ -]/g, '').trim(); }
function isEmail(s: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
function rt(content: string) { return content ? [{ type: 'text', text: { content: content.slice(0, 2000) } }] : []; }
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function sendAcknowledgement(env: Env, to: string, name: string, message: string): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  const firstName = name.split(/\s+/)[0] || 'there';
  const quoted = escapeHtml(message.slice(0, 600));
  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a2027;line-height:1.6">
  <p>Hi ${escapeHtml(firstName)},</p>
  <p>Thanks for reaching out through <a href="${SITE_URL}" style="color:#0a6d63;text-decoration:none">The Wealthy Monk</a> — your message landed safely and I'll reply personally as soon as I can.</p>
  <p style="margin:1.25rem 0 0.4rem;font-size:13px;color:#777;text-transform:uppercase;letter-spacing:.06em">Your message</p>
  <blockquote style="margin:0;padding:0.75rem 1rem;border-left:3px solid #0f9d8f;background:#f3faf8;color:#555;white-space:pre-wrap">${quoted}</blockquote>
  <p style="margin-top:1.5rem">Warmly,<br/>${AUTHOR_NAME}<br/><span style="color:#999">The Wealthy Monk</span></p>
  <p style="margin-top:1.5rem;font-size:12px;color:#aaa">Automated acknowledgement from an unmonitored address — no need to reply.</p>
</div>`;
  const text =
    `Hi ${firstName},\n\nThanks for reaching out through The Wealthy Monk — your message landed safely and I'll reply personally as soon as I can.\n\nYour message:\n${message.slice(0, 600)}\n\nWarmly,\n${AUTHOR_NAME}\nThe Wealthy Monk`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject: 'Thanks — your message reached The Wealthy Monk', html, text }),
    });
    if (!res.ok) console.error('Resend send failed', res.status, (await res.text().catch(() => '')).slice(0, 300));
  } catch (e) { console.error('Resend send error', e); }
}

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  if (!env.NOTION_TOKEN || !env.NOTION_CONTACT_DB_ID) return json({ error: 'contact form not configured' }, 503);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'invalid JSON' }, 400); }
  if (typeof body.hp === 'string' && body.hp.trim()) return json({ ok: true });

  const name = cleanText(String(body.name ?? '')).slice(0, MAX_NAME);
  const email = cleanText(String(body.email ?? '')).slice(0, MAX_EMAIL);
  const subject = cleanText(String(body.subject ?? '')).slice(0, MAX_SUBJECT);
  const message = cleanText(String(body.message ?? '')).slice(0, MAX_MESSAGE);

  if (!name) return json({ error: 'Please add your name.' }, 400);
  if (!isEmail(email)) return json({ error: 'Please add a valid email.' }, 400);
  if (message.length < MIN_MESSAGE) return json({ error: 'Your message is too short.' }, 400);
  const urls = message.match(/https?:\/\//gi);
  if (urls && urls.length > MAX_URLS) return json({ error: 'Too many links in the message.' }, 400);

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const rlKey = `contact:rl:${ip}`;
  if (await env.COMMENTS.get(rlKey)) return json({ error: 'Please wait a moment before sending again.' }, 429);

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parent: { database_id: env.NOTION_CONTACT_DB_ID },
      properties: {
        Name: { title: rt(name) },
        Email: { email },
        Subject: { rich_text: rt(subject) },
        Message: { rich_text: rt(message) },
        Submitted: { date: { start: new Date().toISOString() } },
        Status: { select: { name: 'New' } },
      },
    }),
  });
  if (!res.ok) {
    console.error('Notion contact create failed', res.status, (await res.text().catch(() => '')).slice(0, 300));
    return json({ error: 'Could not send right now. Please try again later.' }, 502);
  }
  await env.COMMENTS.put(rlKey, '1', { expirationTtl: RATE_LIMIT_SECONDS });
  await sendAcknowledgement(env, email, name, message);
  return json({ ok: true });
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204, headers: corsHeaders() });
