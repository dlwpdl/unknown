import './reader.css';
import './visited.css';
import { Asset } from 'expo-asset';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import Head from 'expo-router/head';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { CityPlacePhoto } from '@/components/city-place-photo';
import { DiscoveryMap } from '@/components/discovery-map';
import { WebNightColors } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useAuth } from '@/lib/auth';
import { cityPlacesRevision, getCityPlaces, replaceCityPlacesCatalog, subscribeCityPlaces } from '@/lib/city-places';
import { refreshCityPlaces } from '@/lib/city-place-refresh';
import { placeMapRoute } from '@/lib/discovery';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES } from '@/lib/mock';
import { PUBLIC_SITE } from '@/lib/public-seo';
import { publicWebClient } from '@/lib/public-web-client';

const wordmark = Asset.fromModule(require('../../../assets/brand/gling-night-wordmark.png')).uri;
const visitWordmark = Asset.fromModule(require('../../../assets/brand/gling-night-wordmark-light.png')).uri;
const palette = Object.fromEntries(Object.entries(WebNightColors).map(([key, value]) => [`--${key}`, value])) as CSSProperties;
const cities = CITIES.filter(city => city.state === 'open');

export default function PublicVisited() {
  const { language } = useLanguage(), { isAuthed } = useAuth();
  const ko = language === 'ko';
  const params = useLocalSearchParams<{ city?: string; placeId?: string }>();
  const router = useRouter(), { play } = useInteractionFeedback();
  useSyncExternalStore(subscribeCityPlaces, cityPlacesRevision, cityPlacesRevision);
  const hydrated = useSyncExternalStore(subscribeCityPlaces, () => true, () => false);
  const city = cities.find(city => city.id === params.city) ?? cities[0];
  const places = getCityPlaces(city.id).filter(place => place.glingVisited);
  const selected = places.find(place => place.id === params.placeId) ?? null;
  const [mode, setMode] = useState<'list' | 'map'>(params.placeId ? 'map' : 'list');
  const [catalogState, setCatalogState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let active = true, failed = false;
    void refreshCityPlaces(AsyncStorage, async () => {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const { data, error } = await publicWebClient.rpc('get_city_place_catalog').abortSignal(controller.signal);
        if (error || !data) throw new Error('PLACE_CATALOG_UNAVAILABLE');
        return data;
      } catch (error) { failed = true; throw error; }
      finally { clearTimeout(timeout); }
    }, value => {
      try { const changed = replaceCityPlacesCatalog(value); failed = false; return changed; }
      catch (error) { failed = true; throw error; }
    }).catch(() => { failed = true; }).finally(() => {
      if (active) setCatalogState(failed ? 'error' : 'ready');
    });
    return () => { active = false; };
  }, []);
  const route = (placeId: string) => `/visited?${new URLSearchParams({ city: city.id, placeId })}`;
  const select = (placeId: string) => {
    if (!places.some(place => place.id === placeId)) return;
    play('selection'); setMode('map');
    // This route belongs to the public export, whose routes differ from the native app.
    router.push(route(placeId) as Href);
  };
  const appMap = selected ? `gling://map?${new URLSearchParams({ cityId: city.id, placeId: selected.id, category: 'visited' })}` : null;
  const title = `${city.name} Gling Visited | 글링`;

  return <div className="reader visited-page" style={palette} lang="ko">
    <Head><title>{title}</title><meta name="description" content={`${city.name}에서 글링이 직접 다녀온 장소를 지도에서 둘러보세요.`} />
      <link rel="canonical" href={`${PUBLIC_SITE}/visited?${new URLSearchParams({ city: city.id, ...(selected ? { placeId: selected.id } : {}) })}`} />
    </Head>
    <a className="reader-skip" href="#visited-main" onClick={() => play('selection')}>본문으로 바로가기</a>
    <header className="reader-header">
      <a href="/" aria-label="글링 홈" onClick={() => play('selection')}><img src={wordmark} alt="gling" width="96" /></a>
      <nav aria-label="주요 메뉴"><a href="/" onClick={() => play('selection')}>{ko ? '오늘' : 'Today'}</a><a href="/?tag=festival#stories" onClick={() => play('selection')}>{ko ? '페스티벌' : 'Festivals'}</a>
        <a href="/meetups" onClick={() => play('selection')}>{ko ? '모임' : 'Meetups'}</a>
        <a href="/visited" aria-current="page" onClick={() => play('selection')}>Gling Visited</a>
      </nav>
      <a className="reader-header-account" href="/merchant/" onClick={() => play('selection')}>{isAuthed ? ko ? '내 계정' : 'My account' : ko ? '로그인' : 'Sign in'}</a>
    </header>
    <main id="visited-main" className="reader-main" tabIndex={-1}>
      <div className="visited-heading"><div><h1>Gling Visited</h1><p>글링이 직접 다녀온 곳. 다음에는 함께 가요.</p></div>
        <form action="/visited" method="get" className="visited-city">
          <label htmlFor="visited-city">도시</label><select id="visited-city" name="city" defaultValue={city.id} key={city.id} onChange={() => play('selection')}>
            {cities.map(city => <option key={city.id} value={city.id}>{city.name}</option>)}
          </select><button type="submit" onClick={() => play('selection')}>보기</button>
        </form>
      </div>
      {catalogState !== 'ready' && <p role="status" className="visited-catalog-status">{catalogState === 'loading'
        ? '최신 장소 정보를 확인하고 있어요.' : '최신 장소 정보를 불러오지 못했어요. 저장된 장소로 계속 둘러볼 수 있어요.'}</p>}
      {!places.length ? <section className="visited-empty"><h2>아직 등록된 방문 장소가 없어요</h2><p>{city.name}의 다른 이야기와 모임을 둘러보세요.</p>
        <a className="reader-secondary" href={`/?${new URLSearchParams({ city: city.id, tag: 'meetup' })}#stories`} onClick={() => play('selection')}>이 도시의 모임 보기</a>
      </section> : <>
        <div className="visited-modes" aria-label="장소 보기 방식">{(['list', 'map'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value}
          onClick={() => { play('selection'); setMode(value); }}>{value === 'list' ? '목록' : '지도'}</button>)}</div>
        <div className={`visited-layout visited-mode-${mode}`}>
          <section className="visited-list" aria-label={`${city.name} 직접 방문 장소`}>
            {places.map(place => <a key={place.id} href={route(place.id)} data-place-id={place.id} aria-current={selected?.id === place.id ? 'true' : undefined}
              className="visited-card" onClick={event => { event.preventDefault(); select(place.id); }}>
              <div className="visited-card-photo"><CityPlacePhoto place={place} style={{ width: '100%', height: '100%' }} /></div>
              <div><span className="visited-label"><img src={visitWordmark} alt="gling" width="36" height="15" />VISITED</span><h2>{place.name}</h2><p>{place.address || city.name}</p><span className="visited-card-action">지도에서 보기</span></div>
            </a>)}
          </section>
          <div className="visited-map-column">
            <section className="visited-map" aria-label={`${city.name} 글링 방문 지도`}>
              {hydrated ? <DiscoveryMap cityName={city.englishName} markers={places.map(place => ({ id: place.id, latitude: place.latitude, longitude: place.longitude, color: '#CBB9FF', label: place.name.slice(0, 80) }))}
                selectedId={selected?.id ?? null} center={selected ? { latitude: selected.latitude, longitude: selected.longitude } : null} onSelect={select} />
                : <p role="status">지도를 준비하고 있어요.</p>}
            </section>
            {params.placeId && !selected && <p role="status" className="visited-missing">이 도시의 방문 장소를 찾을 수 없어요. 목록에서 다시 선택해 주세요.</p>}
            {selected && <section className="visited-detail" aria-labelledby="visited-place-name">
              <div><span className="visited-label">글링 직접 방문</span><h2 id="visited-place-name">{selected.name}</h2><p>{selected.address || city.name}</p></div>
              <div className="visited-actions"><a className="reader-primary" href={appMap!} onClick={event => {
                play('selection'); event.currentTarget.href = `gling://map?${new URLSearchParams(placeMapRoute(selected).params)}`;
              }}>앱 지도에서 보기</a>
                <a className="reader-secondary" href={selected.glingVisited!.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={() => play('selection')}>글링 방문 영상 ↗</a></div>
              {selected.photo && <details className="visited-photo-credit"><summary onClick={() => play('selection')}>사진 출처</summary><p>{selected.photo.artist} · {selected.photo.license}</p>
                <a href={selected.photo.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={() => play('selection')}>원본 사진 ↗</a>{' · '}
                <a href={selected.photo.licenseUrl} target="_blank" rel="noopener noreferrer" onClick={() => play('selection')}>이용 조건 ↗</a>
              </details>}
            </section>}
          </div>
        </div>
      </>}
    </main>
    <footer className="reader-footer"><span>gling · 같이 갈 사람, 같이 나눌 이야기</span><nav aria-label="정책">
      <a href="/terms" onClick={() => play('selection')}>이용약관</a><a href="/privacy" onClick={() => play('selection')}>개인정보처리방침</a>
    </nav></footer>
  </div>;
}
