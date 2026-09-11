import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};
const source = ts.transpileModule(fs.readFileSync(new URL('../src/components/relationship-slot-card.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
vm.runInNewContext(source, { exports, require(name) {
  if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  if (name === 'react-native') return { View: 'View', Pressable: 'Pressable', StyleSheet: { create: value => value } };
  if (name === 'expo-symbols') return { SymbolView: 'SymbolView' };
  if (name === '@/components/themed-text') return { ThemedText: 'Text' };
  if (name === '@/constants/theme') return { Spacing: { half: 2, one: 4, two: 8, three: 16 } };
  if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
  if (name === '@/i18n/ko') return { t: { chat: { slotUnlock: value => `해제 ${value}` } } };
  throw new Error(`Unexpected import: ${name}`);
} });
const { relationshipSlotData, RelationshipSlotCard } = exports;
const snapshot = (limit = 3) => ({ tier: 'free', meetupLimit: limit, meetupsUsed: 1, meetupSlotsLocked: 1, meetupSlotsAvailable: limit - 2,
  meetupUnlocksAt: ['2026-09-12T12:00:00Z', '2026-09-11T12:00:00Z'],
  conversationLimit: limit, conversationsUsed: 0, conversationSlotsLocked: 0, conversationSlotsAvailable: limit, conversationUnlocksAt: [] });
const flatten = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(flatten) : flatten(value))];

test('3/5/10 capacity uses separate server pools and picks the nearest valid unlock', () => {
  for (const limit of [3, 5, 10]) {
    const group = relationshipSlotData(snapshot(limit), 'meetup');
    const direct = relationshipSlotData(snapshot(limit), 'conversation');
    assert.equal(group.slots.length, limit);
    assert.equal(group.slots.filter(value => value === 'locked').length, 1);
    assert.equal(group.slots.filter(value => value === 'available').length, limit - 2);
    assert.equal(group.unlockAt, '2026-09-11T12:00:00Z');
    assert.equal(direct.available, limit);
    assert.equal(direct.locked, 0);
  }
});

test('missing or inconsistent server values remain unknown; zero remaining is a real state', () => {
  for (const membership of [null, {}, { ...snapshot(), meetupSlotsLocked: undefined }, { ...snapshot(), meetupSlotsAvailable: 3 }, { ...snapshot(), meetupSlotsAvailable: -1 }]) {
    assert.equal(relationshipSlotData(membership, 'meetup'), null);
  }
  const full = relationshipSlotData({ ...snapshot(), meetupsUsed: 2, meetupSlotsAvailable: 0 }, 'meetup');
  assert.equal(full.available, 0);
  assert.equal(full.slots.includes('available'), false);
});

test('downgrade preserves real usage above quota without inventing capacity or extra slots', () => {
  const data = relationshipSlotData({ ...snapshot(), meetupsUsed: 5, meetupSlotsAvailable: 0 }, 'meetup');
  assert.equal(data.active, 5);
  assert.equal(data.locked, 1);
  assert.equal(data.overLimit, true);
  assert.equal(data.slots.length, 3);
});

test('render exposes an aggregate accessible status and distinct slot symbols; unknown does not render free slots', () => {
  const known = flatten(RelationshipSlotCard({ kind: 'meetup', membership: snapshot() }));
  const status = known.find(node => node.props?.accessibilityRole === 'image');
  assert.match(status.props.accessibilityLabel, /남은 자리 1개, 사용 중 1개, 24시간 잠금 1개/);
  for (const icon of ['checkmark', 'lock.fill', 'plus']) assert.equal(known.filter(node => node.type === 'SymbolView' && node.props.name.ios === icon).length, 1);
  const unknown = flatten(RelationshipSlotCard({ kind: 'meetup', membership: null, loading: true }));
  assert.match(unknown.find(node => node.props?.accessibilityRole === 'image').props.accessibilityLabel, /확인하고 있어요/);
  assert.equal(unknown.some(node => node.type === 'SymbolView' && node.props.name.ios === 'plus'), false);
});
