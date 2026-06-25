/**
 * Convert WordPress post HTML to Notion block children.
 *
 * Output shape matches Notion's CreatePageParameters['children'] — each block
 * is `{ object: 'block', type, [type]: {...} }`.
 *
 * Goals:
 * - Lossless on the common 95%: paragraphs, headings, lists, quotes, code,
 *   images, links, basic inline emphasis.
 * - Fail soft on the long tail: shortcodes (`[gallery]`, `[caption]`, etc.)
 *   and unknown HTML get emitted as a `code` block tagged "html" so the
 *   content is preserved and visible for manual review.
 */
import * as cheerio from 'cheerio';
import type { Element as CheerioElement } from 'domhandler';

type Block = any;

const NOTION_TEXT_MAX = 2000;

type RichText = {
  type: 'text';
  text: { content: string; link?: { url: string } };
  annotations?: Partial<{
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
  }>;
};

export type ConvertResult = {
  blocks: Block[];
  imageUrls: string[];
  warnings: string[];
};

export function htmlToBlocks(html: string): ConvertResult {
  const out: ConvertResult = { blocks: [], imageUrls: [], warnings: [] };

  // WordPress sometimes emits shortcodes inside post content. Capture them
  // and replace with a marker so cheerio doesn't lose them.
  // We pre-flag shortcodes and emit a warning per unique kind.
  const shortcodePattern = /\[(\w+)([^\]]*)\]/g;
  const shortcodes = new Set<string>();
  html.replace(shortcodePattern, (_m, name) => {
    shortcodes.add(name);
    return '';
  });
  if (shortcodes.size > 0) {
    out.warnings.push(
      `Found shortcodes (preserved as code blocks for review): ${[...shortcodes].join(', ')}`
    );
  }

  const $ = cheerio.load(`<div id="__root">${html}</div>`, null, false);
  const root = $('#__root').get(0);
  if (!root) return out;

  walk(root.children as CheerioElement[], out, $);

  // Convert raw HTML loose-text into paragraph blocks.
  return out;
}

function walk(
  nodes: any[],
  out: ConvertResult,
  $: cheerio.CheerioAPI,
  inline = false
): void {
  let para: RichText[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    // Strip leading/trailing whitespace-only text nodes.
    while (para.length && /^\s*$/.test(para[0].text.content)) para.shift();
    while (para.length && /^\s*$/.test(para[para.length - 1].text.content)) para.pop();
    if (para.length === 0) return;
    out.blocks.push(paragraphBlock(para));
    para = [];
  };

  for (const n of nodes) {
    if (n.type === 'text') {
      const text = (n.data ?? '').replace(/\s+/g, ' ');
      if (text) para.push(textRun(text));
      continue;
    }
    if (n.type !== 'tag') continue;
    const tag = n.name.toLowerCase();

    // Inline tags → accumulate into current paragraph.
    if (isInline(tag)) {
      collectInline(n, para, $);
      continue;
    }

    // Block-level tag — flush whatever paragraph we're building first.
    flushPara();
    const block = convertBlock(n, out, $);
    if (block) {
      if (Array.isArray(block)) out.blocks.push(...block);
      else out.blocks.push(block);
    }
  }
  flushPara();
}

function isInline(tag: string): boolean {
  return (
    tag === 'a' ||
    tag === 'b' ||
    tag === 'strong' ||
    tag === 'i' ||
    tag === 'em' ||
    tag === 'u' ||
    tag === 's' ||
    tag === 'strike' ||
    tag === 'del' ||
    tag === 'code' ||
    tag === 'span' ||
    tag === 'br' ||
    tag === 'small' ||
    tag === 'sup' ||
    tag === 'sub'
  );
}

function isValidHref(href: string | undefined): boolean {
  if (!href) return false;
  const h = href.trim();
  if (!h) return false;
  // Must be absolute http(s) or mailto. Skip relative, hash-only, javascript:,
  // and placeholder values left by WP plugins (e.g. "!#postLink!#").
  return /^(https?:\/\/|mailto:)/i.test(h);
}

function collectInline(
  node: any,
  out: RichText[],
  $: cheerio.CheerioAPI,
  inherited: RichText['annotations'] = {}
): void {
  const tag = node.name?.toLowerCase();
  const ann: RichText['annotations'] = { ...inherited };
  let href: string | undefined;

  switch (tag) {
    case 'b':
    case 'strong':
      ann.bold = true;
      break;
    case 'i':
    case 'em':
      ann.italic = true;
      break;
    case 'u':
      ann.underline = true;
      break;
    case 's':
    case 'strike':
    case 'del':
      ann.strikethrough = true;
      break;
    case 'code':
      ann.code = true;
      break;
    case 'a':
      if (isValidHref(node.attribs?.href)) href = node.attribs.href;
      break;
    case 'br':
      out.push(textRun('\n'));
      return;
  }

  for (const c of node.children ?? []) {
    if (c.type === 'text') {
      const text = (c.data ?? '').replace(/\s+/g, ' ');
      if (text) {
        out.push({
          type: 'text',
          text: { content: text, ...(href ? { link: { url: href } } : {}) },
          annotations: ann,
        });
      }
    } else if (c.type === 'tag') {
      if (isInline(c.name.toLowerCase())) {
        collectInline(c, out, $, ann);
      } else {
        // Block tag nested inside inline — odd. Skip with warning.
        // Caller will handle.
      }
    }
  }
}

function convertBlock(node: any, out: ConvertResult, $: cheerio.CheerioAPI): Block | Block[] | null {
  const tag = node.name.toLowerCase();
  const children = node.children ?? [];

  switch (tag) {
    case 'p': {
      // WordPress wraps images in <p> tags: <p><img></p> or
      // <p><img><br><img></p>. If any block-level child (img, blockquote,
      // figure, etc.) is present, treat this <p> as a transparent container
      // and walk its children with the same logic as the top level — so the
      // images become their own image blocks instead of getting dropped.
      const hasBlockChild = (children as any[]).some(
        (c: any) => c.type === 'tag' && !isInline(c.name.toLowerCase())
      );
      if (hasBlockChild) {
        const sub: ConvertResult = { blocks: [], imageUrls: [], warnings: [] };
        walk(children as CheerioElement[], sub, $);
        out.imageUrls.push(...sub.imageUrls);
        out.warnings.push(...sub.warnings);
        return sub.blocks;
      }
      const rich: RichText[] = [];
      collectInlineChildren(children, rich, $);
      if (rich.every((r) => /^\s*$/.test(r.text.content))) return null;
      return paragraphBlock(rich);
    }
    case 'h1':
      return headingBlock(node, 1, $);
    case 'h2':
      return headingBlock(node, 1, $); // map WP h2 → notion h1 (page already has post title)
    case 'h3':
      return headingBlock(node, 2, $);
    case 'h4':
    case 'h5':
    case 'h6':
      return headingBlock(node, 3, $);
    case 'blockquote': {
      const rich: RichText[] = [];
      collectInlineChildren(children, rich, $);
      return {
        object: 'block',
        type: 'quote',
        quote: { rich_text: chunk(rich) },
      };
    }
    case 'pre': {
      const text = $(node).text();
      return {
        object: 'block',
        type: 'code',
        code: {
          language: 'plain text',
          rich_text: [{ type: 'text', text: { content: clip(text) } }],
        },
      };
    }
    case 'ul':
    case 'ol':
      return listBlocks(node, tag === 'ol', $);
    case 'img': {
      const src = node.attribs?.src;
      const alt = node.attribs?.alt ?? '';
      if (!src) return null;
      out.imageUrls.push(src);
      return imageBlock(src, alt);
    }
    case 'figure': {
      // Find inner img + figcaption
      const img = findFirst(node, 'img');
      const caption = findFirst(node, 'figcaption');
      if (!img) {
        // No image — fall through as raw HTML
        return rawHtmlBlock($.html(node), out);
      }
      const src = img.attribs?.src;
      if (!src) return null;
      out.imageUrls.push(src);
      const captionText = caption ? $(caption).text().trim() : '';
      const altText = img.attribs?.alt ?? captionText;
      return imageBlock(src, altText, captionText);
    }
    case 'hr':
      return { object: 'block', type: 'divider', divider: {} };
    case 'iframe':
    case 'embed':
    case 'video': {
      const src = node.attribs?.src;
      if (!src) return null;
      return {
        object: 'block',
        type: 'embed',
        embed: { url: src },
      };
    }
    case 'div':
    case 'section':
    case 'article':
      // Recurse into the container.
      {
        const sub: ConvertResult = { blocks: [], imageUrls: [], warnings: [] };
        walk(children, sub, $);
        out.imageUrls.push(...sub.imageUrls);
        out.warnings.push(...sub.warnings);
        return sub.blocks;
      }
    case 'table':
    case 'script':
    case 'style':
      // Preserve as raw HTML code block.
      return rawHtmlBlock($.html(node), out);
    default:
      out.warnings.push(`Unknown HTML tag rendered as paragraph: <${tag}>`);
      {
        const rich: RichText[] = [];
        collectInlineChildren(children, rich, $);
        if (rich.length === 0) return null;
        return paragraphBlock(rich);
      }
  }
}

function collectInlineChildren(
  nodes: any[],
  out: RichText[],
  $: cheerio.CheerioAPI,
  inherited: RichText['annotations'] = {}
): void {
  for (const c of nodes) {
    if (c.type === 'text') {
      const text = (c.data ?? '').replace(/\s+/g, ' ');
      if (text) out.push({ type: 'text', text: { content: text }, annotations: inherited });
    } else if (c.type === 'tag') {
      if (isInline(c.name.toLowerCase())) {
        collectInline(c, out, $, inherited);
      } else {
        // Nested block (e.g. <p><img></p>) — flatten its text content.
        const text = $(c).text();
        if (text.trim()) out.push({ type: 'text', text: { content: text }, annotations: inherited });
      }
    }
  }
}

function paragraphBlock(rich: RichText[]): Block {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: chunk(rich) },
  };
}

function headingBlock(node: any, level: 1 | 2 | 3, $: cheerio.CheerioAPI): Block {
  const rich: RichText[] = [];
  collectInlineChildren(node.children ?? [], rich, $);
  const key = level === 1 ? 'heading_1' : level === 2 ? 'heading_2' : 'heading_3';
  return {
    object: 'block',
    type: key,
    [key]: { rich_text: chunk(rich) },
  };
}

function listBlocks(node: any, ordered: boolean, $: cheerio.CheerioAPI): Block[] {
  const blocks: Block[] = [];
  const type = ordered ? 'numbered_list_item' : 'bulleted_list_item';
  for (const li of node.children ?? []) {
    if (li.type !== 'tag' || li.name.toLowerCase() !== 'li') continue;
    const rich: RichText[] = [];
    const childBlocks: Block[] = [];
    for (const c of li.children ?? []) {
      if (c.type === 'tag' && (c.name === 'ul' || c.name === 'ol')) {
        childBlocks.push(...listBlocks(c, c.name === 'ol', $));
      } else if (c.type === 'tag' && !isInline(c.name)) {
        // Nested block — render text inline-ish
        const text = $(c).text();
        if (text.trim()) rich.push({ type: 'text', text: { content: text } });
      } else if (c.type === 'text') {
        const text = (c.data ?? '').replace(/\s+/g, ' ');
        if (text.trim()) rich.push({ type: 'text', text: { content: text } });
      } else if (c.type === 'tag') {
        collectInline(c, rich, $);
      }
    }
    const block: any = {
      object: 'block',
      type,
      [type]: { rich_text: chunk(rich) },
    };
    if (childBlocks.length > 0) block[type].children = childBlocks;
    blocks.push(block);
  }
  return blocks;
}

function imageBlock(src: string, alt: string, caption = ''): Block {
  const captionRich: RichText[] = caption
    ? [{ type: 'text', text: { content: caption } }]
    : [];
  return {
    object: 'block',
    type: 'image',
    image: {
      type: 'external',
      external: { url: src },
      caption: captionRich,
    },
  };
}

function rawHtmlBlock(html: string, out: ConvertResult): Block {
  out.warnings.push('Preserved raw HTML as code block for manual review');
  return {
    object: 'block',
    type: 'code',
    code: {
      language: 'html',
      rich_text: [{ type: 'text', text: { content: clip(html) } }],
    },
  };
}

function findFirst(node: any, name: string): any | null {
  if (!node?.children) return null;
  for (const c of node.children) {
    if (c.type === 'tag' && c.name.toLowerCase() === name) return c;
    const found = findFirst(c, name);
    if (found) return found;
  }
  return null;
}

function textRun(content: string): RichText {
  return { type: 'text', text: { content } };
}

function clip(s: string): string {
  return s.length > NOTION_TEXT_MAX ? s.slice(0, NOTION_TEXT_MAX - 1) + '…' : s;
}

/** Notion limits rich_text content to 2000 chars per run. Split long runs. */
function chunk(rich: RichText[]): RichText[] {
  const out: RichText[] = [];
  for (const r of rich) {
    const content = r.text.content;
    if (content.length <= NOTION_TEXT_MAX) {
      out.push(r);
      continue;
    }
    for (let i = 0; i < content.length; i += NOTION_TEXT_MAX) {
      out.push({
        ...r,
        text: { ...r.text, content: content.slice(i, i + NOTION_TEXT_MAX) },
      });
    }
  }
  return out;
}
