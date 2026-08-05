/**
 * Market data layer — pulls real end-of-day quotes from Yahoo Finance's free
 * chart API (no key, works in CI). Powers the report's snapshot boxes, data
 * tables, and bar-chart exhibits so those are grounded in real numbers rather
 * than the model's memory.
 *
 * We use the per-symbol chart endpoint (/v8/finance/chart/<sym>) — the batch
 * quote endpoint now requires a crumb/cookie and is unreliable from CI.
 */

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  prevClose: number;
  changePct: number;
  currency?: string;
}

const YF = 'https://query1.finance.yahoo.com/v8/finance/chart/';

export async function fetchQuote(symbol: string, displayName?: string): Promise<Quote | null> {
  try {
    const r = await fetch(`${YF}${encodeURIComponent(symbol)}?interval=1d&range=2d`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (wealthymonk-agent)' },
    });
    if (!r.ok) return null;
    const d = (await r.json()) as any;
    const m = d?.chart?.result?.[0]?.meta;
    if (!m) return null;
    const price = m.regularMarketPrice;
    const prevClose = m.chartPreviousClose ?? m.previousClose;
    if (typeof price !== 'number' || typeof prevClose !== 'number' || !prevClose) return null;
    return {
      symbol,
      name: displayName ?? m.shortName ?? symbol,
      price,
      prevClose,
      changePct: ((price - prevClose) / prevClose) * 100,
      currency: m.currency,
    };
  } catch {
    return null;
  }
}

/** Fetch many symbols with limited concurrency; drops any that fail. */
async function fetchAll(pairs: { symbol: string; name: string }[], concurrency = 8): Promise<Quote[]> {
  const out: Quote[] = [];
  let i = 0;
  async function worker() {
    while (i < pairs.length) {
      const p = pairs[i++];
      const q = await fetchQuote(p.symbol, p.name);
      if (q) out.push(q);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pairs.length) }, worker));
  // Preserve the requested order (concurrency scrambles it).
  const order = new Map(pairs.map((p, idx) => [p.symbol, idx]));
  out.sort((a, b) => (order.get(a.symbol) ?? 0) - (order.get(b.symbol) ?? 0));
  return out;
}

type SymPair = { symbol: string; name: string };
const P = (symbol: string, name: string): SymPair => ({ symbol, name });

// ── Region symbol maps ───────────────────────────────────────────────────────

const INDIA = {
  headline: [P('^NSEI', 'Nifty 50'), P('^BSESN', 'Sensex'), P('^NSEBANK', 'Nifty Bank')],
  indices: [
    P('^NSEI', 'Nifty 50'), P('^BSESN', 'Sensex'), P('^NSEBANK', 'Nifty Bank'),
    P('^NSMIDCP', 'Nifty Next 50'), P('^CRSLDX', 'Nifty 500'), P('^CNXMIDCAP', 'Nifty Midcap'),
  ],
  sectors: [
    P('^CNXIT', 'Nifty IT'), P('^CNXAUTO', 'Nifty Auto'), P('^CNXFMCG', 'Nifty FMCG'),
    P('^CNXPHARMA', 'Nifty Pharma'), P('^CNXMETAL', 'Nifty Metal'), P('^CNXREALTY', 'Nifty Realty'),
    P('^CNXENERGY', 'Nifty Energy'), P('^CNXFIN', 'Nifty Financial Services'),
    P('^CNXPSUBANK', 'Nifty PSU Bank'), P('^CNXINFRA', 'Nifty Infra'),
  ],
  // Nifty-50 constituents (.NS) for computing top gainers/losers.
  constituents: [
    'RELIANCE', 'TCS', 'HDFCBANK', 'ICICIBANK', 'INFY', 'BHARTIARTL', 'SBIN', 'HINDUNILVR',
    'ITC', 'LT', 'BAJFINANCE', 'KOTAKBANK', 'AXISBANK', 'HCLTECH', 'MARUTI', 'SUNPHARMA',
    'M&M', 'TITAN', 'ULTRACEMCO', 'NTPC', 'ASIANPAINT', 'WIPRO', 'ONGC', 'TATAMOTORS',
    'POWERGRID', 'ADANIENT', 'ADANIPORTS', 'COALINDIA', 'BAJAJFINSV', 'NESTLEIND', 'TATASTEEL',
    'JSWSTEEL', 'TECHM', 'HINDALCO', 'GRASIM', 'INDUSINDBK', 'DRREDDY', 'CIPLA', 'BAJAJ-AUTO',
    'EICHERMOT', 'BRITANNIA', 'HEROMOTOCO', 'DIVISLAB', 'TATACONSUM', 'APOLLOHOSP', 'BPCL',
  ].map((s) => P(`${s}.NS`, s.replace(/\.NS$/, ''))),
  commodities: [
    P('GC=F', 'Gold'), P('SI=F', 'Silver'), P('CL=F', 'Crude Oil (WTI)'),
    P('BZ=F', 'Brent Crude'), P('NG=F', 'Natural Gas'), P('HG=F', 'Copper'),
  ],
  fx: [P('INR=X', 'USD/INR'), P('EURINR=X', 'EUR/INR'), P('GBPINR=X', 'GBP/INR')],
  bonds: [P('^TNX', 'US 10Y Yield')],
  global: [
    P('^GSPC', 'S&P 500'), P('^IXIC', 'Nasdaq'), P('^DJI', 'Dow Jones'),
    P('^FTSE', 'FTSE 100'), P('^N225', 'Nikkei 225'), P('^HSI', 'Hang Seng'), P('000001.SS', 'Shanghai'),
  ],
};

const US = {
  headline: [P('^GSPC', 'S&P 500'), P('^DJI', 'Dow Jones'), P('^IXIC', 'Nasdaq Composite')],
  indices: [
    P('^GSPC', 'S&P 500'), P('^DJI', 'Dow Jones'), P('^IXIC', 'Nasdaq Composite'),
    P('^NDX', 'Nasdaq 100'), P('^RUT', 'Russell 2000'), P('^VIX', 'VIX (volatility)'),
  ],
  sectors: [
    P('XLK', 'Technology'), P('XLF', 'Financials'), P('XLE', 'Energy'), P('XLV', 'Health Care'),
    P('XLY', 'Consumer Disc.'), P('XLP', 'Consumer Staples'), P('XLI', 'Industrials'),
    P('XLB', 'Materials'), P('XLU', 'Utilities'), P('XLRE', 'Real Estate'), P('XLC', 'Communication'),
  ],
  constituents: [
    'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'BRK-B', 'LLY', 'AVGO',
    'JPM', 'V', 'XOM', 'UNH', 'MA', 'JNJ', 'PG', 'HD', 'COST', 'MRK', 'ABBV', 'CVX',
    'PEP', 'KO', 'ADBE', 'WMT', 'BAC', 'CRM', 'NFLX', 'AMD', 'ORCL', 'INTC', 'DIS',
    'CSCO', 'MCD', 'WFC', 'QCOM', 'TXN', 'PFE', 'BA', 'NKE', 'GE', 'CAT', 'GS',
  ].map((s) => P(s, s)),
  commodities: [
    P('GC=F', 'Gold'), P('SI=F', 'Silver'), P('CL=F', 'Crude Oil (WTI)'),
    P('BZ=F', 'Brent Crude'), P('NG=F', 'Natural Gas'), P('HG=F', 'Copper'),
  ],
  fx: [P('DX-Y.NYB', 'US Dollar Index'), P('EURUSD=X', 'EUR/USD'), P('USDJPY=X', 'USD/JPY'), P('GBPUSD=X', 'GBP/USD')],
  bonds: [P('^IRX', 'US 13-Week'), P('^FVX', 'US 5Y Yield'), P('^TNX', 'US 10Y Yield'), P('^TYX', 'US 30Y Yield')],
  global: [
    P('^FTSE', 'FTSE 100'), P('^GDAXI', 'DAX'), P('^FCHI', 'CAC 40'),
    P('^N225', 'Nikkei 225'), P('^HSI', 'Hang Seng'), P('000001.SS', 'Shanghai'), P('^KS11', 'KOSPI'),
  ],
};

const REGION_MAP = { india: INDIA, us: US } as const;
export type MarketRegion = keyof typeof REGION_MAP;

export interface MarketData {
  headline: Quote[];
  indices: Quote[];
  sectors: Quote[];
  gainers: Quote[];
  losers: Quote[];
  commodities: Quote[];
  fx: Quote[];
  bonds: Quote[];
  global: Quote[];
  asOf: string; // ISO timestamp of fetch
}

/** Pull the full data set for a region. Missing symbols are silently dropped. */
export async function fetchMarketData(region: MarketRegion): Promise<MarketData> {
  const map = REGION_MAP[region];
  const [headline, indices, sectors, constituents, commodities, fx, bonds, global] = await Promise.all([
    fetchAll(map.headline),
    fetchAll(map.indices),
    fetchAll(map.sectors),
    fetchAll(map.constituents, 10),
    fetchAll(map.commodities),
    fetchAll(map.fx),
    fetchAll(map.bonds),
    fetchAll(map.global),
  ]);
  const ranked = [...constituents].sort((a, b) => b.changePct - a.changePct);
  const gainers = ranked.slice(0, 5);
  const losers = ranked.slice(-5).reverse();
  return {
    headline, indices, sectors, gainers, losers, commodities, fx, bonds, global,
    asOf: new Date().toISOString(),
  };
}

/** The region's 2-3 headline indices — context for a single-ticker snapshot. */
export async function regionHeadlines(region: MarketRegion): Promise<Quote[]> {
  return fetchAll(REGION_MAP[region].headline);
}

if (process.argv[1]?.endsWith('market-data.ts')) {
  const region = (process.argv[2] as MarketRegion) || 'india';
  fetchMarketData(region).then((d) => {
    const line = (q: Quote) => `    ${q.name.padEnd(22)} ${q.price.toFixed(2).padStart(12)}  ${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%`;
    for (const [k, v] of Object.entries(d)) {
      if (!Array.isArray(v)) continue;
      console.log(`  ${k} (${v.length}):`);
      for (const q of v) console.log(line(q));
    }
  });
}
