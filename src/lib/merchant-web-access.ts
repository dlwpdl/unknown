import type { SupabaseClient } from '@supabase/supabase-js';
import { getMyMerchantAccess, loadMyMerchants, type BusinessMerchant } from './merchant-workspace.ts';

export type MerchantWebAccess = {
  kind: 'member' | 'unassigned' | 'business';
  merchants: BusinessMerchant[];
  canConnectMcp: boolean;
};

export async function loadMerchantWebAccess(client: SupabaseClient, userId: string): Promise<MerchantWebAccess> {
  let accountChanged = false;
  const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
    if (session?.user.id !== userId) accountChanged = true;
  });
  try {
    const initial = await client.auth.getSession();
    if (initial.error || initial.data.session?.user.id !== userId || accountChanged) throw new Error('ACCOUNT_CHANGED');
    const enabled = await getMyMerchantAccess(client);
    const rows = enabled ? await loadMyMerchants(client) : [];
    const { data, error } = await client.auth.getSession();
    if (error || data.session?.user.id !== userId || accountChanged) throw new Error('ACCOUNT_CHANGED');
    const merchants = rows.filter(row => row.role === 'owner' || row.role === 'operator');
    return {
      kind: !enabled ? 'member' : merchants.length ? 'business' : 'unassigned',
      merchants,
      canConnectMcp: merchants.some(row => row.role === 'owner' && row.owner_id === userId && !!row.owner_verified_at),
    };
  } finally { subscription.unsubscribe(); }
}
