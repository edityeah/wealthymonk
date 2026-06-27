/**
 * Find timely finance/markets stories.
 *
 * Sources: NewsAPI (business headlines + market query) and a few finance RSS
 * feeds. Returns deduped candidates (newest first) with a rough category guess.
 * The orchestrator filters these against what's already in Notion.
 */
import { XMLParser } from 'fast-xml-parser';
import type { Category } from './generate.js';

const NEWSAPI_KEY = process.env.NEWSAPI_KEY;

export interface Candidate {
  title: string;
  summary: string;
  url: string;
  source: string;
  imageUrl?: string;
  publishedAt: string; // ISO
  category?: Category;
}

const RSS_FEEDS = [
  { name: 'Moneycontrol Markets', url: 'https://www.moneycontrol.com/rss/marketreports.xml' },
  { name: 'Economic Times Markets', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms' },
  { name: 'Livemint Markets', url: 'https://www.livemint.com/rss/markets' },
  { name: 'CNBC Markets', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258' },
];

// Finance relevance filter (broad; covers Indian + US markets, crypto, etc.).
const FIN_KEYWORDS = [
  'stock', 'share', 'market', 'nifty', 'sensex', 'bse', 'nse', 'ipo', 'sebi',
  'rbi', 'mutual fund', 'sip', 'index', 'nasdaq', 'dow', 's&p', 'fed', 'rate',
  'earnings', 'dividend', 'bond', 'yield', 'crypto', 'bitcoin', 'ethereum',
  'rupee', 'dollar', 'inflation', 'gdp', 'investor', 'investment', 'insurance',
  'tax', 'fund', 'equity', 'valuation', 'fii', 'dii',
];
function isFinance(text: string): boolean {
  const t = text.toLowerCase();
  return FIN_KEYWORDS.some((kw) => t.includes(kw));
}

function guessCategory(text: string): Category | undefined {
  const t = text.toLowerCase();
  if (/(bitcoin|ethereum|crypto|token|blockchain)/.test(t)) return 'Crypto';
  if (/(insurance|policyholder|premium|irdai|mediclaim)/.test(t)) return 'Insurance';
  if (/(tax|income tax|80c|gst|budget|savings)/.test(t)) return 'Personal Finance & Tax';
  if (/(nasdaq|dow jones|s&p|wall street|us stock|federal reserve|\bfed\b)/.test(t)) return 'US Markets';
  if (/(nifty|sensex|\bbse\b|\bnse\b|sebi|\brbi\b|rupee|indian)/.test(t)) return 'Indian Markets';
  if (/(mutual fund|valuation|p\/e|fundamental|portfolio|etf)/.test(t)) return 'Investing & Valuation';
  return undefined;
}

async function fromNewsApi(): Promise<Candidate[]> {
  if (!NEWSAPI_KEY) { console.log('[discover] no NEWSAPI_KEY — skipping NewsAPI'); return []; }
  const q = '(stock market OR nifty OR sensex OR nasdaq OR "S&P 500" OR IPO OR mutual fund OR crypto OR RBI OR SEBI)';
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=en&sortBy=publishedAt&pageSize=40`;
  const r = await fetch(url, { headers: { 'X-Api-Key': NEWSAPI_KEY } });
  if (!r.ok) { console.warn(`[discover] NewsAPI ${r.status}`); return []; }
  const data = (await r.json()) as any;
  return (data.articles ?? []).map((a: any) => ({
    title: (a.title ?? '').replace(/\s+-\s+[^-]+$/, '').trim(),
    summary: a.description ?? '',
    url: a.url,
    source: a.source?.name ?? 'NewsAPI',
    imageUrl: a.urlToImage ?? undefined,
    publishedAt: a.publishedAt,
  })).filter((c: Candidate) => c.title && c.url);
}

function extractImage(it: any, descHtml: string): string | undefined {
  const mc = it['media:content'] ?? it['media:thumbnail'];
  if (mc) for (const m of (Array.isArray(mc) ? mc : [mc])) if (m?.['@_url']) return String(m['@_url']);
  const enc = it.enclosure;
  if (enc) for (const e of (Array.isArray(enc) ? enc : [enc])) if (String(e?.['@_type'] ?? '').startsWith('image/') && e?.['@_url']) return String(e['@_url']);
  const m = descHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : undefined;
}

async function fetchRss(feedUrl: string, sourceName: string): Promise<Candidate[]> {
  try {
    const r = await fetch(feedUrl, { headers: { 'User-Agent': 'wealthymonk-agent/1.0' } });
    if (!r.ok) return [];
    const xml = await r.text();
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const parsed = parser.parse(xml);
    const items = parsed?.rss?.channel?.item ?? parsed?.feed?.entry ?? [];
    const list = Array.isArray(items) ? items : [items];
    return list.map((it: any) => {
      const title = String(it.title?.['#text'] ?? it.title ?? '').trim();
      const link = String(it.link?.['@_href'] ?? it.link ?? '').trim();
      const descRaw = String(it.description ?? it.summary ?? it['content:encoded'] ?? '');
      const summary = descRaw.replace(/<[^>]+>/g, '').trim().slice(0, 400);
      const date = String(it.pubDate ?? it.published ?? it.updated ?? new Date().toISOString());
      return { title, summary, url: link, source: sourceName, imageUrl: extractImage(it, descRaw), publishedAt: new Date(date).toISOString() } as Candidate;
    }).filter((c: Candidate) => c.title && c.url);
  } catch { return []; }
}

export async function discover(): Promise<Candidate[]> {
  const buckets = await Promise.all([
    fromNewsApi().catch(() => []),
    ...RSS_FEEDS.map((f) => fetchRss(f.url, f.name)),
  ]);
  const seen = new Map<string, Candidate>();
  for (const c of buckets.flat()) {
    if (c.url && !seen.has(c.url)) seen.set(c.url, c);
  }
  const filtered = [...seen.values()]
    .filter((c) => isFinance(c.title + ' ' + c.summary))
    .map((c) => ({ ...c, category: c.category ?? guessCategory(c.title + ' ' + c.summary) }));
  filtered.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return filtered;
}

if (process.argv[1]?.endsWith('discover.ts')) {
  discover().then((list) => {
    console.log(`Found ${list.length} finance candidates`);
    for (const c of list.slice(0, 12)) console.log(`  [${c.source}] (${c.category ?? '?'}) ${c.title}`);
  });
}
