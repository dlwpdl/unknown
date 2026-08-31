import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

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
