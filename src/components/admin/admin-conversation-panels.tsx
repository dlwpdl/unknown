import { useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { FlatList, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Colors } from '@/constants/theme';
import {
  CONVERSATION_REVIEW_STATUS, CONVERSATION_RISK_LABEL,
  type ConversationCase, type ConversationDetail, type ConversationMessage, type ConversationReviewStatus,
} from '@/lib/admin-conversations';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { chatImagePaths } from '@/lib/chat-details';
import { CITIES } from '@/lib/mock';
import { supabase } from '@/lib/supabase';
import { ConversationButton, ConversationPicker, ConversationState } from './admin-conversation-controls';
import { conversationStyles as styles } from './admin-conversation-styles';

export const conversationTitle = (room: ConversationCase) => room.title || room.participants.map((person) => person.nickname).join(' ↔ ') || '참여자 정보 없음';
export const cityName = (id: string | null) => CITIES.find((city) => city.id === id)?.name ?? (id || '도시 미등록');
export const conversationCities = (room: ConversationCase) => [...new Set(room.participants.map((person) => cityName(person.city_id)))].join(' ↔ ') || '도시 미등록';
export const conversationTime = (at: string) => {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : date.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
};

function Avatars({ room }: { room: ConversationCase }) {
  return <View style={styles.avatars} aria-hidden accessibilityElementsHidden>
    {room.participants.slice(0, 2).map((person, index) => <View key={person.id} style={[styles.avatar, index > 0 && styles.avatarSecond]}>
      <Text style={styles.avatarText}>{person.nickname.slice(0, 1)}</Text>
    </View>)}
  </View>;
}

function RiskTag({ room }: { room: ConversationCase }) {
  const risk = room.risk_level;
  return <View style={[styles.tag, (risk === 'critical' || risk === 'high') && styles.dangerTag, risk === 'medium' && styles.warningTag, risk === 'low' && styles.accentTag]}>
    <Text style={[styles.tagText, (risk === 'critical' || risk === 'high') && styles.dangerText, risk === 'medium' && styles.warningText, risk === 'low' && styles.accentText]}>
      {risk === 'none' ? room.pending_analysis > 0 ? 'AI 분석 대기' : '감지 신호 없음' : `${CONVERSATION_RISK_LABEL[risk]} · 신호 ${room.signal_count}건`}
    </Text>
  </View>;
}

export function ConversationCaseRow({ room, selected, onPress }: { room: ConversationCase; selected: boolean; onPress: () => void }) {
  const { play } = useInteractionFeedback();
  return <Pressable nativeID={`conversation-case-${room.id}`} testID={`conversation-case-${room.id}`} accessibilityRole="button" aria-current={selected}
    accessibilityLabel={`${conversationTitle(room)}, ${conversationCities(room)}, ${room.kind === 'group' ? '그룹' : '1:1'}, ${CONVERSATION_RISK_LABEL[room.risk_level]}, ${CONVERSATION_REVIEW_STATUS[room.status]}${room.reopened ? ', 새 신호로 재검토 필요' : ''}`}
    onPress={() => { play('selection'); onPress(); }} style={({ pressed }) => [styles.caseRow, selected && styles.caseSelected, pressed && styles.pressed]}>
    <View style={styles.row}><Avatars room={room} /><Text numberOfLines={1} style={styles.caseTitle}>{conversationTitle(room)}</Text>
      <Text style={styles.caption}>{conversationTime(room.latest_message_at)}</Text></View>
    {room.kind === 'group' && !!room.title && <Text numberOfLines={1} style={styles.caption}>{room.participants.map((person) => person.nickname).join(', ')}</Text>}
    <Text numberOfLines={1} style={styles.caption}>{conversationCities(room)} · {room.kind === 'group' ? `그룹 ${room.participants.length}명` : '1:1 대화'}</Text>
    <Text numberOfLines={1} style={styles.body}>{room.latest_excerpt || '메시지 내용 없음'}</Text>
    <View style={[styles.row, styles.between]}><RiskTag room={room} />
      <Text style={styles.caption}>{room.reopened ? '재검토 필요' : CONVERSATION_REVIEW_STATUS[room.status]}</Text></View>
  </Pressable>;
}

export function ConversationThread({ detail, loading, error, loadingMessages, narrow, showReviewButton, focusId,
  onBack, onReview, onEarlier, onLatest, onFirstSignal, onRetry }: {
  detail: ConversationDetail | null; loading: boolean; error: string; loadingMessages: boolean;
  narrow: boolean; showReviewButton: boolean; focusId: string | null;
  onBack: () => void; onReview: () => void; onEarlier: () => void; onLatest: () => void;
  onFirstSignal: () => void; onRetry: () => void;
}) {
  const list = useRef<FlatList<ConversationMessage>>(null);
  const scrollEnd = useRef(true);
  const scrollTarget = useRef<number | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const roomId = detail?.conversation.id;
  const pathsKey = JSON.stringify([...new Set(detail?.messages.flatMap(chatImagePaths) ?? [])]);
  useEffect(() => { scrollEnd.current = true; }, [roomId]);
  useEffect(() => {
    let active = true;
    const paths: string[] = JSON.parse(pathsKey);
    if (!paths.length) return;
    void supabase.storage.from('chat-images').createSignedUrls(paths, 3600).then((result) => {
      if (active) setImageUrls(Object.fromEntries((result.data ?? []).flatMap((image) => image.path && image.signedUrl ? [[image.path, image.signedUrl]] : [])));
    }).catch(() => { /* Original attachment paths stay visible if image storage is unavailable. */ });
    return () => { active = false; };
  }, [pathsKey, roomId]);
  useEffect(() => {
    scrollTarget.current = null;
    const index = detail?.messages.findIndex((message) => message.id === focusId) ?? -1;
    if (index < 0) return;
    scrollEnd.current = false;
    scrollTarget.current = index;
    const frame = requestAnimationFrame(() => {
      list.current?.scrollToIndex({ index, animated: false, viewPosition: 0.4 });
      if (Platform.OS === 'web') document.getElementById(`conversation-message-${focusId}`)?.focus({ preventScroll: true });
    });
    return () => { cancelAnimationFrame(frame); scrollTarget.current = null; };
  }, [detail?.messages, focusId]);

  const back = narrow ? <View style={{ padding: 12 }}><ConversationButton testID="conversation-back" label="대화 목록으로 돌아가기" onPress={onBack} /></View> : null;
  if (loading) return <View style={styles.thread}>{back}<ConversationState testID="conversation-thread-loading" loading title="대화를 불러오는 중이에요." /></View>;
  if (!detail) return <View style={styles.thread}>{back}<ConversationState title={error ? '대화를 열 수 없어요.' : '대화를 선택해 주세요.'}
    body={error || '참여자와 위험 신호를 보고 목록에서 대화를 선택하세요.'} action={error ? '대화 다시 불러오기' : undefined} onAction={onRetry} /></View>;
  const room = detail.conversation;
  const participant = new Map(room.participants.map((person) => [person.id, person]));
  const signalIds = new Set(detail.signals.map((signal) => signal.message_id));
  const signalsPresent = room.signal_count > 0;

  return <View testID="conversation-thread" accessibilityLabel="선택한 대화 내용" style={styles.thread}>
    <View style={styles.threadHeader}>
      {narrow && <ConversationButton testID="conversation-back" label="대화 목록으로 돌아가기" onPress={onBack} style={styles.iconButton}>
        <SymbolView name={{ ios: 'chevron.left', web: 'arrow_back' }} size={20} tintColor={Colors.admin.textSecondary} />
      </ConversationButton>}
      <Avatars room={room} /><View nativeID="conversation-thread-title" tabIndex={-1} style={styles.grow}>
        <Text accessibilityRole="header" style={styles.threadTitle}>{conversationTitle(room)}</Text>
        <Text style={styles.caption}>{room.kind === 'group' ? `그룹 ${room.participants.length}명` : '1:1 대화'} · {conversationCities(room)} · 메시지 {room.message_count}개</Text>
      </View>
      {showReviewButton && <ConversationButton testID="conversation-inspector-open" label="조사 기록" onPress={onReview} />}
    </View>
    <View style={[styles.alert, !signalsPresent && styles.quietAlert]}>
      <SymbolView name={{ ios: 'exclamationmark.bubble', web: 'report' }} size={16} tintColor={signalsPresent ? Colors.admin.warning : Colors.admin.textSecondary} />
      <Text style={[styles.caption, styles.grow, signalsPresent && styles.warningText]}>
        {signalsPresent ? `감지 신호 ${room.signal_count}건 · 앞뒤 맥락을 확인하세요.` : room.pending_analysis > 0 ? `AI 분석 대기 ${room.pending_analysis}건 · 결과가 아직 없어요.` : '현재 표시할 감지 신호가 없어요. 필요하면 직접 검토할 수 있어요.'}
      </Text>
      {detail.signals.length > 0 && <ConversationButton testID="conversation-first-signal" label="첫 신호로 이동" onPress={onFirstSignal} disabled={loadingMessages} />}
    </View>
    {!!error && <View accessibilityRole="alert" style={styles.errorBox}><Text style={styles.error}>{error}</Text><ConversationButton label="최신 대화 다시 불러오기" onPress={onRetry} disabled={loadingMessages} /></View>}
    <FlatList ref={list} testID="conversation-messages" style={styles.scroll} contentContainerStyle={styles.messageList}
      data={detail.messages} keyExtractor={(message) => message.id} maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      onContentSizeChange={() => { if (scrollEnd.current && !focusId) list.current?.scrollToEnd({ animated: false }); }}
      onScrollToIndexFailed={({ index, averageItemLength }) => {
        list.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
        setTimeout(() => { if (scrollTarget.current === index) list.current?.scrollToIndex({ index, animated: false, viewPosition: 0.4 }); }, 100);
      }}
      ListHeaderComponent={detail.nextCursor ? <ConversationButton testID="conversation-earlier" label={loadingMessages ? '메시지를 불러오는 중…' : '이전 메시지 더 보기'} disabled={loadingMessages} busy={loadingMessages} onPress={() => { scrollEnd.current = false; onEarlier(); }} /> : null}
      ListEmptyComponent={<ConversationState title="보존된 원문 메시지가 없어요." body="감지 당시의 문구는 조사 기록에서 확인하세요." />}
      renderItem={({ item: message, index }) => {
        const sender = participant.get(message.sender_id);
        const second = room.participants[0]?.id !== message.sender_id;
        const flagged = signalIds.has(message.id);
        const paths = chatImagePaths(message);
        return <View>
          {(index === 0 || detail.messages[index - 1]?.created_at.slice(0, 10) !== message.created_at.slice(0, 10)) && <Text style={[styles.caption, styles.centered, { marginVertical: 14 }]}>{new Date(message.created_at).toLocaleDateString('ko-KR')}</Text>}
          <View nativeID={`conversation-message-${message.id}`} testID={`conversation-message-${message.id}`} tabIndex={-1}
            accessibilityLabel={`${sender?.nickname ?? '참여자 정보 없음'}, ${conversationTime(message.created_at)}${flagged ? ', 감지 신호' : ''}`} style={styles.message}>
            <View style={[styles.avatar, second && styles.accentTag]} aria-hidden accessibilityElementsHidden><Text style={styles.avatarText}>{sender?.nickname.slice(0, 1) ?? '?'}</Text></View>
            <View style={styles.messageBody}><View style={styles.row}><Text style={styles.caseTitle}>{sender?.nickname ?? '참여자 정보 없음'}</Text><Text style={styles.caption}>{conversationTime(message.created_at)}</Text></View>
              {!!message.reply_to_id && <Text style={styles.caption}>답장 대상 · {message.reply_to_id}</Text>}
              <View style={[styles.bubble, second && styles.bubbleSecond, flagged && styles.flaggedBubble, focusId === message.id && styles.focusedBubble]}>
                <Text selectable style={styles.messageText}>{message.body}</Text>
                {(message.kind === 'image' || paths.length > 0) && (paths.length ? paths : [null]).map((path, position) => <View key={path ?? 'missing'} style={styles.attachment}>
                  {path && imageUrls[path] && !failedImages[path] ? <Image source={{ uri: imageUrls[path] }} style={styles.image} contentFit="contain" accessibilityLabel={`대화에 첨부한 원본 사진 ${position + 1}/${paths.length}`}
                    onError={() => setFailedImages((current) => ({ ...current, [path]: true }))} /> : <Text style={styles.caption}>사진을 표시할 수 없어요.</Text>}
                  <Text selectable style={styles.caption}>사진 {position + 1} · {path ?? '원본 경로 없음'}</Text>
                </View>)}
                {message.kind === 'location' && <View style={styles.attachment}><Text style={styles.body}>공유한 위치</Text>
                  <Text selectable style={styles.caption}>{message.latitude != null && message.longitude != null ? `위도 ${message.latitude} · 경도 ${message.longitude}` : '좌표 정보 없음'}</Text></View>}
              </View>
              {flagged && <Text style={[styles.caption, styles.warningText]}>감지 신호 · 맥락 확인 필요</Text>}
            </View>
          </View>
        </View>;
      }} />
    {detail.hasNewer && <View style={styles.threadBottom}><ConversationButton testID="conversation-latest" label="최신 대화 보기" disabled={loadingMessages} onPress={() => { scrollEnd.current = true; onLatest(); }} /></View>}
    <View style={styles.threadBottom}><Text style={styles.caption}>읽기 전용 · 운영자는 이 대화에 참여하지 않아요.</Text></View>
  </View>;
}

export type ConversationDraft = { status: ConversationReviewStatus; note: string };
export function ConversationReviewPanel({ detail, draft, saving, saveError, notice, inModal, onDraft, onSave, onReload, onSignal, onUser, loadingMessages }: {
  detail: ConversationDetail; draft: ConversationDraft; saving: boolean; saveError: string; notice: string;
  inModal?: boolean; onDraft: (draft: ConversationDraft) => void; onSave: () => void; onReload: () => void;
  onSignal: (id: string) => void; onUser: (id: string) => void; loadingMessages: boolean;
}) {
  const { play } = useInteractionFeedback();
  const noteInput = useRef<TextInput>(null);
  const [validation, setValidation] = useState(false);
  const room = detail.conversation;
  return <View testID="conversation-inspector" accessibilityLabel="대화 조사 기록" style={[styles.review, inModal && styles.reviewInModal]}>
    {!inModal && <View style={styles.reviewHeader}><Text accessibilityRole="header" style={styles.sectionTitle}>조사 기록</Text><RiskTag room={room} /></View>}
    <ScrollView style={styles.scroll} contentContainerStyle={styles.reviewContent} keyboardShouldPersistTaps="handled">
      <View style={styles.reviewSection}>
        <Text style={styles.sectionLabel}>감지 신호 · 표시 {detail.signals.length} / 전체 {room.signal_count}건</Text>
        <Text style={styles.caption}>감지 신호만으로 위반을 확정하지 않아요. 원문과 맥락을 함께 확인하세요.</Text>
        {room.reopened && <Text style={[styles.body, styles.warningText]}>새 신호가 생겨 재검토가 필요해요.</Text>}
        {room.pending_analysis > 0 && <Text style={[styles.body, styles.warningText]}>AI 분석 대기 {room.pending_analysis}건 · 결과가 아직 없어요.</Text>}
        {!detail.signals.length && <Text style={styles.caption}>현재 표시할 감지 신호가 없어요.</Text>}
        {detail.signals.map((signal) => <Pressable key={signal.id} testID={`conversation-signal-${signal.id}`} accessibilityRole="button"
          accessibilityLabel={`${signal.source === 'ai' ? 'AI 분석' : '감시어'} 신호 ${signal.category}, ${CONVERSATION_RISK_LABEL[signal.severity]}, 앞뒤 대화 보기`}
          disabled={loadingMessages} accessibilityState={{ disabled: loadingMessages }}
          onPress={() => { play('selection'); onSignal(signal.message_id); }} style={({ pressed }) => [styles.signal, pressed && styles.pressed, loadingMessages && styles.disabled]}>
          <View style={[styles.row, styles.between]}><Text style={[styles.body, styles.grow]}>{signal.category}</Text><Text style={[styles.caption, styles.warningText]}>{CONVERSATION_RISK_LABEL[signal.severity]}</Text></View>
          <Text style={styles.caption}>{signal.source === 'ai' ? 'AI 분석' : '감시어'} · {conversationTime(signal.message_at ?? signal.created_at)}</Text>
          <Text style={styles.body}>{signal.excerpt}</Text>
          {signal.reasons.map((reason, index) => <Text key={`${signal.id}:${index}`} style={styles.caption}>{reason}</Text>)}
          <Text style={[styles.caption, styles.accentText]}>앞뒤 대화 보기 →</Text>
        </Pressable>)}
      </View>
      <View style={styles.reviewSection}><Text style={styles.sectionLabel}>참여자 {room.participants.length}명</Text>
        {room.participants.map((person) => <Pressable key={person.id} testID={`conversation-participant-${person.id}`} accessibilityRole="button" accessibilityLabel={`${person.nickname}, ${cityName(person.city_id)}, 회원 정보 보기`}
          onPress={() => { play('selection'); onUser(person.id); }} style={({ pressed }) => [styles.person, pressed && styles.pressed]}>
          <View style={styles.avatar} aria-hidden accessibilityElementsHidden><Text style={styles.avatarText}>{person.nickname.slice(0, 1)}</Text></View>
          <View style={styles.grow}><Text style={styles.body}>{person.nickname}</Text><Text style={styles.caption}>{cityName(person.city_id)} · 회원 정보 보기</Text></View>
          <SymbolView name={{ ios: 'chevron.right', web: 'chevron_right' }} size={16} tintColor={Colors.admin.textSecondary} />
        </Pressable>)}
      </View>
      <View style={styles.reviewSection}>
        <Text style={styles.sectionLabel}>검토 상태</Text>
        <ConversationPicker testID="conversation-review-status" label="검토 상태" value={draft.status} disabled={saving}
          options={Object.entries(CONVERSATION_REVIEW_STATUS).map(([value, label]) => ({ value, label }))}
          onChange={(status) => onDraft({ ...draft, status: status as ConversationReviewStatus })} />
        <Text style={styles.sectionLabel}>판단 근거·검토 메모 · 필수</Text>
        <TextInput ref={noteInput} testID="conversation-review-note" accessibilityLabel="판단 근거와 검토 메모, 필수, 1,000자 이내" aria-invalid={validation}
          value={draft.note} onFocus={() => play('selection')} onChangeText={(note) => { setValidation(false); onDraft({ ...draft, note }); }} editable={!saving} multiline maxLength={1000}
          placeholder="확인한 맥락과 필요한 후속 조치를 적어 주세요." placeholderTextColor={Colors.admin.textSecondary} style={[styles.note, validation && styles.noteError]} />
        <Text style={styles.caption}>{draft.note.length.toLocaleString()} / 1,000자</Text>
        {validation && <Text accessibilityRole="alert" style={styles.error}>판단 근거나 검토 메모를 남겨 주세요.</Text>}
        {!!saveError && <View accessibilityRole="alert" style={{ gap: 8 }}><Text style={styles.error}>{saveError}</Text><ConversationButton testID="conversation-review-reload" label="최신 기록 불러오기" onPress={onReload} disabled={saving} /></View>}
      </View>
      <View style={styles.reviewSection}><Text style={styles.sectionLabel}>저장된 검토 이력 · {detail.review_history.length}건</Text>
        {!detail.review_history.length && <Text style={styles.caption}>아직 저장된 검토 기록이 없어요.</Text>}
        {detail.review_history.map((review) => <View key={review.id} testID={`conversation-review-history-${review.id}`} style={styles.history}>
          <Text style={styles.body}>{CONVERSATION_REVIEW_STATUS[review.status]}</Text>
          <Text style={styles.caption}>{conversationTime(review.created_at)} · {review.actor_name ?? '운영자'}</Text>
          <Text selectable style={styles.body}>{review.note}</Text>
        </View>)}
      </View>
      <Text selectable style={styles.caption}>대화 ID · {room.id}</Text>
    </ScrollView>
    <View style={styles.reviewFooter}>
      <ConversationButton testID="conversation-save" primary label={saving ? '저장 중…' : '검토 기록 저장'} disabled={saving || !!saveError || loadingMessages} busy={saving} onPress={() => {
        if (!draft.note.trim()) { play('warning'); setValidation(true); noteInput.current?.focus(); return; }
        setValidation(false); onSave();
      }} />
      {!!notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}
      <Text style={styles.caption}>이 저장은 경고 전송이나 계정 제한을 실행하지 않아요.</Text>
    </View>
  </View>;
}
