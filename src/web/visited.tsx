import { publicMetadata } from '@/components/public-web/metadata';
import { CITIES } from '@/lib/mock';
import { PUBLIC_SITE } from '@/lib/public-seo';

export { default } from '@/components/public-web/visited';

export function generateMetadata() {
  const city = CITIES.filter(city => city.state === 'open')[0];
  return publicMetadata(`${city.name} Gling Visited | 글링`, `${city.name}에서 글링이 직접 다녀온 장소를 지도에서 둘러보세요.`,
    `${PUBLIC_SITE}/visited?${new URLSearchParams({ city: city.id })}`);
}
