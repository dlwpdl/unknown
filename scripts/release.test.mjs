import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { parse } from 'yaml';

test('Android release gives R8 four GiB of heap while retaining signing and configuration checks', () => {
  const result = spawnSync('python3', ['-c', `
import importlib.util, json, os, re, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location('release', 'scripts/release.py')
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
class GradleCaptured(Exception): pass
with tempfile.TemporaryDirectory() as directory:
    os.chdir(directory)
    Path('app.json').write_text(json.dumps({'expo': {'version': '1.1.10', 'ios': {}, 'android': {}}}))
    r.signing = lambda *args: ('unused', 'unused', 'unused', {'keystorePath': 'existing-upload-key', 'keystorePassword': 'test', 'keyAlias': 'test', 'keyPassword': 'test'})
    def run(args, capture=False, env=None):
        if args[0] != 'android/gradlew':
            assert args == ['npx', 'expo', 'prebuild', '--platform', 'android', '--clean', '--no-install']
            return
        jvm = next((arg.split('=', 1)[1] for arg in args if arg.startswith('-Dorg.gradle.jvmargs=')), '')
        assert re.search(r'(^|\\s)-Xmx(4096m|4[gG])($|\\s)', jvm), 'R8 needs an explicit four GiB heap instead of the generated two GiB default'
        assert '--no-daemon' in args and args[-2:] == ['bundleRelease', 'assembleRelease']
        assert [Path(args[i + 1]).name for i, arg in enumerate(args) if arg == '--init-script'] == ['android-signing.init.gradle', 'android-r8-check.init.gradle']
        assert env['GLING_UPLOAD_KEYSTORE'] == 'existing-upload-key'
        app = json.loads(Path('app.json').read_text())['expo']
        assert app['version'] == '1.1.10' and app['android']['versionCode'] == 62
        raise GradleCaptured()
    r.run = run
    try: r.build('android', {}, Path(directory), True, 62)
    except GradleCaptured: pass
    else: raise AssertionError('Android release did not reach the Gradle build')
`], { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

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

test('Android sends the verified bundle to existing closed-testing review before committing', () => {
  const result = spawnSync('python3', ['-c', `
import importlib.util, json, os, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location('release', 'scripts/release.py')
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
with tempfile.TemporaryDirectory() as directory:
    os.chdir(directory)
    Path('app.json').write_text(json.dumps({'expo': {'version': '1.2.0'}}))
    Path('release-notes').mkdir()
    Path('release-notes/1.2.0.ko.txt').write_text('투표와 모임 후기를 추가했어요.')
    r.OUT.mkdir(); (r.OUT / 'app.aab').write_bytes(b'verified-bundle')
    r.google_token = lambda *args: 'test-publisher'
    r.summary = lambda *args: None
    actions = []
    def request(url, token=None, data=None, method='GET', content_type=None, **kwargs):
        assert url.startswith('https://androidpublisher.googleapis.com/upload/')
        assert token == 'test-publisher' and method == 'POST' and data == b'verified-bundle'
        actions.append('upload'); return {'versionCode': 64}
    def play(token, path='', data=None, method='GET'):
        assert token == 'test-publisher'
        if path == '/edits':
            assert method == 'POST'; actions.append('edit'); return {'id': 'owned-edit'}
        if method == 'PUT':
            assert path == '/edits/owned-edit/tracks/alpha', 'Internal testing does not send an update for closed-testing review'
            assert data['track'] == 'alpha'
            release = data['releases'][0]
            assert release['versionCodes'] == ['64'] and release['status'] == 'completed'
            assert release['releaseNotes'][0]['language'] == 'ko-KR'
            actions.append('closed-review'); return data
        if path.endswith(':validate'):
            assert actions[-1] == 'closed-review'; actions.append('validate'); return {}
        if path.endswith(':commit'):
            assert path == '/edits/owned-edit:commit' and method == 'POST'
            assert actions[-1] == 'validate'; actions.append('commit'); return {'id': 'owned-edit'}
        if method == 'DELETE': return {}
        raise AssertionError(path)
    r.request = request; r.play = play
    r.submit('android', {}, {}, Path(directory))
    assert actions == ['edit', 'upload', 'closed-review', 'validate', 'commit']
    assert r.published_android_build([{'track': 'alpha', 'releases': [{'status': 'completed', 'versionCodes': ['64']}]}]) is None
`], { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('building and submitting a release cannot raise the mandatory update policy', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/mobile-release.yml', import.meta.url), 'utf8'));
  for (const platform of ['ios', 'android']) {
    const steps = workflow.jobs[platform].steps;
    const build = steps.findIndex(step => step.name?.startsWith('Build and verify signed'));
    const submit = steps.findIndex(step => step.run?.includes('release.py submit'));
    assert.ok(build >= 0 && build < submit, `${platform}: verify before submitting`);
    for (const step of steps) {
      assert.equal(step.env?.GLING_SUPABASE_SERVICE_ROLE_KEY, undefined, `${platform}: build/review does not prove public availability`);
      assert.doesNotMatch(step.run ?? '', /release\.py (require-update|sync-policy)/);
    }
  }
});

test('iOS resubmission preserves current ATT review instructions and falls back to prior contact details', () => {
  const result = spawnSync('python3', ['-c', `
import importlib.util, json, os, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location('release', 'scripts/release.py')
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
class PublishCaptured(Exception): pass
with tempfile.TemporaryDirectory() as directory:
    os.chdir(directory)
    Path('app.json').write_text(json.dumps({'expo': {'version': '1.3.1'}}))
    Path('release-notes').mkdir(); Path('release-notes/1.3.1.ko.txt').write_text('광고 추적 권한을 먼저 확인해요.')
    r.apple_versions = lambda env: ('test-apple', [
        {'id': 'current', 'attributes': {'versionString': '1.3.1', 'appStoreState': 'PREPARE_FOR_SUBMISSION'}},
        {'id': 'previous', 'attributes': {'versionString': '1.2.3', 'appStoreState': 'READY_FOR_SALE'}}])
    prior = {'notes': 'Older review instructions', 'contactEmail': 'support@example.invalid', 'demoAccountPassword': 'old-test-password'}
    for current, expected_notes, expected_password in [
        (None, 'Older review instructions', 'old-test-password'),
        ({'notes': 'ATT: Home or Settings before any ads', 'demoAccountPassword': 'new-test-password'}, 'ATT: Home or Settings before any ads', 'new-test-password'),
        ({'notes': 'ATT: Home or Settings before any ads', 'contactEmail': None}, 'ATT: Home or Settings before any ads', 'old-test-password')]:
        writes = []
        def request(url, token=None, data=None, method='GET'):
            assert token == 'test-apple'
            if url.endswith('/appStoreVersionLocalizations'): return {'data': []}
            if url.endswith('/previous/appStoreReviewDetail'): return {'data': {'attributes': prior}}
            if url.endswith('/current/appStoreReviewDetail'): return {'data': {'id': 'current-review', 'attributes': current} if current is not None else None}
            assert method in ['POST', 'PATCH'] and '/appStoreReviewDetails' in url
            writes.append(data['data']['attributes']); return {}
        def run(args, capture=False, env=None):
            assert args[:3] == ['asc', 'publish', 'appstore']
            raise PublishCaptured()
        r.request = request; r.run = run; r.summary = lambda *args: None
        try: r.submit('ios', {}, {}, Path(directory))
        except PublishCaptured: pass
        else: raise AssertionError('did not reach the intercepted publish command')
        assert len(writes) == 1
        assert writes[0]['notes'] == expected_notes, 'current ATT instructions were overwritten'
        assert writes[0]['demoAccountPassword'] == expected_password
        assert writes[0]['contactEmail'] == 'support@example.invalid'
`], { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('an arbitrary unverified build cannot be enforced through the release command', () => {
  const result = spawnSync('python3', ['scripts/release.py', 'require-update', '--platform', 'ios', '--build-number', '65'], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8', env: { PATH: process.env.PATH },
  });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /invalid choice/);
});

test('a reviewed iOS build is enforced after fresh public availability despite a cached old lookup', () => {
  const result = spawnSync('python3', ['-c', `
import importlib.util, urllib.parse
spec = importlib.util.spec_from_file_location('release', 'scripts/release.py')
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
public = {'trackId': int(r.APP), 'version': '1.2.0'}
def version(number, state, build):
    return {'data': {'id': number, 'attributes': {'versionString': number, 'appStoreState': state}, 'relationships': {'build': {'data': {'id': str(build)}}}}, 'included': [{'type': 'builds', 'id': str(build), 'attributes': {'version': str(build), 'processingState': 'VALID'}}]}
versions = {'1.2.0': version('1.2.0', 'READY_FOR_SALE', 64), '1.2.3': version('1.2.3', 'WAITING_FOR_REVIEW', 65)}
policy = {'ios': 64, 'android': 64}; writes = []
r.apple_versions = lambda env: ('test-apple', [v['data'] for v in versions.values()])
r.google_token = lambda *args: 'test-google'
def play(token, path='', data=None, method='GET'):
    if path == '/edits': return {'id': 'read-edit'}
    if method == 'DELETE': return {}
    assert path == '/edits/read-edit/tracks'
    return {'tracks': [{'track': 'alpha', 'releases': [{'status': 'completed', 'versionCodes': ['65']}]}, {'track': 'production', 'releases': []}]}
r.play = play
def request(url, token=None, data=None, method='GET', **kwargs):
    if url.startswith('https://api.github.com/'): return {'workflow_runs': []}
    if url.startswith('https://itunes.apple.com/'):
        extra = set(urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)) - {'id', 'country'}
        return {'results': [dict(public) if extra else {'trackId': int(r.APP), 'version': '1.2.0'}]}
    if url.startswith('https://api.appstoreconnect.apple.com/'): return versions[url.split('/appStoreVersions/')[1].split('?')[0]]
    assert url.startswith(r.SUPABASE + '/rest/v1/app_release_policy?')
    assert token == kwargs['api_key'] == 'test-policy-key'
    platform = 'ios' if 'platform=eq.ios' in url else 'android'
    if method == 'PATCH':
        writes.append((platform, data['minimum_build'])); policy[platform] = data['minimum_build']; return {}
    return [{'platform': platform, 'minimum_build': policy[platform]}]
r.request = request
env = {'GLING_SUPABASE_SERVICE_ROLE_KEY': 'test-policy-key'}
r.sync_policy(env, {}, None, False)
assert policy == {'ios': 64, 'android': 64} and writes == []
versions['1.2.3']['data']['attributes']['appStoreState'] = 'READY_FOR_SALE'
r.sync_policy(env, {}, None, False)
assert policy == {'ios': 64, 'android': 64} and writes == [], 'approval alone is not public availability'
public['version'] = '1.2.3'
r.sync_policy(env, {}, None, False)
assert policy == {'ios': 65, 'android': 64} and writes == [('ios', 65)]
`], { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
