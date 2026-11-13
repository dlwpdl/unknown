import type { SupabaseClient } from '@supabase/supabase-js';

export type SavedKind = 'post' | 'merchant' | 'place' | 'user';
export type SavedFilter = 'all' | 'places' | 'posts' | 'jobs' | 'users';
export type SavedTarget = { kind: SavedKind; id: string; cityId?: string };
export type SavedCursor = { savedAt: string; key: string };
// G1: a saved place is 가 보고 싶음 ('want') or 가 봤음 ('been'). Undefined means the server predates it, so the button stays a plain toggle.
export type SavedPlaceStatus = 'want' | 'been';
export type SavedState = { target: SavedTarget; saved: boolean; available: boolean; savedAt: string | null; folderIds: string[]; status?: SavedPlaceStatus | null };
// 'friends': friends see its places (owner 2026-11-13). Undefined is an older server, where every folder is private.
export type FolderVisibility = 'friends' | 'private';
export type SavedFolder = { id: string; name: string; visibility?: FolderVisibility; description?: string | null };
// A folder as someone else may see it: places and consented businesses only. The app names places from its catalog.
export type FolderPlace = { cityId: string; placeKey: string | null; merchantId: string | null; name: string | null; address: string | null };
export type FolderCover = { cityId: string; placeKey: string };
export type FolderCard = { id: string; name: string; visibility: FolderVisibility; description: string | null; cover: FolderCover | null; placeCount: number };
export type FolderRole = 'owner' | 'viewer';
export type PlaceFolder = FolderCard & { owner: { id: string; nickname: string } };
export type FolderDetail = FolderCard & { role: FolderRole; owner: { id: string; nickname: string }; places: FolderPlace[] };
export type SavedItem = {
  key: string; target: SavedTarget; savedAt: string; title: string; subtitle: string;
  imageUrl?: string | null; cityId?: string | null; address?: string | null;
  postType?: 'post' | 'meetup' | 'job' | 'listing'; closed?: boolean; hasWebshop?: boolean; folderIds: string[];
  /** The member's own memo. Only their own list carries it; no friend or folder reader does. */
  note?: string | null;
};
export type SavedPage = { items: SavedItem[]; hasMore: boolean; nextCursor: SavedCursor | null };

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const CITY = /^[a-z][a-z0-9-]{0,63}$/;
const PLACE = /^(?:osm:(?:node|way|relation):[1-9][0-9]{0,19}|partner:[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 1000): value is string => typeof value === 'string' && value.length <= max;
const timestamp = (value: unknown): value is string => text(value, 50) && Number.isFinite(Date.parse(value));
function invalid(): never { throw new Error('INVALID_SAVED_RESPONSE'); }
function target(value: unknown, error = 'INVALID_SAVED_TARGET'): SavedTarget {
  if (!object(value) || !['post', 'merchant', 'place', 'user'].includes(value.kind as string) || typeof value.id !== 'string'
    || (value.kind === 'place' ? !PLACE.test(value.id) || typeof value.cityId !== 'string' : !UUID.test(value.id))
    || (value.cityId !== undefined && (typeof value.cityId !== 'string' || !CITY.test(value.cityId)))) throw new Error(error);
  return { kind: value.kind as SavedKind, id: value.kind === 'place' ? value.id : value.id.toLowerCase(), ...(value.cityId !== undefined ? { cityId: value.cityId as string } : {}) };
}
function args(value: SavedTarget) {
  const checked = target(value);
  return { p_kind: checked.kind, p_id: checked.id, p_city_id: checked.cityId ?? null };
}
function folderIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(id => typeof id !== 'string' || !UUID.test(id)) || new Set(value).size !== value.length) invalid();
  return value;
}
function cursor(value: unknown, error = 'INVALID_SAVED_RESPONSE'): SavedCursor {
  if (!object(value) || !timestamp(value.savedAt) || !text(value.key, 240) || !value.key) throw new Error(error);
  return { savedAt: value.savedAt, key: value.key };
}
function state(value: unknown, requested: SavedTarget): SavedState {
  if (!object(value) || typeof value.saved !== 'boolean' || typeof value.available !== 'boolean' || (value.savedAt !== null && !timestamp(value.savedAt))) invalid();
  const resolved = target(value.target, 'INVALID_SAVED_RESPONSE');
  if (requested.kind === 'place') {
    if (!['place', 'merchant'].includes(resolved.kind) || resolved.cityId !== requested.cityId || (resolved.kind === 'place' && resolved.id !== requested.id)) invalid();
  } else if (resolved.kind !== requested.kind || resolved.id !== requested.id.toLowerCase()) invalid();
  if (value.saved !== (value.savedAt !== null)) invalid();
  const folders = folderIds(value.folderIds);
  if (!value.saved && folders.length) invalid();
  if (value.status !== undefined && (value.saved ? value.status !== 'want' && value.status !== 'been' : value.status !== null)) invalid();
  return { target: resolved, saved: value.saved, available: value.available, savedAt: value.savedAt, folderIds: folders,
    ...(value.status !== undefined ? { status: value.status as SavedPlaceStatus | null } : {}) };
}
async function call(client: SupabaseClient, name: string, values: Record<string, unknown> = {}): Promise<unknown> {
  const result = await client.rpc(name, values);
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
function folder(value: unknown): SavedFolder {
  if (!object(value) || typeof value.id !== 'string' || !UUID.test(value.id) || !text(value.name, 80) || !value.name.trim()
    || (value.visibility !== undefined && value.visibility !== 'friends' && value.visibility !== 'private')
    || (value.description != null && (!text(value.description, 150) || !value.description.trim()))) invalid();
  return { id: value.id, name: value.name, ...(value.visibility !== undefined ? { visibility: value.visibility as FolderVisibility } : {}),
    ...(value.description !== undefined ? { description: value.description as string | null } : {}) };
}
const count = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : invalid();
function folderCard(value: unknown): FolderCard {
  const base = folder(value);
  if (!base.visibility || base.description === undefined || !object(value)) invalid();
  return { id: base.id, name: base.name, visibility: base.visibility, description: base.description, cover: value.cover === null ? null : cover(value.cover), placeCount: count(value.placeCount) };
}
function cover(value: unknown, error = 'INVALID_SAVED_RESPONSE'): FolderCover {
  if (!object(value) || typeof value.cityId !== 'string' || !CITY.test(value.cityId) || typeof value.placeKey !== 'string' || !PLACE.test(value.placeKey)) throw new Error(error);
  return { cityId: value.cityId, placeKey: value.placeKey };
}
function folderPlace(value: unknown): FolderPlace {
  if (!object(value) || typeof value.cityId !== 'string' || !CITY.test(value.cityId)
    || (value.placeKey !== null && (typeof value.placeKey !== 'string' || !PLACE.test(value.placeKey)))
    || (value.merchantId !== null && (typeof value.merchantId !== 'string' || !UUID.test(value.merchantId)))
    || (value.placeKey === null && value.merchantId === null)
    || (value.name !== null && !text(value.name, 300)) || (value.address !== null && !text(value.address, 1000))) invalid();
  return { cityId: value.cityId, placeKey: value.placeKey as string | null, merchantId: value.merchantId === null ? null : (value.merchantId as string).toLowerCase(),
    name: value.name as string | null, address: value.address as string | null };
}
function folderId(id: string) { if (!UUID.test(id)) throw new Error('INVALID_SAVED_FOLDER'); return id; }
function folderName(name: string) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('INVALID_SAVED_FOLDER');
  return name.trim();
}
// One line of up to max letters; a blank one means none.
function oneLine(value: string | null, max: number, error: string) {
  const line = (value ?? '').replace(/\s+/g, ' ').trim();
  if (line.length > max || /[\u0000-\u001f\u007f]/.test(line)) throw new Error(error);
  return line || null;
}
export async function loadSavedItemState(client: SupabaseClient, value: SavedTarget): Promise<SavedState> {
  return state(await call(client, 'get_saved_item_state', args(value)), value);
}
export async function setSavedItem(client: SupabaseClient, value: SavedTarget, saved: boolean): Promise<SavedState> {
  if (typeof saved !== 'boolean') throw new Error('INVALID_SAVED_TARGET');
  const result = state(await call(client, 'set_saved_item', { ...args(value), p_saved: saved }), value);
  if (result.saved !== saved) throw new Error('SAVE_NOT_VERIFIED');
  return result;
}
function placeTarget(value: SavedTarget) { if (value.kind !== 'place' && value.kind !== 'merchant') throw new Error('INVALID_SAVED_TARGET'); return value; }
export async function loadSavedPlaceState(client: SupabaseClient, value: SavedTarget): Promise<SavedState> {
  const result = await client.rpc('get_saved_place_state', args(placeTarget(value)));
  if (result.error?.code === 'PGRST202') return loadSavedItemState(client, value);
  if (result.error) throw new Error(result.error.message);
  return state(result.data, value);
}
export async function setSavedPlaceState(client: SupabaseClient, value: SavedTarget, status: SavedPlaceStatus | null): Promise<SavedState> {
  if (status !== null && status !== 'want' && status !== 'been') throw new Error('INVALID_SAVED_TARGET');
  const result = state(await call(client, 'set_saved_place_state', { ...args(placeTarget(value)), p_status: status }), value);
  if (result.saved !== (status !== null) || result.status !== status) throw new Error('SAVE_NOT_VERIFIED');
  return result;
}
export async function loadSavedItems(client: SupabaseClient, options: { filter?: SavedFilter; query?: string; folderId?: string | null; cursor?: SavedCursor | null } = {}): Promise<SavedPage> {
  const filter = options.filter ?? 'all', query = options.query ?? '';
  if (!['all', 'places', 'posts', 'jobs', 'users'].includes(filter) || typeof query !== 'string' || query.trim().length > 120) throw new Error('INVALID_SAVED_QUERY');
  const after = options.cursor ? cursor(options.cursor, 'INVALID_SAVED_CURSOR') : null;
  const result = await call(client, 'get_saved_items', { p_filter: filter, p_query: query.trim(), p_folder_id: options.folderId ? folderId(options.folderId) : null, p_before_saved_at: after?.savedAt ?? null, p_before_key: after?.key ?? null });
  if (!object(result) || !Array.isArray(result.items) || result.items.length > 30 || typeof result.hasMore !== 'boolean') invalid();
  const items = result.items.map((row): SavedItem => {
    if (!object(row) || !text(row.key, 240) || !row.key || !timestamp(row.savedAt) || !text(row.title, 1000) || !text(row.subtitle, 3000)) invalid();
    const resolved = target(row.target, 'INVALID_SAVED_RESPONSE');
    if (row.imageUrl != null && (!text(row.imageUrl, 3000) || !/^https:\/\//.test(row.imageUrl))) invalid();
    if (row.cityId != null && (typeof row.cityId !== 'string' || !CITY.test(row.cityId))) invalid();
    if (row.address != null && !text(row.address, 1000)) invalid();
    if (row.postType !== undefined && !['post', 'meetup', 'job', 'listing'].includes(row.postType as string)) invalid();
    if ((row.closed !== undefined && typeof row.closed !== 'boolean') || (row.hasWebshop !== undefined && typeof row.hasWebshop !== 'boolean')) invalid();
    if (row.note != null && (!text(row.note, 200) || !row.note.trim())) invalid();
    folderIds(row.folderIds);
    return { ...row, target: resolved } as SavedItem;
  });
  if (new Set(items.map(item => item.key)).size !== items.length) invalid();
  const next = result.nextCursor === null ? null : cursor(result.nextCursor);
  if (result.hasMore !== !!next || (next && (items.at(-1)?.key !== next.key || items.at(-1)?.savedAt !== next.savedAt))) invalid();
  return { items, hasMore: result.hasMore, nextCursor: next };
}
export async function loadSavedFolders(client: SupabaseClient): Promise<SavedFolder[]> {
  const result = await call(client, 'get_saved_folders');
  if (!Array.isArray(result) || result.length > 100) invalid();
  const rows = result.map(folder);
  if (new Set(rows.map(row => row.id)).size !== rows.length) invalid();
  return rows;
}
// Creates a folder (id null) or edits one of the member's own.
// Every edit sends the description too: a blank one clears it.
export async function saveSavedFolder(client: SupabaseClient, id: string | null, name: string, visibility: FolderVisibility, description: string | null): Promise<SavedFolder> {
  if (visibility !== 'friends' && visibility !== 'private') throw new Error('INVALID_SAVED_FOLDER');
  const line = oneLine(description, 150, 'INVALID_SAVED_FOLDER');
  const result = folderCard(await call(client, 'save_saved_folder', { p_folder_id: id === null ? null : folderId(id), p_name: folderName(name), p_visibility: visibility, p_description: line }));
  if ((id !== null && result.id !== id) || result.visibility !== visibility || result.description !== line) invalid();
  return { id: result.id, name: result.name, visibility: result.visibility, description: result.description };
}
// The owner's pick among the folder's places; null goes back to the newest place.
export async function setSavedFolderCover(client: SupabaseClient, id: string, value: FolderCover | null): Promise<FolderCard> {
  const picked = value === null ? null : cover(value, 'INVALID_SAVED_FOLDER_COVER');
  const result = folderCard(await call(client, 'set_saved_folder_cover', { p_folder_id: folderId(id), p_city_id: picked?.cityId ?? null, p_place_key: picked?.placeKey ?? null }));
  if (result.id !== id.toLowerCase() || (picked && (result.cover?.cityId !== picked.cityId || result.cover.placeKey !== picked.placeKey))) invalid();
  return result;
}
export async function loadSavedFolder(client: SupabaseClient, id: string): Promise<FolderDetail> {
  const value = await call(client, 'get_saved_folder', { p_folder_id: folderId(id) });
  const card = folderCard(value);
  if (!object(value) || card.id !== id.toLowerCase() || (value.role !== 'owner' && value.role !== 'viewer') || !object(value.owner)
    || typeof value.owner.id !== 'string' || !UUID.test(value.owner.id) || !text(value.owner.nickname, 200) || !Array.isArray(value.places) || value.places.length > 300) invalid();
  return { ...card, role: value.role, owner: { id: value.owner.id.toLowerCase(), nickname: value.owner.nickname }, places: value.places.map(folderPlace) };
}
// A friend's folders that have a place to show; the server leaves out everything this member may not see.
export async function loadFriendFolders(client: SupabaseClient, userId: string): Promise<FolderCard[]> {
  if (!UUID.test(userId)) throw new Error('INVALID_PROFILE');
  const value = await call(client, 'get_friend_saved_folders', { p_user_id: userId });
  if (!Array.isArray(value) || value.length > 100) invalid();
  return value.map(folderCard);
}
// A blank memo deletes it. The memo stays with this member; the server never shows it to anyone else.
export async function setSavedNote(client: SupabaseClient, value: SavedTarget, note: string | null): Promise<string | null> {
  const line = oneLine(note, 200, 'INVALID_SAVED_NOTE');
  const result = await call(client, 'set_saved_note', { ...args(value), p_note: line });
  if (!object(result) || !text(result.key, 240) || result.note !== line) throw new Error('NOTE_NOT_VERIFIED');
  return line;
}
// Friends' folders that hold this place, as far as this member may open them. At most 10.
export async function loadPlaceFriendFolders(client: SupabaseClient, cityId: string, placeKey: string): Promise<PlaceFolder[]> {
  if (!CITY.test(cityId) || !PLACE.test(placeKey)) throw new Error('INVALID_SAVED_TARGET');
  const value = await call(client, 'get_place_friend_folders', { p_city_id: cityId, p_place_key: placeKey });
  if (!Array.isArray(value) || value.length > 10) invalid();
  return value.map(row => {
    const card = folderCard(row);
    if (!object(row) || !object(row.owner) || typeof row.owner.id !== 'string' || !UUID.test(row.owner.id) || !text(row.owner.nickname, 200)) invalid();
    return { ...card, owner: { id: row.owner.id.toLowerCase(), nickname: row.owner.nickname } };
  });
}
export async function deleteSavedFolder(client: SupabaseClient, id: string): Promise<void> {
  if (await call(client, 'delete_saved_folder', { p_folder_id: folderId(id) }) !== true) throw new Error('FOLDER_DELETE_NOT_VERIFIED');
}
export async function setSavedItemFolders(client: SupabaseClient, value: SavedTarget, ids: string[]): Promise<void> {
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string' || !UUID.test(id)) || new Set(ids).size !== ids.length) throw new Error('INVALID_SAVED_FOLDER');
  if (await call(client, 'set_saved_item_folders', { ...args(value), p_folder_ids: ids }) !== true) throw new Error('FOLDERS_NOT_VERIFIED');
}
