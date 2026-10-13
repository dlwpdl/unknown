#!/usr/bin/env python3
"""기존 city-posts LaunchAgent용 일일 원고·분산 시각·제출 영수증."""
import hashlib
import json
import os
import random
import re
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode, urlparse
from zoneinfo import ZoneInfo

CITIES = {
    'vancouver': ('Vancouver', 'America/Vancouver'),
    'toronto': ('Toronto', 'America/Toronto'),
    'montreal': ('Montréal', 'America/Toronto'),
    'edmonton': ('Edmonton', 'America/Edmonton'),
    'calgary': ('Calgary', 'America/Edmonton'),
}
STORY_DISCLOSURE = '해외생활 사연을 참고해 재구성한 이야기예요.'


def key(post):
    return post['city_id'] + '\n' + post['title']


def posts_per_city(posts):
    count = len(posts) // len(CITIES)
    if count not in (5, 6) or len(posts) != count * len(CITIES) or any(sum(p['city_id'] == c for p in posts) != count for c in CITIES):
        raise ValueError('CITY_QUEUE_REQUIRES_FIVE_REGULAR_PLUS_ONE_STORY_PER_CITY')
    for city in CITIES:
        stories = [p for p in posts if p['city_id'] == city and p.get('content_kind') == 'community_story']
        if len(stories) != count - 5:
            raise ValueError('CITY_STORY_COUNT_MISMATCH')
        for story in stories:
            source, review = story.get('source'), story.get('source_review', {})
            if not isinstance(source, str) or not isinstance(review, dict):
                raise ValueError('STORY_REQUIRES_READ_ORIGINAL_SOURCE')
            url = urlparse(source)
            changes = review.get('fictional_changes')
            if url.scheme != 'https' or not url.hostname or url.username or url.path in ('', '/') or review.get('access') not in ('public_full_body_read', 'authorized_full_body_read') or not review.get('original_conflict') or not isinstance(changes, list) or not changes or not all(isinstance(change, str) and change.strip() for change in changes):
                raise ValueError('STORY_REQUIRES_READ_ORIGINAL_SOURCE')
            if STORY_DISCLOSURE not in story.get('body', ''):
                raise ValueError('STORY_ADAPTATION_DISCLOSURE_REQUIRED')
    return count


def prepare(payload, day):
    local_day = date.fromisoformat(day)
    posts = payload['posts']
    count = posts_per_city(posts)
    if len({key(p) for p in posts}) != len(posts):
        raise ValueError('DUPLICATE_CITY_TITLE')
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    if '$GLING$' in encoded:
        raise ValueError('INVALID_SQL_DELIMITER')
    queued = json.loads(json.dumps(posts))
    for post in queued:
        if not post.get('author_nickname') or not post.get('title') or not post.get('body'):
            raise ValueError('MISSING_AUTHOR_TITLE_BODY')
        name, address = post.get('place_name', ''), post.get('place_address', '')
        if address and not name:
            raise ValueError('PLACE_ADDRESS_REQUIRES_NAME')
        if name:
            if not isinstance(name, str) or not isinstance(address, str) or re.search(r'[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]', name + address):
                raise ValueError('PLACE_REQUIRES_OFFICIAL_ROMAN_NAME')
            display = post.get('place_display_name', name)
            if not re.search('[A-Za-z]', name) or not isinstance(display, str) or not display.strip() or display not in post['title'] + '\n' + post['body']:
                raise ValueError('PLACE_DISPLAY_NAME_MISSING_FROM_PROSE')
            if 'Google 지도:' in post['body']:
                raise ValueError('DUPLICATE_MAP_MARKER')
            query = ', '.join(part for part in [name.strip(), address.strip(), CITIES[post['city_id']][0], 'Canada'] if part)
            url = 'https://www.google.com/maps/search/?' + urlencode({'api': '1', 'query': query})
            if len(url) > 2048:
                raise ValueError('MAP_URL_TOO_LONG')
            post['body'] = post['body'].rstrip() + '\n\nGoogle 지도: ' + url
        if len(post['title']) > 80 or len(post['body']) > 4000:
            raise ValueError('POST_TOO_LONG')

    rng, used = random.Random(day), []
    by_city = {city: sorted((p for p in queued if p['city_id'] == city), key=lambda p: p['ord']) for city in CITIES}
    if count == 6:
        for city_posts in by_city.values():
            rng.shuffle(city_posts)
    band_minutes = 720 // count
    for band in range(count):
        cities = list(CITIES)
        rng.shuffle(cities)
        for city in cities:
            post = by_city[city][band]
            start = datetime.combine(local_day, time(9), ZoneInfo(CITIES[city][1]))
            for _ in range(1000):
                # 마지막 구간은 polling·재진입 지연 뒤에도21시 전에 게시되도록 여유를 둔다.
                at = (start + timedelta(minutes=band * band_minutes + rng.randrange(band_minutes - 15 if band == count - 1 else band_minutes))).astimezone(timezone.utc)
                if all(abs((at - previous).total_seconds()) >= 600 for previous in used):
                    break
            else:
                raise ValueError('NO_SEPARATE_PUBLICATION_SLOT')
            used.append(at)
            post['publish_at'] = at.isoformat()
    return {'queue_version': 1 if count == 5 else 2, 'day': day, 'source_sha256': hashlib.sha256(encoded.encode()).hexdigest(), 'posts': queued}


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + f'.{os.getpid()}.tmp')
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def stage(source, destination, day):
    queued = prepare(json.loads(Path(source).read_text()), day)
    destination = Path(destination)
    if destination.exists():
        current = json.loads(destination.read_text())
        if current != queued:
            raise ValueError('EXISTING_QUEUE_DIFFERS_KEEP_ORIGINAL_ATTEMPTS')
        return
    save(destination, queued)


def due(payload, day, receipts, now=None):
    now = now or datetime.now(timezone.utc)
    if payload.get('queue_version') not in (1, 2) or payload.get('day') != day or str(now.astimezone(ZoneInfo('America/Vancouver')).date()) != day:
        return None
    attempted = [datetime.fromisoformat(row['attempted_at']) for row in receipts.values() if row.get('attempted_at')]
    if attempted and (now - max(attempted)).total_seconds() < 300:
        return None
    posts = sorted(payload['posts'], key=lambda p: p['publish_at'])
    if posts_per_city(posts) != (5 if payload['queue_version'] == 1 else 6) or len({key(p) for p in posts}) != len(posts):
        raise ValueError('INVALID_QUEUE_POST_COUNT')
    previous = None
    for post in posts:
        at = datetime.fromisoformat(post['publish_at'])
        local = at.astimezone(ZoneInfo(CITIES[post['city_id']][1]))
        if str(local.date()) != day or not 9 <= local.hour < 21:
            raise ValueError('INVALID_CITY_PUBLICATION_TIME')
        if previous and (at - previous).total_seconds() < 600:
            raise ValueError('CITY_PUBLICATION_TIMES_TOO_CLOSE')
        previous = at
    for post in posts:
        at = datetime.fromisoformat(post['publish_at'])
        current = now.astimezone(ZoneInfo(CITIES[post['city_id']][1]))
        if at <= now and key(post) not in receipts and str(current.date()) == day and 9 <= current.hour < 21:
            return post
    return None


def main():
    command = sys.argv[1]
    if command == 'stage':
        stage(*sys.argv[2:5])
    elif command == 'due':
        source, day, receipt = sys.argv[2:5]
        receipts = json.loads(Path(receipt).read_text()) if Path(receipt).exists() else {}
        post = due(json.loads(Path(source).read_text()), day, receipts)
        print(json.dumps([post] if post else [], ensure_ascii=False))
    elif command in ['attempt', 'confirm']:
        receipt, payload = sys.argv[2:4]
        post = json.loads(payload)[0]
        receipts = json.loads(Path(receipt).read_text()) if Path(receipt).exists() else {}
        at = datetime.now(timezone.utc).isoformat()
        if command == 'attempt':
            if key(post) in receipts:
                raise ValueError('ALREADY_ATTEMPTED_DO_NOT_RESUBMIT')
            receipts[key(post)] = {'status': 'attempted', 'attempted_at': at}
        else:
            result = json.load(sys.stdin)
            if not isinstance(result, list) or len(result) != 1 or result[0].get('city_id') != post['city_id'] or result[0].get('title') != post['title'] or result[0].get('author_nickname') != post['author_nickname'] or not result[0].get('id') or not result[0].get('created_at'):
                raise ValueError('PUBLICATION_READBACK_UNVERIFIED_KEEP_ATTEMPT')
            receipts[key(post)].update(status='confirmed', confirmed_at=at, post_id=result[0]['id'], created_at=result[0]['created_at'])
        save(receipt, receipts)
    else:
        raise ValueError('UNKNOWN_COMMAND')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError) as error:
        sys.exit(f'FAIL {error}')
