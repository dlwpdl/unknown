import * as Location from 'expo-location';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { isFreshLocation, LOCATION_CONSENT_VERSION, nearbyCommunity, type LocationFix } from '@/lib/location';
import { supabase } from '@/lib/supabase';

type SharedFix = LocationFix & { userId: string };
type LocationValue = {
  enabled: boolean; ready: boolean; busy: boolean; message: string; cityId: string | null;
  capture: (ask?: boolean) => Promise<SharedFix | null>;
  disable: () => Promise<void>;
  record: (fix: SharedFix | null, postId?: string) => Promise<void>;
};
const LocationContext = createContext<LocationValue | null>(null);
const isBackground = () => AppState.currentState === 'background';
export function useCommunityLocation() {
  const value = useContext(LocationContext);
  if (!value) throw new Error('CommunityLocationProvider is required');
  return value;
}

export function CommunityLocationProvider({ userId, loginKey, children }: {
  userId: string | null; loginKey: string | null; children: ReactNode;
}) {
  const preferenceKey = userId ? `${userId}:${loginKey ?? 'restored'}` : null;
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [cityId, setCityId] = useState<string | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const generation = useRef({});
  const inFlight = useRef<object | null>(null);
  const allowed = useRef(false);
  const loginAttempted = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    allowed.current = false;
    inFlight.current = null;
    if (!userId) return;
    void supabase.rpc('get_location_preference').then(({ data, error }) => {
      if (!active) return;
      setOwner(preferenceKey);
      setCityId(null);
      setMessage('');
      setBusy(false);
      allowed.current = !error && data?.enabled === true;
      setEnabled(allowed.current);
      setReady(true);
      if (error) setMessage('위치 설정을 불러오지 못했어요. 도시를 직접 선택할 수 있어요.');
    });
    return () => { active = false; generation.current = {}; allowed.current = false; };
  }, [userId, preferenceKey]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'background') generation.current = {};
    });
    return () => listener.remove();
  }, []);

  const record = useCallback(async (fix: SharedFix | null, postId?: string) => {
    if (!fix || !allowed.current || fix.userId !== userId || !isFreshLocation(fix)) return;
    const { error } = await supabase.rpc('record_location_event', {
      p_user_id: userId,
      p_latitude: fix.latitude, p_longitude: fix.longitude, p_accuracy: fix.accuracy,
      p_measured_at: new Date(fix.measuredAt).toISOString(), p_post_id: postId ?? null,
    }).then((result) => result, () => ({ error: true }));
    if (error) setMessage('도시 추천은 사용할 수 있지만 위치 기록은 저장하지 못했어요.');
  }, [userId]);


  const capture = useCallback(async (ask = false): Promise<SharedFix | null> => {
    if (!userId || inFlight.current || (!ask && !allowed.current) || isBackground()) return null;
    const revision = generation.current;
    const operation = {};
    inFlight.current = operation;
    setBusy(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!ask) {
        const preference = await supabase.rpc('get_location_preference');
        if (revision !== generation.current) return null;
        if (preference.error) throw preference.error;
        if (!preference.data?.enabled) { allowed.current = false; setEnabled(false); setCityId(null); return null; }
      }
      const permission = ask ? await Location.requestForegroundPermissionsAsync() : await Location.getForegroundPermissionsAsync();
      if (revision !== generation.current) return null;
      if (!permission.granted) {
        setMessage('위치 권한이 꺼져 있어요. 기기 설정에서 허용하거나 도시를 직접 선택해 주세요.');
        return null;
      }
      if (ask) {
        const saved = await supabase.rpc('set_location_preference', { p_user_id: userId, p_enabled: true, p_version: LOCATION_CONSENT_VERSION });
        if (saved.error) throw saved.error;
        if (revision !== generation.current) return null;
        allowed.current = true;
        setEnabled(true);
      }
      const result = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('LOCATION_TIMEOUT')), 15000); }),
      ]);
      if (revision !== generation.current || !allowed.current || isBackground()) return null;
      const fix = { userId, latitude: result.coords.latitude, longitude: result.coords.longitude,
        accuracy: result.coords.accuracy, measuredAt: result.timestamp, mocked: result.mocked === true };
      if (!isFreshLocation(fix)) throw new Error('LOCATION_UNUSABLE');
      const nextCity = nearbyCommunity(fix);
      setCityId(nextCity);
      setMessage(nextCity ? '가까운 커뮤니티를 찾았어요. 다른 도시로 바꿔도 돼요.' : '가까운 곳에 열린 커뮤니티가 아직 없어요. 도시를 직접 선택해 주세요.');
      if (loginKey && Date.now() - Date.parse(loginKey) < 600000 && loginAttempted.current !== preferenceKey) {
        loginAttempted.current = preferenceKey;
        await record(fix);
      }
      return fix;
    } catch {
      if (revision === generation.current) setMessage('위치를 확인하지 못했어요. 도시를 직접 선택하거나 다시 시도해 주세요.');
      return null;
    } finally {
      if (timer) clearTimeout(timer);
      if (inFlight.current === operation) { inFlight.current = null; setBusy(false); }
    }
  }, [userId, loginKey, preferenceKey, record]);

  useEffect(() => {
    if (owner !== preferenceKey || busy || !ready || !enabled || !loginKey || Date.now() - Date.parse(loginKey) >= 600000 || loginAttempted.current === preferenceKey) return;
    loginAttempted.current = preferenceKey;
    void capture().then((fix) => record(fix));
  }, [owner, preferenceKey, busy, ready, enabled, loginKey, capture, record]);

  const disable = useCallback(async () => {
    generation.current = {};
    allowed.current = false;
    setBusy(true);
    try {
      const result = await supabase.rpc('set_location_preference', { p_user_id: userId, p_enabled: false, p_version: LOCATION_CONSENT_VERSION });
      if (result.error) throw result.error;
      setEnabled(false); setCityId(null); setMessage('위치 공유를 끄고 저장된 위치 기록을 삭제했어요.');
    } catch {
      setMessage('설정 변경을 저장하지 못했어요. 다시 눌러 주세요. 이 화면에서는 위치 수집을 멈췄어요.');
    } finally { setBusy(false); }
  }, [userId]);

  return <LocationContext.Provider value={{ enabled: owner === preferenceKey && enabled, ready: owner === preferenceKey && ready,
    busy: owner === preferenceKey && busy, message: owner === preferenceKey ? message : '', cityId: owner === preferenceKey ? cityId : null,
    capture, disable, record }}>{children}</LocationContext.Provider>;
}
