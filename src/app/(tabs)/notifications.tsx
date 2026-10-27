import { useLanguage } from '@/hooks/use-language';
import { GlingLoader } from '@/components/gling-loader';
import { Pressable, FlatList } from '@/components/analytics-controls';
import { useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Image } from 'expo-image';
import { LayoutAnimation, Linking, Platform, StyleSheet, UIManager, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProfileAvatarButton } from '@/components/profile-avatar-button';
import { GlassSurface } from '@/components/glass-surface';
import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { LoginPanel } from '@/components/login-panel';
import { TabContent } from '@/components/tab-content';
import { ControlStyles, IconSize, controlPresentation } from '@/constants/design-system';
import { MaxContentWidth, Spacing, TabBarHeight } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { loadNotificationActors, loadNotificationSnippets, loadNotifications, markNotificationsRead, type AppNotification } from '@/lib/community-data';
import { relativeTime } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES } from '@/lib/mock';
import { recordProductEvent } from '@/lib/product-analytics';
import { supabase } from '@/lib/supabase';
import { englishNotificationBody, loadAdminDashboardOrigin, openNotificationTarget } from '@/lib/notification-preferences';
import { BELL_KEEP_UNREAD_KINDS, NOTIFICATION_PAGE_SIZE, appendPage, autoReadIds, groupInbox, inboxSections, inboxTab, itemUnread, likeActors, mergeHeadPage, type InboxItem, type InboxTab } from '@/lib/notification-inbox';
import { subscribeNotificationChanges } from '@/lib/notification-refresh';

type Token = readonly unknown[];
type Operation = { token: Token; userId: string | null; active: boolean; pending: Promise<void> | null; trailing: boolean; serial: number };
type Person = { nickname: string; avatarUrl?: string };
type Entry = { type: 'header'; key: string; title: string } | { type: 'item'; key: string; item: InboxItem<AppNotification> };

// Actor photos are never looked up for meetup or admin rows (privacy of applicants and reporters).
const actorAllowed = (row: AppNotification) => row.category !== 'meetups' && !row.kind.startsWith('meetup_') && row.kind !== 'safety_alert' && !row.kind.startsWith('admin_');
const KIND_SYMBOLS: Record<string, SymbolViewProps['name']> = {
  likes: { ios: 'heart.fill', android: 'favorite', web: 'favorite' },
  comment: { ios: 'bubble.left.fill', android: 'chat_bubble', web: 'chat_bubble' },
  reply: { ios: 'arrowshape.turn.up.left.fill', android: 'reply', web: 'reply' },
  meetups: { ios: 'person.2.fill', android: 'group', web: 'group' },
  admin: { ios: 'shield.lefthalf.filled', android: 'admin_panel_settings', web: 'shield' },
  city_food: { ios: 'fork.knife', android: 'restaurant', web: 'restaurant' },
  city_places: { ios: 'mappin.and.ellipse', android: 'place', web: 'place' },
  trending: { ios: 'flame.fill', android: 'local_fire_department', web: 'local_fire_department' },
  tag: { ios: 'number', android: 'tag', web: 'tag' },
  weekly_ranking: { ios: 'trophy.fill', android: 'emoji_events', web: 'emoji_events' },
  system: { ios: 'bell.fill', android: 'notifications', web: 'notifications' },
};
const CITY_LABELS: Record<string, string> = { city_food: '맛집', city_places: '가볼 만한 곳·행사', trending: '지금 뜨는 글', interests: '관심 태그', nearby: '근처 새 모임', weekly_ranking: '이번 주 인기 글' };
function symbolFor(item: InboxItem<AppNotification>, admin: boolean) {
  const row = item.lead;
  if (admin) return KIND_SYMBOLS.admin;
  if (item.kind === 'likes') return KIND_SYMBOLS.likes;
  if (row.kind === 'comment' || row.kind === 'reply') return KIND_SYMBOLS[row.kind];
  if (row.kind.startsWith('meetup') || row.category === 'meetups' || row.category === 'nearby') return KIND_SYMBOLS.meetups;
  if (row.kind === 'trending_hashtag' || row.category === 'interests') return KIND_SYMBOLS.tag;
  return KIND_SYMBOLS[row.category] ?? KIND_SYMBOLS.system;
}

export default function NotificationsScreen() {
  const { tr, t, locale: appLocale, language } = useLanguage();
  const theme = useTheme();
  const router = useRouter();
  const { isAuthed, isAdmin, isAuthLoading, me, signInApple, signInKakao, signInGoogle, signInDev, authError } = useAuth();
  const userId = isAuthed && !isAuthLoading ? me.id : null;
  const focused = useIsFocused();
  // Rows are cached per account/city so returning to the tab never flashes a loader; work is still scoped to the focused visit.
  const cache = useMemo(() => [userId, me.cityId, isAdmin] as const, [userId, me.cityId, isAdmin]);
  const token = useMemo(() => [cache, focused] as const, [cache, focused]);
  const live = useRef<Operation | null>(null);
  useLayoutEffect(() => {
    const operation: Operation = { token, userId, active: !!userId && focused, pending: null, trailing: false, serial: 0 };
    live.current = operation;
    return () => { operation.active = false; };
  }, [token, userId, focused]);
  const valid = useCallback((operation: Operation) => operation.active && live.current === operation, []);
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const motion = useRef(reducedMotion);
  useLayoutEffect(() => { motion.current = reducedMotion; }, [reducedMotion]);
  const [result, setResult] = useState<{ token: Token; rows: AppNotification[]; hasMore: boolean } | null>(null);
  const [extras, setExtras] = useState<{ token: Token; people: Map<string, Person>; snippets: Map<string, string> } | null>(null);
  const rows = useMemo(() => result?.token === cache ? result.rows : [], [result, cache]);
  const rowsRef = useRef(rows);
  useLayoutEffect(() => { rowsRef.current = rows; }, [rows]);
  // Rows unread when this visit began stay under 새 알림 until the tab loses focus, even after they are marked read.
  const [fresh, setFresh] = useState<{ token: Token; ids: Set<string> } | null>(null);
  const freshIds = fresh?.token === token ? fresh.ids : new Set(rows.filter(row => row.read_at == null).map(row => row.id));
  const [tab, setTab] = useState<InboxTab>('mine');
  const activeTab: InboxTab = tab === 'admin' && !isAdmin ? 'mine' : tab;
  const tabRef = useRef(activeTab);
  useLayoutEffect(() => { tabRef.current = activeTab; }, [activeTab]);
  const knownRows = useRef<{ userId: string; cityId?: string; ids: Set<string> } | null>(null);
  const [pulling, setPulling] = useState(false);
  const [failure, setFailure] = useState<Token | null>(null);
  const error = failure === token;
  const initialLoading = rows.length === 0 && result?.token !== cache && !error;
  const loadingMore = useRef(false);

  const markRead = useCallback(async (operation: Operation, ids: string[]) => {
    if (!ids.length || !valid(operation)) return;
    await markNotificationsRead(supabase, ids);
    if (!valid(operation)) return;
    const now = new Date().toISOString(), read = new Set(ids);
    setResult(previous => previous?.token === cache ? { ...previous, rows: previous.rows.map(row => read.has(row.id) && row.read_at == null ? { ...row, read_at: now } : row) } : previous);
  }, [cache, valid]);

  const loadExtras = useCallback((operation: Operation, page: AppNotification[]) => {
    // 댓글·답글을 남긴 사람의 사진과 글 제목·댓글 한 줄을 함께 보여준다(실패하면 첫 글자와 본문만).
    void Promise.all([
      loadNotificationActors(supabase, page.filter(actorAllowed).map((item) => item.actor_id ?? '')),
      loadNotificationSnippets(supabase, page).catch(() => new Map<string, string>()),
    ]).then(([people, snippets]) => {
      if (!valid(operation)) return;
      setExtras(previous => {
        const same = previous?.token === cache;
        return { token: cache, people: new Map([...(same ? previous.people : []), ...people]), snippets: new Map([...(same ? previous.snippets : []), ...snippets]) };
      });
    }).catch(() => undefined);
  }, [cache, valid]);

  const load = useCallback((background = false, manual = false) => {
    const operation = live.current;
    if (!operation || operation.token !== token || !valid(operation) || !userId) return;
    if (operation.pending) { operation.trailing = true; return operation.pending; }
    const pending = (async () => {
      do {
        operation.trailing = false;
        ++operation.serial;
        if (manual) setPulling(true);
        try {
          const next = await loadNotifications(supabase, userId);
          if (!valid(operation)) return;
          setFailure(null);
          const known = knownRows.current;
          if (background && known?.userId === userId && known.cityId === me.cityId && next.some((item) => !known.ids.has(item.id)) && !motion.current && Platform.OS !== 'web') {
            if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);
            LayoutAnimation.configureNext({ duration: 220,
              create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity },
              update: { type: LayoutAnimation.Types.easeOut },
            });
          }
          knownRows.current = { userId, cityId: me.cityId, ids: new Set(next.map((item) => item.id)) };
          const unread = [...rowsRef.current, ...next].filter(row => row.read_at == null).map(row => row.id);
          setFresh(previous => ({ token, ids: new Set([...(previous?.token === token ? previous.ids : []), ...unread]) }));
          setResult(previous => {
            const merged = mergeHeadPage(next, previous?.token === cache ? previous.rows : []);
            // Older pages kept from scrolling keep their own "more" state; otherwise a full page means more may follow.
            return { token: cache, rows: merged, hasMore: merged.length > next.length ? previous?.hasMore ?? true : next.length === NOTIFICATION_PAGE_SIZE };
          });
          loadExtras(operation, next);
          // A failed read mark keeps the rows unread; it is not a failed refresh.
          await markRead(operation, autoReadIds(next, tabRef.current, isAdmin)).catch(() => {});
        } catch {
          if (valid(operation)) setFailure(token);
        } finally {
          if (valid(operation)) setPulling(false);
        }
        background = true; manual = false;
      } while (valid(operation) && operation.trailing);
    })().finally(() => { if (operation.pending === pending) operation.pending = null; });
    operation.pending = pending;
    return pending;
  }, [token, cache, userId, me.cityId, isAdmin, valid, loadExtras, markRead]);

  const loadMore = useCallback(async () => {
    const operation = live.current, last = rows[rows.length - 1];
    if (!operation || !valid(operation) || !userId || !last || !(result?.token === cache && result.hasMore) || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const page = await loadNotifications(supabase, userId, last.created_at);
      if (!valid(operation)) return;
      setResult(previous => previous?.token === cache ? { token: cache, rows: appendPage(previous.rows, page), hasMore: page.length === NOTIFICATION_PAGE_SIZE } : previous);
      loadExtras(operation, page);
      await markRead(operation, autoReadIds(page, tabRef.current, isAdmin)).catch(() => {});
    } catch {
      if (valid(operation)) setFailure(token);
    } finally { loadingMore.current = false; }
  }, [rows, result, cache, token, userId, isAdmin, valid, loadExtras, markRead]);

  const latestLoad = useRef(load);
  useLayoutEffect(() => { latestLoad.current = load; }, [load]);
  const subscription = useRef<{ userId: string | null; active: boolean; stop: () => void } | null>(null);
  useLayoutEffect(() => {
    const lifetime = { userId, active: !!userId, stop: () => {} };
    subscription.current = lifetime;
    return () => { lifetime.active = false; lifetime.stop(); };
  }, [userId]);
  useEffect(() => {
    const lifetime = subscription.current;
    if (!userId || !lifetime?.active || lifetime.userId !== userId) return;
    const stop = subscribeNotificationChanges(supabase, userId, change => {
      if (lifetime.active && subscription.current === lifetime && (change === 'INSERT' || change === 'refresh')) void latestLoad.current(true);
    });
    lifetime.stop = stop;
    return stop;
  }, [userId]);
  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);

  const cityName = tr(CITIES.find(city => city.id === me.cityId)?.name ?? '내 도시');
  const items = useMemo(() => groupInbox(rows.filter(row => inboxTab(row, isAdmin) === activeTab)), [rows, activeTab, isAdmin]);
  const tabs = useMemo(() => {
    const unread = (key: InboxTab) => groupInbox(rows.filter(row => inboxTab(row, isAdmin) === key)).filter(itemUnread).length;
    return ([['mine', tr("내 소식")], ['city', tr("{0} 소식", cityName)], ...(isAdmin ? [['admin', tr("관리자")]] : [])] as [InboxTab, string][])
      .map(([key, label]) => ({ key, label, unread: unread(key) }));
  }, [rows, isAdmin, cityName, tr]);
  const markable = rows.filter(row => row.read_at == null && !BELL_KEEP_UNREAD_KINDS.has(row.kind) && inboxTab(row, isAdmin) !== null).map(row => row.id);
  const sections = inboxSections(items, freshIds);
  const entries: Entry[] = [
    ...(sections.fresh.length ? [{ type: 'header', key: 'header-fresh', title: tr("새 알림") } as const] : []),
    ...sections.fresh.map(item => ({ type: 'item', key: item.key, item }) as const),
    ...(sections.earlier.length ? [{ type: 'header', key: 'header-earlier', title: tr("지난 알림") } as const] : []),
    ...sections.earlier.map(item => ({ type: 'item', key: item.key, item }) as const),
  ];

  const selectTab = (key: InboxTab) => {
    play('selection');
    if (key === activeTab) return;
    if (!reducedMotion && Platform.OS !== 'web') { if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true); LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); }
    setTab(key);
    const operation = live.current;
    if (operation && operation.token === token) void markRead(operation, autoReadIds(rows, key, isAdmin)).catch(() => {});
  };
  const markAll = () => {
    const operation = live.current;
    if (!operation || operation.token !== token || !valid(operation) || !markable.length) return;
    play('selection');
    void markRead(operation, markable).catch(() => play('warning'));
  };
  const open = (item: InboxItem<AppNotification>) => {
    const operation = live.current;
    if (!operation || operation.token !== token || !valid(operation) || !userId || !rows.some(row => row.id === item.lead.id)) return;
    play('selection');
    void recordProductEvent(supabase, { kind: 'notification_inbox_open', targetId: item.lead.id, platform: Platform.OS }).catch(() => {});
    void markRead(operation, item.rows.filter(row => row.read_at == null).map(row => row.id)).catch(() => {});
    // A row without a valid destination is only marked read.
    openNotificationTarget({ route: item.lead.route, notification: item.lead, adminAccount: isAdmin,
      navigate: route => router.navigate(route as never), dashboardOrigin: () => loadAdminDashboardOrigin(supabase, userId), openURL: url => Linking.openURL(url) });
  };

  if (isAuthLoading) return <TabContent style={styles.screen}><GlingLoader color={theme.accent} style={styles.center} /></TabContent>;
  if (!isAuthed) return <LoginPanel reason={t.auth.reasonNotifications} onApple={signInApple} onKakao={signInKakao} onGoogle={signInGoogle} onDevLogin={signInDev} loading={isAuthLoading} error={authError} />;

  const person = (row: AppNotification) => row.actor_id && actorAllowed(row) && extras?.token === cache ? extras.people.get(row.actor_id) : undefined;
  const nameOf = (row: AppNotification) => person(row)?.nickname ?? /^(.+?)님이 /.exec(row.body)?.[1];
  const textOf = (item: InboxItem<AppNotification>) => {
    const row = item.lead;
    if (item.kind === 'likes') {
      const others = likeActors(item).length - 1, name = nameOf(row), comment = row.kind === 'comment_like' || row.target_type === 'comment';
      if (others > 0 && name) return others === 1
        ? tr(comment ? "{0}님 외 1명이 내 댓글을 좋아해요" : "{0}님 외 1명이 내 글을 좋아해요", name)
        : tr(comment ? "{0}님 외 {1}명이 내 댓글을 좋아해요" : "{0}님 외 {1}명이 내 글을 좋아해요", name, others);
    }
    return language === 'en' ? englishNotificationBody(row, tr, person(row)?.nickname) : tr(row.body);
  };

  const renderRow = (item: InboxItem<AppNotification>) => {
    const row = item.lead, admin = activeTab === 'admin', unread = itemUnread(item);
    const body = textOf(item), title = row.title ? tr(row.title) : null;
    const snippet = row.target_id && extras?.token === cache ? extras.snippets.get(row.target_id) : undefined;
    const time = relativeTime(row.created_at, undefined, appLocale);
    const tag = activeTab === 'city' ? tr(CITY_LABELS[row.category] ?? (row.kind === 'trending_hashtag' ? '지금 뜨는 글' : '글링 안내')) : null;
    const people = item.kind === 'likes' ? likeActors(item).slice(0, 2).map(id => ({ id, actor: actorAllowed(row) && extras?.token === cache ? extras.people.get(id) : undefined })) : [];
    const chip = row.kind === 'comment' || row.kind === 'reply' ? tr("답글 달기") : row.kind === 'meetup_request' ? tr("신청 보기") : null;
    const label = [tag, title, body, snippet, time, unread ? tr("읽지 않음") : null].filter(Boolean).join(', ');
    return <Pressable analyticsId="app_tabs_notifications.pressable.2" onPress={() => open(item)} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [styles.row, { backgroundColor: unread ? theme.backgroundSelected : 'transparent', opacity: pressed ? 0.82 : 1 }]}>
      {unread && <View style={[styles.unreadDot, { backgroundColor: theme.accent }]} />}
      {people.length > 1
        ? <View style={styles.stack}>{people.map(({ id, actor }, index) => <Avatar key={id} actor={actor} fallback={nameOf(item.rows.find(other => other.actor_id === id) ?? row)} small style={index === 0 ? styles.stackFirst : styles.stackSecond} />)}
            <KindBadge symbol={symbolFor(item, admin)} /></View>
        : <View style={styles.avatarWrap}><Avatar actor={person(row)} fallback={actorAllowed(row) && !admin ? nameOf(row) : undefined} symbol={symbolFor(item, admin)} />
            {(person(row) || (actorAllowed(row) && nameOf(row))) && !admin && <KindBadge symbol={symbolFor(item, admin)} />}</View>}
      <View style={styles.rowBody}>
        {tag && <ThemedText type="caption" themeColor="textSecondary">{tag}</ThemedText>}
        {title && <ThemedText type="smallBold">{title}</ThemedText>}
        <ThemedText>{body}</ThemedText>
        {snippet && <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{snippet}</ThemedText>}
        <ThemedText type="small" themeColor="textSecondary">{time}</ThemedText>
        {chip && <Pressable analyticsId="app_tabs_notifications.pressable.4" accessibilityRole="button" accessibilityLabel={chip} onPress={() => open(item)}
          style={({ pressed }) => [ControlStyles.pill, styles.chip, controlPresentation(theme, { tone: row.kind === 'meetup_request' ? 'primary' : 'secondary', pressed }).container]}>
          <ThemedText type="smallBold" style={controlPresentation(theme, { tone: row.kind === 'meetup_request' ? 'primary' : 'secondary' }).text}>{chip}</ThemedText>
        </Pressable>}
      </View>
    </Pressable>;
  };

  return (
    <TabContent style={styles.screen}>
      <SafeAreaView style={{ flex: 1, width: '100%' }}><View style={styles.safeArea}>
        <View style={[styles.header, { backgroundColor: theme.background }]}>
          <ThemedText accessibilityRole="header" style={styles.headerTitle}>{t.notifications.title}</ThemedText>
          <ProfileAvatarButton />
          <GlassSurface tone="control" interactive style={styles.settingsGlass}><Pressable analyticsId="app_tabs_notifications.pressable.1" accessibilityRole="button" accessibilityLabel={tr("알림 설정")} onPress={() => { play('selection'); router.push('/profile/notifications'); }} style={({ pressed }) => [styles.settings, { backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent' }]}>
            <SymbolView name={{ ios: 'slider.horizontal.3', android: 'tune', web: 'tune' }} size={22} tintColor={theme.text} />
          </Pressable></GlassSurface>
        </View>
        <View style={styles.tabs} accessibilityRole="tablist">
          {tabs.map(({ key, label, unread }) => {
            const selected = key === activeTab, look = controlPresentation(theme, { selected });
            return <Pressable analyticsId="app_tabs_notifications.pressable.3" key={key} accessibilityRole="tab" accessibilityState={{ selected }}
              accessibilityLabel={unread ? tr("{0}, 안 읽은 알림 {1}개", label, unread) : label} onPress={() => selectTab(key)}
              style={({ pressed }) => [ControlStyles.pill, styles.tab, controlPresentation(theme, { selected, pressed }).container]}>
              <ThemedText type="smallBold" style={look.text} numberOfLines={1}>{label}</ThemedText>
              {unread > 0 && <View style={[styles.count, { backgroundColor: selected ? theme.accentInk : theme.accent }]}>
                <ThemedText type="caption" style={{ color: selected ? theme.accent : theme.accentInk, fontWeight: '700' }}>{unread > 99 ? '99+' : unread}</ThemedText>
              </View>}
            </Pressable>;
          })}
          {markable.length > 0 && <Pressable analyticsId="app_tabs_notifications.pressable.5" accessibilityRole="button" onPress={markAll}
            style={({ pressed }) => [ControlStyles.pill, styles.markAll, controlPresentation(theme, { tone: 'ghost', pressed }).container]}>
            <ThemedText type="smallBold" themeColor="accent">{tr("모두 읽음")}</ThemedText>
          </Pressable>}
        </View>
        {error && rows.length > 0 && <Pressable analyticsId="app_tabs_notifications.pressable.6" accessibilityRole="alert" onPress={() => { play('selection'); void load(false, true); }}
          style={[styles.banner, { backgroundColor: theme.backgroundElement, borderColor: theme.line }]}>
          <ThemedText type="small">{tr("알림을 새로 불러오지 못했어요. 눌러서 다시 시도해 주세요.")}</ThemedText>
        </Pressable>}
        {initialLoading ? (
          <GlingLoader color={theme.accent} style={styles.center} accessibilityLabel={t.notifications.loading} />
        ) : (
          <FlatList analyticsId="app_tabs_notifications.flatlist.1"
            data={entries}
            keyExtractor={({ key }) => key}
            contentContainerStyle={styles.list}
            refreshing={pulling}
            onRefresh={() => void load(false, true)}
            onEndReached={() => void loadMore()}
            onEndReachedThreshold={0.4}
            ListHeaderComponent={activeTab === 'city' ? <View style={[styles.cityNote, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="small" themeColor="textSecondary">{tr("추천은 하루 최대 8개, 푸시는 낮 시간에만 와요. 종류별로 설정에서 끌 수 있어요.")}</ThemedText>
            </View> : undefined}
            ListEmptyComponent={error
              ? <StateCard kind="error" title={t.notifications.loadError} body={t.notifications.loadErrorBody} actionLabel={t.notifications.retry} onAction={() => void load(false, true)} />
              : <StateCard title={activeTab === 'admin' ? tr("관리자 알림이 없어요") : activeTab === 'city' ? tr("{0} 소식이 아직 없어요", cityName) : t.notifications.empty}
                  body={activeTab === 'mine' ? t.notifications.emptyBody : tr("새 알림이 오면 여기에서 볼 수 있어요.")} />}
            renderItem={({ item }) => item.type === 'header'
              ? <ThemedText accessibilityRole="header" type="smallBold" style={[styles.groupTitle, { color: theme.textSecondary }]}>{item.title}</ThemedText>
              : renderRow(item.item)}
          />
        )}
      </View></SafeAreaView>
    </TabContent>
  );
}

function Avatar({ actor, fallback, symbol, small, style }: { actor?: Person; fallback?: string; symbol?: SymbolViewProps['name']; small?: boolean; style?: object }) {
  const theme = useTheme();
  return <View style={[small ? styles.avatarSmall : styles.avatar, { backgroundColor: theme.backgroundElement, borderColor: theme.background }, style]}>
    {actor?.avatarUrl
      ? <Image source={{ uri: actor.avatarUrl }} style={styles.avatarImage} contentFit="cover" accessibilityIgnoresInvertColors />
      : fallback ? <ThemedText type="smallBold" themeColor="textSecondary">{fallback.trim().slice(0, 1)}</ThemedText>
      : <SymbolView name={symbol ?? KIND_SYMBOLS.system} size={IconSize.toolbar} tintColor={theme.accent} />}
  </View>;
}

function KindBadge({ symbol }: { symbol: SymbolViewProps['name'] }) {
  const theme = useTheme();
  return <View style={[styles.kindBadge, { backgroundColor: theme.accent, borderColor: theme.background }]}>
    <SymbolView name={symbol} size={10} tintColor={theme.accentInk} />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center' },
  safeArea: { flex: 1, width: '100%', alignSelf: 'center', maxWidth: MaxContentWidth },
  header: { minHeight: 56, paddingHorizontal: Spacing.three, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  headerTitle: { flex: 1, fontSize: 22, lineHeight: 30, fontWeight: '700' },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
  tab: { flexDirection: 'row', gap: Spacing.one, borderWidth: 1 },
  count: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  markAll: { marginLeft: 'auto', paddingHorizontal: Spacing.two },
  banner: { marginHorizontal: Spacing.three, marginBottom: Spacing.two, padding: Spacing.three, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, minHeight: 44, justifyContent: 'center' },
  cityNote: { borderRadius: 12, padding: Spacing.three, marginTop: Spacing.two },
  list: { paddingHorizontal: Spacing.three, paddingBottom: TabBarHeight + Spacing.three, flexGrow: 1 },
  groupTitle: { marginTop: Spacing.four, marginBottom: Spacing.two },
  row: { minHeight: 72, paddingVertical: Spacing.three, paddingLeft: Spacing.three, paddingRight: Spacing.two, flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three, borderRadius: 12 },
  unreadDot: { position: 'absolute', left: 4, top: 30, width: 6, height: 6, borderRadius: 3 },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  chip: { alignSelf: 'flex-start', marginTop: Spacing.two, borderWidth: 1 },
  avatarWrap: { width: 44, height: 44 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarSmall: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'absolute' },
  avatarImage: { width: '100%', height: '100%' },
  stack: { width: 44, height: 44 },
  stackFirst: { left: 0, top: 0 },
  stackSecond: { right: 0, bottom: 0 },
  kindBadge: { position: 'absolute', right: -3, bottom: -3, width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  settings: { minWidth: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  settingsGlass: { borderRadius: 22 },
  center: { flex: 1, alignSelf: 'stretch' },
});
