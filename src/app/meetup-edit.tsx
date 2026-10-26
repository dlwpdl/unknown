import { useLanguage } from '@/hooks/use-language';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router';
import { Alert, DeviceEventEmitter, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { StateCard } from '@/components/state-card';
import { GlingLoader } from '@/components/gling-loader';
import { ChillingDateInput } from '@/components/chilling-date-input';
import { RaisedActionButton } from '@/components/raised-action-button';
import { Spacing } from '@/constants/theme';
import { Typography } from '@/constants/design-system';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { getChillingError, getChillingErrorCode } from '@/lib/chilling-data';
import { chillingAvailability, chillingCapacityLimit, chillingTimezoneLabel, configureChillingEvent, normalizeChillingEvent, shiftChillingSchedule, type ChillingEventDraft } from '@/lib/chilling';
import { editPost, MEETUPS_CHANGED_EVENT } from '@/lib/community-data';
import { loadPublicMeetupContext, type PublicMeetupContext } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useMembership } from '@/lib/membership-provider';
import { splitEventMeetupBody } from '@/lib/meetup-ai';
import { splitPlaceMeetupBody } from '@/lib/meetup-destination';
import { joinMeetupSections, parseMeetupSections } from '@/lib/meetup-sections';
import { MeetupSectionsEditor } from '@/components/meetup-sections';
import { supabase } from '@/lib/supabase';

type Baseline = { title: string; intro: string; event: ChillingEventDraft; capacity: string };

// Place/event lines are appended at creation and drive map/event links; only the human intro is editable.
// An unverifiable place tail still falls to the event split, so machine lines are kept rather than exposed.
const splitMeetupBody = (body: string, cityId: string) => splitPlaceMeetupBody(body, cityId) ?? splitEventMeetupBody(body);

export default function MeetupEditRoute() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { me, isAuthed } = useAuth();
  return <MeetupEditForm key={`${postId}:${isAuthed ? me.id : 'guest'}`} postId={typeof postId === 'string' ? postId : ''} />;
}

function MeetupEditForm({ postId }: { postId: string }) {
  const { tr } = useLanguage();
  const theme = useTheme(), router = useRouter();
  const { isAuthed, me, promptLogin } = useAuth();
  const { membership } = useMembership();
  const { play } = useInteractionFeedback();
  const [meetup, setMeetup] = useState<PublicMeetupContext | null>(null);
  const [loading, setLoading] = useState(isAuthed && !!postId), [loadError, setLoadError] = useState(''), [retry, setRetry] = useState(0);
  const [base, setBase] = useState<Baseline | null>(null);
  const [title, setTitle] = useState(''), [intro, setIntro] = useState(''), [details, setDetails] = useState('');
  const [event, setEvent] = useState<ChillingEventDraft | null>(null), [capacity, setCapacity] = useState('');
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [errorField, setErrorField] = useState<string | null>(null);
  const busy = useRef(false), mounted = useRef(true);
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
      const next = { title: value.title, intro: sections ? joinMeetupSections(sections) : parts.intro, event: draft, capacity: String(draft.capacity) };
      setBase(next); setTitle(next.title); setIntro(next.intro); setDetails(parts.details); setEvent(draft); setCapacity(next.capacity);
    }).catch(cause => { if (active) setLoadError(getChillingError(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isAuthed, postId, retry]);

  const textDirty = !!base && (title !== base.title || intro !== base.intro);
  const eventDirty = !!base && !!event && (capacity !== base.capacity || event.startsAt !== base.event.startsAt || event.endsAt !== base.event.endsAt || event.cadence !== base.event.cadence);
  const dirty = textDirty || eventDirty;
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
  const showValidation = (message: string, field: string | null = null) => { setError(message); setErrorField(field); play('warning'); };

  const save = async () => {
    if (busy.current || !meetup || !base || !event || !dirty) return;
    if (!title.trim()) return showValidation(tr('모임 제목을 적어주세요.'), 'title');
    if (!intro.trim()) return showValidation(tr('모임 소개를 적어주세요.'), 'intro');
    if (intro.trim().length + details.length > 5000) return showValidation(tr('모임 소개가 너무 길어요. 조금 줄여 주세요.'));
    const draft = { ...event, capacity: Number(capacity) };
    if (eventDirty) {
      const limit = Math.max(chillingCapacityLimit(membership), Number(base.capacity));
      if (!/^\d+$/.test(capacity) || draft.capacity < 2 || draft.capacity > limit) return showValidation(tr('정원은 호스트를 포함해 2명부터 {0}명까지예요.', limit), 'capacity');
      if (draft.capacity < memberCount) return showValidation(tr('현재 멤버 {0}명보다 적게 줄일 수 없어요. 호스트를 포함해 {0}명 이상으로 정해 주세요.', memberCount), 'capacity');
      if (draft.kind === 'once' && (event.startsAt !== base.event.startsAt) && Date.parse(event.startsAt) < Date.now()) return showValidation(tr('시작 시각이 이미 지났어요. 지금 이후로 선택해 주세요.'), 'schedule');
      try { normalizeChillingEvent(draft); } catch (cause) { return showValidation(getChillingError(cause), draft.kind === 'group' ? 'cadence' : 'schedule'); }
    }
    busy.current = true; setSaving(true); setError(''); setErrorField(null);
    let eventSaved = false;
    try {
      // Kind is passed back unchanged; the server rechecks ownership, expiry and the member floor.
      if (eventDirty) { await configureChillingEvent(supabase, meetup.id, draft); eventSaved = true; }
      if (textDirty) await editPost(supabase, meetup.id, { title: title.trim(), body: intro.trim() + details });
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

  const fieldError = (name: string) => errorField === name && !!error && <ThemedText accessibilityRole="alert" themeColor="accent" style={styles.bodyText}>{tr(error)}</ThemedText>;
  const clear = (name: string) => { if (errorField === name) { setError(''); setErrorField(null); } };
  const input = (name: string, label: string, value: string, change: (next: string) => void, placeholder: string, maxLength: number, multiline = false) => <View style={styles.field}>
    <ThemedText type="smallBold" style={styles.label}>{label}</ThemedText>
    <TextInput accessibilityLabel={label} value={value} onChangeText={next => { change(next); clear(name); }} placeholder={placeholder} placeholderTextColor={theme.textSecondary} maxLength={maxLength} multiline={multiline} editable={!saving} autoCapitalize="none" style={[styles.input, multiline && styles.multiline, { color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} />
    {fieldError(name)}
  </View>;

  const blocked = !isAuthed ? <StateCard kind="blocked" title={tr('로그인 후 모임을 수정할 수 있어요')} body={tr('모임을 연 호스트 계정으로 로그인해 주세요.')} actionLabel={tr('로그인')} onAction={() => promptLogin('모임을 수정하려면 로그인해 주세요.')} />
    : loading ? <GlingLoader />
    : loadError ? <StateCard kind="error" title={tr('모임을 불러오지 못했어요')} body={tr(loadError)} actionLabel={tr('다시 시도')} onAction={() => { setLoadError(''); setLoading(true); setRetry(value => value + 1); }} />
    : !meetup || !room ? <StateCard kind="empty" title={tr('이 모임을 찾을 수 없어요.')} body={tr('삭제되었거나 볼 수 없는 모임이에요.')} />
    : meetup.authorId !== me.id ? <StateCard kind="blocked" title={tr('호스트만 수정할 수 있어요')} body={tr('모임을 연 호스트만 정보를 바꿀 수 있어요.')} />
    : ended ? <StateCard kind="blocked" title={tr('종료된 모임이에요')} body={tr('종료된 모임은 정보를 수정할 수 없어요.')} />
    : null;

  return <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
    <View style={[styles.head, { backgroundColor: theme.background }]}><Pressable analyticsId="app_meetup-create.pressable.1" accessibilityRole="button" accessibilityLabel={tr('뒤로가기')} disabled={saving} accessibilityState={{ disabled: saving }} onPress={() => { play('selection'); back(); }} style={({ pressed }) => [styles.back, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}><SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={22} tintColor={theme.text} /></Pressable><ThemedText accessibilityRole="header" style={styles.headTitle}>{tr('모임 정보 수정')}</ThemedText></View>
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView analyticsId="app_meetup-create.scrollview.1" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {blocked ?? <>
        <ThemedText accessibilityRole="header" type="subtitle">{tr('기본 정보')}</ThemedText>
        {input('title', tr('모임 제목'), title, setTitle, tr('예: 퇴근하고 노을 보러 갈래요?'), 60)}
        <MeetupSectionsEditor value={intro} onChange={next => { setIntro(next); clear('intro'); }} disabled={saving} maxLength={Math.max(1, 5000 - details.length)}>
          {input('intro', tr('모임 소개'), intro, setIntro, tr('무엇을 함께 하고 싶은지 알려주세요.'), Math.max(1, 5000 - details.length), true)}
        </MeetupSectionsEditor>
        {!!details && <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr('연결된 장소·행사 정보는 그대로 남아요.')}</ThemedText>}
        {modern && event && <>
          <ThemedText accessibilityRole="header" type="subtitle" style={styles.sectionTitle}>{tr('일정과 정원')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr('일정을 바꾸면 멤버에게 ‘시간이나 장소가 바뀌었어요’ 알림이 가요.')}</ThemedText>
          <View style={styles.field}><ThemedText type="smallBold" style={styles.label}>{tr('모임 종류')}</ThemedText><ThemedText style={styles.bodyText}>{event.kind === 'once' ? tr('칠링') : tr('정기모임')}</ThemedText><ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr('모임 종류는 바꿀 수 없어요.')}</ThemedText></View>
          {event.kind === 'group' ? input('cadence', tr('활동 주기'), event.cadence, cadence => setEvent({ ...event, cadence }), tr('예: 매주 토요일 오전'), 80) : <View style={styles.field}>
            <ChillingDateInput label={tr('시작')} value={event.startsAt} minimumDate={new Date()} onChange={startsAt => { clear('schedule'); setEvent(current => current && { ...current, ...shiftChillingSchedule(current, startsAt) }); }} disabled={saving} />
            <ChillingDateInput label={tr('종료')} value={event.endsAt} minimumDate={new Date()} onChange={endsAt => { clear('schedule'); setEvent(current => current && { ...current, endsAt }); }} disabled={saving} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{chillingTimezoneLabel({ timezone: event.timezone })}</ThemedText>
            {fieldError('schedule')}
          </View>}
          <View style={styles.field}><ThemedText type="smallBold" style={styles.label}>{tr('정원 (호스트 포함)')}</ThemedText>
            <TextInput accessibilityLabel={tr('정원 (호스트 포함)')} keyboardType="number-pad" value={capacity} onChangeText={value => { setCapacity(value); clear('capacity'); }} editable={!saving} maxLength={4} style={[styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{tr('현재 멤버 {0}명 · 이보다 적게 줄일 수 없어요.', memberCount)}</ThemedText>
            {fieldError('capacity')}
          </View>
        </>}
      </>}
    </ScrollView>{!blocked && <View style={[styles.footer, { backgroundColor: theme.background, borderTopColor: theme.line }]}>
      {!!error && !errorField && <ThemedText accessibilityRole="alert" accessibilityLiveRegion="assertive" themeColor="accent" style={styles.bodyText}>{tr(error)}</ThemedText>}
      <RaisedActionButton analyticsId="meetup.manage.edit" disabled={saving || !dirty} busy={saving} onPress={() => { play('selection'); void save(); }} label={saving ? tr('저장 중…') : tr('저장')} />
    </View>}</KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, head: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three }, back: { position: 'absolute', zIndex: 1, left: Spacing.three, width: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, headTitle: { ...Typography.screenTitle, textAlign: 'center', flex: 1, paddingHorizontal: 44 + Spacing.two },
  content: { padding: 22, paddingBottom: Spacing.five, width: '100%', maxWidth: 640, alignSelf: 'center', gap: Spacing.three }, sectionTitle: { marginTop: Spacing.three }, label: { ...Typography.menu }, helper: { fontSize: 14, lineHeight: 22 }, bodyText: { fontSize: 16, lineHeight: 24 }, field: { gap: Spacing.two },
  input: { borderWidth: 1, borderRadius: 10, minHeight: 48, padding: 12, fontSize: 16, lineHeight: 24 }, multiline: { minHeight: 110, textAlignVertical: 'top' },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 22, paddingVertical: Spacing.two, gap: Spacing.two },
});
