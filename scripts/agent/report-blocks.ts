/**
 * Turn MarketData into the report's deterministic building blocks: the market
 * snapshot, data tables (markdown pipe tables → Notion tables), and SVG
 * bar-chart exhibits. These are generated from real numbers (no LLM), then
 * interleaved with the model's prose analysis in run.ts.
 */
import type { MarketData, Quote, MarketRegion } from './market-data.js';
import { barChartSVG, htmlBlock, type BarItem } from './charts.js';

const fmtNum = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

/** Markdown pipe table. */
function mdTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
  return `${head}\n${sep}\n${body}`;
}

function quoteRows(quotes: Quote[]): string[][] {
  return quotes.map((q) => [q.name, fmtNum(q.price), fmtPct(q.changePct), fmtNum(q.prevClose)]);
}
const toBars = (quotes: Quote[]): BarItem[] =>
  quotes.map((q) => ({ label: q.name, value: q.changePct, display: fmtPct(q.changePct) }));

let exhibitN = 0;
export function resetExhibits() { exhibitN = 0; }
function exhibit(title: string, quotes: Quote[], caption: string): string {
  if (!quotes.length) return '';
  exhibitN += 1;
  const svg = barChartSVG(`Exhibit ${exhibitN}: ${title}`, toBars(quotes), { caption });
  return htmlBlock(svg);
}

// ── Snapshot ─────────────────────────────────────────────────────────────────

export function marketSnapshot(d: MarketData): string {
  const lines: string[] = ['## Market Snapshot', ''];
  if (d.headline.length) {
    lines.push(mdTable(
      ['Index', 'Close', 'Change', 'Prev Close'],
      quoteRows(d.headline),
    ));
    lines.push('');
  }
  const top = d.gainers[0], bottom = d.losers[0];
  const bits: string[] = [];
  if (top) bits.push(`**Top gainer:** ${top.name} ${fmtPct(top.changePct)}`);
  if (bottom) bits.push(`**Top loser:** ${bottom.name} ${fmtPct(bottom.changePct)}`);
  if (bits.length) lines.push(bits.join(' • '));
  return lines.join('\n');
}

// ── Data tables + exhibits ───────────────────────────────────────────────────

const REGION_LABEL: Record<MarketRegion, string> = { india: 'Indian', us: 'US' };

/** All the market-data sections, in report order, as one markdown string. */
export function marketDataSections(d: MarketData, region: MarketRegion): string {
  const label = REGION_LABEL[region];
  const stockNoun = region === 'india' ? 'Nifty-50 stocks' : 'large-cap stocks';
  const out: string[] = [];

  const section = (heading: string, quotes: Quote[], cols: string[], exhibitTitle: string, caption: string) => {
    if (!quotes.length) return;
    out.push(`### ${heading}`, '', mdTable(cols, quoteRows(quotes)), '', exhibit(exhibitTitle, quotes, caption), '');
  };

  section('Indices', d.indices, ['Index', 'Last', 'Change', 'Prev Close'],
    `${label} indices — % change`, 'Percentage change vs previous close.');

  section('Sector performance', d.sectors, ['Sector', 'Last', 'Change', 'Prev Close'],
    'Sector performance — % change', 'Sector indices ranked by daily move.');

  if (d.gainers.length) {
    out.push('### Top gainers & losers', '', `Biggest daily movers among ${stockNoun}.`, '');
    out.push(mdTable(['Stock', 'Last', 'Change', 'Prev Close'], quoteRows(d.gainers)), '');
    out.push(exhibit('Top gainers — % change', d.gainers, 'Five best performers on the day.'), '');
    out.push(mdTable(['Stock', 'Last', 'Change', 'Prev Close'], quoteRows(d.losers)), '');
    out.push(exhibit('Top losers — % change', d.losers, 'Five worst performers on the day.'), '');
  }

  section('Commodities', d.commodities, ['Commodity', 'Last', 'Change', 'Prev Close'],
    'Commodities — % change', 'Global commodity futures (USD).');

  if (d.fx.length || d.bonds.length) {
    out.push('### Currencies & bond yields', '');
    if (d.fx.length) out.push(mdTable(['Pair', 'Last', 'Change', 'Prev Close'], quoteRows(d.fx)), '');
    if (d.bonds.length) out.push(mdTable(['Instrument', 'Yield', 'Change', 'Prev'], quoteRows(d.bonds)), '');
  }

  section('Global markets', d.global, ['Index', 'Last', 'Change', 'Prev Close'],
    'Global indices — % change', 'Major world indices for context.');

  return out.filter((l) => l !== undefined).join('\n');
}

/** A compact, model-readable digest of the data so the AI can analyse it. */
export function dataDigestForModel(d: MarketData): string {
  const line = (q: Quote) => `${q.name}: ${fmtNum(q.price)} (${fmtPct(q.changePct)})`;
  const grp = (name: string, qs: Quote[]) => qs.length ? `${name}: ${qs.map(line).join('; ')}` : '';
  return [
    grp('Headline indices', d.headline),
    grp('Broad indices', d.indices),
    grp('Sectors', d.sectors),
    grp('Top gainers', d.gainers),
    grp('Top losers', d.losers),
    grp('Commodities', d.commodities),
    grp('FX', d.fx),
    grp('Bond yields', d.bonds),
    grp('Global indices', d.global),
  ].filter(Boolean).join('\n');
}
