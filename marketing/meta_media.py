"""Owner's local server staging only; never imported into the app or exposed through MCP."""
import argparse
import importlib.util
import json
import re
import ssl
import urllib.error
import urllib.request
from datetime import timedelta
from pathlib import Path

from meta_api import (MetaClient, MetaError, NoRedirect, digest, now_utc, once, private_json,
                      private_output, validate_intent, validate_source, OPERATIONS)

PROJECT = 'wjvahbdwmctzpkndqaxa'
ORIGIN = 'https://' + PROJECT + '.supabase.co'
BUCKET = 'sns-media'


class MediaStore:
    def __init__(self):
        # Reuse the owner's existing server credential; no key is retained in files or passed to clients.
        path = Path(__file__).parents[1] / 'scripts/storage-usage.py'
        spec = importlib.util.spec_from_file_location('gling_storage_usage', path)
        existing = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(existing)
        context = ssl.create_default_context()
        if Path('/etc/ssl/cert.pem').exists():
            context.load_verify_locations('/etc/ssl/cert.pem')
        self.opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=context))
        request = urllib.request.Request('https://api.supabase.com/v1/projects/' + PROJECT + '/api-keys',
                                         headers={'Authorization': 'Bearer ' + existing.token()})
        try:
            with self.opener.open(request, timeout=20) as response:
                keys = json.load(response)
            self.key = next(k['api_key'] for k in keys if k['name'] == 'service_role' and k['type'] == 'legacy')
        except (OSError, ValueError, KeyError, StopIteration):
            raise MetaError('server_media_credential_unavailable') from None
        bucket = self.request('/bucket/' + BUCKET)
        if bucket.get('public') is not False or bucket.get('file_size_limit') != 67108864:
            raise MetaError('private_media_bucket_not_configured')

    def request(self, path, body=None, method='GET', mime=None, raw=False):
        asset = r'instagram/gling\.app/[0-9a-f]{64}\.(mp4|jpg|png)'
        deleting = path == '/object/' + BUCKET and method == 'DELETE'
        listing = path == '/object/list/' + BUCKET and method == 'POST'
        if path == '/bucket/' + BUCKET and method != 'GET':
            raise MetaError('bucket_configuration_is_read_only')
        if path.startswith('/object/sign/') and (method != 'POST' or body != {'expiresIn': 2400}):
            raise MetaError('signed_links_are_bounded_to_40_minutes')
        if path.startswith('/object/authenticated/') and method != 'GET':
            raise MetaError('authenticated_media_download_is_read_only')
        if listing:
            if not isinstance(body, dict) or body.get('prefix') != 'instagram/gling.app/' or not re.fullmatch(r'[0-9a-f]{64}\.(mp4|jpg|png)', body.get('search', '')) or body.get('limit') != 1:
                raise MetaError('list_only_exact_official_asset')
        elif deleting:
            keys = body.get('prefixes', []) if isinstance(body, dict) else []
            if not keys or any(not re.fullmatch(asset, k) for k in keys):
                raise MetaError('cleanup_only_exact_official_content_hash_paths')
        elif not (path == '/bucket/' + BUCKET or re.fullmatch(r'/object/(authenticated/|sign/)?' + BUCKET + '/' + asset, path)):
            raise MetaError('unsafe_storage_path')
        headers = {'Authorization': 'Bearer ' + self.key, 'apikey': self.key}
        data = body if mime else json.dumps(body).encode() if body is not None else None
        if data is not None:
            headers['Content-Type'] = mime or 'application/json'
        if mime:
            headers['Cache-Control'] = 'max-age=120'
        request = urllib.request.Request(ORIGIN + '/storage/v1' + path, headers=headers, data=data, method=method)
        try:
            with self.opener.open(request, timeout=30) as response:
                data = response.read()
                return data if raw else json.loads(data)
        except urllib.error.HTTPError as error:
            raise MetaError('storage_http_' + str(error.code)) from None
        except (OSError, ValueError):
            raise MetaError('storage_response_unknown_reconcile_path') from None

    def asset(self, file, sha, mime):
        data = Path(file).read_bytes()
        if digest(data) != sha or not 0 < len(data) <= 67108864:
            raise MetaError('changed_or_oversized_media')
        extension = {'video/mp4': '.mp4', 'image/jpeg': '.jpg', 'image/png': '.png'}[mime]
        key = 'instagram/gling.app/' + sha + extension
        try:
            stored = self.request('/object/authenticated/' + BUCKET + '/' + key, raw=True)
        except MetaError as error:
            if str(error) not in ('storage_http_400', 'storage_http_404'):
                raise
            receipt = OPERATIONS / 'meta-api-media' / (sha + '.upload.json')
            once(receipt, {'bucket': BUCKET, 'key': key, 'sha256': sha},
                 lambda: self.request('/object/' + BUCKET + '/' + key, data, 'POST', mime))
            stored = self.request('/object/authenticated/' + BUCKET + '/' + key, raw=True)
        if digest(stored) != sha:
            raise MetaError('stored_media_hash_mismatch')
        signed = self.request('/object/sign/' + BUCKET + '/' + key, {'expiresIn': 2400}, 'POST')
        url = signed.get('signedURL', '')
        if not url.startswith('/object/sign/' + BUCKET + '/' + key + '?'):
            raise MetaError('invalid_signed_media_path')
        return {'key': key, 'sha256': sha, 'bytes': len(data), 'url': ORIGIN + '/storage/v1' + url}

    def stage(self, intent):
        validate_intent(intent, now_utc())
        validate_source(intent)
        if intent['platform'] != 'instagram' or intent['action'] != 'reel':
            raise MetaError('only_official_instagram_reel_staging')
        video = self.asset(intent['video_file'], intent['video_sha256'], 'video/mp4')
        result = {'account': 'instagram:gling.app', 'video': video,
                  'signed_until': (now_utc() + timedelta(seconds=2400)).isoformat()}
        if intent.get('cover_file'):
            suffix = Path(intent['cover_file']).suffix.lower()
            mime = 'image/png' if suffix == '.png' else 'image/jpeg'
            result['cover'] = self.asset(intent['cover_file'], intent['cover_sha256'], mime)
        return result

    def retire(self, staged_path, receipt):
        stage = json.loads(Path(staged_path).read_text())
        original = json.loads(Path(receipt).read_text())
        intent = original['intent']
        if stage.get('account') != 'instagram:gling.app' or Path(intent.get('staging_receipt', '')).resolve() != Path(staged_path).resolve() or stage['video']['sha256'] != intent.get('video_sha256'):
            raise MetaError('cleanup_stage_mismatch')
        client = MetaClient('instagram')
        client.identity()
        state = client.container(receipt)
        if intent.get('probe'):
            if state['state'] != 'FINISHED':
                raise MetaError('probe_upload_not_processed')
        elif state['state'] != 'PUBLISHED' or client.reconcile(receipt).get('status') != 'public_readback_verified':
            raise MetaError('public_video_not_verified_for_cleanup')
        keys = [stage[k]['key'] for k in ('video', 'cover') if k in stage]
        existing = []
        for key in keys:
            rows = self.request('/object/list/' + BUCKET,
                                {'prefix': 'instagram/gling.app/', 'search': key.rsplit('/', 1)[1], 'limit': 1}, 'POST')
            if not rows:
                continue
            existing.append(key)
            expected = next(a for a in (stage.get('video'), stage.get('cover')) if a and a['key'] == key)
            try:
                data = self.request('/object/authenticated/' + BUCKET + '/' + key, raw=True)
                if digest(data) != expected['sha256']:
                    raise MetaError('cleanup_asset_hash_mismatch')
            except MetaError as error:
                if str(error) not in ('storage_http_400', 'storage_http_404'):
                    raise
        if existing:
            self.request('/object/' + BUCKET, {'prefixes': existing}, 'DELETE')
        for key in keys:
            rows = self.request('/object/list/' + BUCKET,
                                {'prefix': 'instagram/gling.app/', 'search': key.rsplit('/', 1)[1], 'limit': 1}, 'POST')
            if rows:
                raise MetaError('cleanup_metadata_readback_pending')
        # CDN copies may briefly persist; signed access remains bounded by the original expiry.
        return {'status': 'exact_staged_assets_retired', 'paths': keys, 'metadata_absence_verified': True,
                'meta_state_verified': state['state'], 'signed_access_expires_at': stage['signed_until']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--intent')
    mode.add_argument('--retire')
    parser.add_argument('--receipt')
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    try:
        out = private_output(args.out)
        if args.retire:
            if not args.receipt:
                raise MetaError('original_container_receipt_required')
            result = MediaStore().retire(private_output(args.retire), private_output(args.receipt))
        else:
            intent = json.loads(Path(args.intent).read_text())
            validate_intent(intent, now_utc())
            validate_source(intent)
            result = MediaStore().stage(intent)
        private_json(out, result)
        print(json.dumps({'status': result.get('status', 'staged_private'), 'bytes': result.get('video', {}).get('bytes'), 'receipt': str(out)}))
    except (MetaError, OSError, ValueError, KeyError) as error:
        print(json.dumps({'status': 'blocked', 'reason': str(error) if isinstance(error, MetaError) else type(error).__name__}))
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
