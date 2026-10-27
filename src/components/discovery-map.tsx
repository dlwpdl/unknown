import { useLanguage } from '@/hooks/use-language';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';
import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { discoveryMapHtml, discoveryMapMessage, discoveryMapScript, discoveryMarkers, type DiscoveryBounds, type DiscoveryMarker } from '@/lib/discovery-map-html';

export type { DiscoveryMarker } from '@/lib/discovery-map-html';
type Props = {
  markers: DiscoveryMarker[]; cityName: string; selectedId?: string | null;
  center?: { latitude: number; longitude: number; requestId?: number } | null; onSelect: (id: string) => void; onMoved?: (bounds: DiscoveryBounds) => void;
  userLocation?: { latitude: number; longitude: number } | null;
  topInset?: number; bottomInset?: number;
};

export function DiscoveryMap(props: Props) {
  return <Canvas key={props.cityName} {...props} />;
}

function Canvas({ markers, cityName, selectedId = null, center = null, userLocation = null, topInset = 0, bottomInset = 0, onSelect, onMoved }: Props) {
  const { language, tr } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback();
  const native = useRef<WebView<unknown>>(null), web = useRef<HTMLIFrameElement>(null), id = useId();
  const sentMarkers = useRef<{ sessionId: string; key: string } | null>(null);
  const [seed] = useState({ markers, cityName, selectedId, center, userLocation, topInset, bottomInset });
  const [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const [readySession, setReadySession] = useState<string | null>(null);
  const sessionId = `${id}.${retry}`;
  const parentOrigin = Platform.OS === 'web' && typeof window !== 'undefined' && window.location.protocol !== 'file:' ? window.location.origin : 'null';
  const html = useMemo(() => {
    try { return discoveryMapHtml({ ...seed, language, sessionId, parentOrigin }); }
    catch { return null; }
  }, [seed, language, sessionId, parentOrigin]);
  const source = useMemo(() => ({ html: html ?? '' }), [html]);
  const markerData = useMemo(() => {
    try { const safe = discoveryMarkers(markers); return { markers: safe, key: JSON.stringify(safe) }; }
    catch { return null; }
  }, [markers]);
  const update = useMemo(() => {
    try {
      const state = { selectedId, center: center && { latitude: center.latitude, longitude: center.longitude, ...(center.requestId !== undefined ? { requestId: center.requestId } : {}) },
        userLocation: userLocation && { latitude: userLocation.latitude, longitude: userLocation.longitude }, topInset, bottomInset };
      return { state, script: discoveryMapScript(state, sessionId) };
    } catch { return null; }
  }, [selectedId, center, userLocation, topInset, bottomInset, sessionId]);
  const sync = useCallback((forceMarkers = false) => {
    if (!update || !markerData) return;
    const includeMarkers = forceMarkers || sentMarkers.current?.sessionId !== sessionId || sentMarkers.current.key !== markerData.key;
    const state = includeMarkers ? { ...update.state, markers: markerData.markers } : update.state;
    if (Platform.OS === 'web') {
      const target = web.current?.contentWindow;
      if (!target) return;
      target.postMessage({ type: 'discovery.update', sessionId, state }, parentOrigin === 'null' ? '*' : parentOrigin);
    } else {
      if (!native.current) return;
      native.current.injectJavaScript(includeMarkers ? discoveryMapScript(state, sessionId) : update.script);
    }
    sentMarkers.current = { sessionId, key: markerData.key };
  }, [update, markerData, sessionId, parentOrigin]);
  const receive = useCallback((raw: string) => {
    if (!update || !markerData) return;
    const message = discoveryMapMessage(raw, sessionId, markerData.markers);
    if (!message) return;
    if (message.type === 'ready') { setReadySession(sessionId); setFailed(false); sync(true); }
    else if (message.type === 'error') setFailed(true);
    else if (message.type === 'select') onSelect(message.id);
    else if (message.type === 'feedback') play('selection');
    else if (message.type === 'credits') void Linking.openURL(message.url).catch(() => play('warning'));
    else if (message.type === 'moved') onMoved?.(message.bounds);
  }, [sessionId, update, markerData, sync, onSelect, onMoved, play]);
  useEffect(() => { sync(); }, [sync]);
  useEffect(() => {
    if (!html || readySession === sessionId) return;
    // WebView/GPU startup can stall before the embedded timeout ever runs.
    const timer = setTimeout(() => setFailed(true), 15000);
    return () => clearTimeout(timer);
  }, [html, sessionId, readySession]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const listener = (event: MessageEvent) => {
      if (!web.current?.contentWindow || event.source !== web.current.contentWindow || event.origin !== parentOrigin || typeof event.data !== 'string') return;
      receive(event.data);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [receive, parentOrigin]);

  return <View style={styles.map}>
    {html && (Platform.OS === 'web'
      ? <iframe key={sessionId} ref={web} srcDoc={html} title={tr("도시 탐색 지도")} sandbox="allow-scripts allow-same-origin" onLoad={() => sync(true)}
        style={{ border: 0, width: '100%', height: '100%', minHeight: 140, flex: 1 }} />
      : <WebView<unknown> key={sessionId} ref={native} source={source} originWhitelist={['*']} applicationNameForUserAgent="GlingDiscoveryMap/1.0"
        style={styles.map} scrollEnabled={false} sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false} cacheEnabled={false} incognito
        allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false} mixedContentMode="never"
        onShouldStartLoadWithRequest={request => request.url === 'about:blank'} setSupportMultipleWindows={false}
        onLoadEnd={() => sync(true)} onError={() => setFailed(true)} onHttpError={() => setFailed(true)} onMessage={event => receive(event.nativeEvent.data)} />)}
    {(failed || !html || !update || !markerData) && <View style={[styles.error, { backgroundColor: theme.card }]} accessibilityLiveRegion="polite">
      <ThemedText type="small">{tr("지도를 불러오지 못했어요. 목록에서 계속 둘러볼 수 있어요.")}</ThemedText>
      <Pressable analyticsId="discovery.map.retry" accessibilityRole="button" accessibilityLabel={tr("지도 다시 불러오기")}
        onPress={() => { play('selection'); setFailed(false); setRetry(value => value + 1); }} style={styles.retry}>
        <ThemedText themeColor="accent">{tr("다시 시도")}</ThemedText>
      </Pressable>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  map: { flex: 1, minHeight: 140 },
  error: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, justifyContent: 'center', alignItems: 'center', padding: 20, gap: 12 },
  retry: { minHeight: 44, minWidth: 44, paddingHorizontal: 16, justifyContent: 'center' },
});
