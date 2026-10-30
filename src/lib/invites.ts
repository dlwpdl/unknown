import type { SupabaseClient } from '@supabase/supabase-js';

// Invite links and rewards. The server decides every reward; the app only links a code and shows the summary.
export const INVITE_CODE_KEY = 'gling.invite.code.v1';
export const INVITE_ORIGIN = 'https://gling.ej-entertainment.com';
const CODE = /^[A-HJ-NP-Z2-9]{8}$/;

export type InviteReward = { tier: 'plus' | 'pro'; days: number; startsAt: string; endsAt: string };
export type InviteSummary = {
  code: string | null; joined: number; rewarded: number; waiting: number;
  rewards: InviteReward[]; grantedDays: number; capDays: number; activeUntil: string | null;
  linked?: boolean; canEnterCode?: boolean;
};

export const inviteUrl = (code: string) => `${INVITE_ORIGIN}/invite?code=${code}`;
export const inviteAppUrl = (code: string) => `gling://invite?code=${code}`;

/** Accepts a bare code or a pasted invite link; anything else is null and never sent. */
export function normalizeInviteCode(input: string | null | undefined): string | null {
  const text = (input ?? '').trim();
  let code = text;
  if (/^(https?|gling):\/\//i.test(text)) {
    try { code = new URL(text).searchParams.get('code') ?? ''; } catch { return null; }
  }
  code = code.replace(/[\s-]/g, '').toUpperCase();
  return CODE.test(code) ? code : null;
}

const call = async <T>(promise: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data as T;
};
export const loadMyInvite = (client: SupabaseClient) => call<InviteSummary>(client.rpc('get_my_invite'));
export const loadBusinessInvite = (client: SupabaseClient, merchantId: string) => call<InviteSummary>(client.rpc('get_business_invite', { p_merchant_id: merchantId }));
export const createInviteLink = async (client: SupabaseClient, merchantId?: string) =>
  (await call<{ code: string }>(client.rpc('create_invite_link', merchantId ? { p_merchant_id: merchantId } : {}))).code;

// These answers are final: the stored code is dropped. Network or rate-limit errors keep it for the next sign-in.
const FINAL = ['INVITE_NOT_FOUND', 'INVITE_ALREADY_LINKED', 'INVITE_SELF', 'INVITE_TOO_LATE'];
export async function claimInviteCode(client: SupabaseClient, code: string) {
  try { await call(client.rpc('claim_invite_code', { p_code: code })); return 'linked' as const; }
  catch (error) {
    const reason = FINAL.find(item => error instanceof Error && error.message.includes(item));
    if (reason) return reason;
    throw error;
  }
}

type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<unknown>; removeItem(key: string): Promise<unknown> };
/** Keeps a code from a deep link until the member has signed up, then links it once. */
export async function rememberInviteCode(storage: Storage, input: string | null | undefined) {
  const code = normalizeInviteCode(input);
  if (code) await storage.setItem(INVITE_CODE_KEY, code);
  return code;
}
export async function claimRememberedInvite(client: SupabaseClient, storage: Storage) {
  const code = normalizeInviteCode(await storage.getItem(INVITE_CODE_KEY));
  if (!code) { await storage.removeItem(INVITE_CODE_KEY); return null; }
  const result = await claimInviteCode(client, code);
  await storage.removeItem(INVITE_CODE_KEY);
  return result;
}

export const rewardWeeks = (days: number) => Math.round(days / 7);
