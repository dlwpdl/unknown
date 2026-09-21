import { createClient } from '@supabase/supabase-js';
import { publicWebFetch } from './public-web';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

// Never restore the native/web app's prior session, even on the same origin.
export const publicWebClient = createClient(url, key, {
  auth: { storageKey: 'gling-public-reader', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: publicWebFetch(url, key) },
});
