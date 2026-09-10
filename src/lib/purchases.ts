import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

const apiKey = Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
let queue: Promise<unknown> = Promise.resolve();

export function purchaseUnavailableReason(): string | null {
  if (Platform.OS === 'web') return '구독과 구매 복원은 글링 iOS·Android 앱에서 이용할 수 있어요.';
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return '구독은 설치된 글링 앱에서 이용할 수 있어요.';
  if (!apiKey || (!__DEV__ && apiKey.startsWith('test_'))) return '구독을 준비하고 있어요. 무료 기능은 계속 이용할 수 있어요.';
  return null;
}

// Keep identity changes and purchases in order; never configure an anonymous billing user.
export function withPurchases<T>(userId: string, operation: (sdk: typeof import('react-native-purchases').default) => Promise<T>): Promise<T> {
  const next = queue.catch(() => undefined).then(async () => {
    const unavailable = purchaseUnavailableReason();
    if (unavailable) throw new Error(unavailable);
    const session = await supabase.auth.getSession();
    if (session.data.session?.user.id !== userId) throw new Error('ACCOUNT_CHANGED');
    const { default: Purchases } = await import('react-native-purchases');
    if (!await Purchases.isConfigured()) Purchases.configure({ apiKey: apiKey!, appUserID: userId });
    else if (await Purchases.getAppUserID() !== userId) await Purchases.logIn(userId);
    return operation(Purchases);
  });
  queue = next.then(() => undefined, () => undefined);
  return next;
}
