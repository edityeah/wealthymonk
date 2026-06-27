export const SITE = {
  title: 'The Wealthy Monk',
  tagline: 'Healthier wallet, happier you!',
  description:
    'Calm, jargon-free guidance on markets, investing, insurance and money decisions — for a healthier wallet and a happier you.',
  url: 'https://wealthymonk.org',
  author: 'The Wealthy Monk',
  locale: 'en_IN',
  twitter: '@wealthy_monk',
  logo: 'https://wealthymonk.org/favicon.svg',
  defaultImage: 'https://wealthymonk.org/og-default.png',
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

export function abs(path?: string): string | undefined {
  if (!path) return undefined;
  return /^https?:\/\//.test(path) ? path : new URL(path, SITE.url).href;
}

/** Sitewide Organization + WebSite JSON-LD (rendered on every page). */
export function siteSchema() {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: SITE.title,
      url: SITE.url,
      logo: SITE.logo,
      description: SITE.description,
      sameAs: [SITE.social.facebook, SITE.social.instagram, SITE.social.x],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE.title,
      url: SITE.url,
      description: SITE.description,
      inLanguage: 'en',
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${SITE.url}/search/?q={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    },
  ];
}

/** BlogPosting JSON-LD for a post page. */
export function articleSchema(opts: {
  title: string;
  description?: string;
  url: string;
  image?: string;
  datePublished: string;
  dateModified?: string;
  section?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: opts.title.slice(0, 110),
    description: opts.description,
    image: opts.image ? [opts.image] : undefined,
    datePublished: opts.datePublished,
    dateModified: opts.dateModified ?? opts.datePublished,
    articleSection: opts.section,
    mainEntityOfPage: { '@type': 'WebPage', '@id': opts.url },
    author: { '@type': 'Organization', name: SITE.author, url: SITE.url },
    publisher: {
      '@type': 'Organization',
      name: SITE.title,
      logo: { '@type': 'ImageObject', url: SITE.logo },
    },
  };
}

/** BreadcrumbList JSON-LD from [{name, url}] crumbs. */
export function breadcrumbSchema(crumbs: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: abs(c.url),
    })),
  };
}
