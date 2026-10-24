import { useLanguage } from '@/hooks/use-language';
import { GlingLoader } from '@/components/gling-loader';
import { Pressable, FlatList } from '@/components/analytics-controls';
import { useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { Image } from 'expo-image';
import { Alert, LayoutAnimation, Linking, Platform, StyleSheet, UIManager, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProfileAvatarButton } from '@/components/profile-avatar-button';
import { GlassSurface } from '@/components/glass-surface';
import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { LoginPanel } from '@/components/login-panel';
import { TabContent } from '@/components/tab-content';
import { Depth, MaxContentWidth, Spacing, TabBarHeight } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { loadNotificationActors, loadNotifications, markNotificationsRead, type AppNotification } from '@/lib/community-data';
import { relativeTime } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { recordProductEvent } from '@/lib/product-analytics';
import { supabase } from '@/lib/supabase';
import { NOTIFICATION_CATEGORIES, adminDashboardUrl, isAdminNotificationKind, notificationRoute } from '@/lib/notification-preferences';
import { subscribeNotificationChanges } from '@/lib/notification-refresh';

type InboxFilter = 'all' | 'personal' | 'admin';
type Token = readonly unknown[];
type Operation = { token: Token; userId: string | null; active: boolean; pending: Promise<void> | null; trailing: boolean; serial: number };

export default function NotificationsScreen({ embedded = false }: { embedded?: boolean } = {}) {
  const { tr, t, locale: appLocale } = useLanguage();
  const INBOX_FILTERS: { key: InboxFilter; label: string }[] = [
    { key: 'all', get label() { return tr("전체"); } }, { key: 'personal', get label() { return tr("내 소식"); } }, { key: 'admin', get label() { return tr("관리자"); } },
  ];
  const theme = useTheme();
  const router = useRouter();
  const { isAuthed, isAdmin, isAuthLoading, me, signInApple, signInKakao, signInGoogle, signInDev, authError } = useAuth();
  const userId = isAuthed && !isAuthLoading ? me.id : null;
  const focused = useIsFocused();
  const token = useMemo(() => [userId, me.cityId, isAdmin, focused] as const, [userId, me.cityId, isAdmin, focused]);
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
  const [result, setResult] = useState<{ token: Token; rows: AppNotification[] } | null>(null);
  const [actorResult, setActors] = useState<{ token: Token; people: Map<string, { nickname: string; avatarUrl?: string }> } | null>(null);
  const rows = result?.token === token ? result.rows : [];
  const [filter, setFilter] = useState<InboxFilter>('all');
  const visibleRows = filter === 'all' ? rows : rows.filter((item) => isAdminNotificationKind(item.kind) === (filter === 'admin'));
  const newRows = visibleRows.filter((item) => item.read_at == null);
  const displayRows = [...newRows, ...visibleRows.filter((item) => item.read_at != null)];
  const knownRows = useRef<{ userId: string; cityId?: string; ids: Set<string> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<Token | null>(null);
  const error = failure === token;
  const initialLoading = rows.length === 0 && (loading || (result?.token !== token && !error));

  const load = useCallback((background = false) => {
    const operation = live.current;
    if (!operation || operation.token !== token || !valid(operation) || !userId) return;
    if (operation.pending) { operation.trailing = true; return operation.pending; }
    const pending = (async () => {
      do {
        operation.trailing = false;
        const request = ++operation.serial;
        if (!background) setLoading(true);
        setFailure(null);
        try {
          const next = await loadNotifications(supabase, userId);
          if (!valid(operation)) return;
          const known = knownRows.current;
          if (background && known?.userId === userId && known.cityId === me.cityId && next.some((item) => !known.ids.has(item.id)) && !motion.current && Platform.OS !== 'web') {
            if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);
            LayoutAnimation.configureNext({ duration: 220,
              create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity },
              update: { type: LayoutAnimation.Types.easeOut },
            });
          }
          knownRows.current = { userId, cityId: me.cityId, ids: new Set(next.map((item) => item.id)) };
          setResult({ token, rows: next });
          // 댓글·답글을 남긴 사람의 사진을 목록에 함께 보여준다(사진이 없으면 첫 글자).
          void loadNotificationActors(supabase, next.filter(item => item.category !== 'meetups' && !item.kind.startsWith('meetup_')).map((item) => item.actor_id ?? ''))
            .then(people => { if (valid(operation) && operation.serial === request) setActors({ token, people }); })
            .catch(() => undefined);
          const unread = next.filter((item) => item.read_at == null).map(({ id }) => id);
          if (unread.length) await markNotificationsRead(supabase, unread);
          // 이번에 처음 본 알림은 화면을 떠날 때까지 '새 소식'에 남겨 둔다.
        } catch {
          if (valid(operation)) setFailure(token);
        } finally {
          if (valid(operation)) setLoading(false);
        }
        background = true;
      } while (valid(operation) && operation.trailing);
    })().finally(() => { if (operation.pending === pending) operation.pending = null; });
    operation.pending = pending;
    return pending;
  }, [token, userId, me.cityId, valid]);

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

  if (isAuthLoading) return <TabContent style={styles.screen}><GlingLoader color={theme.accent} style={styles.center} /></TabContent>;
  if (!isAuthed) return <LoginPanel reason={t.auth.reasonNotifications} onApple={signInApple} onKakao={signInKakao} onGoogle={signInGoogle} onDevLogin={signInDev} loading={isAuthLoading} error={authError} />;

  return (
    <TabContent style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        {!embedded && <View style={[styles.header, { backgroundColor: theme.background }]}>
          <ThemedText accessibilityRole="header" style={styles.headerTitle}>{t.notifications.title}</ThemedText>
          <ProfileAvatarButton />
          <GlassSurface tone="control" interactive style={styles.settingsGlass}><Pressable analyticsId="app_tabs_notifications.pressable.1" accessibilityRole="button" accessibilityLabel={tr("알림 설정")} onPress={() => { play('selection'); router.push('/profile/notifications'); }} style={({ pressed }) => [styles.settings, { backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent' }]}>
            <SymbolView name={{ ios: 'slider.horizontal.3', android: 'tune', web: 'tune' }} size={22} tintColor={theme.text} />
          </Pressable></GlassSurface>
        </View>}
        {isAdmin && !initialLoading && <View style={styles.filters} accessibilityLabel={tr("알림 종류")}>
          {INBOX_FILTERS.map(({ key, label }) => {
            const selected = filter === key;
            return <Pressable analyticsId="app_tabs_notifications.pressable.3" key={key} accessibilityRole="button"
              accessibilityLabel={tr("{0} 알림", (label))} accessibilityState={{ selected }}
              onPress={() => { play('selection'); if (key !== filter) { if (!reducedMotion) { if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true); LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); } setFilter(key); } }}
              style={({ pressed }) => [styles.filter, Depth.control, { backgroundColor: selected ? theme.accent : theme.card, borderColor: selected ? theme.accentDepth : theme.line, borderBottomWidth: 3, }]}>
              <ThemedText type="smallBold" style={{ color: selected ? theme.accentInk : theme.textSecondary }}>{label}</ThemedText>
            </Pressable>;
          })}
        </View>}
        {initialLoading ? (
          <GlingLoader color={theme.accent} style={styles.center} accessibilityLabel={t.notifications.loading} />
        ) : (
          <FlatList analyticsId="app_tabs_notifications.flatlist.1"
            data={displayRows}
            keyExtractor={({ id }) => id}
            contentContainerStyle={[styles.list, embedded && styles.embeddedList]}
            refreshing={loading}
            onRefresh={() => void load()}
            ListEmptyComponent={error
              ? <StateCard kind="error" title={t.notifications.loadError} body={t.notifications.loadErrorBody} actionLabel={t.notifications.retry} onAction={() => void load()} />
              : <StateCard title={filter === 'admin' ? tr("관리자 알림이 없어요") : filter === 'personal' ? tr("내 소식이 없어요") : t.notifications.empty}
                  body={tr(filter === 'all' ? t.notifications.emptyBody : '새 알림이 오면 여기에서 볼 수 있어요.')} />}
            renderItem={({ item, index }) => {
              const admin = isAdminNotificationKind(item.kind);
              const actor = item.actor_id && !admin && item.category !== 'meetups' && !item.kind.startsWith('meetup_') && actorResult?.token === token ? actorResult.people.get(item.actor_id) : undefined;
              return <View>
                {(index === 0 || index === newRows.length) && <ThemedText type="smallBold" style={[styles.groupTitle, { color: theme.textSecondary }]}>{index === 0 && newRows.length > 0 ? tr("새 소식") : newRows.length > 0 ? tr("이전 소식") : tr("모든 알림")}</ThemedText>}
                <Pressable analyticsId="app_tabs_notifications.pressable.2"
                onPress={() => {
                  const operation = live.current;
                  if (!operation || operation.token !== token || !valid(operation) || !rows.some(row => row.id === item.id)) return;
                  play('selection');
                  void recordProductEvent(supabase, { kind: 'notification_inbox_open', targetId: item.id, platform: Platform.OS }).catch(() => {});
                  const dashboard = adminDashboardUrl(item.route, isAdmin && admin);
                  if (dashboard) {
                    void Linking.openURL(dashboard).catch(() => Alert.alert(tr("관리자 대시보드를 열지 못했어요"), tr("Tailscale 연결과 Mac의 관리자 서버를 확인해 주세요.")));
                    return;
                  }
                  const route = notificationRoute(item.route, item);
                  router.push((route?.startsWith('/admin') ? '/notifications' : route ?? '/notifications') as never);
                }}
                accessibilityRole="button"
                accessibilityLabel={tr("{0}, {1}{2}", (admin ? tr('관리자 알림') : tr('내 소식')), (item.title ? `${item.title}, ` : ''), tr(item.body))}
                style={({ pressed }) => [
                  styles.row,
                  item.read_at == null && Depth.card,
                  { borderColor: theme.line, borderWidth: item.read_at == null ? 1 : 0, backgroundColor: item.read_at == null ? theme.card : 'transparent', marginBottom: item.read_at == null ? Spacing.two : 0, opacity: pressed ? 0.82 : 1, },
                ]}>
                <View style={styles.rowLine}>
                  <View style={[styles.avatar, { backgroundColor: admin ? theme.backgroundSelected : theme.backgroundElement, borderColor: theme.line }]}>
                      {admin
                        ? <SymbolView name={{ ios: 'shield.lefthalf.filled', android: 'admin_panel_settings', web: 'shield' }} size={20} tintColor={theme.accent} />
                        : actor?.avatarUrl
                        ? <Image source={{ uri: actor.avatarUrl }} style={styles.avatarImage} contentFit="cover" accessibilityIgnoresInvertColors />
                        : <ThemedText type="smallBold" themeColor="textSecondary">{(actor?.nickname ?? tr("글")).trim().slice(0, 1)}</ThemedText>}
                  </View>
                  <View style={styles.rowBody}>
                    <View style={styles.meta}>
                      <ThemedText type="smallBold" style={{ color: admin ? theme.accent : theme.textSecondary }}>
                        {admin ? tr("관리자 알림") : NOTIFICATION_CATEGORIES.find(category => category.key === item.category)?.label ?? tr("글링 안내")}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">{relativeTime(item.created_at, undefined, appLocale)}</ThemedText>
                    </View>
                    {item.title && <ThemedText type="smallBold">{item.title}</ThemedText>}
                    <ThemedText>{tr(item.body)}</ThemedText>
                  </View>
                </View>
                </Pressable>
              </View>
            }}
          />
        )}
      </SafeAreaView>
    </TabContent>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center' },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  header: { minHeight: 56, paddingHorizontal: Spacing.three, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  headerTitle: { flex: 1, fontSize: 22, lineHeight: 30, fontWeight: '700' },
  filters: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  filter: { minHeight: 44, borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: Spacing.three, paddingBottom: TabBarHeight + Spacing.three, flexGrow: 1 },
  embeddedList: { paddingBottom: Spacing.five },
  groupTitle: { marginTop: Spacing.four, marginBottom: Spacing.two },
  row: { minHeight: 88, paddingVertical: Spacing.three, paddingHorizontal: Spacing.two, gap: Spacing.two, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
  rowLine: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  rowBody: { flex: 1, minWidth: 0, gap: Spacing.two },
  avatar: { width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: Spacing.two },
  settings: { minWidth: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  settingsGlass: { borderRadius: 22 },
  center: { flex: 1, alignSelf: 'stretch' },
});
