import { createClient, isAuthRetryableFetchError, type Session, type User } from '@supabase/supabase-js';

import { authStorage, supabase } from '@/lib/supabase';

type SavedSession = { nickname: string; access_token: string; refresh_token: string };
export type SavedSessions = Record<string, SavedSession>;
export type LinkedAccount = { id: string; nickname: string; forward: boolean };

const STORAGE_KEY = 'gling-linked-sessions';

export const withSession = (sessions: SavedSessions, userId: string, session: SavedSession): SavedSessions => ({ ...sessions, [userId]: session });

export function withoutSession(sessions: SavedSessions, userId: string): SavedSessions {
  const { [userId]: _removed, ...rest } = sessions;
  return rest;
}

const linkedIds = (user: Pick<User, 'app_metadata'>): unknown[] => Array.isArray(user.app_metadata.linked_accounts) ? user.app_metadata.linked_accounts : [];

/** Linked accounts from the server, then accounts kept on this device: never the signed-in one, never twice. */
export function linkedAccountRows(user: Pick<User, 'id' | 'app_metadata'>, listed: { id: string; nickname: string }[], sessions: SavedSessions): LinkedAccount[] {
  const rows = [
    ...listed.map(({ id, nickname }) => ({ id, nickname, forward: true })),
    ...Object.entries(sessions).map(([id, { nickname }]) => ({ id, nickname, forward: linkedIds(user).includes(id) })),
  ];
  return rows.filter((row, index) => row.id !== user.id && rows.findIndex(other => other.id === row.id) === index);
}

async function readSessions(): Promise<SavedSessions> {
  // A failed read throws: writing back after it would erase the way to the original account.
  const raw = await authStorage.getItem(STORAGE_KEY);
  try {
    const saved: unknown = JSON.parse(raw ?? '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved as SavedSessions : {};
  } catch { return {}; }
}

async function saveSessions(change: (sessions: SavedSessions) => SavedSessions) {
  await authStorage.setItem(STORAGE_KEY, JSON.stringify(change(await readSessions())));
}

export async function clearLinkedSessions() {
  await authStorage.removeItem(STORAGE_KEY);
}

/** Rows for the profile account list. Members without linked accounts make no request. */
export async function loadLinkedAccounts(): Promise<LinkedAccount[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];
  const listed = linkedIds(session.user).length ? await supabase.functions.invoke('linked-account', { body: { action: 'list' } }) : null;
  return linkedAccountRows(session.user, Array.isArray(listed?.data?.accounts) ? listed.data.accounts : [], await readSessions());
}

// A new throwaway client per switch: the app client drops the current login when handed a dead refresh token,
// and a reused client would first refresh the stale session it still holds.
const stagingAuth = () => createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
  auth: { storageKey: 'gling-linked-staging', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}).auth;

/** Moves the app to another account on this device. On any failure the current login stays as it was. */
export async function switchToAccount(targetId: string, nickname: string): Promise<void> {
  const { data: { session: current } } = await supabase.auth.getSession();
  if (!current || current.user.id === targetId) throw new Error('SWITCH_FAILED');
  const userId = current.user.id, saved = (await readSessions())[targetId], staging = stagingAuth();
  // Keep the way back first: the server never issues a sign-in toward the original account.
  await saveSessions(sessions => withSession(sessions, userId, { nickname, access_token: current.access_token, refresh_token: current.refresh_token }));
  let next: Session | null = null;
  try {
    if (saved) {
      const refreshed = await staging.refreshSession({ refresh_token: saved.refresh_token });
      next = refreshed.data.session;
      // A rotated or rejected refresh token must not be replayed; one that never reached the server still works.
      if (next || !isAuthRetryableFetchError(refreshed.error)) await saveSessions(sessions => withoutSession(sessions, targetId));
    }
    if (!next && linkedIds(current.user).includes(targetId)) {
      const link = await supabase.functions.invoke('linked-account', { body: { action: 'switch', target: targetId } });
      if (link.error || typeof link.data?.token_hash !== 'string') {
        // The server names one refusal the app can resolve: an admin session that has not passed the second factor yet.
        const code = await Promise.resolve(link.error?.context?.json?.()).then(body => body?.error, () => null);
        throw new Error(code === 'MFA_REQUIRED' ? 'MFA_REQUIRED' : 'SWITCH_FAILED');
      }
      next = (await staging.verifyOtp({ token_hash: link.data.token_hash, type: 'magiclink' })).data.session;
    }
    if (!next || next.user.id !== targetId) throw new Error('SWITCH_FAILED');
    const { error } = await supabase.auth.setSession(next);
    if (error) throw error;
  } catch (cause) {
    // Tokens rotated just now stay the way back when only the hand-over failed.
    const kept = saved && next?.user.id === targetId ? { ...saved, access_token: next.access_token, refresh_token: next.refresh_token } : null;
    await saveSessions(sessions => kept ? withSession(withoutSession(sessions, userId), targetId, kept) : withoutSession(sessions, userId));
    throw cause;
  }
}
