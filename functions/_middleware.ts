/**
 * Return HTTP 410 Gone for legacy WordPress URL patterns so Google drops them
 * faster than it would for a plain 404. Everything else passes through
 * untouched (real pages, /api/* Functions, assets).
 *
 * Only unambiguous WP patterns are matched — nothing the new site actually uses
 * (e.g. /tags/ plural and /category/<slug>/ are NOT matched).
 */
const GONE_PATHS: RegExp[] = [
  /^\/wp-/i,               // /wp-content, /wp-admin, /wp-includes, /wp-login.php, /wp-json
  /^\/xmlrpc\.php$/i,
  /\.php$/i,               // any .php — this static site has none
  /\/feed\/?$/i,           // /feed/ and /<anything>/feed/
  /\/trackback\/?$/i,
  /^\/tag\//i,             // old WP tags (the new site uses /tags/)
  /^\/author\//i,
  /^\/comments\/feed/i,
  /^\/\d{4}\/\d{2}\/?$/i,  // date archives like /2024/11/
];
const GONE_QUERY = ['p', 'page_id', 'cat', 'attachment_id', 'replytocom'];

const BODY =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="robots" content="noindex"><title>410 Gone — The Wealthy Monk</title></head>' +
  '<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;text-align:center;color:#1a2027">' +
  '<h1>410 — Gone</h1><p>This page has been permanently removed. ' +
  '<a href="https://wealthymonk.org/" style="color:#0a6d63">Go to the homepage →</a></p></body></html>';

export const onRequest: PagesFunction = async (ctx) => {
  const url = new URL(ctx.request.url);
  const gone =
    GONE_PATHS.some((re) => re.test(url.pathname)) ||
    GONE_QUERY.some((q) => url.searchParams.has(q));
  if (gone) {
    return new Response(BODY, {
      status: 410,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex' },
    });
  }
  return ctx.next();
};
