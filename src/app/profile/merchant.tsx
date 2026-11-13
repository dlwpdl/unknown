import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { AppState } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScrollView } from '@/components/analytics-controls';
import { KeyboardScreen } from '@/components/keyboard-screen';
import { MerchantWorkspace } from '@/components/merchant-workspace';
import { LoginPanel } from '@/components/login-panel';
import { useAuth } from '@/lib/auth';
import { useChatIdentity } from '@/hooks/use-chat-identity';
import { TabBarHeight } from '@/constants/theme';

// inTab: shown as the business-mode '내 가게' tab, so the last card has to clear the floating tab bar too.
export default function MerchantScreen({ inTab = false }: { inTab?: boolean }) {
  const insets = useSafeAreaInsets();
  const { me, isAuthed, signInApple, signInKakao, signInGoogle, signInDev, isAuthLoading, authError } = useAuth();
  const [refreshSignal, setRefreshSignal] = useState(0);
  const params = useLocalSearchParams<{ merchant?: string; tab?: string }>();
  // Reopen the business the member last switched to; the workspace still re-checks access before showing it.
  const business = useChatIdentity();
  useFocusEffect(useCallback(() => {
    setRefreshSignal(value => value + 1);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') setRefreshSignal(value => value + 1); });
    return () => listener.remove();
  }, []));
  if (!isAuthed) return <LoginPanel reason="비즈니스의 글·원가·재고를 관리하려면 로그인해 주세요." onApple={signInApple} onKakao={signInKakao} onGoogle={signInGoogle} onDevLogin={signInDev} loading={isAuthLoading} error={authError} />;
  return <KeyboardScreen>
    <ScrollView analyticsId="merchant.workspace" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 40 + insets.bottom + (inTab ? TabBarHeight : 0) }}><MerchantWorkspace assignedOnly key={me.id} refreshSignal={refreshSignal} initialMerchantId={typeof params.merchant === 'string' ? params.merchant : business?.id} initialTab={params.tab === 'drafts' ? 'drafts' : undefined} /></ScrollView>
  </KeyboardScreen>;
}
