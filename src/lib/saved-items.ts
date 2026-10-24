import type { SupabaseClient } from '@supabase/supabase-js';

export type SavedKind = 'post' | 'merchant' | 'place' | 'user';
export type SavedFilter = 'all' | 'places' | 'posts' | 'jobs' | 'users';
export type SavedTarget = { kind: SavedKind; id: string; cityId?: string };
export type SavedCursor = { savedAt: string; key: string };
export type SavedState = { target: SavedTarget; saved: boolean; available: boolean; savedAt: string | null; folderIds: string[] };
export type SavedFolder = { id: string; name: string };
export type SavedItem = {
  key: string; target: SavedTarget; savedAt: string; title: string; subtitle: string;
  imageUrl?: string | null; cityId?: string | null; address?: string | null;
  postType?: 'post' | 'meetup' | 'job' | 'listing'; closed?: boolean; hasWebshop?: boolean; folderIds: string[];
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
  return { target: resolved, saved: value.saved, available: value.available, savedAt: value.savedAt, folderIds: folders };
}
async function call(client: SupabaseClient, name: string, values: Record<string, unknown> = {}): Promise<unknown> {
  const result = await client.rpc(name, values);
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
function folder(value: unknown): SavedFolder {
  if (!object(value) || typeof value.id !== 'string' || !UUID.test(value.id) || !text(value.name, 80) || !value.name.trim()) invalid();
  return { id: value.id, name: value.name };
}
function folderId(id: string) { if (!UUID.test(id)) throw new Error('INVALID_SAVED_FOLDER'); return id; }
function folderName(name: string) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('INVALID_SAVED_FOLDER');
  return name.trim();
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
export async function createSavedFolder(client: SupabaseClient, name: string): Promise<SavedFolder> {
  return folder(await call(client, 'create_saved_folder', { p_name: folderName(name) }));
}
export async function renameSavedFolder(client: SupabaseClient, id: string, name: string): Promise<SavedFolder> {
  const result = folder(await call(client, 'rename_saved_folder', { p_folder_id: folderId(id), p_name: folderName(name) }));
  if (result.id !== id) invalid();
  return result;
}
export async function deleteSavedFolder(client: SupabaseClient, id: string): Promise<void> {
  if (await call(client, 'delete_saved_folder', { p_folder_id: folderId(id) }) !== true) throw new Error('FOLDER_DELETE_NOT_VERIFIED');
}
export async function setSavedItemFolders(client: SupabaseClient, value: SavedTarget, ids: string[]): Promise<void> {
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string' || !UUID.test(id)) || new Set(ids).size !== ids.length) throw new Error('INVALID_SAVED_FOLDER');
  if (await call(client, 'set_saved_item_folders', { ...args(value), p_folder_ids: ids }) !== true) throw new Error('FOLDERS_NOT_VERIFIED');
}
