import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { parse } from 'yaml';

test('deployment jobs allocate only free public standard runners and no billed storage', () => {
  const root = new URL('../.github/workflows/', import.meta.url);
  assert.ok(existsSync(new URL('mobile-release.yml', root)), 'mobile release workflow is installed');
  const release = parse(readFileSync(new URL('mobile-release.yml', root), 'utf8'));
  assert.match(release.concurrency.group, /'mobile-release-policy' \|\| 'mobile-release'/, 'policy checks preserve the existing native submission queue');
  assert.equal(release.concurrency['cancel-in-progress'], false, 'a submission in progress is preserved');
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
def version(state): return [{'attributes': {'versionString': '1.1.2', 'appStoreState': state}}]
r.check_store_state(version('READY_FOR_SALE'), '1.1.3')
r.check_store_state(version('PREPARE_FOR_SUBMISSION'), '1.1.2')
for records, target in [(version('READY_FOR_SALE'), '1.1.2'), (version('WAITING_FOR_REVIEW'), '1.1.3')]:
    try: r.check_store_state(records, target)
    except ValueError: pass
    else: raise AssertionError('existing submission was not protected')
for tag, app, package in [('v1.1.3', '1.1.2', '1.1.2'), ('v1.1.3', '1.1.3', '1.1.2'), ('v1.1.3;bad', '1.1.3', '1.1.3')]:
    try: r.release_version(tag, app, package)
    except ValueError: pass
    else: raise AssertionError('invalid release version accepted')
`], { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('mandatory updates follow publicly installable builds and never lower the platform policy', () => {
  const result = spawnSync('python3', ['-c', `
import copy, importlib.util
spec = importlib.util.spec_from_file_location('release', 'scripts/release.py')
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
public = {'trackId': int(r.APP), 'version': '1.1.9'}
version = {'data': {'attributes': {'versionString': '1.1.9', 'appStoreState': 'READY_FOR_SALE'}, 'relationships': {'build': {'data': {'id': 'build61'}}}}, 'included': [{'type': 'builds', 'id': 'build61', 'attributes': {'version': '61', 'processingState': 'VALID'}}]}
assert r.published_ios_build(public, version) == 61
for path, value in [('state', 'WAITING_FOR_REVIEW'), ('public', '1.1.8'), ('build', 'PROCESSING'), ('identity', 'other'), ('number', '-1')]:
    item = copy.deepcopy(version); lookup = dict(public)
    if path == 'state': item['data']['attributes']['appStoreState'] = value
    if path == 'public': lookup['version'] = value
    if path == 'build': item['included'][0]['attributes']['processingState'] = value
    if path == 'identity': item['included'][0]['id'] = value
    if path == 'number': item['included'][0]['attributes']['version'] = value
    assert r.published_ios_build(lookup, item) is None, path
assert r.published_ios_build({'trackId': 1, 'version': '1.1.9'}, version) is None
tracks = [{'track': 'internal', 'releases': [{'status': 'completed', 'versionCodes': ['99']}]}, {'track': 'production', 'releases': [{'status': 'completed', 'versionCodes': ['60', '61']}, {'status': 'inProgress', 'versionCodes': ['62']}, {'status': 'draft', 'versionCodes': ['63']}]}]
assert r.published_android_build(tracks) == 61
assert r.published_android_build(tracks[:1]) is None
policy = {'ios': 50, 'android': 50}; writes = []
def request(url, token=None, data=None, method='GET', **kwargs):
    assert token == kwargs['api_key'] == 'test-service-role'
    assert url.startswith(r.SUPABASE + '/rest/v1/app_release_policy?')
    platform = 'ios' if 'platform=eq.ios' in url else 'android'
    if method == 'PATCH':
        assert 'minimum_build=lt.' + str(data['minimum_build']) in url
        writes.append((platform, data['minimum_build']))
        policy[platform] = max(policy[platform], data['minimum_build'])
        return {}
    assert method == 'GET'
    return [{'platform': platform, 'minimum_build': policy[platform]}]
r.request = request
assert r.enforce_policy('ios', 61, 'test-service-role')['minimum_build'] == 61
assert policy['android'] == 50 and writes == [('ios', 61)]
r.enforce_policy('ios', 61, 'test-service-role')
r.enforce_policy('ios', 60, 'test-service-role')
assert writes == [('ios', 61)]
original = r.request
r.request = lambda *args, **kwargs: [{'platform': 'ios', 'minimum_build': 50}]
try: r.enforce_policy('ios', 61, 'test-service-role')
except RuntimeError: pass
else: raise AssertionError('an unconfirmed policy update was reported as successful')
r.request = original
r.request = lambda *args, **kwargs: {'workflow_runs': [{'id': 99, 'event': 'push', 'status': 'in_progress'}, {'id': 100, 'event': 'workflow_dispatch', 'status': 'in_progress'}]}
assert r.sync_policy({'GITHUB_RUN_ID': '100'}, {}, None, False) == {'status': 'native_release_in_progress'}
r.request = lambda *args, **kwargs: {'workflow_runs': [{'id': 100, 'event': 'workflow_dispatch', 'status': 'in_progress'}]}
try: r.sync_policy({'GITHUB_RUN_ID': '100'}, {}, None, False)
except ValueError as error: assert 'SERVICE_ROLE_KEY' in str(error)
else: raise AssertionError('policy checks did not require the existing backend secret')
r.request = original
`], { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('release policy checks reuse the workflow without building or submitting another binary', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/mobile-release.yml', import.meta.url), 'utf8'));
  assert.equal(workflow.on.schedule[0].cron, '*/15 * * * *');
  assert.equal(workflow.on.workflow_dispatch.inputs.operation.default, 'build');
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.operation.options, ['build', 'sync-policy']);
  assert.match(workflow.jobs.verify.if, /event_name != 'schedule'/);
  assert.match(workflow.jobs.verify.if, /inputs.operation != 'sync-policy'/);
  const policy = workflow.jobs['sync-policy'];
  assert.match(policy.if, /event_name == 'schedule'/);
  assert.ok(policy.steps.some(step => step.run === 'python3 scripts/release.py sync-policy'));
  assert.ok(policy.env.GLING_SUPABASE_SERVICE_ROLE_KEY);
  assert.ok(policy.steps.some(step => step.run?.includes('git merge-base --is-ancestor HEAD origin/mobile-app')));
  assert.equal(workflow.jobs.ios.env.GLING_SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(workflow.jobs.android.env.GLING_SUPABASE_SERVICE_ROLE_KEY, undefined);
});
