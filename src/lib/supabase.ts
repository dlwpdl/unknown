import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { DeviceEventEmitter, Platform } from 'react-native';

import { isReviewUser } from '@/lib/review-access';
import { isAdminRole } from '@/lib/admin';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Supabase 환경 변수가 설정되지 않았습니다. .env.local을 확인하세요.');
}

export const AUTH_EXPIRED_EVENT = 'authExpired';

// Detect a dead session at the transport layer instead of in every catch block:
// GoTrue answers 401 for an expired/revoked JWT and our RPCs raise AUTH_REQUIRED (400).
// The AuthProvider listens and drops the local session so the login sheet opens right away.
export function isAuthFailure(status: number, body: string) {
  return status === 401 || (status === 400 && body.includes('AUTH_REQUIRED'));
}

const authAwareFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.status === 401 || response.status === 400) {
    const body = await response.clone().text().catch(() => '');
    if (isAuthFailure(response.status, body) && !String(typeof input === 'string' ? input : (input as Request).url ?? input).includes('/auth/v1/')) {
      DeviceEventEmitter.emit(AUTH_EXPIRED_EVENT);
    }
  }
  return response;
};

// Native sessions live in the Keychain/Keystore. AFTER_FIRST_UNLOCK keeps background token refresh working while the phone is locked.
const secureOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
// 500 code points stay under the ~2048-byte value limit of older iOS keychains even at 4 UTF-8 bytes each.
const SECURE_CHUNK = 500;
const secureKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');
const secureChunkCount = async (key: string) => Number(await SecureStore.getItemAsync(`${key}.n`, secureOptions)) || 0;

async function readSecureSession(key: string) {
  const count = await secureChunkCount(key);
  if (!count) return null;
  const parts = await Promise.all(Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(`${key}.${i}`, secureOptions)));
  return parts.some(part => part === null) ? null : parts.join('');
}

async function deleteSecureChunks(key: string, from: number, to: number) {
  for (let i = from; i < to; i++) await SecureStore.deleteItemAsync(`${key}.${i}`, secureOptions);
}

async function writeSecureSession(key: string, value: string) {
  const previous = await secureChunkCount(key);
  const points = Array.from(value); // split on code points so no surrogate pair is cut in half
  const parts = Array.from({ length: Math.max(1, Math.ceil(points.length / SECURE_CHUNK)) }, (_, i) => points.slice(i * SECURE_CHUNK, (i + 1) * SECURE_CHUNK).join(''));
  for (let i = 0; i < parts.length; i++) await SecureStore.setItemAsync(`${key}.${i}`, parts[i], secureOptions);
  await SecureStore.setItemAsync(`${key}.n`, String(parts.length), secureOptions);
  await deleteSecureChunks(key, parts.length, previous);
}

export const nativeSessionStorage = {
  async getItem(key: string) {
    const stored = await readSecureSession(secureKey(key));
    if (stored !== null) return stored;
    // One-time move of a session saved by older app versions, so updating does not sign anyone out.
    const legacy = await AsyncStorage.getItem(key);
    if (legacy === null) return null;
    try {
      await writeSecureSession(secureKey(key), legacy);
      await AsyncStorage.removeItem(key);
    } catch {} // keep the AsyncStorage copy and retry on the next read rather than lose the session
    return legacy;
  },
  setItem: (key: string, value: string) => writeSecureSession(secureKey(key), value),
  async removeItem(key: string) {
    const safeKey = secureKey(key);
    const count = await secureChunkCount(safeKey);
    await SecureStore.deleteItemAsync(`${safeKey}.n`, secureOptions);
    await deleteSecureChunks(safeKey, 0, count);
    await AsyncStorage.removeItem(key);
  },
};

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  global: { fetch: authAwareFetch },
  auth: {
    storage: Platform.OS === 'web' ? {
      getItem: (key) => typeof window === 'undefined' ? null : window.localStorage.getItem(key),
      setItem: (key, value) => { if (typeof window !== 'undefined') window.localStorage.setItem(key, value); },
      removeItem: (key) => { if (typeof window !== 'undefined') window.localStorage.removeItem(key); },
    } : nativeSessionStorage,
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
  // 저장 실패(시크릿 모드·쿠키 차단·용량 부족)는 자격 증명 오류와 구분해야 현장에서 원인을 알 수 있다.
  try {
    const result = await supabase.auth.setSession(data.session);
    if (result.error) throw result.error;
  } catch (cause) {
    await restrictedAuth.signOut({ scope: 'local' });
    throw new Error(`SESSION_SAVE_FAILED:${cause instanceof Error ? cause.message : 'unknown'}`);
  }
}

export const signInReviewAccount = (email: string, password: string) => signInRestrictedAccount(email, password, 'review');
export const signInAdminAccount = (email: string, password: string) => signInRestrictedAccount(email, password, 'admin');
