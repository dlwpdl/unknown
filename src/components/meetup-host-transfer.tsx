import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, DeviceEventEmitter, Platform, StyleSheet, View } from 'react-native';
import { ClayBoxFill, useClayBox } from '@/components/clay';
import { GlingLoader } from '@/components/gling-loader';
import { InitialAvatar, ListCard, ListRow, SectionLabel } from '@/components/list-card';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { Typography } from '@/constants/design-system';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { CHILLING_HOST_CONSENT_VERSION, loadChillingProfile, type ChillingProfile } from '@/lib/chilling-data';
import { MEETUPS_CHANGED_EVENT } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadMeetupHostRoster, loadMeetupRoster, type MeetupHostIdentity } from '@/lib/meetup-host-tools';
import { cancelMeetupHostTransfer, hostTransferErrorText, loadMeetupHostTransfer, offerMeetupHostTransfer, respondMeetupHostTransfer, transferDaysLeft, type MeetupHostTransferState } from '@/lib/meetup-host-transfer';
import { supabase } from '@/lib/supabase';

/**
 * Hand a meetup to another approved member (host side) and answer such an offer (receiver side).
 * Renders nothing for everyone else, so it can sit on any meetup screen. The server decides who may do what.
 * host: only the host's side (the settings screen); receiver: only the offer card; both is the default.
 */
export function MeetupHostTransfer({ postId, side = 'both', onChanged }: { postId: string; side?: 'host' | 'receiver' | 'both'; onChanged?: () => void }) {
  const { isAuthed, me } = useAuth();
  return isAuthed ? <Transfer key={`${me.id}:${postId}`} postId={postId} side={side} onChanged={onChanged} /> : null;
}

type Notice = 'offered' | 'cancelled' | 'accepted' | 'declined';

function Transfer({ postId, side, onChanged }: { postId: string; side: 'host' | 'receiver' | 'both'; onChanged?: () => void }) {
  const { tr } = useLanguage(), theme = useTheme(), clayBox = useClayBox(), { play } = useInteractionFeedback();
  const [state, setState] = useState<MeetupHostTransferState | null>(null), [names, setNames] = useState<Map<string, string>>(new Map());
  const [profile, setProfile] = useState<ChillingProfile | null>(null), [profileFailed, setProfileFailed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState<Notice | null>(null), [retry, setRetry] = useState(0);
  const active = useRef(true), working = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const next = await loadMeetupHostTransfer(supabase, postId);
        if (!live) return;
        setState(next);
        if (next.isHost && next.candidates?.length) {
          const [identities, members] = await Promise.all([loadMeetupHostRoster(supabase, postId).catch(() => []), loadMeetupRoster(supabase, postId).catch(() => [])]);
          const map = new Map<string, string>(members.map(member => [member.userId, member.nickname]));
          for (const person of identities as MeetupHostIdentity[]) if (person.displayName) map.set(person.userId, person.displayName);
          if (live) setNames(map);
        }
        if (!next.isHost && next.offer) {
          // The receiver sees exactly what will be published as the host introduction.
          try { const mine = await loadChillingProfile(supabase, 'hosting'); if (live) { setProfile(mine); setProfileFailed(false); } } catch { if (live) setProfileFailed(true); }
        }
      } catch { if (live) setState(null); }
    })();
    return () => { live = false; };
  }, [postId, retry]);

  const run = useCallback(async (work: () => Promise<unknown>, done: Notice) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError(''); setNotice(null); play('selection');
    try {
      await work();
      if (!active.current) return;
      setNotice(done); play('success'); setRetry(value => value + 1); onChanged?.();
      DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT);
    } catch (failure) {
      if (active.current) { play('warning'); setError(tr(hostTransferErrorText(failure) ?? '처리하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.')); }
    } finally { working.current = false; if (active.current) setBusy(false); }
  }, [onChanged, play, tr]);

  const confirm = (title: string, message: string, action: string, go: () => void) => {
    play('selection');
    if (Platform.OS === 'web') { if (globalThis.confirm(`${title}\n\n${message}`)) go(); return; }
    Alert.alert(title, message, [{ text: tr('돌아가기'), style: 'cancel' }, { text: action, onPress: go }]);
  };

  const noticeText = notice === 'offered' ? tr('제안을 보냈어요. 상대가 수락하면 호스트가 바뀌어요.') : notice === 'cancelled' ? tr('제안을 취소했어요.')
    : notice === 'accepted' ? tr('호스트를 넘겨받았어요.') : notice === 'declined' ? tr('제안을 거절했어요.') : '';
  const status = <>
    {!!error && <ThemedText type="small" accessibilityRole="alert" themeColor="danger" style={styles.helper}>{error}</ThemedText>}
    {!!noticeText && <ThemedText type="small" accessibilityLiveRegion="polite" themeColor="textSecondary" style={styles.helper}>{noticeText}</ThemedText>}
  </>;
  const card = (children: React.ReactNode) => <View style={[styles.panel, clayBox ? styles.clayCard : { backgroundColor: theme.card, borderColor: theme.line }]}>{clayBox && <ClayBoxFill kind="tile" />}{children}</View>;
  const left = (expiresAt: string) => { const days = transferDaysLeft(expiresAt); return days <= 1 ? tr('오늘 안에 답이 없으면 제안이 닫혀요') : tr('{0}일 안에 답이 없으면 제안이 닫혀요', days); };

  if (!state) return null;

  if (state.offer) {
    if (side === 'host') return null;
    const offer = state.offer;
    const blocked = offer.blocker === 'TRANSFER_CAPACITY_EXCEEDED' ? tr('이 모임 정원은 {0}명인데 내 한도는 {1}명이라 넘겨받을 수 없어요.', offer.capacity ?? 0, offer.seatLimit)
      : offer.blocker ? tr(hostTransferErrorText(new Error(offer.blocker)) ?? '지금은 넘겨받을 수 없어요.') : '';
    // A profile without photos loaded still publishes; only a failed read of what will be shown stops the answer.
    const ready = !blocked && !busy && !!profile && !profileFailed;
    return card(<>
      <ThemedText type="smallBold" accessibilityRole="header">{tr('{0}님이 호스트를 넘기고 싶어 해요', offer.hostName)}</ThemedText>
      <ThemedText type="small" style={styles.body}>{tr('수락하면 내가 이 모임의 호스트가 돼요. 신청 승인, 회차, 공지는 내가 맡고, {0}님은 멤버로 남아요.', offer.hostName)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{left(offer.expiresAt)}</ThemedText>
      {!!profile && <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr('호스트 소개로 이렇게 보여요: {0}', [profile.displayName, profile.intro].filter(Boolean).join(' · '))}</ThemedText>}
      {profileFailed && <ThemedText type="small" themeColor="danger" accessibilityRole="alert" style={styles.helper}>{tr('모임 프로필을 불러오지 못했어요. 다시 시도해 주세요.')}</ThemedText>}
      {!!blocked && <ThemedText type="small" themeColor="danger" accessibilityRole="alert" style={styles.helper}>{blocked}</ThemedText>}
      <RaisedActionButton analyticsId="meetup.transfer.accept" label={tr('넘겨받기')} busy={busy} disabled={!ready}
        onPress={() => void run(() => respondMeetupHostTransfer(supabase, postId, true, { consentVersion: CHILLING_HOST_CONSENT_VERSION, profileRevision: profile?.revision ?? null }), 'accepted')} />
      <RaisedActionButton analyticsId="meetup.transfer.decline" tone="secondary" label={tr('거절')} disabled={busy}
        onPress={() => void run(() => respondMeetupHostTransfer(supabase, postId, false), 'declined')} />
      {status}
    </>);
  }

  if (!state.isHost || side === 'receiver') return notice && side !== 'host' ? card(status) : null;
  if (!state.available) return null;

  const pending = state.pending, candidates = state.candidates ?? [];
  const nameOf = (id: string) => names.get(id) || tr('모임 멤버');
  return <View>
    <SectionLabel>{tr('호스트 넘기기')}</SectionLabel>
    <ThemedText type="small" themeColor="textSecondary" style={styles.helperGap}>{tr('멤버 한 명에게 이 모임을 넘길 수 있어요. 상대가 수락하면 호스트가 바뀌고, 나는 멤버로 남아요. 수락하기 전까지는 내가 계속 호스트예요.')}</ThemedText>
    {pending ? card(<>
      <ThemedText type="smallBold">{tr('{0}님의 답을 기다려요', nameOf(pending.toUserId))}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{left(pending.expiresAt)}</ThemedText>
      <RaisedActionButton analyticsId="meetup.transfer.cancel" tone="secondary" label={tr('제안 취소')} disabled={busy} onPress={() => void run(() => cancelMeetupHostTransfer(supabase, postId), 'cancelled')} />
    </>)
      : candidates.length ? <ListCard>{candidates.map(candidate => {
        const name = nameOf(candidate.userId);
        const why = candidate.blocker === 'TRANSFER_CAPACITY_EXCEEDED' ? tr('정원이 상대 한도보다 커요') : candidate.blocker ? tr(hostTransferErrorText(new Error(candidate.blocker)) ?? '지금은 넘길 수 없어요.') : undefined;
        return <ListRow key={candidate.userId} title={name} detail={why} leading={<InitialAvatar name={name} />}
          trailing={<RaisedActionButton compact analyticsId="meetup.transfer.pick" label={tr('넘기기')} disabled={busy || !!candidate.blocker}
            onPress={() => confirm(tr('{0}님에게 호스트를 넘길까요?', name), tr('상대가 수락하면 호스트 권한이 옮겨 가요. 아직 수락하지 않았다면 내가 계속 호스트예요.'), tr('제안 보내기'),
              () => void run(() => offerMeetupHostTransfer(supabase, postId, candidate.userId), 'offered'))} />} />;
      })}</ListCard>
        : <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr('넘길 수 있는 멤버가 아직 없어요. 승인된 멤버가 생기면 여기서 넘길 수 있어요.')}</ThemedText>}
    {busy && <GlingLoader color={theme.accent} accessibilityLabel={tr('처리 중')} />}
    {status}
  </View>;
}

const styles = StyleSheet.create({
  panel: { padding: 16, borderRadius: 16, borderWidth: 1, gap: 12 },
  clayCard: { backgroundColor: 'transparent', borderColor: 'transparent', overflow: 'visible' },
  body: { ...Typography.body },
  helper: { fontSize: 14, lineHeight: 22 }, helperGap: { fontSize: 14, lineHeight: 22, marginBottom: 8 },
});
