import { useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, DeviceEventEmitter, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { ChillingDateInput } from '@/components/chilling-date-input';
import { MeetupPolicyNotice } from '@/components/meetup-policy-notice';
import { MeetupCoverPicker, type MeetupCover } from '@/components/meetup-cover-picker';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useCommunityCity } from '@/lib/community-city';
import { createChillingEvent, getChillingError, loadChillingProfile } from '@/lib/chilling-data';
import { type ChillingEventDraft } from '@/lib/chilling';
import { MEETUPS_CHANGED_EVENT } from '@/lib/community-data';
import { supabase } from '@/lib/supabase';

export default function MeetupCreateScreen() {
  const { me, isAuthed } = useAuth();
  return <MeetupCreateForm key={isAuthed ? me.id : 'guest'} />;
}

function MeetupCreateForm() {
  const theme = useTheme(), router = useRouter();
  const { city } = useCommunityCity();
  const { isAuthed, me, promptLogin } = useAuth();
  const [cover, setCover] = useState<MeetupCover | null>(null);
  const [pickingCover, setPickingCover] = useState(false);
  const [title, setTitle] = useState(''), [body, setBody] = useState('');
  const [question, setQuestion] = useState('어떤 분위기의 만남을 기대하세요?');
  const [event, setEvent] = useState<ChillingEventDraft>(() => {
    const start = new Date(Date.now() + 86400000); start.setMinutes(0, 0, 0);
    return { kind: 'once', startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3600000).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, cadence: '', capacity: 6, category: 'casual' };
  });
  const [capacity, setCapacity] = useState('6');
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const busy = useRef(false);
  const mounted = useRef(true);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const submit = async () => {
    if (busy.current || pickingCover) return;
    if (!isAuthed) return promptLogin('만남을 열려면 로그인해 주세요.');
    if (event.kind === 'once' && event.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone) { setError('기기 시간대가 바뀌었어요. 화면을 닫고 다시 열어 일정을 확인해 주세요.'); return; }
    if (!title.trim() || !body.trim() || !question.trim()) { setError('제목, 소개와 신청 질문을 모두 적어주세요.'); return; }
    if (!/^\d+$/.test(capacity) || Number(capacity) < 2 || Number(capacity) > 50) { setError('정원은 호스트를 포함해 2명부터 50명까지예요.'); return; }
    busy.current = true; setSaving(true); setError('');
    try {
      const profile = await loadChillingProfile(supabase);
      if (!mounted.current) return;
      if (!profile) {
        Alert.alert('모임 프로필을 먼저 만들어 주세요', '작성한 만남은 그대로 두었어요. 프로필을 저장하고 돌아와 다시 열어주세요.', [{ text: '나중에', style: 'cancel' }, { text: '프로필 작성', onPress: () => { if (mounted.current) router.push('/meetup-profile'); } }]);
        return;
      }
      const id = await createChillingEvent(supabase, { userId: me.id, image: cover ?? undefined, cityId: city.id, title: title.trim(), body: body.trim(), question: question.trim(), event: { ...event, capacity: Number(capacity) } });
      if (!mounted.current) return;
      DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT);
      router.replace({ pathname: '/post/[id]', params: { id } });
    } catch (cause) { if (mounted.current) setError(getChillingError(cause)); }
    finally { if (mounted.current) { busy.current = false; setSaving(false); } }
  };
  const field = (label: string, value: string, change: (s: string) => void, placeholder: string, maxLength: number, multiline = false) => <View style={styles.field}><ThemedText type="smallBold">{label}</ThemedText><TextInput accessibilityLabel={label} value={value} onChangeText={change} placeholder={placeholder} placeholderTextColor={theme.textSecondary} maxLength={maxLength} multiline={multiline} editable={!saving} autoCapitalize="none" style={[styles.input, multiline && styles.multiline, { color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} /></View>;
  return <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
    <View style={styles.head}><Pressable accessibilityRole="button" accessibilityLabel="뒤로가기" onPress={() => router.back()} style={styles.back}><ThemedText themeColor="accent">‹ 뒤로</ThemedText></Pressable><ThemedText accessibilityRole="header" type="subtitle">만남 열기</ThemedText></View>
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <View style={[styles.segments, { backgroundColor: theme.backgroundElement }]}>{(['once', 'group'] as const).map(kind => <Pressable key={kind} disabled={saving} accessibilityRole="tab" accessibilityState={{ selected: event.kind === kind, disabled: saving }} onPress={() => setEvent({ ...event, kind })} style={[styles.segment, event.kind === kind && { backgroundColor: theme.background }]}><ThemedText type="smallBold">{kind === 'once' ? '칠링 (일회성)' : '모임 (정기모임)'}</ThemedText></Pressable>)}</View>
      <ThemedText type="small" style={[styles.note, { backgroundColor: theme.backgroundElement }]}>무료로 열 수 있어요. 기본 승인·정원·질문도 포함돼요.</ThemedText>
      <MeetupPolicyNotice mode={event.kind === 'once' ? 'once' : 'host'} />
      <MeetupCoverPicker value={cover} onChange={setCover} onPickingChange={setPickingCover} disabled={saving} />
      {field('어떤 만남인가요?', title, setTitle, '예: 퇴근하고 노을 보러 갈래요?', 60)}
      {field('만남 소개', body, setBody, '무엇을 함께 하고 싶은지 알려주세요.', 5000, true)}
      <ThemedText type="smallBold">카테고리</ThemedText><View style={styles.categories}>{(['casual', 'hobby', 'travel'] as const).map((category, i) => <Pressable key={category} disabled={saving} accessibilityRole="button" accessibilityState={{ selected: event.category === category, disabled: saving }} onPress={() => setEvent({ ...event, category })} style={[styles.category, { borderColor: event.category === category ? theme.accent : theme.line }]}><ThemedText type="small">{['가볍게', '취미', '여행'][i]}</ThemedText></Pressable>)}</View>
      {event.kind === 'group' ? field('활동 주기', event.cadence, cadence => setEvent({ ...event, cadence }), '예: 매주 토요일 오전', 80) : <>
        <ChillingDateInput label="시작" value={event.startsAt} onChange={startsAt => setEvent({ ...event, startsAt })} disabled={saving} />
        <ChillingDateInput label="종료" value={event.endsAt} onChange={endsAt => setEvent({ ...event, endsAt })} disabled={saving} />
        <ThemedText type="small" themeColor="textSecondary">{event.timezone} · 기기 시간대 기준이에요. 활동 지역과 다른 시간대라면 기기 시간에 맞춰 선택해 주세요. 종료 후 신규 신청을 받지 않아요.</ThemedText>
      </>}
      <View style={styles.field}><ThemedText type="smallBold">활동 지역</ThemedText><ThemedText>{city.name}</ThemedText><ThemedText type="small" themeColor="textSecondary">지역을 바꾸려면 모임 화면에서 지역을 선택해 주세요.</ThemedText></View>
      <View style={styles.field}><ThemedText type="smallBold">정원 (호스트 포함)</ThemedText><TextInput accessibilityLabel="정원, 2명부터 50명" keyboardType="number-pad" value={capacity} onChangeText={setCapacity} editable={!saving} maxLength={2} style={[styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} /></View>
      {field('신청할 때 물어볼 질문', question, setQuestion, '어떤 분위기의 만남을 기대하세요?', 300)}
      <ThemedText type="small" themeColor="textSecondary">기본 질문 1개 · 신청자의 프로필과 함께 확인해요.</ThemedText>
      <ThemedText type="small" style={[styles.note, { backgroundColor: theme.backgroundElement }]}>상세 집결 장소는 승인된 멤버에게 그룹 채팅으로 안내해 주세요. 개최 시 내 모임 프로필은 행사에서 볼 수 있어요.</ThemedText>
      {!!error && <ThemedText accessibilityRole="alert" themeColor="accent">{error}</ThemedText>}
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving || pickingCover, busy: saving || pickingCover }} disabled={saving || pickingCover} onPress={() => void submit()} style={({ pressed }) => [styles.submit, { backgroundColor: theme.accent, opacity: saving || pickingCover || pressed ? 0.65 : 1 }]}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>{saving ? '만남을 여는 중…' : pickingCover ? '사진을 준비하는 중…' : `${event.kind === 'once' ? '칠링' : '모임'} 열기`}</ThemedText></Pressable>
    </ScrollView></KeyboardAvoidingView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1 }, head: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16 }, back: { minHeight: 48, justifyContent: 'center' },
  content: { padding: 22, paddingBottom: 48, width: '100%', maxWidth: 640, alignSelf: 'center', gap: 8 }, field: { gap: 8, marginVertical: 8 },
  input: { borderWidth: 1, borderRadius: 10, minHeight: 48, padding: 12, fontSize: 15 }, multiline: { minHeight: 110, textAlignVertical: 'top' },
  note: { padding: 16, borderRadius: 12, marginVertical: 12, lineHeight: 22 }, segments: { flexDirection: 'row', padding: 4, borderRadius: 12, gap: 4 }, segment: { flex: 1, minHeight: 44, padding: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  categories: { flexDirection: 'row', gap: 8 }, category: { borderWidth: 1, borderRadius: 24, minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  submit: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 12, marginTop: 8 },
});
