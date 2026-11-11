import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Platform } from 'react-native';

import { useLanguage } from '@/hooks/use-language';
import { useAuth } from '@/lib/auth';
import { composePlace, type CityPlace } from '@/lib/city-places';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

// '이 장소로 글쓰기' (owner 2026-11-11 "지도에서 장소누르고 글 추가"): opens the writer with this place already attached.
// Null for a place the writer's own place search would not list, so the screen shows no button for it.
export function usePlaceCompose(place: Pick<CityPlace, 'id' | 'cityId'> | null | undefined) {
  const router = useRouter(), { isAuthed, promptLogin } = useAuth(), { t } = useLanguage(), { play } = useInteractionFeedback();
  const id = place?.id, cityId = place?.cityId;
  const allowed = useMemo(() => !!composePlace(cityId, id), [cityId, id]);
  if (!allowed) return null;
  return () => {
    play('selection');
    if (!isAuthed) return promptLogin(t.auth.reasonWrite);
    // The writer is on 오늘 in the app and at /compose on the web.
    router.push({ pathname: Platform.OS === 'web' ? '/compose' : '/', params: { compose: '1', place: id, placeCity: cityId } });
  };
}
