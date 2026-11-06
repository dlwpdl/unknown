"""Map sub-filters (PLACE_SUBCATEGORIES in src/lib/discovery.ts) for catalog places, from each place's own OSM tags.

Read-only on the seed and Supabase: it writes a prepared file for review, and the daily publisher applies it later.
A place gets a sub-filter only when its OSM tags or OSM name say so; anything else stays unknown (owner 2026-11-05).
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import ssl
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

SEED = Path.home() / 'Library/Application Support/gling/operations/city-places/verified-seed.json'
OUT = Path('/Users/ash/Desktop/Git/unknown/output/reviews/map-subchips-2026-11-05')
API = 'https://api.openstreetmap.org/api/0.6/'

# (map chip, sub-filter id, tests). A test is a tuple of (key, want) pairs that must all hold. want is a set of accepted
# values (a ';' list matches if any part is accepted), a regex (searched in the value), or None (present and not 'no').
RULES = [
    ('dining', 'korean', [(('cuisine', {'korean'}),)]),
    ('dining', 'japanese', [(('cuisine', {'japanese', 'sushi', 'ramen', 'udon', 'soba', 'izakaya', 'donburi', 'yakitori', 'tempura'}),)]),
    ('dining', 'chinese', [(('cuisine', {'chinese', 'dim_sum', 'cantonese', 'sichuan', 'szechuan', 'shanghainese', 'hunan'}),)]),
    ('dining', 'vietnamese', [(('cuisine', {'vietnamese', 'pho', 'banh_mi'}),)]),
    ('dining', 'thai', [(('cuisine', {'thai'}),)]),
    ('dining', 'indian', [(('cuisine', {'indian', 'south_indian', 'north_indian', 'punjabi'}),)]),
    ('dining', 'italian', [(('cuisine', {'italian', 'pasta'}),)]),
    ('dining', 'mexican', [(('cuisine', {'mexican', 'tex-mex', 'taco', 'tacos', 'burrito'}),)]),
    ('dining', 'burger', [(('cuisine', {'burger'}),)]),
    ('dining', 'pizza', [(('cuisine', {'pizza'}),)]),
    ('dining', 'seafood', [(('cuisine', {'seafood', 'fish', 'fish_and_chips', 'oyster'}),)]),
    ('dining', 'vegan', [(('cuisine', {'vegan'}),), (('diet:vegan', {'yes', 'only'}),)]),
    ('nightlife', 'izakaya', [(('cuisine', {'izakaya'}),), (('name', r'izakaya|居酒屋|이자카야'),), (('cuisine', {'japanese'}), ('amenity', {'bar', 'pub'}))]),
    ('nightlife', 'pocha', [(('name', r'\bpocha\b|pojangmacha|포차|포장마차'),)]),
    ('nightlife', 'cocktail_bar', [(('bar', {'cocktail'}),), (('cocktails', {'yes'}),), (('drink:cocktail', {'yes', 'served'}),), (('name', r'cocktail'),)]),
    ('nightlife', 'wine_bar', [(('bar', {'wine'}),), (('amenity', {'wine_bar'}),), (('name', r'wine bar|bar [àa] vins?|enoteca|vinoteca'),)]),
    ('nightlife', 'pub', [(('amenity', {'pub', 'biergarten'}),)]),
    ('nightlife', 'club', [(('amenity', {'nightclub'}),)]),
    ('nightlife', 'bar', [(('amenity', {'bar'}),)]),
    ('nightlife', 'brewery', [(('craft', {'brewery'}),), (('microbrewery', {'yes'}),), (('industrial', {'brewery'}),), (('name', r'\bbrew(?:ing|ery|eries|house|pub)\b'),)]),
    ('nightlife', 'live_music', [(('amenity', {'music_venue'}),), (('leisure', {'music_venue'}),), (('live_music', {'yes'}),)]),
    ('cafe', 'dessert', [(('cuisine', {'dessert', 'cake', 'donut', 'ice_cream', 'pastry', 'crepe', 'frozen_yogurt', 'waffle', 'gelato', 'chocolate'}),),
                         (('amenity', {'ice_cream'}),), (('shop', {'pastry', 'confectionery', 'chocolate'}),)]),
    ('cafe', 'brunch', [(('cuisine', {'breakfast', 'brunch', 'pancake'}),)]),
    ('cafe', 'bakery', [(('shop', {'bakery'}),), (('cuisine', {'bakery', 'bagel'}),)]),
    ('cafe', 'bubble_tea', [(('cuisine', {'bubble_tea'}),), (('name', r'bubble tea|\bboba\b|버블티'),)]),
    ('cafe', 'roastery', [(('craft', {'coffee_roaster'}),), (('cuisine', {'coffee_roaster'}),), (('name', r'\broast(?:ers?|ery|ing)\b'),)]),
    ('places', 'park', [(('leisure', {'park', 'nature_reserve', 'dog_park'}),), (('boundary', {'national_park', 'protected_area'}),)]),
    ('places', 'beach', [(('natural', {'beach'}),), (('leisure', {'beach_resort'}),)]),
    ('places', 'garden', [(('leisure', {'garden'}),), (('building', {'conservatory', 'greenhouse'}),)]),
    ('places', 'viewpoint', [(('tourism', {'viewpoint'}),), (('tower:type', {'observation'}),)]),
    ('places', 'trail', [(('route', {'hiking', 'foot', 'walking'}),), (('highway', {'path', 'footway', 'track', 'bridleway'}),)]),
    ('places', 'museum', [(('tourism', {'museum'}),), (('building', {'museum'}),)]),
    ('places', 'gallery', [(('tourism', {'gallery'}),), (('museum', {'art'}),)]),
    ('places', 'library', [(('amenity', {'library'}),)]),
    ('places', 'zoo_aquarium', [(('tourism', {'zoo', 'aquarium'}),), (('attraction', {'animal'}),)]),
    ('places', 'historic', [(('historic', None),), (('heritage', None),)]),
    ('places', 'market', [(('amenity', {'marketplace'}),)]),
    ('places', 'theatre', [(('amenity', {'theatre', 'concert_hall', 'music_venue'}),), (('building', {'theatre'}),)]),
]

def chip(place):
    """The map chip the app files this place under (discoveryPlace in src/lib/discovery.ts)."""
    return 'nightlife' if place.get('nightlife') is True else {'food': 'dining', 'cafe': 'cafe', 'places': 'places'}[place['category']]

def holds(tags, key, want):
    value = tags.get(key)
    if not isinstance(value, str) or not value.strip(): return None
    if want is None: return value if value.strip().lower() != 'no' else None
    if isinstance(want, str): return value if re.search(want, value, re.I) else None
    return next((part for part in (v.strip().lower() for v in value.split(';')) if part in want), None)

def subcategories(tags, place_chip):
    """[(id, evidence)] in RULES order; evidence is the tag that backs it, e.g. 'amenity=bar'."""
    found = []
    for rule_chip, ident, tests in RULES:
        if rule_chip != place_chip: continue
        # 미술관 is not 박물관 in Korean: an art museum is only a gallery.
        if ident == 'museum' and tags.get('museum') == 'art': continue
        for test in tests:
            hits = [(key, holds(tags, key, want)) for key, want in test]
            if all(value is not None for _, value in hits):
                found.append((ident, '; '.join(f'{key}={value}' for key, value in hits)))
                break
    return found[:12]  # the app and publisher accept at most 12 per place

def fetch(kind, ids, context):
    url = f'{API}{kind}s.json?{kind}s=' + ','.join(ids)
    with urlopen(Request(url, headers={'User-Agent': 'Gling-place-catalog/1.0'}), context=context, timeout=60) as response:
        return json.loads(response.read(20_000_000))['elements']

def city_tags(city_id, ids, cache, pause, context):
    """Tags per place id from the OSM API, batched by city; deleted or unknown ids are left out.
    The cache only fetches ids it has not seen (new places); delete the cache folder to re-read edited tags."""
    path = cache / f'{city_id}.json'
    tags = json.loads(path.read_text()) if path.exists() else {}
    grouped, wanted = {}, set(ids)
    for ident in ids:
        if ident in tags: continue
        _, kind, number = ident.split(':')
        grouped.setdefault(kind, []).append(number)
    for kind, numbers in grouped.items():
        for start in range(0, len(numbers), 100):
            batch = numbers[start:start + 100]
            try: rows = fetch(kind, batch, context)
            except HTTPError as error:
                if error.code not in (404, 410): raise
                rows = []
                for number in batch:  # one deleted or missing id fails the whole batch
                    time.sleep(pause)
                    try: rows += fetch(kind, [number], context)
                    except HTTPError as one:
                        if one.code not in (404, 410): raise
            for row in rows:
                ident = f"osm:{row.get('type')}:{row.get('id')}"
                if ident in wanted and row.get('visible', True) and isinstance(row.get('tags', {}), dict): tags[ident] = row.get('tags', {})
            time.sleep(pause)
    cache.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(tags, ensure_ascii=False, sort_keys=True))
    return tags

def apply(catalog, places, checked):
    """Set each checked place's values in a catalog or seed (in memory); a checked place with none loses stale ones."""
    applied = 0
    for city in catalog['cities'].values():
        for field in ['places', 'regionalPlaces', 'extraPlaces']:
            for place in city.get(field, []):
                if place['id'] in places: place['subcategories'] = places[place['id']]['subcategories']; applied += 1
                elif place['id'] in checked: place.pop('subcategories', None)
    return applied

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seed', type=Path, default=SEED)
    parser.add_argument('--output', type=Path, default=OUT)
    parser.add_argument('--pause', type=float, default=1.5, help='seconds between OSM API calls')
    parser.add_argument('--catalog', type=Path, help='a published catalog: also measure the size change and write catalog-preview.json')
    parser.add_argument('--seed-copy', action='store_true', help='also write seed-with-subcategories.json next to the output (never the seed itself)')
    args = parser.parse_args()
    raw = args.seed.read_bytes()
    seed = json.loads(raw)
    cert = Path('/etc/ssl/cert.pem')
    context = ssl.create_default_context(cafile=str(cert) if cert.exists() else None)
    places, missing, counts, checked = {}, [], {}, set()
    for city_id, city in seed['cities'].items():
        rows = [*city['places'], *city.get('regionalPlaces', []), *city.get('extraPlaces', [])]
        if any(not re.fullmatch(r'osm:(node|way|relation):[1-9]\d*', p['id']) for p in rows): raise ValueError('INVALID_PLACE_IDENTITY')
        tags = city_tags(city_id, sorted({p['id'] for p in rows}), args.output / 'osm', args.pause, context)
        for place in rows:
            if place['id'] not in tags: missing.append(place['id']); continue
            checked.add(place['id'])
            place_chip = chip(place)
            found = subcategories(tags[place['id']], place_chip)
            for ident, _ in found:
                count = counts.setdefault(place_chip, {}).setdefault(ident, {'vancouver': 0, 'all': 0})
                count['all'] += 1
                if city_id == 'vancouver': count['vancouver'] += 1
            if found: places[place['id']] = dict(cityId=city_id, name=place['name'], chip=place_chip,
                                                subcategories=[ident for ident, _ in found], evidence=dict(found))
    total = sum(len([*c['places'], *c.get('regionalPlaces', []), *c.get('extraPlaces', [])]) for c in seed['cities'].values())
    result = dict(generatedAt=datetime.now(timezone.utc).isoformat(), seedSha256=hashlib.sha256(raw).hexdigest(),
                  source='OpenStreetMap API 0.6 element tags', license='ODbL-1.0', attribution='© OpenStreetMap contributors',
                  rules='scripts/map-subcategories.py', placesChecked=total, placesWithValues=len(places), missingOsm=sorted(missing), places=places)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'subcategories.json').write_text(json.dumps(result, ensure_ascii=False, indent=1, sort_keys=True))
    summary = dict(placesChecked=total, placesWithValues=len(places), missingOsm=len(missing), counts=counts)
    if args.catalog:
        catalog = json.loads(args.catalog.read_text())
        size = lambda value: dict(compact=len(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()),
                                  # private.city_place_catalog checks octet_length(payload::text); jsonb text puts a space after ',' and ':'.
                                  jsonbText=len(json.dumps(value, ensure_ascii=False, separators=(', ', ': ')).encode()))
        before = size(catalog)
        applied = apply(catalog, places, checked)
        after = size(catalog)
        summary['catalog'] = dict(path=str(args.catalog), collectedAt=catalog['collectedAt'], placesTagged=applied, before=before, after=after, limit=2_000_000)
        # Simulator preview only: a newer collectedAt keeps the bundled copy ahead of the live one. Never commit it.
        catalog['collectedAt'] = datetime.now(timezone.utc).isoformat()
        (args.output / 'catalog-preview.json').write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')))
    if args.seed_copy:
        summary['seedCopyTagged'] = apply(seed, places, checked)
        # The operator replaces the seed with this copy atomically after review; this script never writes the seed.
        (args.output / 'seed-with-subcategories.json').write_text(json.dumps(seed, ensure_ascii=False, indent=1))
    (args.output / 'counts.json').write_text(json.dumps(summary, ensure_ascii=False, indent=1, sort_keys=True))
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))

if __name__ == '__main__':
    main()
