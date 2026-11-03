import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { Pressable } from '@/components/analytics-controls';
import { ChillingDateInput } from '@/components/chilling-date-input';
import { DragSheet } from '@/components/drag-sheet';
import { RaisedActionButton } from '@/components/raised-action-button';
import { SelectionChip } from '@/components/selection-chip';
import { GlingLoader } from '@/components/gling-loader';
import { ThemedText } from '@/components/themed-text';
import { IconSize, Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { confirmMeetupOccurrence, proposeMeetupDates, type MeetupOccurrence } from '@/lib/meetup-host-tools';
import { createMeetupSession } from '@/lib/meetup-reviews';
import { supabase } from '@/lib/supabase';

const LENGTHS = [1, 2, 3, 4] as const;
const HOUR = 3600000;
type Repeat = 'none' | 'weekly' | 'fortnightly';

const errors: Record<string, string> = {
  INVALID_SESSION_TIME: '끝나는 시간은 시작 뒤로 잡아 주세요.',
  SESSION_OVERLAP: '같은 시간에 이미 등록된 회차가 있어요. 다른 시간을 골라 주세요.',
};

/** One session, or up to four repeating dates at once. Nothing is created until the button is pressed. */
export function MeetupAddSession({ postId, visible, canRepeat, canSingle = true, onClose, onAdded }: { postId: string; visible: boolean; canRepeat: boolean; canSingle?: boolean; onClose: () => void; onAdded: (count: number) => void }) {
  const { tr, locale } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback(), focused = useIsFocused();
  // Tomorrow, two hours long: the same default as before.
  const [startsAt, setStartsAt] = useState(() => new Date(Date.now() + 86400000).toISOString());
  const [length, setLength] = useState<number>(2), [repeat, setRepeat] = useState<Repeat>(canSingle ? 'none' : 'weekly');
  const [dates, setDates] = useState<MeetupOccurrence[]>([]), [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [loadingDates, setLoadingDates] = useState(false), [error, setError] = useState('');
  const pending = useRef(false), generation = useRef(0), live = useRef(false);
  useLayoutEffect(() => { live.current = true; generation.current++; return () => { live.current = false; }; }, [postId, focused]);
  const endsAt = new Date(Date.parse(startsAt) + length * HOUR).toISOString();
  const end = new Date(endsAt).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const repeating = repeat !== 'none';

  // A new repeating preview starts loading in the same render that asks for it.
  const previewKey = visible && repeating ? [postId, startsAt, endsAt, repeat].join('|') : '';
  const [shownKey, setShownKey] = useState('');
  if (previewKey !== shownKey) { setShownKey(previewKey); if (previewKey) { setLoadingDates(true); setError(''); } }
  useEffect(() => {
    if (!visible || !repeating) return;
    let active = true;
    proposeMeetupDates(supabase, postId, startsAt, endsAt, repeat as 'weekly' | 'fortnightly').then(result => {
      if (active) { setDates(result); setPicked(result.map(date => date.startsAt)); }
    }, failure => { if (active) { setDates([]); setPicked([]); setError((failure as Error)?.message || 'unknown'); play('warning'); } })
      .finally(() => { if (active) setLoadingDates(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a preview only depends on the chosen time and repeat
  }, [visible, postId, startsAt, endsAt, repeat]);

  async function add() {
    const request = generation.current, current = () => live.current && request === generation.current;
    if (pending.current || !current()) return;
    pending.current = true; setBusy(true); setError(''); play('selection');
    const created: string[] = [];
    try {
      if (!repeating) { await createMeetupSession(supabase, postId, startsAt, endsAt); created.push(startsAt); }
      // One at a time so a failure says exactly how many were added.
      else for (const date of dates.filter(item => picked.includes(item.startsAt))) { await confirmMeetupOccurrence(supabase, postId, date); created.push(date.startsAt); }
      if (current()) { play('success'); onAdded(created.length); onClose(); }
    } catch (failure) {
      if (current()) {
        const code = (failure as Error)?.message;
        setError(created.length ? tr('{0}개만 등록했어요. 나머지는 다시 확인해 주세요.', created.length) : code || 'unknown');
        setPicked(value => value.filter(item => !created.includes(item)));
        if (created.length) onAdded(created.length);
        play('warning');
      }
    } finally { pending.current = false; if (live.current) setBusy(false); }
  }

  return <DragSheet visible={visible} onClose={onClose} dismissible={!busy} title={tr('회차 추가')}>
    <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll} contentContainerStyle={styles.content}>
      <ChillingDateInput label={tr('언제 시작하나요')} value={startsAt} disabled={busy} minimumDate={new Date()} onChange={value => { play('selection'); setStartsAt(value); }} />
      <ThemedText style={Typography.label}>{tr('얼마나 하나요')}</ThemedText>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={tr('얼마나 하나요')}>
        {LENGTHS.map(hours => <SelectionChip key={hours} analyticsId="meetup.session.length" selected={length === hours} disabled={busy} accessibilityRole="radio" accessibilityState={{ checked: length === hours, disabled: busy }}
          label={tr('{0}시간', hours)} onPress={() => { play('selection'); setLength(hours); }} />)}
      </View>
      <ThemedText themeColor="textSecondary" style={Typography.supporting}>{tr('{0}에 끝나요', end)} · {Intl.DateTimeFormat().resolvedOptions().timeZone}</ThemedText>
      <ThemedText style={Typography.label}>{tr('반복')}</ThemedText>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={tr('반복')}>
        {([['none', tr('한 번만')], ['weekly', tr('매주')], ['fortnightly', tr('격주')]] as const).map(([value, label]) => {
          const locked = value === 'none' ? !canSingle : !canRepeat;
          return <SelectionChip key={value} analyticsId="meetup.session.repeat" selected={repeat === value} disabled={busy || locked} accessibilityRole="radio" accessibilityState={{ checked: repeat === value, disabled: busy || locked }}
            label={label} onPress={() => { play('selection'); setRepeat(value); setDates([]); setPicked([]); }} />;
        })}
      </View>
      {!canRepeat && <ThemedText themeColor="textSecondary" style={Typography.supporting}>{tr('매주, 격주로 한 번에 등록하는 건 프로 멤버십부터 쓸 수 있어요.')}</ThemedText>}
      {repeating && <>
        <ThemedText style={Typography.label}>{tr('등록할 날짜')}</ThemedText>
        {loadingDates && <GlingLoader color={theme.accent} accessibilityLabel={tr('날짜를 맞춰 보는 중…')} />}
        {dates.map(date => {
          const checked = picked.includes(date.startsAt);
          return <Pressable key={date.startsAt} analyticsId="meetup.session.date" accessibilityRole="checkbox" accessibilityState={{ checked, disabled: busy }} disabled={busy} style={styles.check}
            onPress={() => { play('selection'); setPicked(value => checked ? value.filter(item => item !== date.startsAt) : [...value, date.startsAt]); }}>
            <View style={[styles.box, { borderColor: checked ? theme.accent : theme.line, backgroundColor: checked ? theme.accent : 'transparent' }]}>
              {checked && <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={IconSize.chevron} tintColor={theme.accentInk} />}
            </View>
            <ThemedText style={Typography.body}>{new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(date.startsAt))}</ThemedText>
          </Pressable>;
        })}
      </>}
      {!!error && <ThemedText type="small" accessibilityRole="alert" themeColor="danger">{tr(errors[error] ?? (/^[A-Z_]+$|unknown/.test(error) ? '회차를 등록하지 못했어요. 시간과 권한을 확인해 주세요.' : error))}</ThemedText>}
    </ScrollView>
    <RaisedActionButton analyticsId="meetup.session.add" busy={busy} disabled={repeating && !picked.length} label={repeating ? tr('{0}개 회차 등록', picked.length) : tr('회차 등록')} onPress={() => void add()} />
  </DragSheet>;
}

const styles = StyleSheet.create({
  scroll: { flexShrink: 1 },
  content: { gap: Spacing.two, paddingBottom: Spacing.three },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  check: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
