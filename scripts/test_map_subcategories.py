import importlib.util
import re
import unittest
from pathlib import Path

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

if __name__ == '__main__':
    unittest.main()
