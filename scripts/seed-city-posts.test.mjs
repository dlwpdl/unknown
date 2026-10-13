import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('조회수는 0에서 시작하고 GROW=1일 때만 나이 기준으로 오르며 당일도 반영된다', () => {
  const posts = [
    { ord: 1, city_id: 'calgary', author_nickname: '17에비뉴커피', tag_slug: 'life', title: '테스트 글', body: '내용', source: 'https://example.com/c' },
  ];

  // 새 글은 조회수 0으로 들어간다.
  assert.match(dryRun(posts), /'published',\n       0,/);
  assert.doesNotMatch(dryRun(posts), /generate_series/);

  const grown = dryRun(posts, { GROW: '1' });
  // 1~14일차 하루 1~30, 15~30일차 하루 1~8, 30일에서 멈춤.
  assert.match(grown, /case when day\.i <= 13 then 30 else 8 end/);
  assert.match(grown, /least\(30, base\.elapsed\)/);
  // 올린 당일은 경과 시간 비율로 반영한다.
  assert.match(grown, /base\.age_seconds - least\(30, base\.elapsed\) \* 86400/);
  // 나이로 목표값을 계산하므로 재실행해도 같은 값이 된다.
  assert.match(grown, /where post\.id = target\.id and post\.view_count < target\.views/);
  assert.match(grown, /update private\.post_view_pulse pulse/);
});

test('작성자를 고르지 않은 원고는 등록하지 않는다', () => {
  assert.throws(() => dryRun([
    { ord: 1, city_id: 'vancouver', tag_slug: 'life', title: '누가 썼지', body: '내용' },
  ]), /author_nickname/);
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

const vancouverHour = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
test('실제 예약 실행 경로는 한 건만 보내고 확인 영수증·미확인 시도를 재전송하지 않는다', { skip: vancouverHour < 10 || vancouverHour >= 21 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'gling-city-due-'));
  const file = join(dir, 'queue.json'), bashEnv = join(dir, 'bash-env'), capture = join(dir, 'requests.jsonl');
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  // 실제 clock의 오늘09:00부터10분 간격. 공급자와 키체인만 대체한다.
  const queue = execFileSync('python3', ['-c', `import json; from datetime import datetime,time,timedelta,date; from zoneinfo import ZoneInfo
day='${day}'; start=datetime.combine(date.fromisoformat(day),time(9),ZoneInfo('America/Vancouver'))
posts=[dict(ord=i+1,city_id=['vancouver','toronto','montreal','edmonton','calgary'][i%5],author_nickname='existing seed',tag_slug='life',title='fixture-'+str(i),body='본문',publish_at=(start+timedelta(minutes=i*10)).isoformat()) for i in range(25)]
print(json.dumps(dict(queue_version=1,day=day,posts=posts)))`], { encoding: 'utf8' });
  writeFileSync(file, queue);
  const env = { ...process.env, POSTS_FILE: file, CITY_POSTS_DIR: dir, BASH_ENV: bashEnv, CAPTURE_FILE: capture, DUE: '1' };
  try {
    writeFileSync(bashEnv, `security() { printf fixture-token; }\ncurl() { cat >> "$CAPTURE_FILE"; printf '\\n' >> "$CAPTURE_FILE"; printf '[{"id":"11111111-1111-4111-8111-111111111111","city_id":"vancouver","title":"fixture-0","author_nickname":"existing seed","created_at":"${day}T17:00:00+00:00"}]'; }\n`);
    execFileSync(script, [day], { env, encoding: 'utf8' });
    let receipts = JSON.parse(readFileSync(join(dir, `receipts/${day}.json`), 'utf8'));
    assert.equal(receipts['vancouver\nfixture-0'].status, 'confirmed');
    // 연속 호출은 실제5분 gate에서 전송 없이 끝난다. 다음 tick은 fixture 영수증의 경과시간으로 재현한다.
    assert.match(execFileSync(script, [day], { env: { ...env, DRY_RUN: '1' }, encoding: 'utf8' }), /SKIP/);
    receipts['vancouver\nfixture-0'].attempted_at = new Date(Date.now() - 301000).toISOString().replace('Z', '+00:00');
    writeFileSync(join(dir, `receipts/${day}.json`), JSON.stringify(receipts));
    writeFileSync(bashEnv, 'security() { printf fixture-token; }\ncurl() { cat >> "$CAPTURE_FILE"; printf "\\n" >> "$CAPTURE_FILE"; return 22; }\n');
    assert.notEqual(spawnSync(script, [day], { env, encoding: 'utf8' }).status, 0);
    receipts = JSON.parse(readFileSync(join(dir, `receipts/${day}.json`), 'utf8'));
    const attempted = Object.entries(receipts).filter(([, row]) => row.status === 'attempted');
    assert.equal(attempted.length, 1);
    assert.notEqual(attempted[0][0], 'vancouver\nfixture-0');
    for (const row of Object.values(receipts)) row.attempted_at = new Date(Date.now() - 301000).toISOString().replace('Z', '+00:00');
    writeFileSync(join(dir, `receipts/${day}.json`), JSON.stringify(receipts));
    const sql = execFileSync(script, [day], { env: { ...env, DRY_RUN: '1' }, encoding: 'utf8' });
    const next = JSON.parse(sql.split('$GLING$')[1]);
    assert.equal(next.length, 1);
    assert.notEqual(next[0].title, 'fixture-0');
    assert.notEqual(next[0].title, attempted[0][0].split('\n')[1]);
    const queries = readFileSync(capture, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line).query);
    assert.equal(queries.length, 2);
    const sent = queries.map((query) => JSON.parse(query.split('$GLING$')[1]));
    assert.deepEqual(sent.map((posts) => posts.length), [1, 1]);
    assert.equal(sent[0][0].title, 'fixture-0');
    assert.notEqual(sent[1][0].title, sent[0][0].title);
    assert.match(queries[0], /commit;[\s\S]*select p\.id, p\.city_id, p\.title, p\.created_at/);
    assert.match(queries[0], /commit;[\s\S]*author\.nickname=wanted\.author_nickname[\s\S]*seed_user\.email like '%@seed\.gling\.invalid'/);
    assert.doesNotMatch(queries[0], /generate_series|interval '1 day'/);
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
