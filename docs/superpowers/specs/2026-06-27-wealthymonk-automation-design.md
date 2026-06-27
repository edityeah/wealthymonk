# The Wealthy Monk — Automation Design

**Date:** 2026-06-27
**Status:** Approved — implementing

## Goal

Automate the blog the way Geo-Traveller is automated: AI drafts posts into Notion
(human reviews + publishes), Notion changes auto-deploy, and the site captures
newsletter subscribers + contact messages into Notion with transactional email.

All scheduled automation runs on **GitHub Actions** (repo: `edityeah/wealthymonk`).
Runtime form/subscribe handlers run as **Cloudflare Pages Functions**. Adapted
from Geo-Traveller's proven implementation.

## Subsystems

### 1. Auto-publish from Notion (`.github/workflows/deploy.yml`)
- Triggers: `schedule` every 30 min, `push` to main, `workflow_dispatch`.
- Steps: `npm ci` → `npm run build` (pulls Published posts from Notion, mirrors
  images) → `wrangler pages deploy dist --project-name=wealthy-monk`.
- Effect: flip a post to `Published` in Notion → live within ~30 min, hands-free.
- Secrets (GitHub): `NOTION_TOKEN`, `NOTION_DATABASE_ID`, `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`, plus any `PUBLIC_*` (e.g. `PUBLIC_ADSENSE_CLIENT`,
  `PUBLIC_CFA_TOKEN`) that must be inlined at build time.

### 2. AI blog-drafting agent (`scripts/agent/`, `.github/workflows/agent.yml`)
- Adapted from GT's agent. Hourly cron (24 slots); planner caps at **10 drafts/
  day** from Notion state; extra slots no-op.
- Per run: choose category → generate with Claude → resolve Unsplash cover +
  inline images → QA (deterministic + LLM) → create a **Draft** row in the Posts
  DB with `Content Type`, `Topic Key`, `QA`, `QA Notes`. **Never auto-publishes.**
- Streams: **evergreen** (curated finance seed topics, ranked by search signal)
  and **news** (market-news discovery via NewsAPI, deduped by source URL).
- Initial scope: **Indian + US stock markets**. Full topic/category taxonomy is
  confirmed with the owner before the agent is switched on (kept disabled until
  then).
- Notion schema additions to Posts DB: `Content Type` (select: Evergreen, News),
  `Topic Key` (text), `Source URL` (url), `QA` (select), `QA Notes` (text).
- Secrets (GitHub): `NOTION_TOKEN`, `NOTION_DATABASE_ID`, `ANTHROPIC_API_KEY`,
  `UNSPLASH_ACCESS_KEY`, `NEWSAPI_KEY` (+ optional `PEXELS_API_KEY`).
- Env knobs: `AGENT_EVERGREEN_PER_DAY`, `AGENT_NEWS_PER_DAY`, `AGENT_DRY_RUN`.

### 3. Contact form → Notion (`functions/api/contact.ts`)
- A "Contact" Notion DB (Name, Email, Message, Submitted, Source, Status).
- `POST /api/contact` validates (honeypot + rate limit), creates a Notion row,
  optionally emails the owner via Resend. `ContactForm.astro` on the Contact page.
- Secrets (Pages runtime): `NOTION_TOKEN`, `NOTION_CONTACT_DB_ID`,
  `RESEND_API_KEY` (optional), reuses the `COMMENTS` KV for rate limiting.

### 4. Newsletter → Notion + Resend (`functions/api/subscribe.ts`, `unsubscribe.ts`)
- A "Subscribers" Notion DB (Name, Email, Subscribed, Status, Source).
- `POST /api/subscribe`: honeypot + rate limit + dedup/reactivate, Resend welcome
  email with signed one-click unsubscribe. `GET /api/unsubscribe?id=&s=` verifies
  an HMAC and flips Status → Unsubscribed. Footer `Newsletter.astro` repointed
  from Buttondown to `/api/subscribe`.
- Secrets (Pages runtime): `NOTION_TOKEN`, `NOTION_SUBSCRIBERS_DB_ID`,
  `RESEND_API_KEY`, `UNSUB_SECRET`.

### 5. Weekly digest (`scripts/digest/`, `.github/workflows/digest.yml`)
- Saturday cron: email Active subscribers a roundup of the week's new posts via
  Resend; skips if nothing new. Reuses the subscribe secrets + `UNSUB_SECRET`.

## Helper scripts
- `scripts/create-contact-db.ts`, `scripts/create-subscribers-db.ts` — create the
  Notion databases under a parent page the integration can access
  (`NOTION_PARENT_PAGE_ID`), print the new DB ids for the secrets.
- `.github/workflows/set-pages-secrets.yml` — pushes the runtime secrets to the
  Pages project (build-time GitHub secrets aren't visible to Functions).

## Secrets summary (owner provides; I wire them in)
| Key | Used by | Notes |
|-----|---------|-------|
| `ANTHROPIC_API_KEY` | agent | Claude API — the main cost |
| `UNSPLASH_ACCESS_KEY` | agent | free |
| `NEWSAPI_KEY` | agent | free tier |
| `RESEND_API_KEY` + verified domain | subscribe/contact/digest | email sending |
| `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | deploy + set-secrets | Pages edit, DNS read |
| `UNSUB_SECRET` | subscribe/unsubscribe/digest | random string I generate |

`NOTION_TOKEN`/`NOTION_DATABASE_ID` already exist. The Notion integration needs
**Insert content** capability (already enabled) and the new Contact/Subscribers
DBs connected to it.

## Build order
1. `deploy.yml` auto-publish workflow.
2. Contact (DB + Function + form).
3. Newsletter (DBs + Functions + Resend + repoint form).
4. AI agent (finance-adapted) + `agent.yml` — kept disabled until topic review.
5. Weekly digest.

## Risks / notes
- **Image volume:** the build mirrors Notion cover/inline images to
  `public/img/generated/` each deploy. At 10 posts/day this grows; if build time
  becomes a problem, migrate image hosting to Cloudflare R2 (as GT did). Deferred.
- **Cost:** the agent's Claude usage is the only meaningful recurring cost; the
  10/day cap and draft-only flow keep it controlled.
- **Safety:** the agent only ever creates Drafts; publishing is always a human
  action in Notion. The agent workflow stays disabled until topics are approved.
