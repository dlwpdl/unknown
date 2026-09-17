import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { count } from '@/i18n/ko';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadWeeklyRanking, type WeeklyRanking as Ranking, type WeeklyRankingEntry } from '@/lib/community-data';
import { supabase } from '@/lib/supabase';

// 한 주 동안 가장 많이 읽히고 이야기된 글. 월요일에 서버에서 찍어 고정한 값이라
// 스크롤할 때마다 순서가 바뀌지 않는다.
//
// 접혔을 때는 제목을 달지 않는다. 바로 위에 "우리 동네의 오늘을 펼치다"가 있어서
// 제목이 둘 연달아 오면 내용은 안 나오고 약속만 두 번 하는 화면이 된다.
// 대신 줄 자체가 "이번 주 N위"라고 스스로를 설명한다.
//
// 누르면 그 글로 가는 게 아니라 펼쳐진다. 움직이는 글자를 눌러 엉뚱한 글로
// 들어가는 일이 없어야 하기 때문이다.
const ROTATE_MS = 3600;
const FADE_MS = 180;
// 서너 편 아래에서는 돌리지 않는다. 두 줄이 번갈아 바뀌는 건 정보가 아니라 소음이다.
const ROTATE_MIN = 4;

export function WeeklyRanking({ cityId, refreshKey, onOpen }: { cityId: string; refreshKey?: number; onOpen: (postId: string) => void }) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const { play } = useInteractionFeedback();
  const [ranking, setRanking] = useState<Ranking>(null);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const [fade] = useState(() => new Animated.Value(1));

  // 순위는 스냅샷이지만 그 안의 글은 지워질 수 있다. 서버가 읽을 때 걸러내므로
  // 화면으로 돌아올 때마다 다시 읽어야 지운 글이 사라진다. 한 번만 읽으면 남아 있게 된다.
  const load = useCallback(async (signal: { active: boolean }) => {
    try {
      const next = await loadWeeklyRanking(supabase, cityId);
      if (signal.active) { setRanking(next); setAt(0); setOpen(false); }
    } catch { if (signal.active) setRanking(null); }
  }, [cityId]);

  useFocusEffect(useCallback(() => {
    const signal = { active: true };
    void load(signal);
    return () => { signal.active = false; };
  }, [load]));

  // 피드를 당겨 새로고침하면 순위도 같이 새로 읽는다.
  useEffect(() => {
    const signal = { active: true };
    void (async () => { if (refreshKey !== undefined) await load(signal); })();
    return () => { signal.active = false; };
  }, [load, refreshKey]);

  const total = ranking?.entries.length ?? 0;
  // 몇 편 안 되면 접어둘 이유가 없다. 처음부터 다 보여준다.
  const rotates = total >= ROTATE_MIN && !reducedMotion;
  const alwaysOpen = total > 0 && total < ROTATE_MIN;
  const expanded = open || alwaysOpen;

  useEffect(() => {
    if (expanded || !rotates) return;
    const timer = setInterval(() => {
      Animated.timing(fade, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(() => {
        setAt((current) => (current + 1) % total);
        Animated.timing(fade, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start();
      });
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [fade, expanded, rotates, total]);

  const toggle = useCallback(() => {
    play('selection');
    setOpen((current) => {
      if (current) { setAt(0); fade.setValue(1); }
      return !current;
    });
  }, [fade, play]);

  if (!ranking || total === 0) return null;
  const showing = ranking.entries[Math.min(at, total - 1)];

  // 몇 편뿐이면 제목 한 줄과 함께 그냥 펼쳐 둔다.
  if (alwaysOpen) {
    return (
      <View style={styles.wrap}>
        <ThemedText accessibilityRole="header" type="smallBold" style={styles.heading}>이번 주 많이 읽은 글</ThemedText>
        <View style={[styles.card, { borderColor: theme.line, backgroundColor: theme.card }]}>
          {ranking.entries.map((entry, index) => (
            <Row key={entry.postId} entry={entry} last={index === total - 1}
              onPress={() => { play('selection'); onOpen(entry.postId); }} />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {expanded && (
        <View style={styles.headRow}>
          <ThemedText accessibilityRole="header" type="smallBold" style={styles.heading}>이번 주 많이 읽은 글</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>접기</ThemedText>
        </View>
      )}

      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? '주간 순위 접기' : `이번 주 많이 읽은 글 ${count(total)}편, 눌러서 전체 보기`}
        style={({ pressed }) => [styles.card, { borderColor: theme.line, backgroundColor: theme.card },
          pressed && { backgroundColor: theme.backgroundElement, transform: [{ scale: reducedMotion ? 1 : 0.985 }] }]}>
        {expanded ? (
          ranking.entries.map((entry, index) => (
            <Row key={entry.postId} entry={entry} last={index === total - 1}
              onPress={() => { play('selection'); onOpen(entry.postId); }} />
          ))
        ) : (
          <Animated.View style={[styles.collapsed, { opacity: fade }]}>
            <ThemedText type="smallBold" style={[styles.label, { color: theme.accent }]}>
              이번 주 {showing.rank}위
            </ThemedText>
            <ThemedText type="small" numberOfLines={1} style={styles.title}>{showing.title}</ThemedText>
            <SymbolView name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }}
              size={13} tintColor={theme.textSecondary} />
          </Animated.View>
        )}
      </Pressable>
    </View>
  );
}

function Row({ entry, last, onPress }: { entry: WeeklyRankingEntry; last: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      accessibilityLabel={`${entry.rank}위 ${entry.title}, ${entry.nickname}, 조회 ${count(entry.views)}`}
      style={({ pressed }) => [styles.row, !last && { borderBottomWidth: 1, borderBottomColor: theme.line },
        pressed && { backgroundColor: theme.backgroundSelected }]}>
      <ThemedText type="smallBold" style={[styles.rank, { color: entry.rank <= 3 ? theme.accent : theme.textSecondary }]}>
        {entry.rank}
      </ThemedText>
      <ThemedText type="small" numberOfLines={1} style={styles.title}>{entry.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.views}>{count(entry.views)}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one, marginBottom: Spacing.three, paddingHorizontal: Spacing.three },
  headRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.two },
  heading: { fontSize: 14.5 },
  hint: { fontSize: 12 },
  card: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  collapsed: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: 7 },
  label: { fontSize: 12 },
  row: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: 6 },
  rank: { width: 18, textAlign: 'center', fontVariant: ['tabular-nums'] },
  title: { flex: 1, minWidth: 0 },
  views: { fontSize: 12, fontVariant: ['tabular-nums'] },
});
