/**
 * One-time: push the committed page MDX into the Notion "Pages" database so the
 * pages become editable in Notion. Adds the needed properties, then creates a
 * row per page with its body as Notion blocks.
 *
 *   npx tsx --env-file-if-exists=.env scripts/push-pages.ts
 *
 * For About, the coded team-card section is stripped (it stays a component);
 * only the prose is pushed. Idempotent: skips a page whose Slug already exists.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client, isFullPage } from '@notionhq/client';
import { mdToBlocks } from './agent/publish.ts';

const TOKEN = process.env.NOTION_TOKEN;
const DB = process.env.NOTION_PAGES_DATABASE_ID;
if (!TOKEN || !DB) { console.error('Set NOTION_TOKEN and NOTION_PAGES_DATABASE_ID.'); process.exit(1); }
const notion = new Client({ auth: TOKEN, fetch: globalThis.fetch });
const DIR = 'src/content/pages';

function parse(mdx: string) {
  const m = mdx.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const fm = m?.[1] ?? '';
  let body = (m?.[2] ?? '').trim();
  const get = (k: string) => fm.match(new RegExp(`^${k}:\\s*"?([^"\\n]+?)"?\\s*$`, 'm'))?.[1]?.trim();
  const title = get('title') ?? '';
  const slug = get('slug') ?? '';
  const description = get('description') ?? '';
  const showInFooter = /^showInFooter:\s*true/m.test(fm);
  // Strip coded-only sections (About team cards) — they render as a component.
  body = body.replace(/##\s*Meet the team[\s\S]*?<\/div>\s*/i, '').trim();
  return { title, slug, description, showInFooter, body };
}

async function existingSlugs(): Promise<Set<string>> {
  const out = new Set<string>();
  let cursor: string | undefined;
  do {
    const res = await notion.databases.query({ database_id: DB!, start_cursor: cursor, page_size: 100 });
    for (const p of res.results) if (isFullPage(p)) {
      const s = (p.properties as any).Slug?.rich_text?.[0]?.plain_text;
      if (s) out.add(s);
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}

async function main() {
  console.log('Adding properties to Pages DB…');
  await notion.databases.update({
    database_id: DB!,
    properties: {
      Slug: { rich_text: {} },
      Status: { select: { options: [{ name: 'Published', color: 'green' }, { name: 'Draft', color: 'gray' }] } },
      'Show in footer': { checkbox: {} },
      Description: { rich_text: {} },
    },
  });

  const existing = await existingSlugs();
  for (const file of readdirSync(DIR).filter((f) => /\.mdx?$/.test(f))) {
    const { title, slug, description, showInFooter, body } = parse(readFileSync(join(DIR, file), 'utf8'));
    if (!slug || !title) { console.log(`skip ${file} (no slug/title)`); continue; }
    if (existing.has(slug)) { console.log(`reuse ${slug} (already in Notion)`); continue; }
    const blocks = mdToBlocks(body);
    await notion.pages.create({
      parent: { database_id: DB! },
      properties: {
        Name: { title: [{ text: { content: title } }] },
        Slug: { rich_text: [{ text: { content: slug } }] },
        Status: { select: { name: 'Published' } },
        'Show in footer': { checkbox: showInFooter },
        Description: description ? { rich_text: [{ text: { content: description.slice(0, 2000) } }] } : { rich_text: [] },
      },
      children: blocks.slice(0, 90),
    });
    console.log(`created "${title}" (${slug}) — ${blocks.length} blocks`);
  }
}

main().catch((e) => { console.error(e?.body ?? e); process.exit(1); });
