import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { parseInteractionPreferences } from '../src/lib/interaction-feedback-preferences.ts';

test('피드백 설정은 안전한 기본값을 쓰고 저장된 불리언만 복원한다', () => {
  assert.deepEqual(parseInteractionPreferences(null), { soundEnabled: true, hapticsEnabled: true });
  assert.deepEqual(parseInteractionPreferences('broken'), { soundEnabled: true, hapticsEnabled: true });
  assert.deepEqual(
    parseInteractionPreferences('{"soundEnabled":false,"hapticsEnabled":true}'),
    { soundEnabled: false, hapticsEnabled: true },
  );
});

test('피드백 프로바이더는 로그인 패널을 그리는 AuthProvider보다 바깥에 있다', () => {
  const app = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
  const feedback = app.indexOf('<InteractionFeedbackProvider>');
  const auth = app.indexOf('<AuthProvider>');
  assert.ok(feedback > -1 && auth > -1, '두 프로바이더가 모두 있어야 한다');
  assert.ok(feedback < auth, 'AuthProvider가 띄우는 로그인 패널도 피드백을 써야 한다');
  const admin = readFileSync(new URL('../src/admin/_layout.tsx', import.meta.url), 'utf8');
  assert.ok(admin.includes('<InteractionFeedbackProvider>'), '관리자 콘솔도 피드백 프로바이더를 포함한다');
});

test('모임 생성 완료는 참여 신청과 다른, 화면 이동 위의 축하 모션을 쓴다', () => {
  const created = readFileSync(new URL('../src/app/meetup-create.tsx', import.meta.url), 'utf8');
  const joined = readFileSync(new URL('../src/app/meetup-join.tsx', import.meta.url), 'utf8');
  const feedback = readFileSync(new URL('../src/lib/interaction-feedback.tsx', import.meta.url), 'utf8');
  assert.match(created, /createChillingEvent[\s\S]*play\('meetupCreated'\)/);
  assert.match(joined, /play\('meetupRequested'\)/);
  assert.doesNotMatch(joined, /play\('meetup'\)/, '보낸 직후에는 호스트 처리 표시를 쓰지 않는다');
  assert.match(feedback, /commit === 'meetupRequested' \? tr\('신청을 보냈어요'\)/);
  for (const file of ['../src/app/(tabs)/chat.tsx', '../src/app/meetup-application.tsx']) assert.match(readFileSync(new URL(file, import.meta.url), 'utf8'), /play\(response === 'approved' \? 'meetup'/, file);
  assert.match(feedback, /<Modal visible=\{celebrating !== null\}/);
});

test('owner-picked sounds: one bundled file each, played quieter with the tap quietest, silent switch kept and other music mixed', () => {
  const feedback = readFileSync(new URL('../src/lib/interaction-feedback.tsx', import.meta.url), 'utf8');
  const files = [...feedback.matchAll(/require\('@\/assets\/sounds\/([^']+)'\)/g)].map(match => match[1]);
  assert.equal(new Set(files).size, 12);
  for (const file of files) assert.ok(existsSync(new URL(`../assets/sounds/${file}`, import.meta.url)), file);
  const volumes = Object.fromEntries([...feedback.match(/const VOLUME[^}]+}/)[0].matchAll(/(\w+): ([\d.]+)/g)].map(match => [match[1], Number(match[2])]));
  assert.equal(Object.keys(volumes).length, 15, 'every feedback kind has a volume');
  assert.ok(Object.values(volumes).every(volume => volume > 0 && volume < 1), 'the louder kit only ever plays quieter');
  assert.ok(Object.entries(volumes).every(([kind, volume]) => kind === 'selection' || volume > volumes.selection), 'the frequent tap is the quietest');
  assert.match(feedback, /setAudioModeAsync\(\{ playsInSilentMode: false, interruptionMode: 'mixWithOthers' \}\)/);
});
