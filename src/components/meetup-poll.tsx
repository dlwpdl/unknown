import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SymbolView } from '@/components/symbol-view';

import { Pressable } from '@/components/analytics-controls';
import { ChillingDateInput } from '@/components/chilling-date-input';
import { ClayBoxFill, useClayBox } from '@/components/clay';
import { DragSheet } from '@/components/drag-sheet';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles, IconSize, Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { defaultMeetupStart, formatMeetupTime, meetupZone } from '@/lib/chilling-date';
import { loadPublicMeetupContext } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import {
  POLL_MAX_PER_KIND, POLL_PLACE_MAX, createMeetupPoll, decideMeetupPoll, leadingOption, loadMeetupPoll, pollDraftError, pollError, voteMeetupPoll,
  type MeetupPoll, type PollOption,
} from '@/lib/meetup-poll';
import { supabase } from '@/lib/supabase';

const DAY = 86400000;
const REFRESH_MS = 20000;

/** The meetup's own clock, so every member reads a candidate at the time the meetup uses. */
function useMeetupZone(postId: string) {
  const [zone, setZone] = useState(() => meetupZone());
  useEffect(() => {
    let active = true;
    loadPublicMeetupContext(supabase, postId).then(context => { if (active) setZone(meetupZone(context?.room, context?.cityId)); }, () => {});
    return () => { active = false; };
  }, [postId]);
  return zone;
}

function useOptionText(zone: string) {
  const { locale } = useLanguage();
  return (option: PollOption) => option.kind === 'date' && option.startsAt
    ? formatMeetupTime(option.startsAt, locale, zone, { month: 'short', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' }) : option.label ?? '';
}

/** Open poll (or a result for three days) on top of the meetup chat. Everyone in the meetup votes here; the host and cohosts finish it. */
export function MeetupPollCard({ postId, refreshKey = 0 }: { postId: string; refreshKey?: number }) {
  const { tr } = useLanguage();
  const theme = useTheme(), clayBox = useClayBox(), { play } = useInteractionFeedback();
  const zone = useMeetupZone(postId), text = useOptionText(zone);
  const [poll, setPoll] = useState<MeetupPoll | null>(null), [error, setError] = useState(''), [deciding, setDeciding] = useState(false);
  const pending = useRef(false), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const refresh = useCallback(() => { loadMeetupPoll(supabase, postId).then(value => { if (live.current && !pending.current) setPoll(value); }, () => {}); }, [postId]);
  // Counts move while people vote, so the card re-reads on a short timer (cheap, one row set) and when the host acts.
  useEffect(() => { refresh(); const timer = setInterval(refresh, REFRESH_MS); return () => clearInterval(timer); }, [refresh, refreshKey]);
  if (!poll) return null;
  const open = poll.status === 'open';

  const toggle = async (option: PollOption) => {
    if (!open || pending.current) return;
    pending.current = true; setError(''); play('selection');
    const next = poll.options.map(item => item.id === option.id ? { ...item, mine: !item.mine, votes: item.votes + (item.mine ? -1 : 1) } : item);
    const before = poll;
    setPoll({ ...poll, options: next });
    try { await voteMeetupPoll(supabase, poll.id, next.filter(item => item.mine).map(item => item.id)); }
    catch (failure) { if (live.current) { setPoll(before); setError(pollError(failure)); play('warning'); } }
    finally { pending.current = false; if (live.current) refresh(); }
  };

  const kinds = (['date', 'place'] as const).filter(kind => poll.options.some(option => option.kind === kind));
  const title = kinds.length === 2 ? tr('날짜·장소 투표') : kinds[0] === 'date' ? tr('날짜 투표') : tr('장소 투표');
  const content = <View style={styles.body}>
    <View style={styles.head}>
      <View style={styles.flex}>
        <ThemedText accessibilityRole="header" style={Typography.label}>{open ? title : tr('투표 결과')}</ThemedText>
        {open && <ThemedText themeColor="textSecondary" accessibilityLiveRegion="polite" style={Typography.caption}>{tr('{0}명 중 {1}명이 골랐어요', poll.members, poll.voters)}</ThemedText>}
        {open && !!poll.autoCloseAt && <ThemedText themeColor="textSecondary" style={Typography.caption}>{tr('모임 하루 전에 저절로 닫혀요. 표가 가장 많은 후보로 정해지고, 같으면 호스트가 골라요.')}</ThemedText>}
      </View>
      {open && poll.canManage && <Pressable analyticsId="meetup.poll.decide" accessibilityRole="button" accessibilityLabel={tr('투표 끝내기')} hitSlop={8}
        onPress={() => { play('selection'); setDeciding(true); }} style={({ pressed }) => [styles.finish, { opacity: pressed ? 0.6 : 1 }]}>
        <ThemedText style={[Typography.label, { color: theme.accent }]}>{tr('투표 끝내기')}</ThemedText>
      </Pressable>}
    </View>
    <ScrollView style={styles.list} nestedScrollEnabled>
      {kinds.map(kind => <View key={kind} accessibilityRole={open ? 'group' : undefined}>
        {kinds.length > 1 && <ThemedText themeColor="textSecondary" style={[Typography.caption, styles.kind]}>{kind === 'date' ? tr('날짜') : tr('장소')}</ThemedText>}
        {poll.options.filter(option => option.kind === kind && (open || option.chosen)).map(option => {
          const share = Math.min(1, option.votes / Math.max(1, poll.members));
          return <Pressable key={option.id} analyticsId="meetup.poll.vote" accessibilityRole={open ? 'checkbox' : 'text'} disabled={!open}
            accessibilityLabel={`${text(option)}, ${tr('{0}표', option.votes)}`} accessibilityState={open ? { checked: option.mine } : undefined}
            onPress={() => void toggle(option)} style={styles.option}>
            {open && <View style={[styles.box, { borderColor: option.mine ? theme.accent : theme.textSecondary, backgroundColor: option.mine ? theme.accent : 'transparent' }]}>
              {option.mine && <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={IconSize.chevron} tintColor={theme.accentInk} />}
            </View>}
            <View style={styles.flex}>
              <ThemedText style={Typography.body}>{text(option)}</ThemedText>
              {open && <View style={[styles.bar, { backgroundColor: theme.backgroundSelected }]}><View style={[styles.barFill, { width: `${Math.round(share * 100)}%`, backgroundColor: theme.accent }]} /></View>}
            </View>
            {open ? <ThemedText themeColor="textSecondary" style={Typography.label}>{tr('{0}표', option.votes)}</ThemedText> : <ThemedText style={[Typography.label, { color: theme.accent }]}>{tr('정해졌어요')}</ThemedText>}
          </Pressable>;
        })}
      </View>)}
    </ScrollView>
    {open && <ThemedText themeColor="textSecondary" style={Typography.caption}>{tr('여러 개 고를 수 있고 언제든 바꿀 수 있어요. 누가 골랐는지는 보이지 않아요.')}</ThemedText>}
    {!!error && <ThemedText themeColor="danger" accessibilityRole="alert" style={Typography.caption}>{tr(error)}</ThemedText>}
    {deciding && <PollDecideSheet poll={poll} text={text} onClose={() => setDeciding(false)} onDone={() => { setDeciding(false); refresh(); }} />}
  </View>;
  if (clayBox) return <View style={styles.cardClay}><ClayBoxFill kind="tile" /><View style={styles.clayRows}>{content}</View></View>;
  return <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>{content}</View>;
}

/** Host and cohost pick the winner of each kind (the most-voted one is preselected) or close the poll without one. */
function PollDecideSheet({ poll, text, onClose, onDone }: { poll: MeetupPoll; text: (option: PollOption) => string; onClose: () => void; onDone: () => void }) {
  const { tr } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [date, setDate] = useState(() => leadingOption(poll.options, 'date')?.id ?? null), [place, setPlace] = useState(() => leadingOption(poll.options, 'place')?.id ?? null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const send = async (dateId: string | null, placeId: string | null) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await decideMeetupPoll(supabase, poll.id, dateId, placeId); play('success'); onDone(); }
    catch (failure) { setError(pollError(failure)); play('warning'); setBusy(false); }
  };
  const group = (kind: 'date' | 'place', value: string | null, set: (id: string) => void) => {
    const options = poll.options.filter(option => option.kind === kind);
    if (!options.length) return null;
    return <View key={kind} accessibilityRole="radiogroup" accessibilityLabel={kind === 'date' ? tr('날짜') : tr('장소')}>
      <ThemedText style={Typography.label}>{kind === 'date' ? tr('날짜') : tr('장소')}</ThemedText>
      {options.map(option => <Pressable key={option.id} analyticsId="meetup.poll.pick" accessibilityRole="radio" accessibilityState={{ checked: value === option.id, disabled: busy }} disabled={busy}
        onPress={() => { play('selection'); set(option.id); }} style={styles.option}>
        <View style={[styles.radio, { borderColor: value === option.id ? theme.accent : theme.textSecondary }]}>{value === option.id && <View style={[styles.radioDot, { backgroundColor: theme.accent }]} />}</View>
        <ThemedText style={[Typography.body, styles.flex]}>{text(option)}</ThemedText>
        <ThemedText themeColor="textSecondary" style={Typography.label}>{tr('{0}표', option.votes)}</ThemedText>
      </Pressable>)}
    </View>;
  };
  return <DragSheet visible onClose={onClose} dismissible={!busy} title={tr('투표 끝내기')}>
    <ScrollView keyboardShouldPersistTaps="handled" style={styles.sheetScroll} contentContainerStyle={styles.sheetContent}>
      {group('date', date, setDate)}{group('place', place, setPlace)}
      <ThemedText themeColor="textSecondary" style={Typography.supporting}>{tr('고른 걸 모임에 반영하고 멤버들에게 알려요.')}</ThemedText>
      {!!error && <ThemedText themeColor="danger" accessibilityRole="alert" style={Typography.supporting}>{tr(error)}</ThemedText>}
    </ScrollView>
    <RaisedActionButton analyticsId="meetup.poll.decide" busy={busy} label={tr('이걸로 정하기')} onPress={() => void send(date, place)} />
    <RaisedActionButton analyticsId="meetup.poll.close" tone="secondary" disabled={busy} label={tr('정하지 않고 끝내기')} onPress={() => void send(null, null)} />
  </DragSheet>;
}

/** Host-side sheet for opening a poll: 2 to 5 dates and/or 2 to 5 places. */
export function MeetupPollComposer({ postId, visible, onClose, onCreated }: { postId: string; visible: boolean; onClose: () => void; onCreated: () => void }) {
  const { tr } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback();
  const zone = useMeetupZone(postId);
  const [dates, setDates] = useState<string[]>([]), [places, setPlaces] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const invalid = pollDraftError({ dates, places });
  const addDate = () => {
    play('selection');
    // Each new candidate starts a day after the last, so the list never opens with the same time twice.
    const last = dates.at(-1), start = last ? new Date(Date.parse(last) + DAY).toISOString() : defaultMeetupStart(zone);
    setDates(value => [...value, start]);
  };
  const submit = async () => {
    if (busy || invalid) return;
    setBusy(true); setError('');
    try { await createMeetupPoll(supabase, postId, { dates, places }); play('success'); setDates([]); setPlaces([]); onCreated(); onClose(); }
    catch (failure) { setError(pollError(failure)); play('warning'); }
    finally { setBusy(false); }
  };
  return <DragSheet visible={visible} onClose={onClose} dismissible={!busy} title={tr('날짜·장소 투표 만들기')}>
    <ScrollView keyboardShouldPersistTaps="handled" style={styles.sheetScroll} contentContainerStyle={styles.sheetContent}>
      <ThemedText themeColor="textSecondary" style={Typography.supporting}>{tr('멤버들이 되는 날짜와 가고 싶은 장소를 골라요. 날짜만, 장소만 열어도 돼요.')} {tr('날짜와 장소는 여는 쪽마다 후보를 2~5개 넣어요.')}</ThemedText>
      <ThemedText style={Typography.label}>{tr('날짜 후보')}</ThemedText>
      {dates.map((value, index) => <View key={index} style={styles.candidate}>
        <View style={styles.flex}><ChillingDateInput label={tr('날짜 {0}', index + 1)} value={value} zone={zone} disabled={busy} minimumDate={new Date()}
          onChange={next => { play('selection'); setDates(list => list.map((item, at) => at === index ? next : item)); }} /></View>
        <Remove label={tr('날짜 {0} 지우기', index + 1)} disabled={busy} onPress={() => { play('selection'); setDates(list => list.filter((_, at) => at !== index)); }} />
      </View>)}
      {dates.length < POLL_MAX_PER_KIND && <RaisedActionButton analyticsId="meetup.poll.add-date" tone="secondary" compact disabled={busy} label={tr('날짜 추가')} onPress={addDate} />}
      <ThemedText style={Typography.label}>{tr('장소 후보')}</ThemedText>
      {places.map((value, index) => <View key={index} style={styles.candidate}>
        <TextInput accessibilityLabel={tr('장소 {0}', index + 1)} value={value} editable={!busy} maxLength={POLL_PLACE_MAX} placeholder={tr('예: 강가 공원')} placeholderTextColor={theme.textSecondary}
          onChangeText={next => setPlaces(list => list.map((item, at) => at === index ? next : item))}
          style={[ControlStyles.field, styles.flex, { color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} />
        <Remove label={tr('장소 {0} 지우기', index + 1)} disabled={busy} onPress={() => { play('selection'); setPlaces(list => list.filter((_, at) => at !== index)); }} />
      </View>)}
      {places.length < POLL_MAX_PER_KIND && <RaisedActionButton analyticsId="meetup.poll.add-place" tone="secondary" compact disabled={busy} label={tr('장소 추가')} onPress={() => { play('selection'); setPlaces(list => [...list, '']); }} />}
      {!!error && <ThemedText themeColor="danger" accessibilityRole="alert" style={Typography.supporting}>{tr(error)}</ThemedText>}
      {!error && (dates.length > 0 || places.length > 0) && !!invalid && <ThemedText themeColor="textSecondary" style={Typography.supporting}>{tr(invalid)}</ThemedText>}
    </ScrollView>
    <RaisedActionButton analyticsId="meetup.poll.submit" busy={busy} disabled={!!invalid} label={tr('투표 열기')} onPress={() => void submit()} />
  </DragSheet>;
}

function Remove({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  return <Pressable analyticsId="meetup.poll.remove" accessibilityRole="button" accessibilityLabel={label} disabled={disabled} hitSlop={6} onPress={onPress} style={styles.remove}>
    <SymbolView name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }} size={IconSize.toolbar} tintColor={theme.textSecondary} />
  </Pressable>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { marginHorizontal: Spacing.three, marginBottom: Spacing.two, borderRadius: 12, overflow: 'hidden' },
  cardClay: { marginHorizontal: Spacing.three, marginBottom: Spacing.two }, clayRows: { borderRadius: 16, overflow: 'hidden' },
  body: { padding: Spacing.three, gap: Spacing.one },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  finish: { minHeight: 44, justifyContent: 'center' },
  list: { maxHeight: 220 },
  kind: { marginTop: Spacing.one },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' }, radioDot: { width: 12, height: 12, borderRadius: 6 },
  bar: { height: 4, borderRadius: 2, marginTop: 4, overflow: 'hidden' }, barFill: { height: 4, borderRadius: 2 },
  sheetScroll: { flexShrink: 1 }, sheetContent: { gap: Spacing.two, paddingBottom: Spacing.three },
  candidate: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
