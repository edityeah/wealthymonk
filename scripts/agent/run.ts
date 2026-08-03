/**
 * Wealthy Monk content agent — full daily market "terminal" reports.
 *
 * Each day it drafts TWO comprehensive reports: one Indian-market (category
 * "Indian Markets") and one US-market (category "US Markets"). Each combines
 * REAL market data (snapshot, tables, SVG bar-chart exhibits — generated
 * deterministically from Yahoo Finance) with AI-written analysis grounded in
 * that data and the day's news. Idempotent per region+day; Drafts only, never
 * auto-published.
 *
 * Env: AGENT_DRY_RUN (log only), AGENT_MODEL, AGENT_STATUS.
 */
import { Client, isFullPage } from '@notionhq/client';
import { discoverByRegion, type Region } from './discover.js';
import { generateTerminalReport, type ExistingPost, type Category } from './generate.js';
import { fetchMarketData } from './market-data.js';
import { marketSnapshot, marketDataSections, dataDigestForModel, resetExhibits } from './report-blocks.js';
import { resolveCover, resolveInlineImages } from './images.js';
import { publishToNotion, recentCoverUrls } from './publish.js';
import { withRetry } from '../lib/notion.js';
import { runQa } from './qa.js';

const DRY = !!process.env.AGENT_DRY_RUN;
const FORCE = !!process.env.AGENT_FORCE; // ignore the once-per-day guard (manual test)
const CONTENT_TYPE = 'Market Report';

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

/** Categories that already have a Market Report dated today (idempotency guard). */
function reportsDoneToday(posts: Awaited<ReturnType<typeof loadPosts>>): Set<string> {
  const today = todayUtc();
  const done = new Set<string>();
  for (const p of posts) {
    if (p.createdDate?.slice(0, 10) === today && p.contentType === CONTENT_TYPE && p.category) done.add(p.category);
  }
  return done;
}

/** Assemble the full report body: prose sections interleaved with data blocks. */
function assembleBody(sections: Awaited<ReturnType<typeof generateTerminalReport>>, data: Parameters<typeof marketSnapshot>[0], region: Region): string {
  resetExhibits();
  // Each prose field sits UNDER a "## <section>" heading we add, so demote any
  // H1/H2 the model emitted inside it to H3 — avoids doubled top-level headings
  // and keeps the table-of-contents hierarchy clean.
  const sub = (s?: string) => (s ?? '').trim().replace(/^#{1,2} /gm, '### ');
  const parts: (string | undefined)[] = [
    sections.leadSummary?.trim(),
    sections.keyInsights?.length ? '## Key Insights\n\n' + sections.keyInsights.map((b) => `- ${b}`).join('\n') : undefined,
    marketSnapshot(data),
    '## Market Analysis\n\n' + sub(sections.marketAnalysis),
    '## Market Data\n\n' + marketDataSections(data, region),
    '## Macro View\n\n' + sub(sections.macroView),
    '## Corporate Earnings\n\n' + sub(sections.earnings),
    '## Deals & Corporate Actions\n\n' + sub(sections.deals),
    '## Global Pulse\n\n' + sub(sections.globalPulse),
    sections.whatToWatch?.length ? '## What to Watch\n\n' + sections.whatToWatch.map((b) => `- ${b}`).join('\n') : undefined,
    sections.featureTitle ? `## Feature: ${sections.featureTitle}\n\n` + sub(sections.featureBody) : undefined,
  ];
  return parts.filter(Boolean).join('\n\n');
}

async function makeReport(
  cfg: (typeof REGIONS)[number],
  news: Awaited<ReturnType<typeof discoverByRegion>>[Region],
  existing: ExistingPost[],
  recentCovers: Set<string>,
): Promise<boolean> {
  console.log(`[agent] ${cfg.region}: fetching market data…`);
  const data = await fetchMarketData(cfg.region);
  console.log(`[agent] ${cfg.region}: indices=${data.indices.length} sectors=${data.sectors.length} movers=${data.gainers.length}/${data.losers.length} news=${news.length}`);

  const sections = await generateTerminalReport(cfg.region, dataDigestForModel(data), news, existing, dateLabel());
  // The model may sprinkle inline photo placeholders (![](query:...)) in its prose;
  // resolve them to real vetted images (or drop them). Charts/tables are untouched.
  const body = await resolveInlineImages(assembleBody(sections, data, cfg.region));
  const slug = (sections.slug || slugify(sections.title)).replace(/[^a-z0-9-]/g, '');
  const cover = await resolveCover({
    type: 'brief', stockOnly: true, title: sections.title,
    unsplashQuery: sections.coverQuery, fallbackQueries: cfg.coverPool, avoid: recentCovers,
  });
  const qa = await runQa({ title: sections.title, body });
  console.log(`[agent] ${cfg.region} report: ${body.length} chars | cover: ${cover.source} | QA: ${qa.status}`);
  if (DRY) { console.log(`[DRY] ${cfg.category} report "${sections.title}"`); return true; }

  await publishToNotion(
    {
      title: sections.title, slug, excerpt: sections.excerpt, category: cfg.category,
      tags: dedupeTags([...(sections.tags ?? []), cfg.regionTag, 'TWM News']),
      body, coverQuery: sections.coverQuery, sourceUrl: news[0]?.url ?? '', sourceName: news[0]?.source ?? '',
    },
    cover.url,
    { contentType: CONTENT_TYPE as any, qa: qa.status, qaNotes: qa.notes },
  );
  if (cover.url) recentCovers.add(cover.url);
  console.log(`[agent] ${cfg.category} report draft created.`);
  return true;
}

async function main() {
  const posts = await loadPosts();
  const done = reportsDoneToday(posts);
  const todo = FORCE ? REGIONS : REGIONS.filter((r) => !done.has(r.category));
  console.log(`[agent] reports done today: [${[...done].join(', ') || 'none'}]${FORCE ? ' (FORCE: regenerating anyway)' : ''} — to produce: [${todo.map((t) => t.category).join(', ') || 'none'}]`);
  if (!todo.length) { console.log('[agent] both reports already drafted today — nothing to do.'); return; }

  const buckets = await discoverByRegion();
  console.log(`[agent] discovered india=${buckets.india.length} us=${buckets.us.length}`);
  const existing: ExistingPost[] = posts
    .filter((p) => p.status === 'Published' && p.title && p.slug)
    .map((p) => ({ title: p.title, slug: p.slug, tags: p.tags, excerpt: p.excerpt }));
  const recentCovers = await recentCoverUrls();

  for (const cfg of todo) {
    try {
      await makeReport(cfg, buckets[cfg.region], existing, recentCovers);
    } catch (e) {
      console.error(`[agent] ${cfg.category} failed:`, e);
    }
  }
  console.log('[agent] run complete.');
}

main().catch((e) => { console.error(e); process.exit(1); });
