/**
 * Multi-source image resolver with VISION verification.
 *
 * The old version took the first keyword-search hit blindly, which produced
 * irrelevant covers (a Wikipedia page's dated lead photo) and inline images
 * that didn't match their captions (a book page for "document checklist").
 *
 * Now: gather MANY candidates across sources, then let Claude actually LOOK at
 * them and pick the one that genuinely matches the subject — or reject them all.
 * A wrong image is worse than no image, so inline slots are dropped when nothing
 * fits.
 *
 * Sources (free): Wikimedia Commons / Wikipedia (no key), Pexels (PEXELS_API_KEY,
 * optional), Pixabay (PIXABAY_API_KEY, optional), Unsplash (UNSPLASH_ACCESS_KEY),
 * plus the source article's image / OG image for news.
 */
import Anthropic from '@anthropic-ai/sdk';

const UNSPLASH = process.env.UNSPLASH_ACCESS_KEY;
const PEXELS = process.env.PEXELS_API_KEY;
const PIXABAY = process.env.PIXABAY_API_KEY;
// Picking the best image is a simple visual judgment — Haiku handles it well
// and is ~3-4x cheaper than Sonnet for these image-heavy calls.
const VISION_MODEL = process.env.AGENT_VISION_MODEL ?? 'claude-haiku-4-5-20251001';

/** A candidate image: a small `thumb` for the vision check, a larger `full` to embed. */
export interface Candidate { thumb: string; full: string; source: string; }

async function imageLoads(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok && (r.headers.get('content-type') ?? '').startsWith('image/');
  } catch { return false; }
}

// ── candidate sources (each returns several) ─────────────────────────────────

/** Wikipedia REST lead image for a page title (one candidate). */
export async function wikipediaCandidate(entity: string): Promise<Candidate | null> {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(entity)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'geo-traveller-agent/1.0' } });
    if (!r.ok) return null;
    const data = (await r.json()) as any;
    const full = data?.originalimage?.source ?? data?.thumbnail?.source;
    const thumb = data?.thumbnail?.source ?? full;
    return full ? { thumb, full, source: 'wikipedia' } : null;
  } catch { return null; }
}

/** Wikimedia Commons image search → up to `n` file candidates. */
export async function wikimediaCandidates(query: string, n = 4): Promise<Candidate[]> {
  if (!query) return [];
  try {
    const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=${n}&gsrsearch=${encodeURIComponent(query)}&prop=imageinfo&iiprop=url&iiurlwidth=900&origin=*`;
    const r = await fetch(api, { headers: { 'User-Agent': 'geo-traveller-agent/1.0' } });
    if (!r.ok) return [];
    const data = (await r.json()) as any;
    const pages = Object.values(data?.query?.pages ?? {}) as any[];
    const out: Candidate[] = [];
    for (const p of pages) {
      const info = p?.imageinfo?.[0];
      const u = info?.thumburl ?? info?.url;
      // Skip obvious non-photos (svg/logos/maps render poorly as covers).
      if (u && !/\.svg$/i.test(u)) out.push({ thumb: u, full: u, source: 'wikimedia' });
    }
    return out;
  } catch { return []; }
}

export async function pexelsCandidates(query: string, n = 4): Promise<Candidate[]> {
  if (!PEXELS || !query) return [];
  try {
    const r = await fetch(`https://api.pexels.com/v1/search?per_page=${n}&orientation=landscape&query=${encodeURIComponent(query)}`,
      { headers: { Authorization: PEXELS } });
    if (!r.ok) return [];
    const data = (await r.json()) as any;
    return (data?.photos ?? []).map((p: any) => ({ thumb: p.src?.medium, full: p.src?.large, source: 'pexels' }))
      .filter((c: Candidate) => c.thumb && c.full);
  } catch { return []; }
}

export async function pixabayCandidates(query: string, n = 4): Promise<Candidate[]> {
  if (!PIXABAY || !query) return [];
  try {
    const r = await fetch(`https://pixabay.com/api/?key=${PIXABAY}&image_type=photo&orientation=horizontal&per_page=${Math.max(3, n)}&q=${encodeURIComponent(query)}`);
    if (!r.ok) return [];
    const data = (await r.json()) as any;
    return (data?.hits ?? []).slice(0, n).map((h: any) => ({ thumb: h.webformatURL, full: h.largeImageURL, source: 'pixabay' }))
      .filter((c: Candidate) => c.thumb && c.full);
  } catch { return []; }
}

export async function unsplashCandidates(query: string, n = 5): Promise<Candidate[]> {
  if (!UNSPLASH || !query) return [];
  try {
    const r = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&orientation=landscape&per_page=${n}&content_filter=high`,
      { headers: { Authorization: `Client-ID ${UNSPLASH}` } });
    if (!r.ok) return [];
    const data = (await r.json()) as any;
    return (data?.results ?? []).map((p: any) => ({ thumb: p.urls?.small, full: p.urls?.regular, source: 'unsplash' }))
      .filter((c: Candidate) => c.thumb && c.full);
  } catch { return []; }
}

export async function ogImage(articleUrl: string): Promise<string | undefined> {
  try {
    const r = await fetch(articleUrl, { headers: { 'User-Agent': 'geo-traveller-agent/1.0' } });
    if (!r.ok) return undefined;
    const html = await r.text();
    const m = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ??
              html.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i);
    return m?.[1];
  } catch { return undefined; }
}

// ── vision selection ─────────────────────────────────────────────────────────

/** Parse Claude's choice ("3" / "none" / "Image 2") into a 1-based index or null. */
export function parseVisionChoice(text: string, count: number): number | null {
  const t = (text ?? '').trim().toLowerCase();
  if (!t || t.startsWith('none')) return null;
  const m = t.match(/\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return n >= 1 && n <= count ? n : null;
}

/** De-dupe by full URL, preserving order. */
function dedupe(cands: Candidate[]): Candidate[] {
  const seen = new Set<string>(); const out: Candidate[] = [];
  for (const c of cands) { if (c.full && !seen.has(c.full)) { seen.add(c.full); out.push(c); } }
  return out;
}

/**
 * Show the candidate images to Claude and let it pick the best match for
 * `subject`, or reject all. Returns the chosen Candidate or null.
 *
 * If no ANTHROPIC_API_KEY is available (e.g. local dev), we cannot verify —
 * return the first candidate as a best-effort fallback so the pipeline still
 * runs, but in CI the key is always present so vision actually runs.
 */
export async function selectWithVision(
  subject: string,
  candidates: Candidate[],
  opts: { max?: number; allowNone?: boolean; mode?: 'cover' | 'inline' } = {}
): Promise<Candidate | null> {
  const list = dedupe(candidates).slice(0, opts.max ?? 6);
  if (list.length === 0) return null;
  // Nothing to choose: a required slot (cover) with one candidate keeps it
  // anyway, so skip the vision call entirely (cost optimization).
  if (list.length === 1 && opts.allowNone === false) return list[0];
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return list[0]; // can't verify offline; best effort

  // Anthropic cannot reliably fetch arbitrary image URLs (Wikimedia/Unsplash
  // return 400 "Unable to download the file"). So we download the bytes here
  // and send them as base64 — the only reliable way to actually show Claude the
  // image. Candidates that fail to download or aren't a supported type are
  // skipped, and the numbering follows the successfully-encoded list.
  const encoded: { cand: Candidate; media_type: string; data: string }[] = [];
  for (const c of list) {
    const img = await toBase64Image(c.thumb);
    if (img) encoded.push({ cand: c, ...img });
  }
  if (encoded.length === 0) return opts.allowNone === false ? list[0] : null;

  const content: any[] = [];
  encoded.forEach((e, i) => {
    content.push({ type: 'text', text: `Image ${i + 1}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: e.media_type, data: e.data } });
  });

  const count = encoded.length;
  const instruction = opts.mode === 'cover'
    ? // Covers: strict + scenic. The hero image must be relevant and attractive.
      `These are candidate COVER photos for a travel article: "${subject}".\n\n` +
      `Pick the ONE that makes the best hero image — prefer an iconic, attractive landmark, ` +
      `skyline, cityscape, flag, or clearly-relevant scene for the destination/topic.\n` +
      `REJECT (never pick) any image that:\n` +
      `- shows a DIFFERENT country, city, flag, or landmark than the subject (e.g. a US embassy for a Japan article);\n` +
      `- shows government officials, politicians, ceremonies, handshakes, or press/news scenes;\n` +
      `- is a close-up of paperwork, a postage stamp, a book/text page, a document scan, a screenshot, a logo, a map, a chart;\n` +
      `- is dated/historical, watermarked, blurry, or low quality.\n` +
      `Reply with ONLY the number (1-${count}). If none are great, reply with the single best available number.`
    : // Inline: lenient. A clean, on-topic generic photo is fine.
      `These are candidate images to ILLUSTRATE this point in an article: "${subject}".\n\n` +
      `Pick the ONE that best and most clearly illustrates the subject. A clean, generic photo of the right ` +
      `kind of object, place, or scene is perfectly fine — do not over-reject on small specifics.\n` +
      `REJECT only images that are: clearly off-topic; a page of text, a book cover, a document scan, a ` +
      `screenshot, a logo, a chart, or a diagram; watermarked; or low quality.\n` +
      `Reply with ONLY the number of the best image (1-${count}), or "none" if none reasonably fit.`;

  content.push({ type: 'text', text: instruction });

  try {
    const client = new Anthropic({ apiKey: key });
    const res = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: 16,
      messages: [{ role: 'user', content }],
    });
    const text = (res.content.find((c: any) => c.type === 'text') as any)?.text ?? '';
    const idx = parseVisionChoice(text, count);
    if (idx === null) {
      console.log(`[images] vision(${opts.mode ?? 'inline'}) reply="${text.trim().slice(0, 40)}" → ${opts.allowNone === false ? 'fallback first' : 'none'}`);
      return opts.allowNone === false ? encoded[0].cand : null;
    }
    return encoded[idx - 1].cand;
  } catch (e: any) {
    console.warn(`[images] vision(${opts.mode ?? 'inline'}) ERROR: ${e?.status ?? ''} ${e?.message ?? e}`);
    // Vision errored — fall back to the first downloaded candidate (covers)
    // rather than blocking the post; drop (inline).
    return opts.allowNone === false ? encoded[0].cand : null;
  }
}

const SUPPORTED_IMG = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** Download an image URL and return base64 + media type, or null if unusable. */
async function toBase64Image(url: string): Promise<{ media_type: string; data: string } | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'geo-traveller-agent/1.0' } });
    if (!r.ok) return null;
    let ct = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!SUPPORTED_IMG.has(ct)) {
      // Infer from extension as a fallback.
      if (/\.(jpe?g)(\?|$)/i.test(url)) ct = 'image/jpeg';
      else if (/\.png(\?|$)/i.test(url)) ct = 'image/png';
      else if (/\.webp(\?|$)/i.test(url)) ct = 'image/webp';
      else if (/\.gif(\?|$)/i.test(url)) ct = 'image/gif';
      else return null;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length === 0 || buf.length > 4_500_000) return null; // ~5MB API cap per image
    return { media_type: ct, data: buf.toString('base64') };
  } catch {
    return null;
  }
}

// ── public resolvers ─────────────────────────────────────────────────────────

export interface CoverOpts {
  type: 'evergreen' | 'news';
  title?: string;             // post title, for vision context
  imageEntity?: string;       // evergreen: Wikipedia/Wikimedia subject
  unsplashQuery: string;      // model-supplied specific query
  fallbackQueries?: string[];
  candidateImageUrl?: string; // news: RSS image
  candidateUrl?: string;      // news: article for OG scrape
}

/**
 * Resolve a cover. News prefers the source article's own image (reliably
 * on-topic); otherwise — and always for evergreen — we gather candidates across
 * sources and have vision pick the best.
 */
export async function resolveCover(o: CoverOpts): Promise<{ url?: string; source: string }> {
  // News: the article's own image is almost always the right, authentic cover.
  if (o.type === 'news') {
    if (o.candidateImageUrl && (await imageLoads(o.candidateImageUrl))) {
      return { url: o.candidateImageUrl, source: 'rss-image' };
    }
    if (o.candidateUrl) {
      const og = await ogImage(o.candidateUrl);
      if (og && (await imageLoads(og))) return { url: og, source: 'og-image' };
    }
  }

  // Covers use CLEAN STOCK ONLY (Unsplash/Pexels). We deliberately do NOT pull
  // from Wikimedia/Wikipedia for covers — those return dated documentary photos
  // and wrong-entity results (e.g. a US embassy for a Japan visa guide).
  const queries = [o.unsplashQuery, ...(o.fallbackQueries ?? [])]
    .map((q) => (q ?? '').trim()).filter(Boolean);
  const primary = queries[0] ?? 'travel photography';
  const candidates: Candidate[] = [];
  for (const q of queries.slice(0, 4)) {
    candidates.push(...(await unsplashCandidates(q, 3)));
  }
  candidates.push(...(await pexelsCandidates(primary, 3)));
  if (queries[1]) candidates.push(...(await pexelsCandidates(queries[1], 2)));

  const subject = o.title ? `"${o.title}"` : primary;
  // Cover should always end up with something clean — fall back to first candidate.
  const chosen = await selectWithVision(subject, candidates, { max: 8, allowNone: false, mode: 'cover' });
  return chosen ? { url: chosen.full, source: `vision:${chosen.source}` } : { url: undefined, source: 'none' };
}

/**
 * Replace ![alt](query:...) inline placeholders. For each, gather candidates for
 * the query, let vision pick the one that matches the alt text, and DROP the
 * image if nothing fits (a wrong image is worse than none).
 */
export async function resolveInlineImages(body: string): Promise<string> {
  const re = /!\[([^\]]*)\]\(query:([^)]+)\)/g;
  const jobs: { full: string; alt: string; query: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) jobs.push({ full: m[0], alt: m[1], query: m[2].trim() });

  let out = body;
  for (const j of jobs) {
    // Clean stock only. Wikimedia returns documentary/wrong-entity junk for
    // conceptual queries (e.g. a French-embassy voting scene for "embassy
    // counter"), so we don't use it for inline illustrations.
    const candidates: Candidate[] = [
      ...(await unsplashCandidates(j.query, 5)),
      ...(await pexelsCandidates(j.query, 3)),
    ];
    const subject = j.alt && j.alt !== 'image' ? `${j.alt} (${j.query})` : j.query;
    console.log(`[images] inline "${j.query}": ${candidates.length} candidates`);
    const chosen = await selectWithVision(subject, candidates, { max: 6, allowNone: true, mode: 'inline' });
    out = chosen ? out.replace(j.full, `![${j.alt}](${chosen.full})`) : out.replace(j.full, '');
  }
  return out;
}
