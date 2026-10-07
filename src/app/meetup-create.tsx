import { Pressable, ScrollView } from '@/components/analytics-controls';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, DeviceEventEmitter, KeyboardAvoidingView, LayoutAnimation, Platform, StyleSheet, TextInput, UIManager, View } from 'react-native';
import { Image } from 'expo-image';
import { useReducedMotion } from 'react-native-reanimated';
import { SymbolView } from 'expo-symbols';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { StateCard } from '@/components/state-card';
import { Depth, Spacing } from '@/constants/theme';
import { CITIES } from '@/lib/mock';
import { eventMeetupDraft, isFestivalEvent, loadTicketmasterEvent, meetupAllowed, type TicketmasterEvent } from '@/lib/ticketmaster';
import { ChillingDateInput } from '@/components/chilling-date-input';
import { MeetupPolicyNotice } from '@/components/meetup-policy-notice';
import { MeetupCoverPicker, type MeetupCover } from '@/components/meetup-cover-picker';
import { MeetupKindSwitch } from '@/components/meetup-kind-switch';
import { RaisedActionButton } from '@/components/raised-action-button';
import { relationshipSlotData } from '@/components/relationship-slot-card';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { useCommunityCity } from '@/lib/community-city';
import { createChillingEvent, getChillingError, loadChillingProfile } from '@/lib/chilling-data';
import { type ChillingEventDraft } from '@/lib/chilling';
import { getCommunityActionError, MEETUPS_CHANGED_EVENT } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useMembership } from '@/lib/membership-provider';
import { supabase } from '@/lib/supabase';
import { behavior } from '@/lib/behavior-analytics';
import { parseAiDraftResponse } from '@/lib/ai-draft';
import { splitEventMeetupBody } from '@/lib/meetup-ai';

export default function MeetupCreateScreen() {
  const { me, isAuthed } = useAuth();
  const { ticketmasterEventId = '', ticketmasterCityId = '' } = useLocalSearchParams<{ ticketmasterEventId?: string; ticketmasterCityId?: string }>();
  return <MeetupCreateForm key={`${isAuthed ? me.id : 'guest'}:${ticketmasterCityId}:${ticketmasterEventId}`} />;
}

function MeetupCreateForm() {
  const theme = useTheme(), router = useRouter();
  const { city } = useCommunityCity();
  const { ticketmasterEventId, ticketmasterCityId } = useLocalSearchParams<{ ticketmasterEventId?: string; ticketmasterCityId?: string }>();
  const meetupCity = ticketmasterEventId ? CITIES.find(item => item.id === ticketmasterCityId && item.state === 'open') : city;
  const [eventReady, setEventReady] = useState(!ticketmasterEventId), [eventError, setEventError] = useState(''), [eventAttempt, setEventAttempt] = useState(0);
  const [sourceEvent, setSourceEvent] = useState<TicketmasterEvent | null>(null);
  const loadedEvent = useRef('');
  const { isAuthed, me, promptLogin, isAdmin } = useAuth();
  const { membership, refresh: refreshMembership } = useMembership();
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const slots = relationshipSlotData(membership, 'meetup');
  const slotsFull = !isAdmin && slots ? slots.available === 0 : false;
  const [cover, setCover] = useState<MeetupCover | null>(null);
  const [pickingCover, setPickingCover] = useState(false);
  const [title, setTitle] = useState(''), [body, setBody] = useState('');
  const [eventDetails, setEventDetails] = useState('');
  const [creatingDraft, setCreatingDraft] = useState(false), [aiDraftReady, setAiDraftReady] = useState(false);
  const [draftEdited, setDraftEdited] = useState(false);
  const [question, setQuestion] = useState('어떤 분위기의 모임을 기대하세요?');
  const [event, setEvent] = useState<ChillingEventDraft>(() => {
    const start = new Date(Date.now() + 86400000); start.setMinutes(0, 0, 0);
    return { kind: 'once', startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3600000).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, cadence: '', capacity: 6, category: 'casual' };
  });
  const [capacity, setCapacity] = useState('6');
  const [ageMin, setAgeMin] = useState(''), [ageMax, setAgeMax] = useState('');
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  // 한도 초과는 등급 문제라 멤버십 화면으로 바로 보낸다.
  const membershipError = !!errorCode && !!t.actionErrors[errorCode as keyof typeof t.actionErrors]?.membership;
  const busy = useRef(false);
  const mounted = useRef(true);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!ticketmasterEventId || !isAuthed || loadedEvent.current === ticketmasterEventId) return;
    let active = true; setEventReady(false); setEventError('');
    loadTicketmasterEvent(ticketmasterCityId ?? '', ticketmasterEventId).then(({ event: source }) => {
      const draft = eventMeetupDraft(source);
      if (!active) return;
      const { intro, details } = splitEventMeetupBody(draft.body);
      setTitle(draft.title); setBody(intro); setEventDetails(details); setSourceEvent(source);
      setEvent(current => ({ ...current, kind: 'once', category: isFestivalEvent(source) ? 'festival' : 'hobby', startsAt: draft.startsAt, endsAt: draft.endsAt }));
      loadedEvent.current = ticketmasterEventId; setEventReady(true);
    }).catch(cause => { if (active) setEventError(cause.message); });
    return () => { active = false; };
  }, [ticketmasterEventId, ticketmasterCityId, isAuthed, eventAttempt]);
  const createAiDraft = async () => {
    const titleHint = title.trim(), bodyHint = body.trim();
    if (creatingDraft || saving || !eventReady || (!titleHint && !bodyHint && !cover)) return;
    if (!isAuthed) return promptLogin('AI로 초안을 만들려면 로그인해 주세요.');
    if (bodyHint.length > 1000) {
      Alert.alert('소개가 너무 길어요', 'AI 다듬기는 소개 1000자까지 사용할 수 있어요. 글을 줄이거나 직접 작성해 주세요.');
      return;
    }
    setCreatingDraft(true);
    try {
      const { data, error: draftError } = await supabase.functions.invoke('draft-post', { body: {
        cityName: meetupCity?.name ?? city.name,
        selectedCategory: 'meetup',
        ...(!draftEdited && ticketmasterEventId ? { intent: 'event_meetup' } : {}),
        titleHint: titleHint || undefined,
        bodyHint: bodyHint || undefined,
        ...(!titleHint && !bodyHint && cover ? { imageBase64: cover.base64, mimeType: cover.mimeType } : {}),
      } });
      if (draftError) throw draftError;
      const draft = parseAiDraftResponse(data);
      if (!mounted.current) return;
      setTitle(draft.title.slice(0, 60));
      setBody(draft.body);
      setAiDraftReady(true);
      setDraftEdited(true);
    } catch {
      if (mounted.current) Alert.alert(t.write.aiErrorTitle, t.write.aiErrorBody);
    } finally {
      if (mounted.current) setCreatingDraft(false);
    }
  };
  const submit = async () => {
    if (busy.current || creatingDraft || pickingCover || !eventReady || !meetupCity) return;
    if (!isAuthed) return promptLogin('모임을 열려면 로그인해 주세요.');
    if (slotsFull) {
      Alert.alert('모임 자리가 없어요', `동시에 운영·참여할 수 있는 모임 자리 ${slots!.limit}개를 모두 사용 중이에요. 모임을 종료하거나 나가면 자리는 바로 돌아와요.`,
        [{ text: '닫기', style: 'cancel' }, { text: '멤버십 보기', onPress: () => router.push('/profile/membership') }]);
      return;
    }
    if (event.kind === 'once' && event.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone) { setError('기기 시간대가 바뀌었어요. 화면을 닫고 다시 열어 일정을 확인해 주세요.'); return; }
    if (!title.trim() || !body.trim() || !question.trim()) { setError('제목, 소개와 신청 질문을 모두 적어주세요.'); return; }
    if (!/^\d+$/.test(capacity) || Number(capacity) < 2 || Number(capacity) > 50) { setError('정원은 호스트를 포함해 2명부터 50명까지예요.'); return; }
    if ((ageMin || ageMax) && (!/^\d+$/.test(ageMin) || !/^\d+$/.test(ageMax) || Number(ageMin) > Number(ageMax) || Number(ageMax) > 120)) { setError('권장 연령은 만 0~120세 안에서 최소·최대 나이를 함께 입력해주세요.'); return; }
    busy.current = true; setSaving(true); setError(''); setErrorCode(null);
    try {
      if (ticketmasterEventId) {
        const latest = await loadTicketmasterEvent(ticketmasterCityId ?? '', ticketmasterEventId).catch(cause => { if (mounted.current) setError(cause.message); return null; });
        if (!latest || !mounted.current) return;
        if (!meetupAllowed(latest.event)) { setError('행사 일정 또는 판매 상태가 바뀌었어요. 행사 상세를 다시 확인해 주세요.'); return; }
      }
      const profile = await loadChillingProfile(supabase);
      if (!mounted.current) return;
      if (!profile) {
        Alert.alert('모임 프로필을 먼저 만들어 주세요', '작성한 모임은 그대로 두었어요. 프로필을 저장하고 돌아와 다시 열어주세요.', [{ text: '나중에', style: 'cancel' }, { text: '프로필 작성', onPress: () => { if (mounted.current) router.push('/meetup-profile'); } }]);
        return;
      }
      const id = await createChillingEvent(supabase, { userId: me.id, image: cover ?? undefined, cityId: meetupCity.id, title: title.trim(), body: body.trim() + eventDetails, question: question.trim(), event: { ...event, capacity: Number(capacity), ...(ageMin ? { recommendedAgeMin: Number(ageMin), recommendedAgeMax: Number(ageMax) } : {}) } });
      if (ticketmasterEventId) behavior('success', 'ticketmaster.meetup.created');
      if (!mounted.current) return;
      DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT);
      play('meetupCreated');
      router.replace({ pathname: '/post/[id]', params: { id } });
    } catch (cause) {
      if (!mounted.current) return;
      play('warning');
      setError(getChillingError(cause)); setErrorCode(getCommunityActionError(cause));
      void refreshMembership();
    }
    finally { if (mounted.current) { busy.current = false; setSaving(false); } }
  };
  const field = (label: string, value: string, change: (s: string) => void, placeholder: string, maxLength: number, multiline = false) => <View style={styles.field}><ThemedText type="smallBold">{label}</ThemedText><TextInput accessibilityLabel={label} value={value} onChangeText={change} placeholder={placeholder} placeholderTextColor={theme.textSecondary} maxLength={maxLength} multiline={multiline} editable={!saving && !creatingDraft && eventReady} autoCapitalize="none" style={[styles.input, multiline && styles.multiline, { color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} /></View>;
  const changeKind = (kind: ChillingEventDraft['kind']) => {
    if (!reducedMotion) {
      if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    setEvent(current => ({ ...current, kind }));
  };
  return <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
    <View style={[styles.head, { backgroundColor: theme.background }]}><Pressable analyticsId="app_meetup-create.pressable.1" accessibilityRole="button" accessibilityLabel="뒤로가기" onPress={() => { play('selection'); router.back(); }} style={({ pressed }) => [styles.back, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}><SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={22} tintColor={theme.text} /></Pressable><ThemedText accessibilityRole="header" style={styles.headTitle}>모임 열기</ThemedText></View>
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView analyticsId="app_meetup-create.scrollview.1" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {ticketmasterEventId && (!isAuthed ? <StateCard kind="blocked" title="로그인 후 모임을 열 수 있어요" body="로그인하면 행사 정보를 불러와요." actionLabel="로그인" onAction={() => promptLogin('행사 모임을 열려면 로그인해 주세요.')} /> : !eventReady ? <StateCard kind={eventError ? 'error' : 'empty'} title={eventError ? '행사를 확인하지 못했어요' : '행사 정보를 확인하고 있어요'} body={eventError || '확인 후 제목과 일정을 채워드려요.'} actionLabel={eventError ? '다시 시도' : undefined} onAction={eventError ? () => setEventAttempt(n => n + 1) : undefined} /> : sourceEvent && <View style={styles.eventHero} accessibilityRole="summary"><View style={styles.eventHeroText}><ThemedText type="smallBold" style={styles.eventHeroLabel}>{isFestivalEvent(sourceEvent) ? '함께 가고 싶은 페스티벌' : '함께 갈 행사'}</ThemedText><ThemedText type="smallBold" numberOfLines={2} style={styles.eventHeroTitle}>{sourceEvent.name}</ThemedText><ThemedText type="small" numberOfLines={1} style={styles.eventHeroPlace}>{sourceEvent.venue}{sourceEvent.venue && sourceEvent.city ? ' · ' : ''}{sourceEvent.city}</ThemedText></View><Image source={require('@/assets/images/festival-glass-orbs.webp')} style={styles.eventHeroArt} contentFit="contain" accessible={false} /></View>)}
      {!ticketmasterEventId && <><MeetupKindSwitch value={event.kind} onChange={changeKind} disabled={saving} analyticsId="app_meetup-create.pressable.2" /><ThemedText type="small" themeColor="textSecondary">{event.kind === 'once' ? '이번 한 번, 가볍게 만나요.' : '취향이 맞는 사람들과 정기적으로 만나요.'} 무료로 열 수 있어요.</ThemedText><ThemedText accessibilityRole="header" type="subtitle" style={styles.sectionTitle}>기본 정보</ThemedText></>}
      <MeetupCoverPicker value={cover} onChange={setCover} onPickingChange={setPickingCover} disabled={saving || creatingDraft || !eventReady} />
      {field('모임 제목', title, value => { setTitle(value); setDraftEdited(true); setAiDraftReady(false); }, '예: 퇴근하고 노을 보러 갈래요?', 60)}
      {field('모임 소개', body, value => { setBody(value); setDraftEdited(true); setAiDraftReady(false); }, '무엇을 함께 하고 싶은지 알려주세요.', Math.max(1, 5000 - eventDetails.length), true)}
      {!!eventDetails && <ThemedText type="small" themeColor="textSecondary">모임에 행사 상세 보기 버튼이 연결돼요.</ThemedText>}
      <Pressable analyticsId="app_meetup-create.ai-draft" accessibilityRole="button" accessibilityState={{ disabled: creatingDraft || saving || !eventReady || (!title.trim() && !body.trim() && !cover), busy: creatingDraft }} disabled={creatingDraft || saving || !eventReady || (!title.trim() && !body.trim() && !cover)} onPress={() => { play('selection'); void createAiDraft(); }} style={({ pressed }) => [styles.aiButton, Depth.control, { backgroundColor: theme.backgroundElement, opacity: creatingDraft || saving || !eventReady || (!title.trim() && !body.trim() && !cover) ? 0.5 : 1, transform: [{ translateY: pressed ? 2 : 0 }] }]}><SymbolView name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }} size={17} tintColor={theme.accent} /><ThemedText type="smallBold" style={{ color: theme.accent }}>{creatingDraft ? t.write.creatingDraft : draftEdited ? t.write.polishDraft : t.write.createDraft}</ThemedText></Pressable>
      {aiDraftReady && <ThemedText accessibilityRole="alert" type="small" themeColor="textSecondary">{t.write.reviewDraft}</ThemedText>}
      <View style={styles.field}><ThemedText type="smallBold">카테고리</ThemedText><View style={styles.categories} accessibilityRole="radiogroup" accessibilityLabel="카테고리">{(['casual', 'party', 'festival', 'sports', 'hobby', 'travel'] as const).map((category, i) => <Pressable analyticsId="app_meetup-create.pressable.3" key={category} disabled={saving} accessibilityRole="radio" accessibilityState={{ checked: event.category === category, disabled: saving }} onPress={() => { play('selection'); setEvent(current => ({ ...current, category })); }} style={({ pressed }) => [styles.category, Depth.control, { borderColor: event.category === category ? theme.accentDepth : theme.line, backgroundColor: event.category === category ? theme.accent : theme.card, transform: [{ translateY: pressed ? 2 : 0 }] }]}><ThemedText type="small" style={{ color: event.category === category ? theme.accentInk : theme.text }}>{['가볍게', '파티', '페스티벌', '스포츠', '취미', '여행'][i]}</ThemedText></Pressable>)}</View>{event.category === 'sports' && <View style={styles.sports}><ThemedText type="small" themeColor="textSecondary">어떤 운동을 함께할까요?</ThemedText><View style={styles.categories}>{['골프', '테니스', '러닝', '농구', '축구', '풋살', '트레킹'].map(sport => <Pressable analyticsId="app_meetup-create.sport" key={sport} accessibilityRole="button" onPress={() => { play('selection'); setTitle(current => current.trim() ? current : `${sport} 같이해요`); }} style={({ pressed }) => [styles.category, Depth.control, { borderColor: theme.line, backgroundColor: pressed ? theme.backgroundSelected : theme.card, transform: [{ translateY: pressed ? 2 : 0 }] }]}><ThemedText type="small">{sport}</ThemedText></Pressable>)}</View></View>}</View>
      <ThemedText accessibilityRole="header" type="subtitle" style={styles.sectionTitle}>일정과 인원</ThemedText>
      {event.kind === 'group' ? field('활동 주기', event.cadence, cadence => setEvent({ ...event, cadence }), '예: 매주 토요일 오전', 80) : <>
        <ChillingDateInput label="시작" value={event.startsAt} onChange={startsAt => setEvent({ ...event, startsAt })} disabled={saving} />
        <ChillingDateInput label="종료" value={event.endsAt} onChange={endsAt => setEvent({ ...event, endsAt })} disabled={saving} />
        {!!ticketmasterEventId && <ThemedText type="small" themeColor="textSecondary">모임 종료는 행사 시작 2시간 뒤로 임시 설정했어요. 실제 만날 시간과 종료 시간을 확인해 주세요.</ThemedText>}
        <ThemedText type="small" themeColor="textSecondary">{event.timezone} · 기기 시간대 기준이에요. 활동 지역과 다른 시간대라면 기기 시간에 맞춰 선택해 주세요. 종료 후 신규 신청을 받지 않아요.</ThemedText>
      </>}
      <View style={styles.field}><ThemedText type="smallBold">활동 지역</ThemedText><ThemedText>{meetupCity?.name ?? city.name}</ThemedText><ThemedText type="small" themeColor="textSecondary">지역을 바꾸려면 모임 화면에서 지역을 선택해 주세요.</ThemedText></View>
      <View style={styles.field}><ThemedText type="smallBold">정원 (호스트 포함)</ThemedText><TextInput accessibilityLabel="정원, 2명부터 50명" keyboardType="number-pad" value={capacity} onChangeText={setCapacity} editable={!saving && eventReady} maxLength={2} style={[styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} /></View>
      <ThemedText accessibilityRole="header" type="subtitle" style={styles.sectionTitle}>신청 설정</ThemedText>
      <View style={styles.field}>
        <ThemedText type="smallBold">권장 연령대 · 선택</ThemedText>
        <View style={styles.categories}>
          <TextInput accessibilityLabel="권장 최소 나이, 만 나이" placeholder="최소, 예: 20" placeholderTextColor={theme.textSecondary} keyboardType="number-pad" value={ageMin} onChangeText={setAgeMin} editable={!saving && eventReady} maxLength={3} style={[styles.input, { flex: 1, minWidth: 0, color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} />
          <TextInput accessibilityLabel="권장 최대 나이, 만 나이" placeholder="최대, 예: 39" placeholderTextColor={theme.textSecondary} keyboardType="number-pad" value={ageMax} onChangeText={setAgeMax} editable={!saving && eventReady} maxLength={3} style={[styles.input, { flex: 1, minWidth: 0, color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} />
        </View>
        <ThemedText type="small" themeColor="textSecondary">비워두면 연령대 무관이에요. 권장 연령대와 달라도 신청할 수 있어요.</ThemedText>
      </View>
      {field('신청할 때 물어볼 질문', question, setQuestion, '어떤 분위기의 모임을 기대하세요?', 300)}
      <ThemedText type="small" themeColor="textSecondary">기본 질문 1개 · 신청자의 프로필과 함께 확인해요.</ThemedText>
      <ThemedText type="small" style={[styles.note, { backgroundColor: theme.backgroundElement }]}>상세 집결 장소는 승인된 멤버에게 그룹 채팅으로 안내해 주세요. 개최 시 내 모임 프로필은 행사에서 볼 수 있어요.</ThemedText>
      {isAdmin ? <ThemedText type="small" themeColor="textSecondary">관리자 계정 · 모임 자리 제한 없음</ThemedText>
        : slots && <ThemedText type="small" themeColor={slotsFull ? 'accent' : 'textSecondary'}>
        {slotsFull ? `동시 모임 자리 ${slots.limit}개를 모두 사용 중이에요. 모임을 종료하거나 나가면 자리는 바로 돌아와요.`
          : `동시 모임 자리 ${slots.active}/${slots.limit} 사용 중 · 남은 자리 ${slots.available}개`}
      </ThemedText>}
      <MeetupPolicyNotice mode={event.kind === 'once' ? 'once' : 'host'} />
      {!!error && <ThemedText accessibilityRole="alert" themeColor="accent">{error}</ThemedText>}
      {membershipError && <Pressable analyticsId="app_meetup-create.pressable.5" accessibilityRole="button" onPress={() => { play('selection'); router.push('/profile/membership'); }} style={styles.membership}>
        <ThemedText type="smallBold" themeColor="accent">멤버십과 모임 자리 보기 ›</ThemedText>
      </Pressable>}
    </ScrollView><View style={[styles.footer, { backgroundColor: theme.background, borderTopColor: theme.line }]}><RaisedActionButton analyticsId="app_meetup-create.pressable.4" disabled={saving || creatingDraft || pickingCover || !eventReady} busy={saving || creatingDraft || pickingCover} onPress={() => { play('selection'); void submit(); }} label={saving ? '모임을 여는 중…' : pickingCover ? '사진을 준비하는 중…' : ticketmasterEventId ? '모임 열기' : `${event.kind === 'once' ? '칠링' : '모임'} 열기`} /></View></KeyboardAvoidingView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1 }, head: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three }, back: { position: 'absolute', left: Spacing.three, width: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, headTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
  content: { padding: 22, paddingBottom: Spacing.five, width: '100%', maxWidth: 640, alignSelf: 'center', gap: Spacing.three }, sectionTitle: { marginTop: Spacing.three }, field: { gap: Spacing.two },
  input: { borderWidth: 1, borderRadius: 10, minHeight: 48, padding: 12, fontSize: 15 }, multiline: { minHeight: 110, textAlignVertical: 'top' },
  note: { padding: Spacing.three, borderRadius: 12, lineHeight: 22 },
  eventHero: { minHeight: 132, overflow: 'hidden', borderRadius: 16, backgroundColor: '#26203D', padding: Spacing.three, justifyContent: 'center' },
  eventHeroText: { maxWidth: '66%', gap: Spacing.two, zIndex: 1 },
  eventHeroLabel: { color: '#E8DDFB', fontSize: 12 }, eventHeroTitle: { color: '#FFFFFF', fontSize: 16, lineHeight: 22 }, eventHeroPlace: { color: '#D8D0E4', fontSize: 12 },
  eventHeroArt: { position: 'absolute', right: -22, top: -2, width: 190, height: 136 },
  aiButton: { alignSelf: 'flex-start', minHeight: 44, borderRadius: 22, paddingHorizontal: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, category: { borderWidth: 1, borderBottomWidth: 3, borderRadius: 24, minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' }, sports: { gap: 8, marginTop: 4 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 22, paddingVertical: Spacing.two },
  membership: { minHeight: 44, justifyContent: 'center' },
});
