import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, Linking, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Pressable } from '@/components/analytics-controls';
import { ClayPillFill, useClay } from '@/components/clay';
import { ThemedText } from '@/components/themed-text';
import { useChatIdentity } from '@/hooks/use-chat-identity';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { startMerchantConversation } from '@/lib/merchant-conveniences';
import { loadMerchantProfile } from '@/lib/merchant-profile';
import { reservationAction } from '@/lib/reservation';
import { supabase } from '@/lib/supabase';

type Contact = { merchantId: string; links: string[]; phone: string; canMessage: boolean };

/** 예약하기: hands off to the booking site, phone or Gling message the place already has; renders nothing when it has none. */
export function ReservationButton({ merchantId, website, style }: { merchantId?: string; website?: string | null; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme(), clay = useClay(), router = useRouter(), { play } = useInteractionFeedback(), { tr } = useLanguage();
  const { isAuthed, promptLogin } = useAuth(), business = useChatIdentity();
  const [contact, setContact] = useState<Contact | null>(null), busy = useRef(false);
  useEffect(() => {
    if (!merchantId) return;
    let active = true;
    void loadMerchantProfile(supabase, merchantId).then(profile => {
      if (active && profile) setContact({ merchantId, links: (profile.links ?? []).map(link => link.url), phone: profile.public_phone, canMessage: profile.can_message });
    }).catch(() => { /* No profile means only the place's own booking link can show. */ });
    return () => { active = false; };
  }, [merchantId]);
  const known = merchantId && contact?.merchantId === merchantId ? contact : null;
  const action = reservationAction({ links: [...(known?.links ?? []), website], phone: known?.phone, canMessage: !!known?.canMessage && business?.id !== merchantId });
  if (!action) return null;
  const failed = (title: string, body: string) => { play('warning'); Alert.alert(tr(title), tr(body)); };
  const press = async () => {
    play('selection');
    if (action.kind === 'link') return void Linking.openURL(action.url).catch(() => failed('예약 페이지를 열지 못했어요', '인터넷 연결을 확인하고 다시 시도해 주세요.'));
    if (action.kind === 'phone') return void Linking.openURL(action.url).catch(() => failed('전화를 걸지 못했어요', '잠시 후 다시 시도해 주세요.'));
    if (!isAuthed) return promptLogin(tr('비즈니스에 문의하려면 로그인해 주세요.'));
    if (!merchantId || busy.current) return;
    busy.current = true;
    try {
      const conversationId = await startMerchantConversation(supabase, merchantId, business?.id ?? null);
      play('message'); router.push({ pathname: '/chat', params: { conversationId, view: 'direct', ...(business ? { businessId: business.id } : {}) } });
    } catch { failed('문의를 시작하지 못했어요', '문의를 시작하지 못했어요. 담당자 연결 상태와 네트워크를 확인해 주세요.'); }
    finally { busy.current = false; }
  };
  return <Pressable analyticsId={`place.reserve.${action.kind}`} accessibilityRole={action.kind === 'message' ? 'button' : 'link'}
    accessibilityLabel={action.kind === 'link' ? tr('예약하기, 예약 사이트 열기') : action.kind === 'phone' ? tr('예약하기, 전화 걸기') : tr('예약하기, 글링 메시지로 문의')}
    onPress={() => void press()} style={({ pressed }) => [styles.button, clay && styles.clayButton, { backgroundColor: clay ? 'transparent' : theme.accent, opacity: pressed ? 0.82 : 1 }, style]}>
    {clay && <ClayPillFill kind="cta" />}
    <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{tr('예약하기')}{action.kind === 'link' ? ' ↗' : ''}</ThemedText>
  </Pressable>;
}

const styles = StyleSheet.create({ clayButton: { overflow: 'visible', paddingHorizontal: 18 }, button: { minHeight: 44, minWidth: 44, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' } });
