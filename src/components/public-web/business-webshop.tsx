import './business-webshop.css';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';

import { behavior, flushBehavior } from '@/lib/behavior-analytics';
import { cityPlacesRevision, getCityPlaces, placeMatchesQuery, replaceCityPlacesCatalog, subscribeCityPlaces, type CityPlace } from '@/lib/city-places';
import { refreshCityPlaces } from '@/lib/city-place-refresh';
import { webshopApplicable } from '@/lib/discovery';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES } from '@/lib/mock';
import { publicWebClient } from '@/lib/public-web-client';
import { APPLICATION_LIMITS, applicationProblems, type ApplicationField, type WebshopApplication } from '../../../supabase/functions/_shared/webshop-application';

// Wording and layout: the approved mockup (owner 2026-11-12, gling-webshop-partner-join-20261112).
const ICON = {
  bag: <><path d="M5 8h14l-1 12H6z" /><path d="M9 8V6a3 3 0 016 0v2" /></>,
  tag: <><path d="M3 12V4a1 1 0 011-1h8l9 9-9 9z" /><circle cx="8" cy="8" r="1.5" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
  fork: <path d="M7 3v8M5 3v5a2 2 0 004 0V3M7 11v10M17 3c-2 2-2 6 0 8v10" />,
};
const Icon = ({ name }: { name: keyof typeof ICON }) => <svg className="i" viewBox="0 0 24 24" aria-hidden="true">{ICON[name]}</svg>;
const GETS = [
  ['bag', '글링 손님 주문을 받아요', '밴쿠버·토론토·몬트리올의 글링 사용자가 지도에서 가게를 보고 바로 주문할 수 있어요.'],
  ['tag', '앱보다 싼 가격이 보여요', '지도 ‘배달 할인’ 목록과 주문 버튼에 ‘최대 15% 할인’처럼 할인율이 붙어요.'],
  ['check', '글링이 보낸 주문만 세요', '원래 들어오던 주문은 세지 않아요. 비용은 글링에서 넘어간 주문에만 생기고, 자세한 조건은 연락드릴 때 안내해요.'],
] as const;
const SHOPS = [['yes', '있어요'], ['no', '없어요'], ['unknown', '모르겠어요']] as const;
const DISCOUNTS = [['5', '5%'], ['10', '10%'], ['15_plus', '15% 이상'], ['unknown', '잘 모르겠어요']] as const;
const ERRORS: Record<Exclude<ApplicationField, 'source'>, string> = {
  place: '가게를 골라 주세요.', name: '이름을 적어 주세요.', contact: '전화번호나 카카오톡 ID를 적어 주세요.', email: '이메일 주소를 다시 확인해 주세요.',
  webshop: '셋 중 하나를 골라 주세요.', webshopUrl: '‘https://’로 시작하는 웹샵 주소를 적어 주세요.', discount: '넷 중 하나를 골라 주세요.',
};
// Where focus goes when a field is the first one to fix.
const FIELD_INPUT: Record<ApplicationField, string> = {
  place: 'ws-pl', name: 'ws-nm', contact: 'ws-ct', email: 'ws-em', webshop: 'ws-shop-yes', webshopUrl: 'ws-url', discount: 'ws-disc-5', source: 'ws-nm',
};
const cityName = (id: string) => CITIES.find(city => city.id === id)?.name ?? id;
// The city is shown once in Korean, so the catalog's trailing English city is dropped.
const placeLine = (place: CityPlace) => [place.address.replace(/,?\s*(?:Vancouver|Toronto|Montr[eé]al)\b.*$/i, ''), cityName(place.cityId)].filter(Boolean).join(' · ');
// The revision is the catalog's version; passing it makes a refreshed catalog a new input for the compiled component.
function webshopPlaces(_revision: number) {
  try { return CITIES.filter(city => city.state === 'open').flatMap(city => getCityPlaces(city.id)).filter(place => webshopApplicable(place, {})); }
  catch { return []; }
}
function sentPlace(_revision: number, cityId: unknown, placeId: unknown) {
  if (typeof cityId !== 'string' || typeof placeId !== 'string') return null;
  try { return getCityPlaces(cityId).find(place => place.id === placeId) ?? null; } catch { return null; }
}

async function sendApplication(body: Record<string, unknown>) {
  try {
    const { error } = await publicWebClient.functions.invoke('webshop-apply', { body });
    if (!error) return 200;
    const response = (error as { context?: unknown }).context;
    return response instanceof Response ? response.status : 0;
  } catch { return 0; }
}

type Done = { place: string; contact: string; webshop: string; discount: string };

export function BusinessWebshop() {
  const { play } = useInteractionFeedback();
  const tap = () => play('selection');
  const params = useLocalSearchParams<{ place?: string; city?: string }>();
  const revision = useSyncExternalStore(subscribeCityPlaces, cityPlacesRevision, cityPlacesRevision);
  const hydrated = useSyncExternalStore(subscribeCityPlaces, () => true, () => false);
  // 'auto' shows the place the app sent (?place=&city=), until the owner changes it.
  const [mode, setMode] = useState<'auto' | 'search' | 'picked' | 'manual'>('auto');
  const [picked, setPicked] = useState<CityPlace | null>(null);
  const [query, setQuery] = useState(''), [active, setActive] = useState(0), [closed, setClosed] = useState(false);
  const [manual, setManual] = useState(''), [name, setName] = useState(''), [contact, setContact] = useState(''), [email, setEmail] = useState('');
  const [webshop, setWebshop] = useState(''), [url, setUrl] = useState(''), [discount, setDiscount] = useState(''), [trap, setTrap] = useState('');
  const [tried, setTried] = useState(false), [busy, setBusy] = useState(false), [sendError, setSendError] = useState<'rate' | 'failed' | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  // The element to focus once the next render has put it on the page.
  const focusNext = useRef<string | null>(null);
  const focusSoon = (id: string) => { focusNext.current = id; };
  useEffect(() => {
    if (!focusNext.current) return;
    document.getElementById(focusNext.current)?.focus();
    focusNext.current = null;
  });

  useEffect(() => {
    void refreshCityPlaces(AsyncStorage, async () => {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const { data, error } = await publicWebClient.rpc('get_city_place_catalog').abortSignal(controller.signal);
        if (error || !data) throw new Error('PLACE_CATALOG_UNAVAILABLE');
        return data;
      } finally { clearTimeout(timeout); }
    }, replaceCityPlacesCatalog).catch(() => { /* The bundled catalog still lists the places. */ });
  }, []);

  const fromPlace = hydrated && typeof params.place === 'string' && !!params.place;
  const sent = fromPlace && mode === 'auto' ? sentPlace(revision, params.city, params.place) : null;
  const place = mode === 'picked' ? picked : mode === 'auto' ? sent : null;
  const typing = mode === 'manual';
  const candidates = webshopPlaces(revision);
  const term = query.trim();
  const hits = term ? candidates.filter(item => placeMatchesQuery(item, term))
    .sort((a, b) => Number(b.name.toLowerCase().startsWith(term.toLowerCase())) - Number(a.name.toLowerCase().startsWith(term.toLowerCase()))).slice(0, 4) : [];
  const listOpen = !place && !typing && !!term && !closed;

  const application: WebshopApplication = {
    placeKey: place?.id ?? null, cityId: place?.cityId ?? null, placeName: place ? place.name : typing ? manual.trim() : '',
    name: name.trim(), contact: contact.trim(), email: email.trim() || null,
    webshop: webshop as WebshopApplication['webshop'], webshopUrl: webshop === 'yes' && url.trim() ? url.trim() : null,
    discount: discount as WebshopApplication['discount'], source: fromPlace ? 'place' : 'web',
  };
  const problems = tried ? applicationProblems(application) : [];
  const error = (field: Exclude<ApplicationField, 'source'>) => problems.includes(field)
    ? field === 'place' && typing ? '가게 이름과 주소를 적어 주세요.' : ERRORS[field] : '';
  const err = (id: string, message: string) => message ? <p className="f-err" id={id}>{message}</p> : null;

  function choose(next: CityPlace) { tap(); setPicked(next); setMode('picked'); setQuery(''); focusSoon('ws-pl-change'); }
  function search() { tap(); setPicked(null); setMode('search'); setQuery(''); setClosed(false); focusSoon('ws-pl'); }
  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (!listOpen || !hits.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length); }
    else if (event.key === 'Enter') { event.preventDefault(); choose(hits[Math.min(active, hits.length - 1)]); }
    else if (event.key === 'Escape') setClosed(true);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setTried(true); setSendError(null);
    const found = applicationProblems(application);
    if (found.length) { play('warning'); focusSoon(found[0] === 'place' && typing ? 'ws-pl-manual' : found[0] === 'place' && place ? 'ws-pl-change' : FIELD_INPUT[found[0]]); return; }
    setBusy(true);
    const status = await sendApplication({ ...application, website: trap });
    setBusy(false);
    if (status !== 200) { play('warning'); setSendError(status === 429 ? 'rate' : 'failed'); return; }
    play('success');
    behavior('press', fromPlace ? 'business.webshop.apply.place' : 'business.webshop.apply.web'); void flushBehavior();
    const shop = SHOPS.find(([value]) => value === webshop)![1], cut = DISCOUNTS.find(([value]) => value === discount)![1];
    focusSoon('ws-done');
    setDone({ place: application.placeName, contact: application.contact, webshop: application.webshopUrl ? `${shop} · ${application.webshopUrl}` : shop, discount: discount === 'unknown' ? cut : `${cut} 싸게` });
  }
  function again() {
    tap(); setDone(null); setTried(false); setSendError(null); setPicked(null); setMode('search'); setQuery(''); setManual('');
    setName(''); setContact(''); setEmail(''); setWebshop(''); setUrl(''); setDiscount(''); setTrap(''); focusSoon('ws-pl');
  }
  const options = (group: string, items: readonly (readonly [string, string])[], value: string, onPick: (next: string) => void, described: string, invalid: boolean) =>
    <div className="opts" role="radiogroup" aria-describedby={described} aria-invalid={invalid || undefined}>{items.map(([key, label]) =>
      <label className="opt" key={key}><input type="radio" id={`ws-${group}-${key.replace('_', '-')}`} name={`ws-${group}`} value={key} checked={value === key} onChange={() => { tap(); onPick(key); }} /><span>{label}</span></label>)}</div>;

  return <section className="ws" id="webshop" aria-labelledby="ws-h">
    <p className="biz-kicker">웹샵 제휴</p>
    <h2 id="ws-h">글링 지도에서 가게 웹샵으로 주문이 들어와요</h2>
    <p className="biz-lede">글링 지도의 가게 카드에 ‘웹샵 주문’ 버튼을 달아 드려요. 손님이 누르면 사장님 가게의 Uber 웹샵이 열려요.</p>
    <ul className="ws-gets">{GETS.map(([icon, title, body]) => <li key={title}><span className="ic"><Icon name={icon} /></span><h3>{title}</h3><p>{body}</p></li>)}</ul>
    <div className="ws-rule" role="note"><span className="k">조건은 하나</span><p>웹샵 가격이 Uber Eats 앱보다 싸야 해요. 같은 메뉴끼리 비교해서 하나라도 같거나 비싸면 주문 버튼을 달지 않아요.</p><p>주문과 결제는 가게 Uber 웹샵에서 해요. 글링은 주문을 직접 받지 않아요.</p></div>

    {done ? <div className="ws-form ws-done" id="ws-done" tabIndex={-1} role="status" aria-labelledby="ws-dh">
      <span className="ok-ic"><Icon name="check" /></span>
      <h3 id="ws-dh">접수됐어요</h3>
      <p>{done.place} 신청을 받았어요. 적어 주신 연락처로 연락드릴게요.</p>
      <dl className="ws-sum">{([['가게', done.place], ['연락처', done.contact], ['웹샵', done.webshop], ['앱보다', done.discount]] as const).map(([key, value]) => <Row key={key} label={key}>{value}</Row>)}</dl>
      <ol className="ws-next"><li>글링이 웹샵과 Uber Eats 앱에서 같은 메뉴 가격을 비교해요.</li><li>조건이 맞으면 비용과 자세한 조건을 안내해요.</li><li>지도의 가게 카드에 ‘웹샵 주문’ 버튼이 붙어요.</li></ol>
      <button type="button" className="biz-secondary" onClick={again}>다른 가게도 신청하기</button>
    </div> : <form className="ws-form" noValidate aria-labelledby="ws-fh" onSubmit={event => { void submit(event); }}>
      <h3 id="ws-fh">웹샵 제휴 신청</h3>
      <div className="f">
        <label className="f-label" htmlFor={place ? 'ws-pl-change' : typing ? 'ws-pl-manual' : 'ws-pl'}>가게</label>
        {place ? <div className="picked"><span className="pk-ic"><Icon name="fork" /></span><span className="pk-t"><b>{place.name}</b><small>{placeLine(place)}</small></span>
          <button type="button" id="ws-pl-change" className="pk-change" aria-label={`가게 바꾸기, 지금 고른 가게 ${place.name}`} onClick={search}>바꾸기</button></div>
          : typing ? <div className="f">
            <input id="ws-pl-manual" className="ws-input" type="text" aria-label="가게 이름과 주소" aria-describedby="ws-pl-e" aria-invalid={!!error('place') || undefined} placeholder="가게 이름과 주소" maxLength={APPLICATION_LIMITS.placeName} value={manual} onChange={event => setManual(event.target.value)} />
            <button type="button" className="tlink" onClick={search}>목록에서 고르기</button>
          </div> : <div className="f">
            <div className="srch"><Icon name="search" /><input id="ws-pl" className="ws-input" type="text" role="combobox" aria-autocomplete="list" aria-expanded={listOpen} aria-controls="ws-pl-list"
              aria-activedescendant={listOpen && hits.length ? `ws-pl-opt-${Math.min(active, hits.length - 1)}` : undefined} aria-describedby="ws-pl-h ws-pl-e" aria-invalid={!!error('place') || undefined}
              placeholder="가게 이름으로 찾기" autoComplete="off" maxLength={100} value={query} onChange={event => { setQuery(event.target.value); setActive(0); setClosed(false); }} onKeyDown={keys} /></div>
            <ul className="cb-list" id="ws-pl-list" role="listbox" aria-label="찾은 가게" hidden={!listOpen}>{hits.length ? hits.map((item, index) =>
              <li role="option" key={item.id} id={`ws-pl-opt-${index}`} aria-selected={index === Math.min(active, hits.length - 1)} onClick={() => choose(item)}><b>{item.name}</b><small>{placeLine(item)}</small></li>)
              : <li className="cb-empty" role="option" aria-disabled="true" aria-selected={false}>찾는 가게가 없어요. 아래 ‘목록에 없어요’를 눌러 직접 적어 주세요.</li>}</ul>
            <div className="hint-row"><p className="f-hint" id="ws-pl-h">글링 지도에 있는 가게 중에서 골라 주세요.</p>
              <button type="button" className="tlink" onClick={() => { tap(); setMode('manual'); setQuery(''); focusSoon('ws-pl-manual'); }}>목록에 없어요</button></div>
          </div>}
        {err('ws-pl-e', error('place'))}
      </div>
      <Field id="ws-nm" label="이름" error={error('name')}><input id="ws-nm" name="name" className="ws-input" type="text" autoComplete="name" maxLength={APPLICATION_LIMITS.name} aria-describedby="ws-nm-e" aria-invalid={!!error('name') || undefined} value={name} onChange={event => setName(event.target.value)} /></Field>
      <Field id="ws-ct" label="연락처" error={error('contact')} hint="전화번호나 카카오톡 ID, 편한 쪽으로 적어 주세요."><input id="ws-ct" name="contact" className="ws-input" type="text" autoComplete="tel" maxLength={APPLICATION_LIMITS.contact} aria-describedby="ws-ct-h ws-ct-e" aria-invalid={!!error('contact') || undefined} value={contact} onChange={event => setContact(event.target.value)} /></Field>
      <Field id="ws-em" label={<>이메일 <span className="opt-t">(선택)</span></>} error={error('email')}><input id="ws-em" name="email" className="ws-input" type="email" autoComplete="email" inputMode="email" maxLength={APPLICATION_LIMITS.email} aria-describedby="ws-em-e" aria-invalid={!!error('email') || undefined} value={email} onChange={event => setEmail(event.target.value)} /></Field>
      <fieldset className="f"><legend className="f-label">Uber 웹샵이 있나요?</legend>
        {options('shop', SHOPS, webshop, setWebshop, 'ws-sh-e', !!error('webshop'))}
        {webshop === 'yes' && <div className="f-sub"><label className="f-label" htmlFor="ws-url">웹샵 링크 <span className="opt-t">(선택)</span></label>
          <input id="ws-url" className="ws-input" type="url" inputMode="url" placeholder="https://" maxLength={APPLICATION_LIMITS.webshopUrl} aria-describedby="ws-url-e" aria-invalid={!!error('webshopUrl') || undefined} value={url} onChange={event => setUrl(event.target.value)} />
          {err('ws-url-e', error('webshopUrl'))}</div>}
        {(webshop === 'no' || webshop === 'unknown') && <p className="f-hint">괜찮아요. 연락드릴 때 같이 볼게요.</p>}
        {err('ws-sh-e', error('webshop'))}
      </fieldset>
      <fieldset className="f"><legend className="f-label">앱보다 얼마나 싸게 팔 수 있나요?</legend>
        <p className="f-hint" id="ws-dc-h">같은 메뉴의 Uber Eats 앱 가격과 비교했을 때예요.</p>
        {options('disc', DISCOUNTS, discount, setDiscount, 'ws-dc-h ws-dc-e', !!error('discount'))}
        {err('ws-dc-e', error('discount'))}
      </fieldset>
      {/* Hidden from people and screen readers; a bot that fills every field gets a quiet success and nothing is saved. */}
      <div className="ws-trap" aria-hidden="true"><input tabIndex={-1} autoComplete="off" name="ws-confirm" value={trap} onChange={event => setTrap(event.target.value)} /></div>
      <p className="ws-priv">보내 주신 연락처는 이 신청 안내에만 써요. <a href="/privacy" onClick={tap}>개인정보처리방침</a></p>
      {(!!problems.length || sendError) && <p className="f-err f-sum" role="alert">{problems.length ? `확인할 칸이 ${problems.length}개 있어요. 칸 아래 안내를 봐 주세요.`
        : sendError === 'rate' ? '잠깐 사이에 신청이 많이 들어왔어요. 조금 뒤에 다시 보내 주세요.' : '신청을 보내지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.'}</p>}
      <button className="biz-primary ws-submit" type="submit" aria-busy={busy}>{busy ? '보내는 중…' : '신청하기'}</button>
    </form>}
  </section>;
}

function Field({ id, label, hint, error, children }: { id: string; label: ReactNode; hint?: string; error: string; children: ReactNode }) {
  return <div className="f"><label className="f-label" htmlFor={id}>{label}</label>{children}{hint && <p className="f-hint" id={`${id}-h`}>{hint}</p>}{error && <p className="f-err" id={`${id}-e`}>{error}</p>}</div>;
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return <><dt>{label}</dt><dd>{children}</dd></>;
}
