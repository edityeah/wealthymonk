/**
 * Generate a Wealthy Monk finance post (news or evergreen) via a single Claude
 * call using structured tool output. Body is Markdown with inline image
 * placeholders (query:) and internal backlinks; the build pipeline resolves
 * images. Every post page renders a standing financial disclaimer, so the model
 * must NOT add its own.
 */
import { toolCall } from './llm.js';
import type { Candidate, Region } from './discover.js';
import type { SeedTopic } from './topics.js';

export type Category =
  | 'Indian Markets'
  | 'US Markets'
  | 'Investing & Valuation'
  | 'Crypto'
  | 'Insurance'
  | 'Personal Finance & Tax';

export const CATEGORIES: Category[] = [
  'Indian Markets', 'US Markets', 'Investing & Valuation', 'Crypto', 'Insurance', 'Personal Finance & Tax',
];

export interface ExistingPost { title: string; slug: string; tags: string[]; excerpt?: string; }

const VOICE = `You write for The Wealthy Monk, a calm, jargon-free personal-finance blog (tagline: "Healthier wallet, happier you!"). Audience: Indian retail investors and money-curious readers, with some US-market coverage.

Rules that always apply:
- Clear, plain language. Define jargon the first time. Short paragraphs (2-3 sentences). Use ## and ### headings and lists.
- Be accurate and concrete. Use real specifics (figures, rules) only when you are confident; if a number can change (tax rates, limits, prices), say "as of the latest update" and link the official source (SEBI, RBI, income tax dept, exchange, company IR).
- NEVER give personalised investment advice or "buy/sell" calls. Educate; let readers decide. No hype, no "to the moon", no guaranteed-returns language.
- Do NOT add a disclaimer — the site adds one automatically on every page.
- No emojis. No "In conclusion". No "Source:" line. Do not invent facts.

REQUIRED inline links + images:
A. ENTITY LINKS (external): hyperlink key proper nouns to official sites — companies → investor-relations/official site, regulators → SEBI/RBI/IRDAI, exchanges → NSE/BSE/NYSE, or Wikipedia for concepts. 4-8 links, natural anchor text, don't repeat the same entity.
B. INTERNAL BACKLINKS: you'll get a list of existing Wealthy Monk posts; link 1-3 relevant ones inline by slug: [text](/posts/SLUG/). Don't force fits.
C. INLINE IMAGES: 2-4 placeholders where a visual helps, using EXACTLY: ![alt text](query:concrete photographable subject). The query must name a real, photographable THING, and its geography MUST match the post's topic/category:
   - Indian Markets or India-specific topics → India-anchored: "Bombay Stock Exchange building Mumbai", "Indian rupee banknotes and calculator", "RBI Reserve Bank of India building".
   - US Markets or US-specific topics → US-anchored: "New York Stock Exchange Wall Street", "Nasdaq market screen Times Square", "US dollar bills".
   - Non-geographic topics (general investing/valuation, crypto, generic insurance/tax concepts) → neutral concrete subjects, no country forced: "stock chart on a laptop screen", "gold bitcoin coin", "insurance policy documents and pen", "coins stacked with growth chart".
   - Prefer objects, places, charts, screens, documents, buildings, and currency over photos of PEOPLE. Avoid generic people queries ("business team", "office meeting", "people in suits") — they return mismatched stock.
   - Never abstract ("market analysis", "financial planning"). First image after the opening 1-2 paragraphs.`;

const SYSTEM_NEWS = `${VOICE}

This is a NEWS / timely post grounded in a source. Lead with what happened in plain language and why it matters to an Indian investor or saver, then add context (history, comparable cases, what to watch, what — in general educational terms — readers might consider). 500-800 words. Use ONLY facts in the source; write around anything missing.

Output via the publish_post tool.`;

const SYSTEM_EVERGREEN = `${VOICE}

This is an EVERGREEN reference guide people find by searching — make it the most useful page on the topic. Open with a one-paragraph summary answer. Cover it exhaustively and concretely: definitions, steps, costs/figures (in ₹ where relevant), examples, and common mistakes. 800-1400 words. Don't pad.

Output via the publish_post tool.`;

const TOOL = {
  name: 'publish_post',
  description: "Save the generated post's structured data",
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Clear, descriptive headline, not clickbait. 6-14 words.' },
      slug: { type: 'string', description: 'URL slug. Lowercase, hyphenated, 4-9 words.', pattern: '^[a-z0-9-]+$' },
      excerpt: { type: 'string', description: 'One sentence on what the post covers. 130-180 characters.' },
      category: {
        type: 'string',
        enum: CATEGORIES,
        description: 'The single best-fit site category for this post.',
      },
      tags: { type: 'array', items: { type: 'string' }, description: '3-6 free-form tags (instruments, entities, topic). For news include "TWM News".' },
      body: { type: 'string', description: 'Full body in Markdown. Headings, paragraphs, lists. NO frontmatter, NO H1/title at top, NO disclaimer, NO "Source:" line. Must include entity links, internal backlinks, and inline image placeholders per the system prompt.' },
      coverQuery: { type: 'string', description: 'Specific Unsplash query for the cover — a concrete subject from the post, with geography matching the topic: India-anchored for Indian topics ("Bombay Stock Exchange Mumbai"), US-anchored for US topics ("New York Stock Exchange Wall Street"), neutral for non-geographic topics ("gold bitcoin coin", "insurance documents"). Prefer objects/places over generic people. Not abstract.' },
    },
    required: ['title', 'slug', 'excerpt', 'category', 'tags', 'body', 'coverQuery'],
  },
} as const;

export interface GeneratedPost {
  title: string;
  slug: string;
  excerpt: string;
  category: Category;
  tags: string[];
  body: string;
  coverQuery: string;
  sourceUrl: string;
  sourceName: string;
}

function rankExisting(existing: ExistingPost[], topicText: string): string {
  const topic = topicText.toLowerCase();
  const ranked = existing
    .map((p) => {
      const text = (p.title + ' ' + (p.tags ?? []).join(' ') + ' ' + (p.excerpt ?? '')).toLowerCase();
      let score = 0;
      for (const w of topic.split(/\W+/).filter((w) => w.length >= 4)) if (text.includes(w)) score++;
      return { p, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((x) => x.p);
  return ranked.length
    ? ranked.map((p) => `- ${p.title} — slug: ${p.slug}`).join('\n')
    : '(none yet)';
}

async function callTool(system: string, userPrompt: string, maxTokens: number) {
  return callToolWith(TOOL, system, userPrompt, maxTokens) as Promise<Omit<GeneratedPost, 'sourceUrl' | 'sourceName'>>;
}

async function callToolWith(tool: any, system: string, userPrompt: string, maxTokens: number): Promise<any> {
  // Our tool defs use Anthropic's `input_schema`; OpenAI functions want `parameters`.
  return toolCall({
    system,
    user: userPrompt,
    tool: { name: tool.name, description: tool.description, parameters: tool.input_schema },
    maxTokens,
  });
}

export async function generatePost(candidate: Candidate, existing: ExistingPost[] = []): Promise<GeneratedPost> {
  const postList = rankExisting(existing, candidate.title + ' ' + candidate.summary);
  const userPrompt = `Finance news to cover:

Headline: ${candidate.title}
Source: ${candidate.source}
Source URL: ${candidate.url}
Summary: ${candidate.summary}
${candidate.category ? `Suggested category: ${candidate.category}` : ''}

Existing Wealthy Monk posts you can backlink to inline when relevant (use the slug):

${postList}

Write the post. Use the publish_post tool.`;
  const input = await callTool(SYSTEM_NEWS, userPrompt, 4000);
  return { ...input, sourceUrl: candidate.url, sourceName: candidate.source };
}

// ── Daily market brief ("Day Starter" style) ────────────────────────────────

const REGION_CFG: Record<Region, { label: string; category: Category; indices: string; geo: string; tag: string }> = {
  india: {
    label: 'Indian',
    category: 'Indian Markets',
    indices: 'Nifty 50, Sensex, Bank Nifty',
    geo: 'India-anchored ("Bombay Stock Exchange building Mumbai", "Indian rupee banknotes", "RBI Reserve Bank of India building", "Dalal Street Mumbai")',
    tag: 'Indian Markets',
  },
  us: {
    label: 'US',
    category: 'US Markets',
    indices: 'S&P 500, Dow Jones, Nasdaq',
    geo: 'US-anchored ("New York Stock Exchange Wall Street", "Nasdaq market screen Times Square", "US dollar bills", "Federal Reserve building Washington")',
    tag: 'US Markets',
  },
};

function dayStarterSystem(region: Region): string {
  const c = REGION_CFG[region];
  return `${VOICE}

This is a DAILY MARKET BRIEF for the ${c.label} market, in the style of a morning "Day Starter" roundup. You are given several fresh news items published today. Weave them into ONE cohesive, readable brief a busy investor can skim over coffee. Structure:

1. Opening (2-3 sentences): the day's overall market direction and the ONE biggest driver. Name the date naturally.
2. "## What moved" — key index moves and the standout sectors/stocks. Reference ${c.indices} where relevant.
3. "## Why it moved" (or similar) — the drivers: macro data, global cues, earnings, policy, flows.
4. "## What to watch" — upcoming triggers/events that the sources mention or clearly imply.

HARD ACCURACY RULE: Use ONLY specific numbers (index levels, percentages, prices) that appear in the provided sources. If an exact figure is not in the sources, describe the move qualitatively ("IT stocks led the gains", "banks were under pressure") — DO NOT invent index levels, closing values, or percentages. Never fabricate quotes.

Length: 500-800 words. Focus on what is genuinely trending and worth reading — skip filler stories. Inline image geography MUST be ${c.geo}.

Output via the publish_post tool. Set category to "${c.category}".`;
}

/** A daily market brief for one region, synthesized from the day's top stories. */
export async function generateDailyBrief(
  region: Region,
  candidates: Candidate[],
  existing: ExistingPost[] = [],
  dateLabel?: string,
): Promise<GeneratedPost> {
  const c = REGION_CFG[region];
  const top = candidates.slice(0, 8);
  const sources = top
    .map((s, i) => `${i + 1}. ${s.title}\n   Source: ${s.source} — ${s.url}\n   ${s.summary || '(no summary)'}`)
    .join('\n\n');
  const topicText = top.map((s) => s.title).join(' ');
  const postList = rankExisting(existing, topicText);
  const userPrompt = `Write today's ${c.label}-market Day Starter brief${dateLabel ? ` for ${dateLabel}` : ''}.

Today's ${c.label}-market news items to synthesize (use these as your factual basis; lead with whatever is genuinely the biggest story):

${sources}

Existing Wealthy Monk posts you can backlink to inline when relevant (use the slug):

${postList}

Use the publish_post tool. Set category to "${c.category}". Include "TWM News" in tags.`;
  const input = await callTool(dayStarterSystem(region), userPrompt, 4000);
  return {
    ...input,
    category: c.category, // force — never let the model drift the region
    sourceUrl: top[0]?.url ?? '',
    sourceName: top[0]?.source ?? '',
  };
}

// ── Full daily market terminal report ───────────────────────────────────────

export interface ReportSections {
  title: string;
  slug: string;
  excerpt: string;
  coverQuery: string;
  leadSummary: string;
  keyInsights: string[];
  marketAnalysis: string;
  macroView: string;
  earnings: string;
  deals: string;
  globalPulse: string;
  whatToWatch: string[];
  featureTitle: string;
  featureBody: string;
  tags: string[];
}

const REPORT_TOOL = {
  name: 'publish_report',
  description: 'Save the structured daily market report',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Descriptive headline naming the market and the day\'s main move, e.g. "Indian Market Report: Nifty Climbs 1% as Autos and Financials Lead". 8-16 words.' },
      slug: { type: 'string', description: 'URL slug, lowercase hyphenated, includes the date, e.g. "indian-market-report-august-3-2026".', pattern: '^[a-z0-9-]+$' },
      excerpt: { type: 'string', description: 'One-sentence summary of the day. 130-180 characters.' },
      coverQuery: { type: 'string', description: 'Concrete Unsplash cover query with region-matching geography (India-anchored for Indian report, US-anchored for US). Objects/places over people. Not abstract.' },
      leadSummary: { type: 'string', description: 'Opening 2-3 paragraph synthesis of the session: overall direction, the biggest driver, leading/lagging sectors, and a forward hook. Markdown. Reference the real index numbers from the data.' },
      keyInsights: { type: 'array', items: { type: 'string' }, description: '5-7 punchy bullet insights, each a concrete takeaway with a figure where possible.' },
      marketAnalysis: { type: 'string', description: 'The "what moved and why" analysis (~500-800 words). Use ### subsections. Explain the index/sector/stock moves using the EXACT numbers in the data digest, and the drivers (macro, global cues, earnings, flows). Define any jargon.' },
      macroView: { type: 'string', description: 'Macro & economy section (~600-1000 words) with ### subsections (growth/industrial activity, inflation/rates, policy/regulation, public finance) built from the provided news. Only use facts present in the news items.' },
      earnings: { type: 'string', description: 'Corporate earnings section (~600-1200 words). A ### subsection per major company in the news reporting results, covering profit/revenue/margin and context. Only companies and figures present in the news.' },
      deals: { type: 'string', description: 'Deals, M&A and corporate actions (~300-700 words) drawn from the news — acquisitions, demergers, fundraises, leadership changes, block deals.' },
      globalPulse: { type: 'string', description: 'Global markets & international news (~500-1000 words) with ### subsections — world indices context (reference the global data), central banks, commodities/oil, major global corporate news from the items.' },
      whatToWatch: { type: 'array', items: { type: 'string' }, description: '5-8 forward-looking bullets: upcoming data, events, results, or levels to watch, grounded in the news.' },
      featureTitle: { type: 'string', description: 'Title of a deeper feature/explainer on the single most interesting trending theme of the day.' },
      featureBody: { type: 'string', description: 'The feature deep-dive (~700-1200 words) with ### subsections — an educational analysis of that trending theme (what it is, why it matters, risks, what to consider). Include 1-2 external entity links and 1-2 internal backlinks.' },
      tags: { type: 'array', items: { type: 'string' }, description: '5-8 tags (instruments, entities, themes). Include "TWM News".' },
    },
    required: ['title', 'slug', 'excerpt', 'coverQuery', 'leadSummary', 'keyInsights', 'marketAnalysis', 'macroView', 'earnings', 'deals', 'globalPulse', 'whatToWatch', 'featureTitle', 'featureBody', 'tags'],
  },
} as const;

function reportSystem(region: Region): string {
  const c = REGION_CFG[region];
  return `${VOICE}

You are writing a COMPREHENSIVE DAILY MARKET REPORT for the ${c.label} market — a professional, data-dense "market terminal" style briefing (think a serious morning research note), but in The Wealthy Monk's calm, jargon-free voice. It is long and thorough (target 4,000-6,000 words of prose across all sections combined).

You are given (1) a DATA DIGEST of today's real market numbers (indices, sectors, top movers, commodities, FX, bonds, global indices) and (2) a set of today's NEWS ITEMS. The site will insert the data tables and bar charts automatically — DO NOT write tables or add image placeholders yourself. Your job is the analysis prose that surrounds them.

ACCURACY IS PARAMOUNT:
- For market moves, use the EXACT figures in the DATA DIGEST (e.g. if it says "Nifty 50: 24,572.70 (+1.05%)", use those). Never invent index levels or percentages.
- For company, macro, deal, and global facts, use ONLY what is stated in the NEWS ITEMS. If a specific number isn't provided, describe it qualitatively. Never fabricate figures, quotes, or events.
- If the news has little on a section, keep that section shorter rather than padding with invented content.

Indices to reference where relevant: ${c.indices}. Cover image geography: ${c.geo}.

Fill EVERY field of the publish_report tool. Set category context to "${c.category}". Educational only — no buy/sell calls, no disclaimer (the site adds one).`;
}

/** Full daily market report — structured prose sections; data blocks added later. */
export async function generateTerminalReport(
  region: Region,
  dataDigest: string,
  news: Candidate[],
  existing: ExistingPost[] = [],
  dateLabel?: string,
): Promise<ReportSections & { category: Category }> {
  const c = REGION_CFG[region];
  const newsBlock = news.slice(0, 18)
    .map((n, i) => `${i + 1}. ${n.title}\n   (${n.source}) ${n.url}\n   ${n.summary || '(no summary)'}`)
    .join('\n\n');
  const postList = rankExisting(existing, news.map((n) => n.title).join(' '));
  const userPrompt = `Write today's ${c.label}-market daily report${dateLabel ? ` for ${dateLabel}` : ''}.

=== TODAY'S MARKET DATA (use these exact numbers) ===
${dataDigest}

=== TODAY'S ${c.label.toUpperCase()} & GLOBAL NEWS ITEMS (your only source of facts for macro/earnings/deals/global) ===
${newsBlock}

=== EXISTING WEALTHY MONK POSTS (backlink inline where relevant, by slug) ===
${postList}

Write the full report via the publish_report tool.`;
  // Generous cap: the report is long AND reasoning tokens count against it.
  const input = (await callToolWith(REPORT_TOOL, reportSystem(region), userPrompt, 32000)) as ReportSections;
  return { ...input, category: c.category };
}

// ── Trending-story explainer ────────────────────────────────────────────────

export interface TrendingResult {
  title: string;
  slug: string;
  excerpt: string;
  coverQuery: string;
  tags: string[];
  chosenStory: string;   // short label of the story it covered (for dedup)
  sourceUrl: string;     // the specific source it built on
  ticker: string;        // Yahoo symbol if the story centers on one instrument, else ''
  tickerLabel: string;   // human name for the ticker
  body: string;
  category: Category;
}

const TREND_TOOL = {
  name: 'publish_trending',
  description: 'Save the trending-story explainer',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Engaging, specific headline naming the story. 6-14 words, not clickbait.' },
      slug: { type: 'string', description: 'URL slug, lowercase hyphenated, 4-9 words.', pattern: '^[a-z0-9-]+$' },
      excerpt: { type: 'string', description: 'One-sentence summary of the story. 130-180 characters.' },
      coverQuery: { type: 'string', description: 'Concrete Unsplash cover query, geography matching the market (India-anchored for the India post, US-anchored for US). Objects/places over people. Not abstract.' },
      tags: { type: 'array', items: { type: 'string' }, description: '4-6 tags (entities, instruments, theme). Include "TWM News".' },
      chosenStory: { type: 'string', description: 'A short label (5-10 words) of the single story you chose to cover — used to avoid duplicate coverage.' },
      sourceUrl: { type: 'string', description: 'The URL of the specific source item your story is built on.' },
      ticker: { type: 'string', description: 'If the story centers on ONE publicly-traded instrument you are confident about, its Yahoo Finance symbol; else "". US stocks: plain ticker (NVDA, AAPL). Indian stocks: add .NS (RELIANCE.NS, TATAMOTORS.NS). Indices: ^NSEI (Nifty), ^BSESN (Sensex), ^GSPC (S&P 500), ^IXIC (Nasdaq), ^DJI (Dow). Commodities: GC=F (gold), CL=F (crude), BTC-USD (bitcoin). Leave "" for macro/policy stories or IPOs not yet listed.' },
      tickerLabel: { type: 'string', description: 'Human name for the ticker (e.g. "Nvidia", "Nifty 50"), or "" if no ticker.' },
      body: { type: 'string', description: 'Full explainer in Markdown (~800-1400 words). Use ### subsections (e.g. What happened / Why it matters / The context / What to watch). Include 4-6 external entity links, 1-3 internal backlinks by slug, and 1-2 inline image placeholders EXACTLY as ![alt](query:concrete photographable subject). Do NOT write any tables (a data snapshot is added automatically). No H1, no frontmatter, no disclaimer, no "Source:" line.' },
    },
    required: ['title', 'slug', 'excerpt', 'coverQuery', 'tags', 'chosenStory', 'sourceUrl', 'ticker', 'tickerLabel', 'body'],
  },
} as const;

function trendingSystem(region: Region): string {
  const c = REGION_CFG[region];
  return `${VOICE}

You are writing ONE timely, high-traction ${c.label}-market news explainer for a general finance audience — a story people are actively searching and talking about TODAY (an IPO, a big stock move, an earnings surprise, a regulatory or macro development, a crypto swing). This is NOT a whole-market wrap; pick the SINGLE biggest, most interesting story from the items provided and go deep on it.

Make it genuinely readable and useful: lead with what happened in plain language, then why it matters to an ordinary investor/saver, the context and risks, and what to watch next. Define jargon. Be accurate — use ONLY facts present in the provided news items; if a number isn't there, describe it qualitatively. Never invent figures or quotes.

If the story centers on one tradable instrument (a specific stock, index, or commodity), set the ticker field so a live data snapshot can be added; otherwise leave it "".

Cover image geography: ${c.geo}. Output via the publish_trending tool. Set category to "${c.category}".`;
}

/** One trending-story explainer for a region, chosen from the day's news. */
export async function generateTrending(
  region: Region,
  candidates: Candidate[],
  existing: ExistingPost[] = [],
  opts: { dateLabel?: string; avoid?: string[] } = {},
): Promise<TrendingResult> {
  const c = REGION_CFG[region];
  const top = candidates.slice(0, 12);
  const items = top
    .map((s, i) => `${i + 1}. ${s.title}\n   (${s.source}) ${s.url}\n   ${s.summary || '(no summary)'}`)
    .join('\n\n');
  const postList = rankExisting(existing, top.map((s) => s.title).join(' '));
  const avoidNote = opts.avoid?.length
    ? `\nDO NOT cover any of these already-chosen stories — pick a clearly DIFFERENT one:\n- ${opts.avoid.join('\n- ')}\n`
    : '';
  const userPrompt = `Write today's trending ${c.label}-market explainer${opts.dateLabel ? ` for ${opts.dateLabel}` : ''}.

Today's ${c.label} finance news to choose from (pick the single biggest/most-trending story and go deep):

${items}
${avoidNote}
Existing Wealthy Monk posts you can backlink to inline when relevant (use the slug):

${postList}

Use the publish_trending tool. Set category to "${c.category}". Include "TWM News" in tags.`;
  const input = (await callToolWith(TREND_TOOL, trendingSystem(region), userPrompt, 6000)) as Omit<TrendingResult, 'category'>;
  return { ...input, category: c.category };
}

export async function generateEvergreen(topic: SeedTopic, existing: ExistingPost[] = []): Promise<GeneratedPost> {
  const postList = existing.length ? existing.slice(0, 20).map((p) => `- ${p.title} — slug: ${p.slug}`).join('\n') : '(none yet)';
  const userPrompt = `Write the definitive Wealthy Monk guide on this topic.

Working title: ${topic.title}
Topic brief: ${topic.brief}
Category: ${topic.category}
Suggested tags: ${topic.tags.join(', ')}

Existing Wealthy Monk posts you can backlink to inline when relevant (use the slug):

${postList}

Use the publish_post tool. Set category to "${topic.category}". Do NOT include "TWM News" in tags.`;
  const input = await callTool(SYSTEM_EVERGREEN, userPrompt, 6000);
  return { ...input, category: topic.category, sourceUrl: '', sourceName: '' };
}
