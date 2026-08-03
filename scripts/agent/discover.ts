/**
 * Find timely finance/markets stories, split by region (India vs US).
 *
 * Sources: NewsAPI (business/market query) + region-tagged finance RSS feeds.
 * `discoverByRegion()` returns two newest-first, finance-filtered buckets so the
 * agent can write one Indian-market brief and one US-market brief per day.
 */
import { XMLParser } from 'fast-xml-parser';
import type { Category } from './generate.js';

const NEWSAPI_KEY = process.env.NEWSAPI_KEY;

export type Region = 'india' | 'us';

export interface Candidate {
  title: string;
  summary: string;
  url: string;
  source: string;
  imageUrl?: string;
  publishedAt: string; // ISO
  category?: Category;
  region?: Region;
}

// Region-tagged RSS feeds. The tag is a default; a story is re-classified by
// keyword when its content clearly belongs to the other region.
const RSS_FEEDS: { name: string; url: string; region: Region }[] = [
  // India
  { name: 'Moneycontrol Markets', url: 'https://www.moneycontrol.com/rss/marketreports.xml', region: 'india' },
  { name: 'Economic Times Markets', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', region: 'india' },
  { name: 'Livemint Markets', url: 'https://www.livemint.com/rss/markets', region: 'india' },
  { name: 'Business Standard Markets', url: 'https://www.business-standard.com/rss/markets-106.rss', region: 'india' },
  // US
  { name: 'CNBC Markets', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258', region: 'us' },
  { name: 'CNBC US Markets', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069', region: 'us' },
  { name: 'MarketWatch Top Stories', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', region: 'us' },
  { name: 'Investing.com Stock News', url: 'https://www.investing.com/rss/news_25.rss', region: 'us' },
];

// Finance relevance filter (broad; covers Indian + US markets, crypto, etc.).
const FIN_KEYWORDS = [
  'stock', 'share', 'market', 'nifty', 'sensex', 'bse', 'nse', 'ipo', 'sebi',
  'rbi', 'mutual fund', 'sip', 'index', 'nasdaq', 'dow', 's&p', 'fed', 'rate',
  'earnings', 'dividend', 'bond', 'yield', 'crypto', 'bitcoin', 'ethereum',
  'rupee', 'dollar', 'inflation', 'gdp', 'investor', 'investment', 'insurance',
  'tax', 'fund', 'equity', 'valuation', 'fii', 'dii', 'wall street', 'treasury',
];
function isFinance(text: string): boolean {
  const t = text.toLowerCase();
  return FIN_KEYWORDS.some((kw) => t.includes(kw));
}

// Region signals. A market brief only wants stories that clearly belong to one
// market, so we score India vs US mentions and take the stronger side.
const INDIA_KW = [
  'nifty', 'sensex', 'bse', 'nse', 'sebi', 'rbi', 'rupee', 'dalal street',
  'mumbai', 'gift nifty', 'bank nifty', 'fii', 'dii', 'adani', 'ambani',
  'reliance', 'tata', 'infosys', 'hdfc', 'icici', 'sip', 'india', 'indian',
];
const US_KW = [
  'nasdaq', 'dow jones', 'dow ', 's&p', 'wall street', 'federal reserve',
  'the fed', 'fed ', 'powell', 'nyse', 'treasury', 'nvidia', 'apple', 'tesla',
  'microsoft', 'u.s.', 'us stock', 'american', 'wall st',
];
function countHits(text: string, kws: string[]): number {
  const t = text.toLowerCase();
  let n = 0;
  for (const k of kws) if (t.includes(k)) n++;
  return n;
}
/** Decide a candidate's market region; falls back to the feed's default tag. */
function classifyRegion(text: string, feedRegion?: Region): Region | undefined {
  const india = countHits(text, INDIA_KW);
  const us = countHits(text, US_KW);
  if (india > us) return 'india';
  if (us > india) return 'us';
  return feedRegion; // tie (incl. 0-0) → trust the source
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
  const q = '(stock market OR nifty OR sensex OR nasdaq OR "S&P 500" OR "Dow Jones" OR IPO OR "Federal Reserve" OR RBI OR SEBI OR "Wall Street")';
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=en&sortBy=publishedAt&pageSize=60`;
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

async function fetchRss(feedUrl: string, sourceName: string, region: Region): Promise<Candidate[]> {
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
      return { title, summary, url: link, source: sourceName, imageUrl: extractImage(it, descRaw), publishedAt: new Date(date).toISOString(), region } as Candidate;
    }).filter((c: Candidate) => c.title && c.url);
  } catch { return []; }
}

/** All finance candidates (both regions), newest first, region + category tagged. */
export async function discover(): Promise<Candidate[]> {
  const buckets = await Promise.all([
    fromNewsApi().catch(() => []),
    ...RSS_FEEDS.map((f) => fetchRss(f.url, f.name, f.region)),
  ]);
  const seen = new Map<string, Candidate>();
  for (const c of buckets.flat()) {
    if (c.url && !seen.has(c.url)) seen.set(c.url, c);
  }
  const filtered = [...seen.values()]
    .filter((c) => isFinance(c.title + ' ' + c.summary))
    .map((c) => {
      const text = c.title + ' ' + c.summary;
      return {
        ...c,
        category: c.category ?? guessCategory(text),
        region: classifyRegion(text, c.region),
      };
    });
  filtered.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return filtered;
}

/** Split discovery into India and US market buckets (newest first). */
export async function discoverByRegion(): Promise<Record<Region, Candidate[]>> {
  const all = await discover();
  return {
    india: all.filter((c) => c.region === 'india'),
    us: all.filter((c) => c.region === 'us'),
  };
}

if (process.argv[1]?.endsWith('discover.ts')) {
  discoverByRegion().then((b) => {
    for (const region of ['india', 'us'] as Region[]) {
      console.log(`\n=== ${region.toUpperCase()} (${b[region].length}) ===`);
      for (const c of b[region].slice(0, 10)) console.log(`  [${c.source}] ${c.title}`);
    }
  });
}
