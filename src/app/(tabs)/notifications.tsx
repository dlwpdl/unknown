import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { LoginPanel } from '@/components/login-panel';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, TabBarHeight } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { loadNotifications, markNotificationsRead, type AppNotification } from '@/lib/community-data';
import { supabase } from '@/lib/supabase';

export default function NotificationsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isAuthed, isAuthLoading, me, signInApple, signInKakao, signInGoogle, signInDev, authError } = useAuth();
  const [rows, setRows] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const next = await loadNotifications(supabase, me.id);
      setRows(next);
      const unread = next.filter((item) => item.read_at == null).map(({ id }) => id);
      if (unread.length) {
        await markNotificationsRead(supabase, unread);
        setRows((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? new Date().toISOString() })));
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [me.id]);

  useFocusEffect(useCallback(() => {
    if (!isAuthed) return;
    void load();
  }, [isAuthed, load]));

  if (isAuthLoading) return <ActivityIndicator color={theme.accent} style={styles.center} />;
  if (!isAuthed) return <LoginPanel reason={t.auth.reasonNotifications} onApple={signInApple} onKakao={signInKakao} onGoogle={signInGoogle} onDevLogin={signInDev} loading={isAuthLoading} error={authError} />;

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.header, { borderBottomColor: theme.line }]}>
          <ThemedText type="subtitle">{t.notifications.title}</ThemedText>
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
                disabled={!item.route}
                onPress={() => item.route && router.push(item.route as never)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: theme.card, borderColor: theme.line, opacity: pressed ? 0.72 : 1 },
                ]}>
                <ThemedText>{item.body}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{formatDate(item.created_at)}</ThemedText>
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center' },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  header: { minHeight: 56, paddingHorizontal: Spacing.three, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  list: { padding: Spacing.three, paddingBottom: TabBarHeight + Spacing.three, gap: Spacing.two, flexGrow: 1 },
  row: { minHeight: 72, padding: Spacing.three, gap: Spacing.one, justifyContent: 'center', borderWidth: 1, borderRadius: 12 },
  center: { flex: 1, textAlign: 'center', paddingTop: Spacing.five },
});
