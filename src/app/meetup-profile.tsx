import { GlingLoader } from '@/components/gling-loader';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import { Alert, Keyboard, KeyboardAvoidingView, LayoutAnimation, Modal, Platform, ScrollView as NativeScrollView, StyleSheet, TextInput, UIManager, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChillingProfileCard } from '@/components/chilling-profile-card';
import { CityPicker } from '@/components/city-picker';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Depth, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { getChillingError, loadChillingHostProfile, loadChillingProfile, saveChillingProfile, type ChillingProfile } from '@/lib/chilling-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';
import { CITIES } from '@/lib/mock';

export default function MeetupProfileRoute() {
  const { me, isAuthed } = useAuth();
  const { postId, returnPostId } = useLocalSearchParams<{ postId?: string; returnPostId?: string }>();
  return <ProfileForm key={`${isAuthed ? me.id : 'guest'}:${postId ?? 'mine'}`} postId={postId} returnPostId={returnPostId} />;
}
function ProfileForm({ postId, returnPostId }: { postId?: string; returnPostId?: string }) {
  const theme = useTheme(), router = useRouter();
  const { isAuthed, me, setProfilePhoto, promptLogin } = useAuth();
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const [profile, setProfile] = useState<ChillingProfile>({ intro: '', interests: [], promptOne: '', promptTwo: '' });
  const [tags, setTags] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const scroll = useRef<NativeScrollView>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [tagOpen, setTagOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState<'intro' | 'promptOne' | 'promptTwo' | null>(null);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [cityOpen, setCityOpen] = useState(false), [photoSaving, setPhotoSaving] = useState(false);
  const [error, setError] = useState(''), [loaded, setLoaded] = useState(false), [retry, setRetry] = useState(0);
  const mounted = useRef(true), saveBusy = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    void (postId ? loadChillingHostProfile(supabase, postId) : loadChillingProfile(supabase)).then(value => {
      if (!active) return;
      if (value) { setProfile(value); setTags(value.interests); }
      setLoaded(true);
      if (postId && !value) setError('지금은 이 프로필을 볼 수 없어요.');
    }).catch(e => { if (active) setError(getChillingError(e)); })
      .finally(() => { if (active) {
        if (!reducedMotion && Platform.OS !== 'web') {
          if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);
          LayoutAnimation.configureNext({ duration: 220, create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity } });
        }
        setLoading(false);
      } });
    return () => { active = false; };
  }, [isAuthed, postId, retry, reducedMotion]);
  const back = () => router.canGoBack() ? router.back() : returnPostId
    ? router.replace({ pathname: '/meetup-join', params: { postId: returnPostId } }) : router.replace('/(tabs)/meetups');
  const cityName = CITIES.find(city => city.id === me.cityId)?.name;
  // 선택 사항인 사진은 빼고 저장에 필요한 네 항목만 센다.
  const complete = [profile.intro.trim(), profile.promptOne.trim(), profile.promptTwo.trim(), tags.length].filter(Boolean).length;
  const steps = ['먼저, 나답게', '함께하면 어떤 사람?', '끌리는 모임은?', '취향을 골라봐요', '이렇게 소개돼요'];
  const stepReady = step === 0 ? !!profile.intro.trim() : step === 1 ? !!profile.promptOne.trim()
    : step === 2 ? !!profile.promptTwo.trim() : step === 3 ? tags.length > 0 || !!tagDraft.trim() : complete === 4;
  const changeStep = (next: number) => {
    Keyboard.dismiss(); setCustomOpen(null);
    if (!reducedMotion && Platform.OS !== 'web') LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setStep(next); scroll.current?.scrollTo({ y: 0, animated: false });
  };
  const addTags = (raw: string) => {
    const next = raw.split(',').map(value => value.trim()).filter(Boolean);
    if (next.length) setTags(current => [...new Set([...current, ...next])].slice(0, 8));
    setTagDraft('');
  };
  const pickPhoto = async () => {
    if (photoSaving || saving) return;
    play('selection');
    setPhotoSaving(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8, base64: true,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      const asset = result.assets?.[0];
      if (!result.canceled && asset?.uri && asset.base64) { await setProfilePhoto(asset.uri, asset.base64); play('success'); }
    } catch { play('warning'); Alert.alert('사진을 바꾸지 못했어요', '잠시 후 다시 시도해 주세요.'); }
    finally { if (mounted.current) setPhotoSaving(false); }
  };
  const save = async () => {
    if (saveBusy.current || !loaded || photoSaving || complete !== 4) return;
    play('selection');
    saveBusy.current = true;
    setSaving(true); setError('');
    try {
      const interests = [...new Set([...tags, ...tagDraft.split(',').map(value => value.trim()).filter(Boolean)])].slice(0, 8);
      await saveChillingProfile(supabase, { ...profile, interests });
      if (mounted.current) { play('success'); back(); }
    } catch (e) { if (mounted.current) { play('warning'); setError(getChillingError(e)); } }
    finally { saveBusy.current = false; if (mounted.current) setSaving(false); }
  };
  return <ThemedView style={styles.fill}><SafeAreaView style={styles.fill}>
    {/* 한 번에 한 질문, 다음 행동은 항상 손 닿는 곳에 둔다. */}
    <View style={[styles.appbar, { backgroundColor: theme.background }]}>
      <Pressable analyticsId="app_meetup-profile.pressable.1" onPress={() => { play('selection'); if (!postId && step > 0) changeStep(step - 1); else back(); }} accessibilityRole="button" accessibilityLabel={step > 0 && !postId ? '이전 질문' : '뒤로가기'} style={({ pressed }) => [styles.appbarButton, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
        <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={22} tintColor={theme.text} />
      </Pressable>
      <ThemedText accessibilityRole="header" style={styles.appbarTitle}>{postId ? '호스트 모임 프로필' : '모임 프로필'}</ThemedText>
      <View style={styles.appbarButton} />
    </View>
    {isAuthed && !postId && loaded && <View style={styles.progress} accessibilityLabel={`프로필 작성 ${step + 1}단계, 총 5단계. 필수 항목 ${complete}/4 완료`}>
      {steps.map((label, index) => <View key={label} style={[styles.bar, { backgroundColor: index <= step ? theme.accent : theme.backgroundElement }]} />)}
      <ThemedText type="small" themeColor="textSecondary">{step + 1}/5</ThemedText>
    </View>}
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {loading && isAuthed ? <View style={styles.center}><GlingLoader color={theme.accent} accessibilityLabel="프로필 불러오는 중" /></View> : <ScrollView ref={scroll} analyticsId="app_meetup-profile.scrollview.1" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}
        onLayout={() => { if (TextInput.State.currentlyFocusedInput()) scroll.current?.scrollToEnd({ animated: false }); }}>
        {!isAuthed ? <Pressable analyticsId="app_meetup-profile.pressable.2" onPress={() => { play('selection'); promptLogin('모임 프로필을 확인하려면 로그인해 주세요.'); }} style={styles.button} accessibilityRole="button"><ThemedText themeColor="accent">로그인하기</ThemedText></Pressable>
          : postId ? loaded && !error && <ChillingProfileCard profile={profile} />
              : loaded && <>
                <View style={styles.field}>
                  <ThemedText type="subtitle" style={styles.stepTitle}>{steps[step]}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{step === 4 ? '모임장에게 공유될 나의 카드예요.' : '스펙보다, 함께 노는 방식을 알려주세요.'}</ThemedText>
                </View>
                {step === 0 && <>
                <View style={styles.photoRow}>
                  {me.photoUri
                    ? <Image source={{ uri: me.photoUri }} style={styles.photo} contentFit="cover" />
                    : <View style={[styles.photo, styles.photoFallback, { backgroundColor: theme.backgroundElement }]}><ThemedText style={styles.photoLetter}>{me.nickname.slice(0, 1)}</ThemedText></View>}
                  <View style={styles.photoBody}>
                    <ThemedText type="subtitle">{me.nickname}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">사진은 선택이에요.</ThemedText>
                    <Pressable analyticsId="app_meetup-profile.pressable.5" accessibilityRole="button" onPress={() => void pickPhoto()} disabled={saving || photoSaving} accessibilityState={{ disabled: saving || photoSaving, busy: photoSaving }} style={({ pressed }) => [styles.ghost, Depth.control, { borderColor: theme.line, backgroundColor: theme.card, transform: [{ translateY: pressed ? 2 : 0 }] }]}>
                      <ThemedText type="smallBold" themeColor="accent">{photoSaving ? '사진 저장 중…' : me.photoUri ? '사진 바꾸기' : '사진 선택'}</ThemedText>
                    </Pressable>
                  </View>
                </View>
                <View style={styles.field}>
                  <ThemedText type="smallBold">활동 지역</ThemedText>
                  <Pressable analyticsId="app_meetup-profile.pressable.12" accessibilityRole="button" accessibilityLabel="활동 지역 선택" disabled={saving || photoSaving}
                    onPress={() => { play('selection'); Keyboard.dismiss(); setCityOpen(true); }} style={({ pressed }) => [styles.region, { borderColor: theme.line, backgroundColor: pressed ? theme.backgroundSelected : theme.card }]}>
                    <ThemedText>{cityName ?? '활동 지역을 선택해 주세요'}</ThemedText><ThemedText type="small" themeColor="accent">변경</ThemedText>
                  </Pressable>
                  <ThemedText type="small" themeColor="textSecondary">계정과 같은 지역이에요. 정확한 위치는 표시하지 않아요.</ThemedText>
                </View>
                </>}
                {([
                  { key: 'intro', label: '한 줄 소개', hint: '하나를 고르거나 직접 적어주세요.', limit: 160, examples: ['처음엔 조용하지만 금방 편해져요', '먼저 말을 거는 편이에요', '함께 활동하는 걸 좋아해요'] },
                  { key: 'promptOne', label: '나랑 만나면 주로…', hint: '하나를 고르거나 직접 적어주세요.', limit: 300, examples: ['페스티벌 같이 가기', '라이브 공연 보기', '조용한 카페에서 수다', '가볍게 걷기', '맛집 원정', '보드게임', '맥주 한잔'] },
                  { key: 'promptTwo', label: '이런 모임이면 바로 신청해요', hint: '하나를 고르거나 직접 적어주세요.', limit: 300, examples: ['공연 취향이 맞는 사람들', '소규모(4명 이하)', '주말 낮', '처음 보는 사람과도 편한 분위기'] },
                ] as const).filter((_, index) => index === step).map(field => <View key={field.key} style={[styles.promptPanel, { backgroundColor: theme.card }]}>
                  <ThemedText style={styles.question}>{field.label}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{field.hint}</ThemedText>
                  <View style={styles.choices}>{field.examples.map(example => {
                    const selected = profile[field.key] === example;
                    return <Pressable analyticsId="app_meetup-profile.pressable.4" key={example} accessibilityRole="button" accessibilityLabel={example}
                      accessibilityState={{ selected, disabled: saving }} disabled={saving}
                      onPress={() => { play('selection'); Keyboard.dismiss(); setCustomOpen(null); setProfile(p => ({ ...p, [field.key]: p[field.key] === example ? '' : example })); }}
                      style={({ pressed }) => [styles.choice, { borderColor: selected ? theme.accent : theme.line, backgroundColor: selected ? theme.backgroundSelected : theme.card, opacity: pressed ? 0.7 : 1 }]}>
                      <ThemedText style={styles.choiceText}>{example}</ThemedText>
                      <SymbolView name={selected ? { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' } : { ios: 'circle', android: 'radio_button_unchecked', web: 'radio_button_unchecked' }} size={20} tintColor={selected ? theme.accent : theme.textSecondary} />
                    </Pressable>;
                  })}</View>
                  {customOpen === field.key || (profile[field.key] && !field.examples.some(example => profile[field.key] === example))
                    ? <TextInput accessibilityLabel={`${field.label} 직접 입력`} value={profile[field.key]} autoFocus={customOpen === field.key}
                        placeholder="직접 적어주세요" placeholderTextColor={theme.textSecondary} multiline maxLength={field.limit} editable={!saving}
                        onFocus={() => scroll.current?.scrollToEnd({ animated: false })}
                        onChangeText={text => setProfile(p => ({ ...p, [field.key]: text }))} style={[styles.input, { color: theme.text, borderColor: theme.line }]} />
                    : <Pressable analyticsId="app_meetup-profile.pressable.11" accessibilityRole="button" accessibilityLabel={`${field.label} 직접 입력`}
                        disabled={saving} onPress={() => { play('selection'); setCustomOpen(field.key); }}
                        style={({ pressed }) => [styles.promptChip, Depth.control, { alignSelf: 'flex-start', borderColor: theme.line, backgroundColor: theme.card, transform: [{ translateY: pressed ? 2 : 0 }] }]}>
                        <ThemedText type="small" themeColor="textSecondary">＋ 직접 입력</ThemedText>
                      </Pressable>}
                  <ThemedText type="small" themeColor="textSecondary" style={styles.count}>{profile[field.key].length}/{field.limit}</ThemedText>
                </View>)}
                {step === 3 && <View style={styles.field}>
                  <ThemedText type="smallBold">관심사 <ThemedText type="small" themeColor="textSecondary">필수</ThemedText></ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">선택하거나 직접 추가해 주세요. 최대 8개.</ThemedText>
                  <View style={styles.chips}>
                    {tags.map(tag => <Pressable analyticsId="app_meetup-profile.pressable.6" key={tag} accessibilityRole="button" accessibilityLabel={`${tag} 삭제`}
                      disabled={saving} onPress={() => { play('selection'); setTags(current => current.filter(value => value !== tag)); }}
                      style={({ pressed }) => [styles.promptChip, Depth.control, { borderColor: theme.accentDepth, backgroundColor: theme.accent, transform: [{ translateY: pressed ? 2 : 0 }] }]}>
                      <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{`${tag} ✕`}</ThemedText>
                    </Pressable>)}
                    {tags.length < 8 && ['페스티벌', '라이브 공연', '파티', '산책', '커피', '맛집', '여행', '보드게임', '운동'].filter(tag => !tags.includes(tag)).map(tag =>
                      <Pressable analyticsId="app_meetup-profile.pressable.10" key={tag} accessibilityRole="button" accessibilityLabel={`${tag} 추가`}
                        disabled={saving} onPress={() => { play('selection'); Keyboard.dismiss(); setTags(current => current.length >= 8 || current.includes(tag) ? current : [...current, tag]); }}
                        style={({ pressed }) => [styles.promptChip, Depth.control, { borderColor: theme.line, backgroundColor: theme.backgroundElement, transform: [{ translateY: pressed ? 2 : 0 }] }]}>
                        <ThemedText type="small">＋ {tag}</ThemedText>
                      </Pressable>)}
                    {tags.length < 8 && (tagOpen
                      ? <TextInput autoFocus accessibilityLabel="관심사 추가" value={tagDraft} maxLength={20} editable={!saving} returnKeyType="done"
                        onFocus={() => scroll.current?.scrollToEnd({ animated: false })}
                        onChangeText={setTagDraft} onSubmitEditing={() => addTags(tagDraft)} onBlur={() => { addTags(tagDraft); setTagOpen(false); }}
                        placeholder="예: 산책" placeholderTextColor={theme.textSecondary} style={[styles.tagInput, { color: theme.text, borderColor: theme.accent }]} />
                      : <Pressable analyticsId="app_meetup-profile.pressable.7" accessibilityRole="button" accessibilityLabel="관심사 추가"
                        disabled={saving} onPress={() => { play('selection'); setTagOpen(true); }} style={({ pressed }) => [styles.promptChip, Depth.control, { borderColor: theme.line, backgroundColor: theme.card, transform: [{ translateY: pressed ? 2 : 0 }] }]}>
                        <ThemedText type="small" themeColor="textSecondary">＋ 추가</ThemedText>
                      </Pressable>)}
                  </View>
                </View>}
                {step === 4 && <>
                <ChillingProfileCard profile={{ ...profile, interests: tags }} identity={me} />
                <ThemedText type="small" themeColor="textSecondary">모임을 열면 로그인한 회원이 내 카드를 볼 수 있어요. 참여 신청 시에는 확인과 동의 후 해당 호스트에게 카드와 답변을 보내요. 안전을 위해 자동 분석과 권한 있는 운영자 검토가 적용돼요.</ThemedText>
                </>}
              </>}
        {!!error && <><ThemedText accessibilityRole="alert" themeColor="accent">{error}</ThemedText>
          {!loaded && <Pressable analyticsId="app_meetup-profile.pressable.9" onPress={() => { play('selection'); setLoading(true); setError(''); setRetry(x => x + 1); }} accessibilityRole="button" style={styles.button}><ThemedText>다시 불러오기</ThemedText></Pressable>}</>}
      </ScrollView>}
      {isAuthed && !postId && loaded && !loading && <View style={[styles.footer, { borderColor: theme.line, backgroundColor: theme.background }]}>
        <ThemedText type="small" themeColor="textSecondary">필수 항목 {complete}/4 완료 · {step === 4 ? '저장하면 다음 모임에서도 사용할 수 있어요' : '답변은 나중에도 바꿀 수 있어요'}</ThemedText>
        {step === 4 ? <RaisedActionButton analyticsId="app_meetup-profile.pressable.8" disabled={saving || photoSaving || !stepReady} busy={saving} onPress={() => void save()} label={saving ? '저장 중…' : returnPostId ? '저장하고 신청 계속' : '이 프로필로 시작하기'} />
          : <RaisedActionButton analyticsId="app_meetup-profile.pressable.13" disabled={saving || photoSaving || !stepReady} onPress={() => { play('selection'); if (step === 3) addTags(tagDraft); changeStep(step + 1); }} label={step === 3 ? '내 프로필 미리보기' : '다음'} />}
      </View>}
    </KeyboardAvoidingView>
    <Modal visible={cityOpen} animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={() => setCityOpen(false)}>
      <SafeAreaView style={[styles.fill, { backgroundColor: theme.background }]}><CityPicker onClose={() => setCityOpen(false)} /></SafeAreaView>
    </Modal>
  </SafeAreaView></ThemedView>;
}
const styles = StyleSheet.create({
  region: { minHeight: 48, borderWidth: 1, borderRadius: 12, padding: Spacing.three, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: Spacing.two },
  fill: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.six },
  appbar: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three },
  appbarButton: { minHeight: 44, minWidth: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, appbarTitle: { flex: 1, fontSize: 17, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
  progress: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.four, paddingBottom: Spacing.two },
  bar: { flex: 1, height: 4, borderRadius: 999 },
  footer: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', borderTopWidth: 1, padding: Spacing.four, gap: Spacing.two },
  stepTitle: { fontSize: 28, lineHeight: 36 }, question: { fontSize: 22, lineHeight: 30, fontWeight: '600' },
  promptPanel: { borderRadius: 22, padding: Spacing.four, gap: Spacing.three },
  choices: { gap: Spacing.two }, choice: { minHeight: 52, borderRadius: 14, borderWidth: 1, padding: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  choiceText: { flex: 1, fontSize: 15, lineHeight: 22 }, count: { textAlign: 'right' },
  photoRow: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-start' },
  photo: { width: 80, height: 80, borderRadius: 26 },
  photoFallback: { alignItems: 'center', justifyContent: 'center' }, photoLetter: { fontSize: 22, fontWeight: '700' },
  photoBody: { flex: 1, gap: Spacing.one },
  ghost: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  promptChip: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderBottomWidth: 3, borderRadius: 999, paddingHorizontal: Spacing.three },
  tagInput: { minHeight: 44, minWidth: 120, borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three, fontSize: 15 },
  button: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }, field: { gap: Spacing.two },
  input: { borderWidth: 1, borderRadius: 12, padding: Spacing.three, minHeight: 52, maxHeight: 128, textAlignVertical: 'top', fontSize: 16 },
});
