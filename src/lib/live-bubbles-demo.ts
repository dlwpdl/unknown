import { LIVE, type LiveBubble, type LiveMap, type LivePost, type LiveRequest, type LiveWave, type Point } from './live-bubbles.ts';

// Development builds only, and only while the server has no live-map functions (live-bubbles.ts demoAllowed): made-up neighbours
// so the whole flow, including the receiving side, can be tried on a simulator. Everything stays in memory; nothing is sent anywhere.
// Every name below is invented, and screens label these bubbles '개발용 예시'.
type World = { userId: string; center: Point; bubbles: LiveBubble[]; mine: LiveBubble | null; received: LiveRequest[]; waves: LiveWave[]; day: string; used: number; waved: number; sent: number; changed: () => void };
const worlds = new Map<string, World>();
const PEOPLE = [
  { id: 'demo-person-1', nickname: '하늘콩', trustLevel: 3, body: '커피 한잔 할 사람', east: 260, north: -180, age: 12, left: 48 },
  { id: 'demo-person-2', nickname: '동네고양이', trustLevel: 2, body: '저녁 산책 같이 해요', east: -420, north: 300, age: 25, left: 95 },
  { id: 'demo-person-3', nickname: '라떼한잔', trustLevel: 1, body: '보드게임 한 판 하실 분', east: 600, north: 520, age: 4, left: 26 },
  { id: 'demo-person-4', nickname: '주말등산러', trustLevel: 2, body: '맛집 추천해 주세요', east: -150, north: -650, age: 40, left: 140 },
] as const;
const shift = (center: Point, east: number, north: number): Point => ({
  latitude: center.latitude + north / 111320, longitude: center.longitude + east / (111320 * Math.cos(center.latitude * Math.PI / 180)) });
const iso = (ms: number) => new Date(ms).toISOString();
const day = (now: number) => new Date(now).toDateString();
let sequence = 0;
const nextId = (kind: string) => `demo-${kind}-${++sequence}`;
const world = (key: string) => { const value = worlds.get(key); if (!value) throw new Error('LIVE_NOT_READY'); return value; };
const later = (key: string, ms: number, run: (value: World) => void) => setTimeout(() => { const value = worlds.get(key); if (value) { run(value); value.changed(); } }, ms);

export function load(key: string, userId: string, center: Point, now: number, changed: () => void): LiveMap {
  let value = worlds.get(key);
  if (!value) {
    value = { userId, center, mine: null, received: [], waves: [], day: day(now), used: 0, waved: 0, sent: 0, changed, bubbles: PEOPLE.map(person => ({
      id: `demo-bubble-${person.id}`, author: { id: person.id, nickname: person.nickname, trustLevel: person.trustLevel }, body: person.body, ...shift(center, person.east, person.north),
      audience: 'city', kind: 'member', createdAt: iso(now - person.age * 60000), expiresAt: iso(now + person.left * 60000), sent: null, waved: false, demo: true })) };
    worlds.set(key, value);
  }
  value.changed = changed; value.center = center;
  if (value.day !== day(now)) { value.day = day(now); value.used = 0; value.waved = 0; }
  if (value.mine && Date.parse(value.mine.expiresAt) <= now) clearMine(value);
  // Like the server: a request about a bubble that went down goes with it.
  const up = new Set([...value.bubbles.filter(bubble => Date.parse(bubble.expiresAt) > now).map(bubble => bubble.id), ...(value.mine ? [value.mine.id] : [])]);
  return { bubbles: value.bubbles.filter(bubble => up.has(bubble.id)), mine: value.mine, received: value.received.filter(request => up.has(request.bubbleId)), waves: value.waves,
    requestsLeft: LIVE.dailyRequests - value.used, requestLimit: LIVE.dailyRequests, wavesLeft: LIVE.dailyWaves - value.waved };
}

export function post(key: string, input: LivePost, now: number, sample = true) {
  const value = world(key), replacing = !!value.mine;
  value.mine = { id: nextId('mine'), author: { id: value.userId, nickname: '나', trustLevel: 1 }, body: input.body.trim(), latitude: input.point.latitude, longitude: input.point.longitude,
    audience: input.audience, kind: input.kind, createdAt: iso(now), expiresAt: iso(now + input.minutes * 60000), sent: null, waved: false, demo: true };
  // A replaced bubble takes its requests and waves with it, as on the server.
  value.received = value.received.filter(request => request.waveReply); value.waves = [];
  if (!replacing && sample) later(key, 6000, current => { if (current.mine && !current.waves.length) receive(key, Date.now()); });
}
const clearMine = (value: World) => { value.mine = null; value.waves = []; value.received = value.received.filter(request => request.waveReply); };
export function end(key: string) { clearMine(world(key)); }
export function extend(key: string, now: number) {
  const value = world(key);
  if (value.mine) value.mine = { ...value.mine, expiresAt: iso(Math.min(Date.parse(value.mine.expiresAt) + LIVE.extendMinutes * 60000, now + LIVE.maxMinutes * 60000)) };
}
export function send(key: string, bubbleId: string, greeting: number, now: number) {
  const value = world(key), target = value.bubbles.find(bubble => bubble.id === bubbleId && Date.parse(bubble.expiresAt) > now);
  if (!target) throw new Error('BUBBLE_GONE');
  if (value.used >= LIVE.dailyRequests) throw new Error('REQUEST_LIMIT');
  value.used++; value.sent++;
  const id = nextId('request'), accepts = value.sent % 2 === 1;
  value.bubbles = value.bubbles.map(bubble => bubble.id === bubbleId ? { ...bubble, sent: { id, status: 'pending', greeting, conversationId: null } } : bubble);
  // The made-up neighbour answers a few seconds later: the first request is accepted, the next declined, and so on.
  later(key, 3500, current => {
    current.bubbles = current.bubbles.map(bubble => bubble.sent?.id === id && bubble.sent.status === 'pending' ? { ...bubble, sent: { ...bubble.sent, status: accepts ? 'accepted' : 'declined' } } : bubble);
  });
  return { id };
}
/** Cancelling removes the request (so it can be sent again) but keeps the used count. */
export function cancel(key: string, requestId: string) {
  const value = world(key);
  value.bubbles = value.bubbles.map(bubble => bubble.sent?.id === requestId ? { ...bubble, sent: null } : bubble);
}
export function respond(key: string, requestId: string, response: 'accepted' | 'declined') {
  const value = world(key);
  value.received = value.received.map(request => request.id === requestId ? { ...request, status: response } : request);
  return null;
}
export function wave(key: string, bubbleId: string, now: number) {
  const value = world(key), target = value.bubbles.find(bubble => bubble.id === bubbleId && Date.parse(bubble.expiresAt) > now);
  if (!target) throw new Error('BUBBLE_GONE');
  if (target.waved) throw new Error('ALREADY_WAVED');
  if (value.waved >= LIVE.dailyWaves) throw new Error('WAVE_LIMIT');
  value.waved++;
  value.bubbles = value.bubbles.map(bubble => bubble.id === bubbleId ? { ...bubble, waved: true } : bubble);
  // The first wave of the session gets answered with a chat request, to show what the person who waved receives.
  if (value.waved === 1) later(key, 5000, current => {
    const owner = current.bubbles.find(bubble => bubble.id === bubbleId);
    if (owner) current.received = [{ id: nextId('reply'), bubbleId, bubbleBody: owner.body, sender: owner.author, greeting: 0, waveReply: true, status: 'pending', createdAt: iso(Date.now()), conversationId: null, demo: true }, ...current.received];
  });
}
export function replyToWave(key: string, waveId: string) {
  const value = world(key), target = value.waves.find(item => item.id === waveId);
  if (!target || !value.mine) throw new Error('BUBBLE_GONE');
  if (value.used >= LIVE.dailyRequests) throw new Error('REQUEST_LIMIT');
  value.used++;
  const id = nextId('request');
  value.waves = value.waves.map(item => item.id === waveId ? { ...item, reply: { id, status: 'pending', greeting: 0, conversationId: null } } : item);
  later(key, 3500, current => { current.waves = current.waves.map(item => item.reply?.id === id ? { ...item, reply: { ...item.reply, status: 'accepted' } } : item); });
}
/**
 * A made-up neighbour waves at my bubble now and another sends it a chat request a few seconds later (each person once while it waits).
 * With no bubble of mine up yet, a sample one goes up first so the receiving side can be seen before posting.
 */
export function receive(key: string, now: number) {
  const value = world(key);
  if (!value.mine) post(key, { cityId: '', body: '커피 한잔 할 사람', audience: 'city', minutes: 60, point: value.center, origin: value.center, kind: 'member' }, now, false);
  const waved = new Set(value.waves.map(item => item.sender.id));
  const waver = [PEOPLE[1], PEOPLE[3], PEOPLE[0], PEOPLE[2]].find(person => !waved.has(person.id));
  if (waver) value.waves = [{ id: nextId('wave'), sender: { id: waver.id, nickname: waver.nickname, trustLevel: waver.trustLevel }, createdAt: iso(now), reply: null, demo: true }, ...value.waves];
  later(key, 3000, current => {
    const asked = new Set(current.received.filter(request => request.status === 'pending' && !request.waveReply).map(request => request.sender.id));
    const person = [PEOPLE[2], PEOPLE[0], PEOPLE[1], PEOPLE[3]].find(candidate => !asked.has(candidate.id));
    if (person && current.mine) current.received = [{ id: nextId('incoming'), bubbleId: current.mine.id, bubbleBody: current.mine.body, sender: { id: person.id, nickname: person.nickname, trustLevel: person.trustLevel },
      greeting: current.received.length % 3, waveReply: false, status: 'pending', createdAt: iso(Date.now()), conversationId: null, demo: true }, ...current.received];
  });
}
