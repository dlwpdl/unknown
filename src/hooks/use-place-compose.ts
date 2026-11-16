import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { DeviceEventEmitter, Platform } from 'react-native';

import { useLanguage } from '@/hooks/use-language';
import { useAuth } from '@/lib/auth';
import { composePlace, type CityPlace } from '@/lib/city-places';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

// The app opens the place writer over the screen in view (PlaceWriterHost in feed-screen), so closing it leaves that place where it was (QA B10-2).
export const PLACE_WRITE_EVENT = 'gling.place-write';
/** null reopens the place writer with its draft as it is (the failed upload card's 수정하기). */
export const openPlaceWriter = (place: CityPlace | null) => DeviceEventEmitter.emit(PLACE_WRITE_EVENT, place);

// '이 장소로 글쓰기' (owner 2026-11-11 "지도에서 장소누르고 글 추가"): opens the writer with this place already attached.
// Null for a place the writer's own place search would not list, so the screen shows no button for it.
export function usePlaceCompose(place: Pick<CityPlace, 'id' | 'cityId'> | null | undefined) {
  const router = useRouter(), { isAuthed, promptLogin } = useAuth(), { t } = useLanguage(), { play } = useInteractionFeedback();
  const id = place?.id, cityId = place?.cityId;
  const target = useMemo(() => composePlace(cityId, id), [cityId, id]);
  if (!target) return null;
  return () => {
    play('selection');
    if (!isAuthed) return promptLogin(t.auth.reasonWrite);
    // The web writer is the /compose page; the app's floats over this screen instead of going to 오늘 (owner 2026-11-13 "장소 화면 위에 글쓰기 띄우기").
    if (Platform.OS === 'web') router.push({ pathname: '/compose', params: { compose: '1', place: target.id, placeCity: target.cityId } });
    else openPlaceWriter(target);
  };
}
