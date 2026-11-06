import type { CityPlace } from '@/lib/city-places';

export type ImportCandidate = { name: string; latitude?: number; longitude?: number; address?: string };
export type ImportInput =
  | { kind: 'google-list'; url: string }
  | { kind: 'google-place'; url: string }
  | { kind: 'social'; url: string; network: 'instagram' | 'tiktok' }
  | { kind: 'text'; text: string };
export type ImportMatch =
  | { status: 'found'; input: ImportCandidate; place: CityPlace }
  | { status: 'branch'; input: ImportCandidate; options: CityPlace[] }
  | { status: 'missing'; input: ImportCandidate };

const GOOGLE_HOST = /^(?:www\.|maps\.)?google(?:\.[a-z]{2,3}){1,2}$/;
const LIST_ID = /(?:!2s|\/placelists\/list\/)([\w-]+)/;
const MAX_NAMES = 200;
const MATCH_RADIUS_M = 300;
const SESSION_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function firstLink(raw: string): URL | null {
  const link = raw.match(/https?:\/\/[\w\-.~:/?#[\]@!$&'()*+,;=%]+/i)?.[0].replace(/[.,;:!?'")\]]+$/, '');
  try {
    const url = new URL(link ?? '');
    if (url.username || url.password || url.port) return null;
    url.protocol = 'https:';
    return url;
  } catch { return null; }
}

export function classifyImportInput(raw: string): ImportInput {
  const url = firstLink(raw);
  if (url) {
    const host = url.hostname, path = url.pathname, google = GOOGLE_HOST.test(host);
    if ((host === 'maps.app.goo.gl' && path.length > 1) || (host === 'goo.gl' && /^\/maps\/./.test(path))
      || (google && (/^\/maps\/placelists\/list\/[\w-]+/.test(path) || (path.startsWith('/maps/@') && /!2s[\w-]+/.test(path))))) return { kind: 'google-list', url: url.href };
    if (google && /^\/maps\/place\/[^/]+/.test(path)) return { kind: 'google-place', url: url.href };
    if (/^(?:www\.)?instagram\.com$/.test(host) && /^\/(?:reels?|p|tv)\/[\w-]+/.test(path)) return { kind: 'social', url: url.href, network: 'instagram' };
    if ((/^(?:www\.|m\.)?tiktok\.com$/.test(host) && /\/video\/\d+/.test(path)) || (/^v[mt]\.tiktok\.com$/.test(host) && path.length > 1)) return { kind: 'social', url: url.href, network: 'tiktok' };
  }
  return { kind: 'text', text: raw };
}

const coords = (latitude: unknown, longitude: unknown) =>
  typeof latitude === 'number' && typeof longitude === 'number' && Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && (latitude !== 0 || longitude !== 0) ? { latitude, longitude } : {};
const text = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() || undefined : undefined;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};

export function googlePlaceFromUrl(url: string): ImportCandidate | null {
  try {
    const parsed = new URL(url);
    const match = GOOGLE_HOST.test(parsed.hostname) ? parsed.pathname.match(/^\/maps\/place\/([^/]+)(?:\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?))?/) : null;
    const name = match && text(decodeURIComponent(match[1].replace(/\+/g, ' ')));
    if (!match || !name) return null;
    // The !3d!4d pin is the place itself; @lat,lng is only the map view centre.
    const pin = parsed.pathname.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    const [latitude, longitude] = pin ? [pin[1], pin[2]] : [match[2], match[3]];
    return { name, ...coords(Number(latitude), Number(longitude)) };
  } catch { return null; }
}

export async function readGoogleList(url: string, fetchImpl: typeof fetch = fetch): Promise<{ title: string; places: ImportCandidate[] }> {
  const input = classifyImportInput(url);
  const single = input.kind === 'google-place' ? googlePlaceFromUrl(input.url) : null;
  if (single) return { title: '', places: [single] };
  if (input.kind !== 'google-list') throw new Error('GOOGLE_LIST_UNREADABLE');
  let id = input.url.match(LIST_ID)?.[1];
  if (!id) {
    // A full browser UA gets a JS interstitial with no list id; the bare UA gets the plain 302.
    const response = await fetchImpl(input.url, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null);
    // RN fetch follows the redirect (response.url); a fetch that does not leaves it in Location.
    for (const target of [response?.url, response?.headers.get('location')]) {
      const resolved = classifyImportInput(target ?? '');
      const place = resolved.kind === 'google-place' ? googlePlaceFromUrl(resolved.url) : null;
      if (place) return { title: '', places: [place] };
      id = resolved.kind === 'google-list' ? resolved.url.match(LIST_ID)?.[1] : undefined;
      if (id) break;
    }
    if (!id) throw new Error('GOOGLE_LIST_UNREADABLE');
  }
  const session = Array.from({ length: 22 }, () => SESSION_CHARS[Math.floor(Math.random() * 64)]).join('');
  // shortcut: one call reads at most 500 places (!4i500) and ignores the next-page token d[1]; page through once passing that token is verified.
  const response = await fetchImpl(`https://www.google.com/maps/preview/entitylist/getlist?authuser=0&hl=en&gl=ca&pb=!1m1!1s${id}!2e2!3e2!4i500!6m3!1s${session}!15i204459!28e2!16b1`).catch(() => null);
  if (response && [401, 403, 404].includes(response.status)) throw new Error('GOOGLE_LIST_PRIVATE');
  if (!response?.ok) throw new Error('GOOGLE_LIST_UNREADABLE');
  let data: unknown;
  try { data = JSON.parse((await response.text()).replace(/^\)\]\}'/, '')); } catch { throw new Error('GOOGLE_LIST_UNREADABLE'); }
  if (!Array.isArray(data)) throw new Error('GOOGLE_LIST_UNREADABLE');
  const list = data[0];
  if (!Array.isArray(list)) throw new Error('GOOGLE_LIST_PRIVATE');
  // Only name, pin and address are read: list[3] and row[12] identify the owner and whoever added the place.
  const rows: unknown[] = Array.isArray(list[8]) ? list[8] : [];
  const places = rows.flatMap((row): ImportCandidate[] => {
    const name = Array.isArray(row) ? text(row[2]) : undefined;
    if (!Array.isArray(row) || !name) return [];
    const info = Array.isArray(row[1]) ? row[1] : [], pin = Array.isArray(info[5]) ? info[5] : [], address = text(info[4]);
    return [{ name, ...coords(pin[2], pin[3]), ...(address ? { address } : {}) }];
  });
  if (!places.length) throw new Error('GOOGLE_LIST_EMPTY');
  return { title: text(list[4]) ?? '', places };
}

function csvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (content[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && content[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function parseTakeoutFile(fileName: string, content: string): ImportCandidate[] {
  const body = content.replace(/^﻿/, '').trim();
  if (/\.(?:geo)?json$/i.test(fileName) || body.startsWith('{')) {
    let data: unknown;
    try { data = JSON.parse(body); } catch { return []; }
    const features = record(data).features;
    return (Array.isArray(features) ? features : []).flatMap((feature): ImportCandidate[] => {
      const properties = record(record(feature).properties), location = record(properties.location);
      const name = text(location.name) ?? text(properties.Title) ?? text(properties.name), address = text(location.address);
      if (!name) return [];
      const point = record(record(feature).geometry).coordinates, [longitude, latitude] = Array.isArray(point) ? point : [];
      return [{ name, ...coords(latitude, longitude), ...(address ? { address } : {}) }];
    });
  }
  const rows = csvRows(body), isTitle = (cell: string) => /^(?:title|name|제목)$/i.test(cell.trim());
  const header = rows.slice(0, 3).findIndex(row => row.some(isTitle));
  if (header < 0) return [];
  const title = rows[header].findIndex(isTitle), link = rows[header].findIndex(cell => cell.trim().toLowerCase() === 'url');
  return rows.slice(header + 1).flatMap((row): ImportCandidate[] => {
    const fromUrl = link >= 0 ? googlePlaceFromUrl(row[link]?.trim() ?? '') : null, name = text(row[title]) ?? fromUrl?.name;
    return name ? [{ ...fromUrl, name }] : [];
  });
}

function normalizeName(name: string): string {
  return name.normalize('NFKC').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC')
    .replace(/&/g, 'and').replace(/[^\p{L}\p{N}]/gu, '');
}

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter(name => {
    const key = normalizeName(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_NAMES);
}

export function splitTextNames(input: string): string[] {
  return uniqueNames(input.replace(/https?:\/\/\S+/gi, '\n').split(/[\r\n,，·•ㆍ・/|]+|\s\d{1,3}[.)]\s/).map(piece => piece
    .replace(/\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}️‍⃣]/gu, '')
    .replace(/^\s*(?:[-*–—▪◦‣>]+|\(?\d{1,3}[.)])\s*/, '')
    .replace(/^[\p{L}\s]{1,24}[:：]\s*/u, '')
    .replace(/\s+/g, ' ').trim()));
}

export async function extractPlaceNames(input: string, invoke: (body: { text: string }) => Promise<{ names?: unknown } | null>, { split = true } = {}): Promise<string[]> {
  let names: unknown;
  try { names = (await invoke({ text: input }))?.names; } catch { names = null; }
  // The model may invent names; keep only ones that appear in what the member pasted.
  const source = input.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
  const found = uniqueNames((Array.isArray(names) ? names : []).flatMap(name => {
    const clean = text(name);
    return clean && source.includes(clean.normalize('NFKC').toLowerCase()) ? [clean] : [];
  }));
  return found.length || !split ? found : splitTextNames(input);
}

// Owner pick 2026-11-04 (board card import-reels): Instagram hands a post's caption only to link-preview crawlers, so this asks as one.
// shortcut: stops working if Meta checks crawler IPs or renames these meta tags; the screen then lets the member pick the place.
const PREVIEW_AGENT = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
const decodeHtml = (value: string) => value.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, code: string) =>
  code[0] === '#' ? String.fromCodePoint(parseInt(code.slice(code[1] === 'x' || code[1] === 'X' ? 2 : 1), code[1] === 'x' || code[1] === 'X' ? 16 : 10)) : ENTITIES[code.toLowerCase()] ?? whole);

export async function readInstagramCaption(url: string, fetchImpl: typeof fetch = fetch): Promise<{ account: string; caption: string } | null> {
  try {
    const parsed = new URL(url);
    if (!/^(?:www\.)?instagram\.com$/.test(parsed.hostname) || !/^\/(?:reels?|p|tv)\/[\w-]+/.test(parsed.pathname)) return null;
    const response = await fetchImpl(`https://www.instagram.com${parsed.pathname}`, { headers: { 'User-Agent': PREVIEW_AGENT, Accept: 'text/html' } });
    if (!response.ok) return null;
    const html = (await response.text()).slice(0, 3_000_000), meta: Record<string, string> = {};
    for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
      const key = tag.match(/\b(?:property|name)="([^"]+)"/i)?.[1], content = tag.match(/\bcontent="([^"]*)"/i)?.[1];
      if (key && content !== undefined && !(key in meta)) meta[key] = decodeHtml(content);
    }
    // og:title reads `<account> on Instagram: "<caption>"`; og:description reads `N likes, N comments - <handle> on <date>: "<caption>"`.
    const title = meta['og:title'] ?? '', description = meta['og:description'] ?? '';
    const account = title.match(/^(.*?) on Instagram:/)?.[1]?.trim() ?? '';
    const caption = (description.match(/:\s*"([\s\S]*)"\s*$/)?.[1] ?? title.match(/on Instagram:\s*"([\s\S]*)"\s*$/)?.[1] ?? '').trim().slice(0, 10000);
    return account || caption ? { account, caption } : null;
  } catch { return null; }
}

type Pin = { latitude: number; longitude: number };
const hasPin = (candidate: ImportCandidate): candidate is ImportCandidate & Pin => 'latitude' in coords(candidate.latitude, candidate.longitude);

function meters(a: Pin, b: Pin): number {
  const rad = Math.PI / 180, dLat = (b.latitude - a.latitude) * rad, dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(Math.min(1, h)));
}

function dice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) grams.set(a.slice(i, i + 2), (grams.get(a.slice(i, i + 2)) ?? 0) + 1);
  let shared = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const count = grams.get(b.slice(i, i + 2)) ?? 0;
    if (count) { shared++; grams.set(b.slice(i, i + 2), count - 1); }
  }
  return 2 * shared / (a.length + b.length - 2);
}

// Same name, or one contains the other (a branch suffix like "Fraser"); the shorter side needs 4+ letters.
const sameName = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)));

export function matchPlaces(candidates: ImportCandidate[], places: CityPlace[]): ImportMatch[] {
  const catalog = places.map(place => ({ place, key: normalizeName(place.name) }));
  const seenInputs = new Set<string>(), foundIds = new Set<string>(), matches: ImportMatch[] = [];
  for (const input of candidates) {
    const key = normalizeName(input.name), pin = hasPin(input) ? input : null;
    const inputKey = `${key}|${pin ? `${pin.latitude.toFixed(4)},${pin.longitude.toFixed(4)}` : ''}`;
    if (seenInputs.has(inputKey)) continue;
    seenInputs.add(inputKey);
    let match: ImportMatch = { status: 'missing', input };
    if (key && pin) {
      const nearest = catalog.map(entry => ({ ...entry, distance: meters(pin, entry.place) }))
        .filter(entry => entry.distance <= MATCH_RADIUS_M && (sameName(key, entry.key) || dice(key, entry.key) >= 0.5))
        .sort((a, b) => a.distance - b.distance)[0];
      if (nearest) match = { status: 'found', input, place: nearest.place };
    } else if (key) {
      const hits = catalog.filter(entry => sameName(key, entry.key));
      if (hits.length === 1) match = { status: 'found', input, place: hits[0].place };
      else if (hits.length > 1) match = { status: 'branch', input, options: hits.sort((a, b) => dice(key, b.key) - dice(key, a.key)).slice(0, 5).map(entry => entry.place) };
    }
    if (match.status === 'found') {
      if (foundIds.has(match.place.id)) continue;
      foundIds.add(match.place.id);
    }
    matches.push(match);
  }
  return matches;
}
