import * as Location from 'expo-location';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { SymbolView } from 'expo-symbols';
import { AppState, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable } from '@/components/analytics-controls';
import { PostPinMap } from '@/components/post-pin-map';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import type { ChatLocation } from '@/lib/chat-location';
import { isFreshLocation } from '@/lib/location';
import { googlePinUrl, type PostPin } from '@/lib/post-maps';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

function LocationAction({ label, onPress, disabled = false, primary = false, icon }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean; icon?: ComponentProps<typeof SymbolView>['name'] }) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  return <Pressable analyticsId={'chat-location.' + (primary ? 'send' : label)} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
    onPress={() => { play('selection'); onPress(); }} style={({ pressed }) => [styles.button, { backgroundColor: primary ? theme.accent : 'transparent', opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}>
    {icon && <SymbolView name={icon} size={18} tintColor={primary ? theme.accentInk : theme.accent} />}
    <ThemedText type="smallBold" style={{ color: primary ? theme.accentInk : theme.text }}>{label}</ThemedText></Pressable>;
}

export function ChatLocationPicker({ sending, onSend, onClose }: { sending: boolean; onSend: (point: ChatLocation) => Promise<void>; onClose: () => void }) {
  const theme = useTheme(), insets = useSafeAreaInsets(), reducedMotion = useReducedMotion(), { height } = useWindowDimensions();
  const { play } = useInteractionFeedback();
  const revision = useRef(0);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(''), [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<ChatLocation | null>(null);
  useEffect(() => { const gate = revision; return () => { gate.current++; }; }, []);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => { if (state === 'background') { revision.current++; setBusy(false); } });
    return () => listener.remove();
  }, []);
  const select = (pin: PostPin, label = '') => {
    if (sending) return;
    try { googlePinUrl(pin); } catch { return; }
    revision.current++; setBusy(false); setError(null); play('selection');
    setSelection({ latitude: pin.latitude, longitude: pin.longitude, label: label.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 240) || '선택한 위치' });
  };
  const close = () => { if (!sending) { revision.current++; onClose(); } };
  const locate = async (search: boolean) => {
    if (busy || sending || (search && (!ready || !query.trim()))) return;
    if (search && Platform.OS === 'web') { play('warning'); setError('주소 검색은 앱에서 지원해요. 지도에서 원하는 지점을 골라주세요.'); return; }
    const operation = ++revision.current; setBusy(true); setError(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!search) {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (revision.current !== operation) return;
        if (!permission.granted) throw new Error('PERMISSION');
      } else if (Platform.OS === 'android' && !(await Location.getForegroundPermissionsAsync()).granted) throw new Error('SEARCH_PERMISSION');
      const result = await Promise.race([
        search ? Location.geocodeAsync(query.trim()) : Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), 15000); }),
      ]);
      if (revision.current !== operation || AppState.currentState !== 'active') return;
      if (Array.isArray(result)) {
        if (!result.length) throw new Error('NOT_FOUND');
        select(result[0], query.trim());
      } else {
        const fix = { latitude: result.coords.latitude, longitude: result.coords.longitude, accuracy: result.coords.accuracy, measuredAt: result.timestamp, mocked: result.mocked ?? false };
        if (!isFreshLocation(fix) || fix.accuracy == null || fix.accuracy > 250 || Date.now() - fix.measuredAt > 120000) throw new Error('INACCURATE');
        select(fix, '현재 위치');
      }
    } catch (failure) {
      if (revision.current === operation) { play('warning'); setError(failure instanceof Error && failure.message === 'PERMISSION'
        ? '위치 권한을 허용하거나 지도에서 원하는 지점을 골라주세요.'
        : failure instanceof Error && failure.message === 'SEARCH_PERMISSION' ? '주소 검색에 위치 권한이 필요해요. 현재 위치를 눌러 권한을 허용하거나 지도에서 골라주세요.'
        : '위치를 찾지 못했어요. 주소를 확인하거나 지도에서 골라주세요.'); }
    } finally { clearTimeout(timer); if (revision.current === operation) setBusy(false); }
  };
  return <Modal visible transparent statusBarTranslucent animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={() => { play('selection'); close(); }}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
      <Pressable analyticsId="chat-location.dismiss" accessibilityRole="button" accessibilityLabel="위치 공유 닫기" disabled={sending} onPress={() => { play('selection'); close(); }} style={StyleSheet.absoluteFill} />
      <View style={[styles.sheet, { maxHeight: Math.min(height * 0.82, 640), backgroundColor: theme.card, paddingBottom: Math.max(insets.bottom, 12) }]} accessibilityViewIsModal>
        <View style={styles.row}><ThemedText type="smallBold" style={{ flex: 1, fontSize: 18 }}>위치 공유하기</ThemedText>
          <Pressable analyticsId="chat-location.close" accessibilityRole="button" accessibilityLabel="위치 공유 닫기" accessibilityState={{ disabled: sending }} disabled={sending} onPress={() => { play('selection'); close(); }} style={({ pressed }) => [styles.close, { backgroundColor: theme.backgroundElement, opacity: sending ? 0.45 : pressed ? 0.7 : 1 }]}>
            <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={18} tintColor={theme.textSecondary} />
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }} contentContainerStyle={styles.content}>
          <View style={[styles.search, { backgroundColor: theme.backgroundElement }]}><View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden><SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={18} tintColor={theme.textSecondary} /></View>
            <TextInput value={query} onChangeText={setQuery} placeholder="장소 이름 또는 주소" accessibilityLabel="장소 이름 또는 주소" maxLength={240} editable={ready && !sending} returnKeyType="search" onSubmitEditing={() => { play('selection'); void locate(true); }}
              placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text }]} /><LocationAction label="검색" onPress={() => void locate(true)} disabled={!ready || !query.trim() || busy || sending} />
          </View>
          <View pointerEvents={sending ? 'none' : 'auto'} style={[styles.map, { height: Math.min(240, height * 0.32), backgroundColor: theme.backgroundElement }]}>
            <PostPinMap pin={selection} onSelect={select} onReadyChange={setReady} bottomInset={68} />
            <View style={[styles.current, { backgroundColor: theme.card, borderColor: theme.line }]}><LocationAction label={busy ? '위치 찾는 중' : '현재 위치 선택'} icon={{ ios: 'location.fill', android: 'my_location', web: 'my_location' }} onPress={() => void locate(false)} disabled={busy || sending} /></View>
          </View>
          {!!error && <ThemedText type="small" accessibilityRole="alert">{error}</ThemedText>}
          <View style={styles.place}><View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={[styles.placeIcon, { backgroundColor: theme.backgroundElement }]}><SymbolView name={{ ios: 'mappin.and.ellipse', android: 'location_on', web: 'location_on' }} size={22} tintColor={theme.accent} /></View>
            <View style={{ flex: 1 }}><ThemedText type="smallBold" numberOfLines={3}>{selection?.label ?? '공유할 위치를 골라주세요.'}</ThemedText><ThemedText type="small" themeColor="textSecondary">이 대화에 공유</ThemedText></View>
          </View>
          <LocationAction label={sending ? '보내는 중' : '이 위치 공유하기'} icon={{ ios: 'paperplane.fill', android: 'send', web: 'send' }} onPress={() => {
            if (!selection) return;
            const operation = revision.current;
            void onSend(selection).catch(() => { if (revision.current === operation) { play('warning'); setError('위치를 보내지 못했어요. 선택한 위치는 유지했으니 다시 시도해 주세요.'); } });
          }} disabled={sending || busy || !selection} primary />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' },
  sheet: { width: '100%', maxWidth: 600, alignSelf: 'center', flexShrink: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, gap: 12 },
  content: { gap: 12 }, row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, borderRadius: 14 }, input: { flex: 1, minWidth: 0, minHeight: 48, fontSize: 16 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  button: { minHeight: 48, minWidth: 48, flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12 },
  place: { flexDirection: 'row', alignItems: 'center', gap: 12 }, placeIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  map: { minHeight: 140, overflow: 'hidden', borderRadius: 16 }, current: { position: 'absolute', bottom: 12, left: 12, borderWidth: 1, borderRadius: 24 },
});
