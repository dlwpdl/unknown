import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const { MEMBERSHIP_LIMITS } = await import('../src/lib/membership.ts');
// 실제 등급 한도를 그대로 쓴다. 표와 다른 값이 오면 카드는 '확인 필요'가 맞다.
const limits = [MEMBERSHIP_LIMITS.free.meetups, MEMBERSHIP_LIMITS.plus.meetups, MEMBERSHIP_LIMITS.pro.meetups, MEMBERSHIP_LIMITS.premium.meetups];

const exports = {};
const source = ts.transpileModule(fs.readFileSync(new URL('../src/components/relationship-slot-card.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
vm.runInNewContext(source, { exports, require(name) {
    if (name === '@/lib/behavior-analytics') return { behavior() {}, flushBehavior: async () => {} };
  if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  if ((name === 'react-native' || name === '@/components/analytics-controls')) return { View: 'View', Pressable: 'Pressable', StyleSheet: { create: value => value } };
  if (name === 'expo-symbols') return { SymbolView: 'SymbolView' };
  if (name === '@/components/themed-text') return { ThemedText: 'Text' };
  if (name === '@/constants/theme') return { Spacing: { half: 2, one: 4, two: 8, three: 16 }, Depth: { card: {}, control: {} } };
  if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
  if (name === '@/i18n/ko') return { t: { chat: { slotUnlock: value => `해제 ${value}` } } };
  if (name === '@/lib/membership') return { MEMBERSHIP_LIMITS };
  throw new Error(`Unexpected import: ${name}`);
} });
const { relationshipSlotData, RelationshipSlotCard } = exports;
const snapshot = (limit = MEMBERSHIP_LIMITS.free.meetups) => ({ tier: 'free', meetupLimit: limit, meetupsUsed: 1, meetupSlotsLocked: 1, meetupSlotsAvailable: limit - 2,
  meetupUnlocksAt: ['2026-09-12T12:00:00Z', '2026-09-11T12:00:00Z'],
  conversationLimit: null, conversationsUsed: 0, conversationSlotsLocked: 0, conversationSlotsAvailable: null, conversationUnlocksAt: [] });
const flatten = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(flatten) : flatten(value))];

test('only meetup capacity is metered; direct chat has no numeric slot card', () => {
  for (const limit of limits) {
    const group = relationshipSlotData(snapshot(limit), 'meetup');
    const direct = relationshipSlotData(snapshot(limit), 'conversation');
    assert.equal(group.limit, limit);
    assert.equal(group.locked, 1);
    assert.equal(group.available, limit - 2);
    assert.equal(group.unlockAt, '2026-09-11T12:00:00Z');
    assert.equal(direct, null);
  }
});

test('missing or inconsistent server values remain unknown; zero remaining is a real state', () => {
  for (const membership of [null, {}, { ...snapshot(), meetupSlotsLocked: undefined }, { ...snapshot(), meetupSlotsAvailable: 3 }, { ...snapshot(), meetupSlotsAvailable: -1 }]) {
    assert.equal(relationshipSlotData(membership, 'meetup'), null);
  }
  // 등급 한도표에 없는 값은 숫자를 지어내지 않는다.
  assert.equal(relationshipSlotData({ ...snapshot(), meetupLimit: 6 }, 'meetup'), null);
  const full = relationshipSlotData({ ...snapshot(), meetupsUsed: MEMBERSHIP_LIMITS.free.meetups - 1, meetupSlotsAvailable: 0 }, 'meetup');
  assert.equal(full.available, 0);
});

test('downgrade preserves real usage above quota without inventing capacity or extra slots', () => {
  const data = relationshipSlotData({ ...snapshot(), meetupsUsed: 5, meetupSlotsAvailable: 0 }, 'meetup');
  assert.equal(data.active, 5);
  assert.equal(data.locked, 1);
  assert.equal(data.overLimit, true);
  assert.equal(data.available, 0);
});

test('one continuous bar represents capacity, caps overuse, and preserves accessible known/unknown status', () => {
  const known = flatten(RelationshipSlotCard({ kind: 'meetup', membership: snapshot(MEMBERSHIP_LIMITS.plus.meetups) }));
  const status = known.find(node => node.props?.accessibilityRole === 'image');
  assert.match(status.props.accessibilityLabel, /전체 5개 중 남은 자리 3개, 사용 중 1개, 24시간 잠금 1개/);
  const widths = membership => flatten(RelationshipSlotCard({ kind: 'meetup', membership }))
    .filter(node => typeof node.props?.style?.width === 'string').map(node => parseFloat(node.props.style.width));
  for (const limit of limits) {
    const [active, locked] = widths(snapshot(limit));
    assert.ok(Math.abs(active - 100 / limit) < 0.00001);
    assert.ok(Math.abs(locked - 100 / limit) < 0.00001);
    assert.ok(Math.abs(100 - active - locked - (limit - 2) / limit * 100) < 0.00001);
  }
  assert.deepEqual(widths({ ...snapshot(), meetupsUsed: 5, meetupSlotsAvailable: 0 }), [100, 0]);
  const premium = MEMBERSHIP_LIMITS.premium.meetups;
  assert.deepEqual(widths({ ...snapshot(premium), meetupsUsed: 2, meetupSlotsLocked: 3, meetupSlotsAvailable: premium - 5 }), [2 / premium * 100, 3 / premium * 100]);
  const unknown = flatten(RelationshipSlotCard({ kind: 'meetup', membership: null, loading: true }));
  assert.match(unknown.find(node => node.props?.accessibilityRole === 'image').props.accessibilityLabel, /확인하고 있어요/);
  assert.deepEqual(widths(null), []);
  assert.equal(unknown.find(node => node.props?.accessibilityRole === 'image').props.accessibilityState.busy, true);
});

test('released group slots no longer advertise a 24-hour slot lock', () => {
  const membership = { ...snapshot(), meetupSlotsLocked: 0, meetupSlotsAvailable: 2, meetupUnlocksAt: [] };
  const nodes = flatten(RelationshipSlotCard({ kind: 'meetup', membership }));
  assert.doesNotMatch(nodes.find(node => node.props?.accessibilityRole === 'image').props.accessibilityLabel, /24시간/);
  assert.ok(!nodes.some(node => node.props?.children === '24h 잠금'));
});
