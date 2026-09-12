import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';

import { CITIES } from '@/lib/mock';
import type { City } from '@/lib/types';
import { useCommunityLocation } from '@/lib/location-provider';
import { useAuth } from '@/lib/auth';

const CommunityCityContext = createContext<{
  city: City; setCity: (city: City) => void;
  selectCity: (city: City) => Promise<boolean>; saving: boolean;
} | null>(null);

export function CommunityCityProvider({ children }: { children: ReactNode }) {
  const { cityId } = useCommunityLocation();
  const { me, isAuthed, setProfileCity } = useAuth();
  const userId = isAuthed ? me.id : null;
  const currentUser = useRef(userId);
  useLayoutEffect(() => { currentUser.current = userId; }, [userId]);
  const [selected, setSelected] = useState<{ userId: string | null; city: City } | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const city = (selected?.userId === userId ? selected.city : null)
    ?? CITIES.find((item) => item.id === me.cityId)
    ?? CITIES.find((item) => item.id === cityId) ?? CITIES[0];
  // Navigation after posting only changes the view; explicit city selection saves the preference.
  const setCity = (next: City) => setSelected({ userId, city: next });
  const selectCity = async (next: City) => {
    if (inFlight.current || !CITIES.some((item) => item.id === next.id)) return false;
    if (!userId) { setCity(next); return true; }
    if (next.id === me.cityId) { setSelected(null); return true; }
    inFlight.current = true; setSaving(true);
    try {
      await setProfileCity(next.id);
      if (currentUser.current !== userId) return false;
      setSelected(null);
      return true;
    } catch {
      if (currentUser.current === userId) Alert.alert('지역을 저장하지 못했어요', '연결을 확인한 뒤 다시 선택해 주세요. 기존 지역은 유지됩니다.');
      return false;
    } finally { inFlight.current = false; setSaving(false); }
  };
  return <CommunityCityContext.Provider value={{ city, setCity, selectCity, saving }}>{children}</CommunityCityContext.Provider>;
}

export function useCommunityCity() {
  const value = useContext(CommunityCityContext);
  if (!value) throw new Error('CommunityCityProvider is required');
  return value;
}
