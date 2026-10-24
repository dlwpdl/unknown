import { t as sourceCopy } from '@/i18n/ko';
import { useLanguage } from '@/hooks/use-language';
import { GlingLoader } from '@/components/gling-loader';
import { Pressable, FlatList } from '@/components/analytics-controls';
import { Image, type ImageSource } from 'expo-image';
import { useRouter } from 'expo-router';
import { chatBusinessIdentity } from '@/lib/chat-identity';
import { useChatIdentity } from '@/hooks/use-chat-identity';
import { loadBusinessChatMessages, sendBusinessChatMessage, editBusinessChatMessage, deleteBusinessChatMessage, markBusinessChatRead, setBusinessChatReaction, endBusinessConversation, blockBusinessConversation, subscribeBusinessChat } from '@/lib/business-chat';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { AppState, Keyboard, KeyboardAvoidingView, LayoutAnimation, Linking, Modal, Platform, ScrollView, StyleSheet, TextInput, UIManager, View, type FlatList as NativeFlatList, type NativeScrollEvent, type NativeSyntheticEvent, type ViewToken, useWindowDimensions } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReportSheet } from '@/components/report-sheet';
import MapScreen from '@/app/map';
import { SharedLinkCard } from '@/components/shared-link-card';
import { sharedLinkInMessage } from '@/lib/sharing';
import { ChatMembers } from '@/components/chat-members';
import { MeetupManageSheet } from '@/components/meetup-manage-sheet';
import { MeetupRoomSummary } from '@/components/meetup-room-summary';
import { MeetupChatOverview } from '@/components/meetup-chat-overview';
import { PostPinMap } from '@/components/post-pin-map';
import { PostShareSheet } from '@/components/post-share-sheet';
import { ChatLocationPicker } from '@/components/chat-location-picker';
import type { ChatLocation } from '@/lib/chat-location';
import { MeetupPolicyNotice } from '@/components/meetup-policy-notice';
import { isSupportedImage, preparePostImage, type PreparedImage } from '@/lib/post-image-picker';
import { MAX_POST_IMAGES } from '@/lib/image-upload';
import { ThemedText } from '@/components/themed-text';
import { MannerReviewButton } from '@/components/manner-review';
import { ThemedView } from '@/components/themed-view';
import { TrustBadge } from '@/components/trust-badge';
import { Depth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { t, tr } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { chatSuggestions, loadChatSuggestionContext, sendSuggestedMessage, type ChatSuggestionContext } from '@/lib/chat-suggestions';
import { merchantEventId } from '@/lib/merchant-source';
import { chatDateLabel, chatImagePaths, chatMessageTime, firstUnreadMessageIndex, messageMenuPosition, showChatMessageTime, type ChatRect, type ChatMember } from '@/lib/chat-details';
import { loadPublicPost } from '@/lib/feed-data';
import type { Post } from '@/lib/types';
import { blockUser, endConversation, editChatMessage, deleteChatMessage, loadListingReviewState, writeListingReview, type ListingReviewState, isContentRejected, loadChatReadPosition, loadConversationMessages, loadConversationMessagesByIds, loadMessageReactions, markChatRead, mergeChatMessages, sendChatAttachment, sendDirectMessage, setMessageReaction, uploadChatImage, type ChatMessageRecord, type ConversationPreview, type MessageReaction, type ReportTarget } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';
import { recordProductEvent } from '@/lib/product-analytics';
import { googlePinUrl } from '@/lib/post-maps';

export function conversationCapabilities(status: ConversationPreview['status']) {
  return { read: status === 'active' || status === 'ended', write: status === 'active' };
}

export function conversationExitNotice(conversation: Pick<ConversationPreview, 'kind' | 'isGroupHost' | 'requesterId'>, currentUserId: string, copy = t) {
  if (conversation.kind === 'group') return conversation.isGroupHost ? copy.meetup.endBody : copy.meetup.leaveBody;
  if (conversation.requesterId === null) return copy.chat.endLegacy;
  return conversation.requesterId === currentUserId ? copy.chat.endRequester : copy.chat.endRecipient;
}

export function conversationSender(message: Pick<ChatMessageRecord, 'sender_id' | 'sender_nickname'>, conversation: Pick<ConversationPreview, 'kind' | 'otherUser'>, copy = t, members: Pick<ChatMember, 'id' | 'nickname'>[] | null = null) {
  if (conversation.kind === 'group') return { id: message.sender_id, nickname: members?.find(member => member.id === message.sender_id)?.nickname || copy.chat.member };
  return { id: message.sender_id, nickname: message.sender_nickname ?? (conversation.kind === 'direct' && message.sender_id === conversation.otherUser.id ? conversation.otherUser.nickname : copy.chat.member) };
}

type ReportSelection = { targetType: ReportTarget; targetId: string; reportedUserId?: string; reportedBusinessId?: string; reportedNickname: string };
type ChatPhoto = string | ImageSource | undefined;
const photoSource = (photo: ChatPhoto) => typeof photo === 'string' ? { uri: photo } : photo;
function BubblePressable({ message, onMenu, ...props }: ComponentProps<typeof Pressable> & { message: ChatMessageRecord; onMenu: (message: ChatMessageRecord, bubble: View) => void }) {
  const { tr } = useLanguage();
  const bubble = useRef<View>(null), style = props.style;
  const open = () => {
    if (!props.disabled && bubble.current) onMenu(message, bubble.current);
  };
  return <Pressable {...props} style={typeof style === 'function' ? state => [style(state), message.sender_kind && { minHeight: 44, justifyContent: 'center' }] : [style, message.sender_kind && { minHeight: 44, justifyContent: 'center' }]} ref={bubble} delayLongPress={400} onLongPress={open}
    accessibilityHint={tr("길게 눌러 메시지 메뉴 열기")} accessibilityActions={[{ name: 'longpress', label: tr('메시지 메뉴') }]}
    onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'longpress') open(); }}
    {...(Platform.OS === 'web' ? {
      onContextMenu: (event: { preventDefault: () => void }) => { event.preventDefault(); open(); },
      onKeyDown: (event: { key: string; shiftKey: boolean; preventDefault: () => void }) => { if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); open(); } },
    } : {})} />;
}
function messagePreview(message: Pick<ChatMessageRecord, 'body' | 'kind' | 'deleted_at'>, translate = tr) {
  return message.deleted_at ? translate('삭제된 메시지입니다.') : message.kind === 'image' ? translate('사진') : message.kind === 'location' ? translate('공유한 위치') : message.body;
}
function RoomAction({ label, onPress, disabled = false, primary = false, danger = false }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean; danger?: boolean }) {

  const theme = useTheme();
  const { play } = useInteractionFeedback();
  return <Pressable analyticsId="components_chat-room.pressable.1" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={() => { if (disabled) return; play('selection'); onPress(); }} style={({ pressed }) => [styles.action, danger && styles.dangerAction, primary && !danger && Depth.control, primary && (danger
    ? { backgroundColor: theme.card, borderColor: theme.danger, borderWidth: 1 }
    : { backgroundColor: theme.accent, borderBottomColor: theme.accentDepth, borderBottomWidth: 3 }), { opacity: disabled ? 0.55 : pressed ? 0.82 : 1 }]}>
    {danger && <SymbolView name={{ ios: 'stop.circle', android: 'stop_circle', web: 'stop_circle' }} size={18} tintColor={theme.danger} />}
    <ThemedText type="smallBold" style={{ color: danger ? theme.danger : primary ? theme.accentInk : theme.accent, flexShrink: 1 }}>{label}</ThemedText></Pressable>;
}

export function ChatLocationMessage({ latitude, longitude, label }: { latitude: number; longitude: number; label?: string | null }) {
  const { language } = useLanguage(), auth = useAuth(), { width } = useWindowDimensions();
  const say = (ko: string, en: string) => language === 'en' ? en : ko;
  const pin = useMemo(() => {
    const point = { latitude, longitude };
    try { googlePinUrl(point); return point; } catch { return null; }
  }, [latitude, longitude]);
  const scope = auth.isAuthed ? `${auth.me.id}:${latitude}:${longitude}` : null;
  const liveScope = useRef(scope);
  useLayoutEffect(() => { liveScope.current = scope; return () => { liveScope.current = null; }; }, [scope]);
  const [address, setAddress] = useState<{ scope: string; text: string } | null>(null);
  useEffect(() => {
    if (!pin || !scope || Platform.OS === 'web') return;
    let active = true;
    void (async () => {
      // Android's native geocoder needs existing permission; received pins never request GPS access.
      if (Platform.OS === 'android' && !(await Location.getForegroundPermissionsAsync()).granted) return;
      if (!active || liveScope.current !== scope) return;
      const [place] = await Location.reverseGeocodeAsync(pin);
      const text = [...new Set([place?.street, place?.city, place?.region].filter(Boolean))].join(', ');
      if (active && liveScope.current === scope && text) setAddress({ scope, text });
    })().catch(() => {});
    return () => { active = false; };
  }, [pin, scope]);
  const name = label?.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 240);
  const named = name && !/^(?:현재\s*위치|내\s*위치|선택한 위치|공유한 위치|current location|my location|selected location|shared location)$/i.test(name) ? name : null;
  const approximate = address?.scope === scope ? address.text : null;
  return <View style={[styles.locationCard, { width: Math.min(234, Math.max(140, width - 144)) }]}>
    {pin ? <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.locationMap}>
      <PostPinMap key={`${latitude}:${longitude}`} pin={pin} preview />
    </View> : null}
    <ThemedText type="smallBold">{pin ? named ?? approximate ?? say('공유한 위치', 'Shared location') : say('위치를 확인할 수 없어요', 'Location unavailable')}</ThemedText>
    {named && approximate && <ThemedText type="small" themeColor="textSecondary">{approximate}</ThemedText>}
    {pin && <ThemedText type="small" themeColor="textSecondary">{approximate ? say('대략적인 주소', 'Approximate address') : `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`}</ThemedText>}
  </View>;
}

export function ChatRoom({ conversation, currentUserId, onClose, onChanged }: { conversation: ConversationPreview; currentUserId: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const { tr, t, language, locale: appLocale } = useLanguage();
  const theme = useTheme();
  const hidden = useContentVisibility();
  const auth = useAuth(), selectedBusiness = useChatIdentity(), router = useRouter();
  const business = conversation.kind === 'business';
  const publicSelfId = conversation.selfIdentity?.id ?? currentUserId;
  const publicSelfName = conversation.selfIdentity?.name ?? auth.me.nickname;
  const asBusinessId = conversation.selfIdentity?.kind === 'business' ? conversation.selfIdentity.id : null;
  const scopeMatches = (selectedBusiness?.id ?? null) === asBusinessId;
  const scopeKey = `${currentUserId}:${asBusinessId ?? 'personal'}`;
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const identity = useRef(auth.isAuthed && scopeMatches ? scopeKey : null);
  const mounted = useRef(true);
  const processing = useRef(false);
  const loadingRequest = useRef(0);
  const snapshot = useRef<Promise<void> | null>(null);
  const olderRequest = useRef(false);
  const blockedUsers = useRef(new Set<string>());
  useLayoutEffect(() => { identity.current = auth.isAuthed && auth.me.id === currentUserId && scopeMatches ? scopeKey : null; }, [auth.isAuthed, auth.me.id, currentUserId, scopeMatches, scopeKey]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const valid = useCallback(() => mounted.current && identity.current === scopeKey && (chatBusinessIdentity(currentUserId)?.id ?? null) === asBusinessId, [scopeKey, currentUserId, asBusinessId]);
  const [resolvedStatus, setResolvedStatus] = useState<ConversationPreview['status'] | null>(null);
  const status = conversation.status === 'ended' ? 'ended' : resolvedStatus ?? conversation.status;
  const [businessReady, setBusinessReady] = useState(!business);
  const capabilities = conversationCapabilities(status);
  const access = { read: capabilities.read, write: capabilities.write && (!business || businessReady) };
  const [allMessages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [groupMembers, setGroupMembers] = useState<ChatMember[] | null>(null);
  const [joinResult, setJoinNotices] = useState<{ conversationId: string; members: ChatMember[] } | null>(null);
  const joinNotices = joinResult?.conversationId === conversation.id ? joinResult.members : [];
  const [searchOpen, setSearchOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSession, setSettingsSession] = useState(0);
  const settingsSequence = useRef(0), settingsActive = useRef(0);
  const reportAfterSettings = useRef<{ session: number; target: ReportSelection } | null>(null);
  const settingsTitle = language === 'en' ? 'Room settings' : '대화 설정';
  const closeSettingsLabel = language === 'en' ? 'Close room settings' : '대화 설정 닫기';
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [sharePost, setSharePost] = useState<Post | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const knownMembers = useRef<Set<string> | null>(null);
  const latestMessages = useRef(allMessages);
  useLayoutEffect(() => { latestMessages.current = allMessages; }, [allMessages]);
  const messages = useMemo(() => allMessages.filter((message) => !hidden('message', message.id, message.sender_id)), [allMessages, hidden]);
  const [draft, setDraft] = useState('');
  const [suggestionContext, setSuggestionContext] = useState<ChatSuggestionContext | null>(null);
  const [contextLoaded, setContextLoaded] = useState(false);
  const [uncertainSuggestion, setUncertainSuggestion] = useState<string | null>(null);
  const businessSends = useRef(new Map<string, string>());
  const suggestedSend = useRef<{ body: string; id: string } | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessageRecord | null>(null);
  const [messageMenu, setMessageMenu] = useState<ChatMessageRecord | null>(null);
  const [menuFrame, setMenuFrame] = useState<{ anchor: ChatRect; bounds: ChatRect } | null>(null);
  const [menuSize, setMenuSize] = useState({ width: 0, height: 0 });
  const menuRequest = useRef(0), listRegion = useRef<View>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [editingMessage, setEditingMessage] = useState<ChatMessageRecord | null>(null);
  const [messageEditDraft, setMessageEditDraft] = useState('');
  const replyTarget = replyTo && !replyTo.deleted_at && !hidden('message', replyTo.id, replyTo.sender_id) ? replyTo : null;
  const [selectedPhotos, setSelectedPhotos] = useState<PreparedImage[]>([]);
  const [photoProgress, setPhotoProgress] = useState<{ stage: 'select' | 'prepare' | 'upload' | 'send'; completed: number; total: number } | null>(null);
  const photoProgressLabel = photoProgress?.stage === 'select' ? tr('사진 불러오는 중') : photoProgress?.stage === 'send' ? tr('전송 확인 중') : photoProgress
    ? tr(photoProgress.stage === 'prepare' ? '사진 준비 중 {0}/{1}' : '사진 올리는 중 {0}/{1}', photoProgress.completed, photoProgress.total) : '';
  const photoSend = useRef<{ id: string; photos: PreparedImage[]; paths: string[]; parent: ChatMessageRecord | null; submitted: boolean } | null>(null);
  const [replyLocked, setReplyLocked] = useState(false);
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const discoveryVisible = useRef(false);
  const discoveryLastMessage = useRef<string | undefined>(undefined);
  const [photoViewer, setPhotoOpen] = useState<{ photos: ChatPhoto[]; index: number; initialIndex: number; messageId?: string } | null>(null);
  const photoOpen = photoViewer && (!photoViewer.messageId || messages.some(message => message.id === photoViewer.messageId && !message.deleted_at)) ? photoViewer : null;
  const photoPages = useRef<ScrollView>(null);
  const openPhotos = (photos: ChatPhoto[], index: number, messageId?: string) => { play('selection'); setPhotoOpen({ photos, index, initialIndex: index, messageId }); };
  const changePhoto = (index: number) => {
    if (!photoOpen || index < 0 || index >= photoOpen.photos.length) return;
    play('selection'); setPhotoOpen({ ...photoOpen, index }); photoPages.current?.scrollTo({ x: index * screen.width, animated: !reducedMotion });
  };
  const discardPhotoSend = () => {
    const pending = photoSend.current; photoSend.current = null; setReplyLocked(false);
    if (pending?.paths.length) void supabase.storage.from('chat-images').remove(pending.paths).catch(() => {});
  };
  const messageList = useRef<NativeFlatList<ChatMessageRecord> | null>(null);
  const initialScroll = useRef(false);
  const scrollRetries = useRef(0);
  const followingLatest = useRef(false);
  const lastReadAt = useRef(0);
  const readReady = useRef(false);
  const [viewability] = useState(() => ({ itemVisiblePercentThreshold: 55 }));
  const [readAt, setReadAt] = useState<string | null | undefined>(undefined);
  const [unreadStart, setUnreadStart] = useState<string | null>(null);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const openDiscovery = () => { discoveryVisible.current = true; discoveryLastMessage.current = latestMessages.current.at(-1)?.id; Keyboard.dismiss(); setDiscoveryOpen(true); };
  const closeDiscovery = () => {
    if (discoveryLastMessage.current !== latestMessages.current.at(-1)?.id) { followingLatest.current = false; setAwayFromLatest(true); }
    discoveryVisible.current = false; setDiscoveryOpen(false);
  };

  const [loading, setLoading] = useState(access.read);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState<ReportSelection | null>(null);
  const closeSettings = () => {
    if (!valid() || !settingsActive.current || settingsActive.current !== settingsSession) return;
    settingsActive.current = 0; reportAfterSettings.current = null; play('selection'); setSettingsOpen(false);
  };
  const selectRoomSetting = (action: () => void) => {
    if (!valid() || !settingsActive.current || settingsActive.current !== settingsSession) return;
    settingsActive.current = 0; setSettingsOpen(false); action();
  };
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [review, setReview] = useState<ListingReviewState | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewBody, setReviewBody] = useState('');
  const [reviewPick, setReviewPick] = useState<boolean | null>(null);
  const [reactionChanges, setReactions] = useState<Map<string, MessageReaction>>(new Map());
  const reactions = useMemo(() => business
    ? new Map(messages.map(message => [message.id, reactionChanges.get(message.id) ?? { message_id: message.id, hearts: message.hearts ?? 0, mine: message.mine_reacted === true }]))
    : reactionChanges, [business, messages, reactionChanges]);
  // 참여 승인은 시스템 메시지로 남지 않으므로 멤버 목록의 변화를 채팅창에 알린다.
  useEffect(() => { knownMembers.current = null; }, [conversation.id]);
  useEffect(() => {
    if (!groupMembers) return;
    if (!knownMembers.current) { knownMembers.current = new Set(groupMembers.map(member => member.id)); return; }
    const known = knownMembers.current;
    const added = groupMembers.filter(member => !known.has(member.id) && member.id !== currentUserId);
    if (!added.length) return;
    for (const member of added) known.add(member.id);
    setJoinNotices(current => ({ conversationId: conversation.id, members: [...(current?.conversationId === conversation.id ? current.members : []), ...added].slice(-3) }));
  }, [groupMembers, currentUserId, conversation.id]);
  useEffect(() => {
    if (business) return;
    let active = true;
    void (async () => {
      try {
        const context = await loadChatSuggestionContext(supabase, conversation.id);
        if (active && valid()) setSuggestionContext(context);
      } catch { if (active && valid()) setSuggestionContext(null); }
      finally { if (active && valid()) setContextLoaded(true); }
    })();
    return () => { active = false; };
  }, [business, conversation.id, valid]);
  const lastTap = useRef<{ id: string; at: number } | null>(null);
  useEffect(() => {
    if (business) return;
    let active = true;
    void loadChatReadPosition(supabase, conversation.id).then((position) => {
      if (!active || !valid()) return;
      lastReadAt.current = position ? Date.parse(position) : 0;
      readReady.current = true;
      setReadAt(position);
    }).catch(() => { if (active && valid()) { readReady.current = true; setReadAt(null); setError("안 읽은 메시지 위치를 확인하지 못했어요."); } });
    return () => { active = false; };
  }, [business, conversation.id, valid]);

  useEffect(() => {
    if (discoveryOpen || overviewOpen || loading || readAt === undefined || initialScroll.current) return;
    let positioned = false;
    initialScroll.current = true;
    const index = firstUnreadMessageIndex(messages, readAt, publicSelfId);
    setUnreadStart(index < 0 ? null : messages[index].id);
    followingLatest.current = index < 0;
    setAwayFromLatest(index >= 0 && index < messages.length - 1);
    const timer = setTimeout(() => {
      if (discoveryVisible.current) { initialScroll.current = false; return; }
      positioned = true;
      if (index > 0) messageList.current?.scrollToIndex({ index, viewPosition: 0.12, animated: false });
      else if (index < 0) messageList.current?.scrollToEnd({ animated: false });
    }, 50);
    return () => { clearTimeout(timer); if (!positioned) initialScroll.current = false; };
  }, [messages, publicSelfId, loading, readAt, discoveryOpen, overviewOpen]);

  const trackVisibleMessages = useCallback(({ viewableItems }: { viewableItems: ViewToken<ChatMessageRecord>[] }) => {
    if (discoveryVisible.current || !readReady.current || !valid()) return;
    const newest = viewableItems.map(({ item }) => item).filter((item): item is ChatMessageRecord => !!item)
      .reduce<ChatMessageRecord | null>((latest, item) => !latest || Date.parse(item.created_at) > Date.parse(latest.created_at) ? item : latest, null);
    if (!newest || Date.parse(newest.created_at) <= lastReadAt.current) return;
    lastReadAt.current = Date.parse(newest.created_at);
    void (business ? markBusinessChatRead(supabase, conversation, newest.id) : markChatRead(supabase, conversation.id, newest.id)).catch(() => {});
  }, [business, conversation, valid]);
  const onMessageScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (discoveryVisible.current) return;
    closeMessageMenu();
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const nearLatest = contentSize.height - layoutMeasurement.height - contentOffset.y < 88;
    followingLatest.current = nearLatest;
    setAwayFromLatest(!nearLatest);
  };
  const scrollToLatest = (animated = false) => {
    if (discoveryVisible.current) return;
    followingLatest.current = true;
    setAwayFromLatest(false);
    requestAnimationFrame(() => requestAnimationFrame(() => { if (!discoveryVisible.current) messageList.current?.scrollToEnd({ animated }); }));
  };
  const animateNewMessage = useCallback(() => {
    if (reducedMotion || Platform.OS === 'web' || !initialScroll.current) return;
    if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);
    LayoutAnimation.configureNext({ duration: 220,
      create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity },
      update: { type: LayoutAnimation.Types.easeOut },
    });
  }, [reducedMotion]);
  const setAttachmentMenu = (open: boolean) => {
    if (open === attachmentsOpen) return;
    if (!reducedMotion && Platform.OS !== 'web') {
      if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);
      LayoutAnimation.configureNext({ duration: 220,
        create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity },
        update: { type: LayoutAnimation.Types.easeOut },
        delete: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity },
      });
    }
    setAttachmentsOpen(open);
  };
  useEffect(() => {
    if (business) return;
    let active = true;
    void loadMessageReactions(supabase, messages.map((message) => message.id))
      .then((next) => { if (active) setReactions(next); })
      .catch(() => {});
    return () => { active = false; };
  }, [messages, business]);

  const toggleHeart = async (messageId: string) => {
    if (!valid() || !access.write) return;
    const current = reactions.get(messageId);
    const next = !current?.mine;
    play('reaction');
    setReactions((previous: Map<string, MessageReaction>) => new Map(previous).set(messageId, {
      message_id: messageId, hearts: Math.max(0, (current?.hearts ?? 0) + (next ? 1 : -1)), mine: next,
    }));
    try {
      const saved = business ? await setBusinessChatReaction(supabase, conversation, messageId, next) : null;
      const hearts = saved?.hearts ?? await setMessageReaction(supabase, messageId, next);
      if (!valid()) return;
      setReactions((previous: Map<string, MessageReaction>) => new Map(previous).set(messageId, { message_id: messageId, hearts, mine: saved?.mine ?? next }));
    } catch {
      setReactions((previous: Map<string, MessageReaction>) => new Map(previous).set(messageId, current ?? { message_id: messageId, hearts: 0, mine: false }));
    }
  };
  // 서로 메시지에 하트를 눌러 주는 기능이라 더블탭으로 토글한다 (320ms).
  // 렌더 중 Date.now() 를 부르지 않도록 터치 이벤트의 타임스탬프를 쓴다.
  const handleBubbleTap = (messageId: string, at: number) => {
    const previous = lastTap.current;
    lastTap.current = { id: messageId, at };
    if (previous && previous.id === messageId && at - previous.at < 320) { lastTap.current = null; void toggleHeart(messageId); }
  };
  const closeMessageMenu = useCallback(() => { menuRequest.current += 1; setMessageMenu(null); setMenuFrame(null); }, []);
  const openMessageMenu = (message: ChatMessageRecord, bubble: View) => {
    if (!access.write || sending || !valid() || message.deleted_at) return;
    const request = ++menuRequest.current;
    lastTap.current = null; play('selection');
    bubble.measureInWindow((x, y, width, height) => {
      if (!valid() || request !== menuRequest.current || width <= 0 || height <= 0) return;
      const anchor = { x, y, width, height };
      listRegion.current?.measureInWindow((x, y, width, height) => {
        if (!valid() || request !== menuRequest.current || hidden('message', message.id, message.sender_id) || width < 44 || height < 44) return;
        setMenuFrame({ anchor, bounds: { x, y, width, height } }); setMenuSize({ width: 0, height: 0 });
        setDeleteConfirm(false); setMessageMenu(message);
      });
    });
  };
  const changeMessage = async (message: ChatMessageRecord, remove: boolean) => {
    if (processing.current || !access.write || !valid()) return;
    processing.current = true; setSending(true); setError(null);
    try {
      const saved = business
        ? remove ? await deleteBusinessChatMessage(supabase, conversation, message.id, message.edited_at ?? null) : await editBusinessChatMessage(supabase, conversation, message.id, messageEditDraft, message.edited_at ?? null)
        : remove ? await deleteChatMessage(supabase, message.id, message.edited_at ?? null) : await editChatMessage(supabase, message.id, messageEditDraft, message.edited_at ?? null);
      if (!valid()) return;
      setMessages(previous => mergeChatMessages(previous, [{ ...message, ...saved }], blockedUsers.current));
      if (remove) setReplyTo(current => current?.id === message.id ? null : current);
      setMessageMenu(null); setEditingMessage(null); play(remove ? 'warning' : 'success');
    } catch {
      if (valid()) { play('warning'); setError("메시지를 변경하지 못했어요. 다른 기기에서 변경됐을 수 있으니 원문을 다시 확인해 주세요."); }
    } finally { processing.current = false; if (valid()) setSending(false); }
  };
  const group = conversation.kind === 'group';
  const title = group ? conversation.title : conversation.otherUser.nickname;
  const verificationNotice = !group && !business && ![2, 3].includes(conversation.otherUser.verificationLevel)
    ? <View accessible style={[styles.safetyNotice, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold">{t.chat.unverifiedNotice}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{t.chat.unverifiedSafety}</ThemedText>
    </View> : null;

  const readMessagesByIds = useCallback(async (ids: string[]) => business
    ? (await loadBusinessChatMessages(supabase, conversation, { messageIds: ids })).messages
    : loadConversationMessagesByIds(supabase, conversation.id, ids), [business, conversation]);

  const refreshMessages = useCallback(() => {
    if (!access.read || !valid()) return;
    if (snapshot.current) return snapshot.current;
    const request = ++loadingRequest.current;
    setLoading(true);
    const promise = (async () => {
      try {
        const page = business ? await loadBusinessChatMessages(supabase, conversation) : null;
        const rows = page?.messages ?? await loadConversationMessages(supabase, conversation.id);
        if (!valid() || loadingRequest.current !== request) return;
        // Reconnect starts a contiguous window and revalidates message visibility through RLS.
        setMessages(rows.filter((message) => !blockedUsers.current.has(message.sender_id)));
        setHasOlder(page ? !!page.cursor : rows.length === 50);
        if (page) {
          setResolvedStatus(page.conversation.status); setBusinessReady(true);
          lastReadAt.current = page.readAt ? Date.parse(page.readAt) : 0; readReady.current = true; setReadAt(page.readAt);
        }
      } catch { if (valid() && loadingRequest.current === request) {
        if (business) { setBusinessReady(false); setMessages([]); setPhotoOpen(null); readReady.current = false; }
        setError(sourceCopy.chat.loadMessagesError);
      } }
      finally { if (loadingRequest.current === request) { snapshot.current = null; if (valid()) setLoading(false); } }
    })();
    snapshot.current = promise;
    return promise;
  }, [access.read, business, conversation, valid, setError, setPhotoOpen]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let flushing = false;
    const pending = new Set<string>();
    const flush = async () => {
      timer = undefined;
      if (!active || !valid() || flushing || !pending.size) return;
      const ids = [...pending].slice(0, 50);
      ids.forEach((id) => pending.delete(id));
      flushing = true;
      try {
        await snapshot.current;
        if (!active || !valid()) return;
        const request = loadingRequest.current;
        const rows = await readMessagesByIds(ids);
        if (active && valid()) {
          if (request === loadingRequest.current) {
            const returned = new Set(rows.map(row => row.id));
            const removed = new Set(ids.filter(id => !returned.has(id)));
            if (rows.some(row => !latestMessages.current.some(previous => previous.id === row.id))) animateNewMessage();
            setMessages(previous => mergeChatMessages(previous.filter(row => !removed.has(row.id)).map(row =>
              row.reply_to_id && removed.has(row.reply_to_id) ? { ...row, reply: null } : row), rows, blockedUsers.current));
            setReplyTo(parent => {
              if (!parent || removed.has(parent.id)) return null;
              const updated = rows.find(row => row.id === parent.id);
              return updated?.deleted_at ? null : updated ?? parent;
            });
          }
          else ids.forEach((id) => pending.add(id));
        }
      } catch {
        if (active && valid()) { setError(sourceCopy.chat.loadMessagesError); void refreshMessages(); }
      } finally {
        flushing = false;
        if (active && pending.size && !timer) timer = setTimeout(() => void flush(), 80);
      }
    };
    void Promise.resolve().then(refreshMessages);
    const stopBusiness = business ? subscribeBusinessChat(supabase, currentUserId, event => {
      if (!active || !valid() || event.conversationId !== conversation.id || (event.businessId ?? null) !== asBusinessId) return;
      if (!event.messageId) { void refreshMessages(); void onChanged(); return; }
      pending.add(event.messageId); if (!timer && !flushing) timer = setTimeout(() => void flush(), 80);
    }) : null;
    const channel = business ? null : supabase.channel(`room:${currentUserId}:${conversation.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `id=eq.${conversation.id}` }, ({ new: value }) => {
        if (!valid()) return;
        const next = value.status as ConversationPreview['status'];
        if (['pending', 'active', 'ended', 'rejected', 'cancelled'].includes(next)) setResolvedStatus(next);
        void onChanged();
      });
    if (access.read && channel) channel.on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversation.id}` }, ({ new: message, old: previous }) => {
      const id = message && 'id' in message ? message.id : previous && 'id' in previous ? previous.id : null;
      if (!active || typeof id !== 'string') return;
      pending.add(id);
      if (!timer && !flushing) timer = setTimeout(() => void flush(), 80);
    });
    channel?.subscribe();
    const appState = AppState.addEventListener('change', (next) => { if (next === 'active' && valid()) { void refreshMessages(); void onChanged(); } });
    return () => { active = false; clearTimeout(timer); pending.clear(); loadingRequest.current += 1; snapshot.current = null; appState.remove(); stopBusiness?.(); if (channel) void supabase.removeChannel(channel); };
  }, [access.read, animateNewMessage, business, asBusinessId, conversation.id, currentUserId, onChanged, readMessagesByIds, refreshMessages, valid]);

  const end = async () => {
    if (processing.current || !valid()) return;
    processing.current = true; setBusy(true); setError(null);
    try { if (business) await endBusinessConversation(supabase, conversation); else await endConversation(supabase, conversation.id); if (valid()) { play('warning'); setResolvedStatus('ended'); setConfirmEnd(false); await onChanged(); } }
    catch { if (valid()) { play('warning'); setError(sourceCopy.chat.endError); } }
    finally { processing.current = false; if (valid()) setBusy(false); }
  };
  const block = async (blockedUserId: string) => {
    if (!valid() || blockedUserId === currentUserId) return;
    try {
      if (business) await blockBusinessConversation(supabase, conversation); else await blockUser(supabase, currentUserId, blockedUserId);
      if (!valid()) return;
      play('warning');
      if (group) { blockedUsers.current.add(blockedUserId); setMessages((previous) => previous.filter((message) => message.sender_id !== blockedUserId)); }
      else setResolvedStatus(status === 'pending' ? 'cancelled' : 'ended');
      setNotice(sourceCopy.chat.blockDone); await onChanged();
    } catch { if (valid()) { play('warning'); setError(sourceCopy.chat.blockError); } }
  };
  // 후기 자격은 서버가 판단한다. 여기서는 열린 경우에만 버튼을 보여준다.
  const applyReview = useCallback((next: ListingReviewState | null) => {
    setReview(next);
    if (next?.mine) { setReviewBody(next.mine.body ?? ''); setReviewPick(next.mine.wouldDealAgain); }
  }, []);

  const refreshReview = useCallback(async () => {
    if (conversation.kind !== 'direct') return;
    try {
      const next = await loadListingReviewState(supabase, conversation.id);
      if (valid()) applyReview(next);
    } catch { if (valid()) applyReview(null); }
  }, [applyReview, conversation.id, conversation.kind, valid]);

  const submitReview = async (wouldDealAgain: boolean) => {
    if (busy || !valid()) return;
    setBusy(true); setError(null);
    try {
      await writeListingReview(supabase, conversation.id, wouldDealAgain, reviewBody);
      if (!valid()) return;
      play('selection'); setReviewOpen(false);
      await refreshReview();
    } catch {
      if (valid()) { play('warning'); setError("후기를 남기지 못했어요. 잠시 후 다시 시도해 주세요."); }
    } finally { if (valid()) setBusy(false); }
  };

  // 메시지가 오갈 때마다 서버에 자격을 다시 묻는다. 양쪽이 말을 해야 열리기 때문이다.
  useEffect(() => {
    let active = true;
    void (async () => {
      if (conversation.kind !== 'direct') return;
      try {
        const next = await loadListingReviewState(supabase, conversation.id);
        if (active && valid()) applyReview(next);
      } catch { if (active && valid()) applyReview(null); }
    })();
    return () => { active = false; };
  }, [applyReview, conversation.id, conversation.kind, messages.length, valid]);

  const send = async (suggestion?: string) => {
    const body = (suggestion ?? draft).trim();
    if (!body || sending || processing.current || photoSend.current?.submitted || !access.write || !valid()) return;
    if (suggestion && (replyTarget || uncertainSuggestion && uncertainSuggestion !== body)) return;
    setAttachmentMenu(false);
    processing.current = true; setSending(true); setError(null);
    const parent = replyTarget;
    try {
      if (suggestion && !suggestedSend.current) suggestedSend.current = { body, id: merchantEventId() };
      const sendKey = JSON.stringify(['text', body, parent?.id ?? null]);
      if (business && !businessSends.current.has(sendKey)) businessSends.current.set(sendKey, merchantEventId());
      const id = business ? await sendBusinessChatMessage(supabase, conversation, { clientId: businessSends.current.get(sendKey)!, body, replyToId: parent?.id }) : suggestion
        ? await sendSuggestedMessage(supabase, conversation.id, body, suggestedSend.current!.id)
        : await sendDirectMessage(supabase, conversation.id, body, parent?.id);
      await snapshot.current;
      if (!valid()) return;
      businessSends.current.delete(sendKey);
      animateNewMessage();
      setMessages((previous) => previous.some((item) => item.id === id) ? previous : [...previous, { id, conversation_id: conversation.id, sender_id: publicSelfId, sender_nickname: publicSelfName, ...(business ? { sender_kind: conversation.selfIdentity!.kind, is_mine: true, avatarUri: conversation.selfIdentity!.avatarUri } : {}), body, reply_to_id: parent?.id, reply: parent, created_at: new Date().toISOString() }]);
      if (!suggestion) {
        setReplyTo(current => current?.id === parent?.id ? null : current);
        setDraft((current) => current.trim() === body ? '' : current);
      }
      setUncertainSuggestion(null); scrollToLatest(); play('message');
    } catch (failure) { if (valid()) {
      play('warning');
      if (suggestion) setUncertainSuggestion(body);
      if (business) await refreshMessages();
      setError(isContentRejected(failure) ? sourceCopy.safety.contentBlockedBody : suggestion
        ? "전송 결과를 확인하지 못했어요. 같은 문장을 다시 누르면 중복 없이 확인해요." : sourceCopy.chat.sendError);
      await onChanged();
    } }
    finally { processing.current = false; if (valid()) setSending(false); }
  };
  const pickPhoto = async () => {
    if (sending || pickingPhoto || processing.current || !access.write || !valid()) return;
    processing.current = true; setPickingPhoto(true); setError(null); setPhotoProgress({ stage: 'select', completed: 0, total: 0 });
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1,
        allowsMultipleSelection: true, orderedSelection: true, selectionLimit: MAX_POST_IMAGES,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
      if (result.canceled || !valid()) return;
      const prepared: PreparedImage[] = [];
      setPhotoProgress({ stage: 'prepare', completed: 0, total: Math.min(result.assets.length, MAX_POST_IMAGES) });
      for (const asset of result.assets.slice(0, MAX_POST_IMAGES)) {
        if (!valid()) return;
        if (!asset?.uri || !isSupportedImage(asset.mimeType ?? 'image/jpeg')) throw new Error('UNSUPPORTED_IMAGE');
        prepared.push(await preparePostImage(asset));
        if (valid()) setPhotoProgress({ stage: 'prepare', completed: prepared.length, total: Math.min(result.assets.length, MAX_POST_IMAGES) });
      }
      if (valid()) { discardPhotoSend(); setSelectedPhotos(prepared); play('selection'); }
    } catch { if (valid()) { play('warning'); setError("사진을 준비하지 못했어요. JPG, PNG 또는 WebP 사진을 다시 선택해 주세요."); } }
    finally { processing.current = false; if (valid()) { setPickingPhoto(false); setPhotoProgress(null); } }
  };
  const sendPhoto = async () => {
    if (!selectedPhotos.length || sending || processing.current || !access.write || !valid()) return;
    processing.current = true; setSending(true); setError(null);
    const pending = photoSend.current ??= { id: merchantEventId(), photos: selectedPhotos, paths: [], parent: replyTarget, submitted: false };
    if (!pending.submitted) pending.parent = replyTarget;
    try {
      setPhotoProgress({ stage: 'upload', completed: pending.paths.length, total: pending.photos.length });
      for (let i = pending.paths.length; i < pending.photos.length; i++) {
        if (!valid()) return;
        pending.paths.push(await uploadChatImage(supabase, publicSelfId, conversation.id, pending.photos[i].base64).catch(failure => {
          if (valid()) void recordProductEvent(supabase, { kind: 'photo_upload_error', platform: Platform.OS }).catch(() => {});
          throw failure;
        }));
        if (valid()) setPhotoProgress({ stage: 'upload', completed: pending.paths.length, total: pending.photos.length });
      }
      if (!valid()) return;
      setPhotoProgress({ stage: 'send', completed: pending.paths.length, total: pending.photos.length });
      pending.submitted = true;
      setReplyLocked(true);
      const id = business ? await sendBusinessChatMessage(supabase, conversation, { kind: 'image', imagePaths: pending.paths, clientId: pending.id, replyToId: pending.parent?.id })
        : await sendChatAttachment(supabase, conversation.id, { kind: 'image', imagePaths: pending.paths, clientId: pending.id }, pending.parent?.id);
      const rows = await readMessagesByIds([id]).catch(() => []);
      if (!valid()) return;
      animateNewMessage();
      const localUrls = pending.photos.map(photo => photo.uri);
      setMessages(previous => mergeChatMessages(previous, rows.length ? rows.map(row => row.kind === 'image'
        ? { ...row, imageUrl: row.imageUrl ?? localUrls[0], imageUrls: localUrls.map((url, index) => row.imageUrls?.[index] ?? url) } : row)
        : [{ id, conversation_id: conversation.id, sender_id: publicSelfId, sender_nickname: publicSelfName, ...(business ? { sender_kind: conversation.selfIdentity!.kind, is_mine: true, avatarUri: conversation.selfIdentity!.avatarUri } : {}),
          body: `📷 사진 ${pending.photos.length}장`, kind: 'image', image_path: pending.paths[0], image_paths: pending.paths,
          imageUrl: localUrls[0], imageUrls: localUrls, reply_to_id: pending.parent?.id, reply: pending.parent, created_at: new Date().toISOString() }], blockedUsers.current));
      photoSend.current = null; setReplyLocked(false); setSelectedPhotos([]);
      setReplyTo(current => current?.id === pending.parent?.id ? null : current);
      scrollToLatest(); play('message');
    } catch { if (valid()) { if (business) await refreshMessages(); play('warning'); setError("사진 묶음의 전송 결과를 확인하지 못했어요. 다시 누르면 같은 묶음으로 확인해요."); } }
    finally { processing.current = false; if (valid()) { setSending(false); setPhotoProgress(null); } }
  };
  const sendLocation = async (point: ChatLocation) => {
    if (sending || processing.current || photoSend.current?.submitted || !access.write || !valid()) return;
    processing.current = true; setSending(true); setError(null);
    const parent = replyTarget;
    try {
      const { latitude, longitude, label } = point;
      const sendKey = JSON.stringify(['location', latitude, longitude, label, parent?.id ?? null]);
      if (business && !businessSends.current.has(sendKey)) businessSends.current.set(sendKey, merchantEventId());
      const id = business ? await sendBusinessChatMessage(supabase, conversation, { kind: 'location', latitude, longitude, locationLabel: label, clientId: businessSends.current.get(sendKey)!, replyToId: parent?.id })
        : await sendChatAttachment(supabase, conversation.id, { kind: 'location', latitude, longitude, label }, parent?.id);
      const rows = await readMessagesByIds([id]).catch(() => []);
      if (!valid()) return;
      animateNewMessage();
      setMessages((previous) => mergeChatMessages(previous, rows.length ? rows : [{ id, conversation_id: conversation.id,
        sender_id: publicSelfId, sender_nickname: publicSelfName, ...(business ? { sender_kind: conversation.selfIdentity!.kind, is_mine: true, avatarUri: conversation.selfIdentity!.avatarUri } : {}), body: `📍 ${label}`, kind: 'location', latitude, longitude, location_label: label, reply_to_id: parent?.id, reply: parent,
        created_at: new Date().toISOString() }], blockedUsers.current));
      businessSends.current.delete(sendKey);
      scrollToLatest(); play('message');
      setLocationOpen(false); setReplyTo(current => current?.id === parent?.id ? null : current);
    } catch (failure) {
      if (valid()) { if (business) await refreshMessages(); play('warning'); setError("위치를 보내지 못했어요. 선택한 위치를 확인하고 다시 시도해 주세요."); throw failure; }
    } finally { processing.current = false; if (valid()) setSending(false); }
  };
  const openAttachments = () => { play('selection'); setAttachmentMenu(!attachmentsOpen); };
  const loadOlder = async () => {
    if (olderRequest.current || snapshot.current || !hasOlder || !messages[0] || !access.read || !valid()) return;
    const request = loadingRequest.current;
    olderRequest.current = true; setLoadingOlder(true);
    try {
      const before = { createdAt: messages[0].created_at, id: messages[0].id };
      const page = business ? await loadBusinessChatMessages(supabase, conversation, { before }) : null;
      const rows = page?.messages ?? await loadConversationMessages(supabase, conversation.id, before);
      if (!valid() || request !== loadingRequest.current) return;
      setMessages((previous) => mergeChatMessages(previous, rows, blockedUsers.current)); setHasOlder(page ? !!page.cursor : rows.length === 50);
    } catch { if (valid() && request === loadingRequest.current) setError(sourceCopy.chat.loadMessagesError); }
    finally { olderRequest.current = false; if (valid()) setLoadingOlder(false); }
  };

  // 검색은 지금 불러온 메시지 안에서만 찾는다.
  const trimmedSearch = searchQuery.trim().toLocaleLowerCase();
  const searchMatches = searchOpen && trimmedSearch
    ? messages.filter(message => !message.deleted_at && (message.body ?? '').toLocaleLowerCase().includes(trimmedSearch))
    : messages;

  if (!auth.isAuthed || auth.me.id !== currentUserId || !scopeMatches) return null;
  return <ThemedView style={{ flex: 1 }}>
    <View style={[styles.head, { borderBottomColor: theme.line }]}><View style={styles.titleRow}>{conversation.otherIdentity?.kind === 'business' ? <Pressable analyticsId="chat.peer-profile" accessibilityRole="button" accessibilityLabel={tr('{0} 프로필 보기', title)} onPress={() => { play('selection'); if (conversation.otherIdentity?.kind === 'business') { onClose(); router.push({ pathname: '/company/[id]', params: { id: conversation.otherIdentity.id } }); } }} style={{ minHeight: 44, flex: 1, minWidth: 0, overflow: 'hidden', flexDirection: 'row', gap: 8, alignItems: 'center' }}>{conversation.otherIdentity?.avatarUri && <Image source={{ uri: conversation.otherIdentity.avatarUri }} style={{ width: 32, height: 32, borderRadius: 16 }} />}<ThemedText type="smallBold" numberOfLines={2} ellipsizeMode="tail" accessibilityLabel={title} style={styles.title}>{title}</ThemedText></Pressable> : <ThemedText type="smallBold" numberOfLines={2} ellipsizeMode="tail" accessibilityLabel={title} style={styles.title}>{title}</ThemedText>}{!group && !business && <TrustBadge verified={conversation.otherUser.verificationLevel >= 2} trustLevel={conversation.otherUser.verificationLevel === 3 ? 3 : conversation.otherUser.verificationLevel === 2 ? 2 : undefined} />}</View><Pressable analyticsId="chat.settings.open" accessibilityRole="button" accessibilityLabel={settingsTitle} accessibilityState={{ expanded: settingsOpen }} onPress={() => { if (!valid() || settingsActive.current) return; const session = ++settingsSequence.current; settingsActive.current = session; setSettingsSession(session); reportAfterSettings.current = null; play('selection'); Keyboard.dismiss(); setSettingsOpen(true); }} style={({ pressed }) => [styles.iconAction, { opacity: pressed ? 0.82 : 1 }]}><SymbolView name={{ ios: 'gearshape', android: 'settings', web: 'settings' }} size={21} tintColor={theme.textSecondary} /></Pressable><Pressable analyticsId="components_chat-room.pressable.1" accessibilityRole="button" accessibilityLabel={t.detail.close} onPress={() => { if (!valid()) return; play('selection'); onClose(); }} style={({ pressed }) => [styles.iconAction, { opacity: pressed ? 0.82 : 1 }]}><SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={21} tintColor={theme.textSecondary} /></Pressable></View>
    {searchOpen && <View style={[styles.searchBar, { borderBottomColor: theme.line }]}><SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={17} tintColor={theme.textSecondary} /><TextInput autoFocus value={searchQuery} onChangeText={setSearchQuery} placeholder={tr('대화 내용 검색')} placeholderTextColor={theme.textSecondary} accessibilityLabel={tr('대화 내용 검색')} returnKeyType="search" style={[styles.searchInput, { color: theme.text }]} /><ThemedText type="small" themeColor="textSecondary">{trimmedSearch ? tr('{0}개', searchMatches.length) : ''}</ThemedText><Pressable analyticsId="chat.search-close" accessibilityRole="button" accessibilityLabel={tr('검색 닫기')} onPress={() => { play('selection'); setSearchQuery(''); setSearchOpen(false); }} style={styles.iconAction}><SymbolView name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }} size={18} tintColor={theme.textSecondary} /></Pressable></View>}

    <View style={[styles.toolbar, group && styles.groupToolbar]}>{group && access.read && conversation.groupPostId && <ChatMembers key={`${currentUserId}:${conversation.id}`} conversationId={conversation.id} groupPostId={conversation.groupPostId} currentUserId={currentUserId} onMembersChange={setGroupMembers} onOpenProfile={id => { onClose(); router.push({ pathname: '/meetup-profile', params: { postId: conversation.groupPostId!, userId: id } }); }} />}<View style={styles.roomTools}><Pressable analyticsId="chat.open-map" accessibilityRole="button" accessibilityLabel={tr('지도에서 장소 찾기')} onPress={() => { play('selection'); openDiscovery(); }} style={({ pressed }) => [styles.iconAction, { opacity: pressed ? 0.6 : 1 }]}><SymbolView name={{ ios: 'map', android: 'map', web: 'map' }} size={21} tintColor={theme.accent} /></Pressable><Pressable analyticsId="chat.search-toggle" accessibilityRole="button" accessibilityLabel={tr('대화 내용 검색')} accessibilityState={{ expanded: searchOpen }} onPress={() => { play('selection'); setSearchOpen(current => !current); setSearchQuery(''); }} style={({ pressed }) => [styles.iconAction, { opacity: pressed ? 0.6 : 1 }]}><SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={21} tintColor={searchOpen ? theme.accent : theme.textSecondary} /></Pressable></View></View>
    {!group && !business && <View style={styles.toolbar}><MannerReviewButton subjectId={conversation.otherUser.id} nickname={conversation.otherUser.nickname} context={{ conversationId: conversation.id }} /></View>}
    {review?.canWrite && <View style={styles.toolbar}>
      <RoomAction label={tr(review.mine ? tr("거래 후기 고치기") : tr("{0}님 거래 후기 남기기", (review.subjectNickname ?? '')))}
        onPress={() => setReviewOpen((current) => !current)} disabled={busy} />
      {review.mine && <ThemedText type="small" themeColor="textSecondary">
        {tr(review.mine.wouldDealAgain ? tr("다시 거래하겠다고 남겼어요") : tr("다시 거래하지 않겠다고 남겼어요"))}
      </ThemedText>}
    </View>}
    {review?.canWrite && reviewOpen && <View style={[styles.confirmation, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold">{tr("거래는 어떠셨어요?")}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        {review.postTitle}{" " + tr("· 거래한 사람만 남길 수 있어요")}</ThemedText>
      <View style={styles.reviewPick}>
        {([[true, tr("다시 거래할래요")], [false, tr("아쉬웠어요")]] as [boolean, string][]).map(([value, label]) => {
          const on = reviewPick === value;
          return (
            <Pressable analyticsId="components_chat-room.pressable.2" key={label} onPress={() => { play('selection'); setReviewPick(value); }} accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: busy }} disabled={busy}
              style={({ pressed }) => [styles.reviewOption, Depth.control,
                { borderColor: on ? theme.accent : theme.line, backgroundColor: theme.card, }]}>
              <ThemedText type="smallBold" style={on ? { color: theme.accent } : undefined}>{label}</ThemedText>
            </Pressable>
          );
        })}
      </View>
      <TextInput value={reviewBody} onChangeText={setReviewBody} maxLength={300} multiline editable={!busy}
        placeholder={tr("어땠는지 한 줄로 남겨주세요 (선택)")} accessibilityLabel={tr("거래 후기")}
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.line, minHeight: 64 }]} />
      <View style={styles.messageActions}>
        <RoomAction label={t.profile.cancel} onPress={() => setReviewOpen(false)} disabled={busy} />
        <RoomAction label={tr(busy ? tr("남기는 중") : tr("후기 남기기"))}
          onPress={() => { if (reviewPick !== null) void submitReview(reviewPick); }}
          disabled={busy || reviewPick === null} primary />
      </View>
    </View>}
    {group && conversation.groupPostId && access.read && <MeetupRoomSummary key={`${currentUserId}:${conversation.groupPostId}`} postId={conversation.groupPostId} onOpen={() => {
      if (!valid()) return;
      discoveryVisible.current = true; discoveryLastMessage.current = latestMessages.current.at(-1)?.id;
      Keyboard.dismiss(); setOverviewOpen(true);
    }} onManage={conversation.isGroupHost ? () => { if (valid()) { Keyboard.dismiss(); setManageOpen(true); } } : undefined} />}
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {access.read ? loading && messages.length === 0 ? <View style={styles.center}><GlingLoader color={theme.accent} accessibilityLabel={t.chat.loading} /></View> : <View ref={listRegion} style={styles.messageList} onLayout={closeMessageMenu}><FlatList ref={messageList} analyticsId="components_chat-room.flatlist.1" data={searchMatches} keyExtractor={(message) => message.id} contentContainerStyle={styles.scroll}
        onViewableItemsChanged={trackVisibleMessages} viewabilityConfig={viewability}
        onScrollBeginDrag={closeMessageMenu} onScroll={onMessageScroll} scrollEventThrottle={32} maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onLayout={() => { if (!discoveryVisible.current && initialScroll.current && followingLatest.current) requestAnimationFrame(() => { if (!discoveryVisible.current) messageList.current?.scrollToEnd({ animated: false }); }); }}
        onContentSizeChange={() => { if (!discoveryVisible.current && initialScroll.current && followingLatest.current && !loadingOlder) requestAnimationFrame(() => { if (!discoveryVisible.current) messageList.current?.scrollToEnd({ animated: false }); }); }}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          if (discoveryVisible.current || ++scrollRetries.current > 3) return;
          messageList.current?.scrollToOffset({ offset: Math.max(0, averageItemLength * index), animated: false });
          setTimeout(() => { if (!discoveryVisible.current) messageList.current?.scrollToIndex({ index, viewPosition: 0.12, animated: false }); }, 120);
        }}
        ListEmptyComponent={<ThemedText type="small" themeColor="textSecondary" style={styles.empty}>{searchOpen && trimmedSearch ? t.search.none(searchQuery.trim()) : access.write ? t.chat.newConversation : t.chat.endedBody}</ThemedText>}
        ListFooterComponent={<>{joinNotices.map(member => <ThemedText key={member.id} type="small" themeColor="textSecondary" accessibilityLiveRegion="polite" style={styles.joinNotice}>{tr("{0}님이 모임에 참여했어요", member.nickname)}</ThemedText>)}<View style={{ height: Spacing.four }} /></>}
        ListHeaderComponent={<>{hasOlder && messages.length > 0 && <RoomAction label={loadingOlder ? t.feed.loadingMore : t.chat.loadOlder} onPress={() => void loadOlder()} disabled={loadingOlder} />}{verificationNotice}</>}
        renderItem={({ item: message, index }) => {
          const author = conversationSender(message, conversation, t, groupMembers);
          const memberPhoto = group ? groupMembers?.find(member => member.id === message.sender_id)?.avatarUrl : undefined;
          const date = chatDateLabel(message.created_at, messages[index - 1]?.created_at, undefined, appLocale);
          const mine = message.is_mine ?? message.sender_id === publicSelfId;
          const time = showChatMessageTime(message, messages[index + 1]) ? <ThemedText type="small" themeColor="textSecondary" style={mine ? styles.timeMine : undefined}>{chatMessageTime(message.created_at, appLocale)}</ThemedText> : null;
          const reaction = reactions.get(message.id);
          const attachment = message.kind === 'image' || message.kind === 'location';
          const locationAccessibility = `${message.location_label ?? tr('공유한 위치')} · ${message.latitude}, ${message.longitude} · ${tr('지도에서 열기 ↗')}`;
          const sharedUrl = attachment || message.deleted_at ? null : sharedLinkInMessage(message.body);
          const photos: ChatPhoto[] = message.imageSources ?? message.imageUrls ?? (message.imageUrl ? [message.imageUrl] : chatImagePaths(message).map(() => undefined));
          const gridWidth = Math.min(234, screen.width - 120);
          const messageContent = message.deleted_at ? <ThemedText type="small" themeColor="textSecondary">{tr('삭제된 메시지입니다.')}</ThemedText> : message.kind === 'image'
            ? photos.length > 1 ? <View style={{ width: gridWidth, gap: 6 }}>
              <View style={styles.photoGrid}>{photos.slice(0, 9).map((uri, position) => <BubblePressable key={position} analyticsId="chat.album.photo"
                message={message} onMenu={openMessageMenu} accessibilityRole="button" accessibilityLabel={tr("묶음 사진 {0}/{1} 크게 보기", (position + 1), (photos.length))}
                onPress={() => openPhotos(photos, position, message.id)} style={[styles.albumTile, { width: (gridWidth - (photos.length > 4 ? 4 : 2)) / (photos.length > 4 ? 3 : 2), backgroundColor: theme.backgroundElement }]}>
                {uri ? <Image source={photoSource(uri)} cachePolicy={business ? 'none' : undefined} style={StyleSheet.absoluteFill} contentFit="cover" accessible={false} /> : <ThemedText type="small" themeColor="textSecondary">{tr("사진을 불러오지 못했어요")}</ThemedText>}
                {position === 8 && photos.length > 9 && <View pointerEvents="none" style={styles.morePhotos}><ThemedText type="subtitle" style={{ color: '#fff' }}>+{photos.length - 9}</ThemedText></View>}
              </BubblePressable>)}</View><ThemedText type="small" themeColor="textSecondary">{tr("사진") + " "}{photos.length}{tr("장")}</ThemedText>
              </View> : photos[0] ? <Image source={photoSource(photos[0])} cachePolicy={business ? 'none' : undefined} style={styles.chatPhoto} contentFit="cover" accessibilityLabel={tr("대화에서 보낸 사진")} />
              : <ThemedText type="small" themeColor="textSecondary">{tr("사진을 불러오지 못했어요")}</ThemedText>
            : message.kind === 'location' && message.latitude != null && message.longitude != null
              ? <ChatLocationMessage latitude={message.latitude} longitude={message.longitude} label={message.location_label} />
              : <ThemedText type="small" style={mine ? { color: theme.accentInk } : undefined}>{message.body}</ThemedText>;
          const quote = message.reply_to_id ? message.reply && !hidden('message', message.reply.id, message.reply.sender_id)
            ? messagePreview(message.reply, tr) : tr('원본 메시지를 볼 수 없어요.') : null;
          const content = <>{quote && <ThemedText type="small" numberOfLines={2} style={[styles.quoteText, { color: mine && !attachment ? theme.accentInk : theme.textSecondary, borderLeftColor: mine && !attachment ? theme.accentInk : theme.line }]}>{quote}</ThemedText>}{messageContent}
            {message.edited_at && !message.deleted_at && <ThemedText type="small" style={{ color: mine && !attachment ? theme.accentInk : theme.textSecondary }}>{tr("수정됨")}</ThemedText>}</>;
          const menuProps = { accessible: !(message.kind === 'image' && photos.length > 1), disabled: !!message.deleted_at, accessibilityState: { disabled: !!message.deleted_at } };
          const onBubblePress = (at: number) => {
            if (message.deleted_at) return;
            if (message.kind === 'image' && photos.length) { openPhotos(photos, 0, message.id); return; }
            if (message.kind === 'location' && message.latitude != null && message.longitude != null) {
              play('selection');
              try { void Linking.openURL(googlePinUrl({ latitude: message.latitude, longitude: message.longitude })).catch(() => setError("지도를 열지 못했어요. 다시 시도해 주세요.")); }
              catch { setError("지도를 열지 못했어요. 다시 시도해 주세요."); }
              return;
            }
            handleBubbleTap(message.id, at);
          };
          // 하트 모양은 그대로 두고, 내가 누른 경우에만 눌린 느낌(배경·그림자)을 준다.
          const heart = !message.deleted_at && reaction && reaction.hearts > 0
            ? <View style={[styles.heartBadge, mine && styles.timeMine, reaction.mine && [styles.heartBadgeMine, { backgroundColor: theme.backgroundSelected, borderColor: theme.line }]]}>
                <ThemedText type="small" themeColor={reaction.mine ? undefined : 'textSecondary'} style={reaction.mine ? [styles.heartBadgeTextMine, { color: theme.text }] : undefined}>❤️ {reaction.hearts}</ThemedText>
              </View>
            : null;
          return <View style={styles.messageGroup}>
            {message.id === unreadStart && <View style={[styles.unreadDivider, { borderColor: theme.accent }]}><ThemedText type="smallBold" themeColor="accent">{tr("여기부터 안 읽은 메시지")}</ThemedText></View>}
            {date && <ThemedText type="small" themeColor="textSecondary" style={styles.date}>{date}</ThemedText>}
            {mine ? <><BubblePressable analyticsId="components_chat-room.pressable.heart" {...menuProps} message={message} onMenu={openMessageMenu} onPress={(event: { nativeEvent?: { timestamp?: number } }) => onBubblePress(event?.nativeEvent?.timestamp ?? 0)} accessibilityRole={message.kind === 'location' ? 'link' : 'button'} accessibilityLabel={tr(message.deleted_at ? tr("삭제된 메시지입니다.") : attachment ? message.kind === 'image' ? tr("사진 크게 보기") : locationAccessibility : tr("메시지에 하트 (두 번 탭)"))} style={[styles.bubbleMine, { backgroundColor: attachment ? theme.card : theme.accent }]}>{content}</BubblePressable>{heart}{time}</>
              : <View style={styles.row}>{message.sender_kind === 'business' ? <Pressable analyticsId="chat.sender-profile" accessibilityRole="button" accessibilityLabel={tr('{0} 프로필 보기', author.nickname)} onPress={() => { play('selection'); onClose(); router.push({ pathname: '/company/[id]', params: { id: author.id } }); }} style={[styles.avatar, { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.backgroundElement }]}>{message.avatarUri ? <Image source={{ uri: message.avatarUri }} style={{ width: 36, height: 36, borderRadius: 18 }} /> : <ThemedText type="smallBold" themeColor="navy">{author.nickname[0]}</ThemedText>}</Pressable> : <Pressable analyticsId="meetup.message-profile" accessibilityRole={group ? "button" : undefined} accessibilityLabel={tr("{0} 모임 프로필", author.nickname)} disabled={!group} onPress={() => { if (!conversation.groupPostId) return; play('selection'); onClose(); router.push({ pathname: '/meetup-profile', params: { postId: conversation.groupPostId, userId: author.id } }); }} style={[styles.avatar, { backgroundColor: theme.backgroundElement, width: 44, height: 44, borderRadius: 22 }]}>{memberPhoto ? <Image source={{ uri: memberPhoto }} cachePolicy="none" style={{ width: 36, height: 36, borderRadius: 18 }} /> : <ThemedText type="smallBold" themeColor="accent">{author.nickname[0]}</ThemedText>}</Pressable>}<View style={styles.rowBody}><ThemedText type="smallBold">{author.nickname}</ThemedText><BubblePressable analyticsId="components_chat-room.pressable.heart" {...menuProps} message={message} onMenu={openMessageMenu} onPress={(event: { nativeEvent?: { timestamp?: number } }) => onBubblePress(event?.nativeEvent?.timestamp ?? 0)} accessibilityRole={message.kind === 'location' ? 'link' : 'button'} accessibilityLabel={tr(message.deleted_at ? tr("삭제된 메시지입니다.") : attachment ? message.kind === 'image' ? tr("사진 크게 보기") : locationAccessibility : tr("메시지에 하트 (두 번 탭)"))} style={[styles.bubble, { backgroundColor: theme.card, borderColor: theme.line }]}>{content}</BubblePressable>{heart}{time}<View style={styles.messageActions}><RoomAction label={t.report.short} onPress={() => setReport({ targetType: 'message', targetId: message.id, ...(message.sender_kind === 'business' ? { reportedBusinessId: author.id } : { reportedUserId: author.id }), reportedNickname: author.nickname })} />{group && <RoomAction label={t.chat.block} onPress={() => void block(author.id)} />}</View></View></View>}
            {sharedUrl && <SharedLinkCard key={`${message.id}:${currentUserId}`} url={sharedUrl} />}
          </View>;
        }} />{awayFromLatest && <Pressable analyticsId="components_chat-room.jump-latest" accessibilityRole="button" accessibilityLabel={tr("최근 메시지로 내려가기")} onPress={() => { play('selection'); followingLatest.current = true; setAwayFromLatest(false); messageList.current?.scrollToEnd({ animated: true }); }} style={[styles.jumpLatest, { backgroundColor: theme.card, borderColor: theme.line }]}><ThemedText type="smallBold" themeColor="accent">{tr("↓ 최근 메시지")}</ThemedText></Pressable>}</View> : <View style={styles.request}><ThemedText type="small" themeColor="textSecondary">{tr("처리되거나 취소된 요청이에요. 대화 목록에서 새로 확인해 주세요.")}</ThemedText></View>}
      {business && !businessReady && !loading && <RoomAction label={tr('대화 접근 다시 확인')} onPress={() => { setError(null); void refreshMessages(); }} />}
      {!!error && <ThemedText accessibilityRole="alert" type="small" themeColor="accent" style={styles.feedback}>{tr(error)}</ThemedText>}{notice && <ThemedText type="small" accessibilityLiveRegion="polite" style={styles.feedback}>{tr(notice)}</ThemedText>}
      {confirmEnd && access.write && <View style={[styles.confirmation, { backgroundColor: theme.backgroundElement }]}><ThemedText type="smallBold">{t.chat.endConfirm}</ThemedText><ThemedText type="small">{conversationExitNotice(conversation, currentUserId, t)}</ThemedText>{group && <MeetupPolicyNotice mode={conversation.isGroupHost ? 'close' : 'leave'} />}<View style={styles.messageActions}><RoomAction label={t.profile.cancel} onPress={() => setConfirmEnd(false)} disabled={busy} /><RoomAction label={group ? conversation.isGroupHost ? t.meetup.end : t.meetup.leave : t.chat.end} onPress={() => void end()} disabled={busy} primary danger /></View></View>}
      {photoProgress && <View testID="chat-photo-progress" accessibilityRole="progressbar" accessibilityLabel={photoProgressLabel} accessibilityLiveRegion="polite"
        accessibilityState={{ busy: true }} accessibilityValue={photoProgress.stage === 'send' || photoProgress.stage === 'select' ? undefined : { min: 0, max: photoProgress.total, now: photoProgress.completed }}
        style={[styles.photoProgress, { backgroundColor: theme.card, borderTopColor: theme.line }]}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><GlingLoader size={14} accessibilityLabel={photoProgressLabel} /></View>
        <ThemedText type="smallBold" style={{ flexShrink: 1 }}>{photoProgressLabel}</ThemedText>
      </View>}
      {access.write && replyTarget && <View style={[styles.photoPreview, { backgroundColor: theme.card, borderTopColor: theme.line }]}>
        <View style={styles.previewActions}><ThemedText type="smallBold">{tr("답장")}</ThemedText><ThemedText type="small" numberOfLines={2}>{messagePreview(replyTarget, tr)}</ThemedText></View>
        {replyLocked && <ThemedText type="small" themeColor="textSecondary">{tr("묶음 전송을 확인한 후 변경할 수 있어요.")}</ThemedText>}
        <RoomAction label={tr("답장 취소")} onPress={() => { if (!photoSend.current?.submitted) setReplyTo(null); }} disabled={sending || pickingPhoto || replyLocked} />
      </View>}
      {access.write && selectedPhotos.length > 0 && <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0, flexShrink: 1, backgroundColor: theme.card }} contentContainerStyle={[styles.photoPreview, { borderTopColor: theme.line }]}>
        <View style={styles.photoHeading}><View style={{ flex: 1 }}><ThemedText type="smallBold" style={{ fontSize: 16 }}>{tr("사진") + " "}{selectedPhotos.length}{tr("장")}</ThemedText><ThemedText type="small" themeColor="textSecondary">{tr(selectedPhotos.length > 1 ? tr("한 말풍선에 묶어 보내요") : tr("이 대화에만 공유"))}</ThemedText></View>
          <Pressable analyticsId="chat.photo.cancel" accessibilityRole="button" accessibilityLabel={tr("선택한 사진 모두 취소")} accessibilityState={{ disabled: sending || pickingPhoto }} disabled={sending || pickingPhoto} onPress={() => { play('selection'); discardPhotoSend(); setSelectedPhotos([]); }} style={({ pressed }) => [styles.iconAction, { opacity: sending ? 0.45 : pressed ? 0.7 : 1 }]}>
            <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={18} tintColor={theme.textSecondary} />
          </Pressable>
        </View>
        <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
          {selectedPhotos.map((photo, index) => <View key={`${photo.uri}-${index}`} style={styles.photoThumb}>
            <Pressable analyticsId="chat.photo.preview" accessibilityRole="button" accessibilityLabel={tr("보낼 사진 {0} 크게 보기", (index + 1))} accessibilityState={{ disabled: sending || pickingPhoto }} disabled={sending || pickingPhoto} onPress={() => { openPhotos(selectedPhotos.map(item => item.uri), index); }} style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
              <Image source={{ uri: photo.uri }} style={styles.previewImage} contentFit="cover" />
            </Pressable>
            <Pressable analyticsId="chat.photo.remove" accessibilityRole="button" accessibilityLabel={tr("사진 {0} 제외", (index + 1))} accessibilityState={{ disabled: sending || pickingPhoto }} disabled={sending || pickingPhoto} onPress={() => { play('selection'); discardPhotoSend(); setSelectedPhotos(current => current.filter(item => item !== photo)); }} style={({ pressed }) => [styles.photoRemove, { opacity: sending ? 0.45 : pressed ? 0.7 : 1 }]}>
              <View style={[styles.removeCircle, { backgroundColor: theme.card, borderColor: theme.line }]}><SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={12} tintColor={theme.text} /></View>
            </Pressable>
          </View>)}
        </ScrollView>
        <Pressable analyticsId="chat.photo.send" accessibilityRole="button" accessibilityLabel={tr(sending ? tr("사진 보내는 중") : tr("{0}장 보내기", (selectedPhotos.length)))} accessibilityState={{ disabled: sending || pickingPhoto }} disabled={sending || pickingPhoto}
          onPress={() => { play('selection'); void sendPhoto(); }} style={({ pressed }) => [styles.photoSend, { backgroundColor: theme.accent, opacity: sending ? 0.5 : pressed ? 0.85 : 1 }]}>
          <SymbolView name={{ ios: 'paperplane.fill', android: 'send', web: 'send' }} size={18} tintColor={theme.accentInk} /><ThemedText type="smallBold" style={{ color: theme.accentInk }}>{tr(sending ? tr("보내는 중") : tr("{0}장 보내기", (selectedPhotos.length)))}</ThemedText>
        </Pressable>
      </ScrollView>}
      {access.write ? <>
        {business && <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} style={styles.feedback}>{tr('{0} 프로필로 보내요', publicSelfName)}</ThemedText>}
        {!business && contextLoaded && !loading && !replyTarget && !allMessages.some(message => message.sender_id === currentUserId) && <View style={[styles.suggestions, { backgroundColor: theme.card }]}>
          <ThemedText type="small" themeColor="textSecondary">{suggestionContext?.title ? `${suggestionContext.title} · ` : ''}{tr("누르면 바로 전송돼요")}</ThemedText>
          <View style={styles.suggestionRow}>{chatSuggestions(suggestionContext, suggestionContext?.authorId === currentUserId).map(body => {
            const disabled = sending || pickingPhoto || replyLocked || busy || !!uncertainSuggestion && uncertainSuggestion !== body;
            return <Pressable key={body} analyticsId="components_chat-room.suggestion" accessibilityRole="button" accessibilityLabel={tr("{0} 보내기", (body))}
              disabled={disabled} accessibilityState={{ disabled }} onPress={() => { play('selection'); void send(body); }}
              style={({ pressed }) => [styles.suggestion, { borderColor: theme.line, backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement, opacity: disabled ? 0.5 : 1 }]}>
              <ThemedText type="small" themeColor="accent">{body}</ThemedText>
            </Pressable>;
          })}</View>
        </View>}
        <View style={[styles.composer, { borderTopColor: theme.line, backgroundColor: theme.card, paddingBottom: attachmentsOpen ? Spacing.one : Math.max(insets.bottom, Spacing.two) + Spacing.one }]}>
          <Pressable analyticsId="components_chat-room.add-attachment" accessibilityRole="button" accessibilityLabel={tr(attachmentsOpen ? tr("첨부 메뉴 닫기") : tr("첨부 메뉴 열기"))} accessibilityState={{ expanded: attachmentsOpen, disabled: sending || pickingPhoto || replyLocked }} disabled={sending || pickingPhoto || replyLocked} onPress={openAttachments} style={({ pressed }) => [styles.addAttachment, { backgroundColor: attachmentsOpen ? theme.backgroundSelected : theme.backgroundElement, opacity: pressed ? 0.7 : 1 }]}><SymbolView name={{ ios: attachmentsOpen ? 'xmark' : 'plus', android: attachmentsOpen ? 'close' : 'add', web: attachmentsOpen ? 'close' : 'add' }} size={21} tintColor={theme.accent} /></Pressable>
          <TextInput value={draft} onChangeText={setDraft} maxLength={2000} placeholder={t.chat.messagePlaceholder} accessibilityLabel={t.chat.messagePlaceholder} placeholderTextColor={theme.textSecondary} returnKeyType="send" submitBehavior="submit" onSubmitEditing={() => void send()} style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.line }]} />
          <RoomAction label={sending ? t.chat.sending : t.chat.send} onPress={() => void send()} disabled={sending || pickingPhoto || replyLocked || busy || !draft.trim()} primary={selectedPhotos.length === 0} />
        </View>
        {attachmentsOpen && <View accessibilityLabel={tr("첨부 방법")} style={[styles.attachmentMenu, { backgroundColor: theme.card, borderColor: theme.line, marginBottom: Math.max(insets.bottom, Spacing.two) + Spacing.one }]}>
          <Pressable analyticsId="components_chat-room.attachment-photo" accessibilityRole="button" accessibilityLabel={tr("사진 보내기")} disabled={sending || pickingPhoto || replyLocked} accessibilityState={{ disabled: sending || pickingPhoto || replyLocked }} onPress={() => { play('selection'); setAttachmentMenu(false); void pickPhoto(); }} style={({ pressed }) => [styles.attachmentOption, { backgroundColor: pressed ? theme.backgroundElement : 'transparent' }]}>
            <View style={[styles.attachmentIcon, { backgroundColor: theme.backgroundElement }]}><SymbolView name={{ ios: 'photo.on.rectangle', android: 'photo_library', web: 'photo_library' }} size={20} tintColor={theme.accent} /></View>
            <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}><ThemedText type="smallBold" style={{ fontSize: 15 }}>{tr("사진 보내기")}</ThemedText><ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12 }}>{tr("최대 20장")}</ThemedText></View><SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={16} tintColor={theme.textSecondary} />
          </Pressable>
          <Pressable analyticsId="components_chat-room.attachment-location" accessibilityRole="button" accessibilityLabel={tr("위치 공유하기")} disabled={sending || pickingPhoto || replyLocked} accessibilityState={{ disabled: sending || pickingPhoto || replyLocked }} onPress={() => { play('selection'); setAttachmentMenu(false); setLocationOpen(true); }} style={({ pressed }) => [styles.attachmentOption, { backgroundColor: pressed ? theme.backgroundElement : 'transparent' }]}>
            <View style={[styles.attachmentIcon, { backgroundColor: theme.backgroundElement }]}><SymbolView name={{ ios: 'mappin.and.ellipse', android: 'location_on', web: 'location_on' }} size={20} tintColor={theme.accent} /></View>
            <ThemedText type="smallBold" style={{ flex: 1, fontSize: 15 }}>{tr("위치 공유하기")}</ThemedText><SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={16} tintColor={theme.textSecondary} />
          </Pressable>
        </View>}
      </> : status === 'ended' && <ThemedText type="small" themeColor="textSecondary" style={[styles.feedback, { paddingBottom: Math.max(insets.bottom, Spacing.three) }]}>{t.chat.endedBody}</ThemedText>}
    </KeyboardAvoidingView>
    <Modal key={settingsSession} testID="chat-room-settings-modal" visible={settingsOpen} transparent animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={closeSettings} onDismiss={() => { const pending = reportAfterSettings.current; if (pending?.session !== settingsSession || settingsActive.current) return; reportAfterSettings.current = null; if (valid()) setReport(pending.target); }}>
      <View style={styles.settingsBackdrop}>
        <Pressable analyticsId="chat.settings.dismiss" accessibilityRole="button" accessibilityLabel={closeSettingsLabel} onPress={closeSettings} style={StyleSheet.absoluteFill} />
        <View testID="chat-room-settings" accessibilityViewIsModal style={[styles.settingsSheet, { backgroundColor: theme.card, borderTopColor: theme.line, paddingBottom: Math.max(insets.bottom, Spacing.three) }]}>
          <View style={styles.settingsHeading}><ThemedText type="section" accessibilityRole="header" style={{ flex: 1 }}>{settingsTitle}</ThemedText>
            <Pressable analyticsId="components_chat-room.pressable.1" accessibilityRole="button" accessibilityLabel={closeSettingsLabel} onPress={closeSettings} style={({ pressed }) => [styles.iconAction, { opacity: pressed ? 0.82 : 1 }]}><SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={18} tintColor={theme.textSecondary} /></Pressable>
          </View>
          {access.write && <RoomAction label={group ? conversation.isGroupHost ? t.meetup.end : t.meetup.leave : t.chat.end} danger disabled={busy} onPress={() => { if (access.write) selectRoomSetting(() => setConfirmEnd(true)); }} />}
          {!group && <>{!business && <RoomAction label={t.report.short} onPress={() => selectRoomSetting(() => { const target: ReportSelection = { targetType: 'user', targetId: conversation.otherUser.id, reportedUserId: conversation.otherUser.id, reportedNickname: conversation.otherUser.nickname }; if (Platform.OS === 'ios') reportAfterSettings.current = { session: settingsSession, target }; else setReport(target); })} />}
            <RoomAction label={t.chat.block} disabled={busy} onPress={() => selectRoomSetting(() => { void block(conversation.otherUser.id); })} /></>}
        </View>
      </View>
    </Modal>
    {locationOpen && auth.isAuthed && auth.me.id === currentUserId && access.write && <ChatLocationPicker sending={sending} onSend={sendLocation} onClose={() => setLocationOpen(false)} />}
    {discoveryOpen && auth.isAuthed && auth.me.id === currentUserId && scopeMatches && <Modal visible presentationStyle="fullScreen" animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={closeDiscovery}>
      <SafeAreaProvider style={{ flex: 1 }}><MapScreen onClose={closeDiscovery} /></SafeAreaProvider>
    </Modal>}
    {overviewOpen && group && conversation.groupPostId && access.read && auth.isAuthed && auth.me.id === currentUserId && scopeMatches && <MeetupChatOverview
      key={`${currentUserId}:${conversation.groupPostId}`} postId={conversation.groupPostId} currentUserId={currentUserId}
      onClose={() => { closeDiscovery(); setOverviewOpen(false); }} />}
    {manageOpen && group && conversation.isGroupHost && access.read && auth.isAuthed && auth.me.id === currentUserId && scopeMatches && <MeetupManageSheet visible onClose={() => setManageOpen(false)} actions={[
      { key: 'location', label: tr('집결지 공유'), hint: tr('지도 카드로 보내기'), icon: { ios: 'mappin.and.ellipse', android: 'location_on', web: 'location_on' }, onPress: () => setLocationOpen(true) },
      { key: 'requests', label: tr('참여 신청'), hint: tr('신청과 승인을 처리해요'), icon: { ios: 'person.2', android: 'group', web: 'group' }, onPress: () => router.replace({ pathname: '/chat', params: { view: 'requests' } }) },
      { key: 'share', label: tr('모임 공유하기'), icon: { ios: 'square.and.arrow.up', android: 'share', web: 'share' }, onPress: () => { void Promise.resolve().then(() => loadPublicPost(supabase, conversation.groupPostId!)).then(post => { if (post) setSharePost(post); }).catch(() => {}); } },
      { key: 'end', label: group ? conversation.isGroupHost ? t.meetup.end : t.meetup.leave : t.chat.end, icon: { ios: 'stop.circle', android: 'stop_circle', web: 'stop_circle' }, danger: true, onPress: () => setConfirmEnd(true) },
    ]} />}
    {sharePost && <PostShareSheet post={sharePost} visible onClose={() => setSharePost(null)} onShared={() => setSharePost(null)} />}
    {messageMenu && menuFrame && !deleteConfirm && !hidden('message', messageMenu.id, messageMenu.sender_id) && auth.isAuthed && auth.me.id === currentUserId && access.write && <Modal visible transparent statusBarTranslucent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={() => { play('selection'); closeMessageMenu(); }}>
      <View style={{ flex: 1 }} accessibilityViewIsModal>
        <Pressable analyticsId="chat.message.menu-dismiss" accessibilityRole="button" accessibilityLabel={tr("메시지 메뉴 닫기")} style={StyleSheet.absoluteFill}
          onPress={() => { play('selection'); closeMessageMenu(); }} />
        <View accessibilityLabel={tr("메시지 메뉴")} onLayout={({ nativeEvent: { layout } }) => setMenuSize(current => current.width === layout.width && current.height === layout.height ? current : { width: layout.width, height: layout.height })}
          style={[styles.bubbleMenu, { backgroundColor: theme.card, borderColor: theme.line, maxWidth: menuFrame.bounds.width - 16, opacity: menuSize.height ? 1 : 0 }, menuSize.width
            ? { width: menuSize.width, ...messageMenuPosition(menuFrame.anchor, menuSize, menuFrame.bounds, (messageMenu.is_mine ?? messageMenu.sender_id === publicSelfId)) }
            : { left: menuFrame.bounds.x + 8, top: menuFrame.bounds.y + 8 }]}>
          <Pressable analyticsId="chat.message.reply" accessibilityRole="button" accessibilityLabel={tr("답장")} disabled={sending || pickingPhoto || replyLocked} accessibilityState={{ disabled: sending || pickingPhoto || replyLocked }} onPress={() => { if (photoSend.current?.submitted) return; play('selection'); setReplyTo(messageMenu); closeMessageMenu(); }} style={({ pressed }) => [styles.bubbleMenuAction, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}><ThemedText type="smallBold">{tr("답장")}</ThemedText></Pressable>
          {(messageMenu.is_mine ?? messageMenu.sender_id === publicSelfId) && <>
            {(!messageMenu.kind || messageMenu.kind === 'text') && <Pressable analyticsId="chat.message.edit" accessibilityRole="button" accessibilityLabel={tr("메시지 수정")} disabled={sending} onPress={() => { play('selection'); setEditingMessage(messageMenu); setMessageEditDraft(messageMenu.body); closeMessageMenu(); setError(null); }} style={({ pressed }) => [styles.bubbleMenuAction, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}><ThemedText type="smallBold">{tr("수정")}</ThemedText></Pressable>}
            <Pressable analyticsId="chat.message.delete" accessibilityRole="button" accessibilityLabel={tr("메시지 삭제")} disabled={sending} onPress={() => { play('selection'); setDeleteConfirm(true); }} style={({ pressed }) => [styles.bubbleMenuAction, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}><ThemedText type="smallBold" themeColor="danger">{tr("삭제")}</ThemedText></Pressable>
          </>}
        </View>
      </View>
    </Modal>}
    {messageMenu && deleteConfirm && !hidden('message', messageMenu.id, messageMenu.sender_id) && auth.isAuthed && auth.me.id === currentUserId && access.write && <Modal visible transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={() => { play('selection'); closeMessageMenu(); }}>
      <View style={styles.messageSheetBackdrop} accessibilityViewIsModal>
        <View style={[styles.messageSheet, { backgroundColor: theme.card }]}>
          <ThemedText type="small" numberOfLines={3}>{messagePreview(messageMenu, tr)}</ThemedText>
            <ThemedText>{tr("이 메시지를 삭제할까요? 대화에는 ‘삭제된 메시지입니다’가 남아요.")}</ThemedText>
            <RoomAction label={tr("취소")} onPress={() => setDeleteConfirm(false)} disabled={sending} />
            <RoomAction label={tr("삭제하기")} onPress={() => void changeMessage(messageMenu, true)} disabled={sending} primary />
          {!!error && <ThemedText type="small" accessibilityRole="alert">{tr(error)}</ThemedText>}
        </View>
      </View>
    </Modal>}
    {editingMessage && !hidden('message', editingMessage.id, editingMessage.sender_id) && auth.isAuthed && auth.me.id === currentUserId && access.write && <Modal visible transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={() => { play('selection'); setEditingMessage(null); }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.messageSheetBackdrop} accessibilityViewIsModal>
        <View style={[styles.messageSheet, { backgroundColor: theme.card }]}>
          <ThemedText type="smallBold">{tr("메시지 수정")}</ThemedText>
          <TextInput value={messageEditDraft} onChangeText={setMessageEditDraft} accessibilityLabel={tr("수정할 메시지")} maxLength={2000} multiline autoFocus editable={!sending}
            style={[styles.input, { minHeight: 100, color: theme.text, borderColor: theme.line }]} />
          <RoomAction label={tr("취소")} onPress={() => setEditingMessage(null)} disabled={sending} />
          <RoomAction label={tr(sending ? tr("저장 중") : tr("수정 저장"))} onPress={() => void changeMessage(editingMessage, false)} disabled={sending || !messageEditDraft.trim()} primary />
          {!!error && <ThemedText type="small" accessibilityRole="alert">{tr(error)}</ThemedText>}
        </View>
      </KeyboardAvoidingView>
    </Modal>}
    {report && <ReportSheet visible {...report} businessConversation={business ? conversation : undefined} onClose={() => {
      setReport(null); void onChanged();
      void refreshMessages();
    }} />}
    {photoOpen && <Modal visible transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={() => setPhotoOpen(null)}>
      <View accessibilityViewIsModal style={[styles.photoBackdrop, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.photoToolbar}><ThemedText type="smallBold" style={{ color: '#fff' }}>{`${photoOpen.index + 1}/${photoOpen.photos.length}`}</ThemedText>
          <Pressable analyticsId="components_chat-room.photo-close" accessibilityRole="button" accessibilityLabel={tr("사진 닫기")} onPress={() => { play('selection'); setPhotoOpen(null); }} style={styles.photoClose}><ThemedText style={{ color: '#fff' }}>{tr("닫기 ✕")}</ThemedText></Pressable>
        </View>
        <ScrollView ref={photoPages} key={`${photoOpen.messageId ?? 'draft'}:${screen.width}`} testID="chat-photo-pages" horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          contentOffset={{ x: photoOpen.initialIndex * screen.width, y: 0 }} style={{ flex: 1 }}
          onLayout={() => photoPages.current?.scrollTo({ x: photoOpen.index * screen.width, animated: false })}
          onMomentumScrollEnd={event => { const index = Math.max(0, Math.min(photoOpen.photos.length - 1, Math.round(event.nativeEvent.contentOffset.x / screen.width))); if (index !== photoOpen.index) { play('selection'); setPhotoOpen({ ...photoOpen, index }); } }}>
          {photoOpen.photos.map((uri, index) => <View key={index} style={{ width: screen.width, height: '100%', justifyContent: 'center', alignItems: 'center' }}>
            {uri ? <Image source={Math.abs(index - photoOpen.index) <= 1 ? photoSource(uri) : null} cachePolicy={business ? 'none' : undefined} style={styles.fullPhoto} contentFit="contain" accessibilityLabel={tr(index === photoOpen.index ? tr("대화 사진 크게 보기") : tr("묶음 사진 {0}", (index + 1)))} />
              : <ThemedText style={{ color: '#fff' }}>{tr("사진을 불러오지 못했어요")}</ThemedText>}
          </View>)}
        </ScrollView>
        {photoOpen.photos.length > 1 && <View style={styles.photoToolbar}>{([-1, 1] as const).map(direction => <Pressable key={direction} analyticsId={direction < 0 ? 'chat.photo.previous' : 'chat.photo.next'}
          accessibilityRole="button" accessibilityLabel={tr(direction < 0 ? tr("이전 사진") : tr("다음 사진"))} disabled={photoOpen.index + direction < 0 || photoOpen.index + direction >= photoOpen.photos.length}
          accessibilityState={{ disabled: photoOpen.index + direction < 0 || photoOpen.index + direction >= photoOpen.photos.length }} onPress={() => changePhoto(photoOpen.index + direction)} style={styles.photoClose}>
          <ThemedText style={{ color: '#fff', opacity: photoOpen.index + direction < 0 || photoOpen.index + direction >= photoOpen.photos.length ? 0.4 : 1 }}>{tr(direction < 0 ? tr("← 이전") : tr("다음 →"))}</ThemedText>
        </Pressable>)}</View>}
      </View>
    </Modal>}
  </ThemedView>;
}

const styles = StyleSheet.create({
  bubbleMenu: { position: 'absolute', flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderRadius: 16, padding: 4, shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 10 },
  bubbleMenuAction: { minWidth: 64, minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  quoteText: { borderLeftWidth: 2, paddingLeft: 8, marginBottom: 8 },
  messageSheetBackdrop: { flex: 1, justifyContent: 'center', padding: Spacing.three, backgroundColor: 'rgba(0,0,0,0.55)' },
  messageSheet: { width: '100%', maxWidth: 520, alignSelf: 'center', padding: Spacing.three, borderRadius: 16, gap: Spacing.two },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderBottomWidth: 1, gap: Spacing.two },
  titleRow: { flex: 1, minWidth: 0, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  title: { fontSize: 17, lineHeight: 22, flexShrink: 1, minWidth: 0 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', paddingHorizontal: Spacing.two },
  groupToolbar: { justifyContent: 'space-between', alignItems: 'center' },
  roomTools: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  settingsBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  settingsSheet: { borderTopWidth: 1, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: Spacing.three, paddingTop: Spacing.two, gap: Spacing.two },
  settingsHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dangerAction: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  suggestions: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, gap: Spacing.one },
  suggestionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  suggestion: { minHeight: 44, maxWidth: '100%', borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, paddingVertical: Spacing.two, justifyContent: 'center' },
  action: { minWidth: 44, minHeight: 44, borderRadius: 12, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, justifyContent: 'center', alignItems: 'center' },
  request: { padding: Spacing.three, gap: Spacing.three },
  safetyNotice: { padding: Spacing.three, borderRadius: 12, gap: Spacing.one },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  messageList: { flex: 1 },
  unreadDivider: { alignItems: 'center', borderTopWidth: 1, paddingTop: Spacing.two, marginTop: Spacing.two },
  joinNotice: { textAlign: 'center', paddingVertical: Spacing.one },
  jumpLatest: { position: 'absolute', alignSelf: 'center', bottom: Spacing.two, minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.three, borderRadius: 22, borderWidth: 1, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 },
  scroll: { padding: Spacing.three, gap: Spacing.three },
  messageGroup: { gap: Spacing.one },
  date: { textAlign: 'center', paddingVertical: Spacing.two },
  timeMine: { alignSelf: 'flex-end' },
  heartBadge: { alignSelf: 'flex-start', paddingHorizontal: Spacing.two, paddingVertical: 1, borderRadius: 10, borderWidth: 1, borderColor: 'transparent' },
  // 내가 누른 하트만 진하게: 옅은 배경 + 테두리 + 그림자.
  heartBadgeMine: {
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  heartBadgeTextMine: { textShadowColor: 'rgba(0,0,0,0.30)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  empty: { textAlign: 'center', paddingVertical: Spacing.five },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start', paddingRight: Spacing.five },
  rowBody: { gap: Spacing.one, flexShrink: 1 },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  bubble: { borderWidth: 1, borderRadius: 14, borderTopLeftRadius: 4, paddingHorizontal: 12, paddingVertical: Spacing.two, alignSelf: 'flex-start' },
  bubbleMine: { alignSelf: 'flex-end', borderRadius: 14, borderTopRightRadius: 4, paddingHorizontal: 12, paddingVertical: Spacing.two, marginLeft: Spacing.five },
  chatPhoto: { width: 210, height: 180, borderRadius: 10 },
  locationCard: { gap: Spacing.two },
  locationMap: { height: 124, borderRadius: 10, overflow: 'hidden' },
  photoPreview: { gap: 12, padding: Spacing.three, borderTopWidth: 1 },
  photoProgress: { minHeight: 44, flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  photoHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  photoThumb: { width: 80, height: 80 }, previewImage: { width: 80, height: 80, borderRadius: 12 },
  previewActions: { flex: 1, minWidth: 90 },
  iconAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingLeft: Spacing.three, borderBottomWidth: 1 },
  searchInput: { flex: 1, minHeight: 44, fontSize: 15 },
  photoRemove: { position: 'absolute', top: 0, right: 0, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  removeCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  photoSend: { minHeight: 48, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: 12 },
  addAttachment: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  attachmentMenu: { gap: 4, padding: 8, marginHorizontal: 12, marginTop: 8, borderWidth: 1, borderRadius: 20 },
  attachmentOption: { minHeight: 48, paddingHorizontal: 8, paddingVertical: 6, gap: 10, flexDirection: 'row', alignItems: 'center', borderRadius: 12 },
  attachmentIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  photoBackdrop: { flex: 1, backgroundColor: '#0B0B12', justifyContent: 'center' },
  photoToolbar: { minHeight: 48, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  photoClose: { minWidth: 64, minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2, borderRadius: 10, overflow: 'hidden' },
  albumTile: { aspectRatio: 1, minHeight: 44, justifyContent: 'center' },
  morePhotos: { ...StyleSheet.absoluteFill, backgroundColor: '#0009', alignItems: 'center', justifyContent: 'center' },
  fullPhoto: { width: '100%', height: '100%' },
  messageActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  feedback: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  reviewPick: { flexDirection: 'row', gap: Spacing.two },
  reviewOption: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 10 },
  confirmation: { padding: Spacing.three, gap: Spacing.two },
  composer: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.two, paddingTop: Spacing.two, borderTopWidth: 1, alignItems: 'center' },
  input: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: Spacing.three, paddingVertical: 10, fontSize: 14 },
});
