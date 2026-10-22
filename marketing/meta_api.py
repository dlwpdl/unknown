"""Own-account Meta API operations. Tokens and attempt receipts stay outside Git."""
import argparse
import base64
import hashlib
import ipaddress
import json
import os
import random
import re
import runpy
import ssl
import stat
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

PRIVATE = Path.home() / 'Library/Application Support/gling'
CREDENTIALS = PRIVATE / 'credentials'
OPERATIONS = PRIVATE / 'operations'
ACCOUNTS = {
    'threads': ('https://graph.threads.net', 'v1.0', '39140519375592400'),
    'instagram': ('https://graph.instagram.com', 'v25.0', '17841430674685962'),
}
INSTAGRAM_AUTOMATION = '978b9d5b-77f6-4839-bb85-23caeff3e0ea'
CORRECTIVE_QUEUE_SHA256 = 'cfb0e7d80bfd46d6909533c60600d6da82a4aaa45176b08e5ce469e666e657e9'


class MetaError(Exception):
    pass


def shared_post_url(post_id):
    if not isinstance(post_id, str) or not re.fullmatch(
            r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', post_id):
        raise MetaError('vendor_shared_post_uuid_required')
    token = base64.urlsafe_b64encode(uuid.UUID(post_id).bytes).decode('ascii').rstrip('=')
    return 'https://gling-share-preview.vercel.app/s/' + token


def now_utc():
    return datetime.now(timezone.utc)


def date(value):
    try:
        offset = re.search(r'([+-]\d{2})(\d{2})\Z', value)
        if offset:
            # fromisoformat normalizes invalid offset minutes; strptime rejects them.
            datetime.strptime(offset.group(), '%z')
            value = value[:offset.start()] + offset[1] + ':' + offset[2]
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if result.tzinfo is None:
            raise ValueError()
        return result
    except (ValueError, TypeError, AttributeError):
        raise MetaError('invalid_timestamp') from None


def digest(data):
    return hashlib.sha256(data).hexdigest()


def private_json(path, value, exclusive=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink():
        raise MetaError('unsafe_receipt_path')
    data = (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
    if exclusive:
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            raise MetaError('attempt_exists_reconcile_without_resending') from None
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        return
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def once(path, context, send):
    record = {**context, 'status': 'attempted', 'attempted_at': now_utc().isoformat()}
    private_json(path, record, exclusive=True)
    try:
        result = send()
    except Exception as error:
        record.update(status='uncertain', error=str(error) if isinstance(error, MetaError) else type(error).__name__)
        private_json(path, record)
        raise
    private_json(path, {**record, 'status': 'response_received', 'response': result,
                        'observed_at': now_utc().isoformat()})
    return result


def refresh_due(credentials, now):
    issued = date(credentials.get('refreshed_at', credentials.get('issued_at')))
    expires = date(credentials['expires_at']) if credentials.get('expires_at') else issued + timedelta(days=60)
    if now >= expires:
        raise MetaError('token_expired_reconnect_required')
    return now - issued >= timedelta(days=7)


def operation_receipt(intent):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,120}', intent.get('content_id', '')):
        raise MetaError('unsafe_content_id')
    folder = OPERATIONS / 'meta-api' / intent['platform']
    if intent.get('account') == 'chalkakandupload':
        folder /= 'chalkakandupload'
    return folder / (intent['content_id'] + '.create.json')


def publication_intent(receipt, record):
    # An explicit owner replan changes timing without rewriting the original API attempt.
    path = Path(receipt).with_suffix('.reschedule.json')
    if not path.exists():
        return record['intent']
    change = json.loads(path.read_text())
    original, intent = record['intent'], change.get('intent', {})
    fixed = lambda row: {key: value for key, value in row.items()
                         if key not in ('scheduled_for', 'approval_receipt')}
    attempted = Path(receipt).with_suffix('.publish.json')
    if record.get('platform') != 'instagram' or record.get('status') != 'response_received' or \
            record.get('account_id') != ACCOUNTS['instagram'][2] or not change.get('owner_quote') or \
            change.get('create_sha256') != digest(Path(receipt).read_bytes()) or \
            fixed(original) != fixed(intent) or \
            operation_receipt(intent).resolve() != Path(receipt).resolve() or \
            attempted.exists() and json.loads(attempted.read_text()).get('intent') != intent:
        raise MetaError('reschedule_must_preserve_exact_content_and_existing_attempt')
    return intent


def validate_vendor_completion(intent, row):
    try:
        proof = json.loads(Path(intent['approval_receipt']).read_text())['proof']
        post, = proof['post']
        detail = proof['merchant']
        merchant = detail['merchant']
        checks = proof['material_checks']
        rendered = json.loads(Path(proof['render_receipt']).read_text())
        body = post['body']
        if not all(checks.get(key) is True for key in ('detailed_intro_and_services',
                'location_in_body_verified', 'instagram_profile_verified',
                'photo_sources_and_permission_verified', 'all_saved_photos_viewed')):
            raise MetaError('vendor_material_review_incomplete')
        if not body.strip() or body.strip() == post['title'].strip() or \
                not isinstance(post['image_paths'], list) or len(post['image_paths']) < 3 or \
                not all(isinstance(path, str) and path.strip() for path in post['image_paths']) or \
                len(set(post['image_paths'])) != len(post['image_paths']) or \
                not merchant.get('industry', '').strip() or not merchant.get('services', '').strip() or \
                not re.search(r'https://(?:www\.)?instagram\.com/[A-Za-z0-9_.]+/?(?=\s|$)', body):
            raise MetaError('vendor_saved_intro_missing_photos_or_details')
        if not row.get('post_id') or not row.get('merchant_id') or post['id'] != row['post_id'] or \
                merchant['id'] != row['merchant_id'] or post['city_id'] != merchant['city_id'] or \
                not any(p['post_id'] == post['id'] for p in detail['posts']) or \
                ('https://gling.ej-entertainment.com/post?id=' + post['id'] not in intent['text'] and
                 shared_post_url(post['id']) not in {
                     link.rstrip('.,!;:)]}') for link in
                     re.findall(r"""(?<![\w:/?&=#%])https://[^\s<>"']+""", intent['text'])}):
            raise MetaError('vendor_saved_post_or_merchant_binding_mismatch')
        if rendered.get('authenticated') is not True or rendered.get('post_id') != post['id'] or \
                type(rendered.get('visible_image_count')) is not int or rendered['visible_image_count'] < len(post['image_paths']) or \
                rendered.get('all_image_elements_loaded') is not True or \
                ' '.join(body.split()) not in ' '.join(rendered.get('body', '').split()):
            raise MetaError('vendor_authenticated_body_and_photo_view_required')
        screenshot = Path(rendered['screenshot_path'])
        if not post.get('author_id') or rendered['actual_identity'].get('normal_admin_subject') != post['author_id'] or \
                date(rendered['observed_at']) > now_utc() or \
                not screenshot.is_file() or not screenshot.read_bytes().startswith(b'\x89PNG\r\n\x1a\n'):
            raise MetaError('vendor_actual_identity_time_and_screenshot_required')
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        raise MetaError('vendor_material_evidence_required') from None


def validate_source(intent):
    if intent.get('probe'):
        return
    filename, sep, key = intent.get('source_record', '').rpartition('#')
    if not sep:
        raise MetaError('original_record_pointer_required')
    data = json.loads(Path(filename).read_text())
    if str(data.get('account_handle', 'gling.app')).lstrip('@') != intent.get('account'):
        raise MetaError('source_queue_belongs_to_another_account')
    rows = data.get('entries', data.get('events', []))
    row = next((r for r in rows if key in {r.get('content_id'), r.get('event_id'), r.get('id'), r.get('case_id'), r.get('key')}), None)
    if row is None:
        raise MetaError('original_record_missing')
    expected = row.get('api_intent') or row.get('channels', {}).get('instagram', {}).get('api_intent')
    channel = row.get('channels', {}).get('instagram', {}) if intent['platform'] == 'instagram' else row
    if channel.get('approval_mode') == 'morning_batch' and intent.get('schedule_mode') != 'approval_relative':
        raise MetaError('morning_batch_approval_required')
    if expected != intent or any(row.get(k) for k in ('held', 'hold', 'uncertain')):
        raise MetaError('original_approved_plan_changed_or_held')
    if intent['action'] == 'post' and row.get('status') != 'api_ready':
        raise MetaError('original_post_not_ready')
    if intent['action'] == 'delete' and row.get('status') != 'api_ready':
        raise MetaError('original_delete_not_ready')
    if intent['action'] == 'reel' and row.get('channels', {}).get('instagram', {}).get('status') != 'api_ready':
        raise MetaError('original_reel_not_ready')
    if intent['action'] == 'reply':
        if row.get('status') not in ('api_ready', 'approved'):
            raise MetaError('original_case_sent_pending_or_needs_owner_review')
        if any(row.get(k) for k in ('replied_at', 'sent_at', 'attempted_at', 'reply_sent_at', 'reply_attempted_at', 'public_reply_attempted_at', 'public_reply_receipt', 'reply_receipt')):
            raise MetaError('original_reply_attempt_exists_reconcile_first')
        if intent.get('account') == 'gling.app' and intent.get('content_id', '').startswith('BT-COMPLETE-'):
            validate_vendor_completion(intent, row)


def validate_intent(intent, now, publishing=False):
    if 'collaborators' in intent:
        raise MetaError('collaborators_not_authorized')
    if intent.get('platform') not in ACCOUNTS or intent.get('account') not in ('gling.app', 'chalkakandupload') or \
            intent.get('account') == 'chalkakandupload' and intent.get('platform') != 'threads':
        raise MetaError('wrong_account')
    operation_receipt(intent)
    allowed = ('post', 'reply') if intent['platform'] == 'threads' else ('reel', 'reply')
    if intent.get('action') not in allowed:
        raise MetaError('wrong_platform_action')
    if intent.get('status') != 'api_ready' or intent.get('submission_kind') != 'api_local_queue':
        raise MetaError('not_an_api_ready_record')
    if any(intent.get(k) for k in ('held', 'hold', 'public_id', 'native_receipt', 'attempted_at', 'sending', 'uncertain')):
        raise MetaError('protected_record_reconcile_first')
    if not all(intent.get(k) for k in ('content_id', 'approved_at', 'approval_receipt', 'source_record')):
        raise MetaError('missing_existing_approval_or_record')
    if date(intent['approved_at']) > now or not Path(intent['approval_receipt']).is_file():
        raise MetaError('approval_receipt_missing_or_future_dated')
    if 'user_tags' in intent:
        if intent['platform'] != 'instagram' or intent['action'] != 'reel' or intent.get('probe'):
            raise MetaError('user_tags_only_for_approved_reels')
        tags = intent['user_tags']
        if not isinstance(tags, list) or not tags or any(
                not isinstance(tag, dict) or set(tag) != {'username'} or
                not isinstance(tag['username'], str) or
                not re.fullmatch(r'[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?', tag['username']) or
                '..' in tag['username'] for tag in tags) or \
                len({tag['username'].lower() for tag in tags}) != len(tags):
            raise MetaError('invalid_reel_user_tags')
        approval_path = Path(intent['approval_receipt'])
        try:
            approval = json.loads(approval_path.read_text())
        except (OSError, ValueError):
            raise MetaError('user_tags_exact_owner_approval_required') from None
        fields = ('platform', 'account', 'action', 'content_id', 'approved_at',
                  'copy_sha256', 'video_sha256', 'source_manifest_sha256', 'user_tags')
        if approval_path.is_symlink() or not isinstance(approval, dict) or approval.get('approved') is not True or \
                not isinstance(approval.get('owner_quote'), str) or not approval['owner_quote'].strip() or \
                any(not intent.get(k) or approval.get(k) != intent[k] for k in fields):
            raise MetaError('user_tags_exact_owner_approval_required')
    if intent.get('schedule_mode') == 'approval_relative':
        approval = json.loads(Path(intent['approval_receipt']).read_text())
        fields = ['platform', 'account', 'content_id', 'copy_sha256']
        if intent['action'] == 'reel':
            fields += ['video_sha256', 'source_manifest_sha256', 'cover_sha256']
        if approval.get('kind') != 'morning_batch' or not approval.get('owner_quote') or not intent.get('batch_id') or approval.get('batch_id') != intent['batch_id'] or approval.get('approved_at') != intent['approved_at']:
            raise MetaError('morning_batch_owner_approval_required')
        matches = [row for row in approval.get('items', []) if all(row.get(k) == intent.get(k) and intent.get(k) for k in fields)]
        approval_hours = 23
        if approval.get('schedule_policy') in ('rolling_eight_per_day', 'rolling_twelve_per_day'):
            count = len({row.get('content_id') for row in approval.get('items', [])
                         if row.get('platform') == intent['platform'] and row.get('account') == intent['account']})
            approval_hours = count * 2 + 24 if approval['schedule_policy'] == 'rolling_twelve_per_day' else (count * 3 if count > 8 else 23)
            matches = [row for row in matches if row.get('scheduled_for') == intent.get('scheduled_for')]
        if len(matches) != 1 or not 0 < (date(intent.get('scheduled_for')) - date(intent['approved_at'])).total_seconds() < approval_hours * 3600:
            raise MetaError('morning_batch_exact_content_or_time_changed')
    text = intent.get('text', '')
    if not isinstance(text, str) or not text.strip() or digest(text.encode()) != intent.get('copy_sha256'):
        raise MetaError('changed_or_missing_approved_copy')
    if publishing and intent.get('probe'):
        raise MetaError('probe_cannot_be_published')
    if intent.get('action') in ('post', 'reel'):
        due = date(intent.get('scheduled_for'))
        grace = 300 if intent.get('schedule_mode') == 'approval_relative' else (60 if intent['platform'] == 'threads' else 900)
        elapsed = (now - due).total_seconds()
        if publishing and (not 0 <= elapsed <= grace or intent.get('schedule_mode') == 'approval_relative' and elapsed >= 300 or
                intent.get('automation_id') == INSTAGRAM_AUTOMATION and elapsed >= 300):
            raise MetaError('outside_original_publication_slot')
        prepare_grace = grace if intent['platform'] == 'threads' else 0
        if not publishing and not intent.get('probe') and not -prepare_grace <= (due - now).total_seconds() < 23 * 3600:
            raise MetaError('container_must_be_prepared_within_23_hours_of_slot')
    elif intent.get('action') != 'reply':
        raise MetaError('unsupported_action')
    if intent['platform'] == 'threads' and intent.get('action') == 'post':
        if not intent.get('topic_tag') or not intent.get('topic_observation') or len(text) > 500:
            raise MetaError('missing_observed_single_topic_or_text_too_long')
    if intent['platform'] == 'instagram' and intent.get('action') == 'reel' and not intent.get('probe'):
        validate_reel_master(intent)


def validate_reel_master(intent):
    required = ('video_file', 'video_sha256', 'hyperframes_project', 'source_manifest_sha256',
                'final_review_receipt', 'gling_post_id')
    if not all(intent.get(k) for k in required):
        raise MetaError('missing_accepted_hyperframes_or_gling_first_proof')
    project = Path(intent['hyperframes_project'])
    if not (project / 'index.html').is_file() or digest((project / 'source-manifest.json').read_bytes()) != intent['source_manifest_sha256']:
        raise MetaError('changed_hyperframes_source')
    manifest = json.loads((project / 'source-manifest.json').read_text())
    if manifest.get('private_preview_only') is True or manifest.get('public_release_ready') is False:
        raise MetaError('private_or_held_hyperframes_source')
    index = (project / 'index.html').read_bytes()
    files = manifest.get('source_files', [])
    if not isinstance(files, list) or not any(isinstance(f, dict) and f.get('path') == 'index.html'
            and f.get('sha256') == digest(index) for f in files):
        raise MetaError('changed_hyperframes_source')
    try:
        root = Path(__file__).resolve().parents[1]
        checker = runpy.run_path(str(root / 'scripts/check-gling-cover-category.py'))
        palette = json.loads((root / 'marketing/festival-template.json').read_text())['current_production']['category_point_colors']
        checker['check_palette'](palette)
        checker['check_cover'](index.decode(), palette)
    except (OSError, ValueError, KeyError, TypeError):
        raise MetaError('cover_category_color_contract_failed') from None
    if digest(Path(intent['video_file']).read_bytes()) != intent['video_sha256']:
        raise MetaError('changed_rendered_video')
    review = json.loads(Path(intent['final_review_receipt']).read_text())
    if not all(review.get(k) is True for k in ('accepted', 'saved_reopened', 'gling_post_verified')) or review.get('editor') != 'HyperFrames':
        raise MetaError('video_not_accepted')
    for k in ('video_sha256', 'source_manifest_sha256', 'gling_post_id'):
        if review.get(k) != intent[k]:
            raise MetaError('review_does_not_match_exact_master')
    if intent.get('cover_file'):
        if digest(Path(intent['cover_file']).read_bytes()) != intent.get('cover_sha256') or review.get('cover_sha256') != intent.get('cover_sha256'):
            raise MetaError('approved_cover_hash_mismatch')
    elif not intent.get('cover_first_frame_verified'):
        raise MetaError('approved_cover_not_bound')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class MetaClient:
    def __init__(self, platform, credentials_dir=CREDENTIALS, *, account='gling.app'):
        if platform not in ACCOUNTS:
            raise MetaError('unsupported_account')
        if account not in ('gling.app', 'chalkakandupload') or account == 'chalkakandupload' and platform != 'threads':
            raise MetaError('wrong_account')
        self.account = account
        self.platform = platform
        self.host, self.version, self.user_id = ACCOUNTS[platform]
        filename = platform + ('-chalkakandupload' if account == 'chalkakandupload' else '') + '-api.json'
        self.path = Path(credentials_dir) / filename
        if account == 'chalkakandupload' and not self.path.is_file():
            raise MetaError('api_account_not_connected')
        if self.path.is_symlink() or stat.S_IMODE(self.path.stat().st_mode) & 0o077:
            raise MetaError('credentials_must_be_private_0600')
        self.original = self.path.read_bytes()
        self.credentials = json.loads(self.original)
        self.token = self.credentials.get('access_token')
        if not isinstance(self.token, str) or not self.token or self.credentials.get('username') != account:
            raise MetaError('invalid_credentials')
        if account == 'chalkakandupload':
            user_id = self.credentials.get('user_id')
            if (stat.S_IMODE(self.path.stat().st_mode) != 0o600 or self.credentials.get('app_id') != '929495573284257'
                    or not isinstance(user_id, str) or not re.fullmatch(r'[0-9]+', user_id) or user_id == self.user_id):
                raise MetaError('personal_account_binding_not_verified')
            self.user_id = user_id
        context = ssl.create_default_context()
        # This workspace's Python lacks its CA file; retain TLS verification using macOS's bundle.
        if Path('/etc/ssl/cert.pem').is_file():
            context.load_verify_locations('/etc/ssl/cert.pem')
        self.opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=context))

    def request(self, path, params=None, method='GET', intent=None, publishing=False):
        params = params or {}
        if 'collaborators' in params:
            raise MetaError('collaborators_not_authorized')
        if intent is not None:
            if intent.get('account') != self.account:
                raise MetaError('wrong_account')
            validate_intent(intent, now_utc(), publishing=publishing)
            validate_source(intent)
        if 'user_tags' in params or (intent is not None and 'user_tags' in intent and
                                    method == 'POST' and path == self.user_id + '/media'):
            if intent is None or 'user_tags' not in intent or self.platform != 'instagram' or \
                    method != 'POST' or path != self.user_id + '/media' or params.get('media_type') != 'REELS' or \
                    params.get('user_tags') != json.dumps(intent['user_tags'], separators=(',', ':')):
                raise MetaError('user_tags_request_must_match_approved_reel')
        inbox_node = path.split('/')[0]
        own_inbox_read = method == 'GET' and inbox_node in getattr(self, 'inbox_ids', set()) and path in (inbox_node, inbox_node + '/messages')
        if not own_inbox_read and not re.fullmatch(r'(me|[0-9]+)(/[a-z_]+)?|refresh_access_token', path):
            raise MetaError('unsafe_endpoint')
        if path == 'refresh_access_token':
            url = self.host + '/' + path
        else:
            url = self.host + '/' + self.version + '/' + path
        return self._request(url, params, method, self.token)

    def _request(self, url, params, method, token):
        params = params or {}
        headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/json'}
        data = None
        if method == 'GET':
            url += '?' + urllib.parse.urlencode(params)
        else:
            data = urllib.parse.urlencode(params).encode()
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with self.opener.open(req, timeout=20) as response:
                result = json.loads(response.read())
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read()).get('error', {})
                code, subcode = detail.get('code'), detail.get('error_subcode')
            except (ValueError, AttributeError):
                code, subcode = None, None
            raise MetaError(f'api_http_{error.code}_code_{code}_subcode_{subcode}') from None
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            raise MetaError('api_response_unknown_no_automatic_retry') from None
        if not isinstance(result, dict) or result.get('error'):
            raise MetaError('invalid_api_response')
        return result

    def identity(self):
        fields = 'id,username' if self.platform == 'threads' else 'user_id,username'
        result = self.request('me', {'fields': fields})
        actual_id = result.get('id') if self.platform == 'threads' else result.get('user_id')
        if result.get('username') != self.account or str(actual_id) != self.user_id:
            raise MetaError('live_account_identity_mismatch')
        return result

    def pages(self, path, params=None):
        rows, query = [], dict(params or {}, limit=100)
        for _ in range(100):
            result = self.request(path, query)
            if not isinstance(result.get('data'), list):
                raise MetaError('invalid_paginated_response')
            rows.extend(result['data'])
            paging = result.get('paging', {})
            if not paging.get('next'):
                return rows
            after = paging.get('cursors', {}).get('after')
            if not after or after == query.get('after'):
                raise MetaError('pagination_incomplete')
            query['after'] = after  # Never follow provider URLs containing tokens or another host.
        raise MetaError('pagination_limit_incomplete')

    def posts(self):
        edge = 'threads' if self.platform == 'threads' else 'media'
        fields = 'id,text,timestamp,permalink,media_type' if self.platform == 'threads' else 'id,caption,timestamp,permalink,media_type'
        return self.pages(self.user_id + '/' + edge, {'fields': fields})

    def delete_post(self, media_id, execute=False, intent=None):
        if not re.fullmatch(r'[0-9]+', str(media_id)):
            raise MetaError('invalid_delete_media_id')
        if isinstance(intent, dict) and intent.get('submission_kind') == 'native_future_schedule':
            raise MetaError('native_schedule_cancellation_api_contract_unverified')
        media_id = str(media_id)
        if self.platform == 'instagram':
            corrective = OPERATIONS / 'gling-cover-approved-2026-10-10'
            if any((corrective / (media_id + suffix)).exists() or (corrective / (media_id + suffix)).is_symlink()
                   for suffix in ('.delete-attempt.json', '.delete-readback.json')):
                raise MetaError('legacy_delete_attempt_requires_read_only_reconciliation')
            queue = corrective / 'approved-replacement-queue.json'
            if queue.is_file() and media_id in {str(r['original_public_id']) for r in json.loads(queue.read_text())['entries']}:
                return self.delete_media(media_id, execute=execute)
        folder = OPERATIONS / 'meta-api' / self.platform / 'deletions' / self.account
        attempt = folder / (media_id + '.delete-attempt.json')
        readback = folder / (media_id + '.delete-readback.json')
        if attempt.is_symlink() or readback.is_symlink():
            raise MetaError('unsafe_receipt_path')
        if execute and attempt.exists():
            raise MetaError('attempt_exists_reconcile_without_resending')
        if execute:
            if not isinstance(intent, dict) or any(intent.get(k) != v for k, v in
                    {'platform': self.platform, 'account': self.account, 'action': 'delete',
                     'media_id': media_id, 'status': 'api_ready', 'submission_kind': 'api_local_queue'}.items()) or \
                    any(intent.get(k) for k in ('held', 'hold', 'uncertain', 'probe', 'attempted_at', 'sending')):
                raise MetaError('exact_delete_approval_required')
            validate_source(intent)
            source = Path(intent['source_record'].rpartition('#')[0])
            approval = Path(intent.get('approval_receipt', ''))
            if source.is_symlink() or approval.is_symlink() or not approval.is_file():
                raise MetaError('exact_delete_approval_required')
            source_bytes, approval_bytes = source.read_bytes(), approval.read_bytes()
            approved = json.loads(approval_bytes)
            if approved.get('approved') is not True or any(approved.get(k) != intent.get(k) for k in
                    ('platform', 'account', 'action', 'media_id', 'copy_sha256', 'approved_at')) or \
                    date(intent.get('approved_at')) > now_utc():
                raise MetaError('exact_delete_approval_required')
            original_deadline = json.loads(source_bytes).get('original_deadline')
            deadline = date(original_deadline) if original_deadline else None
            if deadline and now_utc() > deadline:
                raise MetaError('outside_original_delete_deadline')
        self.identity()
        posts = {str(p['id']): p for p in self.posts()}
        if attempt.exists():
            prior = json.loads(attempt.read_text())
            if any(prior.get(k) != v for k, v in {'platform': self.platform, 'account': self.account,
                    'account_id': self.user_id, 'media_id': media_id}.items()):
                raise MetaError('receipt_account_mismatch')
            response = prior.get('response', {})
            verified = media_id not in posts and response.get('success') is True and str(response.get('deleted_id')) == media_id
            result = {'platform': self.platform, 'account': self.account, 'media_id': media_id,
                      'status': 'deleted_public_absence_verified' if verified else 'delete_reconciliation_pending',
                      'deleted_verified': verified, 'post_still_present': media_id in posts,
                      'DELETE_calls': 0, 'resend_allowed': False, 'observed_at': now_utc().isoformat()}
            private_json(readback, result)
            return result
        if media_id not in posts:
            raise MetaError('post_not_owned_or_not_present')
        text = posts[media_id].get('text' if self.platform == 'threads' else 'caption')
        if text is None:
            text = ''
        if not isinstance(text, str):
            raise MetaError('invalid_owned_post_copy')
        copy_sha256 = digest(text.encode())
        if execute and intent.get('copy_sha256') != copy_sha256:
            raise MetaError('approved_delete_target_copy_changed')
        if self.platform == 'threads':
            grants = self._request(self.host + '/debug_token', {'input_token': self.token}, 'GET', self.token).get('data', {})
            if not isinstance(grants, dict) or grants.get('is_valid') is not True or str(grants.get('user_id')) != self.user_id or \
                    not isinstance(grants.get('scopes'), list) or not all(isinstance(s, str) for s in grants['scopes']) or \
                    not {'threads_basic', 'threads_delete'} <= set(grants.get('scopes', [])) or \
                    not isinstance(grants.get('expires_at'), (int, float)) or grants['expires_at'] <= now_utc().timestamp():
                raise MetaError('threads_delete_permission_missing_or_expired')
            send_delete = lambda: self.request(media_id, method='DELETE')
            credential_path, credential_bytes = self.path, self.original
            expiry = datetime.fromtimestamp(grants['expires_at'], timezone.utc)
        else:
            facebook, credential_path, credential_bytes, credential = self.facebook_delete_connection()
            if str(facebook(media_id, {'fields': 'id'}).get('id')) != media_id:
                raise MetaError('facebook_original_media_read_binding_missing')
            send_delete = lambda: facebook(media_id, method='DELETE')
            expiry = date(credential['expires_at'])
        if credential_path.read_bytes() != credential_bytes or self.path.read_bytes() != self.original:
            raise MetaError('delete_credentials_changed')
        context = {'platform': self.platform, 'account': self.account, 'account_id': self.user_id,
                   'media_id': media_id, 'copy_sha256': copy_sha256}
        if not execute:
            return {**context, 'status': 'delete_preflight_ready', 'DELETE_calls': 0,
                    'exact_approval_and_explicit_execute_required': True}

        def send():
            validate_source(intent)
            if source.read_bytes() != source_bytes or approval.read_bytes() != approval_bytes or \
                    credential_path.read_bytes() != credential_bytes or self.path.read_bytes() != self.original or \
                    now_utc() >= expiry or deadline and now_utc() > deadline:
                raise MetaError('delete_source_credentials_or_original_deadline_changed')
            result = send_delete()
            if result.get('success') is not True or str(result.get('deleted_id')) != media_id:
                raise MetaError('delete_response_unknown_reconcile_without_resending')
            return {'success': True, 'deleted_id': media_id}

        once(attempt, {**context, 'source_record': intent['source_record']}, send)
        result = {**context, 'status': 'delete_readback_pending', 'deleted_verified': False,
                  'automatic_retry': False, 'observed_at': now_utc().isoformat()}
        private_json(readback, result, exclusive=True)
        result['deleted_verified'] = media_id not in {str(p['id']) for p in self.posts()}
        if result['deleted_verified']:
            result['status'] = 'deleted_public_absence_verified'
        private_json(readback, result)
        if not result['deleted_verified']:
            raise MetaError('delete_public_absence_pending_do_not_resend')
        return result

    def facebook_delete_connection(self):
        credential_path = self.path.parent / 'facebook-login-pending.json'
        if credential_path.is_symlink() or stat.S_IMODE(credential_path.stat().st_mode) != 0o600:
            raise MetaError('facebook_credentials_must_be_private_0600')
        original_credential = credential_path.read_bytes()
        credential = json.loads(original_credential)
        token = credential.get('access_token')
        page_id = str(credential.get('expected_facebook_page_id', ''))
        if not isinstance(token, str) or not token or credential.get('meta_app_id') != '1696778162062283' or \
                credential.get('expected_instagram_username') != 'gling.app' or str(credential.get('expected_instagram_user_id')) != self.user_id or not page_id.isdigit():
            raise MetaError('facebook_credential_account_binding_mismatch')
        if now_utc() >= date(credential.get('expires_at')):
            raise MetaError('facebook_token_expired_reconnect_existing_account')
        previous = json.loads(Path(credential['verification_report']).read_text())
        expected_user = next((r.get('response', {}).get('id') for r in previous['results'] if r.get('endpoint') == 'me' and r.get('status') == 200), None)
        if not expected_user:
            raise MetaError('facebook_original_user_binding_required')

        def facebook(path, params=None, method='GET'):
            if not re.fullmatch(r'(me|[0-9]+)(/[a-z_]+)?', path):
                raise MetaError('unsafe_endpoint')
            return self._request('https://graph.facebook.com/v25.0/' + path, params, method, token)

        if str(facebook('me', {'fields': 'id'}).get('id')) != str(expected_user):
            raise MetaError('facebook_live_user_identity_mismatch')
        permissions = facebook('me/permissions').get('data', [])
        if not isinstance(permissions, list) or any(not isinstance(p, dict) for p in permissions):
            raise MetaError('facebook_current_permissions_response_invalid')
        granted = {p.get('permission') for p in permissions if p.get('status') == 'granted'}
        if not {'instagram_basic', 'instagram_manage_contents', 'pages_show_list', 'pages_read_engagement'} <= granted:
            raise MetaError('facebook_current_delete_and_binding_permissions_missing')
        accounts = facebook('me/accounts', {'fields': 'id,tasks,instagram_business_account{id,username}', 'limit': 100})
        if not isinstance(accounts.get('data'), list) or any(not isinstance(p, dict) for p in accounts['data']):
            raise MetaError('facebook_current_accounts_response_invalid')
        page = next((p for p in accounts.get('data', []) if str(p.get('id')) == page_id), {})
        linked = page.get('instagram_business_account', {})
        if not isinstance(linked, dict) or str(linked.get('id')) != self.user_id or linked.get('username') != 'gling.app':
            raise MetaError('facebook_current_page_to_instagram_binding_missing')
        ig = facebook(self.user_id, {'fields': 'id,username'})
        if str(ig.get('id')) != self.user_id or ig.get('username') != 'gling.app':
            raise MetaError('facebook_live_instagram_identity_mismatch')
        return facebook, credential_path, original_credential, credential

    def delete_media(self, media_id, execute=False):
        # IG-media deletion is Facebook Login only: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media
        if self.platform != 'instagram' or not re.fullmatch(r'[0-9]+', str(media_id)):
            raise MetaError('wrong_delete_account_or_media_id')
        media_id = str(media_id)
        queue = OPERATIONS / 'gling-cover-approved-2026-10-10' / 'approved-replacement-queue.json'
        original_queue = queue.read_bytes()
        if digest(original_queue) != CORRECTIVE_QUEUE_SHA256:
            raise MetaError('original_corrective_delete_queue_changed')
        data = json.loads(original_queue)
        rows = data['entries']
        old = {str(r['original_public_id']) for r in rows}
        new = {str(r['channels']['instagram']['public_id']) for r in rows}
        if data.get('account_handle') != 'gling.app' or len(rows) != 28 or len(old) != 28 or len(new) != 28 or old & new or media_id not in old:
            raise MetaError('media_not_in_exact_original28_delete_whitelist')
        deadline = date(data['original_deadline']) if data.get('original_deadline') else None
        if deadline and now_utc() > deadline:
            raise MetaError('outside_original_delete_deadline')
        manifest_path = Path(data['accepted_review_manifest'])
        if digest(manifest_path.read_bytes()) != data['accepted_review_manifest_sha256']:
            raise MetaError('accepted_corrective_master_manifest_changed')
        manifest = json.loads(manifest_path.read_text())
        masters = {str(v['original_public_id']): v for v in manifest['videos'] if v.get('group') == 'original-public-28'}
        if set(masters) != old:
            raise MetaError('original28_delete_whitelist_does_not_match_accepted_masters')
        row = next(r for r in rows if str(r['original_public_id']) == media_id)
        channel, intent = row['channels']['instagram'], row['api_intent']
        if row.get('status') != 'new_reel_public_verified_old_deletion_pending' or channel.get('status') != 'published' or any(
                record.get(k) for record in (row, channel, intent) for k in ('held', 'hold', 'uncertain', 'probe')) or any(
                record.get('submission_kind') == 'native_future_schedule' for record in (row, channel, intent)):
            raise MetaError('corrective_record_private_held_future_or_not_published')
        replacement = str(channel['public_id'])
        if channel.get('api_intent') != intent or intent.get('account') != 'gling.app' or intent.get('platform') != 'instagram' or intent.get('action') != 'reel' or \
                intent.get('source_record') != str(queue) + '#' + row['content_id'] or str(row['publication_result']['public_id']) != replacement:
            raise MetaError('corrective_replacement_binding_changed')
        approval = Path(intent['approval_receipt'])
        if str(approval) != manifest['owner_acceptance'] or digest(approval.read_bytes()) != manifest['owner_acceptance_sha256'] or date(intent['approved_at']) > now_utc():
            raise MetaError('original_corrective_owner_approval_changed')
        project = Path(intent['hyperframes_project'])
        source = project / 'source-manifest.json'
        if not (project / 'index.html').is_file() or digest(source.read_bytes()) != intent['source_manifest_sha256']:
            raise MetaError('changed_hyperframes_source')
        source_data = json.loads(source.read_text())
        if source_data.get('private_preview_only') is True or source_data.get('public_release_ready') is False:
            raise MetaError('private_or_held_hyperframes_source')
        review = json.loads(Path(intent['final_review_receipt']).read_text())
        if review.get('editor') != 'HyperFrames' or not all(review.get(k) is True for k in ('accepted', 'saved_reopened', 'gling_post_verified')) or \
                review.get('owner_acceptance_receipt') != str(approval) or review.get('owner_acceptance_sha256') != manifest['owner_acceptance_sha256']:
            raise MetaError('corrective_replacement_not_owner_accepted')
        if any(review.get(k) != intent.get(k) for k in ('video_sha256', 'cover_sha256', 'source_manifest_sha256', 'gling_post_id')) or \
                digest(Path(intent['video_file']).read_bytes()) != intent['video_sha256'] or digest(Path(intent['cover_file']).read_bytes()) != intent['cover_sha256'] or \
                digest(intent['text'].encode()) != intent['copy_sha256']:
            raise MetaError('accepted_corrective_replacement_assets_changed')
        if masters[media_id].get('video_sha256') != intent['video_sha256'] and not (
                review.get('native_equivalent_transfer_export') is True and review.get('original_accepted_video_sha256') == masters[media_id].get('video_sha256')):
            raise MetaError('corrective_video_not_the_accepted_master_or_transfer')
        attempt = queue.parent / (media_id + '.delete-attempt.json')
        readback = queue.parent / (media_id + '.delete-readback.json')
        if attempt.exists() or attempt.is_symlink() or readback.exists() or readback.is_symlink():
            raise MetaError('attempt_exists_reconcile_without_resending')
        facebook, credential_path, original_credential, credential = self.facebook_delete_connection()
        page_id = str(credential['expected_facebook_page_id'])
        self.identity()
        fields = {'fields': 'id,caption,media_type,media_product_type'}
        media = {str(p['id']): p for p in self.pages(self.user_id + '/media', fields)}
        counterpart = media.get(replacement, {})
        if media_id not in media or counterpart.get('media_type') != 'VIDEO' or counterpart.get('media_product_type') != 'REELS' or digest(counterpart.get('caption', '').encode()) != intent['copy_sha256']:
            raise MetaError('original_not_public_or_approved_new_reel_readback_changed')
        if str(facebook(media_id, {'fields': 'id,media_type'}).get('id')) != media_id:
            raise MetaError('facebook_original_media_read_binding_missing')
        context = {'platform': 'instagram-facebook-login', 'account': 'gling.app', 'instagram_user_id': self.user_id,
                   'native_page_id': page_id, 'original_public_id': media_id, 'new_public_id': replacement,
                   'source_record': intent['source_record'], 'source_master_sha256': intent['video_sha256'],
                   'facebook_credential_sha256': digest(original_credential), 'original_deadline': data.get('original_deadline')}
        if queue.read_bytes() != original_queue or credential_path.read_bytes() != original_credential or (deadline and now_utc() > deadline):
            raise MetaError('delete_source_credentials_or_original_deadline_changed')
        if now_utc() >= date(credential['expires_at']):
            raise MetaError('facebook_token_expired_reconnect_existing_account')
        if not execute:
            return {**context, 'status': 'delete_preflight_ready', 'DELETE_calls': 0, 'explicit_execute_required': True}

        def send():
            if queue.read_bytes() != original_queue or credential_path.read_bytes() != original_credential or now_utc() >= date(credential['expires_at']) or (deadline and now_utc() > deadline):
                raise MetaError('delete_source_credentials_or_original_deadline_changed')
            result = facebook(media_id, method='DELETE')
            if result.get('success') is not True or str(result.get('deleted_id')) != media_id:
                raise MetaError('delete_response_unknown_reconcile_without_resending')
            return {'success': True, 'deleted_id': media_id}

        once(attempt, context, send)
        result = {**context, 'status': 'delete_readback_pending', 'deleted_verified': False, 'automatic_retry': False}
        private_json(readback, result, exclusive=True)
        current = {str(p['id']): p for p in self.pages(self.user_id + '/media', fields)}
        result.update(original_still_present=media_id in current, new_public_still_present=replacement in current,
                      observed_at=now_utc().isoformat())
        result['deleted_verified'] = media_id not in current and replacement in current and digest(current[replacement].get('caption', '').encode()) == intent['copy_sha256']
        if result['deleted_verified']:
            result['status'] = 'deleted_public_absence_verified'
        private_json(readback, result)
        if not result['deleted_verified']:
            raise MetaError('delete_public_absence_or_counterpart_pending_do_not_resend')
        return result

    def replies(self, post_id):
        if self.platform == 'threads':
            return self.pages(post_id + '/conversation', {
                'fields': 'id,text,username,timestamp,permalink,has_replies,root_post,replied_to,is_reply'})
        rows = self.pages(post_id + '/comments', {'fields': 'id,text,username,timestamp'})
        for row in list(rows):
            nested = self.pages(str(row['id']) + '/replies', {'fields': 'id,text,username,timestamp'})
            for child in nested:
                child['parent_id'] = row['id']
            rows.extend(nested)
        return rows

    def inspect(self):
        result = {'platform': self.platform, 'account': self.account, 'profile': self.identity(),
                  'observed_at': now_utc().isoformat(), 'source': self.host, 'posts': [], 'status': 'verified'}
        metrics = ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares'] if self.platform == 'threads' else ['views', 'reach', 'likes', 'comments', 'saved', 'shares']
        for post in self.posts():
            row = {**post, 'metrics': {}, 'metric_errors': {}}
            try:
                batch = self.request(str(post['id']) + '/insights', {'metric': ','.join(metrics)}).get('data', [])
            except MetaError:
                batch = None
            for metric in metrics:
                try:
                    data = batch if batch is not None else self.request(str(post['id']) + '/insights', {'metric': metric}).get('data', [])
                    item = next((d for d in data if d.get('name') == metric), {})
                    values = item.get('values', [])
                    value = values[0].get('value') if values else item.get('total_value', {}).get('value')
                    row['metrics'][metric] = value
                    if value is None:
                        result['status'] = 'partial'
                except MetaError as error:
                    row['metrics'][metric] = None
                    row['metric_errors'][metric] = str(error)
                    result['status'] = 'partial'
            try:
                row['replies'] = self.replies(str(post['id']))
                row['replies_complete'] = True
            except MetaError as error:
                row.update(replies=None, replies_complete=False, replies_error=str(error))
                result['status'] = 'partial'
            result['posts'].append(row)
        return result

    def inbox(self):
        if self.platform != 'instagram':
            raise MetaError('threads_dm_api_not_verified_use_existing_guarded_inbox')
        profile = self.identity()
        rows = self.pages(self.user_id + '/conversations', {'platform': 'instagram'})
        self.inbox_ids = set()
        for row in rows:
            node = str(row['id'])
            if not re.fullmatch(r'[A-Za-z0-9_=:.\-]{1,1024}', node):
                raise MetaError('invalid_owned_conversation_id')
            self.inbox_ids.add(node)
            row['messages'] = self.pages(node + '/messages', {'fields': 'id,created_time,from,to,message'})
        return {'platform': 'instagram', 'account': 'gling.app', 'profile': profile,
                'observed_at': now_utc().isoformat(), 'conversations': rows,
                'scope': 'API-eligible one-to-one conversations; inactive Requests older than 30 days and group chats excluded'}

    def owner_reply(self, intent):
        parent, target = str(intent.get('parent_id', '')), str(intent.get('reply_to_id', ''))
        if parent not in {str(p['id']) for p in self.posts()}:
            raise MetaError('reply_parent_not_owned')
        if target == parent:
            raise MetaError('reply_target_is_root_post')
        rows = self.replies(parent)
        target_row = next((p for p in rows if str(p.get('id')) == target), None)
        if target_row is None:
            raise MetaError('reply_target_not_in_owned_conversation')

        def linked_id(value):
            value = value.get('id') if isinstance(value, dict) else value
            return str(value) if value not in (None, '') else ''

        parents, authors = {}, {}
        for row in rows:
            row_id = linked_id(row.get('id'))
            if not row_id:
                raise MetaError('reply_conversation_metadata_incomplete')
            parents[row_id] = linked_id(row.get('replied_to')) if self.platform == 'threads' else \
                linked_id(row.get('parent_id')) or parent
            author = str(row.get('username') or '').strip().lstrip('@').casefold()
            if author:
                authors[row_id] = author
            elif row_id != parent:
                raise MetaError('reply_conversation_metadata_incomplete')
        if self.platform == 'threads':
            for row in rows:
                row_id = linked_id(row.get('id'))
                if row_id != parent and not parents[row_id]:
                    raise MetaError('reply_conversation_metadata_incomplete')
        commenter = authors.get(target)
        if not commenter:
            raise MetaError('reply_conversation_metadata_incomplete')
        if commenter == self.account.casefold():
            raise MetaError('reply_target_is_own_account')
        if parents.get(target) != parent:
            raise MetaError('reply_target_not_top_level_comment')

        for row_id, author in authors.items():
            if row_id == parent or author != self.account.casefold():
                continue
            node, seen = row_id, set()
            while parents.get(node) != parent:
                if node in seen or not parents.get(node) or parents[node] not in parents:
                    raise MetaError('reply_conversation_metadata_incomplete')
                seen.add(node)
                node = parents[node]
            if node in authors and authors[node] == commenter:
                raise MetaError('first_reply_already_exists')

    def prepare(self, intent, receipt):
        if intent.get('account') != self.account:
            raise MetaError('wrong_account')
        validate_intent(intent, now_utc())
        if Path(receipt).resolve() != operation_receipt(intent).resolve():
            raise MetaError('use_stable_content_receipt_across_runs')
        if intent['platform'] != self.platform:
            raise MetaError('wrong_platform')
        validate_source(intent)
        self.identity()
        if intent['action'] == 'reply':
            self.owner_reply(intent)
            if self.platform == 'instagram':
                raise MetaError('instagram_comment_reply_uses_reply_command')
        if self.platform == 'threads':
            params = {'media_type': 'TEXT', 'text': intent['text']}
            if intent['action'] == 'reply':
                params['reply_to_id'] = intent['reply_to_id']
            else:
                params['topic_tag'] = intent['topic_tag']
            edge = 'threads'
        else:
            params, edge = {'media_type': 'REELS', 'caption': intent['text']}, 'media'
            if 'user_tags' in intent:
                # https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/
                params['user_tags'] = json.dumps(intent['user_tags'], separators=(',', ':'))
            if intent.get('staging_receipt'):
                staged = json.loads(private_output(intent['staging_receipt']).read_text())
                if staged.get('account') != 'instagram:gling.app' or staged.get('video', {}).get('sha256') != intent.get('video_sha256') or date(staged['signed_until']) < now_utc() + timedelta(minutes=2):
                    raise MetaError('staged_video_wrong_account_hash_or_expired')
                prefix = 'https://wjvahbdwmctzpkndqaxa.supabase.co/storage/v1/object/sign/sns-media/instagram/gling.app/'
                if not staged['video']['url'].startswith(prefix + intent['video_sha256'] + '.mp4?'):
                    raise MetaError('staged_video_url_does_not_match_exact_object')
                params['video_url'] = public_url(staged['video']['url'])
                if staged.get('cover'):
                    if staged['cover']['sha256'] != intent.get('cover_sha256') or not staged['cover']['url'].startswith(prefix + intent['cover_sha256'] + '.'):
                        raise MetaError('staged_cover_hash_or_path_mismatch')
                    params['cover_url'] = public_url(staged['cover']['url'])
            elif intent.get('video_url') and intent.get('probe'):
                params['video_url'] = public_url(intent['video_url'])
            else:
                raise MetaError('instagram_login_requires_private_staged_video_url')
            if intent.get('cover_url'):
                params['cover_url'] = public_url(intent['cover_url'])
            elif intent.get('cover_first_frame_verified'):
                params['thumb_offset'] = '0'
        result = once(receipt, {'intent': intent, 'platform': self.platform, 'account_id': self.user_id},
                      lambda: self.request(self.user_id + '/' + edge, params, 'POST', intent=intent))
        container = str(result.get('id', ''))
        if not container.isdigit():
            raise MetaError('container_id_missing_reconcile_receipt')
        return self.container(receipt)

    def container(self, receipt):
        record = json.loads(Path(receipt).read_text())
        if record.get('account_id') != self.user_id or record.get('platform') != self.platform:
            raise MetaError('receipt_account_mismatch')
        container = str(record.get('response', {}).get('id', ''))
        if not container.isdigit():
            raise MetaError('no_container_response_reconcile_first')
        field = 'status' if self.platform == 'threads' else 'status_code'
        state = self.request(container, {'fields': field})
        return {'container_id': container, 'state': state.get(field), 'probe': record['intent'].get('probe', False)}

    def publish(self, receipt):
        record = json.loads(Path(receipt).read_text())
        intent = publication_intent(receipt, record)
        if record.get('account_id') != self.user_id or intent.get('account') != self.account:
            raise MetaError('receipt_account_mismatch')
        validate_intent(intent, now_utc(), publishing=True)
        validate_source(intent)
        self.identity()
        state = self.container(receipt)
        if state['state'] != 'FINISHED':
            raise MetaError('container_not_ready_or_already_published')
        if intent['action'] == 'reply':
            self.owner_reply(intent)
        edge = 'threads_publish' if self.platform == 'threads' else 'media_publish'
        result = once(Path(receipt).with_suffix('.publish.json'),
                      {'intent': intent, 'container_id': state['container_id'], 'account_id': self.user_id},
                      lambda: self.request(self.user_id + '/' + edge, {'creation_id': state['container_id']}, 'POST', intent=intent, publishing=True))
        public_id = str(result.get('id', ''))
        if not public_id.isdigit():
            raise MetaError('public_id_missing_reconcile_without_resending')
        rows = self.replies(str(intent['parent_id'])) if intent['action'] == 'reply' else self.posts()
        exact = next((p for p in rows if str(p['id']) == public_id), None)
        if exact is None or exact.get('text', exact.get('caption', '')) != intent['text']:
            raise MetaError('public_readback_pending_do_not_republish')
        return {'public_id': public_id, 'public_readback': exact, 'verified_at': now_utc().isoformat()}

    def reply(self, intent, receipt):
        validate_intent(intent, now_utc(), publishing=True)
        if Path(receipt).resolve() != operation_receipt(intent).resolve():
            raise MetaError('use_stable_content_receipt_across_runs')
        if self.platform != 'instagram' or intent.get('platform') != self.platform or intent.get('action') != 'reply':
            raise MetaError('wrong_reply_operation')
        validate_source(intent)
        self.identity()
        self.owner_reply(intent)
        result = once(receipt, {'intent': intent, 'account_id': self.user_id},
                      lambda: self.request(str(intent['reply_to_id']) + '/replies', {'message': intent['text']}, 'POST', intent=intent, publishing=True))
        row = next((p for p in self.replies(str(intent['parent_id'])) if str(p['id']) == str(result.get('id'))), None)
        if row is None or row.get('text') != intent['text']:
            raise MetaError('reply_readback_pending_do_not_resend')
        return {'reply_readback': row, 'verified_at': now_utc().isoformat()}

    def reconcile(self, receipt):
        record = json.loads(Path(receipt).read_text())
        if record.get('account_id') != self.user_id or record['intent'].get('account') != self.account:
            raise MetaError('receipt_account_mismatch')
        self.identity()
        intent = record['intent']
        attempted = Path(receipt).with_suffix('.publish.json')
        if not attempted.exists():
            return self.container(receipt)
        publication = json.loads(attempted.read_text())
        known = str(publication.get('response', {}).get('id', ''))
        rows = self.replies(str(intent['parent_id'])) if intent['action'] == 'reply' else self.posts()
        matches = [p for p in rows if p.get('text', p.get('caption', '')) == intent['text'] and
                   (str(p['id']) == known if known else
                    0 <= (date(p['timestamp']) - date(publication['attempted_at'])).total_seconds() <= 900)]
        if len(matches) != 1:
            return {'status': 'uncertain', 'matches': len(matches), 'resend_allowed': False}
        return {'status': 'public_readback_verified', 'public_id': str(matches[0]['id']),
                'public_readback': matches[0], 'verified_at': now_utc().isoformat()}

    def refresh(self):
        self.identity()
        if not refresh_due(self.credentials, now_utc()):
            return {'status': 'not_due', 'issued_at': self.credentials.get('issued_at'),
                    'next_check_due_after': (date(self.credentials.get('refreshed_at', self.credentials.get('issued_at'))) + timedelta(days=7)).isoformat()}
        receipt = OPERATIONS / 'meta-api-refresh' / (self.platform + '-' + digest(self.original)[:20] + '.json')
        def renew():
            result = self.request('refresh_access_token', {
                'grant_type': 'th_refresh_token' if self.platform == 'threads' else 'ig_refresh_token',
                'access_token': self.token})
            replacement = result.get('access_token')
            expires = result.get('expires_in')
            if not isinstance(replacement, str) or not isinstance(expires, int) or expires <= 0:
                raise MetaError('invalid_refresh_response')
            self.token = replacement
            self.identity()
            if self.path.read_bytes() != self.original:
                raise MetaError('credentials_changed_by_other_owner')
            data = {**self.credentials, 'access_token': replacement, 'refreshed_at': now_utc().isoformat(),
                    'expires_at': (now_utc() + timedelta(seconds=expires)).isoformat(), 'refresh_tested': True}
            private_json(self.path, data)
            return {'status': 'refreshed', 'expires_at': data['expires_at'], 'identity_verified': True}
        return once(receipt, {'platform': self.platform, 'account_id': self.user_id}, renew)


def public_url(value):
    parsed = urllib.parse.urlsplit(value)
    host = parsed.hostname or ''
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise MetaError('media_url_must_be_public_https')
    if not host or host == 'localhost' or host.endswith(('.local', '.localhost')):
        raise MetaError('private_media_host')
    try:
        if not ipaddress.ip_address(host).is_global:
            raise MetaError('private_media_host')
    except ValueError:
        pass
    return value


def private_output(value):
    path = Path(value).expanduser()
    if not path.resolve().is_relative_to(OPERATIONS.resolve()) or path.is_symlink():
        raise MetaError('output_must_be_in_private_gling_operations')
    return path


def approval_slots(approved_at, content_ids, occupied=(), *, per_day=8):
    if approved_at.tzinfo is None or not content_ids or len(set(content_ids)) != len(content_ids) or per_day not in (8, 12):
        raise MetaError('unique_approved_contents_required')
    rng = random.Random(digest((approved_at.isoformat() + '\n' + '\n'.join(content_ids)).encode()))
    anchor = approved_at.astimezone(timezone.utc)
    start = anchor.replace(second=0, microsecond=0) + timedelta(minutes=35 - anchor.minute % 5)
    planned = []
    for i, content_id in enumerate(content_ids):
        at = start + (timedelta(hours=i * 2) if per_day == 12 else
                      timedelta(minutes=i * (24 * 60 // (5 * min(8, len(content_ids)))) * 5 + rng.randrange(4) * 5))
        if any(abs((at - other).total_seconds()) < 1800 for other in occupied):
            raise MetaError('existing_reservation_conflict_keep_original_schedule')
        planned.append({'content_id': content_id, 'scheduled_for': at.isoformat()})
    return planned


def plan_approved_batch(approval_path, platform, account, now, queue=None):
    if account not in ('gling.app', 'chalkakandupload') or platform not in ACCOUNTS or platform == 'instagram' and account != 'gling.app':
        raise MetaError('wrong_account')
    approval = json.loads(Path(approval_path).read_text())
    if approval.get('kind') != 'morning_batch' or not approval.get('owner_quote') or not approval.get('batch_id'):
        raise MetaError('morning_batch_owner_approval_required')
    approved_at = date(approval.get('approved_at'))
    if approved_at > now:
        raise MetaError('approval_receipt_missing_or_future_dated')
    items = [r for r in approval.get('items', []) if r.get('platform') == platform and r.get('account') == account]
    if len(items) > 8 and approval.get('schedule_policy') not in ('rolling_eight_per_day', 'rolling_twelve_per_day'):
        raise MetaError('explicit_rolling_batch_approval_required')
    names = {'instagram': 'festival-content-ledger.json', 'threads': 'brand-threads-queue.json'}
    queue = Path(queue or Path(__file__).parent / ('chalkakandupload-approvals.json' if account == 'chalkakandupload' else names[platform]))
    original = queue.read_bytes(); data = json.loads(original)
    if str(data.get('account_handle', 'gling.app')).lstrip('@') != account:
        raise MetaError('wrong_due_account')
    rows = data.get('events', data.get('entries', []))
    selected = [r['content_id'] for r in items]
    occupied = []
    for row in rows:
        channel = row.get('channels', {}).get('instagram', {}) if platform == 'instagram' else row
        stamp = (channel.get('api_intent') or {}).get('scheduled_for') or channel.get('scheduled_for') or channel.get('scheduled_at') or channel.get('planned_slot')
        if row.get('content_id') in selected:
            if stamp or channel.get('status') in ('api_ready','scheduled','published','cancelled','removed') or any(
                    r.get(k) for r in (row,channel) for k in ('held','hold','uncertain','sending','attempted_at','public_id','native_receipt','native_scheduled_saved')):
                raise MetaError('protected_record_reconcile_first')
            item = next(r for r in items if r['content_id'] == row['content_id'])
            copy_sha = channel.get('copy_sha256') or row.get('copy_sha256') or (channel.get('review_request') or {}).get('copy_sha256')
            if not copy_sha or item.get('copy_sha256') != copy_sha:
                raise MetaError('morning_batch_exact_content_changed')
            receipt = operation_receipt(item)
            if receipt.exists() or receipt.with_suffix('.publish.json').exists():
                raise MetaError('attempt_exists_reconcile_without_resending')
        elif stamp:
            occupied.append(date(stamp))
    if any(sum(r.get('content_id') == key for r in rows) != 1 for key in selected):
        raise MetaError('original_record_missing_or_duplicate')
    schedule_anchor = approved_at
    if platform == 'threads' and account == 'gling.app' and approval.get('approval_basis') == 'scoped_recurring_owner_authorization':
        schedule_anchor = max([approved_at, *occupied])  # Preserve the order of frozen mixed-post reservations.
    planned = approval_slots(schedule_anchor, selected, occupied,
                            per_day=12 if approval.get('schedule_policy') == 'rolling_twelve_per_day' else 8)
    if any(date(r['scheduled_for']) <= now for r in planned):
        raise MetaError('approval_plan_expired_do_not_slide_original_times')
    if queue.read_bytes() != original:
        raise MetaError('queue_changed_during_plan')
    return {'status':'approval_schedule_planned', 'batch_id':approval['batch_id'],
            'platform':platform, 'account':account, 'approved_at':approval['approved_at'],
            'approval_receipt':str(Path(approval_path).resolve()), 'source_queue':str(queue.resolve()),
            'source_sha256':digest(original), 'items':planned, 'queue_saved':False, 'published':False}


def due_threads(now, queue=None, *, account='gling.app'):
    if account not in ('gling.app', 'chalkakandupload'):
        raise MetaError('wrong_due_account')
    personal = account == 'chalkakandupload'
    queue = queue or Path(__file__).parent / ('chalkakandupload-approvals.json' if personal else 'brand-threads-queue.json')
    local = now.astimezone(ZoneInfo('America/Vancouver'))
    slot = local.strftime('%H:%M')
    slots = ('08:00', '09:00', '10:00', '11:00', '13:00', '15:00', '17:00', '19:00') if personal else ('08:30', '10:00', '11:00', '13:30', '16:00', '17:30', '18:30', '20:00')
    data = json.loads(Path(queue).read_text())
    if str(data.get('account_handle', 'gling.app')).lstrip('@') != account:
        raise MetaError('wrong_due_account')
    rows = data['entries']
    due = [r for r in rows if r.get('scheduled_for') and
           0 <= (now - date(r['scheduled_for'])).total_seconds() <
           (300 if (r.get('api_intent') or {}).get('schedule_mode') == 'approval_relative' else 60) and
           (slot in slots or (r.get('api_intent') or {}).get('schedule_mode') == 'approval_relative')]
    if not due:
        if not personal and slot in ('07:15', '16:15'):
            return {'status': 'preparation_run', 'slot': slot}
        if slot not in slots:
            return {'status': 'outside_slot', 'slot': slot, 'backfill_allowed': False}
        return {'status': 'no_approved_record_due', 'slot': slot, 'backfill_allowed': False}
    if len(due) != 1:
        raise MetaError('overlapping_original_slot_reconcile_first')
    row = due[0]
    if row.get('submission_kind') == 'native_future_schedule':
        return {'status': 'native_reservation_preserved', 'content_id': row['content_id'], 'slot': slot}
    intent = row.get('api_intent')
    if not intent:
        raise MetaError('no_approved_api_intent_in_original_queue')
    if intent.get('account') != account:
        raise MetaError('wrong_due_account')
    validate_intent(intent, now, publishing=True)
    validate_source(intent)
    client = MetaClient('threads', account=account) if personal else MetaClient('threads')
    receipt = operation_receipt(intent)
    if receipt.with_suffix('.publish.json').exists():
        return client.reconcile(receipt)
    deadline = time.monotonic() + 45
    state = client.container(receipt) if receipt.exists() else client.prepare(intent, receipt)
    while state['state'] == 'IN_PROGRESS' and time.monotonic() < deadline:
        time.sleep(1)
        state = client.container(receipt)
    if state['state'] != 'FINISHED':
        raise MetaError('container_not_finished_within_original_deadline')
    return client.publish(receipt)


def due_instagram(now, ledger=Path(__file__).parent / 'festival-content-ledger.json'):
    local = now.astimezone(ZoneInfo('America/Vancouver'))
    slot = local.strftime('%H:%M')
    legacy_slot = local.hour in (8, 10, 12, 14, 16, 17, 19, 21) and local.minute < 5
    due = []
    for row in json.loads(Path(ledger).read_text())['events']:
        channel = row.get('channels', {}).get('instagram', {})
        intent = channel.get('api_intent')
        stamp = intent.get('scheduled_for') if intent else channel.get('scheduled_at', channel.get('planned_slot'))
        if stamp and 0 <= (now - date(stamp)).total_seconds() < 300 and (legacy_slot or (intent or {}).get('schedule_mode') == 'approval_relative'):
            due.append((row, channel, intent))
    if not due:
        if not legacy_slot:
            return {'status': 'outside_slot', 'slot': slot, 'backfill_allowed': False}
        return {'status': 'no_approved_record_due', 'slot': slot, 'backfill_allowed': False}
    if len(due) != 1:
        raise MetaError('overlapping_original_slot_reconcile_first')
    row, channel, intent = due[0]
    if channel.get('submission_kind') == 'native_future_schedule' or channel.get('native_scheduled_saved'):
        return {'status': 'native_reservation_preserved', 'content_id': row['content_id'], 'slot': slot}
    if not intent:
        raise MetaError('no_approved_api_intent_in_original_queue')
    if (intent.get('platform') != 'instagram' or intent.get('action') != 'reel'
            or intent.get('automation_id') != INSTAGRAM_AUTOMATION):
        raise MetaError('wrong_due_account')
    if any(channel.get(k) for k in ('held', 'hold', 'uncertain', 'sending', 'attempted_at')):
        raise MetaError('protected_record_reconcile_first')
    validate_intent(intent, now, publishing=True)
    validate_source(intent)
    receipt = operation_receipt(intent)
    # Instagram preparation stays strictly before the slot; consume its existing once receipt.
    if not receipt.is_file():
        raise MetaError('instagram_container_not_prepared_before_slot')
    record = json.loads(receipt.read_text())
    if (record.get('status') != 'response_received' or publication_intent(receipt, record) != intent
            or record.get('platform') != 'instagram' or record.get('account_id') != ACCOUNTS['instagram'][2]):
        raise MetaError('prepared_receipt_changed_or_uncertain_reconcile_first')
    client = MetaClient('instagram')
    if receipt.with_suffix('.publish.json').exists():
        return client.reconcile(receipt)
    state = client.container(receipt)
    if state['state'] != 'FINISHED':
        raise MetaError('container_not_ready_or_already_published')
    return client.publish(receipt)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['inspect', 'inbox', 'identity', 'refresh', 'prepare', 'container', 'publish', 'reply', 'reconcile', 'due', 'plan', 'delete-media', 'delete-post'])
    parser.add_argument('platform', choices=ACCOUNTS)
    parser.add_argument('--account', choices=('gling.app', 'chalkakandupload'), default='gling.app')
    parser.add_argument('--intent')
    parser.add_argument('--approval-receipt')
    parser.add_argument('--receipt')
    parser.add_argument('--media-id')
    parser.add_argument('--execute', action='store_true', help='Execute guarded media deletion; default is read-only preflight')
    parser.add_argument('--out', required=True, help='Private JSON result inside existing Gling operations folder')
    args = parser.parse_args()
    out = None
    try:
        out = private_output(args.out)
        if args.command == 'plan':
            result = plan_approved_batch(args.approval_receipt, args.platform, args.account, now_utc())
            private_json(out, result)
            print(json.dumps(result))
            return 0
        if args.command == 'due':
            if args.platform == 'instagram' and args.account != 'gling.app':
                raise MetaError('wrong_due_account')
            result = due_threads(now_utc(), account=args.account) if args.platform == 'threads' else due_instagram(now_utc())
            private_json(out, result)
            print(json.dumps(result))
            return 3 if result.get('status') == 'outside_slot' else 0
        client = MetaClient(args.platform, account=args.account)
        receipt = private_output(args.receipt) if args.receipt else None
        if args.command == 'delete-media':
            result = client.delete_media(args.media_id, execute=args.execute)
        elif args.command == 'delete-post':
            intent = json.loads(Path(args.intent).read_text()) if args.intent else None
            result = client.delete_post(args.media_id, execute=args.execute, intent=intent)
        elif args.command in ('prepare', 'reply'):
            if not args.intent or receipt is None:
                raise MetaError('intent_and_receipt_required')
            intent = json.loads(Path(args.intent).read_text())
            result = getattr(client, args.command)(intent, receipt)
        elif args.command in ('container', 'publish', 'reconcile'):
            if receipt is None:
                raise MetaError('receipt_required')
            client.identity()
            result = getattr(client, args.command)(receipt)
        else:
            result = getattr(client, args.command)()
        # Paging URLs can contain a token even when authentication used a header.
        serialized = json.dumps(result, ensure_ascii=False).replace(client.token, '[REDACTED]')
        private_json(out, json.loads(serialized))
        print(json.dumps({'status': 'saved', 'platform': args.platform, 'command': args.command, 'result': str(out)}))
    except (MetaError, OSError, ValueError, KeyError) as error:
        reason = str(error) if isinstance(error, MetaError) else type(error).__name__
        blocked = {'status': 'blocked', 'reason': reason, 'observed_at': now_utc().isoformat()}
        if out is not None:
            private_json(out, blocked)
        print(json.dumps(blocked))
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
