import { Asset } from 'expo-asset';
import { useLocalSearchParams, usePathname } from 'expo-router';
import Head from 'expo-router/head';
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react';
// shortcut: toqr is locked through Expo CLI; recheck this import when upgrading Expo.
import { toQR } from 'toqr';

import { useReaderAnalytics } from './analytics';
import { ControlMetrics, Typography } from '@/constants/design-system';
import { Colors, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { publicWebClient } from '@/lib/public-web-client';
import { PUBLIC_SITE } from '@/lib/public-seo';
import { loadSharedLinkPreview, type SharedLinkPreview } from '@/lib/shared-link-preview';
import { sharedLinkTarget } from '@/lib/sharing';

const wordmark = Asset.fromModule(require('../../../assets/brand/gling-night-wordmark.png')).uri;
const lightWordmark = Asset.fromModule(require('../../../assets/brand/gling-night-wordmark-light.png')).uri;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
type Status = 'loading' | 'ready' | 'error' | 'unavailable';
function subscribeLocation(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

export default function SharedPostLanding() {
  const routerPath = usePathname();
  useLocalSearchParams(); // Re-read the browser snapshot when only query parameters change.
  const path = useSyncExternalStore(subscribeLocation, () => window.location.pathname + window.location.search, () => routerPath);
  const hydrated = useSyncExternalStore(subscribeLocation, () => true, () => false);
  const target = sharedLinkTarget(PUBLIC_SITE + path), postId = target?.id ?? null;
  const [result, setResult] = useState<{ id: string; preview: SharedLinkPreview | null; failed: boolean } | null>(null);
  const [revision, setRevision] = useState(0);
  const current = result?.id === postId ? result : null;
  useReaderAnalytics('post', `shared:${postId ?? 'invalid'}`, hydrated);
  useEffect(() => {
    if (!hydrated || !postId) return;
    let active = true;
    void loadSharedLinkPreview(publicWebClient, postId).then(preview => {
      if (active) setResult({ id: postId, preview: preview?.id === postId ? preview : null, failed: false });
    }).catch(() => { if (active) setResult({ id: postId, preview: null, failed: true }); });
    return () => { active = false; };
  }, [hydrated, postId, revision]);
  const status: Status = !hydrated ? 'loading' : !postId ? 'unavailable' : !current ? 'loading' : current.failed ? 'error' : current.preview ? 'ready' : 'unavailable';
  return <SharedPostLandingContent key={postId ?? 'invalid'} postId={postId} preview={current?.preview ?? null} status={status} invite={target?.invite} onRetry={() => setRevision(value => value + 1)} />;
}

export function SharedPostLandingContent({ postId, preview, status, onRetry, invite = false }: {
  postId: string | null; preview: SharedLinkPreview | null; status: Status; onRetry: () => void; invite?: boolean;
}) {
  const { language } = useLanguage(), theme = useTheme(), { play } = useInteractionFeedback(), ko = language === 'ko';
  const id = postId && UUID.test(postId) ? postId.toLowerCase() : null;
  const ready = status === 'ready' && !!id && preview?.id === id;
  const canonical = id ? `${PUBLIC_SITE}/post?id=${id}${invite ? '&invite=1' : ''}` : null;
  const appUrl = id ? `gling://post/${id}${invite ? '?invite=1' : ''}` : null;
  const [copyMessage, setCopyMessage] = useState(''), [failedImage, setFailedImage] = useState<string | null>(null);
  const qr = useMemo(() => {
    if (!canonical) return null;
    try {
      const cells = toQR(canonical), size = Math.sqrt(cells.length);
      if (!Number.isInteger(size)) return null;
      return { extent: size + 8, path: [...cells].flatMap((cell, index) => cell ? [`M${index % size + 4} ${Math.floor(index / size) + 4}h1v1h-1z`] : []).join('') };
    } catch { return null; }
  }, [canonical]);
  async function copyLink() {
    if (!canonical) return;
    play('selection'); setCopyMessage('');
    try { await navigator.clipboard.writeText(canonical); setCopyMessage(ko ? '이 글의 링크를 복사했어요.' : 'Link to this post copied.'); play('success'); }
    catch { setCopyMessage(ko ? '복사하지 못했어요. 아래 링크 주소를 직접 복사해 주세요.' : 'Could not copy the link. Please copy the address below.'); play('warning'); }
  }
  const description = ko ? '전체 글과 댓글은 글링 앱에서 볼 수 있어요.' : 'Read the full post and comments in the Gling app.';
  const palette = { ...Object.fromEntries(Object.entries(theme).map(([name, value]) => [`--${name}`, value])),
    '--shared-touch': `${ControlMetrics.touch}px`, '--shared-action': `${ControlMetrics.action}px`,
    '--shared-gap': `${Spacing.three}px`, '--shared-padding': `${Spacing.four}px`,
    '--shared-title': `${Typography.sheetTitle.fontSize / 16}rem`, '--shared-menu': `${Typography.menu.fontSize / 16}rem` } as CSSProperties;
  return <div className="shared-post-landing" lang={ko ? 'ko' : 'en'} style={palette}>
    <Head><title>{ready ? `${preview!.title} | ${ko ? '글링' : 'Gling'}` : ko ? '글링 공유 글' : 'Shared post | Gling'}</title>
      <meta name="robots" content="noindex, follow" /><meta name="description" content={description} />
      <meta property="og:title" content={ready ? preview!.title : ko ? '글링 공유 글' : 'Shared post | Gling'} />
      <meta property="og:description" content={description} />{canonical && <link rel="canonical" href={canonical} />}</Head>
    <style>{styles}</style>
    <header><a data-analytics="shared.web.home" href="/" aria-label={ko ? '글링 홈' : 'Gling home'} onClick={() => play('selection')}>
      <img src={theme === Colors.dark ? wordmark : lightWordmark} alt="gling" width={132} height={55} /></a>
      <span>{ko ? '함께 나눈 이야기' : 'A story shared with you'}</span></header>
    <main id="shared-post-main">
      {ready ?
        <section className="shared-preview" aria-label={ko ? '공개 미리보기' : 'Public preview'}>
          {!!preview!.imageUrl && preview!.imageUrl !== failedImage && <img className="shared-cover" src={preview!.imageUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailedImage(preview!.imageUrl!)} />}
          <div className="shared-preview-copy"><p className="shared-kicker">{[preview!.city, preview!.label].filter(Boolean).join(' · ')}{preview!.closed ? ko ? ' · 모집 마감' : ' · Closed' : ''}</p>
            <h1>{preview!.title}</h1>
            {preview!.kind !== 'meetup' && !!preview!.teaser && <p className="shared-teaser">{preview!.teaser}</p>}
            <div className="shared-explanation"><h2>{ko ? '이 이야기는 앱에서 이어져요' : 'Continue this story in the app'}</h2><p>{description}</p></div>
          </div>
        </section>

      : <section className={id ? 'shared-state' : 'shared-state shared-invalid'} aria-live="polite" aria-busy={status === 'loading'}>
        <h1>{status === 'loading' ? ko ? '공유한 글을 확인하고 있어요' : 'Loading the shared preview'
          : !id ? ko ? '공유 링크를 확인해 주세요' : 'Check the shared link' : status === 'error' ? ko ? '미리보기를 불러오지 못했어요' : 'Could not load the preview' : ko ? '공개 미리보기가 없어요' : 'No public preview is available'}</h1>
        <p>{status === 'loading' ? ko ? '잠시만 기다려 주세요.' : 'Please wait a moment.' : !id ? ko ? '글 주소가 올바르지 않아요. 공유받은 링크를 다시 열어 주세요.' : 'The post address is invalid. Please open the original shared link again.' : status === 'error' ? ko ? '연결을 확인하고 다시 시도하거나 앱에서 확인해 주세요.' : 'Check your connection and try again, or continue in the app.' : ko ? '웹에서 표시할 수 있는 미리보기가 없어요. 앱에서 열람 가능 여부를 확인해 주세요.' : 'There is no preview to show on the web. Check access in the app.'}</p>
        {status === 'error' && <button type="button" data-analytics="shared.web.retry" className="shared-secondary" onClick={() => { play('selection'); onRetry(); }}>{ko ? '다시 시도' : 'Try again'}</button>}
      </section>}
      {id && <aside className="shared-handoff" aria-label={ko ? '앱에서 이어가기' : 'Continue in the app'}>
          {!ready && <p className="shared-access-note">{ko ? '앱에서 로그인해 이 글을 볼 수 있는지 확인해 주세요. 삭제되었거나 열람 권한이 없는 글은 앱에서도 볼 수 없어요.' : 'Sign in to the app to check whether you can read this post. Removed posts and posts you do not have permission to read remain unavailable.'}</p>}
          <div className="shared-desktop"><h2>{ko ? '휴대폰으로 이어서 보기' : 'Continue on your phone'}</h2>
            <p>{ko ? '휴대폰 카메라로 QR을 스캔하면 이 글의 앱 안내가 열려요.' : 'Scan with your phone camera to open the app instructions for this same post.'}</p>
            {qr && <svg className="shared-qr" role="img" aria-label={ko ? '휴대폰에서 이 글을 여는 QR 코드' : 'QR code for this post on your phone'} viewBox={`0 0 ${qr.extent} ${qr.extent}`} width={180} height={180} shapeRendering="crispEdges">
              <rect width={qr.extent} height={qr.extent} fill="#fff" /><path d={qr.path} fill="#000" /></svg>}
          </div>
          <div className="shared-mobile"><a className="shared-primary" data-analytics="shared.web.open_app" href={appUrl!} onClick={() => play('selection')}>{ko ? '앱에서 이 글 열기' : 'Open this post in the app'} <span aria-hidden="true">↗</span></a>
            <p>{ko ? '앱이 설치되어 있어야 열 수 있어요.' : 'The Gling app needs to be installed.'}</p>
            <p>{ko ? '카카오톡·Threads 안에서 앱이 열리지 않으면 메뉴에서 Safari 또는 Chrome으로 열어 주세요.' : 'If an in-app browser won’t open Gling, use its menu to open this link in Safari or Chrome.'}</p></div>
          <div className="shared-install"><h2>{ko ? '아직 앱이 없나요?' : 'Need the app?'}</h2>
            <a className="shared-secondary" data-analytics="shared.web.ios_store" href="https://apps.apple.com/ca/app/id6809273242" onClick={() => play('selection')}>{ko ? 'iPhone용 글링 받기' : 'Get Gling for iPhone'} <span aria-hidden="true">↗</span></a>
            <p>{ko ? '설치한 뒤 이 글의 링크를 다시 열어 주세요.' : 'After installing, open this post’s link again.'}</p>
            <p>{ko ? 'Android 공개 출시는 준비 중이에요.' : 'The public Android release is being prepared.'}</p>
          </div>
          <div className="shared-link-actions"><button type="button" className="shared-secondary" data-analytics="shared.web.copy_link" onClick={() => void copyLink()}>{ko ? '이 글의 링크 복사' : 'Copy link to this post'}</button>
            <p className="shared-copy-status" role="status" aria-live="polite">{copyMessage}</p>
            <a className="shared-same-post" data-analytics="shared.web.same_post" href={canonical!} onClick={() => play('selection')}>{canonical}</a></div>
        </aside>}
    </main>
  </div>;
}

const styles = `
.shared-post-landing{min-height:100vh;background:var(--background);color:var(--text);font:1rem/1.5 system-ui,-apple-system,BlinkMacSystemFont,sans-serif;overflow-wrap:anywhere}
.shared-post-landing *{box-sizing:border-box}.shared-post-landing header,.shared-post-landing main{width:min(100%,1088px);margin:0 auto;padding:var(--shared-padding)}
.shared-post-landing header{display:flex;align-items:center;justify-content:space-between;gap:var(--shared-gap);flex-wrap:wrap;border-bottom:1px solid var(--line)}
.shared-post-landing header a{display:inline-flex;min-height:var(--shared-touch);align-items:center}.shared-post-landing header img{object-fit:contain;max-width:100%}
.shared-post-landing header span,.shared-post-landing p{color:var(--textSecondary)}.shared-post-landing main{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:24px;padding-top:32px;padding-bottom:48px}
.shared-post-landing h1{font-size:var(--shared-title);line-height:1.35;letter-spacing:-.5px;margin:0;color:var(--text)}.shared-post-landing h2{font-size:1.125rem;line-height:1.45;letter-spacing:-.4px;margin:0;color:var(--text)}
.shared-post-landing p{margin:8px 0 0}.shared-preview,.shared-handoff,.shared-state{min-width:0;border:1px solid var(--line);border-radius:16px;background:var(--card);overflow:hidden}
.shared-preview{align-self:start}.shared-cover{display:block;width:100%;aspect-ratio:16/9;object-fit:cover}.shared-preview-copy{padding:var(--shared-padding)}
.shared-post-landing .shared-kicker{margin:0 0 12px;color:var(--accent);font-size:.8125rem;font-weight:700}.shared-post-landing .shared-teaser{margin-top:16px;color:var(--text);white-space:pre-line}
.shared-explanation{margin-top:24px;padding-top:20px;border-top:1px solid var(--line)}.shared-handoff{padding:20px;align-self:start}.shared-desktop{display:flex;flex-direction:column;align-items:flex-start;gap:12px}
.shared-desktop p{margin:0}.shared-qr{display:block;width:180px;max-width:100%;height:auto;align-self:center;background:#fff}.shared-mobile{display:none;flex-direction:column;gap:8px}.shared-install,.shared-link-actions{margin-top:24px;padding-top:20px;border-top:1px solid var(--line)}
.shared-install h2{margin-bottom:12px}.shared-primary,.shared-secondary{display:flex;align-items:center;justify-content:center;gap:8px;min-width:var(--shared-touch);min-height:var(--shared-action);border:1px solid var(--line);border-radius:14px;padding:12px 16px;text-align:center;text-decoration:none;font:600 var(--shared-menu)/1.5 system-ui,sans-serif;cursor:pointer;white-space:normal}
.shared-post-landing .shared-primary{background:var(--accent);color:var(--accentInk);border-color:var(--accent)}.shared-post-landing .shared-secondary{background:var(--background);color:var(--text);width:100%}
.shared-post-landing a:active,.shared-post-landing button:active{opacity:.82}.shared-post-landing a:focus-visible,.shared-post-landing button:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.shared-same-post{display:flex;align-items:center;min-height:var(--shared-touch);color:var(--accent);font-size:.8125rem;word-break:break-all;padding:8px 0}.shared-copy-status:empty{display:none}.shared-state{padding:32px;width:100%;align-self:start}.shared-invalid{grid-column:1/-1;max-width:640px;margin:16px auto}.shared-post-landing .shared-access-note{margin:0 0 20px;padding-bottom:20px;border-bottom:1px solid var(--line)}.shared-state button{margin-top:20px}
@media(max-width:767px){.shared-post-landing header,.shared-post-landing main{padding:16px}.shared-post-landing main{grid-template-columns:minmax(0,1fr);gap:16px}.shared-preview-copy{padding:20px}.shared-desktop{display:none}.shared-mobile{display:flex}.shared-handoff{padding:20px}.shared-install{margin-top:20px}.shared-state{padding:24px}}
`;
