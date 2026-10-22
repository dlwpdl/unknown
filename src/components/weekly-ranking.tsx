import { Pressable } from '@/components/analytics-controls';
import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Animated, LayoutAnimation, Platform, StyleSheet, UIManager, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import Reanimated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { GlingLoader } from '@/components/gling-loader';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { count } from '@/i18n/ko';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadWeeklyRanking, type WeeklyRanking as Ranking, type WeeklyRankingEntry } from '@/lib/community-data';
import { supabase } from '@/lib/supabase';

// 한 주 동안 가장 많이 읽히고 이야기된 글. 월요일에 서버에서 찍어 고정한 값이라
// 스크롤할 때마다 순서가 바뀌지 않는다.
//
// 펼친 제목은 카드 안에 묶고, 접힌 줄은 "이번 주 N위"로 스스로를 설명한다.
//
// 누르면 그 글로 가는 게 아니라 펼쳐진다. 움직이는 글자를 눌러 엉뚱한 글로
// 들어가는 일이 없어야 하기 때문이다.
const ROTATE_MS = 3600;
const FADE_MS = 180;
// 서너 편 아래에서는 돌리지 않는다. 두 줄이 번갈아 바뀌는 건 정보가 아니라 소음이다.
const ROTATE_MIN = 4;

export function WeeklyRanking({ cityId, refreshKey, onOpen }: { cityId: string; refreshKey?: number; onOpen: (postId: string) => Promise<void> }) {
  const theme = useTheme();
  const hidden = useContentVisibility();
  const reducedMotion = useReducedMotion();
  const { play } = useInteractionFeedback();
  const [loadedRanking, setRanking] = useState<Ranking>(null);
  const ranking = loadedRanking && { ...loadedRanking, entries: loadedRanking.entries.filter((entry) => !hidden('post', entry.postId, entry.authorId)) };
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const [fade] = useState(() => new Animated.Value(1));
  const [arrow] = useState(() => new Animated.Value(0));

  // 순위는 스냅샷이지만 그 안의 글은 지워질 수 있다. 서버가 읽을 때 걸러내므로
  // 화면으로 돌아올 때마다 다시 읽어야 지운 글이 사라진다. 한 번만 읽으면 남아 있게 된다.
  const load = useCallback(async (signal: { active: boolean }) => {
    try {
      const next = await loadWeeklyRanking(supabase, cityId);
      if (signal.active) { setRanking(next); setAt(0); setOpen(false); arrow.setValue(0); }
    } catch { if (signal.active) setRanking(null); }
  }, [arrow, cityId]);

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
    fade.stopAnimation();
    fade.setValue(1);
    const next = !open;
    if (!reducedMotion) {
      if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);
      LayoutAnimation.configureNext({ duration: next ? 340 : 260, update: { type: LayoutAnimation.Types.easeInEaseOut } });
      Animated.spring(arrow, { toValue: next ? 1 : 0, tension: 70, friction: 10, useNativeDriver: true }).start();
    } else {
      arrow.setValue(next ? 1 : 0);
    }
    if (!next) setAt(0);
    setOpen(next);
  }, [arrow, fade, open, play, reducedMotion]);

  if (!ranking || total === 0) return null;
  const showing = ranking.entries[Math.min(at, total - 1)];

  // 몇 편뿐이면 제목 한 줄과 함께 그냥 펼쳐 둔다.
  if (alwaysOpen) {
    return (
      <View style={styles.wrap}>
        <View style={[styles.card, { borderColor: theme.line, backgroundColor: theme.card }]}>
          <View style={styles.headRow}>
            <ThemedText accessibilityRole="header" type="smallBold" themeColor="textSecondary" style={styles.heading}>이번 주 많이 읽은 글</ThemedText>
          </View>
          {ranking.entries.map((entry, index) => (
            <Row key={entry.postId} entry={entry} last={index === total - 1}
              onPress={async () => { play('selection'); await onOpen(entry.postId); }} />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Animated.View pointerEvents="none" style={[styles.cardDepth, { borderColor: theme.line, backgroundColor: theme.card,
        opacity: arrow.interpolate({ inputRange: [0, 1], outputRange: [0.62, 0] }),
        transform: [{ translateY: arrow.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }] }]} />
      <View style={[styles.card, { borderColor: theme.line, backgroundColor: theme.card }]}>
        {expanded && (
          <Reanimated.View entering={reducedMotion ? undefined : FadeInDown.duration(250)}>
          <Pressable analyticsId="components_weekly-ranking.pressable.1" onPress={toggle} accessibilityRole="button"
            accessibilityState={{ expanded }} accessibilityLabel="주간 순위 접기"
            style={({ pressed }) => [styles.headRow, pressed && { backgroundColor: theme.backgroundElement, transform: [{ scale: 0.985 }] }]}>
            <ThemedText accessibilityRole="header" type="smallBold" themeColor="textSecondary" style={styles.heading}>이번 주 많이 읽은 글</ThemedText>
            <View style={styles.hintGroup}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>접기</ThemedText>
              <Animated.View style={{ transform: [{ rotate: arrow.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }] }}>
                <SymbolView name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }} size={13} tintColor={theme.textSecondary} />
              </Animated.View>
            </View>
          </Pressable>
          </Reanimated.View>
        )}
        {expanded ? (
          ranking.entries.map((entry, index) => (
            <Reanimated.View key={entry.postId} entering={reducedMotion ? undefined : FadeInDown.delay(index * 55).duration(280)}>
            <Row key={entry.postId} entry={entry} last={index === total - 1}
              onPress={async () => { play('selection'); await onOpen(entry.postId); }} />
            </Reanimated.View>
          ))
        ) : (
          <Reanimated.View entering={reducedMotion ? undefined : FadeInDown.duration(220)}>
          <Pressable analyticsId="components_weekly-ranking.pressable.1" onPress={toggle} accessibilityRole="button"
            accessibilityState={{ expanded }} accessibilityLabel={`이번 주 많이 읽은 글 ${count(total)}편, 눌러서 전체 보기`}
            style={({ pressed }) => [pressed && { backgroundColor: theme.backgroundElement, transform: [{ scale: reducedMotion ? 1 : 0.985 }] }]}>
          <Animated.View style={[styles.collapsed, { opacity: fade }]}>
            <ThemedText type="smallBold" style={[styles.label, { color: theme.accent }]}>
              이번 주 {showing.rank}위
            </ThemedText>
            <ThemedText type="small" numberOfLines={1} style={styles.title}>{showing.title}</ThemedText>
            <Animated.View style={{ transform: [{ rotate: arrow.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }] }}>
              <SymbolView name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }} size={13} tintColor={theme.textSecondary} />
            </Animated.View>
          </Animated.View>
          </Pressable>
          </Reanimated.View>
        )}
      </View>
    </View>
  );
}

function Row({ entry, last, onPress }: { entry: WeeklyRankingEntry; last: boolean; onPress: () => Promise<void> }) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const [busy, setBusy] = useState(false);
  return (
    <Pressable analyticsId="components_weekly-ranking.pressable.2" onPress={async () => { if (busy) return; setBusy(true); try { await onPress(); } finally { setBusy(false); } }} accessibilityRole="button"
      accessibilityState={{ busy }}
      accessibilityLabel={`${entry.rank}위 ${entry.title}, ${entry.nickname}, 조회 ${count(entry.views)}`}
      style={({ pressed }) => [styles.row, !last && { borderBottomWidth: 1, borderBottomColor: theme.line },
        pressed && { backgroundColor: theme.backgroundSelected, transform: [{ scale: reducedMotion ? 1 : 0.985 }] }]}>
      <ThemedText type="smallBold" style={[styles.rank, { color: entry.rank <= 3 ? theme.accent : theme.textSecondary }]}>
        {entry.rank}
      </ThemedText>
      <ThemedText type="small" numberOfLines={1} style={styles.title}>{entry.title}</ThemedText>
      {busy ? <GlingLoader color={theme.accent} size={18} accessibilityLabel="글 여는 중" />
        : <ThemedText type="small" themeColor="textSecondary" style={styles.views}>{count(entry.views)}</ThemedText>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: Spacing.four, marginBottom: Spacing.three },
  headRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingTop: Spacing.three, paddingBottom: Spacing.two },
  heading: { flexShrink: 1 },
  hintGroup: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  hint: { fontSize: 12 },
  card: { borderWidth: 1, borderRadius: 12, borderCurve: 'continuous', overflow: 'hidden' },
  cardDepth: { position: 'absolute', top: 6, bottom: -6, left: 6, right: 6, borderWidth: 1, borderRadius: 12, opacity: 0.62 },
  collapsed: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  label: { fontSize: 12 },
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  rank: { width: 18, textAlign: 'center', fontVariant: ['tabular-nums'] },
  title: { flex: 1, minWidth: 0 },
  views: { fontSize: 12, fontVariant: ['tabular-nums'] },
});
