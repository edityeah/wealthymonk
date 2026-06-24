/**
 * Build-time content step.
 *
 * When NOTION_TOKEN + NOTION_DATABASE_ID are set, pulls Published posts from
 * the Notion "Posts" database, mirrors their images to public/img/generated/,
 * and writes MDX into src/content/posts/notion/ (rebuilt each run).
 *
 * With no credentials it exits cleanly without touching the filesystem, so the
 * site builds from the committed MDX in src/content/posts/imported/.
 *
 * Note: posts/imported/ (the one-time WordPress migration) and posts/notion/
 * (live Notion content) coexist. To move an old post into Notion, recreate it
 * there and delete its file from posts/imported/ to avoid a duplicate slug.
 */
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  fetchPublishedPosts,
  extractProps,
  notionConfigured,
} from './lib/notion.js';
import { blocksToMdx, setKnownPostSlugs } from './lib/blocks-to-mdx.js';
import { mirrorImage, mirrorFailures } from './lib/image-mirror.js';

const ROOT = process.cwd();
const POSTS_OUT = join(ROOT, 'src', 'content', 'posts', 'notion');

function yamlEscape(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function frontmatter(props: Record<string, unknown>): string {
  const lines: string[] = ['---'];
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${yamlEscape(String(item))}`);
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      lines.push(`${k}: ${v}`);
    } else {
      lines.push(`${k}: ${yamlEscape(String(v))}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

async function main() {
  if (!notionConfigured) {
    console.log('[build-content] No Notion credentials — building from committed MDX only.');
    return;
  }

  const warnings: string[] = [];
  console.log('[build-content] Fetching published posts from Notion...');
  const pages = await fetchPublishedPosts();
  console.log(`[build-content] ${pages.length} posts to render`);

  const allProps = pages.map((p) => extractProps(p));
  setKnownPostSlugs(allProps.map((p) => p.slug).filter(Boolean));

  await rm(POSTS_OUT, { recursive: true, force: true });
  await mkdir(POSTS_OUT, { recursive: true });

  for (const page of pages) {
    const props = extractProps(page);
    if (!props.title || !props.publishDate) {
      throw new Error(`Post ${page.id} missing required field (Title or Publish Date)`);
    }

    const cover = props.coverUrl ? await mirrorImage(props.coverUrl, props.slug) : undefined;
    const body = await blocksToMdx(page.id, props.slug, { warnings });

    const fm = frontmatter({
      title: props.title,
      slug: props.slug,
      publishDate: props.publishDate,
      category: props.category,
      tags: props.tags,
      series: props.series,
      seriesOrder: props.seriesOrder,
      cover,
      excerpt: props.excerpt,
      originalUrl: props.originalUrl,
      originalDate: props.originalDate,
    });

    await writeFile(join(POSTS_OUT, `${props.slug}.mdx`), fm + '\n\n' + body + '\n');
  }

  if (warnings.length) {
    console.log(`\n[build-content] ${warnings.length} block warning(s):`);
    for (const w of warnings.slice(0, 20)) console.log('  - ' + w);
  }
  if (mirrorFailures.length) {
    console.log(`\n[build-content] ${mirrorFailures.length} image(s) could not be mirrored (using original URL):`);
    for (const f of mirrorFailures.slice(0, 30)) console.log(`  - [${f.slug}] ${f.reason}: ${f.url}`);
  }
}

main().catch((err) => {
  console.error('[build-content] FAILED:', err);
  process.exit(1);
});
