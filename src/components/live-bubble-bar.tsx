import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';

import { ClayPillFill, useClay } from '@/components/clay';
import { Pressable } from '@/components/analytics-controls';
import { DragSheet } from '@/components/drag-sheet';
import { ExtendRow, keepClearViews, useLive, useLiveActions, useNow } from '@/components/live-bubbles';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles, controlPresentation } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useCommunityCity } from '@/lib/community-city';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { LIVE, distanceMeters, durationLabel, getLive, liveNotice, loadLiveMap, minutesLeft, noticeBottom, noticeMs, refreshLive, resetLive, visibleNotice } from '@/lib/live-bubbles';
import { mapCityCenter } from '@/lib/post-map-html';
import { pushPermissionGranted, pushSupported } from '@/lib/push-notifications';
import { supabase } from '@/lib/supabase';

const WARNING_ID = 'live-bubble-ending';
/** iOS 26+ puts my bubble in the tab bar's bottom accessory, where Music keeps what's playing (owner 9148628c); older iOS and Android keep the top bar. */
export const LIVE_ACCESSORY = Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 26;
// The accessory's height plus its gap above the tab bar, so a notice clears it the way it clears the tab bar.
const ACCESSORY_ROOM = 56;

/**
 * While my bubble is up it stays in sight with the time left and 내리기 (owner 2026-11-05: being on the map shows roughly where I am, so it must never
 * be forgotten). On iOS 26+ that is the tab bar accessory below; elsewhere a bar on top of every screen, which the root layout puts above the screens'
 * own safe-area provider so screens start below it. Ten minutes before the end a local notification asks whether to keep it up, and reopening the
 * app far from the bubble asks "아직 거기 계세요?".
 */
export function LiveBubbleBar() {
  const { tr } = useLanguage(), theme = useTheme(), insets = useSafeAreaInsets(), router = useRouter(), { play } = useInteractionFeedback();
  const { isAuthed, isAdmin, me } = useAuth(), { city } = useCommunityCity(), live = useLive(), now = useNow();
  const mine = live.map?.mine && minutesLeft(live.map.mine.expiresAt, now) > 0 ? live.map.mine : null;
  const left = mine ? minutesLeft(mine.expiresAt, now) : 0;
  const { busy, end, extend } = useLiveActions(), [far, setFar] = useState(false), [activeAt, setActiveAt] = useState(() => Date.now());
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthed) { resetLive(); return; }
    const [longitude, latitude] = mapCityCenter(city.englishName);
    void loadLiveMap(supabase, me.id, city.id, { latitude, longitude }).catch(() => {});
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') { setActiveAt(Date.now()); void refreshLive().catch(() => {}); } });
    return () => subscription.remove();
  }, [isAuthed, me.id, city.id, city.englishName]);

  // One phone notification ten minutes before the end, only if notifications are already allowed (never asks here).
  const expiresAt = isAuthed ? live.map?.mine?.expiresAt ?? null : null, userId = me.id;
  useEffect(() => {
    if (!pushSupported) return;
    let active = true;
    void (async () => {
      await Notifications.cancelScheduledNotificationAsync(WARNING_ID).catch(() => {});
      const at = expiresAt ? Date.parse(expiresAt) - LIVE.warnMinutes * 60000 : NaN;
      if (!active || !(at > Date.now() + 5000) || !await pushPermissionGranted().catch(() => false) || !active) return;
      await Notifications.scheduleNotificationAsync({ identifier: WARNING_ID,
        content: { title: tr('글링'), body: tr('말풍선이 10분 뒤에 내려가요. 더 띄워 둘까요?'), data: { userId, category: 'system', route: '/discover' } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: 'gling-activity' } });
    })().catch(() => {});
    return () => { active = false; };
  }, [expiresAt, userId, tr]);

  // Back in the app far from where the bubble sits: ask once per bubble. Admins place theirs anywhere, so they are never asked.
  const mineId = mine?.kind === 'member' && !isAdmin ? mine.id : null;
  useEffect(() => {
    if (!mineId || asked.current === mineId) return;
    let active = true;
    void (async () => {
      if (!(await Location.getForegroundPermissionsAsync()).granted) return;
      const value = await Location.getLastKnownPositionAsync({ maxAge: 120000 }) ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const bubble = getLive().map?.mine;
      if (!active || !bubble || bubble.id !== mineId || value.mocked) return;
      asked.current = mineId;
      if (distanceMeters(bubble, value.coords) > LIVE.farMeters) setFar(true);
    })().catch(() => {});
    return () => { active = false; };
  }, [mineId, activeAt]);

  // In the development example nobody can push, so a made-up wave or request shows up as an in-app notice instead.
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const wave of live.map?.waves ?? []) {
      if (seen.current.has(wave.id)) continue;
      seen.current.add(wave.id);
      if (live.demo) liveNotice(tr('{0}님이 손을 흔들었어요', wave.sender.nickname));
    }
    for (const request of live.map?.received ?? []) {
      if (request.status !== 'pending' || seen.current.has(request.id)) continue;
      seen.current.add(request.id);
      if (live.demo) liveNotice(request.waveReply ? tr('{0}님이 내 손 흔들기에 답했어요', request.sender.nickname) : tr('{0}님이 대화 신청을 보냈어요', request.sender.nickname), request.id);
    }
  }, [live.map?.waves, live.map?.received, live.demo, tr]);

  const endFar = () => { setFar(false); end(); };
  const ending = left > 0 && left <= LIVE.warnMinutes;
  return <>
    {mine && !LIVE_ACCESSORY && <View style={[styles.bar, { paddingTop: insets.top + Spacing.one, paddingLeft: insets.left + Spacing.three, paddingRight: insets.right + Spacing.two, backgroundColor: theme.card, borderBottomColor: theme.line }]}>
      <View style={styles.row}>
        <Pressable analyticsId="livemap.bar" accessibilityRole="button" accessibilityLabel={tr('내 말풍선이 떠 있어요, {0} 남음. 지도에서 보기', durationLabel(left))}
          onPress={() => { play('selection'); router.push('/discover'); }} style={({ pressed }) => [styles.open, { opacity: pressed ? 0.82 : 1 }]}>
          <Pulse />
          <ThemedText type="smallBold" numberOfLines={1} style={styles.flex}>{tr('내 말풍선이 떠 있어요 · {0} 남음', durationLabel(left))}</ThemedText>
        </Pressable>
        <Pressable analyticsId="livemap.end" accessibilityRole="button" accessibilityLabel={tr('말풍선 내리기')} disabled={busy} onPress={end}
          style={({ pressed }) => [ControlStyles.pill, styles.pill, controlPresentation(theme, { tone: 'ghost', pressed, busy }).container]}>
          <ThemedText type="smallBold" themeColor="accent">{tr('내리기')}</ThemedText>
        </Pressable>
      </View>
      {ending && <ExtendRow busy={busy} onExtend={extend} />}
    </View>}
    <DragSheet visible={far && !!mine} onClose={() => setFar(false)} title={tr('아직 거기 계세요?')}>
      <View style={styles.sheet}>
        <ThemedText>{tr('말풍선은 남긴 곳 근처에 떠 있는데, 지금은 꽤 멀리 와 있어요.')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{tr('떠 있는 동안엔 아직 그 동네에 있는 것처럼 보일 수 있어요.')}</ThemedText>
        <RaisedActionButton analyticsId="livemap.far" label={tr('말풍선 내리기')} busy={busy} onPress={endFar} />
        <Pressable analyticsId="livemap.far" accessibilityRole="button" onPress={() => { play('selection'); setFar(false); liveNotice(LIVE_ACCESSORY ? tr('그대로 둘게요. 아래 막대에서 언제든 내릴 수 있어요') : tr('그대로 둘게요. 위쪽 막대에서 언제든 내릴 수 있어요')); }} style={styles.link}>
          <ThemedText type="smallBold" themeColor="accent">{tr('그대로 둘게요')}</ThemedText>
        </Pressable>
      </View>
    </DragSheet>
  </>;
}

/**
 * The bar in the tab bar's bottom accessory (iOS 26+). The system draws it twice, once per placement; 'inline' is the tab bar shrunk by scrolling,
 * where only the dot, the time left and 내리기 fit. Tapping it opens the map, where the tab bar leaves it out (the bottom card shows my bubble there).
 */
export function LiveBubbleAccessory() {
  const inline = NativeTabs.BottomAccessory.usePlacement() === 'inline';
  const { tr } = useLanguage(), theme = useTheme(), router = useRouter(), { play } = useInteractionFeedback(), live = useLive(), now = useNow();
  const clay = useClay();
  const { busy, end, extend } = useLiveActions();
  const mine = live.map?.mine, left = mine ? minutesLeft(mine.expiresAt, now) : 0;
  if (!mine || !left) return null;
  const time = durationLabel(left), ending = left <= LIVE.warnMinutes;
  return <View style={[styles.accessory, inline && styles.inline]}>
    <Pressable analyticsId="livemap.bar" accessibilityRole="button" accessibilityLabel={tr('내 말풍선이 떠 있어요, {0} 남음. 지도에서 보기', time)}
      onPress={() => { play('selection'); router.push('/discover'); }} style={({ pressed }) => [styles.open, { opacity: pressed ? 0.82 : 1 }]}>
      <Pulse />
      <ThemedText type="smallBold" numberOfLines={1} style={styles.flex}>{inline ? time : ending ? tr('곧 내려가요 · {0}', time) : tr('내 말풍선이 떠 있어요 · {0} 남음', time)}</ThemedText>
    </Pressable>
    {ending && !inline && <Pressable analyticsId="livemap.extend" accessibilityRole="button" accessibilityLabel={tr('1시간 더 띄우기')} accessibilityState={{ busy }} disabled={busy} onPress={extend}
      style={({ pressed }) => [ControlStyles.pill, styles.pill, styles.tight, controlPresentation(theme, { tone: 'primary', pressed, busy, clay }).container]}>
      {clay && <ClayPillFill kind="cta" />}
      <ThemedText type="smallBold" numberOfLines={1} style={{ color: theme.accentInk }}>{tr('1시간 더 띄우기')}</ThemedText>
    </Pressable>}
    <Pressable analyticsId="livemap.end" accessibilityRole="button" accessibilityLabel={tr('말풍선 내리기')} accessibilityState={{ busy }} disabled={busy} onPress={end}
      style={({ pressed }) => [ControlStyles.pill, styles.pill, styles.tight, controlPresentation(theme, { tone: 'ghost', pressed, busy }).container]}>
      <ThemedText type="smallBold" themeColor="accent">{tr('내리기')}</ThemedText>
    </Pressable>
  </View>;
}

function Pulse() {
  const theme = useTheme(), reduced = useReducedMotion(), glow = useSharedValue(1);
  useEffect(() => { if (!reduced) glow.set(withRepeat(withTiming(0.35, { duration: 900 }), -1, true)); }, [reduced, glow]);
  const style = useAnimatedStyle(() => ({ opacity: glow.get() }));
  return <Animated.View accessible={false} style={[styles.pulse, { backgroundColor: theme.accent }, style]} />;
}

/** Short confirmations after a live-map action ("말풍선을 띄웠어요"…), floating above sheets on iOS like the upload card. */
export function LiveNotice() {
  const { notice } = useLive(), insets = useSafeAreaInsets(), theme = useTheme(), router = useRouter(), { play } = useInteractionFeedback();
  const { height } = useWindowDimensions(), usual = insets.bottom + 96;
  // The store keeps the last notice; once hidden it stays hidden (it used to come straight back and linger until the next one).
  const [hiddenId, setHiddenId] = useState<number | null>(null), [placed, setPlaced] = useState<{ id: number; bottom: number } | null>(null);
  const shown = visibleNotice(notice, hiddenId);
  useEffect(() => {
    if (!shown) return;
    AccessibilityInfo.announceForAccessibility(shown.text);
    // Sit above an open sheet's buttons or the map's bottom card, measured now that they are on screen.
    // The tab bar accessory can't be measured from here, so while it may be up the notice keeps its height clear on top of the usual spot.
    let active = true;
    const lifted = usual + (LIVE_ACCESSORY && getLive().map?.mine ? ACCESSORY_ROOM : 0);
    void Promise.all(keepClearViews().map(view => new Promise<number>(resolve => view.measureInWindow((_x, y) => resolve(y)))))
      .then(tops => { if (active) setPlaced({ id: shown.id, bottom: noticeBottom(lifted, height, tops) }); });
    const timer = setTimeout(() => setHiddenId(shown.id), noticeMs(shown));
    return () => { active = false; clearTimeout(timer); };
  }, [shown, usual, height]);
  if (!shown || placed?.id !== shown.id) return null;
  const card = <View pointerEvents="box-none" style={[styles.noticeLayer, { bottom: placed.bottom }]}>
    <Pressable analyticsId="livemap.banner" accessibilityRole={shown.requestId ? 'button' : 'text'} disabled={!shown.requestId}
      onPress={() => { play('selection'); setHiddenId(shown.id); if (shown.requestId) router.push({ pathname: '/discover', params: { bubbleRequest: shown.requestId } }); }}
      style={[styles.notice, { backgroundColor: theme.text }]}>
      <ThemedText type="smallBold" style={{ color: theme.background }}>{shown.text}</ThemedText>
    </Pressable>
  </View>;
  return Platform.OS === 'ios' ? <FullWindowOverlay unstable_accessibilityContainerViewIsModal={false}>{card}</FullWindowOverlay> : card;
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  bar: { paddingBottom: Spacing.one, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  open: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  pill: { minHeight: 36, borderRadius: 18 },
  accessory: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingLeft: Spacing.three, paddingRight: Spacing.one },
  inline: { paddingLeft: Spacing.two },
  tight: { paddingHorizontal: 10 },
  pulse: { width: 10, height: 10, borderRadius: 5 },
  sheet: { gap: Spacing.two + 4, paddingBottom: Spacing.two },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  noticeLayer: { position: 'absolute', left: Spacing.three, right: Spacing.three, alignItems: 'center' },
  notice: { maxWidth: 480, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12 },
});
