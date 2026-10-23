#!/usr/bin/env python3
"""Resolve Commons file titles into catalogue photo rows for /tmp review.

Usage: python3 -I scripts/photo-source-commons.py pairs.json
pairs.json: [{"cityId","placeId","placeName","file":"File:..."}]. Writes /tmp/commons-rows.json.
"""
import hashlib, json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path
ROOT = Path('/Users/ash/Desktop/Git/unknown/mobile')
API = 'https://commons.wikimedia.org/w/api.php'
UA = {'User-Agent': 'GlingPlacePhotos/1.0 (https://gling.app; contact: eun530k@gmail.com)'}

def resolve(title, width=1400):
    q = urllib.parse.urlencode({'action':'query','format':'json','titles':title,
        'prop':'imageinfo','iiprop':'url|extmetadata|size|sha1','iiurlwidth':str(width)})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(API+'?'+q, headers=UA), timeout=30) as f:
                d = json.load(f)
            break
        except Exception as e:
            print('retry', title, str(e)[:40], file=sys.stderr); time.sleep(6*(attempt+1))
    else:
        return None
    pages = d.get('query',{}).get('pages',{})
    for p in pages.values():
        ii = (p.get('imageinfo') or [{}])[0]
        if not ii.get('thumburl'):
            return None
        m = ii.get('extmetadata',{})
        def meta(k): return (m.get(k,{}) or {}).get('value','')
        artist = re.sub(r'<[^>]+>','', meta('Artist')).strip()
        return {
            'title': p['title'], 'artist': artist,
            'license': meta('LicenseShortName').strip(),
            # Commons sometimes hands back http or a /deed.en page; the catalogue needs https.
            'licenseUrl': meta('LicenseUrl').strip().replace('http://', 'https://', 1).replace('/deed.en', ''),
            'uri': ii['thumburl'],
            # Keep ':' and ',' readable; the app validator expects /wiki/File:<name>.
            'sourceUrl': 'https://commons.wikimedia.org/wiki/'
                         + urllib.parse.quote(p['title'].replace(' ', '_'), safe=':/(),!$\'&+=@~'),
        }
    return None

def main(pairs_path):
    pairs = json.loads(Path(pairs_path).read_text())
    out = []
    for row in pairs:
        r = resolve(row['file'])
        if not r:
            print('MISS', row['file'], file=sys.stderr); continue
        data = urllib.request.urlopen(urllib.request.Request(r['uri'], headers=UA), timeout=60).read()
        r.update({'cityId': row['cityId'], 'placeId': row['placeId'], 'placeName': row['placeName'],
                  'discoveredVia': 'Wikimedia Commons',
                  'imageSha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
        out.append(r)
        print(f"OK {row['placeName']}: {r['title'][5:60]} | {r['license']} | {len(data)//1024}KB")
        time.sleep(1.5)
    Path('/tmp/commons-rows.json').write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print('rows', len(out))

main(sys.argv[1])
