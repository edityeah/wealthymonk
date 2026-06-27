/**
 * One-click unsubscribe. GET /api/unsubscribe?id=<pageId>&s=<hmac>
 * Verifies the HMAC signature over the subscriber's Notion page id, then flips
 * Status → Unsubscribed. Returns a small HTML confirmation page.
 *
 * Runtime env: NOTION_TOKEN, UNSUB_SECRET.
 */
interface Env {
  NOTION_TOKEN?: string;
  UNSUB_SECRET?: string;
}

const SITE_URL = 'https://wealthymonk.org';
const NOTION_VERSION = '2022-06-28';

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function page(title: string, message: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} — The Wealthy Monk</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f6f8f9;color:#1a2027;display:grid;place-items:center;min-height:100vh;margin:0}.card{background:#fff;border:1px solid #e6e9ec;border-radius:12px;padding:2rem 2.2rem;max-width:440px;text-align:center;box-shadow:0 8px 24px rgba(15,34,51,.06)}h1{font-family:Georgia,serif;font-size:1.4rem;margin:0 0 .6rem}p{color:#5b6671;line-height:1.6}a{color:#0a6d63}</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p><p><a href="${SITE_URL}">← Back to The Wealthy Monk</a></p></div></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

const handle: (id: string, s: string, env: Env) => Promise<Response> = async (id, s, env) => {
  if (!env.NOTION_TOKEN || !env.UNSUB_SECRET) return page('Unavailable', 'Unsubscribe is not configured right now.', 503);
  if (!id || !s) return page('Invalid link', 'This unsubscribe link is missing information.', 400);

  const expected = await hmacHex(env.UNSUB_SECRET, id);
  if (s !== expected) return page('Invalid link', 'This unsubscribe link could not be verified.', 400);

  const res = await fetch(`https://api.notion.com/v1/pages/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { Status: { select: { name: 'Unsubscribed' } } } }),
  });
  if (!res.ok) return page('Something went wrong', 'We could not process that just now. Please try again later.', 502);
  return page('You’re unsubscribed', 'You won’t receive any more emails from The Wealthy Monk. Changed your mind? You can subscribe again anytime.');
};

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url);
  return handle(url.searchParams.get('id') ?? '', url.searchParams.get('s') ?? '', env);
};

// Gmail/Apple Mail one-click sends a POST.
export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url);
  return handle(url.searchParams.get('id') ?? '', url.searchParams.get('s') ?? '', env);
};
