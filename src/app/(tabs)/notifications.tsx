import { GlingLoader } from '@/components/gling-loader';
import { Pressable, FlatList } from '@/components/analytics-controls';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
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
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { loadNotificationActors, loadNotifications, markNotificationsRead, type AppNotification } from '@/lib/community-data';
import { relativeTime } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';
import { NOTIFICATION_CATEGORIES, adminDashboardUrl, isAdminNotificationKind, notificationRoute } from '@/lib/notification-preferences';

type InboxFilter = 'all' | 'personal' | 'admin';
const INBOX_FILTERS: { key: InboxFilter; label: string }[] = [
  { key: 'all', label: '전체' }, { key: 'personal', label: '내 소식' }, { key: 'admin', label: '관리자' },
];

export default function NotificationsScreen({ embedded = false }: { embedded?: boolean } = {}) {
  const theme = useTheme();
  const router = useRouter();
  const { isAuthed, isAdmin, isAuthLoading, me, signInApple, signInKakao, signInGoogle, signInDev, authError } = useAuth();
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const [result, setResult] = useState<{ userId: string; rows: AppNotification[] } | null>(null);
  const [actors, setActors] = useState<Map<string, { nickname: string; avatarUrl?: string }>>(new Map());
  const rows = result?.userId === me.id ? result.rows : [];
  const [filter, setFilter] = useState<InboxFilter>('all');
  const visibleRows = filter === 'all' ? rows : rows.filter((item) => isAdminNotificationKind(item.kind) === (filter === 'admin'));
  const newRows = visibleRows.filter((item) => item.read_at == null);
  const displayRows = [...newRows, ...visibleRows.filter((item) => item.read_at != null)];
  const version = useRef(0);
  const knownRows = useRef<{ userId: string; ids: Set<string> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const initialLoading = loading && rows.length === 0;

  const load = useCallback(async (background = false) => {
    const request = ++version.current;
    if (!background) setLoading(true);
    setError(false);
    try {
      const next = await loadNotifications(supabase, me.id);
      if (request !== version.current) return;
      const known = knownRows.current;
      if (background && known?.userId === me.id && next.some((item) => !known.ids.has(item.id)) && !reducedMotion && Platform.OS !== 'web') {
        if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);
        LayoutAnimation.configureNext({ duration: 220,
          create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity },
          update: { type: LayoutAnimation.Types.easeOut },
        });
      }
      knownRows.current = { userId: me.id, ids: new Set(next.map((item) => item.id)) };
      setResult({ userId: me.id, rows: next });
      // 댓글·답글을 남긴 사람의 사진을 목록에 함께 보여준다(사진이 없으면 첫 글자).
      void loadNotificationActors(supabase, next.map((item) => item.actor_id ?? ''))
        .then((people) => { if (request === version.current) setActors(people); })
        .catch(() => undefined);
      const unread = next.filter((item) => item.read_at == null).map(({ id }) => id);
      if (unread.length) {
        await markNotificationsRead(supabase, unread);
        // 이번에 처음 본 알림은 화면을 떠날 때까지 '새 소식'에 남겨 둔다.
      }
    } catch {
      if (request === version.current) setError(true);
    } finally {
      if (request === version.current) setLoading(false);
    }
  }, [me.id, reducedMotion]);

  useFocusEffect(useCallback(() => {
    if (!isAuthed) return;
    void load();
    const channel = supabase.channel(`notification-list:${me.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${me.id}` }, () => void load(true))
      .subscribe();
    return () => { version.current += 1; void supabase.removeChannel(channel); };
  }, [isAuthed, load, me.id]));

  if (isAuthLoading) return <TabContent style={styles.screen}><GlingLoader color={theme.accent} style={styles.center} /></TabContent>;
  if (!isAuthed) return <LoginPanel reason={t.auth.reasonNotifications} onApple={signInApple} onKakao={signInKakao} onGoogle={signInGoogle} onDevLogin={signInDev} loading={isAuthLoading} error={authError} />;

  return (
    <TabContent style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        {!embedded && <View style={[styles.header, { backgroundColor: theme.background }]}>
          <ThemedText accessibilityRole="header" style={styles.headerTitle}>{t.notifications.title}</ThemedText>
          <ProfileAvatarButton />
          <GlassSurface tone="control" interactive style={styles.settingsGlass}><Pressable analyticsId="app_tabs_notifications.pressable.1" accessibilityRole="button" accessibilityLabel="알림 설정" onPress={() => { play('selection'); router.push('/profile/notifications'); }} style={({ pressed }) => [styles.settings, { backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent' }]}>
            <SymbolView name={{ ios: 'slider.horizontal.3', android: 'tune', web: 'tune' }} size={22} tintColor={theme.text} />
          </Pressable></GlassSurface>
        </View>}
        {isAdmin && !initialLoading && <View style={styles.filters} accessibilityLabel="알림 종류">
          {INBOX_FILTERS.map(({ key, label }) => {
            const selected = filter === key;
            return <Pressable analyticsId="app_tabs_notifications.pressable.3" key={key} accessibilityRole="button"
              accessibilityLabel={`${label} 알림`} accessibilityState={{ selected }}
              onPress={() => { play('selection'); if (key !== filter) { if (!reducedMotion) { if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true); LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); } setFilter(key); } }}
              style={({ pressed }) => [styles.filter, Depth.control, { backgroundColor: selected ? theme.accent : theme.card, borderColor: selected ? theme.accentDepth : theme.line, borderBottomWidth: 3, transform: [{ translateY: pressed ? 2 : 0 }] }]}>
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
              : <StateCard title={filter === 'admin' ? '관리자 알림이 없어요' : filter === 'personal' ? '내 소식이 없어요' : t.notifications.empty}
                  body={filter === 'all' ? t.notifications.emptyBody : '새 알림이 오면 여기에서 볼 수 있어요.'} />}
            renderItem={({ item, index }) => {
              const admin = isAdminNotificationKind(item.kind);
              const actor = item.actor_id && !admin ? actors.get(item.actor_id) : undefined;
              return <View>
                {(index === 0 || index === newRows.length) && <ThemedText type="smallBold" style={[styles.groupTitle, { color: theme.textSecondary }]}>{index === 0 && newRows.length > 0 ? '새 소식' : newRows.length > 0 ? '이전 소식' : '모든 알림'}</ThemedText>}
                <Pressable analyticsId="app_tabs_notifications.pressable.2"
                onPress={() => {
                  play('selection');
                  const dashboard = adminDashboardUrl(item.route, isAdmin && admin);
                  if (dashboard) {
                    void Linking.openURL(dashboard).catch(() => Alert.alert('관리자 대시보드를 열지 못했어요', 'Tailscale 연결과 Mac의 관리자 서버를 확인해 주세요.'));
                    return;
                  }
                  const route = notificationRoute(item.route);
                  router.push((route?.startsWith('/admin') ? '/notifications' : route ?? '/notifications') as never);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${admin ? '관리자 알림' : '내 소식'}, ${item.body}`}
                style={({ pressed }) => [
                  styles.row,
                  item.read_at == null && Depth.card,
                  { borderColor: theme.line, borderWidth: item.read_at == null ? 1 : 0, backgroundColor: item.read_at == null ? theme.card : 'transparent', marginBottom: item.read_at == null ? Spacing.two : 0, opacity: pressed ? 0.82 : 1, transform: [{ translateY: pressed && item.read_at == null ? 2 : 0 }] },
                ]}>
                <View style={styles.rowLine}>
                  <View style={[styles.avatar, { backgroundColor: admin ? theme.backgroundSelected : theme.backgroundElement, borderColor: theme.line }]}>
                      {admin
                        ? <SymbolView name={{ ios: 'shield.lefthalf.filled', android: 'admin_panel_settings', web: 'shield' }} size={20} tintColor={theme.accent} />
                        : actor?.avatarUrl
                        ? <Image source={{ uri: actor.avatarUrl }} style={styles.avatarImage} contentFit="cover" accessibilityIgnoresInvertColors />
                        : <ThemedText type="smallBold" themeColor="textSecondary">{(actor?.nickname ?? '글').trim().slice(0, 1)}</ThemedText>}
                  </View>
                  <View style={styles.rowBody}>
                    <View style={styles.meta}>
                      <ThemedText type="smallBold" style={{ color: admin ? theme.accent : theme.textSecondary }}>
                        {admin ? '관리자 알림' : NOTIFICATION_CATEGORIES.find(category => category.key === item.category)?.label ?? '글링 안내'}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">{relativeTime(item.created_at)}</ThemedText>
                    </View>
                    <ThemedText>{item.body}</ThemedText>
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
