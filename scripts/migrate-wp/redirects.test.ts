import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRedirects } from './redirects.ts';

test('maps old permalink path to new post path', () => {
  const out = buildRedirects([
    { link: 'https://wealthymonk.org/chapter-1-why-invest/', newPath: '/posts/chapter-1-why-invest/' },
  ]);
  assert.equal(out.trim(), '/chapter-1-why-invest/  /posts/chapter-1-why-invest/  301');
});
test('adds trailing slash to old path before comparing', () => {
  const out = buildRedirects([
    { link: 'https://wealthymonk.org/about', newPath: '/about/' },
  ]);
  assert.equal(out.trim(), '');
});
test('skips entries whose old and new paths are equal', () => {
  const out = buildRedirects([{ link: 'https://wealthymonk.org/x/', newPath: '/x/' }]);
  assert.equal(out.trim(), '');
});
test('skips malformed links', () => {
  const out = buildRedirects([{ link: 'not a url', newPath: '/posts/y/' }]);
  assert.equal(out.trim(), '');
});
