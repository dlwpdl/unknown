import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import configure from '../app.config.js';

test('public app settings are preserved and private admin builds cannot run in CI', (t) => {
  const env = { ...process.env };
  t.after(() => { process.env = env; });
  const config = JSON.parse(readFileSync(new URL('../app.json', import.meta.url))).expo;
  delete process.env.GLING_LOCAL_ADMIN;
  delete process.env.GLING_WEB_BASE_URL;
  assert.deepEqual(configure({ config }), config);
  process.env.GLING_WEB_BASE_URL = '/gling';
  assert.equal(configure({ config }).experiments.baseUrl, '/gling');
  process.env.GLING_LOCAL_ADMIN = '1';
  delete process.env.CI;
  const admin = configure({ config });
  assert.deepEqual(admin.plugins[0], ['expo-router', { root: './src/admin' }]);
  assert.equal(admin.experiments.baseUrl, '');
  assert.equal(admin.experiments.typedRoutes, false);
  process.env.CI = 'true';
  assert.throws(() => configure({ config }), /must never be built in CI/);
});
