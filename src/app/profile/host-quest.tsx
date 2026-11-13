import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { ClayBoxFill, useClayBox } from '@/components/clay';
import { KeyboardScreen } from '@/components/keyboard-screen';
import { ListCard, ListLoading, ListRow, SectionLabel, Tag } from '@/components/list-card';
import { LoginPanel } from '@/components/login-panel';
import { InfoNote } from '@/components/notice-blocks';
import { RaisedActionButton } from '@/components/raised-action-button';
import { PopIn, StateCard } from '@/components/state-card';
import { SymbolView } from '@/components/symbol-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ControlStyles, Typography } from '@/constants/design-system';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { QUEST_STEP_AMOUNTS, QUEST_STEP_TAGS, QUEST_STEPS, daysLeft, dollars, inviteDollars, loadMyHostQuest, normalizeQuestCode, questError, startHostQuest, type HostQuest } from '@/lib/host-quests';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

const START_ERRORS: Record<string, string> = {
  QUEST_CODE_NOT_FOUND: '없는 코드이거나 이미 쓴 코드예요. 받은 코드를 한 번 더 봐 주세요.',
  QUEST_ALREADY_USED: '퀘스트는 한 사람당 한 번만 할 수 있어요. 이 계정이나 내 다른 계정으로 이미 했어요.',
  QUEST_PAUSED: '지금은 운영팀이 새 퀘스트 시작을 잠시 멈췄어요.',
  QUEST_NOT_AVAILABLE: '이 계정으로는 퀘스트를 할 수 없어요.',
  RATE_LIMITED: '너무 여러 번 넣었어요. 내일 다시 해 주세요.',
};
const RULES = [
  '한 사람당 평생 한 번, 최대 $20이에요. 다른 계정으로 이미 했다면 이 계정으로는 못 해요.',
  '$20이 다 확정되면 Interac e-Transfer로 한 번에 보내 드려요.',
  '시작한 날부터 60일 안에 $20을 채워야 해요. 못 채우면 모은 만큼 멤버십 이용권으로 바뀌어요.',
  '부정행위가 확인되면 적립이 취소돼요. 퀘스트는 운영팀이 언제든 끝낼 수 있어요.',
  '현금은 캐나다에 사는 분만 받을 수 있어요.',
];

export default function HostQuestScreen() {
  const { tr } = useLanguage();
  const theme = useTheme(), auth = useAuth();
  const [state, setState] = useState<{ userId: string; value: HostQuest } | null>(null), [error, setError] = useState('');
  const quest = state?.userId === auth.me.id ? state.value : null;
  const load = useCallback(() => {
    if (!auth.isAuthed) return;
    const userId = auth.me.id;
    loadMyHostQuest(supabase).then(value => { setState({ userId, value }); setError(''); }, () => setError('퀘스트를 불러오지 못했어요. 잠시 후 다시 열어 주세요.'));
  }, [auth.isAuthed, auth.me.id]);
  useFocusEffect(load);

  if (auth.isAuthLoading) return <ListLoading label={tr('로그인 확인 중')} />;
  if (!auth.isAuthed) return <LoginPanel reason="모임장 퀘스트를 보려면 로그인해 주세요." onApple={auth.signInApple} onKakao={auth.signInKakao} onGoogle={auth.signInGoogle} onDevLogin={auth.signInDev} loading={auth.isAuthLoading} error={auth.authError} />;
  return <KeyboardScreen><ThemedView style={styles.container}>
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView analyticsId="host-quest.scroll" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!!error && <StateCard kind="error" title={tr('퀘스트를 불러오지 못했어요')} body={tr(error)} actionLabel={tr('다시 불러오기')} onAction={load} />}
        {!quest && !error && <ListLoading label={tr('불러오는 중이에요')} />}
        {quest?.status === 'none' && (quest.accepting ? <StartQuest onStarted={load} />
          : <StateCard kind="pending" title={tr('지금은 새로 시작할 수 없어요')} body={tr('운영팀이 새 퀘스트 시작을 잠시 멈췄어요.')} />)}
        {quest && quest.status !== 'none' && <QuestHome quest={quest} accent={theme.accent} />}
      </ScrollView>
    </SafeAreaView>
  </ThemedView></KeyboardScreen>;
}

function StartQuest({ onStarted }: { onStarted: () => void }) {
  const { tr } = useLanguage();
  const theme = useTheme(), clayBox = useClayBox(), { play } = useInteractionFeedback();
  const [code, setCode] = useState(''), [agreed, setAgreed] = useState(false), [busy, setBusy] = useState(false), [note, setNote] = useState('');
  const working = useRef(false);
  const value = normalizeQuestCode(code);
  async function start() {
    if (working.current || !value || !agreed) return;
    working.current = true; setBusy(true); setNote(''); play('selection');
    try { await startHostQuest(supabase, value); play('success'); onStarted(); }
    catch (failure) { play('warning'); setNote(START_ERRORS[questError(failure, Object.keys(START_ERRORS)) ?? ''] ?? '퀘스트를 시작하지 못했어요. 잠시 후 다시 해 주세요.'); }
    finally { working.current = false; setBusy(false); }
  }
  return <View style={styles.stack}>
    <View style={styles.head}>
      <ThemedText accessibilityRole="header" style={Typography.section}>{tr('운영팀에서 받은 코드를 넣어 주세요')}</ThemedText>
      <ThemedText themeColor="textSecondary" style={Typography.supporting}>{tr('8자리 코드예요. 코드 하나는 한 계정만 쓸 수 있어요.')}</ThemedText>
    </View>
    <View style={styles.field}>
      <ThemedText style={Typography.label}>{tr('퀘스트 코드')}</ThemedText>
      <TextInput value={code} onChangeText={next => { setCode(next); setNote(''); }} autoCapitalize="characters" autoCorrect={false} autoComplete="off" maxLength={12} editable={!busy}
        placeholder={tr('코드 8자리')} placeholderTextColor={theme.textSecondary} accessibilityLabel={tr('퀘스트 코드')}
        style={[ControlStyles.field, styles.code, { color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} />
    </View>
    <SectionLabel>{tr('시작하기 전에 읽어 주세요')}</SectionLabel>
    <View style={[styles.card, clayBox ? styles.clayCard : { backgroundColor: theme.card, borderColor: theme.line }]}>{clayBox && <ClayBoxFill kind="tile" />}
      {RULES.map(rule => <InfoNote key={rule}>{tr(rule)}</InfoNote>)}
    </View>
    <Pressable analyticsId="host-quest.agree" accessibilityRole="checkbox" accessibilityState={{ checked: agreed, disabled: busy }} aria-checked={agreed} disabled={busy}
      onPress={() => { play('selection'); setAgreed(on => !on); }} style={({ pressed }) => [styles.agree, { opacity: busy ? 0.45 : pressed ? 0.82 : 1 }]}>
      <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.checkbox, agreed ? { borderColor: theme.accent, backgroundColor: theme.accent } : { borderColor: theme.textSecondary }]}>
        {agreed && <PopIn><SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={13} tintColor={theme.accentInk} /></PopIn>}
      </View>
      <ThemedText type="smallBold" style={styles.flex}>{tr('읽었고 동의해요')}</ThemedText>
    </Pressable>
    <RaisedActionButton analyticsId="host-quest.start" label={tr('퀘스트 시작하기')} busy={busy} disabled={!value || !agreed} onPress={() => void start()} />
    {!!note && <ThemedText type="small" accessibilityRole="alert">{tr(note)}</ThemedText>}
  </View>;
}

function QuestHome({ quest, accent }: { quest: Extract<HostQuest, { startedAt: string }>; accent: string }) {
  const { tr } = useLanguage();
  const theme = useTheme(), clayBox = useClayBox(), router = useRouter();
  const [now] = useState(() => Date.now());
  const total = quest.confirmed + quest.pending;
  const counted = quest.invitees.filter(item => item.state === 'confirmed' || item.state === 'pending').length;
  const ended = quest.status !== 'active';
  return <View style={styles.stack}>
    {quest.status === 'paid' && <StateCard layout="start" mark="check" title={tr('$20을 보냈어요')} body={tr('퀘스트를 끝까지 해 주셔서 고마워요.')} />}
    {quest.status === 'converted' && <StateCard layout="start" title={tr('퀘스트가 끝났어요')} body={quest.convertedDays > 0 ? tr('모은 금액을 멤버십 이용권 {0}일로 바꿨어요.', quest.convertedDays) : tr('확정된 금액이 없어 이용권으로 바꿀 게 없었어요.')} />}
    {quest.status === 'ended' && <StateCard layout="start" title={tr('퀘스트가 끝났어요')} body={tr('궁금한 점은 운영팀 메시지로 물어봐 주세요.')} />}
    <View style={[styles.card, clayBox ? styles.clayCard : { backgroundColor: theme.card, borderColor: theme.line }]}>{clayBox && <ClayBoxFill kind="tile" />}
      <View accessible accessibilityLabel={tr('$20 중 {0} 모였어요', dollars(total))} style={styles.money}>
        <ThemedText style={Typography.display}>{dollars(total)}</ThemedText>
        <ThemedText themeColor="textSecondary" style={Typography.menu}>/ $20</ThemedText>
      </View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.bar, { backgroundColor: theme.backgroundElement }]}>
        <View style={[styles.barPart, { width: `${quest.confirmed / 20}%`, backgroundColor: accent }]} />
        <View style={[styles.barPart, styles.pendingPart, { width: `${quest.pending / 20}%`, backgroundColor: accent }]} />
      </View>
      <View style={styles.legend}>
        <ThemedText style={Typography.supporting}>{tr('확정 {0}', dollars(quest.confirmed))}</ThemedText>
        {quest.pending > 0 && <ThemedText themeColor="textSecondary" style={Typography.supporting}>{tr('확인 중 {0}', dollars(quest.pending))}</ThemedText>}
        {!ended && <ThemedText themeColor="accent" style={[Typography.supporting, styles.right]}>{tr('{0}일 남았어요', daysLeft(quest.endsAt, now))}</ThemedText>}
      </View>
    </View>
    <SectionLabel>{tr('단계')}</SectionLabel>
    <ListCard>{QUEST_STEPS.map((step, index) => {
      const status = quest.steps.find(item => item.step === index + 1)?.status ?? 'todo';
      const amount = index === 3 ? (counted ? `+$${inviteDollars(counted)}/$3` : '+$3') : `+$${QUEST_STEP_AMOUNTS[index]}`;
      return <ListRow key={step.name} analyticsId="host-quest.step" title={tr('{0}단계 · {1}', index + 1, tr(step.name))} detail={tr(step.home)}
        leading={<View style={[styles.num, { backgroundColor: status === 'confirmed' ? accent : theme.backgroundElement }]}>
          {status === 'confirmed' ? <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={13} tintColor={theme.accentInk} /> : <ThemedText style={Typography.label}>{index + 1}</ThemedText>}
        </View>}
        trailing={<View style={styles.trail}><ThemedText style={Typography.label} themeColor={status === 'todo' ? 'textSecondary' : undefined}>{amount}</ThemedText>{status !== 'todo' && <Tag label={tr(QUEST_STEP_TAGS[status])} tone={status === 'confirmed' ? 'accent' : 'quiet'} />}</View>}
        onPress={() => router.push({ pathname: '/profile/host-quest-step', params: { step: String(index + 1) } })} />;
    })}</ListCard>
    {!ended && <View style={styles.cash}>
      <RaisedActionButton analyticsId="host-quest.payout" label={quest.payout ? tr('송금 진행 상황') : tr('$20 받기')} disabled={!quest.payout && !quest.canRequestPayout} onPress={() => router.push('/profile/host-quest-payout')} />
      {!quest.payout && !quest.canRequestPayout && <ThemedText themeColor="textSecondary" style={[Typography.supporting, styles.center]}>{tr('$20이 다 확정되면 받을 수 있어요')}</ThemedText>}
    </View>}
    <InfoNote>{tr('확인 중인 돈은 14일 동안 신고·노쇼·탈퇴·참석 취소가 없으면 확정돼요.')}</InfoNote>
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  content: { padding: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.three },
  stack: { gap: Spacing.three },
  head: { gap: Spacing.one },
  field: { gap: Spacing.one },
  code: { fontSize: 20, lineHeight: 28, fontWeight: '700', letterSpacing: 3 },
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two, borderWidth: StyleSheet.hairlineWidth },
  clayCard: { borderColor: 'transparent', overflow: 'visible' },
  agree: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  checkbox: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 6 },
  money: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.one },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden', flexDirection: 'row' },
  barPart: { height: 8 }, pendingPart: { opacity: 0.35 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.three, rowGap: Spacing.one },
  right: { marginLeft: 'auto' },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  trail: { alignItems: 'flex-end', gap: 2 },
  cash: { gap: Spacing.one },
  center: { textAlign: 'center' },
  flex: { flex: 1, minWidth: 0 },
});
