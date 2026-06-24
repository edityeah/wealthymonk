import type { Category } from '../../src/lib/categories.ts';

// Original WordPress category -> consolidated category.
const MAP: Record<string, Category> = {
  'Indian Stock Market': 'Indian Markets',
  'US Stock Market': 'US Markets',
  Investing: 'Investing & Valuation',
  Investments: 'Investing & Valuation',
  'Fundamental Analysis': 'Investing & Valuation',
  'Stock Market': 'Investing & Valuation',
  'Crypto Currency': 'Crypto',
  Insurance: 'Insurance',
  'Health Insurance': 'Insurance',
  'Home Insurance': 'Insurance',
  'Motor Insurance': 'Insurance',
  'Pet Insurance': 'Insurance',
  'Travel Insurance': 'Insurance',
  'Senior Health Care': 'Insurance',
  'Tax Savings': 'Personal Finance & Tax',
};

// Higher index = higher priority when a post carries several categories.
const PRECEDENCE: Category[] = [
  'Personal Finance & Tax',
  'Investing & Valuation',
  'Indian Markets',
  'US Markets',
  'Crypto',
  'Insurance',
];

// Categories that exist only as the InvestED series — never browse cats or tags.
const SERIES_CATS = new Set(['InvestED', 'Introduction to Stock Markets']);

export function mapCategory(wpCats: string[]): Category {
  const mapped = wpCats.map((c) => MAP[c]).filter(Boolean) as Category[];
  if (mapped.length === 0) return 'Investing & Valuation';
  return mapped.sort((a, b) => PRECEDENCE.indexOf(b) - PRECEDENCE.indexOf(a))[0];
}

export function toTags(wpCats: string[]): string[] {
  return wpCats.filter((c) => !SERIES_CATS.has(c));
}
