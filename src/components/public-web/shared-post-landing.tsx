import { Asset } from 'expo-asset';
import { useLocalSearchParams, usePathname } from 'expo-router';
import Head from 'expo-router/head';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
// shortcut: toqr is locked through Expo CLI; recheck this import when upgrading Expo.
import { toQR } from 'toqr';

import { SharedPostArticle } from './shared-post-article';
import { useReaderAnalytics } from './analytics';
import { ControlMetrics, Typography } from '@/constants/design-system';
import { Colors, Spacing } from '@/constants/theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { publicWebClient } from '@/lib/public-web-client';
import { publicSiteName, PUBLIC_SITE } from '@/lib/public-seo';
import { loadSharedLinkPost, loadSharedLinkPreview, type SharedLinkPreview } from '@/lib/shared-link-preview';
import { sharedLinkTarget, SHARED_POST_RETURN_KEY } from '@/lib/sharing';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

const wordmark = Asset.fromModule(require('../../../assets/brand/gling-night-wordmark.png')).uri;
const lightWordmark = Asset.fromModule(require('../../../assets/brand/gling-night-wordmark-light.png')).uri;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const stores = { ios: 'https://apps.apple.com/ca/app/id6809273242', android: 'https://play.google.com/store/apps/details?id=com.dlwpdl.gling' };
type Status = 'loading' | 'ready' | 'error' | 'unavailable';
function subscribeLocation(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

export default function SharedPostLanding() {
  const routerPath = usePathname();
  useLocalSearchParams();
  const path = useSyncExternalStore(subscribeLocation, () => window.location.pathname + window.location.search, () => routerPath);
  const hydrated = useSyncExternalStore(subscribeLocation, () => true, () => false);
  const { isAuthed, isAuthLoading, me, promptLogin } = useAuth(), hidden = useContentVisibility();
  const { language } = useLanguage(), { play } = useInteractionFeedback();
  const target = sharedLinkTarget(PUBLIC_SITE + path), postId = target?.id ?? null;
  const viewer = me.id;
  const authenticated = isAuthed && !isAuthLoading, owner = authenticated ? viewer : 'guest';
  const [revision, setRevision] = useState(0), [loginError, setLoginError] = useState('');
  const key = `${postId}:${owner}:${revision}`;
  const scopeKey = `${hydrated}:${path}:${postId}:${target?.invite === true}:${viewer}:${isAuthed}:${isAuthLoading}:${revision}`;
  const scope = useRef({ active: false, key: '' });
  useLayoutEffect(() => {
    const committed = { active: true, key: scopeKey }; scope.current = committed;
    return () => { committed.active = false; };
  }, [scopeKey]);
  const [result, setResult] = useState<{ key: string; preview: SharedLinkPreview | null; post: Post | null; failed: boolean } | null>(null);
  const current = result?.key === key ? result : null;
  const post = authenticated && current?.post?.id === postId && !hidden('post', current.post.id, current.post.author.id)
    && !(current.post.business && hidden('user', current.post.business.id)) ? current.post : null;
  useReaderAnalytics('post', `shared:${postId ?? 'invalid'}`, hydrated);
  useEffect(() => {
    if (!hydrated || !postId) return;
    let active = true;
    const read = authenticated ? loadSharedLinkPost(supabase, postId).then(value => ({ post: value?.id === postId ? value : null, preview: null }))
      : loadSharedLinkPreview(publicWebClient, postId).then(value => ({ preview: value?.id === postId ? value : null, post: null }));
    void read.then(value => { if (active && scope.current.active && scope.current.key === scopeKey) setResult({ key, ...value, failed: false }); })
      .catch(() => { if (active && scope.current.active && scope.current.key === scopeKey) setResult({ key, post: null, preview: null, failed: true }); });
    return () => { active = false; };
  }, [authenticated, hydrated, key, postId, scopeKey]);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible); };
  }, []);
  const status: Status = !hydrated ? 'loading' : !postId ? 'unavailable' : !current ? 'loading' : current.failed ? 'error'
    : (authenticated ? post : current.preview) ? 'ready' : 'unavailable';
  function login() {
    if (!postId || isAuthed || isAuthLoading || !scope.current.active || scope.current.key !== scopeKey) return;
    play('selection'); setLoginError('');
    try {
      window.sessionStorage.setItem(SHARED_POST_RETURN_KEY, `/post?id=${postId}${target?.invite ? '&invite=1' : ''}`);
      promptLogin(language === 'ko' ? '로그인하거나 가입하면 웹에서 전체 글을 읽을 수 있어요.' : 'Sign in or sign up to read the full post on the web.');
    } catch {
      setLoginError(language === 'ko' ? '로그인을 준비하지 못했어요. 다시 시도해 주세요.' : 'Could not prepare sign-in. Please try again.'); play('warning');
    }
  }
  return <SharedPostLandingContent key={`${postId}:${owner}`} postId={postId} preview={authenticated ? null : current?.preview ?? null} post={post}
    authenticated={authenticated} authPending={isAuthLoading} status={status} invite={target?.invite} onLogin={login} loginError={loginError} onRetry={() => setRevision(value => value + 1)} />;
}

export function SharedPostLandingContent({ postId, preview, post = null, authenticated = false, authPending = false, status, onRetry, onLogin, loginError = '', invite = false }: {
  postId: string | null; preview: SharedLinkPreview | null; post?: Post | null; authenticated?: boolean; authPending?: boolean; status: Status;
  onRetry: () => void; onLogin: () => void; loginError?: string; invite?: boolean;
}) {
  const { language } = useLanguage(), theme = useTheme(), { play } = useInteractionFeedback(), ko = language === 'ko';
  const id = postId && UUID.test(postId) ? postId.toLowerCase() : null;
  const ready = status === 'ready' && !!id && (authenticated ? post?.id === id : preview?.id === id);
  const canonical = id ? `${PUBLIC_SITE}/post?id=${id}${invite ? '&invite=1' : ''}` : null;
  const appUrl = id ? `gling://post/${id}${invite ? '?invite=1' : ''}` : null;
  const [copyMessage, setCopyMessage] = useState(''), [failedImage, setFailedImage] = useState<string | null>(null);
  const [store, setStore] = useState<'ios' | 'android' | null>(null);
  const storeUrl = store ? stores[store] : null;
  const qr = useMemo(() => {
    if (!storeUrl) return null;
    try {
      const cells = toQR(storeUrl), size = Math.sqrt(cells.length);
      if (!Number.isInteger(size)) return null;
      return { extent: size + 8, path: [...cells].flatMap((cell, index) => cell ? [`M${index % size + 4} ${Math.floor(index / size) + 4}h1v1h-1z`] : []).join('') };
    } catch { return null; }
  }, [storeUrl]);
  async function copyLink() {
    if (!canonical) return;
    play('selection'); setCopyMessage('');
    try { await navigator.clipboard.writeText(canonical); setCopyMessage(ko ? '이 글의 링크를 복사했어요.' : 'Link to this post copied.'); play('success'); }
    catch { setCopyMessage(ko ? '복사하지 못했어요. 아래 링크 주소를 직접 복사해 주세요.' : 'Could not copy the link. Please copy the address below.'); play('warning'); }
  }
  const description = ko ? '로그인하거나 가입하면 웹에서 전체 글을 읽을 수 있어요.' : 'Sign in or sign up to read the full post on the web.';
  const title = authenticated ? post?.title : preview?.title;
  const palette = { ...Object.fromEntries(Object.entries(theme).map(([name, value]) => [`--${name}`, value])),
    '--shared-touch': `${ControlMetrics.touch}px`, '--shared-action': `${ControlMetrics.action}px`, '--shared-gap': `${Spacing.three}px`, '--shared-padding': `${Spacing.four}px`,
    '--shared-title': `${Typography.sheetTitle.fontSize / 16}rem`, '--shared-menu': `${Typography.menu.fontSize / 16}rem` } as CSSProperties;
  return <div className="shared-post-landing" lang={ko ? 'ko' : 'en'} style={palette}>
    <Head><title>{ready ? `${title} | ${ko ? '글링' : 'Gling'}` : ko ? '글링 공유 글' : 'Shared post | Gling'}</title>
      <meta property="og:site_name" content={publicSiteName(language)} /><meta property="og:locale" content={ko ? 'ko_KR' : 'en_CA'} />
      <meta name="robots" content="noindex, follow" /><meta name="description" content={description} />
      <meta property="og:title" content={ready ? title : ko ? '글링 공유 글' : 'Shared post | Gling'} />
      <meta property="og:description" content={description} />{canonical && <link rel="canonical" href={canonical} />}</Head>
    <style>{styles}</style>
    <header><a data-analytics="shared.web.home" href="/" aria-label={ko ? '글링 홈' : 'Gling home'} onClick={() => play('selection')}>
      <img src={theme === Colors.dark ? wordmark : lightWordmark} alt="gling" width={132} height={55} /></a><span>{ko ? '함께 나눈 이야기' : 'A story shared with you'}</span></header>
    <main>
      <div className="shared-story">
        {ready ? authenticated && post ? <SharedPostArticle post={post} /> : <section className="shared-preview" aria-label={ko ? '공개 미리보기' : 'Public preview'}>
          {!!preview!.imageUrl && preview!.imageUrl !== failedImage && <img className="shared-cover" src={preview!.imageUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailedImage(preview!.imageUrl!)} />}
          <div className="shared-preview-copy"><p className="shared-kicker">{[preview!.city, preview!.label].filter(Boolean).join(' · ')}{preview!.closed ? ko ? ' · 모집 마감' : ' · Closed' : ''}</p>
            <h1>{preview!.title}</h1>{preview!.kind !== 'meetup' && !!preview!.teaser && <p className="shared-teaser">{preview!.teaser}</p>}
          </div></section>
          : <section className={id ? 'shared-state' : 'shared-state shared-invalid'} aria-live="polite" aria-busy={status === 'loading'}>
            <h1>{status === 'loading' ? ko ? '공유한 글을 확인하고 있어요' : 'Loading the shared preview' : !id ? ko ? '공유 링크를 확인해 주세요' : 'Check the shared link'
              : status === 'error' ? ko ? '글을 불러오지 못했어요' : 'Could not load the post' : ko ? '지금은 이 글을 볼 수 없어요' : 'This post is unavailable'}</h1>
            <p>{status === 'loading' ? ko ? '잠시만 기다려 주세요.' : 'Please wait a moment.' : !id ? ko ? '글 주소가 올바르지 않아요. 공유받은 링크를 다시 열어 주세요.' : 'The post address is invalid. Please open the original shared link again.'
              : authenticated ? ko ? '삭제되었거나 열람할 수 없는 글이에요.' : 'This post was removed or is not available to you.' : ko ? '삭제되었거나 열람할 수 없는 글일 수 있어요. 로그인한 뒤 확인해 주세요.' : 'Sign in to check access. Removed or inaccessible posts stay unavailable.'}</p>
            {status === 'error' && <button type="button" data-analytics="shared.web.retry" className="shared-secondary" onClick={() => { play('selection'); onRetry(); }}>{ko ? '다시 시도' : 'Try again'}</button>}
          </section>}
        {id && !authenticated && <section className="shared-login"><h2>{ko ? '이어서 읽어보세요' : 'Keep reading'}</h2><p>{description}</p>
          <button type="button" data-analytics="shared.web.login" className="shared-primary" disabled={authPending} onClick={onLogin}>{authPending ? ko ? '로그인 정보를 확인하고 있어요…' : 'Checking sign-in…' : ko ? '로그인·가입하고 읽기' : 'Sign in or sign up to read'}</button>
          {!!loginError && <p role="alert">{loginError}</p>}</section>}
      </div>
      {id && <aside className="shared-handoff" aria-label={ko ? '앱에서 대화하기' : 'Chat in the app'}>
        <h2>{ko ? '앱에서 대화하기' : 'Chat in the Gling app'}</h2><p>{ko ? '대화, 댓글 작성과 모임 참여는 글링 앱에서 이용해 주세요.' : 'Use the Gling app for conversations, comments and joining meetups.'}</p>
        <a className="shared-secondary shared-open-app" data-analytics="shared.web.open_app" href={appUrl!} onClick={() => play('selection')}>{ko ? '앱에서 이 글 열기' : 'Open this post in the app'} <span aria-hidden="true">↗</span></a>
        <p className="shared-support">{ko ? '앱이 설치되어 있어야 열 수 있어요. 카카오톡·Threads 안에서 열리지 않으면 Safari 또는 Chrome으로 이 링크를 열어 주세요.' : 'Gling needs to be installed. If an in-app browser won’t open it, open this link in Safari or Chrome.'}</p>
        <div className="shared-install"><h2>{ko ? '아직 앱이 없나요?' : 'Need the app?'}</h2><p>{ko ? '휴대폰의 스토어를 선택해 주세요.' : 'Choose your phone’s store.'}</p>
          <div className="shared-store-picker" role="group" aria-label={ko ? '앱 스토어 선택' : 'Choose an app store'}>
            <button type="button" data-analytics="shared.web.store.ios" className="shared-secondary" aria-pressed={store === 'ios'} onClick={() => { play('selection'); setStore('ios'); }}>App Store</button>
            <button type="button" data-analytics="shared.web.store.android" className="shared-secondary" aria-pressed={store === 'android'} onClick={() => { play('selection'); setStore('android'); }}>Google Play</button>
          </div>
          {store && storeUrl && <div className="shared-store-result" aria-live="polite">
            {qr && <svg className="shared-qr" role="img" aria-label={`${store === 'ios' ? 'App Store' : 'Google Play'} ${ko ? '설치 안내 QR 코드' : 'download QR code'}`} viewBox={`0 0 ${qr.extent} ${qr.extent}`} width={180} height={180} shapeRendering="crispEdges">
              <rect width={qr.extent} height={qr.extent} fill="#fff" /><path d={qr.path} fill="#000" /></svg>}
            <a className="shared-secondary" data-analytics={store === 'ios' ? 'shared.web.ios_store' : 'shared.web.android_store'} href={storeUrl} target="_blank" rel="noopener" onClick={() => play('selection')}>{store === 'ios' ? ko ? 'App Store에서 받기' : 'Get it on the App Store' : ko ? 'Google Play에서 확인' : 'View on Google Play'} <span aria-hidden="true">↗</span></a>
            {store === 'android' && <p className="shared-support">{ko ? 'Android는 비공개 테스트 중이며 공개 출시를 준비하고 있어요. 테스트 참여 대상만 설치할 수 있어요.' : 'Android is in private testing and its public release is being prepared. Installation is currently limited to eligible testers.'}</p>}
            <p className="shared-support">{ko ? '설치 후 이 글의 링크를 다시 열어 주세요.' : 'After installing, open this post’s link again.'}</p>
          </div>}
        </div>
        <div className="shared-link-actions"><button type="button" className="shared-secondary" data-analytics="shared.web.copy_link" onClick={() => void copyLink()}>{ko ? '이 글의 링크 복사' : 'Copy link to this post'}</button>
          <p className="shared-copy-status" role="status" aria-live="polite">{copyMessage}</p><a className="shared-same-post" data-analytics="shared.web.same_post" href={canonical!} onClick={() => play('selection')}>{canonical}</a></div>
      </aside>}
    </main>
  </div>;
}

const styles = `
.shared-post-landing{min-height:100vh;background:var(--background);color:var(--text);font:1rem/1.5 system-ui,-apple-system,BlinkMacSystemFont,sans-serif;overflow-wrap:anywhere}
.shared-post-landing *{box-sizing:border-box}.shared-post-landing header,.shared-post-landing main{width:min(100%,1088px);margin:0 auto;padding:var(--shared-padding)}
.shared-post-landing header{display:flex;align-items:center;justify-content:space-between;gap:var(--shared-gap);flex-wrap:wrap;border-bottom:1px solid var(--line)}
.shared-post-landing header a{display:inline-flex;min-height:var(--shared-touch);align-items:center}.shared-post-landing header img{object-fit:contain;max-width:100%}
.shared-post-landing header span,.shared-post-landing p{color:var(--textSecondary)}.shared-post-landing main{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:24px;padding-top:32px;padding-bottom:48px;align-items:start}
.shared-post-landing h1{font-size:var(--shared-title);line-height:1.35;letter-spacing:-.5px;margin:0;color:var(--text)}.shared-post-landing h2{font-size:1.125rem;line-height:1.45;letter-spacing:-.4px;margin:0;color:var(--text)}
.shared-post-landing p{margin:8px 0 0}.shared-story,.shared-preview,.shared-handoff,.shared-state,.shared-full{min-width:0}.shared-preview,.shared-handoff,.shared-state,.shared-full{border:1px solid var(--line);border-radius:16px;background:var(--card);overflow:hidden}
.shared-cover{display:block;width:100%;aspect-ratio:16/9;object-fit:cover}.shared-preview-copy,.shared-full{padding:var(--shared-padding)}.shared-full .shared-cover{margin:20px 0;object-fit:contain;aspect-ratio:auto;max-height:640px}
.shared-post-landing .shared-kicker{margin:0 0 12px;color:var(--accent);font-size:.8125rem;font-weight:700}.shared-post-landing .shared-teaser{margin-top:16px;color:var(--text);white-space:pre-line}
.shared-full .reader-body{white-space:pre-wrap;color:var(--text);margin-top:20px}.shared-full .reader-body a{color:var(--accent)}.shared-full .reader-meta,.shared-support{font-size:.8125rem}.shared-meetup{margin-top:24px;border-top:1px solid var(--line);padding-top:20px}
.shared-login{margin-top:20px;padding:20px;border:1px solid var(--line);border-radius:16px}.shared-login button{margin-top:16px;width:100%}.shared-handoff{padding:20px}.shared-open-app{margin-top:16px}
.shared-install,.shared-link-actions{margin-top:24px;padding-top:20px;border-top:1px solid var(--line)}.shared-store-picker{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:16px}.shared-store-result{display:flex;flex-direction:column;gap:12px;margin-top:20px}.shared-store-result p{margin:0}
.shared-qr{display:block;width:180px;max-width:100%;height:auto;align-self:center;background:#fff}.shared-primary,.shared-secondary{display:flex;align-items:center;justify-content:center;gap:8px;min-width:var(--shared-touch);min-height:var(--shared-action);border:1px solid var(--line);border-radius:14px;padding:12px 14px;text-align:center;text-decoration:none;font:600 var(--shared-menu)/1.5 system-ui,sans-serif;cursor:pointer;white-space:normal}
.shared-post-landing .shared-primary{background:var(--accent);color:var(--accentInk);border-color:var(--accent)}.shared-post-landing .shared-secondary{background:var(--background);color:var(--text);width:100%}.shared-post-landing [aria-pressed="true"]{background:var(--backgroundSelected);border-color:var(--accent);color:var(--accent)}
.shared-post-landing a:active,.shared-post-landing button:active{opacity:.82}.shared-post-landing button:disabled{opacity:.6;cursor:default}.shared-post-landing a:focus-visible,.shared-post-landing button:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.shared-same-post{display:flex;align-items:center;min-height:var(--shared-touch);color:var(--accent);font-size:.8125rem;word-break:break-all;padding:8px 0}.shared-copy-status:empty{display:none}.shared-state{padding:32px}.shared-invalid{max-width:640px;margin:16px auto}.shared-state button{margin-top:20px}
@media(max-width:767px){.shared-post-landing header,.shared-post-landing main{padding:16px}.shared-post-landing main{grid-template-columns:minmax(0,1fr);gap:20px}.shared-preview-copy,.shared-full{padding:20px}.shared-handoff{padding:20px}.shared-state{padding:24px}}
`;
