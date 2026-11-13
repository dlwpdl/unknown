import { useLanguage } from '@/hooks/use-language';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SymbolView } from '@/components/symbol-view';
import Reanimated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { ClayBoxFill, ClayPillFill, useClay, useClayBox } from '@/components/clay';
import { Pressable, ScrollView, Switch } from '@/components/analytics-controls';
import { DiscoveryMap, type DiscoveryMarker } from '@/components/discovery-map';
import { DragSheet } from '@/components/drag-sheet';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles, controlPresentation } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { count } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { getCityPlaces } from '@/lib/city-places';
import { deliveryPartnerPlace } from '@/lib/delivery-partners';
import { placeMapRoute } from '@/lib/discovery';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES } from '@/lib/mock';
import { friendErrorMessage, loadProfileOverview, savedPlaceCities, setFriendship, setProfileSharing, type FriendAction, type FriendshipResult, type ProfileOverview } from '@/lib/profile-friends';
import { supabase } from '@/lib/supabase';

const MAP_HEIGHT = 200;
const cityOf = (cityId: string | null | undefined) => CITIES.find(city => city.id === cityId);

// P1: the saved-places map. Pins come only from the server's place list (catalog places and consented businesses),
// so a saved listing or person can never become a pin.
export function ProfileSavedMap({ overview, homeCityId }: { overview: ProfileOverview; homeCityId: string | null }) {
  const { tr } = useLanguage(), theme = useTheme(), router = useRouter(), { play } = useInteractionFeedback();
  const clay = useClay(), clayBox = useClayBox();
  const pins = overview.savedPlaces;
  const cities = useMemo(() => savedPlaceCities(pins ?? []), [pins]);
  const markers = useMemo(() => {
    const byCity = new Map<string, ReturnType<typeof getCityPlaces>>();
    return (pins ?? []).flatMap((pin): DiscoveryMarker[] => {
      let places = byCity.get(pin.cityId);
      if (!places) { try { places = getCityPlaces(pin.cityId); } catch { places = []; } byCity.set(pin.cityId, places); }
      const place = places.find(item => item.id === pin.placeKey) ?? deliveryPartnerPlace(pin.cityId, pin.placeKey);
      if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return [];
      return [{ id: `${pin.cityId}|${pin.placeKey}`, latitude: place.latitude, longitude: place.longitude, color: pin.merchantId ? theme.accent : theme.navy, label: place.name }];
    });
  }, [pins, theme.accent, theme.navy]);
  const [picked, setPicked] = useState<string | null>(null);
  const cityId = cities.some(city => city.cityId === picked) ? picked! : cities.find(city => city.cityId === homeCityId)?.cityId ?? cities[0]?.cityId ?? null;
  const city = cityOf(cityId);
  if (!pins || !markers.length || !city) {
    const own = overview.own, locked = overview.mapHiddenReason === 'not_friends';
    const title = own ? tr('첫 장소 저장하기') : locked ? tr('친구가 되면 저장한 곳이 보여요')
      : overview.mapHiddenReason === 'not_shared' ? tr('저장한 곳을 아직 친구에게 보여 주지 않았어요') : tr('아직 지도에 보여 줄 장소가 없어요');
    const body = own ? tr('지도에서 마음에 드는 곳을 저장하면 여기에 모여요.') : locked && cityOf(homeCityId) ? tr('지금은 활동 지역만 보여요 · {0}', tr(cityOf(homeCityId)!.name)) : null;
    return <Reanimated.View entering={FadeIn.duration(200)} style={[styles.mapEmpty, clayBox ? styles.clayCard : { backgroundColor: theme.backgroundElement, borderColor: theme.line }]}>
      {clayBox && <ClayBoxFill kind="tile" />}
      <SymbolView name={{ ios: own ? 'mappin.and.ellipse' : 'lock', android: own ? 'add_location' : 'lock', web: own ? 'add_location' : 'lock' }} size={24} tintColor={theme.navy} />
      <ThemedText type="smallBold" style={styles.center}>{title}</ThemedText>
      {!!body && <ThemedText type="small" themeColor="textSecondary" style={styles.center}>{body}</ThemedText>}
      {own && <Pressable analyticsId="profile.map.first-save" accessibilityRole="button" accessibilityLabel={tr('지도에서 장소 찾기')}
        onPress={() => { play('selection'); router.push('/map'); }}
        style={({ pressed }) => [ControlStyles.pill, styles.border, controlPresentation(theme, { tone: 'primary', pressed, clay }).container]}>
        {clay && <ClayPillFill kind="cta" />}
        <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{tr('지도에서 장소 찾기')}</ThemedText>
      </Pressable>}
    </Reanimated.View>;
  }
  return <View style={styles.mapBlock}>
    <View style={[styles.map, { borderColor: theme.line }]}>
      <DiscoveryMap markers={markers} cityName={city.englishName} onSelect={id => {
        const [pinCity, placeKey] = id.split('|');
        if (pinCity && placeKey) router.push(placeMapRoute({ id: placeKey, cityId: pinCity }));
      }} />
    </View>
    {cities.length > 1 && <ScrollView analyticsId="profile.map.cities" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {cities.map(item => {
        const selected = item.cityId === cityId, name = cityOf(item.cityId)?.name ?? item.cityId;
        return <Pressable key={item.cityId} analyticsId="profile.map.city" accessibilityRole="button" accessibilityState={{ selected }}
          accessibilityLabel={tr('{0} 저장한 곳 {1}곳', tr(name), count(item.count))}
          onPress={() => { play('selection'); setPicked(item.cityId); }}
          style={({ pressed }) => [ControlStyles.pill, styles.border, clay && { overflow: 'visible', paddingHorizontal: 18 }, controlPresentation(theme, { selected, pressed, clay }).container]}>
          {clay && <ClayPillFill kind={selected ? 'on' : 'white'} />}
          <ThemedText type="smallBold" style={clay ? { color: selected ? theme.accentInk : theme.text } : controlPresentation(theme, { selected }).text}>{tr(name)} {count(item.count)}</ThemedText>
        </Pressable>;
      })}
    </ScrollView>}
  </View>;
}

// P2: record tiles. Only counts the server can actually make today; there are no save types such as 가 볼 곳 yet.
export function ProfileRecordTiles({ overview }: { overview: ProfileOverview }) {
  const { tr } = useLanguage(), theme = useTheme(), clayBox = useClayBox(), router = useRouter(), { play } = useInteractionFeedback(), reduced = useReducedMotion();
  const tiles: { id: string; value: string; label: string; open?: () => void }[] = [
    ...(overview.savedWeekStreak === null || overview.savedCount === null ? [] : [
      { id: 'streak', value: tr('{0}주', count(overview.savedWeekStreak)), label: tr('연속 저장') },
      { id: 'saved', value: count(overview.savedCount), label: tr('저장한 곳'),
        open: overview.own ? () => router.push({ pathname: '/profile/saved', params: { filter: 'places' } }) : undefined },
    ]),
    { id: 'meetups', value: count(overview.meetupCount), label: tr('연 모임') },
  ];
  return <ScrollView analyticsId="profile.records" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tiles}>
    {tiles.map((tile, index) => <Reanimated.View key={tile.id} style={styles.tileSlot} entering={reduced ? FadeIn.duration(150) : FadeInDown.delay(index * 60).duration(250)}>
      <Pressable analyticsId={`profile.record.${tile.id}`} accessibilityRole={tile.open ? 'button' : 'text'} disabled={!tile.open}
        accessibilityLabel={`${tile.label} ${tile.value}`} onPress={() => { if (!tile.open) return; play('selection'); tile.open(); }}
        style={({ pressed }) => [styles.tile, clayBox ? [styles.clayCard, { opacity: pressed && tile.open ? 0.8 : 1 }] : { backgroundColor: pressed && tile.open ? theme.backgroundSelected : theme.backgroundElement }]}>
        {clayBox && <ClayBoxFill kind="tile" />}
        <ThemedText type="subtitle" style={styles.tileValue}>{tile.value}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{tile.label}{tile.open ? ' ›' : ''}</ThemedText>
      </Pressable>
    </Reanimated.View>)}
  </ScrollView>;
}

const NOTICE_KEY = 'gling.friend-share-notice.v1:';
// Saved places reach friends by default (owner 2026-11-04 '켜 두기'), so a member's first request or accept says so once.
// Seen is kept on this device per member; a member who already turned sharing off gets no notice.
export function useFriendShareNotice() {
  const { tr } = useLanguage(), theme = useTheme(), { play } = useInteractionFeedback(), { me } = useAuth();
  const clay = useClay();
  const [pending, setPending] = useState<(() => void) | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const checking = useRef(false);
  const confirm = async (run: () => void) => {
    if (checking.current) return;
    checking.current = true;
    try {
      if (await AsyncStorage.getItem(NOTICE_KEY + me.id).catch(() => null)) return run();
      // A setting that cannot be read counts as on: telling once too often is the safe side.
      if (!await loadProfileOverview(supabase, me.id).then(overview => overview?.sharesSavedPlaces ?? true, () => true)) return run();
      setError(''); setPending(() => run);
    } finally { checking.current = false; }
  };
  const finish = async (hide: boolean) => {
    const run = pending;
    if (!run || busy) return;
    play('selection');
    if (hide) {
      setBusy(true); setError('');
      try { await setProfileSharing(supabase, false); }
      catch { setBusy(false); setError(tr('바꾸지 못했어요. 다시 시도해 주세요.')); play('warning'); return; }
      setBusy(false);
    }
    void AsyncStorage.setItem(NOTICE_KEY + me.id, '1').catch(() => {});
    setPending(null); run();
  };
  const action = (id: string, label: string, hide: boolean) =>
    <Pressable analyticsId={`friend.notice.${id}`} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: busy, busy: busy && hide }}
      disabled={busy} onPress={() => void finish(hide)}
      style={({ pressed }) => [ControlStyles.action, styles.border, controlPresentation(theme, { tone: hide ? 'secondary' : 'primary', pressed, busy: busy && hide, clay }).container]}>
      {clay && <ClayPillFill kind={hide ? 'white' : 'cta'} />}
      <ThemedText type="smallBold" style={controlPresentation(theme, { tone: hide ? 'secondary' : 'primary' }).text}>{label}</ThemedText>
    </Pressable>;
  const sheet = <DragSheet visible={!!pending} dismissible={!busy} onClose={() => setPending(null)} title={tr('저장한 곳은 친구에게 보여요')}>
    <View style={styles.notice}>
      <ThemedText type="small" themeColor="textSecondary">{tr('친구를 맺으면 내가 저장한 장소와 비즈니스를 그 친구가 지도에서 볼 수 있어요. 저장해 둔 구해요·팔아요 글과 프로필은 안 보이고, 설정에서 언제든 끌 수 있어요.')}</ThemedText>
      {!!error && <ThemedText type="small" accessibilityRole="alert">{error}</ThemedText>}
      {action('continue', tr('그대로 계속'), false)}
      {action('hide', tr('저장한 곳은 숨기고 계속'), true)}
    </View>
  </DragSheet>;
  return { confirm, sheet };
}

// P3: friend request button on someone else's profile. It shows for every 'none' state, operated characters included:
// the server refuses those with FRIEND_UNAVAILABLE, so the screen never gives an operated account away.
export function FriendButton({ overview, nickname, onChanged }: { overview: ProfileOverview; nickname: string; onChanged: (next: FriendshipResult) => void }) {
  const { tr } = useLanguage(), theme = useTheme(), { play } = useInteractionFeedback(), { isAuthed, promptLogin } = useAuth();
  const clay = useClay();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const notice = useFriendShareNotice();
  const state = overview.friendship;
  const run = async (action: FriendAction) => {
    if (busy) return;
    setBusy(true); setError('');
    try { const next = await setFriendship(supabase, overview.userId, action); onChanged(next); play(action === 'request' || action === 'accept' ? 'success' : 'selection'); }
    catch (failure) { setError(friendErrorMessage(failure)); play('warning'); }
    finally { setBusy(false); }
  };
  const button = (id: string, label: string, onPress: () => void, primary: boolean, hint?: string) =>
    <Pressable key={id} analyticsId={`user.friend.${id}`} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint}
      accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={() => { play('selection'); onPress(); }}
      style={({ pressed }) => [ControlStyles.action, styles.border, styles.grow, controlPresentation(theme, { tone: primary ? 'primary' : 'secondary', pressed, busy, clay }).container]}>
      {clay && <ClayPillFill kind={primary ? 'cta' : 'white'} />}
      <ThemedText type="smallBold" style={controlPresentation(theme, { tone: primary ? 'primary' : 'secondary' }).text}>{label}</ThemedText>
    </Pressable>;
  if (!isAuthed) return <View style={styles.row}>{button('request', tr('친구 추가'), () => promptLogin(tr('친구를 추가하려면 로그인해 주세요.')), true)}</View>;
  if (overview.own || state === null) return null;
  return <View style={styles.friend}>
    <View style={styles.row}>
      {state === 'none' && button('request', tr('친구 추가'), () => void notice.confirm(() => void run('request')), true, tr('상대가 받으면 친구가 돼요'))}
      {state === 'outgoing' && button('cancel', tr('요청 보냄'), () => void run('cancel'), false, tr('다시 누르면 요청을 취소해요'))}
      {state === 'incoming' && <>{button('accept', tr('수락'), () => void notice.confirm(() => void run('accept')), true)}{button('decline', tr('거절'), () => void run('decline'), false)}</>}
      {state === 'friends' && button('remove', tr('친구'), () => Alert.alert(tr('{0}님과 친구를 끊을까요?', nickname), tr('상대에게 따로 알리지 않아요.'), [
        { text: tr('취소'), style: 'cancel', onPress: () => play('selection') },
        { text: tr('친구 끊기'), style: 'destructive', onPress: () => void run('remove') },
      ]), false, tr('누르면 친구를 끊을 수 있어요'))}
    </View>
    {state === 'incoming' && <ThemedText type="small" themeColor="textSecondary">{tr('{0}님이 친구 요청을 보냈어요.', nickname)}</ThemedText>}
    {!!error && <ThemedText type="small" accessibilityRole="alert">{error}</ThemedText>}
    {notice.sheet}
  </View>;
}

// On by default (owner 2026-11-04): with no saved choice the server shares with friends, so the switch starts on too.
export function ProfileSharingCard() {
  const { tr } = useLanguage(), theme = useTheme(), clayBox = useClayBox(), { play } = useInteractionFeedback(), { me, isAuthed } = useAuth();
  const [state, setState] = useState<{ user: string; on: boolean | null; busy: boolean; error: string } | null>(null);
  const current = state?.user === me.id ? state : null;
  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    void loadProfileOverview(supabase, me.id).then(overview => { if (active) setState({ user: me.id, on: overview?.sharesSavedPlaces ?? true, busy: false, error: '' }); })
      .catch(() => { if (active) setState({ user: me.id, on: null, busy: false, error: tr('설정을 불러오지 못했어요. 잠시 후 다시 열어 주세요.') }); });
    return () => { active = false; };
  }, [isAuthed, me.id, tr]);
  const change = async (on: boolean) => {
    if (!current || current.busy || current.on === null) return;
    play('selection'); setState({ ...current, on, busy: true, error: '' });
    try { await setProfileSharing(supabase, on); setState({ user: me.id, on, busy: false, error: '' }); play('success'); }
    catch { setState({ user: me.id, on: !on, busy: false, error: tr('바꾸지 못했어요. 다시 시도해 주세요.') }); play('warning'); }
  };
  return <View style={[styles.card, clayBox ? styles.clayCard : { backgroundColor: theme.card, borderColor: theme.line }]}>
    {clayBox && <ClayBoxFill kind="tile" />}
    <View style={styles.cardRow}>
      <View style={styles.grow}>
        <ThemedText type="small">{tr('친구에게 저장한 곳 보여 주기')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{tr('켜면 내가 저장한 장소와 비즈니스를 친구가 지도에서 볼 수 있어요. 저장해 둔 구해요·팔아요 글과 프로필은 안 보여요.')}</ThemedText>
      </View>
      <Switch analyticsId="profile.settings.share-saved-places" value={current?.on ?? true} disabled={!current || current.busy || current.on === null}
        onValueChange={on => void change(on)} accessibilityLabel={tr('친구에게 저장한 곳 보여 주기')} />
    </View>
    {!!current?.error && <ThemedText type="small" accessibilityRole="alert">{current.error}</ThemedText>}
  </View>;
}

const styles = StyleSheet.create({
  clayCard: { backgroundColor: 'transparent', borderColor: 'transparent', overflow: 'visible' },
  card: { borderWidth: 1, borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: 44 },
  mapBlock: { gap: Spacing.two },
  map: { height: MAP_HEIGHT, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  mapEmpty: { minHeight: MAP_HEIGHT, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  center: { textAlign: 'center' },
  chips: { gap: Spacing.two },
  border: { borderWidth: 1 },
  // The tiles share the full row like the buttons above (QA H43-5); with large text they keep their width and the row scrolls.
  tiles: { flexGrow: 1, gap: Spacing.two },
  tileSlot: { flexGrow: 1 },
  tile: { minWidth: 104, minHeight: 76, borderRadius: 14, paddingHorizontal: Spacing.three, paddingVertical: 12, gap: 2, justifyContent: 'center' },
  tileValue: { fontVariant: ['tabular-nums'] },
  friend: { gap: Spacing.two },
  notice: { gap: Spacing.three, paddingBottom: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two },
  grow: { flex: 1 },
});
