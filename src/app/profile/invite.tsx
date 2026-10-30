import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { GlingLoader } from '@/components/gling-loader';
import { InviteStats, rewardName, useInviteShare } from '@/components/invite-parts';
import { LoginPanel } from '@/components/login-panel';
import { InfoNote } from '@/components/notice-blocks';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ControlStyles, Typography } from '@/constants/design-system';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { claimInviteCode, createInviteLink, inviteUrl, loadMyInvite, normalizeInviteCode, rewardWeeks, type InviteSummary } from '@/lib/invites';
import { useMembership } from '@/lib/membership-provider';
import { supabase } from '@/lib/supabase';

const claimMessages: Record<string, string> = {
  linked: '초대가 연결됐어요. 첫 모임에 다녀오면 초대한 분이 이용권을 받아요.',
  INVITE_NOT_FOUND: '없는 코드예요. 받은 코드를 한 번 더 봐 주세요.',
  INVITE_ALREADY_LINKED: '이미 다른 초대가 연결돼 있어요.',
  INVITE_SELF: '내 초대 코드는 넣을 수 없어요.',
  INVITE_TOO_LATE: '가입하고 7일이 지났거나 이미 첫 모임에 다녀와서 연결할 수 없어요.',
};

export default function InviteScreen() {
  const { tr, locale } = useLanguage();
  const theme = useTheme(), auth = useAuth(), { play } = useInteractionFeedback();
  const { refresh: refreshMembership } = useMembership();
  const share = useInviteShare();
  const [state, setState] = useState<{ userId: string; value: InviteSummary } | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [code, setCode] = useState(''), [claimNote, setClaimNote] = useState('');
  const working = useRef(false);
  const summary = state?.userId === auth.me.id ? state.value : null;
  const load = useCallback(() => {
    if (!auth.isAuthed) return;
    const userId = auth.me.id;
    loadMyInvite(supabase).then(value => { setState({ userId, value }); setError(''); },
      () => setError('초대 정보를 불러오지 못했어요. 잠시 후 다시 열어 주세요.'));
  }, [auth.isAuthed, auth.me.id]);
  useFocusEffect(load);

  const run = async (operation: () => Promise<void>) => {
    if (working.current) return;
    working.current = true; setBusy(true);
    try { await operation(); } finally { working.current = false; setBusy(false); }
  };
  const date = (value: string) => new Date(value).toLocaleDateString(locale, { month: 'long', day: 'numeric' });
  const sendLink = (value: string) => share(tr('글링에서 같이 모임 나가요. 이 링크로 가입하면 돼요.'), inviteUrl(value));

  if (auth.isAuthLoading) return <GlingLoader color={theme.accent} style={styles.flex} accessibilityLabel={tr('로그인 확인 중')} />;
  if (!auth.isAuthed) return <LoginPanel reason="친구를 초대하려면 로그인해 주세요." onApple={auth.signInApple} onKakao={auth.signInKakao} onGoogle={auth.signInGoogle} onDevLogin={auth.signInDev} loading={auth.isAuthLoading} error={auth.authError} />;

  return <ThemedView style={styles.container}>
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView analyticsId="invite.scroll" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { backgroundColor: theme.card }]}>
          <ThemedText accessibilityRole="header" style={Typography.section}>{tr('친구가 첫 모임에 오면\n플러스 2주 이용권을 드려요')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{tr('모임을 열어 본 호스트가 친구를 데려오면 프로 2주 이용권이에요. 친구는 가입하는 날부터 새 멤버 혜택을 받아요.')}</ThemedText>
          {!!error && <ThemedText type="small" accessibilityRole="alert">{tr(error)}</ThemedText>}
          {summary && (summary.code
            ? <>
              <View style={[styles.codeBox, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="small" themeColor="textSecondary">{tr('내 초대 코드')}</ThemedText>
                <ThemedText selectable style={styles.code}>{summary.code}</ThemedText>
              </View>
              <RaisedActionButton analyticsId="invite.share" label={tr('링크 보내기')} disabled={busy} onPress={() => { play('selection'); void sendLink(summary.code!); }} />
            </>
            : <RaisedActionButton analyticsId="invite.create" label={tr('초대 링크 만들기')} busy={busy} onPress={() => { play('selection'); void run(async () => {
              try {
                const created = await createInviteLink(supabase);
                setState({ userId: auth.me.id, value: { ...summary, code: created } });
                await sendLink(created);
              } catch { play('warning'); setError('초대 링크를 만들지 못했어요. 잠시 후 다시 시도해 주세요.'); }
            }); }} />)}
        </View>

        {summary && <>
          <InviteStats items={[[tr('가입한 친구'), summary.joined], [tr('첫 모임 다녀옴'), summary.rewarded], [tr('기다리는 중'), summary.waiting]]} />
          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <ThemedText type="smallBold" accessibilityRole="header">{tr('받은 이용권')}</ThemedText>
            {summary.rewards.length === 0
              ? <ThemedText type="small" themeColor="textSecondary">{tr('아직 받은 이용권이 없어요.')}</ThemedText>
              : summary.rewards.map(reward => <View key={reward.startsAt} style={[styles.reward, { borderTopColor: theme.line }]}>
                <ThemedText type="smallBold" style={styles.flex}>{rewardName(reward, false, tr)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{tr('{0} ~ {1}', date(reward.startsAt), date(reward.endsAt))}</ThemedText>
              </View>)}
            {summary.activeUntil && <ThemedText type="small" themeColor="accent">{tr('지금 쓰는 이용권은 {0}까지예요.', date(summary.activeUntil))}</ThemedText>}
            <ThemedText type="small" themeColor="textSecondary">{tr('이용권은 합쳐서 8주까지 받을 수 있어요. 지금 {0}주 받았어요.', rewardWeeks(summary.grantedDays))}</ThemedText>
          </View>

          {summary.canEnterCode && <View style={[styles.card, { backgroundColor: theme.card }]}>
            <ThemedText type="smallBold" accessibilityRole="header">{tr('초대 코드 넣기')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{tr('초대받아 가입했다면 7일 안에 코드를 넣어 주세요.')}</ThemedText>
            <View style={styles.row}>
              <TextInput value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} maxLength={80}
                placeholder={tr('코드 8자리')} placeholderTextColor={theme.textSecondary} accessibilityLabel={tr('초대 코드')}
                style={[ControlStyles.field, styles.flex, { color: theme.text, borderColor: theme.line, backgroundColor: theme.background }]} />
              <Pressable analyticsId="invite.code.submit" accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} disabled={busy}
                onPress={() => { play('selection'); void run(async () => {
                  const value = normalizeInviteCode(code);
                  if (!value) { play('warning'); setClaimNote('코드 8자리를 확인해 주세요.'); return; }
                  try {
                    const result = await claimInviteCode(supabase, value);
                    play(result === 'linked' ? 'success' : 'warning'); setClaimNote(claimMessages[result]);
                    if (result === 'linked') { setCode(''); load(); void refreshMembership(); }
                  } catch { play('warning'); setClaimNote('코드를 넣지 못했어요. 잠시 후 다시 시도해 주세요.'); }
                }); }}
                style={({ pressed }) => [ControlStyles.pill, { backgroundColor: theme.backgroundElement, opacity: busy ? 0.45 : pressed ? 0.82 : 1 }]}>
                <ThemedText type="smallBold" themeColor="accent">{tr('코드 연결')}</ThemedText>
              </Pressable>
            </View>
            {!!claimNote && <ThemedText type="small" accessibilityLiveRegion="polite">{tr(claimNote)}</ThemedText>}
          </View>}

          <View style={styles.notes}>
            <InfoNote>{tr('이용권은 정해진 기간 동안만 쓸 수 있어요. 기간이 끝나도 결제되지 않아요.')}</InfoNote>
            <InfoNote>{tr('같은 기기나 같은 이메일·전화번호로 가입한 친구는 한 번만 인정돼요.')}</InfoNote>
            <InfoNote>{tr('유료 멤버십 등급이 더 높으면 그 등급을 그대로 써요.')}</InfoNote>
          </View>
        </>}
        {!summary && !error && <GlingLoader color={theme.accent} accessibilityLabel={tr('초대 정보 불러오는 중')} />}
      </ScrollView>
    </SafeAreaView>
  </ThemedView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  content: { padding: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.three },
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  codeBox: { borderRadius: 12, padding: Spacing.three, gap: 2, alignItems: 'center' },
  code: { fontSize: 24, lineHeight: 32, fontWeight: '700', letterSpacing: 3 },
  reward: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  notes: { gap: Spacing.one },
  flex: { flex: 1, minWidth: 0 },
});
