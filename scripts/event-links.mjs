#!/usr/bin/env node
// The supervisor's tool for event links; there is no admin screen for them yet.
//   node scripts/event-links.mjs settings --campaign <uuid> --file <settings.json> [--dry-run]
//     {"visit_dates":["2026-11-23"],"time_slots":["18:00"],"party_max":2,"reel_days_max":7,"late_gets_benefit":false,
//      "support":[{"key":"meal","covered":true,"note_en":"","note_ko":""}]}   (reel_days_max, late_gets_benefit, support optional)
//   node scripts/event-links.mjs create --campaign <uuid> --kind apply|store --expires YYYY-MM-DD [--slug <slug>] [--dry-run]
//   node scripts/event-links.mjs revoke --id <uuid> [--dry-run]
// A store link's token is printed once and never stored: the database keeps only its SHA-256.
// Dates (--expires, visit dates, deadlines) are days in the business's time zone. Until Supabase's tzdata has B.C.'s permanent
// UTC-7, the database counts 00:00-01:00 Vancouver time as the day before (supervisor 2026-11-02: leave it, report real problems).
// The service-role key comes from GLING_SUPABASE_SERVICE_ROLE_KEY, else the operator's Supabase CLI login, the same way
// as scripts/release.py. It is never printed. --dry-run checks the input and touches nothing.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const SITE = 'https://gling.ej-entertainment.com';
const PROJECT = 'wjvahbdwmctzpkndqaxa';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{2,59}$/;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const SUPPORT = ['meal', 'drinks', 'alcohol', 'parking', 'fee'];
// Database refusals the operator can act on, in the operator's language.
const REFUSALS = {
  BUSINESS_LOGO_REQUIRED: '가게 로고가 없어요. 로고를 먼저 올린 뒤 다시 만드세요. (비즈니스 프로필 사진이 공개돼 있어야 로고로 보여요)',
  APPLY_SETTINGS_REQUIRED: '방문 날짜·시간 설정이 없어요. settings로 앞으로 올 방문 날짜와 시간을 먼저 넣은 뒤 다시 만드세요.',
  23505: '이미 쓰고 있는 주소예요. 다른 --slug로 다시 만드세요.',
  23503: '캠페인을 찾지 못했어요. --campaign 값을 확인해 주세요.',
  23514: '설정 값이 범위를 벗어났어요. 날짜·시간·인원(1~10)·릴스 기한(1~7일)·지원 항목을 확인해 주세요.',
  23502: '방문 날짜와 시간은 하나 이상 있어야 해요.',
};

const realDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
const fail = message => { throw new Error(message); };

export function parse(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    campaign: { type: 'string' }, kind: { type: 'string' }, expires: { type: 'string' }, slug: { type: 'string' },
    id: { type: 'string' }, file: { type: 'string' }, 'dry-run': { type: 'boolean', default: false },
  } });
  const [command, ...extra] = positionals;
  const dryRun = values['dry-run'];
  if (extra.length) fail(`알 수 없는 인자: ${extra.join(' ')}`);
  if (command === 'revoke') {
    if (!UUID.test(values.id ?? '')) fail('--id에 링크 id(uuid)를 넣어 주세요.');
    return { command, id: values.id, dryRun };
  }
  if (!UUID.test(values.campaign ?? '')) fail('--campaign에 캠페인 id(uuid)를 넣어 주세요.');
  if (command === 'settings') {
    if (!values.file) fail('--file에 설정 JSON 파일을 넣어 주세요.');
    return { command, campaign: values.campaign, settings: settings(JSON.parse(readFileSync(values.file, 'utf8'))), dryRun };
  }
  if (command !== 'create') fail('명령은 settings, create, revoke 중 하나예요.');
  if (values.kind !== 'apply' && values.kind !== 'store') fail('--kind는 apply 또는 store예요.');
  if (!realDay(values.expires)) fail('--expires는 YYYY-MM-DD 날짜예요.');
  if (values.slug !== undefined && (values.kind !== 'apply' || !SLUG.test(values.slug))) fail('--slug는 apply 링크에만, 영어 소문자·숫자·- 3~60자로 써요.');
  return { command, campaign: values.campaign, kind: values.kind, expires: values.expires, slug: values.slug, dryRun };
}

/** Same limits as the table checks, so a typo is caught before anything is sent. */
export function settings(input) {
  const { visit_dates, time_slots, party_max, reel_days_max = 7, support = [], late_gets_benefit = false, ...rest } = input ?? {};
  if (Object.keys(rest).length) fail(`모르는 설정: ${Object.keys(rest).join(', ')}`);
  if (!Array.isArray(visit_dates) || !visit_dates.length || !visit_dates.every(realDay)) fail('visit_dates는 YYYY-MM-DD 날짜 목록이에요(하나 이상).');
  if (!Array.isArray(time_slots) || !time_slots.length || !time_slots.every(value => TIME.test(value))) fail('time_slots는 HH:MM 시간 목록이에요(하나 이상).');
  if (!Number.isInteger(party_max) || party_max < 1 || party_max > 10) fail('party_max는 1~10이에요.');
  if (!Number.isInteger(reel_days_max) || reel_days_max < 1 || reel_days_max > 7) fail('reel_days_max는 1~7일이에요.');
  if (typeof late_gets_benefit !== 'boolean') fail('late_gets_benefit은 true 또는 false예요(마감 뒤 신청에도 혜택).');
  const keys = Array.isArray(support) ? support.map(item => item?.key) : null;
  if (!keys || new Set(keys).size !== keys.length || !support.every(item => SUPPORT.includes(item?.key) && typeof item.covered === 'boolean'))
    fail(`support는 [{key, covered}] 목록이에요. key는 ${SUPPORT.join(', ')} 중 하나씩.`);
  return { visit_dates, time_slots, party_max, reel_days_max, support, late_gets_benefit };
}

/** A new link. An apply slug is public (it goes in DMs); a store token is a 32-byte secret, kept only as its SHA-256. */
export function newLink(kind, slug) {
  if (kind === 'apply') {
    const value = slug ?? `e-${randomBytes(6).toString('hex')}`;
    return { slug: value, token: null, hash: null, url: `${SITE}/apply?event=${value}` };
  }
  const token = randomBytes(32).toString('base64url');
  return { slug: null, token, hash: createHash('sha256').update(token).digest('hex'), url: `${SITE}/partner#${token}` };
}

async function serviceKey(env) {
  if (env.GLING_SUPABASE_SERVICE_ROLE_KEY) return env.GLING_SUPABASE_SERVICE_ROLE_KEY;
  const login = execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/api-keys`, { headers: { Authorization: `Bearer ${login}` } });
  const key = response.ok ? (await response.json()).find(item => item.name === 'service_role')?.api_key : null;
  return key || fail('서비스 키를 찾지 못했어요. GLING_SUPABASE_SERVICE_ROLE_KEY를 넣거나 Supabase CLI에 로그인해 주세요.');
}

// Only the project itself, or a local test server, ever receives the key.
function baseUrl(env) {
  const url = env.GLING_SUPABASE_URL ?? `https://${PROJECT}.supabase.co`;
  return /^(https:\/\/[a-z0-9]+\.supabase\.co|http:\/\/127\.0\.0\.1:\d+)$/.test(url) ? url : fail('GLING_SUPABASE_URL은 Supabase 프로젝트 주소여야 해요.');
}

async function rpc(env, key, name, args) {
  const response = await fetch(`${baseUrl(env)}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  });
  const body = await response.json().catch(() => null);
  if (response.ok) return body;
  fail(REFUSALS[body?.message] ?? REFUSALS[body?.code] ?? `요청이 거절됐어요 (${response.status}${body?.code ? ` ${body.code}` : ''}).`);
}

export async function main(argv, env = process.env, out = console.log) {
  const task = parse(argv);
  if (task.command === 'settings') {
    if (task.dryRun) return out(JSON.stringify({ dryRun: true, campaign: task.campaign, settings: task.settings }));
    const { visit_dates, time_slots, party_max, reel_days_max, support, late_gets_benefit } = task.settings;
    await rpc(env, await serviceKey(env), 'set_event_apply_settings', { p_campaign_id: task.campaign, p_visit_dates: visit_dates,
      p_time_slots: time_slots, p_party_max: party_max, p_reel_days_max: reel_days_max, p_support: support,
      p_late_gets_benefit: late_gets_benefit });
    return out('신청 설정을 저장했어요.');
  }
  if (task.command === 'revoke') {
    if (task.dryRun) return out(JSON.stringify({ dryRun: true, revoke: task.id }));
    return out(await rpc(env, await serviceKey(env), 'revoke_event_link', { p_id: task.id }) ? '링크를 껐어요. 지금부터 열리지 않아요.' : '이미 꺼졌거나 없는 링크예요.');
  }
  const link = newLink(task.kind, task.slug);
  if (task.dryRun) return out(JSON.stringify({ dryRun: true, campaign: task.campaign, kind: task.kind, expires: task.expires,
    url: link.token ? `${SITE}/partner#<실제로 만들 때 한 번만 보여요>` : link.url }));
  const id = await rpc(env, await serviceKey(env), 'create_event_link',
    { p_campaign_id: task.campaign, p_kind: task.kind, p_slug: link.slug, p_token_sha256: link.hash, p_expires_on: task.expires });
  out(`링크를 만들었어요 (id ${id}, ${task.expires}까지)\n${link.url}`);
  if (link.token) out('가게 공유 주소는 지금 한 번만 보여요. 저장된 건 해시뿐이라 다시 볼 수 없어요. 잃어버리면 revoke 후 새로 만드세요.');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
