import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { AdminFilterBar, AdminFilterReset, AdminMultiFilter, AdminSearch, AdminSelect, AdminTableSummary } from '@/components/admin/admin-table-controls';
import { AdminConversationsView } from '@/components/admin/admin-conversations';
import { loadAdminMeetupConversations } from '@/lib/admin-conversation-messages';
import { loadAdminMeetups, loadAdminMeetupActivity, adminMeetupState, MEETUP_STATES, REQUEST_STATES, type AdminMeetup, type MeetupFilters, type MeetupActivityMode, type MeetupRequestStatus, type MeetupActivityRow, type MeetupPage } from '@/lib/admin-meetups';
import { chillingKind, chillingSchedule, recommendedAgeLabel } from '@/lib/chilling';
import { displayName } from '@/lib/admin-labels';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES } from '@/lib/mock';
import { supabase } from '@/lib/supabase';

const EMPTY_FILTERS: MeetupFilters = { query: '', cities: [], kind: 'all' };
const date = (value: string) => new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const city = (id: string) => CITIES.find(item => item.id === id)?.name ?? id;
const members = (post: AdminMeetup) => `${post.room_preview.memberCount ?? '—'} / ${post.room_preview.capacity ?? '—'}명`;

export function AdminMeetupsView({ refreshSignal, onUser, localPreview = false }: { refreshSignal: number; onUser: (id: string) => void; localPreview?: boolean }) {
  const { play } = useInteractionFeedback();
  const [input, setInput] = useState('');
  const [filters, setFilters] = useState<MeetupFilters>(EMPTY_FILTERS);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<AdminMeetup | null>(null);
  const [response, setResponse] = useState<{ key: string; page: MeetupPage<AdminMeetup> | null; error: string | null } | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const revision = useRef(0);
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  const key = JSON.stringify([filters, refreshSignal, retry]);
  const current = response?.key === key ? response : null;
  const page = current?.page;
  const busy = !current || moreBusy;
  useEffect(() => { if (!selected) selectedButton.current?.focus(); }, [selected]);
  useEffect(() => {
    const generation = ++revision.current;
    const request = localPreview ? Promise.resolve({ rows: [], profiles: [], total: 0 }) : loadAdminMeetups(supabase, filters);
    void request.then(page => { if (generation === revision.current) setResponse({ key, page, error: null }); })
      .catch(() => { if (generation === revision.current) setResponse({ key, page: null, error: '모임을 불러오지 못했습니다. 관리자 권한과 연결을 확인해주세요.' }); })
      .finally(() => { if (generation === revision.current) setMoreBusy(false); });
    return () => { revision.current = generation + 1; };
  }, [filters, refreshSignal, retry, key, localPreview]);
  const more = async () => {
    if (!page || busy) return;
    const generation = revision.current;
    setMoreBusy(true);
    try {
      const next = await loadAdminMeetups(supabase, filters, page.rows.length);
      if (generation === revision.current) setResponse({ key, page: { ...next, rows: [...new Map([...page.rows, ...next.rows].map(row => [row.id, row])).values()], profiles: [...page.profiles, ...next.profiles] }, error: null });
    } catch { if (generation === revision.current) setResponse({ key, page, error: '다음 모임 목록을 불러오지 못했습니다.' }); }
    finally { if (generation === revision.current) setMoreBusy(false); }
  };
  const profiles = new Map(page?.profiles.map(profile => [profile.id, profile]));
  const choose = (post: AdminMeetup, button: HTMLButtonElement | null) => { play('selection'); selectedButton.current = button; setSelected(post); };
  return <View style={{ gap: 16 }}>
    <div hidden={!!selected}><View style={{ gap: 16 }}>
    <ThemedText type="title" accessibilityRole="header">모임 모니터링</ThemedText>
    <ThemedText type="small">일회성·지속 모임의 모집 상태와 참여 현황을 확인합니다. 숨김·삭제된 기록도 포함합니다.</ThemedText>
    <div className="admin-toolbar">
      <AdminSearch value={input} onChange={setInput} onSubmit={() => { setFilters({ ...filters, query: input.trim() }); setRetry(value => value + 1); }} placeholder="모임 제목 검색" />
      <AdminFilterBar applied={filters.cities.length + Number(filters.kind !== 'all')}>
        <AdminSelect label="모임 구분" value={filters.kind} onChange={kind => setFilters({ ...filters, kind: kind as MeetupFilters['kind'] })} options={[{ value: 'all', label: '전체' }, { value: 'once', label: '일회성' }, { value: 'group', label: '지속 모임' }]} />
        <AdminMultiFilter label="도시" value={filters.cities} onChange={cities => setFilters({ ...filters, cities })} options={CITIES.map(item => ({ value: item.id, label: item.name }))} />
        <AdminFilterReset disabled={!input && !filters.query && !filters.cities.length && filters.kind === 'all'} onReset={() => { setInput(''); setFilters(EMPTY_FILTERS); }} />
      </AdminFilterBar>
    </div>
    {current?.error && <div role="alert" className="admin-meetup-error">{current.error} <button className="admin-reset" type="button" onClick={() => { play('selection'); setRetry(value => value + 1); }}>다시 시도</button></div>}
    {!current && <div role="status">모임을 불러오는 중입니다.</div>}
    {page && <>
      <AdminTableSummary shown={page.rows.length} total={page.total} />
      <div className="admin-table-wrap admin-meetup-table-wrap" tabIndex={0} role="region" aria-label="모임 목록">
        <table className="admin-table admin-meetup-table"><caption className="admin-sr-only">모임 목록 · 참여 인원에는 주최자가 포함됩니다.</caption>
          <thead><tr>{['모임', '상태', '도시·일정', '주최자', '참여·정원'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{page.rows.map(post => <tr key={post.id} className="admin-meetup-row" onClick={event => {
            if (!(event.target as HTMLElement).closest('button,a,input,select,textarea,summary')) choose(post, event.currentTarget.querySelector<HTMLButtonElement>('.admin-meetup-link'));
          }}>
            <td data-label="모임"><button className="admin-row-button admin-meetup-link" type="button" aria-label={`${post.title} 모임 상세 보기`} onClick={event => choose(post, event.currentTarget)}><strong>{post.title}</strong><span className="admin-card-chevron" aria-hidden>›</span></button><div className="admin-muted">{chillingKind(post.room_preview) === 'once' ? '일회성' : '지속 모임'}</div></td>
            <td data-label="상태"><span className={`admin-badge${adminMeetupState(post) === 'open' ? ' admin-badge-success' : ''}`}>{MEETUP_STATES[adminMeetupState(post)]}</span></td>
            <td data-label="도시·일정">{city(post.city_id)}<div className="admin-muted">{chillingSchedule(post.room_preview)}</div></td>
            <td data-label="주최자"><button className="admin-inline-button" type="button" onClick={() => { play('selection'); onUser(post.author_id); }}>{displayName(profiles.get(post.author_id), post.author_id)}</button></td>
            <td data-label="참여·정원">{members(post)}<div className="admin-muted">주최자 포함</div></td>
          </tr>)}</tbody>
        </table>
        {!page.rows.length && <div className="admin-empty">조건에 맞는 모임이 없습니다. 검색어나 필터를 바꿔보세요.</div>}
      </div>
      {page.rows.length < page.total && <button className="admin-reset" type="button" disabled={busy} onClick={() => { play('selection'); void more(); }}>{moreBusy ? '불러오는 중…' : '모임 더 보기'}</button>}
    </>}
    </View></div>
    {selected && <MeetupDetail key={selected.id} post={page?.rows.find(post => post.id === selected.id) ?? selected} hostName={displayName(profiles.get(selected.author_id), selected.author_id)} onUser={onUser} refreshSignal={refreshSignal} onClose={() => setSelected(null)} />}
  </View>;
}

function MeetupDetail({ post, hostName, refreshSignal, onUser, onClose }: { post: AdminMeetup; hostName?: string; refreshSignal: number; onUser: (id: string) => void; onClose: () => void }) {
  const { play } = useInteractionFeedback();
  const heading = useRef<HTMLHeadingElement>(null);
  const revision = useRef(0);
  const [mode, setMode] = useState<MeetupActivityMode | 'overview'>('overview');
  const [status, setStatus] = useState<MeetupRequestStatus | 'all'>('all');
  const [retry, setRetry] = useState(0);
  const [moreBusy, setMoreBusy] = useState(false);
  const [response, setResponse] = useState<{ key: string; page: MeetupPage<MeetupActivityRow> | null; rooms?: Awaited<ReturnType<typeof loadAdminMeetupConversations>>; error: string | null } | null>(null);
  const key = JSON.stringify([post.id, mode, status, refreshSignal, retry]);
  const current = response?.key === key ? response : null;
  const page = current?.page;
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const generation = ++revision.current;
    if (mode === 'overview') return () => { revision.current = generation + 1; };
    const request = mode === 'messages'
      ? loadAdminMeetupConversations(supabase, post.id).then(rooms => ({ page: null, rooms }))
      : loadAdminMeetupActivity(supabase, post.id, 'requests', status).then(page => ({ page }));
    void request.then(result => { if (generation === revision.current) setResponse({ key, ...result, error: null }); })
      .catch(() => { if (generation === revision.current) setResponse({ key, page: null, error: '이 모임의 기록을 불러오지 못했습니다.' }); })
      .finally(() => { if (generation === revision.current) setMoreBusy(false); });
    return () => { revision.current = generation + 1; };
  }, [post.id, mode, status, refreshSignal, retry, key]);
  const more = async () => {
    if (!page || !current || moreBusy || mode !== 'requests') return;
    const generation = revision.current;
    setMoreBusy(true);
    try {
      const next = await loadAdminMeetupActivity(supabase, post.id, 'requests', status, page.rows.length);
      if (generation === revision.current) setResponse({ key, page: { ...next, rows: [...new Map([...page.rows, ...next.rows].map(row => [row.id, row])).values()], profiles: [...page.profiles, ...next.profiles] }, error: null });
    } catch { if (generation === revision.current) setResponse({ key, page, error: '다음 기록을 불러오지 못했습니다.' }); }
    finally { if (generation === revision.current) setMoreBusy(false); }
  };
  const profiles = new Map(page?.profiles.map(profile => [profile.id, profile]));
  return <section className="admin-meetup-detail" aria-label={`${post.title} 모임 상세`}>
    <button className="admin-reset admin-back-button" type="button" onClick={() => { play('selection'); onClose(); }}><span aria-hidden>‹</span> 모임 목록</button>
    <header className="admin-detail-heading">
      <div className="admin-filter-row"><span className="admin-badge admin-badge-accent">{chillingKind(post.room_preview) === 'once' ? '일회성' : '지속 모임'}</span><span className={`admin-badge${adminMeetupState(post) === 'open' ? ' admin-badge-success' : ''}`}>{MEETUP_STATES[adminMeetupState(post)]}</span></div>
      <h2 ref={heading} tabIndex={-1}>{post.title}</h2>
      <p className="admin-muted">{city(post.city_id)} · {chillingSchedule(post.room_preview)}</p>
    </header>
    <div className="admin-status-tabs admin-detail-tabs" role="group" aria-label="모임 상세 메뉴">
      {([{ value: 'overview', label: '모임 정보' }, { value: 'requests', label: '참여 신청' }, { value: 'messages', label: '대화 모니터링' }] as const).map(tab => <button key={tab.value} type="button" aria-pressed={mode === tab.value} onClick={() => { play('selection'); setMode(tab.value); }}>{tab.label}</button>)}
    </div>
    {mode === 'overview' ? <div className="admin-detail-content">
      <dl className="admin-detail-facts">
        <div><dt>주최자</dt><dd><button type="button" className="admin-inline-button" onClick={() => { play('selection'); onUser(post.author_id); }}>{hostName ?? displayName(undefined, post.author_id)}</button></dd></div>
        <div><dt>참여 · 정원</dt><dd>{members(post)}<span className="admin-muted">주최자 포함</span></dd></div>
        <div><dt>참여 조건</dt><dd>{post.room_preview.verifiedOnly ? '인증 회원만 참여' : '전체 회원 참여'}<span className="admin-muted">{recommendedAgeLabel(post.room_preview)}</span></dd></div>
      </dl>
      <div className="admin-detail-copy"><h3>모임 소개</h3><p className="admin-meetup-body">{post.body || '작성된 소개가 없습니다.'}</p>
        {post.room_preview.applicationQuestion && <><h3>참여 신청 질문</h3><p className="admin-meetup-body">{post.room_preview.applicationQuestion}</p></>}
      </div>
      <p className="admin-muted">등록 {date(post.created_at)}</p>
      <details className="admin-context-details" onToggle={() => play('selection')}><summary>문제 추적 정보</summary><p>모임 ID {post.id}</p></details>
    </div> : <div className={mode === 'requests' ? 'admin-detail-content' : ''}>
    {mode === 'requests' && <div className="admin-detail-record-head"><div><h3>참여 신청 기록</h3><p className="admin-muted">신청 메시지와 승인·대기·거절·취소 내역을 확인합니다.</p></div>
      {mode === 'requests' && <AdminSelect label="신청 상태" value={status} onChange={value => setStatus(value as MeetupRequestStatus | 'all')} options={[{ value: 'all', label: '전체' }, ...Object.entries(REQUEST_STATES).map(([value, label]) => ({ value, label }))]} />}
    </div>}
    {current?.error && <div role="alert" className="admin-meetup-error">{current.error} <button className="admin-reset" type="button" onClick={() => { play('selection'); setRetry(value => value + 1); }}>다시 시도</button></div>}
    {!current && <p role="status">기록을 불러오는 중입니다.</p>}
    {current?.rooms && <AdminConversationsView key={post.id} data={{ ...current.rooms, posts: [post], contextPosts: [], messages: [] }} loadingMore={false} noMore onLoadMore={() => {}} onUser={onUser} refreshSignal={refreshSignal} />}
    {page && <>
      <AdminTableSummary shown={page.rows.length} total={page.total} />
      <div className="admin-meetup-activity">{page.rows.map(row => <article key={row.id}>
        <div className="admin-detail-record-meta"><button type="button" className="admin-inline-button" onClick={() => { play('selection'); onUser(row.user_id); }}>{displayName(profiles.get(row.user_id), row.user_id)}</button>{row.status && <span className={`admin-badge${row.status === 'approved' ? ' admin-badge-success' : row.status === 'pending' ? ' admin-badge-warning' : ''}`}>{REQUEST_STATES[row.status]}</span>}<time className="admin-muted" dateTime={row.created_at}>{date(row.created_at)}</time></div>
        <p className="admin-meetup-body">{row.body || '작성한 메시지가 없습니다.'}</p>
      </article>)}</div>
      {!page.rows.length && <p className="admin-empty">{mode === 'requests' ? '해당 상태의 참여 신청이 없습니다.' : '이 모임에 저장된 대화가 없습니다.'}</p>}
      {page.rows.length < page.total && <button className="admin-reset" type="button" disabled={moreBusy} onClick={() => { play('selection'); void more(); }}>{moreBusy ? '불러오는 중…' : '기록 더 보기'}</button>}
    </>}
    </div>}
  </section>;
}
