import './reader.css';
import SharedPostLanding from './shared-post-landing';
import { PublicPostBody } from './shared-post-article';
import { PublicFestivals } from './festivals';
import { useReaderAnalytics } from './analytics';
import { PublicMerchantProfile, PublicMerchantProfileLink } from './merchant-profile';
import { PublicMeetupList } from './meetup-list';
import { AppStoreChoices, InstallAction, useDevice } from './app-store-choices';
import { FeedAd } from '@/components/feed-ad';
import { contentAdPosition } from '@/lib/content-ad-placement';

import { Asset } from 'expo-asset';
import { splitPostAttachments } from '../../../supabase/functions/_shared/post-links';
import { PostAttachmentLink } from '@/components/post-attachment-link';
import { useLocalSearchParams, usePathname } from 'expo-router';
import Head from 'expo-router/head';
import { Fragment, useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';

import { WebNightColors } from '@/constants/theme';
import { ControlMetrics } from '@/constants/design-system';
import { useLanguage } from '@/hooks/use-language';
import { useAuth } from '@/lib/auth';
import { chillingSchedule, recommendedAgeLabel } from '@/lib/chilling';
import { appendUniquePosts, loadPublicFeed, loadPublicPost, type FeedCursor } from '@/lib/feed-data';
import { CITIES, TAGS } from '@/lib/mock';
import { visibleMeetupBody } from '@/lib/meetup-ai';
import { splitPlaceMeetupBody } from '@/lib/meetup-destination';
import { placeMapRoute } from '@/lib/discovery';
import { googleMapsUrl, postMapBody } from '@/lib/post-maps';
import { hasAdLabel } from '@/lib/hashtags';
import { publicMerchantId, publicWebTarget } from '@/lib/public-web';
import { buildSharedPostUrl } from '@/lib/sharing';
import { publicWebClient } from '@/lib/public-web-client';
import { jsonLd, postSeo, publicCitySubpage, publicCitySubpageMeta, publicCompanyUrl, publicSiteName, PUBLIC_SITE } from '@/lib/public-seo';
import { adoptStatic } from './static-slot';
import { publicHomeSchema } from './metadata';
import { InteractionFeedbackProvider, useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadMerchantSource, merchantSourceActionLabel, trackPublicMerchantSourceClick, type MerchantSource } from '@/lib/merchant-source';
import type { Post } from '@/lib/types';

const wordmark = Asset.fromModule(require('../../../assets/brand/gling-night-wordmark.png')).uri;
const BRAND_CARD = `${PUBLIC_SITE}/share-covers/post.png`;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const palette = Object.fromEntries(Object.entries(WebNightColors).map(([key, value]) => [`--${key}`, value])) as CSSProperties;
const cities = CITIES.filter((city) => city.state === 'open');

function MerchantSourceAction({ postId }: { postId: string }) {
  const { play } = useInteractionFeedback(), { tr, language } = useLanguage(), ko = language === 'ko';
  const [result, setResult] = useState<{ id: string; source: MerchantSource } | null>(null);
  useEffect(() => {
    let active = true;
    void loadMerchantSource(publicWebClient, postId).then((source) => { if (active) setResult(source ? { id: postId, source } : null); });
    return () => { active = false; };
  }, [postId]);
  if (result?.id !== postId) return null;
  const label = tr(merchantSourceActionLabel(result.source.original_url));
  return <div className="reader-actions">{result.source.record_kind === 'source' && <span className="reader-kicker">{ko ? '매물·홍보 대리등록 안내' : 'Posted on the business’s behalf'}</span>}<a className="reader-secondary" href={result.source.original_url} target="_blank" rel="noopener noreferrer"
    aria-label={ko ? `${result.source.merchant_name} ${label}, 외부 페이지 열기` : `${result.source.merchant_name}: ${label}, opens an external page`}
    onClick={() => { play('selection'); void trackPublicMerchantSourceClick(postId); }}>{label} ↗</a></div>;
}

function MapAction({ url, label }: { url: string; label?: string }) {
  const { play } = useInteractionFeedback(), { t } = useLanguage();
  const target = googleMapsUrl(url);
  if (!target) return null;
  return <div className="reader-actions"><a data-analytics="components_post-map-link.pressable.1" className="reader-secondary"
    href={target} target="_blank" rel="noopener noreferrer" aria-label={`${label ? `${label} · ` : ''}${t.map.openLabel}`}
    onClick={() => play('selection')}>{label ? `${label} · ` : ''}{t.map.open} ↗</a></div>;
}

function PlaceSourceAction({ post }: { post: Post }) {
  const { play } = useInteractionFeedback(), { tr, language } = useLanguage();
  const place = post.room ? splitPlaceMeetupBody(post.body, post.cityId)?.place : null;
  if (!place) return null;
  const target = () => `gling://map?${new URLSearchParams(placeMapRoute(place).params)}`;
  const label = `${place.name} · ${tr(CITIES.find(city => city.id === place.cityId)?.name ?? '')} · ${language === 'en' ? 'View in app map' : '앱 지도에서 보기'}`;
  return <div className="reader-actions"><a data-analytics="components_post-map-link.pressable.1" className="reader-secondary" href={target()} aria-label={label} style={{ minHeight: ControlMetrics.action }}
    onClick={event => { play('selection'); event.currentTarget.href = target(); }}>{label}</a></div>;
}

function PostAuthor({ post }: { post: Post }) {
  const { play } = useInteractionFeedback();
  const { language } = useLanguage(), ko = language === 'ko';
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  return post.business ? <a className="reader-business-author" href={`/company/${post.business.id}`} onClick={() => play('selection')}
    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
    {post.business.avatarUri && failedLogo !== post.business.avatarUri ? <img src={post.business.avatarUri} alt="" width={32} height={32}
      style={{ borderRadius: '50%', objectFit: 'cover' }} onError={() => setFailedLogo(post.business!.avatarUri!)} /> :
      <span aria-hidden="true" style={{ width: 32, height: 32, borderRadius: '50%', display: 'inline-grid', placeItems: 'center', background: 'var(--backgroundElement)' }}>{post.business.name[0]}</span>}
    {post.business.name} · {ko ? '비즈니스' : 'Business'}</a> : <>{post.author.nickname}</>;
}

function AppInvitation({ target }: { target: string }) {
  const { language } = useLanguage(), ko = language === 'ko';
  const { play } = useInteractionFeedback(), device = useDevice(), phone = device === 'ios' || device === 'android';
  return <section className="reader-invitation" aria-label={ko ? '앱에서 이어가기' : 'Continue in the app'}>
    <h2>{ko ? '글링에서 함께해요.' : 'Meet people on Gling.'}</h2>
    <p>{ko ? `글을 쓰고, 모임에 참여하고, 대화를 이어가세요.${phone ? '' : ' 앱이 없다면 스토어를 선택하고 휴대폰으로 QR 코드를 읽어 주세요.'}` : `Write posts, join meetups and keep the conversation going.${phone ? '' : ' Choose a store and scan its QR code with your phone to get the app.'}`}</p>
    <AppStoreChoices />
    <a data-analytics="web_control_1" className="reader-secondary reader-open-app" href={target} onClick={() => play('selection')}>{ko ? '이미 앱이 있으면 앱에서 열기' : 'Already have the app? Open it'} ↗</a>
  </section>;
}

const INSTALL_BAR_CLOSED = 'gling.install-bar.closed';
function readInstallBarClosed() {
  try { return sessionStorage.getItem(INSTALL_BAR_CLOSED) === '1'; } catch { return false; }
}

/** Phones only (CSS): the sidebar invitation sits below the whole feed there. */
function InstallBar() {
  const { language } = useLanguage(), ko = language === 'ko';
  const { play } = useInteractionFeedback(), device = useDevice();
  const [closed, setClosed] = useState(readInstallBarClosed);
  if (!device || closed) return null;
  return <div className="reader-install-bar" role="region" aria-label={ko ? '글링 앱 설치' : 'Get the Gling app'}>
    <p>{ko ? '모임 참여와 대화는 앱에서 해요' : 'Join meetups and chat in the app'}</p>
    <InstallAction className="reader-primary" onPress={() => play('selection')} />
    <button data-analytics="web.install.close" type="button" aria-label={ko ? '앱 설치 안내 닫기' : 'Close app install bar'} onClick={() => {
      play('selection'); setClosed(true);
      try { sessionStorage.setItem(INSTALL_BAR_CLOSED, '1'); } catch { /* Closes for this page only. */ }
    }}>×</button>
  </div>;
}

function MeetupInfo({ post }: { post: Post }) {
  const { language } = useLanguage(), ko = language === 'ko';
  if (!post.room) return null;
  return <div className="reader-meetup">
    <strong>{ko ? post.room.closed ? '모집 마감' : post.room.eventKind === 'once' ? '일회성 모임' : '주기적 모임'
      : post.room.closed ? 'Closed' : post.room.eventKind === 'once' ? 'One-time meetup' : 'Recurring meetup'}</strong>
    <p>{chillingSchedule(post.room)}</p>
    <p>{recommendedAgeLabel(post.room)} · {ko ? <>{post.room.memberCount}명 참여{post.room.capacity ? ` / 정원 ${post.room.capacity}명` : ''}</>
      : `${post.room.memberCount} joined${post.room.capacity ? ` / ${post.room.capacity} max` : ''}`}</p>
    <small>{ko ? post.room.closed ? '모집이 마감된 모임이에요.' : '권장 연령은 참고 정보예요. 연령대와 관계없이 앱에서 참여를 신청할 수 있어요.'
      : post.room.closed ? 'This meetup is no longer taking requests.' : 'The age range is just a guide. Anyone can request to join in the app.'}</small>
  </div>;
}

function subscribeLocation(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

// Legacy path URLs are served the same static 404 document before hydration.
const staticReaderPath = (path: string) => /^\/(?:posts?|share)\//.test(path) ? '/+not-found' : path;

export default function PublicReader() {
  const routerPath = usePathname();
  const path = useSyncExternalStore(subscribeLocation, () => window.location.pathname, () => staticReaderPath(routerPath));
  return /^\/(?:posts?|share)(?:\/|$)/.test(path) ? <SharedPostLanding /> : <ReaderContent />;
}

function ReaderContent() {
  const { play } = useInteractionFeedback();
  const { isAuthed } = useAuth();
  const { language, tr } = useLanguage(), ko = language === 'ko';
  const params = useLocalSearchParams<{ id?: string; postId?: string; userId?: string; returnPostId?: string; requestId?: string; city?: string; tag?: string }>();
  const routerPath = usePathname();
  // Static hosts serve 404.html for old /post/:id links; retain the actual URL.
  const pathname = useSyncExternalStore(subscribeLocation, () => window.location.pathname, () => staticReaderPath(routerPath));
  const hydrated = useSyncExternalStore(subscribeLocation, () => true, () => false);
  const readyParams = hydrated ? params : {};
  const path = pathname.replace(/\/$/, '') || '/';
  const rawId = path === '/post' ? readyParams.id : path.match(/^\/post\/([^/]+)$/)?.[1];
  const postId = typeof rawId === 'string' && UUID.test(rawId) ? rawId : null;
  const detail = path === '/post' || path.startsWith('/post/');
  const company = path === '/company' || path.startsWith('/company/');
  const merchantId = publicMerchantId(path, readyParams.id);
  // /vancouver, /toronto, /montreal are the indexable city hubs; `/?city=` canonicalizes to them.
  const cityPage = cities.find((item) => path === `/${item.id}`);
  // /vancouver/2, /vancouver/rent, /vancouver/meetups are build-time pages; the reader keeps their static copy in place.
  const sub = publicCitySubpage(path, cities.map((item) => item.id));
  const subCity = sub ? cities.find((item) => item.id === sub.cityId) : undefined;
  const subMeta = sub && subCity ? publicCitySubpageMeta(sub, subCity.name) : null;
  const browse = path === '/' || path === '/meetups' || !!cityPage;
  const meetupPage = path === '/meetups';
  const city = cityPage ?? subCity ?? cities.find((item) => item.id === readyParams.city) ?? cities[0];
  const tag = TAGS.find((item) => item.slug === (path === '/meetups' ? 'meetup' : readyParams.tag));
  const key = `${path}:${postId}:${merchantId}:${city.id}:${tag?.id ?? ''}`;
  const [result, setResult] = useState<{ key: string; posts: Post[]; more: boolean; failed: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const current = result?.key === key ? result : null;
  const post = detail ? current?.posts[0] : undefined;
  const mappedPost = post ? postMapBody(post.body) : null;
  const metadata = post ? postSeo(post, tr(CITIES.find((item) => item.id === post.cityId)?.name ?? ''), language) : null;
  const filters = new URLSearchParams();
  if (!cityPage && cities.some((item) => item.id === readyParams.city)) filters.set('city', city.id);
  if (tag && !meetupPage) filters.set('tag', tag.slug);
  const cityHub = !!cityPage || (path === '/' && !tag && filters.has('city'));
  const canonical = subMeta ? `${PUBLIC_SITE}${path}` : metadata?.canonical ?? (cityHub ? `${PUBLIC_SITE}/${city.id}` : browse ? `${PUBLIC_SITE}${meetupPage ? '/meetups' : '/'}${filters.size ? `?${filters}` : ''}` : postId ? `${PUBLIC_SITE}/post?id=${postId}` : merchantId ? publicCompanyUrl(merchantId) : null);
  const pageTitle = subMeta?.title ?? metadata?.title ?? (cityHub ? ko ? `${city.name} 한인 커뮤니티 · 동네 이야기와 모임 | 글링` : `Korean community in ${city.englishName} | Gling`
    : meetupPage ? ko ? `${filters.has('city') ? `${city.name} 한인 모임` : '캐나다 한인 모임 · 밴쿠버·토론토·몬트리올'} | 글링` : `${filters.has('city') ? `Meetups in ${city.englishName}` : 'Korean meetups in Canada'} | Gling`
    : browse ? filters.size ? `${tr(city.name)} · ${tr(tag?.label ?? '동네 이야기')} | ${ko ? '글링' : 'Gling'}` : `${publicSiteName(language)}${ko ? ' · 밴쿠버·토론토·몬트리올' : ' · Vancouver, Toronto, Montreal'}`
    : detail ? ko ? '글링 공개 글' : 'Public post | Gling' : company ? ko ? '글링 비즈니스 프로필' : 'Business profile | Gling' : ko ? '글링 | 앱에서 이어가기' : 'Gling | Continue in the app');
  const description = subMeta?.description ?? metadata?.description ?? (ko ? '밴쿠버·토론토·몬트리올 한인 커뮤니티 글링에서 동네 이야기, 비즈니스와 모임을 둘러보세요. 로그인하면 공개 글의 전체 본문을 웹에서 읽을 수 있어요.'
    : 'Explore neighbourhood stories, businesses and meetups on Gling, the Korean community app for Vancouver, Toronto and Montreal. Sign in to read the full public post on the web.');
  // Static /post.html has no query parameters yet; let Google render before marking a missing post.
  const noindex = !sub && ((!browse && !detail && !company) || (detail && hydrated && (!postId || (current && !post))) || (company && hydrated && !merchantId));
  // City pages and their subpages carry CollectionPage/ItemList from the build; don't add a second, thinner graph.
  const schema = sub || cityPage ? null : path === '/' && !filters.size ? publicHomeSchema : metadata?.schema ?? (browse ? { '@context': 'https://schema.org', '@type': filters.size ? 'CollectionPage' : 'WebSite', name: publicSiteName(language), url: canonical, description, inLanguage: ko ? 'ko-KR' : 'en-CA' } : null);
  const loading = (browse || Boolean(postId)) && !current;
  const target = publicWebTarget(path, (company ? merchantId : postId) ?? undefined, readyParams);
  useReaderAnalytics(detail ? 'post' : browse || sub ? 'feed' : 'app-invitation', key, hydrated);

  useEffect(() => {
    // The build-time home/city copy (scripts/finish-public-web.mjs) is for crawlers without JavaScript; drop it once the live feed is in.
    if (current && !current.failed) globalThis.document?.getElementById?.('gling-static-home')?.remove();
  }, [current]);

  useEffect(() => {
    let active = true;
    if (!hydrated || (!browse && !postId)) return;
    const load = postId ? loadPublicPost(publicWebClient, postId).then((item) => item ? [item] : [])
      : loadPublicFeed(publicWebClient, city.id, tag?.id ?? null, null, null, { viewerScope: 'guest' });
    void load.then((posts) => {
      if (active) setResult({ key, posts, more: !postId && posts.length === 30, failed: false });
    }).catch(() => { if (active) setResult({ key, posts: [], more: false, failed: true }); });
    return () => { active = false; };
  }, [browse, city.id, hydrated, key, postId, retry, tag?.id]);

  async function more() {
    if (!current || busy) return;
    const last = current.posts.at(-1);
    if (!last?.createdAt) return;
    setBusy(true);
    const cursor: FeedCursor = { id: last.id, createdAt: last.createdAt, sortAt: last.sortAt };
    try {
      const posts = await loadPublicFeed(publicWebClient, city.id, tag?.id ?? null, null, cursor, { viewerScope: 'guest' });
      setResult((previous) => previous?.key === key ? { key, posts: appendUniquePosts(previous.posts, posts), more: posts.length === 30, failed: false } : previous);
    } catch { setResult((previous) => previous?.key === key ? { ...previous, failed: true } : previous); }
    finally { setBusy(false); }
  }

  async function share() {
    if (!postId) return;
    const url = buildSharedPostUrl(postId);
    try {
      if (navigator.share) await navigator.share({ title: post?.title, url });
      else { await navigator.clipboard.writeText(url); setShareMessage('링크를 복사했어요.'); }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) setShareMessage('주소창의 링크를 복사해 공유해 주세요.');
    }
  }

  return <div className="reader" style={palette} lang={language}>
    <Head><title>{detail && noindex ? ko ? '글을 찾을 수 없어요 | 글링' : 'Post unavailable | Gling' : pageTitle}</title>
      <meta name="description" content={description} />
      <meta name="robots" content={noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'} />
      {canonical && <link rel="canonical" href={canonical} />}
      {metadata && <link rel="alternate" type="text/markdown" href={metadata.source} />}
      <meta property="og:type" content={metadata ? 'article' : 'website'} />
      <meta property="og:site_name" content={publicSiteName(language)} /><meta property="og:locale" content={ko ? 'ko_KR' : 'en_CA'} /><meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={description} />
      {canonical && <meta property="og:url" content={canonical} />}
      <meta name="twitter:card" content={post?.imageUris?.some(Boolean) ? 'summary_large_image' : 'summary'} />
      <meta name="twitter:title" content={pageTitle} /><meta name="twitter:description" content={description} />
      {/* A photo-less post would otherwise scrape the cream wordmark onto a white link card. */}
      <meta property="og:image" content={post?.imageUris?.[0] ?? BRAND_CARD} />
      <meta property="og:image:alt" content={post?.imageUris?.[0] ? (ko ? `${post.title} 사진 1` : `${post.title}, photo 1`) : tr('글링')} />
      <meta name="twitter:image" content={post?.imageUris?.[0] ?? BRAND_CARD} />
      {metadata?.published && <meta property="article:published_time" content={metadata.published} />}
      {schema && <script type="application/ld+json">{jsonLd(schema)}</script>}
    </Head>
    <a data-analytics="web_control_4" className="reader-skip" href="#reader-main">{ko ? '본문으로 바로가기' : 'Skip to content'}</a>
    <header className="reader-header">
      <a data-analytics="web_control_5" className="reader-brand" href="/" aria-label={ko ? '글링 홈' : 'Gling home'}><img src={wordmark} alt="gling" width="144" height="60" /></a>
      <nav aria-label={ko ? '주요 메뉴' : 'Main navigation'}>
        <a href={`/${city.id}`} aria-current={browse && !meetupPage && !tag ? 'page' : undefined} onClick={() => play('selection')}>{ko ? '오늘' : 'Today'}</a>
        <a data-analytics="web_control_7" href={`/meetups?city=${city.id}`} aria-current={meetupPage ? 'page' : undefined} onClick={() => play('selection')}>{ko ? '모임' : 'Meetups'}</a>
        <a data-analytics="web_control_6" href={`/?city=${city.id}&tag=festival#stories`} aria-current={tag?.slug === 'festival' ? 'page' : undefined} onClick={() => play('selection')}>{ko ? '페스티벌' : 'Festivals'}</a>
        <a href="/visited" onClick={() => play('selection')}>Gling Visited</a>
      </nav>
      <a className="reader-header-account" href="/merchant/" rel="nofollow" onClick={() => play('selection')}>{isAuthed ? ko ? '비즈니스 관리' : 'Manage business' : ko ? '비즈니스 로그인' : 'Business sign-in'}</a>
    </header>
    <main id="reader-main" className={`reader-main${company ? ' reader-main-company' : ''}`} tabIndex={-1}>
      <div className="reader-content">
        {browse ? <>
          <div className="reader-intro"><p>{ko ? '밴쿠버·토론토·몬트리올 한인이 동네 정보를 묻고 모임을 찾는 무료 앱, 글링이에요.' : 'Gling is a free app where Koreans in Vancouver, Toronto and Montreal ask about their neighbourhood and find meetups.'}</p>
            <InstallAction className="reader-primary" onPress={() => play('selection')} /></div>
          <div className="reader-section-heading"><div><h1 id="stories">{meetupPage ? ko ? '모임' : 'Meetups' : cityHub ? ko ? `${city.name} 한인 커뮤니티` : `Korean community in ${city.englishName}` : path === '/' && !filters.size ? ko ? '캐나다 한인 커뮤니티 글링' : 'Gling, the Korean community in Canada' : ko ? '오늘' : 'Today'}</h1><p>{meetupPage ? ko ? '모임을 살펴보고 앱에서 함께해요.' : 'Explore a meetup, then join in the app.' : ko ? '이 도시에서 나누는 이야기' : 'Stories from your city'}</p></div><span>{tr(city.name)} · {tr(tag?.label ?? '전체 이야기')}</span></div>
          {cityPage && <div ref={adoptStatic('gling-static-city')} />}
          <form key={`${city.id}:${tag?.id ?? ''}`} className="reader-filters" action={meetupPage ? '/meetups' : '/'} method="get">
            <label>{ko ? '도시' : 'City'}<select name="city" defaultValue={city.id} onChange={() => play('selection')}>{cities.map((item) => <option value={item.id} key={item.id}>{tr(item.name)}</option>)}</select></label>
            {!meetupPage && <label>{ko ? '주제' : 'Topic'}<select name="tag" defaultValue={tag?.slug ?? ''} onChange={() => play('selection')}><option value="">{ko ? '전체 이야기' : 'All stories'}</option>{TAGS.map((item) => <option value={item.slug} key={item.id}>{tr(item.label)}</option>)}</select></label>}
            <button data-analytics="web_control_9" type="submit" onClick={() => play('selection')}>{ko ? '보기' : 'Show'}</button>
          </form>
          {hydrated && !meetupPage && tag?.slug === 'festival' && <InteractionFeedbackProvider><PublicFestivals cityId={city.id} cityName={tr(city.name)} /></InteractionFeedbackProvider>}
          {meetupPage ? <PublicMeetupList posts={current?.posts ?? []} cityName={tr(city.name)} loading={loading} failed={!!current?.failed} onRetry={() => setRetry(value => value + 1)} /> : <div aria-busy={loading}>
            {current && <InteractionFeedbackProvider>{current.posts.map((item, index) => { const mapped = postMapBody(item.body); const attached = splitPostAttachments(mapped.body); return <Fragment key={item.id}><article className="reader-card">
              <div><p className="reader-kicker">{hasAdLabel(item.hashtags) && <span aria-label={ko ? '광고' : 'Ad'}>AD · </span>}{tr(item.tag.label)}{item.room?.closed ? ko ? ' · 모집 마감' : ' · Closed' : ''}</p>
                <h3><a data-analytics="web_control_10" href={`/posts/${encodeURIComponent(item.id)}`}>{item.title}</a></h3>
                <p className="reader-excerpt">{item.room ? visibleMeetupBody(attached.body) : attached.body}</p>
                {attached.urls.map((url, index) => <PostAttachmentLink key={`${url}-${index}`} url={url} />)}
                {mapped.url && <MapAction url={mapped.url} label={mapped.label} />}
                <p className="reader-meta"><PostAuthor post={item} /> · {item.createdAtLabel}</p>
                {item.room && <p className="reader-meta">{chillingSchedule(item.room)} · {recommendedAgeLabel(item.room)}</p>}
              </div>
              {(item.imageThumbs?.[0] || item.imageUris?.[0]) && <img src={item.imageThumbs?.[0] || item.imageUris?.[0]} alt="" loading="lazy" className="reader-thumbnail" />}
            </article>{contentAdPosition(index, current.posts.length) && <FeedAd key={`ad-after-${item.id}`} />}</Fragment>; })}</InteractionFeedbackProvider>}
          </div>}
          {current?.more && <button data-analytics="web_control_11" className="reader-more" onClick={() => { play('selection'); void more(); }} disabled={busy}>{busy ? ko ? '불러오는 중…' : 'Loading…' : meetupPage ? ko ? '모임 더 보기' : 'More meetups' : ko ? '이야기 더 보기' : 'More stories'}</button>}
        </> : company ? <InteractionFeedbackProvider>{merchantId
          ? <PublicMerchantProfile key={merchantId} merchantId={merchantId} />
          : hydrated ? <div className="reader-notice"><h1>{ko ? '비즈니스 프로필을 찾을 수 없어요' : 'Business profile not found'}</h1><p>{ko ? '올바른 비즈니스 프로필 링크를 열어 주세요.' : 'Check the link and try again.'}</p></div>
            : <p role="status" className="reader-notice">{ko ? '비즈니스 프로필을 불러오고 있어요…' : 'Loading business profile…'}</p>}</InteractionFeedbackProvider> : detail ? <>
          <a data-analytics="web_control_12" className="reader-back" href="/">{ko ? '← 동네 이야기로' : '← Back to stories'}</a>
          {post && <InteractionFeedbackProvider><article className="reader-post"><p className="reader-kicker">{tr(CITIES.find((item) => item.id === post.cityId)?.name ?? '')} · {tr(post.tag.label)}</p>
            {!!post.hashtags?.length && <p className="reader-kicker" aria-label={ko ? '게시글 해시태그' : 'Post hashtags'}>{post.hashtags.map(tag => `#${tag}`).join(' · ')}</p>}
            <h1>{post.title}</h1><p className="reader-meta">{hasAdLabel(post.hashtags) && <span aria-label={ko ? '광고' : 'Ad'}>AD · </span>}<PostAuthor post={post} /> · <time dateTime={metadata?.published}>{post.createdAtLabel}</time></p>
            <PublicMerchantProfileLink postId={post.id} />
            {post.imageUris?.map((uri, index) => uri && <img className="reader-photo" key={uri} src={uri} alt={ko ? `${post.title} 사진 ${index + 1}` : `${post.title}, photo ${index + 1}`} loading="lazy" />)}
            <PublicPostBody body={post.room ? visibleMeetupBody(mappedPost!.body) : mappedPost!.body} /><MeetupInfo post={post} />
            <PlaceSourceAction post={post} />
            {mappedPost?.url && <MapAction url={mappedPost.url} label={mappedPost.label} />}
            <MerchantSourceAction postId={post.id} />
            <div className="reader-actions"><a data-analytics="web_control_13" className="reader-primary" href={target}>{ko ? post.room ? post.room.closed ? '앱에서 모임 보기' : '앱에서 모임 보기 · 참여하기' : '앱에서 대화하기'
              : post.room ? post.room.closed ? 'View the meetup in the app' : 'View and join in the app' : 'Chat in the app'} ↗</a><button data-analytics="web_control_14" onClick={() => void share()}>{ko ? '링크 공유' : 'Share link'}</button></div>
            <p role="status">{tr(shareMessage)}</p>
            {!!post.commentList?.length && <section className="reader-comments"><h2>{ko ? '공개 댓글' : 'Public comments'}</h2>{post.commentList.map((comment) => <article key={comment.id}><strong>{comment.nickname}</strong><p>{comment.body}</p></article>)}<a data-analytics="web_control_15" href={target}>{ko ? '앱에서 댓글 남기기 ↗' : 'Comment in the app ↗'}</a></section>}
          </article></InteractionFeedbackProvider>}
        </> : sub ? <div ref={adoptStatic('gling-static-hub')} /> : <section className="reader-hero"><h1>{ko ? '앱에서 이어가세요.' : 'Continue in the app.'}</h1><p>{ko ? '웹에서는 공개 이야기와 모임을 둘러볼 수 있어요. 작성·참여·대화와 내 정보 관리는 앱에서 이용해 주세요.' : 'You can browse public stories and meetups on the web. To post, join, chat or manage your account, use the app.'}</p><a data-analytics="web_control_16" href="/">{ko ? '공개 이야기 둘러보기 →' : 'Browse public stories →'}</a></section>}
        {!meetupPage && loading && <p role="status" className="reader-notice">{ko ? '이야기를 불러오고 있어요…' : 'Loading stories…'}</p>}
        {!meetupPage && current?.failed && <div role="alert" className="reader-notice"><p>{ko ? '이야기를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' : 'Couldn’t load stories. Try again in a moment.'}</p><button data-analytics="web_control_17" onClick={() => setRetry((value) => value + 1)}>{ko ? '다시 시도' : 'Try again'}</button></div>}
        {!meetupPage && !loading && !current?.failed && (browse || detail) && !current?.posts.length && <div className="reader-notice">{detail ? <h1>{ko ? '글을 찾을 수 없어요' : 'Post not found'}</h1> : <h2>{ko ? '아직 공개된 이야기가 없어요' : 'No public stories yet'}</h2>}<p>{ko ? detail ? '삭제되었거나 공개되지 않은 글이에요.' : tag?.slug === 'festival' ? '위에서 Ticketmaster의 예정 페스티벌을 확인하거나, 다른 공개 이야기도 둘러보세요.' : '다른 도시나 주제의 이야기도 둘러보세요.'
          : detail ? 'This post was deleted or isn’t public.' : tag?.slug === 'festival' ? 'Check upcoming festivals from Ticketmaster above, or browse other public stories.' : 'Try another city or topic.'}</p>{browse && tag?.slug === 'festival' && <a className="reader-secondary" href="/#stories">{ko ? '전체 이야기 보기' : 'See all stories'}</a>}</div>}
      </div>
      <aside id="app"><AppInvitation target={target} /></aside>
    </main>
    <InstallBar />
    <footer className="reader-footer"><span>{ko ? 'gling · 같이 갈 사람, 같이 나눌 이야기' : 'gling · People to go with, stories to share'}</span><nav aria-label={ko ? '정책' : 'Policies'}><a href="/business" onClick={() => play('selection')}>{ko ? '비즈니스 등록·관리' : 'List or manage your business'}</a><a data-analytics="web_control_18" href="/terms">{ko ? '이용약관' : 'Terms'}</a><a data-analytics="web_control_19" href="/privacy">{ko ? '개인정보처리방침' : 'Privacy'}</a><a data-analytics="web_control_20" href="/account-deletion">{ko ? '계정 삭제' : 'Delete account'}</a></nav></footer>
  </div>;
}
