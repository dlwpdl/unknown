import { useLanguage } from '@/hooks/use-language';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';
import * as Location from 'expo-location';
import { Pressable } from '@/components/analytics-controls';
import { GlingLoader } from '@/components/gling-loader';
import { useClay } from '@/components/clay';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { facingDegrees } from '@/lib/location';
import { discoveryMapHtml, discoveryMapMessage, discoveryMapScript, discoveryMarkers, type DiscoveryBounds, type DiscoveryCity, type DiscoveryMarker } from '@/lib/discovery-map-html';

export type { DiscoveryCity, DiscoveryMarker } from '@/lib/discovery-map-html';
type Props = {
  markers: DiscoveryMarker[]; cityName: string; selectedId?: string | null;
  center?: { latitude: number; longitude: number; requestId?: number } | null; onSelect: (id: string) => void; onMoved?: (bounds: DiscoveryBounds, zoom?: number) => void;
  /** City pills for the far zoom stage; tapping another open city calls onCity. */
  cities?: DiscoveryCity[]; onCity?: (id: string) => void;
  userLocation?: { latitude: number; longitude: number } | null;
  /** Follow the way the phone faces with a cone on the location dot. The screen turns it on only while shown after a location fix. */
  compass?: boolean;
  topInset?: number; bottomInset?: number;
  /** Starting zoom (default 11, the whole city). */
  zoom?: number;
  /** Off while the screen is not shown: a tab mounted in the background draws no frames, so a slow start there is not a failure (QA C14-1). */
  active?: boolean;
  /** The caller's results are loading; the map shows its logo (never over a failure) instead of the caller drawing a second one. */
  loading?: boolean;
};

export function DiscoveryMap(props: Props) {
  return <Canvas key={props.cityName} {...props} />;
}

const NO_CITIES: DiscoveryCity[] = [];
function Canvas({ markers, cityName, cities = NO_CITIES, selectedId = null, center = null, userLocation = null, compass = false, topInset = 0, bottomInset = 0, zoom, active = true, loading = false, onSelect, onMoved, onCity }: Props) {
  const { language, tr } = useLanguage();
  const theme = useTheme(), clay = useClay(), { play } = useInteractionFeedback();
  const native = useRef<WebView<unknown>>(null), web = useRef<HTMLIFrameElement>(null), id = useId();
  const sentMarkers = useRef<{ sessionId: string; key: string } | null>(null);
  const [seed] = useState({ markers, cityName, selectedId, center, userLocation, topInset, bottomInset, zoom });
  const [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  // The page this map last heard 'ready' from; a new page (retry, language, 2D·3D) loads under the cover again.
  const [readyHtml, setReadyHtml] = useState<string | null>(null);
  const sessionId = `${id}.${retry}`;
  // M7 (owner 2026-11-05): degrees from north the phone faces. Kept here so a turn redraws only the map, never the screen around it (map lag 2026-11-11).
  const [heading, setHeading] = useState<number | null>(null);
  useEffect(() => {
    if (!compass) return;
    let active = true, watch: Location.LocationSubscription | null = null, timer: ReturnType<typeof setTimeout> | undefined, last = 0, latest: number | null = null;
    // At most 4 turns a second (map lag 2026-11-08); the newest reading still lands.
    const show = () => { timer = undefined; last = Date.now(); if (active) setHeading(latest); };
    void Location.watchHeadingAsync(reading => { latest = facingDegrees(reading); timer ??= setTimeout(show, Math.max(0, 250 - (Date.now() - last))); }).then(subscription => { if (active) watch = subscription; else subscription.remove(); }, () => {});
    return () => { active = false; clearTimeout(timer); watch?.remove(); setHeading(null); };
  }, [compass]);
  const parentOrigin = Platform.OS === 'web' && typeof window !== 'undefined' && window.location.protocol !== 'file:' ? window.location.origin : 'null';
  // Pill names follow the language, so they rebuild the page like the language itself does; a new array with the same cities does not. The 2D·3D choice rebuilds it the same way.
  const citiesKey = JSON.stringify(cities);
  const html = useMemo(() => {
    try { return discoveryMapHtml({ ...seed, cities: JSON.parse(citiesKey), language, sessionId, parentOrigin, clay }); }
    catch { return null; }
  }, [seed, citiesKey, language, sessionId, parentOrigin, clay]);
  const source = useMemo(() => ({ html: html ?? '' }), [html]);
  const ready = !!html && readyHtml === html;
  const markerData = useMemo(() => {
    try { const safe = discoveryMarkers(markers); return { markers: safe, key: JSON.stringify(safe) }; }
    catch { return null; }
  }, [markers]);
  const update = useMemo(() => {
    try {
      const state = { selectedId, center: center && { latitude: center.latitude, longitude: center.longitude, ...(center.requestId !== undefined ? { requestId: center.requestId } : {}) },
        userLocation: userLocation && { latitude: userLocation.latitude, longitude: userLocation.longitude }, heading, topInset, bottomInset };
      return { state, script: discoveryMapScript(state, sessionId) };
    } catch { return null; }
  }, [selectedId, center, userLocation, heading, topInset, bottomInset, sessionId]);
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
    const message = discoveryMapMessage(raw, sessionId, markerData.markers, (JSON.parse(citiesKey) as DiscoveryCity[]).filter(city => city.open).map(city => city.id));
    if (!message) return;
    if (message.type === 'ready') { setReadyHtml(html); setFailed(false); sync(true); }
    else if (message.type === 'error') setFailed(true);
    else if (message.type === 'select') onSelect(message.id);
    else if (message.type === 'feedback') play('selection');
    else if (message.type === 'credits') void Linking.openURL(message.url).catch(() => play('warning'));
    else if (message.type === 'moved') onMoved?.(message.bounds, message.zoom);
    else if (message.type === 'city') onCity?.(message.id);
  }, [sessionId, html, update, markerData, sync, onSelect, onMoved, onCity, play, citiesKey]);
  useEffect(() => { sync(); }, [sync]);
  useEffect(() => {
    if (!html || !active || ready) return;
    // WebView/GPU startup can stall before the embedded timeout ever runs.
    const timer = setTimeout(() => setFailed(true), 15000);
    return () => clearTimeout(timer);
  }, [html, active, ready]);
  const broken = failed || !html || !update || !markerData;
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
      // Map lag 2026-11-11 (owner "열 때마다 다시 받기"): the WebView's HTTP cache keeps the public base-map tiles, fonts and icons from tiles.openfreemap.org
      // between visits, as their cache headers allow. The page and MapLibre write no cookies or web storage; cookies stay unshared.
      : <WebView<unknown> key={sessionId} ref={native} source={source} originWhitelist={['*']} applicationNameForUserAgent="GlingDiscoveryMap/1.0"
        style={styles.map} scrollEnabled={false} sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false}
        allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false} mixedContentMode="never"
        onShouldStartLoadWithRequest={request => request.url === 'about:blank'} setSupportMultipleWindows={false}
        onLoadEnd={() => sync(true)} onError={() => setFailed(true)} onHttpError={() => setFailed(true)} onMessage={event => receive(event.nativeEvent.data)} />)}
    {/* Loading and failure never show together (QA C14-1): until the page is ready the cover hides the blank page in the app's own colour. */}
    {!broken && (!ready || loading) && <View pointerEvents="none" style={[styles.cover, { paddingTop: topInset, paddingBottom: bottomInset }, !ready && { backgroundColor: theme.background }]}>
      <GlingLoader accessibilityLabel={ready ? '지도 결과 불러오는 중' : '지도 불러오는 중'} />
    </View>}
    {broken && <View style={[styles.error, { backgroundColor: theme.card }]} accessibilityLiveRegion="polite">
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
  cover: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, justifyContent: 'center', alignItems: 'center' },
  retry: { minHeight: 44, minWidth: 44, paddingHorizontal: 16, justifyContent: 'center' },
});
