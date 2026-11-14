import assert from 'node:assert/strict';
import test from 'node:test';
import { adoptStatic, revealStatic } from '../src/components/public-web/static-slot.ts';

// A tiny DOM: nodes know their parent; removal and appendChild keep `isConnected` honest.
function page(ids) {
  const nodes = new Map();
  const body = { id: 'body', children: [], isConnected: true };
  const attach = (node, parent) => {
    if (node.parentNode) node.parentNode.children = node.parentNode.children.filter(child => child !== node);
    node.parentNode = parent; parent.children.push(node); node.isConnected = parent.isConnected;
  };
  const make = id => {
    const node = { id, children: [], parentNode: null, isConnected: false,
      appendChild: child => attach(child, node),
      remove: () => { node.parentNode.children = node.parentNode.children.filter(child => child !== node); node.parentNode = null; node.isConnected = false; nodes.delete(id); } };
    nodes.set(id, node);
    return node;
  };
  for (const id of ids) attach(make(id), body);
  globalThis.document = { getElementById: id => nodes.get(id) ?? null };
  return { body, slot: () => { const node = make(`slot-${nodes.size}`); attach(node, body); return node; }, has: id => nodes.has(id) };
}

test('without the wait marker the copy moves into its slot right away', () => {
  const dom = page(['gling-static-city']);
  const slot = dom.slot();
  adoptStatic('gling-static-city')(slot);
  assert.equal(slot.children[0].id, 'gling-static-city');
});

test('home/city pages keep the copy in place until the feed is in, then swap in one step', () => {
  const dom = page(['gling-static-wait', 'gling-static-city', 'gling-static-home']);
  const slot = dom.slot();
  adoptStatic('gling-static-city')(slot);
  assert.equal(slot.children.length, 0, 'nothing moves while the reader is hidden');
  assert.equal(dom.body.children[1].id, 'gling-static-city');
  revealStatic(['gling-static-home']);
  assert.equal(slot.children[0].id, 'gling-static-city');
  assert.ok(!dom.has('gling-static-home') && !dom.has('gling-static-wait'), 'crawler copy and the hide rule go together');
});

test('a failed feed shows the reader but keeps the home copy above it', () => {
  const dom = page(['gling-static-wait', 'gling-static-home']);
  revealStatic([]);
  assert.ok(dom.has('gling-static-home') && !dom.has('gling-static-wait'));
});

test('a slot that left the page before the reveal is skipped', () => {
  const dom = page(['gling-static-wait', 'gling-static-city']);
  const slot = dom.slot();
  adoptStatic('gling-static-city')(slot);
  slot.remove();
  revealStatic(['gling-static-home']);
  assert.equal(dom.body.children[0].id, 'gling-static-city', 'the copy stays where it was');
});

test('a feed that never answers still shows the reader after the fallback wait', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dom = page(['gling-static-wait', 'gling-static-city', 'gling-static-home']);
  const slot = dom.slot();
  adoptStatic('gling-static-city')(slot);
  t.mock.timers.tick(7999);
  assert.ok(dom.has('gling-static-wait'), 'still waiting just before the fallback');
  t.mock.timers.tick(1);
  assert.equal(slot.children[0].id, 'gling-static-city');
  assert.ok(dom.has('gling-static-home') && !dom.has('gling-static-wait'), 'reader shows under the copy, like a failed feed');
  revealStatic(['gling-static-home']);
  assert.ok(!dom.has('gling-static-home'), 'a late feed still drops the crawler copy');
});

test('a feed that answers in time cancels the fallback', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dom = page(['gling-static-wait', 'gling-static-city', 'gling-static-home']);
  adoptStatic('gling-static-city')(dom.slot());
  revealStatic(['gling-static-home']);
  const fresh = page(['gling-static-wait', 'gling-static-home']);
  t.mock.timers.tick(10000);
  assert.ok(fresh.has('gling-static-wait'), 'no stray reveal fires later');
});
