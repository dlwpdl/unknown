import assert from 'node:assert/strict';
import test from 'node:test';

import { rentAverage } from '../src/lib/rent-average.ts';

const room = (patch) => ({ deal: 'rent_offer', rooms: '1b', area: 'kitsilano', ...patch });

test('렌트 내놓음 가격 아래 동네 평균과 30% 넘게 싼 글 경고', () => {
  const cheap = rentAverage('vancouver', room({}), 1250, 'ko');
  assert.equal(cheap.line, '킷실라노 1베드 평균 $1,915 · CMHC 2025년 10월');
  assert.equal(cheap.cheap, '킷실라노 1베드 평균은 $1,915인데 이 집은 $1,250이에요. 주변 시세보다 이렇게 싼 집은 BC 경찰이 사기 신호로 꼽아요.');
  assert.equal(rentAverage('vancouver', room({}), 1341, 'ko').cheap, null, '30% 이하로 싼 건 평균만 보여 준다');
  assert.equal(rentAverage('vancouver', room({}), 1340, 'ko').cheap !== null, true);
  assert.equal(rentAverage('vancouver', room({}), null, 'ko').cheap, null, '가격이 없으면 경고도 없다');
  assert.equal(rentAverage('vancouver', room({ rooms: '1b_den' }), 2000, 'ko').line, '킷실라노 1베드 평균 $1,915 · CMHC 2025년 10월', '1+덴은 1베드로 센다');
  assert.equal(rentAverage('vancouver', room({ rooms: '2b2b', area: 'port-moody' }), 2000, 'ko').amount, 2175, '트라이시티는 한 구역');
  assert.equal(rentAverage('vancouver', room({}), 1250, 'en').line, 'Kitsilano 1BR average $1,915 · CMHC Oct 2025');
});

test('표에 없거나 맞지 않는 경우에는 아무것도 안 보인다', () => {
  assert.equal(rentAverage('vancouver', room({ rooms: 'room' }), 900, 'ko'), null, '방 한 칸은 CMHC 표에 없다');
  assert.equal(rentAverage('vancouver', room({ rooms: 'basement' }), 900, 'ko'), null);
  assert.equal(rentAverage('vancouver', room({ rooms: '3b', area: 'west-end' }), 3000, 'ko'), null, '신뢰도가 낮은 칸은 뺀다');
  assert.equal(rentAverage('vancouver', room({ area: 'yaletown' }), 1250, 'ko'), null, '구역 경계를 확인하지 않은 동네');
  assert.equal(rentAverage('vancouver', room({ deal: 'rent_wanted' }), 1250, 'ko'), null, '렌트 구함 글에는 붙이지 않는다');
  assert.equal(rentAverage('vancouver', room({ area: undefined }), 1250, 'ko'), null);
  assert.equal(rentAverage('toronto', room({ area: 'downtown' }), 1250, 'ko'), null, '밴쿠버만');
});
