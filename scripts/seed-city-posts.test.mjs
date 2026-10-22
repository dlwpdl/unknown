import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = new URL('./seed-city-posts.sh', import.meta.url).pathname;

function dryRun(posts, extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gling-city-posts-'));
  const file = join(dir, 'posts.json');
  writeFileSync(file, JSON.stringify({ posts }));
  return execFileSync(script, ['2026-09-22'], {
    env: { ...process.env, POSTS_FILE: file, DRY_RUN: '1', ...extraEnv },
    encoding: 'utf8',
  });
}

test('도시 게시글 SQL은 원고를 그대로 싣고 프로필·시각·조회수 규칙을 포함한다', () => {
  const sql = dryRun([
    { ord: 1, city_id: 'vancouver', author_nickname: '새벽마켓', tag_slug: 'life', title: '테스트 글 하나', body: '첫 줄\n둘째 줄', source: 'https://example.com/a' },
    { ord: 2, city_id: 'montreal', author_nickname: '불어책갈피', tag_slug: 'transport', title: '테스트 글 둘', body: '내용', source: 'https://example.com/b' },
  ]);

  // 원고가 그대로 들어가야 한다. 따옴표 이스케이프는 JSON 달러 인용으로 처리한다.
  assert.ok(sql.includes('테스트 글 하나'));
  assert.ok(sql.includes('첫 줄\\n둘째 줄'));
  assert.match(sql, /from jsonb_to_recordset\(/);
  assert.match(sql, /\$GLING\$\[/);

  // 도시별 기존 프로필을 재사용하고 새 프로필을 만들지 않는다.
  assert.match(sql, /from public\.profiles pr/);
  assert.match(sql, /raise exception 'SEED_AUTHOR_NOT_FOUND'/);
  assert.doesNotMatch(sql, /offset slot\.slot/);
  assert.doesNotMatch(sql, /insert into public\.profiles/);

  // 실제 계정(운영자·테스터)에는 대신 쓰지 않는다. 시드 계정만 쓴다.
  assert.match(sql, /join auth\.users u on u\.id = pr\.id/);
  assert.match(sql, /and u\.email like '%@seed\.gling\.invalid'/);
  assert.match(sql, /pr\.nickname = slot\.author_nickname/);
  assert.doesNotMatch(sql, /오 이거 궁금했는데|맞아 나도 그랬음/);
  assert.doesNotMatch(sql, /insert into public\.comments/);

  // 실제 저장 시각으로 등록하고 과거로 소급하지 않는다.
  assert.match(sql, /where not exists \(\n  select 1 from public\.posts existing/);
  assert.match(sql, /'published',\n       0,\n       now\(\)/);
  assert.doesNotMatch(sql, /window_slot|interval '1 day'/);
  assert.match(sql, /posted_on = \(post\.created_at at time zone city\.timezone\)::date/);
  assert.match(sql, /private\.post_view_pulse/);
  assert.match(sql, /join public\.tags tag on tag\.slug = seed\.tag_slug/);
});

test('원고 파일이 없으면 아무것도 하지 않고 정상 종료한다', () => {
  const out = execFileSync(script, ['1999-01-01'], {
    env: { ...process.env, POSTS_FILE: '/nonexistent/posts.json', DRY_RUN: '1' },
    encoding: 'utf8',
  });
  assert.match(out, /SKIP/);
  assert.doesNotMatch(out, /jsonb_to_recordset/);
});

test('조회수는 0에서 시작하고 GROW=1은 원고 없이 조회수만 갱신한다', () => {
  const posts = [
    { ord: 1, city_id: 'calgary', author_nickname: '17에비뉴커피', tag_slug: 'life', title: '테스트 글', body: '내용', source: 'https://example.com/c' },
  ];

  // 새 글은 조회수 0으로 들어간다.
  assert.match(dryRun(posts), /'published',\n       0,/);
  assert.doesNotMatch(dryRun(posts), /generate_series/);

  const grown = dryRun([], { GROW: '1', POSTS_FILE: '/nonexistent/posts.json' });
  assert.doesNotMatch(grown, /insert into public\.posts|gling_today|jsonb_to_recordset/);
  // 하루1~30/1~8개의 현재10분 구간만 선택하며 누락된 구간은 보충하지 않는다.
  assert.match(grown, /case when base\.elapsed <= 13 then 30 else 8 end/);
  assert.match(grown, /date_bin\(interval '10 minutes', now\(\)/);
  assert.match(grown, /set view_count = post\.view_count \+ 1/);
  assert.match(grown, /for no key update of p skip locked/i);
  assert.match(grown, /p\.view_count < 100000000/);
  assert.match(grown, /on conflict on constraint post_view_pulse_pkey do nothing/);
  assert.doesNotMatch(grown, /set view_count = target\.views|sum\(added\)/);
  assert.doesNotMatch(grown, /update private\.post_view_pulse|(?:insert into|update|delete from) public\.post_views/);
});

test('빈 예약 큐와 원고 없는 회차도 다섯 도시 조회수는 독립적으로 갱신한다', () => {
  for (const extraEnv of [{}, { POSTS_FILE: '/nonexistent/posts.json' }]) {
    const sql = dryRun([], { DUE: '1', ...extraEnv });
    assert.match(sql, /generate_series/);
    assert.match(sql, /'toronto', 'vancouver', 'montreal', 'calgary', 'edmonton'/);
    assert.doesNotMatch(sql, /insert into public\.posts|gling_today/);
  }
});

test('실제 Postgres에서 구간별 증가·동시 실행·실제 조회와 과거 버킷을 보존한다', {
  skip: !process.env.CITY_POSTS_TEST_CONTAINER, timeout: 30000,
}, async () => {
  const container = process.env.CITY_POSTS_TEST_CONTAINER;
  const db = `gling_city_growth_test_${process.pid}`;
  const args = ['exec', '-i', container, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', db];
  const query = (input) => execFileSync('docker', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const source = dryRun([], { GROW: '1', POSTS_FILE: '/nonexistent/posts.json' });
  const sql = source.slice(source.indexOf('begin;'));
  const start = Date.UTC(2026, 9, 14), day = 86400000, slot = 600000;
  const at = (time) => sql.replaceAll('now()', `'${new Date(time).toISOString()}'::timestamptz`);
  const id = '00000000-0000-0000-0000-000000000001';
  const state = () => JSON.parse(query(`select json_build_object(
    'views',(select view_count from public.posts where id='${id}'),
    'pulse',(select sum(views) from private.post_view_pulse where post_id='${id}'),
    'real',(select count(*) from public.post_views where post_id='${id}'))`));
  const selectedTime = (age) => start - day + age * day
    + Number(query(`select abs(hashtext('${id}-slot-${age}')::bigint) % 144`)) * slot;
  // The first session keeps its transaction open until the competing request finishes.
  async function whileLocked(input, check, finish = '') {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '';
    child.stderr.on('data', (chunk) => { errors += chunk; });
    const done = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(errors)));
    });
    const ready = new Promise((resolve, reject) => {
      child.stdout.on('data', (chunk) => { output += chunk; if (output.includes('fixture_ready')) resolve(); });
      done.then(() => reject(new Error('fixture closed before lock check')), reject);
    });
    child.stdin.write(`begin;\n${input}\nselect 'fixture_ready';\n`);
    try { await ready; await check(); }
    finally { child.stdin.end(`${finish}\ncommit;\n`); await done; }
  }
  execFileSync('docker', ['exec', container, 'createdb', '-U', 'postgres', db]);
  try {
    query(`create schema private;
      create table public.posts(id uuid primary key,city_id text,status text,deleted_at timestamptz,created_at timestamptz,view_count integer not null);
      create table public.post_views(post_id uuid,user_id integer,primary key(post_id,user_id));
      create table private.post_view_pulse(post_id uuid references public.posts(id),bucket timestamptz,views integer,primary key(post_id,bucket));
      insert into public.posts values
        ('${id}','vancouver','published',null,'2026-10-13',9),
        ('00000000-0000-0000-0000-000000000002','toronto','published',null,'2026-09-30',100000),
        ('00000000-0000-0000-0000-000000000003','montreal','published',null,'2026-11-23',0),
        ('00000000-0000-0000-0000-000000000004','calgary','removed',null,'2026-10-13',0),
        ('00000000-0000-0000-0000-000000000005','edmonton','published','2026-10-13','2026-10-13',0),
        ('00000000-0000-0000-0000-000000000006','vancouver','published',null,'2026-09-13',0),
        ('00000000-0000-0000-0000-000000000007','toronto','published',null,'2026-09-14',0),
        ('00000000-0000-0000-0000-000000000008','ottawa','published',null,'2026-10-13',0),
        ('00000000-0000-0000-0000-000000000009','montreal','published',null,'2026-10-14',0),
        ('00000000-0000-0000-0000-000000000010','calgary','published',null,'2026-10-13',100000000),
        ('00000000-0000-0000-0000-000000000011','edmonton','published',null,'2026-10-13',2147483647);
      insert into public.post_views values ('${id}',1),('${id}',2);
      insert into private.post_view_pulse values ('${id}','2026-10-12',3),('${id}','2026-10-13',4);`);
    query(at(start));
    assert.equal(query("select view_count from public.posts where id='00000000-0000-0000-0000-000000000009'"), '0');
    const first = selectedTime(1), before = state();
    query(at(first));
    const once = state();
    assert.ok(once.views - before.views <= 1, 'restoration never catches up missed days');
    query(at(first + slot / 2));
    assert.deepEqual(state(), once, 'a repeated 5-minute tick cannot add twice');

    query(Array.from({ length: 144 }, (_, tick) => at(start + tick * slot)).join('\n'));
    const full = state();
    const quota = Number(query(`select 1 + abs(hashtext('${id}-1')::bigint) % 30`));
    assert.equal(full.views, 9 + quota);
    assert.equal(full.pulse, 7 + quota, 'only actual administrative increments enter pulse');
    assert.equal(full.real, 2);
    assert.equal(query(`select string_agg(views::text,',' order by bucket) from private.post_view_pulse where post_id='${id}' and bucket<'2026-10-14'`), '3,4');
    assert.equal(query("select view_count - 100000 = 1 + abs(hashtext(id::text || '-14')::bigint) % 8 from public.posts where id='00000000-0000-0000-0000-000000000002'"), 't');
    assert.equal(query("select count(*) from public.posts where id::text between '00000000-0000-0000-0000-000000000003' and '00000000-0000-0000-0000-000000000008' and view_count<>0"), '0');
    assert.equal(query("select string_agg(view_count::text,',' order by id) from public.posts where id::text>='00000000-0000-0000-0000-000000000010'"), '100000000,2147483647');
    assert.equal(query('select count(*) from public.posts'), '11', 'growth cannot publish or resurrect a post');

    const concurrent = selectedTime(2), old = state();
    await whileLocked(at(concurrent).replace(/^begin;\s*/, '').replace(/commit;\s*$/, ''), () => query(at(concurrent)));
    assert.deepEqual(state(), { views: old.views + 1, pulse: old.pulse + 1, real: 2 });

    const readTime = selectedTime(3), preRead = state();
    await whileLocked(`insert into public.post_views values ('${id}',3); update public.posts set view_count=view_count+1 where id='${id}';`, () => query(at(readTime)));
    assert.deepEqual(state(), { views: preRead.views + 1, pulse: preRead.pulse, real: 3 });
    query(at(readTime));
    assert.deepEqual(state(), { views: preRead.views + 2, pulse: preRead.pulse + 1, real: 3 });

    const anonTime = selectedTime(4), bucket = new Date(anonTime).toISOString();
    query(`insert into private.post_view_pulse values ('${id}','${bucket}',3); update public.posts set view_count=view_count+3 where id='${id}';`);
    const anon = state();
    query(at(anonTime));
    assert.deepEqual(state(), anon, 'an existing real anonymous pulse skips administrative growth');

    const busyTime = selectedTime(5), busyBucket = new Date(busyTime).toISOString(), preBusy = state();
    await whileLocked(`insert into private.post_view_pulse values ('${id}','${busyBucket}',1);`, () => {
      assert.throws(() => query(at(busyTime)), /lock timeout/);
      assert.deepEqual(state(), preBusy, 'a pulse conflict rolls back the whole growth request');
    }, `update public.posts set view_count=view_count+1 where id='${id}';`);
    assert.deepEqual(state(), { views: preBusy.views + 1, pulse: preBusy.pulse + 1, real: 3 });
  } finally {
    execFileSync('docker', ['exec', container, 'dropdb', '-U', 'postgres', '--force', db]);
  }
});

test('작성자를 고르지 않은 원고는 등록하지 않는다', () => {
  assert.throws(() => dryRun([
    { ord: 1, city_id: 'vancouver', tag_slug: 'life', title: '누가 썼지', body: '내용' },
  ]), /author_nickname/);
});

test('사연 투표와 가족 바인딩이 빠지거나 잘못된 원고는 전송 전에 거부한다', () => {
  const story = { ord: 1, city_id: 'vancouver', author_nickname: 'seed', tag_slug: 'life',
    content_kind: 'community_story', post_id: '10000000-0000-0000-0000-000000000777', title: '사연 투표', body: '재구성한 사연',
    poll: { question: '어떻게 할까?', options: ['대출', '차', '나누기'] },
    story_fit: { profile_id: '10000000-0000-0000-0000-000000000001', family: { relationship_status: 'married' }, topic: '부부 돈 관리' } };
  for (const invalid of [{ ...story, poll: null }, { ...story, poll: { question: '질문', options: ['A', ' A '] } },
    { ...story, story_fit: null }, { ...story, poll: { question: '질문', options: ['A', 1] } }]) {
    assert.throws(() => dryRun([invalid]), /INVALID_STORY_POLL_OR_FAMILY_BINDING/);
  }
  assert.ok(dryRun([story]).includes('사연 투표'));
});

test('구버전 원고는 자동 예약 실행에서 전체 게시하지 않는다', () => {
  const out = dryRun([{ ord: 1, city_id: 'vancouver', author_nickname: 'seed', tag_slug: 'life', title: '옛 원고', body: '본문' }], { DUE: '1' });
  assert.match(out, /SKIP/);
  assert.doesNotMatch(out, /insert into public\.posts/);
});

test('SQL 달러 인용을 닫는 원고는 전송 전에 거부한다', () => {
  assert.throws(() => dryRun([{ ord: 1, city_id: 'vancouver', author_nickname: 'seed', tag_slug: 'life', title: '테스트', body: '$GLING$; drop table public.posts;' }]), /INVALID_SQL_DELIMITER/);
});

test('기존 수동 요청은 도시·건수를 줄여서 복사해도 그대로 보존한다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gling-city-stage-'));
  const source = join(dir, 'posts.json');
  const data = { posts: [{ ord: 1, city_id: 'vancouver', author_nickname: 'seed', tag_slug: 'life', title: '수동 한 건', body: '본문' }] };
  writeFileSync(source, JSON.stringify(data));
  try {
    execFileSync(script, ['2026-10-12'], { env: { ...process.env, STAGE: '1', POSTS_FILE: source, CITY_POSTS_DIR: dir }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'payload/2026-10-12.json'), 'utf8')), data);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('수동 복사로 같은 날짜의 실행 중 예약 큐를 덮어쓰지 않는다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gling-city-preserve-'));
  const source = join(dir, 'source.json'), dest = join(dir, 'payload/2026-10-12.json');
  writeFileSync(source, JSON.stringify({ posts: [{ title: '수동 변경' }] }));
  execFileSync('mkdir', ['-p', join(dir, 'payload')]);
  const queued = JSON.stringify({ queue_version: 1, day: '2026-10-12', posts: [] });
  writeFileSync(dest, queued);
  try {
    const run = spawnSync(script, ['2026-10-12'], { env: { ...process.env, STAGE: '1', POSTS_FILE: source, CITY_POSTS_DIR: dir }, encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.equal(readFileSync(dest, 'utf8'), queued);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('HTTP 실패·비정상 JSON 응답은 저장 성공으로 보고하지 않는다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gling-city-http-'));
  const file = join(dir, 'posts.json'), bashEnv = join(dir, 'bash-env');
  writeFileSync(file, JSON.stringify({ posts: [{ ord: 1, city_id: 'vancouver', author_nickname: 'seed', tag_slug: 'life', title: 'HTTP 검증', body: '본문' }] }));
  try {
    for (const response of ['printf "";', 'printf "{\\\"error\\\":\\\"denied\\\"}"; return 22;']) {
      writeFileSync(bashEnv, `security() { printf fixture-token; }\ncurl() { cat >/dev/null; ${response} }\n`);
      const run = spawnSync(script, ['2026-10-12'], { env: { ...process.env, POSTS_FILE: file, CITY_POSTS_DIR: dir, BASH_ENV: bashEnv }, encoding: 'utf8' });
      assert.notEqual(run.status, 0);
      assert.doesNotMatch(readFileSync(join(dir, '2026-10-12.log'), 'utf8'), /OK /);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('실제 예약 실행 경로는 한 건만 보내고 확인 영수증·미확인 시도를 재전송하지 않는다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gling-city-due-'));
  const file = join(dir, 'queue.json'), bashEnv = join(dir, 'bash-env'), capture = join(dir, 'requests.jsonl');
  const day = '2026-10-12';
  const clock = join(dir, 'clock.py');
  writeFileSync(clock, `import runpy,sys\nfrom datetime import datetime as RealDateTime\ncode=runpy.run_path(sys.argv[1])\nclass Clock(RealDateTime):\n @classmethod\n def now(cls,tz=None): return RealDateTime.fromisoformat('2026-10-12T19:00:00+00:00').astimezone(tz)\ncode['main'].__globals__['datetime']=Clock\nsys.argv=sys.argv[1:]\ncode['main']()\n`);
  const clockEnv = `python3() { if [[ "$1" == *city-post-schedule.py ]]; then command python3 '${clock}' "$@"; else command python3 "$@"; fi; }\n`;
  const receiptDir = join(dir, `receipts/${day}.json.d`);
  const readReceipts = () => Object.assign({}, ...readdirSync(receiptDir).map(name => JSON.parse(readFileSync(join(receiptDir, name), 'utf8'))));
  const ageReceipts = () => {
    for (const name of readdirSync(receiptDir)) {
      const file = join(receiptDir, name), rows = JSON.parse(readFileSync(file, 'utf8'));
      for (const row of Object.values(rows)) row.attempted_at = '2026-10-12T18:54:59+00:00';
      writeFileSync(file, JSON.stringify(rows));
    }
  };
  // Clock, keychain and HTTP are fixtures; the actual scheduler and shell publisher run.
  const queue = execFileSync('python3', ['-c', `import json; from datetime import datetime,time,timedelta,date; from zoneinfo import ZoneInfo
day='${day}'; start=datetime.combine(date.fromisoformat(day),time(9),ZoneInfo('America/Vancouver'))
posts=[dict(ord=i+1,city_id=['vancouver','toronto','montreal','edmonton','calgary'][i%5],author_nickname='existing seed',tag_slug='life',title='fixture-'+str(i),body='본문',publish_at=(start+timedelta(minutes=i*10)).isoformat()) for i in range(25)]
print(json.dumps(dict(queue_version=1,day=day,posts=posts)))`], { encoding: 'utf8' });
  writeFileSync(file, queue);
  const env = { ...process.env, POSTS_FILE: file, CITY_POSTS_DIR: dir, BASH_ENV: bashEnv, CAPTURE_FILE: capture, DUE: '1' };
  try {
    writeFileSync(bashEnv, clockEnv + `security() { printf fixture-token; }\ncurl() { local request; request="$(cat)"; printf '%s\\n' "$request" >> "$CAPTURE_FILE"; if [[ "$request" == *generate_series* ]]; then return 22; fi; printf '[{"id":"11111111-1111-4111-8111-111111111111","city_id":"vancouver","title":"fixture-0","author_nickname":"existing seed","created_at":"${day}T17:00:00+00:00"}]'; }\n`);
    execFileSync(script, [day], { env, encoding: 'utf8' });
    let receipts = readReceipts();
    assert.equal(receipts['vancouver\nfixture-0'].status, 'confirmed');
    // 연속 호출은 실제5분 gate에서 전송 없이 끝난다. 다음 tick은 fixture 영수증의 경과시간으로 재현한다.
    assert.match(execFileSync(script, [day], { env: { ...env, DRY_RUN: '1' }, encoding: 'utf8' }), /SKIP/);
    ageReceipts();
    writeFileSync(bashEnv, clockEnv + 'security() { printf fixture-token; }\ncurl() { cat >> "$CAPTURE_FILE"; printf "\\n" >> "$CAPTURE_FILE"; return 22; }\n');
    assert.notEqual(spawnSync(script, [day], { env, encoding: 'utf8' }).status, 0);
    receipts = readReceipts();
    const attempted = Object.entries(receipts).filter(([, row]) => row.status === 'attempted');
    assert.equal(attempted.length, 1);
    assert.notEqual(attempted[0][0], 'vancouver\nfixture-0');
    ageReceipts();
    const sql = execFileSync(script, [day], { env: { ...env, DRY_RUN: '1' }, encoding: 'utf8' });
    const next = JSON.parse(sql.split('$GLING$')[1]);
    assert.equal(next.length, 1);
    assert.notEqual(next[0].title, 'fixture-0');
    assert.notEqual(next[0].title, attempted[0][0].split('\n')[1]);
    const queries = readFileSync(capture, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line).query);
    assert.equal(queries.length, 4);
    const growth = queries.filter((query) => query.includes('generate_series'));
    const published = queries.filter((query) => query.includes('insert into public.posts'));
    assert.equal(growth.length, 2);
    assert.equal(published.length, 2);
    for (const query of growth) assert.doesNotMatch(query, /insert into public\.posts|gling_today/);
    const sent = published.map((query) => JSON.parse(query.split('$GLING$')[1]));
    assert.deepEqual(sent.map((posts) => posts.length), [1, 1]);
    assert.equal(sent[0][0].title, 'fixture-0');
    assert.notEqual(sent[1][0].title, sent[0][0].title);
    assert.match(published[0], /commit;[\s\S]*select p\.id, p\.city_id, p\.title, p\.created_at/);
    assert.match(published[0], /commit;[\s\S]*author\.nickname=wanted\.author_nickname[\s\S]*seed_user\.email like '%@seed\.gling\.invalid'/);
    assert.doesNotMatch(published[0], /generate_series|interval '1 day'/);
    // 조회수 요청이 실패해도 게시 영수증은 확인되며, 큐 소진 뒤에도 증가 요청만 보낸다.
    const completed = Object.fromEntries(JSON.parse(queue).posts.map((post) => [`${post.city_id}\n${post.title}`, { status: 'confirmed' }]));
    writeFileSync(join(dir, `receipts/${day}.json`), JSON.stringify(completed));
    execFileSync(script, [day], { env, encoding: 'utf8' });
    const exhausted = readFileSync(capture, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line).query);
    assert.equal(exhausted.length, 5);
    assert.match(exhausted.at(-1), /generate_series/);
    assert.doesNotMatch(exhausted.at(-1), /insert into public\.posts/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('실제 HTTP 전송 JSON에서도 긴 한글 원고와 유니코드를 손상 없이 보존한다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gling-city-transport-'));
  const day = `transport-test-${process.pid}`;
  const file = join(dir, 'posts.json');
  const capture = join(dir, 'request.json');
  const bashEnv = join(dir, 'bash-env');
  const posts = [{
    ord: 1, city_id: 'toronto', author_nickname: '서비스온타리오', tag_slug: 'life',
    title: '한글·Montréal·☕ 원고', body: '가나다라마바사 Montréal ☕ "인용"\n'.repeat(1200),
    source: 'https://example.com/transport',
  }];
  writeFileSync(file, JSON.stringify({ posts }));
  // 실제 직렬화는 실행하고 키체인·외부 HTTP 경계만 차단한다.
  writeFileSync(bashEnv, 'security() { printf fixture-token; }\ncurl() { cat > "$CAPTURE_FILE"; printf "[]\\n"; }\n');
  try {
    execFileSync(script, [day], {
      env: { ...process.env, POSTS_FILE: file, DRY_RUN: '0', GROW: '0', BASH_ENV: bashEnv, CAPTURE_FILE: capture },
      encoding: 'utf8',
    });
    const { query } = JSON.parse(readFileSync(capture, 'utf8'));
    const payload = query.split('$GLING$')[1];
    assert.deepEqual(JSON.parse(payload), posts);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(homedir(), 'Library/Application Support/gling/city-posts', `${day}.log`), { force: true });
  }
});
