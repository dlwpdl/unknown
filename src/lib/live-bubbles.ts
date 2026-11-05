import type { SupabaseClient } from '@supabase/supabase-js';
import { tr } from '../i18n/index.ts';
import * as demo from './live-bubbles-demo.ts';
import { isFreshLocation, type LocationFix } from './location.ts';

// 동네 말풍선 지도 (owner 2026-11-05, docs/ideas/live-map-2026-11-05.md): one short line left where I am, for a while; tapping someone's opens a chat request
// or a lighter 👋 wave (owner 9cb7200d), which only the bubble's owner sees and can answer with a chat request.
// No live location: the app sends the place the member chose to show (within 100 m of where they are) and, for the server's checks only, where they are.
export const LIVE = { bodyMax: 40, moveMeters: 100, dailyRequests: 5, dailyWaves: 20, durations: [30, 60, 180], warnMinutes: 10, farMeters: 1000, extendMinutes: 60, maxMinutes: 180 } as const;
export const QUICK_PHRASES = ['커피 한잔 할 사람', '같이 걸어요', '맛집 추천해 주세요', '동네 친구 구해요'] as const;
// What a request carries is one of these, by index, so a stranger can't send free text before the owner says yes.
export const GREETINGS = ['저도 근처예요', '좋아요, 같이 해요', '잠깐 얘기 나눠요'] as const;

export type Point = { latitude: number; longitude: number };
export type LiveAudience = 'city' | 'friends';
export type LiveKind = 'member' | 'pin';
export type LiveRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';
export type LivePerson = { id: string; nickname: string; trustLevel: 1 | 2 | 3 };
export type LiveSent = { id: string; status: LiveRequestStatus; greeting: number; conversationId: string | null };
export type LiveBubble = Point & { id: string; author: LivePerson; body: string; audience: LiveAudience; kind: LiveKind; createdAt: string; expiresAt: string; sent: LiveSent | null; waved: boolean; demo?: boolean };
/** A request someone sent me: to my bubble, or (waveReply) the owner of a bubble I waved at answering me, about their bubble `bubbleBody`. */
export type LiveRequest = { id: string; bubbleId: string; bubbleBody: string; sender: LivePerson; greeting: number; waveReply: boolean; status: LiveRequestStatus; createdAt: string; conversationId: string | null; demo?: boolean };
/** Someone who waved at my bubble, and the chat request I sent back, if any. */
export type LiveWave = { id: string; sender: LivePerson; createdAt: string; reply: LiveSent | null; demo?: boolean };
export type LiveMap = { bubbles: LiveBubble[]; mine: LiveBubble | null; received: LiveRequest[]; waves: LiveWave[]; requestsLeft: number; requestLimit: number; wavesLeft: number };

const RAD = Math.PI / 180;
/** Great-circle distance in meters. */
export function distanceMeters(a: Point, b: Point) {
  const dLat = (b.latitude - a.latitude) * RAD, dLng = (b.longitude - a.longitude) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * RAD) * Math.cos(b.latitude * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** The point, pulled back toward origin until it is inside the circle (1% margin so the server's own check never disagrees). */
export function clampWithin(origin: Point, point: Point, meters: number = LIVE.moveMeters): Point {
  const distance = distanceMeters(origin, point);
  if (distance <= meters * 0.99) return point;
  const ratio = meters * 0.99 / distance;
  return { latitude: origin.latitude + (point.latitude - origin.latitude) * ratio, longitude: origin.longitude + (point.longitude - origin.longitude) * ratio };
}
/** Where a new bubble first sits: the ~100 m grid cell around me, never my exact spot, and always inside the 100 m circle. */
export function approximatePoint(fix: Point): Point {
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return clampWithin(fix, { latitude: round(fix.latitude), longitude: round(fix.longitude) });
}
/**
 * Where I am, for posting: an honest, fresh fix within 250 m, or MOCKED / INACCURATE / UNAVAILABLE.
 * Only the development example (live state `demo`: a dev build whose server lacks the functions, never a release build)
 * takes the simulator's made-up fix, or the city centre when there is none, so the whole flow can be tried there.
 */
export function postingPlace(fix: LocationFix | null, demoMode: boolean, fallback: Point, now = Date.now()): Point {
  const usable = !!fix && Number.isFinite(fix.latitude) && Math.abs(fix.latitude) <= 90 && Number.isFinite(fix.longitude) && Math.abs(fix.longitude) <= 180;
  if (demoMode) return usable ? { latitude: fix.latitude, longitude: fix.longitude } : fallback;
  if (!fix || !usable) throw new Error('UNAVAILABLE');
  // A location-faking app reports itself through `mocked`; the server also refuses impossible jumps.
  if (fix.mocked) throw new Error('MOCKED');
  if (!isFreshLocation(fix, now) || fix.accuracy! > 250) throw new Error('INACCURATE');
  return { latitude: fix.latitude, longitude: fix.longitude };
}
export function minutesLeft(expiresAt: string, now: number) {
  const end = Date.parse(expiresAt);
  return Number.isFinite(end) ? Math.max(0, Math.ceil((end - now) / 60000)) : 0;
}
export function durationLabel(minutes: number) {
  if (minutes < 60) return tr('{0}분', Math.max(1, minutes));
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return rest ? tr('{0}시간 {1}분', hours, rest) : tr('{0}시간', hours);
}
/** True when the server simply has no live-map functions yet (not deployed), as opposed to a real failure. */
export function isMissingServer(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  return ['PGRST202', 'PGRST205', '42P01', '42883'].includes(code);
}
/** Made-up example bubbles only in a development build, only while the server functions are missing. */
export const demoAllowed = (error: unknown, dev: boolean) => dev && isMissingServer(error);
export const liveErrorCode = (error: unknown) => {
  const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
  return (['LOCATION_UNAVAILABLE', 'REQUEST_LIMIT', 'WAVE_LIMIT', 'ALREADY_WAVED', 'BUBBLE_GONE', 'BLOCKED', 'RATE_LIMITED', 'CONTENT_NOT_ALLOWED', 'PERSONA_NOT_ALLOWED'] as const).find(code => message.includes(code)) ?? null;
};

const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max ? value : null;
const person = (value: unknown): LivePerson | null => {
  const raw = value as Record<string, unknown> | null;
  const id = text(raw?.id, 64), nickname = text(raw?.nickname, 80);
  return id && nickname ? { id, nickname, trustLevel: raw?.trustLevel === 3 ? 3 : raw?.trustLevel === 2 ? 2 : 1 } : null;
};
const status = (value: unknown): LiveRequestStatus => value === 'accepted' || value === 'declined' || value === 'cancelled' ? value : 'pending';
const sentOf = (value: unknown): LiveSent | null => {
  const raw = value as Record<string, unknown> | null | undefined, id = text(raw?.id, 64);
  return id ? { id, status: status(raw?.status), greeting: Number(raw?.greeting) || 0, conversationId: text(raw?.conversationId, 64) } : null;
};
const bubble = (value: unknown): LiveBubble | null => {
  const raw = value as Record<string, unknown> | null, author = person(raw?.author), id = text(raw?.id, 64), body = text(raw?.body, LIVE.bodyMax);
  const latitude = Number(raw?.latitude), longitude = Number(raw?.longitude);
  if (!author || !id || body === null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !text(raw?.expiresAt, 64)) return null;
  return { id, author, body, latitude, longitude, audience: raw?.audience === 'friends' ? 'friends' : 'city', kind: raw?.kind === 'pin' ? 'pin' : 'member',
    createdAt: text(raw?.createdAt, 64) ?? '', expiresAt: raw?.expiresAt as string,
    sent: sentOf(raw?.sent), waved: raw?.waved === true };
};
/** The server's get_live_map JSON, keeping only well-formed entries. */
export function parseLiveMap(data: unknown): LiveMap {
  const raw = (data ?? {}) as Record<string, unknown>, list = (value: unknown) => Array.isArray(value) ? value : [];
  const received = list(raw.received).flatMap(value => {
    const item = value as Record<string, unknown>, sender = person(item?.sender), id = text(item?.id, 64), bubbleId = text(item?.bubbleId, 64);
    return sender && id && bubbleId ? [{ id, bubbleId, bubbleBody: text(item.bubbleBody, LIVE.bodyMax) ?? '', sender, greeting: Number(item.greeting) || 0, waveReply: item.waveReply === true,
      status: status(item.status), createdAt: text(item.createdAt, 64) ?? '', conversationId: text(item.conversationId, 64) }] : [];
  });
  const waves = list(raw.waves).flatMap(value => {
    const item = value as Record<string, unknown>, sender = person(item?.sender), id = text(item?.id, 64);
    return sender && id ? [{ id, sender, createdAt: text(item.createdAt, 64) ?? '', reply: sentOf(item.reply) }] : [];
  });
  const count = (value: unknown, fallback: number) => Number.isFinite(Number(value)) && value !== null && value !== undefined ? Math.max(0, Number(value)) : fallback;
  return { bubbles: list(raw.bubbles).flatMap(value => bubble(value) ?? []), mine: bubble(raw.mine), received, waves,
    requestLimit: count(raw.requestLimit, LIVE.dailyRequests), requestsLeft: count(raw.requestsLeft, 0), wavesLeft: count(raw.wavesLeft, 0) };
}

// One shared state for the map screen and the bar on top of every screen.
export type LiveState = { key: string; status: 'idle' | 'loading' | 'ready' | 'off' | 'error'; demo: boolean; map: LiveMap | null; notice: { id: number; text: string; requestId?: string } | null };
let state: LiveState = { key: '', status: 'idle', demo: false, map: null, notice: null };
let context: { client: SupabaseClient; userId: string; cityId: string; center: Point } | null = null;
const listeners = new Set<() => void>();
export const subscribeLive = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getLive = () => state;
const set = (next: Partial<LiveState>) => { state = { ...state, ...next }; for (const listener of listeners) listener(); };
/** A short confirmation shown over any screen; with a request id, tapping it opens that request. */
export const liveNotice = (value: string, requestId?: string) => set({ notice: { id: Date.now(), text: value, ...(requestId ? { requestId } : {}) } });
const dev = () => typeof __DEV__ !== 'undefined' && __DEV__;

export async function loadLiveMap(client: SupabaseClient, userId: string, cityId: string, center: Point) {
  const key = `${userId}:${cityId}`;
  context = { client, userId, cityId, center };
  if (state.key !== key) set({ key, status: 'loading', demo: false, map: state.key.startsWith(`${userId}:`) ? state.map : null });
  if (state.demo) { set({ status: 'ready', map: demo.load(key, userId, center, Date.now(), refreshLive) }); return; }
  const result = await client.rpc('get_live_map', { p_city_id: cityId });
  if (state.key !== key) return;
  if (result.error) {
    if (demoAllowed(result.error, dev())) set({ demo: true, status: 'ready', map: demo.load(key, userId, center, Date.now(), refreshLive) });
    else set({ status: isMissingServer(result.error) ? 'off' : 'error' });
    return;
  }
  set({ status: 'ready', map: parseLiveMap(result.data) });
}
export function refreshLive() {
  if (!context) return Promise.resolve();
  const { client, userId, cityId, center } = context;
  return loadLiveMap(client, userId, cityId, center);
}
/** Signing out or switching accounts: nothing from the last person stays on screen. */
export function resetLive() { context = null; set({ key: '', status: 'idle', demo: false, map: null, notice: null }); }

async function act<T>(server: (client: SupabaseClient) => PromiseLike<{ data: unknown; error: unknown }>, local: (key: string) => T) {
  if (!context) throw new Error('LIVE_NOT_READY');
  if (state.demo) { const value = local(state.key); await refreshLive(); return value; }
  const result = await server(context.client);
  if (result.error) throw result.error;
  await refreshLive();
  return result.data as T;
}
export type LivePost = { cityId: string; body: string; audience: LiveAudience; minutes: number; point: Point; origin: Point | null; kind: LiveKind };
export const postLiveBubble = (input: LivePost) => act(client => client.rpc('post_live_bubble', {
  p_city_id: input.cityId, p_body: input.body.trim(), p_audience: input.audience, p_minutes: input.minutes, p_latitude: input.point.latitude, p_longitude: input.point.longitude,
  p_origin_latitude: input.origin?.latitude ?? null, p_origin_longitude: input.origin?.longitude ?? null, p_kind: input.kind,
}), key => demo.post(key, input, Date.now()));
export const endLiveBubble = () => act(client => client.rpc('end_live_bubble'), key => demo.end(key));
export const extendLiveBubble = () => act(client => client.rpc('extend_live_bubble'), key => demo.extend(key, Date.now()));
export const sendLiveRequest = (bubbleId: string, greeting: number) => act(client => client.rpc('send_live_bubble_request', { p_bubble_id: bubbleId, p_greeting: greeting }), key => demo.send(key, bubbleId, greeting, Date.now()));
export const cancelLiveRequest = (requestId: string) => act(client => client.rpc('cancel_live_bubble_request', { p_request_id: requestId }), key => demo.cancel(key, requestId));
/** Accepting returns the 1:1 chat both people now share (null in the development example, which never opens a real chat). */
export const respondLiveRequest = (requestId: string, response: 'accepted' | 'declined') =>
  act<string | null>(client => client.rpc('respond_live_bubble_request', { p_request_id: requestId, p_response: response }), key => demo.respond(key, requestId, response));
/** 👋 once per bubble, 20 a day, counted apart from chat requests. Only the bubble's owner ever sees who waved. */
export const waveLiveBubble = (bubbleId: string) => act(client => client.rpc('wave_live_bubble', { p_bubble_id: bubbleId }), key => demo.wave(key, bubbleId, Date.now()));
/** The owner answers a wave with a chat request (one of the five a day); the other person sees "내 손 흔들기에 답했어요". */
export const replyToWave = (waveId: string) => act(client => client.rpc('reply_live_bubble_wave', { p_wave_id: waveId }), key => demo.replyToWave(key, waveId));
/** Development only: made-up neighbours wave at my bubble and send it a request, to see the receiving side. */
export const demoReceive = () => { if (state.demo && context) { demo.receive(state.key, Date.now()); void refreshLive(); } };
