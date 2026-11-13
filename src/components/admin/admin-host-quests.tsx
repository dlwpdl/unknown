import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AdminButton, AdminCard, AdminDock, AdminFacts, AdminPill, AdminTrace, type AdminTone } from '@/components/admin/admin-ui';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import {
  adminQuestPhotoUrl, askAdminQuestAttendee, createAdminQuestCodes, decideAdminQuestStep, endAdminQuest, loadAdminQuest, loadAdminQuestProgram, payoutBlockers,
  questCheckCandidates, recordAdminQuestCheck, reviewAdminQuestPhoto, setAdminQuestAccepting, setAdminQuestCode, setAdminQuestPhotoPeople, settleAdminQuestPayout,
  type AdminQuest, type AdminQuestProgram,
} from '@/lib/admin-host-quests';
import { QUEST_PERSON_REASONS, QUEST_STEPS, dollars } from '@/lib/host-quests';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

const A = Colors.admin;
const when = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const STATUS: Record<string, [string, AdminTone]> = { active: ['진행 중', 'accent'], paid: ['보냄', 'success'], converted: ['이용권으로 바꿈', 'neutral'], ended: ['끝남', 'neutral'] };
const PAYOUT: Record<string, [string, AdminTone]> = { requested: ['송금 요청', 'warning'], sent: ['보냄', 'success'], held: ['보류', 'danger'] };
const PROBLEM: Record<string, string> = { too_long: '4시간 넘는 모임', invite_only: '초대 전용 모임', late_notice: '24시간 안에 잡은 모임', missing: '모임 없음' };
const ERRORS: Record<string, string> = {
  QUEST_CODE_LIMIT: '코드 상한을 넘어요. 상한은 사장님 DB 명령으로만 올려요.', STEP_NOT_DUE: '14일이 지나야 확정할 수 있어요.', STEP_NOT_PENDING: '이미 처리된 줄이에요.',
  NOTE_REQUIRED: '메모를 남겨 주세요.', CHECK_LIMIT: '확인 메시지는 6명까지 보내요.', PAYOUT_ALREADY_SENT: '이미 보냈어요.', PAYOUT_NAME_MISMATCH: '코드 받은 사람 이름과 은행 이름이 달라요.',
  PHOTO_PEOPLE_REQUIRED: '사진 속 사람 수를 먼저 적어 주세요.', ATTENDEE_CHECKS_REQUIRED: '참석자 2명에게 먼저 확인받아 주세요.', BANK_NAME_CHECK_REQUIRED: '은행 화면의 이름을 확인해 주세요.',
  INVALID_TRANSFER_REFERENCE: '이체 번호 끝 4자리를 확인해 주세요.', RECIPIENT_NAME_REQUIRED: '코드 받은 사람 이름을 먼저 적어 주세요.',
};
const failure = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  return Object.entries(ERRORS).find(([code]) => message.includes(code))?.[1] ?? '처리하지 못했어요. 권한과 연결을 확인해 주세요.';
};

export function AdminHostQuestsView({ refreshSignal, onUser, localPreview = false }: { refreshSignal: number; onUser: (id: string) => void; localPreview?: boolean }) {
  const { play } = useInteractionFeedback();
  const [program, setProgram] = useState<AdminQuestProgram | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [picked, setPicked] = useState(''), [revision, setRevision] = useState(0), [busy, setBusy] = useState(false);
  const [count, setCount] = useState('1'), [recipient, setRecipient] = useState(''), [made, setMade] = useState<string[]>([]);
  const working = useRef(false);
  useEffect(() => {
    if (localPreview) return;
    let active = true;
    loadAdminQuestProgram(supabase).then(value => { if (active) { setProgram(value); setError(''); } }, () => { if (active) setError('퀘스트를 불러오지 못했어요. 관리자 권한과 연결을 확인해 주세요.'); });
    return () => { active = false; };
  }, [localPreview, refreshSignal, revision]);
  async function run(action: () => Promise<unknown>, done: string) {
    if (working.current) return;
    working.current = true; setBusy(true); setNotice('');
    try { await action(); setNotice(done); play('success'); setRevision(value => value + 1); }
    catch (reason) { setNotice(failure(reason)); play('warning'); }
    finally { working.current = false; setBusy(false); }
  }
  if (localPreview) return <ThemedText type="small">미리보기에서는 퀘스트를 조회하지 않아요.</ThemedText>;
  return <View style={styles.page}>
    <ThemedText type="title" accessibilityRole="header">모임장 퀘스트</ThemedText>
    {!!error && <ThemedText type="small" accessibilityRole="alert" style={{ color: A.danger }}>{error}</ThemedText>}
    {!!notice && <ThemedText type="small" accessibilityLiveRegion="polite">{notice}</ThemedText>}
    {program && <AdminCard icon="$" tone="accent" title="코드와 예산" info={['코드는 이 화면에서만 만들고 보여요. 저장소에는 넣지 않아요.', '코드 하나에 최대 $50이에요. 상한을 올리려면 사장님 DB 명령이 필요해요.']}
      action={<AdminButton label={program.accepting ? '새 시작 멈추기' : '새 시작 다시 받기'} kind={program.accepting ? 'danger' : 'secondary'} disabled={busy}
        onPress={() => void run(() => setAdminQuestAccepting(supabase, !program.accepting), program.accepting ? '새 시작을 멈췄어요.' : '새 시작을 다시 받아요.')} />}>
      <AdminFacts items={[{ label: '새 시작', value: program.accepting ? '받는 중' : '멈춤', tone: program.accepting ? 'success' : 'warning' }, { label: '코드 상한', value: `${program.codeLimit}개 · 최대 $${program.codeLimit * 50}` },
        { label: '만든 코드', value: `${program.codesMade}개` }, { label: '남은 코드', value: `${program.remaining}개` }]} />
      <View style={styles.row}>
        <TextInput accessibilityLabel="만들 코드 수" value={count} onChangeText={setCount} keyboardType="number-pad" maxLength={2} style={[styles.input, styles.small]} />
        <TextInput accessibilityLabel="코드 받는 사람 이름" value={recipient} onChangeText={setRecipient} maxLength={80} placeholder="받는 사람 이름(은행 이름과 같게)" placeholderTextColor={A.textSecondary} style={styles.input} />
        <AdminButton kind="primary" label="코드 만들기" disabled={busy || !program.remaining || !(Number(count) >= 1)}
          onPress={() => void run(async () => setMade(await createAdminQuestCodes(supabase, Number(count), recipient)), '코드를 만들었어요. 받는 분께 직접 전해 주세요.')} />
      </View>
      {made.length > 0 && <ThemedText selectable style={styles.codes}>{made.join('  ')}</ThemedText>}
      {program.codes.map(code => <CodeRow key={code.code} code={code} busy={busy} onSave={(name, note) => void run(() => setAdminQuestCode(supabase, code.code, name, note), '코드 정보를 고쳤어요.')} />)}
    </AdminCard>}
    {program && <View style={styles.split}>
      <AdminCard icon="★" title="퀘스트" count={program.quests.length} style={styles.list}>
        {!program.quests.length && <ThemedText type="small" style={{ color: A.textSecondary }}>아직 시작한 퀘스트가 없어요.</ThemedText>}
        {program.quests.map(row => <Pressable key={row.id} accessibilityRole="button" accessibilityState={{ selected: row.id === picked }} accessibilityLabel={`${row.nickname} 퀘스트 열기`}
          onPress={() => { play('selection'); setPicked(row.id); }} style={({ pressed }) => [styles.item, row.id === picked && styles.itemOn, { opacity: pressed ? 0.7 : 1 }]}>
          <ThemedText type="smallBold" numberOfLines={1}>{`${row.nickname} · 확정 ${dollars(row.totals.confirmed)} · 확인 중 ${dollars(row.totals.pending)}`}</ThemedText>
          <View style={styles.pills}>
            <AdminPill label={STATUS[row.status]?.[0] ?? row.status} tone={STATUS[row.status]?.[1]} />
            {row.payoutStatus && <AdminPill label={PAYOUT[row.payoutStatus]?.[0] ?? row.payoutStatus} tone={PAYOUT[row.payoutStatus]?.[1]} />}
            {row.photoPending && <AdminPill label="사진 확인 대기" tone="warning" />}
            {row.held > 0 && <AdminPill label={`신고로 멈춤 ${row.held}`} tone="danger" />}
          </View>
        </Pressable>)}
      </AdminCard>
      {!!picked && <QuestDetail key={`${picked}:${revision}`} questId={picked} onUser={onUser} onChanged={() => setRevision(value => value + 1)} />}
    </View>}
  </View>;
}

function CodeRow({ code, busy, onSave }: { code: AdminQuestProgram['codes'][number]; busy: boolean; onSave: (name: string, note: string) => void }) {
  const [name, setName] = useState(code.recipientName ?? ''), [note, setNote] = useState(code.note ?? '');
  return <View style={styles.row}>
    <ThemedText selectable type="smallBold" style={styles.code}>{code.code}</ThemedText>
    <TextInput accessibilityLabel={`${code.code} 받는 사람 이름`} value={name} onChangeText={setName} maxLength={80} placeholder="받는 사람 이름" placeholderTextColor={A.textSecondary} style={styles.input} />
    <TextInput accessibilityLabel={`${code.code} 메모`} value={note} onChangeText={setNote} maxLength={300} placeholder="메모" placeholderTextColor={A.textSecondary} style={styles.input} />
    <ThemedText type="small" style={{ color: A.textSecondary }}>{code.usedAt ? `${code.nickname ?? '회원'} · ${when(code.usedAt)}` : '안 씀'}</ThemedText>
    <AdminButton label="저장" disabled={busy || !name.trim()} onPress={() => onSave(name, note)} />
  </View>;
}

function QuestDetail({ questId, onUser, onChanged }: { questId: string; onUser: (id: string) => void; onChanged: () => void }) {
  const { play } = useInteractionFeedback();
  const [quest, setQuest] = useState<AdminQuest | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({}), [people, setPeople] = useState(''), [last4, setLast4] = useState(''), [bankOk, setBankOk] = useState(false), [note, setNote] = useState('');
  const working = useRef(false);
  useEffect(() => { loadAdminQuest(supabase, questId).then(value => { setQuest(value); setPeople(value.payout?.photoPeople?.toString() ?? ''); }, () => setError('퀘스트를 불러오지 못했어요.')); }, [questId]);
  async function run(action: () => Promise<unknown>, done: string) {
    if (working.current) return;
    working.current = true; setBusy(true); setNotice('');
    try { await action(); setNotice(done); play('success'); onChanged(); }
    catch (reason) { setNotice(failure(reason)); play('warning'); }
    finally { working.current = false; setBusy(false); }
  }
  if (error) return <ThemedText type="small" accessibilityRole="alert" style={{ color: A.danger }}>{error}</ThemedText>;
  if (!quest) return <ThemedText type="small">불러오는 중이에요…</ThemedText>;
  const pay = quest.payout, total = quest.totals.confirmed + quest.totals.pending;
  const candidates = questCheckCandidates(quest), blockers = payoutBlockers(quest, bankOk, last4);
  const excluded = quest.sessions.flatMap(session => session.people).filter(person => person.reason).length;
  const helpers = quest.sessions.flatMap(session => session.people).filter(person => !person.reason && person.otherQuestHosts > 0).length;
  const stepSession = (step: number) => quest.steps.find(row => row.step === step && row.status !== 'cancelled')?.sessionIds[0];
  const label = (sessionId: string) => [2, 5, 7].find(step => stepSession(step) === sessionId);
  return <AdminCard title={`${pay ? '송금 요청' : '퀘스트'} · ${quest.host.nickname} · ${dollars(total)}`} style={styles.detail}
    action={<View style={styles.pills}>{excluded > 0 && <AdminPill label={`제외 ${excluded}명`} tone="warning" />}{helpers > 0 && <AdminPill label={`다른 퀘스트에도 나감 ${helpers}명`} tone="warning" />}</View>}>
    <ThemedText type="small" style={{ color: A.textSecondary }}>{[pay ? `${when(pay.requestedAt)} 요청` : null, pay?.legalName ? `받는 이름 ${pay.legalName}` : null, pay?.email, `코드 받은 사람 ${quest.code.recipientName ?? '—'}`, `시작 ${when(quest.startedAt)}`].filter(Boolean).join(' · ')}</ThemedText>
    <AdminButton kind="text" label="회원 보기" onPress={() => onUser(quest.host.id)} />
    <AdminFacts items={[{ label: '확정', value: dollars(quest.totals.confirmed), tone: quest.totals.confirmed >= 5000 ? 'success' : undefined }, { label: '확인 중', value: dollars(quest.totals.pending) },
      { label: '초대 셈', value: `${quest.totals.invitees}명` }, { label: '신고', value: `${quest.reports}건`, tone: quest.reports ? 'danger' : undefined }]} />
    <ThemedText type="smallBold" accessibilityRole="header">단계</ThemedText>
    {quest.steps.filter(row => row.status !== 'cancelled').map(row => <View key={row.id} style={styles.row}>
      <ThemedText type="small" style={styles.grow}>{`${row.step}단계 ${QUEST_STEPS[row.step - 1].name} · ${dollars(row.amount)} · ${row.status === 'confirmed' ? '확정' : row.heldReason ? '신고로 멈춤' : `확인 중(${when(row.confirmAfter)} 확정)`}`}</ThemedText>
      {row.status === 'pending' && <><AdminButton label="확정" disabled={busy} onPress={() => void run(() => decideAdminQuestStep(supabase, row.id, true, note), '확정했어요.')} />
        <AdminButton kind="danger" label="취소" disabled={busy || !note.trim()} onPress={() => void run(() => decideAdminQuestStep(supabase, row.id, false, note), '취소했어요.')} /></>}
    </View>)}
    <View style={styles.grid}>{quest.sessions.map(session => <View key={session.id} style={styles.block}>
      <ThemedText type="smallBold">{`${label(session.id) ? `${label(session.id)}단계 모임` : '모임'} · ${when(session.startsAt)} · ${session.title}`}</ThemedText>
      {session.problem && <AdminPill label={PROBLEM[session.problem] ?? session.problem} tone="neutral" />}
      <ThemedText type="small" style={{ color: A.textSecondary }}>{`신고 ${session.reports}건 · 노쇼 ${session.noShows}건`}</ThemedText>
      {session.people.map(person => <View key={person.id} style={[styles.person, person.reason && styles.out]}>
        <ThemedText type="small" style={styles.grow}>{person.nickname}</ThemedText>
        <ThemedText type="small">{`QR ${person.qr ? '✓' : '—'} · 서로 확인 ${person.confirmed ? '✓' : '—'}`}</ThemedText>
        {person.reason ? <AdminPill label={`제외 · ${QUEST_PERSON_REASONS[person.reason] ?? person.reason}`} tone="danger" />
          : person.otherQuestHosts > 0 ? <AdminPill label={`다른 퀘스트 모임장 ${person.otherQuestHosts}명`} tone="warning" /> : null}
      </View>)}
    </View>)}</View>
    <ThemedText type="smallBold" accessibilityRole="header">인증샷</ThemedText>
    {!quest.photos.length && <ThemedText type="small" style={{ color: A.textSecondary }}>아직 보낸 사진이 없어요.</ThemedText>}
    {quest.photos.map(photo => <View key={photo.id} style={styles.block}>
      {photo.path && (photoUrls[photo.id] ? <Image source={{ uri: photoUrls[photo.id] }} style={styles.photo} contentFit="contain" accessibilityLabel="모임 인증샷" />
        : <AdminButton label="사진 보기(기록 남음)" disabled={busy} onPress={() => void adminQuestPhotoUrl(supabase, photo.path!).then(url => setPhotoUrls(map => ({ ...map, [photo.id]: url })), reason => setNotice(failure(reason)))} />)}
      <ThemedText type="small" style={{ color: A.textSecondary }}>{`${when(photo.uploadedAt)} · 앱 카메라 · ${photo.sameFileElsewhere ? `같은 파일 ${photo.sameFileElsewhere}건 있음` : '같은 사진 없음'} · ${photo.deletedAt ? '지움' : `${when(photo.deleteAfter)} 지움`}`}</ThemedText>
      {photo.status === 'pending' ? <View style={styles.row}>
        <AdminButton kind="primary" label="사진 승인" disabled={busy} onPress={() => void run(() => reviewAdminQuestPhoto(supabase, photo.id, true, note), '사진을 승인했어요.')} />
        <AdminButton kind="danger" label="사진 거절" disabled={busy || !note.trim()} onPress={() => void run(() => reviewAdminQuestPhoto(supabase, photo.id, false, note), '사진을 거절했어요.')} />
      </View> : <AdminPill label={photo.status === 'approved' ? '승인함' : '거절함'} tone={photo.status === 'approved' ? 'success' : 'danger'} />}
    </View>)}
    {pay && <>
      <ThemedText type="smallBold" accessibilityRole="header">보내기 전 확인</ThemedText>
      <View style={styles.row}>
        <TextInput accessibilityLabel="사진 속 사람 수" value={people} onChangeText={setPeople} keyboardType="number-pad" maxLength={2} placeholder="사진 속 사람 수" placeholderTextColor={A.textSecondary} style={[styles.input, styles.small]} />
        <AdminButton label="사람 수 저장" disabled={busy || !(Number(people) >= 1)} onPress={() => void run(() => setAdminQuestPhotoPeople(supabase, quest.id, Number(people)), '사진 속 사람 수를 적었어요.')} />
        {pay.photoPeople != null && pay.photoPeople < (quest.steps.find(row => row.step === 2)?.personIds.length ?? 0) + 1 && <AdminPill label="사진 속 사람이 센 사람보다 적어요" tone="warning" />}
      </View>
      {candidates.map(person => {
        const check = quest.checks.find(item => item.personId === person.id);
        return <View key={person.id} style={styles.row}>
          <ThemedText type="small" style={styles.grow}>{`${person.nickname} · ${check ? `물어봄 ${when(check.askedAt)}` : '아직 안 물어봄'}${check?.answer ? ` · 답 ${check.answer === 'yes' ? '다녀왔어요' : check.answer === 'no' ? '안 갔어요' : '답 없음'}` : ''}`}</ThemedText>
          {!check ? <AdminButton label="다녀왔는지 묻기" disabled={busy} onPress={() => void run(() => askAdminQuestAttendee(supabase, quest.id, person.id), `${person.nickname}님께 메시지를 보냈어요.`)} />
            : <>{(['yes', 'no', 'none'] as const).map(answer => <AdminButton key={answer} label={answer === 'yes' ? '다녀왔어요' : answer === 'no' ? '안 갔어요' : '답 없음'} disabled={busy || check.answer === answer}
              onPress={() => void run(() => recordAdminQuestCheck(supabase, quest.id, person.id, answer), '답을 적었어요.')} />)}</>}
        </View>;
      })}
      {pay.sameNameElsewhere > 0 && <AdminPill label={`같은 은행 이름이 다른 퀘스트에 ${pay.sameNameElsewhere}건`} tone="warning" />}
      <AdminDock>
        <TextInput accessibilityLabel="처리 메모" value={note} onChangeText={setNote} maxLength={300} placeholder="메모(취소·거절·보류는 꼭)" placeholderTextColor={A.textSecondary} style={styles.input} />
        <TextInput accessibilityLabel="이체 번호 끝 4자리" value={last4} onChangeText={setLast4} maxLength={4} autoCapitalize="characters" placeholder="이체 번호 끝 4자리" placeholderTextColor={A.textSecondary} style={[styles.input, styles.small]} />
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: bankOk }} onPress={() => { play('selection'); setBankOk(value => !value); }} style={styles.check}>
          <View style={[styles.box, bankOk && { backgroundColor: A.accent, borderColor: A.accent }]} /><ThemedText type="small">은행 화면의 받는 사람 이름이 같아요</ThemedText>
        </Pressable>
        {pay.status !== 'sent' && blockers.length > 0 && <ThemedText type="small" style={{ color: A.warning }}>{`아직 못 보내요: ${blockers.join(' · ')}`}</ThemedText>}
        <View style={styles.row}>
          <AdminButton kind="danger" label="보류" disabled={busy || pay.status === 'sent' || !note.trim()} onPress={() => void run(() => settleAdminQuestPayout(supabase, quest.id, 'held', '', false, note), '보류했어요.')} />
          <AdminButton kind="primary" label={pay.status === 'sent' ? `보냄(${pay.transferLast4 ?? ''})` : '보냄'} disabled={busy || blockers.length > 0}
            onPress={() => void run(() => settleAdminQuestPayout(supabase, quest.id, 'sent', last4, bankOk, note), '보냄으로 적었어요.')} />
        </View>
      </AdminDock>
    </>}
    {quest.status === 'active' && <View style={styles.row}>
      <AdminButton kind="danger" label="퀘스트 끝내기(확정분은 이용권으로)" disabled={busy || !note.trim()} onPress={() => void run(() => endAdminQuest(supabase, quest.id, true, note), '퀘스트를 끝내고 확정분을 이용권으로 바꿨어요.')} />
      <AdminButton kind="danger" label="부정으로 끝내기(적립 취소)" disabled={busy || !note.trim()} onPress={() => void run(() => endAdminQuest(supabase, quest.id, false, note), '퀘스트를 끝냈어요.')} />
    </View>}
    {!!notice && <ThemedText type="small" accessibilityLiveRegion="polite">{notice}</ThemedText>}
    <AdminTrace items={[{ label: '퀘스트', value: quest.id }, { label: '회원', value: quest.host.id }, { label: '코드', value: quest.code.code }]} />
  </AdminCard>;
}

const styles = StyleSheet.create({
  page: { gap: Spacing.three, paddingVertical: Spacing.three },
  split: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: Spacing.three },
  list: { flexGrow: 1, flexBasis: 280, maxWidth: 420 },
  detail: { flexGrow: 3, flexBasis: 520 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  item: { minHeight: 52, justifyContent: 'center', gap: 4, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, borderRadius: 10 },
  itemOn: { backgroundColor: A.backgroundSelected },
  input: { flexGrow: 1, flexBasis: 180, minHeight: 40, paddingHorizontal: Spacing.two, borderWidth: 1, borderRadius: 8, borderColor: A.line, backgroundColor: A.card, color: A.text },
  small: { flexGrow: 0, flexBasis: 120 },
  code: { minWidth: 96, letterSpacing: 1 },
  codes: { fontSize: 18, lineHeight: 26, fontWeight: '700', letterSpacing: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  block: { flexGrow: 1, flexBasis: 260, gap: Spacing.one, padding: Spacing.two, borderWidth: 1, borderColor: A.line, borderRadius: 10 },
  person: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.one, paddingVertical: 2 },
  out: { opacity: 0.6 },
  grow: { flexGrow: 1, flexShrink: 1 },
  photo: { width: '100%', height: 220, borderRadius: 8, backgroundColor: A.backgroundElement },
  check: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, minHeight: 40 },
  box: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: A.textSecondary },
});
