import assert from 'node:assert/strict';
import test from 'node:test';
import { plainToInstance } from 'class-transformer';
import { MinLength, validateSync } from 'class-validator';
import { searchQueryValidationError } from '../src/search-query.ts';
import { TrimInput, trimInput } from '../src/input-normalization.ts';

class NameInput {
  name!: string;
}
MinLength(2)(NameInput.prototype, 'name');
TrimInput()(NameInput.prototype, 'name');

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

test('trims user-entered strings before DTO validation', () => {
  assert.equal(trimInput('  Acme Studio  '), 'Acme Studio');
  assert.equal(trimInput('   '), '');
});

test('leaves non-string values unchanged for validators to reject', () => {
  assert.equal(trimInput(42), 42);
  assert.equal(trimInput(null), null);
});

test('class-validator rejects whitespace-only required names after transformation', () => {
  const dto = plainToInstance(NameInput, { name: '   ' });
  assert.equal(dto.name, '');
  assert.equal(validateSync(dto).length, 1);
});

test('class-validator accepts valid names after trimming surrounding spaces', () => {
  const dto = plainToInstance(NameInput, { name: '  OkayChat  ' });
  assert.equal(dto.name, 'OkayChat');
  assert.equal(validateSync(dto).length, 0);
});
