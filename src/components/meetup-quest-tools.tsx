import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ClayBoxFill, useClayBox } from '@/components/clay';
import { ListCard, ListLoading, ListRow, Tag } from '@/components/list-card';
import { RaisedActionButton } from '@/components/raised-action-button';
import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { loadCheckInQr, loadMyHostQuest, qrRuns, questError, sendQuestPhoto, type CheckInQr, type HostQuest } from '@/lib/host-quests';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { preparePostImage } from '@/lib/post-image-picker';
import { supabase } from '@/lib/supabase';

/** Why a meetup does not count toward the quest, in one line. */
export const SESSION_PROBLEMS: Record<string, string> = {
  too_long: '4시간이 넘는 모임이라 퀘스트에 안 쳐요.',
  invite_only: '초대받은 사람만 보는 모임이라 퀘스트에 안 쳐요.',
  late_notice: '시작 24시간 전까지 올린 모임만 퀘스트에 쳐요.',
  outside_quest: '퀘스트 기간 밖의 모임이에요.',
  before_quest: '퀘스트 기간 밖의 모임이에요.',
};
const PHOTO_WINDOW_MS = 30 * 60 * 1000;

/** Host rows on the live session: the rotating QR while it runs (every host: quest invitees count only with a QR check-in), and for quest hosts the group photo until 30 minutes after. */
export function MeetupQuestRows({ postId, kind, sessionId, startsAt, endsAt, now }: { postId: string; kind: 'once' | 'group'; sessionId: string; startsAt: string; endsAt: string; now: number }) {
  const { tr } = useLanguage();
  const router = useRouter();
  const [quest, setQuest] = useState<HostQuest | null>(null);
  const start = Date.parse(startsAt), end = Date.parse(endsAt);
  const open = now >= start && now < end + PHOTO_WINDOW_MS;
  useEffect(() => {
    if (!open) return;
    let active = true;
    loadMyHostQuest(supabase).then(value => { if (active) setQuest(value); }, () => {});
    return () => { active = false; };
  }, [open, sessionId]);
  const active = quest?.status === 'active' ? quest : null;
  const session = active?.sessions.find(item => item.id === sessionId);
  const photo = !!session && !session.problem;
  if (!open || (now >= end && !photo)) return null;
  const go = (section: string) => router.push({ pathname: '/meetup-tools', params: { postId, kind, host: '1', section, sessionId } });
  const photoSent = active?.photo && active.photo.status !== 'rejected';
  return <View style={styles.rows}><ListCard>
    {now < end && <ListRow analyticsId="meetup.quest.qr" title={tr('체크인 QR')} detail={tr('참석자가 폰 카메라로 찍어요')} onPress={() => go('checkin-qr')} />}
    {photo && <ListRow analyticsId="meetup.quest.photo" title={tr('모임 인증샷')} detail={photoSent ? tr('보냈어요') : tr('운영팀 확인용 단체 사진 1장')}
      trailing={photoSent ? <Tag label={active?.photo?.status === 'approved' ? tr('확정') : tr('확인 중')} /> : undefined} onPress={photoSent ? undefined : () => go('quest-photo')} />}
  </ListCard></View>;
}

/** The host's rotating check-in QR. A new code every 15 seconds; each code works once. The drawing is fixed black on white so any phone camera reads it in dark mode too. */
export function MeetupCheckInQr({ sessionId }: { sessionId: string }) {
  const { tr } = useLanguage();
  const theme = useTheme(), clayBox = useClayBox(), { width } = useWindowDimensions();
  const [qr, setQr] = useState<CheckInQr | null>(null), [error, setError] = useState(''), [now, setNow] = useState(() => Date.now());
  const loading = useRef(false), closed = useRef(false);
  useEffect(() => {
    let active = true;
    const load = () => {
      if (loading.current || closed.current) return;
      loading.current = true;
      loadCheckInQr(supabase, sessionId).then(value => { if (active) { setQr(value); setError(''); } }, failure => {
        if (!active) return;
        const code = questError(failure, ['CHECK_IN_CLOSED', 'SESSION_NOT_FOUND']);
        if (code) closed.current = true;
        setError(code ?? 'NETWORK');
      }).finally(() => { loading.current = false; });
    };
    load();
    // Asks every 3 seconds: the server keeps the code until it expires or someone scans it, then hands out the next one.
    const poll = setInterval(load, 3000), tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { active = false; clearInterval(poll); clearInterval(tick); };
  }, [sessionId]);
  if (error === 'CHECK_IN_CLOSED') return <StateCard kind="pending" title={tr('모임 시간에만 QR이 떠요')} body={tr('모임이 시작하면 이 화면에서 QR을 띄워 주세요.')} />;
  if (error === 'SESSION_NOT_FOUND') return <StateCard kind="blocked" title={tr('모임장만 QR을 띄울 수 있어요')} body={tr('참석자는 모임장 폰에 뜬 QR을 폰 카메라로 찍어 주세요.')} />;
  if (!qr) return error ? <StateCard kind="error" title={tr('QR을 불러오지 못했어요')} body={tr('인터넷 연결이 끊긴 것 같아요. 다시 연결되면 저절로 떠요.')} /> : <ListLoading label={tr('QR 불러오는 중')} />;
  const { size, rows } = qrRuns(qr.url);
  const box = Math.min(280, width - Spacing.four * 2 - Spacing.three * 2);
  const cell = Math.floor(box / (size + 8)), quiet = cell * 4;
  const left = Math.max(0, Math.min(15, Math.ceil((Date.parse(qr.expiresAt) - now) / 1000)));
  return <View style={styles.qrStack}>
    <View style={[styles.qrCard, clayBox ? styles.clayCard : { backgroundColor: theme.card, borderColor: theme.line }]}>{clayBox && <ClayBoxFill kind="tile" />}
      <View accessible accessibilityRole="image" accessibilityLabel={tr('체크인 QR')} style={[styles.qr, { width: cell * size + quiet * 2, height: cell * size + quiet * 2 }]}>
        {rows.map((row, y) => row.map(([x, run]) => <View key={`${y}:${x}`} style={[styles.module, { left: quiet + x * cell, top: quiet + y * cell, width: run * cell, height: cell }]} />))}
      </View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.bar, { backgroundColor: theme.backgroundElement }]}><View style={[styles.barFill, { backgroundColor: theme.accent, width: `${left / 15 * 100}%` }]} /></View>
      <ThemedText themeColor="textSecondary" style={Typography.supporting}>{tr('{0}초 뒤에 바뀌어요', left)}</ThemedText>
      <ThemedText accessibilityLiveRegion="polite" style={Typography.label}>{tr('체크인 {0}명', qr.checkedIn)}</ThemedText>
    </View>
    <ThemedText themeColor="textSecondary" style={[Typography.supporting, styles.center]}>{tr('참석자가 폰 카메라로 이 QR을 찍으면 체크인돼요. 위치 정보는 안 써요.')}</ThemedText>
    {qr.questActive && <ThemedText themeColor="textSecondary" style={[Typography.supporting, styles.center]}>{qr.questProblem && SESSION_PROBLEMS[qr.questProblem] ? tr(SESSION_PROBLEMS[qr.questProblem]) : tr('퀘스트에는 QR로 체크인한 사람만 쳐요.')}</ThemedText>}
    {!!error && <ThemedText type="small" accessibilityRole="alert">{tr('연결이 끊겼어요. 다시 연결되면 새 QR이 떠요.')}</ThemedText>}
  </View>;
}

const PHOTO_ERRORS: Record<string, string> = {
  PHOTO_WINDOW_CLOSED: '모임 중이나 끝나고 30분 안에만 보낼 수 있어요.',
  PHOTO_DUPLICATE: '이미 올라온 적 있는 사진이에요. 새로 찍어 주세요.',
  PHOTO_ALREADY_SENT: '인증샷은 이미 보냈어요.',
  QUEST_SESSION_NOT_ELIGIBLE: '이 모임은 퀘스트에 안 쳐요.',
  QUEST_NOT_FOUND: '진행 중인 퀘스트가 없어요.',
  RATE_LIMITED: '너무 여러 번 보냈어요. 잠시 후 다시 해 주세요.',
};

/** The quest group photo: in-app camera only, sent to a private bucket the operations team reviews. */
export function MeetupQuestPhoto({ sessionId }: { sessionId: string }) {
  const { tr } = useLanguage();
  const theme = useTheme(), clayBox = useClayBox(), { play } = useInteractionFeedback(), { me } = useAuth();
  const [quest, setQuest] = useState<HostQuest | null | undefined>(undefined), [busy, setBusy] = useState(false), [sent, setSent] = useState(false), [note, setNote] = useState('');
  const pending = useRef(false);
  useEffect(() => { loadMyHostQuest(supabase).then(setQuest, () => setQuest(null)); }, []);
  async function shoot() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setNote(''); play('selection');
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) { setNote(tr('카메라를 쓸 수 있게 설정에서 허용해 주세요.')); play('warning'); return; }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
      if (result.canceled || !result.assets[0]) return;
      const image = await preparePostImage(result.assets[0]);
      await sendQuestPhoto(supabase, me.id, sessionId, image.base64);
      setSent(true); play('success');
    } catch (failure) {
      setNote(tr(PHOTO_ERRORS[questError(failure, Object.keys(PHOTO_ERRORS)) ?? ''] ?? '사진을 보내지 못했어요. 잠시 후 다시 찍어 주세요.')); play('warning');
    } finally { pending.current = false; setBusy(false); }
  }
  if (quest === undefined) return <ListLoading label={tr('불러오는 중이에요')} />;
  if (!quest || quest.status !== 'active') return <StateCard kind="blocked" title={tr('진행 중인 퀘스트가 없어요')} body={tr('모임장 퀘스트를 하는 동안에만 인증샷을 보내요.')} />;
  const previous = quest.photo;
  if (sent || (previous && previous.status !== 'rejected')) return <StateCard layout="start" mark="check" title={tr('사진을 보냈어요')}
    body={previous?.status === 'approved' && !sent ? tr('운영팀이 확인했어요. 사진은 확인이 끝난 날부터 30일 뒤에 지워요.') : tr('운영팀이 보고 나면 $5가 쌓여요. 사진은 확인이 끝난 날부터 30일 뒤에 지워요.')}>
    <View><Tag label={previous?.status === 'approved' && !sent ? tr('확정') : tr('운영팀 확인 중')} /></View>
  </StateCard>;
  if (Platform.OS === 'web') return <StateCard kind="blocked" title={tr('인증샷은 앱에서 찍어 주세요')} body={tr('모임 시간 안에 앱 카메라로 찍은 단체 사진 1장만 받아요. 갤러리 사진은 안 돼요.')} />;
  return <View style={styles.photoStack}>
    <View style={[styles.photoCard, clayBox ? styles.clayCard : { backgroundColor: theme.card, borderColor: theme.line }]}>{clayBox && <ClayBoxFill kind="tile" />}
      <Tag label={tr('운영팀 확인용으로만 쓰고, 공개하지 않아요')} />
      <ThemedText style={Typography.section}>{tr('모임 사람들이 다 나오게 찍어 주세요')}</ThemedText>
      {previous?.status === 'rejected' && <ThemedText themeColor="textSecondary" style={Typography.supporting}>{tr('지난번에 보낸 사진은 운영팀이 인증하지 않았어요. 다시 찍어 주세요.')}</ThemedText>}
      <ThemedText themeColor="textSecondary" style={Typography.supporting}>{tr('모임 시간 안에 앱 카메라로 찍은 단체 사진 1장만 받아요. 갤러리 사진은 안 돼요.')}</ThemedText>
    </View>
    <RaisedActionButton analyticsId="meetup.quest.photo.shoot" label={tr('사진 찍기')} busy={busy} onPress={() => void shoot()} />
    {!!note && <ThemedText type="small" accessibilityRole="alert">{note}</ThemedText>}
  </View>;
}

const styles = StyleSheet.create({
  rows: { marginTop: Spacing.three },
  qrStack: { gap: Spacing.three, alignItems: 'stretch' },
  qrCard: { alignItems: 'center', gap: Spacing.two, padding: Spacing.three, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  clayCard: { borderColor: 'transparent', overflow: 'visible' },
  // Scanners need dark modules on a light field with a quiet border; these two colors are fixed on purpose.
  qr: { backgroundColor: '#FFFFFF', borderRadius: 12 },
  module: { position: 'absolute', backgroundColor: '#000000' },
  bar: { alignSelf: 'stretch', height: 4, borderRadius: 2, overflow: 'hidden' }, barFill: { height: 4, borderRadius: 2 },
  center: { textAlign: 'center' },
  photoStack: { gap: Spacing.three },
  photoCard: { gap: Spacing.two, padding: Spacing.three, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, alignItems: 'flex-start' },
});
