# The Wealthy Monk — Rebuild Design

**Date:** 2026-06-24
**Status:** Approved (design); pending spec review before planning

## Background

The Wealthy Monk (`wealthymonk.org`) is a personal-finance / stock-market
literacy blog, tagline *"Healthier wallet, happier you!"*. It currently runs on
WordPress 6.9.4 on Hostinger. The hosting has been unreliable (the whole site,
including `wp-admin`, was returning HTTP 500 during this planning session).

We are rebuilding it as a static site, reusing the proven architecture of the
author's other site, **Geo-Traveller** (Astro + Notion + Cloudflare Pages),
adapted for a finance blog.

### Content inventory (from `thewealthymonk.WordPress.2026-06-24.xml`)

- **46 posts**, **9 pages**, **182 image attachments**, 1 draft.
- Pages: Home, About, Contact, Disclaimer, Privacy Policy, Terms and
  Conditions, investED, Introduction to Stock Markets, Stock Market 101.
- 21 WordPress categories (over-fragmented), covering: Indian & US stock
  markets, investing, fundamental analysis / valuation, crypto, insurance
  (health/home/motor/pet/travel), tax savings, books, app reviews, news.
- A **sequential course** ("InvestED" / "Introduction to Stock Markets") made
  of ordered chapters ("Chapter 1: Why should anyone invest?", … "Chapter 4:
  The IPO Markets (Part 1)").

## Goals

1. Move off flaky WordPress/Hostinger hosting to free, fast, reliable static
   hosting on Cloudflare Pages.
2. Migrate all existing posts, pages, and images with original dates and
   working redirects from old permalinks (preserve SEO).
3. Give the author a no-code publishing workflow (Notion), identical to
   Geo-Traveller.
4. Add first-class support for the **InvestED** course.
5. Replace the look with a fresh, trustworthy finance design.

## Non-goals

- No travel features (map, geo-coordinates, location galleries) — these exist
  in Geo-Traveller and are explicitly dropped here.
- No re-platforming of WordPress comments/users; comments (if wanted) come via
  Giscus, config-gated.
- No paid services. All optional integrations are free-tier and off by default.

## Architecture

Mirrors Geo-Traveller:

- **Astro 5** static site generator, **MDX** content collection.
- Content authored in a **Notion** "Posts" database. A build step
  (`scripts/build-content.ts`) pulls `Published` posts via the Notion API,
  converts blocks → MDX, and mirrors Notion image URLs (which expire) into
  `public/img/generated/`.
- **Pagefind** for client-side search; `@astrojs/rss` + `@astrojs/sitemap`.
- **Cloudflare Pages** hosting; build command `npm run build`, output `dist`,
  `NODE_VERSION=22`.
- Optional, config-gated via env vars: Giscus comments, Buttondown newsletter,
  Cloudflare Web Analytics.

### Differences from Geo-Traveller

| Area | Geo-Traveller | Wealthy Monk |
|------|---------------|--------------|
| Map / geo | Leaflet map, lat/long | **Removed** |
| Series | none | **`Series` + `Series Order`** content fields, course UI |
| Palette | travel/editorial | finance: deep navy + green accent |
| Hero | photo-forward | text/readability-forward |
| Legal pages | minimal | About, Contact, Disclaimer, Privacy, Terms |

## Content model (Notion "Posts" database)

| Property        | Type          | Notes                                        |
|-----------------|---------------|----------------------------------------------|
| Title           | Title         | default                                      |
| Slug            | Text          | blank → derived from title                   |
| Status          | Select        | `Draft`, `Published`, `Archived`             |
| Publish Date    | Date          | required                                     |
| Category        | Select        | one of the 6 consolidated categories         |
| Tags            | Multi-select  | includes original WP categories as tags      |
| Series          | Select        | e.g. `InvestED` (blank for normal posts)     |
| Series Order    | Number        | chapter order within a series                |
| Cover           | Files & media | single featured image                        |
| Excerpt         | Text          | 1–2 sentences                                |
| Original URL    | URL           | set by migration; drives `_redirects`        |
| Original Date   | Date          | set by migration                             |

Local seed posts live in `src/content/posts/`; Notion-sourced posts are written
to `src/content/posts/notion/` (gitignored, rebuilt each deploy). The site
builds without a Notion token using only seed posts (for design work).

## Category consolidation (21 → 6)

Originals are preserved as **tags**, and old `/category/<slug>/` URLs get
redirects to the new category pages.

1. **Indian Markets** ← Indian Stock Market
2. **US Markets** ← US Stock Market
3. **Investing & Valuation** ← Investing, Investments, Fundamental Analysis,
   Stock Market (generic)
4. **Crypto** ← Crypto Currency
5. **Insurance** ← Insurance, Health Insurance, Home Insurance, Motor Insurance,
   Pet Insurance, Travel Insurance, Senior Health Care
6. **Personal Finance & Tax** ← Tax Savings

Secondary groupings kept as **tags only** (not top-level categories):
**Resources** (Stock Market Books, Tools, App Reviews) and **News** (TWM News).

The categories **InvestED** and **Introduction to Stock Markets** are not browse
categories — those posts become the **InvestED Series** instead.

Posts with multiple old categories are assigned a single primary new category
by this precedence: Insurance > Crypto > US Markets > Indian Markets >
Investing & Valuation > Personal Finance & Tax. (Verified sensible against the
46-post list; edge cases get hand-checked during migration.)

## Site structure / pages

- **Home** — featured post hero + recent posts grid; entry points to InvestED
  and categories.
- **`/invested/`** — course landing page: ordered list of chapters with
  progress framing. Each chapter page has prev/next navigation.
- **`/category/<slug>/`** — one per consolidated category.
- **`/tags/<slug>/`** — tag pages (thin single-post tags dropped from sitemap,
  as in Geo-Traveller).
- **`/archive/`**, **`/search/`** — utility pages (excluded from sitemap).
- **About, Contact, Disclaimer, Privacy Policy, Terms** — migrated from WP
  pages verbatim.
- **404**, RSS (`/rss.xml`), sitemap.

## Design direction (fresh finance)

- **Palette:** deep navy (primary), single green accent for trust/positive
  finance connotation, warm neutrals; full light/dark mode.
- **Type:** confident serif headlines (Source Serif 4), clean sans body
  (Inter); generous measure for long-form financial reads.
- **Components:** readable article layout, styled tables (finance posts use many
  tables — e.g. share-price targets, holiday lists), callout/disclaimer blocks,
  category chips, series/chapter navigation.
- Exact palette values and component styling are finalized in the Design phase;
  a homepage mockup may be produced for sign-off then.

## Migration plan (one-time)

`scripts/migrate-wp/` (adapted from Geo-Traveller):

1. Parse `thewealthymonk.WordPress.2026-06-24.xml` with `fast-xml-parser`.
2. For each `post`: clean HTML → MDX with `cheerio`, extract title, date,
   excerpt, featured image, categories (→ new mapping), tags, and detect
   InvestED chapters (→ Series + Series Order parsed from "Chapter N").
3. For each `page`: migrate About/Contact/Disclaimer/Privacy/Terms verbatim.
4. Download the 182 attachments into `public/img/` and rewrite image `src`s.
5. Write `Original URL` for every item; generate `public/_redirects` mapping old
   WordPress permalinks → new paths.
6. Output destination is configurable: write to Notion (via API) and/or to local
   MDX. Default for review: local MDX so we can verify before touching Notion.

## Build & deploy

- Scripts (per Geo-Traveller `package.json`): `dev`, `build`
  (`build:content && astro build && build:search`), `migrate`, `deploy`
  (wrangler pages deploy), `typecheck`.
- Cloudflare Pages: connect Git repo, build `npm run build`, output `dist`,
  `NODE_VERSION=22`, env vars `NOTION_TOKEN`, `NOTION_DATABASE_ID` (+ optional
  integrations).
- **DNS cutover (last):** add custom domain `wealthymonk.org` in Cloudflare
  Pages, then point Hostinger DNS at Cloudflare. Done only after content is
  verified on the `*.pages.dev` URL.

## Phases

1. **Skeleton** — Astro project, content schema (with Series fields), layouts,
   templates, one seed post; builds cleanly.
2. **Design** — fresh finance theme, fonts, light/dark, InvestED course UI,
   styled tables, 404.
3. **Migration** — run the WP importer over the XML; verify all 46 posts +
   9 pages + images + redirects; map categories; build InvestED series.
4. **Extras** — Pagefind search, RSS/sitemap, `_redirects`, config-gated Giscus
   / Buttondown / Cloudflare Analytics.
5. **Deploy** — Cloudflare Pages preview, verify, then DNS cutover.

## Risks / open questions

- **Notion API image expiry** — handled by mirroring at build time (known from
  Geo-Traveller). Never link Notion image URLs directly.
- **HTML→MDX fidelity** — WordPress shortcodes/embeds may need manual cleanup;
  migration writes local MDX first for review.
- **Redirect coverage** — depends on the old permalink structure; confirmed from
  `Original URL` per item during migration.
- **Affiliate/ad scripts** — if the WP site ran ads/affiliate widgets, decide
  during migration whether to carry them over (out of scope unless raised).
