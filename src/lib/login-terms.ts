import type { SupabaseClient } from '@supabase/supabase-js';

export const LOGIN_TERMS_VERSION = '2026-09-17';

export async function recordLoginTerms(client: SupabaseClient, version: string) {
  try {
    if (version !== LOGIN_TERMS_VERSION) throw new Error('LOGIN_TERMS_REQUIRED');
    const { error } = await client.rpc('accept_login_terms', { p_version: version });
    if (error) throw error;
  } catch (error) {
    // Do not leave a successful login active if its explicit agreement was not saved.
    await client.auth.signOut({ scope: 'local' });
    throw error;
  }
}
