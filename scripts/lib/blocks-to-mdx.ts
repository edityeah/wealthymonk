import type { BlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import * as cheerio from 'cheerio';
import { fetchBlocks } from './notion.js';
import { mirrorImage } from './image-mirror.js';

// ── Internal-link rewriting ──────────────────────────────────────────────────
// Posts migrated from WordPress carry legacy internal links in WP permalink
// form: https://geo-traveller.com/<slug>/ or /<slug>/ — but every post now
// lives under /posts/<slug>/. Build-content seeds this set with all known post
// slugs so renderRich() can rewrite those links to the correct path.
const knownPostSlugs = new Set<string>();
export function setKnownPostSlugs(slugs: Iterable<string>): void {
  knownPostSlugs.clear();
  for (const s of slugs) knownPostSlugs.add(s);
}

const SITE_HOSTS = new Set(['wealthymonk.org', 'www.wealthymonk.org']);

function slugToLabel(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Convert bare in-text URLs to this site's legacy permalinks into proper
 * markdown links. WordPress posts often contain a bare line like
 * "Also read: https://geo-traveller.com/<slug>/" — left as plain text, the
 * MDX auto-linker turns it into an <a> pointing at the dead root-level URL.
 * Here we replace known-post URLs with [Title](/posts/<slug>/). External and
 * unknown URLs are left untouched (they auto-link as before).
 */
function linkifyInternalBareUrls(text: string): string {
  return text.replace(
    /https?:\/\/(?:www\.)?wealthymonk\.org\/[^\s)\]]*/gi,
    (full) => {
      const rw = rewriteHref(full);
      if (rw && rw.startsWith('/posts/')) {
        const slug = rw.replace(/^\/posts\//, '').replace(/\/$/, '');
        return `[${slugToLabel(slug)}](${rw})`;
      }
      return full;
    }
  );
}

/**
 * Rewrite a legacy root-level internal link (/<slug>/ or full URL to this site)
 * to /posts/<slug>/ when <slug> is a known post. Everything else is returned
 * unchanged: external links, anchors, /tags/*, /map/, multi-segment paths, and
 * links that already point at /posts/.
 */
export function rewriteHref(href: string | null): string | null {
  if (!href) return href;
  if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return href;

  let pathname: string;
  if (/^https?:\/\//i.test(href)) {
    let u: URL;
    try { u = new URL(href); } catch { return href; }
    if (!SITE_HOSTS.has(u.hostname)) return href; // external — leave alone
    pathname = u.pathname;
  } else if (href.startsWith('/')) {
    pathname = href.split('#')[0].split('?')[0];
  } else {
    return href; // relative-without-leading-slash — leave alone
  }

  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 1 && knownPostSlugs.has(segments[0])) {
    return `/posts/${segments[0]}/`;
  }
  return href;
}

type RichText = {
  plain_text: string;
  href: string | null;
  annotations: {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
  };
};

function escapeMdx(s: string): string {
  return s.replace(/([\\{}<>])/g, '\\$1');
}

/**
 * Make a raw HTML fragment (e.g. a preserved table) safe to embed in MDX.
 * WordPress table markup is frequently malformed (unclosed <td>/<tr>), which
 * MDX's strict JSX parser rejects — so we re-serialize through cheerio to
 * balance tags, then self-close void elements and escape braces.
 */
function mdxSafeHtml(html: string): string {
  let normalized: string;
  try {
    normalized = cheerio.load(html, null, false).html();
  } catch {
    normalized = html;
  }
  const selfClosed = normalized.replace(
    /<(img|br|hr|input|source|col|area|base|link|meta)((?:\s[^>]*?)?)\s*(?<!\/)>/gi,
    (_m, tag, attrs) => `<${tag}${attrs} />`,
  );
  const escaped = selfClosed.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
  return '\n' + escaped + '\n';
}

function renderRich(rich: RichText[] | undefined): string {
  if (!rich) return '';
  return rich
    .map((r) => {
      const a = r.annotations;
      // Code spans render verbatim — never linkify or escape.
      if (a.code) return `\`${r.plain_text}\``;
      let text = escapeMdx(r.plain_text);
      // Plain text (no explicit link annotation) may contain bare legacy URLs.
      if (!r.href) text = linkifyInternalBareUrls(text);
      if (a.bold) text = `**${text}**`;
      if (a.italic) text = `*${text}*`;
      if (a.strikethrough) text = `~~${text}~~`;
      if (r.href) text = `[${text}](${rewriteHref(r.href)})`;
      return text;
    })
    .join('');
}

function indent(s: string, n: number): string {
  const pad = ' '.repeat(n);
  return s.split('\n').map((l) => (l ? pad + l : l)).join('\n');
}

export async function blocksToMdx(
  pageId: string,
  slug: string,
  options: { warnings: string[] }
): Promise<string> {
  const blocks = await fetchBlocks(pageId);
  return renderBlocks(blocks, slug, 0, options);
}

async function renderBlocks(
  blocks: BlockObjectResponse[],
  slug: string,
  depth: number,
  ctx: { warnings: string[] }
): Promise<string> {
  const out: string[] = [];
  let listBuf: { type: 'ul' | 'ol'; items: string[] } | null = null;

  const flushList = () => {
    if (!listBuf) return;
    const marker = listBuf.type === 'ul' ? '- ' : '1. ';
    out.push(listBuf.items.map((i) => marker + i).join('\n'));
    listBuf = null;
  };

  for (const b of blocks) {
    const rendered = await renderBlock(b, slug, depth, ctx);
    if (rendered === null) continue;

    if (b.type === 'bulleted_list_item' || b.type === 'numbered_list_item') {
      const kind = b.type === 'bulleted_list_item' ? 'ul' : 'ol';
      if (!listBuf || listBuf.type !== kind) {
        flushList();
        listBuf = { type: kind, items: [] };
      }
      listBuf.items.push(rendered);
    } else {
      flushList();
      out.push(rendered);
    }
  }
  flushList();
  return out.filter(Boolean).join('\n\n');
}

async function renderBlock(
  b: BlockObjectResponse,
  slug: string,
  depth: number,
  ctx: { warnings: string[] }
): Promise<string | null> {
  switch (b.type) {
    case 'paragraph':
      return renderRich(b.paragraph.rich_text as RichText[]);
    case 'heading_1':
      return `## ${renderRich(b.heading_1.rich_text as RichText[])}`;
    case 'heading_2':
      return `### ${renderRich(b.heading_2.rich_text as RichText[])}`;
    case 'heading_3':
      return `#### ${renderRich(b.heading_3.rich_text as RichText[])}`;
    case 'bulleted_list_item':
    case 'numbered_list_item': {
      const data = (b as any)[b.type];
      let inner = renderRich(data.rich_text as RichText[]);
      if (b.has_children) {
        const children = await fetchBlocks(b.id);
        const sub = await renderBlocks(children, slug, depth + 1, ctx);
        inner += '\n' + indent(sub, 2);
      }
      return inner;
    }
    case 'quote':
      return `> ${renderRich(b.quote.rich_text as RichText[]).replace(/\n/g, '\n> ')}`;
    case 'code': {
      const lang = b.code.language ?? '';
      const src = (b.code.rich_text as RichText[]).map((r) => r.plain_text).join('');
      // Tables preserved as raw-HTML code blocks should render as real tables on
      // the site (Notion keeps them as editable HTML). Inject the markup MDX-safely.
      if (lang === 'html' && /<table/i.test(src) && !/<script/i.test(src)) {
        return mdxSafeHtml(src);
      }
      return '```' + lang + '\n' + src + '\n```';
    }
    case 'image': {
      const src =
        b.image.type === 'external' ? b.image.external.url : b.image.file.url;
      const caption = renderRich(b.image.caption as RichText[]);
      const mirrored = await mirrorImage(src, slug);
      // A successful mirror ALWAYS returns an R2 or local path, never the
      // original external URL. If we get the source URL back, the fetch failed
      // (dead third-party hotlink). Omit it — a broken-image icon helps no one.
      if (/^https?:\/\//i.test(src) && mirrored === src) {
        ctx.warnings.push(`Dropped un-mirrorable inline image in ${slug}: ${src}`);
        return '';
      }
      const alt = caption || 'image';
      return caption
        ? `<figure>\n  <img src="${mirrored}" alt="${escapeAttr(alt)}" />\n  <figcaption>${caption}</figcaption>\n</figure>`
        : `![${escapeAttr(alt)}](${mirrored})`;
    }
    case 'divider':
      return '---';
    case 'callout': {
      const inner = renderRich(b.callout.rich_text as RichText[]);
      const emoji = b.callout.icon?.type === 'emoji' ? b.callout.icon.emoji + ' ' : '';
      return `> ${emoji}${inner}`;
    }
    case 'bookmark':
      return renderEmbed(b.bookmark.url);
    case 'embed':
      return renderEmbed(b.embed.url);
    case 'video': {
      const url = b.video.type === 'external' ? b.video.external.url : b.video.file.url;
      return renderEmbed(url);
    }
    case 'table': {
      // Fetch child rows.
      const rows = await fetchBlocks(b.id);
      const renderedRows: string[][] = [];
      for (const r of rows) {
        if (r.type !== 'table_row') continue;
        const cells = (r as any).table_row.cells as RichText[][];
        renderedRows.push(cells.map((c) => renderRich(c).replace(/\|/g, '\\|') || ' '));
      }
      if (renderedRows.length === 0) return null;
      const width = Math.max(...renderedRows.map((r) => r.length));
      const lines: string[] = [];
      const padCells = (row: string[]) => {
        const padded = [...row];
        while (padded.length < width) padded.push(' ');
        return '| ' + padded.join(' | ') + ' |';
      };
      if (b.table.has_column_header) {
        lines.push(padCells(renderedRows[0]));
        lines.push('| ' + Array(width).fill('---').join(' | ') + ' |');
        for (let i = 1; i < renderedRows.length; i++) lines.push(padCells(renderedRows[i]));
      } else {
        // No header row — Markdown tables require a header, so insert a blank one.
        lines.push('| ' + Array(width).fill(' ').join(' | ') + ' |');
        lines.push('| ' + Array(width).fill('---').join(' | ') + ' |');
        for (const r of renderedRows) lines.push(padCells(r));
      }
      return lines.join('\n');
    }
    case 'table_of_contents':
    case 'breadcrumb':
    case 'column_list':
    case 'column':
      return null;
    default:
      ctx.warnings.push(`Unsupported Notion block type: ${b.type}`);
      return `{/* unsupported block: ${b.type} */}`;
  }
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Render a third-party media URL as the appropriate embed HTML. The actual
 * widget hydration (Twitter widgets.js, Instagram embed.js, etc.) is loaded
 * from the post page layout once per page.
 */
export function renderEmbed(rawUrl: string): string {
  // Correct legacy internal links first. A bookmark/embed block pointing at
  // another post on this site (common after the WP migration) is rewritten to
  // /posts/<slug>/ and rendered as a clean inline link rather than a link card
  // showing a raw URL — which also avoids the auto-linked nested <a> bug.
  const url = rewriteHref(rawUrl) || rawUrl;
  if (url.startsWith('/posts/')) {
    const slug = url.replace(/^\/posts\//, '').replace(/\/$/, '');
    return `<a class="embed-link internal" href="${url}">${slugToLabel(slug)} →</a>`;
  }

  // YouTube
  let m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  if (m) {
    return `<div class="embed embed-yt"><iframe src="https://www.youtube.com/embed/${m[1]}" title="YouTube video" loading="lazy" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  // Vimeo
  m = url.match(/vimeo\.com\/(\d+)/);
  if (m) {
    return `<div class="embed embed-vimeo"><iframe src="https://player.vimeo.com/video/${m[1]}" loading="lazy" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  // Twitter / X
  if (/(?:^|\/\/)(?:www\.)?(?:twitter|x)\.com\/[^/]+\/status\/\d+/i.test(url)) {
    return `<blockquote class="twitter-tweet" data-dnt="true" data-theme="light"><a href="${url}">View on X</a></blockquote>`;
  }
  // Instagram post or reel
  m = url.match(/^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/([\w-]+)/);
  if (m) {
    const clean = url.split('?')[0].replace(/\/$/, '') + '/';
    return `<blockquote class="instagram-media" data-instgrm-captioned data-instgrm-permalink="${clean}" data-instgrm-version="14"><a href="${clean}">View on Instagram</a></blockquote>`;
  }
  // TikTok
  m = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/);
  if (m) {
    return `<blockquote class="tiktok-embed" cite="${url}" data-video-id="${m[1]}"><a href="${url}">View on TikTok</a></blockquote>`;
  }
  // Facebook post or video
  if (/(?:facebook|fb)\.com\/.+\/(?:posts|videos|photos)\//i.test(url)) {
    return `<div class="fb-post" data-href="${url}" data-width="500"></div>`;
  }
  // Generic fallback: an iframe attempt is risky (X-Frame-Options) so just
  // make a tidy link card.
  return `<a class="embed-link" href="${url}" target="_blank" rel="noopener">${url}</a>`;
}
