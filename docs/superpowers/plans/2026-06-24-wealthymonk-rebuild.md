# Wealthy Monk Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `wealthymonk.org` as a static Astro site (content from Notion, hosted on Cloudflare Pages), migrating all 46 posts + 9 pages + 182 images from WordPress, with a first-class InvestED course and 6 consolidated categories.

**Architecture:** Adapt the proven Geo-Traveller codebase at `/Users/adityeahspare/Documents/Geo-Traveller`. Astro 5 + MDX content collections; a build-time script pulls Published posts from Notion and mirrors images; Pagefind search; deployed to Cloudflare Pages. Travel features (map, geo) are removed; an ordered Series content type is added. A one-time WordPress XML importer produces local MDX for review, then optionally pushes to Notion.

**Tech Stack:** Astro 5, MDX, TypeScript, `fast-xml-parser`, `cheerio`, `reading-time`, Pagefind, `@notionhq/client`, Wrangler (Cloudflare Pages). Tests via `node --test` + `tsx`.

**Reference:** `GT=/Users/adityeahspare/Documents/Geo-Traveller`. "Adapt from `GT/...`" means copy that file and modify per the step; do not blind-copy travel-specific code.

---

## File Structure

```
src/
  content.config.ts          # collections: posts (+ series fields), pages
  content/
    posts/                    # seed posts (committed)
      notion/                 # Notion/migrated MDX (gitignored)
    pages/                    # about, contact, disclaimer, privacy, terms (mdx)
  layouts/Base.astro          # site shell, light/dark, finance theme
  components/
    SiteNav.astro             # nav: Home, InvestED, categories, About
    PostCard.astro            # post teaser card
    PostBody.astro            # article body wrapper (prose + tables)
    SeriesNav.astro           # prev/next chapter nav (NEW)
    CategoryChips.astro       # category/tag chips
    Disclaimer.astro          # finance disclaimer callout
    TableOfContents.astro     # adapted from GT
  lib/
    posts.ts                  # post/series/category helpers
    categories.ts             # category constants + slugify (NEW)
    seo.ts                    # meta helpers
  pages/
    index.astro               # home: featured + recent
    posts/[slug].astro        # post page
    invested/index.astro      # course landing (NEW)
    category/[category].astro  # category pages (NEW)
    tags/[tag].astro          # tag pages
    archive.astro
    search.astro
    [slug].astro              # static pages (about etc.)
    404.astro
    rss.xml.ts
  styles/global.css           # finance design tokens
scripts/
  build-content.ts            # Notion -> MDX (adapt from GT)
  lib/{notion,blocks-to-mdx,image-mirror}.ts  # adapt from GT
  migrate-wp/
    parse-wxr.ts              # WXR XML -> structured records
    map-category.ts           # 21 -> 6 mapping + precedence (NEW)
    series.ts                 # detect InvestED chapter + order (NEW)
    slugify.ts                # shared slug helper
    html-to-mdx.ts            # post HTML -> MDX (adapt from GT html-to-blocks)
    redirects.ts              # build _redirects entries
    migrate.ts                # orchestrator -> writes local MDX + _redirects
    *.test.ts                 # unit tests
public/
  _redirects                  # old WP permalinks -> new
  img/                        # migrated images (committed) + generated/ (gitignored)
  robots.txt
astro.config.mjs              # site url, mdx, sitemap (no map)
package.json, tsconfig.json, .nvmrc, .env.example, README.md
```

---

## Phase 1 — Skeleton

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `.nvmrc`, `astro.config.mjs`, `.env.example`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "wealthy-monk",
  "type": "module",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "astro dev",
    "build:content": "tsx --env-file-if-exists=.env scripts/build-content.ts",
    "build:search": "pagefind --site dist",
    "build": "npm run build:content && astro build && npm run build:search",
    "migrate": "tsx --env-file-if-exists=.env scripts/migrate-wp/migrate.ts",
    "test": "node --import tsx --test scripts/migrate-wp/*.test.ts",
    "deploy": "npm run build && wrangler pages deploy dist --project-name=wealthy-monk --branch=main",
    "preview": "astro preview",
    "typecheck": "astro check"
  },
  "dependencies": {
    "@astrojs/mdx": "^4.0.0",
    "@astrojs/rss": "^4.0.0",
    "@astrojs/sitemap": "^3.2.0",
    "@fontsource/inter": "^5.2.8",
    "@fontsource/source-serif-4": "^5.2.9",
    "@notionhq/client": "^2.2.15",
    "astro": "^5.0.0",
    "cheerio": "^1.2.0",
    "fast-xml-parser": "^5.8.0",
    "pagefind": "^1.5.2",
    "reading-time": "^1.5.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "wrangler": "^4.98.0"
  }
}
```

- [ ] **Step 2: Create `.nvmrc`** — content: `22`
- [ ] **Step 3: Create `tsconfig.json`** (copy `GT/tsconfig.json` verbatim — it extends astro/tsconfigs/strict).
- [ ] **Step 4: Create `.env.example`**

```
# Notion (optional for local dev; required for live publishing)
NOTION_TOKEN=
NOTION_DATABASE_ID=
# Optional integrations (all off if blank)
PUBLIC_CFA_TOKEN=
PUBLIC_GISCUS_REPO=
PUBLIC_GISCUS_REPO_ID=
PUBLIC_GISCUS_CATEGORY=
PUBLIC_GISCUS_CATEGORY_ID=
PUBLIC_BUTTONDOWN_USER=
```

- [ ] **Step 5: Create `astro.config.mjs`** — adapt from `GT/astro.config.mjs`: keep the sitemap lastmod/tag-count logic, change `site` to `https://wealthymonk.org`, keep `mdx()`, keep shiki `github-light`. Remove nothing else.
- [ ] **Step 6: Install and verify**

Run: `npm install --cache /tmp/npm-cache-wm`
Expected: completes without error (use the temp cache to avoid the EEXIST issue noted in GT README).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: scaffold Astro project"
```

### Task 2: Content schema

**Files:**
- Create: `src/content.config.ts`

- [ ] **Step 1: Write the schema** (adapt from `GT/src/content.config.ts`; drop `locationName/lat/lng`, add `category`, `series`, `seriesOrder`)

```ts
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    slug: z.string().optional(),
    publishDate: z.coerce.date(),
    category: z.string().optional(),
    tags: z.array(z.string()).default([]),
    series: z.string().optional(),
    seriesOrder: z.number().optional(),
    cover: z.string().optional(),
    excerpt: z.string().optional(),
    originalUrl: z.string().optional(),
    originalDate: z.coerce.date().optional(),
    draft: z.boolean().default(false),
  }),
});

const pages = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    description: z.string().optional(),
    showInFooter: z.boolean().default(false),
  }),
});

export const collections = { posts, pages };
```

- [ ] **Step 2: Create one seed post** `src/content/posts/welcome.mdx` with valid frontmatter (title, publishDate, category "Investing & Valuation", excerpt, a short body) so the site builds before migration.
- [ ] **Step 3: Verify** — `npm run dev` then load `http://localhost:4321` is deferred to Task 5; for now `npx astro check` must pass with no content errors.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: content schema with series + category"`

### Task 3: Category constants + slugify (TDD)

**Files:**
- Create: `scripts/migrate-wp/slugify.ts`, `src/lib/categories.ts`
- Test: `scripts/migrate-wp/slugify.test.ts`

- [ ] **Step 1: Write failing test** `scripts/migrate-wp/slugify.test.ts`

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from './slugify.ts';

test('slugify lowercases and dashes', () => {
  assert.equal(slugify('US Stock Market'), 'us-stock-market');
});
test('slugify strips punctuation and apostrophes', () => {
  assert.equal(slugify("Beginner's Guide!"), 'beginners-guide');
});
test('slugify collapses repeats and trims dashes', () => {
  assert.equal(slugify('  Tax & Savings  '), 'tax-savings');
});
```

- [ ] **Step 2: Run, verify fail** — `npm test` → FAIL (module not found).
- [ ] **Step 3: Implement** `scripts/migrate-wp/slugify.ts`

```ts
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```

- [ ] **Step 4: Run, verify pass** — `npm test` → PASS.
- [ ] **Step 5: Create `src/lib/categories.ts`** (the canonical 6 + display order; re-export slugify logic for site use)

```ts
export const CATEGORIES = [
  'Indian Markets',
  'US Markets',
  'Investing & Valuation',
  'Crypto',
  'Insurance',
  'Personal Finance & Tax',
] as const;
export type Category = (typeof CATEGORIES)[number];

export function slugifyTag(input: string): string {
  return input.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
```

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: slugify + category constants"`

---

## Phase 2 — Migration logic (TDD)

### Task 4: Category mapping + precedence (TDD)

**Files:**
- Create: `scripts/migrate-wp/map-category.ts`
- Test: `scripts/migrate-wp/map-category.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapCategory, toTags } from './map-category.ts';

test('insurance wins over markets by precedence', () => {
  assert.equal(mapCategory(['Health Insurance', 'US Stock Market']), 'Insurance');
});
test('indian stock market maps to Indian Markets', () => {
  assert.equal(mapCategory(['Indian Stock Market', 'Investing']), 'Indian Markets');
});
test('generic Stock Market falls to Investing & Valuation', () => {
  assert.equal(mapCategory(['Stock Market']), 'Investing & Valuation');
});
test('crypto wins over investing', () => {
  assert.equal(mapCategory(['Crypto Currency', 'Investing']), 'Crypto');
});
test('tax maps to Personal Finance & Tax', () => {
  assert.equal(mapCategory(['Tax Savings', 'Tools']), 'Personal Finance & Tax');
});
test('unknown only -> Investing & Valuation default', () => {
  assert.equal(mapCategory(['TWM News']), 'Investing & Valuation');
});
test('toTags keeps original cats as tags, drops series cats', () => {
  assert.deepEqual(
    toTags(['Introduction to Stock Markets', 'InvestED', 'Investing']),
    ['Investing'],
  );
});
```

- [ ] **Step 2: Run, verify fail** — `npm test` → FAIL.
- [ ] **Step 3: Implement** `scripts/migrate-wp/map-category.ts`

```ts
import type { Category } from '../../src/lib/categories.ts';

// Original WP category -> consolidated category.
const MAP: Record<string, Category> = {
  'Indian Stock Market': 'Indian Markets',
  'US Stock Market': 'US Markets',
  'Investing': 'Investing & Valuation',
  'Investments': 'Investing & Valuation',
  'Fundamental Analysis': 'Investing & Valuation',
  'Stock Market': 'Investing & Valuation',
  'Crypto Currency': 'Crypto',
  'Insurance': 'Insurance',
  'Health Insurance': 'Insurance',
  'Home Insurance': 'Insurance',
  'Motor Insurance': 'Insurance',
  'Pet Insurance': 'Insurance',
  'Travel Insurance': 'Insurance',
  'Senior Health Care': 'Insurance',
  'Tax Savings': 'Personal Finance & Tax',
};

// Higher index = higher priority when a post has several categories.
const PRECEDENCE: Category[] = [
  'Personal Finance & Tax',
  'Investing & Valuation',
  'Indian Markets',
  'US Markets',
  'Crypto',
  'Insurance',
];

// Categories that exist only as the InvestED series, never as tags/cats.
const SERIES_CATS = new Set(['InvestED', 'Introduction to Stock Markets']);

export function mapCategory(wpCats: string[]): Category {
  const mapped = wpCats.map((c) => MAP[c]).filter(Boolean) as Category[];
  if (mapped.length === 0) return 'Investing & Valuation';
  return mapped.sort((a, b) => PRECEDENCE.indexOf(b) - PRECEDENCE.indexOf(a))[0];
}

export function toTags(wpCats: string[]): string[] {
  return wpCats.filter((c) => !SERIES_CATS.has(c));
}
```

- [ ] **Step 4: Run, verify pass** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: category mapping with precedence"`

### Task 5: InvestED series detection (TDD)

**Files:**
- Create: `scripts/migrate-wp/series.ts`
- Test: `scripts/migrate-wp/series.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSeries } from './series.ts';

test('detects InvestED chapter from category + title', () => {
  const r = detectSeries('Chapter 1: Why should anyone invest?', ['InvestED', 'Introduction to Stock Markets']);
  assert.deepEqual(r, { series: 'InvestED', seriesOrder: 1 });
});
test('parses chapter number with trailing dot', () => {
  const r = detectSeries('Chapter 3. Market Intermediaries', ['Introduction to Stock Markets']);
  assert.deepEqual(r, { series: 'InvestED', seriesOrder: 3 });
});
test('handles Part suffix using the chapter number', () => {
  const r = detectSeries('Chapter 4. The IPO Markets (Part 1)', ['InvestED']);
  assert.deepEqual(r, { series: 'InvestED', seriesOrder: 4 });
});
test('non-course post returns null', () => {
  assert.equal(detectSeries('Best Crypto Exchanges', ['Crypto Currency']), null);
});
```

- [ ] **Step 2: Run, verify fail** — `npm test` → FAIL.
- [ ] **Step 3: Implement** `scripts/migrate-wp/series.ts`

```ts
const SERIES_CATS = new Set(['InvestED', 'Introduction to Stock Markets']);

export function detectSeries(
  title: string,
  wpCats: string[],
): { series: 'InvestED'; seriesOrder: number } | null {
  const inSeries = wpCats.some((c) => SERIES_CATS.has(c));
  if (!inSeries) return null;
  const m = title.match(/Chapter\s+(\d+)/i);
  const seriesOrder = m ? Number(m[1]) : 0;
  return { series: 'InvestED', seriesOrder };
}
```

- [ ] **Step 4: Run, verify pass** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: InvestED series detection"`

### Task 6: WXR parser (TDD)

**Files:**
- Create: `scripts/migrate-wp/parse-wxr.ts`
- Test: `scripts/migrate-wp/parse-wxr.test.ts`, fixture `scripts/migrate-wp/fixture.xml`

- [ ] **Step 1: Create a small fixture** `scripts/migrate-wp/fixture.xml` — a minimal valid WXR with one `post` item (title "Chapter 1: Why should anyone invest?", a `wp:post_date`, two `category domain="category"` entries `InvestED` + `Introduction to Stock Markets`, a `content:encoded` body, a `link`), one `page` item (About), and one `attachment` item (an image `wp:attachment_url`). Use the real export's structure as a template (see `thewealthymonk.WordPress.2026-06-24.xml`).
- [ ] **Step 2: Write failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWxr } from './parse-wxr.ts';
import { readFileSync } from 'node:fs';

const xml = readFileSync(new URL('./fixture.xml', import.meta.url), 'utf8');
const parsed = parseWxr(xml);

test('separates posts, pages, attachments', () => {
  assert.equal(parsed.posts.length, 1);
  assert.equal(parsed.pages.length, 1);
  assert.equal(parsed.attachments.length, 1);
});
test('post carries title, date, link, categories, html', () => {
  const p = parsed.posts[0];
  assert.match(p.title, /Chapter 1/);
  assert.ok(p.date instanceof Date);
  assert.ok(p.link.startsWith('http'));
  assert.ok(p.categories.includes('InvestED'));
  assert.ok(p.html.length > 0);
});
```

- [ ] **Step 3: Run, verify fail** — `npm test` → FAIL.
- [ ] **Step 4: Implement** `scripts/migrate-wp/parse-wxr.ts` using `fast-xml-parser` (adapt from `GT/scripts/migrate-wp/parse-wxr.ts`). Export `parseWxr(xml: string): { posts: WpPost[]; pages: WpPage[]; attachments: WpAttachment[] }` where `WpPost = { title; slug; date: Date; link: string; html: string; excerpt?: string; categories: string[]; tags: string[]; status: string; featuredId?: string }`. Map `wp:post_type` to the three buckets; pull `category domain="category"` vs `domain="post_tag"`; parse `wp:post_date` to Date; read `content:encoded` into `html`.
- [ ] **Step 5: Run, verify pass** — `npm test` → PASS.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: WXR parser"`

### Task 7: Redirects builder (TDD)

**Files:**
- Create: `scripts/migrate-wp/redirects.ts`
- Test: `scripts/migrate-wp/redirects.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRedirects } from './redirects.ts';

test('maps old permalink path to new post path', () => {
  const out = buildRedirects([
    { link: 'https://wealthymonk.org/chapter-1-why-invest/', newPath: '/posts/chapter-1-why-invest/' },
  ]);
  assert.equal(out.trim(), '/chapter-1-why-invest/  /posts/chapter-1-why-invest/  301');
});
test('skips entries whose old and new paths are equal', () => {
  const out = buildRedirects([{ link: 'https://wealthymonk.org/x/', newPath: '/x/' }]);
  assert.equal(out.trim(), '');
});
```

- [ ] **Step 2: Run, verify fail** — `npm test` → FAIL.
- [ ] **Step 3: Implement** `scripts/migrate-wp/redirects.ts`

```ts
export function buildRedirects(items: { link: string; newPath: string }[]): string {
  const lines: string[] = [];
  for (const { link, newPath } of items) {
    let oldPath: string;
    try { oldPath = new URL(link).pathname; } catch { continue; }
    if (!oldPath.endsWith('/')) oldPath += '/';
    if (oldPath === newPath) continue;
    lines.push(`${oldPath}  ${newPath}  301`);
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}
```

- [ ] **Step 4: Run, verify pass** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: redirects builder"`

### Task 8: HTML → MDX converter

**Files:**
- Create: `scripts/migrate-wp/html-to-mdx.ts`
- Test: `scripts/migrate-wp/html-to-mdx.test.ts`

- [ ] **Step 1: Write failing test** — assert it (a) strips WordPress block comments `<!-- wp:* -->`, (b) converts `<h2>`, `<p>`, `<ul>/<li>`, `<table>` to Markdown/retained HTML, (c) rewrites `<img src>` to the local `/img/...` path given a URL→path map, (d) escapes stray `{`/`}` that would break MDX.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToMdx } from './html-to-mdx.ts';

test('strips wp block comments and keeps text', () => {
  const out = htmlToMdx('<!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph -->', new Map());
  assert.match(out, /Hello/);
  assert.doesNotMatch(out, /wp:paragraph/);
});
test('rewrites image src via map', () => {
  const map = new Map([['https://wealthymonk.org/wp-content/uploads/a.png', '/img/a.png']]);
  const out = htmlToMdx('<img src="https://wealthymonk.org/wp-content/uploads/a.png" alt="A">', map);
  assert.match(out, /\/img\/a\.png/);
});
test('escapes curly braces', () => {
  const out = htmlToMdx('<p>Use {this}</p>', new Map());
  assert.doesNotMatch(out, /\{this\}/);
});
```

- [ ] **Step 2: Run, verify fail** — `npm test` → FAIL.
- [ ] **Step 3: Implement** using `cheerio` (adapt from `GT/scripts/migrate-wp/html-to-blocks.ts` + `strip-shortcodes.ts`, but output MDX text rather than Notion blocks). Keep tables as raw HTML (finance posts rely on them); convert headings/paragraphs/lists to Markdown; rewrite `img[src]` through the map; remove `<!-- wp:* -->` comments and known shortcodes; escape `{`/`}`.
- [ ] **Step 4: Run, verify pass** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: html-to-mdx converter"`

### Task 9: Migration orchestrator

**Files:**
- Create: `scripts/migrate-wp/migrate.ts`, `scripts/migrate-wp/README.md`

- [ ] **Step 1: Implement `migrate.ts`** — reads `thewealthymonk.WordPress.2026-06-24.xml`, then:
  1. `parseWxr` → posts/pages/attachments.
  2. Build a URL→local-path map: for each attachment, derive `/img/<basename>` and download the file into `public/img/` (skip if exists). Build map from both attachment URLs and any `wp-content/uploads` URL found in post HTML (basename match).
  3. For each post: compute `slug` (from `link` path or `slugify(title)`), `category = mapCategory(categories)`, `tags = toTags(categories) ∪ wp tags`, `series = detectSeries(...)`, `excerpt` (from `excerpt` or first paragraph), `cover` (featured image local path), and `html → htmlToMdx`. Write `src/content/posts/notion/<slug>.mdx` with full frontmatter + body. Record `{ link, newPath: '/posts/<slug>/' }`.
  4. For pages About/Contact/Disclaimer/Privacy/Terms: write `src/content/pages/<slug>.mdx` (`showInFooter: true` for legal pages). Skip Home/investED/Introduction/Stock Market 101 pages (those become site pages, not content pages).
  5. `buildRedirects(...)` → write `public/_redirects`.
  6. Print a summary: counts written, images downloaded, posts per category, InvestED chapters found.
- [ ] **Step 2: Write `README.md`** documenting `npm run migrate` and that it writes local MDX (review before pushing to Notion).
- [ ] **Step 3: Run migration** — `npm run migrate`
  Expected: 46 post MDX files, ~5 page MDX files, `public/_redirects` populated, images in `public/img/`, summary shows 4 InvestED chapters.
- [ ] **Step 4: Verify** — `npx astro check` passes; spot-check 3 posts (one InvestED chapter, one insurance, one with a table) render correct frontmatter.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: WP migration orchestrator + migrated content"`

---

## Phase 3 — Site templates & design

### Task 10: Base layout + finance theme

**Files:**
- Create: `src/layouts/Base.astro`, `src/styles/global.css`, `src/components/SiteNav.astro`

- [ ] **Step 1: `global.css`** — adapt from `GT/src/styles/global.css`; define finance tokens: `--navy:#0f2233`, `--accent:#1f9d6b` (green), neutrals; light/dark via `prefers-color-scheme` + a `data-theme` toggle; serif headings (Source Serif 4), Inter body; **prominent table styling** (borders, zebra rows, horizontal scroll on small screens).
- [ ] **Step 2: `Base.astro`** — adapt from `GT/src/layouts/Base.astro`: `<head>` SEO/meta, font imports, theme toggle, header with `SiteNav`, footer with legal-page links (from pages where `showInFooter`) + social (FB/IG/X). Remove map/leaflet assets.
- [ ] **Step 3: `SiteNav.astro`** — links: Home, InvestED (`/invested/`), the 6 categories (`/category/<slug>/`), About. Mobile menu.
- [ ] **Step 4: Verify** — `npm run dev`, load home; header/footer render, theme toggle works.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: base layout + finance theme"`

### Task 11: Post page + components

**Files:**
- Create: `src/pages/posts/[slug].astro`, `src/components/PostBody.astro`, `src/components/PostCard.astro`, `src/components/CategoryChips.astro`, `src/components/Disclaimer.astro`, `src/components/TableOfContents.astro`, `src/lib/posts.ts`, `src/lib/seo.ts`

- [ ] **Step 1: `src/lib/posts.ts`** — helpers: `getAllPosts()` (sorted by date desc, drafts excluded in prod), `getPostsByCategory(cat)`, `getPostsByTag(tag)`, `getSeries(name)` (sorted by `seriesOrder`), `getAdjacentInSeries(post)` (prev/next). Adapt from `GT/src/lib/posts.ts`.
- [ ] **Step 2: `posts/[slug].astro`** — `getStaticPaths` from `getAllPosts()`; render title, date, reading time (`reading-time`), `CategoryChips`, `PostBody` (renders MDX), `Disclaimer` callout at the foot, `SeriesNav` if `post.data.series` (Task 12), `TableOfContents` for long posts. Adapt from `GT/src/pages/posts/[slug].astro` (drop map/gallery/likes/comments for v1).
- [ ] **Step 3: `seo.ts`** — adapt from `GT/src/lib/seo.ts` (title/desc/canonical/og).
- [ ] **Step 4: Verify** — load a migrated post; table renders, disclaimer shows, reading time present.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: post page + components"`

### Task 12: InvestED course (landing + series nav)

**Files:**
- Create: `src/pages/invested/index.astro`, `src/components/SeriesNav.astro`

- [ ] **Step 1: `SeriesNav.astro`** — props `prev`/`next` (post refs); renders "← Chapter N" / "Chapter N →" links; nothing rendered if both null.
- [ ] **Step 2: `invested/index.astro`** — intro blurb; ordered list of InvestED chapters via `getSeries('InvestED')`, each linking to its post, numbered by `seriesOrder`.
- [ ] **Step 3: Wire `SeriesNav` into `posts/[slug].astro`** using `getAdjacentInSeries(post)`.
- [ ] **Step 4: Verify** — `/invested/` lists 4 chapters in order; chapter pages show prev/next correctly (Ch1 has no prev; last has no next).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: InvestED course landing + chapter nav"`

### Task 13: Home, category, tag, archive, static pages, 404

**Files:**
- Create: `src/pages/index.astro`, `src/pages/category/[category].astro`, `src/pages/tags/[tag].astro`, `src/pages/archive.astro`, `src/pages/[slug].astro`, `src/pages/404.astro`

- [ ] **Step 1: `index.astro`** — featured (latest) post hero + recent posts grid using `PostCard`; an InvestED promo strip; category links.
- [ ] **Step 2: `category/[category].astro`** — `getStaticPaths` over the 6 categories (slug via `slugifyTag`); list posts in that category.
- [ ] **Step 3: `tags/[tag].astro`** — adapt from GT; `getStaticPaths` over all tags; list posts.
- [ ] **Step 4: `archive.astro`** — all posts grouped by year.
- [ ] **Step 5: `[slug].astro`** — render `pages` collection (About/Contact/Disclaimer/Privacy/Terms) via `getStaticPaths`.
- [ ] **Step 6: `404.astro`** — friendly 404 with search + home links.
- [ ] **Step 7: Verify** — `npm run build` succeeds; visit a category page, a tag page, archive, About, and a bad URL (404) in `npm run preview`.
- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat: home, category, tag, archive, pages, 404"`

---

## Phase 4 — Extras

### Task 14: Search, RSS, sitemap, robots

**Files:**
- Create: `src/pages/search.astro`, `src/pages/rss.xml.ts`, `public/robots.txt`

- [ ] **Step 1: `rss.xml.ts`** — adapt from `GT/src/pages/rss.xml.ts` (`@astrojs/rss`, site title/desc, all posts).
- [ ] **Step 2: `search.astro`** — Pagefind UI page (adapt from `GT/src/pages/search.astro`).
- [ ] **Step 3: `robots.txt`** — allow all, point to `/sitemap-index.xml`.
- [ ] **Step 4: Verify** — `npm run build` (runs `build:search`); `npm run preview`, confirm `/search/` returns results for "IPO" and `/rss.xml` is valid.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: search, rss, sitemap, robots"`

### Task 15: Notion build pipeline + optional integrations

**Files:**
- Create: `scripts/build-content.ts`, `scripts/lib/notion.ts`, `scripts/lib/blocks-to-mdx.ts`, `scripts/lib/image-mirror.ts`; modify `Base.astro`
- Create: `src/components/Comments.astro`, `src/components/Newsletter.astro`, `src/components/Analytics.astro`

- [ ] **Step 1: Adapt `scripts/build-content.ts` + `scripts/lib/*`** from GT — pull `Published` posts from the Notion DB, mirror images to `public/img/generated/`, write to `src/content/posts/notion/`. Update the property reads to the Wealthy Monk schema (Category select, Series, Series Order; drop Location/Lat/Long). When `NOTION_TOKEN` is absent, log and no-op (build uses migrated/seed MDX).
- [ ] **Step 2: Config-gated components** — `Analytics.astro` (Cloudflare beacon if `PUBLIC_CFA_TOKEN`), `Comments.astro` (Giscus if the four `PUBLIC_GISCUS_*` set), `Newsletter.astro` (Buttondown form if `PUBLIC_BUTTONDOWN_USER`). Each renders nothing when its env is blank. Wire into `Base.astro`/post page.
- [ ] **Step 3: Update `README.md`** — adapt GT README: Notion setup with the Wealthy Monk schema, Cloudflare deploy steps, optional integrations, the npm-cache gotcha.
- [ ] **Step 4: Verify** — build with no env set still succeeds and renders no comment/newsletter/analytics markup (`grep` the built HTML to confirm absence).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: Notion build pipeline + config-gated integrations"`

---

## Phase 5 — Deploy (manual, author-driven)

### Task 16: Cloudflare Pages preview + DNS cutover

- [ ] **Step 1:** Push repo to a new GitHub repo (author or via `gh`).
- [ ] **Step 2:** Cloudflare dashboard → Pages → connect repo; build `npm run build`, output `dist`, `NODE_VERSION=22`; add env vars when Notion is ready.
- [ ] **Step 3:** Deploy to `*.pages.dev`; verify home, a post, `/invested/`, a category, search, RSS, and several old-permalink redirects.
- [ ] **Step 4:** Create the Notion "Posts" DB per README; push migrated content to Notion (optional) or keep MDX-committed.
- [ ] **Step 5 (cutover):** Add custom domain `wealthymonk.org` in Pages; point Hostinger DNS at Cloudflare. Verify HTTPS + redirects live.
- [ ] **Step 6: Commit/tag** — tag the release.

---

## Self-Review notes

- **Spec coverage:** stack (T1,2,15), Notion model (T2,15), category 21→6 (T3,4), InvestED series (T5,12), WXR migration + images + redirects (T6–9,14), legal pages (T9,13), fresh finance design + tables (T10,11), search/rss/sitemap (T14), deploy + DNS (T16). Travel features intentionally absent.
- **Types:** `Category` defined in `src/lib/categories.ts`, imported by `map-category.ts`; `mapCategory`/`toTags`/`detectSeries`/`parseWxr`/`buildRedirects`/`htmlToMdx`/`slugify` names are consistent across tasks and their tests.
- **Deferred from GT (out of scope v1, can add later):** KV-backed comments/likes, contact form Cloudflare functions, AI content-generation agent, gallery, map, llms.txt. Giscus/Buttondown/Analytics included but config-gated/off by default.
