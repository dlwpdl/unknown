import type { PostPin } from './post-maps.ts';

// Neighborhood centres for listing posts (부동산·중고거래·구인구직). Listings never store or show a tapped point:
// the composer saves a neighborhood id, and maps place the post at that neighborhood's centre.
// shortcut: hand-picked list per open city, rounded to ~100 m; move it to the server when cities open faster than releases.
export type Neighborhood = { id: string; ko: string; en: string; latitude: number; longitude: number };

const n = (id: string, ko: string, en: string, latitude: number, longitude: number): Neighborhood => ({ id, ko, en, latitude, longitude });

export const NEIGHBORHOODS: Record<string, readonly Neighborhood[]> = {
  vancouver: [
    n('downtown', '다운타운', 'Downtown', 49.282, -123.12), n('west-end', '웨스트엔드', 'West End', 49.286, -123.134),
    n('yaletown', '예일타운', 'Yaletown', 49.275, -123.122), n('kitsilano', '킷실라노', 'Kitsilano', 49.268, -123.168),
    n('mount-pleasant', '마운트 플레전트', 'Mount Pleasant', 49.263, -123.1), n('commercial-drive', '커머셜 드라이브', 'Commercial Drive', 49.27, -123.07),
    n('oakridge', '오크리지', 'Oakridge', 49.233, -123.117), n('ubc', 'UBC', 'UBC', 49.261, -123.246),
    n('north-vancouver', '노스밴쿠버', 'North Vancouver', 49.32, -123.072), n('west-vancouver', '웨스트밴쿠버', 'West Vancouver', 49.328, -123.16),
    n('metrotown', '메트로타운', 'Metrotown', 49.226, -123.004), n('brentwood', '브렌트우드', 'Brentwood', 49.267, -123.001),
    n('joyce', '조이스', 'Joyce–Collingwood', 49.238, -123.032), n('edmonds', '에드먼즈', 'Edmonds', 49.212, -122.959),
    n('burquitlam', '버퀴틀람', 'Burquitlam', 49.261, -122.89), n('coquitlam-centre', '코퀴틀람 센터', 'Coquitlam Centre', 49.277, -122.8),
    n('port-moody', '포트무디', 'Port Moody', 49.284, -122.832), n('new-westminster', '뉴웨스트민스터', 'New Westminster', 49.206, -122.911),
    n('richmond', '리치먼드', 'Richmond', 49.167, -123.134), n('surrey', '써리', 'Surrey', 49.19, -122.849),
    n('langley', '랭리', 'Langley', 49.104, -122.66),
    n('delta', '델타', 'Delta', 49.163, -122.902), n('ladner', '래드너', 'Ladner', 49.089, -123.082),
    n('tsawwassen', '츠와센', 'Tsawwassen', 49.006, -123.083), n('port-coquitlam', '포트코퀴틀람', 'Port Coquitlam', 49.262, -122.781),
    n('maple-ridge', '메이플리지', 'Maple Ridge', 49.219, -122.598), n('white-rock', '화이트락', 'White Rock', 49.025, -122.802),
  ],
  toronto: [
    n('downtown', '다운타운', 'Downtown', 43.651, -79.383), n('koreatown', '코리아타운', 'Koreatown', 43.665, -79.418),
    n('yonge-eglinton', '영·에글린턴', 'Yonge & Eglinton', 43.706, -79.399), n('north-york', '노스욕', 'North York Centre', 43.768, -79.413),
    n('finch', '핀치', 'Finch', 43.78, -79.416), n('thornhill', '쏜힐', 'Thornhill', 43.815, -79.424),
    n('richmond-hill', '리치먼드힐', 'Richmond Hill', 43.883, -79.44), n('vaughan', '본', 'Vaughan', 43.837, -79.508),
    n('markham', '마캄', 'Markham', 43.856, -79.337), n('scarborough', '스카보로', 'Scarborough', 43.773, -79.258),
    n('etobicoke', '에토비코', 'Etobicoke', 43.621, -79.513), n('mississauga', '미시사가', 'Mississauga', 43.589, -79.644),
  ],
  montreal: [
    n('downtown', '다운타운', 'Downtown', 45.502, -73.567), n('old-montreal', '올드 몬트리올', 'Old Montréal', 45.508, -73.554),
    n('plateau', '플라토', 'Plateau', 45.523, -73.58), n('mile-end', '마일엔드', 'Mile End', 45.525, -73.6),
    n('cote-des-neiges', '코트데네주', 'Côte-des-Neiges', 45.496, -73.622), n('ndg', 'NDG', 'NDG', 45.473, -73.615),
    n('westmount', '웨스트마운트', 'Westmount', 45.485, -73.596), n('verdun', '베르됭', 'Verdun', 45.458, -73.57),
    n('saint-laurent', '생로랑', 'Saint-Laurent', 45.51, -73.68), n('laval', '라발', 'Laval', 45.56, -73.72),
    n('brossard', '브로사드', 'Brossard', 45.45, -73.465),
  ],
  calgary: [
    n('downtown', '다운타운', 'Downtown', 51.045, -114.072), n('beltline', '벨트라인', 'Beltline', 51.039, -114.07),
    n('kensington', '켄싱턴', 'Kensington', 51.053, -114.088), n('brentwood', '브렌트우드', 'Brentwood', 51.086, -114.13),
    n('crowfoot', '크로풋', 'Crowfoot', 51.123, -114.207), n('signal-hill', '시그널힐', 'Signal Hill', 51.017, -114.172),
    n('shawnessy', '쇼네시', 'Shawnessy', 50.903, -114.064), n('mahogany', '머호가니', 'Mahogany', 50.896, -113.93),
    n('airdrie', '에어드리', 'Airdrie', 51.292, -114.014),
  ],
  edmonton: [
    n('downtown', '다운타운', 'Downtown', 53.544, -113.491), n('old-strathcona', '올드 스트래스코나', 'Old Strathcona', 53.519, -113.497),
    n('university', '앨버타대 주변', 'University of Alberta', 53.523, -113.526), n('west-edmonton', '웨스트 에드먼턴 몰', 'West Edmonton Mall', 53.523, -113.624),
    n('southgate', '사우스게이트', 'Southgate', 53.485, -113.513), n('mill-woods', '밀우즈', 'Mill Woods', 53.455, -113.43),
    n('windermere', '윈더미어', 'Windermere', 53.43, -113.61), n('sherwood-park', '셔우드파크', 'Sherwood Park', 53.541, -113.296),
    n('st-albert', '세인트앨버트', 'St. Albert', 53.631, -113.626),
  ],
};

export const neighborhoodsFor = (cityId: string): readonly Neighborhood[] => Object.hasOwn(NEIGHBORHOODS, cityId) ? NEIGHBORHOODS[cityId] : [];
export const findNeighborhood = (cityId: string, id: string | null | undefined) => id ? neighborhoodsFor(cityId).find(item => item.id === id) ?? null : null;
export const neighborhoodName = (item: Neighborhood, language: 'ko' | 'en') => language === 'en' ? item.en : item.ko;

const distanceKm = (a: PostPin, b: PostPin) => {
  const rad = Math.PI / 180, dLat = (b.latitude - a.latitude) * rad, dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

export function nearestNeighborhood(cityId: string, pin: PostPin, maxKm = 6): Neighborhood | null {
  let best: Neighborhood | null = null, bestKm = maxKm;
  for (const item of neighborhoodsFor(cityId)) {
    const km = distanceKm(pin, item);
    if (km <= bestKm) { best = item; bestKm = km; }
  }
  return best;
}

// A listing never appears at a tapped point: snap to a neighborhood centre, otherwise round to ~1 km.
export function coarseListingPin(cityId: string, pin: PostPin): { latitude: number; longitude: number; neighborhood: Neighborhood | null } {
  const neighborhood = nearestNeighborhood(cityId, pin);
  if (neighborhood) return { latitude: neighborhood.latitude, longitude: neighborhood.longitude, neighborhood };
  return { latitude: Math.round(pin.latitude * 100) / 100, longitude: Math.round(pin.longitude * 100) / 100, neighborhood: null };
}
