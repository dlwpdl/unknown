import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChillingProfileCard } from '@/components/chilling-profile-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { getChillingError, loadChillingHostProfile, loadChillingProfile, saveChillingProfile, type ChillingProfile } from '@/lib/chilling-data';
import { supabase } from '@/lib/supabase';

export default function MeetupProfileRoute() {
  const { me, isAuthed } = useAuth();
  const { postId } = useLocalSearchParams<{ postId?: string }>();
  return <ProfileForm key={`${isAuthed ? me.id : 'guest'}:${postId ?? 'mine'}`} postId={postId} />;
}
function ProfileForm({ postId }: { postId?: string }) {
  const theme = useTheme(), router = useRouter();
  const { isAuthed, promptLogin } = useAuth();
  const [profile, setProfile] = useState<ChillingProfile>({ intro: '', interests: [], promptOne: '', promptTwo: '' });
  const [interests, setInterests] = useState('');
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [loaded, setLoaded] = useState(false), [retry, setRetry] = useState(0);
  const mounted = useRef(true), saveBusy = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    void (postId ? loadChillingHostProfile(supabase, postId) : loadChillingProfile(supabase)).then(value => {
      if (!active) return;
      if (value) { setProfile(value); setInterests(value.interests.join(', ')); }
      setLoaded(true);
      if (postId && !value) setError('지금은 이 프로필을 볼 수 없어요.');
    }).catch(e => { if (active) setError(getChillingError(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isAuthed, postId, retry]);
  const back = () => router.canGoBack() ? router.back() : router.replace('/(tabs)/meetups');
  const save = async () => {
    if (saveBusy.current || !loaded) return;
    saveBusy.current = true;
    setSaving(true); setError('');
    try {
      await saveChillingProfile(supabase, { ...profile, interests: interests.split(',').map(x => x.trim()).filter(Boolean) });
      if (mounted.current) back();
    } catch (e) { if (mounted.current) setError(getChillingError(e)); }
    finally { saveBusy.current = false; if (mounted.current) setSaving(false); }
  };
  return <ThemedView style={styles.fill}><SafeAreaView style={styles.fill}>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Pressable onPress={back} accessibilityRole="button" style={styles.button}><ThemedText themeColor="accent">‹ 돌아가기</ThemedText></Pressable>
        <ThemedText type="title">{postId ? '호스트 모임 프로필' : '내 모임 프로필'}</ThemedText>
        {!isAuthed ? <Pressable onPress={() => promptLogin('모임 프로필을 확인하려면 로그인해 주세요.')} style={styles.button} accessibilityRole="button"><ThemedText themeColor="accent">로그인하기</ThemedText></Pressable>
          : loading ? <ActivityIndicator color={theme.accent} accessibilityLabel="프로필 불러오는 중" />
            : postId ? loaded && !error && <ChillingProfileCard profile={profile} />
              : loaded && <>
                <ThemedText themeColor="textSecondary">스펙보다, 함께 노는 방식을 알려주세요.</ThemedText>
                {([{ key: 'intro', label: '한 줄 소개', limit: 160 }, { key: 'promptOne', label: '나랑 만나면 주로…', limit: 300 }, { key: 'promptTwo', label: '이런 모임이면 바로 신청해요', limit: 300 }] as const).map(field => <View key={field.key} style={styles.field}>
                  <ThemedText type="smallBold">{field.label}</ThemedText>
                  <TextInput accessibilityLabel={field.label} value={profile[field.key]} multiline maxLength={field.limit} editable={!saving}
                    onChangeText={text => setProfile(p => ({ ...p, [field.key]: text }))} style={[styles.input, { color: theme.text, borderColor: theme.line }]} />
                </View>)}
                <View style={styles.field}><ThemedText type="smallBold">관심사 · 쉼표로 구분, 최대 8개</ThemedText>
                  <TextInput accessibilityLabel="관심사" value={interests} onChangeText={setInterests} editable={!saving} maxLength={248} placeholder="산책, 커피, 여행" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, borderColor: theme.line }]} /></View>
                <ThemedText type="small" themeColor="textSecondary">개최하면 행사에서 호스트 프로필이 공개돼요. 신청할 때는 공유 내용을 먼저 확인하고 해당 호스트에게만 보내요. 안전을 위해 자동 분석과 권한 있는 운영자 검토가 적용돼요.</ThemedText>
                <Pressable accessibilityRole="button" disabled={saving} accessibilityState={{ disabled: saving, busy: saving }} onPress={() => void save()} style={[styles.primary, { backgroundColor: theme.accent, opacity: saving ? 0.6 : 1 }]}>
                  <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{saving ? '저장 중…' : '프로필 저장'}</ThemedText>
                </Pressable>
              </>}
        {!!error && <><ThemedText accessibilityRole="alert" themeColor="accent">{error}</ThemedText>
          {!loaded && <Pressable onPress={() => { setLoading(true); setError(''); setRetry(x => x + 1); }} accessibilityRole="button" style={styles.button}><ThemedText>다시 불러오기</ThemedText></Pressable>}</>}
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView></ThemedView>;
}
const styles = StyleSheet.create({
  fill: { flex: 1 }, content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.six },
  button: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }, field: { gap: Spacing.two },
  input: { borderWidth: 1, borderRadius: 12, padding: Spacing.three, minHeight: 52, textAlignVertical: 'top', fontSize: 16 },
  primary: { minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
});
