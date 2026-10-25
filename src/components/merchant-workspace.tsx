import { useLanguage } from '@/hooks/use-language';
import { tr } from '@/i18n';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Platform, Share, StyleSheet, TextInput, View, type KeyDownEvent } from 'react-native';

import { Pressable, Switch } from '@/components/analytics-controls';
import { GlingLoader } from '@/components/gling-loader';
import { MerchantAccountInvitations, MerchantAccountManagement } from '@/components/merchant-account-connections';
import { MerchantAccessGate } from '@/components/merchant-access-gate';
import { MerchantNaverCafe } from '@/components/merchant-naver-cafe';
import { MerchantWebPosts } from '@/components/merchant-web-posts';
import { MerchantHome, MerchantSidebar, merchantShellStyles, useMerchantSidebar, type MerchantNavItem, type MerchantRecentItem } from '@/components/merchant-web-shell';
import { PostPhotoEditor, type EditablePostImage } from '@/components/post-photo-editor';
import { PostBodyEditor } from '@/components/post-body-editor';
import { MerchantReviewInbox } from '@/components/merchant-review-inbox';
import { MerchantProfileEditor } from '@/components/merchant-profile-editor';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useRouter } from 'expo-router';
import { selectChatBusiness } from '@/lib/chat-identity';
import { loadMyMerchantConnections } from '@/lib/merchant-connections';
import { useAuth } from '@/lib/auth';
import { parseAiDraftResponse } from '@/lib/ai-draft';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import type { BusinessMembershipSnapshot } from '@/lib/membership';
import { MAX_POST_IMAGES } from '@/lib/image-upload';
import { saveMerchantDraftImages } from '@/lib/merchant-posts';
import { CITIES, TAGS } from '@/lib/mock';
import { merchantEventId } from '@/lib/merchant-source';
import {
  MERCHANT_CHANNELS, adjustMerchantInventory, approveMerchantDrafts, archiveMerchantDrafts,
  calculateMerchantCost, getMyBusinessWorkspaceAccess, loadMerchantWorkspace, loadMyMerchants, merchantDraftCopy, merchantReportText,
  publishMerchantDraft, recordMerchantExternalPost, registerMyMerchant, saveMerchantItem,
  type BusinessMerchant, type MerchantChannel, type MerchantDraft, type MerchantWorkspace as Workspace,
} from '@/lib/merchant-workspace';
import { isSupportedImage, preparePostImage, type PreparedImage } from '@/lib/post-image-picker';
import { supabase } from '@/lib/supabase';

const errorText = (error: unknown) => ({
  MERCHANT_ACCESS_REQUIRED: '이 비즈니스를 관리할 권한이 없어요.', ADMIN_REQUIRED: '관리자 2단계 인증을 다시 확인해 주세요.',
  MERCHANT_ACCOUNT_REQUIRED: '현재 계정의 비즈니스 관리 권한을 다시 확인해 주세요.',
  MERCHANT_OWNER_VERIFICATION_REQUIRED: '비즈니스 소유 확인이 완료되면 글링에 게시할 수 있어요.',
  MERCHANT_OPERATIONS_PAUSED: '운영이 중단된 비즈니스는 새 안내글을 게시할 수 없어요.',
  MERCHANT_PLAN_REQUIRED: '여러 건을 한 번에 승인하거나 입출고하려면 비즈니스 체험·유료 운영 기간이 필요해요. 한 건씩은 계속 이용할 수 있어요.',
  MERCHANT_STOCK_NEGATIVE: '출고할 수량이 현재 재고보다 많아요.', MERCHANT_REQUEST_CONFLICT: '이전 입출고 요청과 내용이 달라요. 기록을 새로 확인한 뒤 다시 입력해 주세요.',
  MERCHANT_STOCK_STORAGE_REQUIRED: '이전 입출고 요청을 안전하게 저장·확인하지 못했어요. 저장 공간을 확인한 뒤 같은 요청을 다시 확인해 주세요.',
  MERCHANT_STOCK_PENDING_RESTORED: '결과를 확인하지 못한 이전 입출고 요청을 복구했어요. 아래에서 같은 요청을 다시 확인해 주세요.',
  MERCHANT_DRAFT_APPROVAL_REQUIRED: '저장된 최신 초안을 먼저 승인해 주세요.', MERCHANT_DRAFT_PUBLISHED: '이미 게시한 원고예요. 새 초안으로 복제해 주세요.',
  MERCHANT_DRAFT_CHANGED: '최신 저장본이 바뀌었어요. 입력은 그대로 두었으니 목록에서 해당 원고를 다시 열어 확인해 주세요.',
  INVALID_MERCHANT_CAFE_URL: '직접 올린 다음·네이버 카페 게시글의 HTTPS 주소를 넣어주세요.',
  INVALID_ORIGINAL_URL: '원문 주소는 공개된 HTTPS 링크여야 해요.', ACCOUNT_CHANGED: '계정이 바뀌었어요. 현재 계정으로 다시 열어주세요.',
  INVALID_COST_INPUT: '금액은 0 이상, 수량은 0 초과, 수수료율은 100 미만으로 입력해 주세요.',
  CONTENT_REJECTED: '게시 기준에 맞지 않는 내용이에요. 초안을 확인해 주세요.', RATE_LIMITED: '요청이 많아요. 잠시 후 다시 시도해 주세요.',
  IMAGE_TOO_LARGE: '사진 용량이 커요. 다른 사진으로 다시 시도해 주세요.', INVALID_IMAGE_PATH: '현재 계정의 원고 사진을 다시 확인해 주세요.',
  MERCHANT_PHOTOS_UNAVAILABLE: '사진을 모두 불러오지 못했어요. 원고를 다시 열어주세요.', INVALID_IMAGE_COUNT: `사진은 최대 ${MAX_POST_IMAGES}장까지 추가할 수 있어요.`,
  IMAGE_UNSUPPORTED: 'JPEG, PNG, WebP 사진을 선택해 주세요.',
  DRAFT_FAILED: '초안을 만들지 못했어요. 입력은 그대로 두었으니 잠시 후 다시 시도해 주세요.',
  INVALID_AI_DRAFT: 'AI 응답을 읽지 못했어요. 작성한 내용은 그대로예요.',
  DAILY_LIMIT_REACHED: '오늘의 AI 초안 5회를 모두 사용했어요. 직접 작성은 계속할 수 있어요.',
  AI_CONSENT_REQUIRED: 'AI 데이터 처리 동의를 확인한 뒤 다시 이용해 주세요.',
  INVALID_INPUT: '이번에 알릴 내용과 글의 목적을 확인해 주세요.',
} as Record<string, string>)[error instanceof Error ? error.message : '']
  ?? '처리하지 못했어요. 입력은 그대로 두었으니 연결 상태를 확인한 뒤 다시 시도해 주세요.';
const amount = (value: string) => value.trim() ? Number(value.replace(',', '.')) : NaN;
const money = (value: number) => `CAD ${Number(value).toFixed(2)}`;
type DraftInput = Pick<MerchantDraft, 'id' | 'channel' | 'title' | 'body' | 'tag_slug' | 'kind' | 'image_paths'> & { original_url: string };
type MerchantTab = 'overview' | 'drafts' | 'posts' | 'profile' | 'reviews' | 'channels' | 'cost' | 'stock' | 'membership' | 'accounts';
const accessLost = (error: unknown) => error instanceof Error && ['MERCHANT_ACCESS_REQUIRED', 'MERCHANT_ACCOUNT_REQUIRED', 'AUTH_REQUIRED', 'ACCOUNT_LOCKED', 'ACCOUNT_CHANGED', 'ADMIN_REQUIRED'].includes(error.message);
const emptyDraft = (): DraftInput => ({ id: merchantEventId(), channel: 'gling', title: '', body: '', original_url: '', tag_slug: 'life', kind: 'story', image_paths: [] });
const draftPurposes = ['가게 소식', '메뉴·서비스 소개', '구인구직'] as const;
const sameDraftContent = (a: DraftInput | MerchantDraft, b: DraftInput | MerchantDraft) => a.id === b.id && a.channel === b.channel
  && a.title === b.title && a.body === b.body && (a.original_url ?? '') === (b.original_url ?? '') && a.tag_slug === b.tag_slug && a.kind === b.kind
  && JSON.stringify(a.image_paths ?? []) === JSON.stringify(b.image_paths ?? []);
type StockRequest = { id: string; changes: { item_id: string; delta: number; note: string }[] };
// A remounted tool waits for the previous operation before reading its persisted request.
const stockOperations = new Map<string, Promise<void>>();
async function readStockRequest(key: string): Promise<StockRequest | null> {
  try {
    const stored = await AsyncStorage.getItem(key);
    if (stored === null) return null;
    const value = JSON.parse(stored);
    if (!value || typeof value.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)
      || !Array.isArray(value.changes) || !value.changes.length || value.changes.length > 50
      || value.changes.some((c: StockRequest['changes'][number]) => !c || typeof c.item_id !== 'string' || !c.item_id || c.item_id.length > 100
        || !Number.isFinite(c.delta) || c.delta === 0 || Math.abs(c.delta) > 99999999999 || Math.round(c.delta * 1000) / 1000 !== c.delta
        || typeof c.note !== 'string' || !c.note.trim() || c.note.length > 300)
      || new Set(value.changes.map((c: StockRequest['changes'][number]) => c.item_id)).size !== value.changes.length) throw new Error('INVALID_STORED_STOCK_REQUEST');
    return { id: value.id, changes: value.changes.map((c: StockRequest['changes'][number]) => ({ item_id: c.item_id, delta: c.delta, note: c.note })) };
  } catch { throw new Error('MERCHANT_STOCK_STORAGE_REQUIRED'); }
}

async function confirmAction(title: string, message: string) {
  if (Platform.OS === 'web') return window.confirm(`${title}\n\n${message}`);
  return new Promise<boolean>((resolve) => Alert.alert(title, message, [
    { text: tr("취소"), style: 'cancel', onPress: () => resolve(false) },
    { text: tr("계속"), onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}
async function shareText(text: string) {
  if (Platform.OS === 'web' && navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
  else if (Platform.OS === 'web') window.prompt('내용을 복사하세요', text);
  else await Share.share({ message: text });
}

function Action({ label, onPress, disabled, selected, primary = false, role = 'button' }: { label: string; onPress: () => void; disabled?: boolean; selected?: boolean; primary?: boolean; role?: 'button' | 'tab' }) {

  const theme = useTheme(); const { play } = useInteractionFeedback();
  const press = () => { play('selection'); onPress(); };
  if (primary) return <RaisedActionButton analyticsId="merchant.primary" label={label} onPress={press} disabled={disabled} />;
  return <Pressable lens analyticsId="merchant.action" accessibilityRole={role} accessibilityLabel={label} accessibilityState={{ disabled: !!disabled, selected: !!selected }} aria-selected={role === 'tab' ? !!selected : undefined} disabled={disabled} onPress={press}
    style={[styles.action, { borderColor: selected ? theme.accent : theme.line, backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement, opacity: disabled ? 0.5 : 1 }]}>
    <ThemedText type="smallBold">{label}</ThemedText>
  </Pressable>;
}
function Field({ label, value, onChange, placeholder, numeric = false, signed = false, multiline = false, maxLength = 120, disabled = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; numeric?: boolean; signed?: boolean; multiline?: boolean; maxLength?: number; disabled?: boolean }) {
  const theme = useTheme();
  return <View style={styles.field}><ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={placeholder} editable={!disabled} maxLength={maxLength}
      keyboardType={signed ? Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default' : numeric ? 'decimal-pad' : 'default'} multiline={multiline} placeholderTextColor={theme.textSecondary}
      style={[styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.backgroundElement }, multiline && styles.multiline]} />
  </View>;
}
function Section({ title, children }: { title: string; children: ReactNode }) {

  const theme = useTheme();
  return <View style={[styles.section, { backgroundColor: theme.card, borderColor: theme.line }]}><ThemedText type="subtitle">{title}</ThemedText>{children}</View>;
}
function ToolRow({ title, detail, onPress, disabled }: { title: string; detail: string; onPress: () => void; disabled?: boolean }) {
  const theme = useTheme(); const { play } = useInteractionFeedback();
  return <Pressable analyticsId="merchant.action" accessibilityRole="button" accessibilityLabel={title} accessibilityHint={detail} accessibilityState={{ disabled: !!disabled }} disabled={disabled}
    onPress={() => { play('selection'); onPress(); }} style={[styles.toolRow, { borderColor: theme.line }]}>
    <View style={styles.toolText}><ThemedText type="smallBold">{title}</ThemedText><ThemedText type="small" themeColor="textSecondary">{detail}</ThemedText></View>
    <ThemedText themeColor="textSecondary" accessible={false}>›</ThemedText>
  </Pressable>;
}

type WorkspaceProps = { merchantId?: string; refreshSignal?: number; initialMerchantId?: string; initialTab?: MerchantTab; assignedOnly?: boolean; onBusinessesChanged?: () => void; layout?: 'sidebar' };
export function MerchantWorkspace(props: WorkspaceProps) {

  const [connectionRevision, setConnectionRevision] = useState(0);
  const refreshSignal = (props.refreshSignal ?? 0) + connectionRevision;
  return <>{!props.merchantId && <MerchantAccountInvitations refreshSignal={refreshSignal} onChanged={() => { setConnectionRevision(v => v + 1); props.onBusinessesChanged?.(); }} />}
    <MerchantAccessGate businessOnly={props.assignedOnly} refreshSignal={refreshSignal}><MerchantWorkspaceContent {...props} refreshSignal={refreshSignal} /></MerchantAccessGate></>;
}
function MerchantWorkspaceContent({ merchantId, refreshSignal = 0, initialMerchantId, initialTab, assignedOnly = false, onBusinessesChanged, layout }: WorkspaceProps) {
  const { tr } = useLanguage();
  const { me, isAuthed, isAdmin } = useAuth();
  const [response, setResponse] = useState<{ user: string; rows: BusinessMerchant[]; revision: number; refreshSignal: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(merchantId ?? initialMerchantId ?? null);
  const [choosing, setChoosing] = useState(false);
  const [registering, setRegistering] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0), [dirty, setDirty] = useState(false);
  const [registration, setRegistration] = useState(() => ({ id: merchantEventId(), name: '', contact: '', city_id: 'vancouver' }));
  const busyRef = useRef(false);
  const rows = response?.user === me.id ? response.rows : null;
  const checking = !rows || response?.revision !== revision || response?.refreshSignal !== refreshSignal;
  useEffect(() => {
    let active = true;
    if (!isAuthed || merchantId) return;
    const businesses = assignedOnly ? getMyBusinessWorkspaceAccess(supabase, me.id).then(access => access.merchants) : loadMyMerchants(supabase);
    void businesses.then((next) => { if (active) {
      if (assignedOnly) next = next.filter(row => row.role === 'owner' || row.role === 'operator');
      setResponse({ user: me.id, rows: next, revision, refreshSignal }); setError('');
      setSelected(current => next.some(m => m.id === current) ? current : next.length === 1 ? next[0].id : null);
    } })
      .catch((e) => { if (active) { if (accessLost(e)) { setResponse(null); setSelected(null); setDirty(false); setRegistering(false); setRegistration({ id: merchantEventId(), name: '', contact: '', city_id: 'vancouver' }); } setError(errorText(e)); } });
    return () => { active = false; };
  }, [isAuthed, me.id, merchantId, revision, refreshSignal, assignedOnly]);
  if (!isAuthed) return <ThemedText>{tr("로그인한 뒤 비즈니스 도구를 이용해 주세요.")}</ThemedText>;
  if (merchantId) return <MerchantTools businessOnly={assignedOnly} layout={layout} key={`${me.id}:${merchantId}`} id={merchantId} initialTab={initialTab} refreshSignal={refreshSignal} onDirty={() => {}} />;
  async function choose(id: string | null) {
    if (busyRef.current) return;
    if (id !== selected && dirty && !await confirmAction('저장하지 않은 초안', '다른 비즈니스를 열면 저장하지 않은 수정 내용이 사라져요.')) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      if (id && (!isAdmin || assignedOnly)) {
        const connections = await loadMyMerchantConnections(supabase, me.id);
        const current = connections.merchants.find(item => item.id === id && item.role !== 'admin');
        const session = await supabase.auth.getSession();
        if (session.data.session?.user.id !== me.id) throw new Error('ACCOUNT_CHANGED');
        if (!current) throw new Error('MERCHANT_ACCESS_REQUIRED');
        selectChatBusiness(me.id, current);
      }
      if (id === selected && id !== null) { setChoosing(false); return; }
      setDirty(false); setSelected(id); setRegistering(id === null); setChoosing(false);
    } catch (failure) { setError(errorText(failure)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function register() {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError('');
    try {
      const session = await supabase.auth.getSession();
      if (session.data.session?.user.id !== me.id) throw new Error('ACCOUNT_CHANGED');
      const id = await registerMyMerchant(supabase, registration);
      setRegistration({ id: merchantEventId(), name: '', contact: '', city_id: 'vancouver' });
      setSelected(id); setRegistering(false); setRevision((v) => v + 1);
      onBusinessesChanged?.();
    } catch (e) { setError(errorText(e)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <View style={layout === 'sidebar' ? merchantShellStyles.content : styles.workspace}>
    {error && <ThemedText accessibilityRole="alert">{tr(error)}</ThemedText>}
    {!checking && !registering && (choosing || !selected) && <Section title={tr("관리할 비즈니스")}>
      {rows?.map((m) => <ToolRow key={m.id} title={m.name} detail={tr(m.city_name)} disabled={busy} onPress={() => { void choose(m.id); }} />)}
      {rows?.length === 0 && <ThemedText>{tr("아직 등록한 비즈니스가 없어요. 비즈니스 등록으로 시작해 주세요.")}</ThemedText>}
      <View style={styles.actions}><Action label={tr("비즈니스 등록")} disabled={busy} onPress={() => { void choose(null); }} />{selected && <Action label={tr("선택 닫기")} onPress={() => setChoosing(false)} />}</View>
    </Section>}
    {checking && !error && <GlingLoader accessibilityLabel={tr("내 비즈니스를 불러오는 중")} />}
    {checking && error && <Action label={tr("다시 불러오기")} onPress={() => { setError(''); setRevision((v) => v + 1); }} />}
    {registering && <Section title={tr("내 비즈니스 등록")}>
      <Field label={tr("비즈니스 이름")} value={registration.name} disabled={busy} onChange={(name) => setRegistration({ ...registration, name })} />
      <Field label={tr("담당자 · 연락처")} value={registration.contact} maxLength={1000} disabled={busy} onChange={(contact) => setRegistration({ ...registration, contact })} />
      <ThemedText type="small">{tr("운영 도시")}</ThemedText><View style={styles.actions}>{CITIES.filter((c) => c.state === 'open').map((c) => <Action key={c.id} label={c.name} selected={registration.city_id === c.id} disabled={busy} onPress={() => setRegistration({ ...registration, city_id: c.id })} />)}</View>
      <ThemedText type="small" themeColor="textSecondary">{tr("기본 도구는 무료예요. 등록일부터 14일 동안 일괄 승인·입출고도 체험할 수 있어요. 공개 게시 전에는 비즈니스 소유를 확인해요.")}</ThemedText>
      <Action primary label={tr(busy ? tr("등록 중…") : tr("비즈니스 등록하기"))} disabled={busy || !registration.name.trim()} onPress={() => { void register(); }} />
      <Action label={tr("비즈니스 등록 취소")} disabled={busy} onPress={() => { setRegistering(false); setChoosing(true); }} />
    </Section>}
    {!registering && selected && rows?.some(row => row.id === selected) && <View style={{ display: choosing ? 'none' : 'flex' }}>
      <MerchantTools businessOnly={assignedOnly} layout={layout} key={`${me.id}:${selected}`} id={selected} initialTab={initialTab} refreshSignal={refreshSignal + revision} accessChecking={checking} onChoose={() => setChoosing(true)} onDirty={setDirty} onConnectionsChanged={() => setRevision(v => v + 1)} />
    </View>}
  </View>;
}

function MerchantTools({ id, refreshSignal, onDirty, onConnectionsChanged, onChoose, accessChecking = false, businessOnly = false, initialTab = 'overview', layout }: { layout?: 'sidebar'; id: string; refreshSignal: number; onDirty: (dirty: boolean) => void; onConnectionsChanged?: () => void; onChoose?: () => void; accessChecking?: boolean; businessOnly?: boolean; initialTab?: MerchantTab }) {
  const { tr, locale: appLocale } = useLanguage();
  const theme = useTheme();
  const { me, isAdmin } = useAuth(); const { play } = useInteractionFeedback(), router = useRouter();
  const [revision, setRevision] = useState(0), [tab, setTab] = useState<MerchantTab>(initialTab);
  const [response, setResponse] = useState<{ user: string; revision: number; refreshSignal: number; data: Workspace } | null>(null);
  const [membershipState, setMembership] = useState<{ user: string; value: BusinessMembershipSnapshot } | null>(null);
  const businessMembership = membershipState?.user === me.id && membershipState.value.merchantId === id ? membershipState.value : null;
  const data = response?.user === me.id ? response.data : null;
  const checking = accessChecking || response?.refreshSignal !== refreshSignal || response?.revision !== revision;
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const busyRef = useRef(false), mounted = useRef(true);
  const [editor, setEditor] = useState(emptyDraft), [dirty, setDirty] = useState(false), [selection, setSelection] = useState<string[]>([]);
  const [profileDirty, setProfileDirty] = useState(false);
  const [replyDirty, setReplyDirty] = useState(false);
  const [draftStep, setDraftStep] = useState<'idea' | 'edit' | 'channels'>('idea');
  const [draftView, setDraftView] = useState<'list' | 'composer'>('list');
  const [facts, setFacts] = useState(''), [purpose, setPurpose] = useState<(typeof draftPurposes)[number]>('가게 소식');
  const [aiDraftReady, setAiDraftReady] = useState(false);
  const [draftOptions, setDraftOptions] = useState(false);
  const sidebar = layout === 'sidebar', wideNav = useMerchantSidebar();
  const [channels, setChannels] = useState({ gling: true, naver: false, daum: false });
  const [preparedChannels, setPreparedChannels] = useState<{ naver: boolean; daum: boolean } | null>(null);
  const [openedDraft, setOpenedDraft] = useState<MerchantDraft | null>(null);
  const [draftPhotos, setDraftPhotos] = useState<EditablePostImage[]>([]);
  const editorReload = useRef<DraftInput | null>(null);
  const [showArchived, setShowArchived] = useState(false), [externalUrl, setExternalUrl] = useState('');
  const [item, setItem] = useState<{ id: string; name: string; unit: string; unit_cost: string; low_stock: string }>(() => ({ id: merchantEventId(), name: '', unit: '개', unit_cost: '0', low_stock: '0' }));
  const [changes, setChanges] = useState<Record<string, string>>({}), [stockNote, setStockNote] = useState('');
  const stockRequest = useRef<StockRequest | null>(null);
  const stockKey = `gling.merchant.stock.${me.id}.${id}`;
  const [stockPending, setStockPending] = useState(false), [stockReady, setStockReady] = useState(false);
  const [stockRestoreError, setStockRestoreError] = useState(false), [stockRecoveryRevision, setStockRecoveryRevision] = useState(0);
  const [cost, setCost] = useState({ batchCost: '0', yield: '1', packaging: '0', other: '0', price: '0', feePercent: '0' });
  function clearPrivateState() {
    setResponse(null); setMembership(null); setEditor(emptyDraft()); setOpenedDraft(null); setDraftPhotos([]); editorReload.current = null;
    setSelection([]); setChanges({}); setStockNote(''); setItem({ id: merchantEventId(), name: '', unit: '개', unit_cost: '0', low_stock: '0' });
    setDirty(false); setProfileDirty(false); setReplyDirty(false); setFacts(''); setAiDraftReady(false); setPreparedChannels(null); setExternalUrl('');
    setDraftStep('idea'); setDraftView('list'); setDraftOptions(false); setShowArchived(false); setPurpose('가게 소식'); setChannels({ gling: true, naver: false, daum: false }); setTab('overview'); setNotice('');
    setCost({ batchCost: '0', yield: '1', packaging: '0', other: '0', price: '0', feePercent: '0' });
    stockRequest.current = null; setStockPending(false); setStockReady(false); setStockRestoreError(true);
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onDirty(dirty || profileDirty || replyDirty); }, [dirty, profileDirty, replyDirty, onDirty]);
  useEffect(() => {
    let active = true;
    void (async () => {
      const previousOperation = stockOperations.get(stockKey);
      await previousOperation;
      if (!active) return;
      if (previousOperation) setRevision((v) => v + 1);
      const request = await readStockRequest(stockKey);
      if (!active) return;
      stockRequest.current = request; setStockPending(!!request);
      if (request) { setChanges(Object.fromEntries(request.changes.map((c) => [c.item_id, String(c.delta)]))); setStockNote(request.changes[0].note); }
      setStockReady(true); setStockRestoreError(false);
    })().catch((e) => { if (active) { setStockRestoreError(true); setError(errorText(e)); } });
    return () => { active = false; };
  }, [stockKey, stockRecoveryRevision]);
  useEffect(() => {
    let active = true;
    void loadMerchantWorkspace(supabase, id).then((next) => {
      if (!active) return;
      const refreshedEditor = editorReload.current;
      const latest = refreshedEditor && next.drafts.find((d) => d.id === refreshedEditor.id);
      if (refreshedEditor && latest && sameDraftContent(latest, refreshedEditor)) setOpenedDraft((current) => !current || current.id === latest.id ? latest : current);
      editorReload.current = null;
      setResponse({ user: me.id, revision, refreshSignal, data: next }); setError('');
    })
      .catch((e) => { if (active) { if (accessLost(e)) clearPrivateState(); setError(errorText(e)); } });
    return () => { active = false; };
  }, [id, me.id, revision, refreshSignal]);
  useEffect(() => {
    if (tab !== 'membership') return;
    let active = true;
    void Promise.resolve(supabase.rpc('get_business_membership', { p_merchant_id: id })).then(({ data, error }) => {
      if (active && !error && data?.merchantId === id) setMembership({ user: me.id, value: data as BusinessMembershipSnapshot });
    }).catch(() => {});
    return () => { active = false; };
  }, [id, me.id, tab, revision, refreshSignal]);
  async function run(action: () => Promise<unknown>, success: string, reload = true) {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const session = await supabase.auth.getSession();
      if (!mounted.current || session.data.session?.user.id !== me.id) throw new Error('ACCOUNT_CHANGED');
      await action();
      if (mounted.current) { setNotice(success); play('selection'); if (reload) setRevision((v) => v + 1); }
    } catch (e) { if (mounted.current) { setError(errorText(e)); play('warning'); if (e instanceof Error && e.message === 'MERCHANT_DRAFT_CHANGED') setRevision((v) => v + 1); if (accessLost(e)) { clearPrivateState(); setRevision(v => v + 1); onConnectionsChanged?.(); } } }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  async function openBusinessInbox() {
    if (dirty || profileDirty || replyDirty) {
      if (!await confirmAction('작성 중인 내용', '대화함으로 이동하면 저장하지 않은 수정 내용이 사라질 수 있어요. 이동할까요?')) return;
    }
    await run(async () => {
      const connections = await loadMyMerchantConnections(supabase, me.id);
      if (!mounted.current) return;
      const current = connections.merchants.find(item => item.id === id && item.role !== 'admin');
      if (!current) throw new Error('MERCHANT_ACCESS_REQUIRED');
      selectChatBusiness(me.id, current);
      router.push({ pathname: '/chat', params: { view: 'direct' } });
    }, '', false);
  }
  function changeDraft(next: Partial<DraftInput>) { setEditor({ ...editor, ...next }); setDirty(true); setPreparedChannels(null); }
  // `fresh` comes from the business-web home right after a new empty draft opened, so this render's editor is stale.
  async function generateDraft(fresh?: { facts: string; purpose: (typeof draftPurposes)[number] }) {
    const merchant = data?.merchant, bodyHint = (fresh?.facts ?? facts).trim(), draftPurpose = fresh?.purpose ?? purpose;
    const base = fresh ? emptyDraft() : editor;
    if (!merchant || !bodyHint || busyRef.current) return;
    if (!fresh && (editor.title.trim() || editor.body.trim()) && !await confirmAction(tr('작성한 초안을 바꿀까요?'), tr('직접 수정한 내용이 새 AI 초안으로 바뀌어요.'))) { setDraftStep('edit'); return; }
    await run(async () => {
      const { data: result, error: failure } = await supabase.functions.invoke('draft-post', { body: {
        intent: 'merchant_promotion', merchantId: id, purpose: draftPurpose, cityName: merchant.city_name,
        selectedCategory: base.tag_slug === 'festival' ? 'life' : base.tag_slug, bodyHint,
      } });
      if (failure) {
        let code = 'DRAFT_FAILED';
        if (failure.context instanceof Response) { try { code = (await failure.context.json()).error?.code ?? code; } catch {} }
        throw new Error(code);
      }
      const draft = parseAiDraftResponse(result), session = await supabase.auth.getSession();
      if (!mounted.current || session.data.session?.user.id !== me.id) throw new Error('ACCOUNT_CHANGED');
      if (fresh) { setEditor(current => ({ ...current, title: draft.title, body: draft.body, kind: draftPurpose === '구인구직' ? 'listing' : current.kind })); setDirty(true); setPreparedChannels(null); }
      else changeDraft({ title: draft.title, body: draft.body, kind: draftPurpose === '구인구직' ? 'listing' : editor.kind });
      setAiDraftReady(true); setDraftStep('edit');
    }, '', false);
  }
  async function saveEditor(nextStep?: 'channels') {
    const draft = { ...editor, title: editor.title.trim(), body: editor.body.trim(), original_url: editor.original_url.trim() };
    await run(async () => {
      const paths = await saveMerchantDraftImages(supabase, id, me.id, { ...draft, original_url: draft.original_url || null }, draftPhotos);
      if (!mounted.current) return;
      const savedDraft = { ...draft, image_paths: paths };
      setDraftPhotos(draftPhotos.map((photo, index) => ({ path: paths[index], uri: photo.uri })));
      editorReload.current = savedDraft; setEditor(savedDraft); setDirty(false);
      if (nextStep) setDraftStep(nextStep);
    }, '초안을 저장했어요. 아직 게시되지 않았어요.');
  }
  async function confirmChannels() {
    if (!saved || !draftReady || busyRef.current || published || (!channels.gling && !channels.naver && !channels.daum)) return;
    const source = saved, chosen = { ...channels };
    const places = [chosen.gling && tr('글링 · {0}', tr(data!.merchant.city_name)), chosen.naver && tr('네이버 카페 · 원고 복사 후 직접 등록'), chosen.daum && tr('다음 카페 · 원고 복사 후 직접 등록')].filter(Boolean).join('\n');
    if (!await confirmAction(tr('게시 전 확인'), tr('「{0}」\n\n{1}\n\n위에서 확인한 저장 원고를 사용해요. 카페에는 자동으로 게시되지 않아요.', source.title, places)) || !mounted.current) return;
    setPreparedChannels({ naver: chosen.naver, daum: chosen.daum });
    if (!chosen.gling) { setNotice('원고를 준비했어요. 선택한 카페에서 직접 등록해 주세요.'); return; }
    await run(async () => {
      editorReload.current = editor;
      try {
        let reviewedAt = source.updated_at;
        if (!source.approved_at) {
          await approveMerchantDrafts(supabase, id, [source.id], true, { [source.id]: reviewedAt });
          const latest = (await loadMerchantWorkspace(supabase, id)).drafts.find((d) => d.id === source.id);
          if (!latest || !sameDraftContent(latest, source) || !latest.approved_at || latest.archived_at) throw new Error('MERCHANT_DRAFT_CHANGED');
          reviewedAt = latest.updated_at;
        }
        const session = await supabase.auth.getSession();
        if (!mounted.current || session.data.session?.user.id !== me.id) throw new Error('ACCOUNT_CHANGED');
        await publishMerchantDraft(supabase, id, source.id, reviewedAt);
      } catch (failure) { if (mounted.current) setRevision((v) => v + 1); throw failure; }
    }, chosen.naver || chosen.daum ? '글링에 게시했어요. 카페는 원고 복사 후 직접 등록해 주세요.' : '글링에 게시했어요.');
  }
  async function openDraft(draft?: MerchantDraft, direct = false) {
    if (busyRef.current) return false;
    let opened = false;
    busyRef.current = true; setBusy(true);
    try {
      if (dirty && !await confirmAction('저장하지 않은 초안', '다른 원고를 열면 저장하지 않은 수정 내용이 사라져요.')) return;
      const paths = draft?.image_paths ?? [];
      const nextPhotos: EditablePostImage[] = [];
      if (paths.length) {
        const result = await supabase.storage.from('post-images').createSignedUrls(paths, 60);
        for (const path of paths) {
          const uri = result.data?.find(row => row.path === path)?.signedUrl;
          if (result.error || !uri) throw new Error('MERCHANT_PHOTOS_UNAVAILABLE');
          nextPhotos.push({ path, uri });
        }
      }
      if (!mounted.current) return;
      setEditor(draft ? { ...draft, original_url: draft.original_url ?? '', image_paths: paths } : emptyDraft());
      setDraftPhotos(nextPhotos); setOpenedDraft(draft ?? null); editorReload.current = null;
      setDraftStep(draft || direct ? 'edit' : 'idea'); setFacts(''); setAiDraftReady(false); setDraftOptions(false);
      setChannels({ gling: true, naver: false, daum: false }); setPreparedChannels(null);
      setDirty(false); setExternalUrl(draft?.external_url ?? ''); setError('');
      setDraftView('composer'); setTab('drafts'); opened = true;
    } catch (error) { if (mounted.current) { play('warning'); setError(errorText(error)); } }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
    return opened;
  }
  function changeDraftPhotos(photos: EditablePostImage[]) {
    setDraftPhotos(photos); changeDraft({ image_paths: photos.flatMap(photo => 'path' in photo ? [photo.path] : []) });
  }
  async function pickDraftPhotos() {
    if (busyRef.current || draftPhotos.length >= MAX_POST_IMAGES) return;
    await run(async () => {
      const remaining = MAX_POST_IMAGES - draftPhotos.length;
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsMultipleSelection: true,
        orderedSelection: true, selectionLimit: remaining,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
      if (result.canceled) return;
      const assets = result.assets ?? [];
      if (!assets.length || assets.length > remaining) throw new Error('INVALID_IMAGE_COUNT');
      if (assets.some(asset => !asset.uri || !isSupportedImage(asset.mimeType ?? 'image/jpeg'))) throw new Error('IMAGE_UNSUPPORTED');
      const photos: PreparedImage[] = [];
      for (const asset of assets) photos.push(await preparePostImage(asset, { withThumb: true }));
      if (mounted.current) changeDraftPhotos([...draftPhotos, ...photos]);
    }, '사진을 준비했어요. 순서를 확인하고 초안을 저장해 주세요.', false);
  }
  function toggleDraft(draftId: string) {
    if (busy) return;
    play('selection'); setSelection((ids) => ids.includes(draftId) ? ids.filter((x) => x !== draftId) : ids.length < 50 ? [...ids, draftId] : ids);
  }
  if (!data) return <View style={styles.workspace}>{error ? <><ThemedText accessibilityRole="alert">{tr(error)}</ThemedText><Action label={tr("다시 불러오기")} onPress={() => { setError(''); setRevision((v) => v + 1); }} /></> : <GlingLoader accessibilityLabel={tr("비즈니스 도구를 불러오는 중")} />}</View>;
  const fullAccess = (data.can_manage_business ?? data.merchant.owner_id === me.id) && (!businessOnly || data.merchant.owner_id === me.id);
  const contentTab = ['overview','posts','profile','drafts'].includes(tab);
  const activeTab = fullAccess || contentTab ? tab : 'overview';
  const saved = data.drafts.find((d) => d.id === editor.id);
  const draftChanged = !!openedDraft && (!saved || openedDraft.updated_at !== saved.updated_at || !sameDraftContent(openedDraft, saved));
  const draftReady = !!saved && !dirty && !draftChanged && sameDraftContent(editor, saved);
  const published = !!(saved?.published_at || saved?.external_url);
  const canApprove = selection.length > 0 && (selection.length === 1 || data.merchant.plan !== 'basic');
  const picked = data.drafts.filter((d) => selection.includes(d.id));
  const aiOwner = fullAccess && data.merchant.owner_id === me.id && !!data.merchant.owner_verified_at;
  const navItems: MerchantNavItem[] = [
    { key: 'overview', label: tr('홈'), icon: { ios: 'house', android: 'home', web: 'home' } },
    { key: 'posts', label: tr('글·사진'), icon: { ios: 'doc.text', android: 'description', web: 'description' } },
    { key: 'drafts', label: tr('홍보글 관리'), icon: { ios: 'square.and.pencil', android: 'edit_note', web: 'edit_note' } },
    ...fullAccess ? [{ key: 'reviews', label: tr('이용 후기'), icon: { ios: 'star', android: 'star', web: 'star' } } as const] : [],
    { key: 'profile', label: tr('프로필'), icon: { ios: 'storefront', android: 'storefront', web: 'storefront' } },
    ...aiOwner ? [{ key: 'ai', label: tr('AI 연결'), icon: { ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' } } as const] : [],
    ...fullAccess ? ([
      ['channels', tr('카페 연결'), 'link', 'link'], ['cost', tr('원가 계산'), 'percent', 'calculate'], ['stock', tr('재고'), 'shippingbox', 'inventory_2'],
      ['membership', tr('성과·멤버십'), 'chart.bar', 'bar_chart'], ['accounts', tr('계정 관리'), 'person.2', 'group'],
    ] as const).map(([key, label, ios, web]) => ({ key, label, icon: { ios, android: web, web }, group: 'tools' as const })) : [],
  ];
  function selectNav(key: string) {
    if (key === 'ai') { router.push('/ai'); return; }
    setNotice(''); if (key === 'drafts') setDraftView('list'); setTab(key as MerchantTab);
  }
  async function startHomeDraft(generate: boolean) {
    const notes = facts, kind = purpose;
    if (!await openDraft(undefined, !generate) || !generate || !mounted.current) return;
    setFacts(notes); setPurpose(kind);
    await generateDraft({ facts: notes, purpose: kind });
  }
  const recent: MerchantRecentItem[] = [
    ...data.drafts.filter(d => !d.archived_at && !d.published_at && !d.external_url).map(d => ({ at: d.updated_at, item: { key: `d:${d.id}`, title: d.title || tr('제목 없음'),
      detail: `${MERCHANT_CHANNELS[d.channel] ?? d.channel} · ${d.updated_at.slice(0, 10)}`, status: d.approved_at ? 'approved' as const : 'draft' as const, onPress: () => { void openDraft(d); } } })),
    ...data.posts.map(p => ({ at: p.created_at ?? '', item: { key: `p:${p.post_id}`, title: p.title, detail: tr('조회 {0}회', p.displayed_views), status: 'published' as const, onPress: () => selectNav('posts') } })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 4).map(row => row.item);
  let calculated: ReturnType<typeof calculateMerchantCost> | null = null;
  try { calculated = calculateMerchantCost(Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, amount(v)])) as Parameters<typeof calculateMerchantCost>[0]); } catch { /* Invalid inputs have an inline message. */ }
  const stockChanges = data.items.filter((i) => (changes[i.id] ?? '').trim()).map((i) => ({ item_id: i.id, delta: amount(changes[i.id]), note: stockNote.trim() }));
  const stockValid = stockChanges.length > 0 && stockChanges.length <= 50 && (stockChanges.length === 1 || data.merchant.plan !== 'basic') && !!stockNote.trim()
    && stockChanges.every((c) => Number.isFinite(c.delta) && c.delta !== 0 && Math.abs(c.delta) <= 99999999999 && Math.round(c.delta * 1000) / 1000 === c.delta && Number(data.items.find((i) => i.id === c.item_id)?.quantity) + c.delta >= 0);
  const stockLocked = busy || !stockReady || stockPending;
  async function submitStock() {
    if (!stockReady || busyRef.current || stockOperations.has(stockKey)) return;
    let release = () => {};
    stockOperations.set(stockKey, new Promise<void>((resolve) => { release = resolve; }));
    try {
      if (!stockRequest.current && (!stockValid || !await confirmAction('재고 변경 확인', stockChanges.map((c) => { const i = data!.items.find((v) => v.id === c.item_id)!; return `${i.name}: ${i.quantity} → ${Number(i.quantity) + c.delta}${i.unit}`; }).join('\n')))) return;
      if (!mounted.current) return;
      await run(async () => {
        let stored: StockRequest | null;
        try { stored = await readStockRequest(stockKey); }
        catch (failure) { setStockReady(false); setStockRestoreError(true); throw failure; }
        if (stored && JSON.stringify(stored) !== JSON.stringify(stockRequest.current)) {
          stockRequest.current = stored; setStockPending(true);
          setChanges(Object.fromEntries(stored.changes.map((c) => [c.item_id, String(c.delta)]))); setStockNote(stored.changes[0].note);
          throw new Error('MERCHANT_STOCK_PENDING_RESTORED');
        }
        const request = stockRequest.current ?? { id: merchantEventId(), changes: stockChanges };
        stockRequest.current = request; setStockPending(true);
        try { await AsyncStorage.setItem(stockKey, JSON.stringify(request)); }
        catch { throw new Error('MERCHANT_STOCK_STORAGE_REQUIRED'); }
        const session = await supabase.auth.getSession();
        if (!mounted.current || session.data.session?.user.id !== me.id) throw new Error('ACCOUNT_CHANGED');
        try { await adjustMerchantInventory(supabase, id, request.id, request.changes); }
        catch (failure) {
          if (failure instanceof Error && /^(MERCHANT_STOCK_NEGATIVE|INVALID_MERCHANT_STOCK|MERCHANT_PLAN_REQUIRED|MERCHANT_ITEM_NOT_FOUND|RATE_LIMITED)$/.test(failure.message)) {
            try { await AsyncStorage.removeItem(stockKey); } catch { throw new Error('MERCHANT_STOCK_STORAGE_REQUIRED'); }
            stockRequest.current = null; if (mounted.current) setStockPending(false);
          }
          throw failure;
        }
        try { await AsyncStorage.removeItem(stockKey); } catch { throw new Error('MERCHANT_STOCK_STORAGE_REQUIRED'); }
        stockRequest.current = null;
        if (mounted.current) { setStockPending(false); setChanges({}); setStockNote(''); }
      }, '입출고를 기록했어요.');
    } finally { stockOperations.delete(stockKey); release(); }
  }
  return <>{checking && <View style={styles.workspace}>{error ? <><ThemedText accessibilityRole="alert">{tr(error)}</ThemedText><Action label={tr("다시 불러오기")} onPress={() => { setError(''); setRevision(v => v + 1); }} /></> : <GlingLoader accessibilityLabel={tr("현재 비즈니스 권한을 다시 확인하는 중")} />}</View>}
    <View style={[sidebar ? wideNav ? merchantShellStyles.shell : merchantShellStyles.stacked : styles.workspace, checking && { display: 'none', pointerEvents: 'none' }]} accessibilityElementsHidden={checking} importantForAccessibility={checking ? 'no-hide-descendants' : 'auto'} {...(Platform.OS === 'web' ? { inert: checking } : {})}>
    {sidebar && <MerchantSidebar items={navItems} active={activeTab} onSelect={selectNav} disabled={busy} wide={wideNav} />}
    <View style={sidebar ? merchantShellStyles.main : merchantShellStyles.plain}>
    {sidebar ? null : activeTab === 'overview' ? <View style={styles.businessHeader}>
      <View style={styles.toolText}><ThemedText type="title">{data.merchant.name}</ThemedText><ThemedText type="small" themeColor="textSecondary">{data.merchant.city_name} · {tr(data.merchant.owner_verified_at ? tr("비즈니스 소유 확인됨") : tr("비즈니스 소유 확인 대기"))}</ThemedText></View>
      {onChoose && <Action label={tr("비즈니스 변경")} disabled={busy} onPress={onChoose} />}
    </View> : <View style={styles.businessHeader}><Action label={tr("비즈니스 관리")} disabled={busy} onPress={() => { setNotice(''); setTab('overview'); }} /><ThemedText type="small" themeColor="textSecondary" style={styles.toolText}>{data.merchant.name}</ThemedText></View>}
    {error && <><ThemedText accessibilityRole="alert">{tr(error)}</ThemedText><Action label={tr("자료 새로 확인")} disabled={busy} onPress={() => { setError(''); setRevision((v) => v + 1); }} /></>}{notice && <ThemedText accessibilityLiveRegion="polite">{tr(notice)}</ThemedText>}
    {activeTab === 'overview' && sidebar && <MerchantHome name={data.merchant.name} place={`${tr(data.merchant.city_name)} · ${data.merchant.owner_verified_at ? tr('비즈니스 소유 확인됨') : tr('비즈니스 소유 확인 대기')}`} onChoose={onChoose}
      purposes={draftPurposes} purpose={purpose} onPurpose={value => setPurpose(value as (typeof draftPurposes)[number])} facts={facts} onFacts={setFacts}
      onGenerate={() => { void startHomeDraft(true); }} onWrite={() => { void openDraft(undefined, true); }} resume={dirty ? () => { setDraftView('composer'); setTab('drafts'); } : undefined}
      recent={recent} onAllPosts={() => selectNav('posts')} aiOwner={aiOwner} onOpenAi={() => selectNav('ai')} onOpenReviews={fullAccess ? () => selectNav('reviews') : undefined} busy={busy} />}
    {activeTab === 'overview' && !sidebar && <>
      <ThemedText type="subtitle">{tr("가게 소식을 전해보세요")}</ThemedText>
      <ThemedText themeColor="textSecondary">{tr("이 비즈니스 이름으로 새 소식을 작성해요.")}</ThemedText>
      {(!isAdmin || businessOnly) && data.merchant.owner_verified_at && <Action label={tr('비즈니스 대화함')} disabled={busy} onPress={() => { void openBusinessInbox(); }} />}
      <Action primary label={tr("비즈니스 글쓰기")} disabled={busy} onPress={() => { void openDraft(undefined, true); }} />
      <Action label={tr("사진 관리")} disabled={busy} onPress={() => { setNotice(''); setTab('profile'); }} />
      {dirty && <Action label={tr("작성 중인 초안 이어쓰기")} disabled={busy} onPress={() => { setDraftView('composer'); setTab('drafts'); }} />}
      <Section title={tr("비즈니스 관리")}>
        {([
          ['posts', tr("글·사진"), tr("게시한 글과 사진 관리")],
          ['profile', tr("프로필"), tr("공개 비즈니스 정보와 소개 수정")],
          ['reviews', tr("이용 후기"), tr("이용 후기 확인과 답글")],
          ['drafts', tr("홍보글 관리"), tr("저장한 초안과 게시한 원고")],
          ['channels', tr("카페 연결"), tr("네이버 계정과 게시판 연결")],
          ['cost', tr("원가 계산"), tr("개당 비용과 공헌이익 계산")],
          ['stock', tr("재고"), tr("품목 등록과 입출고 기록")],
          ['membership', tr("성과·멤버십"), tr("최근 활동과 비즈니스 이용 기간")],
          ['accounts', tr("계정 관리"), tr("비즈니스 운영 계정과 권한 관리")],
        ] as const).filter(([key]) => fullAccess || ['posts','profile','drafts'].includes(key)).map(([key, title, detail]) => <ToolRow key={key} title={title} detail={detail} disabled={busy} onPress={() => { if (key === 'drafts') setDraftView('list'); setTab(key); }} />)}
      </Section>
    </>}
    {activeTab === 'posts' && <MerchantWebPosts merchantId={id} posts={data.posts} onChanged={() => setRevision(v => v + 1)} />}
    <View style={{ display: activeTab === 'profile' ? 'flex' : 'none' }}><MerchantProfileEditor merchantId={id} onDirty={setProfileDirty} /></View>
    {fullAccess && (activeTab === 'reviews' || replyDirty) && <View style={{ display: activeTab === 'reviews' ? 'flex' : 'none' }} accessibilityElementsHidden={activeTab !== 'reviews'} importantForAccessibility={activeTab !== 'reviews' ? 'no-hide-descendants' : 'auto'}>
      <MerchantReviewInbox merchantId={id} onDirty={setReplyDirty} />
    </View>}
    {activeTab === 'channels' && <MerchantNaverCafe merchantId={id} drafts={data.drafts} onChanged={() => setRevision(v => v + 1)} />}
    {activeTab === 'drafts' && <>
      <View style={styles.actions}>{draftView === 'composer' && <Action label={tr("홍보글 목록")} disabled={busy} onPress={() => setDraftView('list')} />}{draftView === 'list' && dirty && <Action label={tr("작성 중인 초안 이어쓰기")} disabled={busy} onPress={() => setDraftView('composer')} />}</View>
      {draftView === 'list' && <Section title={tr("홍보글 관리")}>
        <Action primary label={tr("새 초안")} disabled={busy} onPress={() => { void openDraft(); }} />
        <View style={styles.actions}><Action label={tr(showArchived ? tr("작성 중인 원고 보기") : tr("보관한 원고 보기"))} disabled={busy} onPress={() => { setShowArchived(!showArchived); setSelection([]); }} /></View>
        {data.drafts.filter((d) => !!d.archived_at === showArchived).map((d) => <View key={d.id} style={styles.draftRow}>
          <Pressable analyticsId="merchant.select_draft" accessibilityRole="checkbox" accessibilityLabel={tr("{0} 선택", (d.title))} accessibilityState={{ checked: selection.includes(d.id), disabled: busy }} aria-checked={selection.includes(d.id)} disabled={busy} onPress={() => toggleDraft(d.id)}
            {...(Platform.OS === 'web' ? { onKeyDown: (event: KeyDownEvent) => { if (event.nativeEvent.key === ' ') { event.preventDefault(); toggleDraft(d.id); } } } : {})}
            style={styles.checkbox}><ThemedText>{selection.includes(d.id) ? '☑' : '□'}</ThemedText></Pressable>
          <Pressable analyticsId="merchant.open_draft" accessibilityRole="button" accessibilityLabel={`${d.title}, ${MERCHANT_CHANNELS[d.channel]}`} disabled={busy} onPress={() => { play('selection'); void openDraft(d); }} style={styles.draftTitle}><ThemedText type="smallBold">{d.title}</ThemedText><ThemedText type="small" themeColor="textSecondary">{MERCHANT_CHANNELS[d.channel]} · {tr(d.published_at ? tr("글링 게시됨") : d.external_url ? tr("카페 URL 기록됨") : d.approved_at ? tr("승인됨") : tr("초안"))}</ThemedText></Pressable>
        </View>)}
        {!data.drafts.some((d) => !!d.archived_at === showArchived) && <ThemedText type="small" themeColor="textSecondary">{tr(showArchived ? tr("보관한 원고가 없어요.") : tr("새 초안을 작성해 주세요."))}</ThemedText>}
        {selection.length > 0 && <><ThemedText type="small">{selection.length}{tr("개 선택")}</ThemedText><View style={styles.actions}>
          {!showArchived && <Action label={tr("선택 원고 승인")} disabled={busy || !canApprove || (!draftReady && selection.includes(editor.id)) || picked.some((d) => d.published_at || d.external_url)} onPress={() => {
            const expected = Object.fromEntries(picked.map((d) => [d.id, d.updated_at]));
            void run(async () => { await approveMerchantDrafts(supabase, id, selection, true, expected); if (selection.includes(editor.id)) editorReload.current = editor; }, '선택한 저장본을 승인했어요.');
          }} />}
          <Action label={tr(showArchived ? '선택 원고 복원' : '선택 원고 보관')} disabled={busy} onPress={() => { void run(async () => { await archiveMerchantDrafts(supabase, id, selection, !showArchived); setSelection([]); }, showArchived ? '원고를 복원했어요.' : '원고를 보관했어요. 공개된 게시글은 그대로예요.'); }} />
          <Action label={tr("선택 해제")} disabled={busy} onPress={() => setSelection([])} />
        </View>{!canApprove && selection.length > 1 && <ThemedText type="small" themeColor="textSecondary">{tr("기본 이용에서는 한 건씩 승인할 수 있어요.")}</ThemedText>}</>}
      </Section>}
      {draftView === 'composer' && <Section title={tr(draftStep === 'idea' ? tr("어떤 소식을 알릴까요?") : draftStep === 'channels' ? tr("게시 전 확인") : published ? tr("게시한 원고") : tr("초안을 확인해 주세요"))}>
        {draftChanged && <ThemedText accessibilityRole="alert">{tr(errorText(new Error('MERCHANT_DRAFT_CHANGED')))}</ThemedText>}
        {draftStep === 'idea' ? <>
          <ThemedText type="small" themeColor="textSecondary">{tr("가게 이름·도시와 이번 소식으로 초안을 만들어요.")}</ThemedText>
          <View style={styles.actions}>{draftPurposes.map((label) => <Action key={label} label={tr(label)} selected={purpose === label} disabled={busy} onPress={() => { setPurpose(label); setDirty(true); }} />)}</View>
          <Field label={tr("이번에 알릴 내용 (필수)")} value={facts} maxLength={1000} multiline disabled={busy} placeholder={tr("예: 새 닭강정 도시락을 소개하고 싶어요.\n12달러이고 토요일부터 판매해요.")} onChange={(value) => { setFacts(value); setDirty(true); }} />
          <ThemedText type="small" themeColor="textSecondary">{tr("입력하지 않은 가격·날짜는 만들어 넣지 않아요. 가게 이름·도시와 입력 내용이 AI에 전달돼요.")}</ThemedText>
          <Action primary label={tr(busy ? tr("초안 만드는 중…") : tr("AI로 초안 만들기"))} disabled={busy || !facts.trim()} onPress={() => { void generateDraft(); }} />
          <Action label={tr("직접 작성할게요")} disabled={busy} onPress={() => setDraftStep('edit')} />
        </> : draftStep === 'edit' ? <>
        {!published && <View style={styles.actions}><Action label={tr("AI로 다시 작성")} disabled={busy} onPress={() => setDraftStep('idea')} /><Action label={tr("초안 저장")} disabled={busy || draftChanged || !editor.title.trim() || !editor.body.trim() || !!saved?.archived_at} onPress={() => { void saveEditor(); }} /></View>}
        {aiDraftReady && <ThemedText type="small" accessibilityLiveRegion="polite" themeColor="textSecondary">{tr("AI 초안이에요. 가격·시간·연락처를 확인하고 사장님 말투로 고쳐도 좋아요.")}</ThemedText>}
        {editor.channel !== 'gling' && <><ThemedText type="small">{tr("원고 채널")}</ThemedText><View style={styles.actions}>{Object.entries(MERCHANT_CHANNELS).map(([key, label]) => <Action key={key} label={label} selected={editor.channel === key} disabled={busy || published} onPress={() => changeDraft({ channel: key as MerchantChannel })} />)}</View></>}
        <Field label={tr("제목")} value={editor.title} maxLength={100} disabled={busy || published} onChange={(title) => changeDraft({ title })} />
        <View style={styles.field}><ThemedText type="small" themeColor="textSecondary">{tr("게시글 본문")}</ThemedText>
          <PostBodyEditor accessibilityLabel={tr("게시글 본문")} value={editor.body} cityName={CITIES.find(city => city.id === data.merchant.city_id)?.englishName} allowLocation={editor.channel === 'gling'} maxLength={4700} multiline editable={!busy && !published} onChangeText={(body) => changeDraft({ body })}
            style={[styles.input, styles.multiline, { color: theme.text, borderColor: theme.line, backgroundColor: theme.backgroundElement }]} />
        </View>
        <ThemedText type="smallBold">{tr("사진") + " "}{draftPhotos.length}/{MAX_POST_IMAGES}</ThemedText>
        <PostPhotoEditor images={draftPhotos} disabled={busy || published} onChange={changeDraftPhotos} />
        <Action label={tr("사진 추가")} disabled={busy || published || draftPhotos.length >= MAX_POST_IMAGES} onPress={() => { void pickDraftPhotos(); }} />
        <ThemedText type="small" themeColor="textSecondary">{tr("첫 사진을 표지로 사용해요. 사진을 추가·제거하거나 순서를 바꾸면 초안을 저장하고 다시 승인해 주세요.")}</ThemedText>
        <Action label={tr(draftOptions ? tr("추가 설정 닫기") : tr("분류·원문 주소"))} disabled={busy} onPress={() => setDraftOptions(!draftOptions)} />
        {(draftOptions || editor.channel !== 'gling') && <>
        <Field label={tr("원문 주소 · 선택")} value={editor.original_url} maxLength={2048} disabled={busy || published} onChange={(original_url) => changeDraft({ original_url })} />
        <View style={styles.actions}>{TAGS.filter((t) => t.kind === 'post').map((t) => <Action key={t.slug} label={t.label} selected={editor.tag_slug === t.slug} disabled={busy || published} onPress={() => changeDraft({ tag_slug: t.slug })} />)}</View>
        <View style={styles.actions}><Action label={tr("비즈니스 안내")} selected={editor.kind === 'story'} disabled={busy || published} onPress={() => changeDraft({ kind: 'story' })} /><Action label={tr("구인구직·거래")} selected={editor.kind === 'listing'} disabled={busy || published} onPress={() => changeDraft({ kind: 'listing' })} /></View>
        </>}
        {published ? <>{editor.channel === 'gling' && <Action primary label={tr("카페용 원고 준비")} disabled={busy || !draftReady} onPress={() => setDraftStep('channels')} />}<Action label={tr("새 초안으로 복제")} disabled={busy} onPress={() => { setEditor({ ...editor, id: merchantEventId() }); setOpenedDraft(null); setDirty(true); setExternalUrl(''); setPreparedChannels(null); setChannels({ gling: true, naver: false, daum: false }); }} /></> : editor.channel === 'gling' ? <>
          <ThemedText type="small" themeColor="textSecondary">{tr("채널 선택 전에 초안을 저장해요. 아직 게시되지 않아요.")}</ThemedText>
          <Action primary label={tr("게시 채널 선택")} disabled={busy || draftChanged || !editor.title.trim() || !editor.body.trim() || !!saved?.archived_at} onPress={() => { if (draftReady) setDraftStep('channels'); else void saveEditor('channels'); }} />
        </> : null}
        {editor.channel !== 'gling' && <>
        {saved && !published && !saved.archived_at && <Action label={tr(saved.approved_at ? tr("승인 취소") : tr("이 저장본 승인"))} disabled={busy || !draftReady} onPress={() => {
          const expected = { [saved.id]: saved.updated_at };
          void run(async () => { await approveMerchantDrafts(supabase, id, [saved.id], !saved.approved_at, expected); editorReload.current = editor; }, saved.approved_at ? tr("승인을 취소했어요.") : tr("최신 저장본을 승인했어요."));
        }} />}
        <Action label={tr(Platform.OS === 'web' ? tr("게시글 복사") : tr("게시글 공유·복사"))} disabled={busy || !draftReady || !saved?.approved_at} onPress={() => { void run(() => shareText(merchantDraftCopy(saved!)), tr("저장된 원고를 준비했어요."), false); }} />
          <ThemedText type="small" themeColor="textSecondary">{tr("카페의 가입·게시 규칙을 확인한 뒤 직접 올려주세요. 아래 주소는 직접 올린 글을 관리하기 위한 기록이에요.")}</ThemedText>
          <Field label={tr("직접 올린 카페 게시글 주소")} value={externalUrl} maxLength={2048} disabled={busy} onChange={setExternalUrl} />
          <Action label={tr("게시 URL 기록")} disabled={busy || !draftReady || !saved?.approved_at || !externalUrl.trim() || !!saved.archived_at} onPress={() => {
            if (!saved || !draftReady) return;
            const expected = saved.updated_at;
            void run(async () => { await recordMerchantExternalPost(supabase, id, saved.id, externalUrl.trim(), expected); editorReload.current = editor; }, tr("카페 게시 URL을 기록했어요."));
          }} />
        </>}
        </> : <>
          <ThemedText type="smallBold">{editor.title}</ThemedText><ThemedText>{editor.body}</ThemedText>
          {!!editor.original_url && <ThemedText type="small" themeColor="textSecondary">{editor.original_url}</ThemedText>}
          {([['gling', tr("글링에 게시"), tr('{0} · 비즈니스 안내', tr(data.merchant.city_name))], ['naver', tr("네이버 카페용 원고 준비"), tr("원고 복사 후 직접 등록")], ['daum', tr("다음 카페용 원고 준비"), tr("원고 복사 후 직접 등록")]] as const).map(([key, label, detail]) => <View key={key} style={styles.channelRow}>
            <View style={styles.channelText}><ThemedText type="smallBold">{tr(key === 'gling' ? tr("글링") : key === 'naver' ? tr("네이버 카페") : tr("다음 카페"))}</ThemedText><ThemedText type="small" themeColor="textSecondary">{detail}</ThemedText></View>
            <Switch analyticsId={`merchant.channel.${key}`} accessibilityLabel={label} value={channels[key]} disabled={busy || (key === 'gling' && published)} onValueChange={(value) => { play('selection'); setChannels({ ...channels, [key]: value }); }} style={styles.channelSwitch}
              thumbColor={channels[key] ? theme.accentInk : theme.text} {...(Platform.OS === 'web' ? { activeThumbColor: theme.accentInk } : {})} trackColor={{ false: theme.line, true: theme.accent }} ios_backgroundColor={theme.line} />
          </View>)}
          {channels.gling && !data.merchant.owner_verified_at && <ThemedText type="small" themeColor="textSecondary">{tr("글링 공개 게시에는 비즈니스 소유 확인이 필요해요.")}</ThemedText>}
          <ThemedText type="small" themeColor="textSecondary">{tr("글링에는 비즈니스 안내 표시와 게시 기준이 적용돼요. 카페는 가입·게시 규칙을 확인해 직접 올려주세요.")}</ThemedText>
          {published ? <ThemedText accessibilityLiveRegion="polite">{tr("글링에 게시된 원고예요.")}</ThemedText> : <Action primary label={tr(channels.gling ? tr("선택한 내용으로 게시 확인") : channels.naver || channels.daum ? tr("원고 준비 확인") : tr("게시할 채널을 선택해 주세요"))} disabled={busy || !draftReady || !!saved?.archived_at || (!channels.gling && !channels.naver && !channels.daum) || (channels.gling && (!data.merchant.owner_verified_at || data.merchant.status === 'paused'))} onPress={() => { void confirmChannels(); }} />}
          {(['naver', 'daum'] as const).map((key) => channels[key] && (preparedChannels?.[key] || published) && <Action key={key} label={tr("{0} 카페용 원고 {1}", key === 'naver' ? tr("네이버") : tr("다음"), Platform.OS === 'web' ? tr("복사") : tr("공유·복사"))} disabled={busy || !draftReady} onPress={() => { void run(() => shareText(merchantDraftCopy(saved!)), tr("원고를 준비했어요. 카페에서 직접 등록해 주세요."), false); }} />)}
          <Action label={tr("원고 수정")} disabled={busy} onPress={() => setDraftStep('edit')} />
        </>}
      </Section>}
    </>}
    {activeTab === 'cost' && <Section title={tr("개당 원가 계산")}>
      <ThemedText type="small" themeColor="textSecondary">{tr("한 번 만드는 묶음 기준으로 입력해요. 금액은 CAD예요.")}</ThemedText>
      {([['batchCost', tr("묶음 전체 재료비")], ['yield', tr("판매 가능한 수량")], ['packaging', tr("개당 포장비")], ['other', tr("개당 기타비")], ['price', tr("개당 판매가")], ['feePercent', tr("결제·판매 수수료율 (%)")]] as const).map(([key, label]) => <Field key={key} label={label} value={cost[key]} numeric onChange={(value) => setCost({ ...cost, [key]: value })} />)}
      {calculated ? <View style={styles.result}><ThemedText type="subtitle">{tr("개당 변동 원가") + " "}{money(calculated.unitCost)}</ThemedText><ThemedText>{tr("개당 공헌이익") + " "}{money(calculated.contribution)}</ThemedText><ThemedText type="small">{tr("원가율") + " "}{calculated.costPercent?.toFixed(1) ?? '—'}{tr("% · 공헌이익률") + " "}{calculated.marginPercent?.toFixed(1) ?? '—'}%</ThemedText></View> : <ThemedText accessibilityRole="alert">{tr(errorText(new Error('INVALID_COST_INPUT')))}</ThemedText>}
      <ThemedText type="small" themeColor="textSecondary">{tr("공헌이익은 입력한 변동 비용을 뺀 금액이에요. 임대료·인건비·세금 등을 반영하기 전이므로 순이익과 달라요.")}</ThemedText>
      <Action label={tr("계산 내역 복사·공유")} disabled={!calculated || busy} onPress={() => { if (calculated) void run(() => shareText(`${data.merchant.name} 원가 계산\n전체 재료비 ${money(amount(cost.batchCost))} / 수량 ${cost.yield}\n개당 포장비 ${money(amount(cost.packaging))} · 기타비 ${money(amount(cost.other))}\n판매가 ${money(amount(cost.price))} · 수수료 ${cost.feePercent}%\n개당 변동 원가 ${money(calculated.unitCost)}\n개당 공헌이익 ${money(calculated.contribution)} (고정비·세금 반영 전)`), '계산 내역을 준비했어요.', false); }} />
    </Section>}
    {activeTab === 'stock' && <>
      <Section title={tr("품목 관리")}>
        <Field label={tr("품목 이름")} value={item.name} disabled={stockLocked} onChange={(name) => setItem({ ...item, name })} /><Field label={tr("단위")} value={item.unit} maxLength={20} disabled={stockLocked} onChange={(unit) => setItem({ ...item, unit })} />
        <Field label={tr("개당 원가 (CAD)")} value={item.unit_cost} numeric disabled={stockLocked} onChange={(unit_cost) => setItem({ ...item, unit_cost })} /><Field label={tr("재고 부족 기준")} value={item.low_stock} numeric disabled={stockLocked} onChange={(low_stock) => setItem({ ...item, low_stock })} />
        <Action primary label={tr("품목 저장")} disabled={stockLocked || !item.name.trim() || !item.unit.trim() || !Number.isFinite(amount(item.unit_cost)) || amount(item.unit_cost) < 0 || !Number.isFinite(amount(item.low_stock)) || amount(item.low_stock) < 0} onPress={() => { void run(async () => { await saveMerchantItem(supabase, id, { ...item, unit_cost: amount(item.unit_cost), low_stock: amount(item.low_stock) }); setItem({ id: merchantEventId(), name: '', unit: '개', unit_cost: '0', low_stock: '0' }); }, '품목을 저장했어요. 재고는 아래 입출고로 기록해 주세요.'); }} />
      </Section>
      <Section title={tr("입출고 기록")}>
        <ThemedText type="small" themeColor="textSecondary">{tr("입고는 양수, 출고는 음수로 입력해요. 소수점은 세 자리까지 지원해요.")}</ThemedText>
        {!data.items.length && <ThemedText>{tr("품목을 먼저 등록해 주세요.")}</ThemedText>}
        {data.items.map((i) => <View key={i.id} style={styles.stockRow}><ThemedText type="smallBold">{i.name} · {Number(i.quantity)}{i.unit}{tr(Number(i.quantity) <= Number(i.low_stock) ? tr(" · 재고 부족") : '')}</ThemedText><View style={styles.actions}>
          <Action label={tr("{0} 수정", (i.name))} disabled={stockLocked} onPress={() => setItem({ ...i, unit_cost: String(i.unit_cost), low_stock: String(i.low_stock) })} />
        </View><Field label={tr("{0} 입출고 수량", (i.name))} value={changes[i.id] ?? ''} numeric signed disabled={stockLocked} onChange={(value) => setChanges({ ...changes, [i.id]: value })} />
          {!stockPending && (changes[i.id] ?? '').trim() && <ThemedText type="small">{tr("변경 후") + " "}{Number(i.quantity) + amount(changes[i.id])}{i.unit}</ThemedText>}
        </View>)}
        <Field label={tr("입출고 사유")} value={stockNote} maxLength={300} disabled={stockLocked} onChange={setStockNote} />
        {stockChanges.length > 1 && data.merchant.plan === 'basic' && <ThemedText type="small">{tr("기본 이용에서는 한 품목씩 기록할 수 있어요.")}</ThemedText>}
        {!stockReady && <ThemedText type="small" accessibilityLiveRegion="polite">{tr(stockRestoreError ? tr("이전 입출고 요청을 확인해야 새 수량을 입력할 수 있어요.") : tr("이 계정·비즈니스의 이전 입출고 요청을 확인하고 있어요."))}</ThemedText>}
        {!stockReady && stockRestoreError && <Action label={tr("입출고 요청 다시 확인")} disabled={busy} onPress={() => { setError(''); setStockRecoveryRevision((v) => v + 1); }} />}
        <Action primary label={tr(stockPending ? tr("같은 입출고 요청 재확인") : tr("입출고 기록"))} disabled={busy || !stockReady || (!stockPending && !stockValid)} onPress={() => { void submitStock(); }} />
        {stockPending && <ThemedText type="small" accessibilityLiveRegion="polite" themeColor="textSecondary">{tr("입출고 요청을 보관했어요. 결과가 확인될 때까지 수량과 사유는 고정돼요. 매장을 바꾸거나 앱을 다시 열어도 같은 요청 재확인 버튼으로 원래 요청의 결과를 확인할 수 있어요.")}</ThemedText>}
        {data.movements.slice(0, 20).map((m) => <ThemedText key={m.id} type="small" themeColor="textSecondary">{m.item_name} {Number(m.delta) > 0 ? '+' : ''}{m.delta} · {m.note} · {new Date(m.created_at).toLocaleDateString(appLocale)}</ThemedText>)}
      </Section>
    </>}
    {activeTab === 'accounts' && <MerchantAccountManagement merchantName={data.merchant.name} merchantId={id} refreshSignal={refreshSignal + revision} onChanged={() => { setRevision(v => v + 1); onConnectionsChanged?.(); }} />}
    {activeTab === 'membership' && data.metrics && <>
      <Section title={tr("비즈니스 멤버십")}>
        {businessMembership ? <><ThemedText type="subtitle">{({ free:tr("베이직"),plus:tr("플러스"),pro:tr("프로"),premium:tr("프리미엄") })[businessMembership.tier]}</ThemedText>
          <ThemedText>{tr("이번 달 신규") + " "}{businessMembership.postsUsed}/{businessMembership.postLimit ?? tr("기존 약정 유지")}{tr("편 · 끌어올리기") + " "}{businessMembership.bumpsUsed}/{businessMembership.bumpLimit}{tr("회")}</ThemedText>
          {businessMembership.tier === 'premium' && <ThemedText type="small">{tr("전체 30편·24회에 운영대행 신규 4편·끌어올리기 8회·보고서 1회가 포함돼요.")}</ThemedText>}
          <ThemedText type="small" themeColor="textSecondary">{new Date(businessMembership.resetsAt).toLocaleDateString(appLocale)}{tr("에 사용량이 초기화돼요. 직원과 AI도 같은 비즈니스 한도를 공유해요.")}</ThemedText></> : <ThemedText type="small">{tr("멤버십 사용량을 확인하지 못했어요. 비즈니스 연결 상태를 확인하고 다시 열어 주세요.")}</ThemedText>}
        <ThemedText type="small" themeColor="textSecondary">{tr("같은 홍보글은 새 글로 다시 올리지 않고 기존 글을 수정하거나 끌어올려 주세요. 앱의 멤버십 → 비즈니스에서 스토어 상품이 준비되면 가입할 수 있어요.")}</ThemedText>
      </Section>
      <Section title={tr("비즈니스 이용 상태")}><ThemedText type="subtitle">{({ basic: tr("기본 이용"), trial: tr("비즈니스 체험"), pro: tr("비즈니스 유료 운영") })[data.merchant.plan]}</ThemedText>
        <ThemedText>{tr(data.merchant.plan === 'trial' ? tr("{0}까지 체험", (data.merchant.trial_ends_at)) : data.merchant.plan === 'pro' ? tr("{0}까지 운영", (data.merchant.workspace_until)) : tr("개별 초안·승인, 원가 계산, 품목별 입출고를 계속 이용할 수 있어요."))}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{tr("체험·기존 운영 기간 또는 비즈니스 유료 멤버십에서는 여러 건을 한 번에 승인하거나 입출고할 수 있어요. 기간이 끝나도 저장한 자료는 남아요. 개인 멤버십과 비즈니스 구독은 별도로 관리해요.")}</ThemedText>
      </Section>
      <Section title={tr("최근 14일 성과")}><ThemedText>{tr("연결 게시글") + " "}{data.metrics.linked_posts}{tr("편 · 새 글") + " "}{data.metrics.new_posts}{tr("편")}</ThemedText>
        <ThemedText>{tr("로그인 회원 최초 열람 {0}회 · {1}명", data.metrics.first_reads, data.metrics.unique_readers)}</ThemedText><ThemedText>{tr("원문 클릭 {0}회", data.metrics.source_clicks)}</ThemedText>
        <ThemedText type="small">{tr("로그인 클릭 회원 {0}명 · 익명 클릭 세션 {1}개", data.metrics.member_clickers, data.metrics.anonymous_sessions)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{tr("누적 표시 조회") + " "}{data.metrics.displayed_views}{tr("회 · 익명 조회·운영 조정 포함. 실제 열람 인원과 달라요. 원문 클릭은 문의·주문 완료를 뜻하지 않아요. 비즈니스 소유자·작성자·관리자 기록은 측정 성과에서 제외해요.")}</ThemedText>
        {data.reports.map((report) => <Action key={report.id} label={tr("{0} 보고서 공유", (report.period_end))} disabled={busy} onPress={() => { void run(() => shareText(merchantReportText(report)), '저장된 보고서를 준비했어요.', false); }} />)}
      </Section>
    </>}
    </View>
  </View></>;
}

const styles = StyleSheet.create({
  workspace: { gap: 16, width: '100%', maxWidth: 760, alignSelf: 'center' },
  section: { gap: 14, padding: 18, borderWidth: 1, borderRadius: 20, borderCurve: 'continuous' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  action: { minHeight: 44, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, justifyContent: 'center', maxWidth: '100%' },
  field: { gap: 6 }, input: { minHeight: 48, minWidth: 0, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, lineHeight: 22 },
  multiline: { minHeight: 160, textAlignVertical: 'top' },
  draftRow: { flexDirection: 'row', gap: 8, alignItems: 'center' }, checkbox: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  draftTitle: { flex: 1, minWidth: 0, minHeight: 44, gap: 4, paddingVertical: 8 },
  businessHeader: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' },
  toolRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  toolText: { flex: 1, minWidth: 0, gap: 4 },
  stockRow: { gap: 8, paddingVertical: 8 }, result: { gap: 8, paddingVertical: 8 },
  channelRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 }, channelText: { flex: 1, minWidth: 0, gap: 4 }, channelSwitch: { width: 52, height: 44 },
});
