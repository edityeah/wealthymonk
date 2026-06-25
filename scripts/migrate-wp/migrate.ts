/**
 * One-time WordPress -> MDX migration.
 *
 *   npm run migrate
 *
 * Reads the WXR export, downloads images into public/img/, and writes local
 * MDX into src/content/posts/notion/ (posts) and src/content/pages/ (legal
 * pages), plus public/_redirects. Review the output before pushing to Notion.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseWxr, type WpPost } from './parse-wxr.ts';
import { mapCategory, toTags } from './map-category.ts';
import { detectSeries } from './series.ts';
import { htmlToMdx } from './html-to-mdx.ts';
import { buildRedirects } from './redirects.ts';
import { slugify } from './slugify.ts';

const XML = 'thewealthymonk.WordPress.2026-06-24.xml';
const POSTS_DIR = 'src/content/posts/imported';
const PAGES_DIR = 'src/content/pages';
const IMG_DIR = 'public/img';

// WP pages that become site features/templates, not content pages.
const SKIP_PAGES = new Set([
  'home', 'invest-ed', 'introduction-to-stock-markets', 'stock-market',
]);
const FOOTER_PAGES = new Set(['privacy-policy', 'about', 'contact', 'terms-and-conditions', 'disclaimer']);

function yamlString(s: string): string {
  return JSON.stringify(s ?? '');
}

function postSlug(p: WpPost): string {
  if (p.slug) return p.slug;
  try {
    const seg = new URL(p.link).pathname.split('/').filter(Boolean).pop();
    if (seg) return seg;
  } catch { /* fall through */ }
  return slugify(p.title);
}

// Derive a clean ~160-char meta description from anywhere in the body text.
// Robust to posts that open with a table, image, or heading (no leading <p>).
function deriveExcerpt(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/\[[^\]]*\]/g, '') // drop shortcodes
    .replace(/<[^>]+>/g, ' ')   // strip tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length <= 160) return text;
  const cut = text.slice(0, 160);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

async function downloadImage(url: string, destDir: string): Promise<string | null> {
  let name = basename(url.split('?')[0]);
  if (!name) return null;
  name = decodeURIComponent(name);
  const dest = join(destDir, name);
  const publicPath = `/img/${name}`;
  if (existsSync(dest)) return publicPath;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  ! image ${res.status}: ${url}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    return publicPath;
  } catch (err) {
    console.warn(`  ! image failed: ${url} (${(err as Error).message})`);
    return null;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  mkdirSync(POSTS_DIR, { recursive: true });
  mkdirSync(PAGES_DIR, { recursive: true });
  mkdirSync(IMG_DIR, { recursive: true });

  const { posts, pages, attachments } = parseWxr(readFileSync(XML, 'utf8'));
  const published = posts.filter((p) => p.status === 'publish');
  console.log(`Parsed: ${posts.length} posts (${published.length} published), ${pages.length} pages, ${attachments.length} attachments`);

  // ── Build the URL -> local path image map ────────────────────────────────
  // Collect every uploads URL referenced (attachments + featured + inline img).
  const urls = new Set<string>();
  for (const a of attachments) urls.add(a.url);
  for (const p of published) {
    if (p.featuredUrl) urls.add(p.featuredUrl);
    for (const m of p.html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) urls.add(m[1]);
  }

  const urlMap = new Map<string, string>();
  let downloaded = 0;
  if (!dryRun) {
    console.log(`Downloading up to ${urls.size} images...`);
    for (const url of urls) {
      if (!/^https?:\/\//.test(url)) continue;
      const local = await downloadImage(url, IMG_DIR);
      if (local) {
        urlMap.set(url, local);
        urlMap.set(basename(url.split('?')[0]), local);
        downloaded++;
      }
    }
  }

  // ── Posts ─────────────────────────────────────────────────────────────────
  const redirectItems: { link: string; newPath: string }[] = [];
  const catCount: Record<string, number> = {};
  let chapters = 0;

  for (const p of published) {
    const slug = postSlug(p);
    const category = mapCategory(p.categories);
    catCount[category] = (catCount[category] ?? 0) + 1;
    const tags = Array.from(new Set([...toTags(p.categories), ...p.tags]));
    const series = detectSeries(p.title, p.categories);
    if (series) chapters++;
    const wpExcerpt = p.excerpt ? deriveExcerpt(p.excerpt) : '';
    const excerpt = wpExcerpt || deriveExcerpt(p.html);
    const cover = p.featuredUrl ? urlMap.get(p.featuredUrl) : undefined;
    const body = htmlToMdx(p.html, urlMap);

    const fm: string[] = [
      '---',
      `title: ${yamlString(p.title)}`,
      `slug: ${yamlString(slug)}`,
      `publishDate: ${p.date.toISOString()}`,
      `category: ${yamlString(category)}`,
    ];
    if (tags.length) {
      fm.push('tags:');
      for (const t of tags) fm.push(`  - ${yamlString(t)}`);
    }
    if (series) {
      fm.push(`series: ${yamlString(series.series)}`);
      fm.push(`seriesOrder: ${series.seriesOrder}`);
    }
    if (cover) fm.push(`cover: ${yamlString(cover)}`);
    if (excerpt) fm.push(`excerpt: ${yamlString(excerpt)}`);
    fm.push(`originalUrl: ${yamlString(p.link)}`);
    fm.push(`originalDate: ${p.date.toISOString()}`);
    fm.push('---', '');

    if (!dryRun) writeFileSync(join(POSTS_DIR, `${slug}.mdx`), fm.join('\n') + body);
    redirectItems.push({ link: p.link, newPath: `/posts/${slug}/` });
  }

  // ── Pages ───────────────────────────────────────────────────────────────────
  let pageCount = 0;
  for (const pg of pages) {
    if (pg.status !== 'publish') continue;
    const slug = pg.slug || slugify(pg.title);
    if (SKIP_PAGES.has(slug)) continue;
    const body = htmlToMdx(pg.html, urlMap);
    const fm = [
      '---',
      `title: ${yamlString(pg.title)}`,
      `slug: ${yamlString(slug)}`,
      `showInFooter: ${FOOTER_PAGES.has(slug)}`,
      '---',
      '',
    ].join('\n');
    if (!dryRun) writeFileSync(join(PAGES_DIR, `${slug}.mdx`), fm + body);
    redirectItems.push({ link: pg.link, newPath: `/${slug}/` });
    pageCount++;
  }

  // ── Redirects ─────────────────────────────────────────────────────────────
  const redirects = buildRedirects(redirectItems);
  if (!dryRun) writeFileSync(join('public', '_redirects'), redirects);

  console.log('\nSummary');
  console.log(`  posts written:   ${published.length}`);
  console.log(`  pages written:   ${pageCount}`);
  console.log(`  images saved:    ${downloaded}`);
  console.log(`  InvestED chapters: ${chapters}`);
  console.log(`  redirect rules:  ${redirects.split('\n').filter(Boolean).length}`);
  console.log('  category distribution:', catCount);
  if (dryRun) console.log('\n(dry run — no files written)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
