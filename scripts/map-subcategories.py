"""Map sub-filters (PLACE_SUBCATEGORIES in src/lib/discovery.ts) for catalog places, from each place's own OSM tags.

Read-only on the seed and Supabase: it writes a prepared file for review, and the daily publisher applies it later.
A place gets a sub-filter only when its OSM tags or OSM name say so; anything else stays unknown (owner 2026-11-05).
With --fitness it also finds the open cities' exercise places (the 운동 chip, owner 2026-11-12) by those same tags.
"""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path
import re
import ssl
import time
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from xml.parsers import expat

SEED = Path.home() / 'Library/Application Support/gling/operations/city-places/verified-seed.json'
OUT = Path('/Users/ash/Desktop/Git/unknown/output/reviews/map-subchips-2026-11-05')
FITNESS_OUT = Path('/Users/ash/Desktop/Git/unknown/output/reviews/map-fitness-2026-11-12')
API = 'https://api.openstreetmap.org/api/0.6/'
HEADERS = {'User-Agent': 'Gling-place-catalog/1.0'}
# Open cities: weekly city extract (Overpass refuses this Mac) and the municipality's OSM boundary relation.
FITNESS_CITIES = {'vancouver': ('Vancouver', 1852574), 'toronto': ('Toronto', 324211), 'montreal': ('Montreal', 1634158)}
EXTRACT = 'https://download.bbbike.org/osm/bbbike/{0}/{0}.osm.gz'
# Places to play a sport; a stadium is for watching one.
SPORT_PLACES = {'sports_centre', 'sports_hall', 'pitch', 'fitness_centre'}
# A pool, sauna or spa tag alone also covers private and adult-only venues, so these need a sign that the public can go in.
OPEN_ACCESS = {'yes', 'public', 'permissive', 'customers'}

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
    ('nightlife', 'karaoke', [(('amenity', {'karaoke_box'}),)]),
    ('nightlife', 'cocktail_bar', [(('bar', {'cocktail'}),), (('cocktails', {'yes'}),), (('drink:cocktail', {'yes', 'served'}),), (('name', r'cocktail'),)]),
    ('nightlife', 'wine_bar', [(('bar', {'wine'}),), (('amenity', {'wine_bar'}),), (('name', r'wine bar|bar [àa] vins?|enoteca|vinoteca'),)]),
    ('nightlife', 'pub', [(('amenity', {'pub', 'biergarten'}),)]),
    ('nightlife', 'club', [(('amenity', {'nightclub'}),)]),
    ('nightlife', 'bar', [(('amenity', {'bar'}),)]),
    ('nightlife', 'brewery', [(('craft', {'brewery'}),), (('microbrewery', {'yes'}),), (('industrial', {'brewery'}),), (('name', r'\bbrew(?:ing|ery|eries|house|pub)\b'),)]),
    ('nightlife', 'live_music', [(('amenity', {'music_venue'}),), (('leisure', {'music_venue'}),), (('live_music', {'yes'}),)]),
    # breakfast, speakeasy, sports_bar, jazz, happy_hour and matcha have no OSM tag to trust; they come from official sites.
    ('cafe', 'ice_cream', [(('amenity', {'ice_cream'}),), (('cuisine', {'ice_cream', 'gelato'}),)]),
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
    ('places', 'cinema', [(('amenity', {'cinema'}),)]),
    ('places', 'bowling', [(('leisure', {'bowling_alley'}),)]),
    ('places', 'arcade', [(('leisure', {'amusement_arcade'}),)]),
    ('places', 'escape_room', [(('leisure', {'escape_game'}),)]),
    ('fitness', 'running', [(('leisure', {'track'}), ('sport', {'running', 'athletics'})), (('route', {'running'}),)]),
    ('fitness', 'yoga_pilates', [(('leisure', SPORT_PLACES), ('sport', {'yoga', 'pilates'})), (('fitness_centre', {'yoga', 'pilates'}),)]),
    ('fitness', 'climbing', [(('leisure', SPORT_PLACES), ('sport', {'climbing', 'bouldering'}))]),
    ('fitness', 'swimming', [(('leisure', {'swimming_pool', 'water_park'}), ('access', OPEN_ACCESS)), (('leisure', {'swimming_pool', 'water_park'}), ('operator', None)),
                             (('leisure', SPORT_PLACES), ('sport', {'swimming'})), (('amenity', {'public_bath'}), ('sport', {'swimming'}))]),
    ('fitness', 'sauna_spa', [(('amenity', {'public_bath'}),), (('bath:type', None),), (('tourism', {'spa_resort'}),), (('leisure', {'sauna', 'spa'}), ('access', OPEN_ACCESS))]),
    ('fitness', 'golf', [(('leisure', {'golf_course'}),), (('golf', {'driving_range'}),), (('leisure', SPORT_PLACES), ('sport', {'golf'}))]),
    ('fitness', 'tennis_pickleball', [(('leisure', SPORT_PLACES), ('sport', {'tennis', 'pickleball'}))]),
    ('fitness', 'badminton', [(('leisure', SPORT_PLACES), ('sport', {'badminton'}))]),
    ('fitness', 'ice_rink', [(('leisure', {'ice_rink'}),), (('leisure', SPORT_PLACES), ('sport', {'ice_skating', 'ice_hockey'}))]),
    ('fitness', 'soccer', [(('leisure', SPORT_PLACES), ('sport', {'soccer', 'futsal'}))]),
    ('fitness', 'basketball', [(('leisure', SPORT_PLACES), ('sport', {'basketball'}))]),
    ('fitness', 'gym', [(('leisure', {'fitness_centre'}),), (('leisure', SPORT_PLACES), ('sport', {'fitness'})), (('amenity', {'gym'}),)]),
]
FITNESS = [ident for rule_chip, ident, _ in RULES if rule_chip == 'fitness']
FIELDS = ['places', 'regionalPlaces', 'extraPlaces', 'morePlaces', 'fitnessPlaces']
rows_of = lambda city: [place for field in FIELDS for place in city.get(field, [])]

def chip(place):
    """The map chip the app files this place under (placeCategory in src/lib/discovery.ts)."""
    if place.get('nightlife') is True: return 'nightlife'
    if place['category'] == 'places' and set(FITNESS) & set(place.get('subcategories') or []): return 'fitness'
    return {'food': 'dining', 'cafe': 'cafe', 'places': 'places'}[place['category']]

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
        sports = {v.strip().lower() for v in tags.get('sport', '').split(';')} - {''}
        # A climbing or yoga studio is not a gym; a community centre with sport=fitness among others is.
        if ident == 'gym' and found and 'fitness' not in sports: continue
        if ident == 'swimming' and tags.get('swimming_pool') == 'wading': continue
        if ident == 'sauna_spa' and 'swimming' in sports: continue  # Montréal's bains are pools
        if ident == 'ice_rink' and sports and sports <= {'curling'}: continue
        for test in tests:
            hits = [(key, holds(tags, key, want)) for key, want in test]
            if all(value is not None for _, value in hits):
                found.append((ident, '; '.join(f'{key}={value}' for key, value in hits)))
                break
    return found[:12]  # the app and publisher accept at most 12 per place

def fetch(kind, ids, context):
    url = f'{API}{kind}s.json?{kind}s=' + ','.join(ids)
    with urlopen(Request(url, headers=HEADERS), context=context, timeout=60) as response:
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

def apply(catalog, places):
    """Add each place's OSM values after the ones it already has (in memory), up to 12.
    Existing values stay: some come from official sites, not OSM, and a rerun must not erase them."""
    applied = 0
    for city in catalog['cities'].values():
        for place in rows_of(city):
            if place['id'] not in places: continue
            values = list(place.get('subcategories') or [])
            for ident in places[place['id']]['subcategories']:
                if ident not in values and len(values) < 12: values.append(ident)
            place['subcategories'] = values; applied += 1
    return applied

# --fitness: exercise places for the 운동 chip, found by the fitness RULES in each open city's OSM extract.
# A visitor cannot use school grounds or member clubs even when OSM leaves access out (owner brief 2026-11-12).
NOT_OPEN = re.compile(r'\b(?:school|[ée]cole|scolaire|secondary|elementary|collegiate|tdsb|tcdsb|cssdm)\b', re.I)
CLUB = re.compile(r'\bclub\b', re.I)  # a golf, tennis or curling club takes members, unless a public body runs it
PUBLIC = re.compile(r'\b(?:city of|park board|parks|ville de|municipal|community cent(?:re|er)|recreation)\b', re.I)
centre = lambda points: (sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)) if points else None

def download(url, path, context):
    """A cached copy of a weekly extract; delete the cache folder to fetch a newer one."""
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        part = path.with_name(path.name + '.part')
        with urlopen(Request(url, headers=HEADERS), context=context, timeout=600) as response, part.open('wb') as f:
            while chunk := response.read(1 << 20): f.write(chunk)
        part.rename(path)
    return path

def boundary(relation, cache, context):
    """The municipality's polygons as [[ring of (lon, lat)]], from Nominatim once (cached)."""
    path = cache / f'boundary-{relation}.json'
    if not path.exists():
        url = 'https://nominatim.openstreetmap.org/lookup?' + urlencode(dict(osm_ids=f'R{relation}', format='geojson', polygon_geojson=1))
        with urlopen(Request(url, headers=HEADERS), context=context, timeout=60) as response: path.write_bytes(response.read(50_000_000))
        time.sleep(1)  # Nominatim's limit is one request a second
    geometry = json.loads(path.read_text())['features'][0]['geometry']
    return geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]

def inside(point, polygons):
    """Even-odd ray test over every ring, so holes and separate pieces both count."""
    lat, lon, hit = point[0], point[1], False
    for ring in (ring for polygon in polygons for ring in polygon):
        for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
            if (y1 > lat) != (y2 > lat) and lon < x1 + (lat - y1) * (x2 - x1) / (y2 - y1): hit = not hit
    return hit

class _Done(Exception): pass

def scan_extract(path, pick):
    """One streaming pass over an OSM XML extract: [(kind, id, tags, (lat, lon) | node refs | None, pick(tags))] where pick is truthy."""
    hits, current = [], None
    def start(name, attrs):
        nonlocal current
        if name in ('node', 'way', 'relation'): current = (name, attrs, {}, [])
        elif current and name == 'tag': current[2][attrs['k']] = attrs['v']
        elif current and name == 'nd': current[3].append(attrs['ref'])
    def end(name):
        nonlocal current
        if name not in ('node', 'way', 'relation'): return
        kind, attrs, tags, refs = current
        value = tags and pick(tags)
        if value: hits.append((kind, int(attrs['id']), tags, (float(attrs['lat']), float(attrs['lon'])) if kind == 'node' else refs if kind == 'way' else None, value))
        current = None
    parser = expat.ParserCreate(); parser.StartElementHandler, parser.EndElementHandler = start, end
    with gzip.open(path, 'rb') as f: parser.ParseFile(f)
    return hits

def node_coordinates(path, ids):
    """{node id: (lat, lon)} for the given ids; an extract lists every node before the first way."""
    found = {}
    def start(name, attrs):
        if name == 'node' and attrs['id'] in ids: found[attrs['id']] = (float(attrs['lat']), float(attrs['lon']))
        elif name == 'way': raise _Done
    parser = expat.ParserCreate(); parser.StartElementHandler = start
    try:
        with gzip.open(path, 'rb') as f: parser.ParseFile(f)
    except _Done: pass
    return found

def relation_centre(number, cache, pause, context):
    """A relation's member nodes come from the OSM API (cached): the extract lists them before the relation."""
    path = cache / f'relation-{number}.json'
    if not path.exists():
        time.sleep(pause)
        try:
            with urlopen(Request(f'{API}relation/{number}/full.json', headers=HEADERS), context=context, timeout=60) as response: path.write_bytes(response.read(20_000_000))
        except HTTPError as error:
            if error.code not in (404, 410): raise
            return None
    return centre([(e['lat'], e['lon']) for e in json.loads(path.read_text())['elements'] if e.get('type') == 'node' and 'lat' in e])

def https(value):
    if not isinstance(value, str) or len(value) > 2500 or re.search(r'[\s\x00-\x1f\x7f]', value): return None
    u = urlsplit(value)
    return value if u.scheme == 'https' and u.hostname and not u.username and not u.password else None

def text(value, limit):
    return value if isinstance(value, str) and 0 < len(value) <= limit and not re.search(r'[\x00-\x1f\x7f]', value) else None

def score(tags):
    """Rank inside a sub-chip: public operators and notable (Wikidata) places first, then the ones with facts to show."""
    public = tags.get('operator:type') in ('public', 'government', 'community') or PUBLIC.search(tags.get('operator', ''))
    return 2 * bool(public) + 2 * ('wikidata' in tags) + bool(https(tags.get('website', tags.get('contact:website')))) + ('opening_hours' in tags) + ('addr:street' in tags)

def squared_metres(a, b):
    return ((a[0] - b[0]) * 110_540) ** 2 + ((a[1] - b[1]) * 111_320 * 0.68) ** 2  # cos(47°) is close enough for these cities

def find_fitness(seed, cache, per_chip, pause, context):
    """Named, open-to-visitors exercise places per open city, at most about per_chip per sub-chip, as catalog rows."""
    known = {place['id'] for city in seed['cities'].values() for place in rows_of(city)}
    chosen, report = {}, {}
    for city_id, (extract, relation) in FITNESS_CITIES.items():
        path = download(EXTRACT.format(extract), cache / f'{extract}.osm.gz', context)
        area = boundary(relation, cache, context)
        hits = scan_extract(path, lambda tags: 'name' in tags and subcategories(tags, 'fitness'))
        coords = node_coordinates(path, {ref for kind, _, _, where, _ in hits if kind == 'way' for ref in where})
        rows, excluded, left_out = [], {}, []
        for kind, number, tags, where, found in hits:
            ident, name = f'osm:{kind}:{number}', text(tags['name'], 300)
            # The same closed and private tests as refresh-city-places.py, so the publisher keeps what this adds.
            reason = ('in_catalog' if ident in known else 'bad_name' if not name
                      else 'closed' if any(tags.get(k) == 'yes' for k in ['disused', 'abandoned', 'demolished', 'closed']) or any(k.split(':')[0] in ('disused', 'abandoned', 'demolished') for k in tags) or tags.get('opening_hours') in ('closed', 'off')
                      else 'not_open' if tags.get('access') in ('private', 'no', 'members', 'permit') or tags.get('membership') == 'required' or NOT_OPEN.search(f"{name} {tags.get('operator', '')}")
                      or CLUB.search(name) and not PUBLIC.search(f"{name} {tags.get('operator', '')}")
                      else 'chain' if 'brand' in tags or 'brand:wikidata' in tags
                      # An arena or stadium is for watching a game, even when it also carries a rink or pitch tag (supervisor 2026-11-12).
                      else 'spectator' if tags.get('building') == 'stadium' or 'stadium' in tags else None)
            point = None if reason else where if kind == 'node' else centre([coords[r] for r in dict.fromkeys(where) if r in coords]) if kind == 'way' else relation_centre(number, cache, pause, context)
            reason = reason or ('no_location' if not point else 'outside_city' if not inside(point, area) else None)
            if reason:
                excluded[reason] = excluded.get(reason, 0) + 1
                if reason not in ('outside_city', 'in_catalog'): left_out.append(dict(id=ident, name=tags['name'], reason=reason, subcategories=[i for i, _ in found]))
                continue
            street, number_ = text(tags.get('addr:street'), 300), text(tags.get('addr:housenumber'), 300)
            rows.append(dict(id=ident, cityId=city_id, name=name, category='places', latitude=round(point[0], 7), longitude=round(point[1], 7),
                             address=f'{number_} {street}' if street and number_ else '', sourceUrl=f'https://www.openstreetmap.org/{kind}/{number}',
                             website=https(tags.get('website', tags.get('contact:website'))), openingHours=text(tags.get('opening_hours'), 1000),
                             subcategories=[i for i, _ in found], evidence=dict(found), score=score(tags)))
        rows.sort(key=lambda row: (-row['score'], row['id']))
        kept = []
        for row in rows:  # one pin per place: a centre and its pool, or courts split into several named ways
            here = (row['latitude'], row['longitude'])
            if any(squared_metres(here, (k['latitude'], k['longitude'])) < (500 ** 2 if k['name'].casefold() == row['name'].casefold() else 80 ** 2 if set(k['subcategories']) & set(row['subcategories']) else 0) for k in kept):
                excluded['duplicate'] = excluded.get('duplicate', 0) + 1; left_out.append(dict(id=row['id'], name=row['name'], reason='duplicate', subcategories=row['subcategories'])); continue
            kept.append(row)
        picked = []
        for ident in FITNESS:  # a place counts toward every sub-chip it carries
            have = sum(ident in row['subcategories'] for row in picked)
            for row in (row for row in kept if ident in row['subcategories'] and row not in picked):
                if have >= per_chip: break
                picked.append(row); have += 1
        chosen[city_id] = picked
        report[city_id] = dict(extract=dict(url=EXTRACT.format(extract), bytes=path.stat().st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest()),
                               boundaryRelation=relation, matched=len(hits), excluded=excluded, leftOut=left_out,
                               subChips={ident: dict(found=sum(ident in row['subcategories'] for row in kept), kept=sum(ident in row['subcategories'] for row in picked)) for ident in FITNESS},
                               places=len(picked))
    return chosen, report

def catalog_size(value):
    # private.city_place_catalog checks octet_length(payload::text); jsonb text puts a space after ',' and ':'.
    return dict(compact=len(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()),
                jsonbText=len(json.dumps(value, ensure_ascii=False, separators=(', ', ': ')).encode()))

def fitness_main(args, seed, raw, context):
    chosen, report = find_fitness(seed, args.output / 'osm', args.per_chip, args.pause, context)
    rows = {city_id: [{k: v for k, v in row.items() if k not in ('evidence', 'score')} for row in picked] for city_id, picked in chosen.items()}
    result = dict(generatedAt=datetime.now(timezone.utc).isoformat(), seedSha256=hashlib.sha256(raw).hexdigest(), source='OpenStreetMap city extracts (download.bbbike.org), municipal boundary from Nominatim',
                  license='ODbL-1.0', attribution='© OpenStreetMap contributors', rules='scripts/map-subcategories.py (fitness)', perChip=args.per_chip, cities=report, places=chosen)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'fitness-places.json').write_text(json.dumps(result, ensure_ascii=False, indent=1, sort_keys=True))
    summary = dict(perChip=args.per_chip, cities={city_id: dict(places=r['places'], excluded=r['excluded'], subChips=r['subChips']) for city_id, r in report.items()})
    if args.catalog:
        catalog = json.loads(args.catalog.read_text())
        before = catalog_size(catalog)
        for city_id, city_rows in rows.items(): catalog['cities'][city_id]['fitnessPlaces'] = city_rows
        summary['catalog'] = dict(path=str(args.catalog), collectedAt=catalog['collectedAt'], before=before, after=catalog_size(catalog), limit=2_000_000)
        # Simulator preview only: a newer collectedAt keeps the bundled copy ahead of the live one. Never commit it.
        catalog['collectedAt'] = datetime.now(timezone.utc).isoformat()
        (args.output / 'catalog-preview.json').write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')))
    if args.seed_copy:
        copy = deepcopy(seed)
        for city_id, city_rows in rows.items(): copy['cities'][city_id]['fitnessPlaces'] = city_rows
        # The operator replaces the seed with this copy atomically after review; this script never writes the seed.
        (args.output / 'seed-with-fitness.json').write_text(json.dumps(copy, ensure_ascii=False, indent=1))
    (args.output / 'fitness-counts.json').write_text(json.dumps(summary, ensure_ascii=False, indent=1, sort_keys=True))
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seed', type=Path, default=SEED)
    parser.add_argument('--output', type=Path, help=f'default {OUT}, or {FITNESS_OUT} with --fitness')
    parser.add_argument('--pause', type=float, default=1.5, help='seconds between OSM API calls')
    parser.add_argument('--catalog', type=Path, help='a published catalog: also measure the size change and write catalog-preview.json')
    parser.add_argument('--seed-copy', action='store_true', help='also write seed-with-subcategories.json (or seed-with-fitness.json) next to the output (never the seed itself)')
    parser.add_argument('--fitness', action='store_true', help='find exercise places for the 운동 chip instead of tagging catalog places')
    parser.add_argument('--per-chip', type=int, default=5, help='with --fitness: about this many places per city and sub-chip (the catalog has a 2 MB server limit)')
    args = parser.parse_args()
    args.output = args.output or (FITNESS_OUT if args.fitness else OUT)
    raw = args.seed.read_bytes()
    seed = json.loads(raw)
    cert = Path('/etc/ssl/cert.pem')
    context = ssl.create_default_context(cafile=str(cert) if cert.exists() else None)
    if args.fitness: return fitness_main(args, seed, raw, context)
    places, missing, counts = {}, [], {}
    for city_id, city in seed['cities'].items():
        rows = rows_of(city)
        if any(not re.fullmatch(r'osm:(node|way|relation):[1-9]\d*', p['id']) for p in rows): raise ValueError('INVALID_PLACE_IDENTITY')
        tags = city_tags(city_id, sorted({p['id'] for p in rows}), args.output / 'osm', args.pause, context)
        for place in rows:
            if place['id'] not in tags: missing.append(place['id']); continue
            place_chip = chip(place)
            found = subcategories(tags[place['id']], place_chip)
            for ident, _ in found:
                count = counts.setdefault(place_chip, {}).setdefault(ident, {'vancouver': 0, 'all': 0})
                count['all'] += 1
                if city_id == 'vancouver': count['vancouver'] += 1
            if found: places[place['id']] = dict(cityId=city_id, name=place['name'], chip=place_chip,
                                                subcategories=[ident for ident, _ in found], evidence=dict(found))
    total = sum(len(rows_of(c)) for c in seed['cities'].values())
    result = dict(generatedAt=datetime.now(timezone.utc).isoformat(), seedSha256=hashlib.sha256(raw).hexdigest(),
                  source='OpenStreetMap API 0.6 element tags', license='ODbL-1.0', attribution='© OpenStreetMap contributors',
                  rules='scripts/map-subcategories.py', placesChecked=total, placesWithValues=len(places), missingOsm=sorted(missing), places=places)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'subcategories.json').write_text(json.dumps(result, ensure_ascii=False, indent=1, sort_keys=True))
    summary = dict(placesChecked=total, placesWithValues=len(places), missingOsm=len(missing), counts=counts)
    if args.catalog:
        catalog = json.loads(args.catalog.read_text())
        before = catalog_size(catalog)
        applied = apply(catalog, places)
        after = catalog_size(catalog)
        summary['catalog'] = dict(path=str(args.catalog), collectedAt=catalog['collectedAt'], placesTagged=applied, before=before, after=after, limit=2_000_000)
        # Simulator preview only: a newer collectedAt keeps the bundled copy ahead of the live one. Never commit it.
        catalog['collectedAt'] = datetime.now(timezone.utc).isoformat()
        (args.output / 'catalog-preview.json').write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')))
    if args.seed_copy:
        summary['seedCopyTagged'] = apply(seed, places)
        # The operator replaces the seed with this copy atomically after review; this script never writes the seed.
        (args.output / 'seed-with-subcategories.json').write_text(json.dumps(seed, ensure_ascii=False, indent=1))
    (args.output / 'counts.json').write_text(json.dumps(summary, ensure_ascii=False, indent=1, sort_keys=True))
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))

if __name__ == '__main__':
    main()
