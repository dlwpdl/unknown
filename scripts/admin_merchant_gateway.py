"""Same API as the dashboard. rpc() runs it as the owner's admin account over this Mac's direct database connection
(private.is_admin accepts session user postgres); the Keychain "AI 연결" session is only for the dashboard's own status."""
import base64
import json
import runpy
from pathlib import Path
import re
import ssl
import subprocess
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SERVICE = 'com.gling.merchant-admin'
ACCOUNT = 'wjvahbdwmctzpkndqaxa'
RPCS = {'get_admin_merchants', 'get_admin_merchant', 'save_admin_merchant', 'save_admin_merchant_record', 'link_admin_merchant_post',
        'create_admin_merchant_post', 'save_admin_merchant_report', 'get_admin_merchant_report',
        'get_merchant_workspace', 'save_merchant_workspace_item', 'adjust_merchant_inventory',
        'save_merchant_workspace_draft', 'approve_merchant_workspace_drafts', 'archive_merchant_workspace_drafts',
        'publish_merchant_workspace_draft', 'record_merchant_external_post', 'set_admin_merchant_workspace_owner',
        'get_merchant_account_connections', 'connect_admin_merchant_account', 'search_admin_users',
        'get_admin_creator_directory', 'get_admin_creator_deal', 'link_admin_creator_deal_merchant', 'get_admin_merchant_creator_deals'}

def configuration():
    values = {}
    for line in (ROOT / '.env.local').read_text().splitlines():
        name, sep, value = line.partition('=')
        if sep and name.strip() in {'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'}:
            values[name.strip()] = value.strip().strip('"\'')
    origin = values.get('EXPO_PUBLIC_SUPABASE_URL', '').rstrip('/')
    if origin != f'https://{ACCOUNT}.supabase.co': raise ValueError('GLING_PROJECT_REQUIRED')
    return origin, values['EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY']

def request(path, body, token=None):
    origin, key = configuration()
    headers = {'Content-Type': 'application/json', 'apikey': key}
    if token: headers['Authorization'] = 'Bearer ' + token
    try:
        import certifi
        context = ssl.create_default_context(cafile=certifi.where())
    except ImportError: context = ssl.create_default_context()
    try:
        with urlopen(Request(origin + path, data=json.dumps(body).encode(), headers=headers, method='POST'), timeout=20, context=context) as response:
            data = response.read(8_000_000)
            return json.loads(data) if data else None
    except HTTPError as error:
        try: code = json.loads(error.read(4096)).get('message', '')
        except (ValueError, AttributeError): code = ''
        # Never echo API bodies, credentials or untrusted exception text into an AI conversation.
        raise ValueError(code if re.fullmatch('[A-Z_]{3,80}', code) else f'GLING_API_{error.code}') from None

def keychain_read():
    result = subprocess.run(['security', 'find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'], capture_output=True, text=True, timeout=10)
    if result.returncode: return None
    try: return json.loads(result.stdout)
    except ValueError: return None

def keychain_write(session):
    # Interactive stdin avoids putting authentication tokens in process arguments.
    value = json.dumps(session, separators=(',', ':'))
    if "'" in value or '\n' in value: raise ValueError('INVALID_ADMIN_SESSION')
    command = f"add-generic-password -U -s {SERVICE} -a {ACCOUNT} -w '{value}'\n"
    result = subprocess.run(['security', '-i'], input=command, capture_output=True, text=True, timeout=10)
    if result.returncode or keychain_read() != session: raise ValueError('KEYCHAIN_WRITE_FAILED')

def disconnect():
    result = subprocess.run(['security', 'delete-generic-password', '-s', SERVICE, '-a', ACCOUNT], capture_output=True, timeout=10)
    if result.returncode not in (0, 44): raise ValueError('KEYCHAIN_DELETE_FAILED')

def connection_status():
    session = keychain_read()
    return {'connected': bool(session and session.get('expires_at', 0) > time.time()), 'expires_at': session.get('expires_at') if session else None}

def token_claims(access):
    try:
        segment = access.split('.')[1]
        return json.loads(base64.urlsafe_b64decode(segment + '=' * (-len(segment) % 4)))
    except (ValueError, KeyError, IndexError, TypeError): raise ValueError('INVALID_ADMIN_SESSION') from None

def connect(value):
    if not isinstance(value, dict): raise ValueError('INVALID_ADMIN_SESSION')
    access = value.get('access_token')
    if not isinstance(access, str) or not re.fullmatch('[a-zA-Z0-9_.-]{4,12000}', access): raise ValueError('INVALID_ADMIN_SESSION')
    # Supabase validates the JWT; the same DB guard checks current admin role, active account and AAL2.
    request('/rest/v1/rpc/get_admin_merchants', {'p_search': '', 'p_offset': 0}, access)
    claims = token_claims(access)
    now = int(time.time())
    until = now + 8 * 3600
    if value.get('continuation'):
        old = keychain_read()
        if not old or old.get('connected_until', 0) <= now or old.get('subject') != claims.get('sub'): raise ValueError('AI_CONNECTION_REQUIRED')
        until = old['connected_until']
    keychain_write({'access_token': access, 'subject': claims['sub'], 'connected_until': until,
                    'expires_at': min(claims['exp'], until)})
    return connection_status()

def active_session():
    session = keychain_read()
    if not session or session.get('expires_at', 0) <= time.time(): raise ValueError('AI_CONNECTION_REQUIRED')
    # The browser alone owns refresh tokens. Its verified token refresh syncs access here.
    # Copying refresh tokens between two clients would race Supabase's rotation protocol.
    if token_claims(session['access_token']).get('exp', 0) <= time.time(): raise ValueError('AI_CONNECTION_REQUIRED')
    return session

def direct_sql(sql):
    helper = runpy.run_path(str(ROOT / 'scripts/storage-usage.py'))
    try: return helper['query'](sql, helper['token']())
    except HTTPError as error:
        text = error.read(4096).decode(errors='replace')
        # Only a raised [A-Z_] code leaves this function, never database text.
        code = re.search(r'ERROR:\s+\w+:\s+([A-Z_]{3,80})(?![\w ])', text)
        raise ValueError(code.group(1) if code else f'GLING_DB_{error.code}') from None

def lit(value):
    text = str(value)
    if '$g$' in text: raise ValueError('INVALID_ARGUMENT')
    return '$g$' + text + '$g$'

def sql_value(value, kind):
    if value is None: return 'null::' + kind
    if kind.endswith('[]'):
        items = ','.join('"' + str(x).replace('\\', '\\\\').replace('"', '\\"') + '"' for x in value)
        return lit('{' + items + '}') + '::' + kind
    if kind in ('json', 'jsonb') or isinstance(value, (dict, list)): return lit(json.dumps(value, default=str)) + '::' + kind
    if isinstance(value, bool): value = 'true' if value else 'false'
    return lit(value) + '::' + kind

def as_admin(statement):
    # Owner 2026-10-30 "애초에 풀어드민인상황인데": act as the owner's admin account, not through the browser token.
    actor = runpy.run_path(str(ROOT / 'marketing/app_post_spacing.py'))['OFFICIAL_ACCOUNT']
    claims = json.dumps({'sub': actor, 'role': 'authenticated'})
    return direct_sql(f"begin; select set_config('request.jwt.claims', {lit(claims)}, true); set local role authenticated; {statement}; commit;")

def rpc(name, args):
    if name not in RPCS: raise ValueError('UNKNOWN_MERCHANT_OPERATION')
    signatures = direct_sql("select pg_get_function_identity_arguments(p.oid) args from pg_proc p "
                            f"where p.pronamespace = 'public'::regnamespace and p.proname = {lit(name)}")
    overloads = [dict(part.split(' ', 1) for part in row['args'].split(', ') if part) for row in signatures]
    fits = sorted((types for types in overloads if set(args) <= set(types)), key=len)
    if not fits: raise ValueError('UNKNOWN_MERCHANT_OPERATION')
    call = ', '.join(f'{key} => {sql_value(value, fits[0][key])}' for key, value in args.items())
    return as_admin(f'select to_jsonb(public.{name}({call})) as result')[0]['result']

def same_origin(origin, host):
    try:
        parsed = urlsplit(origin)
        return bool(parsed.scheme in {'http', 'https'} and parsed.netloc == host and not parsed.username
                    and not parsed.password and not parsed.path and not parsed.query and not parsed.fragment)
    except ValueError: return False
