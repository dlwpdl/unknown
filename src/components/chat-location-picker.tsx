import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
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

function LocationAction({ label, onPress, disabled = false, primary = false }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  return <Pressable analyticsId={'chat-location.' + (primary ? 'send' : label)} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
    onPress={() => { play('selection'); onPress(); }} style={({ pressed }) => [styles.button, { backgroundColor: primary ? theme.accent : theme.backgroundElement, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}>
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
      <View style={[styles.sheet, { maxHeight: Math.min(height * 0.82, 640), backgroundColor: theme.background, paddingBottom: Math.max(insets.bottom, 12) }]} accessibilityViewIsModal>
        <View style={styles.row}><ThemedText type="subtitle" style={{ flex: 1 }}>위치 공유하기</ThemedText><LocationAction label="닫기" onPress={close} disabled={sending} /></View>
        <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }} contentContainerStyle={styles.content}>
          <View style={styles.row}><TextInput value={query} onChangeText={setQuery} placeholder="장소 이름 또는 주소" accessibilityLabel="장소 이름 또는 주소" maxLength={240} editable={ready && !sending} returnKeyType="search" onSubmitEditing={() => { play('selection'); void locate(true); }}
            placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} /><LocationAction label="검색" onPress={() => void locate(true)} disabled={!ready || !query.trim() || busy || sending} /></View>
          <View pointerEvents={sending ? 'none' : 'auto'} style={[styles.map, { height: Math.min(240, height * 0.32), backgroundColor: theme.backgroundElement }]}>
            <PostPinMap pin={selection} onSelect={select} onReadyChange={setReady} bottomInset={68} />
            <View style={styles.current}><LocationAction label={busy ? '위치 찾는 중' : '현재 위치 선택'} onPress={() => void locate(false)} disabled={busy || sending} /></View>
          </View>
          {!!error && <ThemedText type="small" accessibilityRole="alert">{error}</ThemedText>}
          <ThemedText type="smallBold" numberOfLines={3}>{selection?.label ?? '지도에서 공유할 위치를 골라주세요.'}</ThemedText>
          <LocationAction label={sending ? '보내는 중' : '이 위치 공유하기'} onPress={() => {
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
  sheet: { width: '100%', maxWidth: 600, alignSelf: 'center', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, gap: 12 },
  content: { gap: 12 }, row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, minWidth: 0, minHeight: 48, borderRadius: 12, paddingHorizontal: 12, fontSize: 16 },
  button: { minHeight: 48, minWidth: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  map: { minHeight: 140, overflow: 'hidden', borderRadius: 16 }, current: { position: 'absolute', bottom: 12, left: 12 },
});
