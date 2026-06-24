# The Wealthy Monk

Personal-finance blog — *healthier wallet, happier you!* Static site built with
[Astro](https://astro.build), content authored in Notion, hosted on Cloudflare
Pages. Rebuilt from the original WordPress site.

## Local development

```sh
npm install            # use --cache /tmp/npm-cache-wm if you hit EEXIST
npm run dev            # http://localhost:4321
npm run build          # builds dist/
npm run preview        # serve the built dist/
npm test               # migration unit tests
```

Without a Notion token the site builds from the committed MDX in
`src/content/posts/imported/` (the one-time WordPress import). With a token it
*also* pulls Published posts from Notion.

## Project layout

```
src/
  content/
    posts/
      imported/          # one-time WordPress import (committed)
      notion/            # live Notion posts (gitignored, rebuilt each deploy)
    pages/               # About, Contact, Disclaimer, Privacy, Terms (committed)
  layouts/Base.astro
  components/            # PostCard, SeriesNav, Disclaimer, Comments, Newsletter…
  lib/                   # posts.ts, categories.ts, seo.ts
  pages/                 # index, posts/[slug], invested/, category/, tags/, …
  styles/global.css      # finance design tokens
scripts/
  build-content.ts       # Notion → MDX (runs before astro build)
  lib/{notion,blocks-to-mdx,image-mirror}.ts
  migrate-wp/            # one-time WordPress importer (see its README)
public/
  img/                   # imported images (committed) + generated/ (gitignored)
  _redirects             # old WP permalinks → new (301)
```

## Content model — Notion "Posts" database

Create a full-page Notion database called **Posts** with these properties
(exact, case-sensitive names):

| Property      | Type          | Notes                                       |
|---------------|---------------|---------------------------------------------|
| Title         | Title         | (default)                                   |
| Slug          | Text          | blank → derived from title                  |
| Status        | Select        | `Draft`, `Published`, `Archived`            |
| Publish Date  | Date          | required                                    |
| Category      | Select        | one of the 6 categories (see below)         |
| Tags          | Multi-select  | free-form                                   |
| Series        | Select        | e.g. `InvestED` (blank for normal posts)    |
| Series Order  | Number        | chapter order within a series               |
| Cover         | Files & media | single featured image                       |
| Excerpt       | Text          | 1–2 sentences                               |
| Original URL  | URL           | set by migration (drives redirects)         |
| Original Date | Date          | set by migration                            |

The six categories: **Indian Markets**, **US Markets**, **Investing &
Valuation**, **Crypto**, **Insurance**, **Personal Finance & Tax** (defined in
`src/lib/categories.ts`).

### Notion setup (once)

1. https://notion.so/my-integrations → **New integration** → name it
   "Wealthy Monk", type **Internal**, capability **read content**. Copy the
   **Internal Integration Secret** → this is `NOTION_TOKEN`.
2. Create the **Posts** database above.
3. In the database: `···` → **Add connections** → pick "Wealthy Monk".
4. Open the database as a full page; the 32-char ID in the URL is
   `NOTION_DATABASE_ID`.
5. `cp .env.example .env` and fill in `NOTION_TOKEN` + `NOTION_DATABASE_ID`.

Now `npm run build` pulls Published posts into `src/content/posts/notion/`.

### Imported posts vs. Notion posts

The 45 WordPress posts live as committed MDX under `posts/imported/` and show
up immediately. New posts you write in Notion appear from `posts/notion/`. The
two coexist. To move an old post into Notion, recreate it there and **delete its
file from `posts/imported/`** so the slug isn't duplicated.

## Publishing a new post

1. Write it in the Posts database; set `Category`, `Status = Published`.
2. Trigger a Cloudflare deploy (deploy hook URL, or Pages → Retry latest).
3. A build (~1–2 min) pulls it from Notion and ships it.

## Cloudflare Pages deploy

1. Push this repo to GitHub.
2. Cloudflare dashboard → Pages → Create project → Connect to Git → pick the repo.
3. Build settings: **Build command** `npm run build`, **Output** `dist`,
   env `NODE_VERSION = 22`.
4. Add env vars `NOTION_TOKEN`, `NOTION_DATABASE_ID` (+ optional ones below).
5. Deploy → first deploy uses a `*.pages.dev` URL.
6. When happy: Pages → Custom domains → add `wealthymonk.org`, then point
   Hostinger DNS at Cloudflare.

## Optional integrations (all off unless their env vars are set)

- **Cloudflare Web Analytics:** set `PUBLIC_CFA_TOKEN`.
- **Giscus comments:** set `PUBLIC_GISCUS_REPO`, `PUBLIC_GISCUS_REPO_ID`,
  `PUBLIC_GISCUS_CATEGORY`, `PUBLIC_GISCUS_CATEGORY_ID` (from https://giscus.app).
- **Buttondown newsletter:** set `PUBLIC_BUTTONDOWN_USER` to your username.

## WordPress migration (one-time)

See [scripts/migrate-wp/README.md](scripts/migrate-wp/README.md).

## Known gotchas

- **Notion image URLs expire (~1h).** The build mirrors them to
  `public/img/generated/`; never reference a raw Notion URL from a template.
- **npm cache EEXIST:** run `npm install --cache /tmp/npm-cache-wm`.
