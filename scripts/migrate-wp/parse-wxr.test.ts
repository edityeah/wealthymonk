import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWxr } from './parse-wxr.ts';
import { readFileSync } from 'node:fs';

const xml = readFileSync(new URL('./fixture.xml', import.meta.url), 'utf8');
const parsed = parseWxr(xml);

test('separates posts, pages, attachments', () => {
  assert.equal(parsed.posts.length, 1);
  assert.equal(parsed.pages.length, 1);
  assert.equal(parsed.attachments.length, 1);
});
test('post carries title, date, link, categories, html', () => {
  const p = parsed.posts[0];
  assert.match(p.title, /Chapter 1/);
  assert.ok(p.date instanceof Date);
  assert.ok(p.link.startsWith('http'));
  assert.ok(p.categories.includes('InvestED'));
  assert.ok(p.html.length > 0);
});
test('post tags separated from categories', () => {
  const p = parsed.posts[0];
  assert.ok(p.tags.includes('equity'));
  assert.ok(!p.categories.includes('equity'));
});
test('featured image resolved from thumbnail id', () => {
  assert.match(parsed.posts[0].featuredUrl ?? '', /hero\.png/);
});
