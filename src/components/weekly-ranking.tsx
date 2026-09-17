import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { count } from '@/i18n/ko';
import { loadWeeklyRanking, type WeeklyRanking as Ranking } from '@/lib/community-data';
import { supabase } from '@/lib/supabase';

// 한 주 동안 가장 많이 읽히고 이야기된 글. 서버에서 월요일에 찍어 고정한 값이라
// 스크롤할 때마다 순서가 바뀌지 않는다.
export function WeeklyRanking({ cityId, onOpen }: { cityId: string; onOpen: (postId: string) => void }) {
  const theme = useTheme();
  const [ranking, setRanking] = useState<Ranking>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await loadWeeklyRanking(supabase, cityId);
        if (active) setRanking(next);
      } catch { if (active) setRanking(null); }
    })();
    return () => { active = false; };
  }, [cityId]);

  if (!ranking) return null;
  return (
    <View style={styles.wrap}>
      <ThemedText accessibilityRole="header" type="smallBold" style={styles.heading}>이번 주 많이 읽은 글</ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        {ranking.entries.map((entry) => (
          <Pressable
            key={entry.postId}
            onPress={() => onOpen(entry.postId)}
            accessibilityRole="button"
            accessibilityLabel={`${entry.rank}위 ${entry.title}, ${entry.nickname}, 조회 ${count(entry.views)}`}
            style={({ pressed }) => [styles.card, { backgroundColor: theme.card, borderColor: theme.line },
              pressed && { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold" style={[styles.rank, { color: entry.rank <= 3 ? theme.accent : theme.textSecondary }]}>
              {entry.rank}
            </ThemedText>
            <View style={styles.body}>
              <ThemedText type="smallBold" numberOfLines={2}>{entry.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.meta} numberOfLines={1}>
                {entry.nickname} · 조회 {count(entry.views)} · 댓글 {count(entry.comments)}
              </ThemedText>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two, marginBottom: Spacing.three },
  heading: { fontSize: 15, paddingHorizontal: Spacing.three },
  rail: { gap: Spacing.two, paddingHorizontal: Spacing.three },
  card: { width: 232, minHeight: 84, flexDirection: 'row', gap: Spacing.two, padding: Spacing.three, borderWidth: 1, borderRadius: 12 },
  rank: { fontSize: 20, lineHeight: 24, minWidth: 22, fontVariant: ['tabular-nums'] },
  body: { flex: 1, minWidth: 0, gap: 2 },
  meta: { fontSize: 12 },
});
