import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ── Sitemap data, computed from generated/migrated post frontmatter ──────────
// We parse the post MDX (written before astro build) to:
//   1. give each post a real <lastmod> (its publish date), and
//   2. count how many posts use each tag, so we can drop thin single-post tag
//      pages from the sitemap (they waste crawl budget and won't get indexed).
const POSTS_DIR = 'src/content/posts/notion';
const BUILD_DATE = new Date().toISOString();

function slugifyTag(tag) {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const postLastmod = new Map(); // "/posts/<slug>/" -> ISO date
const tagCounts = new Map(); // tagSlug -> number of posts

try {
  for (const file of readdirSync(POSTS_DIR)) {
    if (!/\.mdx?$/.test(file)) continue;
    const raw = readFileSync(join(POSTS_DIR, file), 'utf8');
    const fm = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) continue;
    const block = fm[1];

    const slug = (block.match(/^slug:\s*"?([^"\n]+?)"?\s*$/m)?.[1] ?? file.replace(/\.mdx?$/, '')).trim();
    const dateRaw = (
      block.match(/^publishDate:\s*"?([^"\n]+?)"?\s*$/m)?.[1] ??
      block.match(/^originalDate:\s*"?([^"\n]+?)"?\s*$/m)?.[1] ??
      ''
    ).trim();
    const d = dateRaw ? new Date(dateRaw) : null;
    if (slug && d && !Number.isNaN(d.getTime())) postLastmod.set(`/posts/${slug}/`, d.toISOString());

    const tagsBlock = block.match(/^tags:\n((?:[ \t]*-[ \t]*.+\n?)+)/m);
    if (tagsBlock) {
      for (const line of tagsBlock[1].split('\n')) {
        const t = line.match(/-[ \t]*"?([^"\n]+?)"?\s*$/);
        if (t) {
          const ts = slugifyTag(t[1].trim());
          if (ts) tagCounts.set(ts, (tagCounts.get(ts) ?? 0) + 1);
        }
      }
    }
  }
} catch {
  // Content not generated yet — fall back to permissive behaviour below.
}

export default defineConfig({
  site: 'https://wealthymonk.org',
  integrations: [
    mdx(),
    sitemap({
      filter: (page) => {
        const p = new URL(page).pathname;
        if (p === '/search/' || p === '/archive/') return false;
        const m = p.match(/^\/tags\/([^/]+)\/?$/);
        if (m) {
          if (tagCounts.size === 0) return true;
          return (tagCounts.get(m[1]) ?? 0) >= 2;
        }
        return true;
      },
      serialize: (item) => {
        const p = new URL(item.url).pathname;
        item.lastmod = postLastmod.get(p) ?? BUILD_DATE;
        return item;
      },
    }),
  ],
  markdown: {
    shikiConfig: { theme: 'github-light' },
  },
});
