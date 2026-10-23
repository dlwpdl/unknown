import { getCityPlaces, type CityPlace } from './city-places.ts';
import { CITIES } from './mock.ts';
import { ticketmasterReference } from '../../supabase/functions/_shared/ticketmaster.ts';

export type MeetupDestination = { kind: 'place'; cityId: string; place: CityPlace } | { kind: 'event'; cityId: string; eventId: string };
export type MeetupDestinationParams = { placeId?: unknown; placeCityId?: unknown; ticketmasterEventId?: unknown; ticketmasterCityId?: unknown };
const identity = /^osm:(node|way|relation):([1-9]\d{0,18})$/;
const tailPattern = /\n\n장소: ([^\r\n]{1,250})\n장소 정보: (https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/([1-9]\d{0,18}))$/;
const supplied = (value: unknown) => value !== undefined && value !== null && value !== '';
function canonicalPlace(cityId: unknown, placeId: unknown): CityPlace | null {
  if (typeof cityId !== 'string' || typeof placeId !== 'string' || !identity.test(placeId) || !CITIES.some(city => city.id === cityId && city.state === 'open')) return null;
  const match = identity.exec(placeId)!;
  try {
    const place = getCityPlaces(cityId).find(place => place.id === placeId);
    return place && place.cityId === cityId && place.sourceUrl === `https://www.openstreetmap.org/${match[1]}/${match[2]}`
      && place.name.trim() && place.name.length <= 250 && !/[\u0000-\u001f\u007f]/.test(place.name) ? place : null;
  } catch { return null; }
}

export function resolveMeetupDestination(params: MeetupDestinationParams): { destination: MeetupDestination | null; invalid: boolean } {
  const placeRequested = supplied(params.placeId) || supplied(params.placeCityId), eventRequested = supplied(params.ticketmasterEventId) || supplied(params.ticketmasterCityId);
  if (!placeRequested && !eventRequested) return { destination: null, invalid: false };
  if (placeRequested && !eventRequested) {
    const place = canonicalPlace(params.placeCityId, params.placeId);
    if (place) return { destination: { kind: 'place', cityId: place.cityId, place }, invalid: false };
  } else if (eventRequested && !placeRequested && typeof params.ticketmasterEventId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(params.ticketmasterEventId)
    && typeof params.ticketmasterCityId === 'string' && CITIES.some(city => city.id === params.ticketmasterCityId && city.state === 'open')) {
    return { destination: { kind: 'event', cityId: params.ticketmasterCityId, eventId: params.ticketmasterEventId }, invalid: false };
  }
  return { destination: null, invalid: true };
}

export function placeMeetupTail(destination: MeetupDestination): string {
  const place = destination.kind === 'place' ? canonicalPlace(destination.cityId, destination.place.id) : null;
  if (!place) throw new Error('INVALID_MEETUP_DESTINATION');
  return `\n\n장소: ${place.name.trim()}\n장소 정보: ${place.sourceUrl}`;
}

export function splitPlaceMeetupBody(body: string, cityId?: string): { intro: string; details: string; place: CityPlace } | null {
  if (body.length > 5000 || ticketmasterReference(body)) return null;
  const match = tailPattern.exec(body);
  if (!match || /(?:^|\n)장소 정보:/.test(body.slice(0, match.index))) return null;
  const placeId = `osm:${match[3]}:${match[4]}`;
  const matches = (cityId === undefined ? CITIES.map(city => city.id) : [cityId]).map(city => canonicalPlace(city, placeId)).filter((place): place is CityPlace => !!place);
  return matches.length === 1 ? { intro: body.slice(0, match.index), details: body.slice(match.index), place: matches[0] } : null;
}

export function matchesMeetupDestination(post: { cityId: string; body: string }, destination: MeetupDestination): boolean {
  if (post.cityId !== destination.cityId) return false;
  if (destination.kind === 'place') return splitPlaceMeetupBody(post.body, post.cityId)?.place.id === destination.place.id;
  return !tailPattern.test(post.body) && ticketmasterReference(post.body) === destination.eventId
    && (post.body.match(/(?:^|\n)행사 ID: /g)?.length ?? 0) === 1;
}

export function meetupDestinationQuery(destination: MeetupDestination): string {
  return (destination.kind === 'place' ? destination.place.sourceUrl : destination.eventId).replace(/[\\%_]/g, character => `\\${character}`);
}
