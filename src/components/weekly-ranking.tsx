import { useCallback, useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
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
// 접혀 있을 때는 한 줄이 10위까지 돌고, 누르면 전부 펼쳐진다. 접힌 줄을 누르면
// 그 글로 가는 게 아니라 펼쳐지기만 한다 — 움직이는 글자를 눌러 엉뚱한 글로
// 들어가는 일이 없어야 하기 때문이다.
const ROTATE_MS = 3600;
const FADE_MS = 180;

export function WeeklyRanking({ cityId, onOpen }: { cityId: string; onOpen: (postId: string) => void }) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const { play } = useInteractionFeedback();
  const [ranking, setRanking] = useState<Ranking>(null);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const [fade] = useState(() => new Animated.Value(1));

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await loadWeeklyRanking(supabase, cityId);
        if (active) { setRanking(next); setAt(0); setOpen(false); }
      } catch { if (active) setRanking(null); }
    })();
    return () => { active = false; };
  }, [cityId]);

  const total = ranking?.entries.length ?? 0;

  useEffect(() => {
    // 펼쳤거나, 한 편뿐이거나, 동작 줄이기가 켜져 있으면 돌지 않는다.
    if (open || reducedMotion || total < 2) return;
    const timer = setInterval(() => {
      Animated.timing(fade, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(() => {
        setAt((current) => (current + 1) % total);
        Animated.timing(fade, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start();
      });
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [fade, open, reducedMotion, total]);

  const toggle = useCallback(() => {
    play('selection');
    setOpen((current) => {
      if (current) { setAt(0); fade.setValue(1); }
      return !current;
    });
  }, [fade, play]);

  if (!ranking || total === 0) return null;
  const showing = ranking.entries[Math.min(at, total - 1)];

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <ThemedText accessibilityRole="header" type="smallBold" style={styles.heading}>이번 주 많이 읽은 글</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          {open ? '접기' : `전체 ${count(total)}편`}
        </ThemedText>
      </View>

      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? '주간 순위 접기' : `이번 주 많이 읽은 글 ${count(total)}편, 눌러서 전체 보기`}
        style={({ pressed }) => [styles.card, { borderColor: theme.line, backgroundColor: theme.card },
          pressed && { backgroundColor: theme.backgroundElement, transform: [{ scale: reducedMotion ? 1 : 0.985 }] }]}>
        {open ? (
          ranking.entries.map((entry, index) => (
            <Row key={entry.postId} entry={entry} last={index === total - 1} onPress={() => { play('selection'); onOpen(entry.postId); }} />
          ))
        ) : (
          <Animated.View style={{ opacity: fade }}>
            <Row entry={showing} last collapsed />
          </Animated.View>
        )}
      </Pressable>
    </View>
  );
}

function Row({ entry, last, collapsed, onPress }: {
  entry: WeeklyRankingEntry; last: boolean; collapsed?: boolean; onPress?: () => void;
}) {
  const theme = useTheme();
  const body = (
    <View style={[styles.row, !last && { borderBottomWidth: 1, borderBottomColor: theme.line }]}>
      <ThemedText type="smallBold" style={[styles.rank, { color: entry.rank <= 3 ? theme.accent : theme.textSecondary }]}>
        {entry.rank}
      </ThemedText>
      <ThemedText type="small" numberOfLines={1} style={styles.title}>{entry.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.views}>{count(entry.views)}</ThemedText>
    </View>
  );
  // 접힌 줄은 눌러도 펼치기만 한다. 바깥 Pressable 이 그 역할을 맡는다.
  if (collapsed || !onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      accessibilityLabel={`${entry.rank}위 ${entry.title}, ${entry.nickname}, 조회 ${count(entry.views)}`}
      style={({ pressed }) => [pressed && { backgroundColor: theme.backgroundSelected }]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one, marginBottom: Spacing.three, paddingHorizontal: Spacing.three },
  headRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.two },
  heading: { fontSize: 14.5 },
  hint: { fontSize: 12 },
  card: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  row: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: 6 },
  rank: { width: 18, textAlign: 'center', fontVariant: ['tabular-nums'] },
  title: { flex: 1, minWidth: 0 },
  views: { fontSize: 12, fontVariant: ['tabular-nums'] },
});
