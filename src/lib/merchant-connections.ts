import type { SupabaseClient } from '@supabase/supabase-js';

export type MerchantAccountRole = 'owner' | 'operator';
export const MERCHANT_ACCOUNT_ROLES = { owner: '소유자', operator: '운영 담당자' } as const;
export type MerchantAccountConnection = { user_id: string; nickname: string; email: string | null; role: MerchantAccountRole };
export type MerchantAccountInvitation = {
  id: string; merchant_id: string; merchant_name: string; address: string; city_name: string;
  role: MerchantAccountRole; expires_at: string; can_accept: boolean;
};
export type MyMerchantConnections = {
  user_id: string;
  merchants: { id: string; name: string; city_name: string; role: MerchantAccountRole | 'admin' }[];
  invitations: MerchantAccountInvitation[];
};
export type MerchantAccountConnections = {
  merchant_id: string; updated_at: string; owner: MerchantAccountConnection | null;
  operators: MerchantAccountConnection[];
  invitations: (MerchantAccountConnection & { id: string; expires_at: string })[];
};

async function rpc(client: SupabaseClient, name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  if (data == null) throw new Error('MERCHANT_CONNECTION_READ_FAILED');
  return data;
}

export async function loadMyMerchantConnections(client: SupabaseClient, userId: string): Promise<MyMerchantConnections> {
  const data = await rpc(client, 'get_my_merchant_connections');
  if (data.user_id !== userId || !Array.isArray(data.merchants) || !Array.isArray(data.invitations)
    || data.merchants.some((row: MyMerchantConnections['merchants'][number]) => !row || typeof row.id !== 'string' || typeof row.name !== 'string' || !['owner','operator','admin'].includes(row.role))
    || data.invitations.some((row: MerchantAccountInvitation) => !row || typeof row.id !== 'string' || typeof row.merchant_id !== 'string'
      || !['owner','operator'].includes(row.role) || typeof row.can_accept !== 'boolean')) throw new Error('MERCHANT_CONNECTION_READ_FAILED');
  return data;
}

export async function loadMerchantAccountConnections(client: SupabaseClient, merchantId: string): Promise<MerchantAccountConnections> {
  const data = await rpc(client, 'get_merchant_account_connections', { p_merchant_id: merchantId });
  if (data.merchant_id !== merchantId || typeof data.updated_at !== 'string' || !Array.isArray(data.operators) || !Array.isArray(data.invitations)) throw new Error('MERCHANT_CONNECTION_READ_FAILED');
  return data;
}

export async function acceptMerchantAccountInvitation(client: SupabaseClient, invitation: Pick<MerchantAccountInvitation, 'id' | 'merchant_id'>): Promise<string> {
  const data = await rpc(client, 'accept_merchant_account_invitation', { p_invitation_id: invitation.id });
  if (data !== invitation.merchant_id) throw new Error('MERCHANT_CONNECTION_SAVE_FAILED');
  return data;
}
export const cancelMerchantAccountInvitation = (client: SupabaseClient, invitationId: string): Promise<string> =>
  rpc(client, 'cancel_merchant_account_invitation', { p_invitation_id: invitationId });

export async function disconnectMerchantAccount(client: SupabaseClient, merchantId: string, connection: Pick<MerchantAccountConnection,'user_id'|'role'>, updatedAt: string, note: string): Promise<string> {
  const data = await rpc(client, 'disconnect_merchant_account', {
    p_merchant_id: merchantId, p_user_id: connection.user_id, p_role: connection.role,
    p_expected_updated_at: updatedAt, p_note: note.trim(),
  });
  if (data !== merchantId) throw new Error('MERCHANT_CONNECTION_SAVE_FAILED');
  return data;
}
