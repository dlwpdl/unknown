import { Pressable, SectionList } from '@/components/analytics-controls';
import { useState } from 'react';
import { KeyboardAvoidingView, LayoutAnimation, Platform, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { useCommunityCity } from '@/lib/community-city';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useCommunityLocation } from '@/lib/location-provider';
import { CITIES } from '@/lib/mock';
import type { City } from '@/lib/types';

export function CityPicker({ onClose, draft }: { onClose: () => void; draft?: { city: City; onSelect: (city: City) => void } }) {
  const theme = useTheme();
  const { city, selectCity, saving } = useCommunityCity();
  const { play } = useInteractionFeedback();
  const [query, setQuery] = useState('');
  const [locationOpen, setLocationOpen] = useState(false);
  const location = useCommunityLocation();
  const { isAuthed } = useAuth();
  const reducedMotion = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const locationBusy = location.busy || !location.ready;
  // 첫 탭은 안내만 펼친다. 동의 버튼을 눌러야 권한 요청과 위치 확인이 시작된다.
  const onLocation = () => {
    if (!location.enabled && !locationOpen) {
      if (!reducedMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setLocationOpen(true);
      return;
    }
    play('selection');
    void location.capture(true);
  };
  const normalize = (value: string) => value.toLowerCase().replace(/[\s.'’-]/g, '');
  const needle = normalize(query);
  const provinceQuery = CITIES.some(item => item.province.toLowerCase() === needle);
  const matches = CITIES.filter(item => provinceQuery ? item.province.toLowerCase() === needle
    : normalize([item.name, item.englishName, item.id, item.province, ...(item.aliases ?? [])].join(' ')).includes(needle));
  const sections = [
    { title: t.feed.cityOpenSection, data: matches.filter(item => item.state === 'open') },
    { title: t.feed.citySoon, data: matches.filter(item => item.state === 'soon').sort((a, b) => a.name.localeCompare(b.name, 'ko')) },
  ].filter(section => section.data.length > 0);

  // Recreate native text layout when Dynamic Type changes while the sheet is open.
  return <KeyboardAvoidingView key={fontScale} style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={styles.head}>
      {draft && <Pressable analyticsId="components_city-picker.pressable.1" accessibilityRole="button" accessibilityLabel={t.write.backToDraft} onPress={onClose} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
        <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={21} tintColor={theme.text} />
      </Pressable>}
      <ThemedText accessibilityRole="header" style={styles.title}>{draft ? t.write.postCity : t.feed.cityPickerTitle}</ThemedText>
      {!draft && <Pressable analyticsId="components_city-picker.pressable.2" accessibilityRole="button" accessibilityLabel={t.write.cancel} onPress={onClose} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
        <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={21} tintColor={theme.text} />
      </Pressable>}
    </View>
    <View style={styles.controls}>
      <View accessibilityRole="tablist" accessibilityLabel={t.feed.cityCountry} style={[styles.countries, { backgroundColor: theme.backgroundElement }]}>
        <View accessible accessibilityRole="tab" accessibilityState={{ selected: true }} style={[styles.country, { backgroundColor: theme.card }]}>
          <ThemedText type="smallBold" themeColor="accent">{t.feed.cityCanada}</ThemedText>
        </View>
        <Pressable analyticsId="components_city-picker.pressable.3" disabled accessibilityRole="tab" accessibilityState={{ selected: false, disabled: true }} accessibilityLabel={`${t.feed.cityUnitedStates}, ${t.feed.citySoon}`} style={styles.country}>
          <ThemedText type="smallBold" themeColor="textSecondary">{t.feed.cityUnitedStates}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{t.feed.citySoon}</ThemedText>
        </Pressable>
      </View>
      <View style={[styles.search, { backgroundColor: theme.backgroundElement }]}>
        <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={19} tintColor={theme.textSecondary} />
        <TextInput accessibilityLabel={t.feed.citySearch} placeholder={t.feed.citySearch} placeholderTextColor={theme.textSecondary}
          value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} returnKeyType="search"
          style={[styles.input, { color: theme.text }]} />
        {!!query && <Pressable analyticsId="components_city-picker.pressable.4" accessibilityRole="button" accessibilityLabel={t.feed.citySearchClear} onPress={() => setQuery('')} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
          <SymbolView name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }} size={19} tintColor={theme.textSecondary} />
        </Pressable>}
      </View>
    </View>
    <SectionList analyticsId="components_city-picker.sectionlist.1" sections={sections} keyExtractor={item => item.id} stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.list}
      ListHeaderComponent={draft || !isAuthed ? null : <View style={[styles.locationRow, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <Pressable analyticsId="components_city-picker.pressable.5" accessibilityRole="button" disabled={locationBusy} accessibilityState={{ disabled: locationBusy, busy: location.busy, expanded: locationOpen }}
          accessibilityLabel="내 위치로 찾기" onPress={onLocation}
          style={({ pressed }) => [styles.locationMain, pressed && { backgroundColor: theme.backgroundSelected }, locationBusy && styles.disabled]}>
          <SymbolView name={{ ios: 'location', android: 'near_me', web: 'near_me' }} size={22} tintColor={theme.accent} />
          <View style={styles.name}>
            <ThemedText style={[styles.rowTitle, { color: theme.accent }]}>{location.busy ? '위치 확인 중…' : location.enabled ? '위치 다시 확인' : locationOpen ? '동의하고 찾기' : '내 위치로 찾기'}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{location.message || (locationOpen && !location.enabled ? '아래 내용에 동의하면 위치를 한 번 확인해요' : 'GPS로 가까운 도시를 한 번만 확인해요')}</ThemedText>
          </View>
          {!location.enabled && <SymbolView name={{ ios: locationOpen ? 'chevron.up' : 'chevron.down', android: locationOpen ? 'expand_less' : 'expand_more', web: locationOpen ? 'expand_less' : 'expand_more' }} size={18} tintColor={theme.textSecondary} />}
        </Pressable>
        {locationOpen && !location.enabled && <View style={[styles.locationDetails, { borderColor: theme.line }]}>
          <ThemedText type="small" themeColor="textSecondary">직접 선택해 저장한 선호 지역이 우선 적용돼요. 동의하지 않아도 아래에서 도시를 고를 수 있어요.</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">동의하면 로그인과 글·모임 작성 때만 위치를 한 번 확인해요. 다른 회원에게는 선택한 도시만 공개돼요.</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">좌표·정확도·측정 시각은 안전 운영을 위해 30일 보관하며 권한 있는 관리자만 조회해요. 설정에서 공유를 끄고 기록을 삭제할 수 있어요.</ThemedText>
        </View>}
      </View>}
      ListEmptyComponent={<ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite" style={styles.empty}>{t.feed.cityNoResults}</ThemedText>}
      ListFooterComponent={<ThemedText type="small" themeColor="textSecondary" style={styles.note}>{draft ? t.write.postCityNote : t.feed.cityPickerNote}</ThemedText>}
      renderSectionHeader={({ section }) => <ThemedText accessibilityRole="header" type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>{section.title}</ThemedText>}
      renderItem={({ item }) => {
        const selected = item.id === (draft?.city ?? city).id;
        const open = item.state === 'open';
        const busy = !draft && saving;
        const disabled = busy || !open;
        return <Pressable analyticsId="components_city-picker.pressable.6" disabled={disabled} accessibilityRole="button" accessibilityState={{ selected, disabled, busy }}
          accessibilityLabel={[item.name, item.englishName, item.province, !open && t.feed.citySoon, selected && t.feed.citySelected].filter(Boolean).join(', ')}
          onPress={async () => {
            if (disabled) return;
            play('selection');
            if (draft) { draft.onSelect(item); onClose(); }
            else if (await selectCity(item)) onClose();
          }}
          style={({ pressed }) => [styles.row, { borderColor: theme.line }, pressed && styles.pressed]}>
          <View style={styles.name}>
            <ThemedText style={[styles.rowTitle, { color: selected ? theme.accent : open ? theme.text : theme.textSecondary }]}>{item.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{item.englishName} · {item.province}</ThemedText>
          </View>
          {!draft && item.id === location.cityId && !selected && <ThemedText type="small" style={[styles.near, { backgroundColor: theme.backgroundElement, color: theme.accent }]}>가까움</ThemedText>}
          {!open && <ThemedText type="small" themeColor="textSecondary">{t.feed.citySoon}</ThemedText>}
          {selected && <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={21} tintColor={theme.accent} />}
        </Pressable>;
      }} />
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  container: { flex: 1 }, head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.four, paddingTop: Spacing.three, gap: Spacing.two },
  title: { flex: 1, fontSize: 24, lineHeight: 32, fontWeight: '700', letterSpacing: -0.5 },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, pressed: { opacity: 0.65 },
  controls: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three, gap: Spacing.three },
  countries: { flexDirection: 'row', padding: 4, borderRadius: 12, gap: 4 },
  country: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, alignItems: 'center', justifyContent: 'center', minHeight: 44, padding: Spacing.two, borderRadius: 9 },
  search: { flexDirection: 'row', alignItems: 'center', paddingLeft: Spacing.three, borderRadius: 10, gap: Spacing.two, minHeight: 44 },
  input: { flex: 1, minWidth: 0, minHeight: 44, fontSize: 16, paddingVertical: Spacing.two, paddingRight: Spacing.two },
  list: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.four }, sectionTitle: { paddingTop: Spacing.four, paddingBottom: Spacing.two },
  row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
  name: { flex: 1, gap: Spacing.one }, rowTitle: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  note: { marginTop: Spacing.four }, empty: { paddingTop: Spacing.four },
  locationRow: { marginTop: Spacing.three, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden' },
  locationMain: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: 12 },
  locationDetails: { borderTopWidth: StyleSheet.hairlineWidth, padding: Spacing.three, gap: Spacing.two },
  near: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: 999, fontWeight: '700' }, disabled: { opacity: 0.5 },
});
