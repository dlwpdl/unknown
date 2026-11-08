import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { Alert, StyleSheet, TextInput, View, type ViewInstance } from 'react-native';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { SymbolView } from '@/components/symbol-view';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { CategoryIcon } from '@/components/category-icon';
import { ClayPhoto, ClayPillFill, useClay } from '@/components/clay';
import { DiscoveryMap, type DiscoveryMarker } from '@/components/discovery-map';
import { DragSheet } from '@/components/drag-sheet';
import { InitialAvatar, Tag } from '@/components/list-card';
import { PostPinMap } from '@/components/post-pin-map';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ReportSheet } from '@/components/report-sheet';
import { SelectionChip } from '@/components/selection-chip';
import { ThemedText } from '@/components/themed-text';
import { TrustBadge } from '@/components/trust-badge';
import { ControlStyles, IconSize, controlPresentation } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { blockUser, loadNotificationActors } from '@/lib/community-data';
import { hideContent } from '@/lib/content-visibility';
import { DISCOVERY_CATEGORIES } from '@/lib/discovery';
import { loadPublicFeed, relativeTime } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import {
  GREETINGS, LIVE, QUICK_PHRASES, approximatePoint, myShownPoints, postingPlace, shownPoint, cancelLiveRequest, clampWithin, demoReceive, distanceMeters, durationLabel, endLiveBubble, extendLiveBubble, getLive, liveErrorCode, liveNotice,
  minutesLeft, postLiveBubble, refreshLive, replyToWave, respondLiveRequest, sendLiveRequest, subscribeLive, waveLiveBubble, type LiveAudience, type LiveBubble, type LiveKind, type LiveMap, type LivePerson, type LiveRequest, type LiveWave, type Point,
} from '@/lib/live-bubbles';
import { formatMeetupTime, meetupZone } from '@/lib/chilling-date';
import type { LocationFix } from '@/lib/location';
import { splitPlaceMeetupBody } from '@/lib/meetup-destination';
import { googleMapsPin, postMapBody } from '@/lib/post-maps';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

export const useLive = () => useSyncExternalStore(subscribeLive, getLive, getLive);
/** A clock for "N분 남음" labels, ticking every 30 seconds. */
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  return now;
}
const mineExpiry = () => getLive().map?.mine?.expiresAt ?? null;
/** True while my bubble is up. Follows only its end time, so the tab bar re-renders when it goes up, comes down or is extended, not on every live-map update. */
export function useMineUp() {
  const expiresAt = useSyncExternalStore(subscribeLive, mineExpiry, mineExpiry);
  const [over, setOver] = useState<string | null>(null);
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => setOver(expiresAt), Math.max(0, Date.parse(expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt]);
  return !!expiresAt && over !== expiresAt;
}
/** 내리기 and 1시간 더 띄우기 with one busy guard and the same confirmations wherever they are offered. */
export function useLiveActions() {
  const { tr } = useLanguage(), { play } = useInteractionFeedback(), [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>, done: string) => {
    if (busy) return;
    play('selection'); setBusy(true);
    try { await action(); play('success'); liveNotice(done); }
    catch { play('warning'); liveNotice(tr('연결을 확인하고 다시 해 주세요.')); }
    finally { setBusy(false); }
  };
  return { busy, end: () => void run(endLiveBubble, tr('말풍선을 내렸어요')), extend: () => void run(extendLiveBubble, tr('1시간 더 떠 있어요')) };
}
/** The last ten minutes of my bubble: 곧 내려가요 with 1시간 더 띄우기. */
export function ExtendRow({ busy, onExtend }: { busy: boolean; onExtend: () => void }) {
  const { tr } = useLanguage(), theme = useTheme();
  const clay = useClay();
  return <View style={styles.extendRow}>
    <ThemedText type="caption" themeColor="textSecondary" style={styles.flex} accessibilityLiveRegion="polite">{tr('말풍선이 곧 내려가요. 더 띄워 둘까요?')}</ThemedText>
    <Pressable analyticsId="livemap.extend" accessibilityRole="button" accessibilityLabel={tr('1시간 더 띄우기')} accessibilityState={{ busy }} disabled={busy} onPress={onExtend}
      style={({ pressed }) => [styles.dockPill, clay && styles.dockPillClay, controlPresentation(theme, { tone: 'primary', pressed, busy, clay }).container]}>
      {clay && <ClayPillFill kind="cta" />}
      <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{tr('1시간 더 띄우기')}</ThemedText>
    </Pressable>
  </View>;
}

// Views the live-map notice must not cover (an open sheet's buttons, the map's bottom card); LiveNotice measures them when it shows.
const keepClear = new Set<RefObject<ViewInstance | null>>();
export const keepClearViews = () => [...keepClear].flatMap(ref => ref.current ? [ref.current] : []);
/** Attach the returned ref to a view the notice should sit above while it is on screen. */
export function useKeepClearOfNotice() {
  const ref = useRef<ViewInstance>(null);
  useEffect(() => { keepClear.add(ref); return () => { keepClear.delete(ref); }; }, []);
  return ref;
}

const BUBBLE_COLOR = '#8E6CE0', MEETUP_TAG = 5;
const MEETUP_COLOR = DISCOVERY_CATEGORIES.find(value => value.id === 'event')?.color ?? '#5F7CF3';

/** My bubble and everyone else's still up, as map pins (3D speech bubble; the Gling tag for an admin pin). */
// A map name tag says when the bubble ends (owner 2026-11-08 "말풍선 남은 시간: 끝나는 시각으로"): a countdown changed every minute and made the map place all its places again.
// The city's clock (meetupZone) so a phone with old B.C. zone data still shows the right hour.
const untilClock = (expiresAt: string, locale: string, cityId: string) => formatMeetupTime(expiresAt, locale, meetupZone(null, cityId), { hour: 'numeric', minute: '2-digit' });

export function useLiveMarkers(map: LiveMap | null, now: number, show: boolean, cityId: string): DiscoveryMarker[] {
  const { tr, locale } = useLanguage(), hidden = useContentVisibility();
  if (!show || !map) return [];
  const shown = [...(map.mine ? [map.mine] : []), ...map.bubbles.filter(bubble => !hidden('live_bubble', bubble.id, bubble.author.id))];
  return shown.filter(bubble => minutesLeft(bubble.expiresAt, now) > 0).map(bubble => {
    const who = bubble === map.mine ? tr('나') : bubble.kind === 'pin' ? tr('글링') : bubble.demo ? tr('개발용 예시') : bubble.author.nickname;
    const sublabel = tr('{0} · {1}까지', who, untilClock(bubble.expiresAt, locale, cityId));
    return { id: `bubble:${bubble.id}`, latitude: bubble.latitude, longitude: bubble.longitude, color: BUBBLE_COLOR, label: bubble.body.slice(0, 80),
      sublabel: sublabel.slice(0, 40), icon: bubble.kind === 'pin' ? 'visited' : 'bubble' };
  });
}

/** 근처 모임: the city's open meetups from the existing meetup feed, pinned at their linked place. */
export function useMeetupMarkers(cityId: string, viewerScope: string, now: number, show: boolean): DiscoveryMarker[] {
  const { tr } = useLanguage(), hidden = useContentVisibility();
  const key = `${cityId}:${viewerScope}`;
  const [result, setResult] = useState<{ key: string; posts: Post[] } | null>(null);
  useEffect(() => {
    if (!show) return;
    let active = true;
    void loadPublicFeed(supabase, cityId, MEETUP_TAG, null, null, { viewerScope }).then(posts => { if (active) setResult({ key, posts }); }, () => {});
    return () => { active = false; };
  }, [show, cityId, viewerScope, key]);
  if (!show || result?.key !== key) return [];
  return result.posts.flatMap(post => {
    const room = post.room, start = room?.startsAt ? Date.parse(room.startsAt) : NaN;
    if (!room || room.closed || room.recruitingClosed || start < now || hidden('post', post.id, post.author.id)) return [];
    const url = postMapBody(post.body).url;
    const pin = splitPlaceMeetupBody(post.body, post.cityId)?.place ?? (url ? googleMapsPin(url) : null);
    if (!pin) return [];
    const minutes = Math.round((start - now) / 60000), seats = room.capacity ? Math.max(0, room.capacity - room.memberCount) : null;
    const when = !Number.isFinite(minutes) ? '' : minutes < 60 ? tr('{0}분 뒤', Math.max(1, minutes)) : minutes < 1440 ? tr('{0}시간 뒤', Math.round(minutes / 60)) : tr('{0}일 뒤', Math.round(minutes / 1440));
    const sublabel = [when, seats === null ? '' : seats ? tr('{0}자리 남음', seats) : tr('자리 다 찼어요')].filter(Boolean).join(' · ');
    return [{ id: `meetup:${post.id}`, latitude: pin.latitude, longitude: pin.longitude, color: MEETUP_COLOR, label: (room.title || post.title).slice(0, 80),
      ...(sublabel ? { sublabel: sublabel.slice(0, 40) } : {}), icon: 'events' }];
  });
}

/** The card under the map: leave a bubble, see mine, or open a request someone sent. */
export function LiveDock({ map, demo, now, onCompose, onReceived }: { map: LiveMap; demo: boolean; now: number; onCompose: () => void; onReceived: (id: string) => void }) {
  const clay = useClay();
  const theme = useTheme(), { tr } = useLanguage(), { play } = useInteractionFeedback();
  const pending = map.received.find(request => request.status === 'pending');
  const mine = map.mine && minutesLeft(map.mine.expiresAt, now) > 0 ? map.mine : null;
  const left = mine ? durationLabel(minutesLeft(mine.expiresAt, now)) : '', waves = mine ? map.waves.length : 0;
  const title = pending ? tr('{0}님이 대화 신청을 보냈어요', pending.sender.nickname) : mine ? mine.body : tr('지금 있는 동네에 한마디 남기기');
  const body = pending ? tr('눌러서 프로필 보고 정하기') : waves ? tr('손 흔든 사람 {0}명 · {1} 뒤 사라져요', waves, left)
    : mine ? mine.audience === 'friends' ? tr('{0} 뒤 사라져요 · 친구한테만 보여요', left) : tr('{0} 뒤 사라져요 · 도시 전체에 보여요', left)
    : tr('누르면 대화 신청이 와요. 받을지는 내가 정해요');
  const action = pending || waves ? tr('보기') : mine ? tr('고치기') : tr('남기기'), clear = useKeepClearOfNotice();
  // The tab bar's bubble bar steps aside on the map, and the ten-minute notification opens the map, so the extend lives here too.
  const ending = !!mine && minutesLeft(mine.expiresAt, now) <= LIVE.warnMinutes, { busy, extend } = useLiveActions();
  return <View ref={clear} style={[styles.dock, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <Pressable analyticsId="livemap.dock" accessibilityRole="button" accessibilityLabel={`${title}, ${body}, ${action}`}
      onPress={() => { play('selection'); if (pending) onReceived(pending.id); else onCompose(); }} style={({ pressed }) => [styles.dockRow, { opacity: pressed ? 0.82 : 1 }]}>
      {pending ? <InitialAvatar name={pending.sender.nickname} /> : <CategoryIcon id="bubble" size={40} play={0} />}
      <View style={styles.flex}>
        <ThemedText type="smallBold" numberOfLines={1}>{title}</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary" numberOfLines={2}>{body}</ThemedText>
      </View>
      <View style={[styles.dockPill, clay && styles.dockPillClay, { backgroundColor: clay ? 'transparent' : theme.accent }]}>{clay && <ClayPillFill kind="on" />}<ThemedText type="smallBold" style={{ color: theme.accentInk }}>{action}</ThemedText></View>
    </Pressable>
    {ending && <ExtendRow busy={busy} onExtend={extend} />}
    {/* Before posting too: the example then puts up a sample bubble of mine to receive on. */}
    {demo && !pending && <Pressable analyticsId="livemap.dev" accessibilityRole="button" accessibilityLabel={tr('개발용 예시: 손 흔들기·대화 신청 받아 보기')} onPress={() => { play('selection'); demoReceive(); }} style={styles.link}>
      <ThemedText type="caption" themeColor="accent">{tr('개발용 예시: 손 흔들기·대화 신청 받아 보기')}</ThemedText>
    </Pressable>}
  </View>;
}

const Label = ({ children }: { children: ReactNode }) => <ThemedText type="smallBold" accessibilityRole="header">{children}</ThemedText>;
function Choice({ selected, label, onPress, analyticsId }: { selected: boolean; label: string; onPress: () => void; analyticsId: string }) {
  const theme = useTheme();
  return <SelectionChip selected={selected} baseColor={theme.backgroundElement} analyticsId={analyticsId} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }}
    onPress={onPress} style={[styles.choice, { borderColor: selected ? theme.accent : theme.line }]}>
    <ThemedText type="smallBold" style={{ color: selected ? theme.accentInk : theme.text }}>{label}</ThemedText>
  </SelectionChip>;
}
function Secondary({ label, onPress, analyticsId, disabled }: { label: string; onPress: () => void; analyticsId: string; disabled?: boolean }) {
  const theme = useTheme();
  return <Pressable analyticsId={analyticsId} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [ControlStyles.action, styles.secondary, controlPresentation(theme, { pressed, disabled }).container]}>
    <ThemedText type="smallBold">{label}</ThemedText>
  </Pressable>;
}
// No onProfile for a 글링 pin: it names no account.
function Person({ person, photo, demo, onProfile }: { person: LivePerson; photo?: string; demo?: boolean; onProfile?: () => void }) {
  const { tr } = useLanguage(), { play } = useInteractionFeedback();
  return <View style={styles.person}>
    {photo ? <ClayPhoto uri={photo} size={48} /> : <InitialAvatar name={person.nickname} />}
    <View style={styles.flex}>
      <View style={styles.nameRow}><ThemedText type="smallBold" numberOfLines={1} style={styles.shrink}>{person.nickname}</ThemedText>
        <TrustBadge trustLevel={person.trustLevel === 1 ? undefined : person.trustLevel} />{demo && <Tag label={tr('개발용 예시')} tone="quiet" />}</View>
      {onProfile && <Pressable analyticsId="livemap.profile" accessibilityRole="button" accessibilityLabel={tr('{0} 프로필 보기', person.nickname)} onPress={() => { play('selection'); onProfile(); }} style={styles.inlineLink}>
        <ThemedText type="small" themeColor="accent">{tr('프로필 보기')}</ThemedText>
      </Pressable>}
    </View>
  </View>;
}

const locationProblem = (code: string) => code === 'PERMISSION' ? '위치 권한이 꺼져 있어요. 설정에서 위치를 켜면 남길 수 있어요.'
  : code === 'MOCKED' ? '지금은 남길 수 없어요. 위치를 확인할 수 없는 상태예요.' : '지금 있는 곳을 확인하지 못했어요. 잠시 뒤에 다시 해 주세요.';
const actionProblem = (error: unknown) => {
  const code = liveErrorCode(error);
  return code === 'LOCATION_UNAVAILABLE' ? '지금은 남길 수 없어요.' : code === 'PERSONA_NOT_ALLOWED' || code === 'BLOCKED' ? '지금은 할 수 없어요.'
    : code === 'CONTENT_NOT_ALLOWED' ? '이 말은 남길 수 없어요. 다른 말로 바꿔 주세요.' : code === 'RATE_LIMITED' ? '잠시 뒤에 다시 해 주세요.'
    : code === 'BUBBLE_GONE' ? '이 말풍선은 방금 내려갔어요.' : code === 'REQUEST_LIMIT' ? '오늘 신청 5번을 다 썼어요. 내일 다시 보낼 수 있어요'
    : code === 'WAVE_LIMIT' ? '오늘 손 흔들기 20번을 다 했어요. 내일 다시 할 수 있어요' : code === 'ALREADY_WAVED' ? '이 말풍선에는 이미 손을 흔들었어요.'
    : '연결을 확인하고 다시 해 주세요.';
};

/** Who waved at my bubble (only I see this), each with a chat request back or where that request stands. */
function WaveList({ waves, now, onClose }: { waves: LiveWave[]; now: number; onClose: () => void }) {
  const { tr } = useLanguage(), theme = useTheme(), { play } = useInteractionFeedback(), router = useRouter();
  const clay = useClay();
  const [busy, setBusy] = useState<string | null>(null), [problem, setProblem] = useState('');
  const reply = async (wave: LiveWave) => {
    if (busy) return;
    play('selection'); setBusy(wave.id); setProblem('');
    try { await replyToWave(wave.id); play('message'); liveNotice(tr('{0}님에게 대화 신청을 보냈어요', wave.sender.nickname)); }
    catch (error) { play('warning'); setProblem(actionProblem(error)); }
    finally { setBusy(null); }
  };
  const openChat = (conversationId: string | null) => {
    play('selection');
    if (!conversationId) { liveNotice(tr('개발용 예시라 실제 채팅은 열리지 않아요')); return; }
    onClose(); router.push({ pathname: '/chat', params: { conversationId, view: 'direct' } });
  };
  return <View style={[styles.quote, { backgroundColor: theme.backgroundElement }]}>
    <Label>{tr('손 흔든 사람 {0}명', waves.length)}</Label>
    {waves.map(wave => <View key={wave.id} style={styles.person}>
      <InitialAvatar name={wave.sender.nickname} />
      <View style={styles.flex}>
        <View style={styles.nameRow}><ThemedText type="smallBold" numberOfLines={1} style={styles.shrink}>{wave.sender.nickname}</ThemedText>
          <TrustBadge trustLevel={wave.sender.trustLevel === 1 ? undefined : wave.sender.trustLevel} />{wave.demo && <Tag label={tr('개발용 예시')} tone="quiet" />}</View>
        <ThemedText type="caption" themeColor="textSecondary">{wave.reply?.status === 'pending' ? tr('대화 신청 보냈어요') : wave.reply?.status === 'declined' ? tr('이번엔 대화가 이어지지 않았어요')
          : wave.reply?.status === 'accepted' ? tr('{0}님이 대화 신청을 받았어요', wave.sender.nickname) : relativeTime(wave.createdAt, now)}</ThemedText>
      </View>
      {!wave.reply ? <Pressable analyticsId="livemap.wave.reply" accessibilityRole="button" accessibilityLabel={tr('{0}님에게 대화 신청', wave.sender.nickname)} disabled={!!busy} onPress={() => void reply(wave)}
        style={({ pressed }) => [ControlStyles.pill, styles.wavePill, controlPresentation(theme, { tone: 'primary', pressed, busy: busy === wave.id, clay }).container]}>
        {clay && <ClayPillFill kind="cta" />}
        <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{tr('대화 신청')}</ThemedText>
      </Pressable> : wave.reply.status === 'accepted' && <Pressable analyticsId="livemap.chat" accessibilityRole="button" onPress={() => openChat(wave.reply?.conversationId ?? null)}
        style={({ pressed }) => [ControlStyles.pill, styles.wavePill, controlPresentation(theme, { pressed, clay }).container]}>
        {clay && <ClayPillFill kind="white" />}
        <ThemedText type="smallBold">{tr('대화하러 가기')}</ThemedText>
      </Pressable>}
    </View>)}
    {problem ? <ThemedText type="small" accessibilityRole="alert">{tr(problem)}</ThemedText> : null}
    <ThemedText type="caption" themeColor="textSecondary">{tr('손 흔든 사람은 나만 봐요. 여기서 보내는 대화 신청도 하루 5번에 들어가요.')}</ThemedText>
  </View>;
}

/** The phone's current fix as reported (checked afterwards by postingPlace); throws PERMISSION or TIMEOUT. */
async function readFix(): Promise<LocationFix> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) throw new Error('PERMISSION');
    const value = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), 15000); })]);
    return { latitude: value.coords.latitude, longitude: value.coords.longitude, accuracy: value.coords.accuracy, measuredAt: value.timestamp, mocked: value.mocked ?? false };
  } finally { if (timer) clearTimeout(timer); }
}

/**
 * 말풍선 남기기 → 남들에게 이렇게 보여요 → (위치 바꾸기, 100 m 안) → 남기기. Mount with a new key per opening.
 * Members always start from a fresh fix where they are; admins drag the pin anywhere and pick 관리자 핀 or 회원처럼.
 */
export function LiveComposeSheet({ visible, onClose, city, mapCenter }: { visible: boolean; onClose: () => void; city: { id: string; name: string; englishName: string }; mapCenter: Point }) {
  const { tr, locale } = useLanguage(), theme = useTheme(), { play } = useInteractionFeedback(), { isAdmin } = useAuth();
  const live = useLive(), mine = live.map?.mine ?? null, waves = live.map?.waves ?? [], now = useNow();
  const [step, setStep] = useState<'write' | 'preview' | 'adjust'>('write');
  const [body, setBody] = useState(mine?.body ?? ''), [audience, setAudience] = useState<LiveAudience>(mine?.audience ?? 'city');
  const [minutes, setMinutes] = useState<number>(60), [kind, setKind] = useState<LiveKind>(mine?.kind ?? 'member');
  const [origin, setOrigin] = useState<Point | null>(null), [spot, setSpot] = useState<Point | null>(() => isAdmin ? mine ?? mapCenter : null);
  const [locating, setLocating] = useState(!isAdmin), [problem, setProblem] = useState(''), [busy, setBusy] = useState(false), [atEdge, setAtEdge] = useState(false);
  const alive = useRef(true);
  // Fixed for this opening (the sheet mounts with a new key each time), so a moving map centre never re-runs the location check.
  const [start] = useState(() => ({ demo: live.demo, center: mapCenter, before: isAdmin ? [] : myShownPoints() })), footer = useKeepClearOfNotice();
  // Where the bubble will really show, for the chosen audience: what the server keeps (an admin's spot stays exact).
  const point = spot && !isAdmin ? shownPoint(spot, start.before, audience) : spot;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const locate = useCallback(() => readFix().catch(error => { if (start.demo) return null; throw error; }).then(fix => postingPlace(fix, start.demo, start.center)).then(place => {
    if (alive.current) { setOrigin(place); setSpot(place); }
  }, error => { if (alive.current) setProblem(locationProblem(error instanceof Error ? error.message : '')); }).finally(() => { if (alive.current) setLocating(false); }), [start]);
  useEffect(() => { if (!isAdmin) void locate(); }, [isAdmin, locate]);
  const ready = !!body.trim() && !!point && !busy && (isAdmin || !!origin);
  const submit = async () => {
    if (!ready || !point) return;
    play('selection'); setBusy(true); setProblem('');
    try {
      await postLiveBubble({ cityId: city.id, body, audience, minutes, point, kind: isAdmin ? kind : 'member' });
      play('success');
      liveNotice(mine ? tr('말풍선을 바꿨어요. {0} 뒤에 사라져요', durationLabel(minutes)) : tr('말풍선을 띄웠어요. {0} 뒤에 사라져요', durationLabel(minutes)));
      onClose();
    } catch (error) { play('warning'); if (alive.current) setProblem(actionProblem(error)); }
    finally { if (alive.current) setBusy(false); }
  };
  const end = async () => {
    if (busy) return;
    play('selection'); setBusy(true);
    try { await endLiveBubble(); play('success'); liveNotice(tr('말풍선을 내렸어요')); onClose(); }
    catch (error) { play('warning'); if (alive.current) setProblem(actionProblem(error)); }
    finally { if (alive.current) setBusy(false); }
  };
  const move = (pin: Point) => {
    if (!origin) return;
    // The 100 m is measured before the pin settles on the ~100 m grid, the point others will see.
    const next = clampWithin(origin, pin), edge = distanceMeters(pin, next) > 1;
    if (edge) play('warning');
    setAtEdge(edge); setSpot(next);
  };
  // Back near an earlier bubble, the server keeps its point, so a moved pin stays put; say why rather than look stuck.
  const grid = spot && approximatePoint(spot), kept = !isAdmin && !!point && !!grid && (point.latitude !== grid.latitude || point.longitude !== grid.longitude);
  const keptLine = kept && <ThemedText type="caption" themeColor="textSecondary" accessibilityLiveRegion="polite">{tr('전에 띄운 자리와 가까워서 같은 자리에 보여요')}</ThemedText>;
  const title = step === 'preview' ? tr('남들에게 이렇게 보여요') : step === 'adjust' ? tr('위치 바꾸기') : mine ? tr('내 말풍선') : tr('말풍선 남기기');
  const preview: DiscoveryMarker[] = point ? [{ id: 'preview', ...point, color: BUBBLE_COLOR, label: body.trim().slice(0, 80) || tr('한마디'), sublabel: tr('{0} · {1}까지', tr('나'), untilClock(new Date(now + minutes * 60000).toISOString(), locale, city.id)), icon: kind === 'pin' && isAdmin ? 'visited' : 'bubble' }] : [];
  const problemLine = !!problem && <View style={[styles.notice, { backgroundColor: theme.backgroundElement }]}>
    <ThemedText type="small" accessibilityRole="alert" style={styles.flex}>{tr(problem)}</ThemedText>
    {!isAdmin && !origin && !locating && <Pressable analyticsId="livemap.compose" accessibilityRole="button" accessibilityLabel={tr('지금 있는 곳 다시 확인')} onPress={() => { play('selection'); setLocating(true); setProblem(''); void locate(); }} style={styles.inlineLink}>
      <ThemedText type="smallBold" themeColor="accent">{tr('다시 확인')}</ThemedText></Pressable>}
  </View>;
  return <DragSheet visible={visible} onClose={onClose} dismissible={!busy} title={title}>
    <ScrollView analyticsId="livemap.compose" keyboardShouldPersistTaps="handled" style={styles.scroll} contentContainerStyle={styles.body}>
      {step === 'write' ? <>
        <ThemedText type="small" themeColor="textSecondary">{mine ? tr('지금 떠 있어요 · {0} 남음', durationLabel(minutesLeft(mine.expiresAt, now))) : tr('짧은 한마디 하나면 돼요')}</ThemedText>
        {mine && waves.length > 0 && <WaveList waves={waves} now={now} onClose={onClose} />}
        {isAdmin ? <>
          <Label>{tr('남기는 방식')}</Label>
          <View style={styles.choices}>{(['pin', 'member'] as const).map(value => <Choice key={value} analyticsId="livemap.compose" selected={kind === value} label={value === 'pin' ? tr('관리자 핀') : tr('회원처럼')} onPress={() => { play('selection'); setKind(value); }} />)}</View>
          <ThemedText type="caption" themeColor="textSecondary">{kind === 'pin' ? tr('글링 표시가 붙은 핀으로 떠요. 공지나 행사를 알릴 때 쓰기 좋아요.') : tr('회원 말풍선과 똑같이 보여요. 관리자라는 표시는 안 붙어요.')}</ThemedText>
          <View style={styles.pinMap}><PostPinMap pin={point} cityName={city.englishName} onSelect={pin => setSpot(pin)} /></View>
          <ThemedText type="caption" themeColor="textSecondary">{tr('두 방식 모두 핀을 끌어 아무 데나 옮길 수 있어요')}</ThemedText>
        </> : <View style={[styles.info, { backgroundColor: theme.backgroundElement }]}>
          <SymbolView name={{ ios: 'location', android: 'my_location', web: 'my_location' }} size={IconSize.toolbar} tintColor={theme.accent} />
          <View style={styles.flex}>
            <ThemedText type="smallBold" accessibilityLiveRegion="polite">{locating ? tr('지금 있는 곳을 확인하고 있어요') : tr('{0} · 지금 있는 곳 근처', tr(city.name))}</ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">{tr('지금 있는 곳에서 100m 안으로 옮길 수 있어요. 다음 화면에서 남들에게 보이는 자리를 먼저 확인해요.')}</ThemedText>
            {start.demo && <ThemedText type="caption" themeColor="accent">{tr('개발용 예시: 시뮬레이터 위치를, 없으면 도시 가운데를 지금 있는 곳으로 써요.')}</ThemedText>}
          </View>
        </View>}
        {problemLine}
        <Label>{tr('한마디')}</Label>
        <TextInput value={body} onChangeText={setBody} onFocus={() => play('selection')} maxLength={LIVE.bodyMax} placeholder={tr('예: 커피 한잔 할 사람')} accessibilityLabel={tr('한마디')}
          placeholderTextColor={theme.textSecondary} returnKeyType="done" style={[ControlStyles.field, styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.background }]} />
        <ThemedText type="caption" themeColor="textSecondary" style={styles.counter}>{tr('{0}/{1}자', body.length, LIVE.bodyMax)}</ThemedText>
        <View style={styles.choices}>{QUICK_PHRASES.map(phrase => <Choice key={phrase} analyticsId="livemap.compose" selected={body === tr(phrase)} label={tr(phrase)} onPress={() => { play('selection'); setBody(tr(phrase)); }} />)}</View>
        <Label>{tr('보는 사람')}</Label>
        <View style={styles.choices}>{(['city', 'friends'] as const).map(value => <Choice key={value} analyticsId="livemap.compose" selected={audience === value} label={value === 'city' ? tr('도시 전체') : tr('친구만')} onPress={() => { play('selection'); setAudience(value); }} />)}</View>
        <ThemedText type="caption" themeColor="textSecondary">{audience === 'city' ? tr('{0}에서 글링 쓰는 사람 누구나 봐요', tr(city.name)) : tr('서로 친구 맺은 사람만 봐요')}</ThemedText>
        <Label>{tr('떠 있는 시간')}</Label>
        <View style={styles.choices}>{LIVE.durations.map(value => <Choice key={value} analyticsId="livemap.compose" selected={minutes === value} label={durationLabel(value)} onPress={() => { play('selection'); setMinutes(value); }} />)}</View>
        <ThemedText type="caption" themeColor="textSecondary">{tr('한 번에 하나만 띄울 수 있어요. 새로 남기면 전에 남긴 건 바뀌어요.')}{'\n'}{tr('대화 신청이 오면 받을지는 그때 정하면 돼요.')}</ThemedText>
      </> : step === 'preview' ? <>
        <ThemedText type="small" themeColor="textSecondary">{tr('대략 여기쯤이에요. 정확한 자리는 안 보여요')}</ThemedText>
        {point && <View style={styles.previewMap}><DiscoveryMap key={`${point.latitude},${point.longitude}`} markers={preview} cityName={city.englishName} center={point} zoom={15} onSelect={() => {}} /></View>}
        <ThemedText type="caption" themeColor="textSecondary">{tr('다른 사람이 보는 지도')}</ThemedText>
        {keptLine}
        {problemLine}
      </> : <>
        <ThemedText type="small" themeColor="textSecondary">{tr('핀을 끌어 옮기면 남들에게 보이는 자리도 같이 바뀌어요')}</ThemedText>
        <View style={styles.previewMap}><PostPinMap pin={point} cityName={city.englishName} onSelect={move} /></View>
        <ThemedText type="caption" accessibilityLiveRegion="polite" style={{ color: atEdge ? theme.accent : theme.textSecondary }}>{atEdge ? tr('100m까지만 옮길 수 있어요. 그 끝에 놓아 뒀어요.') : tr('100m 안에서 옮길 수 있어요')}</ThemedText>
        {keptLine}
        {problemLine}
      </>}
    </ScrollView>
    {/* Pinned under the scrolling part, so a long sheet (with people who waved) never pushes the buttons off screen. */}
    <View ref={footer} style={styles.footer}>
      {step === 'write' ? <View style={styles.actions}>
        {mine && <Secondary analyticsId="livemap.end" label={tr('내리기')} disabled={busy} onPress={() => void end()} />}
        <View style={styles.flex}><RaisedActionButton analyticsId="livemap.compose.next" label={isAdmin ? mine ? tr('다시 띄우기') : tr('남기기') : tr('다음')} disabled={!ready} busy={busy}
          onPress={() => { if (isAdmin) void submit(); else { play('selection'); setStep('preview'); } }} /></View>
      </View> : step === 'preview' ? <>
        <View style={styles.actions}>
          <Secondary analyticsId="livemap.preview" label={tr('위치 바꾸기')} disabled={busy} onPress={() => { play('selection'); setAtEdge(false); setStep('adjust'); }} />
          <View style={styles.flex}><RaisedActionButton analyticsId="livemap.post" label={mine ? tr('다시 띄우기') : tr('남기기')} disabled={!ready} busy={busy} onPress={() => void submit()} /></View>
        </View>
        <Pressable analyticsId="livemap.preview" accessibilityRole="button" onPress={() => { play('selection'); setStep('write'); }} style={styles.link}><ThemedText type="smallBold" themeColor="accent">{tr('글 고치기')}</ThemedText></Pressable>
      </> : <View style={styles.actions}>
        {/* Owner 2026-11-08 "내위치찾기로 새로고침가능하게": a fresh fix re-centres the pin and its 100 m circle on where the member is now. */}
        <Secondary analyticsId="livemap.preview" label={locating ? tr('위치 확인 중') : tr('내 위치 찾기')} disabled={locating} onPress={() => { play('selection'); setAtEdge(false); setLocating(true); setProblem(''); void locate(); }} />
        <View style={styles.flex}><RaisedActionButton analyticsId="livemap.preview" label={tr('이 자리로 할게요')} onPress={() => { play('selection'); setStep('preview'); }} /></View>
      </View>}
    </View>
  </DragSheet>;
}

/** What a member sees after tapping someone's bubble: who left it, and a chat request (or where that request stands). */
export function LiveRequestSheet({ visible, bubble, map, now, onClose, onDismissed, onReport, onBlock }: {
  visible: boolean; bubble: LiveBubble | null; map: LiveMap | null; now: number; onClose: () => void; onDismissed: () => void; onReport: (bubble: LiveBubble) => void; onBlock: (bubble: LiveBubble) => void;
}) {
  const { tr } = useLanguage(), theme = useTheme(), { play } = useInteractionFeedback(), router = useRouter();
  const [greeting, setGreeting] = useState(0), [busy, setBusy] = useState(false), [problem, setProblem] = useState(''), clear = useKeepClearOfNotice();
  const sent = bubble?.sent ?? null, pendingId = sent?.status === 'pending' ? sent.id : null, wavesLeft = map?.wavesLeft ?? 0;
  // Until the owner answers, look again every 15 seconds (the accepted push also arrives).
  useEffect(() => {
    if (!visible || !pendingId || getLive().demo) return;
    const timer = setInterval(() => void refreshLive(), 15000);
    return () => clearInterval(timer);
  }, [visible, pendingId]);
  if (!bubble) return <DragSheet visible={false} onClose={onClose}><View /></DragSheet>;
  const name = bubble.author.nickname, left = map?.requestsLeft ?? 0, limit = map?.requestLimit ?? LIVE.dailyRequests;
  const send = async () => {
    if (busy) return;
    play('selection'); setBusy(true); setProblem('');
    try {
      await sendLiveRequest(bubble.id, greeting);
      play('message');
      const after = getLive().map?.requestsLeft ?? 0;
      liveNotice(after ? tr('대화 신청 보냈어요. 오늘 {0}번 남았어요', after) : tr('대화 신청 보냈어요. 오늘 신청은 다 썼어요'));
    } catch (error) { play('warning'); setProblem(actionProblem(error)); }
    finally { setBusy(false); }
  };
  const wave = async () => {
    if (busy || bubble.waved) return;
    play('selection'); setBusy(true); setProblem('');
    try { await waveLiveBubble(bubble.id); play('success'); liveNotice(tr('손을 흔들었어요')); }
    catch (error) { play('warning'); setProblem(actionProblem(error)); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!sent || busy) return;
    play('selection'); setBusy(true);
    try { await cancelLiveRequest(sent.id); liveNotice(tr('대화 신청을 취소했어요. 쓴 횟수는 돌아오지 않아요')); }
    catch (error) { play('warning'); setProblem(actionProblem(error)); }
    finally { setBusy(false); }
  };
  const openChat = () => {
    play('selection');
    if (!sent?.conversationId) { liveNotice(tr('개발용 예시라 실제 채팅은 열리지 않아요')); return; }
    onClose(); router.push({ pathname: '/chat', params: { conversationId: sent.conversationId, view: 'direct' } });
  };
  const profile = () => { if (bubble.demo) liveNotice(tr('개발용 예시라 프로필이 없어요')); else { onClose(); router.push({ pathname: '/user/[id]', params: { id: bubble.author.id, nickname: name } }); } };
  return <DragSheet visible={visible} onClose={onClose} onDismissed={onDismissed} dismissible={!busy}>
    <ScrollView analyticsId="livemap.request" style={styles.scroll} contentContainerStyle={styles.body}>
      <Person person={bubble.author} demo={bubble.demo} onProfile={bubble.kind === 'pin' ? undefined : profile} />
      <View style={[styles.quote, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="section">{bubble.body}</ThemedText>
        <View style={styles.metaRow}>
          <ThemedText type="caption" themeColor="textSecondary" style={styles.flex}>{tr('{0} · {1} 뒤 사라져요', relativeTime(bubble.createdAt, now), durationLabel(minutesLeft(bubble.expiresAt, now)))}</ThemedText>
          <Pressable analyticsId="livemap.request" accessibilityRole="button" accessibilityLabel={tr('이 말풍선 신고')} onPress={() => { play('selection'); onReport(bubble); }} style={styles.inlineLink}>
            <ThemedText type="caption" themeColor="textSecondary">{tr('신고')}</ThemedText></Pressable>
        </View>
      </View>
      <View ref={clear} style={styles.stack}>
      {bubble.kind === 'pin' ? <ThemedText type="small" themeColor="textSecondary">{tr('글링이 남긴 핀이에요.')}</ThemedText>
      : sent?.status === 'pending' ? <>
        <ThemedText type="section" accessibilityLiveRegion="polite">{tr('대화 신청 보냈어요')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{`“${tr(GREETINGS[sent.greeting] ?? GREETINGS[0])}”\n`}{tr('{0}님이 받으면 알림이 와요.', name)}</ThemedText>
        <Secondary analyticsId="livemap.request.cancel" label={tr('신청 취소')} disabled={busy} onPress={() => void cancel()} />
      </> : sent?.status === 'declined' ? <>
        <ThemedText type="section" accessibilityLiveRegion="polite">{tr('이번엔 대화가 이어지지 않았어요')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{tr('바쁘거나 자리를 떴을 수도 있어요. 다른 말풍선도 눌러 봐요.')}</ThemedText>
        <RaisedActionButton analyticsId="livemap.request" label={tr('지도 둘러보기')} onPress={() => { play('selection'); onClose(); }} />
      </> : sent?.status === 'accepted' ? <>
        <ThemedText type="section" accessibilityLiveRegion="polite">{tr('{0}님이 대화 신청을 받았어요', name)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{tr('이제 대화 화면에서 얘기하면 돼요.')}</ThemedText>
        <RaisedActionButton analyticsId="livemap.chat" label={tr('대화하러 가기')} onPress={openChat} />
      </> : <>
        <Label>{tr('같이 보낼 말')}</Label>
        <View style={styles.choices}>{GREETINGS.map((value, index) => <Choice key={value} analyticsId="livemap.request" selected={greeting === index} label={tr(value)} onPress={() => { play('selection'); setGreeting(index); }} />)}</View>
        {problem ? <ThemedText type="small" accessibilityRole="alert">{tr(problem)}</ThemedText> : null}
        <View style={styles.actions}>
          <Secondary analyticsId="livemap.wave" label={bubble.waved ? tr('손을 흔들었어요') : tr('👋 손 흔들기')} disabled={busy || bubble.waved || wavesLeft <= 0} onPress={() => void wave()} />
          <View style={styles.flex}><RaisedActionButton analyticsId="livemap.request.send" label={tr('대화 신청')} disabled={left <= 0} busy={busy} onPress={() => void send()} /></View>
        </View>
        <ThemedText type="caption" themeColor="textSecondary">{bubble.waved ? tr('손 흔든 건 {0}님만 알아요. 답이 오면 알려 드릴게요.', name) : tr('손 흔들기는 {0}님만 알 수 있어요. 대화 신청 5번과는 상관없어요.', name)}</ThemedText>
        <View style={styles.quota} accessible accessibilityLabel={left ? tr('오늘 남은 신청 {0}번 · 하루 {1}번까지', left, limit) : tr('오늘 신청 {0}번을 다 썼어요. 내일 다시 보낼 수 있어요', limit)}>
          <View style={styles.dots}>{Array.from({ length: limit }, (_, index) => <View key={index} style={[styles.dot, { backgroundColor: index < left ? theme.accent : theme.line }]} />)}</View>
          <ThemedText type="caption" themeColor="textSecondary" style={styles.flex}>{left ? tr('오늘 남은 신청 {0}번 · 하루 {1}번까지', left, limit) : tr('오늘 신청 {0}번을 다 썼어요. 내일 다시 보낼 수 있어요', limit)}</ThemedText>
        </View>
        <ThemedText type="caption" themeColor="textSecondary">{tr('{0}님이 받으면 채팅이 열려요.', name)}</ThemedText>
      </>}
      {sent?.status === 'pending' && !!problem && <ThemedText type="small" accessibilityRole="alert">{tr(problem)}</ThemedText>}
      {bubble.kind !== 'pin' && <Pressable analyticsId="livemap.request" accessibilityRole="button" accessibilityLabel={tr('{0}님 차단하기', name)} onPress={() => { play('selection'); onBlock(bubble); }} style={styles.link}>
        <ThemedText type="small" themeColor="textSecondary">{tr('차단하기')}</ThemedText></Pressable>}
      </View>
    </ScrollView>
  </DragSheet>;
}

/** What the bubble's owner sees: who asked, with which line, and accept or decline. */
export function LiveReceivedSheet({ visible, request, onClose }: { visible: boolean; request: LiveRequest | null; onClose: () => void }) {
  const { tr } = useLanguage(), theme = useTheme(), { play } = useInteractionFeedback(), router = useRouter();
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState(''), [photo, setPhoto] = useState<string>(), clear = useKeepClearOfNotice();
  // The sender's photo (owner 2026-11-06), read the way notifications read it; no photo or a failed read stays the first letter. The sheet remounts per request.
  const senderId = request && !request.demo ? request.sender.id : null;
  useEffect(() => {
    if (!senderId) return;
    let active = true;
    void loadNotificationActors(supabase, [senderId]).then(actors => { if (active) setPhoto(actors.get(senderId)?.avatarUrl); }).catch(() => undefined);
    return () => { active = false; };
  }, [senderId]);
  if (!request) return <DragSheet visible={false} onClose={onClose}><View /></DragSheet>;
  const name = request.sender.nickname;
  const respond = async (response: 'accepted' | 'declined') => {
    if (busy) return;
    play('selection'); setBusy(true); setProblem('');
    try {
      const conversationId = await respondLiveRequest(request.id, response);
      if (response === 'declined') { play('success'); return; }
      play('message');
      if (conversationId) { onClose(); router.push({ pathname: '/chat', params: { conversationId, view: 'direct' } }); }
      else liveNotice(tr('개발용 예시라 실제 채팅은 열리지 않아요'));
    } catch (error) { play('warning'); setProblem(actionProblem(error)); }
    finally { setBusy(false); }
  };
  const profile = () => { if (request.demo) liveNotice(tr('개발용 예시라 프로필이 없어요')); else { onClose(); router.push({ pathname: '/user/[id]', params: { id: request.sender.id, nickname: name } }); } };
  return <DragSheet visible={visible} onClose={onClose} dismissible={!busy} title={tr('대화 신청')}>
    <ScrollView analyticsId="livemap.received" style={styles.scroll} contentContainerStyle={styles.body}>
      <Person person={request.sender} photo={photo} demo={request.demo} onProfile={profile} />
      <View style={[styles.quote, { backgroundColor: theme.backgroundElement }]}>
        {request.waveReply ? <>
          <ThemedText type="section">{tr('내 손 흔들기에 답했어요')}</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">{tr('‘{0}’ 말풍선을 남긴 분이에요', request.bubbleBody)}</ThemedText>
        </> : <>
          <ThemedText type="caption" themeColor="textSecondary">{tr('보낸 말')}</ThemedText>
          <ThemedText type="section">{`“${tr(GREETINGS[request.greeting] ?? GREETINGS[0])}”`}</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">{tr('내 말풍선 ‘{0}’에 온 신청이에요', request.bubbleBody)}</ThemedText>
        </>}
      </View>
      <View ref={clear} style={styles.stack}>
      {problem ? <ThemedText type="small" accessibilityRole="alert">{tr(problem)}</ThemedText> : null}
      {request.status === 'accepted' ? <>
        <ThemedText type="section" accessibilityLiveRegion="polite">{tr('수락했어요')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{tr('채팅에서 바로 이어서 얘기하면 돼요.')}</ThemedText>
        {request.conversationId && <RaisedActionButton analyticsId="livemap.chat" label={tr('대화하러 가기')} onPress={() => { play('selection'); onClose(); router.push({ pathname: '/chat', params: { conversationId: request.conversationId!, view: 'direct' } }); }} />}
      </> : request.status === 'declined' ? <>
        <ThemedText type="section" accessibilityLiveRegion="polite">{tr('거절했어요')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{tr('이 신청은 목록에서 뺐어요.')}</ThemedText>
      </> : <>
        <View style={styles.actions}>
          <Secondary analyticsId="livemap.received.decline" label={tr('거절')} disabled={busy} onPress={() => void respond('declined')} />
          <View style={styles.flex}><RaisedActionButton analyticsId="livemap.received.accept" label={tr('수락하고 대화 시작')} busy={busy} onPress={() => void respond('accepted')} /></View>
        </View>
        <ThemedText type="caption" themeColor="textSecondary">{tr('거절해도 {0}님 화면엔 ‘이번엔 대화가 이어지지 않았어요’라고만 떠요.', name)}</ThemedText>
      </>}
      </View>
    </ScrollView>
  </DragSheet>;
}

export type LiveOpen = { kind: 'compose'; session: number } | { kind: 'request'; bubbleId: string } | { kind: 'received'; requestId: string };

/** Every live-map sheet in one place: compose, request, received, plus report and block for a bubble. */
export function LiveSheets({ open, onChange, city, mapCenter, now }: { open: LiveOpen | null; onChange: (next: LiveOpen | null) => void; city: { id: string; name: string; englishName: string }; mapCenter: Point; now: number }) {
  const { tr } = useLanguage(), { play } = useInteractionFeedback(), { me } = useAuth(), live = useLive(), map = live.map;
  const [composeSession, setComposeSession] = useState(0);
  if (open?.kind === 'compose' && open.session !== composeSession) setComposeSession(open.session);
  // Remembered while closing, so the sheet keeps its content as it slides away.
  const [lastBubble, setLastBubble] = useState<string | null>(null), [lastRequest, setLastRequest] = useState<string | null>(null);
  if (open?.kind === 'request' && open.bubbleId !== lastBubble) setLastBubble(open.bubbleId);
  if (open?.kind === 'received' && open.requestId !== lastRequest) setLastRequest(open.requestId);
  const bubble = map?.bubbles.find(value => value.id === lastBubble) ?? null;
  const request = map?.received.find(value => value.id === lastRequest) ?? null;
  const [reporting, setReporting] = useState<LiveBubble | null>(null), afterClose = useRef<(() => void) | null>(null);
  const report = (target: LiveBubble) => {
    if (target.demo) { hideContent(me.id, 'live_bubble', target.id); liveNotice(tr('개발용 예시라 신고는 보내지 않았어요. 내 지도에선 가려 둘게요')); onChange(null); return; }
    afterClose.current = () => setReporting(target); onChange(null);
  };
  const block = (target: LiveBubble) => Alert.alert(tr('{0}님을 차단할까요?', target.author.nickname), tr('서로 말풍선이 안 보이고 대화 신청도 못 보내요.'), [
    { text: tr('취소'), style: 'cancel' },
    { text: tr('차단하기'), style: 'destructive', onPress: () => void (async () => {
      try {
        if (target.demo) hideContent(me.id, 'user', target.author.id); else { await blockUser(supabase, me.id, target.author.id); await refreshLive(); }
        play('success'); onChange(null); liveNotice(tr('{0}님을 차단했어요. 이제 서로 말풍선이 안 보여요', target.author.nickname));
      } catch { play('warning'); Alert.alert(tr('차단하지 못했어요'), tr('연결을 확인하고 다시 해 주세요.')); }
    })() },
  ]);
  // Sibling sheets: each key carries its own prefix so two empty ids never collide (React duplicate-key error).
  return <>
    {composeSession > 0 && <LiveComposeSheet key={`compose:${composeSession}`} visible={open?.kind === 'compose'} onClose={() => onChange(null)} city={city} mapCenter={mapCenter} />}
    {/* The report sheet opens only once the bubble sheet is gone; iOS drops a modal presented over one still leaving. */}
    <LiveRequestSheet key={`request:${lastBubble ?? ''}`} visible={open?.kind === 'request' && !!bubble} bubble={bubble} map={map} now={now} onClose={() => onChange(null)} onReport={report} onBlock={block}
      onDismissed={() => { const then = afterClose.current; afterClose.current = null; then?.(); }} />
    <LiveReceivedSheet key={`received:${lastRequest ?? ''}`} visible={open?.kind === 'received' && !!request} request={request} onClose={() => onChange(null)} />
    {reporting && <ReportSheet visible targetType="live_bubble" targetId={reporting.id} reportedUserId={reporting.kind === 'pin' ? undefined : reporting.author.id} reportedNickname={reporting.author.nickname} onClose={() => { setReporting(null); void refreshLive(); }} />}
  </>;
}
const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 }, shrink: { flexShrink: 1 },
  dock: { borderWidth: 1, borderRadius: 18, padding: 12, gap: 4, shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  dockRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
  dockPill: { ...ControlStyles.pill, minHeight: 36, borderRadius: 18 },
  dockPillClay: { paddingHorizontal: 16 },
  extendRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'center' },
  inlineLink: { minHeight: 32, justifyContent: 'center', alignSelf: 'flex-start' },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { gap: Spacing.two + 4, paddingBottom: Spacing.two },
  info: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 14, alignItems: 'flex-start' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12 },
  input: { fontSize: 16 },
  counter: { alignSelf: 'flex-end', marginTop: -6 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  footer: { paddingTop: Spacing.two }, stack: { gap: Spacing.two + 4 },
  secondary: { borderWidth: 1 },
  pinMap: { height: 200, borderRadius: 14, overflow: 'hidden' },
  previewMap: { height: 260, borderRadius: 14, overflow: 'hidden' },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  quote: { padding: 14, borderRadius: 16, gap: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  quota: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dots: { flexDirection: 'row', gap: 4 }, dot: { width: 8, height: 8, borderRadius: 4 },
  wavePill: { minHeight: 36, borderRadius: 18, borderWidth: 1 },
});
