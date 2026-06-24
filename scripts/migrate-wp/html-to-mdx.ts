import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

/**
 * Convert a WordPress post's `content:encoded` HTML into MDX body text.
 * - Strips WP block comments and common shortcodes.
 * - Rewrites <img>/<a> media URLs through `urlMap` (full URL, then basename).
 * - Emits Markdown for prose; keeps tables / iframes as raw (MDX-safe) HTML.
 * - Escapes `{`/`}` so MDX doesn't parse them as JS expressions.
 */
export function htmlToMdx(html: string, urlMap: Map<string, string>): string {
  const cleaned = stripShortcodes(stripWpComments(html));
  const $ = cheerio.load(cleaned, null, false);

  const remapUrl = (src: string): string => {
    if (!src) return src;
    if (urlMap.has(src)) return urlMap.get(src)!;
    const base = src.split('?')[0].split('/').pop() ?? '';
    if (base && urlMap.has(base)) return urlMap.get(base)!;
    return src;
  };

  const inline = (nodes: AnyNode[] | undefined): string =>
    (nodes ?? []).map((n) => serialize(n, false)).join('');

  function serialize(node: AnyNode, block: boolean): string {
    if (node.type === 'text') return escapeText((node as any).data ?? '');
    if (node.type !== 'tag') return '';
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const kids = el.children as AnyNode[];

    switch (tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const level = Number(tag[1]);
        return `\n${'#'.repeat(level)} ${inline(kids).trim()}\n`;
      }
      case 'p':
        return `\n${inline(kids).trim()}\n`;
      case 'br':
        return '  \n';
      case 'hr':
        return '\n---\n';
      case 'strong': case 'b':
        return `**${inline(kids)}**`;
      case 'em': case 'i':
        return `*${inline(kids)}*`;
      case 'code':
        return `\`${stripMd(inline(kids))}\``;
      case 'a': {
        const href = remapUrl(el.attribs.href ?? '');
        const txt = inline(kids).trim() || href;
        return href ? `[${txt}](${href})` : txt;
      }
      case 'img': {
        const src = remapUrl(el.attribs.src ?? '');
        const alt = (el.attribs.alt ?? '').replace(/[\[\]]/g, '');
        return src ? `\n![${alt}](${src})\n` : '';
      }
      case 'figure':
        return `\n${inline(kids).trim()}\n`;
      case 'figcaption': {
        const c = inline(kids).trim();
        return c ? `\n*${c}*\n` : '';
      }
      case 'ul':
        return '\n' + listItems(el, '- ') + '\n';
      case 'ol':
        return '\n' + listItems(el, '1. ') + '\n';
      case 'blockquote':
        return '\n' + inline(kids).trim().split('\n').map((l) => `> ${l}`).join('\n') + '\n';
      case 'table': case 'iframe': case 'pre':
        return `\n${rawHtml(el)}\n`;
      case 'script': case 'style':
        return '';
      default:
        // div, span, section, article, etc. — pass through children.
        return block ? `\n${inline(kids).trim()}\n` : inline(kids);
    }
  }

  function listItems(listEl: Element, marker: string): string {
    return (listEl.children as AnyNode[])
      .filter((n): n is Element => n.type === 'tag' && (n as Element).tagName.toLowerCase() === 'li')
      .map((li) => `${marker}${inline(li.children as AnyNode[]).trim()}`)
      .join('\n');
  }

  function rawHtml(el: Element): string {
    // Rewrite media URLs inside the kept-as-HTML block, then make it MDX-safe.
    const $$ = cheerio.load($.html(el), null, false);
    $$('img').each((_i, img) => {
      const src = $$(img).attr('src');
      if (src) $$(img).attr('src', remapUrl(src));
    });
    $$('a').each((_i, a) => {
      const href = $$(a).attr('href');
      if (href) $$(a).attr('href', remapUrl(href));
    });
    return selfCloseVoids(escapeBraces($$.html()));
  }

  const roots = (($.root()[0] as any)?.children ?? []) as AnyNode[];
  const out = roots.map((n) => serialize(n, true)).join('');
  return collapseBlankLines(out).trim() + '\n';
}

function stripWpComments(html: string): string {
  return html.replace(/<!--\s*\/?wp:[^>]*-->/g, '');
}

function stripShortcodes(html: string): string {
  return html
    .replace(/\[caption\s+[^\]]*\]/gi, '')
    .replace(/\[\/caption\]/gi, '')
    .replace(/\[fvplayer[^\]]*\]/gi, '')
    .replace(/!#\w+!#/g, '');
}

function escapeText(s: string): string {
  return escapeBraces(s);
}

function escapeBraces(s: string): string {
  return s.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
}

function stripMd(s: string): string {
  return s.replace(/[*_`]/g, '');
}

function selfCloseVoids(html: string): string {
  return html.replace(/<(img|br|hr|input|source|col|area|base|link|meta)((?:\s[^>]*?)?)\s*(?<!\/)>/gi,
    (_m, tag, attrs) => `<${tag}${attrs} />`);
}

function collapseBlankLines(s: string): string {
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}
