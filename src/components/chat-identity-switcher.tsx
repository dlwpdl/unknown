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
  const { me, isAuthed } = useAuth(), business = useChatIdentity();
  const { tr } = useLanguage(), theme = useTheme(), { play } = useInteractionFeedback();
  const [openedFor, setOpenedFor] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [result, setResult] = useState<MyMerchantConnections | null>(null);
  const user = useRef(me.id), serial = useRef(0), pending = useRef(false);
  useLayoutEffect(() => {
    user.current = isAuthed ? me.id : ''; serial.current++; pending.current = false;
    return () => { user.current = ''; };
  }, [me.id, isAuthed]);
  if (!isAuthed) return null;
  const rows = result?.user_id === me.id ? result.merchants.filter(row => row.role !== 'admin') : [];
  const name = business?.name ?? me.nickname;
  function close() { play('selection'); serial.current++; pending.current = false; setBusy(false); setOpenedFor(null); }
  async function open() {
    if (pending.current) return;
    play('selection'); pending.current = true; setBusy(true); setError(''); setResult(null); setOpenedFor(me.id);
    const request = ++serial.current;
    try {
      const next = await loadMyMerchantConnections(supabase, me.id, true);
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
      const next = await loadMyMerchantConnections(supabase, me.id, true);
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
  const optionStyle = (selected: boolean) => [styles.option, { backgroundColor: selected ? theme.backgroundSelected : theme.card, opacity: busy ? 0.5 : 1 }];
  return <>
    <Pressable analyticsId="chat.identity.open" accessibilityRole="button" accessibilityLabel={tr('대화 프로필 선택: {0}', name)}
      accessibilityState={{ expanded: openedFor === me.id }}
      onPress={() => { void open(); }} style={({ pressed }) => [styles.current, { borderColor: theme.line, backgroundColor: pressed ? theme.backgroundSelected : theme.card }]}>
      <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}><SymbolView name={business ? { ios: 'storefront', android: 'storefront', web: 'storefront' } : { ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' }} size={22} tintColor={theme.accent} /></View>
      <View style={styles.identity}><ThemedText style={styles.name} numberOfLines={1}>{name}</ThemedText><ThemedText type="small" themeColor="textSecondary">{tr(business ? '비즈니스 대화함' : '개인 대화함')}</ThemedText></View>
      <SymbolView name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }} size={14} tintColor={theme.textSecondary} />
    </Pressable>
    <Modal visible={openedFor === me.id} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}><SafeAreaView edges={['bottom']} accessibilityViewIsModal onAccessibilityEscape={close} style={[styles.sheet, { backgroundColor: theme.card }]}>
        <View style={styles.heading}><ThemedText style={styles.sheetTitle}>{tr('대화 프로필')}</ThemedText><Pressable analyticsId="chat.identity.close" accessibilityRole="button" accessibilityLabel={tr('프로필 선택 닫기')} onPress={close} style={styles.close}><SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={18} tintColor={theme.textSecondary} /></Pressable></View>
        <ScrollView analyticsId="chat.identity.options" contentContainerStyle={{ gap: 10 }}>
          <Pressable analyticsId="chat.identity.personal" accessibilityRole="radio" accessibilityState={{ selected: !business, disabled: busy }} disabled={busy} onPress={() => { void choose(null); }} style={optionStyle(!business)}>
            <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}><SymbolView name={{ ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' }} size={22} tintColor={theme.accent} /></View>
            <View style={styles.identity}><ThemedText style={styles.name}>{me.nickname}</ThemedText><ThemedText type="small" themeColor="textSecondary">{tr('개인 프로필')}</ThemedText></View>{!business && <SymbolView name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }} size={22} tintColor={theme.accent} />}
          </Pressable>
          {rows.map(row => <Pressable key={row.id} analyticsId="chat.identity.business" accessibilityRole="radio" accessibilityState={{ selected: row.id === business?.id, disabled: busy }} disabled={busy} onPress={() => { void choose(row.id); }} style={optionStyle(row.id === business?.id)}>
            <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}><SymbolView name={{ ios: 'storefront', android: 'storefront', web: 'storefront' }} size={22} tintColor={theme.accent} /></View>
            <View style={styles.identity}><ThemedText style={styles.name}>{row.name}</ThemedText><ThemedText type="small" themeColor="textSecondary">{tr('비즈니스')}</ThemedText></View>{row.id === business?.id && <SymbolView name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }} size={22} tintColor={theme.accent} />}
          </Pressable>)}
          {busy && <ThemedText accessibilityLiveRegion="polite" type="small">{tr('현재 연결 확인 중…')}</ThemedText>}
          {!!error && <ThemedText accessibilityRole="alert" type="small">{tr(error)}</ThemedText>}
        </ScrollView>
      </SafeAreaView></View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  current: { flexShrink: 0, minHeight: 72, marginBottom: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  identity: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  sheet: { width: '100%', maxWidth: 560, maxHeight: '75%', alignSelf: 'center', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 24, gap: 16 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { flex: 1, fontSize: 20, lineHeight: 28, fontWeight: '700' },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  option: { minHeight: 72, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16 },
});
