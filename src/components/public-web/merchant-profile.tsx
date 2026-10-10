import './merchant-profile.css';

import type { SupabaseClient } from '@supabase/supabase-js';
import Head from 'expo-router/head';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { merchantMapsUrl, merchantPhoneUrl } from '@/lib/merchant-source';
import { loadMerchantProfile, loadMerchantProfilePosts, type MerchantProfile, type MerchantProfilePostKind, type MerchantProfilePostPage } from '@/lib/merchant-profile';
import type { MerchantReviewPage, MerchantReviewReply } from '@/lib/merchant-reviews';
import { PUBLIC_SITE } from '@/lib/public-seo';
import { publicMerchantId, publicWebTarget } from '@/lib/public-web';
import { publicWebClient } from '@/lib/public-web-client';

type ReviewKind = 'usage' | 'employment';
type ProfileTab = 'posts' | 'jobs' | 'reviews' | 'about';
type ReviewCounts = { key: string; usage: number | null; employment: number | null };
type PostCounts = { merchantId: string; postCount: number | null; jobCount: number | null };
type PublicReview = { id: string; nickname: string; score: number; body: string | null; created_at: string; receipt_status: 'verified'; review_kind: ReviewKind; reply?: MerchantReviewReply | null };
type PublicReviewPage = {
  merchantId: string; merchantName: string; reviewKind: ReviewKind; ratingAverage: number | null; reviewCount: number;
  reviews: PublicReview[]; nextOffset: number; hasMore: boolean;
};

export async function loadPublicMerchantReviews(client: SupabaseClient, postId: string, offset = 0, kind: ReviewKind = 'usage'): Promise<PublicReviewPage | null> {
  const result = await client.rpc('get_merchant_reviews', kind === 'usage' ? { p_post_id: postId, p_offset: offset }
    : { p_post_id: postId, p_offset: offset, p_review_kind: kind });
  if (result.error) throw new Error(result.error.message);
  const page = result.data as (MerchantReviewPage & { review_kind?: ReviewKind }) | null;
  if (!page) return null;
  const merchantId = publicMerchantId('/company', page.merchant_id);
  if (!merchantId || (page.review_kind !== kind && !(kind === 'usage' && page.review_kind === undefined))) throw new Error('MERCHANT_REVIEWS_READ_FAILED');
  const rows = (Array.isArray(page.reviews) ? page.reviews : []) as (MerchantReviewPage['reviews'][number] & { review_kind?: ReviewKind })[];
  const reviews = rows.filter((row) => row.receipt_status === 'verified' && (row.review_kind === kind || (kind === 'usage' && row.review_kind === undefined)) && Number.isFinite(row.score)
    && row.score >= 1 && row.score <= 10 && Number.isInteger(row.score * 2)).map((row): PublicReview => {
      const reply = kind === 'usage' && row.reply && typeof row.reply.body === 'string' && row.reply.body.trim() && row.reply.body.length <= 300
        && Number.isFinite(Date.parse(row.reply.created_at)) && Number.isFinite(Date.parse(row.reply.updated_at))
        ? { body: row.reply.body, created_at: row.reply.created_at, updated_at: row.reply.updated_at } : null;
      return { id: row.id, nickname: row.nickname, score: row.score, body: row.body, created_at: row.created_at, receipt_status: 'verified', review_kind: kind, reply };
    });
  return { merchantId, merchantName: page.merchant_name, reviewKind: kind, ratingAverage: page.rating_average, reviewCount: page.review_count,
    reviews, nextOffset: offset + rows.length, hasMore: page.has_more === true && rows.length > 0 };
}

function RatingVisual({ kind, scoreTenths, animated = false }: { kind: ReviewKind; scoreTenths: number | null; animated?: boolean }) {
  const shape = kind === 'usage' ? <svg viewBox="0 0 30 32" aria-hidden="true" focusable="false" fill="currentColor"><path d="M15 1 19 11 29 16 19 21 15 31 11 21 1 16 11 11Z" /></svg>
    : <span className="reader-company-rating-segment" />;
  return <span className={`reader-company-rating-visual${animated ? ' playing' : ''}`} data-review-kind={kind} aria-hidden="true">
    {Array.from({ length: 10 }, (_, index) => {
      const portion = scoreTenths == null ? 0 : Math.max(0, Math.min(100, (scoreTenths - index * 10) * 10));
      const color = [239, 229, 255].map((channel, i) => Math.round(channel + ([169, 33, 255][i] - channel) * index / 9));
      return <span className="reader-company-rating-unit" data-portion={portion} key={index}>{shape}
        <span className="reader-company-rating-fill" style={{ '--portion': `${portion}%`, '--unit-delay': `${index * 22}ms`, color: `rgb(${color.join(',')})` } as CSSProperties}>{shape}</span></span>;
    })}
  </span>;
}

function Rating({ page, kind = 'usage', animated = false, compact = false }: { page: Pick<PublicReviewPage, 'ratingAverage' | 'reviewCount'>; kind?: ReviewKind; animated?: boolean; compact?: boolean }) {
  const scoreTenths = page.ratingAverage == null ? null : Math.round(page.ratingAverage * 10);
  if (compact) return <span className="reader-company-rating-compact"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.3">{kind === 'usage'
    ? <path d="M8 1 10 6 15 8 10 10 8 15 6 10 1 8 6 6Z" fill="currentColor" stroke="none" />
    : <><rect x="1" y="4" width="14" height="11" rx="2" /><path d="M5 4V2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M1 8h14" /></>}</svg>
    <strong>{scoreTenths == null ? '—' : (scoreTenths / 10).toFixed(1)}</strong></span>;
  return <span className="reader-company-rating"><span className="reader-company-rating-number"><strong>{scoreTenths == null ? '—' : (scoreTenths / 10).toFixed(1)}</strong><span>/ 10</span></span>
    <RatingVisual key={`${kind}:${scoreTenths}`} kind={kind} scoreTenths={scoreTenths} animated={animated} />
    <span>인증 {kind === 'usage' ? '이용' : '근무'} 리뷰 {page.reviewCount}개</span></span>;
}

function ProfileRatings({ merchantId, postId, selectedKind, onSelect, onRead, controls = 'company-reviews' }: {
  merchantId: string; postId: string; selectedKind: ReviewKind | null; onSelect: (kind: ReviewKind) => void; onRead?: (counts: ReviewCounts) => void; controls?: string;
}) {
  const { play } = useInteractionFeedback();
  const key = `${merchantId}:${postId}`;
  const [result, setResult] = useState<{ key: string; usage: PublicReviewPage | null; employment: PublicReviewPage | null } | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.allSettled([loadPublicMerchantReviews(publicWebClient, postId), loadPublicMerchantReviews(publicWebClient, postId, 0, 'employment')]).then(([usage, employment]) => {
      const ownPage = (row: PromiseSettledResult<PublicReviewPage | null>) => row.status === 'fulfilled' && row.value?.merchantId === merchantId ? row.value : null;
      if (active) {
        const result = { key, usage: ownPage(usage), employment: ownPage(employment) };
        setResult(result);
        onRead?.({ key, usage: result.usage?.reviewCount ?? null, employment: result.employment?.reviewCount ?? null });
      }
    });
    return () => { active = false; };
  }, [key, merchantId, postId, onRead]);
  const current = result?.key === key ? result : null;
  return <div className="reader-company-metrics" role="group" aria-label="인증 리뷰 평점" aria-busy={!current}>
    {(['usage', 'employment'] as const).map((kind) => {
      const page = current?.[kind];
      const label = `${kind === 'usage' ? '상품·서비스' : '근무'} 리뷰 보기, ${!current ? '불러오는 중' : !page ? '조회 실패' : page.ratingAverage == null ? '점수 없음' : `10점 만점에 평균 ${(Math.round(page.ratingAverage * 10) / 10).toFixed(1)}점, 인증 후기 ${page.reviewCount}개`}`;
      return <button type="button" className="reader-company-metric" key={kind} data-review-kind={kind} aria-label={label} title={label}
        aria-pressed={selectedKind === kind} aria-controls={controls} onClick={() => { play('selection'); onSelect(kind); }}>
        {page ? <Rating page={page} kind={kind} compact /> : <span className="reader-company-metric-unavailable">{current ? '—' : '…'}</span>}
      </button>;
    })}
  </div>;
}

export function PublicMerchantProfileLink({ postId }: { postId: string }) {
  const { play } = useInteractionFeedback();
  const [result, setResult] = useState<{ postId: string; page: PublicReviewPage } | null>(null);
  useEffect(() => {
    let active = true;
    void loadPublicMerchantReviews(publicWebClient, postId).then((page) => {
      if (active) setResult(page ? { postId, page } : null);
    }).catch(() => { if (active) setResult(null); });
    return () => { active = false; };
  }, [postId]);
  if (result?.postId !== postId) return null;
  return <a className="reader-company-link" href={`/company?id=${result.page.merchantId}`} onClick={() => play('selection')}
    aria-label={`${result.page.merchantName} 업체 프로필과 인증 이용 리뷰 보기`}>
    <span><strong>{result.page.merchantName}</strong><Rating page={result.page} /></span><span aria-hidden="true">↗</span>
  </a>;
}

function PublicReviews({ merchantId, postId, kind = 'usage' }: { merchantId: string; postId: string; kind?: ReviewKind }) {
  const { play } = useInteractionFeedback();
  const key = `${merchantId}:${postId}:${kind}`;
  const [result, setResult] = useState<{ key: string; page: PublicReviewPage | null; failed: boolean } | null>(null);
  const [busy, setBusy] = useState(true);
  const [retry, setRetry] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const request = useRef({ active: false, reading: false });
  const current = result?.key === key ? result : null;
  const page = current?.page ?? null;
  const loading = busy || !current;
  const label = kind === 'usage' ? '이용' : '근무';
  useEffect(() => {
    const operation = { active: true, reading: false };
    request.current = operation;
    void loadPublicMerchantReviews(publicWebClient, postId, 0, kind).then((next) => {
      if (!operation.active) return;
      if (!next || next.merchantId !== merchantId || next.reviewKind !== kind) throw new Error('MERCHANT_REVIEWS_READ_FAILED');
      setResult({ key, page: next, failed: false });
    }).catch(() => { if (operation.active) setResult((previous) => ({ key, page: previous?.key === key ? previous.page : null, failed: true })); })
      .finally(() => { if (operation.active) setBusy(false); });
    return () => { operation.active = false; };
  }, [key, kind, merchantId, postId, retry]);

  async function more() {
    const operation = request.current;
    if (!page || !page.hasMore || operation.reading || loading) return;
    operation.reading = true; setBusy(true); play('selection');
    try {
      const next = await loadPublicMerchantReviews(publicWebClient, postId, page.nextOffset, kind);
      if (!operation.active) return;
      if (!next || next.merchantId !== merchantId || next.reviewKind !== kind) throw new Error('MERCHANT_REVIEWS_READ_FAILED');
      setResult((previous) => previous?.key === key && previous.page ? { key, failed: false, page: { ...next, reviews: [...previous.page.reviews,
        ...next.reviews.filter((row) => !previous.page!.reviews.some((existing) => existing.id === row.id))] } } : previous);
      play('success');
    } catch {
      if (operation.active) { setResult((previous) => previous?.key === key ? { ...previous, failed: true } : previous); play('warning'); }
    } finally {
      operation.reading = false;
      if (operation.active) setBusy(false);
    }
  }

  return <section id={`company-reviews-${kind}`} className="reader-company-reviews" data-review-kind={kind} aria-labelledby={`company-reviews-title-${kind}`} aria-busy={loading}>
    <div className="reader-company-section-heading"><div><h2 id={`company-reviews-title-${kind}`}>{kind === 'usage' ? '상품·서비스 이용 리뷰' : '근무 리뷰'}</h2>
      <p>{kind === 'usage' ? '영수증 인증을 마친 이용 리뷰예요.' : '사람이 근무 증빙을 확인한 공개 리뷰예요.'} 10점 척도로 표시해요.</p></div>{page && <Rating page={page} kind={kind} animated />}</div>
    {loading && <p role="status">인증 {label} 리뷰를 불러오고 있어요…</p>}
    {current?.failed && <div role="alert" className="reader-company-error"><p>{label} 리뷰를 불러오지 못했어요.</p>
      <button disabled={loading} onClick={() => { play('selection'); setBusy(true); setRetry((value) => value + 1); }}>다시 시도</button></div>}
    {page?.reviews.map((review) => {
      const open = openId === review.id;
      const date = new Date(review.created_at);
      return <article className="reader-company-review" key={review.id}>
        <button className="reader-company-review-toggle" aria-expanded={open} aria-controls={`review-${kind}-${review.id}`}
          aria-label={`${review.nickname}의 ${review.score.toFixed(1)}점 인증 ${label} 리뷰 ${open ? '접기' : '전체 보기'}`}
          onClick={() => { play('selection'); setOpenId(open ? null : review.id); }}>
          <span className="reader-company-review-heading"><strong>{review.nickname}</strong><span className="reader-company-verified">{kind === 'usage' ? '영수증 인증' : '근무 인증'}</span>
            <span className="reader-company-review-score">{review.score.toFixed(1)} <small>/ 10</small></span></span>
          <RatingVisual kind={kind} scoreTenths={review.score * 10} />
          {!open && <span className="reader-company-review-preview">{review.body || `점수만 남긴 ${label} 리뷰예요.`}</span>}
          <span className="reader-company-review-meta"><time dateTime={review.created_at}>{Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ko-KR')}</time>
            <span>{open ? '접기 ↑' : '전체 보기 ↓'}</span></span>
        </button>
        {open && <div id={`review-${kind}-${review.id}`} className="reader-company-review-detail"><p>{review.body || `점수만 남긴 ${label} 리뷰예요.`}</p>
          {review.reply && <aside className="reader-company-reply"><strong>업체 답변</strong><p>{review.reply.body}</p></aside>}
        </div>}
      </article>;
    })}
    {!loading && !current?.failed && page && !page.reviewCount && <p className="reader-company-empty">아직 공개된 인증 {label} 리뷰가 없어요.</p>}
    {page?.hasMore && <button className="reader-more" disabled={loading} onClick={() => void more()}>인증 {label} 리뷰 더 보기</button>}
  </section>;
}

function PublicProfilePosts({ merchantId, kind, onRead, onPosts }: {
  merchantId: string; kind: MerchantProfilePostKind; onRead?: (counts: PostCounts) => void; onPosts?: () => void;
}) {
  const { play } = useInteractionFeedback();
  const key = `${merchantId}:${kind}`;
  const [result, setResult] = useState<{ key: string; page: MerchantProfilePostPage | null; failed: boolean; failedOffset: number } | null>(null);
  const [busy, setBusy] = useState(true);
  const [retry, setRetry] = useState(0);
  const request = useRef({ active: false, reading: false });
  const current = result?.key === key ? result : null;
  const page = current?.page ?? null;
  const loading = busy || !current;
  const label = kind === 'posts' ? '게시글' : '채용';
  useEffect(() => {
    const operation = { active: true, reading: false };
    request.current = operation;
    void loadMerchantProfilePosts(publicWebClient, merchantId, kind, 0, 'public').then((next) => {
      if (!operation.active) return;
      if (next && (next.merchant_id !== merchantId || next.kind !== kind)) throw new Error('MERCHANT_POSTS_READ_FAILED');
      setResult({ key, page: next, failed: false, failedOffset: 0 });
      onRead?.({ merchantId, postCount: next?.post_count ?? null, jobCount: next?.job_count ?? null });
    }).catch(() => {
      if (operation.active) setResult((previous) => ({ key, page: previous?.key === key ? previous.page : null, failed: true, failedOffset: 0 }));
    }).finally(() => { if (operation.active) setBusy(false); });
    return () => { operation.active = false; };
  }, [key, kind, merchantId, onRead, retry]);

  async function more() {
    const operation = request.current;
    if (!page?.has_more || operation.reading || loading) return;
    operation.reading = true; setBusy(true); play('selection');
    const offset = page.nextOffset;
    try {
      const next = await loadMerchantProfilePosts(publicWebClient, merchantId, kind, offset, 'public');
      if (!operation.active) return;
      if (next && (next.merchant_id !== merchantId || next.kind !== kind)) throw new Error('MERCHANT_POSTS_READ_FAILED');
      setResult((previous) => previous?.key === key ? { key, failed: false, failedOffset: 0, page: next && previous.page ? { ...next,
        posts: [...previous.page.posts, ...next.posts.filter((row) => !previous.page!.posts.some((existing) => existing.id === row.id))] } : next } : previous);
      onRead?.({ merchantId, postCount: next?.post_count ?? null, jobCount: next?.job_count ?? null });
      play('success');
    } catch {
      if (operation.active) { setResult((previous) => previous?.key === key ? { ...previous, failed: true, failedOffset: offset } : previous); play('warning'); }
    } finally { operation.reading = false; if (operation.active) setBusy(false); }
  }

  return <div className="reader-company-posts" data-post-kind={kind} aria-busy={loading}>
    <div className="reader-company-panel-heading"><h2>{kind === 'posts' ? '업체 게시글' : '진행 중인 채용'}</h2>
      {page && <span>{kind === 'posts' ? page.post_count : page.job_count}개</span>}</div>
    {loading && <p role="status">{label}을 불러오고 있어요…</p>}
    {current?.failed && <div className="reader-company-error" role="alert"><p>{label}을 불러오지 못했어요.</p>
      <button disabled={loading} onClick={() => {
        if (current.failedOffset > 0) void more();
        else { play('selection'); setBusy(true); setRetry((value) => value + 1); }
      }}>다시 시도</button></div>}
    {page?.posts.map((post) => {
      const thumbnail = post.imageThumbs?.[0] ?? post.imageUris?.[0];
      return <article className="reader-company-post" key={post.id}><a href={`/post?id=${post.id}`} onClick={() => play('selection')}>
        <span className="reader-company-post-text"><span className="reader-company-post-meta">{post.tag.label} · {post.createdAtLabel}</span>
          <strong>{post.title}</strong><span className="reader-company-post-preview">{post.body}</span></span>
        {thumbnail ? <img className="reader-company-post-cover" src={thumbnail} alt="" loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} />
          : <span className="reader-company-post-arrow" aria-hidden="true">›</span>}</a></article>;
    })}
    {!loading && !current?.failed && !page && <p className="reader-company-empty">현재 공개된 업체 글을 확인할 수 없어요.</p>}
    {!loading && !current?.failed && page && !page.posts.length && <div className="reader-company-empty"><h3>{kind === 'jobs' ? '진행 중인 채용이 없어요' : '아직 공개된 게시글이 없어요'}</h3>
      <p>{kind === 'jobs' ? '새로운 모집 글이 등록되면 여기에 표시돼요.' : '업체에 연결된 공개 글이 등록되면 여기에 표시돼요.'}</p>
      {kind === 'jobs' && onPosts && <button onClick={() => { play('selection'); onPosts(); }}>게시글 보기</button>}</div>}
    {page?.has_more && <button className="reader-more" disabled={loading} onClick={() => void more()}>{label} 더 보기</button>}
  </div>;
}

function ProfilePage({ merchantId }: { merchantId: string }) {
  const { play } = useInteractionFeedback();
  const [result, setResult] = useState<{ key: string; profile: MerchantProfile | null; failed: boolean; attempt: number } | null>(null);
  const [retry, setRetry] = useState(0);
  const [broken, setBroken] = useState({ banner: false, avatar: false });
  const [reviewKind, setReviewKind] = useState<ReviewKind>('usage');
  const [tab, setTab] = useState<ProfileTab>('posts');
  const [postCounts, setPostCounts] = useState<PostCounts | null>(null);
  const [reviewCounts, setReviewCounts] = useState<ReviewCounts | null>(null);
  function selectKind(kind: ReviewKind) {
    setReviewKind(kind);
    setTab('reviews');
  }
  useEffect(() => {
    let active = true;
    void loadMerchantProfile(publicWebClient, merchantId).then((profile) => {
      if (active) { setResult({ key: merchantId, profile, failed: false, attempt: retry }); setBroken({ banner: false, avatar: false }); }
    }).catch(() => {
      if (active) setResult((previous) => ({ key: merchantId, profile: previous?.key === merchantId ? previous.profile : null, failed: true, attempt: retry }));
    });
    return () => { active = false; };
  }, [merchantId, retry]);
  const current = result?.key === merchantId ? result : null;
  const profile = current?.profile;
  const busy = !current || current.attempt !== retry;
  const phone = merchantPhoneUrl(profile?.public_phone ?? ''), directions = merchantMapsUrl(profile?.address ?? '');
  const unavailable = current && !current.failed && !profile;
  const counts = postCounts?.merchantId === merchantId ? postCounts : null;
  const reviews = reviewCounts?.key === `${merchantId}:${profile?.review_post_id}` ? reviewCounts : null;
  const totalReviews = reviews?.usage != null && reviews.employment != null ? reviews.usage + reviews.employment : null;
  const tabs: { id: ProfileTab; label: string; count?: number | null }[] = [
    { id: 'posts', label: '게시글', count: counts?.postCount }, { id: 'jobs', label: '채용', count: counts?.jobCount },
    { id: 'reviews', label: '리뷰', count: totalReviews }, { id: 'about', label: '소개' },
  ];
  const panelId = (id: ProfileTab) => `company-panel-${merchantId}-${id}`;
  return <article className="reader-company" aria-busy={busy}>
    <Head>{profile && <><title>{profile.name} | 글링 업체 프로필</title><meta name="description" content={`${profile.city_name} · ${profile.industry}. ${profile.services.slice(0, 150)}`} /></>}
      <link rel="canonical" href={`${PUBLIC_SITE}/company?id=${merchantId}`} />
      {unavailable && <meta name="robots" content="noindex, nofollow" />}</Head>
    <a className="reader-back" href="/" onClick={() => play('selection')}>← 동네 이야기로</a>
    {busy && <p role="status">업체 프로필을 불러오고 있어요…</p>}
    {current?.failed && <div role="alert" className="reader-company-error"><p>업체 프로필을 불러오지 못했어요.</p>
      <button disabled={busy} onClick={() => { play('selection'); setRetry((value) => value + 1); }}>다시 시도</button></div>}
    {unavailable && <div className="reader-notice"><h1>업체 프로필을 찾을 수 없어요</h1><p>현재 공개된 업체 프로필이 아니에요.</p></div>}
    {profile && <>
      <div className="reader-company-banner">{profile.bannerUri && !broken.banner
        ? <img src={profile.bannerUri} alt={`${profile.name} 배너`} onError={() => setBroken((previous) => ({ ...previous, banner: true }))} />
        : <span aria-hidden="true">{profile.name}</span>}</div>
      <header className="reader-company-identity"><div className="reader-company-business"><div className="reader-company-avatar">{profile.avatarUri && !broken.avatar
        ? <img src={profile.avatarUri} alt={`${profile.name} 로고`} onError={() => setBroken((previous) => ({ ...previous, avatar: true }))} />
        : <span aria-hidden="true">{profile.name.slice(0, 1)}</span>}</div>
        <div><h1>{profile.name}</h1><p className="reader-kicker">{profile.city_name} · {profile.industry}</p></div></div>
        {profile.review_post_id && <ProfileRatings key={`${merchantId}:${profile.review_post_id}`} merchantId={merchantId} postId={profile.review_post_id}
          selectedKind={tab === 'reviews' ? reviewKind : null} onSelect={selectKind} onRead={setReviewCounts} controls={panelId('reviews')} />}</header>
      <div className="reader-company-blurb">{profile.services && <p>{profile.services}</p>}
        {counts?.jobCount != null && counts.jobCount > 0 && <button type="button" className="reader-company-hiring" aria-controls={panelId('jobs')}
          onClick={() => { play('selection'); setTab('jobs'); }}><span aria-hidden="true">●</span> 채용 중 · {`${counts.jobCount}건`} <span aria-hidden="true">›</span></button>}</div>
      {!!profile.links?.length && <nav className="reader-company-sources" aria-label="업체 외부 페이지">{profile.links.map(link =>
        <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`${profile.name} ${link.label}, 새 창 열기`}
          onClick={() => play('selection')}>{link.label} <span aria-hidden="true">↗</span></a>)}</nav>}
      <a className="reader-company-app-action" href={publicWebTarget('/company', merchantId)} onClick={() => play('selection')}>앱에서 문의·저장 <span aria-hidden="true">↗</span></a>
      {(profile.imageLoadFailed || broken.banner || broken.avatar) && <div className="reader-company-image-notice" role="status">
        <p>일부 프로필 사진을 불러오지 못했어요.</p><button disabled={busy} onClick={() => { play('selection'); setRetry((value) => value + 1); }}>사진 다시 불러오기</button></div>}
      <div className="reader-company-tabs" role="tablist" aria-label="업체 프로필 내용">{tabs.map((item, index) => <button type="button" role="tab" key={item.id} data-tab={item.id}
        id={`company-tab-${merchantId}-${item.id}`} aria-controls={panelId(item.id)} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1}
        onClick={() => { play('selection'); setTab(item.id); }} onKeyDown={(event) => {
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % tabs.length
            : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : null;
          if (next == null) return;
          event.preventDefault(); play('selection'); setTab(tabs[next].id);
          event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-tab="${tabs[next].id}"]`)?.focus();
        }}>{item.label}{item.count != null && <span className="reader-company-tab-count">{item.count}</span>}</button>)}</div>
      {tabs.map((item) => <section className="reader-company-panel" role="tabpanel" key={item.id} id={panelId(item.id)}
        aria-labelledby={`company-tab-${merchantId}-${item.id}`} tabIndex={0} hidden={tab !== item.id}>
        {tab === item.id && (item.id === 'posts' || item.id === 'jobs' ? <PublicProfilePosts key={`${merchantId}:${item.id}`} merchantId={merchantId} kind={item.id} onRead={setPostCounts} onPosts={() => setTab('posts')} />
          : item.id === 'reviews' ? profile.review_post_id ? <>
            <div className="reader-company-review-kinds" role="group" aria-label="리뷰 종류">{(['usage', 'employment'] as const).map((kind) => <button type="button" key={kind}
              aria-pressed={reviewKind === kind} aria-controls="company-reviews" onClick={() => { play('selection'); setReviewKind(kind); }}>
              {kind === 'usage' ? '이용' : '근무'}{reviews?.[kind] != null && <span>{reviews[kind]}</span>}</button>)}</div>
            <div id="company-reviews"><PublicReviews key={`${merchantId}:${profile.review_post_id}:${reviewKind}`} merchantId={merchantId} postId={profile.review_post_id} kind={reviewKind} /></div>
          </> : <p className="reader-company-empty">아직 연결된 공개 리뷰가 없어요.</p>
            : <div id="company-intro" className="reader-company-intro"><h2>소개</h2><p>{profile.services || '등록된 소개가 없어요.'}</p>
              <dl><dt>업종</dt><dd>{profile.industry || '등록된 업종이 없어요.'}</dd><dt>지역</dt><dd>{profile.city_name}</dd>
                {phone && <><dt>전화</dt><dd><a href={phone} onClick={() => play('selection')}>{profile.public_phone}</a></dd></>}
                {!!profile.business_hours && <><dt>영업시간</dt><dd className="reader-company-hours">{profile.business_hours}</dd></>}
                {profile.address && <><dt>주소</dt><dd>{profile.address}{directions && <a className="reader-company-directions" href={directions} target="_blank" rel="noopener noreferrer" onClick={() => play('selection')}>길찾기 ↗</a>}</dd></>}
              </dl></div>)}
      </section>)}
    </>}
  </article>;
}

export function PublicMerchantProfile({ merchantId }: { merchantId: string }) {
  return <ProfilePage key={merchantId} merchantId={merchantId} />;
}
