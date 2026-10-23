import { useLanguage } from '@/hooks/use-language';
import { Pressable, SectionList } from '@/components/analytics-controls';
import { useState } from 'react';
import { KeyboardAvoidingView, LayoutAnimation, Platform, StyleSheet, TextInput, UIManager, useWindowDimensions, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SymbolView } from 'expo-symbols';

import { GlassSurface } from '@/components/glass-surface';
import { ThemedText } from '@/components/themed-text';
import { Depth, Spacing } from '@/constants/theme';
import { ControlMetrics, ControlStyles, IconSize, Typography, controlPresentation } from '@/constants/design-system';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useCommunityCity } from '@/lib/community-city';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useCommunityLocation } from '@/lib/location-provider';
import { CITIES } from '@/lib/mock';
import type { City } from '@/lib/types';

export function CityPicker({ onClose, draft, title }: { onClose: () => void; draft?: { city: City; onSelect: (city: City) => void }; title?: string }) {
  const { language, tr, t } = useLanguage();
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
    play('selection');
    if (!location.enabled && !locationOpen) {
      if (!reducedMotion) {
        if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      }
      setLocationOpen(true);
      return;
    }
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
      {draft && <View style={styles.iconGlass}><Pressable analyticsId="components_city-picker.pressable.1" accessibilityRole="button" accessibilityLabel={t.write.backToDraft} onPress={() => { play('selection'); onClose(); }} style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
        <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={IconSize.toolbar} tintColor={theme.text} />
      </Pressable></View>}
      <ThemedText accessibilityRole="header" style={styles.title}>{title ?? (draft ? t.write.postCity : t.feed.cityPickerTitle)}</ThemedText>
      {!draft && <View style={styles.iconGlass}><Pressable analyticsId="components_city-picker.pressable.2" accessibilityRole="button" accessibilityLabel={t.write.cancel} onPress={() => { play('selection'); onClose(); }} style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
        <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={IconSize.toolbar} tintColor={theme.text} />
      </Pressable></View>}
    </View>
    <View style={styles.controls}>
      <View style={[styles.countriesGlass, { backgroundColor: theme.backgroundElement }]}><View accessibilityRole="tablist" accessibilityLabel={t.feed.cityCountry} style={styles.countries}>
        <View accessible accessibilityRole="tab" accessibilityState={{ selected: true }} style={[styles.country, fontScale > 1.2 && styles.currentCountry, Depth.control, controlPresentation(theme, { tone: 'ghost', selected: true }).container]}>
          <ThemedText type="label" style={controlPresentation(theme, { tone: 'ghost', selected: true }).text}>{t.feed.cityCanada}</ThemedText>
        </View>
        <Pressable analyticsId="components_city-picker.pressable.3" disabled accessibilityRole="tab" accessibilityState={{ selected: false, disabled: true }} accessibilityLabel={`${t.feed.cityUnitedStates}, ${t.feed.citySoon}`} style={styles.country}>
          <ThemedText type="smallBold" themeColor="textSecondary">{t.feed.cityUnitedStates}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{t.feed.citySoon}</ThemedText>
        </Pressable>
      </View></View>
      <View style={[styles.searchGlass, { backgroundColor: theme.card, borderColor: theme.line }]}><View style={styles.search}>
        <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={IconSize.toolbar} tintColor={theme.textSecondary} />
        <TextInput accessibilityLabel={t.feed.citySearch} placeholder={t.feed.citySearch} placeholderTextColor={theme.textSecondary}
          value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} returnKeyType="search"
          style={[styles.input, { color: theme.text }]} />
        {!!query && <Pressable analyticsId="components_city-picker.pressable.4" accessibilityRole="button" accessibilityLabel={t.feed.citySearchClear} onPress={() => { play('selection'); setQuery(''); }} style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent' }]}>
          <SymbolView name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }} size={IconSize.toolbar} tintColor={theme.textSecondary} />
        </Pressable>}
      </View></View>
    </View>
    <SectionList analyticsId="components_city-picker.sectionlist.1" sections={sections} keyExtractor={item => item.id} stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.list}
      ListHeaderComponent={draft || !isAuthed ? null : <GlassSurface tone="control" interactive style={[styles.locationRow, controlPresentation(theme, { tone: 'ghost' }).container]}>
        <Pressable analyticsId="components_city-picker.pressable.5" accessibilityRole="button" disabled={locationBusy} accessibilityState={{ disabled: locationBusy, busy: location.busy, expanded: locationOpen }}
          accessibilityLabel={tr("내 위치로 찾기")} onPress={onLocation}
          style={({ pressed }) => [styles.locationMain, controlPresentation(theme, { tone: 'ghost', pressed, disabled: locationBusy, busy: location.busy }).container]}>
          <SymbolView name={{ ios: 'location', android: 'near_me', web: 'near_me' }} size={IconSize.toolbar} tintColor={theme.textSecondary} />
          <View style={styles.name}>
            <ThemedText type="label">{location.busy ? tr("위치 확인 중…") : location.enabled ? tr("위치 다시 확인") : locationOpen ? tr("동의하고 찾기") : tr("내 위치로 찾기")}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{location.message || (locationOpen && !location.enabled ? tr("아래 내용에 동의하면 위치를 한 번 확인해요") : tr("GPS로 가까운 도시를 한 번만 확인해요"))}</ThemedText>
          </View>
          {!location.enabled && <SymbolView name={{ ios: locationOpen ? 'chevron.up' : 'chevron.down', android: locationOpen ? 'expand_less' : 'expand_more', web: locationOpen ? 'expand_less' : 'expand_more' }} size={IconSize.inline} tintColor={theme.textSecondary} />}
        </Pressable>
        {locationOpen && !location.enabled && <View style={[styles.locationDetails, { borderColor: theme.line }]}>
          <ThemedText type="small" themeColor="textSecondary">{tr("직접 선택해 저장한 선호 지역이 우선 적용돼요. 동의하지 않아도 아래에서 도시를 고를 수 있어요.")}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{tr("동의하면 로그인과 글·모임 작성 때만 위치를 한 번 확인해요. 다른 회원에게는 선택한 도시만 공개돼요.")}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{tr("좌표·정확도·측정 시각은 안전 운영을 위해 30일 보관하며 권한 있는 관리자만 조회해요. 설정에서 공유를 끄고 기록을 삭제할 수 있어요.")}</ThemedText>
        </View>}
      </GlassSurface>}
      ListEmptyComponent={<ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite" style={styles.empty}>{t.feed.cityNoResults}</ThemedText>}
      ListFooterComponent={<ThemedText type="small" themeColor="textSecondary" style={styles.note}>{draft ? t.write.postCityNote : t.feed.cityPickerNote}</ThemedText>}
      renderSectionHeader={({ section }) => <ThemedText accessibilityRole="header" type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>{section.title}</ThemedText>}
      renderItem={({ item, index, section }) => {
        const selected = item.id === (draft?.city ?? city).id;
        const open = item.state === 'open';
        const busy = !draft && saving;
        const disabled = busy || !open;
        return <View style={[styles.rowGlass, { backgroundColor: theme.card }, index === 0 && styles.firstRow, index === section.data.length - 1 && styles.lastRow]}><Pressable analyticsId="components_city-picker.pressable.6" disabled={disabled} accessibilityRole="button" accessibilityState={{ selected, disabled, busy }}
          accessibilityLabel={[tr(item.name), language === 'ko' && item.englishName, item.province, !open && t.feed.citySoon, selected && t.feed.citySelected].filter(Boolean).join(', ')}
          onPress={async () => {
            if (disabled) return;
            play('selection');
            if (draft) { draft.onSelect(item); onClose(); }
            else if (await selectCity(item)) onClose();
          }}
          style={({ pressed }) => [styles.row, controlPresentation(theme, { tone: 'ghost', selected, pressed, disabled, busy, reducedMotion }).container]}>
          <View style={styles.name}>
            <ThemedText style={[styles.rowTitle, { color: selected ? theme.accent : open ? theme.text : theme.textSecondary }]}>{tr(item.name)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{language === 'ko' ? `${item.englishName} · ${item.province}` : item.province}</ThemedText>
          </View>
          {!draft && item.id === location.cityId && !selected && <ThemedText type="small" style={[styles.near, { backgroundColor: theme.backgroundElement, color: theme.accent }]}>{tr("가까움")}</ThemedText>}
          {!open && <ThemedText type="small" themeColor="textSecondary">{t.feed.citySoon}</ThemedText>}
          {selected && <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={IconSize.toolbar} tintColor={theme.accent} />}
        </Pressable></View>;
      }} />
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  container: { flex: 1 }, head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.four, paddingTop: Spacing.three, gap: Spacing.two },
  title: { ...Typography.sheetTitle, flex: 1 },
  iconButton: ControlStyles.icon, iconGlass: { borderRadius: ControlMetrics.radius.icon },
  controls: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, gap: Spacing.two },
  countriesGlass: { borderRadius: ControlMetrics.radius.field }, countries: { flexDirection: 'row', padding: Spacing.one, borderRadius: ControlMetrics.radius.field, gap: Spacing.one },
  country: { ...ControlStyles.pill, borderRadius: ControlMetrics.radius.action, flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'center', gap: Spacing.one, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two },
  currentCountry: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', alignSelf: 'center' },
  searchGlass: { borderRadius: ControlMetrics.radius.field, borderWidth: StyleSheet.hairlineWidth }, search: { flexDirection: 'row', alignItems: 'center', paddingLeft: Spacing.three, borderRadius: ControlMetrics.radius.field, gap: Spacing.two, minHeight: ControlMetrics.field },
  input: { flex: 1, minWidth: 0, minHeight: ControlMetrics.touch, fontSize: Typography.menu.fontSize, paddingVertical: Spacing.two, paddingRight: Spacing.two },
  list: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.four }, sectionTitle: { paddingHorizontal: Spacing.three, paddingTop: Spacing.four, paddingBottom: Spacing.two },
  rowGlass: { overflow: 'hidden' }, firstRow: { borderTopLeftRadius: ControlMetrics.radius.field, borderTopRightRadius: ControlMetrics.radius.field }, lastRow: { borderBottomLeftRadius: ControlMetrics.radius.field, borderBottomRightRadius: ControlMetrics.radius.field },
  row: { minHeight: 72, borderRadius: ControlMetrics.radius.field, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  name: { flex: 1, gap: Spacing.one }, rowTitle: Typography.menu,
  note: { marginTop: Spacing.four }, empty: { paddingTop: Spacing.four },
  locationRow: { marginTop: Spacing.two, borderRadius: ControlMetrics.radius.field },
  locationMain: { minHeight: ControlMetrics.field, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  locationDetails: { borderTopWidth: StyleSheet.hairlineWidth, padding: Spacing.three, gap: Spacing.two },
  near: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: 999, fontWeight: '700' },
});
