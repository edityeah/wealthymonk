import { Client, isFullPage, isFullBlock } from '@notionhq/client';
import type {
  PageObjectResponse,
  BlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const NOTION_PAGES_DATABASE_ID = process.env.NOTION_PAGES_DATABASE_ID;

export const notionConfigured = Boolean(NOTION_TOKEN && NOTION_DATABASE_ID);
export const pagesConfigured = Boolean(NOTION_TOKEN && NOTION_PAGES_DATABASE_ID);

// Pass Node's native fetch (undici). The client's bundled node-fetch throws
// ERR_STREAM_PREMATURE_CLOSE on gzipped responses in CI (GitHub runners).
const client = NOTION_TOKEN ? new Client({ auth: NOTION_TOKEN, fetch: globalThis.fetch }) : null;

async function backoff<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const status = err?.status;
    // Retry on rate-limit/5xx HTTP statuses AND transient network errors
    // (fetch failures like "Premature close" surface with no HTTP status).
    const httpRetriable = status === 429 || status === 502 || status === 503 || status === 504;
    const networkError = status === undefined;
    if ((!httpRetriable && !networkError) || attempt >= 5) throw err;
    const delay = Math.min(1000 * 2 ** attempt, 16000);
    await new Promise((r) => setTimeout(r, delay));
    return backoff(fn, attempt + 1);
  }
}

function plainText(rich: any[] | undefined): string {
  if (!rich) return '';
  return rich.map((r) => r.plain_text ?? '').join('');
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function fetchPublishedPosts(): Promise<PageObjectResponse[]> {
  if (!client || !NOTION_DATABASE_ID) {
    throw new Error('Notion not configured (NOTION_TOKEN, NOTION_DATABASE_ID).');
  }
  const out: PageObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const res = await backoff(() =>
      client.databases.query({
        database_id: NOTION_DATABASE_ID,
        start_cursor: cursor,
        page_size: 100,
        filter: { property: 'Status', select: { equals: 'Published' } },
        sorts: [{ property: 'Publish Date', direction: 'descending' }],
      }),
    );
    for (const page of res.results) if (isFullPage(page)) out.push(page);
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}

export async function fetchBlocks(blockId: string): Promise<BlockObjectResponse[]> {
  if (!client) throw new Error('Notion not configured.');
  const out: BlockObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const res = await backoff(() =>
      client.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 }),
    );
    for (const block of res.results) if (isFullBlock(block)) out.push(block);
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}

export type PostProps = {
  id: string;
  title: string;
  slug: string;
  publishDate: string;
  category?: string;
  tags: string[];
  series?: string;
  seriesOrder?: number;
  coverUrl?: string;
  excerpt?: string;
  originalUrl?: string;
  originalDate?: string;
};

export function extractProps(page: PageObjectResponse): PostProps {
  const p = page.properties as Record<string, any>;
  const title = plainText(p.Title?.title);
  const slugRaw = plainText(p.Slug?.rich_text);
  const slug = slugRaw ? slugify(slugRaw) : slugify(title);
  const publishDate: string = p['Publish Date']?.date?.start ?? '';
  const category = p.Category?.select?.name || undefined;
  const tags: string[] = p.Tags?.multi_select?.map((t: any) => t.name as string) ?? [];
  const series = p.Series?.select?.name || undefined;
  const seriesOrder =
    typeof p['Series Order']?.number === 'number' ? p['Series Order'].number : undefined;
  const coverFile = p.Cover?.files?.[0];
  const coverUrl =
    coverFile?.type === 'external' ? coverFile.external.url : coverFile?.file?.url;
  const excerpt = plainText(p.Excerpt?.rich_text) || undefined;
  const originalUrl = p['Original URL']?.url || undefined;
  const originalDate = p['Original Date']?.date?.start || undefined;

  return {
    id: page.id,
    title,
    slug,
    publishDate,
    category,
    tags,
    series,
    seriesOrder,
    coverUrl,
    excerpt,
    originalUrl,
    originalDate,
  };
}
