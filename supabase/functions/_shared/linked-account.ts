type AuthUser = { id: string; email?: string; banned_until?: string; app_metadata?: Record<string, unknown>; factors?: { status?: string }[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Key presence, like the token hook's `metadata ? 'linked_to'`.
const isLinked = (user: AuthUser) => Object.hasOwn(user.app_metadata ?? {}, 'linked_to');

/** Accounts the caller links to. A linked account never links onward. */
export function linkedAccountIds(caller: AuthUser): string[] {
  const ids = caller.app_metadata?.linked_accounts;
  if (isLinked(caller) || !Array.isArray(ids)) return [];
  return ids.filter((id): id is string => typeof id === 'string' && UUID.test(id));
}

/** Why the caller may not get a sign-in for target, or null when it may. Profile status null means no profile row. */
export function switchDenial(caller: AuthUser, callerStatus: string | null, target: AuthUser | null, targetStatus: string | null, now = Date.now()): string | null {
  // A linked account can mint no sign-in at all, so it has no way into the (admin) account that owns it.
  if (isLinked(caller)) return 'LINKED_ACCOUNT';
  if (callerStatus !== 'active') return 'ACCOUNT_NOT_ACTIVE';
  if (!target || !linkedAccountIds(caller).includes(target.id) || target.app_metadata?.linked_to !== caller.id) return 'NOT_LINKED';
  if (target.app_metadata?.role === 'admin' || target.app_metadata?.provider !== 'email' || !target.email) return 'TARGET_NOT_ALLOWED';
  if (target.banned_until && !(Date.parse(target.banned_until) <= now)) return 'TARGET_BANNED';
  if (targetStatus !== null && targetStatus !== 'active') return 'TARGET_NOT_ACTIVE';
  return null;
}

/** Admins and members with a second factor mint a sign-in only from a session that passed it (ADR-0001). */
export function mfaDenial(caller: AuthUser, aal: unknown): string | null {
  const guarded = caller.app_metadata?.role === 'admin' || !!caller.factors?.some(factor => factor.status === 'verified');
  return guarded && aal !== 'aal2' ? 'MFA_REQUIRED' : null;
}

/** The aal claim of a bearer token that the gateway (verify_jwt) and getUser() have already checked. */
export function bearerAal(authorization: string): unknown {
  try {
    const part = authorization.replace(/^Bearer\s+/i, '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part + '='.repeat((4 - part.length % 4) % 4)))?.aal ?? null;
  } catch { return null; }
}
