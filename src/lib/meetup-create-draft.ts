// Keeps a signed-out meetup draft on this device across the login sheet, OAuth round trip or a killed app.
// Plain local storage is fine: it is the person's own unpublished text, never a credential.
type DraftStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export const MEETUP_CREATE_DRAFT_KEY = 'gling.meetup-create.draft.v1';
const LIFETIME = 24 * 60 * 60 * 1000;
// Only a login that started from this screen within this window sends the person back to it.
const RESUME_WINDOW = 30 * 60 * 1000;
// Android AsyncStorage rows fail near 2MB; a larger cover is dropped and the person picks it again.
const COVER_LIMIT = 1_200_000;
const PARAM_KEYS = ['kind', 'ticketmasterCityId', 'ticketmasterEventId', 'placeCityId', 'placeId'] as const;
const CATEGORIES = ['casual', 'party', 'festival', 'sports', 'hobby', 'travel'];

export type MeetupDraftParams = Partial<Record<(typeof PARAM_KEYS)[number], string>>;
export type MeetupDraftCover = { uri: string; base64: string; mimeType: string; thumbBase64?: string; width?: number; height?: number };
export type MeetupCreateDraft = {
  params: MeetupDraftParams;
  awaitingLogin: boolean;
  kindChosen: boolean;
  kind: 'once' | 'group';
  startsAt: string; endsAt: string; cadence: string; category: string;
  title: string; body: string; question: string; topic: string;
  capacity: string; ageMin: string; ageMax: string;
  newcomer: { welcome: boolean; only: boolean };
  pickedPlaceId: string | null;
  cover: MeetupDraftCover | null;
  coverDropped: boolean;
};
type Stored = MeetupCreateDraft & { savedAt: number };

let tail: Promise<unknown> = Promise.resolve();
// Keep read-modify-write steps in order so a late save cannot resurrect a cleared draft.
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = tail.then(operation);
  tail = result.catch(() => {});
  return result;
}

export function meetupDraftParams(raw: Record<string, unknown>): MeetupDraftParams {
  const params: MeetupDraftParams = {};
  for (const key of PARAM_KEYS) {
    const value = raw[key];
    if (typeof value === 'string' && value && value.length <= 200 && /^[\w.:-]+$/.test(value)) params[key] = value;
  }
  return params;
}
export function meetupDraftScope(params: MeetupDraftParams): string {
  return `${params.ticketmasterCityId ?? ''}:${params.ticketmasterEventId ?? ''}:${params.placeCityId ?? ''}:${params.placeId ?? ''}`;
}

const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;
const iso = (value: unknown) => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
function validCover(value: unknown): value is MeetupDraftCover {
  if (!value || typeof value !== 'object') return false;
  const cover = value as Record<string, unknown>;
  return text(cover.uri, 2000) && !!cover.uri && text(cover.base64, COVER_LIMIT) && !!cover.base64 && text(cover.mimeType, 40)
    && (cover.thumbBase64 === undefined || text(cover.thumbBase64, COVER_LIMIT))
    && (cover.width === undefined || typeof cover.width === 'number') && (cover.height === undefined || typeof cover.height === 'number');
}
function parse(raw: string | null, now: number): Stored | null {
  if (!raw) return null;
  let value: Record<string, unknown>;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const age = now - (value.savedAt as number);
  if (typeof value.savedAt !== 'number' || !(age >= 0 && age < LIFETIME)) return null;
  const newcomer = value.newcomer as Record<string, unknown> | undefined;
  if (!value.params || typeof value.params !== 'object') return null;
  const params = meetupDraftParams(value.params as Record<string, unknown>);
  if (Object.keys(params).length !== Object.keys(value.params).length) return null;
  const ok = typeof value.awaitingLogin === 'boolean' && typeof value.kindChosen === 'boolean'
    && (value.kind === 'once' || value.kind === 'group') && iso(value.startsAt) && iso(value.endsAt)
    && text(value.cadence, 80) && typeof value.category === 'string' && CATEGORIES.includes(value.category)
    && text(value.title, 200) && text(value.body, 5000) && text(value.question, 300) && text(value.topic, 500)
    && text(value.capacity, 4) && text(value.ageMin, 3) && text(value.ageMax, 3)
    && !!newcomer && typeof newcomer.welcome === 'boolean' && typeof newcomer.only === 'boolean'
    && (value.pickedPlaceId === null || text(value.pickedPlaceId, 200))
    && (value.cover === null || validCover(value.cover)) && typeof value.coverDropped === 'boolean';
  return ok ? { ...(value as unknown as Stored), params } : null;
}

export function saveMeetupCreateDraft(storage: DraftStorage, draft: MeetupCreateDraft): Promise<void> {
  return serialize(async () => {
    const coverSize = (draft.cover?.base64.length ?? 0) + (draft.cover?.thumbBase64?.length ?? 0);
    const keepCover = !!draft.cover && coverSize <= COVER_LIMIT;
    const record: Stored = { ...draft, params: meetupDraftParams(draft.params), cover: keepCover ? draft.cover : null, coverDropped: draft.coverDropped || (!!draft.cover && !keepCover), savedAt: Date.now() };
    await storage.setItem(MEETUP_CREATE_DRAFT_KEY, JSON.stringify(record));
  });
}

/** The saved draft for this create screen (same place/event link), or null. Expired or broken records are removed. */
export function readMeetupCreateDraft(storage: DraftStorage, scope: string): Promise<MeetupCreateDraft | null> {
  return serialize(async () => {
    const raw = await storage.getItem(MEETUP_CREATE_DRAFT_KEY);
    const draft = parse(raw, Date.now());
    if (raw !== null && !draft) await storage.removeItem(MEETUP_CREATE_DRAFT_KEY);
    if (!draft || meetupDraftScope(draft.params) !== scope) return null;
    const { savedAt: _savedAt, ...rest } = draft;
    return rest;
  });
}

/** After a login that began on the create screen, returns its route params once; the draft itself stays for the screen to restore. */
export function takeMeetupLoginResume(storage: DraftStorage): Promise<MeetupDraftParams | null> {
  return serialize(async () => {
    const raw = await storage.getItem(MEETUP_CREATE_DRAFT_KEY);
    const draft = parse(raw, Date.now());
    if (!draft) { if (raw !== null) await storage.removeItem(MEETUP_CREATE_DRAFT_KEY); return null; }
    if (!draft.awaitingLogin) return null;
    await storage.setItem(MEETUP_CREATE_DRAFT_KEY, JSON.stringify({ ...draft, awaitingLogin: false }));
    return Date.now() - draft.savedAt < RESUME_WINDOW ? draft.params : null;
  });
}

export function clearMeetupCreateDraft(storage: DraftStorage): Promise<void> {
  return serialize(() => storage.removeItem(MEETUP_CREATE_DRAFT_KEY));
}
