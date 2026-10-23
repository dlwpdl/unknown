import type { SupabaseClient } from '@supabase/supabase-js';

export type WebshopComparison = { id: string; name: string; uberCents: number; webCents: number };
export type CheckoutQuote = { itemsCents: number; deliveryCents: number; serviceCents: number; discountCents: number; taxCents: number; tipCents: number; totalCents: number };
export type CheckoutComparison = { verifiedAt: string; fulfillment: 'delivery' | 'pickup'; basketLabel: string; sameConditionsConfirmed: true; uber: CheckoutQuote; webshop: CheckoutQuote };
export type AdminWebshopConfig = {
  cityId: string; enabled: boolean; url: string | null; provider: 'uber'; placeKeys: string[];
  comparisons: WebshopComparison[]; verifiedAt: string | null; promoCode: string | null; checkoutComparison: CheckoutComparison | null;
  commissionBps: number; commissionBasisConfirmed: boolean; commissionScope: 'attributed' | 'all_webshop' | null; updatedAt: string | null;
};
export type AdminWebshop = AdminWebshopConfig & { merchantId: string; name: string };
export type WebshopOrderInput = {
  externalOrderId: string; orderedAt: string; currency: 'CAD'; foodSubtotalCents: number; refundCents: number;
  status: 'completed' | 'cancelled' | 'refunded' | 'partial_refund'; attribution: 'provider_report' | 'promo_code' | 'unattributed';
};
export type WebshopReport = { reportId: string; periodStart: string; periodEnd: string; evidence: string; orders: WebshopOrderInput[] };
export type WebshopMetrics = {
  sheetViews: number; clicks: number; sessions: number; orderDataAvailable: boolean;
  verifiedOrders: number | null; netRevenueCents: number | null; estimatedCommissionCents: number | null; currency: string | null;
  attributedVerifiedOrders: number | null; attributedNetRevenueCents: number | null;
};
export type AdminWebshops = {
  generatedAt: string; stores: AdminWebshop[]; totals: WebshopMetrics;
  breakdown: (WebshopMetrics & { merchantId: string; name: string })[];
  daily: { day: string; sheetViews: number; clicks: number; verifiedOrders: number | null; netRevenueCents: number | null }[];
  orders: (WebshopOrderInput & { reportId: string; merchantId: string; evidence: string })[];
};

const MAX_CENTS = 99_999_999;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONFIG_KEYS = ['cityId', 'enabled', 'url', 'provider', 'placeKeys', 'comparisons', 'verifiedAt', 'promoCode', 'checkoutComparison', 'commissionBps', 'commissionBasisConfirmed', 'commissionScope', 'updatedAt'];
const QUOTE_KEYS = ['itemsCents', 'deliveryCents', 'serviceCents', 'discountCents', 'taxCents', 'tipCents', 'totalCents'];
const fail = (message: string): never => { throw new Error(message); };
function object(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(`${label}: JSON 객체가 필요합니다.`);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key))) fail(`${label}: 허용되지 않은 필드가 있습니다. 고객·결제·주소 정보는 제외해주세요.`);
  return result;
}
function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) return fail(`${label}: 1–${max}자의 텍스트가 필요합니다.`);
  return value.trim();
}
function integer(value: unknown, label: string, max = MAX_CENTS): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) return fail(`${label}: 0–${max} 범위의 정수 센트가 필요합니다.`);
  return value;
}
function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return fail(`${label}: 시간대가 포함된 ISO 날짜가 필요합니다.`);
  const day = value.slice(0, 10);
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return fail(`${label}: 유효하지 않은 날짜입니다.`);
  return value;
}
function observedAt(value: unknown, label: string): string {
  const date = timestamp(value, label);
  if (Date.parse(date) > Date.now() + 300_000) fail(`${label}: 미래의 관측 날짜는 저장할 수 없습니다.`);
  return date;
}
function parseJson(value: string): unknown {
  if (value.length > 2_000_000) fail('JSON은 2MB 이하로 입력해주세요.');
  try { return JSON.parse(value); } catch { return fail('JSON 문법을 확인해주세요.'); }
}
function quote(value: unknown): CheckoutQuote {
  const result = object(value, '결제 견적', QUOTE_KEYS);
  for (const key of QUOTE_KEYS) integer(result[key], key);
  const q = result as CheckoutQuote;
  if (q.totalCents !== q.itemsCents + q.deliveryCents + q.serviceCents + q.taxCents + q.tipCents - q.discountCents) fail('결제 견적: 구성 금액과 합계가 일치하지 않습니다.');
  return q;
}

export function validateWebshopConfig(value: unknown): AdminWebshopConfig {
  const data = object(value, '웹샵 설정', CONFIG_KEYS);
  text(data.cityId, '도시 ID', 100);
  if (typeof data.enabled !== 'boolean' || data.provider !== 'uber') fail('사용 여부와 Uber 공급자를 확인해주세요.');
  if (data.url !== null) {
    if (typeof data.url !== 'string' || data.url.length > 2048 || !/^https:\/\/(?:www\.)?order\.store\/ca\/store\/[a-z0-9-]+(?:%26[a-z0-9-]+)*\/[A-Za-z0-9_-]{20,80}$/.test(data.url)) fail('URL: https://www.order.store/ca/store/지점/ID 형식만 지원합니다. 쿼리·계정·해시는 제외해주세요.');
    const url = new URL(data.url as string);
    if (url.username || url.password || url.port || url.search || url.hash || !['order.store', 'www.order.store'].includes(url.hostname)) fail('URL: 허용된 Uber 웹샵 주소만 저장할 수 있습니다.');
  } else if (data.enabled) fail('활성 웹샵에는 URL이 필요합니다.');
  if (!Array.isArray(data.placeKeys) || data.placeKeys.length > 50 || data.placeKeys.some(key => typeof key !== 'string' || key.length > 120 || !/^(?:osm:(?:node|way|relation):[1-9][0-9]{0,19}|partner:[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(key)) || new Set(data.placeKeys).size !== data.placeKeys.length) fail('장소 키: 같은 지점의 고유 osm:node|way|relation:ID 또는 partner:키를 입력해주세요.');
  if (!Array.isArray(data.comparisons) || data.comparisons.length > 30) fail('가격 비교는 최대 30개입니다.');
  const comparisons = (data.comparisons as unknown[]).map(value => {
    const item = object(value, '메뉴 비교', ['id', 'name', 'uberCents', 'webCents']);
    if (typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(item.id)) fail('메뉴 비교 ID는 소문자·숫자·밑줄·하이픈 1–64자입니다.');
    text(item.name, '메뉴명', 120); integer(item.uberCents, 'Uber 메뉴 금액'); integer(item.webCents, '웹샵 메뉴 금액');
    if (item.uberCents === 0) fail('Uber 비교 금액은 1센트 이상이어야 합니다.');
    return item as WebshopComparison;
  });
  if (new Set(comparisons.map(item => item.id)).size !== comparisons.length) fail('메뉴 비교 ID가 중복됩니다.');
  if (data.verifiedAt !== null) observedAt(data.verifiedAt, '가격 관측 날짜');
  else if (comparisons.length) fail('메뉴 가격을 관측한 날짜가 필요합니다.');
  if (data.promoCode !== null && (typeof data.promoCode !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(data.promoCode))) fail('프로모션 코드는 확인된 영문·숫자·밑줄·하이픈 1–40자만 입력해주세요.');
  if (data.checkoutComparison !== null) {
    const checkout = object(data.checkoutComparison, '전체 결제 비교', ['verifiedAt', 'fulfillment', 'basketLabel', 'sameConditionsConfirmed', 'uber', 'webshop']);
    observedAt(checkout.verifiedAt, '결제 관측 날짜'); text(checkout.basketLabel, '동일 장바구니 설명', 200);
    if (!['delivery', 'pickup'].includes(String(checkout.fulfillment)) || checkout.sameConditionsConfirmed !== true) fail('전체 결제 비교: 같은 메뉴·옵션·수령 방식·배달 조건을 실제 확인해야 합니다.');
    quote(checkout.uber); quote(checkout.webshop);
  }
  integer(data.commissionBps, '수수료 BPS', 10_000);
  if (typeof data.commissionBasisConfirmed !== 'boolean' || ![null, 'attributed', 'all_webshop'].includes(data.commissionScope as string | null)) fail('수수료의 기준 확인 여부와 적용 범위를 확인해주세요.');
  if (data.updatedAt !== null) timestamp(data.updatedAt, '설정 수정 버전');
  return data as AdminWebshopConfig;
}
export const parseWebshopConfig = (value: string) => validateWebshopConfig(parseJson(value));
export function editableWebshopConfig(store: AdminWebshop): AdminWebshopConfig {
  return Object.fromEntries(CONFIG_KEYS.map(key => [key, store[key as keyof AdminWebshopConfig]])) as AdminWebshopConfig;
}

export function validateWebshopReport(value: unknown): WebshopReport {
  const data = object(value, '주문 보고서', ['reportId', 'periodStart', 'periodEnd', 'evidence', 'orders']);
  if (typeof data.reportId !== 'string' || !UUID.test(data.reportId)) fail('보고서 ID는 UUID여야 합니다. 같은 보고서를 재시도할 때 ID를 유지해주세요.');
  const start = Date.parse(timestamp(data.periodStart, '보고서 시작')), end = Date.parse(timestamp(data.periodEnd, '보고서 종료'));
  if (start >= end || end - start > 366 * 86_400_000) fail('보고서 기간은 시작보다 종료가 늦어야 하며 최대 366일입니다.');
  text(data.evidence, '고객 정보를 제외한 보고서 근거', 2000);
  if (end > Date.now() + 300_000) fail('미래 기간의 주문 보고서는 가져올 수 없습니다.');
  if (/@|[0-9]{13,19}/.test(data.evidence as string)) fail('보고서 근거에서 이메일·카드 번호 형태의 정보를 제외해주세요.');
  if (!Array.isArray(data.orders) || data.orders.length > 5000) fail('주문 보고서는 최대 5000건입니다. 0건은 근거에서 실제 무주문이 확인된 경우에만 입력해주세요.');
  const ids = new Set<string>();
  for (const value of data.orders as unknown[]) {
    const row = object(value, '주문', ['externalOrderId', 'orderedAt', 'currency', 'foodSubtotalCents', 'refundCents', 'status', 'attribution']);
    const id = text(row.externalOrderId, '외부 주문 ID', 128);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id) || id !== row.externalOrderId) fail('외부 주문 ID는 영문·숫자·밑줄·점·콜론·하이픈으로 된 공급자 고유 ID여야 합니다.');
    if (ids.has(id)) fail('보고서 안의 외부 주문 ID가 중복됩니다.');
    ids.add(id);
    const date = Date.parse(timestamp(row.orderedAt, '주문 날짜'));
    if (date < start || date >= end) fail('주문 날짜는 보고서 기간 안에 있어야 합니다. 종료 시각은 제외합니다.');
    if (row.currency !== 'CAD') fail('지원하지 않는 통화입니다. CAD 보고서만 가져올 수 있으며 통화를 합산하지 않습니다.');
    const subtotal = integer(row.foodSubtotalCents, '음식 소계'), refund = integer(row.refundCents, '환불액');
    if (refund > subtotal) fail('환불액은 음식 소계를 초과할 수 없습니다.');
    if (!['completed', 'cancelled', 'refunded', 'partial_refund'].includes(String(row.status))) fail('주문 상태는 completed/cancelled/refunded/partial_refund 중 하나여야 합니다.');
    if ((row.status === 'completed' && refund !== 0) || (row.status === 'refunded' && refund !== subtotal) || (row.status === 'partial_refund' && (refund <= 0 || refund >= subtotal))) fail('주문 상태와 환불액이 일치하지 않습니다.');
    if (!['provider_report', 'promo_code', 'unattributed'].includes(String(row.attribution))) fail('기여 근거는 provider_report/promo_code/unattributed 중 하나여야 합니다.');
  }
  return data as WebshopReport;
}
export const parseWebshopReport = (value: string) => validateWebshopReport(parseJson(value));

export async function loadAdminWebshops(client: SupabaseClient, days: number, merchantId: string | null = null): Promise<AdminWebshops> {
  const { data, error } = await client.rpc('get_admin_webshops', { p_days: days, p_merchant_id: merchantId });
  if (error || !data) throw new Error(error?.message ?? 'ADMIN_DATA_MISSING');
  return data as AdminWebshops;
}
export async function saveAdminWebshop(client: SupabaseClient, merchantId: string, config: AdminWebshopConfig): Promise<AdminWebshop> {
  const { data, error } = await client.rpc('save_admin_webshop', { p_merchant_id: merchantId, p_config: validateWebshopConfig(config) });
  if (error || !data) throw new Error(error?.message ?? 'ADMIN_DATA_MISSING');
  return data as AdminWebshop;
}
export async function importAdminWebshopOrders(client: SupabaseClient, merchantId: string, report: WebshopReport): Promise<{ reportId: string; imported: number; duplicates: number }> {
  validateWebshopReport(report);
  const { data, error } = await client.rpc('import_admin_webshop_orders', { p_merchant_id: merchantId, p_report_id: report.reportId, p_period_start: report.periodStart, p_period_end: report.periodEnd, p_evidence: report.evidence, p_orders: report.orders });
  if (error || !data) throw new Error(error?.message ?? 'ADMIN_DATA_MISSING');
  return data as { reportId: string; imported: number; duplicates: number };
}
export function webshopMoney(cents: number | null | undefined, currency: string | null = 'CAD'): string {
  if (currency && currency !== 'CAD') return `지원하지 않는 통화 (${currency})`;
  return cents == null || !Number.isSafeInteger(cents) || !currency ? '확인 불가' : new Intl.NumberFormat('ko-KR', { style: 'currency', currency, minimumFractionDigits: 2 }).format(cents / 100);
}
export function webshopError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/ADMIN_REQUIRED|MFA|AAL2|permission denied/i.test(message)) return '관리자 권한과 MFA 인증을 확인해주세요.';
  if (/revision|conflict|stale|changed|updated_at|updatedAt/i.test(message)) return '다른 변경 또는 같은 ID의 다른 보고서가 있습니다. 최신 기록을 다시 불러와 확인해주세요.';
  if (/BRANCH_MISMATCH|PLACE_CONFLICT|PLACE_ALREADY_LINKED/i.test(message)) return '비즈니스의 도시·지점 연결이 일치하지 않거나 다른 비즈니스가 이미 사용 중입니다. 지점 키를 확인해주세요.';
  if (/WEBSHOP_UNAVAILABLE/i.test(message)) return '공개 동의 또는 운영 상태를 확인한 뒤 웹샵 주문을 활성화해주세요.';
  return '요청을 완료하지 못했습니다. 입력 내용과 연결 상태를 확인한 뒤 다시 시도해주세요.';
}
