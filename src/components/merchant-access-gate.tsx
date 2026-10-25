import { useLanguage } from '@/hooks/use-language';
import { useEffect, useState, type ReactNode } from 'react';
import { AppState, Platform, View } from 'react-native';
import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { getMyBusinessWorkspaceAccess, getMyMerchantAccess } from '@/lib/merchant-workspace';
import { supabase } from '@/lib/supabase';

export function MerchantAccessGate({ children, refreshSignal = 0, businessOnly = false }: { children: ReactNode; refreshSignal?: number; businessOnly?: boolean }) {
  const { tr } = useLanguage();
  const { me, isAuthed } = useAuth(); const { play } = useInteractionFeedback();
  const [access, setAccess] = useState<{ user: string; enabled: boolean; refreshSignal: number; retry: number; businessOnly: boolean } | null>(null);
  const [error, setError] = useState(false), [retry, setRetry] = useState(0);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let active = true, request = 0;
    const check = async () => {
      const current = ++request; setChecking(true);
      try { const enabled = businessOnly ? (await getMyBusinessWorkspaceAccess(supabase, me.id)).enabled : await getMyMerchantAccess(supabase); if (active && current === request) { setAccess({ user: me.id, enabled, refreshSignal, retry, businessOnly }); setError(false); } }
      catch (failure) { if (active && current === request) {
        if (failure instanceof Error && ['AUTH_REQUIRED', 'ACCOUNT_LOCKED', 'ACCOUNT_CHANGED', 'MERCHANT_ACCESS_REQUIRED', 'MERCHANT_ACCOUNT_REQUIRED', 'ADMIN_REQUIRED'].includes(failure.message)) setAccess(null);
        setError(true);
      } }
      finally { if (active && current === request) setChecking(false); }
    };
    if (isAuthed) void check();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active' && isAuthed) void check(); });
    return () => { active = false; subscription.remove(); };
  }, [me.id, isAuthed, retry, refreshSignal, businessOnly]);
  const retained = isAuthed && access?.user === me.id && access.enabled && access.businessOnly === businessOnly;
  const verified = retained && !checking && !error && access.refreshSignal === refreshSignal && access.retry === retry;
  return <>
    {retained && <View style={{ display: verified ? 'flex' : 'none', pointerEvents: verified ? 'auto' : 'none' }} accessibilityElementsHidden={!verified} importantForAccessibility={verified ? 'auto' : 'no-hide-descendants'} {...(Platform.OS === 'web' ? { inert: !verified } : {})}>{children}</View>}
    {!verified && <View style={{ gap: 12, padding: 20 }}>
    <ThemedText accessibilityRole={error ? 'alert' : 'text'}>{error ? tr("비즈니스 권한을 확인하지 못했어요.") : access?.user === me.id && !access.enabled ? tr("비즈니스 관리 권한이 아직 없어요. 관리자에게 비즈니스 계정 승인을 요청해 주세요.") : tr("비즈니스 권한을 확인하고 있어요.")}</ThemedText>
    {(error || access?.user === me.id) && <Pressable analyticsId="merchant.access.retry" accessibilityRole="button" accessibilityLabel={tr("비즈니스 권한 다시 확인")} style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => { play('selection'); setError(false); setRetry(v => v + 1); }}><ThemedText>{tr("다시 확인")}</ThemedText></Pressable>}
  </View>}
  </>;
}
