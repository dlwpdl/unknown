import test from 'node:test';
import assert from 'node:assert/strict';
import { localDateInput, parseLocalDateInput, mergePickerDate } from '../src/lib/chilling-date.ts';
test('local date entry round trips without manual UTC offsets and rejects impossible dates', () => {
  const date = new Date(2027, 0, 12, 17, 30);
  assert.equal(localDateInput(date.toISOString()), '2027-01-12T17:30');
  assert.equal(parseLocalDateInput('2027-01-12T17:30'), date.toISOString());
  assert.equal(parseLocalDateInput('2027-02-30T12:00'), '');
  assert.equal(parseLocalDateInput(''), '');
  const picked = new Date('2027-03-14T00:00:00Z');
  const merged = new Date(mergePickerDate(date.toISOString(), picked, 'date'));
  assert.deepEqual([merged.getFullYear(), merged.getMonth(), merged.getDate(), merged.getHours(), merged.getMinutes()], [2027, 2, 14, 17, 30]);
});
