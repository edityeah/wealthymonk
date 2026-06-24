export const CATEGORIES = [
  'Indian Markets',
  'US Markets',
  'Investing & Valuation',
  'Crypto',
  'Insurance',
  'Personal Finance & Tax',
] as const;

export type Category = (typeof CATEGORIES)[number];

export function slugifyTag(input: string): string {
  return input
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
