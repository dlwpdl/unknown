import type { SupabaseClient } from '@supabase/supabase-js';
import type { TrustContent, TrustTarget } from './meetup-reviews.ts';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.rpc(name, args);
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}
export const loadAdminTrustContent = (client: SupabaseClient, targetType: TrustTarget, targetId: string) => rpc<TrustContent>(client, 'get_admin_trust_content', { p_target_type: targetType, p_target_id: targetId });
export async function reviewAdminTrustTarget(client: SupabaseClient, targetType: TrustTarget, targetId: string, decision: 'published' | 'removed', note: string, expectedUpdatedAt: string) {
  if (!['meetup_review', 'manner_review', 'meetup_attendance'].includes(targetType) || !uuid.test(targetId)
    || !['published', 'removed'].includes(decision) || note.trim().length < 5 || note.trim().length > 1000 || !Number.isFinite(Date.parse(expectedUpdatedAt))) throw new Error('INVALID_REVIEW');
  await rpc<null>(client, 'review_admin_trust_target', { p_target_type: targetType, p_target_id: targetId, p_decision: decision, p_note: note.trim(), p_expected_updated_at: expectedUpdatedAt });
}
