/**
 * One-shot: create the "Contact" and "Subscribers" Notion databases used by the
 * /api/contact and /api/subscribe Cloudflare Functions.
 *
 *   npx tsx --env-file-if-exists=.env scripts/create-admin-dbs.ts
 *
 * Parent: NOTION_PARENT_PAGE_ID if set (a page you've shared with the
 * integration); otherwise a holder page created inside the Posts DB
 * (NOTION_DATABASE_ID) — it has no Published status so it never renders on the
 * site, and you can drag it anywhere in Notion. Idempotent: reuses existing DBs.
 * Prints NOTION_CONTACT_DB_ID and NOTION_SUBSCRIBERS_DB_ID for the secrets.
 */
import { Client } from '@notionhq/client';

const TOKEN = process.env.NOTION_TOKEN;
const POSTS_DB = process.env.NOTION_DATABASE_ID;
const PARENT_PAGE = process.env.NOTION_PARENT_PAGE_ID;
if (!TOKEN || (!POSTS_DB && !PARENT_PAGE)) {
  console.error('Set NOTION_TOKEN and either NOTION_PARENT_PAGE_ID or NOTION_DATABASE_ID.');
  process.exit(1);
}
const notion = new Client({ auth: TOKEN });
const HOLDER_TITLE = '🗂 Wealthy Monk admin (inbox + subscribers)';

async function findDb(title: string): Promise<string | null> {
  const search = await notion.search({ query: title, filter: { property: 'object', value: 'database' } });
  const hit = (search.results as any[]).find((d) => d.title?.[0]?.plain_text === title);
  return hit?.id ?? null;
}

async function parentPageId(): Promise<string> {
  if (PARENT_PAGE) return PARENT_PAGE;
  // Reuse holder if present.
  const search = await notion.search({ query: HOLDER_TITLE, filter: { property: 'object', value: 'page' } });
  const existing = (search.results as any[]).find((p) => p.properties?.Title?.title?.[0]?.plain_text === HOLDER_TITLE);
  if (existing) return existing.id;
  const holder: any = await notion.pages.create({
    parent: { type: 'database_id', database_id: POSTS_DB! },
    properties: { Title: { title: [{ type: 'text', text: { content: HOLDER_TITLE } }] } },
  });
  console.log(`Created holder page in Posts DB: ${holder.id} (no Published status → never renders on site)`);
  return holder.id;
}

async function main() {
  const parent = await parentPageId();

  let contactId = await findDb('Contact');
  if (contactId) {
    console.log(`Reusing Contact DB: ${contactId}`);
  } else {
    const db: any = await notion.databases.create({
      parent: { type: 'page_id', page_id: parent },
      title: [{ type: 'text', text: { content: 'Contact' } }],
      properties: {
        Name: { title: {} },
        Email: { email: {} },
        Subject: { rich_text: {} },
        Message: { rich_text: {} },
        Submitted: { date: {} },
        Status: { select: { options: [
          { name: 'New', color: 'red' }, { name: 'Read', color: 'yellow' }, { name: 'Replied', color: 'green' },
        ] } },
      },
    });
    contactId = db.id;
    console.log('✅ Created "Contact" database.');
  }

  let subsId = await findDb('Subscribers');
  if (subsId) {
    console.log(`Reusing Subscribers DB: ${subsId}`);
  } else {
    const db: any = await notion.databases.create({
      parent: { type: 'page_id', page_id: parent },
      title: [{ type: 'text', text: { content: 'Subscribers' } }],
      properties: {
        Name: { title: {} },
        Email: { email: {} },
        Subscribed: { date: {} },
        Status: { select: { options: [
          { name: 'Active', color: 'green' }, { name: 'Unsubscribed', color: 'gray' },
        ] } },
        Source: { rich_text: {} },
      },
    });
    subsId = db.id;
    console.log('✅ Created "Subscribers" database.');
  }

  console.log('\n--- add these to your secrets ---');
  console.log(`NOTION_CONTACT_DB_ID=${contactId}`);
  console.log(`NOTION_SUBSCRIBERS_DB_ID=${subsId}`);
}

main().catch((e) => { console.error(e?.body ?? e); process.exit(1); });
