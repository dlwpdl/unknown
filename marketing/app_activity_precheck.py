"""Existing central job: wake for durable app events or its original half-hour checks."""
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import runpy
import tempfile
import uuid
from zoneinfo import ZoneInfo


ROOT = Path.home() / 'Library/Application Support/gling/operations/automation-manager/app-activity'
EVENT_KEYS = {'id', 'kind', 'target_id', 'actor_id', 'context_id', 'action',
              'occurred_at', 'operated_actor', 'attention'}
KINDS = {'post', 'comment', 'message', 'conversation', 'meetup_request', 'monitor_probe'}


def query_database(sql):
    # Reuse the server operations connection; this feed never reads content bodies.
    helper = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/storage-usage.py'))
    return helper['query'](sql, helper['token']())


def save_private(path, value):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.parent.chmod(0o700)
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as f:
        temporary = Path(f.name)
        try:
            os.chmod(temporary, 0o600)
            json.dump(value, f, ensure_ascii=False, indent=2)
            f.write('\n'); f.flush(); os.fsync(f.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def validate_events(events):
    if not isinstance(events, list) or len(events) > 100:
        raise ValueError('INVALID_ACTIVITY_BATCH')
    seen = set()
    for event in events:
        if not isinstance(event, dict) or set(event) != EVENT_KEYS:
            raise ValueError('METADATA_ONLY_ACTIVITY_REQUIRED')
        if type(event['id']) is not int or event['id'] <= 0 or event['id'] in seen:
            raise ValueError('INVALID_ACTIVITY_ID')
        seen.add(event['id'])
        if event['kind'] not in KINDS or event['action'] not in {'insert', 'update', 'probe'}:
            raise ValueError('INVALID_ACTIVITY_KIND')
        if event['attention'] is not True or event['operated_actor'] is not False:
            raise ValueError('NONACTIONABLE_ACTIVITY_BATCH')
        for key in ['target_id', 'actor_id', 'context_id']:
            if event[key] is not None:
                uuid.UUID(event[key])
        if event['target_id'] is None or not isinstance(event['occurred_at'], str):
            raise ValueError('INVALID_ACTIVITY_TARGET')
        datetime.fromisoformat(event['occurred_at'].replace('Z', '+00:00'))


def persona_gate(events, root):
    from persona_response import stage, wakeup
    response_root = root / 'persona-responses'
    stage(events, root=response_root)
    return {'ready': False} if events else wakeup(root=response_root)


def check(*, now=None, root=ROOT, query=query_database, response_gate=persona_gate):
    now = (now or datetime.now(ZoneInfo('America/Vancouver'))).astimezone(ZoneInfo('America/Vancouver'))
    root.mkdir(mode=0o700, parents=True, exist_ok=True); root.chmod(0o700)
    result = {'checked_at': now.isoformat(), 'routine_checkpoint': now.minute in {0, 30},
              'ai_continue': now.minute in {0, 30}}
    events = []
    try:
        batch = str(uuid.uuid4())
        value = query(f"select private.claim_gling_activity('{batch}'::uuid) as result")[0]['result']
        events = value['events']; validate_events(events)
        result.update(status='consumer_busy' if value['busy'] else 'no_new_activity',
                      pending_count=int(value['pending_count']))
        if events:
            if value['busy']:
                raise ValueError('AMBIGUOUS_ACTIVITY_LEASE')
            batch = str(uuid.UUID(value['batch_id']))
            ticket = {'batch_id': batch, 'observed_at': now.isoformat(), 'events': events}
            save_private(root / 'batches' / (batch + '.json'), ticket)
            save_private(root / 'pending.json', ticket)
            result.update(status='activity_ready', batch_id=batch, event_count=len(events),
                          ticket=str(root / 'batches' / (batch + '.json')), ai_continue=True)
    except (Exception, SystemExit):
        # Do not echo database/network errors: they may include credentials or private text.
        result.update(status='monitor_check_failed', error_code='ACTIVITY_CHECK_FAILED')
        events = []
    try:
        response = response_gate(events, root)
        result['persona_responses'] = response
        result['ai_continue'] = result['ai_continue'] or response['ready']
    except Exception:
        result['persona_responses'] = {'ready': False, 'error_code': 'PERSONA_GATE_FAILED'}
    save_private(root / 'latest-check.json', result)
    return result


def ack(batch, report, *, root=ROOT, query=query_database):
    batch = str(uuid.UUID(batch))
    try:
        ticket = json.loads((root / 'batches' / (batch + '.json')).read_text())
        report = Path(report).resolve()
        raw = report.read_bytes(); review = json.loads(raw)
        ids = [event['id'] for event in ticket['events']]
        handled = review['handled_event_ids']
        if (ticket['batch_id'] != batch or review['batch_id'] != batch
                or review['outcome'] != 'reviewed' or not isinstance(handled, list)
                or any(type(n) is not int for n in handled)
                or len(handled) != len(ids) or set(handled) != set(ids)):
            raise ValueError('ACTIVITY_ASSESSMENT_REQUIRED')
    except (OSError, KeyError, TypeError, ValueError):
        raise ValueError('ACTIVITY_ASSESSMENT_REQUIRED') from None
    receipt = {'batch_id': batch, 'event_ids': ids, 'report_path': str(report),
               'report_sha256': hashlib.sha256(raw).hexdigest()}
    save_private(root / 'batches' / (batch + '.assessment.json'), receipt)
    count = query(f"select private.ack_gling_activity('{batch}'::uuid) as acknowledged")[0]['acknowledged']
    if type(count) is not int or not 0 <= count <= len(ids):
        raise ValueError('INVALID_ACTIVITY_ACK')
    receipt.update(acknowledged=count, checked_at=datetime.now(ZoneInfo('America/Vancouver')).isoformat())
    save_private(root / 'batches' / (batch + '.ack.json'), receipt)
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('check')
    acknowledge = commands.add_parser('ack')
    acknowledge.add_argument('--batch', required=True)
    acknowledge.add_argument('--report', required=True, type=Path)
    args = parser.parse_args()
    if args.command == 'check':
        result = check(); print(json.dumps(result)); raise SystemExit(0 if result['ai_continue'] else 3)
    try:
        print(json.dumps(ack(args.batch, args.report)))
    except Exception:
        print(json.dumps({'status': 'ack_failed', 'error_code': 'ACTIVITY_ACK_FAILED'}))
        raise SystemExit(1)
