import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { parseChatMapEvent, chatMapHtml } from '../src/lib/chat-location.ts';

test('the map bridge accepts only bounded coordinates and short place labels', () => {
  assert.deepEqual(parseChatMapEvent(JSON.stringify({ type: 'selection', latitude: 49.28, longitude: -123.12, label: ' Library ' })),
    { type: 'selection', latitude: 49.28, longitude: -123.12, label: 'Library' });
  for (const value of ['bad', 'null', '{}', JSON.stringify({ type: 'selection', latitude: 91, longitude: 0, label: 'bad' }),
    JSON.stringify({ type: 'selection', latitude: '49', longitude: 0, label: 'bad' }),
    JSON.stringify({ type: 'selection', latitude: 49, longitude: -181, label: 'bad' }),
    JSON.stringify({ type: 'selection', latitude: 49, longitude: 0, label: 'x'.repeat(241) })]) assert.equal(parseChatMapEvent(value), null);
});

test('map clicks and a chosen Places result return a point; a search alone never sends', async () => {
  const html = chatMapHtml('key</script><script>bad()', { latitude: 49.28, longitude: -123.12 });
  assert.equal((html.match(/<script>/g) ?? []).length, 1, 'configuration cannot terminate the inline script');
  const sent = [], listeners = {}, results = { children: [], replaceChildren() { this.children = []; }, appendChild(node) { this.children.push(node); } };
  const map = { addListener: (name, fn) => { listeners[name] = fn; }, panTo() {}, setZoom() {} };
  const document = { getElementById: id => id === 'results' ? results : {}, createElement: tag => tag === 'script' ? {} : { textContent: '', onclick: null }, head: { appendChild() {} } };
  const context = { document, window: { ReactNativeWebView: { postMessage: value => sent.push(JSON.parse(value)) } },
    google: { maps: { importLibrary: async name => name === 'maps' ? { Map: function () { return map; } } : { Place: { searchByText: async () => ({ places: [{ displayName: 'Library', formattedAddress: 'Downtown', location: { toJSON: () => ({ lat: 49.28, lng: -123.12 }) } }] }) } },
      Circle: function () { return { setCenter() {}, setMap() {} }; } } }, setTimeout, clearTimeout };
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  await context.window.initGlingMap();
  assert.ok(sent.some(event => event.type === 'ready'));
  assert.ok(!sent.some(event => event.type === 'selection'));
  listeners.click({ latLng: { toJSON: () => ({ lat: 49.2, lng: -123.1 }) } });
  assert.equal(sent.at(-1).type, 'selection'); assert.equal(sent.at(-1).latitude, 49.2);
  sent.length = 0; await context.window.glingMapCommand({ type: 'search', query: 'library' });
  assert.ok(!sent.some(event => event.type === 'selection'));
  results.children[0].onclick(); assert.equal(sent.at(-1).label, 'Library · Downtown');
  assert.equal(sent.at(-1).longitude, -123.12);
});
