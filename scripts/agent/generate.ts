/**
 * Generate a Wealthy Monk finance post (news or evergreen) via a single Claude
 * call using structured tool output. Body is Markdown with inline image
 * placeholders (query:) and internal backlinks; the build pipeline resolves
 * images. Every post page renders a standing financial disclaimer, so the model
 * must NOT add its own.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Candidate, Region } from './discover.js';
import type { SeedTopic } from './topics.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const MODEL = process.env.AGENT_MODEL ?? 'claude-sonnet-4-6';

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
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    tools: [TOOL as any],
    tool_choice: { type: 'tool', name: 'publish_post' },
    messages: [{ role: 'user', content: userPrompt }],
  });
  const toolUse = res.content.find((c: any) => c.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') throw new Error('Claude did not return a tool_use block');
  return toolUse.input as Omit<GeneratedPost, 'sourceUrl' | 'sourceName'>;
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
