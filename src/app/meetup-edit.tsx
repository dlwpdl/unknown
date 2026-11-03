import { useLanguage } from '@/hooks/use-language';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router';
import { Alert, DeviceEventEmitter, KeyboardAvoidingView, LayoutAnimation, Platform, StyleSheet, TextInput, UIManager, View, type ScrollViewInstance, type TextInputInstance } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SymbolView } from 'expo-symbols';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { StateCard } from '@/components/state-card';
import { GlingLoader } from '@/components/gling-loader';
import { ChillingDateInput } from '@/components/chilling-date-input';
import { Tag } from '@/components/list-card';
import { MeetupCoverPicker } from '@/components/meetup-cover-picker';
import { InfoNote } from '@/components/notice-blocks';
import { PostPhotoEditor, type EditablePostImage } from '@/components/post-photo-editor';
import { RaisedActionButton } from '@/components/raised-action-button';
import { Spacing } from '@/constants/theme';
import { Typography } from '@/constants/design-system';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { getChillingError, getChillingErrorCode } from '@/lib/chilling-data';
import { chillingAvailability, chillingCapacityLimit, chillingTimezoneLabel, configureChillingEvent, normalizeChillingEvent, shiftChillingSchedule, type ChillingEventDraft } from '@/lib/chilling';
import { editPost, MEETUPS_CHANGED_EVENT } from '@/lib/community-data';
import { loadPublicMeetupContext, loadPublicPost, type PublicMeetupContext } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useMembership } from '@/lib/membership-provider';
import { splitEventMeetupBody } from '@/lib/meetup-ai';
import { splitPlaceMeetupBody } from '@/lib/meetup-destination';
import { joinMeetupSections, parseMeetupSections } from '@/lib/meetup-sections';
import { MeetupSectionsEditor } from '@/components/meetup-sections';
import { MeetupNewcomerOption } from '@/components/newcomer';
import { setMeetupNewcomer } from '@/lib/newcomer';
import { supabase } from '@/lib/supabase';

type Newcomer = { welcome: boolean; only: boolean };
type FormCard = 'basics' | 'schedule';
type Baseline = { title: string; intro: string; event: ChillingEventDraft; capacity: string; newcomer: Newcomer };

// Place/event lines are appended at creation and drive map/event links; only the human intro is editable.
// An unverifiable place tail still falls to the event split, so machine lines are kept rather than exposed.
const splitMeetupBody = (body: string, cityId: string) => splitPlaceMeetupBody(body, cityId) ?? splitEventMeetupBody(body);

export default function MeetupEditRoute() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { me, isAuthed } = useAuth();
  return <MeetupEditForm key={`${postId}:${isAuthed ? me.id : 'guest'}`} postId={typeof postId === 'string' ? postId : ''} />;
}

function MeetupEditForm({ postId }: { postId: string }) {
  const { tr, language } = useLanguage();
  const theme = useTheme(), router = useRouter();
  const { isAuthed, me, promptLogin } = useAuth();
  const { membership } = useMembership();
  const reducedMotion = useReducedMotion();
  const { play } = useInteractionFeedback();
  const [meetup, setMeetup] = useState<PublicMeetupContext | null>(null);
  const [loading, setLoading] = useState(isAuthed && !!postId), [loadError, setLoadError] = useState(''), [retry, setRetry] = useState(0);
  const [base, setBase] = useState<Baseline | null>(null);
  const [title, setTitle] = useState(''), [intro, setIntro] = useState(''), [details, setDetails] = useState('');
  const [event, setEvent] = useState<ChillingEventDraft | null>(null), [capacity, setCapacity] = useState('');
  const [newcomer, setNewcomer] = useState<Newcomer>({ welcome: false, only: false });
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [errorField, setErrorField] = useState<string | null>(null);
  // null until the current photos load; a failed load never offers a save that could drop them.
  const [photos, setPhotos] = useState<EditablePostImage[] | null>(null), [photosFailed, setPhotosFailed] = useState(false), [photosEdited, setPhotosEdited] = useState(false), [pickingPhoto, setPickingPhoto] = useState(false);
  const busy = useRef(false), mounted = useRef(true);
  const scroll = useRef<ScrollViewInstance>(null), inputs = useRef<Record<string, TextInputInstance | null>>({});
  // A field's layout y is relative to its card, so the scroll target adds the card's own y.
  const fieldY = useRef<Record<string, number>>({}), cardY = useRef<Partial<Record<FormCard, number>>>({});
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (!isAuthed || !postId) return;
    let active = true;
    loadPublicMeetupContext(supabase, postId).then(value => {
      if (!active) return;
      setMeetup(value);
      if (!value) return;
      const parts = splitMeetupBody(value.body, value.cityId), room = value.room;
      const draft: ChillingEventDraft = { kind: room.eventKind ?? 'group', startsAt: room.startsAt ?? '', endsAt: room.endsAt ?? '', timezone: room.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, cadence: room.cadence ?? '', capacity: room.capacity ?? 8, category: room.category };
      // Headed intros are compared in their saved shape, so opening the editor alone never marks the form dirty.
      const sections = parseMeetupSections(parts.intro);
      const next = { title: value.title, intro: sections ? joinMeetupSections(sections) : parts.intro, event: draft, capacity: String(draft.capacity),
        newcomer: { welcome: room.newcomerWelcome === true, only: room.newcomerOnly === true } };
      setBase(next); setNewcomer(next.newcomer); setTitle(next.title); setIntro(next.intro); setDetails(parts.details); setEvent(draft); setCapacity(next.capacity);
      if (value.authorId !== me.id) return;
      setPhotosFailed(false);
      void loadPublicPost(supabase, postId).then(post => {
        if (!active) return;
        const paths = post?.imagePaths ?? [], uris = post?.imageUris ?? [];
        if (!post || paths.length !== uris.filter(Boolean).length) { setPhotosFailed(true); return; }
        setPhotos(paths.map((path, index) => ({ path, uri: uris[index] })));
      }).catch(() => { if (active) setPhotosFailed(true); });
    }).catch(cause => { if (active) setLoadError(getChillingError(cause)); })
      .finally(() => {
        if (!active) return;
        // The form fades in where the loader was. Opacity only, so Reduce Motion keeps it too.
        if (Platform.OS !== 'web') {
          if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);
          LayoutAnimation.configureNext({ duration: 220, create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity } });
        }
        setLoading(false);
      });
    return () => { active = false; };
  }, [isAuthed, me.id, postId, retry]);

  const textDirty = !!base && (title !== base.title || intro !== base.intro);
  const eventDirty = !!base && !!event && (capacity !== base.capacity || event.startsAt !== base.event.startsAt || event.endsAt !== base.event.endsAt || event.cadence !== base.event.cadence);
  const newcomerDirty = !!base && (newcomer.welcome !== base.newcomer.welcome || newcomer.only !== base.newcomer.only);
  const dirty = textDirty || eventDirty || newcomerDirty || photosEdited;
  usePreventRemove(dirty && !saving, ({ repeat }) => {
    const heading = tr('수정 중인 내용을 버리고 나갈까요?'), message = tr('저장하지 않은 수정 내용은 사라져요.');
    if (Platform.OS === 'web') { if (globalThis.confirm(`${heading}\n${message}`)) repeat(); return; }
    Alert.alert(heading, message, [{ text: tr('계속 수정'), style: 'cancel' }, { text: tr('나가기'), style: 'destructive', onPress: repeat }]);
  });

  const back = () => { if (router.canGoBack()) router.back(); else router.replace(Platform.OS === 'web' ? '/?tag=meetup' : '/(tabs)/meetups'); };
  const room = meetup?.room;
  // Legacy rooms without an event kind keep their original join flow; configuring one would convert it.
  const modern = !!room?.eventKind;
  const memberCount = room?.memberCount ?? 1;
  const ended = !!room && ['ended', 'closed'].includes(chillingAvailability(room));
  const showValidation = (message: string, field: string | null = null) => {
    setError(message); setErrorField(field); play('warning');
    if (!field) return;
    const card: FormCard = field === 'title' || field === 'intro' ? 'basics' : 'schedule';
    scroll.current?.scrollTo({ y: (cardY.current[card] ?? 0) + (fieldY.current[field] ?? 0), animated: !reducedMotion });
    inputs.current[field]?.focus();
  };

  const save = async () => {
    if (busy.current || pickingPhoto || !meetup || !base || !event || !dirty) return;
    if (!title.trim()) return showValidation(tr('모임 제목을 적어주세요.'), 'title');
    if (!intro.trim()) return showValidation(tr('모임 소개를 적어주세요.'), 'intro');
    if (intro.trim().length + details.length > 5000) return showValidation(tr('모임 소개가 너무 길어요. 조금 줄여 주세요.'), 'intro');
    const draft = { ...event, capacity: Number(capacity) };
    if (eventDirty) {
      if (draft.kind === 'once' && (event.startsAt !== base.event.startsAt) && Date.parse(event.startsAt) < Date.now()) return showValidation(tr('시작 시각이 이미 지났어요. 지금 이후로 선택해 주세요.'), 'schedule');
      const limit = Math.max(chillingCapacityLimit(membership), Number(base.capacity));
      if (!/^\d+$/.test(capacity) || draft.capacity < 2 || draft.capacity > limit) return showValidation(tr('정원은 호스트를 포함해 2명부터 {0}명까지예요.', limit), 'capacity');
      if (draft.capacity < memberCount) return showValidation(tr('현재 멤버 {0}명보다 적게 줄일 수 없어요. 호스트를 포함해 {0}명 이상으로 정해 주세요.', memberCount), 'capacity');
      try { normalizeChillingEvent(draft); } catch (cause) { return showValidation(getChillingError(cause), draft.kind === 'group' ? 'cadence' : 'schedule'); }
    }
    busy.current = true; setSaving(true); setError(''); setErrorField(null);
    let eventSaved = false;
    try {
      // Kind is passed back unchanged; the server rechecks ownership, expiry and the member floor.
      if (eventDirty) { await configureChillingEvent(supabase, meetup.id, draft); eventSaved = true; }
      if (textDirty || photosEdited) {
        await editPost(supabase, meetup.id, { title: title.trim(), body: intro.trim() + details }, photosEdited && photos ? { userId: me.id, images: photos } : undefined);
        // A retry after a later failure must not upload the same photos again.
        if (mounted.current) setPhotosEdited(false);
      }
      if (newcomerDirty) await setMeetupNewcomer(supabase, meetup.id, newcomer.welcome, newcomer.only);
      DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT);
      if (!mounted.current) return;
      play('success');
      back();
    } catch (cause) {
      if (eventSaved) {
        // The schedule is already saved; a retry only resends the text.
        DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT);
        if (mounted.current) setBase(current => current && { ...current, event: draft, capacity });
      }
      if (!mounted.current) return;
      const message = cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : '';
      const code = getChillingErrorCode(cause);
      if (message.includes('EVENT_CAPACITY_BELOW_MEMBERS')) showValidation(tr('이미 참여한 멤버보다 적게 줄일 수 없어요. 호스트를 포함한 현재 인원 이상으로 정해 주세요.'), 'capacity');
      else if (code === 'INVALID_CAPACITY' || code === 'INVALID_EVENT_CAPACITY') showValidation(getChillingError(cause), 'capacity');
      else if (code === 'MEETUP_CLOSED' || code === 'MEETUP_EXPIRED') showValidation(tr('종료된 모임은 정보를 수정할 수 없어요.'));
      else showValidation(getChillingError(cause));
    } finally { if (mounted.current) { busy.current = false; setSaving(false); } }
  };

  const fieldError = (name: string) => errorField === name && !!error && <ThemedText accessibilityRole="alert" themeColor="danger" style={styles.bodyText}>{tr(error)}</ThemedText>;
  const clear = (name: string) => { if (errorField === name) { setError(''); setErrorField(null); } };
  // multiline is the intro only: its layout and error sit around the sections editor, which can replace this field.
  const input = (name: string, label: string, value: string, change: (next: string) => void, placeholder: string, maxLength: number, multiline = false) => <View onLayout={event => { if (!multiline) fieldY.current[name] = event.nativeEvent.layout.y; }} style={styles.field}>
    <ThemedText type="smallBold" style={styles.label}>{label}</ThemedText>
    <TextInput ref={field => { inputs.current[name] = field; }} accessibilityLabel={label} value={value} onChangeText={next => { change(next); clear(name); }} placeholder={placeholder} placeholderTextColor={theme.textSecondary} maxLength={maxLength} multiline={multiline} editable={!saving} autoCapitalize="none" style={[styles.input, multiline && styles.multiline, { color: theme.text, borderColor: errorField === name ? theme.danger : theme.line, backgroundColor: theme.card }]} />
    {!multiline && fieldError(name)}
  </View>;

  const blocked = !isAuthed ? <StateCard kind="blocked" title={tr('로그인 후 모임을 수정할 수 있어요')} body={tr('모임을 연 호스트 계정으로 로그인해 주세요.')} actionLabel={tr('로그인')} onAction={() => promptLogin('모임을 수정하려면 로그인해 주세요.')} />
    : loading ? <GlingLoader color={theme.accent} accessibilityLabel={tr('모임 불러오는 중')} />
    : loadError ? <StateCard kind="error" title={language === 'en' ? 'Couldn’t load this meetup' : '모임을 불러오지 못했어요'} body={tr(loadError)} actionLabel={tr('다시 시도')} onAction={() => { setLoadError(''); setLoading(true); setRetry(value => value + 1); }} />
    : !meetup || !room ? <StateCard kind="empty" title={tr('이 모임을 찾을 수 없어요.')} body={tr('삭제되었거나 볼 수 없는 모임이에요.')} />
    : meetup.authorId !== me.id ? <StateCard kind="blocked" title={tr('호스트만 수정할 수 있어요')} body={tr('모임을 연 호스트만 정보를 바꿀 수 있어요.')} />
    : ended ? <StateCard kind="blocked" title={tr('종료된 모임이에요')} body={tr('종료된 모임은 정보를 수정할 수 없어요.')} />
    : null;

  return <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
    <View style={[styles.head, { backgroundColor: theme.background }]}><Pressable analyticsId="app_meetup-create.pressable.1" accessibilityRole="button" accessibilityLabel={tr('뒤로가기')} disabled={saving} accessibilityState={{ disabled: saving }} onPress={() => { play('selection'); back(); }} style={({ pressed }) => [styles.back, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}><SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={22} tintColor={theme.text} /></Pressable><ThemedText accessibilityRole="header" style={styles.headTitle}>{tr('모임 정보 수정')}</ThemedText></View>
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView ref={scroll} analyticsId="app_meetup-create.scrollview.1" keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, loading && styles.loading]}>
      {blocked ?? <>
        <View onLayout={event => { cardY.current.basics = event.nativeEvent.layout.y; }} style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
          <ThemedText accessibilityRole="header" style={styles.cardTitle}>{tr('기본 정보')}</ThemedText>
          {input('title', tr('모임 제목'), title, setTitle, tr('예: 퇴근하고 노을 보러 갈래요?'), 60)}
          <View style={styles.field}>
            <ThemedText type="smallBold" style={styles.label}>{tr('사진')}</ThemedText>
            {photosFailed ? <InfoNote tone="warn">{tr('사진을 모두 불러오지 못했어요. 이 화면을 다시 열어 주세요.')}</InfoNote>
              : !photos ? <GlingLoader color={theme.accent} accessibilityLabel={tr('사진 불러오는 중')} />
              : photos.length ? <>
                <PostPhotoEditor images={photos} disabled={saving || pickingPhoto} onChange={next => { setPhotos(next); setPhotosEdited(true); }} />
                {photos.length > 1 && <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr('첫 사진이 표지예요. 앞·뒤 버튼으로 순서를 바꿀 수 있어요.')}</ThemedText>}
              </> : <MeetupCoverPicker value={null} onChange={image => { if (image) { setPhotos([image as EditablePostImage]); setPhotosEdited(true); } }} onPickingChange={setPickingPhoto} disabled={saving} />}
          </View>
          <View onLayout={event => { fieldY.current.intro = event.nativeEvent.layout.y; }} style={styles.field}>
            <MeetupSectionsEditor value={intro} onChange={next => { setIntro(next); clear('intro'); }} disabled={saving} maxLength={Math.max(1, 5000 - details.length)}>
              {input('intro', tr('모임 소개'), intro, setIntro, tr('무엇을 함께 하고 싶은지 알려주세요.'), Math.max(1, 5000 - details.length), true)}
            </MeetupSectionsEditor>
            {fieldError('intro')}
          </View>
          {!!details && <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr('연결된 장소·행사 정보는 그대로 남아요.')}</ThemedText>}
        </View>
        {modern && event && <>
          <View onLayout={event => { cardY.current.schedule = event.nativeEvent.layout.y; }} style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
            <ThemedText accessibilityRole="header" style={styles.cardTitle}>{tr('일정과 정원')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr('일정을 바꾸면 멤버에게 ‘시간이나 장소가 바뀌었어요’ 알림이 가요.')}</ThemedText>
            <View style={styles.field}>
              <View style={styles.kind}><ThemedText type="smallBold" style={styles.label}>{tr('모임 종류')}</ThemedText><Tag label={event.kind === 'once' ? tr('칠링') : tr('정기모임')} /></View>
              <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr('모임 종류는 바꿀 수 없어요.')}</ThemedText>
            </View>
            {event.kind === 'group' ? input('cadence', tr('활동 주기'), event.cadence, cadence => setEvent({ ...event, cadence }), tr('예: 매주 토요일 오전'), 80) : <View onLayout={layout => { fieldY.current.schedule = layout.nativeEvent.layout.y; }} style={styles.field}>
              <ChillingDateInput label={tr('시작')} value={event.startsAt} minimumDate={new Date()} onChange={startsAt => { clear('schedule'); setEvent(current => current && { ...current, ...shiftChillingSchedule(current, startsAt) }); }} disabled={saving} />
              <ChillingDateInput label={tr('종료')} value={event.endsAt} minimumDate={new Date()} onChange={endsAt => { clear('schedule'); setEvent(current => current && { ...current, endsAt }); }} disabled={saving} />
              <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{chillingTimezoneLabel({ timezone: event.timezone })}</ThemedText>
              {fieldError('schedule')}
            </View>}
            <View onLayout={layout => { fieldY.current.capacity = layout.nativeEvent.layout.y; }} style={styles.field}><ThemedText type="smallBold" style={styles.label}>{tr('정원 (호스트 포함)')}</ThemedText>
              <TextInput ref={field => { inputs.current.capacity = field; }} accessibilityLabel={tr('정원 (호스트 포함)')} keyboardType="number-pad" value={capacity} onChangeText={value => { setCapacity(value); clear('capacity'); }} editable={!saving} maxLength={4} style={[styles.input, { color: theme.text, borderColor: errorField === 'capacity' ? theme.danger : theme.line, backgroundColor: theme.card }]} />
              <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr('현재 멤버 {0}명 · 이보다 적게 줄일 수 없어요.', memberCount)}</ThemedText>
              {fieldError('capacity')}
            </View>
          </View>
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
            <ThemedText accessibilityRole="header" style={styles.cardTitle}>{tr('신청 질문')}</ThemedText>
            <ThemedText style={styles.bodyText}>{room?.applicationQuestion || tr('함께하고 싶은 이유를 알려주세요')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr('신청 질문은 모임을 연 뒤에는 바꿀 수 없어요.')}</ThemedText>
          </View>
          <MeetupNewcomerOption welcome={newcomer.welcome} only={newcomer.only} onChange={setNewcomer} disabled={saving} />
        </>}
      </>}
    </ScrollView>{!blocked && <View style={[styles.footer, { backgroundColor: theme.background, borderTopColor: theme.line }]}>
      {!!error && !errorField && <ThemedText accessibilityRole="alert" accessibilityLiveRegion="assertive" themeColor="danger" style={styles.bodyText}>{tr(error)}</ThemedText>}
      <RaisedActionButton analyticsId="meetup.manage.edit" disabled={saving || pickingPhoto || !dirty} busy={saving} onPress={() => { play('selection'); void save(); }} label={saving ? tr('저장 중…') : tr('저장')} />
    </View>}</KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, head: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three }, back: { position: 'absolute', zIndex: 1, left: Spacing.three, width: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, headTitle: { ...Typography.screenTitle, textAlign: 'center', flex: 1, paddingHorizontal: 44 + Spacing.two },
  content: { padding: 22, paddingBottom: Spacing.five, width: '100%', maxWidth: 640, alignSelf: 'center', gap: Spacing.three }, loading: { flexGrow: 1, justifyContent: 'center' },
  card: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.three }, cardTitle: { ...Typography.section },
  label: { ...Typography.menu }, helper: { ...Typography.supporting }, bodyText: { ...Typography.body }, field: { gap: Spacing.two },
  kind: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  input: { borderWidth: 1, borderRadius: 10, minHeight: 48, padding: 12, fontSize: 16, lineHeight: 24 }, multiline: { minHeight: 110, textAlignVertical: 'top' },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 22, paddingVertical: Spacing.two, gap: Spacing.two },
});
