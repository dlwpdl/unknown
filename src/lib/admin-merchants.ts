import type { SupabaseClient } from '@supabase/supabase-js';
import { safeMerchantSourceUrl } from './merchant-source.ts';
import { merchantReportText } from './merchant-workspace.ts';
import type { MerchantAccountRole } from './merchant-connections.ts';
export { merchantReportText } from './merchant-workspace.ts';
export { merchantMapsUrl } from './merchant-source.ts';

export type Merchant = {
  id: string; name: string; city_id: string; city_name: string; timezone: string;
  contact: string; status: 'lead' | 'trial' | 'paid' | 'paused';
  consent: 'pending' | 'granted' | 'revoked'; consent_note: string;
  trial_ends_at: string | null; post_count: number; report_count: number; updated_at: string;
  owner_id?: string | null; owner_verified_at?: string | null; workspace_until?: string | null;
  industry?: string; services?: string; address?: string;
};
export type MerchantMetrics = {
  linked_posts: number; new_posts: number; displayed_views: number; first_reads: number;
  unique_readers: number; source_clicks: number; member_clickers: number; anonymous_sessions: number;
};
export type MerchantPost = { post_id: string; title: string; original_url: string | null; displayed_views: number; source_clicks: number; status?: string; created_at?: string };
export type MerchantReport = {
  id: string; merchant_id: string; merchant_name: string; city_name: string;
  period_start: string; period_end: string; timezone: string; generated_at: string;
  title: string; summary: string; next_step: string; proposal_period: 'two_weeks' | 'month';
  proposal_amount: number | null; tax_note: string; metrics: MerchantMetrics; posts: MerchantPost[];
};
export type MerchantDetail = { merchant: Merchant; metrics: MerchantMetrics; posts: MerchantPost[]; reports: MerchantReport[]; available_posts: { id: string; title: string }[] };

async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error || data == null) throw new Error(error?.message ?? 'MERCHANT_DATA_MISSING');
  return data as T;
}
export const loadMerchants = (client: SupabaseClient, search = '', offset = 0) => rpc<{ merchants: Merchant[]; more: boolean }>(client, 'get_admin_merchants', { p_search: search.trim(), p_offset: offset });
export const loadMerchant = (client: SupabaseClient, id: string, start: string, end: string) => rpc<MerchantDetail>(client, 'get_admin_merchant', { p_merchant_id: id, p_start: start, p_end: end });
export const saveMerchant = (client: SupabaseClient, value: { id: string | null; name: string; city_id: string; contact: string; status: Merchant['status']; consent: Merchant['consent']; consent_note: string; trial_ends_at: string | null; industry?: string; services?: string; address?: string }) => rpc<string>(client, 'save_admin_merchant', Object.fromEntries(Object.entries(value).map(([key, v]) => [`p_${key}`, v])));
export function merchantAddressCity(address: string): string | null {
  // 소재지는 주소에 명시된 도시·주만 사용하고 게시 지역에서 추정하지 않는다.
  const match = address.match(/(?:^|,)\s*([^,\d]+),\s*(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\b/i);
  return match ? `${match[1].trim()}, ${match[2].toUpperCase()}` : null;
}
export async function linkMerchantPost(client: SupabaseClient, id: string, postId: string, source: string) {
  const url = safeMerchantSourceUrl(source);
  if (!url) throw new Error('INVALID_ORIGINAL_URL');
  return rpc<string>(client, 'link_admin_merchant_post', { p_merchant_id: id, p_post_id: postId.trim(), p_original_url: url });
}
export async function createMerchantPost(client: SupabaseClient, id: string, value: { title: string; body: string; tag_slug: string; original_url: string; kind: 'story' | 'listing'; request_id: string }) {
  const url = safeMerchantSourceUrl(value.original_url);
  if (!url) throw new Error('INVALID_ORIGINAL_URL');
  return rpc<string>(client, 'create_admin_merchant_post', { p_merchant_id: id, p_title: value.title.trim(), p_body: value.body.trim(), p_tag_slug: value.tag_slug, p_original_url: url, p_kind: value.kind, p_request_id: value.request_id });
}
export const saveMerchantReport = (client: SupabaseClient, value: Pick<MerchantReport, 'id' | 'merchant_id' | 'period_start' | 'period_end' | 'title' | 'summary' | 'next_step' | 'proposal_period' | 'proposal_amount' | 'tax_note'>) => rpc<MerchantReport>(client, 'save_admin_merchant_report', Object.fromEntries(Object.entries(value).map(([key, v]) => [`p_${key}`, v])));

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function merchantReportHtml(report: MerchantReport, logo = '') {
  const text = merchantReportText(report);
  const logoImage = /^data:image\/png;base64,[a-z0-9+/=]+$/i.test(logo) ? `<img class="logo" src="${logo}" alt="글링">` : '<strong class="logo">gling</strong>';
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(report.merchant_name)} · 글링 보고서</title>
<style>:root{color-scheme:dark;--bg:#0B0B12;--text:#F6F3F0;--accent:#CBB9FF;--sub:#B7B4C3}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.75 system-ui,-apple-system,'Apple SD Gothic Neo',sans-serif}main{max-width:860px;margin:auto;padding:56px 28px}.logo{display:block;max-width:120px;max-height:44px;font-size:30px;color:var(--accent)}h1{font-size:30px;line-height:1.4;word-break:keep-all}h2{font-size:19px;margin:32px 0 12px}small{color:var(--sub);font:12px/1.7 Menlo,monospace}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:28px 0}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:12px 8px;border-bottom:1px solid #343443;overflow-wrap:anywhere}a{color:var(--accent)}footer{margin-top:40px;border-top:1px solid #343443;padding-top:20px;color:var(--sub);font-size:12px}@media(max-width:480px){main{padding:28px 18px}h1{font-size:25px}}@media print{:root{color-scheme:light;--bg:white;--text:#15121D;--accent:#51446B;--sub:#555}main{padding:0;max-width:none}.logo{filter:brightness(.4)}table{font-size:11px}tr{break-inside:avoid}a{color:inherit}footer{break-inside:avoid}}</style>
<main>${logoImage}<h1>${escape(report.merchant_name)}<br>홍보 운영 결과와 다음 제안</h1><small>보고서 작성 ${escape(report.generated_at)} · 측정 기간 ${escape(report.period_start)}~${escape(report.period_end)}</small><pre>${escape(text)}</pre><h2>소개한 게시글</h2><table><thead><tr><th>글</th><th>누적 표시 조회</th><th>기간 내 업체 링크 클릭</th></tr></thead><tbody>${report.posts.map((p) => `<tr><td>${escape(p.title)}${p.original_url && safeMerchantSourceUrl(p.original_url) ? `<br><a href="${escape(p.original_url)}" target="_blank" rel="noopener noreferrer">업체 계정으로 가기</a>` : ''}</td><td>${p.displayed_views}</td><td>${p.source_clicks}</td></tr>`).join('')}</tbody></table><footer>글링 · 한인 모임·커뮤니티<br>보고서는 저장 시점의 집계입니다. 이 문서는 유료 운영 제안이며 결제나 갱신이 자동으로 진행되지 않습니다.</footer></main></html>`;
}

export async function getAdminMerchantAccess(client: SupabaseClient, userId: string): Promise<boolean> {
  const data = await rpc<unknown>(client, 'get_admin_merchant_access', { p_user_id: userId });
  if (typeof data !== 'boolean') throw new Error('MERCHANT_ACCESS_READ_FAILED');
  return data;
}
export async function setAdminMerchantAccess(client: SupabaseClient, userId: string, enabled: boolean): Promise<boolean> {
  const data = await rpc<unknown>(client, 'set_admin_merchant_access', { p_user_id: userId, p_enabled: enabled });
  if (data !== enabled) throw new Error('MERCHANT_ACCESS_SAVE_FAILED');
  return data;
}
export const setAdminMerchantOwner = (client: SupabaseClient, id: string, ownerId: string, verified: boolean, until: string | null) => rpc<string>(client, 'set_admin_merchant_workspace_owner', { p_merchant_id: id, p_owner_id: ownerId, p_verified: verified, p_workspace_until: until });

export async function connectAdminMerchantAccount(client: SupabaseClient,
  merchant: { id: string; updated_at: string }, account: { id: string; nickname: string; email: string | null },
  input: { role: MerchantAccountRole; method: 'direct' | 'invite'; verified: boolean; note: string }): Promise<string> {
  if (input.verified !== true || input.note.trim().length < 6) throw new Error('MERCHANT_CONNECTION_CONFIRMATION_REQUIRED');
  const data = await rpc<string>(client, 'connect_admin_merchant_account', {
    p_merchant_id: merchant.id, p_user_id: account.id, p_role: input.role, p_method: input.method,
    p_verified: input.verified, p_note: input.note.trim(), p_expected_updated_at: merchant.updated_at,
    p_expected_nickname: account.nickname, p_expected_email: account.email,
  });
  if (typeof data !== 'string' || !data || input.method === 'direct' && data !== merchant.id) throw new Error('MERCHANT_CONNECTION_SAVE_FAILED');
  return data;
}
