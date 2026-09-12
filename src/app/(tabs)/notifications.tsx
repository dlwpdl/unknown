import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { LoginPanel } from '@/components/login-panel';
import { TabContent } from '@/components/tab-content';
import { MaxContentWidth, Spacing, TabBarHeight } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { loadNotifications, markNotificationsRead, type AppNotification } from '@/lib/community-data';
import { supabase } from '@/lib/supabase';
import { NOTIFICATION_CATEGORIES, notificationRoute } from '@/lib/notification-preferences';

export default function NotificationsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isAuthed, isAuthLoading, me, signInApple, signInKakao, signInGoogle, signInDev, authError } = useAuth();
  const [result, setResult] = useState<{ userId: string; rows: AppNotification[] } | null>(null);
  const rows = result?.userId === me.id ? result.rows : [];
  const version = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async (background = false) => {
    const request = ++version.current;
    if (!background) setLoading(true);
    setError(false);
    try {
      const next = await loadNotifications(supabase, me.id);
      if (request !== version.current) return;
      setResult({ userId: me.id, rows: next });
      const unread = next.filter((item) => item.read_at == null).map(({ id }) => id);
      if (unread.length) {
        await markNotificationsRead(supabase, unread);
        if (request !== version.current) return;
        setResult({ userId: me.id, rows: next.map((item) => ({ ...item, read_at: item.read_at ?? new Date().toISOString() })) });
      }
    } catch {
      if (request === version.current) setError(true);
    } finally {
      if (request === version.current) setLoading(false);
    }
  }, [me.id]);

  useFocusEffect(useCallback(() => {
    if (!isAuthed) return;
    void load();
    const channel = supabase.channel(`notification-list:${me.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${me.id}` }, () => void load(true))
      .subscribe();
    return () => { version.current += 1; void supabase.removeChannel(channel); };
  }, [isAuthed, load, me.id]));

  if (isAuthLoading) return <ActivityIndicator color={theme.accent} style={styles.center} />;
  if (!isAuthed) return <LoginPanel reason={t.auth.reasonNotifications} onApple={signInApple} onKakao={signInKakao} onGoogle={signInGoogle} onDevLogin={signInDev} loading={isAuthLoading} error={authError} />;

  return (
    <TabContent style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.header, { borderBottomColor: theme.line }]}>
          <ThemedText type="subtitle">{t.notifications.title}</ThemedText>
          <Pressable accessibilityRole="button" accessibilityLabel="알림 설정" onPress={() => router.push('/profile/notifications')} style={styles.settings}>
            <SymbolView name={{ ios: 'slider.horizontal.3', android: 'tune', web: 'tune' }} size={22} tintColor={theme.text} />
          </Pressable>
        </View>
        {loading ? (
          <ActivityIndicator color={theme.accent} style={styles.center} accessibilityLabel={t.notifications.loading} />
        ) : (
          <FlatList
            data={rows}
            keyExtractor={({ id }) => id}
            contentContainerStyle={styles.list}
            refreshing={loading}
            onRefresh={() => void load()}
            ListEmptyComponent={<ThemedText type="small" themeColor="textSecondary" style={styles.center}>{error ? t.notifications.loadError : t.notifications.empty}</ThemedText>}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => router.push((notificationRoute(item.route) ?? '/notifications') as never)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.row,
                  { borderColor: theme.line, opacity: pressed ? 0.72 : 1 },
                ]}>
                <View style={styles.meta}>
                  <ThemedText type="smallBold" themeColor="textSecondary">{NOTIFICATION_CATEGORIES.find(category => category.key === item.category)?.label ?? '글링 안내'}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{formatDate(item.created_at)}</ThemedText>
                </View>
                <ThemedText>{item.body}</ThemedText>
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
    </TabContent>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center' },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  header: { minHeight: 56, paddingHorizontal: Spacing.three, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  list: { paddingHorizontal: Spacing.three, paddingBottom: TabBarHeight + Spacing.three, flexGrow: 1 },
  row: { minHeight: 88, paddingVertical: Spacing.three, gap: Spacing.two, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  meta: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: Spacing.two },
  settings: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, textAlign: 'center', paddingTop: Spacing.five },
});
