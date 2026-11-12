import gzip
import importlib.util
import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('map_subcategories', ROOT / 'scripts/map-subcategories.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class MapSubcategories(unittest.TestCase):
    def ids(self, tags, chip): return [ident for ident, _ in m.subcategories(tags, chip)]

    def test_owner_examples_come_from_the_places_own_tags(self):
        self.assertEqual(m.subcategories({'leisure': 'park'}, 'places'), [('park', 'leisure=park')])
        self.assertEqual(self.ids({'amenity': 'library'}, 'places'), ['library'])
        self.assertEqual(self.ids({'tourism': 'museum'}, 'places'), ['museum'])
        self.assertEqual(self.ids({'amenity': 'nightclub'}, 'nightlife'), ['club'])
        self.assertEqual(self.ids({'amenity': 'pub'}, 'nightlife'), ['pub'])
        self.assertEqual(self.ids({'amenity': 'bar', 'cuisine': 'japanese;sushi'}, 'nightlife'), ['izakaya', 'bar'])
        self.assertEqual(m.subcategories({'amenity': 'restaurant', 'name': 'Guu Izakaya'}, 'nightlife'), [('izakaya', 'name=Guu Izakaya')])

    def test_nothing_is_guessed(self):
        self.assertEqual(self.ids({}, 'places'), [])
        self.assertEqual(self.ids({'amenity': 'restaurant', 'name': 'Sushi Bar'}, 'dining'), [], 'a name alone never sets a cuisine')
        self.assertEqual(self.ids({'cuisine': 'japanese'}, 'dining'), ['japanese'])
        self.assertEqual(self.ids({'amenity': 'restaurant', 'cuisine': 'japanese'}, 'nightlife'), [], 'a Japanese restaurant is not an izakaya')
        self.assertEqual(self.ids({'historic': 'no'}, 'places'), [])
        self.assertEqual(self.ids({'diet:vegan': 'no'}, 'dining'), [])
        self.assertEqual(self.ids({'name': 'Bartholomew'}, 'nightlife'), [])

    def test_only_the_chip_the_app_shows_the_place_under(self):
        self.assertEqual(self.ids({'amenity': 'bar'}, 'dining'), [])
        self.assertEqual(self.ids({'cuisine': 'korean'}, 'nightlife'), [])
        self.assertEqual(m.chip({'category': 'food', 'nightlife': True}), 'nightlife')
        self.assertEqual(m.chip({'category': 'food'}), 'dining')
        self.assertEqual(m.chip({'category': 'places'}), 'places')

    def test_art_museums_are_galleries_and_lists_match_any_part(self):
        self.assertEqual(self.ids({'tourism': 'museum', 'museum': 'art'}, 'places'), ['gallery'])
        self.assertEqual(self.ids({'tourism': 'museum', 'museum': 'history', 'historic': 'building'}, 'places'), ['museum', 'historic'])
        self.assertEqual(self.ids({'cuisine': 'burger; Pizza'}, 'dining'), ['burger', 'pizza'])

    def test_ice_cream_and_karaoke_come_only_from_their_own_tags(self):
        self.assertEqual(self.ids({'amenity': 'ice_cream'}, 'cafe'), ['ice_cream', 'dessert'])
        self.assertEqual(self.ids({'cuisine': 'gelato'}, 'cafe'), ['ice_cream', 'dessert'])
        self.assertEqual(self.ids({'cuisine': 'cake'}, 'cafe'), ['dessert'])
        self.assertEqual(self.ids({'amenity': 'karaoke_box'}, 'nightlife'), ['karaoke'])
        self.assertEqual(self.ids({'amenity': 'bar', 'name': 'Karaoke Night'}, 'nightlife'), ['bar'], 'a name alone is not a karaoke box')

    def test_leisure_chips_come_from_their_osm_tags(self):
        self.assertEqual(self.ids({'amenity': 'cinema'}, 'places'), ['cinema'])
        self.assertEqual(self.ids({'leisure': 'bowling_alley'}, 'places'), ['bowling'])
        self.assertEqual(self.ids({'leisure': 'amusement_arcade'}, 'places'), ['arcade'])
        self.assertEqual(self.ids({'leisure': 'escape_game'}, 'places'), ['escape_room'])
        self.assertEqual(self.ids({'amenity': 'theatre'}, 'places'), ['theatre'], 'a stage theatre is not a cinema')

    def test_apply_keeps_existing_values_and_only_adds_new_ones(self):
        rows = [{'id': 'a', 'subcategories': ['korean']}, {'id': 'b', 'subcategories': ['cocktail_bar']}, {'id': 'c'},
                {'id': 'd', 'subcategories': [f'v{n}' for n in range(12)]}, {'id': 'e', 'subcategories': ['korean']}]
        catalog = {'cities': {'vancouver': {'places': rows}}}
        found = {'b': {'subcategories': ['cocktail_bar', 'bar']}, 'c': {'subcategories': ['park']}, 'd': {'subcategories': ['bar']}}
        self.assertEqual(m.apply(catalog, found), 3)
        self.assertEqual([row.get('subcategories') for row in rows],
                         [['korean'], ['cocktail_bar', 'bar'], ['park'], [f'v{n}' for n in range(12)], ['korean']],
                         'official-site values survive a rerun with no or different OSM values; never more than 12')

    def test_every_rule_id_is_an_app_sub_filter_under_the_same_chip(self):
        source = (ROOT / 'src/lib/discovery.ts').read_text()
        block = source[source.index('export const PLACE_SUBCATEGORIES'):source.index('] as const;', source.index('export const PLACE_SUBCATEGORIES'))]
        app = set(re.findall(r"\{ id: '(\w+)', filter: '(\w+)'", block))
        for chip, ident, _ in m.RULES: self.assertIn((ident, chip), app)
        self.assertEqual(len({ident for _, ident, _ in m.RULES}), len(m.RULES))

    def test_exercise_places_get_their_sub_chip_from_their_own_tags(self):
        self.assertEqual(self.ids({'leisure': 'fitness_centre'}, 'fitness'), ['gym'])
        self.assertEqual(self.ids({'leisure': 'fitness_centre', 'sport': 'yoga'}, 'fitness'), ['yoga_pilates'], 'a yoga studio is not a gym')
        self.assertEqual(self.ids({'leisure': 'sports_centre', 'sport': 'climbing'}, 'fitness'), ['climbing'])
        self.assertEqual(self.ids({'leisure': 'sports_centre', 'sport': 'swimming;fitness;basketball'}, 'fitness'), ['swimming', 'basketball', 'gym'])
        self.assertEqual(self.ids({'leisure': 'pitch', 'sport': 'tennis;pickleball'}, 'fitness'), ['tennis_pickleball'])
        self.assertEqual(self.ids({'leisure': 'ice_rink'}, 'fitness'), ['ice_rink'])
        self.assertEqual(self.ids({'amenity': 'public_bath'}, 'fitness'), ['sauna_spa'])
        self.assertEqual(self.ids({'leisure': 'track', 'sport': 'athletics'}, 'fitness'), ['running'])
        self.assertEqual(self.ids({'leisure': 'swimming_pool', 'access': 'yes', 'swimming_pool': 'wading'}, 'fitness'), [], 'a wading pool is not for swimming')
        self.assertEqual(self.ids({'leisure': 'swimming_pool'}, 'fitness'), [], 'a pool needs a sign the public can use it')
        self.assertEqual(self.ids({'leisure': 'swimming_pool', 'operator': 'Park Board'}, 'fitness'), ['swimming'])
        self.assertEqual(self.ids({'leisure': 'sauna'}, 'fitness'), [], 'a sauna tag alone also covers private and adult-only venues')
        self.assertEqual(self.ids({'leisure': 'sauna', 'access': 'customers'}, 'fitness'), ['sauna_spa'])
        self.assertEqual(self.ids({'amenity': 'public_bath', 'sport': 'swimming'}, 'fitness'), ['swimming'], 'a Montréal bain is a pool')
        self.assertEqual(self.ids({'leisure': 'stadium', 'sport': 'soccer'}, 'fitness'), [], 'a stadium is for watching')
        self.assertEqual(self.ids({'leisure': 'ice_rink', 'sport': 'curling'}, 'fitness'), [], 'a curling sheet is not a skating rink')
        self.assertEqual(self.ids({'leisure': 'miniature_golf'}, 'fitness'), [])
        self.assertEqual(self.ids({'sport': 'soccer'}, 'fitness'), [], 'a sport needs a place to play it')
        self.assertEqual(self.ids({'leisure': 'fitness_centre'}, 'places'), [], 'fitness rules only fill the 운동 chip')
        self.assertEqual(m.chip({'category': 'places', 'subcategories': ['park', 'gym']}), 'fitness')

    def test_fitness_import_keeps_named_open_places_inside_the_city_and_caps_each_sub_chip(self):
        nodes = [  # (id, lat, lon, tags)
            (1, 0.5, 0.5, {'name': 'Public Gym', 'leisure': 'fitness_centre', 'operator': 'City of Fixture', 'website': 'https://gym.example'}),
            (2, 0.51, 0.5, {'name': 'Second Gym', 'leisure': 'fitness_centre', 'website': 'http://insecure.example'}),
            (3, 0.52, 0.5, {'name': 'Third Gym', 'leisure': 'fitness_centre'}),
            (4, 0.53, 0.5, {'name': 'Members Gym', 'leisure': 'fitness_centre', 'access': 'members'}),
            (5, 0.54, 0.5, {'name': 'Chain Gym', 'leisure': 'fitness_centre', 'brand': 'Chain'}),
            (6, 0.55, 0.5, {'name': 'Fixture Secondary School Pool', 'leisure': 'swimming_pool', 'access': 'yes'}),
            (14, 0.59, 0.5, {'name': 'Fixture Golf Club', 'leisure': 'golf_course'}),
            (15, 0.59, 0.52, {'name': 'Fixture Municipal Golf Club', 'leisure': 'golf_course', 'operator': 'City of Fixture'}),
            (16, 0.4, 0.4, {'name': 'Fixture Stadium', 'leisure': 'stadium', 'sport': 'soccer'}),
            (17, 0.4, 0.45, {'name': 'Fixture Arena', 'leisure': 'ice_rink', 'building': 'stadium'}),
            (7, 5.0, 5.0, {'name': 'Far Gym', 'leisure': 'fitness_centre'}),
            (8, 0.56, 0.5, {'leisure': 'fitness_centre'}),
            (9, 0.57, 0.5, {'name': 'Closed Gym', 'leisure': 'fitness_centre', 'disused': 'yes'}),
            (10, 0.58, 0.5, {'name': 'Catalog Gym', 'leisure': 'fitness_centre'}),
            (11, 0.6, 0.6, {}), (12, 0.6, 0.61, {}), (13, 0.61, 0.61, {}),
        ]
        xml = ['<?xml version="1.0"?><osm>']
        for ident, lat, lon, tags in nodes:
            xml.append(f'<node id="{ident}" lat="{lat}" lon="{lon}">' + ''.join(f'<tag k="{k}" v="{v}"/>' for k, v in tags.items()) + '</node>')
        xml.append('<way id="20"><nd ref="11"/><nd ref="12"/><nd ref="13"/><nd ref="11"/><tag k="name" v="Court Way"/><tag k="leisure" v="pitch"/><tag k="sport" v="tennis"/></way>')
        xml.append('<way id="21"><nd ref="11"/><nd ref="12"/><tag k="name" v="Court Way"/><tag k="leisure" v="pitch"/><tag k="sport" v="tennis"/></way></osm>')
        seed = {'cities': {'fixture': {'places': [{'id': 'osm:node:10'}]}}}
        with tempfile.TemporaryDirectory() as folder, patch.object(m, 'FITNESS_CITIES', {'fixture': ('Fixture', 1)}), patch.object(m, 'urlopen', side_effect=AssertionError('no network')):
            cache = Path(folder)
            with gzip.open(cache / 'Fixture.osm.gz', 'wt') as f: f.write(''.join(xml))
            square = [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]
            (cache / 'boundary-1.json').write_text(json.dumps({'features': [{'geometry': {'type': 'Polygon', 'coordinates': square}}]}))
            chosen, report = m.find_fitness(seed, cache, 2, 0, None)
        rows = chosen['fixture']
        self.assertEqual([row['name'] for row in rows], ['Fixture Municipal Golf Club', 'Court Way', 'Public Gym', 'Second Gym'], 'a public club stays, one pin for the split courts, two gyms, public first')
        self.assertEqual((rows[2]['website'], rows[3]['website']), ('https://gym.example', None), 'only https links')
        court = rows[1]
        self.assertEqual((court['id'], court['sourceUrl'], court['category'], court['subcategories']), ('osm:way:20', 'https://www.openstreetmap.org/way/20', 'places', ['tennis_pickleball']))
        self.assertAlmostEqual(court['latitude'], 0.6033333, places=6)
        self.assertEqual(report['fixture']['excluded'], {'not_open': 3, 'chain': 1, 'outside_city': 1, 'closed': 1, 'in_catalog': 1, 'duplicate': 1, 'spectator': 1},
                         'the stadium never matches a sub-chip and the arena is left out')
        self.assertNotIn('Fixture Stadium', [row['name'] for row in report['fixture']['leftOut']])
        self.assertEqual({row['name'] for row in report['fixture']['leftOut'] if row['reason'] == 'not_open'}, {'Members Gym', 'Fixture Secondary School Pool', 'Fixture Golf Club'})
        self.assertEqual(report['fixture']['subChips']['gym'], {'found': 3, 'kept': 2})

if __name__ == '__main__':
    unittest.main()
