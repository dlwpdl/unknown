import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { translateUi } from '../src/i18n/index.ts';
import { LEGAL_DOCUMENTS } from '../src/lib/legal-documents.ts';

// Owner-confirmed copy (2026-11-11 "이대로"), already reviewed; do not reword it here.
const NOTE = '모임에서 일어난 일은 호스트와 멤버가 각자 책임져요. 문제가 생겨 신고해 주시면 글링이 기록을 확인하고 최대한 도울게요. 위급하면 911에 먼저 연락해 주세요.';
const NOTE_EN = "Hosts and members are each responsible for themselves at a meetup. If something goes wrong, report it. We'll look into it and do everything we can to help. In an emergency, call 911 first.";
const TERMS = '모임에서 생긴 일은 참여한 사용자 각자가 책임집니다. 다만 사용자가 문제를 신고하면 gling은 관련 기록을 확인하고 필요한 운영 조치를 하며, 수사기관이나 법원이 법에 따라 요청하면 이에 응하는 등 할 수 있는 범위에서 최대한 협조합니다. gling의 고의나 과실로 생긴 손해는 관련 법률에 따라 gling이 책임집니다.';

test('meetup apply and create screens show the confirmed responsibility note in Korean and English', () => {
  const join = readFileSync(new URL('../src/app/meetup-join.tsx', import.meta.url), 'utf8');
  const create = readFileSync(new URL('../src/app/meetup-create.tsx', import.meta.url), 'utf8');
  assert.equal(join.split(`{tr('${NOTE}')}`).length - 1, 2, 'both apply layouts carry the note');
  assert.equal(create.split(`{tr('${NOTE}')}`).length - 1, 1);
  assert.equal(translateUi('en', NOTE), NOTE_EN);
  assert.equal(translateUi('ko', NOTE), NOTE);
});

test('terms section 9 adds the responsibility paragraph right after the existing user-responsibility sentence', () => {
  const section = LEGAL_DOCUMENTS.terms.sections.find(value => value.title === '9. 책임과 변경');
  assert.ok(section);
  assert.match(section.paragraphs[0], /각 사용자의 판단과 책임으로 이용합니다/);
  assert.equal(section.paragraphs[1], TERMS);
});
