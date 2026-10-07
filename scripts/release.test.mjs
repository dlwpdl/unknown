import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { parse } from 'yaml';

test('deployment jobs allocate only free public standard runners and no billed storage', () => {
  const root = new URL('../.github/workflows/', import.meta.url);
  assert.ok(existsSync(new URL('mobile-release.yml', root)), 'mobile release workflow is installed');
  for (const file of readdirSync(root).filter(name => name.endsWith('.yml'))) {
    const workflow = parse(readFileSync(new URL(file, root), 'utf8'));
    for (const [name, job] of Object.entries(workflow.jobs)) {
      assert.match(job.if, /github\.event\.repository\.private == false/, `${file}:${name} blocks private billing`);
      if (!job['runs-on']) continue;
      assert.ok(['ubuntu-24.04', 'ubuntu-latest', 'macos-26'].includes(job['runs-on']), `${file}:${name} uses a standard runner`);
      for (const step of job.steps ?? []) {
        assert.doesNotMatch(step.uses ?? '', /^actions\/(cache|upload-artifact)@/, 'no artifact or cache storage charges');
        assert.equal(step.with?.cache, undefined, 'no dependency cache storage');
      }
    }
  }
});

test('release preparation validates source version and avoids build numbers used by either store', () => {
  assert.ok(existsSync(new URL('release.py', import.meta.url)), 'release commands are installed');
  const result = spawnSync('python3', ['-c', `
import importlib.util
spec = importlib.util.spec_from_file_location('release', 'scripts/release.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
assert r.next_build_number(55, [54, 58], 54) == 59
assert r.next_build_number(55, [], 54) == 55
assert r.release_version('v1.1.3', '1.1.3', '1.1.3') == '1.1.3'
for tag, app, package in [('v1.1.3', '1.1.2', '1.1.2'), ('v1.1.3', '1.1.3', '1.1.2'), ('v1.1.3;bad', '1.1.3', '1.1.3')]:
    try: r.release_version(tag, app, package)
    except ValueError: pass
    else: raise AssertionError('invalid release version accepted')
`], { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
