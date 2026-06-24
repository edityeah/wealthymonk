import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from './slugify.ts';

test('slugify lowercases and dashes', () => {
  assert.equal(slugify('US Stock Market'), 'us-stock-market');
});
test('slugify strips punctuation and apostrophes', () => {
  assert.equal(slugify("Beginner's Guide!"), 'beginners-guide');
});
test('slugify collapses repeats and trims dashes', () => {
  assert.equal(slugify('  Tax & Savings  '), 'tax-savings');
});
