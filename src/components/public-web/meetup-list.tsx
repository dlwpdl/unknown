import './meetup-list.css';
import { useState, type CSSProperties } from 'react';

import { ControlMetrics, ControlMotion, Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { chillingAvailability, chillingSchedule } from '@/lib/chilling';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES } from '@/lib/mock';
import { previewImage } from '@/lib/shared-link-preview';
import type { Post } from '@/lib/types';

export function PublicMeetupList({ posts, cityName, loading, failed, onRetry }: {
  posts: Post[]; cityName: string; loading: boolean; failed: boolean; onRetry: () => void;
}) {
  const { language, locale, tr } = useLanguage(), ko = language === 'ko';
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const meetups = posts.filter(post => !!post.room);
  const style = { ...Object.fromEntries(Object.entries(theme).map(([key, value]) => [`--${key}`, value])),
    '--pm-gap': `${Spacing.three}px`, '--pm-padding': `${Spacing.four}px`, '--pm-small-gap': `${Spacing.two}px`,
    '--pm-action': `${ControlMetrics.action}px`, '--pm-radius': `${ControlMetrics.radius.action}px`, '--pm-pressed': ControlMotion.pressedOpacity,
    '--pm-heading': `${Typography.sheetTitle.fontSize / 16}rem`, '--pm-title': `${Typography.section.fontSize / 16}rem`,
    '--pm-body': `${Typography.menu.fontSize / 16}rem`, '--pm-meta': `${Typography.supporting.fontSize / 16}rem` } as CSSProperties;
  return <section className="public-meetups" style={style} aria-label={ko ? `${cityName} 모임` : `Meetups in ${cityName}`} aria-busy={loading}>
    <header className="public-meetups-heading"><div><h2>{ko ? `${cityName}의 모임` : `Meetups in ${cityName}`}</h2>
      <p>{ko ? '어떤 모임인지 살펴보세요. 참여 신청·모임 만들기·대화는 글링 앱에서 이용해요.' : 'Explore the meetups below. Joining, creating meetups and chatting happen in the Gling app.'}</p></div>
      <a className="public-meetup-action" href="gling://meetup-create" onClick={() => play('selection')}>{ko ? '앱에서 모임 만들기' : 'Create a meetup in the app'} <span aria-hidden="true">↗</span></a>
    </header>
    {loading ? <p className="public-meetups-state" role="status">{ko ? '모임을 불러오고 있어요.' : 'Loading meetups…'}</p>
      : failed ? <div className="public-meetups-state" role="alert"><p>{ko ? '모임을 불러오지 못했어요. 다시 확인해 주세요.' : 'Could not load the meetups. Please try again.'}</p>
        <button type="button" className="public-meetup-action" onClick={() => { play('selection'); onRetry(); }}>{ko ? '다시 불러오기' : 'Try again'}</button></div>
        : !meetups.length ? <p className="public-meetups-state" role="status">{ko ? '지금 이 도시에서 볼 수 있는 공개 모임이 없어요. 다른 도시를 살펴보거나 앱에서 모임을 만들어 보세요.' : 'No meetups are available to preview in this city. Explore another city or create a meetup in the app.'}</p>
          : <div className="public-meetups-list">{meetups.map(post => {
            const room = post.room!;
            const memberCount = Number.isSafeInteger(room.memberCount) && room.memberCount >= 0 ? room.memberCount : null;
            const capacity = Number.isSafeInteger(room.capacity) && room.capacity! > 0 ? room.capacity! : null;
            const availability = chillingAvailability({ ...room, memberCount: memberCount ?? undefined, capacity: capacity ?? undefined });
            const state = availability === 'ended' ? ko ? '종료된 모임' : 'Ended' : availability === 'closed' ? ko ? '모집 마감' : 'Closed' : availability === 'full' ? ko ? '정원 마감' : 'Full' : null;
            const image = post.imageThumbs?.[0] || post.imageUris?.[0] || (post.imagePaths?.some(Boolean) ? previewImage(post.id) : undefined);
            const photo = image && !failedImages.has(`${post.id}:${image}`) ? image : null;
            const city = tr(CITIES.find(item => item.id === post.cityId)?.name ?? cityName);
            const title = post.title || room.title;
            return <article key={post.id} className="public-meetup-card" aria-label={title}>
              <a className="public-meetup-link" href={`/post?id=${encodeURIComponent(post.id)}&invite=1`} aria-label={ko ? `${title} 모임 살펴보기` : `View meetup: ${title}`} onClick={() => play('selection')}>
              <div className="public-meetup-cover">{photo ? <img className="public-meetup-photo" src={photo} alt="" width={640} height={360} loading="lazy" referrerPolicy="no-referrer"
                onError={() => setFailedImages(previous => new Set(previous).add(`${post.id}:${photo}`))} />
                : <span>{image ? ko ? '사진을 불러오지 못했어요' : 'Photo unavailable' : ko ? '모임 사진이 없어요' : 'No meetup photo'}</span>}</div>
              <div className="public-meetup-content"><p className="public-meetup-kind">{room.eventKind === 'once' ? ko ? '일회성 모임' : 'One-time meetup' : ko ? '지속 모임' : 'Recurring meetup'}{state && <span className="public-meetup-status">{state}</span>}</p>
                <h3>{title}</h3>
                <dl className="public-meetup-details"><div><dt>{ko ? '일정' : 'When'}</dt><dd>{chillingSchedule(room, locale)}</dd></div>
                  <div><dt>{ko ? '도시' : 'City'}</dt><dd>{city}</dd></div>
                  <div><dt>{ko ? '참여' : 'Members'}</dt><dd>{memberCount === null ? ko ? '참여 현황 확인 필요' : 'Attendance unavailable' : ko ? `${memberCount.toLocaleString(locale)}명 참여` : `${memberCount.toLocaleString(locale)} members`}
                    {capacity !== null && (ko ? ` · 정원 ${capacity.toLocaleString(locale)}명` : ` · Capacity ${capacity.toLocaleString(locale)}`)}</dd></div></dl>
                <span className="public-meetup-cue">{ko ? '모임 살펴보기' : 'View meetup'} <span aria-hidden="true">→</span></span>
              </div>
              </a>
            </article>;
          })}</div>}
  </section>;
}
