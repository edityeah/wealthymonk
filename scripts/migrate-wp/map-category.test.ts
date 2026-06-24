import test from 'node:test';
import assert from 'node:assert/strict';
import { mapCategory, toTags } from './map-category.ts';

test('insurance wins over markets by precedence', () => {
  assert.equal(mapCategory(['Health Insurance', 'US Stock Market']), 'Insurance');
});
test('indian stock market maps to Indian Markets', () => {
  assert.equal(mapCategory(['Indian Stock Market', 'Investing']), 'Indian Markets');
});
test('generic Stock Market falls to Investing & Valuation', () => {
  assert.equal(mapCategory(['Stock Market']), 'Investing & Valuation');
});
test('crypto wins over investing', () => {
  assert.equal(mapCategory(['Crypto Currency', 'Investing']), 'Crypto');
});
test('tax maps to Personal Finance & Tax', () => {
  assert.equal(mapCategory(['Tax Savings', 'Tools']), 'Personal Finance & Tax');
});
test('unknown only -> Investing & Valuation default', () => {
  assert.equal(mapCategory(['TWM News']), 'Investing & Valuation');
});
test('toTags keeps original cats as tags, drops series cats', () => {
  assert.deepEqual(
    toTags(['Introduction to Stock Markets', 'InvestED', 'Investing']),
    ['Investing'],
  );
});
