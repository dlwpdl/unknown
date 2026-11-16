import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { DragSheet } from '@/components/drag-sheet';
import { RaisedActionButton } from '@/components/raised-action-button';
import { SelectionChip } from '@/components/selection-chip';
import { SymbolView } from '@/components/symbol-view';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles, IconSize } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import type { CityPlace } from '@/lib/city-places';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

// Same values as the kind check in report_place_correction.
const KINDS = [['hours', '영업 시간'], ['address', '주소'], ['contact', '전화·웹사이트'], ['closed', '문을 닫았거나 옮겼어요'], ['other', '기타']] as const;
type Kind = typeof KINDS[number][0];

/** 정보가 달라요 (owner 2026-11-13): a signed-in member picks what is wrong on a map place and the operators read it by SQL. */
export function PlaceCorrection({ place }: { place: CityPlace }) {
  const { tr } = useLanguage(), theme = useTheme(), { play } = useInteractionFeedback();
  const [open, setOpen] = useState(false), [kind, setKind] = useState<Kind | null>(null), [note, setNote] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [sent, setSent] = useState(false);
  const submit = async () => {
    if (!kind || busy) return;
    play('selection'); setBusy(true); setError('');
    let message = '';
    try {
      const { error: failed } = await supabase.rpc('report_place_correction', { p_city_id: place.cityId, p_place_key: place.id, p_kind: kind, p_note: note.trim() || null });
      if (failed) message = failed.message || 'FAILED';
    } catch { message = 'FAILED'; }
    setBusy(false);
    if (message) {
      play('warning');
      setError(message.includes('PLACE_CORRECTION_SENT_TODAY') ? tr('이 장소는 오늘 이미 보내 주셨어요. 내일 다시 보낼 수 있어요.')
        : message.includes('RATE_LIMITED') ? tr('오늘은 더 보낼 수 없어요. 내일 다시 해 주세요.') : tr('보내지 못했어요. 잠시 후 다시 시도해 주세요.'));
      return;
    }
    play('success'); setSent(true); setOpen(false); setKind(null); setNote('');
  };
  return <>
    {sent ? <ThemedText type="small" themeColor="textSecondary" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.row}>{tr('보내 주셔서 고마워요. 운영팀에 잘 전달했어요.')}</ThemedText>
      : <Pressable analyticsId="places.correction.open" accessibilityRole="button" accessibilityLabel={tr('정보가 달라요')} accessibilityHint={tr('알려 주시면 운영팀이 확인하고 고칠게요.')}
        onPress={() => { play('selection'); setError(''); setOpen(true); }} style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}>
        <SymbolView name={{ ios: 'pencil', android: 'edit', web: 'edit' }} size={IconSize.inline} tintColor={theme.textSecondary} accessible={false} />
        <ThemedText type="smallBold" themeColor="textSecondary">{tr('정보가 달라요')}</ThemedText>
      </Pressable>}
    <DragSheet visible={open} onClose={() => setOpen(false)} dismissible={!busy} title={tr('어디를 고칠까요?')}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>
        <ThemedText type="small" themeColor="textSecondary">{tr('알려 주시면 운영팀이 확인하고 고칠게요.')}</ThemedText>
        <View accessibilityRole="radiogroup" style={styles.kinds}>
          {KINDS.map(([id, label]) => <SelectionChip key={id} analyticsId="places.correction.kind" label={tr(label)} selected={kind === id} disabled={busy}
            accessibilityRole="radio" accessibilityLabel={tr(label)} accessibilityState={{ selected: kind === id, disabled: busy }} onPress={() => { play('selection'); setKind(id); }} />)}
        </View>
        <TextInput value={note} onChangeText={setNote} maxLength={300} multiline editable={!busy} onFocus={() => play('selection')}
          accessibilityLabel={tr('어떻게 다른지 적어 주세요 (선택)')} placeholder={tr('어떻게 다른지 적어 주세요 (선택)')} placeholderTextColor={theme.textSecondary}
          style={[ControlStyles.field, styles.note, { color: theme.text, backgroundColor: theme.card, borderColor: theme.line }]} />
        {!!error && <ThemedText type="small" themeColor="danger" accessibilityRole="alert">{error}</ThemedText>}
        <RaisedActionButton analyticsId="places.correction.submit" label={busy ? tr('보내는 중…') : tr('보내기')} disabled={!kind} busy={busy} onPress={() => { void submit(); }} />
      </ScrollView>
    </DragSheet>
  </>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: Spacing.one, minHeight: 44 },
  sheet: { gap: Spacing.three, paddingBottom: Spacing.two },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  note: { minHeight: 88, paddingTop: 12, textAlignVertical: 'top' },
});
