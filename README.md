# The Wealthy Monk

Personal-finance blog — *healthier wallet, happier you!* Static site built with
[Astro](https://astro.build), content authored in Notion, hosted on Cloudflare
Pages.

## Local development

```sh
npm install            # use --cache /tmp/npm-cache-wm if you hit EEXIST
npm run dev            # http://localhost:4321
npm run build          # builds dist/ (pulls Published posts from Notion)
npm run preview        # serve the built dist/
```

Posts are pulled from Notion at build time. Without a Notion token the build
produces no posts (Notion is the source of truth); with a token it pulls all
`Published` posts and mirrors their images.

## Project layout

```
src/
  content/
    posts/notion/        # posts pulled from Notion (gitignored, rebuilt each deploy)
    pages/               # About, Contact, Disclaimer, Privacy, Terms (committed)
  layouts/Base.astro
  components/            # PostCard, SeriesNav, Disclaimer, Comments, Newsletter…
  lib/                   # posts.ts, categories.ts, seo.ts
  pages/                 # index, posts/[slug], invested/, category/, tags/, …
  styles/global.css      # finance design tokens
scripts/
  build-content.ts       # Notion → MDX (runs before astro build)
  lib/{notion,blocks-to-mdx,image-mirror}.ts
  agent/                 # AI blog-drafting agent (drafts into Notion)
public/
  img/                   # committed images + generated/ (gitignored)
  _redirects             # old permalinks → new (301)
```

## Content model — Notion "Posts" database

Properties (exact, case-sensitive names):

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
| Content Type  | Select        | `Evergreen`, `News` (set by the agent)      |
| Topic Key     | Text          | agent de-dup key                            |
| Source URL    | URL           | agent de-dup                                |
| QA / QA Notes | Select / Text | agent QA status                             |

The six categories: **Indian Markets**, **US Markets**, **Investing &
Valuation**, **Crypto**, **Insurance**, **Personal Finance & Tax** (defined in
`src/lib/categories.ts`).

## Publishing a post

1. Write it in the Posts database; set `Category`, `Status = Published`.
2. The `deploy` GitHub Action rebuilds + deploys every 30 min (or trigger it
   manually), pulling the post from Notion and shipping it — live in ~1–2 min.

## AI drafting agent

`scripts/agent/` runs on a schedule (`.github/workflows/agent.yml`) and creates
**Draft** posts in the Posts DB (evergreen finance topics + market news → Claude
→ Unsplash cover → QA). It never publishes; you review drafts and flip to
`Published`. Secrets: `ANTHROPIC_API_KEY`, `UNSPLASH_ACCESS_KEY`, `NEWSAPI_KEY`.

## Deploy & automation (GitHub Actions + Cloudflare Pages)

- `deploy.yml` — build + deploy to Cloudflare Pages (every 30 min + on push).
- `agent.yml` — the drafting agent (hourly; caps at 10 drafts/day).
- `set-pages-secrets.yml` — push Function runtime secrets to the Pages project.
- Runtime Functions (`functions/api/`): contact, subscribe, unsubscribe, likes,
  comments — backed by Notion, Resend, and Cloudflare KV.

Required secrets: `NOTION_TOKEN`, `NOTION_DATABASE_ID`, `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, and (for Functions) `NOTION_CONTACT_DB_ID`,
`NOTION_SUBSCRIBERS_DB_ID`, `RESEND_API_KEY`, `UNSUB_SECRET`.

## Optional integrations (off unless their env vars are set)

- **Cloudflare Web Analytics:** `PUBLIC_CFA_TOKEN`.
- **Google AdSense:** `PUBLIC_ADSENSE_CLIENT` (+ your `ads.txt`).

## Likes & comments (Cloudflare KV)

KV-backed Pages Functions. Bind two KV namespaces at deploy: `LIKES` → `wm_likes`,
`COMMENTS` → `wm_comments` (Pages → Settings → Functions → KV bindings). Optional
`ADMIN_TOKEN` enables comment deletion. Locally they degrade gracefully.

## Known gotchas

- **Notion image URLs expire (~1h).** The build mirrors them to
  `public/img/generated/`; never reference a raw Notion URL from a template.
- **npm cache EEXIST:** run `npm install --cache /tmp/npm-cache-wm`.
