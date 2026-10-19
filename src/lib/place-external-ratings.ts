import snapshot from './place-external-ratings.json';

export type ExternalPlaceRating = {
  cityId: string; placeId: string; placeName: string;
  provider: 'Google' | 'Tripadvisor' | 'Resy';
  score: number; scale: 5; count: number;
  via: 'Wanderlog' | 'Resy'; sourceUrl: string; checkedAt: string;
  observedUrl?: string; evidenceSha256?: string;
};

// Checked snapshots keep provider requests out of app opens and member-review writes.
export function getPlaceExternalRatings(cityId: string, placeId: string): ExternalPlaceRating[] {
  return (snapshot as ExternalPlaceRating[]).filter(rating => {
    if (rating.cityId !== cityId || rating.placeId !== placeId || rating.scale !== 5
      || !Number.isFinite(rating.score) || rating.score <= 0 || rating.score > 5
      || !Number.isSafeInteger(rating.count) || rating.count <= 0 || !Number.isFinite(Date.parse(rating.checkedAt))) return false;
    try {
      const url = new URL(rating.sourceUrl);
      if (url.username || url.password) return false;
      if (rating.observedUrl !== undefined || rating.evidenceSha256 !== undefined) {
        const observed = new URL(rating.observedUrl ?? '');
        if (rating.via !== 'Wanderlog' || observed.origin !== 'https://wanderlog.com'
          || observed.username || observed.password
          || !/^\/list\/geoCategory\/[1-9]\d*\/[a-z0-9-]+$/.test(observed.pathname)
          || !/^[a-f0-9]{64}$/.test(rating.evidenceSha256 ?? '')) return false;
      }
      return rating.via === 'Wanderlog' && ['Google', 'Tripadvisor'].includes(rating.provider)
        ? url.origin === 'https://wanderlog.com' && /^\/place\/details\/[1-9]\d*$/.test(url.pathname)
        : rating.via === 'Resy' && rating.provider === 'Resy' && url.origin === 'https://resy.com'
          && /^\/cities\/[a-z0-9-]+\/venues\/[a-z0-9-]+$/.test(url.pathname);
    } catch { return false; }
  });
}
