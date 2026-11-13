import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from '@/components/symbol-view';
import { useCallback, useEffect, useState } from 'react';
import { DeviceEventEmitter, Linking, StyleSheet, View } from 'react-native';

import { Pressable, Switch } from '@/components/analytics-controls';
import { ClayBoxFill, ClayPillFill, useClay, useClayBox } from '@/components/clay';
import { SelectionChip } from '@/components/selection-chip';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles, IconSize, Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { MEETUPS_CHANGED_EVENT } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { MEETUP_LABEL_TEXT, loadNewcomerStatus, meetupLabels, newcomerDaysLeft, type MeetupLabel, type NewcomerStatus } from '@/lib/newcomer';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

/** My own newcomer status; nobody else's is ever loaded or shown. */
export function useNewcomerStatus(enabled = true) {
  const { isAuthed, me } = useAuth();
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{ key: string; userId: string; status: NewcomerStatus | null } | null>(null);
  const userId = enabled && isAuthed && me.id ? me.id : null;
  const key = userId ? `${userId}:${version}` : null;
  useEffect(() => {
    if (!key || !userId) return;
    let active = true;
    loadNewcomerStatus(supabase, userId, version > 0).then(
      status => { if (active) setResult({ key, userId, status }); },
      () => { if (active) setResult({ key, userId, status: null }); });
    return () => { active = false; };
  }, [key, userId, version]);
  useEffect(() => {
    if (!enabled) return;
    const listener = DeviceEventEmitter.addListener(MEETUPS_CHANGED_EVENT, () => setVersion(value => value + 1));
    return () => listener.remove();
  }, [enabled]);
  // A refresh keeps showing the last status for the same account while it reloads.
  return { status: userId && result?.userId === userId ? result.status : null, loading: !!key && result?.key !== key,
    refresh: () => setVersion(value => value + 1) };
}

// Photo overlays keep fixed colours in both themes: they sit on arbitrary photos, not on the theme background.
// Contrast from the mockup check: #171123 on #CBB9FF 10.5:1, #FFFFFF on #2B2B36 (92%) about 14:1.
const LABEL_COLORS: Record<MeetupLabel, { backgroundColor: string; color: string }> = {
  new: { backgroundColor: 'rgba(43,43,54,0.92)', color: '#FFFFFF' },
  welcome: { backgroundColor: '#CBB9FF', color: '#171123' },
  newcomersOnly: { backgroundColor: '#CBB9FF', color: '#171123' },
};

export function MeetupLabelBadges({ labels, overlay = true }: { labels: MeetupLabel[]; overlay?: boolean }) {
  const { tr } = useLanguage();
  const theme = useTheme(), clay = useClay();
  if (!labels.length) return null;
  // The card's accessibility label already reads these before the title.
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.badges, overlay && styles.overlay]}>
    {labels.map(label => <View key={label} style={[styles.badge, clay ? styles.badgeClay : { backgroundColor: LABEL_COLORS[label].backgroundColor }]}>
      {clay && <ClayPillFill kind={label === 'new' ? 'white' : 'on'} />}
      <ThemedText style={[styles.badgeText, { color: !clay ? LABEL_COLORS[label].color : label === 'new' ? theme.text : theme.accentInk }]}>{tr(MEETUP_LABEL_TEXT[label])}</ThemedText>
    </View>)}
  </View>;
}

/** "새 모임, 처음 와도 돼요, " for the card's accessibility label. */
export function useMeetupLabelPrefix(post: Pick<Post, 'createdAt' | 'room'>) {
  const { tr } = useLanguage();
  const labels = meetupLabels(post);
  return { labels, prefix: labels.map(label => `${tr(MEETUP_LABEL_TEXT[label])}, `).join('') };
}

/** Host option after capacity: one switch; turning it on reveals who can apply and a list preview. */
export function MeetupNewcomerOption({ welcome, only, onChange, disabled }: {
  welcome: boolean; only: boolean; onChange: (next: { welcome: boolean; only: boolean }) => void; disabled?: boolean;
}) {
  const { tr } = useLanguage();
  const theme = useTheme(), clayBox = useClayBox();
  const { play } = useInteractionFeedback();
  const { status } = useNewcomerStatus();
  const days = status?.periodDays ?? 60;
  return <View style={styles.option}>
    <ThemedText type="smallBold" style={Typography.menu}>{tr('처음 오는 분')}</ThemedText>
    <View style={[styles.optionCard, clayBox ? styles.clayCard : { backgroundColor: theme.card, borderColor: theme.line }]}>{clayBox && <ClayBoxFill kind="tile" />}
      <View style={styles.switchRow}>
        <View style={styles.flex}>
          <ThemedText style={Typography.menu}>{tr('처음 오는 분 환영')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{tr('목록에 ‘처음 와도 돼요’가 붙고, 가입한 지 얼마 안 된 분께 먼저 추천돼요.')}</ThemedText>
        </View>
        <Switch analyticsId="meetup.newcomer.welcome" accessibilityLabel={tr('처음 오는 분 환영')} value={welcome} disabled={disabled}
          onValueChange={value => { play('selection'); onChange({ welcome: value, only: value && only }); }} />
      </View>
      {welcome && <>
        <View style={[styles.divider, { backgroundColor: theme.line }]} />
        <ThemedText type="smallBold">{tr('신청할 수 있는 사람')}</ThemedText>
        <View accessibilityRole="radiogroup" accessibilityLabel={tr('신청할 수 있는 사람')} style={styles.choices}>
          {([[false, 'meetup.newcomer.audience.anyone', '누구나'], [true, 'meetup.newcomer.audience.newcomers', '새 멤버만']] as const).map(([value, id, label]) =>
            <SelectionChip key={id} analyticsId={id} selected={only === value} disabled={disabled} accessibilityRole="radio" accessibilityState={{ checked: only === value, disabled: !!disabled }}
              baseColor={theme.backgroundElement} onPress={() => { play('selection'); onChange({ welcome, only: value }); }} style={[ControlStyles.pill, styles.choice]}>
              <ThemedText type="smallBold" style={{ color: only === value ? theme.accentInk : theme.text }}>{tr(label)}</ThemedText>
            </SelectionChip>)}
        </View>
        {only && <ThemedText type="small" themeColor="textSecondary">{tr('가입한 지 {0}일 안 된 분만 신청할 수 있어요. 인원이 덜 찰 수 있어요.', days)}</ThemedText>}
        <View style={[styles.preview, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="small" themeColor="textSecondary">{tr('목록에서는 이렇게 보여요')}</ThemedText>
          <MeetupLabelBadges overlay={false} labels={only ? ['newcomersOnly'] : ['welcome']} />
        </View>
      </>}
    </View>
  </View>;
}

const hiddenKey = (userId: string) => `gling.newcomer-card.hidden:${userId}`;
const celebratedKey = (userId: string) => `gling.newcomer-card.celebrated:${userId}`;
// 캐나다 온 지 and the 처음 할 일 checks stay on this phone only, like hiding the card.
const arrivalKey = (userId: string) => `gling.newcomer-card.arrival:${userId}`;
const stepsKey = (userId: string) => `gling.newcomer-card.steps:${userId}`;
const ARRIVALS = [['new', '3개월 안 됐어요'], ['year', '1년 안 됐어요'], ['old', '1년 넘었어요']] as const;
type Arrival = typeof ARRIVALS[number][0];
// BC facts checked 2026-11-13 (minimum wage, MSP wait and fee, Compass deposit); recheck once a year. Vancouver only.
const FIRST_STEPS: { id: string; title: string; body: string; label: string; url?: string; open?: 'housing' | 'jobs' | 'meetups' }[] = [
  { id: 'compass', title: '교통카드', body: '컴퍼스 카드는 $6 내고 만드는데 카드를 돌려주면 그 돈도 돌려받아요. 어른 요금이면 신용카드나 폰을 바로 찍어도 되고요.',
    label: 'TransLink ↗', url: 'https://www.translink.ca/transit-fares/compass-card' },
  { id: 'sin', title: 'SIN 신청', body: '일하려면 이 번호부터 있어야 해요. 돈은 안 들고, 서비스 캐나다에 직접 가면 서류가 맞을 때 그 자리에서 받아요.',
    label: '정부 안내 ↗', url: 'https://www.canada.ca/en/employment-social-development/services/sin/apply.html' },
  { id: 'bank', title: '은행 계좌', body: '신분증 원본을 두 개 챙겨 가요. 하나뿐이면 그 은행에 계좌가 있는 지인이 신원을 확인해 주는 방법도 있어요.',
    label: '정부 안내 ↗', url: 'https://www.canada.ca/en/financial-consumer-agency/services/banking/opening-bank-account.html' },
  { id: 'msp', title: 'MSP 신청', body: '도착하자마자 신청해도 그달 남은 날에 두 달을 더 기다려야 시작돼요. 그동안 쓸 보험은 따로 들어 둬요. 유학생은 MSP 비용으로 한 달에 $75를 내요.',
    label: 'BC 정부 ↗', url: 'https://www2.gov.bc.ca/gov/content/health/health-drug-coverage/msp/bc-residents/eligibility-and-enrolment/are-you-eligible' },
  { id: 'room', title: '방 구하기', body: '보러 가기 전에 돈부터 달라는 집은 거르세요. 동네별 렌트는 부동산에 모여 있어요.', label: '부동산 ›', open: 'housing' },
  { id: 'job', title: '일 구하기', body: 'BC 최저시급은 2026년 6월부터 $18.25예요. 유학생은 학기 중엔 주 24시간까지 일할 수 있어요.', label: '구인구직 ›', open: 'jobs' },
  { id: 'friends', title: '친구 만들기', body: "'처음 와도 돼요'가 붙은 모임은 호스트가 처음 오는 사람도 반긴다고 표시한 곳이에요.", label: '모임 ›', open: 'meetups' },
];

/** Today tab: progress toward the first meetup, only for my own newcomer period. */
export function NewcomerProgressCard({ cityId, onOpenCategory }: { cityId: string; onOpenCategory: (slug: 'housing' | 'jobs') => void }) {
  const { tr } = useLanguage();
  const theme = useTheme(), clayBox = useClayBox(), router = useRouter();
  const { me, isAuthed } = useAuth();
  const { play } = useInteractionFeedback();
  const { status, refresh } = useNewcomerStatus(isAuthed);
  const [stored, setStored] = useState<{ hidden: boolean; celebrated: boolean; arrival: Arrival | null; done: string[] } | null>(null);
  useFocusEffect(useCallback(() => { refresh(); }, [])); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    AsyncStorage.multiGet([hiddenKey(me.id), celebratedKey(me.id), arrivalKey(me.id), stepsKey(me.id)])
      .then(([[, hidden], [, celebrated], [, arrival], [, steps]]) => {
        let done: string[] = [];
        try { const parsed: unknown = JSON.parse(steps ?? '[]'); if (Array.isArray(parsed)) done = parsed.filter(id => FIRST_STEPS.some(step => step.id === id)); } catch { /* a broken value starts the list over */ }
        if (active) setStored({ hidden: hidden === '1', celebrated: celebrated === '1', arrival: ARRIVALS.find(([id]) => id === arrival)?.[0] ?? null, done });
      })
      .catch(() => { if (active) setStored({ hidden: false, celebrated: false, arrival: null, done: [] }); });
    return () => { active = false; };
  }, [isAuthed, me.id]);
  const celebrate = !!status?.newcomer && status.attended && stored?.celebrated === false;
  useEffect(() => {
    // The celebration shows once; the next visit no longer finds the card. "First" = the server's attended newcomer status plus this account's celebrated flag.
    if (!celebrate) return;
    play('firstMeetup');
    void AsyncStorage.setItem(celebratedKey(me.id), '1').catch(() => {});
  }, [celebrate, me.id]); // eslint-disable-line react-hooks/exhaustive-deps -- play changes with the sound settings; cheer once
  if (!status?.newcomer || !stored || stored.hidden || (status.attended && !celebrate)) return null;
  const openMeetups = () => { play('selection'); router.navigate('/(tabs)/meetups'); };
  const link = (label: string) => <Pressable analyticsId="today.newcomer.meetups" accessibilityRole="link" onPress={openMeetups} style={styles.link}>
    <ThemedText type="smallBold" themeColor="accent">{label}</ThemedText>
  </Pressable>;
  if (celebrate) return <View style={[styles.card, clayBox ? styles.clayCard : { backgroundColor: theme.card, borderColor: theme.line }]}>{clayBox && <ClayBoxFill kind="tile" />}
    <ThemedText accessibilityRole="header" style={Typography.section}>{tr('첫 모임 다녀오셨네요!')}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{tr('다음 모임도 마음 가는 대로 골라 보세요.')}</ThemedText>
    {link(tr('모임 보기 ›'))}
  </View>;
  const vancouver = cityId === 'vancouver';
  const answer = (arrival: Arrival) => {
    play('selection');
    setStored(current => current && { ...current, arrival });
    void AsyncStorage.setItem(arrivalKey(me.id), arrival).catch(() => {});
  };
  const toggleStep = (id: string) => {
    play('selection');
    const done = stored.done.includes(id) ? stored.done.filter(item => item !== id) : [...stored.done, id];
    setStored(current => current && { ...current, done });
    void AsyncStorage.setItem(stepsKey(me.id), JSON.stringify(done)).catch(() => {});
  };
  const openStep = (step: typeof FIRST_STEPS[number]) => {
    if (step.url) { play('selection'); void Linking.openURL(step.url).catch(() => play('warning')); }
    else if (step.open === 'meetups') openMeetups();
    else if (step.open) onOpenCategory(step.open);
  };
  const steps = [['가입', true], ['프로필', true], ['첫 참여 신청', status.requested], ['첫 모임 참석', false]] as const;
  const remaining = steps.filter(([, done]) => !done).length;
  return <View style={[styles.card, clayBox ? styles.clayCard : { backgroundColor: theme.card, borderColor: theme.line }]}>{clayBox && <ClayBoxFill kind="tile" />}
    <View style={styles.cardHead}>
      <ThemedText accessibilityRole="header" type="smallBold" themeColor="accent" style={styles.flex}>{newcomerDaysLeft(status) === 1 ? tr('새로 온 멤버 · 이 안내는 오늘까지예요') : tr('새로 온 멤버 · 이 안내는 {0}일 더 보여요', newcomerDaysLeft(status))}</ThemedText>
      <Pressable analyticsId="today.newcomer.hide" accessibilityRole="button" accessibilityLabel={tr('새로 온 멤버 카드 숨기기')} style={styles.link}
        onPress={() => { play('selection'); setStored(current => current && { ...current, hidden: true }); void AsyncStorage.setItem(hiddenKey(me.id), '1').catch(() => {}); }}>
        <ThemedText type="small" themeColor="textSecondary">{tr('숨기기')}</ThemedText>
      </Pressable>
    </View>
    {vancouver && !stored.arrival && <View style={styles.arrival}>
      <ThemedText accessibilityRole="header" type="smallBold">{tr('캐나다 온 지 얼마나 됐어요?')}</ThemedText>
      <View accessibilityRole="radiogroup" accessibilityLabel={tr('캐나다 온 지 얼마나 됐어요?')} style={styles.arrivalChips}>
        {ARRIVALS.map(([id, label]) => <SelectionChip key={id} analyticsId="today.newcomer.arrival" selected={false} label={tr(label)}
          accessibilityRole="radio" accessibilityState={{ checked: false }} onPress={() => answer(id)} />)}
      </View>
      <ThemedText type="caption" themeColor="textSecondary">{tr('고르면 거기에 맞는 할 일을 보여 드려요. 다른 사람한테는 안 보여요.')}</ThemedText>
    </View>}
    {vancouver && stored.arrival === 'new' && <View style={styles.arrival}>
      <ThemedText accessibilityRole="header" type="smallBold">{tr('처음 2주에 다들 하는 것')}</ThemedText>
      <ThemedText type="caption" themeColor="textSecondary">{tr('위에서부터 하나씩 끝내면 돼요. 끝낸 건 누르면 지워져요.')}</ThemedText>
      <View accessibilityRole="list">
        {FIRST_STEPS.map((step, index) => {
          const done = stored.done.includes(step.id);
          return <View key={step.id} style={[styles.firstStep, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line }]}>
            <Pressable analyticsId="today.newcomer.step" accessibilityRole="checkbox" accessibilityState={{ checked: done }} accessibilityLabel={`${tr(step.title)}, ${tr(step.body)}`}
              onPress={() => toggleStep(step.id)} style={styles.firstStepCheck}>
              <View style={[styles.tick, done ? { backgroundColor: theme.accent, borderColor: theme.accent } : { borderColor: theme.textSecondary }]}>
                {done && <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={14} tintColor={theme.accentInk} />}
              </View>
              <View style={styles.flex}>
                <ThemedText type="smallBold" themeColor={done ? 'textSecondary' : 'text'} style={done && styles.struck}>{tr(step.title)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{tr(step.body)}</ThemedText>
              </View>
            </Pressable>
            <Pressable analyticsId="today.newcomer.step-link" accessibilityRole="link" onPress={() => openStep(step)} style={styles.stepLink}>
              <ThemedText type="smallBold" themeColor="accent">{tr(step.label)}</ThemedText>
            </Pressable>
          </View>;
        })}
      </View>
    </View>}
    <View style={styles.steps} accessibilityRole="list">
      {steps.map(([label, done], index) => <View key={label} style={styles.step} accessible accessibilityLabel={`${tr(label)}, ${done ? tr('완료') : tr('아직')}`}>
        <View style={[styles.dot, done ? { backgroundColor: theme.accent } : { borderWidth: 1, borderColor: theme.textSecondary }]}>
          {done ? <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={IconSize.chevron} tintColor={theme.accentInk} />
            : <ThemedText type="smallBold" themeColor="textSecondary">{index + 1}</ThemedText>}
        </View>
        <ThemedText type="small" style={styles.stepLabel} themeColor={done ? 'text' : 'textSecondary'}>{tr(label)}</ThemedText>
      </View>)}
    </View>
    <View style={styles.next}>
      <ThemedText type="small" style={styles.flex}>{remaining === 2 ? tr('첫 모임까지 두 단계 남았어요.') : tr('첫 모임까지 한 단계 남았어요.')}</ThemedText>
      {link(tr('모임 보기 ›'))}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  clayCard: { backgroundColor: 'transparent', borderColor: 'transparent', overflow: 'visible' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  overlay: { position: 'absolute', top: 12, left: 12, right: 12 },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeClay: { paddingHorizontal: 12, paddingVertical: 4 },
  badgeText: { ...Typography.label },
  option: { gap: Spacing.two },
  optionCard: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  divider: { height: StyleSheet.hairlineWidth },
  choices: { flexDirection: 'row', gap: Spacing.two },
  choice: { flex: 1 },
  preview: { borderRadius: 12, padding: Spacing.two, gap: Spacing.two },
  card: { borderWidth: 1, borderRadius: 20, padding: Spacing.three, gap: Spacing.three, marginTop: Spacing.three },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  steps: { flexDirection: 'row', gap: Spacing.two },
  step: { flex: 1, alignItems: 'center', gap: Spacing.one },
  dot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { textAlign: 'center' },
  next: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  link: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0 },
  arrival: { gap: Spacing.two },
  arrivalChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  firstStep: { paddingVertical: Spacing.one },
  firstStepCheck: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingTop: Spacing.one },
  tick: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  struck: { textDecorationLine: 'line-through' },
  stepLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', marginLeft: 34 },
});
