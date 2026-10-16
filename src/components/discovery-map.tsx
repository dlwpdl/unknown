import { useLanguage } from '@/hooks/use-language';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';
import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { discoveryMapHtml, discoveryMapMessage, discoveryMapScript, discoveryMarkers, type DiscoveryMarker } from '@/lib/discovery-map-html';

export type { DiscoveryMarker } from '@/lib/discovery-map-html';
type Props = {
  markers: DiscoveryMarker[]; cityName: string; selectedId?: string | null;
  center?: { latitude: number; longitude: number } | null; onSelect: (id: string) => void;
  bottomInset?: number;
};

export function DiscoveryMap(props: Props) {
  return <Canvas key={props.cityName} {...props} />;
}

function Canvas({ markers, cityName, selectedId = null, center = null, bottomInset = 0, onSelect }: Props) {
  const { language, tr } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback();
  const native = useRef<WebView>(null), web = useRef<HTMLIFrameElement>(null), id = useId();
  const [seed] = useState({ markers, cityName, selectedId, center, bottomInset });
  const [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const sessionId = `${id}.${retry}`;
  const parentOrigin = Platform.OS === 'web' && typeof window !== 'undefined' && window.location.protocol !== 'file:' ? window.location.origin : 'null';
  const html = useMemo(() => {
    try { return discoveryMapHtml({ ...seed, language, sessionId, parentOrigin }); }
    catch { return null; }
  }, [seed, language, sessionId, parentOrigin]);
  const source = useMemo(() => ({ html: html ?? '' }), [html]);
  const update = useMemo(() => {
    try {
      const state = { markers: discoveryMarkers(markers), selectedId, center, bottomInset };
      return { state, script: discoveryMapScript(state, sessionId) };
    } catch { return null; }
  }, [markers, selectedId, center, bottomInset, sessionId]);
  const sync = useCallback(() => {
    if (!update) return;
    if (Platform.OS === 'web') web.current?.contentWindow?.postMessage({ type: 'discovery.update', sessionId, state: update.state }, parentOrigin === 'null' ? '*' : parentOrigin);
    else native.current?.injectJavaScript(update.script);
  }, [update, sessionId, parentOrigin]);
  const receive = useCallback((raw: string) => {
    if (!update) return;
    const message = discoveryMapMessage(raw, sessionId, update.state.markers);
    if (!message) return;
    if (message.type === 'ready') { setFailed(false); sync(); }
    else if (message.type === 'error') setFailed(true);
    else if (message.type === 'select') onSelect(message.id);
    else if (message.type === 'feedback') play('selection');
    else if (message.type === 'credits') void Linking.openURL(message.url).catch(() => play('warning'));
  }, [sessionId, update, sync, onSelect, play]);
  useEffect(() => { sync(); }, [sync]);
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
      ? <iframe key={sessionId} ref={web} srcDoc={html} title={tr("도시 탐색 지도")} sandbox="allow-scripts allow-same-origin" onLoad={sync}
        style={{ border: 0, width: '100%', height: '100%', minHeight: 140, flex: 1 }} />
      : <WebView key={sessionId} ref={native} source={source} originWhitelist={['*']} applicationNameForUserAgent="GlingDiscoveryMap/1.0"
        style={styles.map} scrollEnabled={false} sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false} cacheEnabled={false} incognito
        allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false} mixedContentMode="never"
        onShouldStartLoadWithRequest={request => request.url === 'about:blank'} setSupportMultipleWindows={false}
        onLoadEnd={sync} onError={() => setFailed(true)} onHttpError={() => setFailed(true)} onMessage={event => receive(event.nativeEvent.data)} />)}
    {(failed || !html || !update) && <View style={[styles.error, { backgroundColor: theme.card }]} accessibilityLiveRegion="polite">
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
