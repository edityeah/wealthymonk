/**
 * Newsletter subscribe → Notion (+ Resend welcome email with 1-click unsubscribe).
 *
 * POST /api/subscribe   body: { email, name?, source?, hp? }
 *
 * Spam protection: honeypot (hp), per-IP rate limit. Dedup: re-subscribing an
 * Active email is a no-op; a previously-unsubscribed email is reactivated.
 *
 * Runtime env: NOTION_TOKEN, NOTION_SUBSCRIBERS_DB_ID, RESEND_API_KEY (optional),
 *   UNSUB_SECRET (optional, signs unsubscribe links), COMMENTS KV (rate limit).
 */
interface Env {
  COMMENTS: KVNamespace;
  NOTION_TOKEN?: string;
  NOTION_SUBSCRIBERS_DB_ID?: string;
  RESEND_API_KEY?: string;
  UNSUB_SECRET?: string;
}

const SITE_URL = 'https://wealthymonk.org';
const FROM_EMAIL = 'The Wealthy Monk <no-reply@wealthymonk.org>';
const AUTHOR_NAME = 'Aditya';

const MAX_NAME = 100, MAX_EMAIL = 200, MAX_SOURCE = 40, RATE_LIMIT_SECONDS = 60;
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

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function unsubLink(secret: string | undefined, pageId: string): Promise<string> {
  if (!secret) return `${SITE_URL}/contact/`;
  const s = await hmacHex(secret, pageId);
  return `${SITE_URL}/api/unsubscribe?id=${encodeURIComponent(pageId)}&s=${s}`;
}

async function findSubscriber(env: Env, email: string): Promise<{ pageId: string; status: string } | null> {
  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_SUBSCRIBERS_DB_ID}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter: { property: 'Email', email: { equals: email } }, page_size: 1 }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: any[] };
    const row = data.results?.[0];
    if (!row) return null;
    return { pageId: row.id, status: row.properties?.Status?.select?.name ?? '' };
  } catch { return null; }
}

async function reactivate(env: Env, pageId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { Status: { select: { name: 'Active' } }, Subscribed: { date: { start: new Date().toISOString() } } } }),
    });
    return res.ok;
  } catch { return false; }
}

async function sendWelcome(env: Env, to: string, name: string, unsubUrl: string): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  const firstName = (name.split(/\s+/)[0] || '').trim();
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hello,';
  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a2027;line-height:1.6">
  <p>${greeting}</p>
  <p>Welcome to <a href="${SITE_URL}" style="color:#0a6d63;text-decoration:none">The Wealthy Monk</a> — thanks for subscribing.</p>
  <p>You'll get clear, jargon-free takes on <strong>markets, investing, insurance and money</strong> — useful, never clickbait. <strong>One short roundup a week</strong>, no per-post spam.</p>
  <p style="margin:1.5rem 0"><a href="${SITE_URL}" style="display:inline-block;background:#0f9d8f;color:#fff;text-decoration:none;padding:0.65rem 1.4rem;border-radius:999px;font-weight:600">Start reading →</a></p>
  <p style="margin-top:1.25rem">Warmly,<br/>${AUTHOR_NAME}<br/><span style="color:#999">The Wealthy Monk</span></p>
  <p style="margin-top:1.5rem;font-size:12px;color:#aaa">You subscribed at wealthymonk.org. <a href="${unsubUrl}" style="color:#aaa">Unsubscribe instantly</a>.</p>
</div>`;
  const text =
    `${firstName ? `Hi ${firstName},` : 'Hello,'}\n\nWelcome to The Wealthy Monk — thanks for subscribing.\n\nClear, jargon-free takes on markets, investing, insurance and money. One short roundup a week.\n\nStart reading: ${SITE_URL}\n\nWarmly,\n${AUTHOR_NAME}\nThe Wealthy Monk\n\n(Unsubscribe: ${unsubUrl})`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL, to: [to], subject: 'Welcome to The Wealthy Monk', html, text,
        headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      }),
    });
    if (!res.ok) console.error('Resend welcome failed', res.status, (await res.text().catch(() => '')).slice(0, 300));
  } catch (e) { console.error('Resend welcome error', e); }
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try { return await handle(ctx); }
  catch (e: any) { console.error('subscribe threw', e?.stack ?? e); return json({ error: 'Could not subscribe right now. Please try again later.' }, 500); }
};

const handle: PagesFunction<Env> = async ({ env, request }) => {
  if (!env.NOTION_TOKEN || !env.NOTION_SUBSCRIBERS_DB_ID) return json({ error: 'Subscriptions aren’t set up yet.' }, 503);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'invalid JSON' }, 400); }
  if (typeof body.hp === 'string' && body.hp.trim()) return json({ ok: true });

  const email = cleanText(String(body.email ?? '')).slice(0, MAX_EMAIL).toLowerCase();
  const name = cleanText(String(body.name ?? '')).slice(0, MAX_NAME);
  const source = cleanText(String(body.source ?? '')).slice(0, MAX_SOURCE);
  if (!isEmail(email)) return json({ error: 'Please enter a valid email.' }, 400);

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const rlKey = `subscribe:rl:${ip}`;
  if (await env.COMMENTS.get(rlKey)) return json({ error: 'Please wait a moment before trying again.' }, 429);
  await env.COMMENTS.put(rlKey, '1', { expirationTtl: RATE_LIMIT_SECONDS });

  const existing = await findSubscriber(env, email);
  if (existing) {
    if (existing.status === 'Active') return json({ ok: true, already: true });
    const ok = await reactivate(env, existing.pageId);
    if (!ok) return json({ error: 'Could not subscribe right now. Please try again later.' }, 502);
    await sendWelcome(env, email, name, await unsubLink(env.UNSUB_SECRET, existing.pageId));
    return json({ ok: true, reactivated: true });
  }

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parent: { database_id: env.NOTION_SUBSCRIBERS_DB_ID },
      properties: {
        Name: { title: rt(name || email) },
        Email: { email },
        Subscribed: { date: { start: new Date().toISOString() } },
        Status: { select: { name: 'Active' } },
        Source: { rich_text: rt(source || 'site') },
      },
    }),
  });
  if (!res.ok) {
    console.error('Notion subscriber create failed', res.status, (await res.text().catch(() => '')).slice(0, 300));
    return json({ error: 'Could not subscribe right now. Please try again later.' }, 502);
  }
  const created = (await res.json().catch(() => ({}))) as { id?: string };
  await sendWelcome(env, email, name, created.id ? await unsubLink(env.UNSUB_SECRET, created.id) : `${SITE_URL}/contact/`);
  return json({ ok: true });
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204, headers: corsHeaders() });
