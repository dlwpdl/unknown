import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { CityPlacePhoto } from '@/components/city-place-photo';
import { ListCard, ListRow } from '@/components/list-card';
import { SymbolView } from '@/components/symbol-view';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { getCityPlaces, type CityPlace } from '@/lib/city-places';
import { deliveryPartnerPlace } from '@/lib/delivery-partners';
import { loadFriendFolders, loadPlaceFriendFolders, type FolderCard, type FolderPlace, type PlaceFolder } from '@/lib/saved-items';
import { supabase } from '@/lib/supabase';

// Finds places in the app's catalog, reading each city once (getCityPlaces rebuilds a whole city per call).
export function placeLookup() {
  const cities = new Map<string, Map<string, CityPlace>>();
  return (cityId: string, placeKey: string): CityPlace | undefined => {
    if (!cities.has(cityId)) {
      try { cities.set(cityId, new Map(getCityPlaces(cityId).map(value => [value.id, value]))); } catch { cities.set(cityId, new Map()); }
    }
    return cities.get(cityId)!.get(placeKey) ?? deliveryPartnerPlace(cityId, placeKey);
  };
}

// Names a folder's places from the catalog. A place the catalog no longer has and no business name for drops out.
export function folderPlaces(places: FolderPlace[]) {
  const find = placeLookup();
  return places.flatMap(item => {
    const place = item.placeKey ? find(item.cityId, item.placeKey) : undefined;
    const title = item.name ?? place?.name;
    return title ? [{ ...item, place, title, subtitle: item.address ?? place?.address ?? '' }] : [];
  });
}

// A folder's cover: its cover place's photo, or a folder icon when the catalog has no such place.
export function FolderCover({ place, style }: { place?: CityPlace; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  if (place) return <CityPlacePhoto place={place} style={[styles.thumb, style]} />;
  return <View style={[styles.thumb, styles.icon, { backgroundColor: theme.backgroundElement }, style]}>
    <SymbolView name={{ ios: 'folder', android: 'folder', web: 'folder' }} size={20} tintColor={theme.textSecondary} accessible={false} />
  </View>;
}

// A friend's folders under their profile. Nothing shows until there is at least one, and a failed read stays quiet.
export function FriendFolders({ userId, nickname }: { userId: string; nickname: string }) {
  const { tr, locale } = useLanguage(), router = useRouter();
  const [state, setState] = useState<{ userId: string; folders: (FolderCard & { place?: CityPlace })[] } | null>(null);
  useEffect(() => {
    let active = true;
    void loadFriendFolders(supabase, userId).then(folders => {
      const find = placeLookup();
      if (active) setState({ userId, folders: folders.map(folder => ({ ...folder, place: folder.cover ? find(folder.cover.cityId, folder.cover.placeKey) : undefined })) });
    }).catch(() => { if (active) setState({ userId, folders: [] }); });
    return () => { active = false; };
  }, [userId]);
  const folders = state?.userId === userId ? state.folders : [];
  if (!folders.length) return null;
  return <View style={styles.section}>
    <ThemedText type="smallBold">{tr('{0}님의 폴더', nickname)}</ThemedText>
    <ListCard>{folders.map(folder => <ListRow key={folder.id} analyticsId="user.folder.open" title={folder.name}
      detail={[tr('장소 {0}곳', folder.placeCount.toLocaleString(locale)), folder.description].filter(Boolean).join(' · ')} leading={<FolderCover place={folder.place} />}
      onPress={() => router.push({ pathname: '/profile/folder', params: { id: folder.id } })} />)}</ListCard>
  </View>;
}

// On a place screen: friends' folders that hold this place. Quiet until there is one, and quiet on a failed read.
export function PlaceFriendFolders({ cityId, placeKey }: { cityId: string; placeKey: string }) {
  const { tr } = useLanguage(), router = useRouter(), hidden = useContentVisibility();
  const { isAuthed, isAuthLoading, me } = useAuth();
  const key = `${isAuthed ? me.id : 'guest'}:${cityId}:${placeKey}`;
  const [state, setState] = useState<{ key: string; folders: (PlaceFolder & { place?: CityPlace })[] } | null>(null);
  useEffect(() => {
    if (!isAuthed || isAuthLoading) return;
    let active = true;
    void loadPlaceFriendFolders(supabase, cityId, placeKey).then(folders => {
      const find = placeLookup();
      if (active) setState({ key, folders: folders.map(folder => ({ ...folder, place: folder.cover ? find(folder.cover.cityId, folder.cover.placeKey) : undefined })) });
    }).catch(() => { if (active) setState({ key, folders: [] }); });
    return () => { active = false; };
  }, [key, isAuthed, isAuthLoading, cityId, placeKey]);
  const folders = (state?.key === key ? state.folders : []).filter(folder => !hidden('user', folder.owner.id));
  if (!folders.length) return null;
  return <View style={styles.section}>
    <ThemedText type="smallBold">{tr('이 장소를 넣은 친구 폴더')}</ThemedText>
    <ListCard>{folders.map(folder => <ListRow key={folder.id} analyticsId="places.friend-folder.open" title={folder.name}
      detail={tr('{0}님이 만든 폴더', folder.owner.nickname)} leading={<FolderCover place={folder.place} />}
      onPress={() => router.push({ pathname: '/profile/folder', params: { id: folder.id } })} />)}</ListCard>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  thumb: { width: 44, height: 44, borderRadius: 10 },
  icon: { alignItems: 'center', justifyContent: 'center' },
});
