import './reader.css';
import { PublicFestivals } from './festivals';
import { useReaderAnalytics } from './analytics';

import { Asset } from 'expo-asset';
import { splitPostLinks } from '../../../supabase/functions/_shared/post-links';
import { useLocalSearchParams, usePathname } from 'expo-router';
import Head from 'expo-router/head';
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';

import { WebNightColors } from '@/constants/theme';
import { chillingSchedule, recommendedAgeLabel } from '@/lib/chilling';
import { appendUniquePosts, loadPublicFeed, loadPublicPost, type FeedCursor } from '@/lib/feed-data';
import { CITIES, TAGS } from '@/lib/mock';
import { visibleMeetupBody } from '@/lib/meetup-ai';
import { googleMapsUrl, postMapBody } from '@/lib/post-maps';
import { t } from '@/i18n/ko';
import { publicWebTarget } from '@/lib/public-web';
import { publicWebClient } from '@/lib/public-web-client';
import { jsonLd, postSeo, PUBLIC_SITE } from '@/lib/public-seo';
import { InteractionFeedbackProvider, useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadMerchantSource, trackPublicMerchantSourceClick, type MerchantSource } from '@/lib/merchant-source';
import type { Post } from '@/lib/types';

const wordmark = Asset.fromModule(require('../../../assets/brand/gling-night-wordmark.png')).uri;
const showcaseArt = Asset.fromModule(require('../../../assets/images/festival-glass-orbs.webp')).uri;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const palette = Object.fromEntries(Object.entries(WebNightColors).map(([key, value]) => [`--${key}`, value])) as CSSProperties;
const cities = CITIES.filter((city) => city.state === 'open');

function MerchantSourceAction({ postId }: { postId: string }) {
  const { play } = useInteractionFeedback();
  const [result, setResult] = useState<{ id: string; source: MerchantSource } | null>(null);
  useEffect(() => {
    let active = true;
    void loadMerchantSource(publicWebClient, postId).then((source) => { if (active) setResult(source ? { id: postId, source } : null); });
    return () => { active = false; };
  }, [postId]);
  if (result?.id !== postId) return null;
  return <div className="reader-actions"><a className="reader-secondary" href={result.source.original_url} target="_blank" rel="noopener noreferrer"
    aria-label={`${result.source.merchant_name} 계정으로 가기, 외부 페이지 열기`}
    onClick={() => { play('selection'); void trackPublicMerchantSourceClick(postId); }}>업체 계정으로 가기 ↗</a></div>;
}

function MapAction({ url }: { url: string }) {
  const { play } = useInteractionFeedback();
  const target = googleMapsUrl(url);
  if (!target) return null;
  return <div className="reader-actions"><a data-analytics="components_post-map-link.pressable.1" className="reader-secondary"
    href={target} target="_blank" rel="noopener noreferrer" aria-label={t.map.openLabel}
    onClick={() => play('selection')}>{t.map.open} ↗</a></div>;
}

function BodyLinks({ body }: { body: string }) {
  const { play } = useInteractionFeedback();
  return <p className="reader-body">{splitPostLinks(body).map((part, index) => part.url
    ? <a key={index} href={part.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" onClick={() => play('selection')}>{part.text}</a>
    : part.text)}</p>;
}

function AppInvitation({ target, label = '앱에서 대화하기' }: { target: string; label?: string }) {
  return <section className="reader-invitation" aria-label="앱에서 이어가기">
    <h2>마음에 드는 이야기를<br />찾았다면, 이제 앱에서.</h2>
    <p>글을 쓰고, 모임에 참여하고, 대화를 이어가세요.</p>
    <a data-analytics="web_control_1" className="reader-primary" href={target}>{label} ↗</a>
    <details><summary data-analytics="web_control_2">아직 앱이 없나요?</summary>
      <p>iPhone에서는 App Store에서 글링을 받을 수 있어요. Android는 출시 준비 중이에요. 설치 후 이 글의 링크를 다시 열면 같은 글에서 시작할 수 있어요.</p>
      <a data-analytics="web_control_3" href="https://apps.apple.com/ca/app/id6809273242">iPhone용 글링 받기 ↗</a>
    </details>
  </section>;
}

function MeetupInfo({ post }: { post: Post }) {
  if (!post.room) return null;
  return <div className="reader-meetup">
    <strong>{post.room.closed ? '모집 마감' : post.room.eventKind === 'once' ? '일회성 모임' : '주기적 모임'}</strong>
    <p>{chillingSchedule(post.room)}</p>
    <p>{recommendedAgeLabel(post.room)} · {post.room.memberCount}명 참여{post.room.capacity ? ` / 정원 ${post.room.capacity}명` : ''}</p>
    <small>{post.room.closed ? '모집이 마감된 모임이에요.' : '권장 연령은 참고 정보예요. 연령대와 관계없이 앱에서 참여를 신청할 수 있어요.'}</small>
  </div>;
}

function subscribeLocation(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

export default function PublicReader() {
  const params = useLocalSearchParams<{ id?: string; city?: string; tag?: string }>();
  const routerPath = usePathname();
  // Static hosts serve 404.html for old /post/:id links; retain the actual URL.
  const pathname = useSyncExternalStore(subscribeLocation, () => window.location.pathname, () => routerPath);
  const hydrated = useSyncExternalStore(subscribeLocation, () => true, () => false);
  const readyParams = hydrated ? params : {};
  const path = pathname.replace(/\/$/, '') || '/';
  const rawId = path === '/post' ? readyParams.id : path.match(/^\/post\/([^/]+)$/)?.[1];
  const postId = typeof rawId === 'string' && UUID.test(rawId) ? rawId : null;
  const detail = path === '/post' || path.startsWith('/post/');
  const browse = path === '/' || path === '/meetups';
  const city = cities.find((item) => item.id === readyParams.city) ?? cities[0];
  const tag = TAGS.find((item) => item.slug === (path === '/meetups' ? 'meetup' : readyParams.tag));
  const key = `${path}:${postId}:${city.id}:${tag?.id ?? ''}`;
  const [result, setResult] = useState<{ key: string; posts: Post[]; more: boolean; failed: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const current = result?.key === key ? result : null;
  const post = detail ? current?.posts[0] : undefined;
  const mappedPost = post ? postMapBody(post.body) : null;
  const metadata = post ? postSeo(post, CITIES.find((item) => item.id === post.cityId)?.name) : null;
  const filters = new URLSearchParams();
  if (cities.some((item) => item.id === readyParams.city)) filters.set('city', city.id);
  if (tag) filters.set('tag', tag.slug);
  const canonical = metadata?.canonical ?? (browse ? `${PUBLIC_SITE}/${filters.size ? `?${filters}` : ''}` : postId ? `${PUBLIC_SITE}/post?id=${postId}` : null);
  const pageTitle = metadata?.title ?? (browse ? `${filters.size ? `${city.name} · ${tag?.label ?? '동네 이야기'} | ` : ''}글링 | 캐나다 한인 커뮤니티` : detail ? '글링 공개 글' : '글링 | 앱에서 이어가기');
  const description = metadata?.description ?? `${browse && filters.size ? `${city.name}의 ` : '캐나다 한인 커뮤니티 글링에서 '}동네 이야기, 맛집, 비즈니스와 모임을 둘러보세요. 공개 글은 로그인 없이 읽고, 참여와 대화는 앱에서 이어갈 수 있어요.`;
  // Static /post.html has no query parameters yet; let Google render before marking a missing post.
  const noindex = (!browse && !detail) || (detail && hydrated && (!postId || (current && !post)));
  const schema = metadata?.schema ?? (browse ? { '@context': 'https://schema.org', '@type': filters.size ? 'CollectionPage' : 'WebSite', name: '글링', url: canonical, description, inLanguage: 'ko' } : null);
  const loading = (browse || Boolean(postId)) && !current;
  const target = publicWebTarget(path, postId ?? undefined);
  useReaderAnalytics(detail ? 'post' : browse ? 'feed' : 'app-invitation', key, hydrated);

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
    const url = `${window.location.origin}/post?id=${encodeURIComponent(postId)}`;
    try {
      if (navigator.share) await navigator.share({ title: post?.title, url });
      else { await navigator.clipboard.writeText(url); setShareMessage('링크를 복사했어요.'); }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) setShareMessage('주소창의 링크를 복사해 공유해 주세요.');
    }
  }

  return <div className="reader" style={palette} lang="ko">
    <Head><title>{detail && noindex ? '글을 찾을 수 없어요 | 글링' : pageTitle}</title>
      <meta name="description" content={description} />
      <meta name="robots" content={noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'} />
      {canonical && <link rel="canonical" href={canonical} />}
      {metadata && <link rel="alternate" type="text/markdown" href={metadata.source} />}
      <meta property="og:type" content={metadata ? 'article' : 'website'} />
      <meta property="og:site_name" content="글링" /><meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={description} />
      {canonical && <meta property="og:url" content={canonical} />}
      <meta name="twitter:card" content={post?.imageUris?.length ? 'summary_large_image' : 'summary'} />
      <meta name="twitter:title" content={pageTitle} /><meta name="twitter:description" content={description} />
      {post?.imageUris?.[0] && <><meta property="og:image" content={post.imageUris[0]} /><meta property="og:image:alt" content={`${post.title} 사진 1`} /><meta name="twitter:image" content={post.imageUris[0]} /></>}
      {metadata?.published && <meta property="article:published_time" content={metadata.published} />}
      {schema && <script type="application/ld+json">{jsonLd(schema)}</script>}
    </Head>
    <a data-analytics="web_control_4" className="reader-skip" href="#reader-main">본문으로 바로가기</a>
    <header className="reader-header">
      <a data-analytics="web_control_5" href="/" aria-label="글링 홈"><img src={wordmark} alt="gling" width="96" /></a>
      <nav aria-label="주요 메뉴"><a data-analytics="web_control_6" href="/?tag=festival#stories">페스티벌</a><a data-analytics="web_control_7" href="/?tag=meetup#stories">모임</a><a href="/#stories">오늘의 이야기</a><a data-analytics="web_control_8" className="reader-header-app" href="#app">앱에서 시작 ↗</a></nav>
    </header>
    <main id="reader-main" className="reader-main" tabIndex={-1}>
      {browse && <section className="reader-showcase" aria-labelledby="reader-showcase-title">
        <div className="reader-showcase-copy">
          <h1 id="reader-showcase-title">큰 페스티벌부터<br />동네 한잔까지.</h1>
          <p>함께 갈 사람을 찾고, 오늘의 이야기를 나눠요. 공개 게시판은 로그인 없이 둘러볼 수 있어요.</p>
          <div className="reader-showcase-actions">
            <a data-analytics="web_control_21" className="reader-primary" href="/#stories">오늘의 이야기 보기 <span aria-hidden="true">↗</span></a>
            <a data-analytics="web_control_22" className="reader-secondary" href="/?tag=meetup#stories">모임 둘러보기 <span aria-hidden="true">↗</span></a>
          </div>
        </div>
        <div className="reader-showcase-scene" aria-hidden="true"><img src={showcaseArt} alt="" width="768" height="512" fetchPriority="high" /></div>
      </section>}
      <div className="reader-content">
        {browse ? <>
          <div className="reader-section-heading"><div><h2 id="stories">오늘의 이야기</h2><p>페스티벌 후기부터 동네의 작은 질문까지.</p></div><span>{city.name} · {tag?.label ?? '전체 이야기'}</span></div>
          <form key={`${city.id}:${tag?.id ?? ''}`} className="reader-filters" action="/" method="get">
            <label>도시<select name="city" defaultValue={city.id}>{cities.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
            <label>주제<select name="tag" defaultValue={tag?.slug ?? ''}><option value="">전체 이야기</option>{TAGS.map((item) => <option value={item.slug} key={item.id}>{item.label}</option>)}</select></label>
            <button data-analytics="web_control_9" type="submit">보기</button>
          </form>
          {hydrated && <InteractionFeedbackProvider><PublicFestivals cityId={city.id} cityName={city.name} /></InteractionFeedbackProvider>}
          <div aria-busy={loading}>
            {current && <InteractionFeedbackProvider>{current.posts.map((item) => { const mapped = postMapBody(item.body); return <article className="reader-card" key={item.id}>
              <div><p className="reader-kicker">{item.tag.label}{item.room?.closed ? ' · 모집 마감' : ''}</p>
                <h3><a data-analytics="web_control_10" href={`/post?id=${encodeURIComponent(item.id)}`}>{item.title}</a></h3>
                <p className="reader-excerpt">{item.room ? visibleMeetupBody(mapped.body) : mapped.body}</p>
                {mapped.url && <MapAction url={mapped.url} />}
                <p className="reader-meta">{item.author.nickname} · {item.createdAtLabel}</p>
                {item.room && <p className="reader-meta">{chillingSchedule(item.room)} · {recommendedAgeLabel(item.room)}</p>}
              </div>
              {(item.imageThumbs?.[0] ?? item.imageUris?.[0]) && <img src={item.imageThumbs?.[0] ?? item.imageUris?.[0]} alt="" loading="lazy" className="reader-thumbnail" />}
            </article>; })}</InteractionFeedbackProvider>}
          </div>
          {current?.more && <button data-analytics="web_control_11" className="reader-more" onClick={() => void more()} disabled={busy}>{busy ? '불러오는 중…' : '이야기 더 보기'}</button>}
        </> : detail ? <>
          <a data-analytics="web_control_12" className="reader-back" href="/">← 동네 이야기로</a>
          {post && <InteractionFeedbackProvider><article className="reader-post"><p className="reader-kicker">{CITIES.find((item) => item.id === post.cityId)?.name} · {post.tag.label}</p>
            <h1>{post.title}</h1><p className="reader-meta">{post.author.nickname} · <time dateTime={metadata?.published}>{post.createdAtLabel}</time></p>
            {post.imageUris?.map((uri, index) => <img className="reader-photo" key={uri} src={uri} alt={`${post.title} 사진 ${index + 1}`} loading="lazy" />)}
            <BodyLinks body={post.room ? visibleMeetupBody(mappedPost!.body) : mappedPost!.body} /><MeetupInfo post={post} />
            {mappedPost?.url && <MapAction url={mappedPost.url} />}
            <MerchantSourceAction postId={post.id} />
            <div className="reader-actions"><a data-analytics="web_control_13" className="reader-primary" href={target}>{post.room ? post.room.closed ? '앱에서 모임 보기' : '앱에서 모임 보기 · 참여하기' : '앱에서 대화하기'} ↗</a><button data-analytics="web_control_14" onClick={() => void share()}>링크 공유</button></div>
            <p role="status">{shareMessage}</p>
            {!!post.commentList?.length && <section className="reader-comments"><h2>공개 댓글</h2>{post.commentList.map((comment) => <article key={comment.id}><strong>{comment.nickname}</strong><p>{comment.body}</p></article>)}<a data-analytics="web_control_15" href={target}>앱에서 댓글 남기기 ↗</a></section>}
          </article></InteractionFeedbackProvider>}
        </> : <section className="reader-hero"><h1>앱에서 이어가세요.</h1><p>웹에서는 공개 이야기와 모임을 둘러볼 수 있어요. 작성·참여·대화와 내 정보 관리는 앱에서 이용해 주세요.</p><a data-analytics="web_control_16" href="/">공개 이야기 둘러보기 →</a></section>}
        {loading && <p role="status" className="reader-notice">이야기를 불러오고 있어요…</p>}
        {current?.failed && <div role="alert" className="reader-notice"><p>이야기를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p><button data-analytics="web_control_17" onClick={() => setRetry((value) => value + 1)}>다시 시도</button></div>}
        {!loading && !current?.failed && (browse || detail) && !current?.posts.length && <div className="reader-notice">{detail ? <h1>글을 찾을 수 없어요</h1> : <h2>아직 공개된 이야기가 없어요</h2>}<p>{detail ? '삭제되었거나 공개되지 않은 글이에요.' : tag?.slug === 'festival' ? '위에서 Ticketmaster의 예정 페스티벌을 확인하거나, 다른 공개 이야기도 둘러보세요.' : '다른 도시나 주제의 이야기도 둘러보세요.'}</p>{browse && tag?.slug === 'festival' && <a className="reader-secondary" href="/#stories">전체 이야기 보기</a>}</div>}
      </div>
      <aside id="app"><AppInvitation target={target} label={post?.room ? post.room.closed ? '앱에서 모임 보기' : '앱에서 참여하기' : undefined} /></aside>
    </main>
    <footer className="reader-footer"><span>gling · 같이 갈 사람, 같이 나눌 이야기</span><nav aria-label="정책"><a data-analytics="web_control_18" href="/terms">이용약관</a><a data-analytics="web_control_19" href="/privacy">개인정보처리방침</a><a data-analytics="web_control_20" href="/account-deletion">계정 삭제</a></nav></footer>
  </div>;
}
