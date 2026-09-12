import assert from 'node:assert/strict';
import test from 'node:test';
import { ageOnDate, validatePersonalInfo } from '../src/lib/personal-info.ts';

test('age uses complete UTC calendar years, including leap birthdays', () => {
  assert.equal(ageOnDate('1992-03-08', '2026-03-07'), 33);
  assert.equal(ageOnDate('1992-03-08', '2026-03-08'), 34);
  assert.equal(ageOnDate('2000-02-29', '2025-02-28'), 24);
  assert.equal(ageOnDate('2000-02-29', '2025-03-01'), 25);
  assert.equal(ageOnDate('1900-02-28', '2020-02-29'), 120);
  for (const date of ['', '2025-02-29', '2026-02-30', '2026-13-01', '2026-09-13', '1899-01-01', '1992-3-8']) {
    assert.equal(ageOnDate(date, '2026-09-12'), null, date);
  }
});

test('optional personal info validates a complete pair without restricting international names', () => {
  const today = '2026-09-12';
  assert.equal(validatePersonalInfo('', '', today), null);
  assert.equal(validatePersonalInfo(' 王 ', '2000-02-29', today), null);
  assert.equal(validatePersonalInfo('Jean-Luc O’Connor', '1906-09-12', today), null);
  for (const [name, dob] of [['김', ''], ['', '2000-01-01'], ['\n', '2000-01-01'], ['A\nB', '2000-01-01'], ['a'.repeat(201), '2000-01-01'], ['김', '1906-09-11'], ['김', '2026-02-29']]) {
    assert.ok(validatePersonalInfo(name, dob, today), JSON.stringify([name, dob]));
  }
});
