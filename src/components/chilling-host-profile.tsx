import { GlingLoader } from '@/components/gling-loader';
import { Pressable } from '@/components/analytics-controls';
import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { DeviceEventEmitter, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { ChillingProfileCard } from '@/components/chilling-profile-card';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { StateCard } from '@/components/state-card';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useAuth } from '@/lib/auth';
import { getChillingError, loadChillingHostProfile, loadMeetupParticipation, type ChillingProfile, type MeetupParticipation } from '@/lib/chilling-data';
import { chillingAvailability, chillingKind, chillingSchedule, recommendedAgeLabel } from '@/lib/chilling';
import { MEETUPS_CHANGED_EVENT } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES } from '@/lib/mock';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

export function ChillingHostProfile({ post, onJoin, onBeforeNavigate }: { post: Post; onJoin?: () => void; onBeforeNavigate?: () => void }) {
  const { isAuthed, me } = useAuth();
  return <HostProfile key={`${post.id}:${isAuthed ? me.id : 'guest'}`} post={post} onJoin={onJoin} onBeforeNavigate={onBeforeNavigate} />;
}
function HostProfile({ post, onJoin, onBeforeNavigate }: { post: Post; onJoin?: () => void; onBeforeNavigate?: () => void }) {
  const { isAuthed, me, promptLogin } = useAuth(), hidden = useContentVisibility(), theme = useTheme(), router = useRouter();
  const { play } = useInteractionFeedback();
  const [profile, setProfile] = useState<ChillingProfile | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [participation, setParticipation] = useState<MeetupParticipation | null>(null), [statusError, setStatusError] = useState(''), [retry, setRetry] = useState(0);
  const [statusLoading, setStatusLoading] = useState(true), [infoOpen, setInfoOpen] = useState(false);
  const unavailable = !post.room || hidden('post', post.id, post.author.id);
  const own = isAuthed && post.author.id === me.id;
  useFocusEffect(useCallback(() => {
    let active = true;
    setProfile(null); setError(''); setParticipation(null); setStatusError('');
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
  if (unavailable || !post.room) return null;
  const availability = chillingAvailability(post.room);
  const statusLabel = participation ? { pending: '승인 대기', approved: '참여 승인', rejected: '신청 거절', cancelled: '신청 취소됨' }[participation.status] : null;
  const seats = post.room.capacity ? Math.max(0, post.room.capacity - post.room.memberCount) : null;
  const load = async () => {
    if (!isAuthed) return promptLogin('호스트 모임 프로필을 보려면 로그인해 주세요.');
    if (loading) return;
    setLoading(true); setError('');
    try { const value = await loadChillingHostProfile(supabase, post.id); setProfile(value); if (!value) setError('지금은 프로필을 볼 수 없어요.'); }
    catch (e) { setError(getChillingError(e)); }
    finally { setLoading(false); }
  };
  return <View style={styles.content}>
    <View style={styles.badges}>
      <View style={[styles.badge, { backgroundColor: theme.backgroundElement }]}><ThemedText type="smallBold" themeColor="accent">{chillingKind(post.room) === 'once' ? '한 번의 만남' : '정기 모임'}</ThemedText></View>
      <View style={[styles.badge, { backgroundColor: theme.backgroundElement }]}><ThemedText type="smallBold">{{ open: '모집 중', full: '정원 마감', closed: '모집 마감', ended: '종료된 모임' }[availability]}</ThemedText></View>
    </View>
    <View style={[styles.facts, { backgroundColor: theme.card, borderColor: theme.line }]}>
      <View style={styles.fact}><View style={[styles.icon, { backgroundColor: theme.backgroundElement }]}><SymbolView name={{ ios: 'calendar', android: 'calendar_today', web: 'calendar_today' }} size={20} tintColor={theme.accent} /></View>
        <View style={styles.factBody}><ThemedText type="small" themeColor="textSecondary">{chillingKind(post.room) === 'once' ? '언제 만나나요' : '활동 주기'}</ThemedText><ThemedText style={styles.factValue}>{chillingSchedule(post.room)}</ThemedText></View></View>
      <View style={[styles.fact, styles.divider, { borderColor: theme.line }]}><View style={[styles.icon, { backgroundColor: theme.backgroundElement }]}><SymbolView name={{ ios: 'mappin.and.ellipse', android: 'location_on', web: 'location_on' }} size={20} tintColor={theme.accent} /></View>
        <View style={styles.factBody}><ThemedText type="small" themeColor="textSecondary">활동 지역</ThemedText><ThemedText style={styles.factValue}>{CITIES.find(city => city.id === post.cityId)?.name ?? post.cityId}</ThemedText><ThemedText type="small" themeColor="textSecondary">집결 장소는 승인 후 모임 대화에서 확인해요.</ThemedText></View></View>
      <View style={[styles.fact, styles.divider, { borderColor: theme.line }]}><View style={[styles.icon, { backgroundColor: theme.backgroundElement }]}><SymbolView name={{ ios: 'person.2', android: 'group', web: 'group' }} size={20} tintColor={theme.accent} /></View>
        <View style={styles.factBody}><ThemedText type="small" themeColor="textSecondary">함께하는 사람</ThemedText><ThemedText style={styles.factValue}>{post.room.memberCount}{post.room.capacity ? ` / ${post.room.capacity}명` : '명'}{seats !== null ? ` · ${seats}자리 남음` : ''}</ThemedText><ThemedText type="small" themeColor="textSecondary">모임장 포함 · 신청만으로 자리가 예약되지 않아요.</ThemedText></View></View>
    </View>
    {statusLabel && <View style={[styles.status, { backgroundColor: theme.backgroundSelected }]}><ThemedText type="smallBold" themeColor="accent">내 신청 · {statusLabel}</ThemedText>
      {participation?.status === 'pending' && availability === 'full' && <ThemedText type="small" themeColor="textSecondary">신청은 대기 중이에요. 지금은 정원이 차서 승인할 수 없어요.</ThemedText>}
      {participation?.status === 'approved' && (availability === 'ended' || availability === 'closed') && <ThemedText type="small" themeColor="textSecondary">이전 승인 기록이에요. 현재 모임은 종료되거나 마감됐어요.</ThemedText>}
    </View>}
    <RaisedActionButton analyticsId="components_chilling-host-profile.pressable.2" disabled={statusLoading || (!own && !participation && availability !== 'open')} busy={statusLoading} onPress={() => {
      play('selection');
      if (own) { onBeforeNavigate?.(); router.push({ pathname: '/chat', params: { view: 'requests' } }); }
      else if (participation) { onBeforeNavigate?.(); router.push({ pathname: '/meetup-join', params: { postId: post.id } }); }
      else if (onJoin) onJoin();
      else if (isAuthed) router.push({ pathname: '/meetup-join', params: { postId: post.id } });
      else promptLogin('이 모임에 참여하려면 로그인해 주세요.');
    }} label={statusLoading ? '신청 상태 확인 중…' : own ? '참여 신청자 검토하기' : participation ? '내 신청 결과 보기' : { open: '질문에 답하고 참여 신청', full: '정원이 모두 찼어요', closed: '모집이 마감됐어요', ended: '종료된 모임이에요' }[availability]} />
    {!participation && !own && availability === 'open' && <ThemedText type="small" themeColor="textSecondary">모임장에게 답변과 프로필을 보내고, 승인 후 함께해요.</ThemedText>}
    {!!statusError && <StateCard kind="error" title="신청 상태를 불러오지 못했어요" body={statusError} actionLabel="다시 불러오기" onAction={() => setRetry(value => value + 1)} />}
    {!!post.room.eventKind && <>
      <Pressable analyticsId="components_chilling-host-profile.pressable.1" onPress={() => { play('selection'); if (profile) setProfile(null); else void load(); }} accessibilityRole="button" accessibilityState={{ expanded: !!profile, busy: loading }} style={[styles.disclosure, { borderColor: theme.line }]}>
        <View style={styles.factBody}><ThemedText type="small" themeColor="textSecondary">이 모임을 연 사람</ThemedText><ThemedText style={styles.factValue}>{post.author.nickname}</ThemedText></View>
        <ThemedText type="smallBold" themeColor="accent">프로필 {profile ? '접기' : '보기'} ›</ThemedText>
      </Pressable>
      {loading && <GlingLoader color={theme.accent} />}
      {isAuthed && profile && <ChillingProfileCard profile={profile} identity={{ nickname: post.author.nickname }} />}
      {!!error && <ThemedText type="small" accessibilityRole="alert">{error}</ThemedText>}
    </>}
    <Pressable analyticsId="components_chilling-host-profile.pressable.3" accessibilityRole="button" accessibilityState={{ expanded: infoOpen }} onPress={() => { play('selection'); setInfoOpen(value => !value); }} style={styles.disclosure}>
      <ThemedText type="smallBold">참여 안내</ThemedText><ThemedText themeColor="textSecondary">{infoOpen ? '−' : '＋'}</ThemedText>
    </Pressable>
    {infoOpen && <View style={styles.factBody}><ThemedText type="small" themeColor="textSecondary">{recommendedAgeLabel(post.room)}{post.room.recommendedAgeMin != null ? ' · 권장 범위 밖이어도 신청 가능' : ''}</ThemedText>
      {!!post.room.timezone && <ThemedText type="small" themeColor="textSecondary">일정은 {post.room.timezone} 기준이에요.</ThemedText>}
      <ThemedText type="small" themeColor="textSecondary">준비물·참가비·집결 안내는 모임장 공지와 모임 대화에서 확인해 주세요.</ThemedText>
    </View>}
  </View>;
}
const styles = StyleSheet.create({
  content: { padding: Spacing.four, gap: Spacing.three }, badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }, badge: { borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  facts: { borderRadius: 22, borderWidth: 1, paddingHorizontal: Spacing.four }, fact: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three, paddingVertical: Spacing.four },
  factBody: { flex: 1, gap: Spacing.one }, factValue: { fontSize: 16, lineHeight: 24, fontWeight: '600' }, icon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, divider: { borderTopWidth: 1 },
  status: { borderRadius: 16, padding: Spacing.three, gap: Spacing.one }, disclosure: { minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, borderBottomWidth: 1, paddingVertical: Spacing.two },
});
