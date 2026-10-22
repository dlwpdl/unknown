"""Gling Shorts in the existing G9 queue; credentials and once receipts stay private."""
import argparse
import fcntl
import json
import os
import re
import stat
import subprocess
import time
import uuid
from datetime import datetime, timedelta, timezone
from fractions import Fraction
from pathlib import Path

import requests

from meta_api import (INSTAGRAM_AUTOMATION, MetaError, date, digest, now_utc, once,
                      private_json, validate_reel_master)

ROOT = Path.home() / 'Library/Application Support/gling/operations/youtube'
CHANNEL = 'UCPr7LdLmf9g0BqyPYrdh1dg'
LEDGER = Path(__file__).with_name('festival-content-ledger.json')
API = 'https://www.googleapis.com/youtube/v3/'
UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos'
TOKEN_URL = 'https://oauth2.googleapis.com/token'
SCOPES = {'https://www.googleapis.com/auth/youtube.upload',
          'https://www.googleapis.com/auth/youtube.readonly'}
PROTECTED = ('held', 'hold', 'uncertain', 'sending', 'attempted_at', 'native_receipt', 'native_scheduled_saved')
BINDINGS = ('platform', 'account', 'content_id', 'scheduled_for', 'source_record', 'video_sha256',
            'source_manifest_sha256', 'gling_post_id', 'metadata_sha256', 'final_review_sha256')
LINK = re.compile(r'(?i)(?:[a-z]+://|www\.|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b)')


def metadata(intent):
    return {'snippet': {'title': intent['title'], 'description': intent['description'],
                       'categoryId': '22', 'defaultLanguage': 'ko'},
            'status': {'privacyStatus': 'public',
                       'selfDeclaredMadeForKids': intent['made_for_kids'],
                       'containsSyntheticMedia': intent['contains_synthetic_media']}}


def metadata_hash(intent):
    return digest(json.dumps(metadata(intent), ensure_ascii=False, sort_keys=True,
                             separators=(',', ':')).encode())


def receipt_path(intent):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,120}', intent.get('content_id', '')):
        raise MetaError('unsafe_content_id')
    attempt = intent.get('upload_attempt', '')
    if not isinstance(attempt, str) or attempt and not re.fullmatch(r'[A-Za-z0-9_-]{1,40}', attempt):
        raise MetaError('unsafe_youtube_upload_attempt')
    return ROOT / 'publishing' / (intent['content_id'] + ('.' + attempt if attempt else '') + '.upload.json')


def probe_short(filename):
    result = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'json', str(filename)],
        capture_output=True, text=True, timeout=5, check=True)
    info = json.loads(result.stdout)
    video = info['streams'][0]
    if (video['width'], video['height']) != (1080, 1920) or Fraction(video['r_frame_rate']) != 30 \
            or not 0 < float(info['format']['duration']) <= 180:
        raise MetaError('youtube_short_requires_1080x1920_30fps_up_to_180s')


def validate_intent(intent, now):
    if intent.get('platform') != 'youtube' or intent.get('account') != CHANNEL \
            or intent.get('automation_id') != INSTAGRAM_AUTOMATION:
        raise MetaError('wrong_youtube_account')
    receipt_path(intent)
    if intent.get('status') != 'api_ready' or intent.get('submission_kind') != 'api_local_queue' \
            or any(intent.get(k) for k in (*PROTECTED, 'public_id', 'probe')):
        raise MetaError('protected_youtube_intent')
    if not isinstance(intent.get('title'), str) or not intent['title'].strip() or len(intent['title']) > 100 \
            or any(c in intent['title'] for c in '<>') \
            or not isinstance(intent.get('description'), str) or not intent['description'].strip() \
            or len(intent['description'].encode()) > 5000 \
            or any(type(intent.get(k)) is not bool for k in ('made_for_kids', 'contains_synthetic_media')):
        raise MetaError('invalid_youtube_metadata')
    if metadata_hash(intent) != intent.get('metadata_sha256'):
        raise MetaError('youtube_metadata_changed')
    if not re.fullmatch(r'.+ \| 캐나다 [가-힣]+에서 가야 하는 [가-힣· ]+!', intent['title']) \
            or LINK.search(intent['description']) \
            or not all(word in intent['description'] for word in ('채널 프로필', '다운로드')):
        raise MetaError('youtube_shorts_copy_policy')
    approval = json.loads(Path(intent['approval_receipt']).read_text())
    if approval.get('kind') != 'morning_batch' or not approval.get('owner_quote') \
            or approval.get('approved_at') != intent.get('approved_at') \
            or date(intent['approved_at']) > now or date(intent['scheduled_for']) <= date(intent['approved_at']):
        raise MetaError('youtube_final_owner_approval_required')
    matches = [item for item in approval.get('items', []) if all(
        item.get(k) == intent.get(k) and intent.get(k) for k in BINDINGS) and all(
        item.get(k) == intent.get(k) for k in ('upload_attempt', 'replaces_video_id',
                                              'thumbnail_policy', 'cover_sha256'))]
    if len(matches) != 1:
        raise MetaError('exact_youtube_approval_required')
    if intent.get('upload_attempt') or intent.get('replaces_video_id'):
        if not intent.get('upload_attempt') or not re.fullmatch(r'[A-Za-z0-9_-]{11}', intent.get('replaces_video_id', '')):
            raise MetaError('youtube_previous_upload_reconcile_first')
        if intent['replaces_video_id'] in approval.get('protected_video_ids', []):
            raise MetaError('protected_youtube_video')
        previous = private_read(receipt_path({'content_id': intent['content_id']}))
        if previous.get('status') != 'response_received' \
                or previous.get('response', {}).get('id') != intent['replaces_video_id'] \
                or any(previous.get('intent', {}).get(k) != intent.get(k) for k in
                       ('content_id', 'account', 'video_sha256', 'source_manifest_sha256')):
            raise MetaError('youtube_previous_upload_reconcile_first')
    validate_reel_master(intent)
    review_data = Path(intent['final_review_receipt']).read_bytes()
    if digest(review_data) != intent.get('final_review_sha256'):
        raise MetaError('youtube_final_review_changed')
    if json.loads(review_data).get('youtube_rights_verified') is not True:
        raise MetaError('youtube_rights_not_verified_for_this_master')
    probe_short(intent['video_file'])


def source_row(intent, data):
    matches = [row for row in data['events'] if row.get('content_id') == intent['content_id']]
    if len(matches) != 1:
        raise MetaError('youtube_source_record_missing_or_duplicated')
    row = matches[0]
    channel = row.get('channels', {}).get('youtube', {})
    if any(r.get(k) for r in (row, channel) for k in (*PROTECTED, 'deleted_at')) or any(
            r.get('status') in ('held', 'cancelled', 'removed', 'deleted') for r in (row, channel)):
        raise MetaError('protected_source_reconcile_first')
    return row, channel


def validate_source(intent):
    filename, sep, content_id = intent.get('source_record', '').rpartition('#')
    if not sep or content_id != intent['content_id']:
        raise MetaError('youtube_source_record_required')
    row, channel = source_row(intent, json.loads(Path(filename).read_text()))
    if channel.get('api_intent') != intent:
        raise MetaError('youtube_source_intent_changed')


def private_read(path):
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW)) as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise MetaError('unsafe_youtube_private_file')
        return json.load(stream)


class YouTubeClient:
    def __init__(self, budget=30):
        self.deadline = time.monotonic() + budget
        self.session = requests.Session()
        self.session.trust_env = False
        token = private_read(ROOT / 'token.json')
        config = private_read(ROOT / 'client-secret.json')['installed']
        if config.get('project_id') != 'gling-5ab6a' or token.get('client_id') != config.get('client_id') \
                or token.get('client_secret') != config.get('client_secret') \
                or token.get('token_uri') != TOKEN_URL or set(token.get('scopes', [])) != SCOPES:
            raise MetaError('youtube_oauth_project_or_scopes_mismatch')
        expiry = datetime.fromisoformat(token.get('expiry', '1970-01-01').replace('Z', '+00:00'))
        if expiry.replace(tzinfo=expiry.tzinfo or timezone.utc) <= now_utc() + timedelta(minutes=2):
            response = self.request('POST', TOKEN_URL, data={'grant_type': 'refresh_token',
                'refresh_token': token['refresh_token'], 'client_id': token['client_id'],
                'client_secret': token['client_secret']})
            if not response.get('access_token') or response.get('scope') and set(response['scope'].split()) != SCOPES:
                raise MetaError('youtube_refresh_scope_mismatch')
            token.update(token=response['access_token'], expiry=(now_utc() +
                timedelta(seconds=int(response['expires_in']))).isoformat())
            private_json(ROOT / 'token.json', token)
        self.session.headers['Authorization'] = 'Bearer ' + token['token']

    def request(self, method, url, **kwargs):
        remaining = self.deadline - time.monotonic()
        if remaining < 1:
            raise MetaError('youtube_original_step_budget_exhausted')
        try:
            response = self.session.request(method, url, allow_redirects=False,
                timeout=(min(5, remaining / 2), min(20, remaining / 2)), **kwargs)
            if response.status_code not in (200, 201):
                raise MetaError('youtube_http_' + str(response.status_code))
            return response.json()
        except (requests.RequestException, ValueError):
            raise MetaError('youtube_response_unknown_no_automatic_retry') from None

    def identity(self):
        data = self.request('GET', API + 'channels', params={'part': 'id,snippet', 'mine': 'true'})
        if [row.get('id') for row in data.get('items', [])] != [CHANNEL]:
            raise MetaError('live_youtube_channel_identity_mismatch')
        return {'channel_id': CHANNEL, 'title': data['items'][0]['snippet']['title']}

    def ensure_upload_slot(self, intent):
        remaining = self.deadline - time.monotonic()
        elapsed = (now_utc() - date(intent['scheduled_for'])).total_seconds()
        if remaining < 1 or not 0 <= elapsed < 300 or elapsed + remaining + 2 >= 300:
            raise MetaError('youtube_original_upload_slot_expired_or_too_tight')

    def upload(self, intent):
        # shortcut: one bounded multipart upload up to256MiB; use resumable if approved Shorts outgrow this budget.
        path = Path(intent['video_file'])
        if not 0 < path.stat().st_size <= 256 * 1024 * 1024:
            raise MetaError('youtube_multipart_size_requires_resumable_review')
        video = path.read_bytes()
        if digest(video) != intent['video_sha256']:
            raise MetaError('changed_rendered_video')
        boundary = 'gling-' + uuid.uuid4().hex
        body = ('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
                json.dumps(metadata(intent), ensure_ascii=False) + '\r\n--' + boundary +
                '\r\nContent-Type: video/mp4\r\n\r\n').encode() + video + ('\r\n--' + boundary + '--\r\n').encode()
        validate_source(intent)
        self.ensure_upload_slot(intent)
        return self.request('POST', UPLOAD, params={'part': 'snippet,status', 'uploadType': 'multipart',
            'notifySubscribers': 'false'}, headers={'Content-Type': 'multipart/related; boundary=' + boundary}, data=body)

    def video(self, video_id):
        rows = self.request('GET', API + 'videos', params={'part': 'snippet,status,processingDetails',
                                                        'id': video_id}).get('items', [])
        if len(rows) != 1:
            raise MetaError('youtube_uploaded_video_readback_missing')
        return rows[0]

    def set_thumbnail(self, intent, video_id):
        cover = Path(intent['cover_file']).read_bytes()
        if intent.get('cover_first_frame_verified') is not True \
                or digest(cover) != intent.get('cover_sha256') \
                or not 0 < len(cover) <= 50 * 1024 * 1024 \
                or not (cover.startswith(b'\x89PNG\r\n\x1a\n') or cover.startswith(b'\xff\xd8')):
            raise MetaError('youtube_exact_first_cover_required')
        receipt = receipt_path(intent).with_suffix('.thumbnail.json')
        context = {'video_id': video_id, 'channel_id': CHANNEL, 'cover_sha256': intent['cover_sha256']}
        if receipt.exists():
            record = private_read(receipt)
            if record.get('status') != 'response_received' or any(record.get(k) != v for k, v in context.items()):
                raise MetaError('youtube_thumbnail_uncertain_reconcile_without_resending')
            response = record.get('response', {})
        else:
            validate_source(intent)
            response = once(receipt, context, lambda: self.request('POST',
                'https://www.googleapis.com/upload/youtube/v3/thumbnails/set',
                params={'videoId': video_id, 'uploadType': 'media'},
                headers={'Content-Type': 'image/png' if cover.startswith(b'\x89PNG') else 'image/jpeg'}, data=cover))
        if not response.get('items') or not isinstance(response['items'][0], dict):
            raise MetaError('youtube_thumbnail_response_unconfirmed')
        return {'status': 'api_accepted', 'cover_sha256': intent['cover_sha256'],
                'returned_thumbnails': response['items'][0], 'observed_at': now_utc().isoformat()}


def advance(intent, now, client):
    validate_intent(intent, now)
    validate_source(intent)
    receipt = receipt_path(intent)
    if receipt.exists():
        record = private_read(receipt)
        if record.get('intent') != intent or record.get('status') != 'response_received' \
                or not record.get('response', {}).get('id'):
            raise MetaError('youtube_uncertain_upload_reconcile_without_resending')
        response = record['response']
    else:
        if not 0 <= (now - date(intent['scheduled_for'])).total_seconds() < 300:
            raise MetaError('youtube_original_upload_slot_required')
        client.identity()
        validate_source(intent)
        if intent.get('replaces_video_id'):
            previous = client.request('GET', API + 'videos', params={
                'part': 'id,status', 'id': intent['replaces_video_id']})
            if previous.get('items') != []:
                raise MetaError('youtube_previous_video_still_present_no_reupload')
        client.ensure_upload_slot(intent)
        response = once(receipt, {'intent': intent, 'platform': 'youtube', 'channel_id': CHANNEL},
                        lambda: client.upload(intent))
    video_id = response.get('id', '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{11}', video_id):
        raise MetaError('youtube_uncertain_upload_reconcile_without_resending')
    video = client.video(video_id)
    snippet, status = video.get('snippet', {}), video.get('status', {})
    if video.get('id') != video_id or snippet.get('channelId') != CHANNEL \
            or snippet.get('title') != intent['title'] or snippet.get('description') != intent['description']:
        raise MetaError('youtube_uploaded_video_readback_mismatch')
    processing = video.get('processingDetails', {}).get('processingStatus')
    failed = status.get('uploadStatus') in ('failed', 'rejected', 'deleted') or \
        processing in ('failed', 'terminated')
    processed = status.get('uploadStatus') == 'processed' and processing in (None, 'succeeded')
    remote_schedule = bool(status.get('publishAt'))
    public = status.get('privacyStatus') == 'public' and processed and not failed and not remote_schedule
    result = {'status': 'upload_failed_or_rejected' if failed else 'public_verified' if public else
              'legacy_remote_schedule_requires_reconciliation' if remote_schedule else 'uploaded_visibility_unconfirmed',
        'content_id': intent['content_id'], 'channel_id': CHANNEL, 'video_id': video_id,
        'url': 'https://www.youtube.com/shorts/' + video_id, 'public_verified': public,
        'scheduled_for': intent['scheduled_for'], 'observed_at': now_utc().isoformat(),
        'upload_status': status.get('uploadStatus'), 'processing': video.get('processingDetails', {}).get('processingStatus')}
    private_json(receipt.with_suffix('.readback.json'), result)
    if public and intent.get('thumbnail_policy') == 'first_cover_api':
        result['thumbnail'] = client.set_thumbnail(intent, video_id)
        private_json(receipt.with_suffix('.readback.json'), result)
    return result


def due(now=None, ledger=LEDGER, budget=30):
    deadline = time.monotonic() + budget
    now = now or now_utc()
    candidates, held, queued = [], [], 0
    for row in json.loads(Path(ledger).read_text())['events']:
        intent = row.get('channels', {}).get('youtube', {}).get('api_intent')
        if not intent:
            continue
        queued += 1
        if not isinstance(intent, dict):
            held.append({'content_id': row.get('content_id'), 'error': 'invalid_youtube_intent'})
            continue
        try:
            # Holds and cancellations take precedence over future waiting and saved proof.
            validate_source(intent)
            receipt = receipt_path(intent)
            readback = receipt.with_suffix('.readback.json')
            proof = private_read(readback) if readback.exists() else {}
            if proof.get('status') in ('scheduled_verified', 'legacy_remote_schedule_requires_reconciliation'):
                raise MetaError('legacy_remote_schedule_requires_reconciliation_not_cancelled')
            thumbnail_pending = proof.get('public_verified') and intent.get('thumbnail_policy') == 'first_cover_api' \
                and proof.get('thumbnail', {}).get('status') != 'api_accepted'
            if proof.get('public_verified') and not thumbnail_pending or proof.get('status') == 'upload_failed_or_rejected':
                continue
            if receipt.exists():
                record = private_read(receipt)
                if record.get('intent') != intent or record.get('status') != 'response_received' \
                        or not re.fullmatch(r'[A-Za-z0-9_-]{11}', record.get('response', {}).get('id', '')):
                    raise MetaError('youtube_uncertain_upload_reconcile_without_resending')
                validate_intent(intent, now)
                observed = date(proof['observed_at']) if proof.get('observed_at') else \
                    datetime.min.replace(tzinfo=timezone.utc)
                candidates.append((2 if thumbnail_pending else 1, observed, intent))
            else:
                elapsed = (now - date(intent['scheduled_for'])).total_seconds()
                if elapsed < 0:
                    continue
                if elapsed >= 300:
                    raise MetaError('youtube_original_upload_slot_expired_or_too_tight')
                validate_intent(intent, now)
                candidates.append((0, date(intent['scheduled_for']), intent))
        except (MetaError, OSError, ValueError, KeyError, TypeError, IndexError, AttributeError, subprocess.SubprocessError) as error:
            held.append({'content_id': intent.get('content_id'),
                         'error': str(error) if isinstance(error, MetaError) else type(error).__name__})
    if candidates:
        remaining = deadline - time.monotonic()
        if remaining < 1:
            raise MetaError('youtube_original_step_budget_exhausted')
        client = YouTubeClient(remaining)
        for _, _, intent in sorted(candidates, key=lambda row: row[:2]):
            try:
                result = advance(intent, now, client)
                if held:
                    result.update(protected_attempts=len(held), held_items=held)
                return result
            except (MetaError, OSError, ValueError, KeyError, TypeError, IndexError, AttributeError, subprocess.SubprocessError) as error:
                held.append({'content_id': intent['content_id'],
                             'error': str(error) if isinstance(error, MetaError) else type(error).__name__})
    return {'status': 'youtube_upload_held_for_reconciliation' if held else
            'no_youtube_action_due' if queued else 'no_approved_youtube_record',
            'protected_attempts': len(held), 'held_items': held, 'backfill_allowed': False}


def plan(approval_path, now=None, ledger=LEDGER):
    now = now or now_utc()
    ledger = Path(ledger).resolve()
    approval_path = Path(approval_path).resolve()
    approval = json.loads(approval_path.read_text())
    items = [dict(item, approval_receipt=str(approval_path), approved_at=approval['approved_at'])
             for item in approval.get('items', []) if item.get('platform') == 'youtube' and item.get('account') == CHANNEL]
    if not items or len({item['content_id'] for item in items}) != len(items):
        raise MetaError('exact_youtube_approval_required')
    for intent in items:
        filename, sep, content_id = intent.get('source_record', '').rpartition('#')
        if not sep or content_id != intent['content_id'] or Path(filename).resolve() != ledger:
            raise MetaError('youtube_source_record_required')
        validate_intent(intent, now)
    with Path(str(ledger) + '.lock').open('a+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        data = json.loads(ledger.read_text())
        changed = False
        for intent in items:
            row, channel = source_row(intent, data)
            if channel:
                if channel.get('api_intent') != intent:
                    raise MetaError('protected_source_reconcile_first')
                continue
            if receipt_path(intent).exists():
                raise MetaError('protected_source_reconcile_first')
            row.setdefault('channels', {})['youtube'] = {'status': 'api_ready', 'api_intent': intent}
            changed = True
        if changed:
            private_json(ledger, data)
    return {'status': 'youtube_intents_planned', 'content_ids': [item['content_id'] for item in items]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['identity', 'due', 'plan'])
    parser.add_argument('--approval', type=Path)
    parser.add_argument('--budget-seconds', type=float, default=30)
    args = parser.parse_args()
    if not 1 <= args.budget_seconds <= 45:
        parser.error('budget must be within1..45 seconds')
    try:
        if args.command == 'identity':
            result = YouTubeClient(args.budget_seconds).identity()
        elif args.command == 'plan':
            if not args.approval:
                parser.error('--approval is required')
            result = plan(args.approval)
        else:
            result = due(budget=args.budget_seconds)
        if args.command == 'due':
            private_json(ROOT / 'publishing/due-latest.json', result)
        print(json.dumps(result, ensure_ascii=False))
    except (MetaError, OSError, ValueError, KeyError, TypeError, IndexError, subprocess.SubprocessError) as error:
        print(json.dumps({'status': 'youtube_step_blocked',
                          'error': str(error) if isinstance(error, MetaError) else type(error).__name__}))
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
