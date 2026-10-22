import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Image } from 'expo-image';
import { AppState, Platform, StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { GlingLoader } from '@/components/gling-loader';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { connectMerchantMcp, denyMerchantMcp, loadMerchantMcpAuthorization, loadMerchantMcpChangePhotos, loadMerchantMcpChanges, loadMerchantMcpConnections,
  revokeMerchantMcp, reviewMerchantMcpChange, type MerchantMcpAuthorization, type MerchantMcpChange, type MerchantMcpConnection, type MerchantMcpPhotoGroup } from '@/lib/merchant-mcp';
import { loadMyMerchants, type BusinessMerchant } from '@/lib/merchant-workspace';
import { supabase } from '@/lib/supabase';

const labels: Record<string, string> = { name: '비즈니스명', industry: '업종', services: '서비스 소개', address: '주소', avatar_path: '프로필 사진', banner_path: '커버 사진', title: '제목', body: '본문', image_paths: '게시글 사진' };
const valueText = (value: unknown) => value == null || value === '' ? '없음' : Array.isArray(value) ? value.length ? value.join('\n') : '없음' : String(value);
const dateText = (value: string) => new Date(value).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
function errorText(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  if (code.includes('ACCOUNT_CHANGED')) return '계정이 바뀌었어요. 현재 계정으로 다시 열어 주세요.';
  if (code.includes('MCP_CONNECT_CLEANUP_PENDING')) return '연결을 마치지 못했고 해제도 확인하지 못했어요. 연결을 시작한 계정의 AI 연결 목록에서 해제해 주세요.';
  if (code.includes('MCP_SCOPE_NOT_ALLOWED')) return '이 요청은 글링 업무 연결과 다른 권한을 요청했어요. AI 도구에서 글링 연결을 다시 시작해 주세요.';
  if (code.includes('MCP_AUTHORIZATION_EXPIRED')) return '연결 요청이 만료됐어요. AI 도구에서 글링 연결을 다시 시작해 주세요.';
  if (code.includes('MCP_BUSINESS_ACCOUNT_REQUIRED') || code.includes('MERCHANT_ACCOUNT_REQUIRED')) return '승인된 사업자 계정으로 연결해 주세요.';
  if (code.includes('MERCHANT_POST_CHANGED') || code.includes('MERCHANT_PROFILE_CHANGED')) return '원본이 바뀌었어요. AI에게 최신 원본으로 새 제안을 요청한 뒤 다시 검토해 주세요.';
  if (code.includes('MCP_CONNECTION_REQUIRED') || code.includes('MERCHANT_ACCESS_REQUIRED')) return '비즈니스 권한이나 AI 연결이 변경됐어요. 현재 연결과 비즈니스를 다시 확인해 주세요.';
  if (code.includes('MCP_CHANGE_EXPIRED')) return '이 제안은 만료됐어요. AI에게 새 제안을 요청해 주세요.';
  return '처리를 확인하지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.';
}
function Action({ label, onPress, disabled = false, primary = false, danger = false }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean; danger?: boolean }) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  return <Pressable analyticsId="merchant.ai.action" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} aria-disabled={disabled} disabled={disabled}
    onPress={() => { play('selection'); onPress(); }} style={({ pressed }) => [styles.button, { borderColor: theme.line, backgroundColor: primary ? theme.accent : 'transparent', opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}>
    <ThemedText type="smallBold" style={{ color: primary ? theme.accentInk : danger ? '#FFA5AF' : theme.text }}>{label}</ThemedText>
  </Pressable>;
}
function Choice({ title, detail, checked, onPress, disabled = false }: { title: string; detail: string; checked: boolean; onPress: () => void; disabled?: boolean }) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  // The installed web Pressable handles Space for buttons, but not checkbox roles.
  const keyboard = Platform.OS === 'web' ? { onKeyDown: (event: KeyboardEvent) => {
    if (event.key === ' ') { event.preventDefault(); if (!disabled && !event.repeat) { play('selection'); onPress(); } }
  } } : {};
  return <Pressable {...keyboard} analyticsId="merchant.ai.permission" accessibilityRole="checkbox" accessibilityLabel={`${title}. ${detail}`} accessibilityState={{ checked, disabled }} aria-checked={checked} aria-disabled={disabled} disabled={disabled}
    onPress={() => { play('selection'); onPress(); }} style={({ pressed }) => [styles.choice, { borderColor: checked ? theme.accent : theme.line, opacity: disabled || pressed ? 0.65 : 1 }]}>
    <View style={[styles.check, { borderColor: checked ? theme.accent : theme.line, backgroundColor: checked ? theme.accent : 'transparent' }]}>
      {checked && <ThemedText type="smallBold" style={{ color: theme.accentInk }}>✓</ThemedText>}
    </View><View style={styles.grow}><ThemedText type="smallBold">{title}</ThemedText><ThemedText type="small" themeColor="textSecondary">{detail}</ThemedText></View>
  </Pressable>;
}
function ChangeReview({ change, busy, expired, confirming, onApply, onReject }: { change: MerchantMcpChange; busy: boolean; expired: boolean; confirming: boolean; onApply: () => void; onReject: () => void }) {
  const theme = useTheme();
  const [photos, setPhotos] = useState<MerchantMcpPhotoGroup[] | null>(null), [loaded, setLoaded] = useState<string[]>([]);
  const [photoError, setPhotoError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    void loadMerchantMcpChangePhotos(supabase, change).then(groups => { if (current) setPhotos(groups); })
      .catch(() => { if (current) setPhotoError(true); });
    return () => { current = false; };
  }, [change, retry]);
  const photosReady = photos !== null && !photoError && photos.every(group => group.uris.every(uri => loaded.includes(uri)));
  return <View style={[styles.connection, { borderColor: theme.line }]}>
    <ThemedText type="smallBold">{change.kind === 'profile' ? '비즈니스 프로필 수정' : change.kind === 'edit_post' ? '게시글 수정' : '게시글 삭제'}</ThemedText>
    {change.kind === 'delete_post' ? <><ThemedText type="smallBold">{valueText(change.before_value.title)}</ThemedText><ThemedText themeColor="textSecondary">{valueText(change.before_value.body)}</ThemedText><ThemedText>적용하면 이 글의 공개 노출을 종료해요.</ThemedText></>
      : Object.entries(change.changes).filter(([key]) => !['avatar_path', 'banner_path', 'image_paths'].includes(key)).map(([key, value]) => <View key={key} style={styles.diff}><ThemedText type="smallBold">{labels[key] ?? key}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">현재 · {valueText(change.before_value[key])}</ThemedText><ThemedText>제안 · {valueText(value)}</ThemedText></View>)}
    <View style={styles.row}>{photos?.map(group => <View key={group.label} style={styles.photoGroup}>
      <ThemedText type="smallBold">{group.label}</ThemedText>
      {!group.uris.length && <ThemedText type="small" themeColor="textSecondary">사진 없음</ThemedText>}
      {group.uris.map((uri, index) => <View key={`${retry}:${index}:${uri}`} style={styles.diff}>
        <Image source={{ uri }} contentFit="contain" style={[styles.photo, { backgroundColor: theme.background }]} accessibilityLabel={`${group.label} ${index + 1}`}
          onLoad={() => setLoaded(previous => previous.includes(uri) ? previous : [...previous, uri])} onError={() => setPhotoError(true)} />
        {Platform.OS === 'web' && <Action label={`${group.label} ${index + 1} 크게 보기`} onPress={() => { window.open(uri, '_blank', 'noopener,noreferrer'); }} />}
      </View>)}
    </View>)}</View>
    {photoError ? <><ThemedText accessibilityRole="alert">사진을 확인하지 못했어요. 사진을 불러온 뒤 적용할 수 있어요.</ThemedText>
      <Action label="사진 다시 불러오기" disabled={busy} onPress={() => { setPhotos(null); setLoaded([]); setPhotoError(false); setRetry(value => value + 1); }} /></>
      : !photosReady && <ThemedText type="small" themeColor="textSecondary">검토할 사진을 불러오는 중이에요.</ThemedText>}
    {confirming && <ThemedText>위 내용을 확인했어요. 이 제안을 공개 내용에 적용할까요?</ThemedText>}
    <View style={styles.row}>
      <Action label={confirming ? '확인한 내용 적용' : '내용 확인 후 적용'} primary={change.kind !== 'delete_post'} danger={change.kind === 'delete_post'} disabled={busy || expired || !photosReady} onPress={onApply} />
      <Action label="제안 거절" disabled={busy} onPress={onReject} />
    </View>
  </View>;
}

export function MerchantMcpConnections({ userId, authorizationId }: { userId: string; authorizationId?: string }) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [merchants, setMerchants] = useState<BusinessMerchant[]>([]), [connections, setConnections] = useState<MerchantMcpConnection[]>([]);
  const [authorization, setAuthorization] = useState<MerchantMcpAuthorization | null>(null), [selected, setSelected] = useState<string[]>([]);
  const [drafts, setDrafts] = useState(false), [publish, setPublish] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [revision, setRevision] = useState(0);
  const [reviewMerchant, setReviewMerchant] = useState<string | null>(null), [changeResponse, setChangeResponse] = useState<{ merchantId: string; revision: number; items: MerchantMcpChange[] } | null>(null);
  const [checkedAt, setCheckedAt] = useState(Date.now);
  const [revokeId, setRevokeId] = useState<string | null>(null), [applyId, setApplyId] = useState<string | null>(null);
  const active = useRef(true), working = useRef(false);
  const endpoint = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/merchant-mcp`;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    void Promise.allSettled([loadMyMerchants(supabase), loadMerchantMcpConnections(supabase), authorizationId ? loadMerchantMcpAuthorization(supabase, authorizationId) : Promise.resolve(null)])
      .then(([businessResponse, linkResponse, requestResponse]) => {
        if (!current) return;
        const businesses = businessResponse.status === 'fulfilled' ? businessResponse.value : [];
        const links = linkResponse.status === 'fulfilled' ? linkResponse.value : [];
        const request = requestResponse.status === 'fulfilled' ? requestResponse.value : null;
        const owned = businesses.filter(m => m.owner_id === userId && !!m.owner_verified_at);
        setMerchants(owned); setConnections(links); setAuthorization(request); setCheckedAt(Date.now());
        const failure = [businessResponse, linkResponse, requestResponse].find(response => response.status === 'rejected');
        setError(failure?.status === 'rejected' ? errorText(failure.reason) : '');
        setSelected(ids => ids.filter(id => owned.some(m => m.id === id)));
        setReviewMerchant(id => owned.some(m => m.id === id) ? id : owned[0]?.id ?? null);
      }).catch(failure => { if (current) { setError(errorText(failure)); setAuthorization(null); setMerchants([]); setConnections([]); setChangeResponse(null); } })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [userId, authorizationId, revision]);
  useEffect(() => {
    const refresh = () => { if (!working.current) { setLoading(true); setApplyId(null); setRevision(value => value + 1); } };
    const app = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    if (Platform.OS === 'web') { window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', visible); }
    return () => { app.remove(); if (Platform.OS === 'web') { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible); } };
  }, []);
  useEffect(() => {
    let current = true;
    if (reviewMerchant) {
      void loadMerchantMcpChanges(supabase, reviewMerchant).then(next => { if (current) setChangeResponse({ merchantId: reviewMerchant, revision, items: next }); })
        .catch(failure => { if (current) { setChangeResponse({ merchantId: reviewMerchant, revision, items: [] }); setError(errorText(failure)); } });
    }
    return () => { current = false; };
  }, [reviewMerchant, userId, revision]);
  async function run(operation: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (failure) { if (active.current) { setError(errorText(failure)); play('warning'); } }
    finally { working.current = false; if (active.current) setBusy(false); }
  }
  const refresh = () => { setLoading(true); setApplyId(null); setRevision(value => value + 1); };
  const redirect = (url: string) => { if (active.current && Platform.OS === 'web') window.location.assign(url); };
  const connected = connections.filter(c => !c.revoked_at && Date.parse(c.expires_at) > checkedAt);
  const currentChanges = changeResponse?.merchantId === reviewMerchant && changeResponse?.revision === revision ? changeResponse : null;
  const changes = currentChanges?.items ?? [], changesLoading = !!reviewMerchant && !currentChanges;
  return <View style={styles.sections}>
    <View style={styles.hero}><View style={[styles.ai, { backgroundColor: theme.accent }]}><ThemedText type="subtitle" style={{ color: theme.accentInk }}>AI</ThemedText></View>
      <ThemedText type="title" accessibilityRole="header">평소 쓰는 AI로,{`\n`}내 가게 소식을 만들어요.</ThemedText>
      <ThemedText themeColor="textSecondary">Codex · Claude Code · ChatGPT · Claude에서 글과 프로필을 준비하고, 글링에서 검토해요.</ThemedText>
    </View>
    {error && <View style={[styles.card, { borderColor: theme.line }]}><ThemedText accessibilityRole="alert">{error}</ThemedText><Action label="다시 확인" onPress={refresh} disabled={busy} /></View>}
    {notice && <ThemedText accessibilityLiveRegion="polite" aria-live="polite" themeColor="accent">{notice}</ThemedText>}
    {loading ? <GlingLoader accessibilityLabel="AI 연결과 비즈니스 권한을 확인하는 중" /> : <>
      {authorization && <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <ThemedText type="subtitle" accessibilityRole="header">{authorization.client_name} 연결하기</ThemedText>
        <ThemedText themeColor="textSecondary">이 도구에 허용할 비즈니스와 작업을 골라 주세요. 연결은 30일 동안 유지돼요.</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" selectable>돌아갈 주소 · {authorization.redirect_uri}{`\n`}연결하려는 AI 도구의 주소인지 확인해 주세요.</ThemedText>
        <ThemedText type="smallBold">연결할 내 비즈니스</ThemedText>
        {merchants.map(m => <Choice key={m.id} title={m.name} detail={m.city_name || m.city_id} checked={selected.includes(m.id)} disabled={busy}
          onPress={() => setSelected(ids => ids.includes(m.id) ? ids.filter(id => id !== m.id) : [...ids, m.id])} />)}
        {!merchants.length && <ThemedText>소유권이 확인된 비즈니스가 필요해요. 비즈니스 연결을 먼저 완료해 주세요.</ThemedText>}
        <ThemedText type="smallBold">허용할 작업</ThemedText>
        <View style={[styles.included, { borderColor: theme.line }]}><ThemedText type="smallBold">✓ 선택한 비즈니스의 글·초안·공개 프로필 읽기</ThemedText><ThemedText type="small" themeColor="textSecondary">연결하면 기본으로 허용돼요.</ThemedText></View>
        <Choice title="초안 저장과 변경 제안" detail="새 원고를 저장하고 프로필·게시글 수정이나 삭제를 제안해요. 공개 변경은 웹에서 직접 검토해요." checked={drafts} disabled={busy} onPress={() => setDrafts(value => !value)} />
        <Choice title="내가 승인한 원고 게시" detail="글링 웹에서 검토·승인한 최신 원고만 게시해요. AI가 원고를 승인할 수는 없어요." checked={publish} disabled={busy} onPress={() => setPublish(value => !value)} />
        <ThemedText type="small" themeColor="textSecondary">일반 회원 기능과 개인 대화는 이 연결에 포함되지 않아요. 연결 후에도 비즈니스 권한을 매번 확인하며, 언제든 해제할 수 있어요.</ThemedText>
        <View style={styles.row}><Action label={busy ? '처리 중…' : '선택한 권한으로 연결'} primary disabled={busy || !selected.length} onPress={() => { void run(async () => redirect(await connectMerchantMcp(supabase, userId, authorization, { merchantIds: selected, allowDrafts: drafts, allowPublish: publish }))); }} />
          <Action label="취소" disabled={busy} onPress={() => { void run(async () => redirect(await denyMerchantMcp(supabase, userId, authorization))); }} /></View>
      </View>}
      {!authorizationId && <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <ThemedText type="subtitle" accessibilityRole="header">AI 도구에서 글링 연결을 추가해요.</ThemedText>
        <ThemedText themeColor="textSecondary">연결 주소를 복사해 AI 도구의 MCP 또는 커넥터 설정에 붙여 넣으세요. 로그인하면 이 화면에서 비즈니스와 권한을 고를 수 있어요.</ThemedText>
        <ThemedText type="small" selectable>{endpoint}</ThemedText>
        <Action label="연결 주소 복사" disabled={busy} onPress={() => { void run(async () => { if (!navigator.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE'); await navigator.clipboard.writeText(endpoint); if (active.current) { setNotice('연결 주소를 복사했어요.'); play('success'); } }); }} />
      </View>}
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <ThemedText type="subtitle" accessibilityRole="header">연결된 AI 도구</ThemedText>
        {!connected.length && <ThemedText themeColor="textSecondary">아직 연결된 도구가 없어요.</ThemedText>}
        {connected.map(c => <View key={c.id} style={[styles.connection, { borderColor: theme.line }]}>
          <ThemedText type="smallBold">{c.client_name} · {c.is_connected ? '연결됨' : 'AI 도구에서 완료 필요'}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{c.businesses.map(m => m.name).join(' · ') || '현재 연결된 비즈니스 없음'}{`\n`}읽기{c.allow_drafts ? ' · 초안과 제안' : ''}{c.allow_publish ? ' · 승인한 원고 게시' : ''}{`\n`}{dateText(c.expires_at)}까지</ThemedText>
          {revokeId === c.id ? <><ThemedText>해제하면 이 도구에서 글링에 접근할 수 없어요.</ThemedText><View style={styles.row}>
            <Action label="연결 해제하기" danger disabled={busy} onPress={() => { void run(async () => { await revokeMerchantMcp(supabase, userId, c.id); if (active.current) { setRevokeId(null); setNotice('AI 연결을 해제했어요.'); refresh(); play('success'); } }); }} />
            <Action label="계속 연결" disabled={busy} onPress={() => setRevokeId(null)} /></View></>
            : <Action label="연결 해제" disabled={busy} onPress={() => setRevokeId(c.id)} />}
        </View>)}
      </View>
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <ThemedText type="subtitle" accessibilityRole="header">공개 변경 제안 검토</ThemedText>
        <ThemedText themeColor="textSecondary">AI가 제안한 프로필·게시글 수정과 삭제를 여기서 확인해요. 새 원고 승인은 비즈니스 관리의 초안에서 진행해요.</ThemedText>
        <View style={styles.row}>{merchants.map(m => <Action key={m.id} label={m.name} primary={reviewMerchant === m.id} disabled={busy} onPress={() => { setApplyId(null); setReviewMerchant(m.id); }} />)}</View>
        {changesLoading ? <GlingLoader accessibilityLabel="변경 제안을 불러오는 중" /> : !changes.some(c => c.status === 'pending') && <ThemedText themeColor="textSecondary">검토할 제안이 없어요.</ThemedText>}
        {changes.filter(c => c.status === 'pending').map(change => <ChangeReview key={`${revision}:${change.id}`} change={change} busy={busy} expired={Date.parse(change.expires_at) <= checkedAt} confirming={applyId === change.id}
          onApply={() => { if (applyId !== change.id) { setApplyId(change.id); return; } void run(async () => { const result = await reviewMerchantMcpChange(supabase, userId, change.id, true); if (active.current) { setNotice(result.status === 'applied' ? '검토한 내용을 적용했어요.' : '이 제안은 이미 검토됐어요.'); refresh(); play('success'); } }); }}
          onReject={() => { void run(async () => { await reviewMerchantMcpChange(supabase, userId, change.id, false); if (active.current) { setNotice('제안을 거절했어요.'); refresh(); play('success'); } }); }} />)}
      </View>
    </>}
  </View>;
}
const styles = StyleSheet.create({
  sections: { gap: 24 }, hero: { gap: 12, paddingVertical: 12 }, ai: { width: 52, height: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  card: { gap: 16, padding: 24, borderRadius: 20, borderWidth: 1 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  button: { minHeight: 44, minWidth: 44, borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  choice: { minHeight: 64, borderWidth: 1, borderRadius: 14, padding: 16, flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  check: { width: 22, height: 22, borderWidth: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' }, grow: { flex: 1, gap: 4 },
  included: { gap: 4, paddingBottom: 16, borderBottomWidth: 1 }, connection: { gap: 12, paddingTop: 20, borderTopWidth: 1 }, diff: { gap: 6 },
  photoGroup: { flexGrow: 1, flexBasis: 0, minWidth: 180, gap: 8 }, photo: { width: '100%', height: 180, borderRadius: 12 },
});
