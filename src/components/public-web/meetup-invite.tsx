import AsyncStorage from '@react-native-async-storage/async-storage';
import { Asset } from 'expo-asset';
import { useRouter } from 'expo-router';
import Head from 'expo-router/head';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { CHILLING_CATEGORY_LABELS } from '@/components/chilling-event';
import { ControlMetrics, Typography } from '@/constants/design-system';
import { Colors, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { chillingAvailability, chillingKind, chillingSchedule, recommendedAgeLabel } from '@/lib/chilling';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { rememberInviteCode } from '@/lib/invites';
import { loadMeetupInviteCard, seatsLeft, type MeetupInviteCard } from '@/lib/meetup-invite';
import { meetupCategoryOf, meetupLanguageNote } from '@/lib/meetup-language';
import { meetupFeeAmount } from '@/lib/meetup-host-tools';
import { CITIES } from '@/lib/mock';
import { findNeighborhood, neighborhoodName } from '@/lib/neighborhoods';
import { publicWebClient } from '@/lib/public-web-client';
import { loadSharedLinkPost } from '@/lib/shared-link-preview';
import { SHARED_POST_RETURN_KEY } from '@/lib/sharing';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

const wordmark = Asset.fromModule(require('../../../assets/brand/gling-night-wordmark.png')).uri;
const lightWordmark = Asset.fromModule(require('../../../assets/brand/gling-night-wordmark-light.png')).uri;

/**
 * The meetup web invitation (owner 2026-11-13): a link opens this before any login. It shows what the app's meetup detail
 * shows a guest, plus the intro opening, the neighborhood and seats left from get_meetup_invite_card. The exact place,
 * members and contacts stay behind acceptance. Not a meetup (or gone): onMissing hands the page back to the shared post landing.
 */
export function MeetupInvite({ postId, code, onMissing }: { postId: string; code: string | null; onMissing: (postId: string) => void }) {
  const { language, locale, tr } = useLanguage(), ko = language === 'ko';
  const theme = useTheme(), { play } = useInteractionFeedback(), router = useRouter();
  const { isAuthed, isAuthLoading, promptLogin } = useAuth();
  const [loaded, setLoaded] = useState<{ key: string; post: Post; card: MeetupInviteCard } | null>(null);
  const [failed, setFailed] = useState(''), [revision, setRevision] = useState(0);
  const [sheet, setSheet] = useState(false), [wantsWeb, setWantsWeb] = useState(false), [loginError, setLoginError] = useState('');
  const [brokenCover, setBrokenCover] = useState(false);
  const firstOption = useRef<HTMLAnchorElement>(null), opener = useRef<HTMLButtonElement>(null);
  const key = `${postId}:${code ?? ''}:${isAuthed}:${revision}`;
  const joinPath = `/meetup-join?postId=${postId}${code ? `&code=${code}` : ''}`;

  // The sharer's code is kept like an invite link: the existing sign-up claim links it (auth.tsx).
  useEffect(() => { void rememberInviteCode(AsyncStorage, code).catch(() => {}); }, [code]);
  useEffect(() => {
    if (isAuthLoading) return;
    let live = true;
    const client = isAuthed ? supabase : publicWebClient;
    void Promise.all([loadSharedLinkPost(client, postId), loadMeetupInviteCard(client, postId, code)]).then(([post, card]) => {
      if (!live) return;
      if (!post?.room || !card) onMissing(postId);
      else { setLoaded({ key, post, card }); setFailed(''); }
    }, () => { if (live) setFailed(key); });
    return () => { live = false; };
  }, [code, isAuthLoading, isAuthed, key, onMissing, postId]);
  // A sign-in that finishes on this page (no redirect) still continues to the web application.
  useEffect(() => { if (wantsWeb && isAuthed && !isAuthLoading) router.push(joinPath); }, [isAuthLoading, isAuthed, joinPath, router, wantsWeb]);
  useEffect(() => {
    if (!sheet) return;
    firstOption.current?.focus();
    const button = opener.current;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSheet(false); };
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('keydown', escape); button?.focus(); };
  }, [sheet]);

  const palette = { ...Object.fromEntries(Object.entries(theme).map(([name, value]) => [`--${name}`, value])),
    '--mi-touch': `${ControlMetrics.touch}px`, '--mi-action': `${ControlMetrics.action}px`, '--mi-gap': `${Spacing.three}px`,
    '--mi-title': `${Typography.sheetTitle.fontSize / 16}rem` } as CSSProperties;
  const brand = <header className="mi-bar"><a href="/" aria-label={ko ? '글링 홈' : 'Gling home'} onClick={() => play('selection')}>
    <img src={theme === Colors.dark ? wordmark : lightWordmark} alt="gling" width={96} height={40} /></a></header>;
  const current = loaded?.key === key ? loaded : null;
  if (!current) {
    const error = failed === key;
    return <div className="meetup-invite" lang={ko ? 'ko' : 'en'} style={palette}><style>{styles}</style>
      <Head><meta name="robots" content="noindex, nofollow" /></Head>{brand}
      <main className="mi-state" aria-live="polite" aria-busy={!error}>
        <h1>{error ? ko ? '초대장을 불러오지 못했어요' : 'Couldn’t load this invite' : ko ? '초대장을 여는 중이에요' : 'Opening your invite'}</h1>
        {error && <button type="button" className="mi-secondary" onClick={() => { play('selection'); setRevision(value => value + 1); }}>{ko ? '다시 시도' : 'Try again'}</button>}
      </main></div>;
  }

  const { post, card } = current, room = post.room!;
  // A host pause reads 모집 마감 here as on the app card and the shop QR list.
  const base = chillingAvailability(room), availability = base === 'open' && room.recruitingClosed ? 'closed' : base, open = availability === 'open';
  const left = seatsLeft({ capacity: room.capacity ?? null, memberCount: room.memberCount ?? null });
  const city = CITIES.find(item => item.id === post.cityId), cityName = city ? ko ? city.name : city.englishName : '';
  const area = findNeighborhood(post.cityId, card.area);
  const category = meetupCategoryOf(room);
  const host = post.author.nickname;
  // Only the host's own photo gets the big slot; the share-preview default banner stays in link previews (owner 2026-11-13).
  const photo = brokenCover ? null : post.imageUris?.[0] ?? null;
  const spoken = meetupLanguageNote(room, `${post.title}\n${card.intro}`, language);
  const facts: [string, string, string | null][] = [
    [ko ? '언제' : 'When', chillingSchedule(room, locale), null],
    [ko ? '어디' : 'Where', area ? ko ? `${neighborhoodName(area, 'ko')} 근처` : `Near ${neighborhoodName(area, 'en')}` : cityName,
      tr('집결지는 승인 후')],
    [ko ? '인원' : 'Spots', room.capacity ? `${room.memberCount ?? 0} / ${room.capacity}${ko ? '명' : ''}` : ko ? `${room.memberCount ?? 0}명` : `${room.memberCount ?? 0} going`,
      room.capacity && left != null ? ko ? `${room.capacity}자리 중 ${left}자리 남았어요` : `${left} of ${room.capacity} spots left` : null],
    card.fee ? [ko ? '회비' : 'Fee', meetupFeeAmount(card.fee), null] : [ko ? '나이' : 'Ages', recommendedAgeLabel(room, locale), null],
  ];
  const state = { full: ko ? '정원이 다 찼어요. 앱에서 빈자리 알림을 받을 수 있어요.' : 'This one’s full. You can get an alert in the app if a spot opens.',
    closed: ko ? '모집이 마감된 모임이에요.' : 'This meetup isn’t taking requests.', ended: ko ? '이미 끝난 모임이에요.' : 'This meetup has ended.', open: '' }[availability];

  function openSheet() { play('selection'); setLoginError(''); setSheet(true); }
  function closeSheet() { play('selection'); setSheet(false); }
  function applyOnWeb() {
    play('selection');
    if (isAuthed) { router.push(joinPath); return; }
    try {
      // Web sign-in can finish on /auth/callback; it returns to the application screen (sharedPostReturnPath keeps the code).
      window.sessionStorage.setItem(SHARED_POST_RETURN_KEY, joinPath);
      setWantsWeb(true); setSheet(false);
      promptLogin(ko ? '로그인하면 이 모임 신청서가 바로 열려요.' : 'Sign in to open this meetup’s request form.');
    } catch { setLoginError(ko ? '로그인 창을 열지 못했어요. 한 번 더 눌러 주세요.' : 'Couldn’t open sign-in. Tap once more.'); play('warning'); }
  }

  return <div className="meetup-invite" lang={ko ? 'ko' : 'en'} style={palette}><style>{styles}</style>
    <Head><title>{`${post.title} | ${ko ? '글링 모임 초대' : 'Gling meetup invite'}`}</title><meta name="robots" content="noindex, nofollow" /></Head>
    {brand}
    <main className="mi-page">
      {!!card.inviter && <p className="mi-from"><span className="mi-avatar" aria-hidden="true">{[...card.inviter][0]}</span>
        {ko ? `${card.inviter}님이 같이 가자고 보낸 모임이에요` : `${card.inviter} wants you to come along`}</p>}
      {!!photo && <img className="mi-cover" src={photo} alt="" referrerPolicy="no-referrer" onError={() => setBrokenCover(true)} />}
      <div className="mi-chips">
        <span className="mi-chip mi-on">{chillingKind(room) === 'once' ? tr('칠링') : tr('정기모임')}</span>
        {!!category && <span className="mi-chip">{tr(CHILLING_CATEGORY_LABELS[category])}</span>}
        {!!spoken && <span className="mi-chip">{spoken}</span>}
        <span className="mi-chip">{tr({ open: '모집 중', full: '정원 마감', closed: '모집 마감', ended: '종료된 모임' }[availability])}</span>
      </div>
      <h1>{post.title}</h1>
      <p className="mi-host"><span className="mi-avatar" aria-hidden="true">{[...host][0]}</span>{host} <small>{ko ? '호스트' : 'Host'}</small></p>
      <dl className="mi-facts">{facts.map(([label, value, note], index) => <div key={label} className="mi-fact">
        <dt>{label}</dt><dd>{value}</dd>
        {index === 2 && !!room.capacity && <span className="mi-seat" aria-hidden="true"><i style={{ width: `${Math.min(100, ((room.memberCount ?? 0) / room.capacity) * 100)}%` }} /></span>}
        {!!note && <dd className="mi-note">{note}</dd>}
      </div>)}</dl>
      {!!card.intro && <section aria-labelledby="mi-intro"><h2 id="mi-intro">{ko ? '소개' : 'About'}</h2><p className="mi-intro">{card.intro}</p></section>}
      <p className="mi-lock"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
        <span>{ko ? '이 초대장은 링크를 받은 사람만 열 수 있고, 검색에는 나오지 않아요.' : 'Only people with the link can open this invite. It won’t show up in search.'}</span></p>
    </main>
    <footer className="mi-dock">
      <p>{open ? ko ? '호스트가 신청을 보고 승인하면 자리가 확정돼요.' : 'Your spot is confirmed once the host approves your request.' : state}</p>
      {open ? <button ref={opener} type="button" className="mi-primary" data-analytics="invite.web.apply" aria-haspopup="dialog" onClick={openSheet}>{ko ? '신청하기' : 'Request to join'}</button>
        : <a className="mi-secondary" data-analytics="invite.web.other_meetups" href={city ? `/${city.id}/meetups` : '/meetups'} onClick={() => play('selection')}>{ko ? '다른 모임 보기' : 'See other meetups'}</a>}
      {!!loginError && <p role="alert">{loginError}</p>}
    </footer>
    {sheet && <div className="mi-scrim" onClick={closeSheet}>
      <div className="mi-sheet" role="dialog" aria-modal="true" aria-labelledby="mi-sheet-title" onClick={event => event.stopPropagation()}>
        <span className="mi-grab" aria-hidden="true" />
        <h2 id="mi-sheet-title">{ko ? '신청은 어디서 할까요?' : 'Where do you want to apply?'}</h2>
        <a ref={firstOption} className="mi-option" data-analytics="invite.web.has_app" href={`gling:/${joinPath}`} onClick={() => { play('selection'); setSheet(false); }}>
          <span className="mi-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M11 18h2" /></svg></span>
          <span><b>{ko ? '글링 앱이 있어요' : 'I have the Gling app'}</b><span>{ko ? '앱에서 이 모임 신청 화면이 바로 열려요.' : 'This meetup’s request screen opens right in the app.'}</span></span></a>
        <button type="button" className="mi-option" data-analytics="invite.web.no_app" onClick={applyOnWeb}>
          <span className="mi-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg></span>
          <span><b>{ko ? '앱이 아직 없어요' : 'I don’t have the app yet'}</b><span>{ko ? '로그인하고 한 줄 소개와 호스트 질문 답을 쓰면 여기서 바로 신청돼요. 앱은 그다음에 받아도 늦지 않아요.' : 'Sign in, add a one-line intro and answer the host’s question to apply right here. You can grab the app after.'}</span></span></button>
        <p className="mi-sheet-note">{ko ? '카카오톡·Threads 안에서 앱이나 로그인 창이 열리지 않으면 Safari 또는 Chrome으로 이 링크를 열어 주세요.' : 'If the app or sign-in won’t open inside KakaoTalk or Threads, open this link in Safari or Chrome.'}</p>
        <button type="button" className="mi-ghost" onClick={closeSheet}>{ko ? '닫기' : 'Close'}</button>
      </div>
    </div>}
  </div>;
}

const styles = `
body:has(.meetup-invite){margin:0;overflow-y:auto!important}
.meetup-invite{min-height:100vh;background:var(--background);color:var(--text);font:1rem/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;overflow-wrap:anywhere}
.meetup-invite *{box-sizing:border-box}.meetup-invite p{margin:0}
.mi-bar,.mi-page,.mi-state,.mi-dock{width:min(100%,560px);margin:0 auto;padding-left:16px;padding-right:16px}
.mi-bar{display:flex;align-items:center;min-height:56px}.mi-bar a{display:inline-flex;align-items:center;min-height:var(--mi-touch)}.mi-bar img{object-fit:contain}
.mi-page{padding-top:4px;padding-bottom:180px}.mi-state{padding-top:48px;display:grid;gap:16px}
.mi-from,.mi-host{display:flex;align-items:center;gap:8px;font-size:.8125rem;line-height:1.45;color:var(--textSecondary)}
.mi-from{margin:6px 0 12px}.mi-host{min-height:var(--mi-touch);font-weight:700;color:var(--text)}.mi-host small{font-weight:500;color:var(--textSecondary);font-size:.8125rem}
.mi-avatar{flex:none;display:grid;place-items:center;width:28px;height:28px;border-radius:14px;background:var(--backgroundSelected);color:var(--text);font-size:.75rem;font-weight:700}
.mi-cover{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:16px;background:var(--backgroundElement)}
.mi-chips{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0 6px}.mi-chip{font-size:.75rem;line-height:1.5;font-weight:700;border-radius:999px;padding:3px 10px;background:var(--backgroundElement);color:var(--textSecondary)}.mi-chip.mi-on{background:var(--backgroundSelected);color:var(--accent)}
.meetup-invite h1{margin:4px 0 8px;font-size:var(--mi-title);line-height:1.3;letter-spacing:-.5px;word-break:keep-all}
.meetup-invite h2{margin:0 0 6px;font-size:.8125rem;line-height:1.45;font-weight:700}
.mi-facts{display:grid;grid-template-columns:1fr 1fr;margin:8px 0 18px;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--card)}
.mi-fact{padding:12px 14px;min-height:86px;min-width:0}.mi-fact:nth-child(2n){border-left:1px solid var(--line)}.mi-fact:nth-child(n+3){border-top:1px solid var(--line)}
.mi-fact dt{font-size:.75rem;line-height:1.4;color:var(--textSecondary)}.mi-fact dd{margin:2px 0 0;font-weight:700;word-break:keep-all}.mi-fact .mi-note{font-size:.75rem;line-height:1.4;font-weight:500;color:var(--textSecondary)}
.mi-seat{display:block;height:6px;border-radius:3px;background:var(--backgroundElement);margin-top:8px;overflow:hidden}.mi-seat i{display:block;height:100%;background:var(--accent);border-radius:3px}
.mi-intro{white-space:pre-line;line-height:1.55;word-break:keep-all;margin-bottom:16px!important}
.mi-lock{display:flex;gap:8px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--card);font-size:.75rem;line-height:1.5;color:var(--textSecondary);word-break:keep-all}.mi-lock svg{flex:none;margin-top:2px}
.mi-dock{position:fixed;left:0;right:0;bottom:0;padding-top:10px;padding-bottom:calc(16px + env(safe-area-inset-bottom));background:color-mix(in srgb,var(--background) 86%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-top:1px solid var(--line);display:grid;gap:8px}
.mi-dock p{font-size:.75rem;line-height:1.45;color:var(--textSecondary);text-align:center}
.mi-primary,.mi-secondary,.mi-ghost{display:flex;align-items:center;justify-content:center;width:100%;min-height:var(--mi-action);border-radius:14px;border:1px solid var(--accent);background:var(--accent);color:var(--accentInk);font:700 1rem/1.4 inherit;font-family:inherit;text-decoration:none;cursor:pointer;transition:transform 90ms ease-out,opacity 90ms}
.mi-secondary{background:transparent;border-color:var(--line);color:var(--text)}.mi-ghost{background:transparent;border-color:transparent;color:var(--accent);min-height:var(--mi-touch);font-size:.875rem}
.mi-scrim{position:fixed;inset:0;z-index:10;background:rgba(5,5,10,.62);display:flex;align-items:flex-end;justify-content:center}
.mi-sheet{width:min(100%,560px);background:var(--card);border-radius:24px 24px 0 0;border-top:1px solid var(--line);padding:10px 16px calc(20px + env(safe-area-inset-bottom))}
.mi-grab{display:block;width:36px;height:5px;border-radius:3px;background:var(--backgroundSelected);margin:0 auto 14px}
.mi-sheet h2{font-size:1.25rem;line-height:1.4;letter-spacing:-.4px;margin:0 0 14px}
.mi-option{display:flex;gap:12px;align-items:flex-start;width:100%;min-height:72px;margin-bottom:10px;padding:14px;border:1px solid var(--line);border-radius:16px;background:var(--background);color:var(--text);text-align:left;text-decoration:none;font:inherit;cursor:pointer;transition:transform 90ms ease-out,opacity 90ms,border-color .15s}
.mi-option b{display:block;font-size:1rem;line-height:1.5}.mi-option span span{display:block;font-size:.8125rem;line-height:1.45;color:var(--textSecondary);word-break:keep-all}
.mi-sheet-note{margin:2px 4px 6px!important;font-size:.8125rem;line-height:1.45;color:var(--textSecondary);word-break:keep-all}
.mi-icon{flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:12px;background:var(--backgroundElement);color:var(--accent)}
.meetup-invite a:active,.meetup-invite button:active{transform:scale(.97);opacity:.82}
.meetup-invite a:focus-visible,.meetup-invite button:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
@media(hover:hover){.mi-option:hover{border-color:var(--accent)}}
@media(prefers-reduced-motion:reduce){.meetup-invite *{transition:none!important}.meetup-invite a:active,.meetup-invite button:active{transform:none}}
`;
