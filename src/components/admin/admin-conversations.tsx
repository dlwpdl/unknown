import { useEffect, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { FlatList, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { useAdminConversations } from '@/hooks/use-admin-conversations';
import { adminOptionKeys } from '@/lib/admin';
import type { ConversationFilters } from '@/lib/admin-conversations';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES } from '@/lib/mock';
import { ConversationButton, ConversationDialog, ConversationPicker, ConversationState } from './admin-conversation-controls';
import { ConversationCaseRow, ConversationReviewPanel, ConversationThread, type ConversationDraft } from './admin-conversation-panels';
import { conversationStyles as styles } from './admin-conversation-styles';

type Period = 'week' | 'today' | 'all';
const PERIODS = [{ value: 'week', label: '최근 7일' }, { value: 'today', label: '오늘' }, { value: 'all', label: '전체 기간' }];
const KINDS = [{ value: 'all', label: '모든 대화' }, { value: 'direct', label: '1:1 대화' }, { value: 'group', label: '그룹 대화' }];
const RISKS = [{ value: 'all', label: '모든 위험 수준' }, { value: 'high', label: '높음·긴급' }, { value: 'medium', label: '보통' }, { value: 'low', label: '낮음' }, { value: 'none', label: '감지 신호 없음' }];
const SCOPES = [{ value: 'pending', label: '검토 필요' }, { value: 'all', label: '전체 대화' }, { value: 'done', label: '검토 완료' }] as const;
const CITIES_OPTIONS = [{ value: 'all', label: '전체 도시' }, ...CITIES.map((city) => ({ value: city.id, label: city.name })), { value: 'unknown', label: '도시 미등록' }];
function sinceForPeriod(period: Period) {
  if (period === 'all') return null;
  const date = new Date();
  if (period === 'today') date.setHours(0, 0, 0, 0);
  else date.setDate(date.getDate() - 7);
  return date.toISOString();
}

export function AdminConversationsView({ onUser, refreshSignal }: { onUser: (id: string) => void; refreshSignal: number }) {
  const { play } = useInteractionFeedback();
  const [filters, setFilters] = useState<ConversationFilters>(() => ({ city: 'all', scope: 'pending', kind: 'all', risk: 'all', since: sinceForPeriod('week'), query: '', sort: 'risk' }));
  const [period, setPeriod] = useState<Period>('week');
  const [search, setSearch] = useState('');
  const [width, setWidth] = useState(0);
  const [threadOpen, setThreadOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<{ period: Period; kind: ConversationFilters['kind']; risk: ConversationFilters['risk']; since: string | null }>({ period: 'week', kind: 'all', risk: 'all', since: filters.since });
  const [drafts, setDrafts] = useState<Record<string, ConversationDraft>>({});
  const [focus, setFocus] = useState<{ roomId: string; messageId: string } | null>(null);
  const state = useAdminConversations(filters, refreshSignal);
  const wide = width >= 960, narrow = width < 640;
  const focusId = focus?.roomId === state.selectedId ? focus.messageId : null;
  const room = state.detail?.conversation;
  const draft = room ? drafts[room.id] ?? { status: room.status, note: room.review?.note ?? '' } : null;

  useEffect(() => {
    const timer = setTimeout(() => setFilters((current) => current.query === search ? current : { ...current, query: search }), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const updateFilter = (next: Partial<ConversationFilters>) => {
    setFilters((current) => ({ ...current, ...next }));
    setThreadOpen(false); setReviewOpen(false); setFocus(null);
  };
  const reset = () => {
    setSearch(''); setPeriod('week');
    updateFilter({ city: 'all', scope: 'pending', kind: 'all', risk: 'all', since: sinceForPeriod('week'), query: '', sort: 'risk' });
  };
  const focusSignal = async (messageId: string) => {
    if (!state.selectedId) return;
    const roomId = state.selectedId;
    setReviewOpen(false);
    const loaded = await state.loadMessages(messageId);
    if (loaded) setFocus({ roomId, messageId });
    else play('warning');
  };
  const save = async () => {
    if (!room || !draft) return;
    const id = room.id, submitted = draft;
    const saved = await state.saveReview(submitted.status, submitted.note);
    if (saved) {
      play('success');
      setDrafts((current) => {
        if (current[id] && (current[id].note !== submitted.note || current[id].status !== submitted.status)) return current;
        const next = { ...current }; delete next[id]; return next;
      });
    } else play('warning');
  };
  const review = state.detail && draft ? <ConversationReviewPanel key={state.detail.conversation.id} detail={state.detail} draft={draft}
    saving={state.saving} saveError={state.saveError} notice={state.notice} inModal={!wide} loadingMessages={state.loadingMessages}
    onDraft={(next) => setDrafts((current) => ({ ...current, [state.detail!.conversation.id]: next }))} onSave={() => void save()}
    onReload={state.reloadDetail} onSignal={(id) => void focusSignal(id)} onUser={(id) => { setReviewOpen(false); onUser(id); }} /> : null;

  return <View testID="admin-conversations" style={styles.root} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
    <View style={styles.heading}><View style={styles.grow}><Text accessibilityRole="header" style={styles.pageTitle}>대화 조사</Text>
      <Text style={styles.subtitle}>대화 단위로 좁히고, 앞뒤 맥락을 함께 확인하세요.</Text></View>
      {!!state.page && <Text style={styles.highCount}>높은 위험 신호 {state.page.counts.high.toLocaleString()}건</Text>}
    </View>
    <View style={styles.toolbar}>
      <ConversationPicker testID="conversation-city" label="참여자 등록 도시" value={filters.city} options={CITIES_OPTIONS} onChange={(city) => updateFilter({ city })} />
      <View style={styles.segments} accessibilityRole="tablist" accessibilityLabel="대화 검토 범위">
        {SCOPES.map((scope) => <Pressable key={scope.value} testID={`conversation-scope-${scope.value}`} accessibilityRole="tab" accessibilityLabel={scope.label}
          aria-selected={filters.scope === scope.value} tabIndex={filters.scope === scope.value ? 0 : -1}
          {...(Platform.OS === 'web' ? { onKeyDown: adminOptionKeys } : {})}
          onPress={() => { play('selection'); updateFilter({ scope: scope.value }); }} style={({ pressed }) => [styles.segment, filters.scope === scope.value && styles.segmentSelected, pressed && styles.pressed]}>
          <Text style={[styles.segmentText, filters.scope === scope.value && styles.segmentTextSelected]}>{scope.label} {state.page?.counts[scope.value]?.toLocaleString() ?? '…'}</Text>
        </Pressable>)}
      </View>
      <Text style={styles.filterSummary}>{PERIODS.find((entry) => entry.value === period)?.label} · {KINDS.find((entry) => entry.value === filters.kind)?.label}</Text>
      <ConversationButton testID="conversation-filters" label="상세 필터" onPress={() => { setFilterDraft({ period, kind: filters.kind, risk: filters.risk, since: filters.since }); setFilterOpen(true); }}>
        <SymbolView name={{ ios: 'line.3.horizontal.decrease', web: 'filter_list' }} size={16} tintColor={Colors.admin.textSecondary} /><Text style={styles.buttonText}>상세 필터{period !== 'week' || filters.kind !== 'all' || filters.risk !== 'all' ? ' · 적용 중' : ''}</Text>
      </ConversationButton>
    </View>
    <View style={styles.workbench}>
      {(!narrow || !threadOpen) && <View testID="conversation-list" accessibilityLabel="대화방 목록" style={[styles.list, narrow && styles.fullPanel]}>
        <View style={styles.listTools}><View style={styles.search}>
          <SymbolView name={{ ios: 'magnifyingglass', web: 'search' }} size={16} tintColor={Colors.admin.textSecondary} />
          <TextInput testID="conversation-search" accessibilityLabel="이름과 대화 내용 검색" placeholder="이름·대화 내용 검색" placeholderTextColor={Colors.admin.textSecondary}
            value={search} onFocus={() => play('selection')} onChangeText={setSearch} onSubmitEditing={() => setFilters((current) => current.query === search ? current : { ...current, query: search })} style={styles.searchInput} />
          {!!search && <ConversationButton testID="conversation-search-clear" label="검색어 지우기" onPress={() => setSearch('')} style={styles.iconButton}><SymbolView name={{ ios: 'xmark', web: 'close' }} size={14} tintColor={Colors.admin.textSecondary} /></ConversationButton>}
        </View><View style={styles.listCaption}><Text style={styles.caption}>대화 {state.page?.counts[filters.scope]?.toLocaleString() ?? '…'}개</Text>
          <ConversationPicker compact testID="conversation-sort" label="대화 정렬" value={filters.sort} options={[{ value: 'risk', label: '위험 신호 우선' }, { value: 'recent', label: '최근 대화순' }]}
            onChange={(sort) => updateFilter({ sort: sort as ConversationFilters['sort'] })} />
        </View></View>
        {state.loading ? <ConversationState testID="conversation-list-loading" loading title="목록을 불러오는 중이에요." /> : !state.page ? <ConversationState title="대화 목록을 열 수 없어요." body={state.listError} action="다시 시도" onAction={state.reloadList} /> :
          <FlatList testID="conversation-case-list" style={styles.scroll} data={state.page.rows} keyExtractor={(item) => item.id} extraData={state.selectedId}
            renderItem={({ item }) => <ConversationCaseRow room={item} selected={item.id === state.selectedId} onPress={() => {
              state.setSelectedId(item.id); setFocus(null); setThreadOpen(true);
              if (Platform.OS === 'web') requestAnimationFrame(() => document.getElementById('conversation-thread-title')?.focus({ preventScroll: true }));
            }} />}
            ListEmptyComponent={<ConversationState title="조건에 맞는 대화가 없어요." body="도시나 위험 수준을 바꾸거나 전체 대화에서 다시 확인하세요." action="필터 초기화" onAction={reset} />}
            ListFooterComponent={<View style={styles.listFooter}>
              {!!state.listError && <Text accessibilityRole="alert" style={styles.error}>{state.listError}</Text>}
              {state.page.nextOffset != null && <ConversationButton testID="conversation-list-more" label={state.loadingMore ? '불러오는 중…' : '대화 더 보기'} disabled={state.loadingMore} busy={state.loadingMore} onPress={() => void state.loadMore()} />}
              <Text style={styles.caption}>불러온 대화 {state.page.rows.length.toLocaleString()}개</Text>
            </View>} />}
        <View style={styles.listFooter}><Text style={styles.caption}>신고 여부와 관계없이 전체 대화를 조사할 수 있어요.</Text></View>
      </View>}
      {(!narrow || threadOpen) && <ConversationThread detail={state.detail} loading={state.detailLoading} error={state.detailError} loadingMessages={state.loadingMessages}
        narrow={narrow} showReviewButton={!wide} focusId={focusId} onBack={() => { setThreadOpen(false); setReviewOpen(false); }}
        onReview={() => setReviewOpen(true)} onEarlier={() => void state.loadMessages()} onLatest={() => { setFocus(null); void state.loadMessages(null, true); }}
        onFirstSignal={() => { const signal = state.detail?.signals[0]; if (signal) void focusSignal(signal.message_id); }} onRetry={state.reloadDetail} />}
      {wide && (review ?? <View style={styles.review}><ConversationState title="조사 기록" body="대화를 선택하면 신호와 검토 이력이 표시돼요." /></View>)}
    </View>
    {!!state.notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{state.notice}</Text>}
    <Text style={styles.footer}>대화 열람과 검토 기록이 남아요. AI 신호의 최종 판단은 운영자가 해요.</Text>
    <ConversationDialog title="조사 기록" visible={reviewOpen && !wide} onClose={() => setReviewOpen(false)} review testID="conversation-review-dialog">
      {review ?? <ConversationState loading title="조사 기록을 불러오는 중이에요." />}
    </ConversationDialog>
    <ConversationDialog title="대화 필터" visible={filterOpen} onClose={() => setFilterOpen(false)} testID="conversation-filter-dialog">
      <ScrollView contentContainerStyle={styles.filterContent}>
        <Text style={styles.sectionLabel}>기간</Text><ConversationPicker testID="conversation-period" label="기간" value={filterDraft.period} options={PERIODS}
          onChange={(value) => { const next = value as Period; setFilterDraft((current) => ({ ...current, period: next, since: sinceForPeriod(next) })); }} />
        <Text style={styles.sectionLabel}>대화 종류</Text><ConversationPicker testID="conversation-kind" label="대화 종류" value={filterDraft.kind} options={KINDS}
          onChange={(kind) => setFilterDraft((current) => ({ ...current, kind: kind as ConversationFilters['kind'] }))} />
        <Text style={styles.sectionLabel}>위험 신호</Text><ConversationPicker testID="conversation-risk" label="위험 신호" value={filterDraft.risk} options={RISKS}
          onChange={(risk) => setFilterDraft((current) => ({ ...current, risk: risk as ConversationFilters['risk'] }))} />
        <Text style={styles.caption}>참여자의 등록 도시를 기준으로 찾아요. 서로 다른 도시의 대화는 양쪽 도시에서 확인할 수 있고, 미등록 대화도 볼 수 있어요.</Text>
      </ScrollView>
      <View style={styles.filterActions}><ConversationButton testID="conversation-filter-reset" label="초기화" onPress={() => setFilterDraft({ period: 'week', kind: 'all', risk: 'all', since: sinceForPeriod('week') })} />
        <ConversationButton testID="conversation-filter-apply" label="필터 적용" primary onPress={() => {
          setPeriod(filterDraft.period); updateFilter({ kind: filterDraft.kind, risk: filterDraft.risk, since: filterDraft.since }); setFilterOpen(false);
        }} /></View>
    </ConversationDialog>
  </View>;
}
