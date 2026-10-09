import './festivals.css';

import { useEffect, useState } from 'react';
import { eventPriceLabel, eventTime, safeTicketUrl, type TicketmasterEvent } from '../../../supabase/functions/_shared/ticketmaster';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadPublicFestivals } from '@/lib/public-web';
import { publicWebClient } from '@/lib/public-web-client';

export function PublicFestivals({ cityId, cityName }: { cityId: string; cityName: string }) {
  const { play } = useInteractionFeedback();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; events: TicketmasterEvent[]; failed: boolean } | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const [failedImage, setFailedImage] = useState('');
  const key = `${cityId}:${attempt}`;
  const current = result?.key === key ? result : null;
  const events = current?.events ?? [];
  const event = events[index % events.length];
  const rotating = playing && !hovering && !focused;
  const ticketUrl = event && safeTicketUrl(event.ticketUrl);

  useEffect(() => {
    let active = true;
    void loadPublicFestivals(publicWebClient, cityId).then((items) => {
      if (active) { setResult({ key, events: items, failed: false }); setIndex(0); }
    }).catch(() => {
      if (active) setResult({ key, events: [], failed: true });
    });
    return () => { active = false; };
  }, [cityId, key]);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPlaying(!preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!rotating || events.length < 2) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setIndex((value) => (value + 1) % events.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [rotating, events.length, key]);

  function move(delta: number) {
    play('selection');
    setIndex((value) => (value + delta + events.length) % events.length);
    setPlaying(false);
  }

  return <section className="reader-festivals" aria-labelledby="reader-festivals-title" aria-roledescription="캐러셀"
    onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}
    onFocusCapture={() => setFocused(true)}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    onPointerDown={(event) => { if (event.pointerType === 'touch') setPlaying(false); }}>
    <div className="reader-festivals-heading"><div><span className="reader-kicker">IN YOUR CITY</span>
      <h2 id="reader-festivals-title">{cityName}의 다음 페스티벌</h2></div><span className="reader-meta">Ticketmaster</span></div>
    {!current ? <p className="reader-festival-state" role="status">{cityName} 행사 정보를 불러오고 있어요.</p>
      : current.failed ? <div className="reader-festival-state" role="status"><p>행사 정보를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.</p>
        <button type="button" onClick={() => { play('selection'); setAttempt((value) => value + 1); }}>다시 불러오기</button></div>
        : !event ? <p className="reader-festival-state" role="status">지금 Ticketmaster에 등록된 예정 페스티벌이 없어요. 아래 도시 이야기도 둘러보세요.</p>
          : <>
            <article className="reader-festival-card" aria-roledescription="슬라이드" aria-label={`${index % events.length + 1}/${events.length}: ${event.name}`}>
              {event.image && failedImage !== event.id && <img key={event.id} src={event.image} alt="" width="960" height="540"
                loading="lazy" onError={() => setFailedImage(event.id)} />}
              <div className="reader-festival-copy"><p className="reader-festival-date">{eventTime(event)} · 현지 시간</p>
                <h3>{event.name}</h3><p>{event.venue || '장소는 판매처에서 확인해 주세요.'}</p>
                <p className="reader-festival-price">{eventPriceLabel(event)}</p>
                {event.status === 'rescheduled' && <p>변경된 일정은 판매처에서 확인해 주세요.</p>}
                {event.status === 'offsale' && <p>현재 티켓 판매가 중단돼 있어요.</p>}
                <div className="reader-festival-actions">
                  {ticketUrl && <a className="reader-primary" href={ticketUrl} target="_blank" rel="noopener noreferrer"
                    aria-label={`${event.name} 티켓·행사 정보, Ticketmaster 새 탭 열기`} onClick={() => play('selection')}>티켓·행사 정보 ↗</a>}
                  <a className="reader-secondary" href={`gling://events/${encodeURIComponent(event.id)}?cityId=${encodeURIComponent(cityId)}`}
                    onClick={() => play('selection')}>앱에서 함께 갈 사람 찾기</a>
                </div>
              </div>
            </article>
            {events.length > 1 && <div className="reader-festival-controls">
              <span aria-live={rotating ? 'off' : 'polite'} aria-atomic="true">{index % events.length + 1} / {events.length}</span>
              <div><button type="button" aria-label="이전 페스티벌" onClick={() => move(-1)}>←</button>
                <button type="button" onClick={() => { play('selection'); setPlaying((value) => !value); }}
                  aria-label={playing ? '페스티벌 자동 넘김 일시정지' : '페스티벌 자동 넘김 시작'}>{playing ? '일시정지' : '자동 넘김'}</button>
                <button type="button" aria-label="다음 페스티벌" onClick={() => move(1)}>→</button></div>
            </div>}
            <p className="reader-festival-source">행사 정보: Ticketmaster · 일정과 판매 상태는 달라질 수 있어요.</p>
          </>}
  </section>;
}
