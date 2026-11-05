import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles, controlPresentation } from '@/constants/design-system';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { getCityPlaces, type CityPlace } from '@/lib/city-places';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadPlaceSaves, type PlaceSaves } from '@/lib/profile-friends';
import { supabase } from '@/lib/supabase';

// G2 on a map place, laid out like the business page: who saved it and the 소개 3칸 near the top, similar places and the
// lists it is in further down. Nothing shows when the server has no real saves or the catalog has no intro.
export function usePlaceSaves(cityId: string | undefined, placeId: string | undefined, enabled: boolean, viewer: string | null) {
  const key = cityId && placeId ? `${cityId}:${placeId}:${viewer ?? ''}` : null;
  const [state, setState] = useState<{ key: string; value: PlaceSaves | null } | null>(null);
  useEffect(() => {
    if (!enabled || !key || !cityId || !placeId) return;
    let active = true;
    void loadPlaceSaves(supabase, cityId, placeId).then(value => { if (active) setState({ key, value }); }).catch(() => { if (active) setState({ key, value: null }); });
    return () => { active = false; };
  }, [enabled, key, cityId, placeId]);
  return state?.key === key ? state.value : null;
}

const week = (saverCount: number, weekCount: number, locale: string, tr: (text: string, ...args: string[]) => string) => weekCount > 0
  ? tr('저장 {0} · 이번 주 +{1}', saverCount.toLocaleString(locale), weekCount.toLocaleString(locale)) : tr('저장 {0}', saverCount.toLocaleString(locale));

export function PlaceSavedBy({ place, saves }: { place: CityPlace; saves: PlaceSaves | null }) {
  const { tr, language, locale } = useLanguage(), theme = useTheme(), router = useRouter(), { play } = useInteractionFeedback();
  const en = language === 'en', intro = place.intro;
  const rows = intro ? ([[tr('분위기'), en ? intro.vibeEn ?? intro.vibe : intro.vibe], [place.category === 'places' ? tr('뭘 할까') : tr('뭘 시킬까'), en ? intro.orderEn ?? intro.order : intro.order],
    [tr('언제 갈까'), en ? intro.whenEn ?? intro.when : intro.when]] as const).filter(([, value]) => !!value) : [];
  return <>
    {!!saves && (saves.saverCount > 0 || saves.friends.length > 0) && <View style={[styles.box, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold">{tr('저장한 사람 {0}명', saves.saverCount.toLocaleString(locale))}{saves.weekCount > 0 ? ` · ${tr('이번 주 +{0}', saves.weekCount.toLocaleString(locale))}` : ''}</ThemedText>
      {saves.firstIsMe && <ThemedText type="smallBold" themeColor="accent">{tr('내가 처음 저장했어요')}</ThemedText>}
      {saves.friends.length > 0 ? <View style={styles.chips}>
        {saves.friends.map(friend => <Pressable key={friend.id} analyticsId="places.saves.friend" accessibilityRole="link" accessibilityLabel={tr('{0} 프로필 보기', friend.nickname)}
          onPress={() => { play('selection'); router.push({ pathname: '/user/[id]', params: { id: friend.id, nickname: friend.nickname } }); }}
          style={({ pressed }) => [ControlStyles.pill, styles.chip, controlPresentation(theme, { pressed }).container]}>
          <ThemedText type="small">{friend.first ? tr('{0}님이 처음 저장', friend.nickname) : tr('{0}님이 저장', friend.nickname)}</ThemedText>
        </Pressable>)}
      </View> : <ThemedText type="small" themeColor="textSecondary">{tr('친구가 저장하면 여기에 이름이 보여요. 다른 사람은 숫자로만 보여요.')}</ThemedText>}
    </View>}
    {!!intro && rows.length > 0 && <View style={styles.intro}>
      {rows.map(([label, value]) => <View key={label} style={styles.row}>
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.label}>{label}</ThemedText>
        <ThemedText type="small" style={styles.value}>{value}</ThemedText>
      </View>)}
      <Pressable analyticsId="places.intro.source" accessibilityRole="link" accessibilityLabel={tr('소개 출처 보기')} style={styles.link}
        onPress={() => { play('selection'); void Linking.openURL(intro.sourceUrl).catch(() => play('warning')); }}>
        <ThemedText type="small" themeColor="textSecondary">{tr('소개 출처 보기')} ↗</ThemedText>
      </Pressable>
    </View>}
  </>;
}

export function PlaceRelated({ place, saves }: { place: CityPlace; saves: PlaceSaves | null }) {
  const { tr, locale } = useLanguage(), theme = useTheme(), router = useRouter(), { play } = useInteractionFeedback();
  let catalog: CityPlace[] = [];
  try { catalog = saves?.similar.length ? getCityPlaces(place.cityId) : []; } catch { /* A missing catalog only hides the similar list. */ }
  const similar = (saves?.similar ?? []).flatMap(item => { const found = catalog.find(other => other.id === item.placeKey); return found ? [{ ...item, place: found }] : []; }).slice(0, 3);
  // 들어간 목록: the map's own lists. The compare board also named friends' folders; folder names have never been shown to anyone else, so they wait.
  const lists = [...(place.recommendation?.placeId === place.id ? [['top25', 'TOP 50'] as const] : []), ...(place.glingVisited ? [['visited', 'gling Visited'] as const] : [])];
  return <>
    {similar.length > 0 && <View style={styles.panel}>
      <ThemedText type="subtitle">{tr('같이 저장된 곳')}</ThemedText>
      {similar.map((item, index) => <Pressable key={item.placeKey} analyticsId="places.similar" accessibilityRole="link" accessibilityLabel={tr('{0} 장소 보기', item.place.name)}
        onPress={() => { play('selection'); router.push({ pathname: '/places/[id]', params: { id: item.placeKey, cityId: place.cityId } }); }}
        style={({ pressed }) => [styles.similar, { borderBottomColor: theme.line, opacity: pressed ? 0.7 : 1 }]}>
        <ThemedText type="smallBold" themeColor="accent" style={styles.rank}>{index + 1}</ThemedText>
        <View style={styles.text}>
          <ThemedText type="smallBold" numberOfLines={1}>{item.place.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{week(item.saverCount, item.weekCount, locale, tr)}</ThemedText>
        </View>
        <ThemedText themeColor="textSecondary" accessible={false}>›</ThemedText>
      </Pressable>)}
    </View>}
    {lists.length > 0 && <View style={styles.lists}>
      <ThemedText type="smallBold">{tr('이 장소가 들어간 목록')}</ThemedText>
      <View style={styles.chips}>
        {lists.map(([filter, label]) => <Pressable key={filter} analyticsId="places.list" accessibilityRole="link" accessibilityLabel={tr('{0} 목록을 지도에서 보기', label)}
          onPress={() => { play('selection'); router.navigate({ pathname: '/map', params: { cityId: place.cityId, category: filter } }); }}
          style={({ pressed }) => [ControlStyles.pill, styles.chip, controlPresentation(theme, { pressed }).container]}>
          <ThemedText type="small">{label} ›</ThemedText>
        </Pressable>)}
      </View>
    </View>}
  </>;
}

const styles = StyleSheet.create({
  box: { borderRadius: 14, padding: 16, gap: 10 },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { borderWidth: 1 },
  intro: { gap: 10 },
  row: { flexDirection: 'row', gap: 12 },
  label: { width: 72 },
  value: { flex: 1 },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  panel: { gap: 12 },
  similar: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 12, borderBottomWidth: 1 },
  rank: { width: 20, textAlign: 'center', fontVariant: ['tabular-nums'] },
  text: { flex: 1, gap: 6 },
  lists: { gap: 10 },
});
