import { useLanguage } from '@/hooks/use-language';
import { Pressable } from '@/components/analytics-controls';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Animated, LayoutAnimation, Platform, StyleSheet, UIManager, View } from 'react-native';
import Reanimated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { PostZoomLink } from '@/components/post-zoom-link';
import { ClayIcon, ClayPillFill, useClay } from '@/components/clay';
import { ThemedText } from '@/components/themed-text';
import { GlingLoader } from '@/components/gling-loader';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { count } from '@/i18n';
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

// linked: signed in, so a row grows the post straight out of itself (owner 2026-11-02); guests keep onOpen and its login gate.
export function WeeklyRanking({ cityId, refreshKey, linked = false, onOpen }: { cityId: string; refreshKey?: number; linked?: boolean; onOpen: (postId: string) => Promise<void> }) {
  const { tr } = useLanguage();
  const clay = useClay();
  const theme = useTheme();
  const hidden = useContentVisibility();
  const reducedMotion = useReducedMotion();
  const { play } = useInteractionFeedback();
  const [loadedRanking, setRanking] = useState<Ranking>(null);
  const ranking = loadedRanking && { ...loadedRanking, entries: loadedRanking.entries.filter((entry) => !hidden('listed_post', entry.postId, entry.authorId)) };
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const [fade] = useState(() => new Animated.Value(1));
  const [arrow] = useState(() => new Animated.Value(0));
  const foldedCity = useRef(cityId);

  // 순위는 스냅샷이지만 그 안의 글은 지워질 수 있다. 서버가 읽을 때 걸러내므로
  // 화면으로 돌아올 때마다 다시 읽어야 지운 글이 사라진다. 한 번만 읽으면 남아 있게 된다.
  const load = useCallback(async (signal: { active: boolean }) => {
    try {
      const next = await loadWeeklyRanking(supabase, cityId);
      if (!signal.active) return;
      setRanking(next); setAt(0);
      // Only a new city starts folded. Coming back from a post keeps the list open, so the post shrinks back into its row.
      if (foldedCity.current !== cityId) { foldedCity.current = cityId; setOpen(false); arrow.setValue(0); }
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
      // 펼칠 때는 스프링으로 쫙 열리고, 접을 때는 짧게 닫힌다. 줄 등장도 이 안에 끝나도록 맞췄다 (owner 2026-11-02).
      LayoutAnimation.configureNext(next ? { duration: 380, update: { type: LayoutAnimation.Types.spring, springDamping: 0.82 } }
        : { duration: 260, update: { type: LayoutAnimation.Types.easeInEaseOut } });
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
      <View style={[styles.card, { borderColor: theme.line, backgroundColor: theme.card }]}>
        <View style={styles.headRow}>
          <ThemedText accessibilityRole="header" type="smallBold" themeColor="textSecondary" style={styles.heading}>{tr("이번 주 많이 읽은 글")}</ThemedText>
        </View>
        {ranking.entries.map((entry, index) => (
          <Row key={entry.postId} entry={entry} last={index === total - 1} linked={linked}
            onPress={async () => { play('selection'); if (!linked) await onOpen(entry.postId); }} />
        ))}
      </View>
    );
  }

  // 접힌 줄은 겹친 카드 없이 얇은 알약 한 줄 (owner 2026-11-03 "공간낭비"). 펼치면 테두리 카드로 1~10위.
  if (!expanded) {
    return (
      <Reanimated.View entering={reducedMotion ? undefined : FadeInDown.duration(220)}>
        <Pressable analyticsId="components_weekly-ranking.pressable.1" onPress={toggle} accessibilityRole="button"
          accessibilityState={{ expanded }} accessibilityLabel={tr("이번 주 많이 읽은 글 {0}편, 눌러서 전체 보기", (count(total)))}
          style={styles.foldTouch}>
          <View style={[styles.fold, { backgroundColor: clay ? 'transparent' : theme.backgroundElement }]}>
            {clay && <ClayPillFill kind="tray" />}
            <Animated.View style={[styles.collapsed, { opacity: fade }]}>
              <ClayIcon clay="trophy" claySize={24} size={18} />
              <ThemedText type="smallBold" style={[styles.label, { color: theme.accent }]}>
                {tr('이번 주 {0}위', showing.rank)}</ThemedText>
              <ThemedText type="small" numberOfLines={1} style={styles.title}>{showing.title}</ThemedText>
              <Animated.View style={{ transform: [{ rotate: arrow.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }] }}>
                <ClayIcon clay="chevron" name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }} size={13} tintColor={theme.textSecondary} />
              </Animated.View>
            </Animated.View>
          </View>
        </Pressable>
      </Reanimated.View>
    );
  }

  return (
    <View style={[styles.card, { borderColor: theme.line, backgroundColor: theme.card }]}>
      <Reanimated.View entering={reducedMotion ? undefined : FadeInDown.duration(250)}>
        <Pressable analyticsId="components_weekly-ranking.pressable.1" onPress={toggle} accessibilityRole="button"
          accessibilityState={{ expanded }} accessibilityLabel={tr("주간 순위 접기")}
          style={({ pressed }) => [styles.headRow, pressed && { backgroundColor: theme.backgroundElement }]}>
          <ThemedText accessibilityRole="header" type="smallBold" themeColor="textSecondary" style={styles.heading}>{tr("이번 주 많이 읽은 글")}</ThemedText>
          <View style={styles.hintGroup}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>{tr("접기")}</ThemedText>
            <Animated.View style={{ transform: [{ rotate: arrow.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }] }}>
              <ClayIcon clay="chevron" name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }} size={13} tintColor={theme.textSecondary} />
            </Animated.View>
          </View>
        </Pressable>
      </Reanimated.View>
      {ranking.entries.map((entry, index) => (
        <Reanimated.View key={entry.postId} entering={reducedMotion ? undefined : FadeInDown.delay(Math.min(index, 9) * 20).duration(240)}>
          <Row key={entry.postId} entry={entry} last={index === total - 1} linked={linked}
            onPress={async () => { play('selection'); if (!linked) await onOpen(entry.postId); }} />
        </Reanimated.View>
      ))}
    </View>
  );
}

function Row({ entry, last, linked, onPress }: { entry: WeeklyRankingEntry; last: boolean; linked: boolean; onPress: () => Promise<void> }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const row = (
    <Pressable analyticsId="components_weekly-ranking.pressable.2" onPress={linked ? () => void onPress() : async () => { if (busy) return; setBusy(true); try { await onPress(); } finally { setBusy(false); } }} accessibilityRole="button"
      accessibilityState={{ busy }}
      accessibilityLabel={tr("{0}위 {1}, {2}", (entry.rank), (entry.title), (entry.nickname))}
      // An object style: the zoom link's Slot drops function styles. FlatPressable gives the pressed fade and shrink.
      style={StyleSheet.flatten([styles.row, !last && { borderBottomWidth: 1, borderBottomColor: theme.line }])}>
      <ThemedText type="smallBold" style={[styles.rank, { color: entry.rank <= 3 ? theme.accent : theme.textSecondary }]}>
        {entry.rank}
      </ThemedText>
      <ThemedText type="small" numberOfLines={1} style={styles.title}>{entry.title}</ThemedText>
      {busy && <GlingLoader color={theme.accent} size={18} accessibilityLabel={tr("글 여는 중")} />}
    </Pressable>
  );
  return linked ? <PostZoomLink id={entry.postId}>{row}</PostZoomLink> : row;
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingTop: Spacing.three, paddingBottom: Spacing.two },
  heading: { flexShrink: 1 },
  hintGroup: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  hint: { fontSize: 12 },
  card: { borderWidth: 1, borderRadius: 12, borderCurve: 'continuous', overflow: 'hidden' },
  // The pill shows 36pt; its touch area reaches 4pt above and below it, 44pt in all, without taking layout space.
  foldTouch: { marginVertical: -4, paddingVertical: 4 },
  fold: { borderRadius: 999 },
  collapsed: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: 14, paddingVertical: 6 },
  label: { fontSize: 12 },
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  rank: { width: 18, textAlign: 'center', fontVariant: ['tabular-nums'] },
  title: { flex: 1, minWidth: 0 },
});
