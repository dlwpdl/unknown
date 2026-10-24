import type { SupabaseClient } from '@supabase/supabase-js';
import { attachMerchantProfileImages } from './merchant-profile.ts';

type DirectoryRow = {
  id: string; name: string; city_id: string; industry: string; services: string; address: string;
  avatar_path: string | null; banner_path: string | null; saved: boolean; has_webshop: boolean;
};
export type BusinessDirectoryItem = DirectoryRow & { avatarUri: string | null; bannerUri: string | null; imageLoadFailed: boolean };
export type BusinessDirectoryPage = { items: BusinessDirectoryItem[]; industries: string[]; hasMore: boolean; nextOffset: number };
export type BusinessDirectoryRequest = { cityId: string; query?: string; industry: string | null; offset?: number; signal?: AbortSignal };
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && [...value].length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (row: Record<string, unknown>, keys: string[]) => Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key));
const invalidResponse = (): never => { throw new Error('INVALID_BUSINESS_DIRECTORY_RESPONSE'); };

function requestScope(request: BusinessDirectoryRequest) {
  if (!request || !text(request.cityId, 100) || !request.cityId.trim() || request.cityId !== request.cityId.trim()
    || request.query !== undefined && !text(request.query, 200) || request.industry !== null && (!text(request.industry, 200) || !request.industry.trim())
    || request.offset !== undefined && !Number.isInteger(request.offset) || (request.offset ?? 0) < 0 || (request.offset ?? 0) > 10000) {
    throw new Error('INVALID_BUSINESS_DIRECTORY_REQUEST');
  }
  return { cityId: request.cityId, query: (request.query ?? '').trim(), industry: request.industry?.trim() ?? null, offset: request.offset ?? 0 };
}

export function parseBusinessDirectoryPage(value: unknown, request: BusinessDirectoryRequest) {
  const scope = requestScope(request);
  if (!record(value) || !exact(value, ['city_id', 'query', 'industry', 'offset', 'items', 'industries', 'has_more', 'next_offset'])
    || value.city_id !== scope.cityId || value.query !== scope.query || value.industry !== scope.industry || value.offset !== scope.offset
    || !Array.isArray(value.items) || value.items.length > 20 || typeof value.has_more !== 'boolean'
    || value.has_more && value.items.length !== 20 || value.next_offset !== scope.offset + value.items.length
    || !Array.isArray(value.industries) || value.industries.some(industry => !text(industry, 200) || !industry.trim() || industry !== industry.trim())
    || new Set(value.industries).size !== value.industries.length) return invalidResponse();
  const industries = value.industries as string[];
  const items = value.items.map((row: unknown): DirectoryRow => {
    if (!record(row) || !exact(row, ['id', 'name', 'city_id', 'industry', 'services', 'address', 'avatar_path', 'banner_path', 'saved', 'has_webshop'])
      || typeof row.id !== 'string' || !UUID.test(row.id) || row.city_id !== scope.cityId
      || !text(row.name, 200) || !row.name.trim() || !text(row.industry, 200) || !industries.includes(row.industry)
      || scope.industry !== null && row.industry !== scope.industry
      || typeof row.services !== 'string' || [...row.services].length > 1500 || typeof row.address !== 'string' || [...row.address].length > 300
      || typeof row.saved !== 'boolean' || typeof row.has_webshop !== 'boolean') return invalidResponse();
    for (const kind of ['avatar', 'banner'] as const) {
      const path = row[`${kind}_path`];
      if (path !== null && (typeof path !== 'string' || !new RegExp(`^business-profile/${row.id}/${kind}/[0-9a-f]{32}$`).test(path))) return invalidResponse();
    }
    return { id: row.id, name: row.name, city_id: row.city_id, industry: row.industry, services: row.services, address: row.address,
      avatar_path: row.avatar_path as string | null, banner_path: row.banner_path as string | null, saved: row.saved, has_webshop: row.has_webshop };
  });
  if (new Set(items.map(item => item.id)).size !== items.length) return invalidResponse();
  return { items, industries, hasMore: value.has_more, nextOffset: value.next_offset as number };
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) { const error = new Error('Business directory request aborted'); error.name = 'AbortError'; throw error; }
}

export async function loadBusinessDirectory(client: SupabaseClient, request: BusinessDirectoryRequest): Promise<BusinessDirectoryPage> {
  const scope = requestScope(request);
  checkAbort(request.signal);
  const pending = client.rpc('get_public_business_directory', { p_city_id: scope.cityId, p_query: scope.query, p_industry: scope.industry, p_offset: scope.offset });
  const { data, error } = await (request.signal ? pending.abortSignal(request.signal) : pending);
  checkAbort(request.signal);
  if (error) throw error;
  const page = parseBusinessDirectoryPage(data, scope);
  const items = await Promise.all(page.items.map(item => attachMerchantProfileImages(client, item)));
  checkAbort(request.signal);
  return { ...page, items };
}
