import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScrollView } from '@/components/analytics-controls';
import { ClayBoxFill, useClayBox } from '@/components/clay';
import { KeyboardScreen } from '@/components/keyboard-screen';
import { ListCard, ListLoading, ListRow, SectionLabel, Tag } from '@/components/list-card';
import { RaisedActionButton } from '@/components/raised-action-button';
import { StateCard } from '@/components/state-card';
import { SymbolView } from '@/components/symbol-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ControlStyles, IconSize, Typography } from '@/constants/design-system';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { loadMyHostQuest, questError, requestQuestPayout, type HostQuest } from '@/lib/host-quests';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

const ERRORS: Record<string, string> = {
  INVALID_EMAIL: '이메일 주소가 맞는지 한 번 더 봐 주세요.',
  INVALID_NAME: '은행에 등록된 이름을 2자 이상 적어 주세요.',
  PAYOUT_NOT_READY: '$50이 다 확정되면 받을 수 있어요',
  PAYOUT_EMAIL_USED: '이 이메일로는 이미 다른 퀘스트 돈을 받았어요.',
  PAYOUT_LOCKED: '이미 보냈거나 보류된 요청이라 바꿀 수 없어요.',
  QUEST_ENDED: '끝난 퀘스트예요.',
  RATE_LIMITED: '너무 여러 번 보냈어요. 내일 다시 해 주세요.',
};

/** $50 payout: e-mail and bank name once everything is confirmed, then where the transfer is. */
export default function HostQuestPayoutScreen() {
  const { tr, locale } = useLanguage();
  const theme = useTheme(), clayBox = useClayBox(), { play } = useInteractionFeedback();
  const [quest, setQuest] = useState<HostQuest | null>(null), [error, setError] = useState(false);
  const [email, setEmail] = useState(''), [name, setName] = useState(''), [busy, setBusy] = useState(false), [note, setNote] = useState('');
  const working = useRef(false);
  const load = useCallback(() => { loadMyHostQuest(supabase).then(value => { setQuest(value); setError(false); }, () => setError(true)); }, []);
  useFocusEffect(load);
  const date = (value: string) => new Date(value).toLocaleDateString(locale, { month: 'long', day: 'numeric' });
  async function send() {
    if (working.current) return;
    working.current = true; setBusy(true); setNote(''); play('selection');
    try { await requestQuestPayout(supabase, email, name); play('success'); load(); }
    catch (failure) { play('warning'); setNote(ERRORS[questError(failure, Object.keys(ERRORS)) ?? ''] ?? '요청하지 못했어요. 잠시 후 다시 해 주세요.'); }
    finally { working.current = false; setBusy(false); }
  }
  const live = quest && quest.status !== 'none' ? quest : null;
  const payout = live?.payout ?? null;
  const dot = (state: 'done' | 'now' | 'next') => <SymbolView name={state === 'done' ? { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' } : state === 'now' ? { ios: 'circle.inset.filled', android: 'radio_button_checked', web: 'radio_button_checked' } : { ios: 'circle', android: 'radio_button_unchecked', web: 'radio_button_unchecked' }}
    size={IconSize.inline} tintColor={state === 'next' ? theme.textSecondary : theme.accent} />;
  return <KeyboardScreen><ThemedView style={styles.container}>
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView analyticsId="host-quest-payout.scroll" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {error && <StateCard kind="error" title={tr('퀘스트를 불러오지 못했어요')} body={tr('잠시 후 다시 열어 주세요.')} />}
        {!quest && !error && <ListLoading label={tr('불러오는 중이에요')} />}
        {quest && !live && <StateCard kind="blocked" title={tr('진행 중인 퀘스트가 없어요')} body={tr('프로필의 모임장 퀘스트에서 코드를 넣어 시작해요.')} />}
        {live && <>
          <View style={[styles.card, styles.row, clayBox ? styles.clayCard : { backgroundColor: theme.card, borderColor: theme.line }]}>{clayBox && <ClayBoxFill kind="tile" />}
            <ThemedText style={Typography.display}>{`$${Math.floor(live.confirmed / 100)}`}</ThemedText>
            {live.confirmed >= 5000 && <Tag label={tr('다 확정됐어요')} />}
          </View>
          {!payout && (live.canRequestPayout ? <View style={styles.form}>
            <ThemedText style={Typography.label}>{tr('송금 받을 이메일')}</ThemedText>
            <TextInput value={email} onChangeText={setEmail} editable={!busy} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" maxLength={254}
              accessibilityLabel={tr('송금 받을 이메일')} style={[ControlStyles.field, { color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} />
            <ThemedText style={[Typography.label, styles.gapTop]}>{tr('은행에 등록된 이름')}</ThemedText>
            <TextInput value={name} onChangeText={setName} editable={!busy} autoCapitalize="words" autoCorrect={false} autoComplete="name" textContentType="name" maxLength={80}
              accessibilityLabel={tr('은행에 등록된 이름')} style={[ControlStyles.field, { color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} />
            <ThemedText themeColor="textSecondary" style={[Typography.supporting, styles.gapTop]}>{tr('Interac e-Transfer로 보내요. 송금 전에 은행에 등록된 이름을 확인하고, 여기 적은 이름과 다르면 보내지 않아요. 이메일과 이름은 송금에만 써요.')}</ThemedText>
            <View style={styles.gapTop}><RaisedActionButton analyticsId="host-quest-payout.request" label={tr('송금 요청')} busy={busy} disabled={!email.trim() || name.trim().length < 2} onPress={() => void send()} /></View>
            {!!note && <ThemedText type="small" accessibilityRole="alert">{tr(note)}</ThemedText>}
          </View> : <StateCard layout="start" title={tr('$50이 다 확정되면 받을 수 있어요')} body={tr('확인 중인 돈은 14일 동안 신고·노쇼·탈퇴·참석 취소가 없으면 확정돼요.')} />)}
          {payout && <>
            <SectionLabel>{tr('진행 상황')}</SectionLabel>
            <ListCard>
              <ListRow title={tr('확정 $50')} detail={tr('14일 동안 신고·노쇼 같은 문제가 없었어요')} leading={dot('done')} />
              <ListRow title={tr('송금 요청')} detail={[date(payout.requestedAt), payout.email].filter(Boolean).join(' · ')} leading={dot('done')} />
              {payout.status === 'held'
                ? <ListRow title={tr('보류')} detail={tr('운영팀이 확인할 게 있어서 잠시 멈췄어요. 운영팀 메시지를 봐 주세요.')} leading={dot('now')} />
                : <ListRow title={tr('운영팀 확인')} detail={tr('세 모임 참석자와 사진을 보고 있어요')} leading={dot(payout.status === 'sent' ? 'done' : 'now')} />}
              <ListRow title={tr('보냄')} leading={dot(payout.status === 'sent' ? 'done' : 'next')}
                detail={payout.status === 'sent' && payout.sentAt ? tr('{0} · 이체 번호 끝 {1}', date(payout.sentAt), payout.transferLast4 ?? '') : tr('보내면 보낸 날과 이체 번호 끝 4자리가 여기 떠요')} />
            </ListCard>
          </>}
        </>}
      </ScrollView>
    </SafeAreaView>
  </ThemedView></KeyboardScreen>;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  content: { padding: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.three },
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two, borderWidth: StyleSheet.hairlineWidth },
  clayCard: { borderColor: 'transparent', overflow: 'visible' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  form: { gap: Spacing.one },
  gapTop: { marginTop: Spacing.two },
});
