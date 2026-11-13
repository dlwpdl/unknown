import assert from 'node:assert/strict';
import test from 'node:test';
import { publicPostEvent } from '../src/lib/public-event.ts';
import { publicPostSchema } from '../src/lib/public-seo.ts';

const url = 'https://gling.ej-entertainment.com/posts/00000000-0000-4000-8000-000000000001';
const post = (cityId, title, text, tagSlug = 'festival') => ({ id: '00000000-0000-4000-8000-000000000001', title, cityId, tagSlug, text });

test('a festival post with one dated day and a Venue(street address) becomes an Event on the city clock', () => {
  const market = publicPostEvent(post('vancouver', 'Vancouver Christmas Market 2026: 운영시간·연령별 패스',
    'Vancouver Christmas Market이 2026년 11월 16일부터 12월 24일까지 Jack Poole Plaza(1055 Canada Place)에서 열립니다.'), url);
  assert.deepEqual(market, {
    '@type': 'Event', '@id': `${url}#event`, name: 'Vancouver Christmas Market 2026', startDate: '2026-11-16', endDate: '2026-12-24',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: { '@type': 'Place', name: 'Jack Poole Plaza', address: { '@type': 'PostalAddress', streetAddress: '1055 Canada Place', addressRegion: 'BC', addressCountry: 'CA' } },
  });
  const show = publicPostEvent(post('montreal', '몬트리올 BEYRIES 라이브 공연', '공연은 2026년 10월 7일 19:30–20:50, Salle Émile-Legault(613 avenue Sainte-Croix)에서 열립니다.'), url);
  assert.equal(show.startDate, '2026-10-07T19:30:00-04:00');
  assert.equal(show.endDate, '2026-10-07T20:50:00-04:00');
  // B.C. stays on UTC-7 after 2026-11-01 even where zone data is older; Toronto drops to UTC-5.
  assert.equal(publicPostEvent(post('vancouver', '밴쿠버 겨울 공연', '2026년 12월 5일 19:00 Orpheum(601 Smithe St)'), url).startDate, '2026-12-05T19:00:00-07:00');
  assert.equal(publicPostEvent(post('toronto', '토론토 겨울 공연', '2026년 12월 5일(토) 19:00 Massey Hall(178 Victoria St)'), url).startDate, '2026-12-05T19:00:00-05:00');
  const festival = publicPostEvent(post('toronto', 'Toronto After Dark 2026: 극장·패스', 'Toronto After Dark가 2026년 10월 14~18일 열립니다. 상영관은 Scotiabank Theatre(259 Richmond St W)와 CineCycle(129 Spadina Ave)입니다.'), url);
  assert.deepEqual([festival.startDate, festival.endDate, festival.location.map(place => place.name)], ['2026-10-14', '2026-10-18', ['Scotiabank Theatre', 'CineCycle']]);
  assert.equal(publicPostEvent(post('toronto', 'Distillery Winter Village 2026', '2026년 11월 12일–2027년 1월 3일 Distillery Historic District(55 Mill Street)에서 열립니다.'), url).endDate, '2027-01-03');
});

test('posts without a certain date, a street address or the festival topic stay plain posts', () => {
  for (const [cityId, text, tagSlug] of [
    ['vancouver', '2026년 11월 7일 14:00–17:00, Roundhouse Community Centre.'],
    ['montreal', '2026년 10월 11일 13:30~16:00에 열립니다. 장소는 Bibliothèque interculturelle(6767 Chemin de …'],
    ['vancouver', '2026년 10월 17·18일 11:00–16:00, UBC Botanical Garden(6804 SW Marine Dr)'],
    ['montreal', '공식 공지 기간은11월13일–2027년1월3일입니다. Grand Marché(1499 Jeanne-Mance St)'],
    ['vancouver', '올해 VIFF는 10월 1일부터 11일까지 열려요. The Cinematheque(1131 Howe St)'],
    ['toronto', '2026년 12월 20일–12월 3일 Massey Hall(178 Victoria St)'],
    ['toronto', '2026년 10월 3일 Massey Hall(2026 edition)'],
    ['toronto', '2026년 10월 3일 Massey Hall(178 Victoria St)', 'life'],
    ['ottawa', '2026년 10월 3일 Massey Hall(178 Victoria St)'],
  ]) assert.equal(publicPostEvent(post(cityId, '행사', text, tagSlug), url), null, text);
});

test('the post schema adds the Event as its own graph node only when there is one', () => {
  const facts = { ...post('toronto', 'Distillery Winter Village 2026', '2026년 11월 12일–2027년 1월 3일 Distillery Historic District(55 Mill Street)'), city: '토론토', label: '페스티벌' };
  assert.deepEqual(publicPostSchema(facts)['@graph'].map(node => node['@type']), ['DiscussionForumPosting', 'BreadcrumbList', 'Event']);
  assert.deepEqual(publicPostSchema({ ...facts, tagSlug: 'life' })['@graph'].map(node => node['@type']), ['DiscussionForumPosting', 'BreadcrumbList']);
});
