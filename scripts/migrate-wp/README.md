# WordPress migration (one-time)

Converts the WordPress export `thewealthymonk.WordPress.2026-06-24.xml` into
local MDX so we can review it before anything touches Notion.

```sh
npm run migrate            # downloads images + writes MDX + _redirects
npm run migrate -- --dry-run   # parse + report only, writes nothing
```

What it produces:

- `src/content/posts/notion/<slug>.mdx` — one file per published post, with
  frontmatter (title, slug, publishDate, mapped `category`, `tags`, `series`/
  `seriesOrder` for InvestED chapters, `cover`, `excerpt`, `originalUrl`).
- `src/content/pages/<slug>.mdx` — About, Contact, Disclaimer, Privacy Policy,
  Terms (footer pages). Home / investED / Stock Market 101 pages are skipped —
  those are site templates, not content pages.
- `public/img/<file>` — downloaded image attachments.
- `public/_redirects` — old WordPress permalinks → new paths (301).

Category consolidation (21 → 6) lives in `map-category.ts`; InvestED chapter
detection in `series.ts`. Both are unit-tested (`npm test`).

The migrated MDX is gitignored under `posts/notion/`; commit it explicitly if
you want it version-controlled, or push it to Notion as the source of truth.
