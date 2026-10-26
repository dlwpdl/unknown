import { useLanguage } from '@/hooks/use-language';
import { useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Modal, Platform, StyleSheet, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
import { Pressable } from '@/components/analytics-controls';
import { PostPinMap } from '@/components/post-pin-map';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { isFreshLocation } from '@/lib/location';
import { googlePinUrl, type PostPin } from '@/lib/post-maps';

export function PostLocationPicker({ visible, initialPin, initialLabel = '', cityName = '', onClose, onConfirm }: {
  visible: boolean; initialPin: PostPin | null; initialLabel?: string; cityName?: string; onClose: () => void; onConfirm: (pin: PostPin, label: string) => void;
}) {
  const { tr } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback(), insets = useSafeAreaInsets(), reduced = useReducedMotion();
  const [pin, setPin] = useState<PostPin | null>(initialPin), [label, setLabel] = useState(initialLabel);
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const revision = useRef(0);
  const [ready, setReady] = useState(false), [cardHeight, setCardHeight] = useState(150);
  useEffect(() => { const gate = revision; return () => { gate.current++; }; }, []);
  useEffect(() => { const listener = AppState.addEventListener('change', state => { if (state === 'background') { revision.current++; setBusy(false); } }); return () => listener.remove(); }, []);
  const select = (selected: PostPin, name = '') => {
    try { googlePinUrl(selected); } catch { return; }
    revision.current++; play('selection'); setPin(selected); setLabel((typeof name === 'string' ? name : '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100)); setBusy(false); setMessage('');
  };
  const close = () => { revision.current++; setBusy(false); onClose(); };
  const locate = async (search: boolean) => {
    if (!ready || busy || (search && !query.trim())) return;
    if (search && Platform.OS === 'web') { play('warning'); setMessage('주소 검색은 앱에서 지원해요. 지도에서 원하는 지점을 골라주세요.'); return; }
    play('selection'); const operation = ++revision.current; setBusy(true); setMessage('');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!search) {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (revision.current !== operation) return;
        if (!permission.granted) throw new Error('PERMISSION');
      } else if (Platform.OS === 'android' && !(await Location.getForegroundPermissionsAsync()).granted) throw new Error('SEARCH_PERMISSION');
      const result = await Promise.race([
        search ? Location.geocodeAsync([query.trim(), cityName].filter(Boolean).join(', ')) : Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), 15000); }),
      ]);
      if (revision.current !== operation || AppState.currentState !== 'active') return;
      if (Array.isArray(result)) {
        if (!result.length) throw new Error('NOT_FOUND');
        select({ latitude: result[0].latitude, longitude: result[0].longitude }, query.trim());
      } else {
        const fix = { latitude: result.coords.latitude, longitude: result.coords.longitude, accuracy: result.coords.accuracy, measuredAt: result.timestamp, mocked: result.mocked ?? false };
        if (!isFreshLocation(fix) || fix.accuracy == null || fix.accuracy > 250 || Date.now() - fix.measuredAt > 120000) throw new Error('INACCURATE');
        select({ latitude: fix.latitude, longitude: fix.longitude }, '내 위치');
      }
    } catch (error) {
      if (revision.current !== operation) return;
      play('warning'); setMessage(error instanceof Error && error.message === 'PERMISSION' ? '위치 권한이 꺼져 있어요. 지도에서 원하는 지점을 직접 고를 수 있어요.'
        : error instanceof Error && error.message === 'SEARCH_PERMISSION' ? '주소 검색에 위치 권한이 필요해요. 지도에서 핀을 고르거나 내 위치를 눌러 권한을 허용해 주세요.'
        : '위치를 찾지 못했어요. 주소를 다시 확인하거나 지도에서 핀을 골라주세요.');
    } finally { if (timer) clearTimeout(timer); if (revision.current === operation) setBusy(false); }
  };
  return <Modal visible={visible} animationType={reduced ? 'none' : 'slide'} onRequestClose={close}>
    <SafeAreaProvider style={[styles.backdrop, { backgroundColor: theme.background }]}>
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: theme.background, paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.header}><Pressable analyticsId="post.location.cancel" accessibilityRole="button" accessibilityLabel={tr("위치 선택 취소")} onPress={close} style={styles.control}><ThemedText>‹</ThemedText></Pressable><ThemedText type="smallBold">{tr("위치 공유")}</ThemedText><View style={styles.control} /></View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.canvas}>
        {visible && <PostPinMap pin={pin} label={label} cityName={cityName} onSelect={select} onReadyChange={setReady} bottomInset={cardHeight + 24} />}
        <View style={[styles.search, { backgroundColor: theme.card, borderColor: theme.line }]}>
          <TextInput value={query} onChangeText={value => { revision.current++; setBusy(false); setQuery(value); }} accessibilityLabel={tr("장소·주소 검색")} placeholder={tr("장소나 주소 찾기")} placeholderTextColor={theme.textSecondary}
            onFocus={() => play('selection')} onSubmitEditing={() => void locate(true)} returnKeyType="search" maxLength={150} style={[styles.input, { color: theme.text }]} />
          <Pressable analyticsId="post.location.search" accessibilityRole="button" accessibilityLabel={tr("주소 찾기")} disabled={!ready || busy || !query.trim()} onPress={() => void locate(true)} style={styles.control}><ThemedText themeColor="accent">{tr("검색")}</ThemedText></Pressable>
        </View>
        <Pressable analyticsId="post.location.current" accessibilityRole="button" accessibilityLabel={tr("내 위치 선택")} disabled={!ready || busy} onPress={() => void locate(false)} style={[styles.current, { bottom: cardHeight + 36, backgroundColor: theme.card, borderColor: theme.line }]}><ThemedText type="smallBold">{busy ? tr("찾는 중…") : tr("내 위치")}</ThemedText></Pressable>
        <View onLayout={event => setCardHeight(Math.min(900, Math.ceil(event.nativeEvent.layout.height)))} style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
          {pin ? <TextInput value={label} onChangeText={value => { revision.current++; setBusy(false); setLabel(value.replace(/[\u0000-\u001f\u007f]/g, ' ')); }} maxLength={100} accessibilityLabel={tr("첨부할 위치 이름")} placeholder={tr("선택한 위치")} placeholderTextColor={theme.textSecondary}
            onFocus={() => play('selection')} style={[styles.name, { color: theme.text, borderColor: theme.line }]} /> : <ThemedText type="smallBold">{tr("지도에서 위치를 선택해 주세요.")}</ThemedText>}
          {!pin && <ThemedText type="small" themeColor="textSecondary">{tr("가게를 누르거나, 원하는 지점으로 핀을 옮겨보세요.")}</ThemedText>}
          {pin && <ThemedText type="small" themeColor="textSecondary">{tr("글을 게시하면 글과 통합 지도에 이 위치가 공개돼요.")}</ThemedText>}
          {!!message && <ThemedText type="small" accessibilityRole="alert">{tr(message)}</ThemedText>}
          <Pressable analyticsId="post.location.confirm" accessibilityRole="button" disabled={!ready || !pin || busy} onPress={() => { if (!ready || !pin || busy) return; revision.current++; play('selection'); onConfirm(pin, label.trim() || '선택한 위치'); }}
            style={[styles.confirm, { backgroundColor: theme.accent, opacity: !ready || !pin || busy ? 0.5 : 1 }]}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>{tr("이 위치 첨부")}</ThemedText></Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  screen: { flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center' }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 56 },
  control: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  search: { position: 'absolute', top: 16, left: 16, right: 16, flexDirection: 'row', borderWidth: 1, borderRadius: 14, paddingLeft: 12 },
  input: { flex: 1, minHeight: 48 }, canvas: { flex: 1 }, name: { minHeight: 44, fontSize: 17, borderBottomWidth: 1, paddingVertical: 6 },
  current: { position: 'absolute', left: 16, minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderWidth: 1, borderRadius: 12 },
  card: { position: 'absolute', bottom: 16, left: 16, right: 16, borderRadius: 16, padding: 12, gap: 8, borderWidth: 1 },
  confirm: { minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 12 },
});
