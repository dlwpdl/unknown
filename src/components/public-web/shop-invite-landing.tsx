import { Asset } from 'expo-asset';
import Head from 'expo-router/head';
import { useEffect, useState, type CSSProperties } from 'react';

import { AppStoreChoices } from './app-store-choices';
import { ControlMetrics, Typography } from '@/constants/design-system';
import { Colors } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { chillingAvailability, chillingSchedule } from '@/lib/chilling';
import { loadPublicFeed } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { inviteAppUrl } from '@/lib/invites';
import { seatsLeft, type BusinessInviteLanding } from '@/lib/meetup-invite';
import { meetupLanguageNote } from '@/lib/meetup-language';
import { CITIES, TAGS } from '@/lib/mock';
import { publicWebClient } from '@/lib/public-web-client';
import { loadSharedLinkPost } from '@/lib/shared-link-preview';
import type { Post } from '@/lib/types';

const WEEK = 7 * 86400000;
const wordmark = Asset.fromModule(require('../../../assets/brand/gling-night-wordmark.png')).uri;
const lightWordmark = Asset.fromModule(require('../../../assets/brand/gling-night-wordmark-light.png')).uri;
// The app meetup card's labels for a meetup that no longer takes requests (chilling-event.tsx).
const STATE_LABELS = { full: '정원 마감', closed: '모집 마감', ended: '종료된 모임' } as const;

/**
 * A shop QR code (owner 2026-11-13): "[shop]에서 찍었어요 → 이 가게 모임 → 이번 주 [city] 모임". The code stays the shop's
 * invite code (invite.web.tsx already stored it), so a sign-up from here still counts for that shop, and every meetup
 * link carries it on to the invitation.
 */
export function ShopInviteLanding({ code, landing }: { code: string; landing: BusinessInviteLanding }) {
  const { language, locale, tr } = useLanguage(), ko = language === 'ko';
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [lists, setLists] = useState<{ key: string; shop: Post[]; week: Post[] | null } | null>(null);
  const city = CITIES.find(item => item.id === landing.cityId), cityName = city ? ko ? city.name : city.englishName : '';
  const key = `${landing.merchantId}:${landing.meetups.join(',')}`;
  useEffect(() => {
    let live = true;
    const meetupTag = TAGS.find(tag => tag.slug === 'meetup')?.id ?? null;
    const shop = Promise.all(landing.meetups.map(id => loadSharedLinkPost(publicWebClient, id).catch(() => null)));
    const week = loadPublicFeed(publicWebClient, landing.cityId, meetupTag, null, null, { viewerScope: 'guest' }).then(posts => {
      const now = Date.now();
      return posts.filter(post => post.room && !landing.meetups.includes(post.id) && chillingAvailability(post.room, now) === 'open'
        && post.room.eventKind === 'once' && Date.parse(post.room.startsAt ?? '') - now < WEEK)
        .sort((a, b) => Date.parse(a.room!.startsAt ?? '') - Date.parse(b.room!.startsAt ?? '')).slice(0, 3);
    }, () => null);
    void Promise.all([shop, week]).then(([found, upcoming]) => {
      if (live) setLists({ key, shop: found.filter((post): post is Post => !!post?.room), week: upcoming });
    });
    return () => { live = false; };
  }, [key, landing.cityId, landing.meetups]);
  const current = lists?.key === key ? lists : null;
  const palette = { ...Object.fromEntries(Object.entries(theme).map(([name, value]) => [`--${name}`, value])),
    '--si-touch': `${ControlMetrics.touch}px`, '--si-action': `${ControlMetrics.action}px`, '--si-title': `${Typography.sheetTitle.fontSize / 16}rem` } as CSSProperties;

  const item = (post: Post) => {
    const room = post.room!, availability = chillingAvailability(room);
    const state = availability !== 'open' ? STATE_LABELS[availability] : room.recruitingClosed ? STATE_LABELS.closed : null;
    const left = seatsLeft({ capacity: room.capacity ?? null, memberCount: room.memberCount ?? null });
    const seats = left == null ? null : ko ? `${left}자리 남음` : `${left} ${left === 1 ? 'spot' : 'spots'} left`;
    const spoken = meetupLanguageNote(room, post.title, language);
    return <a key={post.id} className="si-item" data-analytics="invite.shop.meetup" href={`/post?id=${post.id}&invite=1&code=${code}`} onClick={() => play('selection')}>
      {/* No photo: the app card's plain poster (no words), so a missing photo never repeats the share banner. */}
      <span className="si-thumb" aria-hidden="true">{!!post.imageUris?.[0] && <img src={post.imageUris[0]} alt="" width={64} height={64} referrerPolicy="no-referrer"
        onError={event => { event.currentTarget.hidden = true; }} />}</span>
      <span>{!!spoken && <span className="si-lang">{spoken}</span>}<b>{post.title}</b><small>{[chillingSchedule(room, locale), state ? tr(state) : seats].filter(Boolean).join(' · ')}</small></span></a>;
  };

  return <div className="shop-invite" lang={ko ? 'ko' : 'en'} style={palette}><style>{styles}</style>
    <Head><title>{ko ? `${landing.name}에서 찍었어요 | 글링` : `Scanned at ${landing.name} | Gling`}</title><meta name="robots" content="noindex, nofollow" /></Head>
    <header className="si-bar"><a href="/" aria-label={ko ? '글링 홈' : 'Gling home'} onClick={() => play('selection')}>
      <img src={theme === Colors.dark ? wordmark : lightWordmark} alt="gling" width={96} height={40} /></a></header>
    <main>
      <p className="si-from"><span aria-hidden="true">✓</span>{ko ? `${landing.name}에서 찍었어요` : `Scanned at ${landing.name}`}</p>
      <h1>{ko ? `${landing.name}에서 열리는 모임` : `Meetups at ${landing.name}`}</h1>
      <p className="si-about">{ko ? '밴쿠버·토론토·몬트리올 한인이 동네 정보를 묻고 모임을 찾는 무료 앱, 글링이에요.' : 'Gling is a free app where Koreans in Vancouver, Toronto and Montreal ask about their neighbourhood and find meetups.'}</p>
      {!current ? <p className="si-note" role="status">{ko ? '모임을 불러오고 있어요.' : 'Loading meetups…'}</p>
        : current.shop.length ? <div className="si-list">{current.shop.map(item)}</div>
          : <p className="si-note">{ko ? '이 가게에서 열리는 모임은 아직 없어요.' : 'No meetups here yet.'}</p>}
      <h2>{ko ? `이번 주 ${cityName} 모임` : `This week in ${cityName}`}</h2>
      {!current ? null : current.week?.length ? <div className="si-list">{current.week.map(item)}</div>
        : <p className="si-note">{current.week ? ko ? '이번 주에 열리는 모임이 아직 없어요.' : 'Nothing’s on this week yet.' : ko ? '모임을 불러오지 못했어요.' : 'Couldn’t load meetups.'}</p>}
      <a className="si-more" data-analytics="invite.shop.city_meetups" href={city ? `/${city.id}/meetups` : '/meetups'} onClick={() => play('selection')}>
        {ko ? `${cityName} 모임 더 보기` : `More meetups in ${cityName}`} <span aria-hidden="true">→</span></a>
      <section className="si-app">
        <AppStoreChoices />
        <a className="si-open" data-analytics="invite.shop.open_app" href={inviteAppUrl(code)} onClick={() => play('selection')}>{tr('앱에서 열기')}</a>
      </section>
    </main>
  </div>;
}

const styles = `
body:has(.shop-invite){margin:0;overflow-y:auto!important}
.shop-invite{min-height:100vh;background:var(--background);color:var(--text);font:1rem/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;overflow-wrap:anywhere}
.shop-invite *{box-sizing:border-box}.shop-invite main,.si-bar{width:min(100%,560px);margin:0 auto;padding:0 16px}.shop-invite main{padding-top:4px;padding-bottom:48px}.shop-invite p{margin:0}
.si-bar{display:flex;align-items:center;min-height:56px}.si-bar a{display:inline-flex;align-items:center;min-height:var(--si-touch)}.si-bar img{object-fit:contain}
.si-from{display:flex;align-items:center;gap:6px;color:var(--textSecondary);font-size:.8125rem;line-height:1.45;margin:6px 0 4px!important}.si-from span{color:var(--accent);font-weight:700}
.shop-invite h1{font-size:var(--si-title);line-height:1.3;letter-spacing:-.5px;margin:0 0 6px;word-break:keep-all}.shop-invite h2{font-size:1.125rem;line-height:1.4;margin:24px 0 10px}
.si-about{color:var(--textSecondary);font-size:.875rem;line-height:1.5;margin-bottom:16px!important;word-break:keep-all}
.si-list{display:grid;gap:10px}.si-note{color:var(--textSecondary);font-size:.875rem}
.si-item{display:flex;gap:12px;align-items:center;min-height:84px;padding:10px;border:1px solid var(--line);border-radius:16px;background:var(--card);color:var(--text);text-decoration:none;transition:transform 90ms ease-out,opacity 90ms}
.si-thumb{position:relative;flex:none;width:64px;height:64px;border-radius:12px;overflow:hidden;background:var(--backgroundElement)}
.si-thumb::before{content:"";position:absolute;width:24px;height:24px;border-radius:50%;right:9px;top:8px;background:var(--accent)}
.si-thumb::after{content:"";position:absolute;width:120px;height:36px;border-radius:50%;right:-28px;bottom:-14px;transform:rotate(-15deg);background:var(--backgroundSelected)}
.si-thumb img{position:relative;z-index:1;width:100%;height:100%;object-fit:cover}
.si-lang{display:inline-block;margin-bottom:4px;padding:1px 8px;border-radius:6px;background:var(--backgroundElement);font-size:.75rem;line-height:1.5;font-weight:700}
.si-item b{display:block;font-size:.9375rem;line-height:1.4;word-break:keep-all}.si-item small{display:block;margin-top:2px;font-size:.75rem;line-height:1.4;color:var(--textSecondary)}
.si-more{display:inline-flex;align-items:center;gap:6px;min-height:var(--si-touch);margin-top:8px;color:var(--accent);font-weight:700;text-decoration:none}
.si-app{display:grid;gap:12px;margin-top:24px;padding-top:20px;border-top:1px solid var(--line)}
.si-open{display:flex;align-items:center;justify-content:center;min-height:var(--si-action);border:1px solid var(--line);border-radius:14px;color:var(--text);font-weight:700;text-decoration:none}
.shop-invite a:active{transform:scale(.97);opacity:.82}.shop-invite a:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
@media(prefers-reduced-motion:reduce){.shop-invite *{transition:none!important}.shop-invite a:active{transform:none}}
`;
