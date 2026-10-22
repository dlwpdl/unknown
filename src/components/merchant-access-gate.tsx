import { useEffect, useState, type ReactNode } from 'react';
import { AppState, View } from 'react-native';
import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { getMyMerchantAccess } from '@/lib/merchant-workspace';
import { supabase } from '@/lib/supabase';

export function MerchantAccessGate({ children, refreshSignal = 0 }: { children: ReactNode; refreshSignal?: number }) {
  const { me, isAuthed } = useAuth(); const { play } = useInteractionFeedback();
  const [access, setAccess] = useState<{ user: string; enabled: boolean } | null>(null);
  const [error, setError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const check = async () => {
      try { const enabled = await getMyMerchantAccess(supabase); if (active) { setAccess({ user: me.id, enabled }); setError(false); } }
      catch { if (active) { setAccess(null); setError(true); } }
    };
    if (isAuthed) void check();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active' && isAuthed) void check(); });
    return () => { active = false; subscription.remove(); };
  }, [me.id, isAuthed, retry, refreshSignal]);
  if (isAuthed && access?.user === me.id && access.enabled && !error) return <>{children}</>;
  return <View style={{ gap: 12, padding: 20 }}>
    <ThemedText accessibilityRole={error ? 'alert' : 'text'}>{error ? '업체 권한을 확인하지 못했어요.' : access?.user === me.id && !access.enabled ? '업체 관리 권한이 아직 없어요. 관리자에게 업체 계정 승인을 요청해 주세요.' : '업체 권한을 확인하고 있어요.'}</ThemedText>
    {(error || access?.user === me.id) && <Pressable analyticsId="merchant.access.retry" accessibilityRole="button" accessibilityLabel="업체 권한 다시 확인" style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => { play('selection'); setAccess(null); setRetry(v => v + 1); }}><ThemedText>다시 확인</ThemedText></Pressable>}
  </View>;
}
