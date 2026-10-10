#!/usr/bin/env python3
"""Render six to ten local festival cards with a fixed final Gling introduction; no uploads."""
import argparse
import copy
import json
from pathlib import Path
import tempfile
import hashlib
import re
import os
import shutil
import subprocess
from datetime import date
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / 'output/design/gling-viff-mixed-carousel-2026-09-30/frames.html'
assert hashlib.sha256(TEMPLATE.read_bytes()).hexdigest() == '18bf9317d86b65aae6633b22aa87f57d97e73f60a913cca292d623836005ef73', 'The owner-approved template changed; use the approved source until a new template is explicitly chosen'
LICENSES = {'CC0': ('creativecommons.org', '/publicdomain/zero/1.0'),
            'Public domain': ('creativecommons.org', '/publicdomain/mark/1.0'),
            'Unsplash License': ('unsplash.com', '/license')}
LICENSES.update({f'CC {kind} {version}': ('creativecommons.org', f'/licenses/{path}/{version}')
                 for kind, path in [('BY', 'by'), ('BY-SA', 'by-sa')]
                 for version in ['2.0', '3.0', '4.0']})
COVER_MOTIONS = {
    'slow-push': ('centered102%→110% push', '1.02+0.08*{progress}', '0.5', '0.5'),
    'pull-back': ('centered110%→102% pullback', '1.10-0.08*{progress}', '0.5', '0.5'),
    'diagonal-drift': ('106% diagonal drift', '1.06', '0.25+0.50*{progress}', '0.25+0.50*{progress}'),
    'side-pan': ('108% horizontal pan', '1.08', '0.15+0.70*{progress}', '0.5'),
    'legacy-loop': ('background104%→114%→104% with smooth horizontal/vertical pan',
                    '1.04+0.05*(1-cos(2*PI*{progress}))',
                    '0.5+0.18*sin(2*PI*{progress})', '0.5+0.10*sin(2*PI*{progress})'),
}


def checked_url(value):
    parsed = urlsplit(value)
    if parsed.scheme != 'https' or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError('A public HTTPS source URL is required')
    return parsed


def validate_event(event, cover_records=None):
    from PIL import Image
    kind = event.get('content_kind', 'event')
    if kind not in ('event', 'place'):
        raise ValueError('Unknown content kind')
    if kind == 'place':
        if 'start_date' in event or 'end_date' in event:
            raise ValueError('Place content must not invent event dates')
        for key in ['place_type', 'place_address', 'place_verified_on']:
            if not isinstance(event.get(key), str) or not event[key].strip():
                raise ValueError(f'Missing place detail: {key}')
        date.fromisoformat(event['place_verified_on'])
        if event.get('place_operating_status') != 'open':
            raise ValueError('Current place availability must be verified')
    if event.get('fact_check_status') == 'passed':
        receipt = ROOT / event.get('fact_check_receipt', '')
        if not receipt.is_file():
            raise ValueError('A passed fact check requires its final-copy audit receipt')
        audit = json.loads(receipt.read_text())
        digest = hashlib.sha256((json.dumps(event, ensure_ascii=False, indent=2) + '\n').encode()).hexdigest()
        passes = audit.get('passes', [])
        if (audit.get('id') != event['event_id'] or not audit.get('draft_ready') or audit.get('input_sha256') != digest
                or [p.get('number') for p in passes] != [1, 2, 3]
                or not all(p.get('status', '').startswith('passed') for p in passes)):
            raise ValueError('Fact audit is held or does not match this final input; recheck before drafting')
    for key in ['event_id', 'name', 'city', *(['year'] if kind == 'event' else []), 'title_ko', 'instagram_body',
                'gling_title', 'gling_body', 'video_caption']:
        if not isinstance(event.get(key), str) or not event[key].strip():
            raise ValueError(f'Missing text: {key}')
    if not re.fullmatch(r'[A-Za-z0-9_-]+', event['event_id']):
        raise ValueError('event_id must be a stable filename-safe identifier')
    for key in ['cover_title_lines', 'period_lines', 'venue_lines', *(['period_title_lines'] if 'period_title_lines' in event else [])]:
        lines = event.get(key)
        if not isinstance(lines, list) or not 1 <= len(lines) <= 2 or any(not isinstance(x, str) or not x.strip() or '\n' in x for x in lines):
            raise ValueError(f'{key} must contain one or two explicit text lines; fonts never shrink')
    for key in ['instagram_body', 'video_caption']:
        if not re.search(r'프로필\s*링크', event[key]):
            raise ValueError(f'{key} must direct users to the profile link')
    for key in ['instagram_body', 'video_caption', 'gling_body']:
        if re.search(r'(?:apps|itunes)\.apple\.com|itms-apps://', event[key], re.I):
            raise ValueError('Direct App Store URLs are not allowed in drafts')
    if not event.get('official_sources'):
        raise ValueError('Verified official event sources are required')
    for source in event['official_sources']:
        checked_url(source['url']); date.fromisoformat(source['verified_at'])
    photos = event.get('photos', [])
    if not 4 <= len(photos) <= 8:
        raise ValueError('Deferred: four to eight distinct licensed photographs are required (five to nine content cards plus Gling)')
    result, hashes, urls = [], set(), set()
    for photo in photos:
        for key in ['file', 'title', 'creator', 'source_url', 'license', 'license_url', 'verified_at', 'alt']:
            if not isinstance(photo.get(key), str) or not photo[key].strip():
                raise ValueError(f'Deferred: photo {key} is missing')
        source = checked_url(photo['source_url'])
        license_url = checked_url(photo['license_url'])
        expected = LICENSES.get(photo['license'])
        if not expected or (license_url.netloc, license_url.path.rstrip('/')) != expected:
            raise ValueError('Deferred: commercial adaptation rights are not verified for this license')
        date.fromisoformat(photo['verified_at'])
        if photo.get('context') not in ['event', 'venue', 'illustrative']:
            raise ValueError('The photo must distinguish event, venue, or illustrative context')
        if kind == 'place' and photo.get('context') != 'venue':
            raise ValueError('Place photos must show the actual featured branch')
        if not isinstance(photo.get('object_position', 50), (int, float)) or not 0 <= photo.get('object_position', 50) <= 100:
            raise ValueError('Photo object_position must be a percentage from 0 to 100')
        path = (ROOT / photo['file']).resolve()
        with Image.open(path) as image:
            if image.width < 1080 or image.height < 1350:
                raise ValueError('Deferred: a source photo is too small for the fixed 1080x1350 export')
            image.verify()
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if photo.get('sha256') and photo['sha256'] != digest:
            raise ValueError('Deferred: the photo original changed after source verification')
        canonical = source._replace(query='', fragment='').geturl()
        if digest in hashes or canonical in urls:
            raise ValueError('Deferred: repeated photos or repeated source pages cannot fill the carousel')
        hashes.add(digest); urls.add(canonical); result.append((photo, path, digest))
    if cover_records is None:
        cover_records = json.loads((ROOT / 'marketing/festival-content-ledger.json').read_text())['events']
    cover_url = urlsplit(result[0][0]['source_url'])._replace(query='', fragment='').geturl()
    for record in cover_records:
        if str(record.get('research_id')) == event['event_id']:
            continue
        cover_hash, other_url = record.get('cover_source_sha256'), record.get('cover_source_url')
        if not cover_hash and record.get('media_directory'):
            existing = ROOT / record['media_directory'] / 'manifest.json'
            if existing.is_file():
                photo = json.loads(existing.read_text())['photos'][0]
                cover_hash, other_url = photo['sha256'], photo['source_url']
        if result[0][2] == cover_hash or (other_url and cover_url == urlsplit(other_url)._replace(query='', fragment='').geturl()):
            raise ValueError(f'Deferred: cover original already belongs to event {record.get("research_id")}; choose a different photograph')
    return result


def cover_date_label(event):
    if event.get('content_kind') == 'place':
        return ''
    start, end = event.get('start_date'), event.get('end_date')
    if not start or not end:
        dates = [re.search(r'\d{4}\.\d{2}\.\d{2}', line) for line in event['period_lines']]
        if len(dates) != 2 or not all(dates):
            return ''
        start, end = [x.group().replace('.', '-') for x in dates]
    start, end = date.fromisoformat(start), date.fromisoformat(end)
    if start == end:
        return start.strftime('%Y.%m.%d')
    ending = end.strftime('%d' if start.year == end.year and start.month == end.month else '%m.%d' if start.year == end.year else '%Y.%m.%d')
    return start.strftime('%Y.%m.%d') + '–' + ending


def frames_document(event, photos, out, aspect='4:5'):
    from bs4 import BeautifulSoup
    place = event.get('content_kind') == 'place'
    soup = BeautifulSoup(TEMPLATE.read_text(), 'html.parser')
    figures = soup.select('figure')
    if len(figures) != 6:
        raise ValueError('The approved six-slide source template changed')
    for _ in range(len(photos) - 4):
        figures[-2].insert_before(copy.deepcopy(figures[3]))
    figures = soup.select('figure')
    css = soup.style.get_text()
    def rebase(match):
        asset = (TEMPLATE.parent / match[1]).resolve()
        return 'url("' + os.path.relpath(asset, out).replace(os.sep, '/') + '")'
    css = re.sub(r'url\(["\']([^"\']+)["\']\)', rebase, css)
    css += '\n' + ','.join(f'html[data-export-slide="{i}"] figure:nth-child({i})' for i in range(1, len(figures) + 1)) + '{display:block}\n'
    if aspect == '9:16':
        css += '''\n.poster{height:640px}
html[data-export-slide],html[data-export-slide] body{height:1920px}
.cover h2{top:138px;right:40px}
.city-label{top:110px;left:26px;right:40px;text-align:right;white-space:normal}
.page{bottom:125px;right:40px}
.period-card,.app-card{padding:100px 40px 125px 28px}
'''
    elif aspect == '4:3':
        css += '''\n.poster{height:270px}
html[data-export-slide],html[data-export-slide] body{height:810px}
.cover h2{top:55px}
.city-label{top:30px}
.period-card,.app-card{padding:24px 28px}
.period-card .eyebrow{margin-bottom:0}
.period-event{position:absolute;top:48px;left:28px;width:304px;font-size:32px;margin:0}
.period-label{position:absolute;top:114px;left:28px;margin:0}
.period-date{position:absolute;top:128px;left:28px;width:304px;font-size:30px;line-height:1.15;margin:0}
.period-note{position:absolute;left:28px;bottom:24px;max-width:260px;margin:0}
.app-card .eyebrow{margin-bottom:16px}
.app-card h2{font-size:26px;margin-bottom:16px}
.app-card .wordmark{width:110px;height:44px;margin-bottom:12px}
.app-card .app-copy{font-size:12px;margin:0 0 6px}
.app-card .app-note{font-size:10px;line-height:1.4;margin:0}
'''
    soup.style.string = css
    records = []
    for i, (photo, path, digest) in enumerate(photos, 1):
        filename = f'assets/{i:02d}-source{path.suffix.lower()}'
        shutil.copyfile(path, out / filename)
        image = figures[i - 1].select_one('.poster > img')
        image['src'], image['alt'] = filename, photo['alt']
        figures[i - 1].select_one('.poster')['aria-label'] = photo['alt']
        image['style'] = f'object-position:{photo.get("object_position", 50)}% center'
        figures[i - 1].figcaption.string = f'{i:02d} · {photo["creator"]} · {photo["license"]}'
        records.append({**photo, 'file': filename, 'original_file': str(path), 'sha256': digest})
    def lines(selector, values):
        tag = soup.select_one(selector)
        tag.clear()
        for i, value in enumerate(values):
            if i:
                tag.append(soup.new_tag('br'))
            tag.append(value)
    lines('.festival-name', event['cover_title_lines'])
    size = 104 if len(event['cover_title_lines']) == 1 and len(event['cover_title_lines'][0]) <= 4 else 58
    soup.select_one('.festival-name')['style'] = f'font-size:{size}px'
    soup.select_one('.festival-ko').string = event['title_ko']
    label = cover_date_label(event)
    soup.select_one('.city-label').string = event['city'] + (' · ' + label if label else '')
    for i, figure in enumerate(figures, 1):
        if figure.select_one('.page'):
            figure.select_one('.page').string = f'{i:02d}/{len(figures):02d}'
    figures[-2].figcaption.string = f'{len(figures)-1:02d} · {"방문 정보" if place else "행사 기간"}'
    figures[-1].figcaption.string = f'{len(figures):02d} · 글링 앱 소개'
    soup.select_one('.period-card')['aria-label'] = f'{event["name"]} 방문 정보' if place else f'{event["name"]} {event["year"]} 행사 기간'
    soup.select_one('.period-card .eyebrow').string = event['city'] if place else f'{event["city"]} · {event["year"]}'
    if place:
        soup.select_one('.period-label').string = '방문 정보'
    lines('.period-event', event.get('period_title_lines', event['cover_title_lines']))
    lines('.period-date', event['period_lines'])
    lines('.period-note', event['venue_lines'])
    soup.select_one('.app-card .eyebrow').string = 'GLING'
    lines('.app-card h2', ['같이 갈 사람은', '글링에서'])
    soup.select_one('.app-copy').string = '정보·동행 모임은 글링에서'
    logo = soup.select_one('.wordmark')
    logo['src'] = os.path.relpath(ROOT / 'assets/brand/gling-night-wordmark.png', out).replace(os.sep, '/')
    (out / 'frames.html').write_text(str(soup))
    preview = BeautifulSoup(str(soup), 'html.parser')
    preview.script.decompose()
    (out / 'index.html').write_text(str(preview))
    return records, size


def write_drafts(event, records, out, aspect='4:5'):
    tags = list(dict.fromkeys([*event.get('hashtags', []), '#글링']))
    if len(tags) != 5 or any(not re.fullmatch(r'#[^\s#]+', x) for x in tags):
        raise ValueError('Exactly five hashtags, including #글링, are required')
    credits = 'photo: ' + ' '.join(f'{i}. {p["creator"]}' for i, p in enumerate(records, 1))
    context = event.get('photo_context_note', '').strip()
    if '\n' in context:
        raise ValueError('Photo context note must be one short sentence')
    sharealike = any(p['license'].startswith('CC BY-SA') for p in records)
    if sharealike and any(p['license'] == 'Unsplash License' for p in records):
        raise ValueError('Deferred: a mixed ShareAlike/Unsplash video needs a separate rights review')
    required = [(i, p) for i, p in enumerate(records, 1) if p['license'].startswith('CC BY') or p['license'] == 'Public domain']
    legal = ''
    modifications = f'{aspect} 크롭·공통 톤 보정·약한 그레인·표지 음영/문자·장 번호·커버 움직임 적용.'
    if aspect == '4:3':
        modifications = modifications.replace('·커버 움직임', '')
    if required:
        credits = 'photo: ' + '\n'.join(f'{i}. {p["creator"]}' + (' 「' + p['title'] + '」\n' + p['source_url'] if p['license'].startswith('CC BY') or p['license'] == 'Public domain' else '') for i, p in enumerate(records, 1))
        groups = {(p['license'], p['license_url']) for _, p in required}
        licenses = '\n'.join((('·'.join(str(i) for i, p in required if (p['license'], p['license_url']) == (name, url)) + ': ') if len(groups) > 1 or len(required) < len(records) else '') + f'{name} {url}' for name, url in sorted(groups))
        modifications = '크롭·보정·문자' + ('·커버 모션' if aspect != '4:3' else '')
        if sharealike:
            modifications += ' · 편집영상 CC BY-SA 4.0'
            if 'https://creativecommons.org/licenses/by-sa/4.0/' not in licenses:
                licenses += '\n편집영상 CC BY-SA 4.0 https://creativecommons.org/licenses/by-sa/4.0/'
        legal = f'\n{licenses}\n{modifications}'
    suffix = f'\n\n' + (context + '\n' if context else '') + f'{credits}{legal}\n\n{" ".join(tags)}\n'
    caption = event['instagram_body'].rstrip() + suffix
    if len(caption) > 2200:
        raise ValueError('Deferred: Instagram caption exceeds 2200 characters')
    (out / 'caption.txt').write_text(caption)
    detail_sources = '\n'.join(f'{i}. {p["creator"]}, 「{p["title"]}」 / {p["license"]}\n{p["source_url"]}' for i, p in enumerate(records, 1))
    detail_licenses = '\n'.join(dict.fromkeys(p['license_url'] for p in records))
    if sharealike:
        detail_licenses += '\nhttps://creativecommons.org/licenses/by-sa/4.0/'
    detail_changes = ('\n사진 편집됨.' + (' 편집 이미지 CC BY-SA 4.0' if sharealike else '')) if required else ''
    detail = event['gling_body'].rstrip() + f'\n\n사진 출처·이용 조건\n{context}\n{detail_sources}\n라이선스: {detail_licenses}{detail_changes}'
    for filename, content in [('gling-body.txt', detail),
                              ('youtube-caption.txt', event['video_caption'] + suffix),
                              ('tiktok-caption.txt', event['video_caption'] + suffix)]:
        (out / filename).write_text(content.rstrip() + '\n')
    return caption, 'CC BY-SA 4.0' if sharealike else None


def ffmpeg_tool(name):
    candidate = shutil.which(name) or f'/opt/anaconda3/bin/{name}'
    if not Path(candidate).is_file():
        raise ValueError(f'Use the already-installed {name}; no dependency will be installed')
    return candidate


def encode(arguments):
    subprocess.run([ffmpeg_tool('ffmpeg'), '-hide_banner', '-loglevel', 'error', '-y', *arguments], check=True)


def verify_video(path, dimensions, seconds, frames):
    probe = json.loads(subprocess.check_output([ffmpeg_tool('ffprobe'), '-v', 'error', '-count_frames',
                        '-show_entries', 'stream=codec_name,codec_type,width,height,pix_fmt,avg_frame_rate,nb_read_frames:format=duration',
                        '-of', 'json', str(path)]))
    streams = probe['streams']
    assert len(streams) == 1 and streams[0]['codec_type'] == 'video', 'Video must contain no audio track'
    video = streams[0]
    assert (video['width'], video['height']) == dimensions and video['codec_name'] == 'h264', probe
    assert video['pix_fmt'] == 'yuv420p' and video['avg_frame_rate'] == '30/1', probe
    assert video['nb_read_frames'] == str(frames) and abs(float(probe['format']['duration']) - seconds) < .02, probe
    subprocess.run([ffmpeg_tool('ffmpeg'), '-v', 'error', '-i', str(path), '-f', 'null', '-'], check=True, capture_output=True)
    return probe


def select_cover_motion(event_id, out):
    current = out / 'manifest.json'
    if current.is_file():
        saved = json.loads(current.read_text())
        if saved.get('eventId') == event_id and saved.get('coverMotion') and saved.get('state') != 'rendering-local-drafts':
            return saved.get('coverMotionTemplate', 'legacy-loop')
    rotation = tuple(name for name in COVER_MOTIONS if name != 'legacy-loop')
    # shortcut: concurrent render starts can choose the same predecessor; serialize selection if production overlaps.
    history = sorted((ROOT / 'output/design').rglob('manifest.json'), key=lambda p: p.stat().st_mtime_ns, reverse=True)
    for path in history:
        try:
            saved = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        previous = saved.get('coverMotionTemplate')
        if previous in COVER_MOTIONS and saved.get('state') != 'rendering-local-drafts' and saved.get('coverMotion'):
            return rotation[(rotation.index(previous) + 1) % len(rotation)] if previous in rotation else rotation[0]
    return rotation[0]


def cover_motion_graph(height, template, frames=180):
    if frames < 2:
        raise ValueError('Cover camera motion requires at least two frames')
    _, zoom, x, y = COVER_MOTIONS[template]
    progress = f'on/{frames - 1}'
    zoom, x, y = [value.format(progress=progress) for value in (zoom, x, y)]
    return (f"[0:v]scale=2160:{height*2},zoompan=z='{zoom}':x='(iw-iw/zoom)*({x})':"
            f"y='(ih-ih/zoom)*({y})':d={frames}:s=1080x{height}:fps=30,setsar=1[bg];"
            '[bg][1:v]overlay=0:0:shortest=1,format=yuv420p[out]')


def render(event, out, photos, aspect='4:5'):
    from bs4 import BeautifulSoup
    from PIL import Image
    from playwright.sync_api import sync_playwright
    motion = select_cover_motion(event['event_id'], out) if aspect != '4:3' else None
    out.mkdir(parents=True, exist_ok=True)
    (out / 'assets').mkdir(exist_ok=True)
    (out / 'manifest.json').write_text(json.dumps({'eventId': event['event_id'], 'state': 'rendering-local-drafts'}) + '\n')
    height = {'9:16': 1920, '4:3': 810, '4:5': 1350}[aspect]
    records, title_size = frames_document(event, photos, out, aspect)
    caption, video_license = write_drafts(event, records, out, aspect)
    names = ['01-cover-poster.png', *[f'{i:02d}-photo.png' for i in range(2, len(photos) + 1)],
             f'{len(photos) + 1:02d}-period.png', f'{len(photos) + 2:02d}-gling.png']
    checks = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1080, 'height': height}, device_scale_factor=1)
        for i, filename in enumerate(names, 1):
            page.goto((out / 'frames.html').as_uri() + f'?slide={i}', wait_until='load')
            page.evaluate("Promise.all(['500 58px Bodoni','600 18px Pretendard','400 10px CityMenlo'].map(s=>document.fonts.load(s)))")
            page.evaluate('document.fonts.ready')
            page.wait_for_function('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)')
            assert page.evaluate("document.fonts.check('500 58px Bodoni') && document.fonts.check('600 18px Pretendard') && document.fonts.check('400 10px CityMenlo')"), 'The fixed brand fonts did not load'
            bounds = page.locator('figure:visible .poster').evaluate('''(e,height) => {const bad=[];const lines={};for(const c of e.querySelectorAll('h2,p,span,img.wordmark')){const r=c.getBoundingClientRect();if(r.x<0||r.y<0||r.right>1080||r.bottom>height||c.scrollWidth>c.clientWidth)bad.push(c.className);const range=document.createRange();range.selectNodeContents(c);lines[c.className]=new Set(Array.from(range.getClientRects()).map(r=>Math.round(r.top))).size;}return {overflow:bad,lines};}''', height)
            assert not bounds['overflow'], f'Slide {i} overflows: {bounds}'
            if i == 1:
                assert bounds['lines']['festival-name'] <= (1 if title_size == 104 else 2), 'Cover title must fit the fixed font; add explicit line breaks'
                assert bounds['lines']['city-label'] <= 2, 'City/date must fit at the fixed Menlo size'
                assert page.locator('.festival-name').evaluate('(e)=>getComputedStyle(e).fontSize') == f'{title_size}px'
            page.screenshot(path=str(out / filename))
            with Image.open(out / filename) as exported:
                assert exported.size == (1080, height)
            checks.append({'slide': i, **bounds})
        if aspect == '4:3':
            preview = BeautifulSoup((out / 'index.html').read_text(), 'html.parser')
            (out / 'index.html').write_text(str(preview))
            page.set_viewport_size({'width': 1180, 'height': 800})
            page.goto((out / 'index.html').as_uri()); page.evaluate('document.fonts.ready')
            page.wait_for_function('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)')
            page.screenshot(path=str(out / 'preview.png'), full_page=True)
            browser.close()
            manifest = dict(eventId=event['event_id'], channel='gling', dimensions=[1080, 810],
                state='local-photos-ready' if event.get('fact_check_status') == 'passed' else 'local-preview-fact-check-held',
                templateSource=str(TEMPLATE.relative_to(ROOT)), photos=records, bounds=checks,
                finalInputSha256=hashlib.sha256((json.dumps(event, ensure_ascii=False, indent=2) + '\n').encode()).hexdigest(),
                images=[dict(file=f,sha256=hashlib.sha256((out/f).read_bytes()).hexdigest()) for f in names],
                body=dict(file='gling-body.txt',sha256=hashlib.sha256((out/'gling-body.txt').read_bytes()).hexdigest()),
                coverTextSafeForFeedAspect='intrinsic photo aspect, contain; no title crop', photoStyle=dict(brightness=.9,saturation=.9,contrast=1.03,grainOpacity=.035),
                externalUploads=0, glingRegistrations=0)
            (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
            print(f'Rendered Gling 4:3 photos: {out}; no external writes')
            return
        for layer in ['background', 'overlay']:
            page.goto((out / 'frames.html').as_uri() + f'?slide=1&layer={layer}')
            page.evaluate('document.fonts.ready')
            page.wait_for_function('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)')
            page.screenshot(path=str(out / f'cover-{layer}.png'), omit_background=layer == 'overlay')
        page.set_viewport_size({'width': 1180, 'height': 1050})
        page.goto((out / 'index.html').as_uri()); page.evaluate('document.fonts.ready')
        page.wait_for_function('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)')
        page.screenshot(path=str(out / 'preview.png'), full_page=True)
        browser.close()
    encoding = ['-an', '-r', '30', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-threads', '4', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
    cover = out / '01-moving-cover.mp4'
    graph = cover_motion_graph(height, motion)
    encode(['-i', str(out / 'cover-background.png'), '-loop', '1', '-framerate', '30', '-i', str(out / 'cover-overlay.png'),
            '-filter_complex_threads', '2', '-filter_complex', graph, '-map', '[out]', '-t', '6', *encoding, str(cover)])
    cover_probe = verify_video(cover, (1080, height), 6, 180)
    with tempfile.TemporaryDirectory(prefix='segments-', dir=out) as directory:
        folder = Path(directory)
        clips = [cover]
        for i, filename in enumerate(names[1:], 2):
            clip = folder / f'{i}.mp4'
            encode(['-loop', '1', '-framerate', '30', '-i', str(out / filename), '-t', '3', *encoding, str(clip)])
            clips.append(clip)
        listing = folder / 'concat.txt'
        listing.write_text('\n'.join("file '" + str(p).replace("'", "'\\''") + "'" for p in clips) + '\n')
        youtube = out / 'youtube-short.mp4'
        vertical_filter = 'setsar=1' if height == 1920 else 'pad=1080:1920:0:285:color=black'
        encode(['-f', 'concat', '-safe', '0', '-i', str(listing), '-vf', vertical_filter,
                '-t', str(6 + (len(names) - 1) * 3), *encoding, str(youtube)])
    vertical_probe = verify_video(youtube, (1080, 1920), 6 + (len(names) - 1) * 3, (6 + (len(names) - 1) * 3) * 30)
    shutil.copyfile(youtube, out / 'tiktok.mp4')
    # Preview actual exports; encoded cover already contains its text and shadow.
    preview = BeautifulSoup((out / 'index.html').read_text(), 'html.parser')
    posters = preview.select('.poster')
    for i, poster in enumerate(posters):
        poster.clear()
        poster['class'] = ['poster']
        if i == 0:
            media = preview.new_tag('video', src='01-moving-cover.mp4', poster='01-cover-poster.png',
                                    muted='', autoplay='', loop='', playsinline='',
                                    style='display:block;width:100%;height:100%;object-fit:cover')
        else:
            media = preview.new_tag('img', src=names[i], alt=poster.get('aria-label', ''),
                                    style='display:block;width:100%;height:100%;object-fit:cover')
        poster.append(media)
    assert len(preview.select('.poster > video')) == 1 and len(preview.select('.poster > img')) == len(names) - 1
    assert not preview.select('.cover h2, .city-label')
    (out / 'index.html').write_text(str(preview))
    digest = lambda name: hashlib.sha256((out / name).read_bytes()).hexdigest()
    assert digest('youtube-short.mp4') == digest('tiktok.mp4')
    media = ['01-moving-cover.mp4', *names[1:]]
    manifest = dict(eventId=event['event_id'], name=event['name'],
                    state='local-drafts-ready-for-review' if event.get('fact_check_status') == 'passed' else 'local-preview-fact-check-held',
                    factCheckStatus=event.get('fact_check_status', 'pending'),factCheckReceipt=event.get('fact_check_receipt'),
                    factCheckScope=event.get('fact_check_scope'),
                    finalInputSha256=hashlib.sha256((json.dumps(event, ensure_ascii=False, indent=2) + '\n').encode()).hexdigest(),
                    draftFileSha256={f:digest(f) for f in ['caption.txt','gling-body.txt','youtube-caption.txt','tiktok-caption.txt']},
                    templateSource=str(TEMPLATE.relative_to(ROOT)), dimensions=[1080, height],
                    structure=['moving cover', *['photo'] * (len(photos) - 1), 'event period', 'Gling'],
                    coverMotion=f'6 seconds; {COVER_MOTIONS[motion][0]}; text fixed', coverMotionTemplate=motion,
                    instagram=[dict(slide=i, type='video' if i == 1 else 'image', file=f, sha256=digest(f)) for i, f in enumerate(media, 1)],
                    youtube=dict(file='youtube-short.mp4', sha256=digest('youtube-short.mp4'), dimensions=[1080,1920]),
                    tiktok=dict(file='tiktok.mp4', sha256=digest('tiktok.mp4'), dimensions=[1080,1920]),
                    verticalTimeline=[dict(slide=i, start=0 if i == 1 else 6+(i-2)*3, seconds=6 if i == 1 else 3) for i in range(1,len(names)+1)],
                    verticalCardPlacement=dict(x=0,y=(1920-height)//2,width=1080,height=height,background='#000000',textReflow=height==1920),
                    videoAdaptationLicense=video_license, photos=records, officialSources=event['official_sources'],
                    typography=dict(coverPreviewPx=title_size,coverExportPx=title_size*3,koreanPreviewPx=18,city='Menlo 400 10px'),
                    previewMedia=dict(video=1,images=len(names)-1,source='actual exports'),
                    photoModifications=f'{aspect} crop, uniform tone/grain, cover shadow/text, page numbers, cover background movement',
                    photoStyle=dict(brightness=.9,saturation=.9,contrast=1.03,grainOpacity=.035,appliedToSlides=list(range(1,len(photos)+1)),previewDoubleApplication=False),
                    draftFiles=['caption.txt','gling-body.txt','youtube-caption.txt','tiktok-caption.txt'],
                    glingTitle=event['gling_title'], instagramCaptionCharacters=len(caption),
                    videoVerification=dict(cover=cover_probe,vertical=vertical_probe,allFramesDecoded=True,tiktokByteIdentical=True),
                    bounds=checks, externalUploads=0, scheduledPosts=0, glingRegistrations=0, paidCalls=0)
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f'Rendered: {out}; {manifest["state"]}; no external writes')


def self_check():
    from PIL import Image
    assert callable(validate_event), 'The required photo/license validation is not implemented yet'
    with tempfile.TemporaryDirectory() as directory:
        folder = Path(directory)
        photos = []
        for i in range(4):
            path = folder / f'{i}.png'
            Image.new('RGB', (1600, 2000), (i * 40, 0, 20)).save(path)
            photos.append(dict(file=str(path), title=f'Fixture {i}', creator='Test',
                               source_url=f'https://example.com/{i}', license='CC BY 4.0',
                               license_url='https://creativecommons.org/licenses/by/4.0/',
                               verified_at='2026-09-30', context='illustrative',
                               alt='Test image', object_position=50))
        event = dict(event_id='CHECK', name='Check', city='CHECK', year='2026',
                     start_date='2026-10-01', end_date='2026-10-11',
                     cover_title_lines=['CHECK'], title_ko='검증', period_lines=['10월 1일', '— 11일'],
                     venue_lines=['검증 장소'], gling_headline_lines=['함께 갈 사람?'], photos=photos,
                     instagram_body='글링은 프로필 링크에서.', gling_title='검증', gling_body='검증',
                     video_caption='글링은 프로필 링크에서.', hashtags=['#캐나다','#영화제','#행사','#해외생활','#글링'],
                     official_sources=[dict(url='https://example.com/event', verified_at='2026-09-30')])
        assert len(validate_event(event)) == 4
        place = copy.deepcopy(event)
        for key in ['year', 'start_date', 'end_date']:
            place.pop(key)
        place.update(content_kind='place', place_type='library',
                     place_address='Test-only address', place_operating_status='open',
                     place_verified_on='2026-10-07', period_lines=['방문 조건', '예약 필요'],
                     venue_lines=['Test-only address'])
        for photo in place['photos']:
            photo['context'] = 'venue'
        assert len(validate_event(place)) == 4, 'A verified place must not need invented event dates or a year'
        assert cover_date_label(place) == '', 'A place cover must not invent an event period'
        from bs4 import BeautifulSoup
        place_out = folder / 'place'
        (place_out / 'assets').mkdir(parents=True)
        for aspect in ['9:16', '4:3']:
            frames_document(place, validate_event(place), place_out, aspect)
            doc = BeautifulSoup((place_out / 'frames.html').read_text(), 'html.parser')
            assert '방문 정보' in doc.select_one('.period-label').get_text()
            assert doc.select_one('.period-date').get_text(' / ') == '방문 조건 / 예약 필요'
            assert doc.select_one('.period-note').get_text() == 'Test-only address'
            assert doc.select_one('.city-label').get_text() == 'CHECK'
            assert '정보·동행 모임은 글링에서' == doc.select_one('.app-copy').get_text()
            assert '행사 기간' not in doc.select_one('.period-card').get('aria-label', '')
        public_domain = copy.deepcopy(event)
        public_domain['photos'][1].update(license='Public domain', license_url='https://creativecommons.org/publicdomain/mark/1.0/')
        assert len(validate_event(public_domain)) == 4, 'A documented public-domain original must remain Public domain, not be relabelled CC0'
        public_caption, _ = write_drafts(public_domain, public_domain['photos'], folder)
        assert 'Public domain https://creativecommons.org/publicdomain/mark/1.0/' in public_caption
        assert '「Fixture 1」\nhttps://example.com/1' in public_caption, 'Public-domain provenance must survive the SNS export'
        assert '「Fixture 0」\nhttps://example.com/0' in public_caption, 'Known CC photo titles must survive the SNS export'
        def rejected(changed, cover_records=None):
            try:
                validate_event(changed, cover_records)
            except ValueError:
                return
            raise AssertionError('Unsafe input was accepted')
        bad = copy.deepcopy(place); bad['start_date'] = '2026-10-01'; rejected(bad)
        bad = copy.deepcopy(place); bad['place_operating_status'] = 'closed'; rejected(bad)
        bad = copy.deepcopy(place); bad['place_address'] = ''; rejected(bad)
        bad = copy.deepcopy(place); bad['place_verified_on'] = '2026-02-30'; rejected(bad)
        bad = copy.deepcopy(place); bad['photos'][0]['context'] = 'illustrative'; rejected(bad)
        bad = copy.deepcopy(event); bad['content_kind'] = 'unknown'; rejected(bad)
        bad = copy.deepcopy(public_domain); bad['photos'][1]['license_url'] = 'https://creativecommons.org/publicdomain/zero/1.0/'; rejected(bad)
        bad = copy.deepcopy(event); bad['photos'] = bad['photos'][:3]; rejected(bad)
        bad = copy.deepcopy(event); bad['photos'][3] = copy.deepcopy(bad['photos'][0]); rejected(bad)
        duplicate = folder / 'duplicate.png'; duplicate.write_bytes(Path(photos[0]['file']).read_bytes())
        bad = copy.deepcopy(event); bad['photos'][3]['file'] = str(duplicate); rejected(bad)
        bad = copy.deepcopy(event); bad['photos'][0]['license'] = 'CC BY-NC 4.0'; rejected(bad)
        bad = copy.deepcopy(event); bad['photos'][0]['license'] = 'Official media kit'; rejected(bad)
        bad = copy.deepcopy(event); bad['photos'][0]['verified_at'] = ''; rejected(bad)
        bad = copy.deepcopy(event); bad['photos'][0]['sha256'] = 'stale'; rejected(bad)
        bad = copy.deepcopy(event); bad['cover_title_lines'] = ['one', 'two', 'three']; rejected(bad)
        bad = copy.deepcopy(event); bad['period_title_lines'] = ['one', 'two', 'three']; rejected(bad)
        bad = copy.deepcopy(event); bad['instagram_body'] = 'CTA missing'; rejected(bad)
        bad = copy.deepcopy(event); bad['video_caption'] += ' https://apps.apple.com/app/id123'; rejected(bad)
        cover_hash = hashlib.sha256(Path(photos[0]['file']).read_bytes()).hexdigest()
        covers = [dict(research_id='OTHER', cover_source_sha256=cover_hash, cover_source_url=photos[0]['source_url'])]
        rejected(event, covers)
        different_hash = [dict(research_id='OTHER', cover_source_sha256='different', cover_source_url=photos[0]['source_url']+'?tracking=1')]
        rejected(event, different_hash)
        covers[0]['research_id'] = 'CHECK'; assert len(validate_event(event, covers)) == 4
        bad = copy.deepcopy(event); bad['fact_check_status'] = 'passed'; rejected(bad)
        checked = copy.deepcopy(event); checked['fact_check_status'] = 'passed'
        checked['fact_check_receipt'] = str(folder / 'audit.json')
        audit = dict(id='CHECK', draft_ready=True, passes=[dict(number=i,status='passed') for i in [1,2,3]],
                     input_sha256=hashlib.sha256((json.dumps(checked, ensure_ascii=False, indent=2) + '\n').encode()).hexdigest())
        (folder / 'audit.json').write_text(json.dumps(audit))
        assert len(validate_event(checked)) == 4
        changed = copy.deepcopy(checked); changed['period_lines'][0] = '10월 2일'; rejected(changed)
        audit['draft_ready'] = False; (folder / 'audit.json').write_text(json.dumps(audit)); rejected(checked)
        simple = copy.deepcopy(event)
        for photo in simple['photos']:
            photo['license'], photo['license_url'] = 'Unsplash License', 'https://unsplash.com/license'
        caption, _ = write_drafts(simple, simple['photos'], folder)
        assert '공통 톤 보정' not in (folder / 'gling-body.txt').read_text(), 'Production notes must not enter the public article'
        assert not (folder / 'threads.txt').exists(), 'Festival drafts must not enter the separate Threads workflow'
        assert 'photo: 1. Test 2. Test 3. Test 4. Test' in caption
        assert '라이선스:' not in caption and '크롭' not in caption and 'https://example.com/' not in caption
        legal, _ = write_drafts(event, event['photos'], folder)
        assert 'CC BY 4.0' in legal and 'https://creativecommons.org/licenses/by/4.0/' in legal and '크롭' in legal
        assert legal.count('Test') == 4, 'Required credits must not repeat the author list'
        (folder / 'assets').mkdir()
        frames_document(event, validate_event(event), folder)
        from playwright.sync_api import sync_playwright
        from PIL import ImageStat
        import io
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page(viewport={'width': 1080, 'height': 1350})
            for i, photo in enumerate(photos, 1):
                page.goto((folder / 'frames.html').as_uri() + f'?slide={i}')
                pixel = Image.open(io.BytesIO(page.screenshot())).crop((520, 650, 560, 690))
                source = sum(ImageStat.Stat(Image.open(photo['file'])).mean[:3])
                assert sum(ImageStat.Stat(pixel).mean[:3]) < source, f'Photo slide {i} has no actual tone-down effect'
                if i == 2:
                    assert sum(ImageStat.Stat(pixel).var[:3]) > 0, 'Subtle grain must appear in the rendered photograph'
            browser.close()
        frames_document(event, validate_event(event), folder, aspect='9:16')
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page(viewport={'width': 1080, 'height': 1920})
            page.goto((folder / 'frames.html').as_uri() + '?slide=1')
            page.evaluate('document.fonts.ready')
            assert page.locator('.city-label').inner_text() == 'CHECK · 2026.10.01–11', 'The cover must show the verified date with its city'
            frame = page.locator('.poster:visible').bounding_box()
            assert (frame['x'], frame['y'], frame['width'], frame['height']) == (0, 0, 1080, 1920), '9:16 must fill the complete canvas without padding'
            for selector in ['.festival-name', '.festival-ko', '.city-label']:
                box = page.locator(selector).bounding_box()
                assert box['y'] >= 200 and box['x'] >= 60 and box['x'] + box['width'] <= 1000, 'Reel text must remain inside the UI-safe area'
                assert box['y'] >= 315 and box['y'] + box['height'] <= 1605, 'Cover text must survive the centered4:5feed preview with padding'
            browser.close()
        frames_document(event, validate_event(event), folder, aspect='4:3')
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page(viewport={'width': 1080, 'height': 810})
            page.goto((folder / 'frames.html').as_uri() + '?slide=1')
            page.evaluate('document.fonts.ready')
            frame = page.locator('.poster:visible').bounding_box()
            assert (frame['x'], frame['y'], frame['width'], frame['height']) == (0, 0, 1080, 810), 'Gling detail photo must fill its native 4:3 area'
            for selector in ['.festival-name', '.festival-ko', '.city-label']:
                box = page.locator(selector).bounding_box()
                assert box['y'] >= 67.5 and box['y'] + box['height'] <= 742.5, 'Gling cover type must survive the feed 16:10 center crop'
            browser.close()
        detail = (folder / 'gling-body.txt').read_text()
        assert all(p['source_url'] in detail for p in photos), 'Gling detail must retain all photo sources'
        assert 'https://creativecommons.org/licenses/by/4.0/' in detail and '사진 편집됨.' in detail
    print('PASS: unique cover originals, final-copy fact gate, photo licenses, four tone-down renders, visible grain, full Gling credits and separate SNS workflow')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--self-check', action='store_true')
    parser.add_argument('event', nargs='?', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--aspect', choices=['4:5', '9:16', '4:3'], default='4:5')
    args = parser.parse_args()
    if args.self_check:
        self_check()
    else:
        if not args.event or not args.output:
            parser.error('EVENT.json and --output OUT are required')
        try:
            event = json.loads(args.event.read_text())
            photos = validate_event(event)
            output = (ROOT / args.output).resolve()
            if output == TEMPLATE.parent or output == ROOT:
                raise ValueError('Output must be a separate draft folder')
            render(event, output, photos, args.aspect)
        except (ValueError, KeyError, OSError, subprocess.CalledProcessError, AssertionError) as error:
            parser.exit(2, f'Deferred: {error}\n')
