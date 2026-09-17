import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, DeviceEventEmitter, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChillingProfileCard } from '@/components/chilling-profile-card';
import { ChillingEventSchedule } from '@/components/chilling-event';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useAuth } from '@/lib/auth';
import { getChillingError, loadChillingProfile, requestChillingJoin, type ChillingProfile } from '@/lib/chilling-data';
import { MEETUPS_CHANGED_EVENT, requestMeetupJoin } from '@/lib/community-data';
import { loadPublicPost } from '@/lib/feed-data';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

export default function MeetupJoinRoute() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { me, isAuthed } = useAuth();
  return <JoinForm key={`${postId}:${isAuthed ? me.id : 'guest'}`} postId={postId} />;
}
function JoinForm({ postId }: { postId: string }) {
  const theme = useTheme(), router = useRouter(), hidden = useContentVisibility();
  const { isAuthed, promptLogin, me } = useAuth();
  const [post, setPost] = useState<Post | null>(null), [profile, setProfile] = useState<ChillingProfile | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [answer, setAnswer] = useState(''), [consent, setConsent] = useState(false), [sending, setSending] = useState(false), [sent, setSent] = useState(false);
  const busy = useRef(false);
  useFocusEffect(useCallback(() => {
    let active = true;
    setConsent(false); setLoading(true); setError(''); setPost(null); setProfile(null);
    if (!isAuthed) { setLoading(false); return; }
    void loadPublicPost(supabase, postId).then(async value => {
      const ownProfile = value?.room?.eventKind ? await loadChillingProfile(supabase) : null;
      if (active) { setPost(value); setProfile(ownProfile); }
    }).catch(e => { if (active) setError(getChillingError(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  // retry deliberately re-runs the focused screen's load after an explicit retry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, postId, retry]));
  const back = () => router.canGoBack() ? router.back() : router.replace('/(tabs)/meetups');
  const unavailable = !post?.room || hidden('post', post.id, post.author.id) || post.room.closed;
  const own = post?.author.id === me.id;
  const modern = !!post?.room?.eventKind;
  const submit = async () => {
    if (busy.current || unavailable || own || !post || (modern && (!profile || !consent))) return;
    busy.current = true; setSending(true); setError('');
    try {
      if (modern) await requestChillingJoin(supabase, post.id, answer, consent);
      else await requestMeetupJoin(supabase, post.id, answer);
      DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT); setSent(true);
    } catch (e) { setError(getChillingError(e)); }
    finally { busy.current = false; setSending(false); }
  };
  return <ThemedView style={styles.fill}><SafeAreaView style={styles.fill}>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Pressable onPress={back} accessibilityRole="button" style={styles.button}><ThemedText themeColor="accent">‹ 돌아가기</ThemedText></Pressable>
        <ThemedText type="title">{sent ? '신청을 보냈어요' : '참여 신청'}</ThemedText>
        {!isAuthed ? <Pressable onPress={() => promptLogin('참여하려면 로그인해 주세요.')} style={styles.button} accessibilityRole="button"><ThemedText themeColor="accent">로그인하기</ThemedText></Pressable>
          : loading ? <ActivityIndicator color={theme.accent} accessibilityLabel="신청 정보 불러오는 중" />
            : unavailable ? <ThemedText>모집이 마감됐거나 볼 수 없는 모임이에요.</ThemedText>
              : own ? <ThemedText>내가 개최한 모임이에요. 대화 탭에서 신청자를 확인할 수 있어요.</ThemedText>
                : sent ? <><ThemedText>호스트가 확인하면 알려드릴게요. 승인 후 모임 대화에서 자세한 집결 장소를 확인하세요.</ThemedText><Pressable onPress={back} style={styles.button} accessibilityRole="button"><ThemedText themeColor="accent">돌아가기</ThemedText></Pressable></>
                  : <>
                    <ThemedText type="subtitle">{post!.title}</ThemedText>
                    <ChillingEventSchedule room={post!.room!} />
                    {modern && !profile ? <>
                      <ThemedText>함께할 사람들에게 나를 소개할 모임 프로필이 필요해요.</ThemedText>
                      <Pressable onPress={() => router.push('/meetup-profile')} accessibilityRole="button" style={styles.button}><ThemedText themeColor="accent">모임 프로필 작성하기</ThemedText></Pressable>
                    </> : <>
                      {profile && <><ThemedText type="smallBold">{post!.author.nickname}님에게 이렇게 공유돼요</ThemedText><ChillingProfileCard profile={profile} />
                        <Pressable onPress={() => router.push('/meetup-profile')} accessibilityRole="button" style={styles.button}><ThemedText themeColor="accent">프로필 수정</ThemedText></Pressable></>}
                      <ThemedText type="smallBold">{post!.room!.applicationQuestion || '호스트에게 간단히 소개해 주세요'}</ThemedText>
                      <TextInput value={answer} onChangeText={setAnswer} accessibilityLabel="신청 답변" multiline maxLength={300} editable={!sending} placeholder="기대하는 만남을 알려주세요." placeholderTextColor={theme.textSecondary} style={[styles.input, { borderColor: theme.line, color: theme.text }]} />
                      {modern && <Pressable onPress={() => setConsent(v => !v)} disabled={sending} accessibilityRole="checkbox" accessibilityState={{ checked: consent, disabled: sending }} style={styles.consent}>
                        <ThemedText themeColor="accent">{consent ? '☑' : '□'}</ThemedText><ThemedText type="small" style={styles.flex}>이 호스트에게 내 모임 프로필과 답변을 공유하는 데 동의해요. 다른 신청자에게는 공개되지 않아요. 신청 취소·거절·탈퇴·차단 후 호스트 열람은 종료돼요.</ThemedText>
                      </Pressable>}
                      <ThemedText type="small" themeColor="textSecondary">안전을 위한 자동 분석과 권한 있는 운영자 검토가 적용돼요. 신청 취소는 모임 탭의 내 모임에서 할 수 있어요.</ThemedText>
                      <Pressable onPress={() => void submit()} accessibilityRole="button" disabled={sending || (modern && !consent)} accessibilityState={{ disabled: sending || (modern && !consent), busy: sending }} style={[styles.primary, { backgroundColor: theme.accent, opacity: sending || (modern && !consent) ? 0.5 : 1 }]}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>{sending ? '보내는 중…' : '신청 보내기'}</ThemedText></Pressable>
                    </>}
                  </>}
        {!!error && <><ThemedText accessibilityRole="alert" themeColor="accent">{error}</ThemedText><Pressable onPress={() => setRetry(v => v + 1)} accessibilityRole="button" style={styles.button}><ThemedText>다시 불러오기</ThemedText></Pressable></>}
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView></ThemedView>;
}
const styles = StyleSheet.create({
  fill: { flex: 1 }, flex: { flex: 1 }, content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.six },
  button: { minHeight: 44, justifyContent: 'center' }, input: { minHeight: 100, borderWidth: 1, borderRadius: 12, padding: Spacing.three, fontSize: 16, textAlignVertical: 'top' },
  consent: { minHeight: 44, flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' }, primary: { minHeight: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center', padding: Spacing.three },
});
