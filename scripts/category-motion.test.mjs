import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { ALIVE, ALIVE_MS, aliveMotion, aliveSteps } from '../src/lib/category-motion.ts';
import { PLACE_SUBCATEGORIES } from '../src/lib/discovery.ts';

const MAP_ICONS = ['top25', 'delivery', 'dining', 'cafe', 'festival', 'nightlife', 'places', 'housing', 'used', 'events'];
// Still pictures without a gesture: the row settings the owner picked, the live map's speech bubble (2026-11-05) and every sub-category (all drawn by 2026-11-05).
// Chips added 2026-11-10 have no picture yet and borrow their category's.
const OWN_SUBCATEGORY_ICONS = PLACE_SUBCATEGORIES.map(option => option.id);
const STILL_ICONS = ['scope', 'all', 'open', 'visited', 'bubble', ...OWN_SUBCATEGORY_ICONS];

test('every map icon has the mockup gesture and origin, and the artwork ships with the app', () => {
  assert.deepEqual(Object.keys(ALIVE).sort(), [...MAP_ICONS].sort());
  assert.deepEqual(ALIVE.cafe, ['hop', 0.5, 1], 'cafe hops from its base');
  assert.deepEqual(ALIVE.delivery, ['scoot', 0.5, 0.8], 'delivery scoots forward');
  assert.deepEqual(ALIVE.used, ['swing', 0.2, 0.2], 'the price tag dangles from its corner');
  const icon = readFileSync(new URL('../src/components/category-icon.tsx', import.meta.url), 'utf8');
  const drawn = [...icon.matchAll(/(\w+): require\('@\/assets\/images\/map-categories\/(\w+)\.png'\)/g)].map(match => match[1] === match[2] && match[1]);
  assert.deepEqual(drawn.slice(0, MAP_ICONS.length), MAP_ICONS, 'the ten moving icons first');
  assert.deepEqual(drawn.slice(MAP_ICONS.length).sort(), [...STILL_ICONS].sort(), 'then the still ones, in any order');
  for (const id of [...MAP_ICONS, ...STILL_ICONS]) {
    assert.ok(existsSync(new URL(`../assets/images/map-categories/${id}.png`, import.meta.url)), id);
    assert.ok(icon.includes(`require('@/assets/images/map-categories/${id}.png')`), id);
  }
});

test('a sub-category without its own picture yet shows its map category picture', () => {
  const icon = readFileSync(new URL('../src/components/category-icon.tsx', import.meta.url), 'utf8');
  const drawn = new Set([...icon.matchAll(/(\w+): require\(/g)].map(match => match[1]));
  for (const option of PLACE_SUBCATEGORIES) {
    const own = OWN_SUBCATEGORY_ICONS.includes(option.id);
    assert.equal(drawn.has(option.id), own, option.id);
    if (!own) assert.ok(MAP_ICONS.includes(option.filter) && drawn.has(option.filter), option.id);
  }
});

test('each gesture runs once in 0.64s and ends where it started', () => {
  for (const id of MAP_ICONS) {
    const { tracks } = aliveMotion(id, 24, false);
    assert.ok(Object.keys(tracks).length, id);
    for (const [key, track] of Object.entries(tracks)) {
      assert.equal(track[0][0], 0); assert.equal(track.at(-1)[0], 1);
      const steps = aliveSteps(track);
      assert.ok(Math.abs(steps.reduce((sum, [, ms]) => sum + ms, 0) - ALIVE_MS) < 1e-6, `${id} ${key}`);
      assert.ok(steps.every(([, ms]) => ms > 0), `${id} ${key} keyframes move forward`);
      const start = track[0][1], end = steps.at(-1)[0];
      assert.equal(key === 'rotate' ? end % 360 : end, start, `${id} ${key} returns to rest`);
    }
  }
  assert.deepEqual(aliveSteps(aliveMotion('nightlife', 24, false).tracks.rotate).map(([to, ms]) => [to, Math.round(ms * 10) / 10]), [[-22, 179.2], [12, 192], [-4, 166.4], [0, 102.4]]);
});

test('the origin becomes points from the center, and reduced motion or an unknown category plays nothing', () => {
  const cafe = aliveMotion('cafe', 24, false);
  assert.deepEqual([cafe.originX, cafe.originY], [0, 12]);
  const festival = aliveMotion('festival', 24, false);
  assert.ok(Math.abs(festival.originX + 4.8) < 1e-9 && Math.abs(festival.originY - 7.2) < 1e-9);
  for (const id of MAP_ICONS) assert.equal(aliveMotion(id, 24, true), null, id);
  assert.equal(aliveMotion('all', 24, false), null);
  assert.equal(aliveMotion('visited', 24, false), null);
  assert.equal(aliveMotion('toString', 24, false), null, 'object keys are not categories');
});
