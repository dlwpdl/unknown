#!/usr/bin/env python3
"""Render a venue site and take its largest real photo. Writes /tmp/render-photos.json.

Usage: python3 -I scripts/photo-source-render.py [limit]  (city is set in the file; flip it per city.)


Many venue sites are JS-built or only expose a logo as og:image, so the HTML
scan finds nothing. This loads the page, measures every <img> and CSS
background, and keeps the biggest one that is actually photographic.
"""
import asyncio, hashlib, json, sys, urllib.parse, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path('/Users/ash/Desktop/Git/unknown/mobile')
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36'
MIN_BYTES = 120_000
BAD = ('logo', 'fallback', 'placeholder', 'sprite', 'icon', 'favicon', 'seo-img', 'noimage', 'default-share', 'og-default')

JS = """() => {
  const out = [];
  for (const img of document.querySelectorAll('img')) {
    const r = img.getBoundingClientRect();
    const src = img.currentSrc || img.src;
    if (src) out.push({src, w: Math.max(r.width, img.naturalWidth||0), h: Math.max(r.height, img.naturalHeight||0)});
  }
  for (const el of document.querySelectorAll('*')) {
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg.startsWith('url(')) {
      const r = el.getBoundingClientRect();
      out.push({src: bg.slice(5, -2).replace(/["']/g, ''), w: r.width, h: r.height});
    }
  }
  return out;
}"""

def is_image(d):
    return d[:2] == b'\xff\xd8' or d[:2] == b'\x89P' or (d[:4] == b'RIFF' and d[8:12] == b'WEBP')

async def grab(browser, place):
    ctx = await browser.new_context(user_agent=UA, viewport={'width': 1400, 'height': 1000})
    page = await ctx.new_page()
    try:
        await page.goto(place['website'], wait_until='domcontentloaded', timeout=30000)
        await page.wait_for_timeout(2500)
        try:
            await page.mouse.wheel(0, 2200)
            await page.wait_for_timeout(1500)
        except Exception:
            pass
        imgs = await page.evaluate(JS)
    except Exception as e:
        await ctx.close()
        return place, None, f'RENDER {str(e)[:50]}'
    seen, cands = set(), []
    for i in imgs:
        u = urllib.parse.urljoin(place['website'], i['src'])
        if not u.startswith('http') or u in seen: continue
        seen.add(u)
        if any(b in u.lower() for b in BAD): continue
        if i['w'] < 500 or i['h'] < 320: continue
        cands.append((i['w'] * i['h'], u))
    cands.sort(reverse=True)
    await ctx.close()
    loop = asyncio.get_running_loop()
    for _, u in cands[:6]:
        try:
            data = await asyncio.wait_for(loop.run_in_executor(None, fetch, u), 25)
        except Exception:
            continue
        if len(data) >= MIN_BYTES and is_image(data):
            return place, (u, data), 'ok'
    return place, None, f'no photo ({len(cands)} cands)'

def fetch(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': UA}), timeout=20) as r:
        return r.read()

async def main(limit=0):
    cat = json.loads((ROOT/'src/lib/city-places.catalog.json').read_text())
    ph = json.loads((ROOT/'src/lib/city-places.photos.json').read_text())
    have = {r['placeId'] for r in ph['cities']['vancouver']}
    todo = [p for p in cat['cities']['vancouver']['places'] if p['id'] not in have and p.get('website')]
    todo = todo[:limit] if limit else todo
    rows, hashes = [], set()
    sem = asyncio.Semaphore(3)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        async def run(p):
            async with sem:
                return await grab(browser, p)
        for place, picked, why in await asyncio.gather(*(run(p) for p in todo)):
            if not picked:
                print(f'  -  {place["name"]}: {why}'); continue
            url, data = picked
            h = hashlib.sha256(data).hexdigest()
            if h in hashes:
                print(f'  =  {place["name"]}: dup'); continue
            hashes.add(h)
            rows.append({'cityId':'vancouver','placeId':place['id'],'artist':place['name'],
                'title':place['name'],'discoveredVia':'Business site','imageSha256':h,
                'license':'Business-provided photo','uri':url,'sourceUrl':place['website'],
                'licenseUrl':place['website'],'bytes':len(data),'placeName':place['name']})
            print(f'  ✅ {place["name"]}: {len(data)//1024}KB {url[-60:]}')
        await browser.close()
    Path('/tmp/render-photos.json').write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    print(f'수집 {len(rows)} / 시도 {len(todo)}')

asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 0))
