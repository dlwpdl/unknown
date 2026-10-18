import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { cityPlacesRevision, replaceCityPlacesCatalog, subscribeCityPlaces } from '@/lib/city-places';
import { refreshCityPlaces } from '@/lib/city-place-refresh';
import { supabase } from '@/lib/supabase';

async function fetchCatalog() {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const { data, error } = await supabase.rpc('get_city_place_catalog').abortSignal(controller.signal);
    if (error || !data) throw new Error('PLACE_CATALOG_UNAVAILABLE');
    return data;
  } finally { clearTimeout(timeout); }
}

export function useCityPlacesRevision() {
  const revision = useSyncExternalStore(subscribeCityPlaces, cityPlacesRevision, cityPlacesRevision);
  useFocusEffect(useCallback(() => {
    const refresh = () => { void refreshCityPlaces(AsyncStorage, fetchCatalog, replaceCityPlacesCatalog); };
    refresh();
    const listener = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => listener.remove();
  }, []));
  return revision;
}
