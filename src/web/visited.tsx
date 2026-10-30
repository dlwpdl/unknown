import { publicMetadata } from '@/components/public-web/metadata';
import { CITIES } from '@/lib/mock';
import { PUBLIC_SITE } from '@/lib/public-seo';

export { default } from '@/components/public-web/visited';

export function generateMetadata() {
  const city = CITIES.filter(city => city.state === 'open')[0];
  // The first city is the plain /visited page, matching its sitemap entry.
  return publicMetadata(`${city.name} 한인이 가 본 곳 | 글링`, `${city.name}에서 글링이 직접 다녀온 식당·카페·가 볼 곳을 주소와 지도로 모았어요.`, `${PUBLIC_SITE}/visited`);
}
