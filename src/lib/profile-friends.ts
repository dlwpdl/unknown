import type { SupabaseClient } from '@supabase/supabase-js';
import { tr } from '../i18n/index.ts';

// Friends need the other person's acceptance. '프로필 저장' (saved people) stays a separate private bookmark.
export type FriendshipState = 'none' | 'outgoing' | 'incoming' | 'friends';
export type FriendAction = 'request' | 'accept' | 'decline' | 'cancel' | 'remove';
export type SavedPlacePin = { cityId: string; placeKey: string; merchantId: string | null };
export type ProfileOverview = {
  userId: string; own: boolean; savedCount: number; savedWeekStreak: number; meetupCount: number; friendCount: number;
  // No field says whether a request would be refused: the button always shows and the server answers FRIEND_UNAVAILABLE.
  friendship: FriendshipState | null;
  // null: not visible to this viewer (mapHiddenReason says why). The owner and sharing friends get an array.
  savedPlaces: SavedPlacePin[] | null; mapHiddenReason: 'not_friends' | 'not_shared' | null; sharesSavedPlaces: boolean | null;
  // Own profile only: requests waiting for this member's answer.
  friendRequestCount: number | null;
};
export type FriendPerson = { id: string; nickname: string; cityId: string | null; neighborhood: string | null; since: string };
export type MyFriends = { incoming: FriendPerson[]; outgoing: FriendPerson[]; friends: FriendPerson[] };
export type FriendshipResult = { friendship: FriendshipState; friendCount: number };
export type MerchantSaves = {
  saverCount: number;
  friends: { id: string; nickname: string; savedAt: string }[];
  similar: { merchantId: string; name: string; saverCount: number; weekCount: number }[];
};

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const CITY = /^[a-z][a-z0-9-]{0,63}$/;
const PLACE = /^(?:osm:(?:node|way|relation):[1-9][0-9]{0,19}|partner:[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const STATES: FriendshipState[] = ['none', 'outgoing', 'incoming', 'friends'];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : invalid();
const uuid = (value: unknown) => typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : invalid();
const name = (value: unknown) => typeof value === 'string' && value.length <= 200 ? value : invalid();
const time = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : invalid();
const list = (value: unknown, max: number) => Array.isArray(value) && value.length <= max ? value : invalid();
function invalid(): never { throw new Error('INVALID_PROFILE_RESPONSE'); }

export function parseProfileOverview(value: unknown): ProfileOverview | null {
  if (value === null) return null;
  if (!object(value) || typeof value.own !== 'boolean') invalid();
  const friendship = value.friendship === null ? null : STATES.includes(value.friendship as FriendshipState) ? value.friendship as FriendshipState : invalid();
  const savedPlaces = value.savedPlaces === null ? null : list(value.savedPlaces, 300).map(pin => {
    if (!object(pin) || typeof pin.cityId !== 'string' || !CITY.test(pin.cityId) || typeof pin.placeKey !== 'string' || !PLACE.test(pin.placeKey)) invalid();
    return { cityId: pin.cityId, placeKey: pin.placeKey, merchantId: pin.merchantId === null ? null : uuid(pin.merchantId) };
  });
  const reason = value.mapHiddenReason;
  if (reason !== null && reason !== 'not_friends' && reason !== 'not_shared') invalid();
  if (value.sharesSavedPlaces !== null && typeof value.sharesSavedPlaces !== 'boolean') invalid();
  const requests = value.friendRequestCount === null || value.friendRequestCount === undefined ? null : count(value.friendRequestCount);
  return { userId: uuid(value.userId), own: value.own, savedCount: count(value.savedCount), savedWeekStreak: count(value.savedWeekStreak),
    meetupCount: count(value.meetupCount), friendCount: count(value.friendCount), friendship,
    savedPlaces, mapHiddenReason: reason, sharesSavedPlaces: value.sharesSavedPlaces, friendRequestCount: requests };
}

// City chips: most saved city first, then by id so the order never jumps between reads.
export function savedPlaceCities(pins: SavedPlacePin[]): { cityId: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const pin of pins) counts.set(pin.cityId, (counts.get(pin.cityId) ?? 0) + 1);
  return [...counts].map(([cityId, total]) => ({ cityId, count: total })).sort((a, b) => b.count - a.count || a.cityId.localeCompare(b.cityId));
}

export async function loadProfileOverview(client: SupabaseClient, userId: string): Promise<ProfileOverview | null> {
  const { data, error } = await client.rpc('get_profile_overview', { p_user_id: userId });
  if (error) throw error;
  return parseProfileOverview(data);
}

export async function setFriendship(client: SupabaseClient, userId: string, action: FriendAction): Promise<FriendshipResult> {
  const { data, error } = await client.rpc('set_friendship', { p_user_id: userId, p_action: action });
  if (error) throw new Error(error.message);
  if (!object(data) || !STATES.includes(data.friendship as FriendshipState)) invalid();
  return { friendship: data.friendship as FriendshipState, friendCount: count(data.friendCount) };
}

function people(value: unknown): FriendPerson[] {
  return list(value, 600).map(person => {
    if (!object(person)) invalid();
    return { id: uuid(person.id), nickname: name(person.nickname), cityId: person.cityId === null ? null : name(person.cityId),
      neighborhood: person.neighborhood === null ? null : name(person.neighborhood), since: time(person.since) };
  });
}

export async function loadMyFriends(client: SupabaseClient): Promise<MyFriends> {
  const { data, error } = await client.rpc('get_my_friends');
  if (error) throw error;
  if (!object(data)) invalid();
  return { incoming: people(data.incoming), outgoing: people(data.outgoing), friends: people(data.friends) };
}

export async function setProfileSharing(client: SupabaseClient, savedPlacesToFriends: boolean): Promise<boolean> {
  const { data, error } = await client.rpc('set_profile_sharing', { p_saved_places_to_friends: savedPlacesToFriends });
  if (error) throw error;
  if (!object(data) || data.savedPlacesToFriends !== savedPlacesToFriends) invalid();
  return savedPlacesToFriends;
}

export function parseMerchantSaves(value: unknown): MerchantSaves | null {
  if (value === null) return null;
  if (!object(value)) invalid();
  return {
    saverCount: count(value.saverCount),
    friends: list(value.friends, 20).map(friend => object(friend) ? { id: uuid(friend.id), nickname: name(friend.nickname), savedAt: time(friend.savedAt) } : invalid()),
    similar: list(value.similar, 3).map(place => object(place)
      ? { merchantId: uuid(place.merchantId), name: name(place.name), saverCount: count(place.saverCount), weekCount: count(place.weekCount) } : invalid()),
  };
}

export async function loadMerchantSaves(client: SupabaseClient, merchantId: string): Promise<MerchantSaves | null> {
  const { data, error } = await client.rpc('get_merchant_saves', { p_merchant_id: merchantId });
  if (error?.code === 'PGRST202') return null;
  if (error) throw error;
  return parseMerchantSaves(data);
}

// 지도 '보여 줄 곳': places in one city saved by friends who share them (get_friend_saved_places). friendCount is every
// friend, so the map can tell '친구 0명' from '보여 준 친구 0명'.
export type FriendSaver = { id: string; nickname: string; avatarPath: string | null; avatarUrl?: string };
export type FriendSavedPlace = { placeKey: string; friendCount: number; friends: FriendSaver[] };
export type FriendSavedPlaces = { friendCount: number; places: FriendSavedPlace[] };
export function parseFriendSavedPlaces(value: unknown): FriendSavedPlaces {
  if (!object(value)) invalid();
  const places = list(value.places, 300).map(place => {
    if (!object(place) || typeof place.placeKey !== 'string' || !PLACE.test(place.placeKey)) invalid();
    const friends = list(place.friends, 3).map(friend => {
      if (!object(friend)) invalid();
      const id = uuid(friend.id);
      // Avatars live under '<user id>/'; anything else is not that person's photo.
      if (friend.avatarPath !== null && (typeof friend.avatarPath !== 'string' || !friend.avatarPath.startsWith(`${id}/`) || friend.avatarPath.length > 300)) invalid();
      return { id, nickname: name(friend.nickname), avatarPath: friend.avatarPath };
    });
    const total = count(place.friendCount);
    if (!friends.length || total < friends.length) invalid();
    return { placeKey: place.placeKey, friendCount: total, friends };
  });
  return { friendCount: count(value.friendCount), places };
}
export async function loadFriendSavedPlaces(client: SupabaseClient, cityId: string): Promise<FriendSavedPlaces> {
  if (!CITY.test(cityId)) invalid();
  const { data, error } = await client.rpc('get_friend_saved_places', { p_city_id: cityId });
  if (error) throw error;
  const result = parseFriendSavedPlaces(data);
  const paths = [...new Set(result.places.flatMap(place => place.friends.flatMap(friend => friend.avatarPath ? [friend.avatarPath] : [])))].slice(0, 100);
  if (!paths.length) return result;
  // A photo that fails to sign falls back to the initial; the places still show.
  const urls = new Map<string, string>();
  try {
    const signed = await client.storage.from('avatars').createSignedUrls(paths, 3600);
    for (const item of signed.data ?? []) if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  } catch { /* initials only */ }
  return { ...result, places: result.places.map(place => ({ ...place, friends: place.friends.map(friend => {
    const avatarUrl = friend.avatarPath ? urls.get(friend.avatarPath) : undefined;
    return avatarUrl ? { ...friend, avatarUrl } : friend;
  }) })) };
}

// The map's place keys for one scope. 내가 저장한 곳 reuses the owner's own profile pins (catalog places and consented
// businesses only), so it never needs a new server read.
export type MapScope = 'all' | 'mine' | 'friends';
export type MapScopePlaces = { places: Map<string, FriendSavedPlace | null>; friendCount: number | null };
export async function loadMapScope(client: SupabaseClient, scope: Exclude<MapScope, 'all'>, cityId: string, userId: string): Promise<MapScopePlaces> {
  if (scope === 'friends') {
    const result = await loadFriendSavedPlaces(client, cityId);
    return { places: new Map(result.places.map(place => [place.placeKey, place])), friendCount: result.friendCount };
  }
  const overview = await loadProfileOverview(client, userId);
  return { places: new Map((overview?.savedPlaces ?? []).filter(pin => pin.cityId === cityId).map(pin => [pin.placeKey, null])), friendCount: null };
}

export function friendErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('FRIEND_REQUEST_LIMIT')) return tr('답을 기다리는 요청이 100개예요. 몇 개를 취소한 뒤 다시 보내 주세요.');
  if (message.includes('FRIEND_REQUEST_NOT_FOUND')) return tr('요청이 이미 취소됐거나 처리됐어요.');
  // Operated characters, blocked and reported pairs all get the same sentence (owner 2026-11-04).
  if (message.includes('FRIEND_UNAVAILABLE')) return tr('지금은 친구를 맺을 수 없어요.');
  return tr('친구 요청을 처리하지 못했어요. 잠시 후 다시 해 주세요.');
}
