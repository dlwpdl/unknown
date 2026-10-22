"""Read-only G8 admission: review only a producer's frozen, future revision."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import sys


def review_candidates(ledger_path, now=None):
    ledger_path = Path(ledger_path)
    now = now or datetime.now(timezone.utc)
    original = ledger_path.read_bytes()
    rows = json.loads(original)['events']
    ready, skipped = [], []
    reports = (ledger_path.parent / 'reports').resolve()
    for row in rows:
        channel = row.get('channels', {}).get('instagram', {})
        request = channel.get('review_request')
        if not isinstance(request, dict) or request.get('state') != 'ready_for_review':
            continue
        content_id = row.get('content_id')
        try:
            if channel.get('status') in ('published', 'cancelled', 'removed') or any(
                    channel.get(k) for k in ('sending', 'uncertain', 'attempted_at')):
                raise ValueError('protected_or_finished_record')
            if request.get('account') != 'gling.app' or request.get('content_id') != content_id:
                raise ValueError('wrong_account_or_content')
            if not request.get('producer_run_id'):
                raise ValueError('missing_producer')
            original_slot = ((channel.get('api_intent') or {}).get('scheduled_for')
                             or channel.get('planned_slot') or channel.get('scheduled_at'))
            draft = request.get('mode') == 'morning_draft'
            if draft:
                if request.get('scheduled_for') or original_slot or channel.get('api_intent'):
                    raise ValueError('morning_draft_must_not_have_a_publication_slot')
            else:
                if not request.get('gling_post_id'):
                    raise ValueError('missing_app_readback')
                scheduled = datetime.fromisoformat(request['scheduled_for'].replace('Z', '+00:00'))
                if scheduled.tzinfo is None or scheduled <= now:
                    raise ValueError('expired_or_unzoned_slot')
                if not original_slot or datetime.fromisoformat(original_slot.replace('Z', '+00:00')) != scheduled:
                    raise ValueError('original_publication_slot_changed')
            receipt = Path(request['review_receipt'])
            if not receipt.is_absolute() or not receipt.resolve().is_relative_to(reports):
                raise ValueError('receipt_outside_existing_reports')
            files = [('video_file', 'video_sha256'),
                                      ('source_manifest', 'source_manifest_sha256'),
                                      ('caption_file', 'copy_sha256'),
                                      ('cover_file', 'cover_sha256')]
            if draft:
                files.append(('app_draft_file', 'app_draft_sha256'))
            for field, hash_field in files:
                path = Path(request[field])
                if not path.is_absolute() or not path.is_file():
                    raise ValueError('missing_' + field)
                digest = hashlib.sha256()
                with path.open('rb') as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                        digest.update(chunk)
                if digest.hexdigest() != request[hash_field]:
                    raise ValueError('hash_mismatch_' + field)
            fingerprint = hashlib.sha256(json.dumps(
                request, sort_keys=True, ensure_ascii=False, separators=(',', ':')
            ).encode()).hexdigest()
            if receipt.exists():
                previous = json.loads(receipt.read_text())
                if previous.get('request_sha256') == fingerprint and previous.get('decision') in (
                        'accepted', 'changes_required', 'blocked'):
                    raise ValueError('already_reviewed')
                raise ValueError('receipt_path_in_use')
            ready.append({'content_id': content_id, 'request_sha256': fingerprint,
                          'review_receipt': str(receipt), 'request': request})
        except (OSError, ValueError, KeyError, TypeError) as error:
            skipped.append({'content_id': content_id, 'reason': str(error)})
    if ledger_path.read_bytes() != original:
        return {'status': 'ledger_changed_during_check', 'ready': [], 'skipped': skipped}
    return {'status': 'review_ready' if ready else 'no_ready_review',
            'ready': ready, 'skipped': skipped}


if __name__ == '__main__':
    try:
        result = review_candidates(Path(__file__).with_name('festival-content-ledger.json'))
    except (OSError, ValueError, KeyError, TypeError) as error:
        result = {'status': 'review_check_blocked', 'ready': [], 'reason': str(error)}
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result['ready'] else 3)
