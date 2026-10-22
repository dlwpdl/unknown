"""Protected operated-persona inbox for the existing central automation."""
import argparse
import hashlib
import json
from pathlib import Path
import runpy
import time
import uuid

from app_activity_precheck import ROOT as ACTIVITY_ROOT, save_private

ROOT = ACTIVITY_ROOT / 'persona-responses'
KINDS = {'comment', 'message', 'conversation', 'meetup_request'}
ACTIONS = {'comment_reply', 'message_reply', 'accept_conversation', 'hold_meetup'}
PENDING = {'pending', 'auth_required', 'ready', 'uncertain', 'refresh_required'}


def gateway():
    return runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/admin_merchant_gateway.py'))


def rpc(name, args):
    if name not in {'get_admin_persona_case', 'get_admin_persona_pending', 'act_admin_persona_case'}:
        raise ValueError('UNKNOWN_PERSONA_OPERATION')
    api = gateway()
    return api['request']('/rest/v1/rpc/' + name, args, api['active_session']()['access_token'])


def connected():
    return gateway()['connection_status']()['connected']


def case_path(case_id, root):
    kind, sep, target = case_id.partition(':')
    if kind not in KINDS or not sep or str(uuid.UUID(target)) != target:
        raise ValueError('INVALID_PERSONA_CASE')
    return root / 'cases' / (kind + '-' + target + '.json')


def stage(events, *, root=ROOT):
    root.mkdir(mode=0o700, parents=True, exist_ok=True); root.chmod(0o700)
    for event in events:
        if event['kind'] not in KINDS:
            continue
        case_id = event['kind'] + ':' + event['target_id']
        path = case_path(case_id, root)
        if not path.exists():
            save_private(path, {'case_id': case_id, 'kind': event['kind'],
                                'target_id': event['target_id'], 'state': 'pending'})


def cases(*, root=ROOT):
    return [json.loads(path.read_text()) for path in sorted((root / 'cases').glob('*.json'))]


def set_state(case_id, state, *, root, **fields):
    path = case_path(case_id, root)
    value = json.loads(path.read_text())
    value.update(state=state, updated_at=int(time.time()), **fields)
    save_private(path, value)
    return value


def error_state(error):
    return 'auth_required' if str(error) in {'AI_CONNECTION_REQUIRED', 'ADMIN_REQUIRED', 'ADMIN_MFA_REQUIRED', 'UNAUTHORIZED'} else 'uncertain'


def wakeup(*, root=ROOT, connected=connected, now=None):
    pending = sum(row['state'] in PENDING for row in cases(root=root))
    result = {'pending_count': pending, 'ready': False}
    if not pending:
        return result
    now = time.time() if now is None else now
    path = root / 'wake.json'
    previous = json.loads(path.read_text()) if path.exists() else {}
    if now >= previous.get('next_after', 0) and connected():
        result['ready'] = True
        # New source events wake immediately; this bounds backlog/auth-recovery retries.
        save_private(path, {'next_after': now + 300})
    return result


def reconcile(*, root=ROOT, rpc=rpc):
    try:
        rows = rpc('get_admin_persona_pending', {'p_limit': 100})
        if not isinstance(rows, list): raise ValueError('INVALID_PERSONA_INBOX')
        stage(rows, root=root)
        return {'state': 'reconciled', 'discovered': len(rows)}
    except Exception as error:
        return {'state': error_state(error)}


def context(case_id, *, root=ROOT, rpc=rpc):
    path = case_path(case_id, root)
    case = json.loads(path.read_text())
    attempt = root / 'attempts' / path.name
    if attempt.exists() and not json.loads(attempt.read_text()).get('rejected'):
        return case
    try:
        value = rpc('get_admin_persona_case', {'p_kind': case['kind'], 'p_target_id': case['target_id']})
        if not isinstance(value, dict) or type(value.get('eligible')) is not bool:
            raise ValueError('INVALID_PERSONA_CONTEXT')
        context_path = root / 'contexts' / path.name
        save_private(context_path, value)
        return set_state(case_id, 'ready' if value['eligible'] else 'not_actionable', root=root,
                         context_path=str(context_path), context_status=value.get('status'))
    except Exception as error:
        return set_state(case_id, error_state(error), root=root)


def execute(plan, *, root=ROOT, rpc=rpc):
    if not isinstance(plan, dict) or set(plan) != {'case_id', 'persona_id', 'revision', 'action', 'body', 'idempotency_key', 'checks'}:
        raise ValueError('INVALID_PERSONA_PLAN')
    path = case_path(plan['case_id'], root)
    case = json.loads(path.read_text())
    for key in ['persona_id', 'idempotency_key']:
        if str(uuid.UUID(plan[key])) != plan[key]: raise ValueError('INVALID_PERSONA_PLAN')
    if plan['action'] not in ACTIONS or plan['checks'] != {'persona': True, 'meaning': True, 'patina': True}:
        raise ValueError('PERSONA_REVIEW_REQUIRED')
    reply = plan['action'] in {'comment_reply', 'message_reply'}
    limit = 1000 if plan['action'] == 'comment_reply' else 2000
    if (not isinstance(plan['body'], str) or len(plan['body']) > limit
            or (reply and not plan['body'].strip()) or (not reply and plan['body'] != '')):
        raise ValueError('INVALID_PERSONA_BODY')
    raw = json.dumps(plan, ensure_ascii=False, sort_keys=True).encode()
    digest = hashlib.sha256(raw).hexdigest()
    attempt = root / 'attempts' / path.name
    previous = None
    if attempt.exists():
        previous = json.loads(attempt.read_text())
        if previous['plan_sha256'] != digest and not previous.get('rejected'):
            raise ValueError('EXACT_PERSONA_RETRY_REQUIRED')
        if case['state'] in {'completed', 'owner_review'}:
            return case
    if previous is None or previous.get('rejected'):
        value = json.loads((root / 'contexts' / path.name).read_text())
        if (not value.get('eligible') or value.get('persona_id') != plan['persona_id']
                or value.get('revision') != plan['revision']):
            raise ValueError('FRESH_PERSONA_CONTEXT_REQUIRED')
        if previous:
            if previous['plan']['idempotency_key'] == plan['idempotency_key']:
                raise ValueError('NEW_PERSONA_REVIEW_REQUIRED')
            save_private(root / 'rejections' / (path.stem + '-' + previous['plan']['idempotency_key'] + '.json'), previous)
        save_private(attempt, {'plan_sha256': digest, 'plan': plan, 'attempted_at': int(time.time())})
    try:
        receipt = rpc('act_admin_persona_case', {
            'p_kind': case['kind'], 'p_target_id': case['target_id'],
            'p_persona_id': plan['persona_id'], 'p_revision': plan['revision'],
            'p_action': plan['action'], 'p_body': plan['body'], 'p_idempotency_key': plan['idempotency_key']})
        if not isinstance(receipt, dict) or receipt.get('status') != ('held' if plan['action'] == 'hold_meetup' else 'performed'):
            raise ValueError('PERSONA_RECEIPT_REQUIRED')
        save_private(root / 'receipts' / path.name, receipt)
        return set_state(plan['case_id'], 'owner_review' if plan['action'] == 'hold_meetup' else 'completed',
                         root=root, plan_sha256=digest, receipt_path=str(root / 'receipts' / path.name))
    except Exception as error:
        if isinstance(error, ValueError) and str(error) == 'STALE_SOURCE':
            rejected = json.loads(attempt.read_text())
            rejected.update(rejected=True, error_code='STALE_SOURCE')
            save_private(attempt, rejected)
            return set_state(plan['case_id'], 'refresh_required', root=root, plan_sha256=digest)
        if isinstance(error, ValueError) and str(error) in {
                'ALREADY_ACTED', 'IDEMPOTENCY_CONFLICT', 'CASE_INELIGIBLE', 'PERSONA_MISMATCH',
                'INVALID_BODY', 'UNSUPPORTED_ACTION', 'INVALID_ARGUMENT', 'RECIPIENT_REQUIRED',
                'REQUEST_EXPIRED', 'BLOCKED', 'ACCOUNT_LOCKED', 'CONTENT_NOT_ALLOWED',
                'GLING_API_400', 'GLING_API_404', 'GLING_API_409', 'GLING_API_422'}:
            return set_state(plan['case_id'], 'review_required', root=root, plan_sha256=digest)
        return set_state(plan['case_id'], error_state(error), root=root, plan_sha256=digest)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('list'); commands.add_parser('reconcile')
    stage_command = commands.add_parser('stage'); stage_command.add_argument('--ticket', required=True, type=Path)
    read_command = commands.add_parser('context'); read_command.add_argument('--case', required=True)
    write_command = commands.add_parser('execute'); write_command.add_argument('--plan', required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.command == 'list': result = cases()
        elif args.command == 'reconcile': result = reconcile()
        elif args.command == 'context': result = context(args.case)
        elif args.command == 'execute': result = execute(json.loads(args.plan.read_text()))
        else:
            ticket = json.loads(args.ticket.read_text()); stage(ticket['events']); result = {'state': 'staged'}
        print(json.dumps(result, ensure_ascii=False))
    except Exception:
        print(json.dumps({'state': 'failed', 'error_code': 'PERSONA_OPERATION_FAILED'}))
        raise SystemExit(1)
