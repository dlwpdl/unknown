import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { AppState, KeyboardAvoidingView, Platform } from 'react-native';
import { ScrollView } from '@/components/analytics-controls';
import { MerchantWorkspace } from '@/components/merchant-workspace';
import { LoginPanel } from '@/components/login-panel';
import { useAuth } from '@/lib/auth';

export default function MerchantScreen() {
  const { me, isAuthed, signInApple, signInKakao, signInGoogle, signInDev, isAuthLoading, authError } = useAuth();
  const [refreshSignal, setRefreshSignal] = useState(0);
  const params = useLocalSearchParams<{ merchant?: string; tab?: string }>();
  useFocusEffect(useCallback(() => {
    setRefreshSignal(value => value + 1);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') setRefreshSignal(value => value + 1); });
    return () => listener.remove();
  }, []));
  if (!isAuthed) return <LoginPanel reason="비즈니스의 글·원가·재고를 관리하려면 로그인해 주세요." onApple={signInApple} onKakao={signInKakao} onGoogle={signInGoogle} onDevLogin={signInDev} loading={isAuthLoading} error={authError} />;
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
    <ScrollView analyticsId="merchant.workspace" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 40 }}><MerchantWorkspace assignedOnly key={me.id} refreshSignal={refreshSignal} initialMerchantId={typeof params.merchant === 'string' ? params.merchant : undefined} initialTab={params.tab === 'drafts' ? 'drafts' : undefined} /></ScrollView>
  </KeyboardAvoidingView>;
}
