import type { SupabaseClient } from '@supabase/supabase-js';
import { safeMerchantSourceUrl } from './merchant-source.ts';

export type PartnershipView = 'creators' | 'campaigns' | 'benefits';
export type PartnershipKind = 'creator' | 'campaign' | 'benefit' | 'participation';
type RecordBase = { id: string; created_at: string; updated_at: string };
export type CreatorProfile = { platform: string; url: string; followers: string; checked_on: string | null };
export type CreatorDeal = {
  id: string; creator_id: string; merchant_id: string | null; merchant_name: string | null;
  agreed_on: string; currency: 'CAD' | 'USD'; ad_fee_cents: number | null; meal_support_cents: number | null;
  deliverables: string; source_url: string; notes: string; created_at: string; recorded_by_name: string | null;
  collaboration_on?: string | null; updated_at?: string;
};
export type CreatorDealInput = Omit<CreatorDeal, 'merchant_name' | 'created_at' | 'recorded_by_name' | 'updated_at'>;
export const CREATOR_DEAL_SORTS = { date_desc: '최근 합의순', date_asc: '오래된 합의순', fee_asc: '광고비 낮은순', fee_desc: '광고비 높은순', support_asc: '식사 지원 낮은순', support_desc: '식사 지원 높은순', updated_desc: '정보 수정순' } as const;
export type CreatorDirectoryOptions = { sort: keyof typeof CREATOR_DEAL_SORTS; currency: 'CAD' | 'USD' };
export type Creator = RecordBase & {
  member_id: string | null; member_name: string | null; display_name: string; city_id: string; city_name: string;
  profile_url: string; category: string; contact: string; reference_url: string; reference_views: number | null;
  metrics_note: string; status: 'active' | 'paused'; notes: string; participation_count: number;
  platforms?: CreatorProfile[]; contact_name?: string; content_summary?: string; activity_regions?: string;
  latest_deal?: CreatorDeal | null; deal_count?: number;
};
export type Campaign = RecordBase & {
  merchant_id: string; merchant_name: string; city_name: string; title: string; status: 'draft' | 'open' | 'paused' | 'closed';
  terms: string; terms_confirmed: boolean; team_limit: number | null; minimum_views: number | null;
  support_amount_cents: number | null; currency: 'CAD' | 'USD' | null; deadline_note: string; ends_on: string | null;
  notes: string; selected_count: number; applicant_count: number;
};
export type Participation = RecordBase & {
  campaign_id: string; creator_id: string; creator_name: string; creator_profile_url: string; campaign_title: string;
  merchant_name: string; stage: 'applied' | 'selected' | 'visited' | 'submitted' | 'completed' | 'declined' | 'cancelled';
  scheduled_at: string | null; visited_at: string | null; content_url: string; actual_views: number | null;
  payment_status: 'not_applicable' | 'pending' | 'paid'; payment_note: string; notes: string;
};
export type Benefit = RecordBase & {
  merchant_id: string; merchant_name: string; campaign_id: string | null; campaign_title: string | null;
  title: string; audience: 'creators' | 'members'; status: 'draft' | 'active' | 'paused' | 'ended';
  discount_percent: number | null; terms: string; terms_confirmed: boolean; expires_on: string | null;
  issue_limit: number | null; issued_count: number; redeemed_count: number;
};
export type BenefitCoupon = RecordBase & {
  benefit_id: string; benefit_title: string; merchant_name: string; creator_id: string | null; user_id: string | null;
  recipient_name: string; code: string; status: 'issued' | 'redeemed' | 'revoked'; expires_on: string;
  terms_snapshot: Record<string, unknown>; redeemed_at: string | null; revoked_at: string | null; action_note: string;
  expired: boolean;
};
export type PartnershipRecord = Creator | Campaign | Benefit;
export type PartnershipEvent = { id: number; actor_name: string | null; resource_id: string; action: string; created_at: string };
export type PartnershipPage = {
  kind: PartnershipView; rows: PartnershipRecord[]; record: PartnershipRecord | null; more: boolean;
  participations: Participation[]; coupons: BenefitCoupon[]; events: PartnershipEvent[]; children_more: boolean;
  deals?: CreatorDeal[];
};

export function creatorPlatformName(value: string): string {
  try {
    const host = new URL(value).hostname.replace(/^(?:www|m)\./, '');
    return ({ 'instagram.com': 'Instagram', 'youtube.com': 'YouTube', 'youtu.be': 'YouTube', 'tiktok.com': 'TikTok', 'threads.com': 'Threads', 'threads.net': 'Threads', 'facebook.com': 'Facebook', 'x.com': 'X', 'twitter.com': 'X', 'blog.naver.com': '네이버 블로그' } as Record<string, string>)[host] ?? '웹사이트';
  } catch { return 'SNS'; }
}

export function creatorProfiles(creator: { profile_url?: string; platforms?: CreatorProfile[] }): CreatorProfile[] {
  const key = (value: string) => {
    const url = new URL(value), host = url.hostname.replace(/^www\./, '').replace(/^threads\.net$/, 'threads.com');
    let path = url.pathname.replace(/\/+$/, '');
    try { path = decodeURIComponent(path); } catch { /* Keep malformed URLs distinct; saving still validates them. */ }
    if ((host === 'instagram.com' && /^\/[^/]+$/.test(path))
      || (['threads.com', 'tiktok.com', 'youtube.com'].includes(host) && /^\/@[^/]+$/.test(path))) path = path.toLowerCase();
    return host + path;
  };
  const profiles = Array.isArray(creator.platforms) ? creator.platforms.filter(row => row && typeof row.url === 'string' && safeMerchantSourceUrl(row.url))
    .map(row => ({ ...row, followers: row.followers ?? '', checked_on: row.checked_on ?? null })) : [];
  const primary = typeof creator.profile_url === 'string' ? safeMerchantSourceUrl(creator.profile_url) : null;
  if (!primary) return profiles;
  const match = profiles.find(row => key(row.url) === key(primary));
  return [match ?? { platform: creatorPlatformName(primary), url: primary, followers: '', checked_on: null }, ...profiles.filter(row => key(row.url) !== key(primary))];
}

export const CREATOR_STATUSES = { active: '활동 중', paused: '중지' } as const;
export const CAMPAIGN_STATUSES = { draft: '제안·준비', open: '모집 중', paused: '일시 중지', closed: '모집 종료' } as const;
export const PARTICIPATION_STAGES = { applied: '지원 접수', selected: '선정', visited: '방문 확인', submitted: '콘텐츠 제출', completed: '완료', declined: '미선정', cancelled: '취소' } as const;
export const BENEFIT_STATUSES = { draft: '조건 준비', active: '사용 가능', paused: '일시 중지', ended: '종료' } as const;
export const PAYMENT_STATUSES = { not_applicable: '지원금 없음', pending: '지급 대기', paid: '지급 기록 완료' } as const;
export const PARTNERSHIP_ACTIONS: Record<string, string> = {
  creator_created: '크리에이터 등록', creator_saved: '크리에이터 정보 수정',
  creator_deal_recorded: '협업 합의 조건 기록',
  creator_deal_merchant_linked: '협업 벤더·날짜 연결',
  campaign_created: '캠페인 등록', campaign_saved: '캠페인 정보 수정',
  benefit_created: '혜택 등록', benefit_saved: '혜택 정보 수정',
  participation_created: '참여 팀 접수', participation_saved: '참여 진행 기록 수정', participation_selected: '참여 팀 선정',
  coupon_issued: '쿠폰 발급', coupon_redeemed: '쿠폰 사용 확인', coupon_revoked: '쿠폰 취소',
};

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const calendarDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01' && timestamp(value) && new Date(value).toISOString().slice(0, 10) === value;
const validRecord = (value: unknown, kind: PartnershipView) => {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && uuid.test(row.id) && timestamp(row.updated_at)
    && typeof row[kind === 'creators' ? 'display_name' : 'title'] === 'string';
};

function validCreatorDeal(value: unknown, saved = true): value is CreatorDeal {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && uuid.test(row.id) && typeof row.creator_id === 'string' && uuid.test(row.creator_id)
    && (row.merchant_id === null || typeof row.merchant_id === 'string' && uuid.test(row.merchant_id))
    && (row.collaboration_on == null || calendarDate(row.collaboration_on))
    && (row.updated_at === undefined || timestamp(row.updated_at))
    && ['CAD', 'USD'].includes(String(row.currency))
    && typeof row.agreed_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.agreed_on) && row.agreed_on >= '1900-01-01' && timestamp(row.agreed_on)
    && new Date(row.agreed_on).toISOString().slice(0, 10) === row.agreed_on
    && [row.ad_fee_cents, row.meal_support_cents].every(amount => amount === null || typeof amount === 'number' && Number.isInteger(amount) && amount >= 0 && amount <= 99999999)
    && typeof row.deliverables === 'string' && row.deliverables.trim().length > 0 && row.deliverables.length <= 300
    && typeof row.notes === 'string' && row.notes.trim().length > 0 && row.notes.length <= 3000
    && typeof row.source_url === 'string' && (row.source_url === '' || Boolean(safeMerchantSourceUrl(row.source_url)))
    && (!saved || timestamp(row.created_at) && (row.merchant_name === null || typeof row.merchant_name === 'string')
      && (row.recorded_by_name === null || typeof row.recorded_by_name === 'string'));
}

export function creatorDealAmount(cents: number | null, currency: 'CAD' | 'USD'): string {
  return cents === null ? '미확인' : new Intl.NumberFormat('en-CA', { style: 'currency', currency, currencyDisplay: 'code' }).format(cents / 100);
}

export function amountToCents(input: string): number | null {
  const value = input.trim();
  if (!value) return null;
  if (!/^(0|[1-9]\d{0,5})(\.\d{1,2})?$/.test(value)) throw new Error('INVALID_PARTNERSHIP');
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export async function loadPartnerships(client: SupabaseClient, kind: PartnershipView, search = '', offset = 0, id: string | null = null, childOffset = 0, directory?: CreatorDirectoryOptions): Promise<PartnershipPage> {
  if (!['creators', 'campaigns', 'benefits'].includes(kind) || !Number.isInteger(offset) || offset < 0 || offset > 10000
    || !Number.isInteger(childOffset) || childOffset < 0 || childOffset > 10000 || (id !== null && !uuid.test(id)) || search.length > 200) throw new Error('INVALID_PARTNERSHIP');
  if (directory && (kind !== 'creators' || !Object.keys(CREATOR_DEAL_SORTS).includes(directory.sort) || !['CAD', 'USD'].includes(directory.currency))) throw new Error('INVALID_PARTNERSHIP');
  const args = { p_search: search.trim(), p_offset: offset, p_id: id, p_child_offset: childOffset };
  const { data, error } = directory ? await client.rpc('get_admin_creator_directory', { ...args, p_sort: directory.sort, p_currency: directory.currency })
    : await client.rpc('get_admin_partnerships', { p_kind: kind, ...args });
  if (error) throw new Error(error.message);
  if (!data || data.kind !== kind || !Array.isArray(data.rows) || data.rows.length > 50 || !data.rows.every((row: unknown) => validRecord(row, kind))
    || typeof data.more !== 'boolean' || typeof data.children_more !== 'boolean'
    || !['participations', 'coupons', 'events'].every((key) => Array.isArray(data[key]) && data[key].length <= (key === 'events' ? 20 : 50))
    || (id ? !validRecord(data.record, kind) || data.record.id !== id : data.record !== null)) throw new Error('PARTNERSHIP_READ_FAILED');
  if (directory && (!Array.isArray(data.deals) || data.deals.length > 50 || !data.deals.every((row: unknown) => validCreatorDeal(row) && row.creator_id === id)
    || !data.rows.every((row: Creator) => typeof row.deal_count === 'number' && Number.isInteger(row.deal_count) && row.deal_count >= 0
      && (row.latest_deal === null || validCreatorDeal(row.latest_deal) && row.latest_deal.creator_id === row.id && row.latest_deal.currency === directory.currency)))) throw new Error('PARTNERSHIP_READ_FAILED');
  return data as PartnershipPage;
}

async function mutation(client: SupabaseClient, name: string, args: Record<string, unknown>, id: string): Promise<string> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  if (data !== id) throw new Error('PARTNERSHIP_SAVE_UNVERIFIED');
  return id;
}

export async function recordCreatorDeal(client: SupabaseClient, record: CreatorDealInput): Promise<string> {
  if (!validCreatorDeal(record, false)) throw new Error('INVALID_PARTNERSHIP');
  return mutation(client, 'record_admin_creator_deal', { p_record: record }, record.id);
}

export async function loadCreatorDeal(client: SupabaseClient, id: string): Promise<CreatorDeal> {
  if (!uuid.test(id)) throw new Error('INVALID_PARTNERSHIP');
  const { data, error } = await client.rpc('get_admin_creator_deal', { p_id: id });
  if (error) throw new Error(error.message);
  if (!validCreatorDeal(data) || data.id !== id) throw new Error('PARTNERSHIP_READ_FAILED');
  return data;
}

export async function linkCreatorDealMerchant(client: SupabaseClient, id: string, merchantId: string, collaborationOn: string | null, expectedUpdatedAt: string): Promise<string> {
  if (!uuid.test(id) || !merchantId || !uuid.test(merchantId) || !timestamp(expectedUpdatedAt) || (collaborationOn !== null && !calendarDate(collaborationOn))) throw new Error('INVALID_PARTNERSHIP');
  return mutation(client, 'link_admin_creator_deal_merchant', { p_id: id, p_merchant_id: merchantId, p_collaboration_on: collaborationOn, p_expected_updated_at: expectedUpdatedAt }, id);
}

export async function savePartnership(client: SupabaseClient, kind: PartnershipKind, record: { id: string } & Record<string, unknown>, expectedUpdatedAt: string | null): Promise<string> {
  if (!['creator', 'campaign', 'benefit', 'participation'].includes(kind) || !uuid.test(record.id) || (expectedUpdatedAt !== null && !timestamp(expectedUpdatedAt))) throw new Error('INVALID_PARTNERSHIP');
  return mutation(client, 'save_admin_partnership', { p_kind: kind, p_record: record, p_expected_updated_at: expectedUpdatedAt }, record.id);
}

export async function issueBenefitCoupon(client: SupabaseClient, id: string, benefitId: string, recipient: { creator_id: string | null; user_id: string | null }): Promise<string> {
  if (!uuid.test(id) || !uuid.test(benefitId) || Boolean(recipient.creator_id) === Boolean(recipient.user_id)
    || !uuid.test((recipient.creator_id ?? recipient.user_id)!)) throw new Error('INVALID_PARTNERSHIP');
  return mutation(client, 'issue_admin_benefit_coupon', { p_id: id, p_benefit_id: benefitId, p_creator_id: recipient.creator_id, p_user_id: recipient.user_id }, id);
}

export async function actBenefitCoupon(client: SupabaseClient, id: string, updatedAt: string, action: 'redeem' | 'revoke', note: string): Promise<string> {
  if (!uuid.test(id) || !timestamp(updatedAt) || !['redeem', 'revoke'].includes(action) || !note.trim() || note.trim().length > 1000) throw new Error('INVALID_PARTNERSHIP');
  return mutation(client, 'act_admin_benefit_coupon', { p_id: id, p_expected_updated_at: updatedAt, p_action: action, p_note: note.trim() }, id);
}

export function partnershipError(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return ({
    ADMIN_REQUIRED: '관리자 인증을 확인한 뒤 다시 로그인해 주세요.',
    INVALID_PARTNERSHIP: '이름·연결 대상·날짜·금액과 필수 조건을 확인해 주세요.',
    PARTNERSHIP_NOT_FOUND: '해당 자료를 찾지 못했습니다. 목록을 다시 확인해 주세요.',
    PARTNERSHIP_CHANGED: '다른 변경이 저장됐습니다. 입력을 확인하고 최신 자료를 다시 불러와 주세요.',
    PARTNERSHIP_READBACK_REQUIRED: '서버 저장은 완료됐습니다. 입력을 유지했으니 ‘저장 내용 다시 확인’을 눌러 주세요.',
    PARTNERSHIP_TERMS_REQUIRED: '업체 동의와 혜택 조건·기한·지원 통화를 먼저 확정해 주세요.',
    PARTNERSHIP_TERMS_LOCKED: '선정이나 쿠폰 발급 이력이 있어 조건을 바꿀 수 없습니다. 별도 캠페인이나 혜택을 등록해 주세요.',
    PARTNERSHIP_CAPACITY: '선정 정원 또는 쿠폰 발급 한도에 도달했습니다.',
    PARTNERSHIP_STAGE: '진행 단계와 방문·콘텐츠·지급 확인 내용을 확인해 주세요.',
    PARTNERSHIP_DUPLICATE: '이미 등록된 계정 또는 참여 팀입니다. 기존 기록을 확인해 주세요.',
    PARTNERSHIP_INACTIVE: '업체·크리에이터·캠페인 또는 혜택이 현재 이용 가능한 상태가 아닙니다.',
    COUPON_ALREADY_ISSUED: '이 대상에게 이미 발급한 혜택입니다. 발급 내역을 확인해 주세요.',
    COUPON_UNAVAILABLE: '이미 사용·취소됐거나 기한이 지난 쿠폰입니다. 최신 내역을 확인해 주세요.',
  } as Record<string, string>)[code] ?? '처리 결과를 확인하지 못했습니다. 입력은 유지했습니다. 최신 내역을 다시 확인해 주세요.';
}
