/**
 * GET  /api/likes/:slug  — returns { count }.
 * POST /api/likes/:slug  — increments by 1, returns new { count }.
 *
 * Cloudflare KV binding: LIKES. Throttled 1/slug/IP/24h.
 */
interface Env {
  LIKES: KVNamespace;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function sanitizeSlug(s: string): string | null {
  if (!s || s.length > 200) return null;
  if (!/^[a-z0-9-]+$/i.test(s)) return null;
  return s.toLowerCase();
}

async function getCount(env: Env, slug: string): Promise<number> {
  const v = await env.LIKES.get(`post:${slug}`);
  return v ? Number(v) || 0 : 0;
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const slug = sanitizeSlug(params.slug as string);
  if (!slug) {
    return new Response(JSON.stringify({ error: 'invalid slug' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }
  const count = await getCount(env, slug);
  return new Response(JSON.stringify({ count }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30', ...corsHeaders() },
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ params, env, request }) => {
  const slug = sanitizeSlug(params.slug as string);
  if (!slug) {
    return new Response(JSON.stringify({ error: 'invalid slug' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const throttleKey = `throttle:${slug}:${ip}`;
  if (await env.LIKES.get(throttleKey)) {
    const count = await getCount(env, slug);
    return new Response(JSON.stringify({ count, throttled: true }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }
  const next = (await getCount(env, slug)) + 1;
  await env.LIKES.put(`post:${slug}`, String(next));
  await env.LIKES.put(throttleKey, '1', { expirationTtl: 86400 });
  return new Response(JSON.stringify({ count: next }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { status: 204, headers: corsHeaders() });
