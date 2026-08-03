/**
 * Deterministic SVG chart generator for the daily market report — no chart
 * library, no image hosting. Produces a self-contained, theme-safe (light card)
 * horizontal bar chart as an inline <svg> string. It is embedded in the post
 * body inside an ```html fenced block so it round-trips Notion → MDX and renders
 * as a real chart on the site (see blocks-to-mdx html passthrough).
 */

export interface BarItem {
  label: string;
  value: number;      // used for bar length + color sign
  display?: string;   // label shown at the bar end (defaults to value)
}

const GREEN = '#16a34a';
const RED = '#dc2626';
const AXIS = '#94a3b8';
const TEXT = '#1a2027';
const MUTED = '#64748b';
const CARD = '#ffffff';
const BORDER = '#e5e7eb';

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Diverging horizontal bar chart: positive values extend right (green),
 * negative left (red), from a zero baseline. Good for % changes and signed
 * magnitudes. For all-positive data it simply reads as a normal bar chart.
 */
export function barChartSVG(title: string, items: BarItem[], opts: { caption?: string } = {}): string {
  const rows = items.filter((i) => Number.isFinite(i.value));
  if (!rows.length) return '';

  const W = 720;
  const padX = 16, padTop = 46, rowH = 30, gap = 8, padBottom = opts.caption ? 34 : 16;
  const labelW = 168;         // left label column
  const valueW = 62;          // right value column
  const plotX = padX + labelW;
  const plotW = W - plotX - valueW - padX;
  const H = padTop + rows.length * (rowH + gap) - gap + padBottom;

  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.value)), 1e-9);
  const hasNeg = rows.some((r) => r.value < 0);
  // Zero baseline: centered when data has negatives, left-aligned otherwise.
  const zeroX = hasNeg ? plotX + plotW / 2 : plotX;
  const halfW = hasNeg ? plotW / 2 : plotW;

  const parts: string[] = [];
  // Explicit viewBox + width/height so it renders correctly both inline and as a
  // data-URI <img> on the site. A background <rect> (not CSS) guarantees the card
  // look in every rendering context.
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" ` +
      `aria-label="${esc(title)}" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif">`
  );
  parts.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="${CARD}" stroke="${BORDER}"/>`);
  parts.push(`<text x="${padX}" y="26" font-size="15" font-weight="700" fill="${TEXT}">${esc(title)}</text>`);
  // zero axis
  parts.push(`<line x1="${zeroX.toFixed(1)}" y1="${padTop - 8}" x2="${zeroX.toFixed(1)}" y2="${(H - padBottom).toFixed(1)}" stroke="${AXIS}" stroke-width="1" stroke-dasharray="${hasNeg ? '0' : '2 3'}"/>`);

  rows.forEach((r, i) => {
    const y = padTop + i * (rowH + gap);
    const cy = y + rowH / 2;
    const w = (Math.abs(r.value) / maxAbs) * (halfW - 6);
    const color = r.value < 0 ? RED : GREEN;
    const x = r.value < 0 ? zeroX - w : zeroX;
    parts.push(`<text x="${padX}" y="${(cy + 4).toFixed(1)}" font-size="12.5" fill="${TEXT}">${esc(r.label)}</text>`);
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(w, 1).toFixed(1)}" height="${rowH}" rx="3" fill="${color}" opacity="0.9"/>`);
    const disp = r.display ?? (r.value > 0 ? '+' : '') + r.value.toFixed(2);
    parts.push(`<text x="${(W - padX).toFixed(1)}" y="${(cy + 4).toFixed(1)}" font-size="12.5" font-weight="600" text-anchor="end" fill="${color}">${esc(disp)}</text>`);
  });

  if (opts.caption) {
    parts.push(`<text x="${padX}" y="${(H - 12).toFixed(1)}" font-size="11.5" fill="${MUTED}">${esc(opts.caption)}</text>`);
  }
  parts.push('</svg>');
  // Wrap so it sits as its own block; the leading/trailing newlines keep the
  // fenced ```html block clean when assembled into the markdown body.
  return parts.join('');
}

/** Wrap an SVG (or any safe HTML) as a fenced html code block for the body. */
export function htmlBlock(html: string): string {
  return '```html\n' + html + '\n```';
}
