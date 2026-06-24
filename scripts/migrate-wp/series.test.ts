import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSeries } from './series.ts';

test('detects InvestED chapter from category + title', () => {
  const r = detectSeries('Chapter 1: Why should anyone invest?', ['InvestED', 'Introduction to Stock Markets']);
  assert.deepEqual(r, { series: 'InvestED', seriesOrder: 1 });
});
test('parses chapter number with trailing dot', () => {
  const r = detectSeries('Chapter 3. Market Intermediaries', ['Introduction to Stock Markets']);
  assert.deepEqual(r, { series: 'InvestED', seriesOrder: 3 });
});
test('handles Part suffix using the chapter number', () => {
  const r = detectSeries('Chapter 4. The IPO Markets (Part 1)', ['InvestED']);
  assert.deepEqual(r, { series: 'InvestED', seriesOrder: 4 });
});
test('non-course post returns null', () => {
  assert.equal(detectSeries('Best Crypto Exchanges', ['Crypto Currency']), null);
});
