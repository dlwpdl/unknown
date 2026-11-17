import assert from 'node:assert/strict';
import test from 'node:test';
import { kakaoIds, splitKakaoIds } from '../src/lib/kakao-id.ts';

test('운영 본문의 카톡 표기에서 아이디만 뽑는다', () => {
  assert.deepEqual(kakaoIds('· 문의: 김사장, 카톡 gling_cafe1'), ['gling_cafe1']);
  assert.deepEqual(kakaoIds('문의: 이름 647 330 0000, 카톡 gling.shop_99\n'), ['gling.shop_99']);
  assert.deepEqual(kakaoIds('카톡 아이디는 glingcafe이에요.'), ['glingcafe']);
  assert.deepEqual(kakaoIds('카톡 glingcafe 작업 중에는 전화를 못 받아요'), ['glingcafe']);
  assert.deepEqual(kakaoIds('카카오톡 ID: Gling.Cafe.'), ['Gling.Cafe']);
  assert.deepEqual(kakaoIds('KakaoTalk id: glingcafe, katalk glingcafe'), ['glingcafe']);
  assert.deepEqual(kakaoIds('kakao: glingcafe / Kakao ID glingshop'), ['glingcafe', 'glingshop']);
});
test('카카오 단어나 링크, 짧은 말은 아이디로 잡지 않는다', () => {
  for (const text of ['카카오 조각이 초콜릿 되는 과정', '카톡 문의 주세요', '카톡이 안 되면 전화 주세요', 'https://open.kakao.com/o/gAbCdEf1', 'pf.kakao.com/_xAbCdEf', '카톡 ab', '카톡 647 330 0000', 'Kakao Bank 계좌로 보내 주세요', 'kakao channel 소식', '카톡 abcdefghijklmnopqrstuvwxyz'])
    assert.deepEqual(kakaoIds(text), [], text);
});
test('나눈 조각을 이으면 본문이 그대로다', () => {
  const text = '문의: 김, 카톡 아이디는 glingcafe이에요. 감사합니다';
  const parts = splitKakaoIds(text);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.deepEqual(parts.filter(part => part.kakaoId).map(part => part.text), ['glingcafe']);
});
