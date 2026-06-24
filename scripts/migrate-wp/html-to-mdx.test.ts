import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToMdx } from './html-to-mdx.ts';

test('strips wp block comments and keeps text', () => {
  const out = htmlToMdx('<!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph -->', new Map());
  assert.match(out, /Hello/);
  assert.doesNotMatch(out, /wp:paragraph/);
});
test('rewrites image src via map', () => {
  const map = new Map([['https://wealthymonk.org/wp-content/uploads/a.png', '/img/a.png']]);
  const out = htmlToMdx('<img src="https://wealthymonk.org/wp-content/uploads/a.png" alt="A">', map);
  assert.match(out, /\/img\/a\.png/);
  assert.doesNotMatch(out, /wealthymonk\.org/);
});
test('rewrites image by basename when full url not in map', () => {
  const map = new Map([['b.png', '/img/b.png']]);
  const out = htmlToMdx('<img src="https://cdn.example.com/2024/b.png" alt="B">', map);
  assert.match(out, /\/img\/b\.png/);
});
test('escapes curly braces so MDX does not treat them as expressions', () => {
  const out = htmlToMdx('<p>Use {this}</p>', new Map());
  assert.doesNotMatch(out, /\{this\}/);
});
test('converts headings and links to markdown', () => {
  const out = htmlToMdx('<h2>Title</h2><p>See <a href="/x">here</a></p>', new Map());
  assert.match(out, /## Title/);
  assert.match(out, /\[here\]\(\/x\)/);
});
test('strips caption shortcodes', () => {
  const out = htmlToMdx('<p>[caption id="x" width="3"]hi[/caption]</p>', new Map());
  assert.doesNotMatch(out, /\[caption/);
  assert.doesNotMatch(out, /\[\/caption\]/);
});
test('keeps tables as html and self-closes void tags', () => {
  const out = htmlToMdx('<table><tr><td>a<br>b</td></tr></table>', new Map());
  assert.match(out, /<table>/);
  assert.match(out, /<br\s*\/>/);
});
