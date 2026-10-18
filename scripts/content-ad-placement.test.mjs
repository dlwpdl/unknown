import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const file = new URL('../src/lib/content-ad-placement.ts', import.meta.url);
const placement = {};
vm.runInNewContext(ts.transpileModule(existsSync(file) ? readFileSync(file, 'utf8') : '', {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: placement });

test('content ads follow four completed organic items and leave a following organic item', () => {
  assert.equal(typeof placement.contentAdPosition, 'function');
  for (const [total, expected] of [[0, []], [4, []], [5, [3]], [8, [3]], [9, [3, 7]], [13, [3, 7, 11]]]) {
    assert.deepEqual(Array.from({ length: total }, (_, index) => index).filter(index => placement.contentAdPosition(index, total)), expected);
  }
  for (const index of [-1, 0, 2, 3.5, NaN, Infinity]) assert.equal(placement.contentAdPosition(index, 9), false);
});

test('appending content preserves organic identities/order and existing ad keys', () => {
  assert.equal(typeof placement.contentAdPosition, 'function');
  const posts = Array.from({ length: 13 }, (_, index) => ({ id: `post-${index}` }));
  const render = items => items.flatMap((item, index) => [item, ...(placement.contentAdPosition(index, items.length) ? [{ ad: `ad-after-${item.id}` }] : [])]);
  for (const count of [4, 5, 8, 9, 13]) {
    const rows = render(posts.slice(0, count));
    assert.deepEqual(rows.filter(row => !row.ad), posts.slice(0, count));
    const next = render(posts.slice(0, count + 1));
    assert.deepEqual(next.slice(0, rows.length), rows, 'append cannot insert an ad above previously rendered rows');
  }
});
