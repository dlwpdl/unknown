import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, SectionList, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useCommunityCity } from '@/lib/community-city';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES } from '@/lib/mock';

export function CityPicker({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const { city, selectCity, saving } = useCommunityCity();
  const { play } = useInteractionFeedback();
  const [query, setQuery] = useState('');
  const { fontScale } = useWindowDimensions();
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
      <ThemedText accessibilityRole="header" style={styles.title}>{t.feed.cityPickerTitle}</ThemedText>
      <Pressable accessibilityRole="button" accessibilityLabel={t.write.cancel} onPress={onClose} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
        <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={21} tintColor={theme.text} />
      </Pressable>
    </View>
    <View style={styles.controls}>
      <View accessibilityRole="tablist" accessibilityLabel={t.feed.cityCountry} style={[styles.countries, { backgroundColor: theme.backgroundElement }]}>
        <View accessible accessibilityRole="tab" accessibilityState={{ selected: true }} style={[styles.country, { backgroundColor: theme.card }]}>
          <ThemedText type="smallBold" themeColor="accent">{t.feed.cityCanada}</ThemedText>
        </View>
        <Pressable disabled accessibilityRole="tab" accessibilityState={{ selected: false, disabled: true }} accessibilityLabel={`${t.feed.cityUnitedStates}, ${t.feed.citySoon}`} style={styles.country}>
          <ThemedText type="smallBold" themeColor="textSecondary">{t.feed.cityUnitedStates}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{t.feed.citySoon}</ThemedText>
        </Pressable>
      </View>
      <View style={[styles.search, { backgroundColor: theme.backgroundElement }]}>
        <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={19} tintColor={theme.textSecondary} />
        <TextInput accessibilityLabel={t.feed.citySearch} placeholder={t.feed.citySearch} placeholderTextColor={theme.textSecondary}
          value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} returnKeyType="search"
          style={[styles.input, { color: theme.text }]} />
        {!!query && <Pressable accessibilityRole="button" accessibilityLabel={t.feed.citySearchClear} onPress={() => setQuery('')} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
          <SymbolView name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }} size={19} tintColor={theme.textSecondary} />
        </Pressable>}
      </View>
    </View>
    <SectionList sections={sections} keyExtractor={item => item.id} stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.list}
      ListEmptyComponent={<ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite" style={styles.empty}>{t.feed.cityNoResults}</ThemedText>}
      ListFooterComponent={<ThemedText type="small" themeColor="textSecondary" style={styles.note}>{t.feed.cityPickerNote}</ThemedText>}
      renderSectionHeader={({ section }) => <ThemedText accessibilityRole="header" type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>{section.title}</ThemedText>}
      renderItem={({ item }) => {
        const selected = item.id === city.id;
        const open = item.state === 'open';
        const disabled = saving || !open;
        return <Pressable disabled={disabled} accessibilityRole="button" accessibilityState={{ selected, disabled, busy: saving }}
          accessibilityLabel={[item.name, item.englishName, item.province, !open && t.feed.citySoon, selected && t.feed.citySelected].filter(Boolean).join(', ')}
          onPress={async () => { if (disabled) return; play('selection'); if (await selectCity(item)) onClose(); }}
          style={({ pressed }) => [styles.row, { borderColor: theme.line }, pressed && styles.pressed]}>
          <View style={styles.name}>
            <ThemedText style={[styles.rowTitle, { color: selected ? theme.accent : open ? theme.text : theme.textSecondary }]}>{item.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{item.englishName} · {item.province}</ThemedText>
          </View>
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
});
