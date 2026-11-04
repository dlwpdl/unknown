import { useLanguage } from '@/hooks/use-language';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Reanimated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { GlingLoader } from '@/components/gling-loader';
import { useFriendShareNotice } from '@/components/profile-overview';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ControlStyles, controlPresentation } from '@/constants/design-system';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { count } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES } from '@/lib/mock';
import { friendErrorMessage, loadMyFriends, setFriendship, type FriendAction, type FriendPerson, type MyFriends } from '@/lib/profile-friends';
import { supabase } from '@/lib/supabase';

// Friend requests and friends of the signed-in member. Nobody else's requests are ever readable (get_my_friends).
export default function FriendsScreen() {
  const { tr } = useLanguage(), theme = useTheme(), router = useRouter(), { play } = useInteractionFeedback(), reduced = useReducedMotion();
  const { me, isAuthed } = useAuth();
  const [result, setResult] = useState<{ user: string; friends: MyFriends | null; failed: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const current = result?.user === me.id ? result : null;
  const notice = useFriendShareNotice();
  useFocusEffect(useCallback(() => {
    if (!isAuthed) return;
    let active = true;
    void loadMyFriends(supabase).then(friends => { if (active) setResult({ user: me.id, friends, failed: false }); })
      .catch(() => { if (active) setResult({ user: me.id, friends: null, failed: true }); });
    return () => { active = false; };
  // revision re-reads the list after an accept, decline or cancel.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, me.id, revision]));

  const act = async (person: FriendPerson, action: FriendAction) => {
    if (busy) return;
    setBusy(person.id); setError('');
    try { await setFriendship(supabase, person.id, action); play(action === 'accept' ? 'success' : 'selection'); setRevision(value => value + 1); }
    catch (failure) { setError(friendErrorMessage(failure)); play('warning'); }
    finally { setBusy(null); }
  };
  const small = (person: FriendPerson, action: FriendAction, label: string, primary = false) =>
    <Pressable analyticsId={`profile.friends.${action}`} accessibilityRole="button" accessibilityLabel={`${person.nickname}, ${label}`}
      accessibilityState={{ disabled: !!busy, busy: busy === person.id }} disabled={!!busy}
      onPress={() => { play('selection'); if (action === 'accept') void notice.confirm(() => void act(person, action)); else void act(person, action); }}
      style={({ pressed }) => [ControlStyles.pill, styles.border, controlPresentation(theme, { tone: primary ? 'primary' : 'secondary', pressed, busy: busy === person.id }).container]}>
      <ThemedText type="smallBold" style={controlPresentation(theme, { tone: primary ? 'primary' : 'secondary' }).text}>{label}</ThemedText>
    </Pressable>;
  const section = (id: string, title: string, people: FriendPerson[], actions: (person: FriendPerson) => ReactNode) => !!people.length &&
    <View style={styles.section} key={id}>
      <ThemedText type="smallBold">{title} <ThemedText type="small" themeColor="textSecondary">{count(people.length)}</ThemedText></ThemedText>
      {people.map((person, index) => <Reanimated.View key={person.id} entering={reduced ? FadeIn.duration(150) : FadeInDown.delay(Math.min(index, 8) * 40).duration(220)}
        style={[styles.person, { borderBottomColor: theme.line }]}>
        <Pressable analyticsId="profile.friends.open" accessibilityRole="link" accessibilityLabel={tr('{0} 프로필 보기', person.nickname)}
          onPress={() => { play('selection'); router.push({ pathname: '/user/[id]', params: { id: person.id, nickname: person.nickname } }); }} style={styles.personMain}>
          <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}><ThemedText type="smallBold" style={{ color: theme.accent }}>{person.nickname[0]}</ThemedText></View>
          <View style={styles.personText}>
            <ThemedText type="smallBold" numberOfLines={1}>{person.nickname}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{person.neighborhood ?? tr(CITIES.find(city => city.id === person.cityId)?.name ?? '')}</ThemedText>
          </View>
        </Pressable>
        <View style={styles.actions}>{actions(person)}</View>
      </Reanimated.View>)}
    </View>;
  const friends = current?.friends;
  return <ThemedView style={styles.container}><SafeAreaView style={styles.safeArea} edges={['bottom']}>
    <ScrollView analyticsId="profile.friends.scroll" contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      {!current && <GlingLoader color={theme.accent} accessibilityLabel={tr('불러오는 중')} style={{ marginVertical: Spacing.four }} />}
      {current?.failed && <View style={styles.state}>
        <ThemedText type="small">{tr('친구 목록을 불러오지 못했어요.')}</ThemedText>
        <Pressable analyticsId="profile.friends.retry" accessibilityRole="button" onPress={() => { play('selection'); setResult(null); setRevision(value => value + 1); }}
          style={({ pressed }) => [ControlStyles.pill, styles.border, controlPresentation(theme, { pressed }).container]}><ThemedText type="smallBold">{tr('다시 불러오기')}</ThemedText></Pressable>
      </View>}
      {!!error && <ThemedText type="small" accessibilityRole="alert">{error}</ThemedText>}
      {friends && <>
        {section('incoming', tr('받은 친구 요청'), friends.incoming, person => <>{small(person, 'accept', tr('수락'), true)}{small(person, 'decline', tr('거절'))}</>)}
        {section('outgoing', tr('보낸 요청'), friends.outgoing, person => small(person, 'cancel', tr('취소')))}
        {section('friends', tr('친구'), friends.friends, () => null)}
        {!friends.incoming.length && !friends.outgoing.length && !friends.friends.length && <View style={styles.state}>
          <ThemedText type="smallBold">{tr('아직 친구가 없어요')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.center}>{tr('이웃 프로필에서 친구 추가를 누르고, 상대가 받으면 친구가 돼요.')}</ThemedText>
        </View>}
      </>}
    </ScrollView>
    {notice.sheet}
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth },
  content: { padding: Spacing.three, gap: Spacing.four },
  section: { gap: Spacing.one },
  person: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  personMain: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 },
  personText: { flex: 1, minWidth: 0, gap: 2 },
  avatar: { width: 40, height: 40, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: Spacing.two },
  border: { borderWidth: 1 },
  state: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
  center: { textAlign: 'center' },
});
