import { XMLParser } from 'fast-xml-parser';

export type WpPost = {
  title: string;
  slug: string;
  link: string;
  date: Date;
  status: string;
  html: string;
  excerpt: string;
  categories: string[];
  tags: string[];
  featuredUrl?: string;
};

export type WpPage = {
  title: string;
  slug: string;
  link: string;
  date: Date;
  status: string;
  html: string;
};

export type WpAttachment = { id: string; url: string };

export type ParsedWxr = {
  posts: WpPost[];
  pages: WpPage[];
  attachments: WpAttachment[];
};

type RawItem = Record<string, any>;

function arr<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(v: any): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    if ('__cdata' in v) return String(v.__cdata);
    if ('#text' in v) return String(v['#text']);
  }
  return String(v);
}

function postType(it: RawItem): string {
  return text(it['wp:post_type']);
}

function toDate(it: RawItem): Date {
  const gmt = text(it['wp:post_date_gmt']);
  const local = text(it['wp:post_date']);
  const pub = text(it.pubDate);
  if (gmt && gmt !== '0000-00-00 00:00:00') return new Date(gmt + 'Z');
  if (local && local !== '0000-00-00 00:00:00') return new Date(local.replace(' ', 'T'));
  if (pub) return new Date(pub);
  return new Date();
}

export function parseWxr(xml: string): ParsedWxr {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    cdataPropName: '__cdata',
    trimValues: false,
    processEntities: true,
    isArray: (name) => ['item', 'category', 'wp:postmeta'].includes(name),
  });
  const tree = parser.parse(xml);
  const channel = tree?.rss?.channel;
  if (!channel) throw new Error('Invalid WXR: missing rss > channel');
  const items: RawItem[] = arr(channel.item);

  // Index attachments by id so we can resolve featured images.
  const attachments: WpAttachment[] = [];
  const attachmentsById = new Map<string, WpAttachment>();
  for (const it of items) {
    if (postType(it) !== 'attachment') continue;
    const id = text(it['wp:post_id']);
    const url = text(it['wp:attachment_url']);
    if (url) {
      const att = { id, url };
      attachments.push(att);
      if (id) attachmentsById.set(id, att);
    }
  }

  const posts: WpPost[] = [];
  const pages: WpPage[] = [];

  for (const it of items) {
    const type = postType(it);
    if (type !== 'post' && type !== 'page') continue;

    const title = text(it.title);
    const link = text(it.link);
    const slug = text(it['wp:post_name']);
    const status = text(it['wp:status']);
    const html = text(it['content:encoded']);
    const date = toDate(it);

    if (type === 'page') {
      pages.push({ title, slug, link, date, status, html });
      continue;
    }

    const excerpt = text(it['excerpt:encoded']);
    const categories: string[] = [];
    const tags: string[] = [];
    for (const c of arr(it.category)) {
      const domain = c['@_domain'];
      const name = text(c.__cdata ?? c['#text'] ?? c);
      if (!name) continue;
      if (domain === 'category') categories.push(name);
      else if (domain === 'post_tag') tags.push(name);
    }

    let featuredUrl: string | undefined;
    for (const meta of arr(it['wp:postmeta'])) {
      if (text(meta['wp:meta_key']) === '_thumbnail_id') {
        const att = attachmentsById.get(text(meta['wp:meta_value']));
        if (att) featuredUrl = att.url;
      }
    }

    posts.push({ title, slug, link, date, status, html, excerpt, categories, tags, featuredUrl });
  }

  return { posts, pages, attachments };
}
