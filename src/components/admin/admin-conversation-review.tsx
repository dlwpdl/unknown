import { useEffect, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { useAdminConversations } from '@/hooks/use-admin-conversations';
import { adminOptionKeys } from '@/lib/admin';
import type { ConversationFilters } from '@/lib/admin-conversations';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES } from '@/lib/mock';
import { ConversationButton, ConversationDialog, ConversationPicker, ConversationState } from './admin-conversation-controls';
import { CONVERSATION_REVIEW_INFO, ConversationCaseRow, ConversationReviewPanel, ConversationThread, type ConversationDraft } from './admin-conversation-panels';
import { conversationStyles as styles } from './admin-conversation-styles';

type Period = 'week' | 'today' | 'all';
const PERIODS = [{ value: 'week', label: '최근 7일' }, { value: 'today', label: '오늘' }, { value: 'all', label: '전체 기간' }];
const KINDS = [{ value: 'all', label: '모든 대화' }, { value: 'direct', label: '1:1 대화' }, { value: 'group', label: '그룹 대화' }];
const RISKS = [{ value: 'all', label: '모든 위험 수준' }, { value: 'high', label: '높음·긴급' }, { value: 'medium', label: '보통' }, { value: 'low', label: '낮음' }, { value: 'none', label: '감지 신호 없음' }];
const SCOPES = [{ value: 'pending', label: '검토 필요' }, { value: 'all', label: '전체' }, { value: 'done', label: '검토 완료' }] as const;
const SORTS = [{ value: 'risk', label: '위험 신호 우선' }, { value: 'recent', label: '최근 대화순' }];
const CITIES_OPTIONS = [{ value: 'all', label: '전체 도시' }, ...CITIES.map((city) => ({ value: city.id, label: city.name })), { value: 'unknown', label: '도시 미등록' }];
function sinceForPeriod(period: Period) {
  if (period === 'all') return null;
  const date = new Date();
  if (period === 'today') date.setHours(0, 0, 0, 0);
  else date.setDate(date.getDate() - 7);
  return date.toISOString();
}

export function AdminConversationReviewView({ onUser, refreshSignal }: { onUser: (id: string) => void; refreshSignal: number }) {
  const { play } = useInteractionFeedback();
  // Default is every period: this one screen replaced the all-time room monitor, so the first view must not shrink.
  const [filters, setFilters] = useState<ConversationFilters>(() => ({ city: 'all', scope: 'pending', kind: 'all', risk: 'all', since: null, query: '', sort: 'risk' }));
  const [period, setPeriod] = useState<Period>('all');
  const [search, setSearch] = useState('');
  const [width, setWidth] = useState(0);
  const [threadOpen, setThreadOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  type FilterDraft = Pick<ConversationFilters, 'city' | 'kind' | 'risk' | 'since' | 'sort'> & { period: Period };
  const blankDraft: FilterDraft = { period: 'all', city: 'all', kind: 'all', risk: 'all', since: null, sort: 'risk' };
  const [filterDraft, setFilterDraft] = useState<FilterDraft>(blankDraft);
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
    setSearch(''); setPeriod('all');
    updateFilter({ city: 'all', scope: 'pending', kind: 'all', risk: 'all', since: null, query: '', sort: 'risk' });
  };
  const filtered = period !== 'all' || filters.city !== 'all' || filters.kind !== 'all' || filters.risk !== 'all' || filters.sort !== 'risk';
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
    <View style={styles.toolbar}>
      <View style={styles.segments} accessibilityRole="tablist" accessibilityLabel="대화 검토 범위">
        {SCOPES.map((scope) => <Pressable key={scope.value} testID={`conversation-scope-${scope.value}`} accessibilityRole="tab" accessibilityLabel={scope.label}
          aria-selected={filters.scope === scope.value} tabIndex={filters.scope === scope.value ? 0 : -1}
          {...(Platform.OS === 'web' ? { onKeyDown: adminOptionKeys } : {})}
          onPress={() => { play('selection'); updateFilter({ scope: scope.value }); }} style={({ pressed }) => [styles.segment, filters.scope === scope.value && styles.segmentSelected, pressed && styles.pressed]}>
          <Text style={[styles.segmentText, filters.scope === scope.value && styles.segmentTextSelected]}>{scope.label} {state.page?.counts[scope.value]?.toLocaleString() ?? '…'}</Text>
        </Pressable>)}
      </View>
    </View>
    <View style={[styles.workbench, local.workbench]}>
      {(!narrow || !threadOpen) && <View testID="conversation-list" accessibilityLabel="대화방 목록" style={[styles.list, narrow && styles.fullPanel]}>
        <View style={[styles.listTools, local.listTools]}><View style={[styles.search, styles.grow]}>
          <SymbolView name={{ ios: 'magnifyingglass', web: 'search' }} size={16} tintColor={Colors.admin.textSecondary} />
          <TextInput testID="conversation-search" accessibilityLabel="이름과 대화 내용 검색" placeholder="이름, 대화 내용" placeholderTextColor={Colors.admin.textSecondary}
            value={search} onFocus={() => play('selection')} onChangeText={setSearch} onSubmitEditing={() => setFilters((current) => current.query === search ? current : { ...current, query: search })} style={styles.searchInput} />
          {!!search && <ConversationButton testID="conversation-search-clear" label="검색어 지우기" onPress={() => setSearch('')} style={styles.iconButton}><SymbolView name={{ ios: 'xmark', web: 'close' }} size={14} tintColor={Colors.admin.textSecondary} /></ConversationButton>}
        </View>
          <ConversationButton testID="conversation-filters" label={`상세 필터${filtered ? ', 적용 중' : ''}`} style={local.filterButton}
            onPress={() => { setFilterDraft({ period, city: filters.city, kind: filters.kind, risk: filters.risk, since: filters.since, sort: filters.sort }); setFilterOpen(true); }}>
            <SymbolView name={{ ios: 'line.3.horizontal.decrease', web: 'filter_list' }} size={18} tintColor={filtered ? Colors.admin.accent : Colors.admin.textSecondary} />
            {filtered && <View style={local.filterDot} />}
          </ConversationButton>
        </View>
        {state.loading ? <ConversationState testID="conversation-list-loading" loading title="목록을 불러오는 중이에요." /> : !state.page ? <ConversationState title="대화 목록을 열 수 없어요." body={state.listError} action="다시 시도" onAction={state.reloadList} /> :
          <FlatList testID="conversation-case-list" style={styles.scroll} data={state.page.rows} keyExtractor={(item) => item.id} extraData={state.selectedId}
            renderItem={({ item }) => <ConversationCaseRow room={item} selected={item.id === state.selectedId} onPress={() => {
              state.setSelectedId(item.id); setFocus(null); setThreadOpen(true);
              if (Platform.OS === 'web') requestAnimationFrame(() => document.getElementById('conversation-thread-title')?.focus({ preventScroll: true }));
            }} />}
            ListEmptyComponent={<ConversationState title="조건에 맞는 대화가 없어요." body="검색어나 필터를 바꾸거나 전체 탭에서 다시 확인해 주세요." action="필터 초기화" onAction={reset} />}
            ListFooterComponent={state.listError || state.page.nextOffset != null ? <View style={styles.listFooter}>
              {!!state.listError && <Text accessibilityRole="alert" style={styles.error}>{state.listError}</Text>}
              {state.page.nextOffset != null && <ConversationButton testID="conversation-list-more" label={state.loadingMore ? '불러오는 중…' : '대화 더 보기'} disabled={state.loadingMore} busy={state.loadingMore} onPress={() => void state.loadMore()} />}
            </View> : undefined} />}
      </View>}
      {(!narrow || threadOpen) && <ConversationThread detail={state.detail} loading={state.detailLoading} error={state.detailError} loadingMessages={state.loadingMessages}
        narrow={narrow} showReviewButton={!wide} focusId={focusId} onBack={() => { setThreadOpen(false); setReviewOpen(false); }}
        onReview={() => setReviewOpen(true)} onEarlier={() => void state.loadMessages()} onLatest={() => { setFocus(null); void state.loadMessages(null, true); }}
        onFirstSignal={() => { const signal = state.detail?.signals[0]; if (signal) void focusSignal(signal.message_id); }} onRetry={state.reloadDetail} />}
      {wide && (review ?? <View style={[styles.review, local.reviewEmpty]}><ConversationState title="검토" body="대화를 선택하면 신호와 검토 이력이 보여요." /></View>)}
    </View>
    {!!state.notice && !wide && <Text accessibilityLiveRegion="polite" style={styles.notice}>{state.notice}</Text>}
    <ConversationDialog title="검토" info={CONVERSATION_REVIEW_INFO} visible={reviewOpen && !wide} onClose={() => setReviewOpen(false)} review testID="conversation-review-dialog">
      {review ?? <ConversationState loading title="검토 기록을 불러오는 중이에요." />}
    </ConversationDialog>
    <ConversationDialog title="대화 필터" visible={filterOpen} onClose={() => setFilterOpen(false)} testID="conversation-filter-dialog">
      <ScrollView contentContainerStyle={styles.filterContent}>
        <Text style={styles.sectionLabel}>참여자 등록 도시</Text><ConversationPicker testID="conversation-city" label="참여자 등록 도시" value={filterDraft.city} options={CITIES_OPTIONS}
          onChange={(city) => setFilterDraft((current) => ({ ...current, city }))} />
        <Text style={styles.caption}>서로 다른 도시의 대화는 양쪽 도시에서 보이고, 도시 미등록 대화도 따로 고를 수 있어요.</Text>
        <Text style={styles.sectionLabel}>기간</Text><ConversationPicker testID="conversation-period" label="기간" value={filterDraft.period} options={PERIODS}
          onChange={(value) => { const next = value as Period; setFilterDraft((current) => ({ ...current, period: next, since: sinceForPeriod(next) })); }} />
        <Text style={styles.sectionLabel}>대화 종류</Text><ConversationPicker testID="conversation-kind" label="대화 종류" value={filterDraft.kind} options={KINDS}
          onChange={(kind) => setFilterDraft((current) => ({ ...current, kind: kind as ConversationFilters['kind'] }))} />
        <Text style={styles.sectionLabel}>위험 신호</Text><ConversationPicker testID="conversation-risk" label="위험 신호" value={filterDraft.risk} options={RISKS}
          onChange={(risk) => setFilterDraft((current) => ({ ...current, risk: risk as ConversationFilters['risk'] }))} />
        <Text style={styles.sectionLabel}>정렬</Text><ConversationPicker testID="conversation-sort" label="대화 정렬" value={filterDraft.sort} options={SORTS}
          onChange={(sort) => setFilterDraft((current) => ({ ...current, sort: sort as ConversationFilters['sort'] }))} />
      </ScrollView>
      <View style={styles.filterActions}><ConversationButton testID="conversation-filter-reset" label="초기화" onPress={() => setFilterDraft(blankDraft)} />
        <ConversationButton testID="conversation-filter-apply" label="필터 적용" primary onPress={() => {
          setPeriod(filterDraft.period); updateFilter({ city: filterDraft.city, kind: filterDraft.kind, risk: filterDraft.risk, since: filterDraft.since, sort: filterDraft.sort }); setFilterOpen(false);
        }} /></View>
    </ConversationDialog>
  </View>;
}

const local = StyleSheet.create({
  // The ⓘ popover of the right-hand review column must not be clipped by the workbench edge.
  workbench: { overflow: 'visible' },
  listTools: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  filterButton: { width: 44, paddingHorizontal: 0 },
  filterDot: { position: 'absolute', top: 9, right: 9, width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.admin.accent },
  reviewEmpty: { width: 300 },
});
