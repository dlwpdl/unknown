import importlib.util
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def implementation():
    path = ROOT / 'scripts/refresh-city-places.py'
    assert path.exists(), 'daily place collector is missing'
    spec = importlib.util.spec_from_file_location('city_place_daily', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class DailyPlaces(unittest.TestCase):
    def fixture(self):
        now = '2026-10-18T01:00:00+00:00'
        place = dict(id='osm:node:1', cityId='vancouver', name='Verified Cafe', category='cafe', latitude=49.28, longitude=-123.12, address='Address', sourceUrl='https://www.openstreetmap.org/node/1')
        seed = dict(recommendationTheme='photo-spots', cities={'vancouver':dict(coverage='municipal-boundary', places=[place], recommendations=[dict(placeId=place['id'], reason='Source-checked photo setting', sourceUrl='https://example.org/venue', verifiedAt='2026-10-17T10:00:00Z')])})
        osm = [dict(type='node', id=1, lat=49.28, lon=-123.12, tags=dict(name='Verified Cafe', amenity='cafe', opening_hours='Mo-Su 09:00-17:00'))]
        return seed, osm, now

    def test_refresh_keeps_source_review_date_and_exact_identity(self):
        m = implementation(); seed, osm, now = self.fixture()
        data = m.build_catalog(seed, osm, now)
        self.assertEqual(data['cities']['vancouver']['places'][0]['id'], 'osm:node:1')
        self.assertEqual(data['cities']['vancouver']['places'][0]['openingHours'], 'Mo-Su 09:00-17:00')
        self.assertEqual(data['cities']['vancouver']['recommendations'][0]['verifiedAt'], seed['cities']['vancouver']['recommendations'][0]['verifiedAt'])
        self.assertEqual(data['collectedAt'], now)
        self.assertEqual(data.get('recommendationTheme'), 'photo-spots')

    def test_daily_refresh_preserves_the_reselected_editorial_revision_and_order(self):
        m = implementation(); seed, osm, now = self.fixture()
        seed['selectionRevision'] = 2
        result = m.build_catalog(seed, osm, now)
        self.assertEqual(result.get('selectionRevision'), 2)
        self.assertEqual(result['cities']['vancouver']['recommendations'], seed['cities']['vancouver']['recommendations'])
        for revision in [-1, 2.5, True]:
            seed['selectionRevision'] = revision
            with self.assertRaisesRegex(ValueError, 'INVALID_SELECTION_REVISION'):
                m.build_catalog(seed, osm, now)

    def test_fifty_distinct_reviewed_places_survive_refresh_but_fifty_one_is_rejected(self):
        m = implementation()
        for count in [50, 51]:
            seed, _, now = self.fixture()
            city = seed['cities']['vancouver']
            place, pick = city['places'][0], city['recommendations'][0]
            city['places'] = [dict(place, id=f'osm:node:{i}', name=f'Fixture photo place {i}',
                                  sourceUrl=f'https://www.openstreetmap.org/node/{i}') for i in range(1, count + 1)]
            city['recommendations'] = [dict(pick, placeId=p['id']) for p in city['places']]
            osm = [dict(type='node', id=i, lat=49.28, lon=-123.12,
                        tags={'name': f'Fixture photo place {i}', 'tourism': 'attraction'}) for i in range(1, count + 1)]
            if count == 51:
                with self.assertRaisesRegex(ValueError, 'CITY_RECOMMENDATIONS_NOT_VERIFIED'):
                    m.build_catalog(seed, osm, now)
            else:
                result = m.build_catalog(seed, osm, now)['cities']['vancouver']
                self.assertEqual([p['id'] for p in result['places']], [p['id'] for p in city['places']])
                self.assertEqual(result['recommendations'], city['recommendations'])

    def test_general_business_seed_cannot_publish_as_photo_recommendations(self):
        m = implementation(); seed, osm, now = self.fixture()
        seed.pop('recommendationTheme')
        with self.assertRaisesRegex(ValueError, 'PHOTO_SELECTION_REQUIRED'):
            m.build_catalog(seed, osm, now)

    def test_legacy_seed_does_not_spend_the_daily_collection(self):
        m = implementation(); seed = json.loads((ROOT/'src/lib/city-places.catalog.json').read_text())
        seed.pop('recommendationTheme')
        osm = [dict(type=p['id'].split(':')[1], id=int(p['id'].split(':')[2]), lat=p['latitude'], lon=p['longitude'], tags={'name':p['name']}) for city in seed['cities'].values() for p in city['places']]
        with tempfile.TemporaryDirectory() as target:
            path = Path(target)/'legacy.json'; path.write_text(json.dumps(seed))
            with patch.object(sys,'argv',['refresh-city-places.py','--seed',str(path),'--output',target]), patch.object(m,'current_catalog',return_value=None), patch.object(m,'collect',return_value={'elements':osm}) as collect:
                with self.assertRaisesRegex(ValueError, 'PHOTO_SELECTION_REQUIRED'):
                    m.main()
                collect.assert_not_called()

    def test_closed_private_and_renamed_places_leave_recommendations_but_keep_archived_links(self):
        m = implementation()
        for patch in [dict(disused='yes'), dict(access='private'), dict(name='Different Business')]:
            seed, osm, now = self.fixture(); osm[0]['tags'].update(patch)
            city = m.build_catalog(seed, osm, now)['cities']['vancouver']
            self.assertEqual(city['recommendations'], [])
            self.assertEqual(city['places'][0]['id'], 'osm:node:1')

    def test_reviewed_bridge_name_is_not_mistaken_for_a_renamed_road(self):
        m = implementation(); seed, osm, now = self.fixture()
        seed['cities']['vancouver']['places'][0]['name'] = 'Broadway Bridge'
        osm[0]['tags'] = {'name': 'Broadway Avenue', 'bridge': 'yes', 'bridge:name': 'Broadway Bridge'}
        city = m.build_catalog(seed, osm, now)['cities']['vancouver']
        self.assertEqual(len(city['recommendations']), 1)
        osm[0]['tags'].pop('bridge:name')
        self.assertEqual(m.build_catalog(seed, osm, now)['cities']['vancouver']['recommendations'], [])

    def test_invalid_or_empty_upstream_is_not_a_new_verified_snapshot(self):
        m = implementation(); seed, osm, now = self.fixture()
        with self.assertRaises(ValueError): m.build_catalog(seed, [], now)
        osm[0]['lat'] = float('nan')
        with self.assertRaises(ValueError): m.build_catalog(seed, osm, now)

    def test_foreign_identity_and_unsafe_recommendation_source_are_rejected(self):
        m = implementation()
        for change in [lambda c: c['places'][0].update(cityId='toronto'), lambda c: c['recommendations'][0].update(sourceUrl='javascript:alert(1)')]:
            seed, osm, now = self.fixture(); change(seed['cities']['vancouver'])
            with self.assertRaises(ValueError): m.build_catalog(seed, osm, now)

    def test_duplicate_or_unrequested_osm_rows_cannot_count_as_complete_collection(self):
        m = implementation()
        for malformed in ['duplicate','unrequested']:
            seed, osm, now = self.fixture()
            if malformed == 'duplicate': osm.append(dict(osm[0]))
            else: osm[0]['id'] = 999
            with self.assertRaises(ValueError): m.build_catalog(seed, osm, now)

    def test_missing_credentials_do_not_collect_or_leave_a_submission_marker(self):
        m = implementation()
        seed = json.loads((ROOT/'src/lib/city-places.catalog.json').read_text())
        elements = [dict(type=p['id'].split(':')[1], id=int(p['id'].split(':')[2]),lat=p['latitude'],lon=p['longitude'],tags={'name':p['name']}) for c in seed['cities'].values() for p in c['places']]
        with tempfile.TemporaryDirectory() as target, patch.object(sys,'argv',['refresh-city-places.py','--publish','--output',target]), patch.object(m,'current_catalog',return_value=None), patch.object(m,'collect',return_value={'elements':elements}) as collect, patch.object(m.subprocess,'run',return_value=SimpleNamespace(returncode=1,stdout='')):
            with self.assertRaises(ValueError): m.main()
            self.assertFalse((Path(target)/'attempt.json').exists())
            collect.assert_not_called()

    def test_daily_refresh_retains_verified_dining_photo_and_provider_metadata(self):
        m = implementation(); seed, osm, now = self.fixture()
        seed['cities']['vancouver']['diningRecommendations'] = seed['cities']['vancouver']['recommendations']
        seed['photoCatalog'] = {'cities': {'vancouver': [dict(placeId='osm:node:1', cityId='vancouver', uri='https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Fixture.jpg/960px-Fixture.jpg', sourceUrl='https://commons.wikimedia.org/wiki/File:Fixture.jpg', artist='Fixture photographer', license='CC BY 4.0', licenseUrl='https://creativecommons.org/licenses/by/4.0/', imageSha256='a'*64)]}}
        seed['externalRatings'] = [dict(cityId='vancouver', placeId='osm:node:1', placeName='Verified Cafe', provider='Google', score=4.7, scale=5, count=120, via='Wanderlog', sourceUrl='https://wanderlog.com/place/details/123', checkedAt='2026-10-17T10:00:00Z')]
        result = m.build_catalog(seed, osm, now)
        self.assertEqual(result['cities']['vancouver'].get('diningRecommendations'), seed['cities']['vancouver']['diningRecommendations'])
        self.assertEqual(result.get('photoCatalog'), seed['photoCatalog'])
        self.assertEqual(result.get('externalRatings'), seed['externalRatings'])
        osm[0]['tags']['disused'] = 'yes'
        self.assertEqual(m.build_catalog(seed, osm, now)['cities']['vancouver']['diningRecommendations'], [])

    def test_non_dining_supplement_and_unknown_photo_or_rating_identity_are_rejected(self):
        m = implementation()
        for kind in ['category', 'photo', 'rating']:
            seed, osm, now = self.fixture()
            if kind == 'category':
                seed['cities']['vancouver']['places'][0]['category'] = 'places'
                seed['cities']['vancouver']['diningRecommendations'] = seed['cities']['vancouver']['recommendations']
            elif kind == 'photo': seed['photoCatalog'] = {'cities': {'vancouver': [{'cityId':'vancouver','placeId':'osm:node:999'}]}}
            else: seed['externalRatings'] = [{'cityId':'vancouver','placeId':'osm:node:999'}]
            with self.assertRaises(ValueError): m.build_catalog(seed, osm, now)

    def test_old_seed_keeps_already_saved_server_photo_rating_and_newer_editorial_revision(self):
        m = implementation(); seed = json.loads((ROOT/'src/lib/city-places.catalog.json').read_text())
        previous = json.loads(json.dumps(seed)); previous['collectedAt']='2026-10-18T01:00:00Z'; previous['selectionRevision'] = seed.get('selectionRevision',0) + 1
        previous['photoCatalog']=json.loads((ROOT/'src/lib/city-places.photos.json').read_text())
        previous['externalRatings']=json.loads((ROOT/'src/lib/place-external-ratings.json').read_text())
        osm = [dict(type=p['id'].split(':')[1],id=int(p['id'].split(':')[2]),lat=p['latitude'],lon=p['longitude'],tags={'name':p['name']}) for city in seed['cities'].values() for p in city['places']]
        with tempfile.TemporaryDirectory() as target:
            path=Path(target)/'seed.json';path.write_text(json.dumps(seed))
            with patch.object(sys,'argv',['refresh-city-places.py','--seed',str(path),'--output',target]), patch.object(m,'current_catalog',return_value=previous), patch.object(m,'collect',return_value={'elements':osm}):m.main()
            result=json.loads(next(Path(target).glob('catalog-*.json')).read_text())
            self.assertEqual(result.get('selectionRevision'),previous['selectionRevision'])
            self.assertEqual(result.get('photoCatalog'),previous['photoCatalog'])
            self.assertEqual(result.get('externalRatings'),previous['externalRatings'])

if __name__ == '__main__': unittest.main()
