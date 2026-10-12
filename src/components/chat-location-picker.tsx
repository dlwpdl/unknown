import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, TextInput, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable } from '@/components/analytics-controls';
import { ChatMap } from '@/components/chat-map';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { chatMapHtml, parseChatMapEvent, type ChatLocation, type ChatMapCommand } from '@/lib/chat-location';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

function LocationAction({ label, onPress, disabled = false, primary = false }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  return <Pressable analyticsId={`chat-location.${primary ? 'send' : label}`} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
    onPress={() => { play('selection'); onPress(); }} style={({ pressed }) => [styles.button, { backgroundColor: primary ? theme.accent : theme.backgroundElement, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}>
    <ThemedText type="smallBold" style={{ color: primary ? theme.accentInk : theme.text }}>{label}</ThemedText></Pressable>;
}

export function ChatLocationPicker({ sending, onSend, onClose }: { sending: boolean; onSend: (point: ChatLocation) => Promise<void>; onClose: () => void }) {
  const theme = useTheme(), insets = useSafeAreaInsets(), reducedMotion = useReducedMotion();
  const { play } = useInteractionFeedback();
  const key = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
  const html = useMemo(() => key ? chatMapHtml(key) : '', [key]);
  const mounted = useRef(true), locating = useRef(false);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(''), [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<ChatLocation | null>(null), [command, setCommand] = useState<ChatMapCommand | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!key || ready) return;
    const timer = setTimeout(() => setError('지도를 불러오지 못했어요. 현재 위치를 선택하거나 잠시 후 다시 열어 주세요.'), 15000);
    return () => clearTimeout(timer);
  }, [key, ready]);
  const receive = useCallback((data: string) => {
    const event = parseChatMapEvent(data); if (!event) return;
    if (event.type === 'selection' && !sending) { setSelection(event); setError(null); play('selection'); }
    else if (event.type === 'ready') { setReady(true); setError(null); if (selection) setCommand({ ...selection, type: 'point' }); }
    else if (event.type === 'error') { setError('지도나 검색을 불러오지 못했어요. 연결을 확인해 주세요.'); play('warning'); }
    else if (event.type === 'empty') setError('검색 결과가 없어요. 장소 이름이나 주소를 바꿔 보세요.');
  }, [play, sending, selection]);
  const currentLocation = async () => {
    if (locating.current || sending) return;
    locating.current = true; setBusy(true); setError(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('LOCATION_PERMISSION');
      if (!mounted.current) return;
      const position = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('LOCATION_TIMEOUT')), 15000); })]);
      if (!mounted.current) return;
      const event = parseChatMapEvent(JSON.stringify({ type: 'selection', latitude: position.coords.latitude, longitude: position.coords.longitude, label: '현재 위치' }));
      if (!event || event.type !== 'selection') throw new Error('LOCATION_UNAVAILABLE');
      setSelection(event); if (ready) setCommand({ ...event, type: 'point' }); play('selection');
    } catch (failure) {
      if (mounted.current) { play('warning'); setError(failure instanceof Error && failure.message === 'LOCATION_PERMISSION'
        ? '현재 위치를 선택하려면 위치 권한을 허용해 주세요.' : '현재 위치를 찾지 못했어요. 위치 설정을 확인해 주세요.'); }
    } finally { clearTimeout(timer); locating.current = false; if (mounted.current) setBusy(false); }
  };
  const search = () => { if (!ready || !query.trim() || sending) return; setError(null); setSelection(null); setCommand({ type: 'search', query: query.trim() }); };
  return <Modal visible animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={() => { if (!sending) { play('selection'); onClose(); } }}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.screen, { backgroundColor: theme.background, paddingTop: Math.max(insets.top, 12), paddingBottom: Math.max(insets.bottom, 12) }]} accessibilityViewIsModal>
      <View style={styles.row}><ThemedText type="subtitle" style={{ flex: 1 }}>위치 공유하기</ThemedText><LocationAction label="닫기" onPress={onClose} disabled={sending} /></View>
      <View style={styles.row}><TextInput value={query} onChangeText={setQuery} placeholder="장소 이름 또는 주소" accessibilityLabel="장소 이름 또는 주소" maxLength={240} editable={ready && !sending} returnKeyType="search" onSubmitEditing={() => { play('selection'); search(); }}
        placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} /><LocationAction label="검색" onPress={search} disabled={!ready || !query.trim() || sending} /></View>
      <View pointerEvents={sending ? 'none' : 'auto'} style={[styles.map, { backgroundColor: theme.backgroundElement }]}>{key ? <><ChatMap html={html} command={command} onEvent={receive} />{!ready && <View style={[styles.mapLoading, { backgroundColor: theme.backgroundElement }]}><ThemedText type="small" themeColor="textSecondary">{error ?? '지도를 불러오는 중이에요.'}</ThemedText></View>}</>
        : <ThemedText type="small" themeColor="textSecondary" style={{ padding: 24 }}>지도 검색을 준비 중이에요. 현재 위치는 아래 버튼으로 선택할 수 있어요.</ThemedText>}</View>
      <View style={styles.row}><LocationAction label={busy ? '위치 찾는 중' : '현재 위치 선택'} onPress={() => void currentLocation()} disabled={busy || sending} /><ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>{key ? '장소를 검색하거나 지도에서 눌러 선택하세요.' : '현재 위치를 선택해 공유할 수 있어요.'}</ThemedText></View>
      {!!error && <ThemedText type="small" accessibilityRole="alert">{error}</ThemedText>}
      <View style={styles.selection}><ThemedText type="smallBold" numberOfLines={3}>{selection?.label ?? '공유할 위치를 선택해 주세요.'}</ThemedText>
        {selection && <ThemedText type="small" themeColor="textSecondary">{selection.latitude.toFixed(5)}, {selection.longitude.toFixed(5)}</ThemedText>}
        <LocationAction label={sending ? '보내는 중' : '이 위치 공유하기'} onPress={() => { if (selection) void onSend(selection).catch(() => { if (mounted.current) setError('위치를 보내지 못했어요. 선택한 위치는 유지했으니 다시 시도해 주세요.'); }); }} disabled={sending || busy || !selection} primary /></View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({ screen: { flex: 1, gap: 12, paddingHorizontal: 16 }, row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, minWidth: 0, minHeight: 48, borderRadius: 12, paddingHorizontal: 12, fontSize: 16 }, button: { minHeight: 48, minWidth: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  map: { flex: 1, minHeight: 160, overflow: 'hidden', borderRadius: 16 }, mapLoading: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'center', alignItems: 'center', padding: 24 }, selection: { gap: 8 } });
