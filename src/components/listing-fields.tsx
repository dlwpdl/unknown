import { useMemo, useState } from 'react';
import { Modal, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { useReducedMotion } from 'react-native-reanimated';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { DiscoveryMap } from '@/components/discovery-map';
import { RaisedActionButton } from '@/components/raised-action-button';
import { SelectionChip } from '@/components/selection-chip';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles, IconSize, Typography, controlPresentation } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import {
  APPLY_WAYS, CONDITIONS, formatMoveIn, HOUSING_DEALS, HOUSING_INCLUDES, JOB_DEALS, JOB_TYPES, LISTING_LABELS, PAY_UNITS, ROOMS, USED_DEALS,
  type ListingCategory, type ListingDraft, type ListingMissing,
} from '@/lib/listing-details';
import { CITIES } from '@/lib/mock';
import { findNeighborhood, nearestNeighborhood, neighborhoodName, neighborhoodsFor } from '@/lib/neighborhoods';

const DEALS = { housing: HOUSING_DEALS, jobs: JOB_DEALS, used: USED_DEALS } as const;
const DEAL_HINTS: Partial<Record<string, string>> = { hiring: '사람 구해요', seeking: '일 찾아요' };
const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// The 1st and 15th of the next few months: one tap instead of a date wheel.
function moveInChoices(now: Date) {
  const days: string[] = [];
  for (let month = 0; days.length < 6 && month < 4; month++) for (const day of [1, 15]) {
    const date = new Date(now.getFullYear(), now.getMonth() + month, day);
    if (date > now && days.length < 6) days.push(isoDay(date));
  }
  return ['now', ...days];
}

function Chip({ label, selected, onPress, disabled, multi }: { label: string; selected: boolean; onPress: () => void; disabled?: boolean; multi?: boolean }) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  return <SelectionChip analyticsId="listing.fields.chip" selected={selected} disabled={disabled} baseColor={theme.backgroundElement}
    accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityLabel={label} accessibilityState={{ selected, checked: selected, disabled }}
    onPress={() => { play('selection'); onPress(); }} style={[ControlStyles.pill, styles.chip, { borderColor: selected ? theme.accent : theme.line }]}>
    <ThemedText type="label" style={{ color: selected ? theme.accentInk : theme.text }}>{label}</ThemedText>
  </SelectionChip>;
}

function Section({ label, hint, missing, children }: { label: string; hint?: string; missing?: boolean; children: React.ReactNode }) {
  const theme = useTheme(), { tr } = useLanguage();
  return <View style={styles.section}>
    <View style={styles.sectionHead}>
      <ThemedText type="label">{label}</ThemedText>
      {hint && <ThemedText type="caption" themeColor="textSecondary">{hint}</ThemedText>}
      {missing && <ThemedText type="caption" style={{ color: theme.accent }}>{tr('꼭 골라 주세요')}</ThemedText>}
    </View>
    {children}
  </View>;
}

function Field({ label, value, onChange, placeholder, disabled, prefix, suffix, numeric, multiline, maxLength = 40 }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; disabled?: boolean; prefix?: string; suffix?: string; numeric?: boolean; multiline?: boolean; maxLength?: number;
}) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  return <View style={[ControlStyles.field, styles.field, multiline && styles.multiline, { borderColor: theme.line, backgroundColor: theme.card }]}>
    {prefix && <ThemedText style={Typography.menu} themeColor="textSecondary">{prefix}</ThemedText>}
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} onFocus={() => play('selection')} editable={!disabled} placeholder={placeholder}
      placeholderTextColor={theme.textSecondary} keyboardType={numeric ? 'decimal-pad' : 'default'} multiline={multiline} maxLength={maxLength}
      style={[styles.input, Typography.menu, multiline && styles.multilineInput, { color: theme.text }]} />
    {suffix && <ThemedText type="supporting" themeColor="textSecondary">{suffix}</ThemedText>}
  </View>;
}

// Category fields for the composer. The parent owns the draft and builds the body lead from it.
export function ListingFields({ category, cityId, value, onChange, missing = [], disabled, lead, fixedDeal }: {
  category: ListingCategory; cityId: string; value: ListingDraft; onChange: (next: ListingDraft) => void; missing?: ListingMissing[];
  disabled?: boolean; lead?: string; fixedDeal?: boolean;
}) {
  const theme = useTheme(), { tr, language } = useLanguage(), { play } = useInteractionFeedback();
  const [picking, setPicking] = useState(false);
  const [moveIns] = useState(() => moveInChoices(new Date()));
  const set = (patch: Partial<ListingDraft>) => onChange({ ...value, ...patch });
  const toggle = <T extends string>(list: T[], item: T) => list.includes(item) ? list.filter(entry => entry !== item) : [...list, item];
  const area = findNeighborhood(cityId, value.area);
  const wanted = value.deal === 'rent_wanted' || value.deal === 'buy';
  const housingPrice = { rent_offer: '월세', rent_wanted: '예산', sale: '매매가', buy: '예산' }[value.deal as 'rent_offer'] ?? '가격';
  const show = (key: ListingMissing) => missing.includes(key);

  const areaButton = (label: string, note: string) => <Section label={tr(label)} missing={show('area')}>
    <Pressable analyticsId="listing.fields.area" accessibilityRole="button" accessibilityLabel={`${tr(label)}, ${area ? neighborhoodName(area, language) : tr('동네 고르기')}`} disabled={disabled}
      onPress={() => { play('selection'); setPicking(true); }} style={({ pressed }) => [ControlStyles.field, styles.field, { borderColor: theme.line, backgroundColor: theme.card, opacity: pressed ? 0.82 : disabled ? 0.45 : 1 }]}>
      <SymbolView name={{ ios: 'mappin', android: 'location_on', web: 'location_on' }} size={IconSize.inline} tintColor={theme.textSecondary} />
      <ThemedText style={[Typography.menu, styles.flex]} themeColor={area ? undefined : 'textSecondary'}>{area ? neighborhoodName(area, language) : tr('동네 고르기')}</ThemedText>
      <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={IconSize.chevron} tintColor={theme.textSecondary} />
    </Pressable>
    <ThemedText type="caption" themeColor="textSecondary">{tr(note)}</ThemedText>
  </Section>;

  return <View style={styles.root}>
    {!fixedDeal && <View accessibilityRole="radiogroup" style={styles.chips}>
      {DEALS[category].map(deal => <Chip key={deal} selected={value.deal === deal} disabled={disabled} onPress={() => set({ deal })}
        label={DEAL_HINTS[deal] ? `${tr((LISTING_LABELS[category] as Record<string, string>)[deal])} (${tr(DEAL_HINTS[deal]!)})` : tr((LISTING_LABELS[category] as Record<string, string>)[deal])} />)}
    </View>}

    {category === 'housing' && <>
      <Section label={tr('방 구성')} hint={tr('하나만')} missing={show('rooms')}>
        <View accessibilityRole="radiogroup" style={styles.chips}>{ROOMS.map(room => <Chip key={room} label={tr(LISTING_LABELS.rooms[room])} selected={value.rooms === room} disabled={disabled} onPress={() => set({ rooms: room })} />)}</View>
      </Section>
      <Section label={tr(housingPrice)} missing={show('price')}>
        <Field label={tr(housingPrice)} value={value.price} onChange={price => set({ price })} prefix="$" suffix={value.deal === 'rent_offer' || value.deal === 'rent_wanted' ? tr('/월') : undefined} numeric disabled={disabled} maxLength={12} placeholder={wanted ? tr('비워 둬도 돼요') : undefined} />
      </Section>
      <Section label={tr(wanted ? '입주 희망일' : '입주 가능일')}>
        <View accessibilityRole="radiogroup" style={styles.chips}>{moveIns.map(day => <Chip key={day} label={day === 'now' ? tr('바로') : formatMoveIn(day, language)} selected={value.moveIn === day} disabled={disabled}
          onPress={() => set({ moveIn: value.moveIn === day ? null : day })} />)}</View>
      </Section>
      {areaButton('동네', '동네까지만 보여요. 정확한 주소는 대화에서 알려 주세요.')}
      <Section label={tr('포함된 것')} hint={tr('여러 개 고를 수 있어요')}>
        <View style={styles.chips}>{HOUSING_INCLUDES.map(item => <Chip key={item} multi label={tr(LISTING_LABELS.includes[item])} selected={value.includes.includes(item)} disabled={disabled} onPress={() => set({ includes: toggle(value.includes, item) })} />)}</View>
      </Section>
    </>}

    {category === 'jobs' && <>
      <Section label={tr(value.deal === 'seeking' ? '희망 급여' : '급여')} missing={show('price')}>
        <View accessibilityRole="radiogroup" style={styles.chips}>{PAY_UNITS.map(unit => <Chip key={unit} label={tr(LISTING_LABELS.payUnit[unit])} selected={value.payUnit === unit} disabled={disabled} onPress={() => set({ payUnit: unit })} />)}</View>
        {value.payUnit !== 'negotiable' && <Field label={tr(LISTING_LABELS.payUnit[value.payUnit])} value={value.price} onChange={price => set({ price })} prefix="$" numeric disabled={disabled} maxLength={12}
          suffix={tr(({ hour: '/시간', month: '/월', year: '/년' } as const)[value.payUnit])} />}
      </Section>
      <Section label={tr('근무 형태')} hint={tr('여러 개 고를 수 있어요')}>
        <View style={styles.chips}>{JOB_TYPES.map(item => <Chip key={item} multi label={tr(LISTING_LABELS.jobTypes[item])} selected={value.jobTypes.includes(item)} disabled={disabled} onPress={() => set({ jobTypes: toggle(value.jobTypes, item) })} />)}</View>
      </Section>
      {areaButton(value.deal === 'seeking' ? '일하고 싶은 동네' : '근무지', '동네까지만 보여요.')}
      <Section label={tr(value.deal === 'seeking' ? '가능한 시간' : '근무 시간')}>
        <Field label={tr('근무 시간')} value={value.hours} onChange={hours => set({ hours })} placeholder={tr('예: 토·일 11–19시')} disabled={disabled} />
      </Section>
      <Section label={tr(value.deal === 'seeking' ? '해 본 일' : '하는 일')} hint={tr('세 줄 정도')}>
        <Field label={tr('하는 일')} value={value.duties} onChange={duties => set({ duties })} placeholder={tr(value.deal === 'seeking' ? '예: 바리스타 1년, 캐셔' : '예: 주문 받기, 서빙, 테이블 정리')} disabled={disabled} multiline maxLength={200} />
      </Section>
      {value.deal === 'hiring' && <Section label={tr('지원 방법')}>
        <View style={styles.chips}>{APPLY_WAYS.map(item => <Chip key={item} multi label={tr(LISTING_LABELS.apply[item])} selected={value.apply.includes(item)} disabled={disabled} onPress={() => set({ apply: toggle(value.apply, item) })} />)}</View>
      </Section>}
    </>}

    {category === 'used' && <>
      <Section label={tr(value.deal === 'buy' ? '희망 가격' : '가격')} missing={show('price')}>
        {!value.free && <Field label={tr('가격')} value={value.price} onChange={price => set({ price })} prefix="$" numeric disabled={disabled} maxLength={12} placeholder={value.deal === 'buy' ? tr('비워 둬도 돼요') : undefined} />}
        {value.deal === 'sell' && <View style={styles.chips}>
          <Chip multi label={tr('무료 나눔')} selected={value.free} disabled={disabled} onPress={() => set({ free: !value.free, offers: false })} />
          {!value.free && <Chip multi label={tr('가격 제안 받아요')} selected={value.offers} disabled={disabled} onPress={() => set({ offers: !value.offers })} />}
        </View>}
      </Section>
      {value.deal === 'sell' && <Section label={tr('물건 상태')} missing={show('condition')}>
        <View accessibilityRole="radiogroup" style={styles.chips}>{CONDITIONS.map(item => <Chip key={item} label={tr(LISTING_LABELS.condition[item])} selected={value.condition === item} disabled={disabled} onPress={() => set({ condition: item })} />)}</View>
      </Section>}
      {areaButton('만날 곳', '동네까지만 보여요. 집 주소는 적지 않아요.')}
    </>}

    {!!lead && <View style={[styles.preview, { backgroundColor: theme.backgroundElement }]} accessible accessibilityLabel={`${tr('본문 첫 줄 미리보기')}, ${lead}`}>
      <ThemedText type="caption" themeColor="textSecondary">{tr('본문 첫 줄 미리보기 (구버전 앱에도 이렇게 보여요)')}</ThemedText>
      <ThemedText type="supporting">{lead}</ThemedText>
    </View>}
    {picking && <NeighborhoodPicker visible cityId={cityId} initial={value.area} onClose={() => setPicking(false)} onConfirm={id => { set({ area: id }); setPicking(false); }} />}
  </View>;
}

// 동네 고르기: the same map as the discovery map. Moving the map picks the neighborhood nearest the centre;
// the tapped or centred point itself is never kept.
export function NeighborhoodPicker({ visible, cityId, initial, onClose, onConfirm }: { visible: boolean; cityId: string; initial: string | null; onClose: () => void; onConfirm: (id: string) => void }) {
  const theme = useTheme(), { tr, language } = useLanguage(), { play } = useInteractionFeedback(), reduced = useReducedMotion();
  const items = neighborhoodsFor(cityId), city = CITIES.find(item => item.id === cityId);
  const [selected, setSelected] = useState<string | null>(initial);
  const [center, setCenter] = useState<{ latitude: number; longitude: number; requestId: number } | null>(null);
  const markers = useMemo(() => items.map(item => ({ id: item.id, latitude: item.latitude, longitude: item.longitude, color: item.id === selected ? '#6E4AA2' : '#9283AC', label: neighborhoodName(item, language) })), [items, selected, language]);
  const choose = (id: string, move = true) => {
    const item = items.find(entry => entry.id === id);
    if (!item) return;
    setSelected(id);
    if (move) setCenter(current => ({ latitude: item.latitude, longitude: item.longitude, requestId: (current?.requestId ?? 0) + 1 }));
  };
  const current = findNeighborhood(cityId, selected);
  return <Modal visible={visible} animationType={reduced ? 'none' : 'slide'} presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaProvider style={styles.flex}>
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Pressable analyticsId="listing.area.close" accessibilityRole="button" accessibilityLabel={tr('닫기')} onPress={() => { play('selection'); onClose(); }}
          style={({ pressed }) => [ControlStyles.icon, controlPresentation(theme, { tone: 'ghost', pressed }).container]}>
          <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={IconSize.toolbar} tintColor={theme.text} />
        </Pressable>
        <ThemedText accessibilityRole="header" style={[Typography.menu, styles.flex, styles.center]}>{tr('동네 고르기')}</ThemedText>
        <View style={ControlStyles.icon} />
      </View>
      <View style={styles.flex}>
        {visible && <DiscoveryMap markers={markers} cityName={city?.englishName ?? ''} selectedId={selected} center={center} bottomInset={0}
          onSelect={id => choose(id, false)}
          onMoved={bounds => { const next = nearestNeighborhood(cityId, { latitude: (bounds.south + bounds.north) / 2, longitude: (bounds.west + bounds.east) / 2 }, 4); if (next) setSelected(next.id); }} />}
      </View>
      <View style={[styles.sheet, { backgroundColor: theme.background, borderTopColor: theme.line }]}>
        <ScrollView analyticsId="listing.area.list" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {items.map(item => <Chip key={item.id} label={neighborhoodName(item, language)} selected={selected === item.id} onPress={() => choose(item.id)} />)}
        </ScrollView>
        <ThemedText type="caption" themeColor="textSecondary">{tr('지도를 움직이면 가운데 동네가 골라져요. 누른 지점은 저장하지 않고, 동네 이름과 동네 중심만 저장해요.')}</ThemedText>
        <RaisedActionButton analyticsId="listing.area.confirm" disabled={!current} label={current ? tr('{0}(으)로 정하기', neighborhoodName(current, language)) : tr('동네를 골라 주세요')}
          onPress={() => { if (current) { play('selection'); onConfirm(current.id); } }} />
      </View>
    </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}

const styles = StyleSheet.create({
  root: { gap: Spacing.three, marginTop: Spacing.two },
  section: { gap: Spacing.two },
  sectionHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chipsRow: { flexDirection: 'row', gap: Spacing.two, paddingVertical: Spacing.one },
  chip: { borderWidth: 1 },
  field: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  multiline: { alignItems: 'flex-start', paddingVertical: Spacing.two },
  input: { flex: 1, minHeight: 44, paddingVertical: 0 },
  multilineInput: { minHeight: 72, textAlignVertical: 'top' },
  preview: { borderRadius: 12, padding: 12, gap: 4 },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.two, minHeight: 56 },
  sheet: { padding: Spacing.three, gap: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
});
