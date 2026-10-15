import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import WebView from 'react-native-webview';
import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { mapHtml, mapMessage, mapPinScript, mapPreviews, rememberMapPreview } from '@/lib/post-map-html';
import { googlePinUrl, type PostPin } from '@/lib/post-maps';
import { useAuth } from '@/lib/auth';
import { recordProductEvent } from '@/lib/product-analytics';
import { supabase } from '@/lib/supabase';

export function PostPinMap({ pin, cityName = '', preview = false, bottomInset = 0, onSelect, onReadyChange }: {
  pin: PostPin | null; label?: string; cityName?: string; preview?: boolean; bottomInset?: number;
  onSelect?: (pin: PostPin, label?: string) => void; onReadyChange?: (ready: boolean) => void;
}) {
  const theme = useTheme(), { play } = useInteractionFeedback(), native = useRef<WebView>(null), web = useRef<HTMLIFrameElement>(null);
  const { isAuthed, me } = useAuth(), userId = isAuthed ? me.id : null;
  const identity = useRef(userId);
  useLayoutEffect(() => { identity.current = userId; return () => { identity.current = null; }; }, [userId]);
  const mapStyle = [styles.map, preview && styles.preview];
  const [initialPin] = useState(pin);
  const [failed, setFailed] = useState(false), [retry, setRetry] = useState(0), [image, setImage] = useState<string>();
  const key = pin ? googlePinUrl(pin) : '', cached = preview ? mapPreviews.get(key) ?? image : undefined;
  const seed = preview ? pin : initialPin;
  const html = useMemo(() => mapHtml({ pin: seed, cityName, preview, accent: theme.accent }), [seed, cityName, preview, theme.accent]);
  const fail = useCallback(() => {
    setFailed(true); onReadyChange?.(false);
    if (userId && identity.current === userId) void recordProductEvent(supabase, { kind: 'map_error', platform: Platform.OS }).catch(() => {});
  }, [onReadyChange, userId]);
  useEffect(() => { onReadyChange?.(false); }, [html, retry, onReadyChange]);
  useEffect(() => {
    if (preview) return;
    if (Platform.OS === 'web') web.current?.contentWindow?.postMessage({ type: 'move', pin, bottomInset }, '*');
    else native.current?.injectJavaScript(mapPinScript(pin, bottomInset));
  }, [pin, preview, bottomInset]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const receive = (event: MessageEvent) => {
      if (event.source !== web.current?.contentWindow || event.origin !== (window.location.protocol === 'file:' ? 'null' : window.location.origin) || typeof event.data !== 'string') return;
      const message = mapMessage(event.data); if (!message) return;
      if (message.type === 'pick' && !preview) onSelect?.(message.pin, message.label);
      else if (message.type === 'ready') { setFailed(false); onReadyChange?.(true); }
      else if (message.type === 'error') fail();
      else if (message.type === 'snapshot' && preview) { rememberMapPreview(key, message.uri); setImage(message.uri); }
      else if (message.type === 'feedback') play('selection');
      else if (message.type === 'credit') { play('selection'); void Linking.openURL(message.url).catch(() => play('warning')); }
    };
    window.addEventListener('message', receive);
    web.current?.contentWindow?.postMessage({ type: 'move', pin, bottomInset }, '*');
    return () => window.removeEventListener('message', receive);
  }, [onSelect, onReadyChange, preview, key, play, pin, bottomInset, fail]);
  if (cached) return <Image source={{ uri: cached }} accessibilityLabel="선택한 위치의 지도. OpenStreetMap·OpenMapTiles" contentFit="cover" style={mapStyle} />;
  if (preview && failed) return <View style={[mapStyle, styles.previewError, { backgroundColor: theme.card }]}><ThemedText type="small" themeColor="accent">지도</ThemedText></View>;
  return <View style={mapStyle}>
    {Platform.OS === 'web' ? <iframe key={retry} ref={web} srcDoc={html} title="지도에서 위치 선택" sandbox="allow-scripts allow-same-origin"
      onLoad={() => { setFailed(false); web.current?.contentWindow?.postMessage({ type: 'move', pin, bottomInset }, '*'); }}
      style={{ border: 0, width: '100%', height: '100%', minHeight: preview ? 0 : 140, flex: 1 }} />
      : <WebView key={retry} ref={native} source={{ html }} originWhitelist={['*']} applicationNameForUserAgent="GlingMap/1.0"
        style={mapStyle} scrollEnabled={false} sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false}
        onShouldStartLoadWithRequest={request => request.url === 'about:blank'} setSupportMultipleWindows={false}
        onLoadStart={() => { setFailed(false); onReadyChange?.(false); }} onLoadEnd={() => { if (!preview) native.current?.injectJavaScript(mapPinScript(pin, bottomInset)); }} onError={fail}
        onMessage={event => {
          const message = mapMessage(event.nativeEvent.data); if (!message) return;
          if (message.type === 'pick' && !preview) onSelect?.(message.pin, message.label);
          else if (message.type === 'ready') { setFailed(false); onReadyChange?.(true); }
          else if (message.type === 'error') fail();
          else if (message.type === 'snapshot' && preview) { rememberMapPreview(key, message.uri); setImage(message.uri); }
          else if (message.type === 'feedback') play('selection');
          else if (message.type === 'credit') { play('selection'); void Linking.openURL(message.url).catch(() => play('warning')); }
        }} />}
    {failed && <View style={[styles.error, { backgroundColor: theme.card }]}><ThemedText type="small">지도를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.</ThemedText>
      <Pressable lens analyticsId="post.location.map.retry" accessibilityRole="button" onPress={() => { play('selection'); setFailed(false); setRetry(value => value + 1); }} style={styles.retry}><ThemedText themeColor="accent">다시 시도</ThemedText></Pressable></View>}
  </View>;
}

const styles = StyleSheet.create({ map: { flex: 1, minHeight: 140 }, preview: { minHeight: 0 }, previewError: { justifyContent: 'center', alignItems: 'center' }, error: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, justifyContent: 'center', alignItems: 'center', padding: 20, gap: 12 }, retry: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' } });
