// 최근 검색어 (I-post-01 bundle): kept only on this phone, one list per account, never sent to the server.
const MAX_RECENT = 10;

export const recentSearchKey = (viewer: string | null) => `gling.search.recent:${viewer ?? 'guest'}`;

export function parseRecentSearches(raw: string | null): string[] {
  try {
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim() && item.length <= 100).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

// Newest first; the same words typed again move to the top instead of repeating.
export function addRecentSearch(list: string[], query: string) {
  const text = query.trim().slice(0, 100);
  if (!text) return list;
  return [text, ...list.filter(item => item.toLowerCase() !== text.toLowerCase())].slice(0, MAX_RECENT);
}

export const removeRecentSearch = (list: string[], query: string) => list.filter(item => item !== query);
