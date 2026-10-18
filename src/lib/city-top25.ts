import type { DiscoveryCategory } from './discovery.ts';

export type CityTop25Place = {
  id: string; cityId: string; title: string; label: string;
  category: Exclude<DiscoveryCategory, 'housing' | 'used' | 'event' | 'festival'>;
  latitude: number; longitude: number; reason: string; reasonEn?: string; sourceUrl: string; postIds: readonly string[];
};

// Only source-checked city selections belong here; design fixtures stay outside the app.
export const CITY_TOP25: readonly CityTop25Place[] = [];
