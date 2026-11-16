import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DELIVERY_PARTNERS, deliveryPartnerPlace } from '../src/lib/delivery-partners.ts';

const json = path => JSON.parse(readFileSync(new URL(`../src/lib/${path}`, import.meta.url), 'utf8'));

test('each visited place shows its approved one-line introduction in Korean and English', () => {
  const handson = json('gling-visited.json').find(row => row.placeId === 'osm:node:4976343547').line;
  assert.deepEqual(handson, { ko: '한국에서 태어나 캐나다에서 자란 셰프가 철마다 바뀌는 10~12코스를 내요.', en: 'A Korean-born chef serves a seasonal tasting menu of 10 to 12 courses.' });
  assert.deepEqual(deliveryPartnerPlace('vancouver', 'partner:jimoco-coquitlam').glingVisited.line, { ko: '이탈리아 파스타에 한식 느낌을 살짝 더했어요. 피자와 리소토도 있어요.', en: 'Italian pasta with a Korean touch, plus pizza and risotto.' });
  assert.deepEqual(deliveryPartnerPlace('vancouver', 'partner:on-and-off-coquitlam').glingVisited.line, { ko: '낮엔 햇빛 잘 드는 브런치집이고, 밤엔 조명을 낮추고 재즈를 틀어요.', en: "By day it's a bright brunch spot. At night the lights go down and the jazz comes on." });
  assert.ok(DELIVERY_PARTNERS.filter(partner => partner.visited).every(partner => partner.visitedLine));
});

test('Handson is listed under its current name', () => {
  const place = json('city-places.catalog.json').cities.vancouver.places.find(item => item.id === 'osm:node:4976343547');
  assert.equal(place.name, 'By Handson');
});
