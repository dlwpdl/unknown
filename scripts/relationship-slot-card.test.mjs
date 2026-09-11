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
    assert.equal(group.limit, limit);
    assert.equal(group.locked, 1);
    assert.equal(group.available, limit - 2);
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
});

test('downgrade preserves real usage above quota without inventing capacity or extra slots', () => {
  const data = relationshipSlotData({ ...snapshot(), meetupsUsed: 5, meetupSlotsAvailable: 0 }, 'meetup');
  assert.equal(data.active, 5);
  assert.equal(data.locked, 1);
  assert.equal(data.overLimit, true);
  assert.equal(data.available, 0);
});

test('one continuous bar represents capacity, caps overuse, and preserves accessible known/unknown status', () => {
  const known = flatten(RelationshipSlotCard({ kind: 'meetup', membership: snapshot() }));
  const status = known.find(node => node.props?.accessibilityRole === 'image');
  assert.match(status.props.accessibilityLabel, /남은 자리 1개, 사용 중 1개, 24시간 잠금 1개/);
  const widths = membership => flatten(RelationshipSlotCard({ kind: 'meetup', membership }))
    .filter(node => typeof node.props?.style?.width === 'string').map(node => parseFloat(node.props.style.width));
  for (const limit of [3, 5, 10]) {
    const [active, locked] = widths(snapshot(limit));
    assert.ok(Math.abs(active - 100 / limit) < 0.00001);
    assert.ok(Math.abs(locked - 100 / limit) < 0.00001);
    assert.ok(Math.abs(100 - active - locked - (limit - 2) / limit * 100) < 0.00001);
  }
  assert.deepEqual(widths({ ...snapshot(), meetupsUsed: 5, meetupSlotsAvailable: 0 }), [100, 0]);
  assert.deepEqual(widths({ ...snapshot(), meetupsUsed: 2, meetupSlotsLocked: 3, meetupSlotsAvailable: 0 }), [2 / 3 * 100, 1 / 3 * 100]);
  const unknown = flatten(RelationshipSlotCard({ kind: 'meetup', membership: null, loading: true }));
  assert.match(unknown.find(node => node.props?.accessibilityRole === 'image').props.accessibilityLabel, /확인하고 있어요/);
  assert.deepEqual(widths(null), []);
  assert.equal(unknown.find(node => node.props?.accessibilityRole === 'image').props.accessibilityState.busy, true);
});
