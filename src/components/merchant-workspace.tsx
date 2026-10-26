import { useLanguage } from '@/hooks/use-language';
import { tr } from '@/i18n';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Platform, Share, StyleSheet, TextInput, View, type KeyDownEvent } from 'react-native';

import { Pressable, Switch } from '@/components/analytics-controls';
import { GlingLoader } from '@/components/gling-loader';
import { MerchantAccountInvitations, MerchantAccountManagement } from '@/components/merchant-account-connections';
import { MerchantAccessGate } from '@/components/merchant-access-gate';
import { MerchantNaverCafe } from '@/components/merchant-naver-cafe';
import { MerchantOperatorInvites } from '@/components/merchant-operator-invites';
import { MerchantWebPosts } from '@/components/merchant-web-posts';
import { MerchantBadge, merchantToneColor, MerchantHelp, MerchantMeter, MerchantPageHeader, MerchantSegments, MerchantStat, MerchantStats, MerchantSteps } from '@/components/merchant-ui';
import { MerchantChannelList, MerchantHome, MerchantSidebar, merchantShellStyles, useMerchantSidebar, type MerchantNavItem, type MerchantRecentItem } from '@/components/merchant-web-shell';
import { PostPhotoEditor, type EditablePostImage } from '@/components/post-photo-editor';
import { PostBodyEditor } from '@/components/post-body-editor';
import { MerchantReviewInbox } from '@/components/merchant-review-inbox';
import { MerchantProfileEditor } from '@/components/merchant-profile-editor';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { usePreventRemove, useRouter } from 'expo-router';
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
  BUSINESS_PLAN_REQUIRED: 'AI 초안은 유료 비즈니스 멤버십에서 쓸 수 있어요. 직접 작성은 계속할 수 있어요.',
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
function ToolTile({ title, detail, icon, badge, warn = false, onPress, disabled }: { title: string; detail: string; icon: SymbolViewProps['name']; badge?: string; warn?: boolean; onPress: () => void; disabled?: boolean }) {
  const theme = useTheme(); const { play } = useInteractionFeedback();
  return <Pressable analyticsId="merchant.home.tile" accessibilityRole="button" accessibilityLabel={badge ? `${title}, ${badge}` : title} accessibilityHint={detail} accessibilityState={{ disabled: !!disabled }} disabled={disabled}
    onPress={() => { play('selection'); onPress(); }} style={({ pressed }) => [styles.tile, { backgroundColor: pressed ? theme.backgroundSelected : theme.card, borderColor: theme.line, opacity: disabled ? 0.5 : 1 }]}>
    <View style={styles.tileTop}><SymbolView name={icon} size={22} tintColor={theme.accent} />{!!badge && <MerchantBadge label={badge} tone={warn ? 'warn' : 'accent'} />}</View>
    <View style={styles.toolText}><ThemedText type="smallBold">{title}</ThemedText><ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{detail}</ThemedText></View>
  </Pressable>;
}
const costKeys = ['batchCost', 'yield', 'packaging', 'other', 'price', 'feePercent'] as const;
type CostInput = Record<(typeof costKeys)[number], string>;
type CostMenu = { name: string; values: CostInput };
const emptyCost = (): CostInput => ({ batchCost: '', yield: '', packaging: '', other: '', price: '', feePercent: '' });
// Empty fields count as nothing spent; an empty yield means one piece per batch.
const costNumbers = (cost: CostInput) => Object.fromEntries(costKeys.map(key => [key, cost[key].trim() ? amount(cost[key]) : key === 'yield' ? 1 : 0])) as Record<(typeof costKeys)[number], number>;
// Saved menus are a per-device convenience, so unreadable data is dropped instead of blocking the calculator.
function parseCostMenus(stored: string | null): CostMenu[] {
  try {
    const value = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(value)) return [];
    return value.filter((menu: CostMenu) => !!menu && typeof menu.name === 'string' && !!menu.name.trim() && menu.name.length <= 30 && !!menu.values
      && costKeys.every(key => typeof menu.values[key] === 'string' && menu.values[key].length <= 20)).slice(0, 20)
      .map((menu: CostMenu) => ({ name: menu.name, values: Object.fromEntries(costKeys.map(key => [key, menu.values[key]])) as CostInput }));
  } catch { return []; }
}
const tileIcon = (ios: string, material: string) => ({ ios, android: material, web: material }) as SymbolViewProps['name'];

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
  const { tr, language, locale: appLocale } = useLanguage();
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
  // In the app the tools are tabs inside one screen, so back returns to the business home instead of leaving it.
  usePreventRemove(!sidebar && tab !== 'overview', () => { setNotice(''); setTab('overview'); });
  const [channels, setChannels] = useState({ gling: true, naver: false, daum: false });
  const [preparedChannels, setPreparedChannels] = useState<{ naver: boolean; daum: boolean } | null>(null);
  const [openedDraft, setOpenedDraft] = useState<MerchantDraft | null>(null);
  const [draftPhotos, setDraftPhotos] = useState<EditablePostImage[]>([]);
  const editorReload = useRef<DraftInput | null>(null);
  const [draftFilter, setDraftFilter] = useState<'open' | 'published' | 'archived'>('open'), [externalUrl, setExternalUrl] = useState('');
  const showArchived = draftFilter === 'archived';
  const [item, setItem] = useState<{ id: string; name: string; unit: string; unit_cost: string; low_stock: string }>(() => ({ id: merchantEventId(), name: '', unit: '개', unit_cost: '0', low_stock: '0' }));
  const [changes, setChanges] = useState<Record<string, string>>({}), [stockNote, setStockNote] = useState('');
  const stockRequest = useRef<StockRequest | null>(null);
  const stockKey = `gling.merchant.stock.${me.id}.${id}`;
  const [stockPending, setStockPending] = useState(false), [stockReady, setStockReady] = useState(false);
  const [stockRestoreError, setStockRestoreError] = useState(false), [stockRecoveryRevision, setStockRecoveryRevision] = useState(0);
  const [cost, setCost] = useState(emptyCost);
  const costKey = `gling.merchant.cost.${me.id}.${id}`;
  const [costMenus, setCostMenus] = useState<CostMenu[]>([]), [menuName, setMenuName] = useState<string | null>(null);
  const [itemOpen, setItemOpen] = useState(false), [stockFilter, setStockFilter] = useState<'all' | 'low'>('all'), [allMovements, setAllMovements] = useState(false);
  function clearPrivateState() {
    setResponse(null); setMembership(null); setEditor(emptyDraft()); setOpenedDraft(null); setDraftPhotos([]); editorReload.current = null;
    setSelection([]); setChanges({}); setStockNote(''); setItem({ id: merchantEventId(), name: '', unit: '개', unit_cost: '0', low_stock: '0' });
    setDirty(false); setProfileDirty(false); setReplyDirty(false); setFacts(''); setAiDraftReady(false); setPreparedChannels(null); setExternalUrl('');
    setDraftStep('idea'); setDraftView('list'); setDraftOptions(false); setDraftFilter('open'); setPurpose('가게 소식'); setChannels({ gling: true, naver: false, daum: false }); setTab('overview'); setNotice('');
    setCost(emptyCost()); setCostMenus([]); setMenuName(null); setItemOpen(false);
    stockRequest.current = null; setStockPending(false); setStockReady(false); setStockRestoreError(true);
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onDirty(dirty || profileDirty || replyDirty); }, [dirty, profileDirty, replyDirty, onDirty]);
  useEffect(() => {
    let active = true;
    void (async () => {
      const stored = await AsyncStorage.getItem(costKey);
      if (active) setCostMenus(parseCostMenus(stored));
    })().catch(() => {});
    return () => { active = false; };
  }, [costKey]);
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
        selectedCategory: base.tag_slug === 'festival' ? 'life' : base.tag_slug, bodyHint, language,
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
  // Same rule as the server's merchant_workspace_plan: free (basic) businesses write by hand.
  const aiAllowed = data.merchant.plan !== 'basic';
  const navItems: MerchantNavItem[] = [
    { key: 'overview', label: tr('홈'), icon: { ios: 'house', android: 'home', web: 'home' } },
    { key: 'posts', label: tr('글·사진'), icon: { ios: 'doc.text', android: 'description', web: 'description' } },
    { key: 'drafts', label: tr('홍보글'), icon: { ios: 'square.and.pencil', android: 'edit_note', web: 'edit_note' } },
    ...fullAccess ? [{ key: 'reviews', label: tr('이용 후기'), icon: { ios: 'star', android: 'star', web: 'star' } } as const] : [],
    { key: 'profile', label: tr('프로필'), icon: { ios: 'storefront', android: 'storefront', web: 'storefront' } },
    ...aiOwner ? [{ key: 'ai', label: tr('AI 연결'), icon: { ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' } } as const] : [],
    ...fullAccess ? ([
      ['channels', tr('채널 연결'), 'link', 'link'], ['cost', tr('원가 계산'), 'percent', 'calculate'], ['stock', tr('재고'), 'shippingbox', 'inventory_2'],
      ['membership', tr('성과·멤버십'), 'chart.bar', 'bar_chart'], ['accounts', tr('계정 관리'), 'person.2', 'group'],
    ] as const).map(([key, label, ios, web]) => ({ key, label, icon: { ios, android: web, web }, group: 'tools' as const })) : [],
  ];
  function selectNav(key: string) {
    if (key === 'ai') { router.push('/ai'); return; }
    setNotice(''); if (key === 'drafts') setDraftView('list'); setTab(key as MerchantTab);
  }
  const pageCopy: Partial<Record<MerchantTab, [string, string]>> = {
    posts: [tr('글·사진'), tr('게시한 글을 열어 고치거나 내릴 수 있어요.')],
    drafts: [tr('홍보글'), tr('초안을 쓰고, 확인한 원고만 게시해요.')],
    reviews: [tr('이용 후기'), tr('후기에 답글을 달면 비즈니스 프로필에 함께 보여요.')],
    profile: [tr('프로필'), tr('손님에게 보이는 비즈니스 정보예요.')],
    channels: [tr('채널 연결'), tr('글링 글을 네이버 카페·SNS에도 함께 올려요.')],
    cost: [tr('원가 계산'), tr('한 번 만드는 묶음 기준으로 넣어요. 금액은 CAD예요.')],
    stock: [tr('재고'), tr('품목을 등록하고 들어오고 나간 수량을 기록해요.')],
    membership: [tr('성과·멤버십'), tr('최근 14일 성과와 이번 달 사용량이에요.')],
    accounts: [tr('계정 관리'), tr('이 비즈니스를 함께 관리하는 계정이에요.')],
  };
  const newLabel = activeTab === 'posts' ? tr('새 글 쓰기') : activeTab === 'drafts' && draftView === 'list' ? tr('새 초안') : '';
  const draftMatches = (d: MerchantDraft, filter: typeof draftFilter) => filter === 'archived' ? !!d.archived_at
    : !d.archived_at && (filter === 'published') === !!(d.published_at || d.external_url);
  const stockStep = (itemId: string, delta: number) => setChanges(current => {
    const next = Math.round((amount(current[itemId] || '0') + delta) * 1000) / 1000;
    return { ...current, [itemId]: Number.isFinite(next) && next !== 0 ? String(next) : '' };
  });
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
  const costInput = costNumbers(cost);
  try { calculated = calculateMerchantCost(costInput); } catch { /* Invalid inputs have an inline message. */ }
  // Parts of one sale for the bar: ingredients, packaging and other, fees, then what is left.
  const costParts = calculated ? [
    [tr('재료'), costInput.batchCost / costInput.yield, theme.navy], [tr('포장·기타'), costInput.packaging + costInput.other, theme.accentDepth],
    [tr('수수료'), costInput.price * costInput.feePercent / 100, theme.textSecondary], [tr('남는 돈'), Math.max(0, calculated.contribution), theme.accent],
  ] as const : [];
  const costTotal = costParts.reduce((sum, [, value]) => sum + value, 0);
  const sameCost = (values: CostInput) => costKeys.every(key => values[key] === cost[key]);
  async function storeCostMenus(next: CostMenu[], success: string) {
    try { await AsyncStorage.setItem(costKey, JSON.stringify(next)); }
    catch { setError(tr('메뉴를 저장하지 못했어요. 기기 저장 공간을 확인해 주세요.')); play('warning'); return; }
    if (mounted.current) { setCostMenus(next); setNotice(success); play('selection'); }
  }
  function saveCostMenu(name: string) {
    const trimmed = name.trim().slice(0, 30);
    if (!trimmed) return;
    setMenuName(null);
    void storeCostMenus([{ name: trimmed, values: { ...cost } }, ...costMenus.filter(menu => menu.name !== trimmed)].slice(0, 20), tr('「{0}」 메뉴로 저장했어요.', trimmed));
  }
  function askCostMenuName() {
    if (Platform.OS === 'ios') Alert.prompt(tr('메뉴 이름'), tr('저장해 두면 다음에 바로 불러올 수 있어요.'), [{ text: tr('취소'), style: 'cancel' }, { text: tr('저장'), onPress: value => saveCostMenu(value ?? '') }], 'plain-text', costMenus.find(menu => sameCost(menu.values))?.name ?? '');
    else setMenuName(costMenus.find(menu => sameCost(menu.values))?.name ?? '');
  }
  async function deleteCostMenu(menu: CostMenu) {
    if (!await confirmAction(tr('메뉴 삭제'), tr('「{0}」 계산을 이 기기에서 지울까요?', menu.name)) || !mounted.current) return;
    await storeCostMenus(costMenus.filter(item => item.name !== menu.name), tr('메뉴를 지웠어요.'));
  }
  const lowItems = data.items.filter(i => Number(i.quantity) <= Number(i.low_stock));
  const openDrafts = data.drafts.filter(d => draftMatches(d, 'open')).length;
  const inboxAllowed = (!isAdmin || businessOnly) && !!data.merchant.owner_verified_at;
  const planEnds = data.merchant.plan === 'trial' ? data.merchant.trial_ends_at : data.merchant.workspace_until;
  const goTool = (key: MerchantTab) => { setNotice(''); if (key === 'drafts') setDraftView('list'); setTab(key); };
  const shownItems = stockFilter === 'low' ? lowItems : data.items;
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
    {sidebar || activeTab === 'overview' ? null : <View style={styles.businessHeader}><Action label={tr("비즈니스 관리")} disabled={busy} onPress={() => { setNotice(''); setTab('overview'); }} /><ThemedText type="small" themeColor="textSecondary" style={styles.toolText}>{data.merchant.name}</ThemedText></View>}
    {sidebar && activeTab !== 'overview' && pageCopy[activeTab] && <MerchantPageHeader title={pageCopy[activeTab]![0]} subtitle={pageCopy[activeTab]![1]} action={newLabel ? <RaisedActionButton compact analyticsId="merchant.primary" label={newLabel} disabled={busy} onPress={() => { play('selection'); void openDraft(undefined, activeTab === 'posts' || !aiAllowed); }} /> : undefined} />}
    {error && <><ThemedText accessibilityRole="alert">{tr(error)}</ThemedText><Action label={tr("자료 새로 확인")} disabled={busy} onPress={() => { setError(''); setRevision((v) => v + 1); }} /></>}{notice && <ThemedText accessibilityLiveRegion="polite">{tr(notice)}</ThemedText>}
    {activeTab === 'overview' && sidebar && <MerchantHome name={data.merchant.name} place={`${tr(data.merchant.city_name)} · ${data.merchant.owner_verified_at ? tr('비즈니스 소유 확인됨') : tr('비즈니스 소유 확인 대기')}`} onChoose={onChoose}
      purposes={draftPurposes} purpose={purpose} onPurpose={value => setPurpose(value as (typeof draftPurposes)[number])} facts={facts} onFacts={setFacts}
      onGenerate={() => { void startHomeDraft(true); }} onWrite={() => { void openDraft(undefined, true); }} resume={dirty ? () => { setDraftView('composer'); setTab('drafts'); } : undefined}
      recent={recent} onAllPosts={() => selectNav('posts')} aiEnabled={aiAllowed} aiOwner={aiOwner} onOpenAi={() => selectNav('ai')} onOpenReviews={fullAccess ? () => selectNav('reviews') : undefined} busy={busy} />}
    {activeTab === 'overview' && !sidebar && <>
      <View style={[styles.storeCard, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <View style={styles.businessHeader}>
          <View style={[styles.storeLogo, { backgroundColor: theme.backgroundSelected }]}><SymbolView name={tileIcon('storefront', 'storefront')} size={26} tintColor={theme.accent} /></View>
          <View style={styles.toolText}><ThemedText type="subtitle">{data.merchant.name}</ThemedText><ThemedText type="small" themeColor="textSecondary">{tr(data.merchant.city_name)} · {data.merchant.owner_verified_at ? tr("비즈니스 소유 확인됨") : tr("비즈니스 소유 확인 대기")}</ThemedText></View>
          {onChoose && <Action label={tr("비즈니스 변경")} disabled={busy} onPress={onChoose} />}
        </View>
        {data.metrics && <>
          <View style={styles.kpis}>{([[tr('처음 읽은 회원'), data.metrics.unique_readers], [tr('원문 클릭'), data.metrics.source_clicks], [tr('새 글'), data.metrics.new_posts]] as const).map(([label, value]) =>
            <View key={label} style={[styles.kpi, { backgroundColor: theme.backgroundElement }]} accessible accessibilityLabel={`${label} ${value}`}><ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{label}</ThemedText><ThemedText type="subtitle">{Number(value).toLocaleString(appLocale)}</ThemedText></View>)}</View>
          <ThemedText type="small" themeColor="textSecondary">{tr("최근 14일 기준이에요.")}</ThemedText>
        </>}
      </View>
      <Action primary label={tr("소식 쓰기")} disabled={busy} onPress={() => { void openDraft(undefined, true); }} />
      {dirty && <Action label={tr("작성 중인 초안 이어쓰기")} disabled={busy} onPress={() => { setDraftView('composer'); setTab('drafts'); }} />}
      {([
        [tr("알리기"), <>
          <ToolTile title={tr("소식·초안")} detail={tr("쓰고 있는 글과 저장한 초안")} icon={tileIcon('square.and.pencil', 'edit_note')} badge={openDrafts ? tr("작성 중 {0}", openDrafts) : undefined} disabled={busy} onPress={() => goTool('drafts')} />
          <ToolTile title={tr("게시한 글")} detail={tr("올린 글을 고치거나 내려요")} icon={tileIcon('doc.text', 'description')} disabled={busy} onPress={() => goTool('posts')} />
          {fullAccess && <ToolTile title={tr("채널 연결")} detail={tr("네이버 카페·SNS에도 올려요")} icon={tileIcon('link', 'link')} disabled={busy} onPress={() => goTool('channels')} />}
        </>, true],
        [tr("손님"), <>
          {inboxAllowed && <ToolTile title={tr("대화함")} detail={tr("손님이 보낸 문의")} icon={tileIcon('bubble.left.and.bubble.right', 'forum')} disabled={busy} onPress={() => { void openBusinessInbox(); }} />}
          {fullAccess && <ToolTile title={tr("이용 후기")} detail={tr("후기를 보고 답글을 달아요")} icon={tileIcon('star', 'star')} disabled={busy} onPress={() => goTool('reviews')} />}
        </>, inboxAllowed || fullAccess],
        [tr("가게 운영"), <>
          <ToolTile title={tr("원가 계산")} detail={tr("하나 팔면 얼마 남는지")} icon={tileIcon('percent', 'calculate')} disabled={busy} onPress={() => goTool('cost')} />
          <ToolTile title={tr("재고")} detail={tr("품목 {0}개", data.items.length)} icon={tileIcon('shippingbox', 'inventory_2')} badge={lowItems.length ? tr("부족 {0}", lowItems.length) : undefined} warn disabled={busy} onPress={() => goTool('stock')} />
        </>, fullAccess],
        [tr("가게 설정"), <>
          <ToolTile title={tr("프로필·사진")} detail={tr("손님에게 보이는 가게 정보")} icon={tileIcon('storefront', 'storefront')} disabled={busy} onPress={() => goTool('profile')} />
          {fullAccess && <ToolTile title={tr("계정·권한")} detail={tr("함께 운영하는 사람")} icon={tileIcon('person.2', 'group')} disabled={busy} onPress={() => goTool('accounts')} />}
          {fullAccess && <ToolTile title={tr("성과·멤버십")} detail={tr("최근 성과와 이용 등급")} icon={tileIcon('chart.bar', 'bar_chart')} disabled={busy} onPress={() => goTool('membership')} />}
        </>, true],
      ] as const).filter(([, , shown]) => shown).map(([title, tiles]) => <View key={title} style={styles.tileGroup}>
        <ThemedText type="smallBold" themeColor="textSecondary" accessibilityRole="header">{title}</ThemedText><View style={styles.tiles}>{tiles}</View>
      </View>)}
    </>}
    {activeTab === 'posts' && <MerchantWebPosts bare={sidebar} merchantId={id} posts={data.posts} onChanged={() => setRevision(v => v + 1)} />}
    <View style={{ display: activeTab === 'profile' ? 'flex' : 'none' }}><MerchantProfileEditor bare={sidebar} merchantId={id} onDirty={setProfileDirty} /></View>
    {fullAccess && (activeTab === 'reviews' || replyDirty) && <View style={{ display: activeTab === 'reviews' ? 'flex' : 'none' }} accessibilityElementsHidden={activeTab !== 'reviews'} importantForAccessibility={activeTab !== 'reviews' ? 'no-hide-descendants' : 'auto'}>
      <MerchantReviewInbox bare={sidebar} merchantId={id} onDirty={setReplyDirty} />
    </View>}
    {activeTab === 'channels' && <><MerchantChannelList /><MerchantNaverCafe merchantId={id} drafts={data.drafts} onChanged={() => setRevision(v => v + 1)} /></>}
    {activeTab === 'drafts' && <>
      <View style={styles.actions}>{draftView === 'composer' && <Action label={tr("홍보글 목록")} disabled={busy} onPress={() => setDraftView('list')} />}{draftView === 'list' && dirty && <Action label={tr("작성 중인 초안 이어쓰기")} disabled={busy} onPress={() => setDraftView('composer')} />}</View>
      {draftView === 'list' && <Section title={sidebar ? tr('원고 목록') : tr("홍보글 관리")}>
        {!sidebar && <Action primary label={tr("새 초안")} disabled={busy} onPress={() => { void openDraft(undefined, !aiAllowed); }} />}
        <MerchantSegments value={draftFilter} disabled={busy} onChange={(filter) => { setDraftFilter(filter); setSelection([]); }} items={[
          { key: 'open', label: tr('작성 중 {0}', data.drafts.filter(d => draftMatches(d, 'open')).length) },
          { key: 'published', label: tr('게시됨 {0}', data.drafts.filter(d => draftMatches(d, 'published')).length) },
          { key: 'archived', label: tr('보관함') },
        ]} />
        {data.drafts.filter((d) => draftMatches(d, draftFilter)).map((d) => <View key={d.id} style={styles.draftRow}>
          <Pressable analyticsId="merchant.select_draft" accessibilityRole="checkbox" accessibilityLabel={tr("{0} 선택", (d.title))} accessibilityState={{ checked: selection.includes(d.id), disabled: busy }} aria-checked={selection.includes(d.id)} disabled={busy} onPress={() => toggleDraft(d.id)}
            {...(Platform.OS === 'web' ? { onKeyDown: (event: KeyDownEvent) => { if (event.nativeEvent.key === ' ') { event.preventDefault(); toggleDraft(d.id); } } } : {})}
            style={styles.checkbox}><ThemedText>{selection.includes(d.id) ? '☑' : '□'}</ThemedText></Pressable>
          <Pressable analyticsId="merchant.open_draft" accessibilityRole="button" accessibilityLabel={`${d.title}, ${MERCHANT_CHANNELS[d.channel]}`} disabled={busy} onPress={() => { play('selection'); void openDraft(d); }} style={styles.draftTitle}><ThemedText type="smallBold">{d.title}</ThemedText><ThemedText type="small" themeColor="textSecondary">{MERCHANT_CHANNELS[d.channel]} · {new Date(d.updated_at).toLocaleDateString(appLocale)}</ThemedText></Pressable>
          <MerchantBadge label={d.published_at ? tr("글링 게시됨") : d.external_url ? tr("카페 URL 기록됨") : d.approved_at ? tr("승인됨") : tr("초안")} tone={d.published_at || d.external_url ? 'ok' : d.approved_at ? 'accent' : 'neutral'} />
        </View>)}
        {!data.drafts.some((d) => draftMatches(d, draftFilter)) && <ThemedText type="small" themeColor="textSecondary">{draftFilter === 'archived' ? tr("보관한 원고가 없어요.") : draftFilter === 'published' ? tr('아직 게시한 원고가 없어요.') : tr("새 초안을 작성해 주세요.")}</ThemedText>}
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
        {!published && <MerchantSteps steps={[tr('내용'), tr('원고 확인'), tr('게시할 곳')]} current={draftStep === 'idea' ? 0 : draftStep === 'edit' ? 1 : 2} />}
        {draftChanged && <ThemedText accessibilityRole="alert">{tr(errorText(new Error('MERCHANT_DRAFT_CHANGED')))}</ThemedText>}
        {draftStep === 'idea' && !aiAllowed ? <>
          <ThemedText type="small" themeColor="textSecondary">{tr('AI 초안은 유료 비즈니스 멤버십에서 쓸 수 있어요. 직접 작성은 계속할 수 있어요.')}</ThemedText>
          <Action primary label={tr("직접 작성할게요")} disabled={busy} onPress={() => setDraftStep('edit')} />
        </> : draftStep === 'idea' ? <>
          <View style={styles.actions}>{draftPurposes.map((label) => <Action key={label} label={tr(label)} selected={purpose === label} disabled={busy} onPress={() => { setPurpose(label); setDirty(true); }} />)}</View>
          <Field label={tr("이번에 알릴 내용 (필수)")} value={facts} maxLength={1000} multiline disabled={busy} placeholder={tr("예: 새 닭강정 도시락을 소개하고 싶어요.\n12달러이고 토요일부터 판매해요.")} onChange={(value) => { setFacts(value); setDirty(true); }} />
          <ThemedText type="small" themeColor="textSecondary">{tr("입력하지 않은 가격·날짜는 만들어 넣지 않아요. 가게 이름·도시와 입력 내용이 AI에 전달돼요.")}</ThemedText>
          <Action primary label={tr(busy ? tr("초안 만드는 중…") : tr("AI로 초안 만들기"))} disabled={busy || !facts.trim()} onPress={() => { void generateDraft(); }} />
          <Action label={tr("직접 작성할게요")} disabled={busy} onPress={() => setDraftStep('edit')} />
        </> : draftStep === 'edit' ? <>
        {!published && <View style={styles.actions}>{aiAllowed && <Action label={tr("AI로 다시 작성")} disabled={busy} onPress={() => setDraftStep('idea')} />}<Action label={tr("초안 저장")} disabled={busy || draftChanged || !editor.title.trim() || !editor.body.trim() || !!saved?.archived_at} onPress={() => { void saveEditor(); }} /></View>}
        {aiDraftReady && <ThemedText type="small" accessibilityLiveRegion="polite" themeColor="textSecondary">{tr("AI 초안이에요. 가격·시간·연락처를 확인하고 사장님 말투로 고쳐도 좋아요.")}</ThemedText>}
        {editor.channel !== 'gling' && <><ThemedText type="small">{tr("원고 채널")}</ThemedText><View style={styles.actions}>{Object.entries(MERCHANT_CHANNELS).map(([key, label]) => <Action key={key} label={label} selected={editor.channel === key} disabled={busy || published} onPress={() => changeDraft({ channel: key as MerchantChannel })} />)}</View></>}
        <Field label={tr("제목")} value={editor.title} maxLength={100} disabled={busy || published} onChange={(title) => changeDraft({ title })} />
        <View style={styles.field}><ThemedText type="small" themeColor="textSecondary">{tr("게시글 본문")}</ThemedText>
          <PostBodyEditor accessibilityLabel={tr("게시글 본문")} value={editor.body} cityName={CITIES.find(city => city.id === data.merchant.city_id)?.englishName} allowLocation={editor.channel === 'gling'} maxLength={editor.channel === 'gling' ? 1000 : 4700} multiline editable={!busy && !published} onChangeText={(body) => changeDraft({ body })}
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
    {activeTab === 'cost' && <>
      <View style={styles.chips}>
        {costMenus.map(menu => { const on = sameCost(menu.values); return <Pressable key={menu.name} analyticsId="merchant.cost.menu" accessibilityRole="button" accessibilityLabel={tr("{0} 계산 불러오기", menu.name)} accessibilityHint={tr("길게 누르면 지울 수 있어요.")} accessibilityState={{ selected: on }}
          onPress={() => { play('selection'); setCost({ ...menu.values }); }} onLongPress={() => { play('selection'); void deleteCostMenu(menu); }}
          style={({ pressed }) => [styles.chip, { backgroundColor: on ? theme.text : theme.card, borderColor: theme.line, opacity: pressed ? 0.7 : 1 }]}>
          <ThemedText type="smallBold" style={{ color: on ? theme.background : theme.text }}>{menu.name}</ThemedText></Pressable>; })}
        <Action label={tr("메뉴로 저장")} disabled={busy || !calculated} onPress={askCostMenuName} />
        {costKeys.some(key => cost[key]) && <Action label={tr("새로 계산")} disabled={busy} onPress={() => setCost(emptyCost())} />}
      </View>
      {menuName !== null && <View style={styles.row2}><View style={styles.half}><Field label={tr("메뉴 이름")} value={menuName} maxLength={30} placeholder={tr("예: 단호박 라떼")} onChange={setMenuName} /></View>
        <Action label={tr("저장")} disabled={!menuName.trim()} onPress={() => saveCostMenu(menuName)} /><Action label={tr("취소")} onPress={() => setMenuName(null)} /></View>}
      <View style={[styles.storeCard, { backgroundColor: theme.card, borderColor: theme.line }]}>
        {calculated ? <>
          <ThemedText type="small" themeColor="textSecondary">{tr("하나 팔면 남는 돈")}</ThemedText>
          <View style={styles.bigRow}><ThemedText type="title" style={calculated.contribution < 0 ? { color: theme.danger } : undefined}>{money(calculated.contribution)}</ThemedText>
            {calculated.marginPercent !== null && <ThemedText type="smallBold" themeColor="textSecondary">{tr("마진 {0}%", Math.round(calculated.marginPercent))}</ThemedText>}</View>
          {costTotal > 0 && <>
            <View style={[styles.costBar, { backgroundColor: theme.backgroundElement }]} accessible={false}>{costParts.map(([label, value, color]) => value > 0 ? <View key={label} style={{ flex: value / costTotal, backgroundColor: color }} /> : null)}</View>
            <View style={styles.legend}>{costParts.map(([label, value, color]) => <View key={label} style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: color }]} /><ThemedText type="small" themeColor="textSecondary">{`${label} ${value.toFixed(2)}`}</ThemedText></View>)}</View>
          </>}
          {!costInput.price ? <ThemedText type="small" themeColor="textSecondary">{tr("판매가를 넣으면 남는 돈이 보여요.")}</ThemedText>
            : calculated.contribution < 0 ? <ThemedText type="small" style={{ color: theme.danger }}>{tr("파는 값보다 드는 돈이 더 많아요.")}</ThemedText> : null}
          <ThemedText type="small" themeColor="textSecondary">{tr("개당 변동 원가 {0} · 원가율 {1}%", money(calculated.unitCost), calculated.costPercent?.toFixed(1) ?? '—')}</ThemedText>
        </> : <ThemedText accessibilityRole="alert">{tr(errorText(new Error('INVALID_COST_INPUT')))}</ThemedText>}
      </View>
      <Section title={tr("만드는 데 드는 돈")}>
        <ThemedText type="small" themeColor="textSecondary">{tr("한 번 만드는 묶음 기준으로 넣어요. 금액은 CAD예요.")}</ThemedText>
        <View style={styles.row2}><View style={styles.half}><Field label={tr("묶음 전체 재료비")} value={cost.batchCost} numeric placeholder="0.00" onChange={(value) => setCost({ ...cost, batchCost: value })} /></View><View style={styles.half}><Field label={tr("나오는 개수")} value={cost.yield} numeric placeholder="1" onChange={(value) => setCost({ ...cost, yield: value })} /></View></View>
        <View style={styles.row2}><View style={styles.half}><Field label={tr("개당 포장비")} value={cost.packaging} numeric placeholder="0.00" onChange={(value) => setCost({ ...cost, packaging: value })} /></View><View style={styles.half}><Field label={tr("개당 기타비")} value={cost.other} numeric placeholder={tr("없으면 비워 두세요")} onChange={(value) => setCost({ ...cost, other: value })} /></View></View>
      </Section>
      <Section title={tr("파는 값")}>
        <View style={styles.row2}><View style={styles.half}><Field label={tr("개당 판매가")} value={cost.price} numeric placeholder="0.00" onChange={(value) => setCost({ ...cost, price: value })} /></View><View style={styles.half}><Field label={tr("결제·판매 수수료율 (%)")} value={cost.feePercent} numeric placeholder="0" onChange={(value) => setCost({ ...cost, feePercent: value })} /></View></View>
      </Section>
      <ThemedText type="small" themeColor="textSecondary">{tr("임대료·인건비·세금 전 금액이라 순이익과 달라요.")}</ThemedText>
      <MerchantHelp items={[tr("공헌이익은 판매가에서 입력한 변동 비용을 뺀 금액이에요."), tr("저장한 메뉴는 이 기기에만 남아요. 길게 누르면 지울 수 있어요.")]} />
      <Action label={tr("계산 내역 복사·공유")} disabled={!calculated || busy} onPress={() => { if (calculated) void run(() => shareText(`${data.merchant.name} 원가 계산\n전체 재료비 ${money(costInput.batchCost)} / 수량 ${costInput.yield}\n개당 포장비 ${money(costInput.packaging)} · 기타비 ${money(costInput.other)}\n판매가 ${money(costInput.price)} · 수수료 ${costInput.feePercent}%\n개당 변동 원가 ${money(calculated.unitCost)}\n개당 공헌이익 ${money(calculated.contribution)} (고정비·세금 반영 전)`), '계산 내역을 준비했어요.', false); }} />
    </>}
    {activeTab === 'stock' && <>
      {lowItems.length > 0 && <View style={[styles.alert, { backgroundColor: theme.backgroundElement, borderColor: merchantToneColor(theme, 'warn') }]} accessible accessibilityLabel={tr("{0}개 품목이 부족해요: {1}", lowItems.length, lowItems.map(i => i.name).join(', '))}>
        <SymbolView name={tileIcon('exclamationmark.triangle.fill', 'warning')} size={22} tintColor={merchantToneColor(theme, 'warn')} />
        <View style={styles.toolText}><ThemedText type="smallBold">{tr("{0}개 품목이 부족해요", lowItems.length)}</ThemedText><ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{lowItems.map(i => i.name).join(', ')}</ThemedText></View>
      </View>}
      <View style={styles.businessHeader}>
        <View style={styles.toolText}>{data.items.length > 0 && <MerchantSegments value={stockFilter} disabled={busy} onChange={setStockFilter} items={[{ key: 'all', label: tr("전체 {0}", data.items.length) }, { key: 'low', label: tr("부족 {0}", lowItems.length) }]} />}</View>
        <Action label={tr(itemOpen ? "품목 닫기" : "＋ 품목")} disabled={stockLocked} onPress={() => { if (!itemOpen) setItem({ id: merchantEventId(), name: '', unit: '개', unit_cost: '0', low_stock: '0' }); setItemOpen(!itemOpen); }} />
      </View>
      {(itemOpen || !data.items.length) && <Section title={data.items.some(i => i.id === item.id) ? tr("품목 수정") : tr("새 품목")}>
        <View style={styles.row2}><View style={styles.half}><Field label={tr("품목 이름")} value={item.name} disabled={stockLocked} onChange={(name) => setItem({ ...item, name })} /></View><View style={styles.half}><Field label={tr("단위")} value={item.unit} maxLength={20} disabled={stockLocked} onChange={(unit) => setItem({ ...item, unit })} /></View></View>
        <View style={styles.row2}><View style={styles.half}><Field label={tr("개당 원가 (CAD)")} value={item.unit_cost} numeric disabled={stockLocked} onChange={(unit_cost) => setItem({ ...item, unit_cost })} /></View><View style={styles.half}><Field label={tr("재고 부족 기준")} value={item.low_stock} numeric disabled={stockLocked} onChange={(low_stock) => setItem({ ...item, low_stock })} /></View></View>
        <Action primary label={tr("품목 저장")} disabled={stockLocked || !item.name.trim() || !item.unit.trim() || !Number.isFinite(amount(item.unit_cost)) || amount(item.unit_cost) < 0 || !Number.isFinite(amount(item.low_stock)) || amount(item.low_stock) < 0} onPress={() => { void run(async () => { await saveMerchantItem(supabase, id, { ...item, unit_cost: amount(item.unit_cost), low_stock: amount(item.low_stock) }); setItem({ id: merchantEventId(), name: '', unit: '개', unit_cost: '0', low_stock: '0' }); setItemOpen(false); }, '품목을 저장했어요. 수량은 아래에서 ±로 바꿔 주세요.'); }} />
      </Section>}
      {data.items.length > 0 && <View style={[styles.storeCard, { backgroundColor: theme.card, borderColor: theme.line }]}>
        {shownItems.map((i) => { const delta = (changes[i.id] ?? '').trim(); return <View key={i.id} style={[styles.stockItem, { borderColor: theme.line }]}>
          <View style={styles.toolText}>
            <View style={styles.actions}><ThemedText type="smallBold">{i.name}</ThemedText>{Number(i.quantity) <= Number(i.low_stock) && <MerchantBadge label={tr("부족")} tone="warn" />}
              <Pressable analyticsId="merchant.action" accessibilityRole="button" accessibilityLabel={tr("{0} 수정", i.name)} disabled={stockLocked} onPress={() => { play('selection'); setItem({ ...i, unit_cost: String(i.unit_cost), low_stock: String(i.low_stock) }); setItemOpen(true); }} style={styles.textButton}><ThemedText type="small" themeColor="accent">{tr("수정")}</ThemedText></Pressable></View>
            <ThemedText type="small" themeColor="textSecondary">{tr("지금 {0}{1} · 기준 {2}{1}", Number(i.quantity), i.unit, Number(i.low_stock))}</ThemedText>
            {!stockPending && !!delta && <ThemedText type="small" themeColor="accent">{tr("변경 후") + " "}{Number(i.quantity) + amount(delta)}{i.unit}</ThemedText>}
          </View>
          <View style={[styles.stepper, { backgroundColor: theme.backgroundElement }]}>
            <Pressable analyticsId="merchant.stock.step" accessibilityRole="button" accessibilityLabel={tr("{0} 1 빼기", i.name)} accessibilityState={{ disabled: stockLocked }} disabled={stockLocked} onPress={() => { play('selection'); stockStep(i.id, -1); }} style={styles.stepButton}><ThemedText type="subtitle" themeColor="accent">−</ThemedText></Pressable>
            <TextInput accessibilityLabel={tr("{0} 입출고 수량", i.name)} value={changes[i.id] ?? ''} onChangeText={(value) => setChanges({ ...changes, [i.id]: value })} placeholder="0" editable={!stockLocked} maxLength={14}
              keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'} placeholderTextColor={theme.textSecondary} style={[styles.stepInput, { color: theme.text }]} />
            <Pressable analyticsId="merchant.stock.step" accessibilityRole="button" accessibilityLabel={tr("{0} 1 더하기", i.name)} accessibilityState={{ disabled: stockLocked }} disabled={stockLocked} onPress={() => { play('selection'); stockStep(i.id, 1); }} style={styles.stepButton}><ThemedText type="subtitle" themeColor="accent">+</ThemedText></Pressable>
          </View>
        </View>; })}
        {!shownItems.length && <ThemedText type="small" themeColor="textSecondary">{tr("부족한 품목이 없어요.")}</ThemedText>}
      </View>}
      {data.items.length > 0 && <View style={[styles.storeCard, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <ThemedText type="smallBold">{stockChanges.length ? stockChanges.map((c) => `${data.items.find((i) => i.id === c.item_id)?.name} ${c.delta > 0 ? '+' : ''}${Number.isFinite(c.delta) ? c.delta : '?'}`).join(' · ') : tr("±로 바꿀 수량을 정해 주세요.")}</ThemedText>
        {stockChanges.length > 0 && <ThemedText type="small" themeColor="textSecondary">{tr("바꾼 품목 {0}개", stockChanges.length)}</ThemedText>}
        <Field label={tr("입출고 사유")} value={stockNote} maxLength={300} placeholder={tr("예: 오전 입고, 주말 행사에 씀")} disabled={stockLocked} onChange={setStockNote} />
        {stockChanges.length > 1 && data.merchant.plan === 'basic' && <ThemedText type="small">{tr("기본 이용에서는 한 품목씩 기록할 수 있어요.")}</ThemedText>}
        {!stockReady && <ThemedText type="small" accessibilityLiveRegion="polite">{tr(stockRestoreError ? tr("이전 입출고 요청을 확인해야 새 수량을 입력할 수 있어요.") : tr("이 계정·비즈니스의 이전 입출고 요청을 확인하고 있어요."))}</ThemedText>}
        {!stockReady && stockRestoreError && <Action label={tr("입출고 요청 다시 확인")} disabled={busy} onPress={() => { setError(''); setStockRecoveryRevision((v) => v + 1); }} />}
        <Action primary label={tr(stockPending ? tr("같은 입출고 요청 재확인") : tr("이유 적고 저장"))} disabled={busy || !stockReady || (!stockPending && !stockValid)} onPress={() => { void submitStock(); }} />
        {stockPending && <ThemedText type="small" accessibilityLiveRegion="polite" themeColor="textSecondary">{tr("입출고 요청을 보관했어요. 결과가 확인될 때까지 수량과 사유는 고정돼요. 매장을 바꾸거나 앱을 다시 열어도 같은 요청 재확인 버튼으로 원래 요청의 결과를 확인할 수 있어요.")}</ThemedText>}
      </View>}
      {data.movements.length > 0 && <Section title={tr("최근 기록")}>
        {data.movements.slice(0, allMovements ? 20 : 5).map((m) => <View key={m.id} style={[styles.stockItem, { borderColor: theme.line }]}>
          <View style={styles.toolText}><ThemedText type="small">{m.item_name} {Number(m.delta) > 0 ? '+' : ''}{m.delta}</ThemedText><ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{m.note}</ThemedText></View>
          <ThemedText type="small" themeColor="textSecondary">{new Date(m.created_at).toLocaleDateString(appLocale)}</ThemedText>
        </View>)}
        {data.movements.length > 5 && <Action label={tr(allMovements ? "접기" : "모두 보기")} onPress={() => setAllMovements(!allMovements)} />}
      </Section>}
      <MerchantHelp items={[tr("입고는 ＋, 출고는 −로 입력해요."), tr("소수점은 세 자리까지 넣을 수 있어요.")]} />
    </>}
    {activeTab === 'accounts' && <MerchantAccountManagement bare={sidebar} merchantName={data.merchant.name} merchantId={id} refreshSignal={refreshSignal + revision} onChanged={() => { setRevision(v => v + 1); onConnectionsChanged?.(); }} />}
    {activeTab === 'accounts' && data.merchant.owner_id === me.id && !!data.merchant.owner_verified_at && <MerchantOperatorInvites merchantId={id} refreshSignal={refreshSignal + revision} onChanged={() => setRevision(v => v + 1)} />}
    {activeTab === 'membership' && (data.metrics ? <>
      <MerchantStats>
        <MerchantStat label={tr("새 글")} value={tr("{0}편", data.metrics.new_posts)} />
        <MerchantStat label={tr("처음 읽은 회원")} value={tr("{0}명", data.metrics.unique_readers)} />
        <MerchantStat label={tr("원문 클릭")} value={tr("{0}회", data.metrics.source_clicks)} />
        <MerchantStat label={tr("연결된 글")} value={tr("{0}편", data.metrics.linked_posts)} />
      </MerchantStats>
      <View style={styles.columns}>
        <View style={styles.column}><Section title={businessMembership ? ({ free: tr("베이직"), plus: tr("플러스"), pro: tr("프로"), premium: tr("프리미엄"), admin: tr("관리자") })[businessMembership.tier] : tr("비즈니스 멤버십")}>
          {businessMembership ? <>
            {businessMembership.postLimit != null ? <MerchantMeter label={tr("이번 달 새 글")} value={businessMembership.postsUsed} max={businessMembership.postLimit} />
              : <ThemedText type="small">{tr("이번 달 새 글 {0}편 · 기존 약정 유지", businessMembership.postsUsed)}</ThemedText>}
            {businessMembership.bumpLimit != null ? <MerchantMeter label={tr("끌어올리기")} value={businessMembership.bumpsUsed} max={businessMembership.bumpLimit} />
              : <ThemedText type="small">{tr("끌어올리기 {0}회 · 한도 없음", businessMembership.bumpsUsed)}</ThemedText>}
            <ThemedText type="small" themeColor="textSecondary">{tr("{0}에 초기화돼요. 직원·AI도 같은 한도를 써요.", new Date(businessMembership.resetsAt).toLocaleDateString(appLocale))}</ThemedText>
            {businessMembership.tier === 'premium' && <ThemedText type="small" themeColor="textSecondary">{tr("전체 30편·24회에 운영대행 신규 4편·끌어올리기 8회·보고서 1회가 포함돼요.")}</ThemedText>}
          </> : <ThemedText type="small">{tr("멤버십 사용량을 확인하지 못했어요. 비즈니스 연결 상태를 확인하고 다시 열어 주세요.")}</ThemedText>}
        </Section></View>
        <View style={styles.column}><Section title={tr("이용 상태")}>
          <View style={styles.actions}><MerchantBadge label={({ basic: tr("기본 이용"), trial: tr("비즈니스 체험"), pro: tr("비즈니스 유료 운영") })[data.merchant.plan]} tone={data.merchant.plan === 'basic' ? 'neutral' : 'accent'} />
            {data.merchant.plan !== 'basic' && planEnds && <ThemedText type="small" themeColor="textSecondary">{tr(data.merchant.plan === 'trial' ? "{0}까지 체험" : "{0}까지 운영", planEnds)}</ThemedText>}</View>
          <ThemedText type="small" themeColor="textSecondary">{data.merchant.plan === 'basic' ? tr("개별 초안·승인, 원가 계산, 품목별 입출고를 계속 이용할 수 있어요.") : tr("여러 건을 한 번에 승인하거나 입출고할 수 있어요.")}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{tr("기간이 끝나도 저장한 자료는 남아요.")}</ThemedText>
        </Section></View>
      </View>
      {data.reports.length > 0 && <Section title={tr("성과 보고서")}><View style={styles.actions}>{data.reports.map((report) => <Action key={report.id} label={tr("{0} 보고서 공유", (report.period_end))} disabled={busy} onPress={() => { void run(() => shareText(merchantReportText(report)), '저장된 보고서를 준비했어요.', false); }} />)}</View></Section>}
      <MerchantHelp label={tr("측정 기준과 이용 규칙")} items={[
        tr("로그인 회원 최초 열람 {0}회 · {1}명", data.metrics.first_reads, data.metrics.unique_readers),
        tr("로그인 클릭 회원 {0}명 · 익명 클릭 세션 {1}개", data.metrics.member_clickers, data.metrics.anonymous_sessions),
        tr("누적 표시 조회 {0}회는 익명 조회·운영 조정을 포함해 실제 열람 인원과 달라요.", data.metrics.displayed_views),
        tr("원문 클릭은 문의·주문 완료를 뜻하지 않아요."),
        tr("비즈니스 소유자·작성자·관리자 기록은 측정 성과에서 제외해요."),
        tr("같은 홍보글은 새 글로 다시 올리지 않고 기존 글을 수정하거나 끌어올려 주세요."),
        tr("체험·기존 운영 기간 또는 비즈니스 유료 멤버십에서는 여러 건을 한 번에 승인하거나 입출고할 수 있어요."),
        tr("개인 멤버십과 비즈니스 구독은 별도로 관리해요."),
        tr("앱의 멤버십 → 비즈니스에서 스토어 상품이 준비되면 가입할 수 있어요."),
      ]} />
    </> : <Section title={tr("성과·멤버십")}><ThemedText>{tr("성과 정보를 아직 불러오지 못했어요.")}</ThemedText><Action label={tr("다시 확인")} disabled={busy} onPress={() => { setError(''); setRevision(v => v + 1); }} /></Section>)}
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
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }, column: { flexGrow: 1, flexBasis: 300, minWidth: 0 },
  storeCard: { gap: 12, padding: 16, borderWidth: 1, borderRadius: 20, borderCurve: 'continuous' },
  storeLogo: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  kpis: { flexDirection: 'row', gap: 8 }, kpi: { flex: 1, minWidth: 0, gap: 2, padding: 10, borderRadius: 14 },
  tileGroup: { gap: 8 }, tiles: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  tile: { width: '48.5%', minHeight: 96, padding: 12, gap: 10, borderWidth: 1, borderRadius: 16, borderCurve: 'continuous', justifyContent: 'space-between' },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 999, borderWidth: 1 },
  row2: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }, half: { flexGrow: 1, flexBasis: 140, minWidth: 0 },
  bigRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 },
  costBar: { flexDirection: 'row', height: 10, borderRadius: 99, overflow: 'hidden' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 }, legendDot: { width: 8, height: 8, borderRadius: 2 },
  alert: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1, borderRadius: 16 },
  stockItem: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, overflow: 'hidden' },
  stepButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepInput: { width: 56, minHeight: 44, textAlign: 'center', fontSize: 16, fontVariant: ['tabular-nums'] },
  textButton: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 4 },
  channelRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 }, channelText: { flex: 1, minWidth: 0, gap: 4 }, channelSwitch: { width: 52, height: 44 },
});
