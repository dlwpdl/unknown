import { useLocalSearchParams } from 'expo-router';
import { UnifiedSearch } from '@/components/unified-search';
import { useCommunityCity } from '@/lib/community-city';
import { CITIES } from '@/lib/mock';
import type { UnifiedSearchKind } from '@/lib/unified-search';

const kinds: UnifiedSearchKind[] = ['all', 'business', 'place', 'person', 'post', 'meetup'];
export default function SearchScreen() {
  const { city } = useCommunityCity();
  const params = useLocalSearchParams<{ cityId?: string; query?: string; kind?: string }>();
  const cityId = CITIES.find(value => value.id === params.cityId)?.id ?? city.id;
  const query = typeof params.query === 'string' ? params.query.slice(0, 100) : '';
  const kind = kinds.includes(params.kind as UnifiedSearchKind) ? params.kind as UnifiedSearchKind : query.trim().startsWith('#') ? 'post' : 'all';
  return <UnifiedSearch key={`${cityId}:${query}:${kind}`} initialCityId={cityId} initialQuery={query} initialKind={kind} />;
}
