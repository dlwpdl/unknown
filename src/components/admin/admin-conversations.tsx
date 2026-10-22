import { useEffect, useMemo, useRef, useState } from 'react';

import { AdminFilterBar, AdminFilterReset, AdminSearch, AdminSelect, AdminTableSummary } from '@/components/admin/admin-table-controls';
import { loadAdminConversationMessages, type AdminConversationPage } from '@/lib/admin-conversations';
import type { AdminConversation, AdminDashboardData, AdminMessage, AdminProfile } from '@/lib/admin-data';
import { conversationLabel, displayName } from '@/lib/admin-labels';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

const formatDate = (value: string) => new Date(value).toLocaleString('ko-KR');

export function AdminConversationsView({ data, loadingMore, noMore, onLoadMore, onUser, localPreview = false, refreshSignal = 0 }: {
  data: Pick<AdminDashboardData, 'profiles' | 'posts' | 'contextPosts' | 'conversations' | 'messages'>;
  loadingMore: boolean; noMore: boolean; onLoadMore: () => void; onUser: (id: string) => void; localPreview?: boolean; refreshSignal?: number;
}) {
  const { play } = useInteractionFeedback();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [selected, setSelected] = useState<AdminConversation | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const profiles = useMemo(() => new Map(data.profiles.map(profile => [profile.id, profile])), [data.profiles]);
  const label = (room: AdminConversation) => conversationLabel(room, profiles, [...data.posts, ...(data.contextPosts ?? [])]);
  const needle = query.trim().toLocaleLowerCase('ko-KR');
  const rows = data.conversations.filter(room => (kind === 'all' || (kind === 'group') === !!room.group_post_id)
    && [room.id, room.user_low_id, room.user_high_id, label(room).primary].some(value => value?.toLocaleLowerCase('ko-KR').includes(needle)));
  useEffect(() => { if (!selected) trigger.current?.focus(); }, [selected]);
  const selectedLabel = selected && label(selected);
  return <section>
    <div hidden={!!selected} className="admin-conversation-list">
      <div className="admin-detail-heading"><h2>대화 모니터링</h2><p className="admin-muted">대화방을 선택하면 참여자와 전체 대화를 확인할 수 있습니다.</p></div>
      <div className="admin-toolbar"><AdminSearch value={query} onChange={setQuery} placeholder="대화방, 참여자 이름 또는 ID 검색" />
        <AdminFilterBar applied={kind === 'all' ? 0 : 1}><div className="admin-filter-row">
          <AdminSelect label="대화 유형" value={kind} onChange={setKind} options={[{ value: 'all', label: '전체' }, { value: 'direct', label: '1:1 대화' }, { value: 'group', label: '모임 대화' }]} />
          <AdminFilterReset onReset={() => { setQuery(''); setKind('all'); }} />
        </div></AdminFilterBar><AdminTableSummary shown={rows.length} loaded={data.conversations.length} /></div>
      <div className="admin-card-list" aria-label="대화방 목록">
        {rows.map(room => {
          const roomLabel = label(room);
          const latest = data.messages.filter(message => message.conversation_id === room.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
          return <button key={room.id} type="button" className="admin-card" data-conversation-id={room.id} aria-label={`${roomLabel.primary} 상세 대화 보기`}
            onClick={event => { play('selection'); trigger.current = event.currentTarget; setSelected(room); }}>
            <span className="admin-card-top"><span className="admin-card-title">{roomLabel.primary}</span><span className="admin-card-chevron" aria-hidden>›</span></span>
            {latest && <span className="admin-card-excerpt">{displayName(profiles.get(latest.sender_id), latest.sender_id)} · {latest.body || '(내용 없음)'}</span>}
            <span className="admin-card-meta"><span>{roomLabel.secondary}</span><span>{latest ? '최근 메시지' : '대화 개설'} · {formatDate(latest?.created_at ?? room.created_at)}</span></span>
          </button>;
        })}
        {!rows.length && <div className="admin-empty">조건에 맞는 대화방이 없습니다.</div>}
      </div>
      {!noMore && <button type="button" className="admin-reset" disabled={loadingMore} onClick={() => { play('selection'); onLoadMore(); }}>{loadingMore ? '불러오는 중…' : '대화방 더 보기'}</button>}
    </div>
    {selected && selectedLabel && <AdminConversationDetail key={selected.id} conversationId={selected.id} title={selectedLabel.primary} subtitle={selectedLabel.secondary}
      profiles={data.profiles} localMessages={localPreview ? data.messages : undefined} refreshSignal={refreshSignal} onUser={onUser} onClose={() => setSelected(null)} />}
  </section>;
}

export function AdminConversationDetail({ conversationId, title, subtitle, profiles = [], localMessages, refreshSignal = 0, onUser, onClose }: {
  conversationId: string; title: string; subtitle?: string; profiles?: AdminProfile[]; localMessages?: AdminMessage[]; refreshSignal?: number;
  onUser: (id: string) => void; onClose?: () => void;
}) {
  const { play } = useInteractionFeedback();
  const [retry, setRetry] = useState(0);
  const [response, setResponse] = useState<{ key: string; page?: AdminConversationPage; error?: string }>({ key: '' });
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState('');
  const revision = useRef(0);
  const pendingMore = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const key = JSON.stringify([conversationId, refreshSignal, retry]);
  const page = response.key === key ? response.page : undefined;
  const error = response.key === key ? response.error : undefined;
  const namedProfiles = useMemo(() => new Map([...profiles, ...(page?.profiles ?? [])].map(profile => [profile.id, profile])), [profiles, page?.profiles]);

  useEffect(() => { heading.current?.focus(); }, [conversationId]);
  useEffect(() => {
    const generation = ++revision.current;
    pendingMore.current = false;
    const rows = localMessages?.filter(message => message.conversation_id === conversationId).sort((a, b) => b.created_at.localeCompare(a.created_at));
    const request = rows ? Promise.resolve({ rows, total: rows.length, profiles: [] }) : loadAdminConversationMessages(supabase, conversationId);
    void request.then(next => { if (revision.current === generation) { setMoreBusy(false); setMoreError(''); setResponse({ key, page: next }); } })
      .catch(() => { if (revision.current === generation) { setMoreBusy(false); setMoreError(''); setResponse({ key, error: '대화를 불러오지 못했습니다. 권한과 연결 상태를 확인해주세요.' }); } });
    return () => { revision.current = generation + 1; };
  }, [conversationId, key, localMessages]);

  const more = async () => {
    if (!page || pendingMore.current) return;
    const generation = revision.current;
    pendingMore.current = true; setMoreBusy(true); setMoreError('');
    try {
      const next = await loadAdminConversationMessages(supabase, conversationId, page.rows.length);
      if (revision.current !== generation) return;
      const known = new Set(page.rows.map(row => row.id));
      setResponse({ key, page: { rows: [...page.rows, ...next.rows.filter(row => !known.has(row.id))], total: next.total, profiles: [...page.profiles, ...next.profiles] } });
    } catch {
      if (revision.current === generation) setMoreError('이전 대화를 불러오지 못했습니다. 다시 시도해주세요.');
    } finally {
      if (revision.current === generation) { pendingMore.current = false; setMoreBusy(false); }
    }
  };

  return <section className="admin-meetup-detail" aria-label="상세 대화">
    {onClose && <button type="button" className="admin-reset admin-back-button" onClick={() => { play('selection'); onClose(); }}>← 대화방 목록</button>}
    <div className="admin-detail-heading"><h2 ref={heading} tabIndex={-1}>{title}</h2><p className="admin-muted">{subtitle ?? '선택한 대화방의 메시지와 참여자 이력을 확인합니다.'}</p></div>
    <div className="admin-detail-content">
      <div className="admin-detail-record-head"><div><h3>대화 내용</h3><p className="admin-muted">오래된 메시지부터 시간순으로 표시합니다.</p></div>
        <button type="button" className="admin-reset" aria-label="대화 새로고침" onClick={() => { play('selection'); setRetry(value => value + 1); }}>새로고침</button>
      </div>
      {error ? <div role="alert" className="admin-meetup-error">{error}<button type="button" className="admin-reset" onClick={() => { play('selection'); setRetry(value => value + 1); }}>다시 시도</button></div>
        : !page ? <div role="status" className="admin-empty">대화를 불러오는 중입니다.</div> : <>
          <div className="admin-table-summary" role="status">전체 {page.total.toLocaleString()}개 메시지 · {page.rows.length.toLocaleString()}개 표시</div>
          {!!moreError && <div role="alert" className="admin-meetup-error">{moreError}</div>}
          {page.rows.length < page.total && <button type="button" className="admin-reset" aria-label="이전 대화 더 보기" disabled={moreBusy} onClick={() => { play('selection'); return more(); }}>{moreBusy ? '불러오는 중…' : '이전 대화 더 보기'}</button>}
          <div className="admin-meetup-activity" aria-label="시간순 메시지">
            {[...page.rows].reverse().map(message => <article key={message.id}>
              <div className="admin-detail-record-meta"><button type="button" className="admin-inline-button" onClick={() => { play('selection'); onUser(message.sender_id); }}>{displayName(namedProfiles.get(message.sender_id), message.sender_id)}</button>
                <time className="admin-muted" dateTime={message.created_at}>{formatDate(message.created_at)}</time></div>
              <p className="admin-meetup-body">{message.body || '(내용 없음)'}</p>
            </article>)}
            {!page.rows.length && <div className="admin-empty">이 대화방에 아직 메시지가 없습니다.</div>}
          </div>
          <details className="admin-context-details" onToggle={() => play('selection')}><summary>문제 추적 정보</summary><p>대화 ID {conversationId}</p></details>
        </>}
    </div>
  </section>;
}
