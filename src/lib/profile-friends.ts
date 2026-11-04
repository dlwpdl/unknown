import type { SupabaseClient } from '@supabase/supabase-js';
import { tr } from '../i18n/index.ts';

// Friends need the other person's acceptance. '프로필 저장' (saved people) stays a separate private bookmark.
export type FriendshipState = 'none' | 'outgoing' | 'incoming' | 'friends';
export type FriendAction = 'request' | 'accept' | 'decline' | 'cancel' | 'remove';
export type SavedPlacePin = { cityId: string; placeKey: string; merchantId: string | null };
export type ProfileOverview = {
  userId: string; own: boolean; savedCount: number; savedWeekStreak: number; meetupCount: number; friendCount: number;
  friendship: FriendshipState | null; canRequestFriend: boolean;
  // null: not visible to this viewer (mapHiddenReason says why). The owner and sharing friends get an array.
  savedPlaces: SavedPlacePin[] | null; mapHiddenReason: 'not_friends' | 'not_shared' | null; sharesSavedPlaces: boolean | null;
  // Own profile only: requests waiting for this member's answer.
  friendRequestCount: number | null;
};
export type FriendPerson = { id: string; nickname: string; cityId: string | null; neighborhood: string | null; since: string };
export type MyFriends = { incoming: FriendPerson[]; outgoing: FriendPerson[]; friends: FriendPerson[] };
export type FriendshipResult = { friendship: FriendshipState; canRequestFriend: boolean; friendCount: number };
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
  if (!object(value) || typeof value.own !== 'boolean' || typeof value.canRequestFriend !== 'boolean') invalid();
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
    meetupCount: count(value.meetupCount), friendCount: count(value.friendCount), friendship, canRequestFriend: value.canRequestFriend,
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
  if (!object(data) || !STATES.includes(data.friendship as FriendshipState) || typeof data.canRequestFriend !== 'boolean') invalid();
  return { friendship: data.friendship as FriendshipState, canRequestFriend: data.canRequestFriend, friendCount: count(data.friendCount) };
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

export function friendErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('FRIEND_REQUEST_LIMIT')) return tr('답을 기다리는 요청이 100개예요. 몇 개를 취소한 뒤 다시 보내 주세요.');
  if (message.includes('FRIEND_REQUEST_NOT_FOUND')) return tr('요청이 이미 취소됐거나 처리됐어요.');
  if (message.includes('FRIEND_UNAVAILABLE')) return tr('지금은 이 사람을 친구로 추가할 수 없어요.');
  return tr('친구 요청을 처리하지 못했어요. 잠시 후 다시 해 주세요.');
}
