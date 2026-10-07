import type { SupabaseClient } from '@supabase/supabase-js';
import { safeMerchantSourceUrl } from './merchant-source.ts';

export type Merchant = {
  id: string; name: string; city_id: string; city_name: string; timezone: string;
  contact: string; status: 'lead' | 'trial' | 'paid' | 'paused';
  consent: 'pending' | 'granted' | 'revoked'; consent_note: string;
  trial_ends_at: string | null; post_count: number; report_count: number; updated_at: string;
  owner_id?: string | null; owner_verified_at?: string | null; workspace_until?: string | null;
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
export const saveMerchant = (client: SupabaseClient, value: { id: string | null; name: string; city_id: string; contact: string; status: Merchant['status']; consent: Merchant['consent']; consent_note: string; trial_ends_at: string | null }) => rpc<string>(client, 'save_admin_merchant', Object.fromEntries(Object.entries(value).map(([key, v]) => [`p_${key}`, v])));
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

export function merchantReportText(report: MerchantReport) {
  const m = report.metrics;
  return `${report.merchant_name} · ${report.title}\n${report.city_name} · ${report.period_start}~${report.period_end} (${report.timezone})\n\n`
    + `연결 게시글: ${m.linked_posts}편 · 기간 내 새 글: ${m.new_posts}편\n`
    + `표시 조회수: ${m.displayed_views.toLocaleString('ko-KR')}회 (보고서 작성 시점 누적, 익명 조회·운영 조정 포함)\n`
    + `기간 내 로그인 회원 최초 열람: ${m.first_reads}회 · 로그인 열람 회원: ${m.unique_readers}명\n`
    + `원문 이동 클릭: ${m.source_clicks}회 · 로그인 클릭 회원: ${m.member_clickers}명 · 익명 클릭 세션: ${m.anonymous_sessions}개\n\n`
    + `${report.summary}\n\n다음 운영 제안\n${report.next_step}`
    + (report.proposal_amount == null ? '' : `\n${report.proposal_period === 'month' ? '월' : '2주'} 운영: CAD ${Number(report.proposal_amount).toFixed(2)} · ${report.tax_note}`)
    + '\n\n표시 조회수는 실제 열람 인원이 아닙니다. 로그인 회원과 익명 세션은 합산하지 않습니다. 원문 클릭은 외부 이동을 누른 기록이며 문의·지원·주문 완료는 확인하지 않았습니다. 최초 열람은 같은 글의 로그인 계정별 최초 기록만 포함하며 재방문은 포함하지 않습니다.';
}
const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function merchantReportHtml(report: MerchantReport, logo = '') {
  const text = merchantReportText(report);
  const logoImage = /^data:image\/png;base64,[a-z0-9+/=]+$/i.test(logo) ? `<img class="logo" src="${logo}" alt="글링">` : '<strong class="logo">gling</strong>';
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(report.merchant_name)} · 글링 보고서</title>
<style>:root{color-scheme:dark;--bg:#0B0B12;--text:#F6F3F0;--accent:#CBB9FF;--sub:#B7B4C3}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.75 system-ui,-apple-system,'Apple SD Gothic Neo',sans-serif}main{max-width:860px;margin:auto;padding:56px 28px}.logo{display:block;max-width:120px;max-height:44px;font-size:30px;color:var(--accent)}h1{font-size:30px;line-height:1.4;word-break:keep-all}h2{font-size:19px;margin:32px 0 12px}small{color:var(--sub);font:12px/1.7 Menlo,monospace}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:28px 0}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:12px 8px;border-bottom:1px solid #343443;overflow-wrap:anywhere}a{color:var(--accent)}footer{margin-top:40px;border-top:1px solid #343443;padding-top:20px;color:var(--sub);font-size:12px}@media(max-width:480px){main{padding:28px 18px}h1{font-size:25px}}@media print{:root{color-scheme:light;--bg:white;--text:#15121D;--accent:#51446B;--sub:#555}main{padding:0;max-width:none}.logo{filter:brightness(.4)}table{font-size:11px}tr{break-inside:avoid}a{color:inherit}footer{break-inside:avoid}}</style>
<main>${logoImage}<h1>${escape(report.merchant_name)}<br>홍보 운영 결과와 다음 제안</h1><small>보고서 작성 ${escape(report.generated_at)} · 측정 기간 ${escape(report.period_start)}~${escape(report.period_end)}</small><pre>${escape(text)}</pre><h2>소개한 게시글</h2><table><thead><tr><th>글</th><th>누적 표시 조회</th><th>기간 내 원문 클릭</th></tr></thead><tbody>${report.posts.map((p) => `<tr><td>${escape(p.title)}${p.original_url && safeMerchantSourceUrl(p.original_url) ? `<br><a href="${escape(p.original_url)}" target="_blank" rel="noopener noreferrer">원문으로 가기</a>` : ''}</td><td>${p.displayed_views}</td><td>${p.source_clicks}</td></tr>`).join('')}</tbody></table><footer>글링 · 한인 모임·커뮤니티<br>보고서는 저장 시점의 집계입니다. 이 문서는 유료 운영 제안이며 결제나 갱신이 자동으로 진행되지 않습니다.</footer></main></html>`;
}
