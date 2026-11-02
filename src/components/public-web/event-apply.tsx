import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { ListCard, ListRow, SectionLabel, Tag } from '@/components/list-card';
import { RaisedActionButton } from '@/components/raised-action-button';
import { SelectionChip } from '@/components/selection-chip';
import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles, Typography, controlPresentation } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { callEventLink } from '@/lib/event-links';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { EVENT_COPY, eventDate, eventDay, eventHandle, eventTime, reelChoices, type EventLanguage, type SupportKey } from './event-copy';
import { EventFact, EventHeader, EventLoadState, EventPage, EventSelect, LanguageChips, eventStyles } from './event-parts';

type EventInfo = {
  title: string; business: string; avatar: string; instagram: string | null; terms: string; closes_on: string | null; deadline_note: string;
  support: { key: SupportKey; covered: boolean; note_en?: string; note_ko?: string }[];
  visit_dates: string[]; time_slots: string[]; party_max: number; reel_days_max: number;
};
type Slot = { date: string; time: string };
type FormError = 'badHandle' | 'needSlot' | 'halfSlot' | 'sameSlot' | 'needAllergy' | 'needReel' | 'tooMany' | 'closed' | 'sendFailed';
const EMPTY: Slot = { date: '', time: '' };

// gling.ej-entertainment.com/apply?event=<slug>, opened from the event DM. Layout and wording: the approved galbi example.
export default function EventApplyPage() {
  const { event: slug } = useLocalSearchParams<{ event?: string }>();
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [language, setLanguage] = useState<EventLanguage>('en');
  const [load, setLoad] = useState<'loading' | 'expired' | 'failed'>('loading');
  const [info, setInfo] = useState<EventInfo | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [handle, setHandle] = useState('');
  const [first, setFirst] = useState<Slot>(EMPTY);
  const [second, setSecond] = useState<Slot>(EMPTY);
  const [party, setParty] = useState(1);
  const [noAllergy, setNoAllergy] = useState(false);
  const [allergy, setAllergy] = useState('');
  const [reel, setReel] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [done, setDone] = useState(false);
  const copy = EVENT_COPY[language];

  useEffect(() => {
    let live = true;
    const request = slug ? callEventLink<{ event: EventInfo }>({ apply: slug }) : Promise.resolve({ status: 404, data: null });
    void request.then(({ status, data }) => {
      if (!live) return;
      if (status === 200 && data?.event) { setInfo(data.event); setParty(Math.min(2, data.event.party_max)); }
      else setLoad(status === 404 || status === 400 ? 'expired' : 'failed');
    });
    return () => { live = false; };
  }, [slug, attempt]);

  if (!info) return <EventPage language={language} onLanguage={setLanguage} title="Gling">
    <EventLoadState language={language} state={load} onRetry={() => { setLoad('loading'); setAttempt(value => value + 1); }} />
  </EventPage>;

  const problem = (): FormError | null => {
    if (!eventHandle(handle)) return 'badHandle';
    if (!first.date || !first.time) return 'needSlot';
    if (!second.date !== !second.time) return 'halfSlot';
    if (second.date === first.date && second.time === first.time) return 'sameSlot';
    if (!noAllergy && !allergy.trim()) return 'needAllergy';
    if (!reel) return 'needReel';
    return null;
  };
  const submit = async () => {
    if (busy || !slug) return;
    const found = problem();
    if (found) { play('warning'); setError(found); return; }
    setBusy(true); setError(null);
    const { status } = await callEventLink({ apply: slug, handle: eventHandle(handle)!, slots: second.date ? [first, second] : [first], party,
      allergies: noAllergy ? null : allergy.trim(), reel_days: reel!, language });
    setBusy(false);
    if (status === 200) { play('success'); setDone(true); return; }
    play('warning');
    // A 400 here means a pick went stale after the page loaded (a date passed); sending again after re-picking fixes it.
    setError(status === 429 ? 'tooMany' : status === 404 ? 'closed' : 'sendFailed');
  };
  const edit = <T,>(set: (value: T) => void) => (value: T) => { set(value); setError(null); };
  const dates = info.visit_dates.map(value => ({ value, label: eventDate(value, language) }));
  const times = info.time_slots.map(value => ({ value, label: eventTime(value, language) }));
  const note = (item: EventInfo['support'][number]) => (language === 'ko' ? item.note_ko : item.note_en) || undefined;
  const slotRow = (label: string, slot: Slot, set: (slot: Slot) => void) => <View style={styles.slot}>
    <ThemedText themeColor="textSecondary" style={[Typography.supporting, styles.slotLabel]}>{label}</ThemedText>
    <EventSelect label={`${label} · ${copy.date_ph}`} placeholder={copy.date_ph} value={slot.date} options={dates} grow={1.3} disabled={busy} onChange={date => edit(set)({ ...slot, date })} />
    <EventSelect label={`${label} · ${copy.time_ph}`} placeholder={copy.time_ph} value={slot.time} options={times} disabled={busy} onChange={time => edit(set)({ ...slot, time })} />
  </View>;
  const step = (label: string, glyph: string, next: number) => {
    const blocked = busy || next < 1 || next > info.party_max;
    return <Pressable analyticsId={`event.apply.party.${glyph === '+' ? 'more' : 'less'}`} accessibilityRole="button" accessibilityLabel={label}
      disabled={blocked} accessibilityState={{ disabled: blocked }} onPress={() => { play('selection'); setParty(next); }}
      style={({ pressed }) => [ControlStyles.icon, styles.stepButton, controlPresentation(theme, { pressed, disabled: blocked }).container]}>
      <ThemedText style={Typography.menu}>{glyph}</ThemedText>
    </Pressable>;
  };

  return <EventPage language={language} onLanguage={setLanguage} title={`${info.title} · Gling`}>
    <EventHeader language={language} title={info.title} business={info.business} avatar={info.avatar} instagram={info.instagram} />
    {done ? <StateCard layout="start" kind="success" mark="check" title={copy.done[0]} body={copy.done[1]}>
      <RaisedActionButton analyticsId="event.apply.follow" tone="secondary" label={copy.btn_profile2}
        onPress={() => { play('selection'); window.open('https://www.instagram.com/gling.app/', '_blank', 'noopener'); }} />
    </StateCard> : <>
      {info.support.length > 0 && <View style={eventStyles.section}>
        <SectionLabel>{copy.h_cover}</SectionLabel>
        <ListCard>{info.support.map(item => <ListRow key={item.key} title={copy.cover[item.key](info.party_max)} detail={note(item)}
          trailing={<Tag label={item.covered ? `✓ ${copy.yes}` : `✕ ${copy.no}`} tone={item.covered ? 'accent' : 'quiet'} />} />)}</ListCard>
      </View>}
      <View style={eventStyles.section}>
        <SectionLabel>{copy.h_do}</SectionLabel>
        <EventFact mark="🎬">
          <ThemedText style={Typography.body}>{copy.do(info.reel_days_max)}</ThemedText>
          {!!info.terms && <ThemedText themeColor="textSecondary" style={Typography.supporting}>{info.terms}</ThemedText>}
        </EventFact>
        <EventFact mark="📅">
          <ThemedText style={Typography.body}>{copy.when(eventDay(info.visit_dates[0], language), eventDay(info.visit_dates[info.visit_dates.length - 1], language),
            info.closes_on ? eventDay(info.closes_on, language) : null)}</ThemedText>
          {!!info.deadline_note && <ThemedText themeColor="textSecondary" style={Typography.supporting}>{info.deadline_note}</ThemedText>}
        </EventFact>
      </View>

      <View style={eventStyles.section}>
        <SectionLabel>{copy.h_apply}</SectionLabel>
        <ThemedText style={Typography.label}>{copy.l_handle}</ThemedText>
        <View style={[ControlStyles.field, eventStyles.handle, { borderColor: error === 'badHandle' ? theme.danger : theme.line, backgroundColor: theme.card }]}>
          <ThemedText themeColor="textSecondary" style={Typography.menu}>@</ThemedText>
          <TextInput accessibilityLabel={copy.l_handle} value={handle} onChangeText={edit(setHandle)} onFocus={() => play('selection')}
            placeholder={copy.handle_ph} placeholderTextColor={theme.textSecondary} autoCapitalize="none" autoCorrect={false} autoComplete="off"
            spellCheck={false} maxLength={31} editable={!busy} style={[eventStyles.input, Typography.menu, { color: theme.text }]} />
        </View>

        <ThemedText style={[Typography.label, styles.gap]}>{copy.l_slots}</ThemedText>
        {slotRow(copy.first, first, setFirst)}
        {slotRow(copy.second, second, setSecond)}

        <ThemedText style={[Typography.label, styles.gap]}>{copy.l_party}</ThemedText>
        <View style={styles.party}>
          {step(copy.party_less, '−', party - 1)}
          <ThemedText accessibilityLiveRegion="polite" style={[Typography.section, styles.count]}>{party}</ThemedText>
          {step(copy.party_more, '+', party + 1)}
          <ThemedText themeColor="textSecondary" style={Typography.supporting}>{copy.party_max(info.party_max)}</ThemedText>
        </View>

        <ThemedText style={[Typography.label, styles.gap]}>{copy.l_allergy}</ThemedText>
        <View style={eventStyles.chips}>
          <SelectionChip analyticsId="event.apply.allergy.none" label={copy.none} selected={noAllergy} disabled={busy}
            accessibilityRole="checkbox" accessibilityState={{ checked: noAllergy }}
            onPress={() => { play('selection'); edit(setNoAllergy)(!noAllergy); if (!noAllergy) setAllergy(''); }} />
        </View>
        <View style={[ControlStyles.field, eventStyles.handle, { borderColor: theme.line, backgroundColor: theme.card, opacity: noAllergy ? 0.45 : 1 }]}>
          <TextInput accessibilityLabel={copy.l_allergy} value={allergy} onChangeText={edit(setAllergy)} onFocus={() => play('selection')}
            placeholder={copy.allergy_ph} placeholderTextColor={theme.textSecondary} maxLength={200} editable={!busy && !noAllergy}
            style={[eventStyles.input, Typography.menu, { color: theme.text }]} />
        </View>

        <ThemedText style={[Typography.label, styles.gap]}>{copy.l_reel(info.reel_days_max)}</ThemedText>
        <View accessibilityRole="radiogroup" accessibilityLabel={copy.l_reel(info.reel_days_max)} style={eventStyles.chips}>
          {reelChoices(info.reel_days_max).map(days => <SelectionChip key={days} analyticsId={`event.apply.reel.${days}`} label={copy.reel(days)}
            selected={reel === days} disabled={busy} accessibilityRole="radio" accessibilityState={{ checked: reel === days }}
            onPress={() => { play('selection'); edit(setReel)(days); }} />)}
        </View>

        <ThemedText style={[Typography.label, styles.gap]}>{copy.l_lang}</ThemedText>
        <LanguageChips language={language} onLanguage={setLanguage} label={copy.l_lang} analyticsId="event.apply.language" />

        <ThemedText themeColor="textSecondary" style={[Typography.supporting, styles.gap]}>{copy.privacy}</ThemedText>
        {error && <ThemedText accessibilityLiveRegion="polite" style={[Typography.supporting, { color: theme.danger }]}>{copy[error]}</ThemedText>}
        <RaisedActionButton analyticsId="event.apply.submit" label={copy.btn_submit} busy={busy} onPress={() => void submit()} />
      </View>
    </>}
  </EventPage>;
}

const styles = StyleSheet.create({
  gap: { marginTop: Spacing.two },
  slot: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + Spacing.half },
  slotLabel: { width: 76 },
  party: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stepButton: { borderWidth: 1 },
  count: { minWidth: 28, textAlign: 'center' },
});
