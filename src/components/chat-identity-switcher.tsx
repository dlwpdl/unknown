import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, Modal, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
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
import { businessMediaUrl } from '@/lib/business-media';
import { ControlStyles, Typography, controlPresentation } from '@/constants/design-system';

export function ChatIdentitySwitcher({ onChanged, target = 'chat', onAvailabilityChange }: { onChanged?: () => void; target?: 'chat' | 'business'; onAvailabilityChange?: (available: boolean) => void }) {
  const { me, isAuthed } = useAuth(), business = useChatIdentity(), router = useRouter();
  const { tr } = useLanguage(), theme = useTheme(), { play } = useInteractionFeedback();
  const [openedFor, setOpenedFor] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [result, setResult] = useState<MyMerchantConnections | null>(null);
  const user = useRef(me.id), serial = useRef(0), pending = useRef(false);
  useLayoutEffect(() => {
    user.current = isAuthed ? me.id : ''; serial.current++; pending.current = false;
    return () => { user.current = ''; setBusy(false); setError(''); setOpenedFor(null); };
  }, [me.id, isAuthed]);
  useFocusEffect(useCallback(() => {
    if (!isAuthed || target !== 'business') return;
    let active = true;
    const refresh = async () => {
      if (pending.current) return;
      const request = ++serial.current;
      try {
        const next = await loadMyMerchantConnections(supabase, me.id, true);
        if (active && user.current === me.id && request === serial.current) setResult(next);
      } catch {
        if (active && user.current === me.id && request === serial.current) { setResult(null); setOpenedFor(null); }
      }
    };
    void refresh();
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    return () => { active = false; serial.current++; pending.current = false; setBusy(false); setOpenedFor(null); listener.remove(); };
  }, [isAuthed, me.id, target]));
  const rows = isAuthed && result?.user_id === me.id ? result.merchants.filter(row => row.role !== 'admin') : [];
  useEffect(() => {
    onAvailabilityChange?.(target === 'business' && rows.length > 0);
    return () => onAvailabilityChange?.(false);
  }, [onAvailabilityChange, target, rows.length]);
  if (!isAuthed) return null;
  if (target === 'business' && !rows.length && openedFor !== me.id) return null;
  const name = business?.name ?? me.nickname;
  function close() { play('selection'); serial.current++; pending.current = false; setBusy(false); setOpenedFor(null); }
  async function open() {
    if (pending.current) return;
    if (target === 'business') { play('selection'); setError(''); setOpenedFor(me.id); return; }
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
    if (id === null) { selectChatBusiness(me.id, null); setOpenedFor(null); onChanged?.(); if (target === 'business') router.push('/profile'); return; }
    pending.current = true; setBusy(true); setError('');
    const request = ++serial.current;
    try {
      const next = await loadMyMerchantConnections(supabase, me.id, true);
      if (user.current !== me.id || request !== serial.current) return;
      setResult(next);
      const selected = next.merchants.find(row => row.id === id && row.role !== 'admin');
      if (!selected) throw new Error('MERCHANT_ACCESS_REQUIRED');
      selectChatBusiness(me.id, selected); setOpenedFor(null); onChanged?.();
      if (target === 'chat') play('success');
      if (target === 'business') router.push({ pathname: '/profile/merchant', params: { merchant: selected.id } });
    } catch {
      if (user.current === me.id && request === serial.current) { setError('비즈니스 연결을 다시 확인해 주세요. 현재 프로필은 유지돼요.'); play('warning'); }
    } finally {
      if (user.current === me.id && request === serial.current) { pending.current = false; setBusy(false); }
    }
  }
  const optionStyle = (selected: boolean) => [styles.option, { backgroundColor: selected ? theme.backgroundSelected : theme.card, opacity: busy ? 0.5 : 1 }];
  const photo = (uri: string | null | undefined, personal = false) => <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
    <SymbolView name={personal ? { ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' } : { ios: 'storefront', android: 'storefront', web: 'storefront' }} size={22} tintColor={theme.accent} />
    {!!uri && <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" accessible={false} />}
  </View>;
  return <>
    {target === 'business' ? <Pressable analyticsId="chat.identity.open" accessibilityRole="button" accessibilityLabel={tr('프로필 전환')}
      accessibilityState={{ expanded: openedFor === me.id }} onPress={() => { void open(); }}
      style={({ pressed }) => [ControlStyles.icon, controlPresentation(theme, { tone: 'ghost', pressed }).container]}>
      <SymbolView name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }} size={14} tintColor={theme.textSecondary} />
    </Pressable> :
    <Pressable analyticsId="chat.identity.open" accessibilityRole="button" accessibilityLabel={tr('대화 프로필 선택: {0}', name)}
      accessibilityState={{ expanded: openedFor === me.id }}
      onPress={() => { void open(); }} style={({ pressed }) => [styles.current, { borderColor: theme.line, backgroundColor: pressed ? theme.backgroundSelected : theme.card }]}>
      <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}><SymbolView name={business ? { ios: 'storefront', android: 'storefront', web: 'storefront' } : { ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' }} size={22} tintColor={theme.accent} /></View>
      <View style={styles.identity}><ThemedText style={styles.name} numberOfLines={1}>{name}</ThemedText><ThemedText type="small" themeColor="textSecondary">{tr(business ? '비즈니스 대화함' : '개인 대화함')}</ThemedText></View>
      <SymbolView name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }} size={14} tintColor={theme.textSecondary} />
    </Pressable>}
    <Modal visible={openedFor === me.id} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}><Pressable analyticsId="chat.identity.close" accessibilityRole="button" accessibilityLabel={tr('프로필 선택 닫기')} onPress={close} style={StyleSheet.absoluteFill} /><SafeAreaView edges={['bottom']} accessibilityViewIsModal onAccessibilityEscape={close} style={[styles.sheet, { backgroundColor: theme.card }]}>
        <View style={styles.heading}><ThemedText style={Typography.sheetTitle}>{tr(target === 'business' ? '프로필 전환' : '대화 프로필')}</ThemedText><Pressable analyticsId="chat.identity.close" accessibilityRole="button" accessibilityLabel={tr('프로필 선택 닫기')} onPress={close} style={styles.close}><SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={18} tintColor={theme.textSecondary} /></Pressable></View>
        <ScrollView analyticsId="chat.identity.options" contentContainerStyle={{ gap: 10 }}>
          <Pressable analyticsId="chat.identity.personal" accessibilityRole="radio" accessibilityState={{ selected: !business, disabled: busy }} disabled={busy} onPress={() => { void choose(null); }} style={optionStyle(!business)}>
            {photo(me.photoUri, true)}
            <View style={styles.identity}><ThemedText style={styles.name}>{me.nickname}</ThemedText><ThemedText type="small" themeColor="textSecondary">{tr('개인 프로필')}</ThemedText></View>{!business && <SymbolView name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }} size={22} tintColor={theme.accent} />}
          </Pressable>
          {rows.map(row => <Pressable key={row.id} analyticsId="chat.identity.business" accessibilityRole="radio" accessibilityState={{ selected: row.id === business?.id, disabled: busy }} disabled={busy} onPress={() => { void choose(row.id); }} style={optionStyle(row.id === business?.id)}>
            {photo(typeof row.avatar_path === 'string' && row.avatar_path.startsWith(`business-profile/${row.id}/avatar/`) ? businessMediaUrl(row.avatar_path) : null)}
            <View style={styles.identity}><ThemedText style={styles.name}>{row.name}</ThemedText><ThemedText type="small" themeColor="textSecondary">{tr('비즈니스')}{target === 'business' ? ` · ${tr(row.role === 'owner' ? '소유자' : '운영 담당자')}` : ''}</ThemedText></View>{row.id === business?.id && <SymbolView name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }} size={22} tintColor={theme.accent} />}
          </Pressable>)}
          {busy && <ThemedText accessibilityLiveRegion="polite" type="small">{tr('현재 연결 확인 중…')}</ThemedText>}
          {!!error && <ThemedText accessibilityRole="alert" type="small">{tr(error)}</ThemedText>}
          {target === 'business' && <ThemedText type="small" themeColor="textSecondary">{tr('연결된 비즈니스만 보여요. 전환한 뒤 글쓰기와 사진 관리를 할 수 있어요.')}</ThemedText>}
        </ScrollView>
      </SafeAreaView></View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  current: { flexShrink: 0, minHeight: 72, marginBottom: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  identity: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  sheet: { width: '100%', maxWidth: 560, maxHeight: '75%', alignSelf: 'center', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 24, gap: 16 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { flex: 1, fontSize: 20, lineHeight: 28, fontWeight: '700' },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  option: { minHeight: 72, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16 },
});
