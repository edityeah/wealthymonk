/**
 * Build-time content step.
 *
 * When NOTION_TOKEN + NOTION_DATABASE_ID are set, this pulls Published posts
 * from Notion into src/content/posts/notion/ and mirrors their images (full
 * implementation lands with the Notion pipeline task). Until then it is a
 * graceful no-op so the site builds from the committed imported MDX.
 */
const token = process.env.NOTION_TOKEN;
const db = process.env.NOTION_DATABASE_ID;

if (!token || !db) {
  console.log('[build-content] No Notion credentials — building from committed MDX only.');
  process.exit(0);
}

console.log('[build-content] Notion credentials present — pulling posts is not yet wired up.');
console.log('[build-content] (Notion pipeline pending; committed MDX is the source for now.)');
process.exit(0);
