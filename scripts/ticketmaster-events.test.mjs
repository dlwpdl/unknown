import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEventQuery, normalizeEvent, meetupAllowed, safeTicketUrl, featuredLocalEvents, spotlightLocalEvents, localDayUtcRange, eventPriceLabel, eventMatchesPriceFilter } from '../supabase/functions/_shared/ticketmaster.ts';
const raw = { id: 'G5vYZabc', name: 'Live show', url: 'https://www.ticketmaster.ca/event/G5vYZabc?irgwc=1', dates: { start: { dateTime: '2027-01-02T04:00:00Z', localDate: '2027-01-01', localTime: '20:00:00' }, timezone: 'America/Vancouver', status: { code: 'onsale' } }, _embedded: { venues: [{ name: 'Arena', city: { name: 'Vancouver' }, country: { countryCode: 'CA' } }] } };
test('bounded city/category/page validation keeps upstream requests controlled', () => {
  assert.deepEqual(parseEventQuery({ cityId: 'vancouver' }), { cityId: 'vancouver', category: 'all', page: 0 });
  assert.deepEqual(parseEventQuery({ cityId: 'vancouver', festival: true }), { cityId: 'vancouver', category: 'all', page: 0, festival: true });
  for (const input of [{ cityId: 'vancouver', festival: false }, { cityId: 'vancouver', festival: true, page: 1 }, { cityId: 'vancouver', festival: true, category: 'music' }, { cityId: 'vancouver', festival: true, eventId: 'G5vYZabc' }]) assert.throws(() => parseEventQuery(input));
  for (const input of [{cityId:'unknown'}, {cityId:'vancouver',page:-1}, {cityId:'vancouver',page:20}, {cityId:'vancouver',page:'1'}, {cityId:'vancouver',category:'bad'}, {cityId:'vancouver',startDate:'tomorrow'}, {cityId:'vancouver',eventId:'../keys'}]) assert.throws(() => parseEventQuery(input));
  const futureDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  assert.equal(parseEventQuery({ cityId:'vancouver', date:futureDate }).date, futureDate);
  const month = futureDate.slice(0, 7);
  assert.equal(parseEventQuery({ cityId:'vancouver', month }).month, month);
  for (const input of [{cityId:'vancouver',month:'2026-13'}, {cityId:'vancouver',month,date:futureDate}, {cityId:'vancouver',month,eventId:'G5vYZabc'}, {cityId:'vancouver',month,page:1}]) assert.throws(() => parseEventQuery(input));
  for (const date of ['2026-02-30','yesterday','2020-01-01','2030-01-01']) assert.throws(() => parseEventQuery({ cityId:'vancouver', date }));
});
test('city-local day bounds survive daylight saving changes', () => {
  assert.deepEqual(localDayUtcRange('2027-03-14','America/Vancouver'), ['2027-03-14T08:00:00Z','2027-03-15T07:00:00Z']);
  assert.deepEqual(localDayUtcRange('2027-11-07','America/Vancouver'), ['2027-11-07T07:00:00Z','2027-11-08T08:00:00Z']);
});
test('price and short description never invent free entry or copy terms as editorial text', () => {
  assert.equal(eventPriceLabel(normalizeEvent(raw)), '가격 정보 없음');
  const event = normalizeEvent({ ...raw, info: '<p>Explore the castle with friends.</p>', priceRanges: [{ min: 25, max: 40, currency: 'CAD' }] });
  assert.equal(event.description, 'Explore the castle with friends.');
  assert.match(eventPriceLabel(event), /CA\$25/);
});
test('price filters use only known CAD minimums and keep unknown prices separate', () => {
  const priced = normalizeEvent({ ...raw, priceRanges: [{ min: 49, max: 120, currency: 'CAD' }] });
  const foreign = normalizeEvent({ ...raw, priceRanges: [{ min: 25, max: 50, currency: 'USD' }] });
  const freeMarked = normalizeEvent({ ...raw, priceRanges: [{ min: 0, max: 25, currency: 'CAD' }] });
  assert.equal(eventMatchesPriceFilter(priced, 'under50'), true);
  assert.equal(eventMatchesPriceFilter(priced, 'free'), false);
  assert.equal(eventMatchesPriceFilter(foreign, 'under50'), false);
  assert.equal(eventMatchesPriceFilter(normalizeEvent(raw), 'unknown'), true);
  assert.equal(eventMatchesPriceFilter(freeMarked, 'free'), true);
  assert.equal(eventMatchesPriceFilter(priced, 'all'), true);
});
test('normalization preserves affiliate URL and absolute/local time, without inventing price or stock', () => {
  const event = normalizeEvent(raw);
  assert.equal(event.ticketUrl, raw.url); assert.equal(event.startsAt, raw.dates.start.dateTime); assert.equal(event.localDate, '2027-01-01'); assert.equal(event.price, null);
  assert.equal(meetupAllowed(event, Date.parse('2026-12-01')), true);
  assert.equal(meetupAllowed(event, Date.parse('2028-01-01')), false);
  assert.equal(safeTicketUrl('https://ticketmaster.ca.evil.test'), null);
  assert.equal(safeTicketUrl('javascript:alert(1)'), null);
});
test('event-linked YouTube videos are accepted only from a real video URL', () => {
  assert.equal(normalizeEvent({ ...raw, externalLinks: { youtube: [{ url: 'https://www.youtube.com/watch?v=abcdefghijk' }] } }).videoYoutubeId, 'abcdefghijk');
  assert.equal(normalizeEvent({ ...raw, externalLinks: { youtube: [{ url: 'https://youtu.be/abcdefghijk' }] } }).videoYoutubeId, 'abcdefghijk');
  assert.equal(normalizeEvent({ ...raw, externalLinks: { youtube: [{ url: 'https://youtube.com/channel/abcdefghijk' }] } }).videoYoutubeId, null);
  assert.equal(normalizeEvent({ ...raw, externalLinks: { youtube: [{ url: 'https://youtube.com.evil.test/watch?v=abcdefghijk' }] } }).videoYoutubeId, null);
  assert.equal(normalizeEvent({ ...raw, _embedded: { ...raw._embedded, attractions: [{ externalLinks: { youtube: [{ url: 'https://youtu.be/abcdefghijk' }] } }] } }).videoYoutubeId, 'abcdefghijk');
});
test('uncertain, changed and cancelled events cannot seed meetup time', () => {
  for (const code of ['canceled','cancelled','postponed','rescheduled','offsale']) assert.equal(meetupAllowed(normalizeEvent({...raw,dates:{...raw.dates,status:{code}}}),0),false);
  for (const flag of ['dateTBD','dateTBA','timeTBA']) assert.equal(meetupAllowed(normalizeEvent({...raw,dates:{...raw.dates,start:{...raw.dates.start,[flag]:true}}}),0),false);
  assert.equal(meetupAllowed(normalizeEvent({...raw,dates:{...raw.dates,start:{localDate:'2027-01-01'}}}),0),false);
  assert.throws(() => normalizeEvent({ id:'broken' }));
});
test('body event reference is bounded and never accepts a URL as an ID', async () => {
  const { ticketmasterReference } = await import('../supabase/functions/_shared/ticketmaster.ts');
  assert.equal(ticketmasterReference('출처: Ticketmaster\n행사 ID: G5vYZabc\n티켓:'), 'G5vYZabc');
  for (const body of ['행사 ID: https://evil.test', '행사 ID: ../admin', `행사 ID: ${'a'.repeat(101)}`, `prefix 행사 ID: abc`]) assert.equal(ticketmasterReference(body), null);
});
test('today preview keeps upcoming events of every kind in date order', () => {
  const make = (id, name, dateTime, status = 'onsale') => normalizeEvent({ ...raw, id, name, dates: { ...raw.dates, start: { ...raw.dates.start, dateTime }, status: { code: status } } });
  const events = [make('concert', 'Concert', '2027-01-02T04:00:00Z'), make('past', 'Past Festival', '2025-01-02T04:00:00Z'), make('fest', 'City Festival', '2027-01-03T04:00:00Z'), make('sport', 'Football', '2027-01-04T04:00:00Z'), make('canceled', 'Canceled fair', '2027-01-05T04:00:00Z', 'canceled'), make('comedy', 'Comedy', '2027-01-05T04:00:00Z'), make('theatre', 'Theatre', '2027-01-05T05:00:00Z'), make('fair2', 'Jazz Festival', '2027-01-06T04:00:00Z')];
  assert.deepEqual(featuredLocalEvents(events, Date.parse('2026-09-24')).map(event => event.id), ['concert', 'fest', 'sport', 'comedy', 'theatre']);
  assert.deepEqual(spotlightLocalEvents(events, Date.parse('2026-09-24')).map(event => event.id), ['fest', 'fair2', 'concert']);
  assert.equal(events[0].id, 'concert');
});
