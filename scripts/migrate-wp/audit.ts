/**
 * Audit migrated content fidelity.
 *
 *   npm run audit
 *
 * For each published WordPress post, compares the original against the
 * Notion-pulled MDX in src/content/posts/notion/ and flags shortfalls:
 *   - body text length (ratio of pulled / original)
 *   - number of tables
 *   - number of images
 * Run AFTER `npm run build` (so the Notion MDX exists on disk).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseWxr, type WpPost } from './parse-wxr.ts';
import { slugify } from './slugify.ts';

const XML = 'thewealthymonk.WordPress.2026-06-24.xml';
const DIR = 'src/content/posts/notion';
const TEXT_RATIO_MIN = 0.85;

function postSlug(p: WpPost): string {
  if (p.slug) return p.slug;
  try {
    const seg = new URL(p.link).pathname.split('/').filter(Boolean).pop();
    if (seg) return seg;
  } catch { /* */ }
  return slugify(p.title);
}

function plain(s: string): string {
  return s
    .replace(/^---[\s\S]*?---/, '')        // frontmatter
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`~|]/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

const { posts } = parseWxr(readFileSync(XML, 'utf8'));
const published = posts.filter((p) => p.status === 'publish');

type Row = {
  slug: string; origChars: number; pulledChars: number; ratio: number;
  origTables: number; pulledTables: number; origImgs: number; pulledImgs: number;
  flags: string[];
};
const rows: Row[] = [];

for (const p of published) {
  const slug = postSlug(p);
  const file = join(DIR, `${slug}.mdx`);
  const flags: string[] = [];

  if (!existsSync(file)) {
    rows.push({ slug, origChars: plain(p.html).length, pulledChars: 0, ratio: 0,
      origTables: count(p.html, /<table/gi), pulledTables: 0,
      origImgs: count(p.html, /<img/gi), pulledImgs: 0, flags: ['MISSING from build'] });
    continue;
  }

  const mdx = readFileSync(file, 'utf8');
  const origChars = plain(p.html).length;
  const pulledChars = plain(mdx).length;
  const ratio = origChars ? pulledChars / origChars : 1;
  const origTables = count(p.html, /<table/gi);
  const pulledTables = count(mdx, /<table/gi);
  const origImgs = count(p.html, /<img/gi) + (p.featuredUrl ? 1 : 0);
  const pulledImgs = count(mdx, /\/img\/generated\//g);

  if (ratio < TEXT_RATIO_MIN) flags.push(`text ${(ratio * 100).toFixed(0)}% of original`);
  if (pulledTables < origTables) flags.push(`tables ${pulledTables}/${origTables}`);
  if (origImgs > 0 && pulledImgs === 0) flags.push(`images ${pulledImgs}/${origImgs}`);

  rows.push({ slug, origChars, pulledChars, ratio, origTables, pulledTables, origImgs, pulledImgs, flags });
}

const flagged = rows.filter((r) => r.flags.length);
console.log(`Audited ${rows.length} posts. ${flagged.length} flagged.\n`);
if (flagged.length) {
  for (const r of flagged) {
    console.log(`⚠ ${r.slug}`);
    console.log(`    chars ${r.pulledChars}/${r.origChars} (${(r.ratio * 100).toFixed(0)}%), tables ${r.pulledTables}/${r.origTables}, imgs ${r.pulledImgs}/${r.origImgs}`);
    console.log(`    → ${r.flags.join('; ')}`);
  }
} else {
  console.log('✓ No loose ends — every post is full-fidelity.');
}
console.log('\nLowest text ratios:');
[...rows].sort((a, b) => a.ratio - b.ratio).slice(0, 5).forEach((r) =>
  console.log(`  ${(r.ratio * 100).toFixed(0)}%  ${r.slug}`));
