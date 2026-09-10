import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { isReviewUser } from '@/lib/review-access';
import { isAdminRole } from '@/lib/admin';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Supabase 환경 변수가 설정되지 않았습니다. .env.local을 확인하세요.');
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: Platform.OS === 'web' ? {
      getItem: (key) => typeof window === 'undefined' ? null : window.localStorage.getItem(key),
      setItem: (key, value) => { if (typeof window !== 'undefined') window.localStorage.setItem(key, value); },
      removeItem: (key) => { if (typeof window !== 'undefined') window.localStorage.removeItem(key); },
    } : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

// Validate review/admin access before storing any session in the main app client.
const restrictedAuth = createClient(supabaseUrl, supabasePublishableKey, {
  auth: { storageKey: 'gling-review-staging', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}).auth;

async function signInRestrictedAccount(email: string, password: string, kind: 'review' | 'admin'): Promise<void> {
  const { data, error } = await restrictedAuth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  const allowed = kind === 'admin' ? isAdminRole(data.user?.app_metadata) : isReviewUser(data.user);
  if (!data.session || !allowed) {
    await restrictedAuth.signOut({ scope: 'local' });
    throw new Error(kind === 'admin' ? 'ADMIN_ACCESS_DENIED' : 'REVIEW_ACCESS_DENIED');
  }
  const result = await supabase.auth.setSession(data.session);
  if (result.error) {
    await restrictedAuth.signOut({ scope: 'local' });
    throw result.error;
  }
}

export const signInReviewAccount = (email: string, password: string) => signInRestrictedAccount(email, password, 'review');
export const signInAdminAccount = (email: string, password: string) => signInRestrictedAccount(email, password, 'admin');
