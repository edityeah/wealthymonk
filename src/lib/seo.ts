export const SITE = {
  title: 'The Wealthy Monk',
  tagline: 'Healthier wallet, happier you!',
  description:
    'Calm, jargon-free guidance on markets, investing, insurance and money decisions — for a healthier wallet and a happier you.',
  url: 'https://wealthymonk.org',
  author: 'The Wealthy Monk',
  social: {
    facebook: 'https://www.facebook.com/wealthymonk/',
    instagram: 'https://www.instagram.com/',
    x: 'https://twitter.com/wealthy_monk',
  },
};

export function pageTitle(title?: string): string {
  return title ? `${title} — ${SITE.title}` : `${SITE.title} — ${SITE.tagline}`;
}

export function canonical(pathname: string): string {
  const p = pathname.endsWith('/') || pathname.includes('.') ? pathname : `${pathname}/`;
  return new URL(p, SITE.url).href;
}
