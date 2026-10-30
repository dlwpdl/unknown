import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SelectionChip } from '@/components/selection-chip';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { LANGUAGE_SHARES, MEETUP_LANGUAGE_NAMES, languagePairLabel, languageSeats, loadMeetupLanguages, otherLanguage,
  type LanguageExchange, type MeetupLanguage, type MeetupLanguages } from '@/lib/meetup-language';
import { supabase } from '@/lib/supabase';

// shortcut: three languages make three pairs, so the host picks a pair; switch to two pickers when a fourth language arrives.
const PAIRS: LanguageExchange['languages'][] = [['ko', 'en'], ['ko', 'fr'], ['en', 'fr']];
const name = (language: MeetupLanguage) => MEETUP_LANGUAGE_NAMES[language];

// Same chip as the listing fields: shared pill size, label type and fading selected fill.
function Chip({ label, selected, onPress, disabled, analyticsId, accessibilityLabel }: {
  label: string; selected: boolean; onPress: () => void; disabled?: boolean; analyticsId: string; accessibilityLabel?: string;
}) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  return <SelectionChip analyticsId={analyticsId} selected={selected} disabled={disabled} baseColor={theme.backgroundElement}
    accessibilityRole="radio" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ selected, checked: selected, disabled }}
    onPress={() => { play('selection'); onPress(); }} style={[ControlStyles.pill, styles.chip, { borderColor: selected ? theme.accent : theme.line }]}>
    <ThemedText type="label" style={{ color: selected ? theme.accentInk : theme.text }}>{label}</ThemedText>
  </SelectionChip>;
}

/** Host side of the create form: the language pair and how seats split between them. */
export function MeetupLanguageSetup({ value, onChange, capacity, disabled }: { value: LanguageExchange; onChange: (next: LanguageExchange) => void; capacity: number; disabled?: boolean }) {
  const { language } = useLanguage();
  const say = (ko: string, en: string) => language === 'en' ? en : ko;
  const [first, second] = value.languages;
  const seats = languageSeats(value, capacity);
  const shareLabel = (share: number) => share === 50 ? say('반반', 'Half and half')
    : share > 50 ? say(`${name(first)} 쪽 많이`, `More ${name(first)}`) : say(`${name(second)} 쪽 많이`, `More ${name(second)}`);
  return <View style={styles.group}>
    <ThemedText type="label">{say('교환할 두 언어', 'Languages to exchange')}</ThemedText>
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={say('교환할 두 언어', 'Languages to exchange')}>
      {PAIRS.map(pair => <Chip key={pair.join('-')} analyticsId="meetup-create.language.pair" disabled={disabled}
        label={languagePairLabel({ languages: pair, share: 50 })} selected={pair[0] === first && pair[1] === second}
        onPress={() => onChange({ ...value, languages: pair })} />)}
    </View>
    <ThemedText type="label">{say('언어별 인원', 'Seats by language')}</ThemedText>
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={say('언어별 인원', 'Seats by language')}>
      {LANGUAGE_SHARES.map(share => <Chip key={share} analyticsId="meetup-create.language.share" disabled={disabled}
        label={shareLabel(share)} selected={value.share === share} onPress={() => onChange({ ...value, share })} />)}
    </View>
    <ThemedText type="supporting" themeColor="textSecondary">{seats
      ? say(`호스트 빼고 ${name(first)} ${seats[0]}명, ${name(second)} ${seats[1]}명까지 받아요. 한쪽이 먼저 차면 그쪽 신청만 마감돼요.`,
        `Up to ${seats[0]} ${name(first)} and ${seats[1]} ${name(second)} speakers, not counting you. If one side fills first, only that side stops taking requests.`)
      : say('정원을 3명 이상으로 정하면 언어별 인원을 나눠 드려요.', 'Set the capacity to 3 or more to split seats by language.')}</ThemedText>
  </View>;
}

/** Applicant side: the language they speak decides their seat; the other language is what they practise. */
export function MeetupLanguagePicker({ exchange, state, value, onChange, disabled }: {
  exchange: LanguageExchange; state: MeetupLanguages | null; value: MeetupLanguage | null; onChange: (speaks: MeetupLanguage) => void; disabled?: boolean;
}) {
  const { language } = useLanguage();
  const say = (ko: string, en: string) => language === 'en' ? en : ko;
  const status = (speaks: MeetupLanguage) => {
    const side = state?.sides.find(item => item.language === speaks);
    if (!side || side.seats == null) return '';
    const left = Math.max(0, side.seats - side.approved);
    return left ? say(` · ${left}자리 남음`, ` · ${left} left`) : say(' · 마감', ' · Full');
  };
  return <View style={styles.group}>
    <ThemedText type="label">{say('할 줄 아는 말', 'Language you speak')}</ThemedText>
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={say('할 줄 아는 말', 'Language you speak')}>
      {exchange.languages.map(speaks => <Chip key={speaks} analyticsId="meetup.join.language" disabled={disabled}
        label={name(speaks) + status(speaks)} selected={value === speaks} onPress={() => onChange(speaks)} />)}
    </View>
    {/* 로/를 fit all three names: 한국어, English(잉글리시), Français(프랑세) end in a vowel sound. */}
    <ThemedText type="supporting" themeColor="textSecondary">{value
      ? say(`${name(value)}로 도와주고 ${name(otherLanguage(exchange, value))}를 배우는 쪽으로 신청해요.`,
        `You’ll join the ${name(value)} side and practise ${name(otherLanguage(exchange, value))}.`)
      : say('어느 쪽 자리로 신청할지 골라 주세요.', 'Choose which side you’re joining.')}</ThemedText>
  </View>;
}

/** Host view: the applicant's side and approvals per language. Renders nothing for ordinary meetups. */
export function MeetupLanguageCounts({ postId, requestId }: { postId: string; requestId?: string }) {
  const { language } = useLanguage(), theme = useTheme();
  const say = (ko: string, en: string) => language === 'en' ? en : ko;
  const [state, setState] = useState<MeetupLanguages | null>(null);
  useEffect(() => {
    let active = true;
    setState(null);
    // A failed read only hides the counts; approval still goes through the server's side check.
    loadMeetupLanguages(supabase, postId).then(value => { if (active) setState(value); }, () => undefined);
    return () => { active = false; };
  }, [postId]);
  if (!state) return null;
  const choice = requestId ? state.requests?.[requestId] : undefined;
  const unknown = state.unknown && state.unknown.approved + state.unknown.pending > 0 ? state.unknown : null;
  return <View style={[styles.counts, { backgroundColor: theme.backgroundElement }]}>
    <ThemedText type="label">{say('언어별 인원', 'By language')}</ThemedText>
    {requestId && <ThemedText type="supporting">{choice
      ? say(`할 줄 아는 말 ${name(choice.speaks)} · 배우는 말 ${name(choice.learns)}`, `Speaks ${name(choice.speaks)} · Learning ${name(choice.learns)}`)
      : say('언어를 고르지 않고 신청했어요.', 'Applied without choosing a language.')}</ThemedText>}
    {state.sides.map(side => <ThemedText key={side.language} type="supporting" themeColor="textSecondary">
      {say(`${name(side.language)} · 승인 ${side.approved}${side.seats != null ? `/${side.seats}` : ''}명 · 검토 중 ${side.pending ?? 0}명 · 대기 ${side.waiting ?? 0}명`,
        `${name(side.language)} · ${side.approved}${side.seats != null ? `/${side.seats}` : ''} approved · ${side.pending ?? 0} to review · ${side.waiting ?? 0} waiting`)}
    </ThemedText>)}
    {unknown && <ThemedText type="supporting" themeColor="textSecondary">{say(`언어 없이 신청 · 승인 ${unknown.approved}명 · 검토 중 ${unknown.pending}명`,
      `No language chosen · ${unknown.approved} approved · ${unknown.pending} to review`)}</ThemedText>}
  </View>;
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderWidth: 1 },
  counts: { borderRadius: 16, padding: Spacing.three, gap: Spacing.one },
});
