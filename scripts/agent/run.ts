/**
 * Wealthy Monk content agent — daily trending finance explainers.
 *
 * Each day it drafts THREE posts: TWO US-market and ONE Indian-market, each a
 * timely, high-traction news explainer (an IPO, a big stock move, an earnings
 * surprise, a policy/macro story) chosen from the day's finance news — not a
 * whole-market wrap. When a story centers on one stock/index/commodity, a small
 * live data snapshot (table + mini chart) is added automatically. Idempotent per
 * category+day; Drafts only, never auto-published.
 *
 * Env: AGENT_DRY_RUN (log only), AGENT_FORCE (ignore once-per-day guard), AGENT_MODEL.
 */
import { Client, isFullPage } from '@notionhq/client';
import { discoverByRegion, type Region } from './discover.js';
import { generateTrending, type ExistingPost, type Category } from './generate.js';
import { fetchQuote, regionHeadlines } from './market-data.js';
import { snapshotBlock } from './report-blocks.js';
import { resolveCover, resolveInlineImages } from './images.js';
import { publishToNotion, recentCoverUrls } from './publish.js';
import { withRetry } from '../lib/notion.js';
import { runQa } from './qa.js';

const DRY = !!process.env.AGENT_DRY_RUN;
const FORCE = !!process.env.AGENT_FORCE;
const CONTENT_TYPE = 'Trending';

const notion = new Client({ auth: process.env.NOTION_TOKEN!, fetch: globalThis.fetch });
const DB = process.env.NOTION_DATABASE_ID!;

// The daily plan: two US posts, one India post.
const PLAN: { region: Region; category: Category; regionTag: string; coverPool: string[] }[] = [
  usSlot(), usSlot(),
  {
    region: 'india', category: 'Indian Markets', regionTag: 'Indian Markets',
    coverPool: [
      'Bombay Stock Exchange building Mumbai', 'Indian rupee banknotes and coins',
      'RBI Reserve Bank of India building', 'Mumbai financial district skyline',
      'stock market ticker board India', 'Dalal Street Mumbai',
    ],
  },
];
function usSlot() {
  return {
    region: 'us' as Region, category: 'US Markets' as Category, regionTag: 'US Markets',
    coverPool: [
      'New York Stock Exchange Wall Street', 'Nasdaq market screen Times Square',
      'US dollar bills close up', 'Wall Street street sign New York',
      'stock market trading floor screens', 'Federal Reserve building Washington',
    ],
  };
}

const plain = (rich: any[] | undefined) => (rich ?? []).map((r) => r.plain_text ?? '').join('');
const todayUtc = () => new Date().toISOString().slice(0, 10);
const dateLabel = () => new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
function slugify(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const t of tags) { const k = t.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(t); } }
  return out;
}

async function loadPosts() {
  const out: { title: string; slug: string; tags: string[]; excerpt?: string; category?: string; contentType?: string; createdDate?: string; status?: string }[] = [];
  let cursor: string | undefined;
  do {
    const res = await withRetry(() => notion.databases.query({ database_id: DB, start_cursor: cursor, page_size: 100 }));
    for (const p of res.results) {
      if (!isFullPage(p)) continue;
      const pr = p.properties as any;
      out.push({
        title: plain(pr.Title?.title),
        slug: plain(pr.Slug?.rich_text),
        tags: (pr.Tags?.multi_select ?? []).map((t: any) => t.name),
        excerpt: plain(pr.Excerpt?.rich_text) || undefined,
        category: pr.Category?.select?.name,
        contentType: pr['Content Type']?.select?.name,
        status: pr.Status?.select?.name,
        createdDate: pr['Publish Date']?.date?.start,
      });
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}

/** Count today's Trending posts by category (idempotency). */
function doneTodayByCategory(posts: Awaited<ReturnType<typeof loadPosts>>): Map<string, number> {
  const today = todayUtc();
  const m = new Map<string, number>();
  for (const p of posts) {
    if (p.createdDate?.slice(0, 10) === today && p.contentType === CONTENT_TYPE && p.category) {
      m.set(p.category, (m.get(p.category) ?? 0) + 1);
    }
  }
  return m;
}

/** Insert a block right after the body's first paragraph. */
function injectAfterLead(body: string, block: string): string {
  const parts = body.split('\n\n');
  if (parts.length <= 1) return `${body}\n\n${block}`;
  return [parts[0], block, ...parts.slice(1)].join('\n\n');
}

async function makePost(
  cfg: (typeof PLAN)[number],
  candidates: Awaited<ReturnType<typeof discoverByRegion>>[Region],
  existing: ExistingPost[],
  avoid: string[],
  recentCovers: Set<string>,
): Promise<{ story: string; sourceUrl: string } | null> {
  if (!candidates.length) { console.log(`[agent] no ${cfg.region} candidates — skipping.`); return null; }

  const t = await generateTrending(cfg.region, candidates, existing, { dateLabel: dateLabel(), avoid });
  console.log(`[agent] ${cfg.region} story: "${t.chosenStory}"${t.ticker ? ` [${t.ticker}]` : ''}`);

  let body = t.body;
  // Contextual data snapshot when the story centers on one instrument.
  if (t.ticker) {
    try {
      const [main, heads] = await Promise.all([fetchQuote(t.ticker, t.tickerLabel || undefined), regionHeadlines(cfg.region)]);
      if (main) body = injectAfterLead(body, snapshotBlock(main, heads));
      else console.log(`[agent] ticker ${t.ticker} returned no data — skipping snapshot.`);
    } catch (e) { console.log(`[agent] snapshot failed for ${t.ticker}:`, e); }
  }
  body = await resolveInlineImages(body);

  const slug = (t.slug || slugify(t.title)).replace(/[^a-z0-9-]/g, '');
  const cover = await resolveCover({
    type: 'brief', stockOnly: true, title: t.title,
    unsplashQuery: t.coverQuery, fallbackQueries: cfg.coverPool, avoid: recentCovers,
  });
  const qa = await runQa({ title: t.title, body });
  console.log(`[agent] ${cfg.category}: ${body.length} chars | cover: ${cover.source} | QA: ${qa.status}`);
  if (DRY) { console.log(`[DRY] ${cfg.category} "${t.title}"`); return { story: t.chosenStory, sourceUrl: t.sourceUrl }; }

  await publishToNotion(
    {
      title: t.title, slug, excerpt: t.excerpt, category: cfg.category,
      tags: dedupeTags([...(t.tags ?? []), cfg.regionTag, 'TWM News']),
      body, coverQuery: t.coverQuery, sourceUrl: t.sourceUrl || '', sourceName: '',
    },
    cover.url,
    { contentType: CONTENT_TYPE as any, qa: qa.status, qaNotes: qa.notes },
  );
  if (cover.url) recentCovers.add(cover.url);
  console.log(`[agent] ${cfg.category} draft created.`);
  return { story: t.chosenStory, sourceUrl: t.sourceUrl };
}

async function main() {
  const posts = await loadPosts();
  const done = doneTodayByCategory(posts);
  const todo = FORCE ? [...PLAN] : PLAN.filter((slot) => {
    const c = done.get(slot.category) ?? 0;
    if (c > 0) { done.set(slot.category, c - 1); return false; }
    return true;
  });
  console.log(`[agent] plan: ${PLAN.map((p) => p.category).join(' + ')}${FORCE ? ' (FORCE)' : ''} — to produce: [${todo.map((t) => t.category).join(', ') || 'none'}]`);
  if (!todo.length) { console.log('[agent] all posts already drafted today — nothing to do.'); return; }

  const buckets = await discoverByRegion();
  console.log(`[agent] discovered india=${buckets.india.length} us=${buckets.us.length}`);
  const existing: ExistingPost[] = posts
    .filter((p) => p.status === 'Published' && p.title && p.slug)
    .map((p) => ({ title: p.title, slug: p.slug, tags: p.tags, excerpt: p.excerpt }));
  const recentCovers = await recentCoverUrls();
  const avoidByRegion: Record<Region, string[]> = { india: [], us: [] };
  const usedUrls = new Set<string>();

  for (const cfg of todo) {
    try {
      const fresh = buckets[cfg.region].filter((c) => !usedUrls.has(c.url));
      const res = await makePost(cfg, fresh, existing, avoidByRegion[cfg.region], recentCovers);
      if (res) { avoidByRegion[cfg.region].push(res.story); if (res.sourceUrl) usedUrls.add(res.sourceUrl); }
    } catch (e) {
      console.error(`[agent] ${cfg.category} failed:`, e);
    }
  }
  console.log('[agent] run complete.');
}

main().catch((e) => { console.error(e); process.exit(1); });
