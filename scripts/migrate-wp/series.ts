const SERIES_CATS = new Set(['InvestED', 'Introduction to Stock Markets']);

export function detectSeries(
  title: string,
  wpCats: string[],
): { series: 'InvestED'; seriesOrder: number } | null {
  const inSeries = wpCats.some((c) => SERIES_CATS.has(c));
  if (!inSeries) return null;
  const m = title.match(/Chapter\s+(\d+)/i);
  const seriesOrder = m ? Number(m[1]) : 0;
  return { series: 'InvestED', seriesOrder };
}
