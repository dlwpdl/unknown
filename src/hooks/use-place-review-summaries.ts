import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { useAuth } from '@/lib/auth';
import { loadPlaceRatingSummaries, type PlaceRatingSummary } from '@/lib/place-reviews';
import { supabase } from '@/lib/supabase';

export function usePlaceReviewSummaries(cityId: string, placeIds: string[]) {
  const { me, isAuthed, isAuthLoading } = useAuth();
  const viewer = isAuthed ? me.id : null;
  const ids = [...new Set(placeIds)].slice(0, 50).sort().join('|');
  const key = `${viewer ?? 'guest'}:${cityId}:${ids}`;
  const [snapshot, setSnapshot] = useState<{ key: string; ratings: Record<string, PlaceRatingSummary> }>({ key: '', ratings: {} });
  useFocusEffect(useCallback(() => {
    let active = true;
    if (!cityId || !ids || isAuthLoading) return;
    const matchesViewer = async () => {
      const { data, error } = await supabase.auth.getSession();
      return !error && (data.session?.user.id ?? null) === viewer;
    };
    void (async () => {
      try {
        if (!await matchesViewer() || !active) return;
        const places = ids.split('|');
        const batches = await Promise.all([places.slice(0, 25), places.slice(25)].filter(batch => batch.length)
          .map(batch => loadPlaceRatingSummaries(supabase, cityId, batch)));
        const ratings = Object.assign({}, ...batches) as Record<string, PlaceRatingSummary>;
        if (active && await matchesViewer() && active) setSnapshot({ key, ratings });
      } catch {
        // Keep known scores for this account; missing data is never converted to zero reviews.
      }
    })();
    return () => { active = false; };
  }, [cityId, ids, isAuthLoading, key, viewer]));
  return !isAuthLoading && snapshot.key === key ? snapshot.ratings : {};
}
