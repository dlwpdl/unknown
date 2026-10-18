import { useLayoutEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useChatIdentity } from '@/hooks/use-chat-identity';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { selectChatBusiness } from '@/lib/chat-identity';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadMyMerchantConnections, type MyMerchantConnections } from '@/lib/merchant-connections';
import { supabase } from '@/lib/supabase';

export function ChatIdentitySwitcher({ onChanged }: { onChanged?: () => void }) {
  const { me, isAuthed, isAdmin } = useAuth(), business = useChatIdentity();
  const { tr } = useLanguage(), theme = useTheme(), { play } = useInteractionFeedback();
  const [openedFor, setOpenedFor] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [result, setResult] = useState<MyMerchantConnections | null>(null);
  const user = useRef(me.id), serial = useRef(0), pending = useRef(false);
  useLayoutEffect(() => {
    user.current = isAuthed && !isAdmin ? me.id : ''; serial.current++; pending.current = false;
    return () => { user.current = ''; };
  }, [me.id, isAuthed, isAdmin]);
  if (!isAuthed || isAdmin) return null;
  const rows = result?.user_id === me.id ? result.merchants.filter(row => row.role !== 'admin') : [];
  const name = business?.name ?? me.nickname;
  function close() { play('selection'); serial.current++; pending.current = false; setBusy(false); setOpenedFor(null); }
  async function open() {
    if (pending.current) return;
    play('selection'); pending.current = true; setBusy(true); setError(''); setResult(null); setOpenedFor(me.id);
    const request = ++serial.current;
    try {
      const next = await loadMyMerchantConnections(supabase, me.id);
      if (user.current === me.id && request === serial.current) setResult(next);
    } catch {
      if (user.current === me.id && request === serial.current) { setError('연결을 확인하지 못했어요. 현재 프로필은 유지돼요.'); play('warning'); }
    } finally {
      if (user.current === me.id && request === serial.current) { pending.current = false; setBusy(false); }
    }
  }
  async function choose(id: string | null) {
    if (pending.current || user.current !== me.id) return;
    play('selection');
    if (id === null) { selectChatBusiness(me.id, null); setOpenedFor(null); onChanged?.(); return; }
    pending.current = true; setBusy(true); setError('');
    const request = ++serial.current;
    try {
      const next = await loadMyMerchantConnections(supabase, me.id);
      if (user.current !== me.id || request !== serial.current) return;
      setResult(next);
      const selected = next.merchants.find(row => row.id === id && row.role !== 'admin');
      if (!selected) throw new Error('MERCHANT_ACCESS_REQUIRED');
      selectChatBusiness(me.id, selected); setOpenedFor(null); onChanged?.(); play('success');
    } catch {
      if (user.current === me.id && request === serial.current) { setError('비즈니스 연결을 다시 확인해 주세요. 현재 프로필은 유지돼요.'); play('warning'); }
    } finally {
      if (user.current === me.id && request === serial.current) { pending.current = false; setBusy(false); }
    }
  }
  const optionStyle = (selected: boolean) => [styles.option, { borderColor: selected ? theme.accent : theme.line, backgroundColor: selected ? theme.backgroundSelected : theme.card, opacity: busy ? 0.5 : 1 }];
  return <>
    <Pressable analyticsId="chat.identity.open" accessibilityRole="button" accessibilityLabel={tr('대화 프로필 선택: {0}', name)}
      onPress={() => { void open(); }} style={({ pressed }) => [styles.current, { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement }]}>
      <SymbolView name={business ? { ios: 'storefront', android: 'storefront', web: 'storefront' } : { ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' }} size={20} tintColor={theme.accent} />
      <View style={{ flex: 1 }}><ThemedText type="smallBold" numberOfLines={1}>{name}</ThemedText><ThemedText type="small" themeColor="textSecondary">{tr(business ? '비즈니스 대화함' : '개인 대화함')}</ThemedText></View>
      <SymbolView name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }} size={14} tintColor={theme.textSecondary} />
    </Pressable>
    <Modal visible={openedFor === me.id} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}><SafeAreaView edges={['bottom']} accessibilityViewIsModal onAccessibilityEscape={close} style={[styles.sheet, { backgroundColor: theme.card }]}>
        <View style={styles.heading}><ThemedText type="subtitle">{tr('대화 프로필')}</ThemedText><Pressable analyticsId="chat.identity.close" accessibilityRole="button" accessibilityLabel={tr('프로필 선택 닫기')} onPress={close} style={styles.close}><ThemedText type="smallBold">{tr('닫기')}</ThemedText></Pressable></View>
        <ScrollView analyticsId="chat.identity.options" contentContainerStyle={{ gap: 10 }}>
          <Pressable analyticsId="chat.identity.personal" accessibilityRole="radio" accessibilityState={{ selected: !business, disabled: busy }} disabled={busy} onPress={() => { void choose(null); }} style={optionStyle(!business)}>
            <View style={styles.optionHeading}><ThemedText type="smallBold" style={{ flex: 1 }}>{me.nickname}</ThemedText>{!business && <ThemedText type="smallBold" themeColor="accent">✓</ThemedText>}</View><ThemedText type="small" themeColor="textSecondary">{tr('개인 프로필')}</ThemedText>
          </Pressable>
          {rows.map(row => <Pressable key={row.id} analyticsId="chat.identity.business" accessibilityRole="radio" accessibilityState={{ selected: row.id === business?.id, disabled: busy }} disabled={busy} onPress={() => { void choose(row.id); }} style={optionStyle(row.id === business?.id)}>
            <View style={styles.optionHeading}><ThemedText type="smallBold" style={{ flex: 1 }}>{row.name}</ThemedText>{row.id === business?.id && <ThemedText type="smallBold" themeColor="accent">✓</ThemedText>}</View><ThemedText type="small" themeColor="textSecondary">{tr('비즈니스')}</ThemedText>
          </Pressable>)}
          {busy && <ThemedText accessibilityLiveRegion="polite" type="small">{tr('현재 연결 확인 중…')}</ThemedText>}
          {!!error && <ThemedText accessibilityRole="alert" type="small">{tr(error)}</ThemedText>}
        </ScrollView>
      </SafeAreaView></View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  current: { minHeight: 56, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  backdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  sheet: { width: '100%', maxWidth: 560, maxHeight: '75%', alignSelf: 'center', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 24, gap: 16 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  optionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  option: { minHeight: 64, padding: 14, gap: 4, borderWidth: 1, borderRadius: 14 },
});
