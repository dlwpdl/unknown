import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScrollView } from '@/components/analytics-controls';
import { ClayBoxFill, useClayBox } from '@/components/clay';
import { InitialAvatar, ListCard, ListLoading, ListRow, SectionLabel, Tag } from '@/components/list-card';
import { SESSION_PROBLEMS } from '@/components/meetup-quest-tools';
import { InfoNote } from '@/components/notice-blocks';
import { RaisedActionButton } from '@/components/raised-action-button';
import { StateCard } from '@/components/state-card';
import { SymbolView } from '@/components/symbol-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSize, Typography } from '@/constants/design-system';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { QUEST_PERSON_REASONS, QUEST_STEP_AMOUNTS, QUEST_STEP_TAGS, QUEST_STEPS, inviteDollars, loadMyHostQuest, type HostQuest } from '@/lib/host-quests';
import { supabase } from '@/lib/supabase';

const SESSION_STEPS = [1, 2, 5, 6, 7];

/** One quest step: what it takes, and for each meetup or invitee whether they counted and why not. */
export default function HostQuestStepScreen() {
  const { step: stepParam } = useLocalSearchParams<{ step?: string }>();
  const step = Math.min(7, Math.max(1, Number(stepParam) || 1));
  const meta = QUEST_STEPS[step - 1];
  const { tr, locale } = useLanguage();
  const theme = useTheme(), clayBox = useClayBox(), router = useRouter();
  const [quest, setQuest] = useState<HostQuest | null>(null), [error, setError] = useState(false);
  useFocusEffect(useCallback(() => { loadMyHostQuest(supabase).then(value => { setQuest(value); setError(false); }, () => setError(true)); }, []));
  const date = (value: string) => new Date(value).toLocaleDateString(locale, { month: 'long', day: 'numeric' });
  const title = tr('{0}단계 · {1}', step, tr(meta.name));
  const live = quest && quest.status !== 'none' ? quest : null;
  const status = live?.steps.find(item => item.step === step) ?? null;
  const counted = live?.invitees.filter(item => item.state === 'confirmed' || item.state === 'pending').length ?? 0;
  const check = <SymbolView name={{ ios: 'checkmark.circle', android: 'check_circle', web: 'check_circle' }} size={IconSize.inline} tintColor={theme.accent} />;
  return <ThemedView style={styles.container}>
    <Stack.Screen options={{ title }} />
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView analyticsId="host-quest-step.scroll" contentContainerStyle={styles.content}>
        {error && <StateCard kind="error" title={tr('퀘스트를 불러오지 못했어요')} body={tr('잠시 후 다시 열어 주세요.')} />}
        {!quest && !error && <ListLoading label={tr('불러오는 중이에요')} />}
        {live && <>
          <View style={[styles.card, clayBox ? styles.clayCard : { backgroundColor: theme.card, borderColor: theme.line }]}>{clayBox && <ClayBoxFill kind="tile" />}
            {step === 4 ? <>
              <View style={styles.money}><ThemedText style={Typography.display}>{counted}</ThemedText><ThemedText themeColor="textSecondary" style={Typography.menu}>{tr('/ 10명')}</ThemedText></View>
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.bar, { backgroundColor: theme.backgroundElement }]}><View style={[styles.barFill, { width: `${Math.min(counted, 10) * 10}%`, backgroundColor: theme.accent }]} /></View>
              <ThemedText themeColor="textSecondary" style={Typography.supporting}>{tr('3명이 참석 확인되면 $3, 그다음부터 1명에 $1씩, 최대 $10이에요.')}</ThemedText>
              {counted > 0 && <ThemedText style={Typography.supporting}>{counted < 3 ? tr('{0}명 더 오면 돈이 쌓이기 시작해요.', 3 - counted) : tr('지금 {0}이 쌓였어요.', `$${inviteDollars(counted)}`)}</ThemedText>}
            </> : <View style={styles.amount}>
              <ThemedText style={Typography.display}>{`+$${QUEST_STEP_AMOUNTS[step - 1]}`}</ThemedText>
              {status && status.status !== 'todo' && <Tag label={tr(QUEST_STEP_TAGS[status.status])} tone={status.status === 'confirmed' ? 'accent' : 'quiet'} />}
            </View>}
            {status?.status === 'pending' && status.confirmAfter && <ThemedText themeColor="textSecondary" style={Typography.supporting}>{tr('{0}에 확정돼요.', date(status.confirmAfter))}</ThemedText>}
            {status?.status === 'held' && <ThemedText themeColor="textSecondary" style={Typography.supporting}>{tr('신고가 들어와서 운영팀이 보고 있어요. 정리되면 다시 확정돼요.')}</ThemedText>}
          </View>

          <SectionLabel>{step === 4 ? tr('이렇게 돼야 1명으로 쳐요') : tr('이렇게 돼야 이 단계를 깨요')}</SectionLabel>
          <ListCard>{meta.checks.map(line => <ListRow key={line} title={tr(line)} leading={check} />)}</ListCard>
          {(SESSION_STEPS.includes(step) || step === 4) && <InfoNote>{tr('4시간이 넘는 모임, 초대받은 사람만 보는 모임, 시작 24시간 안에 올린 모임은 퀘스트에 안 쳐요.')}</InfoNote>}

          {step === 3 && <>
            <SectionLabel>{tr('보낸 사진')}</SectionLabel>
            <ListCard><ListRow title={live.photo ? tr(live.photo.status === 'approved' ? '운영팀이 확인했어요' : live.photo.status === 'rejected' ? '운영팀이 인증하지 않았어요. 다시 찍어 주세요.' : '운영팀 확인 중') : tr('아직 안 보냈어요')}
              detail={tr('모임 중에 모임 화면에서 「모임 인증샷」을 눌러 찍어요.')} /></ListCard>
          </>}

          {step === 4 && <>
            <SectionLabel>{tr('내 코드로 온 사람')}</SectionLabel>
            {live.invitees.length === 0 ? <ListCard><ListRow title={tr('아직 없어요')} detail={tr('퀘스트를 시작한 뒤 내 초대 코드로 가입한 사람만 쳐요.')} /></ListCard>
              : <ListCard>{live.invitees.map((person, index) => {
                const counts = person.state === 'confirmed' || person.state === 'pending';
                return <ListRow key={`${person.nickname}:${index}`} title={person.nickname} leading={<InitialAvatar name={person.nickname} />}
                  detail={counts ? tr('다른 모임장 모임에서 참석 확인됐어요') : tr(QUEST_PERSON_REASONS[person.state] ?? '')}
                  trailing={counts ? <Tag label={tr(person.state === 'confirmed' ? '확정' : '확인 중')} /> : person.state === 'waiting' ? undefined : <Tag label={tr('제외')} tone="danger" />} />;
              })}</ListCard>}
            <RaisedActionButton analyticsId="host-quest-step.invite" tone="secondary" label={tr('내 초대 코드 보내기')} onPress={() => router.push('/profile/invite')} />
          </>}

          {SESSION_STEPS.includes(step) && <>
            <SectionLabel>{tr('퀘스트 기간에 연 모임')}</SectionLabel>
            {live.sessions.length === 0 && <ListCard><ListRow title={tr('아직 연 모임이 없어요')} /></ListCard>}
            {live.sessions.map(session => <View key={session.id} style={styles.session}>
              <ThemedText style={Typography.label}>{`${date(session.startsAt)} · ${session.title}`}</ThemedText>
              {session.problem && SESSION_PROBLEMS[session.problem] && <ThemedText themeColor="textSecondary" style={Typography.supporting}>{tr(SESSION_PROBLEMS[session.problem])}</ThemedText>}
              {!session.problem && <ListCard>{session.people.length === 0 ? <ListRow title={tr('체크인한 사람이 없어요')} />
                : session.people.map((person, index) => <ListRow key={`${person.nickname}:${index}`} title={person.nickname} leading={<InitialAvatar name={person.nickname} />}
                  detail={person.reason ? tr(QUEST_PERSON_REASONS[person.reason] ?? '') : tr('참석 확인됐어요')}
                  trailing={person.reason ? <Tag label={tr('제외')} tone="danger" /> : <Tag label={tr('포함')} />} />)}</ListCard>}
            </View>)}
          </>}
          <InfoNote>{tr('확인 중인 돈은 14일 동안 신고·노쇼·탈퇴·참석 취소가 없으면 확정돼요.')}</InfoNote>
        </>}
      </ScrollView>
    </SafeAreaView>
  </ThemedView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  content: { padding: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.three },
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two, borderWidth: StyleSheet.hairlineWidth },
  clayCard: { borderColor: 'transparent', overflow: 'visible' },
  money: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.one },
  amount: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden' }, barFill: { height: 8 },
  session: { gap: Spacing.one },
});
