/**
 * Evergreen finance seed backlog across the 6 site categories. The planner
 * picks the next topic whose key is not yet in Notion. Stable source of topics;
 * edit freely to steer what the agent writes.
 */
import { canonicalKey } from './topic-key.ts';
import type { Category } from './generate.ts';

export interface SeedTopic {
  key: string;
  title: string;          // working title; the model may refine
  brief: string;          // what the guide must cover
  category: Category;     // one of the 6 site categories
  coverQueries: string[]; // photogenic, finance-relevant cover subjects
  tags: string[];
  searchHints: string[];
}

type Seed = Omit<SeedTopic, 'key'> & { keyParts: string[] };

const SEEDS: Seed[] = [
  // ── Indian Markets ──────────────────────────────────────────────────────
  { keyParts: ['guide', 'how-stock-market-works-india'], category: 'Indian Markets',
    title: 'How the Stock Market Works in India: A Beginner’s Guide',
    brief: 'NSE/BSE, SEBI, demat & trading accounts, how an order is placed and settled (T+1), indices (Nifty 50, Sensex), and how a beginner actually starts. Concrete and current.',
    coverQueries: ['Bombay Stock Exchange building Mumbai', 'stock market trading screen India', 'NSE India'],
    tags: ['Indian Stock Market', 'Investing', 'Beginners'], searchHints: ['how stock market works india'] },
  { keyParts: ['guide', 'open-demat-account-india'], category: 'Indian Markets',
    title: 'How to Open a Demat Account in India: Step-by-Step',
    brief: 'What a demat + trading account is, documents (PAN, Aadhaar, bank), choosing a broker (discount vs full-service), charges, and the online KYC process.',
    coverQueries: ['person using trading app phone', 'stock charts smartphone', 'Indian rupee and phone'],
    tags: ['Indian Stock Market', 'Demat', 'Beginners'], searchHints: ['how to open demat account'] },
  { keyParts: ['guide', 'nifty-50-sensex-explained'], category: 'Indian Markets',
    title: 'Nifty 50 and Sensex Explained: What the Indices Really Mean',
    brief: 'What the indices track, how they are calculated, free-float weighting, what moves them, and how to invest in them via index funds/ETFs.',
    coverQueries: ['stock market index board green red', 'financial charts screen', 'trading floor'],
    tags: ['Indian Stock Market', 'Index', 'Nifty', 'Sensex'], searchHints: ['nifty 50 vs sensex'] },

  // ── US Markets ──────────────────────────────────────────────────────────
  { keyParts: ['guide', 'invest-us-stocks-from-india'], category: 'US Markets',
    title: 'How to Invest in US Stocks from India',
    brief: 'LRS limits, platforms that allow US investing, taxation (TCS, capital gains, dividend withholding), currency conversion, and fractional shares. Practical for Indian investors.',
    coverQueries: ['New York Stock Exchange Wall Street', 'US stock market screen', 'American flag finance'],
    tags: ['US Stock Market', 'Investing', 'India'], searchHints: ['how to invest in us stocks from india'] },
  { keyParts: ['guide', 'sp500-explained'], category: 'US Markets',
    title: 'What Is the S&P 500 and How Do You Invest in It?',
    brief: 'What the S&P 500 is, how it is weighted, historical returns, and how investors (incl. from India) get exposure via index funds/ETFs.',
    coverQueries: ['Wall Street New York', 'S&P 500 chart screen', 'stock exchange building'],
    tags: ['US Stock Market', 'Index', 'S&P 500'], searchHints: ['what is the s&p 500'] },

  // ── Investing & Valuation ────────────────────────────────────────────────
  { keyParts: ['guide', 'what-is-mutual-fund'], category: 'Investing & Valuation',
    title: 'What Is a Mutual Fund? A Plain-English Guide',
    brief: 'Types (equity/debt/hybrid/index), NAV, expense ratio, direct vs regular plans, SIP vs lumpsum, taxation, and how to pick one. For Indian investors.',
    coverQueries: ['savings growth coins plant', 'financial planning calculator', 'investment chart'],
    tags: ['Investing', 'Mutual Funds', 'SIP'], searchHints: ['what is a mutual fund'] },
  { keyParts: ['guide', 'read-pe-ratio'], category: 'Investing & Valuation',
    title: 'How to Read the P/E Ratio (and Its Limits)',
    brief: 'What price-to-earnings means, trailing vs forward, how to compare across sectors, when a low/high P/E misleads, and other ratios to pair it with.',
    coverQueries: ['financial analysis charts laptop', 'calculator and financial report', 'stock valuation screen'],
    tags: ['Fundamental Analysis', 'Valuation', 'Investing'], searchHints: ['what is pe ratio'] },
  { keyParts: ['guide', 'compounding-explained'], category: 'Investing & Valuation',
    title: 'The Power of Compounding: Why Starting Early Wins',
    brief: 'How compounding works with a concrete rupee example, the rule of 72, why time beats timing, and what it means for SIPs and long-term investing.',
    coverQueries: ['money growth chart upward', 'piggy bank savings', 'coins stacked growth'],
    tags: ['Investing', 'Compounding', 'Personal Finance'], searchHints: ['power of compounding'] },

  // ── Crypto ──────────────────────────────────────────────────────────────
  { keyParts: ['guide', 'crypto-tax-india'], category: 'Crypto',
    title: 'Crypto Tax in India: What You Need to Know',
    brief: 'The 30% tax on gains, 1% TDS, no loss set-off, how it applies to trading/airdrops, and reporting. Current rules, clearly explained — not advice.',
    coverQueries: ['bitcoin coin physical', 'cryptocurrency chart screen', 'crypto trading phone'],
    tags: ['Crypto Currency', 'Tax', 'India'], searchHints: ['crypto tax india 30 percent'] },
  { keyParts: ['guide', 'what-is-bitcoin'], category: 'Crypto',
    title: 'What Is Bitcoin? A Beginner’s Explainer',
    brief: 'What Bitcoin is, blockchain basics, wallets and exchanges, volatility and risk, and how Indians can buy it legally. Balanced, risk-aware.',
    coverQueries: ['bitcoin gold coin', 'blockchain network abstract', 'cryptocurrency wallet phone'],
    tags: ['Crypto Currency', 'Bitcoin', 'Beginners'], searchHints: ['what is bitcoin'] },

  // ── Insurance ───────────────────────────────────────────────────────────
  { keyParts: ['guide', 'term-vs-whole-life'], category: 'Insurance',
    title: 'Term Insurance vs Whole Life: Which Should You Buy?',
    brief: 'How term and whole-life differ, why term is usually the better value for pure protection, sum-assured rules of thumb, riders, and common mistakes.',
    coverQueries: ['family protection umbrella concept', 'insurance policy document signing', 'family financial planning'],
    tags: ['Insurance', 'Term Insurance', 'Life Insurance'], searchHints: ['term vs whole life insurance'] },
  { keyParts: ['guide', 'health-insurance-india-guide'], category: 'Insurance',
    title: 'Health Insurance in India: How to Choose the Right Policy',
    brief: 'Sum insured, individual vs family floater, room-rent limits, co-pay, waiting periods, network hospitals, and claim process. Practical buyer’s guide.',
    coverQueries: ['health insurance stethoscope documents', 'hospital reception', 'medical insurance form'],
    tags: ['Insurance', 'Health Insurance', 'India'], searchHints: ['how to choose health insurance india'] },

  // ── Personal Finance & Tax ───────────────────────────────────────────────
  { keyParts: ['guide', 'tax-saving-80c'], category: 'Personal Finance & Tax',
    title: 'Section 80C and Beyond: Tax-Saving Options for Salaried Indians',
    brief: 'The ₹1.5L 80C basket (ELSS, PPF, EPF, life insurance, etc.), 80D, NPS 80CCD(1B), old vs new regime trade-off, and how to actually plan it.',
    coverQueries: ['tax documents calculator pen', 'income tax form India', 'financial planning desk'],
    tags: ['Tax Savings', 'Personal Finance', 'India'], searchHints: ['80c tax saving options'] },
  { keyParts: ['guide', 'emergency-fund'], category: 'Personal Finance & Tax',
    title: 'How to Build an Emergency Fund (and Where to Keep It)',
    brief: 'Why you need 3–6 months of expenses, how to size it, where to park it (liquid funds, sweep FDs, savings), and how to build it on a salary.',
    coverQueries: ['savings jar emergency money', 'piggy bank coins', 'budgeting notebook calculator'],
    tags: ['Personal Finance', 'Savings', 'Budgeting'], searchHints: ['how to build emergency fund'] },
  { keyParts: ['guide', 'financial-planning-20s'], category: 'Personal Finance & Tax',
    title: 'Financial Planning in Your 20s: A Practical Roadmap',
    brief: 'Budgeting, emergency fund, first investments (SIPs), term + health insurance, avoiding lifestyle inflation and bad debt. Concrete steps for young earners.',
    coverQueries: ['young person budgeting laptop', 'savings planning notebook', 'financial goals planning'],
    tags: ['Personal Finance', 'Investing', 'Beginners'], searchHints: ['financial planning in your 20s'] },
];

export function seedTopics(): SeedTopic[] {
  return SEEDS.map((s) => ({
    key: canonicalKey(s.keyParts),
    title: s.title,
    brief: s.brief,
    category: s.category,
    coverQueries: s.coverQueries,
    tags: s.tags,
    searchHints: s.searchHints,
  }));
}
