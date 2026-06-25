/**
 * One-time push of the WordPress export into the Notion "Posts" database.
 *
 *   npm run push:notion              # create missing posts in Notion
 *   npm run push:notion -- --dry-run # report what would be created
 *
 * Idempotent: skips any post whose Slug already exists in the database, so
 * re-running never duplicates. Needs NOTION_TOKEN + NOTION_DATABASE_ID and the
 * integration's "Insert content" capability.
 */
import { readFileSync } from 'node:fs';
import { Client, isFullPage } from '@notionhq/client';
import { parseWxr, type WpPost } from './parse-wxr.ts';
import { mapCategory, toTags } from './map-category.ts';
import { detectSeries } from './series.ts';
import { slugify } from './slugify.ts';
import { htmlToBlocks } from './html-to-blocks.ts';

const XML = 'thewealthymonk.WordPress.2026-06-24.xml';
const DB = process.env.NOTION_DATABASE_ID;
const TOKEN = process.env.NOTION_TOKEN;

if (!TOKEN || !DB) {
  console.error('Set NOTION_TOKEN and NOTION_DATABASE_ID (in .env).');
  process.exit(1);
}
const notion = new Client({ auth: TOKEN });
const dryRun = process.argv.includes('--dry-run');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function backoff<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const status = err?.status ?? err?.code;
    if (![429, 409, 502, 503, 504].includes(status) || attempt >= 5) throw err;
    await sleep(Math.min(1000 * 2 ** attempt, 16000));
    return backoff(fn, attempt + 1);
  }
}

function postSlug(p: WpPost): string {
  if (p.slug) return p.slug;
  try {
    const seg = new URL(p.link).pathname.split('/').filter(Boolean).pop();
    if (seg) return seg;
  } catch { /* fall through */ }
  return slugify(p.title);
}

function deriveExcerpt(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= 160) return text;
  const cut = text.slice(0, 160);
  const sp = cut.lastIndexOf(' ');
  return (sp > 80 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}

// Notion select/multi-select option names may not contain commas.
function optName(s: string): string {
  return s.replace(/,/g, ' ').trim().slice(0, 100);
}

async function existingSlugs(): Promise<Set<string>> {
  const slugs = new Set<string>();
  let cursor: string | undefined;
  do {
    const res = await backoff(() =>
      notion.databases.query({ database_id: DB!, start_cursor: cursor, page_size: 100 }),
    );
    for (const page of res.results) {
      if (!isFullPage(page)) continue;
      const slug = (page.properties as any).Slug?.rich_text?.[0]?.plain_text;
      if (slug) slugs.add(slug);
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return slugs;
}

async function main() {
  const { posts } = parseWxr(readFileSync(XML, 'utf8'));
  const published = posts.filter((p) => p.status === 'publish');

  const existing = dryRun ? new Set<string>() : await existingSlugs();
  console.log(`${published.length} published posts; ${existing.size} already in Notion.`);

  let created = 0;
  let skipped = 0;
  const warnings: string[] = [];

  for (const p of published) {
    const slug = postSlug(p);
    if (existing.has(slug)) {
      skipped++;
      continue;
    }

    const category = mapCategory(p.categories);
    const tags = Array.from(new Set([...toTags(p.categories), ...p.tags])).map(optName).filter(Boolean);
    const series = detectSeries(p.title, p.categories);
    const wpEx = p.excerpt ? deriveExcerpt(p.excerpt) : '';
    const excerpt = wpEx || deriveExcerpt(p.html);

    const { blocks, warnings: w } = htmlToBlocks(p.html);
    warnings.push(...w.map((m) => `[${slug}] ${m}`));

    const properties: any = {
      Title: { title: [{ text: { content: p.title.slice(0, 2000) } }] },
      Slug: { rich_text: [{ text: { content: slug } }] },
      Status: { select: { name: 'Published' } },
      'Publish Date': { date: { start: p.date.toISOString() } },
      Category: { select: { name: optName(category) } },
      'Original URL': { url: p.link || null },
      'Original Date': { date: { start: p.date.toISOString() } },
    };
    if (tags.length) properties.Tags = { multi_select: tags.map((name) => ({ name })) };
    if (excerpt) properties.Excerpt = { rich_text: [{ text: { content: excerpt.slice(0, 2000) } }] };
    if (series) {
      properties.Series = { select: { name: series.series } };
      properties['Series Order'] = { number: series.seriesOrder };
    }
    if (p.featuredUrl) {
      properties.Cover = { files: [{ type: 'external', name: 'cover', external: { url: p.featuredUrl } }] };
    }

    if (dryRun) {
      console.log(`would create: ${slug}  [${category}${series ? `, ${series.series} #${series.seriesOrder}` : ''}]  ${blocks.length} blocks`);
      created++;
      continue;
    }

    // Create the page with the first 100 blocks, append the rest in batches.
    const first = blocks.slice(0, 100);
    const page = await backoff(() =>
      notion.pages.create({ parent: { database_id: DB! }, properties, children: first }),
    );
    await sleep(350);

    for (let i = 100; i < blocks.length; i += 100) {
      await backoff(() =>
        notion.blocks.children.append({ block_id: (page as any).id, children: blocks.slice(i, i + 100) }),
      );
      await sleep(350);
    }

    created++;
    console.log(`created (${created}): ${slug}  [${category}]  ${blocks.length} blocks`);
  }

  console.log(`\nDone. created: ${created}, skipped (already present): ${skipped}`);
  if (warnings.length) {
    const posts = new Set(warnings.map((w) => w.split(']')[0] + ']'));
    console.log(`\n${warnings.length} conversion note(s) across ${posts.size} post(s) — spot-check these in Notion:`);
    for (const w of warnings.slice(0, 40)) console.log('  - ' + w);
  }
  if (dryRun) console.log('\n(dry run — nothing written to Notion)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
