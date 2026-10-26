import { useLanguage } from '@/hooks/use-language';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router';
import { Alert, DeviceEventEmitter, KeyboardAvoidingView, LayoutAnimation, Platform, StyleSheet, TextInput, UIManager, View, type ScrollViewInstance, type TextInputInstance } from 'react-native';
import { Image } from 'expo-image';
import { useReducedMotion } from 'react-native-reanimated';
import { SymbolView } from 'expo-symbols';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { StateCard } from '@/components/state-card';
import { Depth, Spacing } from '@/constants/theme';
import { ControlStyles, Typography, controlPresentation } from '@/constants/design-system';
import { useCityPlacesRevision } from '@/hooks/use-city-places';
import { CITIES } from '@/lib/mock';
import { eventMeetupDraft, isFestivalEvent, loadTicketmasterEvent, meetupAllowed, type TicketmasterEvent } from '@/lib/ticketmaster';
import { ChillingDateInput } from '@/components/chilling-date-input';
import { MeetupPolicyNotice } from '@/components/meetup-policy-notice';
import { MeetupCoverPicker, type MeetupCover } from '@/components/meetup-cover-picker';
import { MeetupAiDraftPreview } from '@/components/meetup-ai-draft-preview';
import { ChillingProfileCard } from '@/components/chilling-profile-card';
import { MeetupTemplatePicker } from '@/components/meetup-template-picker';
import { MeetupKindSwitch } from '@/components/meetup-kind-switch';
import { RaisedActionButton } from '@/components/raised-action-button';
import { RelationshipSlotCard, relationshipSlotData } from '@/components/relationship-slot-card';
import { InfoNote, MoreDetails } from '@/components/notice-blocks';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useCommunityCity } from '@/lib/community-city';
import { chillingProfilePreview, createChillingEvent, getChillingError, getChillingErrorCode, loadChillingProfile, type ChillingProfile } from '@/lib/chilling-data';
import { chillingCapacityLimit, chillingTimezoneLabel, normalizeChillingEvent, shiftChillingSchedule, type ChillingEventDraft } from '@/lib/chilling';
import { getCommunityActionError, MEETUPS_CHANGED_EVENT } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useMembership } from '@/lib/membership-provider';
import { supabase } from '@/lib/supabase';
import { behavior } from '@/lib/behavior-analytics';
import { MeetupSectionsEditor } from '@/components/meetup-sections';
import { MEETUP_DRAFT_FIELDS, meetupAiDraftChanges, meetupAiDraftFields, parseMeetupAiDraftResponse, type MeetupDraftField, type MeetupDraftFields, type MeetupDraftRevision } from '@/lib/ai-draft';
import { splitEventMeetupBody } from '@/lib/meetup-ai';
import { placeMapRoute } from '@/lib/discovery';
import { placeMeetupTail, resolveMeetupDestination, splitPlaceMeetupBody, type MeetupDestinationParams } from '@/lib/meetup-destination';

export default function MeetupCreateScreen() {

  const params = useLocalSearchParams();
  // Signing in mid-draft must not remount the form; host profile and consent reset per account in the focus effect.
  return <MeetupCreateForm key={`${params.ticketmasterCityId}:${params.ticketmasterEventId}:${params.placeCityId}:${params.placeId}`} />;
}

function MeetupCreateForm() {
  const { tr, t, language } = useLanguage();
  const aiCopy = (ko: string, en: string) => language === 'en' ? en : ko;
  const theme = useTheme(), router = useRouter();
  const { city } = useCommunityCity();
  const params = useLocalSearchParams();
  useCityPlacesRevision();
  const { destination, invalid: invalidDestination } = resolveMeetupDestination(params as MeetupDestinationParams);
  const sourcePlace = destination?.kind === 'place' ? destination.place : null;
  const ticketmasterEventId = destination?.kind === 'event' ? destination.eventId : undefined, ticketmasterCityId = destination?.cityId;
  const requestedKind = params.kind === 'once' || params.kind === 'group' ? params.kind : null;
  const [kindChosen, setKindChosen] = useState(!!ticketmasterEventId || !!requestedKind);
  const [assistanceOpen, setAssistanceOpen] = useState(false), [advancedOpen, setAdvancedOpen] = useState(false);
  const meetupCity = destination ? CITIES.find(item => item.id === destination.cityId && item.state === 'open') : invalidDestination ? undefined : city;
  const [eventReady, setEventReady] = useState(!invalidDestination && !ticketmasterEventId), [eventError, setEventError] = useState(''), [eventAttempt, setEventAttempt] = useState(0);
  const [sourceEvent, setSourceEvent] = useState<TicketmasterEvent | null>(null);
  const loadedEvent = useRef('');
  const sourceEdited = useRef(false);
  const { isAuthed, me, promptLogin, isAdmin } = useAuth();
  const { membership, refresh: refreshMembership } = useMembership();
  const capacityLimit = chillingCapacityLimit(membership);
  const capacityError = aiCopy(`정원은 호스트를 포함해 2명부터 ${capacityLimit}명까지예요.`, `Capacity must be between 2 and ${capacityLimit}, including the host.`);
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const slots = relationshipSlotData(membership, 'meetup');
  const slotsFull = !isAdmin && slots ? slots.available === 0 : false;
  const [cover, setCover] = useState<MeetupCover | null>(null);
  const [pickingCover, setPickingCover] = useState(false);
  const [title, setTitle] = useState(() => sourcePlace ? aiCopy(`${sourcePlace.name.slice(0, 44)} 같이 가요`, `Let's go to ${sourcePlace.name.slice(0, 45)}`) : ''), [body, setBody] = useState(() => sourcePlace ? aiCopy(`${sourcePlace.name}에 함께 가실 분을 찾아요.`, `I'd like to go to ${sourcePlace.name}. Who's in?`) : '');
  const [eventDetails, setEventDetails] = useState(() => destination?.kind === 'place' ? placeMeetupTail(destination) : '');
  const [seededPlaceId, setSeededPlaceId] = useState(sourcePlace?.id ?? '');
  const [creatingDraft, setCreatingDraft] = useState(false), [aiDraftReady, setAiDraftReady] = useState(false);
  const [topic, setTopic] = useState(''), [aiError, setAiError] = useState('');
  const [aiPreview, setAiPreview] = useState<{ fields: MeetupDraftFields; revision: MeetupDraftRevision } | null>(null);
  const [aiSelected, setAiSelected] = useState({ title: true, body: true, question: true });
  const [draftRevision, setDraftRevision] = useState<MeetupDraftRevision>({ title: 0, body: 0, question: 0 });
  const draftBusy = useRef(false);
  const [draftEdited, setDraftEdited] = useState(false);
  const [question, setQuestion] = useState(() => tr('어떤 분위기의 모임을 기대하세요?'));
  const [hostPreview, setHostPreview] = useState<ChillingProfile | null>(null);
  const [hostConsent, setHostConsent] = useState(false);
  const [event, setEvent] = useState<ChillingEventDraft>(() => {
    const start = new Date(Date.now() + 86400000); start.setMinutes(0, 0, 0);
    return { kind: ticketmasterEventId ? 'once' : requestedKind ?? 'once', startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3600000).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, cadence: '', capacity: 6, category: 'casual' };
  });
  const [capacity, setCapacity] = useState('6');
  const [ageMin, setAgeMin] = useState(''), [ageMax, setAgeMax] = useState('');
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [touched, setTouched] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<string | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const fieldY = useRef<Record<string, number>>({});
  const inputs = useRef<Record<string, TextInputInstance | null>>({});
  const profileRead = useRef(0), focused = useRef(true);
  // 한도 초과는 등급 문제라 멤버십 화면으로 바로 보낸다.
  const membershipError = !!errorCode && !!t.actionErrors[errorCode as keyof typeof t.actionErrors]?.membership;
  const busy = useRef(false);
  const mounted = useRef(true);
  const editDraftField = (field: MeetupDraftField, value: string) => {
    setDraftRevision(current => ({ ...current, [field]: current[field] + 1 }));
    ({ title: setTitle, body: setBody, question: setQuestion })[field](value);
    setDraftEdited(true); setAiDraftReady(false);
  };
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  usePreventRemove((draftEdited || touched || !!cover || !!topic.trim() || capacity !== '6' || !!ageMin || !!ageMax) && !saving, ({ repeat }) => {
    const title = tr('작성 중인 모임에서 나갈까요?'), message = tr('작성한 내용은 저장되지 않아요.');
    if (Platform.OS === 'web') { if (globalThis.confirm(`${title}\n${message}`)) repeat(); return; }
    Alert.alert(title, message, [{ text: tr('계속 작성'), style: 'cancel' }, { text: tr('나가기'), style: 'destructive', onPress: repeat }]);
  });
  useFocusEffect(useCallback(() => {
    focused.current = true;
    const request = ++profileRead.current;
    setHostConsent(false); setHostPreview(null);
    if (isAuthed && me.id) void loadChillingProfile(supabase, 'hosting').then(profile => {
      if (mounted.current && focused.current && request === profileRead.current) setHostPreview(profile?.version === 2 && profile.revision ? profile : null);
    }).catch(cause => { if (mounted.current && focused.current && request === profileRead.current) { setError(getChillingError(cause)); setErrorField(null); } });
    return () => { focused.current = false; profileRead.current++; };
  }, [isAuthed, me.id]));
  const showValidation = (message: string, field?: string) => {
    if (!mounted.current || !focused.current) return;
    setError(message); setErrorCode(null); setErrorField(field ?? null); play('warning');
    if (field === 'age' && !advancedOpen) setAdvancedOpen(true);
    else if (field) { scroll.current?.scrollTo({ y: fieldY.current[field] ?? 0, animated: !reducedMotion }); inputs.current[field]?.focus(); }
  };
  // A cold link can become valid after the remote catalog arrives; seed it once.
  if (destination?.kind === 'place' && seededPlaceId !== destination.place.id) {
    const place = destination.place;
    setSeededPlaceId(place.id);
    setEventDetails(placeMeetupTail(destination));
    if (!draftEdited) {
      setTitle(language === 'en' ? `Let's go to ${place.name.slice(0, 45)}` : `${place.name.slice(0, 44)} 같이 가요`);
      setBody(language === 'en' ? `I'd like to go to ${place.name}. Who's in?` : `${place.name}에 함께 가실 분을 찾아요.`);
    }
    setEventReady(true);
  }
  useEffect(() => {
    if (!ticketmasterEventId || invalidDestination || !isAuthed || loadedEvent.current === ticketmasterEventId) return;
    let active = true; setEventReady(false); setEventError('');
    loadTicketmasterEvent(ticketmasterCityId ?? '', ticketmasterEventId).then(({ event: source }) => {
      if (source.id !== ticketmasterEventId) throw new Error(language === 'en' ? 'Check the event details again.' : '행사 정보를 다시 확인해 주세요.');
      const draft = eventMeetupDraft(source, language);
      if (!active) return;
      const { intro, details } = splitEventMeetupBody(draft.body);
      setEventDetails(details); setSourceEvent(source);
      if (!sourceEdited.current) {
        setTitle(draft.title); setBody(intro);
        setEvent(current => ({ ...current, kind: 'once', category: isFestivalEvent(source) ? 'festival' : 'hobby', startsAt: draft.startsAt, endsAt: draft.endsAt }));
      }
      loadedEvent.current = ticketmasterEventId; setEventReady(true);
    }).catch(cause => { if (active) setEventError(cause.message); });
    return () => { active = false; };
  }, [ticketmasterEventId, ticketmasterCityId, isAuthed, eventAttempt, invalidDestination, language]);
  const createAiDraft = async () => {
    const titleHint = title.trim(), bodyHint = body.trim(), topicHint = topic.trim();
    if (draftBusy.current || saving || !eventReady || (!topicHint && !titleHint && !bodyHint && !cover)) return;
    if (!isAuthed) return promptLogin('AI로 초안을 만들려면 로그인해 주세요.');
    if (bodyHint.length > 5000) {
      setAiError('INTRO_TOO_LONG');
      return;
    }
    const revision = { ...draftRevision };
    draftBusy.current = true; setCreatingDraft(true); setAiError(''); setAiPreview(null); setAiDraftReady(false);
    try {
      const { data, error: draftError } = await supabase.functions.invoke('draft-post', { body: {
        cityName: meetupCity?.name ?? city.name,
        selectedCategory: 'meetup',
        intent: !draftEdited && ticketmasterEventId ? 'event_meetup' : 'meetup',
        topic: topicHint || undefined,
        language,
        titleHint: titleHint || undefined,
        bodyHint: bodyHint || undefined,
        ...(!titleHint && !bodyHint && cover ? { imageBase64: cover.base64, mimeType: cover.mimeType } : {}),
      } });
      if (draftError) throw draftError;
      const fields = meetupAiDraftFields(parseMeetupAiDraftResponse(data), language);
      if (fields.body.length > 5000 - eventDetails.length) throw new Error('INVALID_AI_DRAFT');
      if (!mounted.current) return;
      setAiSelected({ title: true, body: true, question: true });
      setAiPreview({ fields, revision });
    } catch {
      if (mounted.current) { play('warning'); setAiError('DRAFT_FAILED'); }
    } finally {
      draftBusy.current = false;
      if (mounted.current) setCreatingDraft(false);
    }
  };
  const applyAiDraft = () => {
    if (!aiPreview || saving || draftBusy.current) return;
    const changes = meetupAiDraftChanges(aiPreview.fields, aiSelected, aiPreview.revision, draftRevision);
    if (Object.keys(changes).length) sourceEdited.current = true;
    for (const field of MEETUP_DRAFT_FIELDS) if (changes[field] !== undefined) editDraftField(field, changes[field]!);
    if (Object.keys(changes).length) { setAiPreview(null); setAiDraftReady(true); }
  };
  const submit = async () => {
    if (busy.current || !focused.current || creatingDraft || pickingCover || !eventReady || !meetupCity || invalidDestination) return;
    if (sourcePlace && (!resolveMeetupDestination(params as MeetupDestinationParams).destination || !splitPlaceMeetupBody(body.trim() + eventDetails, meetupCity.id))) { setError(aiCopy('장소 연결 정보를 다시 확인해 주세요. 작성한 내용은 그대로예요.', 'Check the linked place again. Your writing is unchanged.')); setErrorField(null); return; }
    if (!isAuthed) return promptLogin('모임을 열려면 로그인해 주세요.');
    if (!kindChosen) { showValidation(aiCopy('칠링 또는 정기모임을 선택해 주세요.', 'Choose a one-time or regular meetup.'), 'kind'); return; }
    if (slotsFull) {
      Alert.alert(tr("모임 자리가 없어요"), tr("동시에 운영·참여할 수 있는 모임 자리 {0}개를 모두 사용 중이에요. 모임을 종료하거나 나가면 자리는 바로 돌아와요.", (slots!.limit)),
        [{ text: tr("닫기"), style: 'cancel' }, { text: tr("멤버십 보기"), onPress: () => router.push('/profile/membership') }]);
      return;
    }
    const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (event.kind === 'once' && event.timezone !== deviceZone) { setEvent(current => ({ ...current, timezone: deviceZone })); showValidation(tr("기기 시간대가 바뀌어 일정 시간대를 맞췄어요. 시작·종료 시각을 다시 확인해 주세요."), 'schedule'); return; }
    if (event.kind === 'once' && new Date(event.startsAt) < new Date()) { showValidation(tr("시작 시각이 이미 지났어요. 지금 이후로 선택해 주세요."), 'schedule'); return; }
    if (!title.trim()) { showValidation(aiCopy('모임 제목을 적어주세요.', 'Enter a meetup title.'), tr('모임 제목')); return; }
    if (!body.trim()) { showValidation(aiCopy('모임 소개를 적어주세요.', 'Add an introduction.'), tr('모임 소개')); return; }
    if (!question.trim()) { showValidation(aiCopy('신청 질문을 적어주세요.', 'Add an application question.'), tr('신청할 때 물어볼 질문')); return; }
    if (!/^\d+$/.test(capacity) || Number(capacity) < 2 || Number(capacity) > capacityLimit) { showValidation(capacityError, 'capacity'); return; }
    if ((ageMin || ageMax) && (!/^\d+$/.test(ageMin) || !/^\d+$/.test(ageMax) || Number(ageMin) > Number(ageMax) || Number(ageMax) > 120)) { showValidation(aiCopy('권장 연령은 만 0~120세 안에서 최소·최대 나이를 함께 입력해주세요.', 'Enter both recommended ages, from 0 to 120, with the minimum first.'), 'age'); return; }
    try { normalizeChillingEvent({ ...event, capacity: Number(capacity) }, capacityLimit); }
    catch (cause) { showValidation(getChillingError(cause), event.kind === 'group' ? tr('활동 주기') : 'schedule'); return; }
    busy.current = true; setSaving(true); setError(''); setErrorCode(null); setErrorField(null);
    const request = ++profileRead.current;
    try {
      if (ticketmasterEventId) {
        const latest = await loadTicketmasterEvent(ticketmasterCityId ?? '', ticketmasterEventId).catch(cause => { if (mounted.current) setError(cause.message); return null; });
        if (!latest || !mounted.current || !focused.current || request !== profileRead.current) return;
        if (latest.event.id !== ticketmasterEventId || !meetupAllowed(latest.event)) { setError("행사 일정 또는 판매 상태가 바뀌었어요. 행사 상세를 다시 확인해 주세요."); return; }
      }
      const profile = await loadChillingProfile(supabase, 'hosting');
      if (!mounted.current || !focused.current || request !== profileRead.current) return;
      if (profile?.version !== 2 || !profile.revision) {
        Alert.alert(aiCopy('모임 프로필을 먼저 저장해 주세요', 'Save your meetup profile first'), aiCopy('모임 프로필은 계정당 하나이며 다음 모임에도 사용해요. 입력한 모임 내용은 그대로예요. 프로필을 저장한 뒤 이 모임에서 공개할 소개를 확인해 주세요.', 'You have one meetup profile for all your meetups. Your draft is unchanged. Save your profile, then review what you want to share for this meetup.'), [{ text: aiCopy('작성으로 돌아가기', 'Back to draft'), style: 'cancel', onPress: () => { if (request === profileRead.current) showValidation(aiCopy('모임을 열려면 모임 프로필을 먼저 저장해 주세요. 작성한 내용은 그대로예요.', 'Save your meetup profile before publishing. Your draft is unchanged.')); } }, { text: tr("프로필 작성"), onPress: () => { if (mounted.current && focused.current && request === profileRead.current) router.push('/meetup-profile'); } }]);
        return;
      }
      if (!hostConsent || hostPreview?.revision !== profile.revision) {
        setHostPreview(profile); setHostConsent(false);
        showValidation(aiCopy('이 모임에서 공개할 소개와 선택한 사진을 확인하고 동의해 주세요.', 'Review and consent to the introduction and selected photo shared for this meetup.'), 'profile');
        return;
      }
      const id = await createChillingEvent(supabase, { userId: me.id, image: cover ?? undefined, cityId: meetupCity.id, title: title.trim(), body: body.trim() + eventDetails, question: question.trim(), hostProfileRevision: profile.revision, event: { ...event, capacity: Number(capacity), ...(ageMin ? { recommendedAgeMin: Number(ageMin), recommendedAgeMax: Number(ageMax) } : {}) } });
      // The meetup exists even if the host already left this screen, so lists refresh first.
      DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT);
      if (!mounted.current || !focused.current || request !== profileRead.current) return;
      if (ticketmasterEventId) behavior('success', 'ticketmaster.meetup.created');
      play('meetupCreated');
      router.replace({ pathname: '/post/[id]', params: { id } });
    } catch (cause) {
      if (!mounted.current) return;
      const code = getChillingErrorCode(cause);
      if (code === 'INVALID_CAPACITY' || code === 'INVALID_EVENT_CAPACITY') showValidation(aiCopy('정원과 현재 멤버십 한도를 다시 확인해 주세요.', 'Check capacity and your current membership limit.'), 'capacity');
      else { play('warning'); setError(getChillingError(cause)); }
      setErrorCode(getCommunityActionError(cause));
      void refreshMembership();
    }
    finally { if (mounted.current) { busy.current = false; setSaving(false); } }
  };
  const field = (label: string, value: string, change: (s: string) => void, placeholder: string, maxLength: number, multiline = false) => <View onLayout={event => { fieldY.current[label] = event.nativeEvent.layout.y; }} style={styles.field}><ThemedText type="smallBold" style={styles.label}>{label}</ThemedText><TextInput ref={input => { inputs.current[label] = input; }} accessibilityLabel={label} value={value} onChangeText={next => { sourceEdited.current = true; change(next); if (errorField === label) { setError(''); setErrorField(null); } }} placeholder={placeholder} placeholderTextColor={theme.textSecondary} maxLength={maxLength} multiline={multiline} editable={!saving && eventReady} autoCapitalize="none" style={[styles.input, multiline && styles.multiline, { color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} />{errorField === label && !!error && <ThemedText accessibilityRole="alert" themeColor="accent" style={styles.bodyText}>{tr(error)}</ThemedText>}</View>;
  const changeKind = (kind: ChillingEventDraft['kind']) => {
    setKindChosen(true); setTouched(true);
    if (errorField === 'kind') { setError(''); setErrorField(null); }
    sourceEdited.current = true;
    if (!reducedMotion) {
      if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    setEvent(current => ({ ...current, kind }));
  };
  return <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
    <View style={[styles.head, { backgroundColor: theme.background }]}><Pressable analyticsId="app_meetup-create.pressable.1" accessibilityRole="button" accessibilityLabel={tr("뒤로가기")} disabled={saving} accessibilityState={{ disabled: saving }} onPress={() => { play('selection'); if (router.canGoBack()) router.back(); else router.replace(Platform.OS === 'web' ? '/?tag=meetup' : '/(tabs)/meetups'); }} style={({ pressed }) => [styles.back, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}><SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={22} tintColor={theme.text} /></Pressable><ThemedText accessibilityRole="header" style={styles.headTitle}>{tr("모임 열기")}</ThemedText></View>
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView ref={scroll} analyticsId="app_meetup-create.scrollview.1" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {invalidDestination && <StateCard kind="error" title={aiCopy('장소·행사 정보를 확인하지 못했어요', 'Couldn’t verify this place or event')} body={aiCopy('원래 상세에서 다시 열어주세요. 작성한 내용은 그대로예요.', 'Open it again from its details. Your writing is unchanged.')} />}
      <>
      {!isAdmin && slots && <RelationshipSlotCard kind="meetup" membership={membership} />}
      {slotsFull && <InfoNote tone="warn">{tr("모임을 종료하거나 나가면 자리는 바로 돌아와요.")}</InfoNote>}
      <ThemedText accessibilityRole="header" type="subtitle" style={styles.firstSection}>{aiCopy('01. 어떤 모임인가요?', '01. What are we doing?')}</ThemedText>
      {!ticketmasterEventId && <View onLayout={event => { fieldY.current.kind = event.nativeEvent.layout.y; }} style={styles.field}>
        <MeetupKindSwitch value={kindChosen ? event.kind : null} onChange={changeKind} disabled={saving} analyticsId="app_meetup-create.pressable.2" />
        <ThemedText style={styles.helper} themeColor="textSecondary">{!kindChosen ? aiCopy('이번 한 번 만날지, 꾸준히 만날지 선택해 주세요.', 'Choose a one-time meetup or an ongoing group.') : event.kind === 'once' ? tr('이번 한 번, 가볍게 만나요.') : tr('취향이 맞는 사람들과 정기적으로 만나요.')}</ThemedText>
        {errorField === 'kind' && !!error && <ThemedText accessibilityRole="alert" themeColor="accent" style={styles.bodyText}>{tr(error)}</ThemedText>}
      </View>}
      {field(tr("모임 제목"), title, value => editDraftField('title', value), tr("예: 퇴근하고 노을 보러 갈래요?"), 60)}
      <MeetupCoverPicker value={cover} onChange={setCover} onPickingChange={setPickingCover} disabled={saving || creatingDraft || !eventReady} />
      <MeetupSectionsEditor value={body} onChange={value => { sourceEdited.current = true; editDraftField('body', value); }} disabled={saving || !eventReady} maxLength={Math.max(1, 5000 - eventDetails.length)} heading={false}>
        {field(tr("모임 소개"), body, value => editDraftField('body', value), tr("무엇을 함께 하고 싶은지 알려주세요."), Math.max(1, 5000 - eventDetails.length), true)}
      </MeetupSectionsEditor>
      <Pressable analyticsId="meetup-create.assistance" accessibilityRole="button" accessibilityState={{ expanded: assistanceOpen }} onPress={() => { play('selection'); setAssistanceOpen(value => !value); }} style={({ pressed }) => [styles.disclosure, { opacity: pressed ? 0.82 : 1 }]}>
        <ThemedText style={styles.label} themeColor="accent">{aiCopy('소개 작성 도움받기', 'Help with your introduction')}</ThemedText>
        <SymbolView name={{ ios: assistanceOpen ? 'chevron.up' : 'chevron.down', android: assistanceOpen ? 'expand_less' : 'expand_more', web: assistanceOpen ? 'expand_less' : 'expand_more' }} size={16} tintColor={theme.accent} />
      </Pressable>
      {assistanceOpen && <View style={styles.field}>
      <MeetupTemplatePicker draft={{ title, body, applicationQuestion: question, category: event.category }} disabled={saving || creatingDraft || !eventReady} onApply={value => {
        if (value.body.length + eventDetails.length > 5000) {
          play('warning'); setError('소개가 길어 템플릿을 적용하지 않았어요. 모임에 맞게 소개를 직접 작성해 주세요.'); setErrorField(null); return false;
        }
        sourceEdited.current = true; setError('');
        editDraftField('title', value.title); editDraftField('body', value.body); editDraftField('question', value.applicationQuestion); setDraftEdited(true);
        if (value.category && ['casual', 'party', 'festival', 'sports', 'hobby', 'travel'].includes(value.category)) setEvent(current => ({ ...current, category: value.category as ChillingEventDraft['category'] }));
      }} />
      {!!eventDetails && <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{sourcePlace ? aiCopy('모임에 이 장소의 지도가 연결돼요.', 'This place’s map will be linked to your meetup.') : tr("모임에 행사 상세 보기 버튼이 연결돼요.")}</ThemedText>}
      {field(aiCopy('모임 주제', 'Meetup topic'), topic, setTopic, aiCopy('예: 주말에 가볍게 산책하고 싶어요.', 'e.g. a relaxed weekend walk'), 500)}
      <Pressable analyticsId="app_meetup-create.ai-draft" accessibilityRole="button" accessibilityState={{ disabled: creatingDraft || saving || !eventReady || (!topic.trim() && !title.trim() && !body.trim() && !cover), busy: creatingDraft }} disabled={creatingDraft || saving || !eventReady || (!topic.trim() && !title.trim() && !body.trim() && !cover)} onPress={() => { play('selection'); void createAiDraft(); }} style={({ pressed }) => [styles.aiButton, Depth.control, { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement, opacity: creatingDraft || saving || !eventReady || (!topic.trim() && !title.trim() && !body.trim() && !cover) ? 0.5 : 1 }]}><SymbolView name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }} size={17} tintColor={theme.accent} /><ThemedText type="smallBold" style={[styles.label, { color: theme.accent }]}>{creatingDraft ? t.write.creatingDraft : aiError ? aiCopy('AI 초안 다시 시도', 'Retry AI draft') : draftEdited && !topic.trim() ? t.write.polishDraft : t.write.createDraft}</ThemedText></Pressable>
      {!!aiError && <ThemedText accessibilityRole="alert" type="small" themeColor="textSecondary" style={styles.helper}>{aiError === 'INTRO_TOO_LONG' ? aiCopy('AI 다듬기는 소개 5000자까지 사용할 수 있어요. 글을 줄이거나 직접 작성해 주세요.', 'AI can polish introductions up to 5,000 characters. Shorten yours or keep writing it yourself.') : aiCopy('초안을 만들지 못했어요. 작성한 내용은 그대로예요. 다시 시도해 주세요.', 'Couldn’t create the draft. Your writing is unchanged. Try again.')}</ThemedText>}
      {aiPreview && <MeetupAiDraftPreview fields={aiPreview.fields} selected={aiSelected} protectedFields={{ title: draftRevision.title !== aiPreview.revision.title, body: draftRevision.body !== aiPreview.revision.body, question: draftRevision.question !== aiPreview.revision.question }} disabled={saving || creatingDraft} onToggle={field => setAiSelected(current => ({ ...current, [field]: !current[field] }))} onApply={applyAiDraft} onDismiss={() => setAiPreview(null)} />}
      {aiDraftReady && <ThemedText accessibilityRole="alert" type="small" themeColor="textSecondary" style={styles.helper}>{t.write.reviewDraft}</ThemedText>}
      </View>}
      {field(tr("신청할 때 물어볼 질문"), question, value => editDraftField('question', value), tr("어떤 분위기의 모임을 기대하세요?"), 300)}
      <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr("기본 질문 1개 · 신청자의 프로필과 함께 확인해요.")}</ThemedText>
      </>
      <>
      <ThemedText accessibilityRole="header" type="subtitle" style={styles.sectionTitle}>{aiCopy('02. 언제, 어디서 만나요?', '02. When and where?')}</ThemedText>
      {sourcePlace && <View style={styles.field}><ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{aiCopy('함께 갈 장소', 'Where we’re going')} · {tr(meetupCity?.name ?? city.name)}</ThemedText><ThemedText style={[styles.bodyText, Typography.section]}>{sourcePlace.name}</ThemedText>
        <Pressable analyticsId="components_post-map-link.pressable.1" accessibilityRole="button" accessibilityLabel={aiCopy('선택한 장소 지도 보기', 'View the selected place on the map')} onPress={() => { play('selection'); router.navigate(placeMapRoute(sourcePlace)); }} style={({ pressed }) => [ControlStyles.action, controlPresentation(theme, { pressed }).container, { borderWidth: 1 }]}><ThemedText type="smallBold" style={[styles.label, controlPresentation(theme).text]}>{aiCopy('장소 지도 보기', 'View place map')}</ThemedText></Pressable>
      </View>}
      {ticketmasterEventId && (!isAuthed ? <StateCard kind="blocked" title={tr("로그인 후 모임을 열 수 있어요")} body={tr("로그인하면 행사 정보를 불러와요.")} actionLabel={tr("로그인")} onAction={() => promptLogin('행사 모임을 열려면 로그인해 주세요.')} /> : !eventReady ? <StateCard kind={eventError ? 'error' : 'empty'} title={eventError ? tr("행사를 확인하지 못했어요") : tr("행사 정보를 확인하고 있어요")} body={eventError ? tr(eventError) : tr('확인 후 제목과 일정을 채워드려요.')} actionLabel={eventError ? tr('다시 시도') : undefined} onAction={eventError ? () => setEventAttempt(n => n + 1) : undefined} /> : sourceEvent && <View style={styles.eventHero} accessibilityRole="summary"><View style={styles.eventHeroText}><ThemedText type="smallBold" style={[styles.label, styles.eventHeroLabel]}>{isFestivalEvent(sourceEvent) ? tr("함께 가고 싶은 페스티벌") : tr("함께 갈 행사")}</ThemedText><ThemedText type="smallBold" numberOfLines={2} style={[styles.label, styles.eventHeroTitle]}>{sourceEvent.name}</ThemedText><ThemedText type="small" numberOfLines={1} style={[styles.helper, styles.eventHeroPlace]}>{sourceEvent.venue}{sourceEvent.venue && sourceEvent.city ? ' · ' : ''}{sourceEvent.city}</ThemedText></View><Image source={require('@/assets/images/festival-glass-orbs.webp')} style={styles.eventHeroArt} contentFit="contain" accessible={false} /></View>)}
      {!kindChosen ? null : event.kind === 'group' ? field(tr("활동 주기"), event.cadence, cadence => setEvent({ ...event, cadence }), tr("예: 매주 토요일 오전"), 80) : <View onLayout={event => { fieldY.current.schedule = event.nativeEvent.layout.y; }} style={{ gap: Spacing.three }}>
        <ChillingDateInput label={tr("시작")} value={event.startsAt} minimumDate={new Date()} onChange={startsAt => { sourceEdited.current = true; setTouched(true); setEvent(current => ({ ...current, ...shiftChillingSchedule(current, startsAt) })); }} disabled={saving || !eventReady} />
        <ChillingDateInput label={tr("종료")} value={event.endsAt} minimumDate={new Date()} onChange={endsAt => { sourceEdited.current = true; setTouched(true); setEvent(current => ({ ...current, endsAt })); }} disabled={saving || !eventReady} />
        {!!ticketmasterEventId && eventReady && <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr("모임 종료는 행사 시작 2시간 뒤로 임시 설정했어요. 실제 만날 시간과 종료 시간을 확인해 주세요.")}</ThemedText>}
        <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{chillingTimezoneLabel({ timezone: event.timezone }) ? tr("{0} 기준 · 끝나면 새 신청을 받지 않아요.", chillingTimezoneLabel({ timezone: event.timezone })) : tr("끝나면 새 신청을 받지 않아요.")}</ThemedText>
        <MoreDetails label={tr("시간대 안내")} analyticsId="meetup-create.timezone-details" items={[tr("이 기기의 시간대 기준이에요. 활동 지역과 시간대가 다르면 기기 시간에 맞춰 골라 주세요.")]} />
        {errorField === 'schedule' && !!error && <ThemedText accessibilityRole="alert" themeColor="accent" style={styles.bodyText}>{tr(error)}</ThemedText>}
      </View>}
      <View style={styles.field}><ThemedText type="smallBold" style={styles.label}>{tr("활동 지역")}</ThemedText><ThemedText style={styles.bodyText}>{tr(meetupCity?.name ?? city.name)}</ThemedText><ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr("지역을 바꾸려면 모임 화면에서 지역을 선택해 주세요.")}</ThemedText><InfoNote>{tr("정확한 집결 장소는 승인된 멤버에게 모임 대화에서 알려 주세요.")}</InfoNote></View>
      <View onLayout={event => { fieldY.current.capacity = event.nativeEvent.layout.y; }} style={styles.field}><ThemedText type="smallBold" style={styles.label}>{tr("정원 (호스트 포함)")}</ThemedText><TextInput ref={input => { inputs.current.capacity = input; }} accessibilityLabel={aiCopy(`정원, 2명부터 ${capacityLimit}명`, `Capacity, 2 to ${capacityLimit}`)} keyboardType="number-pad" value={capacity} onChangeText={value => { setCapacity(value); if (errorField === 'capacity') { setError(''); setErrorField(null); } }} editable={!saving && eventReady} maxLength={membership ? String(capacityLimit).length : 4} style={[styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{aiCopy(`현재 멤버십은 호스트를 포함해 최대 ${capacityLimit}명까지예요.`, `Your current membership allows up to ${capacityLimit} people, including the host.`)}</ThemedText>
        {errorField === 'capacity' && !!error && <ThemedText accessibilityRole="alert" themeColor="accent" style={styles.bodyText}>{tr(error)}</ThemedText>}
      </View>
      <Pressable analyticsId="meetup-create.advanced" accessibilityRole="button" accessibilityState={{ expanded: advancedOpen }} onPress={() => { play('selection'); setAdvancedOpen(value => !value); }} style={({ pressed }) => [styles.disclosure, { opacity: pressed ? 0.82 : 1 }]}>
        <ThemedText style={styles.label} themeColor="accent">{aiCopy('참가 설정 · 선택', 'Participation settings · optional')}</ThemedText>
        <SymbolView name={{ ios: advancedOpen ? 'chevron.up' : 'chevron.down', android: advancedOpen ? 'expand_less' : 'expand_more', web: advancedOpen ? 'expand_less' : 'expand_more' }} size={16} tintColor={theme.accent} />
      </Pressable>
      {advancedOpen && <>
      <View style={styles.field}><ThemedText type="smallBold" style={styles.label}>{tr("카테고리")}</ThemedText><View style={styles.categories} accessibilityRole="radiogroup" accessibilityLabel={tr("카테고리")}>{(['casual', 'party', 'festival', 'sports', 'hobby', 'travel'] as const).map((category, i) => <Pressable analyticsId="app_meetup-create.pressable.3" key={category} disabled={saving} accessibilityRole="radio" accessibilityState={{ checked: event.category === category, disabled: saving }} onPress={() => { play('selection'); sourceEdited.current = true; setTouched(true); setEvent(current => ({ ...current, category })); }} style={({ pressed }) => [styles.category, Depth.control, { borderColor: event.category === category ? theme.accentDepth : theme.line, backgroundColor: event.category === category ? theme.accent : theme.card, }]}><ThemedText type="small" style={[styles.helper, { color: event.category === category ? theme.accentInk : theme.text }]}>{[tr("가볍게"), tr("파티"), tr("페스티벌"), tr("스포츠"), tr("취미"), tr("여행")][i]}</ThemedText></Pressable>)}</View></View>
      <View onLayout={event => { fieldY.current.age = event.nativeEvent.layout.y; if (errorField === 'age') { scroll.current?.scrollTo({ y: event.nativeEvent.layout.y, animated: !reducedMotion }); inputs.current.age?.focus(); } }} style={styles.field}>
        <ThemedText type="smallBold" style={styles.label}>{tr("권장 연령대 · 선택")}</ThemedText>
        <View style={styles.categories}>
          <TextInput ref={input => { inputs.current.age = input; }} accessibilityLabel={tr("권장 최소 나이, 만 나이")} placeholder={tr("최소, 예: 20")} placeholderTextColor={theme.textSecondary} keyboardType="number-pad" value={ageMin} onChangeText={setAgeMin} editable={!saving && eventReady} maxLength={3} style={[styles.input, { flex: 1, minWidth: 0, color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} />
          <TextInput accessibilityLabel={tr("권장 최대 나이, 만 나이")} placeholder={tr("최대, 예: 39")} placeholderTextColor={theme.textSecondary} keyboardType="number-pad" value={ageMax} onChangeText={setAgeMax} editable={!saving && eventReady} maxLength={3} style={[styles.input, { flex: 1, minWidth: 0, color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} />
        </View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr("비워 두면 연령대 상관없이 받아요. 권장 연령대가 달라도 신청할 수는 있어요.")}</ThemedText>
        {errorField === 'age' && !!error && <ThemedText accessibilityRole="alert" themeColor="accent" style={styles.bodyText}>{tr(error)}</ThemedText>}
      </View>
      </>}
      </>
      <>
      <ThemedText accessibilityRole="header" type="subtitle" style={styles.sectionTitle}>{aiCopy('내 모임 프로필', 'Your meetup profile')}</ThemedText>
      {!hostPreview && <View style={[styles.note, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText style={styles.bodyText}>{aiCopy('모임 프로필은 한 번 저장하고 다음 모임에도 다시 사용해요.', 'Save one meetup profile and reuse it for future meetups.')}</ThemedText>
        <Pressable analyticsId="meetup-create.profile-edit" accessibilityRole="button" disabled={saving} style={styles.membership} onPress={() => { play('selection'); setHostConsent(false); router.push('/meetup-profile'); }}><ThemedText style={styles.label} themeColor="accent">{aiCopy('내 모임 프로필 확인', 'Review your meetup profile')}</ThemedText></Pressable>
      </View>}
      {hostPreview && <View onLayout={event => { fieldY.current.profile = event.nativeEvent.layout.y; }} style={styles.field}><ThemedText type="subtitle">{tr('공개할 호스트 소개')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{aiCopy('저장한 모임 프로필을 다시 사용해요. 공개 동의는 이 모임에만 적용돼요.', 'Your saved meetup profile is reused. Sharing consent applies only to this meetup.')}</ThemedText>
        <ChillingProfileCard profile={chillingProfilePreview(hostPreview, 'public')} />
        <Pressable analyticsId="meetup-create.host-consent" accessibilityRole="checkbox" accessibilityState={{ checked: hostConsent, disabled: saving }} aria-checked={hostConsent} disabled={saving} style={({ pressed }) => [styles.consent, { borderColor: hostConsent ? theme.accent : theme.line, backgroundColor: theme.card, opacity: saving ? 0.55 : pressed ? 0.7 : 1 }]} onPress={() => { play('selection'); setHostConsent(value => !value); if (errorField === 'profile') { setError(''); setErrorField(null); } }}><View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.checkbox, { borderColor: hostConsent ? theme.accent : theme.line, backgroundColor: hostConsent ? theme.accent : theme.card }]}>{hostConsent && <ThemedText type="smallBold" style={{ color: theme.accentInk }}>✓</ThemedText>}</View><ThemedText type="smallBold" style={[styles.label, styles.consentText]}>{tr('이 모임에서 소개와 선택한 사진을 공개하는 데 동의해요.')}</ThemedText></Pressable>
        {errorField === 'profile' && !!error && <ThemedText accessibilityRole="alert" themeColor="accent" style={styles.bodyText}>{tr(error)}</ThemedText>}
        <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr('로그인한 회원이 볼 수 있어요. 비공개 선호 설정과 나머지 사진은 공유하지 않아요.')}</ThemedText>
        <Pressable analyticsId="meetup-create.profile-edit" accessibilityRole="button" disabled={saving} style={styles.membership} onPress={() => { play('selection'); setHostConsent(false); router.push('/meetup-profile'); }}><ThemedText type="smallBold" themeColor="accent" style={styles.label}>{tr('모임 프로필 수정')}</ThemedText></Pressable>
      </View>}
      {isAdmin && <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr("관리자 계정 · 모임 자리 제한 없음")}</ThemedText>}
      {kindChosen && <MeetupPolicyNotice mode={event.kind === 'once' ? 'once' : 'host'} />}
      </>
      {membershipError && <Pressable analyticsId="app_meetup-create.pressable.5" accessibilityRole="button" onPress={() => { play('selection'); router.push('/profile/membership'); }} style={styles.membership}>
        <ThemedText type="smallBold" themeColor="accent" style={styles.label}>{tr("멤버십과 모임 자리 보기 ›")}</ThemedText>
      </Pressable>}
    </ScrollView><View style={[styles.footer, { backgroundColor: theme.background, borderTopColor: theme.line }]}>
      {!!error && !errorField && <ThemedText accessibilityRole="alert" accessibilityLiveRegion="assertive" themeColor="accent" style={styles.bodyText}>{tr(error)}</ThemedText>}
      <RaisedActionButton analyticsId="app_meetup-create.pressable.4" disabled={saving || creatingDraft || pickingCover || !eventReady || invalidDestination} busy={saving || creatingDraft || pickingCover} onPress={() => { play('selection'); void submit(); }} label={saving ? tr("모임을 여는 중…") : pickingCover ? tr("사진을 준비하는 중…") : !kindChosen ? tr("모임 열기") : event.kind === 'group' ? tr('정기모임 열기') : tr('칠링 열기')} /></View></KeyboardAvoidingView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1 }, head: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three }, back: { position: 'absolute', zIndex: 1, left: Spacing.three, width: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, headTitle: { ...Typography.screenTitle, textAlign: 'center', flex: 1, paddingHorizontal: 44 + Spacing.two },
  content: { padding: 22, paddingBottom: Spacing.five, width: '100%', maxWidth: 640, alignSelf: 'center', gap: Spacing.three }, sectionTitle: { marginTop: Spacing.three }, firstSection: { marginTop: 0 }, label: { ...Typography.menu }, helper: { fontSize: 14, lineHeight: 22 }, bodyText: { fontSize: 16, lineHeight: 24 }, disclosure: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two }, field: { gap: Spacing.two },
  input: { borderWidth: 1, borderRadius: 10, minHeight: 48, padding: 12, fontSize: 16, lineHeight: 24 }, multiline: { minHeight: 110, textAlignVertical: 'top' },
  note: { padding: Spacing.three, borderRadius: 12, lineHeight: 22 },
  eventHero: { minHeight: 132, overflow: 'hidden', borderRadius: 16, backgroundColor: '#26203D', padding: Spacing.three, justifyContent: 'center' },
  eventHeroText: { maxWidth: '66%', gap: Spacing.two, zIndex: 1 },
  eventHeroLabel: { color: '#E8DDFB', fontSize: 12 }, eventHeroTitle: { color: '#FFFFFF', fontSize: 16, lineHeight: 22 }, eventHeroPlace: { color: '#D8D0E4', fontSize: 12 },
  eventHeroArt: { position: 'absolute', right: -22, top: -2, width: 190, height: 136 },
  aiButton: { alignSelf: 'flex-start', minHeight: 44, borderRadius: 22, paddingHorizontal: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, category: { borderWidth: 1, borderBottomWidth: 3, borderRadius: 24, minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 22, paddingVertical: Spacing.two },
  membership: { minHeight: 44, justifyContent: 'center' },
  consent: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three, borderWidth: 1, borderRadius: 10 },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 1, justifyContent: 'center', alignItems: 'center' }, consentText: { flex: 1 },
});
