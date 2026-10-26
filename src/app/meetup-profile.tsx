import { Typography } from '@/constants/design-system';
import { useLanguage } from '@/hooks/use-language';
import { GlingLoader } from '@/components/gling-loader';
import { Pressable, ScrollView, Switch } from '@/components/analytics-controls';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import { Alert, AppState, Keyboard, KeyboardAvoidingView, LayoutAnimation, Modal, Platform, type ScrollViewInstance, StyleSheet, TextInput, UIManager, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChillingProfileCard } from '@/components/chilling-profile-card';
import { InfoNote, MoreDetails, WhoSees } from '@/components/notice-blocks';
import { CityPicker } from '@/components/city-picker';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Depth, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { CHILLING_PROMPTS, chillingProfilePreview, getChillingError, loadChillingHostProfile, loadChillingMemberProfile, loadChillingProfile, normalizeChillingProfile, saveChillingProfile, type ChillingProfile } from '@/lib/chilling-data';
import { removeUnsavedMeetupPhotos, uploadMeetupProfilePhoto } from '@/lib/chilling-profile-media';
import { preparePostImage, type PreparedImage } from '@/lib/post-image-picker';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';
import { CITIES } from '@/lib/mock';

export default function MeetupProfileRoute() {

  const { me, isAuthed } = useAuth();
  const { postId, userId, returnPostId } = useLocalSearchParams<{ postId?: string; userId?: string; returnPostId?: string }>();
  return <ProfileForm key={`${isAuthed ? me.id : 'guest'}:${postId ?? 'mine'}:${userId ?? 'host'}`} postId={postId} userId={userId} returnPostId={returnPostId} />;
}
function ProfileForm({ postId, userId, returnPostId }: { postId?: string; userId?: string; returnPostId?: string }) {
  const { tr, language } = useLanguage();
  const theme = useTheme(), router = useRouter(), insets = useSafeAreaInsets();
  const { isAuthed, me, promptLogin } = useAuth();
  const viewer = me.id;
  const [initialCity] = useState(me.cityId);
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const [profile, setProfile] = useState<ChillingProfile>({ version: 2, displayName: '', cityId: me.cityId, photoPaths: [], publicPhotoPath: null,
    intro: '', interests: [], promptOne: '', promptTwo: '', promptOneId: 'meet', promptTwoId: 'join', shareWithMembers: false,
    preferences: { activities: [], availability: '', pace: 'any' } });
  const [photos, setPhotos] = useState<{ path?: string; uri: string | null; image?: PreparedImage }[]>([]);
  const [publicPhotoIndex, setPublicPhotoIndex] = useState<number | null>(null);
  const [privateActivities, setPrivateActivities] = useState('');
  const [audience, setAudience] = useState<'host' | 'members' | 'public'>('host');
  const [tags, setTags] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const scroll = useRef<ScrollViewInstance>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [tagOpen, setTagOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState<'intro' | 'promptOne' | 'promptTwo' | null>(null);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [cityOpen, setCityOpen] = useState(false), [photoSaving, setPhotoSaving] = useState(false);
  const [error, setError] = useState(''), [loaded, setLoaded] = useState(false), [retry, setRetry] = useState(0);
  const mounted = useRef(true), saveBusy = useRef(false), pickBusy = useRef(false), loadVersion = useRef(0);
  const viewerRef = useRef<string | null>(isAuthed ? viewer : null), focused = useRef(true), saveScope = useRef(0);
  useLayoutEffect(() => {
    mounted.current = true; viewerRef.current = isAuthed ? viewer : null; saveScope.current++;
    return () => { mounted.current = false; viewerRef.current = null; };
  }, [isAuthed, viewer]);
  useFocusEffect(useCallback(() => {
    focused.current = isAuthed && viewerRef.current === viewer; saveScope.current++;
    return () => { focused.current = false; saveScope.current++; };
  }, [isAuthed, viewer]));
  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    const generation = ++loadVersion.current;
    void (postId ? userId ? loadChillingMemberProfile(supabase, postId, userId) : loadChillingHostProfile(supabase, postId) : loadChillingProfile(supabase)).then(value => {
      if (!active || generation !== loadVersion.current) return;
      if (value) {
        setProfile(postId ? value : { ...value, version: 2, displayName: value.displayName ?? '', cityId: value.cityId || initialCity,
          promptOneId: value.promptOneId ?? 'meet', promptTwoId: value.promptTwoId ?? 'join', shareWithMembers: value.shareWithMembers === true,
          preferences: value.preferences ?? { activities: [], availability: '', pace: 'any' } });
        setTags(value.interests);
        setPhotos((value.photoPaths ?? []).map((path, index) => ({ path, uri: value.photoUris?.[index] ?? null })));
        const publicIndex = value.publicPhotoPath ? (value.photoPaths ?? []).indexOf(value.publicPhotoPath) : -1;
        setPublicPhotoIndex(publicIndex >= 0 ? publicIndex : null);
        setPrivateActivities(value.preferences?.activities.join(', ') ?? '');
        if (!postId && value.version === 2 && [value.displayName?.trim(), value.cityId, value.intro.trim()].every(Boolean)) setStep(4);
      }
      setLoaded(true);
      if (postId && !value) setError("지금은 이 프로필을 볼 수 없어요.");
    }).catch(e => { if (active && generation === loadVersion.current) setError(getChillingError(e)); })
      .finally(() => { if (active && generation === loadVersion.current) {
        if (!reducedMotion && Platform.OS !== 'web') {
          if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);
          LayoutAnimation.configureNext({ duration: 220, create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity } });
        }
        setLoading(false);
      } });
    return () => { active = false; };
  }, [isAuthed, postId, userId, retry, reducedMotion, initialCity]);
  useEffect(() => {
    if (!postId) return;
    const subscription = AppState.addEventListener('change', state => {
      loadVersion.current++;
      setLoaded(false); setProfile({ intro: '', interests: [], promptOne: '', promptTwo: '' });
      if (state === 'active') { setLoading(true); setError(''); setRetry(value => value + 1); }
    });
    return () => subscription.remove();
  }, [postId]);
  const back = () => router.canGoBack() ? router.back() : returnPostId
    ? router.replace({ pathname: '/meetup-join', params: { postId: returnPostId } }) : router.replace(Platform.OS === 'web' ? '/?tag=meetup' : '/(tabs)/meetups');
  const selectedCity = CITIES.find(city => city.id === profile.cityId) ?? CITIES.find(city => city.id === initialCity) ?? CITIES[0];
  const cityName = language === 'en' ? selectedCity.englishName : selectedCity.name;
  // Name, city and intro are required; the two prompts and interests are optional extras.
  const missing = ([[profile.displayName?.trim(), '모임에서 쓸 이름'], [profile.cityId, '활동 지역'], [profile.intro.trim(), '한 줄 소개']] as const).filter(([value]) => !value).map(([, label]) => tr(label));
  const complete = 3 - missing.length;
  const steps = ['먼저, 나답게', '함께하면 어떤 사람?', '끌리는 모임은?', '취향을 골라봐요', '이렇게 소개돼요'];
  const activities = [...new Set(privateActivities.split(',').map(value => value.trim()).filter(Boolean))];
  const activitiesInvalid = activities.length > 8 || activities.some(value => value.length > 30);
  const stepReady = (step === 0 || step === 4 ? complete === 3 : true) && !(step >= 3 && activitiesInvalid);
  // Leaving loses edits, so only a changed own-profile draft asks first.
  const snapshot = JSON.stringify([profile, tags, tagDraft, photos.map(photo => photo.path ?? photo.uri), publicPhotoIndex, privateActivities]);
  const [baseline, setBaseline] = useState<string | null>(null), [baseFor, setBaseFor] = useState<string | null>(null);
  if ((loaded ? viewer : null) !== baseFor) { setBaseFor(loaded ? viewer : null); setBaseline(loaded ? snapshot : null); }
  usePreventRemove(!postId && loaded && baseline !== null && baseline !== snapshot && !saving, ({ repeat }) => {
    const title = tr('작성 중인 프로필에서 나갈까요?'), message = tr('작성한 내용은 저장되지 않아요.');
    if (Platform.OS === 'web') { if (globalThis.confirm(`${title}\n${message}`)) repeat(); return; }
    Alert.alert(title, message, [{ text: tr('계속 작성'), style: 'cancel' }, { text: tr('나가기'), style: 'destructive', onPress: repeat }]);
  });
  const optionalEmpty = (step === 1 && !profile.promptOne.trim()) || (step === 2 && !profile.promptTwo.trim());
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
    if (pickBusy.current || saving || photos.length >= 3) return;
    pickBusy.current = true;
    play('selection');
    setPhotoSaving(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8, base64: true,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      const asset = result.assets?.[0];
      if (!result.canceled && asset?.uri) {
        const image = await preparePostImage(asset);
        if (mounted.current) { setPhotos(current => [...current, { uri: image.uri, image }].slice(0, 3)); play('success'); }
      }
    } catch { play('warning'); Alert.alert(tr("사진을 바꾸지 못했어요"), tr("잠시 후 다시 시도해 주세요.")); }
    finally { pickBusy.current = false; if (mounted.current) setPhotoSaving(false); }
  };
  const draftProfile = { ...profile, interests: tags, photoPaths: photos.map((photo, index) => photo.path ?? `${me.id}/pending-${index}.webp`),
    photoUris: photos.map(photo => photo.uri), publicPhotoPath: publicPhotoIndex === null ? null : photos[publicPhotoIndex]?.path ?? `${me.id}/pending-${publicPhotoIndex}.webp` };
  const save = async () => {
    const request = saveScope.current;
    const current = () => mounted.current && focused.current && viewerRef.current === viewer && request === saveScope.current;
    if (!current() || saveBusy.current || !loaded || photoSaving || complete !== 3) return;
    play('selection');
    saveBusy.current = true;
    setSaving(true); setError('');
    const uploaded: string[] = [];
    let saved = false;
    try {
      const interests = [...new Set([...tags, ...tagDraft.split(',').map(value => value.trim()).filter(Boolean)])].slice(0, 8);
      const draft = normalizeChillingProfile({ ...draftProfile, interests, preferences: { ...profile.preferences!,
        activities } });
      const paths: string[] = [];
      for (const photo of photos) {
        if (photo.path) paths.push(photo.path);
        else if (photo.image) { const path = await uploadMeetupProfilePhoto(supabase, viewer, photo.image); uploaded.push(path); if (!current()) return; paths.push(path); }
      }
      if (!current()) return;
      await saveChillingProfile(supabase, { ...draft, photoPaths: paths, publicPhotoPath: publicPhotoIndex === null ? null : paths[publicPhotoIndex] ?? null });
      saved = true;
      if (current()) { play('success'); back(); }
    } catch (e) { if (current()) { play('warning'); setError(getChillingError(e)); } }
    // An abandoned or failed save must not leave uploaded photos behind in storage.
    finally { if (!saved && uploaded.length) await removeUnsavedMeetupPhotos(supabase, uploaded); saveBusy.current = false; if (mounted.current && viewerRef.current === viewer) setSaving(false); }
  };
  return <ThemedView style={styles.fill}><SafeAreaView style={styles.fill}>
    {/* 한 번에 한 질문, 다음 행동은 항상 손 닿는 곳에 둔다. */}
    <View style={[styles.appbar, { backgroundColor: theme.background }]}>
      <Pressable analyticsId="app_meetup-profile.pressable.1" disabled={saving || photoSaving} onPress={() => { play('selection'); if (!postId && step > 0) changeStep(step - 1); else back(); }} accessibilityRole="button" accessibilityLabel={step > 0 && !postId ? tr("이전 질문") : tr("뒤로가기")} style={({ pressed }) => [styles.appbarButton, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
        <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={22} tintColor={theme.text} />
      </Pressable>
      <ThemedText accessibilityRole="header" style={styles.appbarTitle}>{postId ? tr("모임 프로필") : tr("모임 프로필 관리")}</ThemedText>
      {/* On the first step the back arrow already leaves, so 취소 only appears once back means "previous question". */}
      {!postId && step > 0 ? <Pressable analyticsId="meetup-profile.cancel" accessibilityRole="button" disabled={saving || photoSaving} style={styles.appbarButton} onPress={() => { play('selection'); back(); }}><ThemedText type="small" style={styles.helper}>{tr("취소")}</ThemedText></Pressable> : <View style={styles.appbarButton} />}
    </View>
    {isAuthed && !postId && loaded && <View accessible style={styles.progress} accessibilityLabel={tr("프로필 작성 {0}단계, 총 5단계. 필수 항목 {1}/3 완료", (step + 1), (complete))}>
      {steps.map((label, index) => <View key={label} style={[styles.bar, { backgroundColor: index <= step ? theme.accent : theme.backgroundElement }]} />)}
      <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{step + 1}/5</ThemedText>
    </View>}
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {loading && isAuthed ? <View style={styles.center}><GlingLoader color={theme.accent} accessibilityLabel={tr("프로필 불러오는 중")} /></View> : <ScrollView ref={scroll} analyticsId="app_meetup-profile.scrollview.1" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {!isAuthed ? <Pressable analyticsId="app_meetup-profile.pressable.2" onPress={() => { play('selection'); promptLogin('모임 프로필을 확인하려면 로그인해 주세요.'); }} style={styles.button} accessibilityRole="button"><ThemedText themeColor="accent" style={styles.bodyText}>{tr("로그인하기")}</ThemedText></Pressable>
          : postId ? loaded && !error && <ChillingProfileCard profile={profile} />
              : loaded && <>
                <View style={styles.field}>
                  <ThemedText type="subtitle" style={styles.stepTitle}>{tr(steps[step])}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{language === 'en' ? 'You have one meetup profile for all your meetups, separate from your personal profile.' : '일반 프로필과 별개로 계정당 하나를 만들고, 모든 모임에서 함께 사용해요.'}</ThemedText>
                </View>
                {step === 0 && <>
                <View style={styles.field}><ThemedText type="smallBold" style={styles.label}>{tr("모임에서 쓸 이름")}</ThemedText>
                  <TextInput accessibilityLabel={tr("모임에서 쓸 이름")} value={profile.displayName ?? ''} maxLength={30} editable={!saving} placeholder={tr("모임에서 불리고 싶은 이름")} placeholderTextColor={theme.textSecondary} onChangeText={displayName => setProfile(current => ({ ...current, displayName }))} style={[styles.input, { color: theme.text, borderColor: theme.line }]} />
                </View>
                <View style={styles.field}><ThemedText type="smallBold" style={styles.label}>{tr("모임 사진 · 선택, 최대 3장")}</ThemedText>
                  <View style={styles.photoRow}>{photos.map((photo, index) => <View key={photo.path ?? photo.uri ?? index} style={styles.photoBody}>
                    {photo.uri ? <Image source={{ uri: photo.uri }} cachePolicy="none" style={styles.photo} contentFit="cover" accessibilityLabel={tr("모임 사진 {0}", index + 1)} /> : <View style={[styles.photo, styles.photoFallback, { backgroundColor: theme.backgroundElement }]}><ThemedText type="small" style={styles.helper}>{tr('미리보기 불가')}</ThemedText></View>}
                    <Pressable analyticsId="meetup-profile.remove-photo" accessibilityRole="button" accessibilityLabel={tr("모임 사진 {0} 삭제", index + 1)} disabled={saving || photoSaving} style={styles.button} onPress={() => { play('selection'); setPhotos(current => current.filter((_, item) => item !== index)); setPublicPhotoIndex(current => current === index ? null : current !== null && current > index ? current - 1 : current); }}><ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr("삭제")}</ThemedText></Pressable>
                  </View>)}</View>
                  <Pressable analyticsId="app_meetup-profile.pressable.5" accessibilityRole="button" onPress={() => void pickPhoto()} disabled={saving || photoSaving || photos.length >= 3} accessibilityState={{ disabled: saving || photoSaving || photos.length >= 3, busy: photoSaving }} style={[styles.ghost, Depth.control, { borderColor: theme.line, backgroundColor: theme.card }]}><ThemedText type="smallBold" themeColor="accent" style={styles.label}>{photoSaving ? tr("사진 준비 중…") : tr("사진 추가")}</ThemedText></Pressable>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr("저장할 때만 반영돼요. 일반 프로필 사진은 바뀌지 않아요.")}</ThemedText>
                </View>
                <View style={styles.field}>
                  <ThemedText type="smallBold" style={styles.label}>{tr("활동 지역")}</ThemedText>
                  <Pressable analyticsId="app_meetup-profile.pressable.12" accessibilityRole="button" accessibilityLabel={tr("활동 지역 선택")} disabled={saving || photoSaving}
                    onPress={() => { play('selection'); Keyboard.dismiss(); setCityOpen(true); }} style={({ pressed }) => [styles.region, { borderColor: theme.line, backgroundColor: pressed ? theme.backgroundSelected : theme.card }]}>
                    <ThemedText style={styles.bodyText}>{cityName ?? tr("활동 지역을 선택해 주세요")}</ThemedText><ThemedText type="small" themeColor="accent" style={styles.helper}>{tr("변경")}</ThemedText>
                  </Pressable>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr("모임 활동 지역만 저장해요. 계정 지역과 정확한 위치는 바뀌지 않아요.")}</ThemedText>
                </View>
                </>}
                {([
                  { key: 'intro', label: tr("한 줄 소개"), hint: tr("하나를 고르거나 직접 적어주세요."), limit: 160, examples: [tr("처음엔 조용하지만 금방 편해져요"), tr("먼저 말을 거는 편이에요"), tr("함께 활동하는 걸 좋아해요")] },
                  { key: 'promptOne', label: tr(CHILLING_PROMPTS[profile.promptOneId ?? 'meet']), hint: tr("실제 나와 맞는 답변을 적어주세요."), limit: 300, examples: [tr("페스티벌 같이 가기"), tr("라이브 공연 보기"), tr("조용한 카페에서 수다"), tr("가볍게 걷기"), tr("맛집 원정"), tr("보드게임"), tr("맥주 한잔")] },
                  { key: 'promptTwo', label: tr(CHILLING_PROMPTS[profile.promptTwoId ?? 'join']), hint: tr("실제 나와 맞는 답변을 적어주세요."), limit: 300, examples: [tr("공연 취향이 맞는 사람들"), tr("소규모(4명 이하)"), tr("주말 낮"), tr("처음 보는 사람과도 편한 분위기")] },
                ] as const).filter((_, index) => index === step).map(field => <View key={field.key} style={[styles.promptPanel, { backgroundColor: theme.card }]}>
                  {(field.key === 'promptOne' || field.key === 'promptTwo') && <View style={styles.chips}>{(field.key === 'promptOne' ? ['meet', 'weekend', 'comfort'] as const : ['join', 'learn', 'ritual'] as const).map(id => <Pressable analyticsId="meetup-profile.prompt" key={id} accessibilityRole="button" accessibilityState={{ selected: (field.key === 'promptOne' ? profile.promptOneId : profile.promptTwoId) === id }} disabled={saving} onPress={() => { play('selection'); setProfile(current => ({ ...current, [field.key === 'promptOne' ? 'promptOneId' : 'promptTwoId']: id })); }} style={[styles.promptChip, { borderColor: theme.line, backgroundColor: (field.key === 'promptOne' ? profile.promptOneId : profile.promptTwoId) === id ? theme.backgroundSelected : theme.backgroundElement }]}><ThemedText type="small" style={styles.helper}>{tr(CHILLING_PROMPTS[id])}</ThemedText></Pressable>)}</View>}
                  <ThemedText style={[styles.bodyText, styles.question]}>{field.label}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{field.hint}</ThemedText>
                  <View style={styles.choices}>{field.examples.map(example => {
                    const selected = profile[field.key] === example;
                    return <Pressable analyticsId="app_meetup-profile.pressable.4" key={example} accessibilityRole="button" accessibilityLabel={example}
                      accessibilityState={{ selected, disabled: saving }} disabled={saving}
                      onPress={() => { play('selection'); Keyboard.dismiss(); setCustomOpen(null); setProfile(p => ({ ...p, [field.key]: p[field.key] === example ? '' : example })); }}
                      style={({ pressed }) => [styles.choice, { borderColor: selected ? theme.accent : theme.line, backgroundColor: selected ? theme.backgroundSelected : theme.card, opacity: pressed ? 0.7 : 1 }]}>
                      <ThemedText style={[styles.bodyText, styles.choiceText]}>{example}</ThemedText>
                      <SymbolView name={selected ? { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' } : { ios: 'circle', android: 'radio_button_unchecked', web: 'radio_button_unchecked' }} size={20} tintColor={selected ? theme.accent : theme.textSecondary} />
                    </Pressable>;
                  })}</View>
                  {customOpen === field.key || (profile[field.key] && !field.examples.some(example => profile[field.key] === example))
                    ? <TextInput accessibilityLabel={tr("{0} 직접 입력", (field.label))} value={profile[field.key]} autoFocus={customOpen === field.key}
                        placeholder={tr("직접 적어주세요")} placeholderTextColor={theme.textSecondary} multiline maxLength={field.limit} editable={!saving}
                        onFocus={() => scroll.current?.scrollToEnd({ animated: false })}
                        onChangeText={text => setProfile(p => ({ ...p, [field.key]: text }))} style={[styles.input, { color: theme.text, borderColor: theme.line }]} />
                    : <Pressable analyticsId="app_meetup-profile.pressable.11" accessibilityRole="button" accessibilityLabel={tr("{0} 직접 입력", (field.label))}
                        disabled={saving} onPress={() => { play('selection'); setCustomOpen(field.key); }}
                        style={({ pressed }) => [styles.promptChip, Depth.control, { alignSelf: 'flex-start', borderColor: theme.line, backgroundColor: theme.card, }]}>
                        <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr("＋ 직접 입력")}</ThemedText>
                      </Pressable>}
                  <ThemedText type="small" themeColor="textSecondary" style={[styles.helper, styles.count]}>{profile[field.key].length}/{field.limit}</ThemedText>
                </View>)}
                {step === 3 && <View style={styles.field}>
                  <ThemedText type="smallBold" style={styles.label}>{tr("관심사") + " "}<ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr("선택")}</ThemedText></ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr("선택하거나 직접 추가해 주세요. 최대 8개.")}</ThemedText>
                  <View style={styles.chips}>
                    {tags.map(tag => <Pressable analyticsId="app_meetup-profile.pressable.6" key={tag} accessibilityRole="button" accessibilityLabel={tr("{0} 삭제", (tag))}
                      disabled={saving} onPress={() => { play('selection'); setTags(current => current.filter(value => value !== tag)); }}
                      style={({ pressed }) => [styles.promptChip, Depth.control, { borderColor: theme.accentDepth, backgroundColor: theme.accent, }]}>
                      <ThemedText type="smallBold" style={[styles.label, { color: theme.accentInk }]}>{`${tag} ✕`}</ThemedText>
                    </Pressable>)}
                    {tags.length < 8 && [tr("페스티벌"), tr("라이브 공연"), tr("파티"), tr("산책"), tr("커피"), tr("맛집"), tr("여행"), tr("보드게임"), tr("운동")].filter(tag => !tags.includes(tag)).map(tag =>
                      <Pressable analyticsId="app_meetup-profile.pressable.10" key={tag} accessibilityRole="button" accessibilityLabel={tr("{0} 추가", (tag))}
                        disabled={saving} onPress={() => { play('selection'); Keyboard.dismiss(); setTags(current => current.length >= 8 || current.includes(tag) ? current : [...current, tag]); }}
                        style={({ pressed }) => [styles.promptChip, Depth.control, { borderColor: theme.line, backgroundColor: theme.backgroundElement, }]}>
                        <ThemedText type="small" style={styles.helper}>＋ {tag}</ThemedText>
                      </Pressable>)}
                    {tags.length < 8 && (tagOpen
                      ? <TextInput autoFocus accessibilityLabel={tr("관심사 추가")} value={tagDraft} maxLength={20} editable={!saving} returnKeyType="done"
                        onFocus={() => scroll.current?.scrollToEnd({ animated: false })}
                        onChangeText={setTagDraft} onSubmitEditing={() => addTags(tagDraft)} onBlur={() => { addTags(tagDraft); setTagOpen(false); }}
                        placeholder={tr("예: 산책")} placeholderTextColor={theme.textSecondary} style={[styles.tagInput, { color: theme.text, borderColor: theme.accent }]} />
                      : <Pressable analyticsId="app_meetup-profile.pressable.7" accessibilityRole="button" accessibilityLabel={tr("관심사 추가")}
                        disabled={saving} onPress={() => { play('selection'); setTagOpen(true); }} style={({ pressed }) => [styles.promptChip, Depth.control, { borderColor: theme.line, backgroundColor: theme.card, }]}>
                        <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr("＋ 추가")}</ThemedText>
                      </Pressable>)}
                  </View>
                  <View style={[styles.promptPanel, { backgroundColor: theme.card }]}>
                    <ThemedText type="smallBold" style={styles.label}>{tr("나만 보는 선호 설정")}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr("이 설정은 호스트와 멤버에게 공유되지 않아요.")}</ThemedText>
                    <TextInput accessibilityLabel={tr("선호하는 모임 활동")} value={privateActivities} maxLength={248} editable={!saving} placeholder={tr("예: 독서, 산책 · 쉼표로 구분")} placeholderTextColor={theme.textSecondary} onChangeText={setPrivateActivities} style={[styles.input, { color: theme.text, borderColor: theme.line }]} />
                    <TextInput accessibilityLabel={tr("편한 요일과 시간")} value={profile.preferences?.availability ?? ''} maxLength={160} editable={!saving} placeholder={tr("예: 토요일 오후가 편해요")} placeholderTextColor={theme.textSecondary} onChangeText={availability => setProfile(current => ({ ...current, preferences: { activities: [], pace: 'any', ...current.preferences, availability } }))} style={[styles.input, { color: theme.text, borderColor: theme.line }]} />
                    <View style={styles.chips}>{(['any', 'relaxed', 'active'] as const).map(pace => <Pressable analyticsId="meetup-profile.pace" key={pace} accessibilityRole="button" accessibilityState={{ selected: profile.preferences?.pace === pace }} disabled={saving} style={[styles.promptChip, { borderColor: theme.line, backgroundColor: profile.preferences?.pace === pace ? theme.backgroundSelected : theme.backgroundElement }]} onPress={() => { play('selection'); setProfile(current => ({ ...current, preferences: { activities: [], availability: '', ...current.preferences, pace } })); }}><ThemedText type="small" style={styles.helper}>{tr(pace === 'any' ? '어느 쪽도 좋아요' : pace === 'relaxed' ? '느긋하게' : '활동적으로')}</ThemedText></Pressable>)}</View>
                  </View>
                </View>}
                {step === 4 && <>
                <View accessibilityRole="tablist" style={[styles.segment, { backgroundColor: theme.backgroundElement }]}>{(['host', 'members', 'public'] as const).map(value => <Pressable analyticsId="meetup-profile.preview-audience" key={value} accessibilityRole="tab" accessibilityState={{ selected: audience === value }} style={[styles.segmentItem, audience === value && { backgroundColor: theme.background }]} onPress={() => { play('selection'); setAudience(value); }}><ThemedText type="smallBold" themeColor={audience === value ? 'accent' : undefined}>{tr(value === 'host' ? '호스트' : value === 'members' ? '멤버' : '공개할 때')}</ThemedText></Pressable>)}</View>
                <ChillingProfileCard profile={chillingProfilePreview(draftProfile, audience)} />
                {audience === 'public' && <View style={styles.field}><ThemedText type="smallBold" style={styles.label}>{tr("공개 호스트 사진 선택")}</ThemedText><View style={styles.chips}>
                  <Pressable analyticsId="meetup-profile.public-photo-none" accessibilityRole="button" accessibilityState={{ selected: publicPhotoIndex === null }} disabled={saving} style={[styles.promptChip, { borderColor: theme.line, backgroundColor: publicPhotoIndex === null ? theme.backgroundSelected : theme.card }]} onPress={() => { play('selection'); setPublicPhotoIndex(null); }}><ThemedText type="small" style={styles.helper}>{tr("공개 사진 없음")}</ThemedText></Pressable>
                  {photos.map((_, index) => <Pressable analyticsId="meetup-profile.public-photo" key={index} accessibilityRole="button" accessibilityState={{ selected: publicPhotoIndex === index }} disabled={saving} style={[styles.promptChip, { borderColor: theme.line, backgroundColor: publicPhotoIndex === index ? theme.backgroundSelected : theme.card }]} onPress={() => { play('selection'); setPublicPhotoIndex(index); }}><ThemedText type="small" style={styles.helper}>{tr("사진 {0}", index + 1)}</ThemedText></Pressable>)}
                </View><InfoNote>{tr("저장만으로 공개되지 않아요. 모임을 열 때 소개와 이 사진을 다시 확인해요.")}</InfoNote></View>}
                <WhoSees title={tr("누가 무엇을 보나요")} rows={[
                  { icon: { ios: 'person', android: 'person', web: 'person' }, label: tr("신청받는 호스트"), detail: tr("모임 이름 · 사진 · 소개 · 신청 답변") },
                  { icon: { ios: 'person.2', android: 'group', web: 'group' }, label: tr("승인된 멤버"), detail: profile.shareWithMembers ? tr("모임 이름, 그리고 사진 · 짧은 소개") : tr("모임 이름만"),
                    accessory: <Switch analyticsId="meetup-profile.share-members" accessibilityLabel={tr("승인 후 멤버에게 사진·짧은 소개 공유")} value={profile.shareWithMembers === true} disabled={saving} onValueChange={next => { play('selection'); setProfile(current => ({ ...current, shareWithMembers: next })); }} /> },
                  { icon: { ios: 'eye.slash', android: 'visibility_off', web: 'visibility_off' }, label: tr("다른 신청자"), detail: tr("보이지 않아요"), hidden: true },
                ]} />
                <InfoNote>{tr("상대가 이미 본 내용이나 저장한 사진은 되돌릴 수 없어요.")}</InfoNote>
                <MoreDetails label={tr("자세히")} analyticsId="meetup-profile.privacy-details" items={[tr("프로필을 고쳐도 이미 보낸 신청은 그대로예요."), tr("신청이 취소·거절되거나 탈퇴·차단·모임 종료가 되면 그 뒤로는 새로 볼 수 없어요."), tr("안전을 위해 자동 분석과 권한 있는 운영자 검토가 적용돼요.")]} />
                </>}
              </>}
        {!!error && <><ThemedText accessibilityRole="alert" themeColor="accent" style={styles.bodyText}>{tr(error)}</ThemedText>
          {!loaded && <Pressable analyticsId="app_meetup-profile.pressable.9" onPress={() => { play('selection'); setLoading(true); setError(''); setRetry(x => x + 1); }} accessibilityRole="button" style={styles.button}><ThemedText style={styles.bodyText}>{tr("다시 불러오기")}</ThemedText></Pressable>}</>}
      </ScrollView>}
      {isAuthed && !postId && loaded && !loading && <View style={[styles.footer, { borderColor: theme.line, backgroundColor: theme.background }]}>
        {!!error && <ThemedText accessibilityRole="alert" accessibilityLiveRegion="assertive" themeColor="accent" style={styles.bodyText}>{tr(error)}</ThemedText>}
        {/* Say why 다음 is disabled instead of leaving a dead button. */}
        <ThemedText type="small" themeColor={(step >= 3 && activitiesInvalid) || (missing.length && (step === 0 || step === 4)) ? 'accent' : 'textSecondary'} style={styles.helper} accessibilityLiveRegion="polite">{step >= 3 && activitiesInvalid ? tr("선호 활동은 8개까지, 각 30자 이내로 적어주세요") : missing.length && (step === 0 || step === 4) ? tr("남은 필수 항목: {0}", missing.join(' · ')) : step === 4 ? tr("저장하면 다음 모임에서도 사용할 수 있어요") : step === 0 ? tr("필수 항목을 다 채웠어요") : tr("선택 항목이에요. 비워 둬도 신청할 수 있어요")}</ThemedText>
        {step === 4 ? <RaisedActionButton analyticsId="app_meetup-profile.pressable.8" disabled={saving || photoSaving || !stepReady} busy={saving} onPress={() => void save()} label={saving ? tr("저장 중…") : returnPostId ? tr("저장하고 신청 계속") : language === 'en' ? 'Save meetup profile' : '모임 프로필 저장'} />
          : <RaisedActionButton analyticsId="app_meetup-profile.pressable.13" disabled={saving || photoSaving || !stepReady} onPress={() => { play('selection'); if (step === 3) addTags(tagDraft); changeStep(step + 1); }} label={step === 3 ? tr("내 프로필 미리보기") : optionalEmpty ? tr("건너뛰기") : tr("다음")} />}
      </View>}
    </KeyboardAvoidingView>
    <Modal visible={cityOpen} animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={() => setCityOpen(false)}>
      <SafeAreaProvider style={[styles.fill, { backgroundColor: theme.background }]}>
        <View style={[styles.fill, { paddingTop: insets.top, paddingBottom: insets.bottom }]}><CityPicker title={tr("활동 지역")} onClose={() => setCityOpen(false)} draft={{ city: selectedCity, onSelect: city => { setProfile(current => ({ ...current, cityId: city.id })); setCityOpen(false); } }} /></View>
      </SafeAreaProvider>
    </Modal>
  </SafeAreaView></ThemedView>;
}
const styles = StyleSheet.create({
  label: { ...Typography.menu }, helper: { fontSize: 14, lineHeight: 22 }, bodyText: { fontSize: 16, lineHeight: 24 },
  region: { minHeight: 48, borderWidth: 1, borderRadius: 12, padding: Spacing.three, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: Spacing.two },
  fill: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.six },
  appbar: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three },
  appbarButton: { minHeight: 44, minWidth: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, appbarTitle: { ...Typography.screenTitle, flex: 1, textAlign: 'center' },
  progress: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.four, paddingBottom: Spacing.two },
  bar: { flex: 1, height: 4, borderRadius: 999 },
  footer: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', borderTopWidth: 1, padding: Spacing.four, gap: Spacing.two },
  stepTitle: { ...Typography.subtitle }, question: { fontSize: 22, lineHeight: 30, fontWeight: '600' },
  promptPanel: { borderRadius: 22, padding: Spacing.four, gap: Spacing.three },
  choices: { gap: Spacing.two }, choice: { minHeight: 52, borderRadius: 14, borderWidth: 1, padding: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  choiceText: { flex: 1, fontSize: 16, lineHeight: 24 }, count: { textAlign: 'right' },
  photoRow: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-start' },
  photo: { width: 80, height: 80, borderRadius: 26 },
  photoFallback: { alignItems: 'center', justifyContent: 'center' }, photoLetter: { fontSize: 22, fontWeight: '700' },
  photoBody: { flex: 1, gap: Spacing.one },
  ghost: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  segment: { flexDirection: 'row', borderRadius: 12, padding: 3, gap: 3 }, segmentItem: { flex: 1, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  promptChip: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three },
  tagInput: { minHeight: 44, minWidth: 120, borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three, fontSize: 16, lineHeight: 24 },
  button: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }, field: { gap: Spacing.two },
  input: { borderWidth: 1, borderRadius: 12, padding: Spacing.three, minHeight: 52, maxHeight: 128, textAlignVertical: 'top', fontSize: 16, lineHeight: 24 },
});
