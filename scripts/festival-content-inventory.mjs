import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { CITIES } from '../src/lib/mock.ts';
import { EVENT_TIMEZONES } from '../supabase/functions/_shared/ticketmaster.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const nativeProof = channel => !!(channel && typeof channel.native_id === 'string' && channel.native_id.trim()
  && typeof channel.receipt === 'string' && channel.receipt.trim());
const countFields = ['candidates', 'held', 'expired', 'outside_window', 'prepared_new_gling', 'registered_gling', 'registration_unconfirmed'];

export function buildInventory(events, { cities = CITIES, policy, now = new Date() }) {
  if (!Array.isArray(events) || !Number.isFinite(now.getTime()) || !validDay(policy.minimum_research_through)
    || ['daily_bundles', 'buffer_days', 'minimum_new_bundles_per_city', 'research_days'].some(key => !Number.isInteger(policy[key]) || policy[key] < 1)) {
    throw new Error('Invalid ledger, date or inventory policy');
  }
  const rows = cities.filter(city => city.state === 'open').map(city => ({ city: city.id,
    local_day: EVENT_TIMEZONES[city.id] ? new Intl.DateTimeFormat('en-CA', { timeZone: EVENT_TIMEZONES[city.id] }).format(now) : null,
    ...Object.fromEntries(countFields.map(key => [key, 0])) }));
  const day = rows.map(row => row.local_day).filter(Boolean).sort().at(-1) ?? now.toISOString().slice(0, 10);
  const researchThrough = [policy.minimum_research_through, new Date(Date.parse(day) + policy.research_days * 86400000).toISOString().slice(0, 10)].sort().at(-1);
  const channels = Object.fromEntries(['instagram', 'youtube', 'tiktok'].map(channel => [channel, { prepared_unassigned: 0, scheduled: 0, published: 0, native_unconfirmed: 0, preparation_unconfirmed: 0 }]));
  const unique = new Map();
  const conflicts = new Set();
  for (const event of events) {
    if (!event || typeof event.key !== 'string' || !event.key.trim() || typeof event.city !== 'string') throw new Error('Event lacks a canonical key or city');
    if (unique.has(event.key) && JSON.stringify(unique.get(event.key)) !== JSON.stringify(event)) conflicts.add(event.key);
    unique.set(event.key, event);
  }
  const held = [];
  for (const event of unique.values()) {
    const row = rows.find(city => city.city === event.city);
    if (!row) continue;
    row.candidates++;
    const draft = event.current_draft ?? {};
    const kind = event.content_kind ?? draft.content_kind ?? 'event';
    const place = kind === 'place';
    const datesKnown = validDay(draft.start_date) && validDay(draft.end_date) && draft.start_date <= draft.end_date;
    if (!place && datesKnown && row.local_day && draft.end_date < row.local_day) { row.expired++; continue; }
    if (!place && datesKnown && draft.start_date > researchThrough) { row.outside_window++; continue; }
    const reasons = [];
    if (conflicts.has(event.key)) reasons.push('conflicting-duplicate');
    if (!row.local_day) reasons.push('missing-city-timezone');
    if (!['event', 'place'].includes(kind) || (draft.content_kind && draft.content_kind !== kind)) reasons.push('content-kind-mismatch');
    if (place) {
      if (!['name', 'place_type', 'place_address'].every(key => typeof draft[key] === 'string' && draft[key].trim())
        || !validDay(draft.place_verified_on) || draft.place_verified_on > row.local_day || draft.place_operating_status !== 'open'
        || 'start_date' in draft || 'end_date' in draft) reasons.push('unverified-place-details');
    } else if (!datesKnown) reasons.push('unverified-event-dates');
    if (event.fact_check_status !== 'passed-within-stated-scope') reasons.push('facts-not-passed');
    if (draft.city !== event.city || event.native_draft_eligible !== true || draft.eligibility?.local_caption_verified !== true
      || draft.eligibility?.local_media_ready !== true || draft.eligibility?.gling_registration_eligible !== true || draft.eligibility?.gling_registration_hold) reasons.push('copy-or-media-not-prepared');
    if (reasons.length) { row.held++; held.push({ key: event.key, city: event.city, reasons }); continue; }
    const gling = event.channels?.gling;
    const registered = gling?.status === 'published' && nativeProof(gling);
    if (registered) row.registered_gling++;
    else if (draft.gling_registered || gling?.native_id || ['published', 'scheduled'].includes(gling?.status)) {
      row.registration_unconfirmed++; held.push({ key: event.key, city: event.city, reasons: ['registration-needs-readback-do-not-recreate'] });
    } else row.prepared_new_gling++;
    // Gling-first proof is required even for counting an unassigned social bundle.
    if (!registered) continue;
    for (const [name, counts] of Object.entries(channels)) {
      const channel = event.channels?.[name];
      if (['published', 'scheduled'].includes(channel?.status) && nativeProof(channel)) counts[channel.status]++;
      else if (channel?.native_id || ['published', 'scheduled'].includes(channel?.status)) counts.native_unconfirmed++;
      else if (['local-ready-for-normal-native-preview', 'local-draft-brand-login-held'].includes(channel?.status)) counts.prepared_unassigned++;
      else counts.preparation_unconfirmed++;
    }
  }
  const totals = Object.fromEntries(countFields.map(key => [key, rows.reduce((sum, row) => sum + row[key], 0)]));
  const target = policy.daily_bundles * policy.buffer_days;
  return { checked_at_utc: now.toISOString(), basis: 'Ledger evidence only; not a publication authorization or live fact/file revalidation.',
    research_through: researchThrough, cities: rows, totals, channels, held,
    refill: { target_new_bundles: target, new_bundles_needed: Math.max(0, target - totals.prepared_new_gling),
      city_priority: rows.map(row => ({ city: row.city, new_bundles_needed: Math.max(0, policy.minimum_new_bundles_per_city - row.prepared_new_gling),
        prepared_new_gling: row.prepared_new_gling, registered_gling: row.registered_gling }))
        .sort((a, b) => b.new_bundles_needed - a.new_bundles_needed || a.registered_gling - b.registered_gling || a.city.localeCompare(b.city)) } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const read = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  const policy = read('marketing/festival-content-continuity.json');
  const report = buildInventory(read('marketing/festival-content-ledger.json').events, { policy });
  report.missing_source_cities = report.cities.filter(row => !policy.source_directory[row.city]?.length).map(row => row.city);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
