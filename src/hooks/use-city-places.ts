import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { useCallback, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { cityPlacesRevision, replaceCityPlacesCatalog, subscribeCityPlaces } from '@/lib/city-places';
import { refreshCityPlaces } from '@/lib/city-place-refresh';
import { supabase } from '@/lib/supabase';

// Android AsyncStorage cannot read back one value near 2 MB (CursorWindow) and caps its whole database at 6 MB, and the catalog
// outgrows that. Native apps keep it in a cache file; if the OS clears it, the next visit downloads once more.
const catalogFile = () => new File(Paths.cache, 'gling-city-places.json');
const catalogStorage = Platform.OS === 'web' ? AsyncStorage : {
  // Until the first file write, read the copy 1.5.1 and earlier left in AsyncStorage so an update does not download again that day.
  getItem: async (key: string) => { const file = catalogFile(); return file.exists ? file.text() : AsyncStorage.getItem(key); },
  setItem: async (key: string, value: string) => { await catalogFile().write(value); await AsyncStorage.removeItem(key); },
};

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
    const refresh = () => { void refreshCityPlaces(catalogStorage, fetchCatalog, replaceCityPlacesCatalog); };
    refresh();
    const listener = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => listener.remove();
  }, []));
  return revision;
}
