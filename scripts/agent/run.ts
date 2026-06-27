/**
 * Wealthy Monk content agent — one draft per run, stream chosen from Notion
 * state. Evergreen: next uncovered finance seed topic. News: discover finance
 * stories, dedup by source URL. Both pass QA → Draft in the Posts DB. Nothing
 * auto-publishes.
 *
 * Daily caps (env): AGENT_EVERGREEN_PER_DAY (3), AGENT_NEWS_PER_DAY (7),
 * AGENT_DRY_RUN (log only).
 */
import { Client, isFullPage } from '@notionhq/client';
import { discover } from './discover.js';
import { generatePost, generateEvergreen, type ExistingPost } from './generate.js';
import { resolveCover, resolveInlineImages } from './images.js';
import { existingSourceUrls, publishToNotion } from './publish.js';
import { seedTopics } from './topics.js';
import { chooseStream, pickEvergreenTopic, type DayCounts } from './planner.js';
import { withRetry } from '../lib/notion.js';
import { runQa } from './qa.js';

const EVERGREEN_PER_DAY = Number(process.env.AGENT_EVERGREEN_PER_DAY ?? 3);
const NEWS_PER_DAY = Number(process.env.AGENT_NEWS_PER_DAY ?? 7);
const DRY = !!process.env.AGENT_DRY_RUN;

const notion = new Client({ auth: process.env.NOTION_TOKEN!, fetch: globalThis.fetch });
const DB = process.env.NOTION_DATABASE_ID!;

const plain = (rich: any[] | undefined) => (rich ?? []).map((r) => r.plain_text ?? '').join('');
const todayUtc = () => new Date().toISOString().slice(0, 10);
function slugify(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const t of tags) { const k = t.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(t); } }
  return out;
}

async function loadPosts() {
  const out: { title: string; slug: string; tags: string[]; excerpt?: string; contentType?: string; topicKey?: string; createdDate?: string; status?: string }[] = [];
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
        contentType: pr['Content Type']?.select?.name,
        topicKey: plain(pr['Topic Key']?.rich_text) || undefined,
        status: pr.Status?.select?.name,
        createdDate: pr['Publish Date']?.date?.start,
      });
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}

function dayCounts(posts: Awaited<ReturnType<typeof loadPosts>>): DayCounts {
  const today = todayUtc();
  let evergreen = 0, news = 0;
  for (const p of posts) {
    if (p.createdDate?.slice(0, 10) !== today) continue;
    if (p.contentType === 'Evergreen') evergreen++;
    else if (p.contentType === 'News') news++;
  }
  return { evergreen, news };
}

async function doEvergreen(posts: Awaited<ReturnType<typeof loadPosts>>, existing: ExistingPost[]): Promise<boolean> {
  const covered = new Set(posts.map((p) => p.topicKey).filter(Boolean) as string[]);
  const topic = pickEvergreenTopic(seedTopics(), covered);
  if (!topic) { console.log('[agent] no uncovered evergreen topics left.'); return false; }
  console.log(`[agent] evergreen: ${topic.key} — ${topic.title}`);

  const post = await generateEvergreen(topic, existing);
  const body = await resolveInlineImages(post.body);
  const slug = (post.slug || slugify(post.title)).replace(/[^a-z0-9-]/g, '');
  const cover = await resolveCover({ type: 'evergreen', title: post.title, unsplashQuery: topic.coverQueries[0] ?? post.coverQuery, fallbackQueries: [...topic.coverQueries.slice(1), post.coverQuery] });
  const qa = await runQa({ title: post.title, body });
  console.log(`[agent] cover: ${cover.source} | QA: ${qa.status}`);
  if (DRY) { console.log(`[DRY] evergreen "${post.title}" [${post.category}] ${body.length} chars`); return true; }
  await publishToNotion({ ...post, slug, body, tags: dedupeTags(post.tags) }, cover.url, { contentType: 'Evergreen', topicKey: topic.key, qa: qa.status, qaNotes: qa.notes });
  console.log('[agent] evergreen draft created.');
  return true;
}

async function doNews(posts: Awaited<ReturnType<typeof loadPosts>>, existing: ExistingPost[]): Promise<boolean> {
  const seen = await existingSourceUrls();
  const candidates = (await discover()).filter((c) => !seen.has(c.url));
  if (!candidates.length) { console.log('[agent] no fresh news candidates.'); return false; }
  const candidate = candidates[0];
  console.log(`[agent] news: ${candidate.title}`);

  const post = await generatePost(candidate, existing);
  const body = await resolveInlineImages(post.body);
  const slug = (post.slug || slugify(post.title)).replace(/[^a-z0-9-]/g, '');
  const cover = await resolveCover({ type: 'news', title: post.title, unsplashQuery: post.coverQuery, candidateImageUrl: candidate.imageUrl, candidateUrl: candidate.url, fallbackQueries: [post.tags[0]].filter(Boolean) as string[] });
  const qa = await runQa({ title: post.title, body, sourceSummary: candidate.summary });
  console.log(`[agent] cover: ${cover.source} | QA: ${qa.status}`);
  if (DRY) { console.log(`[DRY] news "${post.title}" [${post.category}]`); return true; }
  await publishToNotion({ ...post, slug, body, tags: dedupeTags([...post.tags, 'TWM News']) }, cover.url, { contentType: 'News', qa: qa.status, qaNotes: qa.notes });
  console.log('[agent] news draft created.');
  return true;
}

async function main() {
  const posts = await loadPosts();
  const counts = dayCounts(posts);
  const quota = { evergreen: EVERGREEN_PER_DAY, news: NEWS_PER_DAY };
  console.log(`[agent] today: ${counts.evergreen} evergreen / ${counts.news} news (caps ${EVERGREEN_PER_DAY}/${NEWS_PER_DAY})`);

  if (counts.evergreen + counts.news >= EVERGREEN_PER_DAY + NEWS_PER_DAY) {
    console.log('[agent] daily total reached — nothing to do.'); return;
  }

  const existing: ExistingPost[] = posts
    .filter((p) => p.status === 'Published' && p.title && p.slug)
    .map((p) => ({ title: p.title, slug: p.slug, tags: p.tags, excerpt: p.excerpt }));

  const preferred = chooseStream(counts, quota) ?? 'news';
  const order = preferred === 'evergreen' ? ['evergreen', 'news'] : ['news', 'evergreen'];
  console.log(`[agent] preferred: ${preferred}`);
  const run: Record<string, () => Promise<boolean>> = {
    evergreen: () => doEvergreen(posts, existing),
    news: () => doNews(posts, existing),
  };
  for (const s of order) {
    if (await run[s]()) return;
    console.log(`[agent] ${s} produced nothing — trying fallback.`);
  }
  console.log('[agent] nothing to produce this run.');
}

main().catch((e) => { console.error(e); process.exit(1); });
