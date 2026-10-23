import assert from 'node:assert/strict';
import test from 'node:test';

import { generateNickname, normalizeNickname } from '../src/lib/nickname.ts';

test('한글과 영문 닉네임은 각각 두 단어를 조합하고 DB 길이 제한을 지킨다', () => {
  assert.equal(generateNickname('ko', () => 0), '고요한수달');
  assert.equal(generateNickname('en', () => 0), 'CalmOtter');
  assert.equal(generateNickname('ko', () => 0).length <= 20, true);
  assert.equal(generateNickname('en', () => 0).length <= 20, true);
});

function suggestion(language, adjective, noun) {
  let draw = 0;
  return generateNickname(language, () => draw++ === 0 ? adjective : noun);
}
function choicePoints(language, position) {
  const choices = new Map();
  for (let sample = 0; sample < 2048; sample++) {
    const point = (sample + 0.5) / 2048;
    const name = suggestion(language, position === 0 ? point : 0, position === 1 ? point : 0);
    if (!choices.has(name)) choices.set(name, point);
  }
  return [...choices.values()];
}
for (const language of ['ko', 'en']) test(`${language} recommendations provide at least 50 distinct adjectives and 50 distinct name words`, () => {
  const adjectives = choicePoints(language, 0), nouns = choicePoints(language, 1);
  assert.ok(adjectives.length >= 50, `Only ${adjectives.length} distinct adjective choices`);
  assert.ok(nouns.length >= 50, `Only ${nouns.length} distinct noun choices`);
  const names = new Set();
  for (const adjective of adjectives) for (const noun of nouns) {
    const name = suggestion(language, adjective, noun);
    assert.equal(normalizeNickname(name), name);
    assert.ok([...name].length >= 2 && [...name].length <= 20, name);
    assert.match(name, language === 'ko' ? /^[가-힣]+$/u : /^[A-Za-z]+$/u);
    assert.doesNotMatch(name, /admin|moderator|support|official|gling|관리자|운영자|고객센터|글링/iu);
    names.add(name);
  }
  assert.equal(names.size, adjectives.length * nouns.length, 'Distinct word pairs must not collapse to the same suggested name');
  assert.equal(new Set([...names].map(name => name.toLowerCase())).size, names.size, 'The database uses case-insensitive nicknames');
  assert.ok(names.size >= 2500);
});
