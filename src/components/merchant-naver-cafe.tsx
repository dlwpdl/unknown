import { useLanguage } from '@/hooks/use-language';
import { tr } from '@/i18n';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Linking, Platform, StyleSheet, TextInput, View } from 'react-native';
import { Pressable } from '@/components/analytics-controls';
import { MerchantBadge, MerchantHelp, type MerchantBadgeTone } from '@/components/merchant-ui';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { merchantEventId } from '@/lib/merchant-source';
import type { MerchantDraft } from '@/lib/merchant-workspace';
import { cancelMerchantNaverPreparation, completeMerchantNaverCafe, disconnectMerchantNaverCafe, loadMerchantNaverCafe, parseCafeBoardUrl, publishMerchantNaverCafe, startMerchantNaverCafe,
  type MerchantNaverPublish, type MerchantNaverStatus } from '@/lib/naver-cafe';
import { supabase } from '@/lib/supabase';

const errors: Record<string, string> = {
  MERCHANT_ACCESS_REQUIRED: '현재 계정에 비즈니스 관리 권한이 없어요.', MERCHANT_OWNER_VERIFICATION_REQUIRED: '확인된 비즈니스 소유자만 네이버 계정을 연결할 수 있어요.',
  NAVER_NOT_CONFIGURED: '네이버 개발자 앱 설정이 아직 준비되지 않았어요.', NAVER_STATUS_UNAVAILABLE: '네이버 연결 상태를 확인하지 못했어요. 연결 설정과 서버 배포를 확인해 주세요.',
  INVALID_NAVER_STATE: '로그인 계정이 다르거나 연결 요청이 만료됐어요. 다시 연결해 주세요.', NAVER_RECONNECT_REQUIRED: '네이버 계정을 다시 연결해 주세요.',
  INVALID_NAVER_BOARD_URL: '카페의 게시판 주소를 붙여넣어 주세요. 카페 홈 주소만으로는 게시판을 선택할 수 없어요.',
  MERCHANT_DRAFT_CHANGED: '원고가 바뀌었어요. 최신 저장본과 사진 순서를 다시 확인하고 승인해 주세요.', MERCHANT_DRAFT_APPROVAL_REQUIRED: '최신 저장 원고를 먼저 승인해 주세요.',
  NAVER_CONTENT_REVIEW_REQUIRED: '안전 검토가 필요한 원고예요. 내용을 확인한 뒤 운영자에게 문의해 주세요.', CONTENT_NOT_ALLOWED: '게시 기준에 맞지 않는 내용이에요.',
  NAVER_INVALID_PHOTO: '사진 형식 또는 용량을 확인하지 못했어요. 원고의 사진을 확인해 주세요.', NAVER_PENDING_STORAGE_REQUIRED: '발행 요청을 안전하게 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.',
  NAVER_PUBLISH_UNCERTAIN: '게시 결과가 불확실해요. 중복 게시를 막기 위해 재발행을 멈췄어요. 카페에서 실제 글을 확인해 주세요.',
  MERCHANT_OPERATIONS_PAUSED: '중단된 비즈니스는 게시할 수 없어요.', RATE_LIMITED: '오늘 게시 한도 또는 연결 요청 한도에 도달했어요. 잠시 후 다시 확인해 주세요.',
};
const errorText = (error: unknown) => errors[error instanceof Error ? error.message : ''] ?? '처리하지 못했어요. 입력은 유지했으니 상태를 다시 확인해 주세요.';

const NO_PHOTOS: string[] = [];
export type MerchantNaverCallbackData = { state: string | null; code: string | null; result: string | null };
let capturedCallback: MerchantNaverCallbackData | null | undefined;
export function captureMerchantNaverCallback(): MerchantNaverCallbackData | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  if (capturedCallback !== undefined) return capturedCallback;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('naver_cafe')) return null;
  capturedCallback = { state: url.searchParams.get('state'), code: url.searchParams.get('code'), result: url.searchParams.get('naver_cafe') };
  ['naver_cafe', 'state', 'code'].forEach(key => url.searchParams.delete(key));
  window.history.replaceState(window.history.state, '', url.href);
  return capturedCallback;
}
export function MerchantNaverCallback({ callback, onConnected }: { callback?: MerchantNaverCallbackData | null; onConnected: (merchantId: string) => void }) {

  const { me } = useAuth();
  return <CafeCallback key={me.id} userId={me.id} callback={callback} onConnected={onConnected} />;
}
function CafeCallback({ callback: provided, onConnected, userId }: { callback?: MerchantNaverCallbackData | null; onConnected: (merchantId: string) => void; userId: string }) {
  const { tr } = useLanguage();
  const [callback] = useState(() => provided === undefined ? captureMerchantNaverCallback() : provided);
  const [error, setError] = useState(''), [done, setDone] = useState(false);
  const operation = useRef<ReturnType<typeof completeMerchantNaverCafe> | null>(null), delivered = useRef(false), currentUser = useRef(userId);
  const { play } = useInteractionFeedback();
  useLayoutEffect(() => { currentUser.current = userId; return () => { currentUser.current = ''; }; }, [userId]);
  useEffect(() => {
    if (!callback || delivered.current) return;
    if (!operation.current) operation.current = Promise.resolve().then(async () => {
      if (callback.result !== 'finish' || !callback.state || !callback.code) throw new Error('INVALID_NAVER_STATE');
      return completeMerchantNaverCafe(supabase, callback.state, callback.code);
    });
    void operation.current.then(result => {
      if (currentUser.current !== userId || delivered.current) return;
      delivered.current = true; capturedCallback = null; setDone(true); play('success'); onConnected(result.merchantId);
    }).catch(err => {
      if (currentUser.current !== userId || delivered.current) return;
      delivered.current = true; capturedCallback = null; setError(errorText(err)); play('warning');
    });
  }, [callback, onConnected, userId, play]);
  if (!callback) return null;
  return <ThemedText accessibilityLiveRegion="polite" accessibilityRole={error ? 'alert' : undefined} type="small" themeColor={error ? 'danger' : undefined}>
    {error ? tr(error) : done ? tr("네이버 연결을 완료했어요. 카페 가입·게시판 쓰기 권한은 발행할 때 확인해요.") : tr("네이버 연결을 확인하고 있어요…")}
  </ThemedText>;
}
async function confirm(title: string, body: string) {
  if (Platform.OS === 'web') return window.confirm(`${title}\n\n${body}`);
  return new Promise<boolean>(resolve => Alert.alert(title, body, [{ text: tr("취소"), style: 'cancel', onPress: () => resolve(false) }, { text: tr("확인"), onPress: () => resolve(true) }], { cancelable: true, onDismiss: () => resolve(false) }));
}
function CafeAction({ label, onPress, disabled = false, primary = false }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {

  const theme = useTheme(), { play } = useInteractionFeedback();
  return <Pressable lens analyticsId="merchant.naver.action" accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled }} disabled={disabled} onPress={() => { play('selection'); onPress(); }}
    style={[styles.button, { borderColor: theme.line, backgroundColor: primary ? theme.accent : theme.backgroundElement, opacity: disabled ? 0.45 : 1 }]}><ThemedText type="smallBold" style={primary ? { color: theme.background } : undefined}>{label}</ThemedText></Pressable>;
}

type Props = { merchantId: string; drafts: MerchantDraft[]; onChanged?: () => void | Promise<void> };
type PendingPublish = MerchantNaverPublish & { observedArticleUrl?: string };
const receiptTones: Record<MerchantNaverStatus['requests'][number]['status'], MerchantBadgeTone> = { prepared: 'accent', in_flight: 'accent', succeeded: 'ok', failed: 'danger', uncertain: 'warn' };
const safeArticleUrl = (value: string) => /^https:\/\/cafe\.naver\.com\/[A-Za-z0-9_-]{1,100}\/[1-9]\d*$/.test(value);
export function MerchantNaverCafe(props: Props) {

  const { me } = useAuth();
  return <CafeWorkspace key={`${me.id}:${props.merchantId}`} {...props} userId={me.id} />;
}
function CafeWorkspace({ merchantId, drafts, onChanged, userId }: Props & { userId: string }) {
  const { tr } = useLanguage();
  const labels = { get prepared() { return tr("발행 준비"); }, get in_flight() { return tr("결과 확인 중"); }, get succeeded() { return tr("게시 완료"); }, get failed() { return tr("게시 거절"); }, get uncertain() { return tr("결과 불확실"); } } as const;
  const theme = useTheme(), { play } = useInteractionFeedback();
  const context = `${userId}:${merchantId}`, contextRef = useRef(context);
  useLayoutEffect(() => { contextRef.current = context; return () => { contextRef.current = ''; }; }, [context]);
  const storageKey = `gling:merchant-naver:${context}`;
  const [status, setStatus] = useState<MerchantNaverStatus | null>(null), [boardUrl, setBoardUrl] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null), [busy, setBusy] = useState(false), busyRef = useRef(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState<string | { errorCode: string }>(''), [pending, setPending] = useState<PendingPublish | null>(null);
  const [photos, setPhotos] = useState<{ key: string; urls: string[] } | null>(null), [photoFailure, setPhotoFailure] = useState<string | null>(null);
  const eligible = drafts.filter(draft => draft.approved_at && !draft.archived_at && !draft.external_url);
  const draft = eligible.find(draft => draft.id === draftId);
  const imagePaths = draft?.image_paths ?? NO_PHOTOS;
  const photoKey = JSON.stringify([context, draft?.id, draft?.updated_at, imagePaths]);
  const urls = photos?.key === photoKey ? photos.urls : [];
  const photoFailed = photoFailure === photoKey;
  const unresolved = status?.requests.find(request => request.id === pending?.requestId && ['in_flight', 'uncertain'].includes(request.status));
  const preparation = status?.requests.find(request => request.id === pending?.requestId && request.status === 'prepared');
  useEffect(() => {
    let active = true;
    void Promise.all([loadMerchantNaverCafe(supabase, merchantId), AsyncStorage.getItem(storageKey).catch(() => { throw new Error('NAVER_PENDING_STORAGE_REQUIRED'); })])
      .then(async ([next, stored]) => {
        if (!active || contextRef.current !== context) return;
        setStatus(next);
        if (stored) {
          const restored = JSON.parse(stored);
          if (!restored || typeof restored.requestId !== 'string' || typeof restored.draftId !== 'string' || typeof restored.expectedUpdatedAt !== 'string'
            || typeof restored.boardUrl !== 'string' || !Array.isArray(restored.imagePaths) || restored.imagePaths.length > 6 || restored.imagePaths.some((path: unknown) => typeof path !== 'string') || restored.confirmed !== true) throw new Error('NAVER_PENDING_STORAGE_REQUIRED');
          parseCafeBoardUrl(restored.boardUrl);
          if (restored.observedArticleUrl !== undefined && (typeof restored.observedArticleUrl !== 'string' || !safeArticleUrl(restored.observedArticleUrl))) throw new Error('NAVER_PENDING_STORAGE_REQUIRED');
          if (next.requests.some(request => request.id === restored.requestId && ['succeeded', 'failed'].includes(request.status))) {
            await AsyncStorage.removeItem(storageKey);
            if (active && contextRef.current === context) setNotice("이전 요청의 최종 결과를 확인했어요. 새 원고를 선택할 수 있어요.");
            return;
          }
          setPending(restored); setBoardUrl(restored.boardUrl); setDraftId(restored.draftId);
          setNotice("이전 발행 요청이 있어요. 먼저 결과를 확인해 주세요.");
        }
      }).catch(err => { if (active && contextRef.current === context) setError(errorText(err)); });
    return () => { active = false; };
  }, [context, merchantId, storageKey]);
  useEffect(() => {
    let active = true;
    if (!imagePaths.length) return;
    void Promise.resolve().then(async () => {
      if (imagePaths.some(path => !path.startsWith(`${userId}/`))) throw new Error('INVALID_IMAGE_PATH');
      return supabase.storage.from('post-images').createSignedUrls(imagePaths, 300);
    }).then(result => {
      if (!active || contextRef.current !== context) return;
      const ordered = imagePaths.map(path => result.data?.find(row => row.path === path)?.signedUrl);
      if (result.error || ordered.some(url => !url)) { setPhotoFailure(photoKey); return; }
      setPhotos({ key: photoKey, urls: ordered as string[] });
    }).catch(() => { if (active) setPhotoFailure(photoKey); });
    return () => { active = false; };
  }, [context, photoKey, imagePaths, userId]);

  async function run(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try { await work(); }
    catch (err) { if (contextRef.current === context) { setError(errorText(err)); play('warning'); } }
    finally { busyRef.current = false; if (contextRef.current === context) setBusy(false); }
  }
  async function refreshStatus() {
    const next = await loadMerchantNaverCafe(supabase, merchantId);
    if (contextRef.current !== context) return;
    setStatus(next);
    if (pending && next.requests.some(request => request.id === pending.requestId && ['succeeded', 'failed'].includes(request.status))) {
      await AsyncStorage.removeItem(storageKey);
      if (contextRef.current === context) setPending(null);
    }
  }

  return <View style={[styles.section, { borderColor: theme.line, backgroundColor: theme.card }]}>
    <View style={styles.titleRow}>
      <ThemedText type="subtitle">{tr("네이버 카페")}</ThemedText>
      {status ? <MerchantBadge label={!status.configured ? tr("설정 필요") : status.connection ? tr("연결됨") : tr("연결 안 됨")} tone={!status.configured ? 'warn' : status.connection ? 'ok' : 'neutral'} />
        : <MerchantBadge label={tr("연결 상태 확인 중")} />}
    </View>
    {status && !status.configured && <ThemedText themeColor="textSecondary" type="small">{tr("네이버 개발자 앱과 서버 연결 설정이 필요해요.")}</ThemedText>}
    {status?.configured && !status.connection && <ThemedText themeColor="textSecondary" type="small">{tr("본인 네이버 계정으로 연결해 주세요.")}</ThemedText>}
    <View style={styles.actions}>
      <CafeAction label={tr("상태 다시 확인")} disabled={busy} onPress={() => { void run(refreshStatus); }} />
      <CafeAction label={status?.connection ? tr("네이버 다시 연결") : tr("네이버 계정 연결")} disabled={busy || !status?.configured} onPress={() => { void run(async () => {
        if (Platform.OS !== 'web') { setNotice("비즈니스용 웹에서 네이버 계정을 연결해 주세요."); return; }
        const next = await startMerchantNaverCafe(supabase, merchantId);
        const target = new URL(next.authorizationUrl);
        if (target.protocol !== 'https:' || target.hostname !== 'nid.naver.com' || target.pathname !== '/oauth2.0/authorize') throw new Error('INVALID_NAVER_STATE');
        if (contextRef.current === context) window.location.assign(target.href);
      }); }} />
      {status?.connection && <CafeAction label={tr("연결 해제")} disabled={busy} onPress={() => { void run(async () => {
        if (!await confirm('네이버 연결 해제', '새 게시를 중단하고 글링에 저장한 연결 토큰을 삭제해요. 이미 카페에 올린 글은 유지돼요.')) return;
        play('selection'); const result = await disconnectMerchantNaverCafe(supabase, merchantId);
        if (contextRef.current !== context) return;
        setStatus(await loadMerchantNaverCafe(supabase, merchantId)); play('success');
        setNotice(result.providerRevoked ? "네이버 연결을 해제했어요." : "글링 연결은 해제했어요. 네이버의 연결된 서비스에서도 권한 해제를 확인해 주세요.");
      }); }} />}
    </View>
    {error ? <ThemedText accessibilityRole="alert" type="small" themeColor="danger">{tr(error)}</ThemedText> : null}
    {notice ? <ThemedText accessibilityLiveRegion="polite" type="small">{typeof notice === 'string' ? tr(notice) : tr('네이버가 게시를 거절했어요 ({0}). 카페 권한과 사진을 확인해 주세요.', notice.errorCode || tr('권한 확인'))}</ThemedText> : null}
    {preparation && <CafeAction label={tr("이전 발행 준비 취소")} disabled={busy} onPress={() => { void run(async () => {
      if (!await confirm('이전 발행 준비를 취소할까요?', '아직 외부 게시를 시작하지 않은 요청만 취소할 수 있어요. 발행이 시작됐다면 결과 확인을 계속해요.')) return;
      play('selection');
      const result = await cancelMerchantNaverPreparation(supabase, merchantId, preparation.id);
      if (contextRef.current !== context) return;
      if (result.request.status === 'failed' && result.request.error_code === 'NAVER_PREPARATION_CANCELLED') {
        await AsyncStorage.removeItem(storageKey); setPending(null); setNotice("발행 준비를 취소했어요. 최신 원고를 선택해 주세요."); play('success');
      } else setNotice(errors.NAVER_PUBLISH_UNCERTAIN);
      await refreshStatus();
    }); }} />}
    {pending?.observedArticleUrl && <View style={styles.receipt}><ThemedText type="small" themeColor="textSecondary">{tr("네이버가 반환한 링크예요. 글링 서버 기록은 아직 확인되지 않았어요.")}</ThemedText>
      <CafeAction label={tr("반환된 카페 링크 확인")} disabled={busy} onPress={() => { void run(async () => {
        if (!safeArticleUrl(pending.observedArticleUrl!)) throw new Error('INVALID_NAVER_BOARD_URL');
        await Linking.openURL(pending.observedArticleUrl!);
      }); }} />
    </View>}
    {status?.configured && status.connection && <>
      <ThemedText type="smallBold">{tr("발행할 게시판 주소")}</ThemedText>
      <TextInput accessibilityLabel={tr("네이버 카페 게시판 주소")} value={boardUrl} editable={!busy && !pending} maxLength={2048} autoCapitalize="none" autoCorrect={false}
        placeholder="https://cafe.naver.com/f-e/cafes/…/menus/…" placeholderTextColor={theme.textSecondary}
        onFocus={() => play('selection')} onChangeText={value => { play('selection'); setBoardUrl(value); }}
        style={[styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.backgroundElement }]} />
      <ThemedText type="smallBold">{tr("올릴 원고 · 승인된 것만")}</ThemedText>
      <View style={styles.actions}>{eligible.map(value => <CafeAction key={value.id} label={value.title} onPress={() => { setDraftId(value.id); }} disabled={busy || !!pending && pending.draftId !== value.id} />)}</View>
      {!eligible.length && <ThemedText type="small" themeColor="textSecondary">{tr("승인된 원고가 없어요. 홍보글에서 초안을 승인해 주세요.")}</ThemedText>}
      {draft && <View style={styles.review}>
        <ThemedText type="smallBold">{draft.title}</ThemedText><ThemedText>{draft.body}</ThemedText>
        {draft.original_url && <ThemedText type="small">{draft.original_url}</ThemedText>}
        <ThemedText type="small" themeColor="textSecondary">{tr("사진 {0}장 · 아래 순서로 첨부해요.", imagePaths.length)}</ThemedText>
        {urls.map((uri, index) => <View key={uri}><ThemedText type="small">{index === 0 ? tr("{0} · 첫 사진", 1) : String(index + 1)}</ThemedText>
          <Image source={{ uri }} contentFit="contain" style={styles.photo} accessibilityLabel={tr("네이버에 첨부할 사진 {0}", (index + 1))} onError={() => setPhotoFailure(photoKey)} /></View>)}
        {photoFailed && <ThemedText type="small" themeColor="danger">{tr("사진을 확인하지 못해 발행을 멈췄어요. 원고 사진을 다시 확인해 주세요.")}</ThemedText>}
        <View style={styles.publishRow}><CafeAction primary label={unresolved ? tr("게시 결과 확인") : tr("카페에 발행")} disabled={busy || !unresolved && (photoFailed || urls.length !== imagePaths.length)} onPress={() => { void run(async () => {
          if (unresolved) { await refreshStatus(); setNotice(errors.NAVER_PUBLISH_UNCERTAIN); return; }
          const board = parseCafeBoardUrl(boardUrl);
          if (!await confirm('카페에 이 원고를 발행할까요?', `${draft.title}\n\n${board.url}\n사진 ${imagePaths.length}장 · 표시된 순서\n카페의 게시·홍보 규칙을 확인했어요.`)) return;
          play('selection');
          const input: PendingPublish = pending ?? { requestId: merchantEventId(), draftId: draft.id, expectedUpdatedAt: draft.updated_at, boardUrl: board.url, imagePaths, confirmed: true };
          if (input.draftId !== draft.id || input.expectedUpdatedAt !== draft.updated_at || JSON.stringify(input.imagePaths) !== JSON.stringify(imagePaths)) throw new Error('MERCHANT_DRAFT_CHANGED');
          try { await AsyncStorage.setItem(storageKey, JSON.stringify(input)); } catch { throw new Error('NAVER_PENDING_STORAGE_REQUIRED'); }
          if (contextRef.current !== context) return;
          setPending(input);
          const result = await publishMerchantNaverCafe(supabase, merchantId, input);
          if (contextRef.current !== context) return;
          if (!['succeeded', 'failed'].includes(result.request.status)) {
            const restored: PendingPublish = { ...input, requestId: result.request.id,
              ...(result.request.article_url && safeArticleUrl(result.request.article_url) ? { observedArticleUrl: result.request.article_url } : {}) };
            setPending(restored);
            await AsyncStorage.setItem(storageKey, JSON.stringify(restored));
          }
          if (['succeeded', 'failed'].includes(result.request.status)) {
            await AsyncStorage.removeItem(storageKey); setPending(null);
            play(result.request.status === 'succeeded' ? 'success' : 'warning');
            setNotice(result.request.status === 'succeeded' ? "실제 네이버 게시글 링크를 확인하고 저장했어요." : { errorCode: result.request.error_code ?? '' });
            await onChanged?.();
          } else setNotice(errors.NAVER_PUBLISH_UNCERTAIN);
          setStatus(await loadMerchantNaverCafe(supabase, merchantId));
        }); }} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>{tr("하루 3회까지 한 건씩, 회원 공개로 게시해요.")}</ThemedText></View>
      </View>}
      {pending && !draft && <ThemedText type="small" themeColor="textSecondary">{tr("이전 원고의 결과를 아래에서 확인해 주세요. 현재 원고를 바꾸어 재전송하지 않아요.")}</ThemedText>}
    </>}
    {status?.requests.map(request => <View key={request.id} style={[styles.receipt, { borderColor: theme.line }]}>
      <View style={styles.titleRow}>{request.error_code === 'NAVER_PREPARATION_CANCELLED' ? <MerchantBadge label={tr("발행 준비 취소됨")} /> : <MerchantBadge label={labels[request.status]} tone={receiptTones[request.status]} />}
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>{request.board_url}</ThemedText></View>
      {request.article_url && <CafeAction label={tr("카페 게시글 열기")} disabled={busy} onPress={() => { void run(async () => {
        if (!safeArticleUrl(request.article_url!)) throw new Error('INVALID_NAVER_BOARD_URL');
        await Linking.openURL(request.article_url!);
      }); }} />}
      {['in_flight', 'uncertain'].includes(request.status) && <ThemedText type="small" themeColor="textSecondary">{tr("중복을 막기 위해 재발행하지 않아요. 실제 카페 글을 확인한 뒤 운영자에게 결과 확인을 요청해 주세요.")}</ThemedText>}
      {request.status === 'failed' && request.error_code !== 'NAVER_PREPARATION_CANCELLED' && <ThemedText type="small" themeColor="textSecondary">{tr("{0} · 카페 가입·게시 권한과 사진을 확인한 뒤 원고를 다시 저장·승인해 주세요.", request.error_code || tr("권한 확인"))}</ThemedText>}
    </View>)}
    <MerchantHelp items={[tr("카페 가입·등업과 게시판 쓰기 권한은 카페에서 직접 받아 주세요."), tr("발행 전에 저장된 원고와 사진을 표시된 순서대로 확인해요."),
      tr("네이버에서 저장 사진 형식이 지원되는지는 실제 연결 계정으로 확인이 필요해요. 사진이 거절되면 게시 완료로 표시하지 않아요.")]} />
  </View>;
}
const styles = StyleSheet.create({
  section: { padding: 20, gap: 14, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { minHeight: 44, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, justifyContent: 'center', paddingHorizontal: 14 },
  input: { minHeight: 44, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 }, review: { gap: 12 }, photo: { width: '100%', height: 240 },
  receipt: { gap: 8, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }, publishRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }, hint: { flexShrink: 1 },
});
