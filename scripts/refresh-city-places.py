"""Refresh reviewed OSM identities once daily; publish only with --publish."""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import ssl
import subprocess
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
PROJECT = 'wjvahbdwmctzpkndqaxa'

def https(value):
    if not isinstance(value, str) or len(value) > 2500: return False
    u = urlsplit(value)
    return u.scheme == 'https' and bool(u.hostname) and not u.username and not u.password

def instant(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))

def day(value):
    return instant(value).astimezone(ZoneInfo('America/Vancouver')).date().isoformat()

def build_catalog(seed, elements, now):
    if seed.get('recommendationTheme') != 'photo-spots': raise ValueError('PHOTO_SELECTION_REQUIRED')
    if not elements: raise ValueError('EMPTY_OSM_RESPONSE')
    expected = {p['id'] for city in seed['cities'].values() for p in city['places']}
    indexed = {}
    for element in elements:
        if not isinstance(element, dict): raise ValueError('INVALID_OSM_RESPONSE')
        ident = f"osm:{element.get('type')}:{element.get('id')}"
        if ident not in expected or ident in indexed: raise ValueError('UNEXPECTED_OSM_IDENTITY')
        indexed[ident] = element
    # shortcut: drops over 20% require review, revise after a confirmed bulk OSM cleanup.
    if len(indexed) < len(expected) * 0.8: raise ValueError('INCOMPLETE_OSM_RESPONSE')
    result = dict(collectedAt=now, recommendationTheme='photo-spots', source='OpenStreetMap; source-reviewed Gling photo spots', license='ODbL-1.0',
                  attribution='© OpenStreetMap contributors', attributionUrl='https://www.openstreetmap.org/copyright', cities={})
    for city_id, city in seed['cities'].items():
        places, eligible = [], set()
        for original in city['places']:
            ident = original['id']
            if not re.fullmatch(r'osm:(node|way|relation):[1-9]\d*', ident) or original['cityId'] != city_id: raise ValueError('INVALID_PLACE_IDENTITY')
            p = {k: original.get(k) for k in ['id','cityId','name','category','latitude','longitude','address','sourceUrl','website','openingHours']}
            if p['sourceUrl'] != 'https://www.openstreetmap.org/' + '/'.join(ident.split(':')[1:]): raise ValueError('INVALID_PLACE_SOURCE')
            if not isinstance(p['name'], str) or not 0 < len(p['name']) <= 300 or re.search(r'[\x00-\x1f\x7f]', p['name']) or p['category'] not in ['food','cafe','places'] or not isinstance(p['address'], str) or len(p['address']) > 1000: raise ValueError('INVALID_PLACE_RECORD')
            if p['website'] is not None and not https(p['website']): raise ValueError('INVALID_PLACE_WEBSITE')
            if p['openingHours'] is not None and (not isinstance(p['openingHours'], str) or not 0 < len(p['openingHours']) <= 1000): raise ValueError('INVALID_PLACE_HOURS')
            if not all(isinstance(p[k], (int,float)) and math.isfinite(p[k]) for k in ['latitude','longitude']) or not (40 <= p['latitude'] <= 85 and -142 <= p['longitude'] <= -52): raise ValueError('INVALID_PLACE_LOCATION')
            e = indexed.get(ident)
            if e:
                center, tags = e.get('center', e), e.get('tags', {})
                lat, lon = center.get('lat'), center.get('lon')
                if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in [lat, lon]) or not (40 <= lat <= 85 and -142 <= lon <= -52): raise ValueError('INVALID_PLACE_LOCATION')
                p.update(latitude=lat, longitude=lon)
                hours = tags.get('opening_hours')
                if isinstance(hours, str) and 0 < len(hours) <= 1000 and not re.search(r'[\x00-\x1f\x7f]', hours): p['openingHours'] = hours
                website = tags.get('website', tags.get('contact:website'))
                if https(website): p['website'] = website
                street, number = tags.get('addr:street'), tags.get('addr:housenumber')
                if all(isinstance(v, str) and 0 < len(v) <= 300 and not re.search(r'[\x00-\x1f\x7f]', v) for v in [street, number]):
                    p['address'] = (number+' '+street)[:1000]
                closed = any(tags.get(k) == 'yes' for k in ['disused','abandoned','demolished','closed']) or any(k in tags for k in ['disused:amenity','abandoned:amenity','demolished:amenity'])
                names = [tags.get(k) for k in ['name','name:en','name:fr','official_name','brand']]
                if tags.get('bridge') == 'yes': names.append(tags.get('bridge:name'))
                renamed = p['name'].casefold() not in [v.casefold() for v in names if isinstance(v, str)]
                if not closed and not renamed and tags.get('access') not in ['private','no'] and hours not in ['closed','off']: eligible.add(ident)
            places.append(p)
        if len({p['id'] for p in places}) != len(places) or not places or len(places) > 200: raise ValueError('INVALID_PLACE_CATALOG')
        picks = city.get('recommendations')
        if not isinstance(picks, list) or len(picks) > 25: raise ValueError('CITY_RECOMMENDATIONS_NOT_VERIFIED')
        reviewed, selected = [], set()
        for pick in picks:
            if pick['placeId'] not in {p['id'] for p in places} or pick['placeId'] in selected or not https(pick['sourceUrl']) or not isinstance(pick['reason'], str) or not 0 < len(pick['reason']) <= 500: raise ValueError('INVALID_PLACE_RECOMMENDATION')
            checked = instant(pick['verifiedAt'])
            if checked.tzinfo is None or checked > instant(now): raise ValueError('INVALID_PLACE_REVIEW_DATE')
            selected.add(pick['placeId'])
            if pick['placeId'] in eligible and (instant(now) - checked).days <= 90:
                selected_pick = {k: pick[k] for k in ['placeId','reason','sourceUrl','verifiedAt']}
                if 'reasonEn' in pick:
                    if not isinstance(pick['reasonEn'], str) or not 0 < len(pick['reasonEn']) <= 500: raise ValueError('INVALID_PLACE_RECOMMENDATION')
                    selected_pick['reasonEn'] = pick['reasonEn']
                reviewed.append(selected_pick)
        result['cities'][city_id] = dict(coverage=city['coverage'], places=places, recommendations=reviewed)
    return result

def http(url, body, headers):
    cert = Path('/etc/ssl/cert.pem')
    context = ssl.create_default_context(cafile=str(cert) if cert.exists() else None)
    with urlopen(Request(url, data=body, headers=headers, method='POST'), context=context, timeout=60) as response:
        raw = response.read(2_000_001)
    if len(raw) > 2_000_000: raise ValueError('PLACE_RESPONSE_TOO_LARGE')
    return json.loads(raw)

def current_catalog():
    from admin_merchant_gateway import configuration
    origin, key = configuration()
    return http(origin + '/rest/v1/rpc/get_city_place_catalog', b'{}', {'Content-Type':'application/json', 'apikey':key})

def collect(seed):
    grouped = {kind:[] for kind in ['node','way','relation']}
    for city in seed['cities'].values():
        for p in city['places']:
            match = re.fullmatch(r'osm:(node|way|relation):([1-9]\d*)', p['id'])
            if not match: raise ValueError('INVALID_PLACE_IDENTITY')
            grouped[match[1]].append(match[2])
    query = '[out:json][timeout:45][maxsize:16777216];(' + ''.join(kind+'(id:'+','.join(ids)+');' for kind, ids in grouped.items() if ids) + ');out body center;'
    response = http('https://overpass-api.de/api/interpreter', urlencode({'data':query}).encode(), {'User-Agent':'Gling-place-catalog/1.0','Content-Type':'application/x-www-form-urlencoded'})
    if response.get('remark') or not isinstance(response.get('elements'), list): raise ValueError('INVALID_OSM_RESPONSE')
    return response

def operations_token():
    # Reuse the existing city-operations Keychain credential; never expose it in argv or logs.
    key = subprocess.run(['security','find-generic-password','-s','Supabase CLI','-w'], capture_output=True, text=True, timeout=10)
    if key.returncode or not key.stdout.strip(): raise ValueError('SUPABASE_CONNECTION_REQUIRED')
    return key.stdout.strip()

def publish(payload, token=None):
    token = token or operations_token()
    body = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    tag = '$city_' + hashlib.sha256(body.encode()).hexdigest()[:16] + '$'
    if tag in body: raise ValueError('INVALID_PLACE_PAYLOAD')
    query = f"""insert into private.city_place_catalog as current(id,payload,refreshed_on)
      values(true,{tag}{body}{tag}::jsonb,(now() at time zone 'America/Vancouver')::date)
      on conflict(id) do update set payload=excluded.payload,refreshed_on=excluded.refreshed_on,updated_at=now()
      where current.refreshed_on < excluded.refreshed_on returning refreshed_on;"""
    return http(f'https://api.supabase.com/v1/projects/{PROJECT}/database/query', json.dumps({'query':query}).encode(), {'Content-Type':'application/json','Authorization':'Bearer '+token})

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seed', type=Path, default=ROOT/'src/lib/city-places.catalog.json')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    now = datetime.now(timezone.utc).isoformat()
    out = args.output or Path.home()/'Library/Application Support/gling/operations/city-places'/day(now)
    out.mkdir(parents=True, exist_ok=True)
    previous = None
    try: previous = current_catalog()
    except Exception:
        if args.publish: raise ValueError('PLACE_CATALOG_NOT_AVAILABLE') from None
    if previous and day(previous['collectedAt']) >= day(now):
        print(json.dumps({'status':'already_refreshed','day':day(now)})); return
    if args.publish and (out/'attempt.json').exists(): raise ValueError('PLACE_PUBLICATION_NEEDS_READBACK')
    seed = json.loads(args.seed.read_text())
    if seed.get('recommendationTheme') != 'photo-spots': raise ValueError('PHOTO_SELECTION_REQUIRED')
    baseline = json.loads((ROOT/'src/lib/city-places.catalog.json').read_text())
    if set(seed['cities']) != set(baseline['cities']): raise ValueError('INVALID_PLACE_CITIES')
    # Retain older identities that already have detail/review links.
    if previous:
        seed = deepcopy(seed)
        for city_id, city in seed['cities'].items():
            known = {p['id'] for p in city['places']}
            city['places'] += [p for p in previous['cities'][city_id]['places'] if p['id'] not in known]
    token = operations_token() if args.publish else None
    response = collect(seed)
    upstream = json.dumps(response, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
    upstream_sha = hashlib.sha256(upstream).hexdigest()
    (out/f'osm-{upstream_sha}.json').write_bytes(upstream)
    payload = build_catalog(seed, response['elements'], now)
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
    digest = hashlib.sha256(raw).hexdigest()
    path = out/f'catalog-{digest}.json'; path.write_bytes(raw)
    result = dict(status='prepared', day=day(now), payload_sha256=digest, path=str(path), upstream_json_sha256=upstream_sha, places=sum(len(c['places']) for c in payload['cities'].values()), recommendations=sum(len(c['recommendations']) for c in payload['cities'].values()))
    if args.publish:
        with (out/'attempt.json').open('x') as f: json.dump(result, f)
        try: publish(payload, token)
        except Exception: pass  # Read the actual row before deciding whether a timed-out write succeeded.
        saved = current_catalog()
        if saved != payload: raise ValueError('PLACE_PUBLICATION_NOT_VERIFIED')
        result['status'] = 'published_and_read_back'
    (out/'result.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result))

if __name__ == '__main__':
    try: main()
    except Exception as error:
        code = str(error)
        print(json.dumps({'status':'failed','error':code if re.fullmatch('[A-Z_]{3,80}', code) else type(error).__name__}))
        raise SystemExit(1)
