import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('all 207 bundled display photos retain verified originals and separate derivative provenance', () => {
  const manifest = JSON.parse(readFileSync(new URL('../assets/images/city-places-display/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.images.length, 207);
  assert.deepEqual(manifest.transform, { encoder: 'cwebp', encoderVersion: '1.4.0', format: 'webp', maxEdge: 1920, quality: 84, method: 6,
    resize: 'preserve-aspect-no-upscale', crop: false, metadata: 'icc' });
  const check = spawnSync('python3', [new URL('./prepare-city-place-photos.py', import.meta.url).pathname, '--check'], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  const summary = JSON.parse(check.stdout);
  assert.equal(summary.count, 207);
  assert.equal(summary.originalBytes, 80_992_682);
  assert.ok(summary.displayBytes < summary.originalBytes / 2, 'display payload should materially reduce bundled photo bytes');
  assert.equal(summary.originalHashesUnchanged, true);
  assert.equal(summary.noOriginalStaticRequires, true);
});
