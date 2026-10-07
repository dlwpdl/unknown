import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function appFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'admin' || entry.name === 'gling-loader.tsx') return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? appFiles(path) : /\.tsx$/.test(entry.name) ? [path] : [];
  });
}

test('사용자 앱의 로딩은 글링 로고 로더 하나로 표시한다', () => {
  const root = new URL('../src/', import.meta.url).pathname;
  for (const file of [...appFiles(join(root, 'app')), ...appFiles(join(root, 'components'))]) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\bActivityIndicator\b/, file);
  }
});
