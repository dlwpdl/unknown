import Head from 'expo-router/head';
import { useEffect, useState, type CSSProperties } from 'react';

import { AppStoreChoices } from './app-store-choices';
import { ControlMetrics, Typography } from '@/constants/design-system';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { chillingAvailability, chillingSchedule } from '@/lib/chilling';
import { loadPublicFeed } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { inviteAppUrl } from '@/lib/invites';
import type { BusinessInviteLanding } from '@/lib/meetup-invite';
import { CITIES, TAGS } from '@/lib/mock';
import { publicWebClient } from '@/lib/public-web-client';
import { loadSharedLinkPost } from '@/lib/shared-link-preview';
import type { Post } from '@/lib/types';

const WEEK = 7 * 86400000;
const COVER = '/share-covers/meetup.png';

/**
 * A shop QR code (owner 2026-11-13): "[shop]에서 찍었어요 → 이 가게 모임 → 이번 주 [city] 모임". The code stays the shop's
 * invite code (invite.web.tsx already stored it), so a sign-up from here still counts for that shop, and every meetup
 * link carries it on to the invitation.
 */
export function ShopInviteLanding({ code, landing }: { code: string; landing: BusinessInviteLanding }) {
  const { language, locale } = useLanguage(), ko = language === 'ko';
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
    const room = post.room!;
    const left = room.capacity ? Math.max(0, room.capacity - (room.memberCount ?? 0)) : null;
    const detail = [chillingSchedule(room, locale), left != null && (ko ? `${left}자리 남음` : `${left} ${left === 1 ? 'spot' : 'spots'} left`)].filter(Boolean).join(' · ');
    return <a key={post.id} className="si-item" data-analytics="invite.shop.meetup" href={`/post?id=${post.id}&invite=1&code=${code}`} onClick={() => play('selection')}>
      <img src={post.imageUris?.[0] || COVER} alt="" width={64} height={64} referrerPolicy="no-referrer" onError={event => { event.currentTarget.src = COVER; }} />
      <span><b>{post.title}</b><small>{detail}</small></span></a>;
  };

  return <div className="shop-invite" lang={ko ? 'ko' : 'en'} style={palette}><style>{styles}</style>
    <Head><title>{ko ? `${landing.name}에서 찍었어요 | 글링` : `Scanned at ${landing.name} | Gling`}</title><meta name="robots" content="noindex, nofollow" /></Head>
    <main>
      <p className="si-from"><span aria-hidden="true">✓</span>{ko ? `${landing.name}에서 찍었어요` : `You scanned this at ${landing.name}`}</p>
      <h1>{ko ? '이 가게 모임' : 'Meetups at this spot'}</h1>
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
        <a className="si-open" data-analytics="invite.shop.open_app" href={inviteAppUrl(code)} onClick={() => play('selection')}>{ko ? '앱에서 열기' : 'Open in the app'}</a>
      </section>
    </main>
  </div>;
}

const styles = `
.shop-invite{min-height:100vh;background:var(--background);color:var(--text);font:1rem/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;overflow-wrap:anywhere}
.shop-invite *{box-sizing:border-box}.shop-invite main{width:min(100%,560px);margin:0 auto;padding:16px 16px 48px}.shop-invite p{margin:0}
.si-from{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:12px;background:var(--backgroundSelected);color:var(--accent);font-size:.875rem;font-weight:700;margin-bottom:20px!important}
.shop-invite h1{font-size:var(--si-title);line-height:1.3;letter-spacing:-.5px;margin:0 0 10px}.shop-invite h2{font-size:1.125rem;line-height:1.4;margin:24px 0 10px}
.si-list{display:grid;gap:10px}.si-note{color:var(--textSecondary);font-size:.875rem}
.si-item{display:flex;gap:12px;align-items:center;min-height:84px;padding:10px;border:1px solid var(--line);border-radius:16px;background:var(--card);color:var(--text);text-decoration:none;transition:transform 90ms ease-out,opacity 90ms}
.si-item img{flex:none;width:64px;height:64px;border-radius:12px;object-fit:cover;background:var(--backgroundElement)}
.si-item b{display:block;font-size:.9375rem;line-height:1.4;word-break:keep-all}.si-item small{display:block;margin-top:2px;font-size:.75rem;line-height:1.4;color:var(--textSecondary)}
.si-more{display:inline-flex;align-items:center;gap:6px;min-height:var(--si-touch);margin-top:8px;color:var(--accent);font-weight:700;text-decoration:none}
.si-app{display:grid;gap:12px;margin-top:24px;padding-top:20px;border-top:1px solid var(--line)}
.si-open{display:flex;align-items:center;justify-content:center;min-height:var(--si-action);border:1px solid var(--line);border-radius:14px;color:var(--text);font-weight:700;text-decoration:none}
.shop-invite a:active{transform:scale(.97);opacity:.82}.shop-invite a:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
@media(prefers-reduced-motion:reduce){.shop-invite *{transition:none!important}.shop-invite a:active{transform:none}}
`;
