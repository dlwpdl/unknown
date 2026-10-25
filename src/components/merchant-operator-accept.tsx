import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { acceptMerchantOperatorLink, MERCHANT_OPERATOR_INVITE_PARAM, previewMerchantOperatorLink, readMerchantOperatorInvite, type MerchantOperatorPreview } from '@/lib/merchant-operators';
import { supabase } from '@/lib/supabase';

const storageKey = 'gling.merchant.operator-invite';
const errors: Record<string, string> = {
  MERCHANT_INVITATION_NOT_AVAILABLE: '이 초대 링크는 쓸 수 없어요. 만료됐거나 이미 사용됐을 수 있어요. 사장님께 새 링크를 받아 주세요.',
  MERCHANT_ALREADY_CONNECTED: '이미 이 비즈니스를 관리하고 있어요.',
  MERCHANT_OPERATOR_LIMIT: '이 비즈니스의 공동 관리자 자리가 모두 찼어요. 사장님께 확인해 주세요.',
  RATE_LIMITED: '요청이 많아요. 잠시 후 다시 시도해 주세요.',
};

// Keeps the token across the login round-trip in this tab only, and removes it from the visible URL.
function takeInviteToken(): string | null {
  if (typeof window === 'undefined') return null;
  const fromUrl = readMerchantOperatorInvite(window.location.search);
  try {
    if (fromUrl) {
      window.sessionStorage.setItem(storageKey, fromUrl);
      const url = new URL(window.location.href); url.searchParams.delete(MERCHANT_OPERATOR_INVITE_PARAM);
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      return fromUrl;
    }
    return readMerchantOperatorInvite(`?${MERCHANT_OPERATOR_INVITE_PARAM}=${window.sessionStorage.getItem(storageKey) ?? ''}`);
  } catch { return fromUrl; }
}
function clearInviteToken() { try { window.sessionStorage.removeItem(storageKey); } catch {} }

export function MerchantOperatorAccept({ userId, isAuthed, onJoined }: { userId: string; isAuthed: boolean; onJoined: () => void }) {
  const { tr } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [token, setToken] = useState<string | null>(takeInviteToken);
  const [preview, setPreview] = useState<{ user: string; value: MerchantOperatorPreview } | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [joined, setJoined] = useState('');
  useEffect(() => {
    if (!token || !isAuthed) return;
    let active = true;
    void previewMerchantOperatorLink(supabase, token).then(value => { if (active) { setPreview({ user: userId, value }); setError(''); } })
      .catch(failure => { if (active) { setPreview(null); setError(errors[failure instanceof Error ? failure.message : ''] ?? errors.MERCHANT_INVITATION_NOT_AVAILABLE); } });
    return () => { active = false; };
  }, [token, isAuthed, userId]);
  if (!token && !joined) return null;
  const card = [styles.card, { backgroundColor: theme.card, borderColor: theme.accent }];
  if (joined) return <View style={card} accessibilityLiveRegion="polite"><ThemedText type="smallBold">{tr('{0}의 공동 관리자가 됐어요.', joined)}</ThemedText></View>;
  if (!isAuthed) return <View style={card}><ThemedText type="smallBold">{tr('공동 관리자 초대를 받았어요.')}</ThemedText><ThemedText type="small" themeColor="textSecondary">{tr('아래에서 글링에 로그인하면 참여할 수 있어요.')}</ThemedText></View>;
  const current = preview?.user === userId ? preview.value : null;
  function dismiss() { play('selection'); clearInviteToken(); setToken(null); }
  async function accept() {
    if (!token || busy) return;
    setBusy(true); setError('');
    try {
      await acceptMerchantOperatorLink(supabase, token);
      clearInviteToken(); setToken(null); setJoined(current?.merchant_name ?? ''); play('success'); onJoined();
    } catch (failure) { play('warning'); setError(errors[failure instanceof Error ? failure.message : ''] ?? '참여하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  }
  return <View style={card}>
    {current ? <>
      <ThemedText type="subtitle" accessibilityRole="header">{tr('{0}의 공동 관리자로 참여할까요?', current.merchant_name)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{tr('{0} · 참여하면 이 비즈니스의 글과 사진을 함께 관리해요.', tr(current.city_name))}</ThemedText>
    </> : !error && <ThemedText type="small" themeColor="textSecondary">{tr('초대 링크를 확인하고 있어요.')}</ThemedText>}
    {!!error && <ThemedText type="small" accessibilityRole="alert">{tr(error)}</ThemedText>}
    <View style={styles.row}>
      {current && <RaisedActionButton compact analyticsId="merchant.primary" label={busy ? tr('참여하는 중…') : tr('참여하기')} disabled={busy} onPress={() => { play('selection'); void accept(); }} />}
      <Pressable analyticsId="merchant.connection.action" accessibilityRole="button" accessibilityLabel={tr('닫기')} disabled={busy} onPress={dismiss}
        style={({ pressed }) => [styles.button, { borderColor: theme.line, opacity: pressed ? 0.7 : 1 }]}><ThemedText type="smallBold">{tr('닫기')}</ThemedText></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { gap: 10, padding: 18, borderWidth: 1, borderRadius: 20, width: '100%', maxWidth: 760, alignSelf: 'center' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  button: { minHeight: 44, minWidth: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
});
