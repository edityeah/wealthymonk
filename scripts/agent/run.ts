/**
 * Wealthy Monk content agent — daily market "Day Starter" briefs.
 *
 * Each day it drafts exactly TWO posts: one Indian-market brief (category
 * "Indian Markets") and one US-market brief (category "US Markets"), each
 * synthesized from that day's trending finance news. Idempotent: a region whose
 * brief already exists today is skipped, so an hourly cron fills any missing
 * region then no-ops. Nothing is ever auto-published — posts land as Drafts.
 *
 * Env: AGENT_DRY_RUN (log only, no Notion write), AGENT_MODEL, AGENT_STATUS.
 */
import { Client, isFullPage } from '@notionhq/client';
import { discoverByRegion, type Region } from './discover.js';
import { generateDailyBrief, type ExistingPost, type Category } from './generate.js';
import { resolveCover, resolveInlineImages } from './images.js';
import { existingSourceUrls, publishToNotion, recentCoverUrls } from './publish.js';
import { withRetry } from '../lib/notion.js';
import { runQa } from './qa.js';

const DRY = !!process.env.AGENT_DRY_RUN;
const CONTENT_TYPE = 'Daily Brief';

const notion = new Client({ auth: process.env.NOTION_TOKEN!, fetch: globalThis.fetch });
const DB = process.env.NOTION_DATABASE_ID!;

const REGIONS: { region: Region; category: Category; regionTag: string; coverPool: string[] }[] = [
  {
    region: 'india', category: 'Indian Markets', regionTag: 'Indian Markets',
    coverPool: [
      'Bombay Stock Exchange building Mumbai', 'Indian rupee banknotes and coins',
      'RBI Reserve Bank of India building', 'Mumbai financial district skyline',
      'stock market ticker board India', 'Dalal Street Mumbai',
    ],
  },
  {
    region: 'us', category: 'US Markets', regionTag: 'US Markets',
    coverPool: [
      'New York Stock Exchange Wall Street', 'Nasdaq market screen Times Square',
      'US dollar bills close up', 'Wall Street street sign New York',
      'stock market trading floor screens', 'Federal Reserve building Washington',
    ],
  },
];

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

/** Categories that already have a Daily Brief dated today (idempotency guard). */
function briefsDoneToday(posts: Awaited<ReturnType<typeof loadPosts>>): Set<string> {
  const today = todayUtc();
  const done = new Set<string>();
  for (const p of posts) {
    if (p.createdDate?.slice(0, 10) === today && p.contentType === CONTENT_TYPE && p.category) {
      done.add(p.category);
    }
  }
  return done;
}

async function makeBrief(
  cfg: (typeof REGIONS)[number],
  buckets: Record<Region, Awaited<ReturnType<typeof discoverByRegion>>[Region]>,
  existing: ExistingPost[],
  seenSources: Set<string>,
  recentCovers: Set<string>,
): Promise<boolean> {
  const fresh = buckets[cfg.region].filter((c) => !seenSources.has(c.url));
  const candidates = fresh.length ? fresh : buckets[cfg.region];
  if (!candidates.length) { console.log(`[agent] no ${cfg.region} candidates — skipping.`); return false; }
  console.log(`[agent] ${cfg.region}: ${candidates.length} candidates, lead "${candidates[0].title}"`);

  const post = await generateDailyBrief(cfg.region, candidates, existing, dateLabel());
  const body = await resolveInlineImages(post.body);
  const slug = (post.slug || slugify(post.title)).replace(/[^a-z0-9-]/g, '');
  const cover = await resolveCover({
    type: 'brief',
    stockOnly: true,
    title: post.title,
    unsplashQuery: post.coverQuery,
    fallbackQueries: cfg.coverPool,
    avoid: recentCovers,
  });
  const qa = await runQa({ title: post.title, body });
  console.log(`[agent] ${cfg.region} cover: ${cover.source} | QA: ${qa.status}`);
  if (DRY) { console.log(`[DRY] ${cfg.category} brief "${post.title}" — ${body.length} chars`); return true; }

  await publishToNotion(
    { ...post, slug, body, category: cfg.category, tags: dedupeTags([...post.tags, cfg.regionTag, 'TWM News']) },
    cover.url,
    { contentType: CONTENT_TYPE as any, qa: qa.status, qaNotes: qa.notes },
  );
  if (cover.url) recentCovers.add(cover.url); // don't let the second brief reuse the first's cover
  console.log(`[agent] ${cfg.category} draft created.`);
  return true;
}

async function main() {
  const posts = await loadPosts();
  const done = briefsDoneToday(posts);
  const todo = REGIONS.filter((r) => !done.has(r.category));
  console.log(`[agent] daily briefs done today: [${[...done].join(', ') || 'none'}] — to produce: [${todo.map((t) => t.category).join(', ') || 'none'}]`);
  if (!todo.length) { console.log('[agent] both briefs already drafted today — nothing to do.'); return; }

  const buckets = await discoverByRegion();
  console.log(`[agent] discovered india=${buckets.india.length} us=${buckets.us.length}`);
  const existing: ExistingPost[] = posts
    .filter((p) => p.status === 'Published' && p.title && p.slug)
    .map((p) => ({ title: p.title, slug: p.slug, tags: p.tags, excerpt: p.excerpt }));
  const seenSources = await existingSourceUrls();
  const recentCovers = await recentCoverUrls();

  for (const cfg of todo) {
    try {
      await makeBrief(cfg, buckets, existing, seenSources, recentCovers);
    } catch (e) {
      console.error(`[agent] ${cfg.category} failed:`, e);
    }
  }
  console.log('[agent] run complete.');
}

main().catch((e) => { console.error(e); process.exit(1); });
