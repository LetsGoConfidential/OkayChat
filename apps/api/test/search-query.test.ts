import assert from 'node:assert/strict';
import test from 'node:test';
import { searchQueryValidationError } from '../src/search-query.ts';

test('rejects missing, blank, and one-character queries', () => {
  assert.equal(searchQueryValidationError(undefined), 'Enter at least two characters to search');
  assert.equal(searchQueryValidationError('   '), 'Enter at least two characters to search');
  assert.equal(searchQueryValidationError('x'), 'Enter at least two characters to search');
});

test('accepts the minimum length after trimming', () => {
  assert.equal(searchQueryValidationError(' ab '), null);
});

test('accepts queries up to 100 characters', () => {
  assert.equal(searchQueryValidationError('x'.repeat(100)), null);
});

test('rejects queries over 100 characters', () => {
  assert.equal(searchQueryValidationError('x'.repeat(101)), 'Search text must be 100 characters or fewer');
});
