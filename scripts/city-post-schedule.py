#!/usr/bin/env python3
"""기존 city-posts LaunchAgent용 일일 원고·분산 시각·제출 영수증."""
import hashlib
import json
import os
import random
import re
import sys
import uuid
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


def key(post):
    return post['city_id'] + '\n' + post['title']


def validate_story_poll(post):
    if post.get('content_kind') != 'community_story':
        if post.get('poll') is not None:
            raise ValueError('INVALID_STORY_POLL_OR_FAMILY_BINDING')
        return
    poll, fit = post.get('poll'), post.get('story_fit')
    if not isinstance(poll, dict) or not isinstance(fit, dict):
        raise ValueError('INVALID_STORY_POLL_OR_FAMILY_BINDING')
    question, options = poll.get('question'), poll.get('options')
    if (not isinstance(question, str) or not 1 <= len(question.strip()) <= 120
            or not isinstance(options, list) or not 2 <= len(options) <= 6
            or any(not isinstance(v, str) or not 1 <= len(v.strip()) <= 80 for v in options)
            or len({v.strip() for v in options}) != len(options)
            or not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', str(post.get('post_id', '')), re.I)
            or not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', str(fit.get('profile_id', '')), re.I)
            or not isinstance(fit.get('family'), dict) or not fit['family']
            or not isinstance(fit.get('topic'), str) or not fit['topic'].strip()):
        raise ValueError('INVALID_STORY_POLL_OR_FAMILY_BINDING')


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
        validate_story_poll(post)
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


def save(path, value, exclusive=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + f'.{os.getpid()}.tmp')
    try:
        with temporary.open('w') as stream:
            stream.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        if exclusive:
            os.link(temporary, path)
        else:
            os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def stage(source, destination, day, registry=None):
    queued = prepare(json.loads(Path(source).read_text()), day)
    destination = Path(destination)
    if destination.exists() and json.loads(destination.read_text()) == queued:
        return
    stories = [p for p in queued['posts'] if p.get('content_kind') == 'community_story']
    if stories:
        registry = Path(registry or Path(__file__).resolve().parents[1] / 'marketing/community-story-sources.json')
        owned = json.loads(registry.read_text()).get('personal_threads_cases', [])
        for post in stories:
            case = post.get('source_case_key')
            if not case or post['post_id'] != str(uuid.uuid5(uuid.NAMESPACE_URL, 'gling-story:' + case)):
                raise ValueError('STABLE_STORY_CASE_ID_REQUIRED')
            if any(case == row.get('source_case_key') or post['source'] == row.get('source_url') or post['post_id'] == row.get('planned_post_id') for row in owned):
                raise ValueError('PERSONAL_STORY_CASE_OWNED_BY_OTHER_PIPELINE')
        if len({p['post_id'] for p in stories}) != len(stories):
            raise ValueError('DUPLICATE_STORY_CASE')
    try:
        save(destination, queued, exclusive=True)
    except FileExistsError:
        current = json.loads(destination.read_text())
        if current != queued:
            raise ValueError('EXISTING_QUEUE_DIFFERS_KEEP_ORIGINAL_ATTEMPTS')


def read_receipts(path):
    path = Path(path)
    records = json.loads(path.read_text()) if path.exists() else {}
    # Per-post receipts cannot lose another process's attempt or confirmation.
    for item in sorted(path.with_name(path.name + '.d').glob('*.json')):
        records.update(json.loads(item.read_text()))
    return records


def post_receipt(path, post):
    path = Path(path)
    return path.with_name(path.name + '.d') / (hashlib.sha256(key(post).encode()).hexdigest() + '.json')


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
    if command == 'validate-stories':
        for post in json.load(sys.stdin):
            validate_story_poll(post)
    elif command == 'stage':
        stage(*sys.argv[2:])
    elif command == 'stage-raw':
        source, destination = map(Path, sys.argv[2:4])
        value = json.loads(source.read_text())
        try:
            save(destination, value, exclusive=True)
        except FileExistsError:
            if json.loads(destination.read_text()) != value:
                raise ValueError('EXISTING_QUEUE_KEEP_ORIGINAL_ATTEMPTS')
    elif command == 'due':
        source, day, receipt = sys.argv[2:5]
        receipts = read_receipts(receipt)
        post = due(json.loads(Path(source).read_text()), day, receipts)
        print(json.dumps([post] if post else [], ensure_ascii=False))
    elif command in ['attempt', 'confirm']:
        receipt, payload = sys.argv[2:4]
        posts = json.loads(payload)
        if not isinstance(posts, list) or len(posts) != 1:
            raise ValueError('EXACTLY_ONE_POST_REQUIRED')
        post = posts[0]
        receipts = read_receipts(receipt)
        at = datetime.now(timezone.utc).isoformat()
        if command == 'attempt':
            if key(post) in receipts:
                raise ValueError('ALREADY_ATTEMPTED_DO_NOT_RESUBMIT')
            receipts[key(post)] = {'status': 'attempted', 'attempted_at': at}
        else:
            result = json.load(sys.stdin)
            if not isinstance(result, list) or len(result) != 1 or result[0].get('city_id') != post['city_id'] or result[0].get('title') != post['title'] or result[0].get('author_nickname') != post['author_nickname'] or not result[0].get('id') or not result[0].get('created_at') or (post.get('post_id') and result[0]['id'] != post['post_id']):
                raise ValueError('PUBLICATION_READBACK_UNVERIFIED_KEEP_ATTEMPT')
            receipts[key(post)].update(status='confirmed', confirmed_at=at, post_id=result[0]['id'], created_at=result[0]['created_at'])
        try:
            save(post_receipt(receipt, post), {key(post): receipts[key(post)]}, exclusive=command == 'attempt')
        except FileExistsError:
            raise ValueError('ALREADY_ATTEMPTED_DO_NOT_RESUBMIT') from None
    else:
        raise ValueError('UNKNOWN_COMMAND')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError) as error:
        sys.exit(f'FAIL {error}')
