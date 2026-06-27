import type { SeedTopic } from './topics.ts';

export type Stream = 'evergreen' | 'news';
export interface DayCounts { evergreen: number; news: number; }
export interface Quota { evergreen: number; news: number; }

// Tie-break: evergreen (compounding SEO) before news.
const PRIORITY: Stream[] = ['evergreen', 'news'];

/** Pick the stream furthest behind its daily quota; null when both are met. */
export function chooseStream(counts: DayCounts, quota: Quota): Stream | null {
  const ranked = PRIORITY
    .map((c) => ({ c, remaining: quota[c] - counts[c] }))
    .filter((x) => x.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining || PRIORITY.indexOf(a.c) - PRIORITY.indexOf(b.c));
  return ranked.length ? ranked[0].c : null;
}

/** First seed topic whose key is not yet covered in Notion. */
export function pickEvergreenTopic(topics: SeedTopic[], coveredKeys: Set<string>): SeedTopic | null {
  return topics.find((t) => !coveredKeys.has(t.key)) ?? null;
}
