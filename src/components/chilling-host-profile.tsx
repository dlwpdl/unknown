import { useLanguage } from '@/hooks/use-language';
import { SymbolView } from '@/components/symbol-view';
import { Pressable } from '@/components/analytics-controls';
import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { DeviceEventEmitter, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CHILLING_CATEGORY_LABELS } from '@/components/chilling-event';
import { languagePairLabel, meetupCategoryOf, parseLanguageExchange } from '@/lib/meetup-language';
import { ClayPillFill, useClay } from '@/components/clay';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { Typography } from '@/constants/design-system';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useAuth } from '@/lib/auth';
import { useChatIdentity } from '@/hooks/use-chat-identity';
import { selectChatBusiness } from '@/lib/chat-identity';
import { getChillingError, loadMeetupParticipation, type MeetupParticipation } from '@/lib/chilling-data';
import { chillingAvailability, chillingKind, chillingTimezoneLabel, meetupBarAction, recommendedAgeLabel } from '@/lib/chilling';
import { MEETUPS_CHANGED_EVENT } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { meetupFeeAmount } from '@/lib/meetup-host-tools';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';
import { useNewcomerStatus } from '@/components/newcomer';
import { newcomerLocked } from '@/lib/newcomer';

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

// hideOpen: logged-out readers can't see a host's pause, so '모집 중' could be wrong there.
export function MeetupChips({ post, hideOpen = false }: { post: Post; hideOpen?: boolean }) {
  const { tr } = useLanguage();
  const theme = useTheme(), clay = useClay();
  if (!post.room) return null;
  const availability = chillingAvailability(post.room);
  const category = meetupCategoryOf(post.room), exchange = parseLanguageExchange(post.room);
  const chip = [styles.badge, clay ? styles.clayBadge : { backgroundColor: theme.backgroundElement }], fill = clay && <ClayPillFill kind="white" />;
  return <View style={styles.badges}>
    <View style={chip}>{fill}<ThemedText type="smallBold" themeColor="accent">{chillingKind(post.room) === 'once' ? tr('칠링') : tr('정기모임')}</ThemedText></View>
    {!!category && <View style={chip}>{fill}<ThemedText type="smallBold">{tr(CHILLING_CATEGORY_LABELS[category])}</ThemedText></View>}
    {exchange && <View style={chip}>{fill}<ThemedText type="smallBold">{languagePairLabel(exchange)}</ThemedText></View>}
    {!(hideOpen && availability === 'open') && <View style={chip}>{fill}<ThemedText type="smallBold">{{ open: tr('모집 중'), full: tr('정원 마감'), closed: tr('모집 마감'), ended: tr('종료된 모임') }[availability]}</ThemedText></View>}
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
    recommendedAgeLabel(room, appLocale) + (room.recommendedAgeMin != null ? ` · ${tr('범위 밖이어도 신청할 수 있어요')}` : ''),
    room.timezone ? tr('일정은 {0} 기준이에요.', chillingTimezoneLabel(room, appLocale)) : '',
  ].filter(Boolean);
  return <View style={[styles.notes, { borderColor: theme.line }]}>
    <Pressable analyticsId="components_chilling-host-profile.pressable.3" accessibilityRole="button" accessibilityLabel={tr('참여 전에 알아둘 것')} accessibilityState={{ expanded: open }} onPress={() => { play('selection'); setOpen(value => !value); }} style={styles.row}>
      <ThemedText style={Typography.menu}>{tr('참여 전에 알아둘 것')}</ThemedText><SymbolView name={open ? { ios: 'minus', android: 'remove', web: 'remove' } : { ios: 'plus', android: 'add', web: 'add' }} size={20} tintColor={theme.textSecondary} />
    </Pressable>
    {open && notes.map(note => <ThemedText key={note} type="small" themeColor="textSecondary">• {note}</ThemedText>)}
  </View>;
}

export function MeetupActionBar({ post, status, onJoin, onBeforeNavigate }: { post: Post; status: MeetupStatus; onJoin?: () => void; onBeforeNavigate?: () => void }) {
  const { tr } = useLanguage();
  const { isAuthed, me, promptLogin } = useAuth(), theme = useTheme(), router = useRouter(), insets = useSafeAreaInsets();
  const { play } = useInteractionFeedback(), business = useChatIdentity();
  const newcomer = useNewcomerStatus(isAuthed && post.room?.newcomerOnly === true);
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
  const bar = meetupBarAction({ own, participating: !!participation, loading: status.statusLoading || (isAuthed && room.newcomerOnly === true && newcomer.loading), availability, newcomerLocked: isAuthed && !!newcomer.status && newcomerLocked(room, newcomer.status) });
  const fee = room.fee ? meetupFeeAmount(room.fee.amount) : null;
  const seats = room.capacity ? tr('{0}자리 남음', Math.max(0, room.capacity - room.memberCount)) : tr('{0}명 참여 중', room.memberCount);
  const [title, detail] = own ? [tr('내가 연 모임'), seats]
    : participation?.status === 'pending' ? [tr('승인 대기 중'), tr('호스트가 확인하면 알려드려요')]
    : participation ? [tr({ approved: '참여 승인', rejected: '신청이 거절됐어요', cancelled: '신청을 취소했어요' }[participation.status]), fee ? tr('회비 {0}', fee) : '']
    : availability === 'open' ? [seats, fee ? tr('회비 {0} · 승인 후 참여', fee) : tr('승인 후 참여')]
    : [{ full: tr('정원이 모두 찼어요'), closed: tr('모집이 마감됐어요'), ended: tr('종료된 모임이에요') }[availability], ''];
  return <View style={[styles.bar, { borderTopColor: theme.line, backgroundColor: theme.card, paddingBottom: Math.max(insets.bottom, Spacing.two) + Spacing.one }]}>
    <View style={styles.barMeta}>
      <ThemedText style={Typography.menu}>{title}</ThemedText>
      {!!detail && <ThemedText type="small" themeColor="textSecondary">{detail}</ThemedText>}
    </View>
    {bar.action === 'locked' ? <ThemedText type="smallBold" themeColor="textSecondary" style={styles.lockedNote}>{tr(bar.label)}</ThemedText> : <RaisedActionButton compact analyticsId="components_chilling-host-profile.pressable.2" disabled={bar.disabled} busy={bar.busy} label={tr(bar.label)} onPress={() => {
      play('selection');
      if (bar.action === 'review') { onBeforeNavigate?.(); router.push({ pathname: '/chat', params: { view: 'requests' } }); }
      else if (bar.action === 'status') { onBeforeNavigate?.(); router.push({ pathname: '/meetup-join', params: { postId: post.id } }); }
      else if (onJoin) onJoin();
      else if (isAuthed) router.push({ pathname: '/meetup-join', params: { postId: post.id } });
      else promptLogin('이 모임에 참여하려면 로그인해 주세요.');
    }} />}
  </View>;
}

const styles = StyleSheet.create({
  summary: { gap: Spacing.three, marginTop: Spacing.three }, badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginBottom: Spacing.two }, clayBadge: { overflow: 'visible', paddingHorizontal: 14 }, badge: { borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  host: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 }, avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  hostName: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.one }, flexText: { flexShrink: 1 }, link: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.one },
  facts: { flexDirection: 'row', flexWrap: 'wrap', borderRadius: 18, borderWidth: 1, overflow: 'hidden' }, fact: { padding: Spacing.three, gap: 2 }, factTop: { borderTopWidth: 1 }, factLeft: { borderLeftWidth: 1 },
  factValue: { fontSize: 16, lineHeight: 24, fontWeight: '600' }, status: { borderRadius: 16, padding: Spacing.three },
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two }, notes: { borderTopWidth: 1, marginTop: Spacing.three, gap: Spacing.two },
  bar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingTop: Spacing.two, borderTopWidth: 1 },
  barMeta: { flexGrow: 1, flexShrink: 1, flexBasis: 160, minWidth: 0 },
  lockedNote: { flexShrink: 1, maxWidth: 190, textAlign: 'right' },
});
