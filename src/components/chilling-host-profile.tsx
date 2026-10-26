import { useLanguage } from '@/hooks/use-language';
import { GlingLoader } from '@/components/gling-loader';
import { Pressable } from '@/components/analytics-controls';
import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { DeviceEventEmitter, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { CHILLING_CATEGORY_LABELS, SeatBar } from '@/components/chilling-event';
import { ChillingProfileCard } from '@/components/chilling-profile-card';
import { MeetupWaitlist } from '@/components/meetup-host-tools';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ReportSheet } from '@/components/report-sheet';
import { ThemedText } from '@/components/themed-text';
import { StateCard } from '@/components/state-card';
import { TrustBadge } from '@/components/trust-badge';
import { Spacing } from '@/constants/theme';
import { Typography } from '@/constants/design-system';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useAuth } from '@/lib/auth';
import { useChatIdentity } from '@/hooks/use-chat-identity';
import { selectChatBusiness } from '@/lib/chat-identity';
import { getChillingError, loadChillingHostProfile, loadMeetupParticipation, type ChillingProfile, type MeetupParticipation } from '@/lib/chilling-data';
import { chillingAvailability, chillingKind, chillingSchedule, chillingTimezoneLabel, meetupBarAction, recommendedAgeLabel } from '@/lib/chilling';
import { MEETUPS_CHANGED_EVENT } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { meetupFeeAmount, meetupFeeDue } from '@/lib/meetup-host-tools';
import { CITIES } from '@/lib/mock';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

export type MeetupStatus = ReturnType<typeof useMeetupParticipation>;

/** One status lookup shared by the meetup summary and the bottom action bar. */
export function useMeetupParticipation(post: Post) {
  const { isAuthed, me } = useAuth(), hidden = useContentVisibility();
  const [participation, setParticipation] = useState<MeetupParticipation | null>(null), [statusError, setStatusError] = useState(''), [retry, setRetry] = useState(0);
  const [statusLoading, setStatusLoading] = useState(true);
  const unavailable = !post.room || hidden('post', post.id, post.author.id);
  const own = isAuthed && post.author.id === me.id;
  useFocusEffect(useCallback(() => {
    let active = true;
    setParticipation(null); setStatusError('');
    if (!isAuthed || own || unavailable) { setStatusLoading(false); return; }
    setStatusLoading(true);
    const refresh = async () => {
      try { const value = await loadMeetupParticipation(supabase, post.id, me.id); if (active) { setParticipation(value); setStatusError(''); } }
      catch (e) { if (active) { setParticipation(null); setStatusError(getChillingError(e)); } }
      finally { if (active) setStatusLoading(false); }
    };
    void refresh();
    const listener = DeviceEventEmitter.addListener(MEETUPS_CHANGED_EVENT, () => void refresh());
    return () => { active = false; listener.remove(); };
  // retry re-runs the focused status lookup after an explicit retry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, me.id, own, unavailable, post.id, retry]));
  return { own, participation, statusLoading, statusError, retry: () => setRetry(value => value + 1) };
}

export function MeetupChips({ post }: { post: Post }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  if (!post.room) return null;
  const availability = chillingAvailability(post.room);
  const chip = [styles.badge, { backgroundColor: theme.backgroundElement }];
  return <View style={styles.badges}>
    <View style={chip}><ThemedText type="smallBold" themeColor="accent">{chillingKind(post.room) === 'once' ? tr('칠링') : tr('정기모임')}</ThemedText></View>
    {!!post.room.category && <View style={chip}><ThemedText type="smallBold">{tr(CHILLING_CATEGORY_LABELS[post.room.category])}</ThemedText></View>}
    <View style={chip}><ThemedText type="smallBold">{{ open: tr('모집 중'), full: tr('정원 마감'), closed: tr('모집 마감'), ended: tr('종료된 모임') }[availability]}</ThemedText></View>
  </View>;
}

export function MeetupSummary({ post, status, onClose, onBeforeNavigate }: { post: Post; status: MeetupStatus; onClose: () => void; onBeforeNavigate?: () => void }) {
  const { tr, t, locale: appLocale } = useLanguage();
  const { isAuthed, promptLogin } = useAuth(), theme = useTheme(), router = useRouter();
  const { play } = useInteractionFeedback();
  const stacked = useWindowDimensions().fontScale >= 1.3;
  const [profile, setProfile] = useState<ChillingProfile | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [report, setReport] = useState(false);
  const room = post.room;
  if (!room) return null;
  const { own, participation, statusError } = status;
  const availability = chillingAvailability(room);
  const load = async () => {
    if (!isAuthed) return promptLogin('호스트 모임 프로필을 보려면 로그인해 주세요.');
    if (loading) return;
    setLoading(true); setError('');
    try { const value = await loadChillingHostProfile(supabase, post.id); setProfile(value); if (!value) setError("지금은 프로필을 볼 수 없어요."); }
    catch (e) { setError(getChillingError(e)); }
    finally { setLoading(false); }
  };
  const facts: [string, string, string?][] = [
    [tr('언제'), chillingSchedule(room, appLocale)],
    [tr('어디'), tr(CITIES.find(city => city.id === post.cityId)?.name ?? post.cityId), tr('집결지는 승인 후')],
    [tr('인원'), tr(room.capacity ? '{0} / {1}명' : '{0}명', room.memberCount, room.capacity)],
    room.fee ? [tr('회비'), meetupFeeAmount(room.fee.amount), room.fee.dueOn ? tr('{0}까지', meetupFeeDue(room.fee.dueOn, appLocale)) : room.fee.note]
      : [tr('나이'), recommendedAgeLabel(room, appLocale)],
  ];
  const statusNote = participation?.status === 'pending' && availability === 'full' ? tr('신청은 대기 중이에요. 지금은 정원이 차서 승인할 수 없어요.')
    : participation?.status === 'approved' && (availability === 'ended' || availability === 'closed') ? tr('이전 승인 기록이에요. 현재 모임은 종료되거나 마감됐어요.') : '';
  // Web has no attendance UI (meetup-reviews.web.tsx renders nothing), so the row stays native-only.
  const tools = Platform.OS === 'web' ? null : own ? tr('호스트 도구') : participation?.status === 'approved' ? tr('참석 확인') : null;
  return <View style={styles.summary}>
    <View style={styles.host}>
      <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}><ThemedText type="smallBold">{post.author.nickname[0]}</ThemedText></View>
      <View style={styles.hostName}><ThemedText type="smallBold" style={styles.flexText}>{post.author.nickname}</ThemedText><TrustBadge verified={post.author.verified} trustLevel={post.author.trustLevel} /></View>
      <Pressable analyticsId="components_chilling-host-profile.pressable.1" accessibilityRole="button" accessibilityLabel={tr('{0} 모임 프로필', post.author.nickname)}
        accessibilityState={room.eventKind ? { expanded: !!profile, busy: loading } : undefined} style={styles.link}
        onPress={() => {
          play('selection');
          // Event meetups expand the host's shared profile in place; legacy rooms keep the profile route.
          if (!room.eventKind) { onClose(); router.push({ pathname: '/meetup-profile', params: { postId: post.id } }); }
          else if (profile) setProfile(null); else void load();
        }}>
        <ThemedText type="smallBold" themeColor="accent">{profile ? tr('접기') : tr('프로필')}</ThemedText>
      </Pressable>
      {!own && <Pressable analyticsId="meetup.detail.report" accessibilityRole="button" accessibilityLabel={t.report.title(post.author.nickname)} style={styles.link}
        onPress={() => { play('selection'); if (isAuthed) setReport(true); else promptLogin(t.auth.reasonReport); }}>
        <SymbolView name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }} size={21} tintColor={theme.textSecondary} />
      </Pressable>}
    </View>
    {loading && <GlingLoader color={theme.accent} />}
    {isAuthed && profile && <ChillingProfileCard profile={profile} />}
    {!!error && <ThemedText type="small" accessibilityRole="alert">{tr(error)}</ThemedText>}
    <View style={[styles.facts, { borderColor: theme.line }]}>
      {facts.map(([label, value, note], index) => <View key={label} style={[styles.fact, { width: stacked ? '100%' : '50%', backgroundColor: theme.card, borderColor: theme.line },
        index >= (stacked ? 1 : 2) && styles.factTop, !stacked && index % 2 === 1 && styles.factLeft]}>
        <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
        <ThemedText style={styles.factValue}>{value}</ThemedText>
        {!!note && <ThemedText type="small" themeColor="textSecondary">{note}</ThemedText>}
        {index === 2 && <SeatBar room={room} />}
      </View>)}
    </View>
    {!!statusNote && <View style={[styles.status, { backgroundColor: theme.backgroundSelected }]}><ThemedText type="small">{statusNote}</ThemedText></View>}
    {tools && <Pressable analyticsId="meetup.detail.tools" accessibilityRole="button" accessibilityLabel={tools} style={[styles.row, { borderColor: theme.line }]}
      onPress={() => { play('selection'); onBeforeNavigate?.(); router.push({ pathname: '/meetup-tools', params: { postId: post.id, kind: room.eventKind ?? 'group', host: own ? '1' : '0' } }); }}>
      <ThemedText style={Typography.menu}>{tools}</ThemedText><ThemedText themeColor="textSecondary">›</ThemedText>
    </Pressable>}
    {isAuthed && !own && !participation && availability === 'full' && <MeetupWaitlist postId={post.id} />}
    {!!statusError && <StateCard kind="error" title={tr('신청 상태를 불러오지 못했어요')} body={tr(statusError)} actionLabel={tr('다시 불러오기')} onAction={status.retry} />}
    {report && <ReportSheet visible targetType="post" targetId={post.id} reportedUserId={post.business ? undefined : post.author.id} reportedBusinessId={post.business?.id}
      reportedNickname={post.business?.name ?? post.author.nickname} onClose={() => setReport(false)} />}
  </View>;
}

export function MeetupNotes({ post }: { post: Post }) {
  const { tr, locale: appLocale } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const [open, setOpen] = useState(false);
  const room = post.room;
  if (!room) return null;
  const notes = [
    tr('호스트가 답변과 프로필을 보고 승인해요. 신청만으로는 자리가 잡히지 않아요.'),
    tr('정확한 집결 장소는 승인 후 모임 대화에서 알려줘요.'),
    tr('인원에는 호스트도 들어가요.'),
    recommendedAgeLabel(room, appLocale) + (room.recommendedAgeMin != null ? tr(' · 권장 범위 밖이어도 신청 가능') : ''),
    room.timezone ? tr('일정은 {0} 기준이에요.', chillingTimezoneLabel(room, appLocale)) : '',
  ].filter(Boolean);
  return <View style={[styles.notes, { borderColor: theme.line }]}>
    <Pressable analyticsId="components_chilling-host-profile.pressable.3" accessibilityRole="button" accessibilityLabel={tr('참여 전에 알아둘 것')} accessibilityState={{ expanded: open }} onPress={() => { play('selection'); setOpen(value => !value); }} style={styles.row}>
      <ThemedText style={Typography.menu}>{tr('참여 전에 알아둘 것')}</ThemedText><ThemedText themeColor="textSecondary">{open ? '−' : '＋'}</ThemedText>
    </Pressable>
    {open && notes.map(note => <ThemedText key={note} type="small" themeColor="textSecondary">• {note}</ThemedText>)}
  </View>;
}

export function MeetupActionBar({ post, status, onJoin, onBeforeNavigate }: { post: Post; status: MeetupStatus; onJoin?: () => void; onBeforeNavigate?: () => void }) {
  const { tr } = useLanguage();
  const { isAuthed, me, promptLogin } = useAuth(), theme = useTheme(), router = useRouter(), insets = useSafeAreaInsets();
  const { play } = useInteractionFeedback(), business = useChatIdentity();
  const room = post.room;
  if (!room) return null;
  const { own, participation } = status;
  // Meetups are between people: while acting as a business the bar only offers switching back.
  if (business && !own) return <View style={[styles.bar, { borderTopColor: theme.line, backgroundColor: theme.card, paddingBottom: Math.max(insets.bottom, Spacing.two) + Spacing.one }]}>
    <View style={styles.barMeta}>
      <ThemedText style={Typography.menu}>{tr('모임은 개인으로 참여해요')}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{tr('지금은 {0} 이름으로 쓰는 중', business.name)}</ThemedText>
    </View>
    <RaisedActionButton compact analyticsId="meetup.detail.switch-personal" label={tr('개인으로 바꾸기')} onPress={() => { play('selection'); selectChatBusiness(me.id, null); }} />
  </View>;
  const availability = chillingAvailability(room);
  const bar = meetupBarAction({ own, participating: !!participation, loading: status.statusLoading, availability });
  const fee = room.fee ? meetupFeeAmount(room.fee.amount) : null;
  const seats = room.capacity ? tr('{0}자리 남음', Math.max(0, room.capacity - room.memberCount)) : tr('{0}명 참여 중', room.memberCount);
  const [title, detail] = own ? [tr('내가 연 모임'), seats]
    : participation?.status === 'pending' ? [tr('승인 대기 중'), tr('호스트가 확인하면 알려드려요')]
    : participation ? [tr({ approved: '참여 승인', rejected: '신청 거절', cancelled: '신청 취소됨' }[participation.status]), fee ? tr('회비 {0}', fee) : '']
    : availability === 'open' ? [seats, fee ? tr('회비 {0} · 승인 후 참여', fee) : tr('승인 후 참여')]
    : [{ full: tr('정원이 모두 찼어요'), closed: tr('모집이 마감됐어요'), ended: tr('종료된 모임이에요') }[availability], ''];
  return <View style={[styles.bar, { borderTopColor: theme.line, backgroundColor: theme.card, paddingBottom: Math.max(insets.bottom, Spacing.two) + Spacing.one }]}>
    <View style={styles.barMeta}>
      <ThemedText style={Typography.menu}>{title}</ThemedText>
      {!!detail && <ThemedText type="small" themeColor="textSecondary">{detail}</ThemedText>}
    </View>
    <RaisedActionButton compact analyticsId="components_chilling-host-profile.pressable.2" disabled={bar.disabled} busy={bar.busy} label={tr(bar.label)} onPress={() => {
      play('selection');
      if (bar.action === 'review') { onBeforeNavigate?.(); router.push({ pathname: '/chat', params: { view: 'requests' } }); }
      else if (bar.action === 'status') { onBeforeNavigate?.(); router.push({ pathname: '/meetup-join', params: { postId: post.id } }); }
      else if (onJoin) onJoin();
      else if (isAuthed) router.push({ pathname: '/meetup-join', params: { postId: post.id } });
      else promptLogin('이 모임에 참여하려면 로그인해 주세요.');
    }} />
  </View>;
}

const styles = StyleSheet.create({
  summary: { gap: Spacing.three, marginTop: Spacing.three }, badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginBottom: Spacing.two }, badge: { borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  host: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 }, avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  hostName: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.one }, flexText: { flexShrink: 1 }, link: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.one },
  facts: { flexDirection: 'row', flexWrap: 'wrap', borderRadius: 18, borderWidth: 1, overflow: 'hidden' }, fact: { padding: Spacing.three, gap: 2 }, factTop: { borderTopWidth: 1 }, factLeft: { borderLeftWidth: 1 },
  factValue: { fontSize: 16, lineHeight: 24, fontWeight: '600' }, status: { borderRadius: 16, padding: Spacing.three },
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two }, notes: { borderTopWidth: 1, marginTop: Spacing.three, paddingBottom: Spacing.three, gap: Spacing.two },
  bar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingTop: Spacing.two, borderTopWidth: 1 },
  barMeta: { flexGrow: 1, flexShrink: 1, flexBasis: 160, minWidth: 0 },
});
