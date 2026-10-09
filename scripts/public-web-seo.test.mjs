import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finishPublicWeb } from './finish-public-web.mjs';
import { CITIES } from '../src/lib/mock.ts';
import { PUBLIC_SITE, PUBLIC_SOURCE } from '../src/lib/public-seo.ts';

test('기존 export는 공개 도시별 라이브 sitemap/AI 탐색과 보호 경로 robots를 생성한다', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gling-seo-export-'));
  try {
    mkdirSync(join(directory, 'auth'));
    writeFileSync(join(directory, '+not-found.html'), 'existing-fallback');
    writeFileSync(join(directory, 'auth', 'keep.html'), 'preserved');
    finishPublicWeb(directory);
    assert.equal(readFileSync(join(directory, '404.html'), 'utf8'), 'existing-fallback');
    assert.equal(readFileSync(join(directory, 'auth', 'keep.html'), 'utf8'), 'preserved');
    const robots = readFileSync(join(directory, 'robots.txt'), 'utf8');
    const llms = readFileSync(join(directory, 'llms.txt'), 'utf8');
    for (const city of CITIES.filter(c => c.state === 'open')) {
      assert.ok(robots.includes(`Sitemap: ${PUBLIC_SOURCE}?format=sitemap&city=${city.id}`));
      assert.ok(llms.includes(`${PUBLIC_SOURCE}?format=markdown&city=${city.id}`));
    }
    for (const path of ['/merchant/', '/auth/', '/admin', '/chat', '/profile']) assert.ok(robots.includes(`Disallow: ${path}`));
    assert.ok(robots.includes(`Sitemap: ${PUBLIC_SITE}/sitemap.xml`));
    assert.ok(!robots.includes('User-agent: GPTBot'), 'AI 학습의 별도 정책을 임의로 바꾸지 않는다');
    const sitemap = readFileSync(join(directory, 'sitemap.xml'), 'utf8');
    assert.ok(!sitemap.includes('/merchant'));
    assert.ok(!sitemap.includes('/admin'));
    assert.ok(sitemap.includes(`${PUBLIC_SITE}/privacy`));
    assert.ok(!llms.includes('sb_publishable_'));
  } finally { rmSync(directory, { recursive: true }); }
});
