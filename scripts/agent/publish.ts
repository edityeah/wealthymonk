/**
 * Push a generated post into the Notion Posts database as a Draft.
 * Returns the Notion page ID and URL.
 */
import { Client, isFullPage } from '@notionhq/client';
import type { GeneratedPost } from './generate.js';
import { withRetry } from '../lib/notion.js';

const NOTION_TOKEN = process.env.NOTION_TOKEN!;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID!;

const STATUS = (process.env.AGENT_STATUS ?? 'Draft') as 'Draft' | 'Published';
const notion = new Client({ auth: NOTION_TOKEN, fetch: globalThis.fetch });

function richText(s: string) {
  // Notion caps at 2000 chars per text run.
  const out: any[] = [];
  for (let i = 0; i < s.length; i += 1900) {
    out.push({ type: 'text', text: { content: s.slice(i, i + 1900) } });
  }
  return out;
}

export function mdToBlocks(md: string): any[] {
  // Very small md → Notion block converter. Headings + paragraphs + lists +
  // bold/italic. Enough for what the LLM produces.
  const blocks: any[] = [];
  const lines = md.split('\n');
  let para: string[] = [];

  const flushPara = () => {
    const text = para.join(' ').trim();
    para = [];
    if (!text) return;
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: parseInline(text) },
    });
  };

  for (let raw of lines) {
    const line = raw.trim();
    if (!line) { flushPara(); continue; }

    // Standalone image line: ![alt](url) — becomes a Notion image block.
    const imgMatch = line.match(/^!\[([^\]]*)\]\((https?:\/\/[^)]+)\)$/);
    if (imgMatch) {
      flushPara();
      const alt = imgMatch[1] || 'image';
      const url = imgMatch[2];
      blocks.push({
        object: 'block',
        type: 'image',
        image: {
          type: 'external',
          external: { url },
          caption: alt && alt !== 'image' ? [{ type: 'text', text: { content: alt } }] : [],
        },
      });
      continue;
    }

    const h1 = line.match(/^#\s+(.*)/);
    const h2 = line.match(/^##\s+(.*)/);
    const h3 = line.match(/^###\s+(.*)/);
    const li = line.match(/^[-*]\s+(.*)/);
    const ol = line.match(/^\d+\.\s+(.*)/);

    if (h1 || h2 || h3) {
      flushPara();
      const text = (h3?.[1] ?? h2?.[1] ?? h1?.[1])!;
      const type = h3 ? 'heading_3' : h2 ? 'heading_2' : 'heading_1';
      blocks.push({ object: 'block', type, [type]: { rich_text: parseInline(text) } });
      continue;
    }
    if (li) {
      flushPara();
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: parseInline(li[1]) },
      });
      continue;
    }
    if (ol) {
      flushPara();
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: parseInline(ol[1]) },
      });
      continue;
    }
    para.push(line);
  }
  flushPara();
  return blocks;
}

const SITE_URL = 'https://wealthymonk.org';

function normalizeLinkUrl(url: string): string | null {
  const u = url.trim();
  if (!u) return null;
  // Internal: /posts/slug or /tags/x — make absolute (Notion needs http(s)).
  if (u.startsWith('/')) return SITE_URL + u;
  // Mailto / tel / http(s) are fine.
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
  // Anything else (hash-only, plain text, javascript:, ftp:) — drop the link.
  return null;
}

function parseInline(text: string): any[] {
  // Handles [link](url), **bold**, *italic*. Simple lex.
  const out: any[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) {
      out.push({ type: 'text', text: { content: text.slice(last, m.index) } });
    }
    if (m[2]) {
      const url = normalizeLinkUrl(m[2]);
      if (url) {
        out.push({ type: 'text', text: { content: m[1], link: { url } } });
      } else {
        // Drop the link, keep the anchor text
        out.push({ type: 'text', text: { content: m[1] } });
      }
    } else if (m[3]) {
      out.push({
        type: 'text',
        text: { content: m[3] },
        annotations: { bold: true },
      });
    } else if (m[4]) {
      out.push({
        type: 'text',
        text: { content: m[4] },
        annotations: { italic: true },
      });
    }
    last = re.lastIndex;
  }
  if (last < text.length) {
    out.push({ type: 'text', text: { content: text.slice(last) } });
  }
  // Cap to 2000 chars per run
  const capped: any[] = [];
  for (const item of out) {
    const content = item.text?.content ?? '';
    if (content.length <= 1900) { capped.push(item); continue; }
    for (let i = 0; i < content.length; i += 1900) {
      capped.push({ ...item, text: { ...item.text, content: content.slice(i, i + 1900) } });
    }
  }
  return capped;
}

export interface PublishMeta {
  contentType?: 'Evergreen' | 'News';
  topicKey?: string;
  qa?: 'Passed' | 'Flagged';
  qaNotes?: string;
}

export async function publishToNotion(
  post: GeneratedPost,
  coverUrl?: string,
  meta?: PublishMeta
): Promise<{ pageId: string; url: string }> {
  const blocks = mdToBlocks(post.body);

  const properties: Record<string, any> = {
    Title: { title: [{ text: { content: post.title } }] },
    Slug: { rich_text: [{ text: { content: post.slug } }] },
    Status: { select: { name: STATUS } },
    'Publish Date': { date: { start: new Date().toISOString().slice(0, 10) } },
    Category: { select: { name: post.category } },
    Tags: { multi_select: post.tags.map((t) => ({ name: t.replace(/,/g, ' ').slice(0, 100) })) },
    Excerpt: { rich_text: richText(post.excerpt) },
    // Source URL is only for the agent's de-dup tracking. Original URL is
    // reserved for the original import (the legacy source URL).
    'Source URL': { url: post.sourceUrl || null },
    ...(meta?.contentType ? { 'Content Type': { select: { name: meta.contentType } } } : {}),
    ...(meta?.topicKey ? { 'Topic Key': { rich_text: [{ type: 'text', text: { content: meta.topicKey } }] } } : {}),
    ...(meta?.qa ? { QA: { select: { name: meta.qa } } } : {}),
    ...(meta?.qaNotes ? { 'QA Notes': { rich_text: [{ type: 'text', text: { content: meta.qaNotes.slice(0, 1900) } }] } } : {}),
  };
  if (coverUrl) {
    properties.Cover = {
      files: [{ type: 'external', name: 'cover', external: { url: coverUrl } }],
    };
  }

  // Notion caps page-create at 100 children; batch the rest via append.
  const first = blocks.slice(0, 90);
  const rest = blocks.slice(90);
  const page = await notion.pages.create({
    parent: { database_id: NOTION_DATABASE_ID },
    properties,
    children: first,
  });
  for (let i = 0; i < rest.length; i += 90) {
    await notion.blocks.children.append({ block_id: page.id, children: rest.slice(i, i + 90) });
  }
  return { pageId: page.id, url: (page as any).url ?? '' };
}

export async function existingSourceUrls(): Promise<Set<string>> {
  const set = new Set<string>();
  let cursor: string | undefined;
  do {
    const res = await withRetry(() => notion.databases.query({
      database_id: NOTION_DATABASE_ID,
      start_cursor: cursor,
      page_size: 100,
    }));
    for (const p of res.results) {
      if (!isFullPage(p)) continue;
      const props = p.properties as any;
      // Check both the new Source URL and the legacy Original URL slot,
      // so de-dup still catches agent posts created before the schema split.
      const src = props['Source URL']?.url ?? props['Original URL']?.url;
      if (src) set.add(src);
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return set;
}
