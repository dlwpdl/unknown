import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScrollView } from '@/components/analytics-controls';
import { CityPlacePhoto } from '@/components/city-place-photo';
import { DragSheet } from '@/components/drag-sheet';
import { FolderCover, folderPlaces } from '@/components/friend-folders';
import { ListCard, ListLoading, ListRow } from '@/components/list-card';
import { SavedLibraryButton } from '@/components/saved-library';
import { StateCard } from '@/components/state-card';
import { SymbolView } from '@/components/symbol-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadSavedFolder, setSavedFolderCover, type FolderCover as Cover, type FolderDetail } from '@/lib/saved-items';
import { supabase } from '@/lib/supabase';

// One saved folder as the server lets this member see it: the owner's own, or a friend's folder shown to friends.
// Only places and businesses come back, so this is also how friends see the owner's folder.
export default function SavedFolderScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { tr, locale } = useLanguage(), theme = useTheme(), router = useRouter(), hidden = useContentVisibility();
  const { isAuthed, isAuthLoading, me } = useAuth(), { play } = useInteractionFeedback();
  const [revision, setRevision] = useState(0);
  const [picking, setPicking] = useState(false), [coverBusy, setCoverBusy] = useState(false), [coverError, setCoverError] = useState('');
  const folderId = typeof id === 'string' ? id : '';
  const key = `${isAuthed ? me.id : 'guest'}:${folderId}:${revision}`;
  const [state, setState] = useState<{ key: string; folder: FolderDetail | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!isAuthed || isAuthLoading || !folderId) return;
    let active = true;
    void loadSavedFolder(supabase, folderId).then(folder => { if (active) setState({ key, folder, failed: false }); })
      .catch((error: unknown) => { if (active) setState({ key, folder: null, failed: !(error instanceof Error && error.message.includes('FOLDER_UNAVAILABLE')) }); });
    return () => { active = false; };
  }, [key, isAuthed, isAuthLoading, folderId]);
  const current = state?.key === key ? state : null;
  const folder = current?.folder && !hidden('user', current.folder.owner.id) ? current.folder : null;
  const rows = folder ? folderPlaces(folder.places) : [];
  const loading = isAuthed && !!folderId && !current;
  const photos = rows.filter(row => row.place && row.placeKey);
  // The server's cover, or the newest place with a photo when the catalog no longer has that one.
  const coverPlace = (folder?.cover && photos.find(row => row.cityId === folder.cover!.cityId && row.placeKey === folder.cover!.placeKey) || photos[0])?.place;
  const pickCover = async (value: Cover) => {
    if (!folder || coverBusy) return;
    setCoverBusy(true); setCoverError('');
    try { await setSavedFolderCover(supabase, folder.id, value); play('success'); setPicking(false); setRevision(previous => previous + 1); }
    catch { play('warning'); setCoverError(tr('표지를 바꾸지 못했어요. 다시 시도해 주세요.')); }
    finally { setCoverBusy(false); }
  };
  return <ThemedView style={styles.root}><SafeAreaView edges={['bottom']} style={styles.safe}>
    <Stack.Screen options={{ title: folder?.name ?? tr('폴더') }} />
    <ScrollView analyticsId="folder.scroll" contentContainerStyle={styles.content}>
      {loading ? <ListLoading label={tr('폴더 불러오는 중')} />
        : !folder ? <StateCard kind={current?.failed ? 'error' : 'empty'} title={current?.failed ? tr('폴더를 불러오지 못했어요') : tr('지금은 볼 수 없는 폴더예요')}
          body={current?.failed ? tr('연결을 확인하고 다시 시도해 주세요.') : tr('나만 보기로 바뀌었거나 지워진 폴더일 수 있어요.')}
          actionLabel={current?.failed ? tr('다시 시도') : undefined} onAction={current?.failed ? () => setRevision(value => value + 1) : undefined} />
        : <>
          <View style={styles.head}>
            <View style={styles.title}>
              <FolderCover place={coverPlace} style={styles.cover} />
              <View style={styles.grow}>
                <ThemedText type="section" accessibilityRole="header">{folder.name}</ThemedText>
                <ThemedText type="supporting" themeColor="textSecondary">{[
                  folder.role === 'owner' ? null : tr('{0}님이 만든 폴더', folder.owner.nickname),
                  tr('장소 {0}곳', rows.length.toLocaleString(locale)),
                  folder.visibility === 'friends' ? tr('친구에게 보여요') : tr('나만 보기'),
                ].filter(Boolean).join(' · ')}</ThemedText>
              </View>
            </View>
            {!!folder.description && <ThemedText>{folder.description}</ThemedText>}
            {folder.role === 'owner' && <ThemedText type="supporting" themeColor="textSecondary">{folder.visibility === 'friends'
              ? tr('친구에게는 이 화면처럼 장소와 비즈니스만 보여요.') : tr('나만 보는 폴더예요. 저장함의 폴더 관리에서 친구에게 보이게 바꿀 수 있어요.')}</ThemedText>}
            {folder.role === 'owner' && photos.length > 1 && <View style={styles.actions}>
              <SavedLibraryButton analyticsId="folder.cover.open" label={tr('표지 바꾸기')} onPress={() => { setCoverError(''); setPicking(true); }} />
            </View>}
          </View>
          {rows.length ? <ListCard>{rows.map(row => <ListRow key={row.merchantId ?? `${row.cityId}:${row.placeKey}`} analyticsId="folder.place.open" title={row.title} detail={row.subtitle || undefined}
            leading={row.place ? <CityPlacePhoto place={row.place} style={styles.thumb} />
              : <View style={[styles.thumb, styles.icon, { backgroundColor: theme.backgroundElement }]}><SymbolView name={{ ios: 'building.2', android: 'storefront', web: 'storefront' }} size={20} tintColor={theme.textSecondary} accessible={false} /></View>}
            onPress={() => row.merchantId ? router.push({ pathname: '/company/[id]', params: { id: row.merchantId } })
              : router.push({ pathname: '/places/[id]', params: { id: row.placeKey!, cityId: row.cityId } })} />)}</ListCard>
            : <StateCard kind="empty" title={tr('아직 장소가 없어요')} body={folder.role === 'owner' ? tr('저장함에서 장소 카드의 ··· 를 누르면 이 폴더에 넣을 수 있어요.') : tr('친구가 장소를 넣으면 여기에 보여요.')} />}
        </>}
    </ScrollView>
    <DragSheet visible={picking && !!folder} onClose={() => setPicking(false)} dismissible={!coverBusy} title={tr('표지 고르기')}>
      <View style={styles.sheet}>
        <ThemedText type="supporting" themeColor="textSecondary">{tr('이 폴더에 넣은 장소 사진 중에서 골라요. 고르지 않으면 가장 최근에 저장한 장소가 표지가 돼요.')}</ThemedText>
        {!!coverError && <ThemedText type="supporting" accessibilityRole="alert">{coverError}</ThemedText>}
        <ScrollView analyticsId="folder.cover.scroll" style={styles.picker}><ListCard>{photos.map(row => {
          const chosen = row.place === coverPlace;
          return <ListRow key={`${row.cityId}:${row.placeKey}`} analyticsId="folder.cover.pick" title={row.title} label={chosen ? tr('{0}, 지금 표지', row.title) : row.title}
            leading={<CityPlacePhoto place={row.place!} style={styles.thumb} />}
            trailing={chosen ? <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={18} tintColor={theme.accent} accessible={false} /> : undefined}
            onPress={() => { if (!chosen) void pickCover({ cityId: row.cityId, placeKey: row.placeKey! }); }} />;
        })}</ListCard></ScrollView>
      </View>
    </DragSheet>
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' }, safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.five },
  head: { gap: Spacing.two },
  title: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  grow: { flex: 1, minWidth: 0, gap: Spacing.one },
  cover: { width: 88, height: 88, borderRadius: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  sheet: { gap: Spacing.three, paddingBottom: Spacing.two },
  picker: { maxHeight: 420 },
  thumb: { width: 44, height: 44, borderRadius: 10 },
  icon: { alignItems: 'center', justifyContent: 'center' },
});
