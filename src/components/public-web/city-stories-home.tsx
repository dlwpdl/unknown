import './city-stories-home.css';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { hasAdLabel } from '@/lib/hashtags';
import type { Post } from '@/lib/types';
import credits from './city-stories-credits.json';

const ASSETS = '/city-stories/';
const visuals: Record<string, { latin: string; primary: string; secondary: string; place: string; neighborhood: string; line: string }> = {
  vancouver: { latin: 'Vancouver', primary: 'coal-harbour', secondary: 'gastown', place: 'Coal Harbour', neighborhood: 'Gastown', line: '바다와 산 사이, 우리 동네의 이야기.' },
  toronto: { latin: 'Toronto', primary: 'cn-tower', secondary: 'kensington', place: 'CN Tower', neighborhood: 'Kensington Market', line: '각자의 속도가 만나는 도시의 이야기.' },
  montreal: { latin: 'Montréal', primary: 'palais', secondary: 'old-montreal', place: 'Palais des congrès', neighborhood: 'Old Montréal', line: '다른 언어, 같은 동네에서 시작하는 이야기.' },
};
type City = { id: string; name: string };
type Tag = { slug: string; label: string };
type Props = {
  city: City; cities: readonly City[]; tags: readonly Tag[]; tag?: Tag;
  posts: Post[]; loading: boolean; failed: boolean; more: boolean; busy: boolean; isAuthed?: boolean;
  onMore: () => void; onRetry: () => void;
  renderAuthor?: (post: Post) => ReactNode; renderExtras?: (post: Post) => ReactNode; renderAd?: (index: number, total: number) => ReactNode;
  excerpt?: (post: Post) => string;
};
type Motion = { setPaused: (value: boolean) => void; dispose: () => void };
type MotionWindow = Window & { createGlingCityStoriesMotion?: (root: HTMLElement) => Motion };
let motionScripts: Promise<void> | undefined;
function loadMotion() {
  return motionScripts ??= (async () => {
    for (const file of ['gsap.min.js', 'ScrollTrigger.min.js', 'lenis.min.js', 'motion.js']) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = ASSETS + file; script.onload = () => resolve(); script.onerror = () => reject(new Error('Motion unavailable'));
        document.head.appendChild(script);
      });
    }
  })();
}
export function filterCityStories(posts: Post[], query: string) {
  const value = query.trim().normalize('NFKC').toLocaleLowerCase();
  return value ? posts.filter(post => `${post.title} ${post.body} ${post.tag.label}`.normalize('NFKC').toLocaleLowerCase().includes(value)) : posts;
}
function Arrow() { return <span className="arrow" aria-hidden="true">↗</span>; }
function Bookmark() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4z" /></svg>; }

export default function CityStoriesHome({ city, cities, tags, tag, posts, loading, failed, more, busy, isAuthed, onMore, onRetry, renderAuthor, renderExtras, renderAd, excerpt }: Props) {
  const { play } = useInteractionFeedback();
  const [query, setQuery] = useState(''), [paused, setPaused] = useState(false), [motionReady, setMotionReady] = useState(false);
  const root = useRef<HTMLDivElement>(null), menu = useRef<HTMLDialogElement>(null), motion = useRef<Motion | null>(null), menuButton = useRef<HTMLButtonElement>(null);
  const visual = visuals[city.id], latin = visual?.latin ?? city.id.replaceAll('-', ' ');
  const stories = filterCityStories(posts, query);
  const url = (path = '/', topic?: string) => `${path}?city=${encodeURIComponent(city.id)}${topic ? `&tag=${encodeURIComponent(topic)}` : ''}`;
  useEffect(() => {
    let active = true;
    void loadMotion().then(() => {
      if (!active || !root.current) return;
      motion.current = (window as MotionWindow).createGlingCityStoriesMotion?.(root.current) ?? null;
      setMotionReady(!!motion.current);
    }).catch(() => { /* The complete static layout and native links remain usable. */ });
    return () => { active = false; motion.current?.dispose(); motion.current = null; };
  }, []);
  function closeMenu() { menu.current?.close(); menuButton.current?.focus(); }
  const photo = (key: string, eager = false) => <img src={`${ASSETS}${key}.webp`} alt={credits.find(item => item.key === key)?.placeName ?? ''} width={1200} height={800} decoding="async" loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : undefined} />;
  return <div className="city-home-frame" ref={root} onClick={event => { const target = (event.target as Element).closest('a,button,summary'); if (target && !target.closest('.city-story-extras,.reader-business-author,.city-feed-ad')) play('selection'); }}>
    <a className="skip" href="#stories">본문으로 바로가기</a>
    <header className="site-header"><div className="wrap header-inner">
      <a className="logo" href="/" aria-label="글링 처음으로"><img src={`${ASSETS}logo.svg`} alt="gling" width={114} height={37} /></a>
      <nav className="main-nav" aria-label="주 메뉴"><a href={url()} aria-current="page">오늘</a><a href={url('/meetups')}>모임</a><a href={url('/', 'festival')}>페스티벌</a><a href={url('/visited')}>Gling Visited</a></nav>
      <div className="header-actions"><a className="outline arrow-link" href="/merchant/">{isAuthed ? '내 계정' : '로그인'} <Arrow /></a><button className="menu-toggle js-only" ref={menuButton} aria-haspopup="dialog" aria-controls="city-menu" onClick={() => menu.current?.showModal()}>메뉴</button></div>
    </div></header>
    <main>
      <section className="hero wrap" aria-labelledby="city-hero-heading"><div className="hero-topline"><span><i className="signal" aria-hidden="true" />같이 갈 사람, 같이 나눌 이야기</span><span>캐나다 로컬 커뮤니티</span></div>
        <div className="hero-grid"><div className="hero-copy"><h1 id="city-hero-heading">이 도시가<br />조금 더<br /><em>가까워지는 곳.</em></h1><p>동네의 작은 발견부터, 같이할 사람까지.<br />우리의 오늘이 모이는 글링.</p><div className="hero-links"><a className="pill arrow-link" href="#stories">동네 이야기 보기 <span className="arrow" aria-hidden="true">↘</span></a><a className="text-link arrow-link" href={url('/meetups')}><span>같이할 사람 찾기</span><Arrow /></a></div></div>
          <div className="wall" aria-label={`${city.name}의 풍경과 동네 이야기`}>
            <div className="photo-main"><div className="float-layer" data-float="0"><a className="wall-photo" href={url('/visited')}>{visual ? photo(visual.primary, true) : <div className="city-placeholder">{latin}</div>}<span className="photo-caption"><span><i className="signal" aria-hidden="true" />{visual?.place ?? city.name}, {latin}</span><strong>익숙한 길에서 만나는 새로운 하루</strong></span></a></div></div>
            <div className="photo-small"><div className="float-layer" data-float="1"><a className="wall-photo" href={url('/meetups')}>{visual ? photo(visual.secondary) : <div className="city-placeholder">함께.</div>}<span className="photo-caption"><span>동네에서, 함께</span><strong>{visual?.neighborhood ?? city.name}</strong></span></a></div></div>
            <div className="wall-note"><div className="float-layer" data-float="2"><a className="note-body" href={url('/meetups')}><strong>같이 갈 사람,<br />같이 나눌 이야기.</strong><small>산책도, 커피도. 동네에서 함께.</small></a></div></div>
            <div className="wall-place"><div className="float-layer" data-float="3"><div className="place-body"><i className="signal" aria-hidden="true" />{latin}, Canada</div></div></div>
          </div>
        </div>
        <div className="city-strip"><nav className="city-picker" aria-label="도시 선택">{cities.map(item => <a key={item.id} href={`/?city=${encodeURIComponent(item.id)}${tag ? `&tag=${encodeURIComponent(tag.slug)}` : ''}`} aria-current={city.id === item.id ? 'true' : undefined}>{item.name}</a>)}</nav><span className="label">당신의 도시는 어디인가요? <span aria-hidden="true">↙</span></span></div>
        <div className="city-word-box"><span className="city-word" aria-hidden="true">{latin}</span></div><div className="hero-bottom"><span>{visual?.line ?? '우리 동네에서, 새로운 이야기를 시작해요.'}</span>{motionReady && <button className="motion-toggle" aria-pressed={paused} onClick={() => { motion.current?.setPaused(!paused); setPaused(!paused); }}>{paused ? '배경 움직임 재생' : '배경 움직임 멈추기'}</button>}</div>
      </section>
      <section className="board wrap" id="stories" aria-labelledby="city-stories-heading"><div className="section-head"><div><h2 id="city-stories-heading">{city.name}의 오늘{tag ? ` · ${tag.label}` : ''}</h2><p>소소한 질문도, 새로운 약속도. 여기서부터.</p></div><label className="search-box"><span aria-hidden="true">⌕</span><span className="sr-only">불러온 글에서 검색</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="불러온 글에서 검색" /></label></div>
        <div className="board-tools"><nav className="topic-tabs" aria-label="이야기 주제"><a href={`${url()}#stories`} aria-current={!tag ? 'true' : undefined}>전체</a>{tags.filter(item => ['life', 'meetup', 'business'].includes(item.slug)).map(item => <a key={item.slug} href={`${url('/', item.slug)}#stories`} aria-current={tag?.slug === item.slug ? 'true' : undefined}>{item.label}</a>)}<a href="gling://profile/saved">저장한 글 <Arrow /></a></nav>
          <form action="/#stories" className="city-topic-form"><input type="hidden" name="city" value={city.id} /><label><span className="sr-only">모든 주제</span><select name="tag" onChange={() => play('selection')} defaultValue={tag?.slug ?? ''}><option value="">모든 주제</option>{tags.map(item => <option value={item.slug} key={item.slug}>{item.label}</option>)}</select></label><button type="submit">보기</button></form>
        </div>
        {loading && <p className="empty" role="status">이야기를 불러오고 있어요…</p>}
        {failed && <div className="empty" role="alert"><p>이야기를 불러오지 못했어요.</p><button className="outline" onClick={onRetry}>다시 시도</button></div>}
        <div className="story-grid" aria-busy={loading}>{stories.map((post, index) => {
          const image = post.imageThumbs?.[0] || post.imageUris?.[0];
          const layout = index === 0 ? 'featured' : index === 1 && !image ? 'question' : index === 2 ? 'compact' : 'wide-row';
          return <Fragment key={post.id}><article className={`story-card ${layout}${!image && layout === 'wide-row' ? ' text-only' : ''}`}>
            {image ? <a className="story-cover" href={`/posts/${encodeURIComponent(post.id)}`} tabIndex={-1} aria-hidden="true"><img src={image} alt="" loading="lazy" width={800} height={500} /></a> : layout === 'wide-row' ? <div className="text-tile" aria-hidden="true">{post.tag.label.slice(0, 2)}.</div> : null}
            <div className="story-content"><span className="story-tag">{hasAdLabel(post.hashtags) ? 'AD · ' : ''}{post.tag.label}{post.room?.closed ? ' · 모집 마감' : ''}</span>{layout === 'question' && <div className="quote-mark" aria-hidden="true">“</div>}<h3><a className="story-open" href={`/posts/${encodeURIComponent(post.id)}`}>{post.title}</a></h3><p className="city-excerpt">{excerpt?.(post) ?? post.body}</p>
              {renderExtras?.(post)}<div className="story-meta"><span>{renderAuthor?.(post) ?? post.author.nickname} · {post.createdAtLabel}</span><a className="save" href={`gling://post/${post.id}`} aria-label={`${post.title} 앱에서 열어 저장`}>{<Bookmark />}</a></div>
            </div></article>{renderAd?.(index, stories.length)}</Fragment>;
        })}</div>
        {!loading && !failed && !stories.length && <p className="empty" role="status">{query ? '검색어에 맞는 글이 없어요. 다른 검색어로 찾아보세요.' : '아직 공개된 이야기가 없어요. 다른 도시나 주제도 둘러보세요.'}</p>}
        {more && <div className="board-end"><button className="outline arrow-link" disabled={busy} onClick={onMore}>{busy ? '불러오는 중…' : '이야기 더 보기'} <span aria-hidden="true">↓</span></button></div>}
      </section>
      <section className="nearby wrap" aria-labelledby="city-nearby-heading"><div className="nearby-photo">{visual ? photo(visual.secondary) : <div className="city-placeholder">{latin}</div>}<span className="nearby-caption"><i className="signal" aria-hidden="true" />{visual?.neighborhood ?? city.name}, {latin}</span></div><div className="nearby-copy"><h2 id="city-nearby-heading">좋은 장소 다음엔,<br />같이 갈 사람이니까.</h2><p>혼자 저장해 둔 곳에 약속이 생기는 순간.<br />동네의 이야기를, 함께하는 하루로 이어가세요.</p><div className="nearby-links"><a className="arrow-link" href={url('/meetups')}><span>같이할 모임 찾기<small>우리 동네의 모임과 약속</small></span><Arrow /></a><a className="arrow-link" href={url('/visited')}><span>Gling Visited 둘러보기<small>도시의 장소와 방문 이야기</small></span><Arrow /></a></div></div></section>
      <section className="faq wrap" aria-labelledby="city-faq-heading"><div><h2 id="city-faq-heading">처음 오셨나요?</h2><p className="soft" style={{ marginTop: 16, fontSize: 14 }}>글링, 여기서부터 시작해요.</p></div><div><details><summary>글링은 어떤 곳인가요?</summary><p>글링은 캐나다의 도시별 이야기와 모임을 나누는 커뮤니티예요. 동네에서 궁금한 일, 함께 가고 싶은 곳, 비즈니스 소식을 만날 수 있어요.</p></details><details><summary>웹에서도 이야기를 볼 수 있나요?</summary><p>공개 글의 짧은 소개와 대표 사진은 웹에서 둘러볼 수 있어요. 로그인하면 현재 공개 상태와 열람 권한을 확인한 뒤 전체 글을 읽을 수 있어요. 글쓰기, 모임 참여와 대화는 앱에서 이어가세요.</p></details><details><summary>앱은 어디에서 받나요?</summary><p>iPhone은 <a href="https://apps.apple.com/ca/app/id6809273242">App Store에서 글링</a>을 확인해 주세요. Android는 비공개 테스트 중이며, 테스트 참여 대상만 설치할 수 있어요.</p></details><a className="text-link arrow-link" href="/faq"><span>자주 묻는 질문 더 보기</span><Arrow /></a></div></section>
    </main>
    <footer className="site-footer"><div className="wrap"><div className="footer-top"><h2>이 도시에서,<br />우리의 이야기를 시작해요.</h2><a className="outline arrow-link" href="https://apps.apple.com/ca/app/id6809273242">App Store에서 글링 보기 <Arrow /></a></div><img className="footer-wordmark" src={`${ASSETS}logo-dark.svg`} alt="gling" width={720} height={230} /><div className="footer-bottom"><span>Gling · 캐나다 로컬 커뮤니티</span><div><a href="/merchant/">비즈니스 관리</a><a href="/terms">이용약관</a><a href="/privacy">개인정보처리방침</a><a href="/account-deletion">계정 삭제</a></div></div><details className="credits"><summary>도시 사진 출처</summary>{credits.map(photo => <p key={photo.key}>{photo.placeName} · {photo.artist} · <a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer">사진 원문 ↗</a> · <a href={photo.licenseUrl} target="_blank" rel="noopener noreferrer">{photo.license}</a>. 크기 조정 및 화면 비율에 따른 크롭. 도시 풍경 사진은 개별 게시글이나 모임의 방문 인증을 뜻하지 않아요.</p>)}</details></div></footer>
    <dialog className="city-menu" id="city-menu" ref={menu} aria-label="글링 메뉴" data-lenis-prevent onCancel={event => { event.preventDefault(); closeMenu(); }} onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const stops = [...event.currentTarget.querySelectorAll<HTMLElement>('button,a[href]')], first = stops[0], last = stops.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}><div className="dialog-top"><span>글링 메뉴</span><button className="close-dialog" aria-label="메뉴 닫기" onClick={closeMenu}>×</button></div><nav className="menu-panel"><a href="#stories" onClick={closeMenu}>오늘의 이야기 ↘</a><a href={url('/meetups')}>모임 ↗</a><a href={url('/', 'festival')}>페스티벌 ↗</a><a href={url('/visited')}>Gling Visited ↗</a></nav></dialog>
  </div>;
}
