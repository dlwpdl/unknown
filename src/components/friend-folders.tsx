import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ListCard, ListRow } from '@/components/list-card';
import { SymbolView } from '@/components/symbol-view';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { getCityPlaces, type CityPlace } from '@/lib/city-places';
import { deliveryPartnerPlace } from '@/lib/delivery-partners';
import { loadFriendFolders, type FolderCard, type FolderPlace } from '@/lib/saved-items';
import { supabase } from '@/lib/supabase';

// Names a folder's places from the app's catalog, reading each city once (getCityPlaces rebuilds a whole city per call).
// A place the catalog no longer has and no business name for drops out.
export function folderPlaces(places: FolderPlace[]) {
  const cities = new Map<string, Map<string, CityPlace>>();
  return places.flatMap(item => {
    let place: CityPlace | undefined;
    if (item.placeKey) {
      if (!cities.has(item.cityId)) {
        try { cities.set(item.cityId, new Map(getCityPlaces(item.cityId).map(value => [value.id, value]))); } catch { cities.set(item.cityId, new Map()); }
      }
      place = cities.get(item.cityId)!.get(item.placeKey) ?? deliveryPartnerPlace(item.cityId, item.placeKey);
    }
    const title = item.name ?? place?.name;
    return title ? [{ ...item, place, title, subtitle: item.address ?? place?.address ?? '' }] : [];
  });
}

function FolderIcon() {
  const theme = useTheme();
  return <View style={[styles.thumb, styles.icon, { backgroundColor: theme.backgroundElement }]}>
    <SymbolView name={{ ios: 'folder', android: 'folder', web: 'folder' }} size={20} tintColor={theme.textSecondary} accessible={false} />
  </View>;
}

// A friend's folders under their profile. Nothing shows until there is at least one, and a failed read stays quiet.
export function FriendFolders({ userId, nickname }: { userId: string; nickname: string }) {
  const { tr, locale } = useLanguage(), router = useRouter();
  const [state, setState] = useState<{ userId: string; folders: FolderCard[] } | null>(null);
  useEffect(() => {
    let active = true;
    void loadFriendFolders(supabase, userId).then(folders => { if (active) setState({ userId, folders }); }).catch(() => { if (active) setState({ userId, folders: [] }); });
    return () => { active = false; };
  }, [userId]);
  const folders = state?.userId === userId ? state.folders : [];
  if (!folders.length) return null;
  return <View style={styles.section}>
    <ThemedText type="smallBold">{tr('{0}님의 폴더', nickname)}</ThemedText>
    <ListCard>{folders.map(folder => <ListRow key={folder.id} analyticsId="user.folder.open" title={folder.name}
      detail={tr('장소 {0}곳', folder.placeCount.toLocaleString(locale))} leading={<FolderIcon />}
      onPress={() => router.push({ pathname: '/profile/folder', params: { id: folder.id } })} />)}</ListCard>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  thumb: { width: 44, height: 44, borderRadius: 10 },
  icon: { alignItems: 'center', justifyContent: 'center' },
});
