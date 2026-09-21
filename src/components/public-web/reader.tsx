import './reader.css';
import { useReaderAnalytics } from './analytics';

import { Asset } from 'expo-asset';
import { useLocalSearchParams, usePathname } from 'expo-router';
import Head from 'expo-router/head';
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';

import { Colors } from '@/constants/theme';
import { chillingSchedule, recommendedAgeLabel } from '@/lib/chilling';
import { appendUniquePosts, loadPublicFeed, loadPublicPost, type FeedCursor } from '@/lib/feed-data';
import { CITIES, TAGS } from '@/lib/mock';
import { publicWebTarget } from '@/lib/public-web';
import { publicWebClient } from '@/lib/public-web-client';
import type { Post } from '@/lib/types';

const wordmark = Asset.fromModule(require('../../../assets/brand/gling-wordmark.png')).uri;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const palette = Object.fromEntries(Object.entries(Colors.light).map(([key, value]) => [`--${key}`, value])) as CSSProperties;
const cities = CITIES.filter((city) => city.state === 'open');

function AppInvitation({ target, label = '앱에서 대화하기' }: { target: string; label?: string }) {
  return <section className="reader-invitation" aria-label="앱에서 이어가기">
    <h2>둘러보기는 여기서,<br />함께하는 건 앱에서.</h2>
    <p>글 작성, 모임 참여와 모든 대화는 글링 앱에서 시작해요.</p>
    <a data-analytics="web_control_1" className="reader-primary" href={target}>{label} ↗</a>
    <details><summary data-analytics="web_control_2">아직 앱이 없나요?</summary>
      <p>iOS · Android 출시 준비 중이에요. 앱을 이미 설치했다면 위 버튼으로 이어가세요. 설치 후 이 글의 링크를 다시 열면 같은 글에서 시작할 수 있어요.</p>
      <a data-analytics="web_control_3" href="mailto:gling@ej-entertainment.com?subject=글링%20출시%20문의">출시 소식 문의하기</a>
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
  const path = pathname.replace(/\/$/, '') || '/';
  const rawId = path === '/post' ? params.id : path.match(/^\/post\/([^/]+)$/)?.[1];
  const postId = typeof rawId === 'string' && UUID.test(rawId) ? rawId : null;
  const detail = path === '/post' || path.startsWith('/post/');
  const browse = path === '/' || path === '/meetups';
  const city = cities.find((item) => item.id === params.city) ?? cities[0];
  const tag = TAGS.find((item) => item.slug === (path === '/meetups' ? 'meetup' : params.tag));
  const key = `${path}:${postId}:${city.id}:${tag?.id ?? ''}`;
  const [result, setResult] = useState<{ key: string; posts: Post[]; more: boolean; failed: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const current = result?.key === key ? result : null;
  const post = detail ? current?.posts[0] : undefined;
  const loading = (browse || Boolean(postId)) && !current;
  const target = publicWebTarget(path, postId ?? undefined);
  useReaderAnalytics(detail ? 'post' : browse ? 'feed' : 'app-invitation', key);

  useEffect(() => {
    let active = true;
    if (!browse && !postId) return;
    const load = postId ? loadPublicPost(publicWebClient, postId).then((item) => item ? [item] : [])
      : loadPublicFeed(publicWebClient, city.id, tag?.id ?? null, null, null, { viewerScope: 'guest' });
    void load.then((posts) => {
      if (active) setResult({ key, posts, more: !postId && posts.length === 30, failed: false });
    }).catch(() => { if (active) setResult({ key, posts: [], more: false, failed: true }); });
    return () => { active = false; };
  }, [browse, city.id, key, postId, retry, tag?.id]);

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
    <Head><title>{post ? `${post.title} | 글링` : '글링 | 우리 동네의 오늘'}</title>
      <meta name="description" content="우리 동네의 공개 이야기와 모임을 둘러보세요. 참여와 대화는 글링 앱에서 이어집니다." />
    </Head>
    <a data-analytics="web_control_4" className="reader-skip" href="#reader-main">본문으로 바로가기</a>
    <header className="reader-header">
      <a data-analytics="web_control_5" href="/" aria-label="글링 홈"><img src={wordmark} alt="gling" width="96" /></a>
      <nav aria-label="주요 메뉴"><a data-analytics="web_control_6" href="/">동네 이야기</a><a data-analytics="web_control_7" href="/?tag=meetup">모임</a><a data-analytics="web_control_8" href="#app">앱에서 시작 ↗</a></nav>
    </header>
    <main id="reader-main" className="reader-main" tabIndex={-1}>
      <div className="reader-content">
        {browse ? <>
          <header className="reader-hero"><p className="reader-kicker">우리 동네, 글링</p><h1>동네의 이야기를 읽고,<br />새로운 만남을 발견해요.</h1><p>이야기와 모임은 여기서 둘러보고, 참여와 대화는 앱에서 이어가세요.</p></header>
          <form className="reader-filters" action="/" method="get">
            <label>도시<select name="city" defaultValue={city.id}>{cities.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
            <label>주제<select name="tag" defaultValue={tag?.slug ?? ''}><option value="">전체 이야기</option>{TAGS.map((item) => <option value={item.slug} key={item.id}>{item.label}</option>)}</select></label>
            <button data-analytics="web_control_9" type="submit">보기</button>
          </form>
          <h2 className="reader-list-title">{city.name} · {tag?.label ?? '전체 이야기'}</h2>
          <div aria-busy={loading}>
            {current?.posts.map((item) => <article className="reader-card" key={item.id}>
              <div><p className="reader-kicker">{item.tag.label}{item.room?.closed ? ' · 모집 마감' : ''}</p>
                <h3><a data-analytics="web_control_10" href={`/post?id=${encodeURIComponent(item.id)}`}>{item.title}</a></h3>
                <p className="reader-excerpt">{item.body}</p>
                <p className="reader-meta">{item.author.nickname} · {item.createdAtLabel}</p>
                {item.room && <p className="reader-meta">{chillingSchedule(item.room)} · {recommendedAgeLabel(item.room)}</p>}
              </div>
              {item.imageUris?.[0] && <img src={item.imageUris[0]} alt="" loading="lazy" className="reader-thumbnail" />}
            </article>)}
          </div>
          {current?.more && <button data-analytics="web_control_11" className="reader-more" onClick={() => void more()} disabled={busy}>{busy ? '불러오는 중…' : '이야기 더 보기'}</button>}
        </> : detail ? <>
          <a data-analytics="web_control_12" className="reader-back" href="/">← 동네 이야기로</a>
          {post && <article className="reader-post"><p className="reader-kicker">{CITIES.find((item) => item.id === post.cityId)?.name} · {post.tag.label}</p>
            <h1>{post.title}</h1><p className="reader-meta">{post.author.nickname} · {post.createdAtLabel}</p>
            {post.imageUris?.map((uri, index) => <img className="reader-photo" key={uri} src={uri} alt={`${post.title} 사진 ${index + 1}`} loading="lazy" />)}
            <p className="reader-body">{post.body}</p><MeetupInfo post={post} />
            <div className="reader-actions"><a data-analytics="web_control_13" className="reader-primary" href={target}>{post.room ? post.room.closed ? '앱에서 모임 보기' : '앱에서 모임 보기 · 참여하기' : '앱에서 대화하기'} ↗</a><button data-analytics="web_control_14" onClick={() => void share()}>링크 공유</button></div>
            <p role="status">{shareMessage}</p>
            {!!post.commentList?.length && <section className="reader-comments"><h2>공개 댓글</h2>{post.commentList.map((comment) => <article key={comment.id}><strong>{comment.nickname}</strong><p>{comment.body}</p></article>)}<a data-analytics="web_control_15" href={target}>앱에서 댓글 남기기 ↗</a></section>}
          </article>}
        </> : <section className="reader-hero"><h1>앱에서 이어가세요.</h1><p>웹에서는 공개 이야기와 모임을 둘러볼 수 있어요. 작성·참여·대화와 내 정보 관리는 앱에서 이용해 주세요.</p><a data-analytics="web_control_16" href="/">공개 이야기 둘러보기 →</a></section>}
        {loading && <p role="status" className="reader-notice">이야기를 불러오고 있어요…</p>}
        {current?.failed && <div role="alert" className="reader-notice"><p>이야기를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p><button data-analytics="web_control_17" onClick={() => setRetry((value) => value + 1)}>다시 시도</button></div>}
        {!loading && !current?.failed && (browse || detail) && !current?.posts.length && <div className="reader-notice">{detail ? <h1>글을 찾을 수 없어요</h1> : <h2>아직 공개된 이야기가 없어요</h2>}<p>{detail ? '삭제되었거나 공개되지 않은 글이에요.' : '다른 도시나 주제의 이야기도 둘러보세요.'}</p></div>}
      </div>
      <aside id="app"><AppInvitation target={target} label={post?.room ? post.room.closed ? '앱에서 모임 보기' : '앱에서 참여하기' : undefined} /></aside>
    </main>
    <footer className="reader-footer"><span>gling · 우리 동네의 오늘</span><nav aria-label="정책"><a data-analytics="web_control_18" href="/terms">이용약관</a><a data-analytics="web_control_19" href="/privacy">개인정보처리방침</a><a data-analytics="web_control_20" href="/account-deletion">계정 삭제</a></nav></footer>
  </div>;
}
