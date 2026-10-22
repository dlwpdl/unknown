"""Read-only calendar checks; see launch-kit.md for the operating procedure.

ponytail: prelaunch Instagram/Threads only; extend the contract at public launch.
Live account ownership, queue reconciliation and content accuracy still need review.
"""
import csv
import re
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


def check(rows):
    errors = []
    seen_ids, seen_copy, seen_refs = set(), set(), set()
    if not rows:
        return ["empty calendar"]
    for row in rows:
        ident = row.get('content_id', '')
        def require(condition, message):
            if not condition:
                errors.append(f"{ident or '(missing ID)'}: {message}")
        require(re.fullmatch(r'GL-(?:P|BT)\d{3,}', ident) and ident not in seen_ids, 'missing/duplicate content_id')
        seen_ids.add(ident)
        platform = row.get('platform', '')
        require(platform in {'instagram', 'threads'}, 'unsupported platform')
        copy = ' '.join(row.get('copy', '').split())
        require(copy and (platform, copy) not in seen_copy, 'empty/duplicate copy on platform')
        seen_copy.add((platform, copy))
        require(not re.search(r'\{\{|\}\}|\[(?:TODO|TBD|링크|이름)\]', copy), 'unrendered variable')
        placement = row.get('link_placement', '')
        require(placement in {'profile', 'body', 'none'}, 'unknown link_placement')
        url = row.get('link', '')
        if placement == 'none':
            require(not url, 'unused link must be empty')
        else:
            try:
                parts = urlsplit(url)
            except ValueError:
                require(False, 'invalid URL')
                continue
            query = parse_qs(parts.query, keep_blank_values=True)
            content = 'profile' if placement == 'profile' else ident.lower().replace('-', '_')
            story_link = (platform == 'threads' and row.get('account_handle') == 'chalkakandupload'
                          and placement == 'body' and not parts.fragment
                          and re.fullmatch(r'/share/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', parts.path, re.I))
            require(parts.scheme == 'https' and parts.netloc == 'gling.ej-entertainment.com'
                    and (parts.path in {'', '/'} or story_link), 'wrong Gling destination')
            require(query == ({} if story_link else {'utm_source': [platform], 'utm_medium': ['organic_social'],
                                                    'utm_campaign': ['prelaunch'], 'utm_content': [content]}),
                    'UTM mismatch or unknown query field')
        status = row.get('status', '')
        require(status in {'draft', 'ready', 'scheduled', 'published', 'blocked', 'cancelled'}, 'unknown status')
        if status in {'ready', 'scheduled', 'published'}:
            require(bool(row.get('account_handle')), 'account verification missing')
            if row.get('format') != 'text':
                asset = row.get('asset_path', '')
                require(bool(asset) and (Path(__file__).parent.parent / asset).is_file(), 'asset missing')
        ref = row.get('publish_ref', '')
        if ref:
            require((platform, ref) not in seen_refs, 'duplicate publish_ref')
            seen_refs.add((platform, ref))
        if status in {'scheduled', 'published'}:
            require(bool(ref), 'reservation/publication receipt missing')
            require(bool(row.get('published_at' if status == 'published' else 'scheduled_at')), 'action timestamp missing')
        values = [row.get(k, '') for k in ('reach', 'profile_visits', 'link_clicks', 'waitlist_requests')]
        require(all(v == '' or re.fullmatch(r'\d+', v) for v in values), 'metrics must be blank or nonnegative integers')
        measured = any(v != '' for v in values)
        state = row.get('measurement_status', '')
        require(state in {'not_collected', 'partial', 'observed', 'unavailable'}, 'unknown measurement_status')
        require(measured == (state in {'partial', 'observed'}), 'metric/state mismatch; missing is not zero')
        if measured:
            require(bool(row.get('observed_at') and row.get('metric_source')), 'measurement evidence missing')
        for key in ('scheduled_at', 'published_at', 'observed_at'):
            if row.get(key):
                try:
                    stamp = datetime.fromisoformat(row[key].replace('Z', '+00:00'))
                    require(stamp.utcoffset() is not None, f'{key} timezone missing')
                except ValueError:
                    require(False, f'{key} invalid timestamp')
    return errors


def self_test():
    row = dict(content_id="GL-P002", platform="threads", copy="동네 질문을 나눠요.",
               status="draft", link_placement="body", measurement_status="not_collected",
               link="https://gling.ej-entertainment.com/?utm_source=threads&"
                    "utm_medium=organic_social&utm_campaign=prelaunch&utm_content=gl_p002")
    assert check([row]) == []
    brand = dict(row, content_id='GL-BT045', link_placement='none', link='')
    assert not check([brand]), 'official Threads IDs keep their original namespace'
    assert check([brand, brand]), 'official Threads IDs must stay unique'
    assert check([dict(brand, content_id='GL-BX045')]), 'unknown ID namespace'
    cases = [
        ("duplicate id", [row, row]),
        ("duplicate copy", [row, dict(row, content_id="GL-P003", link=row['link'].replace('gl_p002', 'gl_p003'))]),
        ("wrong destination", [dict(row, link=row['link'].replace('gling.', 'rottery.'))]),
        ("wrong UTM source", [dict(row, link=row['link'].replace('source=threads', 'source=instagram'))]),
        ("unrendered variable", [dict(row, copy="안녕하세요 {{first_name}}")]),
        ("unsupported publication", [dict(row, status="published")]),
        ("unobserved zero", [dict(row, reach="0")]),
        ("observed without evidence", [dict(row, reach="0", measurement_status="observed")]),
        ("per-post profile attribution", [dict(row, link_placement="profile")]),
        ("malformed URL", [dict(row, link="https://[invalid")]),
    ]
    for name, rows in cases:
        assert check(rows), name
    measured = dict(row, reach="0", measurement_status="partial",
                    observed_at="2026-09-09T14:00:00-07:00", metric_source="local-test-only")
    assert not check([measured]), "evidenced zero must remain zero"
    assert measured['reach'] == "0" and 'link_clicks' not in measured
    assert check([dict(measured, reach="-1")]), "negative metric"
    assert check([dict(measured, observed_at="2026-09-09T14:00:00")]), "timezone missing"
    assert check([dict(row, link=row['link']+'&email=private@example.com')]), "unknown query field"
    assert check([]), "empty queue is not success"
    story = dict(row, account_handle='chalkakandupload',
                 link='https://gling.ej-entertainment.com/share/12345678-1234-1234-1234-123456789abc')
    assert not check([story]), 'personal Threads accepts the existing post share URL'
    for invalid in [dict(story, account_handle='gling.app'), dict(story, platform='instagram'),
                    dict(story, link_placement='profile'), dict(story, link=story['link']+'?next=https://evil.test'),
                    dict(story, link=story['link']+'#private'), dict(story, link=story['link']+'/private'),
                    dict(story, link=story['link'].replace('12345678-', 'invalid-')),
                    dict(story, link=story['link'].replace('https:', 'http:')),
                    dict(story, link=story['link'].replace('gling.ej-entertainment.com', 'gling.ej-entertainment.com.evil.test'))]:
        assert check([invalid]), 'reject unsafe or unrelated post links'
    print("PASS: calendar validation self-test (synthetic data; no network or publication)")


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        self_test()
    else:
        with Path(__file__).with_name("social-calendar.csv").open(encoding="utf-8-sig", newline="") as f:
            rows = list(csv.DictReader(f))
        errors = check(rows)
        print("\n".join(errors) if errors else f"PASS: {len(rows)} calendar rows; local consistency only, publication not verified")
        sys.exit(bool(errors))
