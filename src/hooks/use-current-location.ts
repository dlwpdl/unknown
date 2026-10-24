import * as Location from 'expo-location';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { isFreshNearbyLocation, type LocationFix } from '@/lib/location';

type Token = readonly unknown[];
type State = { token: Token; status: 'checking' | 'ready' | 'permission' | 'unavailable'; fix: LocationFix | null; canAskAgain: boolean };
type Lifetime = { token: Token; active: boolean; pending: boolean; state: State | null; expiry?: ReturnType<typeof setTimeout> };
const normalize = (value: Location.LocationObject): LocationFix => ({ latitude: value.coords.latitude, longitude: value.coords.longitude,
  accuracy: value.coords.accuracy, measuredAt: value.timestamp, mocked: value.mocked === true });

// Distance-only foreground reads follow the map's OS permission policy. They do
// not enable community location sharing or send coordinates to its event API.
export function useCurrentLocation(cityId: string, enabled = true) {
  const { isAuthed, isAuthLoading, me } = useAuth(), focused = useIsFocused();
  const [foreground, setForeground] = useState(() => AppState.currentState === 'active');
  const viewer = me.id, active = enabled && focused && foreground && !isAuthLoading;
  const token = useMemo(() => [cityId, enabled, viewer, isAuthed, isAuthLoading, focused, foreground] as const,
    [cityId, enabled, viewer, isAuthed, isAuthLoading, focused, foreground]);
  const live = useRef<Lifetime | null>(null), [state, setState] = useState<State | null>(null);
  const current = state?.token === token ? state : null;
  useLayoutEffect(() => {
    const lifetime: Lifetime = { token, active, pending: false, state: null }; live.current = lifetime;
    return () => { lifetime.active = false; if (lifetime.expiry) clearTimeout(lifetime.expiry); };
  }, [active, token]);
  useLayoutEffect(() => { if (live.current?.token === token) live.current.state = current; }, [current, token]);
  useEffect(() => {
    if (!enabled) return;
    const listener = AppState.addEventListener('change', next => setForeground(next === 'active'));
    return () => listener.remove();
  }, [enabled]);
  const read = useCallback(async (ask: boolean) => {
    const scope = live.current;
    if (!scope?.active || scope.token !== token || scope.pending || AppState.currentState !== 'active') return;
    const valid = () => scope.active && live.current === scope && AppState.currentState === 'active';
    scope.pending = true;
    if (scope.expiry) clearTimeout(scope.expiry);
    setState({ token, fix: null, status: 'checking', canAskAgain: scope.state?.canAskAgain ?? true });
    let timer: ReturnType<typeof setTimeout> | undefined, canAskAgain = true;
    try {
      const permission = ask ? await Location.requestForegroundPermissionsAsync() : await Location.getForegroundPermissionsAsync();
      if (!valid()) return;
      canAskAgain = permission.canAskAgain !== false;
      if (!permission.granted) { setState({ token, fix: null, status: 'permission', canAskAgain }); return; }
      const position = await Promise.race([
        (async () => {
          const cached = ask ? null : await Location.getLastKnownPositionAsync({ maxAge: 120000, requiredAccuracy: 250 }).catch(() => null);
          if (cached && isFreshNearbyLocation(normalize(cached), Date.now())) return cached;
          if (!valid()) return null;
          return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('LOCATION_TIMEOUT')), 15000); }),
      ]);
      if (!valid() || !position) return;
      const fix = normalize(position);
      if (!isFreshNearbyLocation(fix, Date.now())) throw new Error('LOCATION_UNUSABLE');
      setState({ token, fix, status: 'ready', canAskAgain });
      scope.expiry = setTimeout(() => { if (valid()) setState({ token, fix: null, status: 'unavailable', canAskAgain }); }, Math.max(1, fix.measuredAt + 120001 - Date.now()));
    } catch {
      if (valid()) setState({ token, fix: null, status: 'unavailable', canAskAgain });
    } finally { if (timer) clearTimeout(timer); scope.pending = false; }
  }, [token]);
  useEffect(() => { if (active) void read(false); }, [active, read]);
  const request = useCallback(async () => {
    const scope = live.current;
    if (!scope?.active || scope.token !== token || scope.pending || AppState.currentState !== 'active') return;
    if (scope.state?.status === 'permission' && !scope.state.canAskAgain) {
      scope.pending = true;
      try { await Linking.openSettings(); } catch { /* The permission state remains accurate if Settings cannot open. */ }
      finally { scope.pending = false; }
      return;
    }
    await read(true);
  }, [read, token]);
  return { fix: current?.fix ?? null,
    status: current?.status ?? (active ? 'checking' : 'unavailable'), busy: active && (!current || current.status === 'checking'),
    canAskAgain: current?.canAskAgain ?? true, request };
}
export type CurrentLocation = ReturnType<typeof useCurrentLocation>;
