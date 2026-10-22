"""Bounded, read-only Facebook Login Business Discovery collector.

Run from mobile: python3 marketing/instagram_reference_discovery.py \
    --handle EXACT_HANDLE --limit 10 --out /Users/ash/Desktop/Git/unknown/output/reviews/RUN/discovery.json
Uses only the separate, root-verified facebook-discovery.json; never publisher tokens.
Official contract: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery
Metric semantics: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media
"""
import argparse
import hashlib
import json
import os
import re
import signal
import ssl
import stat
import time
import urllib.request
from pathlib import Path

from meta_api import CREDENTIALS, MetaClient, MetaError, NoRedirect, date, now_utc, private_json

REVIEWS = Path('/Users/ash/Desktop/Git/unknown/output/reviews')
BINDINGS = {'meta_app_id':'1696778162062283',
            'expected_facebook_page_id':'1362245160303253',
            'expected_instagram_user_id':'17841430674685962',
            'expected_instagram_username':'gling.app', 'graph_version':'v25.0'}
PERMISSIONS = {'instagram_basic', 'instagram_manage_insights', 'pages_read_engagement'}
FIELDS = 'id,caption,media_type,media_product_type,permalink,timestamp,view_count,like_count,comments_count'


def load_credentials(path):
    """Open without following a symlink and validate the opened file, not a prior stat."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_uid != os.getuid():
                raise MetaError('discovery_credentials_require_owned_regular_0600_file')
            value = json.loads(stream.read(65537))
        if not isinstance(value, dict) or any(value.get(k) != v for k,v in BINDINGS.items()):
            raise MetaError('discovery_credential_binding_mismatch')
        if not isinstance(value.get('access_token'),str) or not value['access_token'].strip() or \
                not isinstance(value.get('facebook_user_id'),str) or not re.fullmatch(r'[0-9]+',value['facebook_user_id']):
            raise MetaError('discovery_credential_identity_missing')
        now = now_utc()
        expires, verified = date(value.get('expires_at')), date(value.get('verified_at'))
        if expires.utcoffset().total_seconds() != 0 or verified.utcoffset().total_seconds() != 0 or not verified <= now < expires:
            raise MetaError('discovery_credential_expired_or_unverified')
        if not isinstance(value.get('verification_report'),str) or not Path(value['verification_report']).is_absolute():
            raise MetaError('discovery_verification_report_required')
        return value
    except (OSError, ValueError, TypeError):
        raise MetaError('discovery_credentials_unavailable_or_invalid') from None


def handles(values):
    if not values or any(not isinstance(v,str) or not re.fullmatch(r'[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?',v)
                         or '..' in v for v in values):
        raise MetaError('one_to_three_exact_handles_required')
    result = list(dict.fromkeys(v.lower() for v in values))
    if len(result)>3:
        raise MetaError('one_to_three_exact_handles_required')
    return result


def output_path(value):
    path = Path(value)
    if path.is_symlink() or not path.resolve().is_relative_to(REVIEWS.resolve()) or path.resolve()==REVIEWS.resolve():
        raise MetaError('output_must_be_beneath_reviews')
    return path.resolve()


class DiscoveryTransport:
    def __init__(self, credentials):
        # Reuse MetaClient's TLS and redacted HTTP/JSON handling without loading publisher credentials.
        self.client = MetaClient.__new__(MetaClient)
        context = ssl.create_default_context()
        if Path('/etc/ssl/cert.pem').is_file():
            context.load_verify_locations('/etc/ssl/cert.pem')
        self.client.opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=context))
        self.credentials = credentials
        self.deadline = time.monotonic()+45

    def get(self, path, params=None):
        if not re.fullmatch(r'me|me/permissions|1362245160303253|17841430674685962',path):
            raise MetaError('discovery_unsafe_endpoint')
        if time.monotonic()>=self.deadline or now_utc()>=date(self.credentials['expires_at']):
            raise MetaError('discovery_budget_or_credential_expired')
        try:
            result = self.client._request('https://graph.facebook.com/v25.0/'+path,params,'GET',self.credentials['access_token'])
        except Exception:
            raise MetaError('discovery_request_failed_no_retry') from None
        if time.monotonic()>=self.deadline:
            raise MetaError('discovery_budget_expired')
        return result


def filter_media(handle, rows, seen, token):
    accepted, quarantine = [], []
    for row in rows:
        if not isinstance(row,dict):
            quarantine.append({'reason':'invalid_media_object'}); continue
        media_id = row.get('id')
        if not isinstance(media_id,str) or not media_id.isascii() or not media_id.isdigit():
            quarantine.append({'reason':'invalid_media_id'}); continue
        if media_id in seen:
            continue
        seen.add(media_id)
        reason = None
        if row.get('media_product_type')!='REELS': reason='not_confirmed_reel'
        link=row.get('permalink')
        if not isinstance(link,str) or not re.fullmatch(r'https://(?:www\.)?instagram\.com/(?:reel|p)/[A-Za-z0-9_-]+/',link):
            reason='invalid_original_permalink'
        for key in ('view_count','like_count','comments_count'):
            count=row.get(key)
            if count is not None and (type(count) is not int or count<0): reason='invalid_count'
        try: date(row.get('timestamp'))
        except MetaError: reason='invalid_media_timestamp'
        if reason:
            quarantine.append({'id':media_id,'reason':reason}); continue
        accepted.append({'id':media_id,'account_handle':handle,'permalink':link,
                         'timestamp':row['timestamp'],'media_type':row.get('media_type') if row.get('media_type') in ('VIDEO','IMAGE','CAROUSEL_ALBUM') else None,
                         'media_product_type':'REELS',
                         'caption':row.get('caption','').replace(token,'[REDACTED]') if isinstance(row.get('caption',''),str) else None,
                         **{k:row.get(k) for k in ('view_count','like_count','comments_count')}})
    accepted.sort(key=lambda r:(r['view_count'] is not None, r['view_count'] or 0),reverse=True)
    return accepted,quarantine


def normalize_observation(row, observed_at, followers, source, *, reference_role='venue_evidence', cohort=None):
    """Normalize saved evidence only; caller supplies an explicit reviewed comparison cohort."""
    if reference_role not in ('venue_evidence', 'structure_benchmark'):
        raise ValueError('Invalid reference role')
    link = row.get('permalink')
    match = re.fullmatch(r'https://(?:www\.)?instagram\.com/(?:reel|p)/([A-Za-z0-9_-]+)/', link or '')
    if not match or not row.get('id') or not isinstance(source, str) or not source.strip():
        raise ValueError('Source ID, original URL and saved provenance required')
    captured = date(observed_at)
    views = row.get('view_count')
    for value in (views, followers):
        if value is not None and (type(value) is not int or value < 0):
            raise ValueError('Counts must be nonnegative integers or null')
    precision = row.get('views_precision', 'exact') if views is not None else 'unknown'
    if row.get('platform', 'instagram') != 'instagram':
        raise ValueError('Instagram evidence required')
    if precision not in ('exact', 'rounded', 'unknown') or views is not None and precision == 'unknown':
        raise ValueError('Observed views need exact or rounded precision')
    age = None
    try:
        elapsed = (captured - date(row.get('timestamp'))).total_seconds() / 3600
        if elapsed > 0:
            age = elapsed
    except MetaError:
        pass
    missing = [name for name, absent in (('views_unknown', views is None),
        ('publication_age_unknown', age is None), ('current_account_scale_unknown', not followers),
        ('reviewed_cohort_unknown', not cohort), ('topic_unknown', not row.get('topic'))) if absent]
    value = dict(source_id=str(row['id']), reference_id='IG-' + match[1], source_url=link,
        account_handle=row.get('account_handle'), platform='instagram', format='reels',
        reference_role=reference_role, observed_at=observed_at, published_at=row.get('timestamp'),
        views=views, views_display=row.get('views_display'), views_precision=precision,
        current_followers=followers, followers_display=row.get('followers_display'), followers_precision=row.get('followers_precision', 'exact' if followers is not None else 'unknown'),
        followers_observed_at=observed_at, followers_at_publication=None, age_hours=age,
        views_per_current_follower=views / followers if views is not None and followers else None,
        ratio_is_approximate=precision == 'rounded' or row.get('followers_precision') == 'rounded',
        cohort=cohort, topic=row.get('topic'), source=source, missing=missing,
        caveats=['Cumulative sample observation; paid, pinned and Facebook exposure may be unknown.',
                 'Current followers are not followers at publication; no causal or global success inferred.'])
    value['observation_id'] = 'reference-' + hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()
    return value


def qualify_observations(observations):
    """Show raw-view rank only inside a supplied cohort with complete age/scale evidence."""
    if len({(r['source_id'],r['reference_role']) for r in observations}) != len(observations) or len({(r['reference_id'],r['reference_role']) for r in observations}) != len(observations):
        raise ValueError('Duplicate reference source in comparison sample')
    result = []
    for row in observations:
        peers = [other for other in observations if not row['missing'] and not other['missing']
                 and other['source_id'] != row['source_id']
                 and all(row[key] == other[key] for key in ('platform', 'format', 'topic', 'cohort', 'reference_role'))]
        dominators = [other['source_id'] for other in peers
            if other['views'] >= row['views'] and other['age_hours'] <= row['age_hours']
            and other['current_followers'] <= row['current_followers']
            and any(other[key] != row[key] for key in ('views', 'age_hours', 'current_followers'))]
        status = ('performance_unknown' if row['views'] is None else
                  'performance_relative_observation' if peers else 'performance_observed_insufficient_comparison')
        result.append({**row, 'assessment': dict(status=status,
            comparable_ids=sorted(other['source_id'] for other in peers),
            tied_ids=sorted(other['source_id'] for other in peers if other['views'] == row['views']),
            sample_view_rank=1 + sum(other['views'] > row['views'] for other in peers) if peers else None,
            sample_size=1 + len(peers), causal_or_global_success=False,
            dominator_ids=sorted(dominators), relative_sample_leader=not dominators if peers else None,
            dominance_is_approximate=any(r['ratio_is_approximate'] or r['views_precision'] == 'rounded'
                                        for r in [row, *peers]),
            comparison_basis='Non-dominated within reviewed same-role cohort: views >=, age <=, current followers <=, one strict. Rounded observations are approximate; no global success cutoff.')})
    return result


def collect(get, credentials, targets, limit, *, topic=None, cohort=None, reference_role='venue_evidence'):
    targets=handles(targets)
    if reference_role not in ('venue_evidence', 'structure_benchmark') or any(
            value is not None and (not isinstance(value, str) or not value.strip() or len(value) > 200)
            for value in (topic, cohort)):
        raise MetaError('invalid_local_editorial_context')
    if type(limit) is not int or not 1<=limit<=25: raise MetaError('media_limit_must_be_1_to_25')
    if get('me',{'fields':'id'}).get('id')!=credentials['facebook_user_id']:
        raise MetaError('discovery_live_user_mismatch')
    rows=get('me/permissions').get('data')
    if not isinstance(rows,list) or any(not isinstance(r,dict) for r in rows) or not PERMISSIONS <= {r.get('permission') for r in rows if r.get('status')=='granted'}:
        raise MetaError('discovery_required_permissions_missing')
    page=get(BINDINGS['expected_facebook_page_id'],{'fields':'id,instagram_business_account{id,username}'})
    ig=page.get('instagram_business_account')
    if page.get('id')!=BINDINGS['expected_facebook_page_id'] or not isinstance(ig,dict) or \
            ig.get('id')!=BINDINGS['expected_instagram_user_id'] or ig.get('username')!='gling.app':
        raise MetaError('discovery_live_page_instagram_mismatch')
    accepted,quarantine,accounts,seen=[],[],[],set()
    for handle in targets:
        fields='business_discovery.username('+handle+'){username,followers_count,media_count,media.limit('+str(limit)+'){'+FIELDS+'}}'
        business=get(BINDINGS['expected_instagram_user_id'],{'fields':fields}).get('business_discovery')
        if not isinstance(business,dict) or not isinstance(business.get('username'),str) or business['username'].lower()!=handle:
            raise MetaError('discovery_target_identity_missing_or_mismatch')
        media=business.get('media',{})
        if not isinstance(media,dict) or not isinstance(media.get('data'),list) or len(media['data'])>limit:
            raise MetaError('discovery_invalid_bounded_media_response')
        account={'username':handle}
        for key in ('followers_count','media_count'):
            value=business.get(key)
            if value is not None and (type(value) is not int or value<0):
                quarantine.append({'account_handle':handle,'reason':'invalid_'+key}); value=None
            account[key]=value
        accounts.append(account)
        good,bad=filter_media(handle,media['data'],seen,credentials['access_token'])
        accepted.extend(good); quarantine.extend(bad)
    accepted.sort(key=lambda r:(r['view_count'] is not None,r['view_count'] or 0),reverse=True)
    observed_at = now_utc().isoformat()
    account_sizes = {a['username']: a['followers_count'] for a in accounts}
    observations = qualify_observations([normalize_observation({**row, 'topic':topic}, observed_at,
        account_sizes[row['account_handle']], 'Meta Business Discovery bounded GET',
        reference_role=reference_role, cohort=cohort) for row in accepted])
    for row, observation in zip(accepted, observations):
        row['performance_observation'] = observation
    return {'status':'collected','observed_at':observed_at,'accounts':accounts,
            'references':accepted,'quarantine':quarantine,'publish_queue_crm_writes':0,
            'limits':{'handles':3,'media_per_handle':limit,'pages_per_handle':1,'overall_seconds':45,'automatic_retries':0},
            'caveats':['High observed view count within this returned sample only; publication dates and account audiences differ.',
                       'view_count includes paid and organic views and Facebook crosspost views when accessible to the session user.',
                       'Missing counts remain null; zero is an observed zero. No reach, retention, rights, approval, or reuse permission inferred.',
                       'Business/Creator exact handles only; age-gated or inaccessible accounts may fail. No paging URLs followed.',
                       'Business Manager-granted Page roles may additionally require ads_read or ads_management; never granted automatically.']}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--handle',action='append',required=True)
    parser.add_argument('--limit',type=int,default=10)
    parser.add_argument('--out',required=True)
    parser.add_argument('--topic', help='Local reviewed topic; never sent to Meta')
    parser.add_argument('--cohort', help='Local reviewed comparable sample; never inferred')
    parser.add_argument('--reference-role', choices=['venue_evidence', 'structure_benchmark'], default='venue_evidence')
    args=parser.parse_args()
    out=None
    def expired(signum,frame): raise MetaError('discovery_45_second_budget_expired')
    previous=signal.signal(signal.SIGALRM,expired)
    signal.setitimer(signal.ITIMER_REAL,45)
    try:
        out=output_path(args.out)
        targets=handles(args.handle)
        if not 1<=args.limit<=25: raise MetaError('media_limit_must_be_1_to_25')
        credentials=load_credentials(CREDENTIALS/'facebook-discovery.json')
        result=collect(DiscoveryTransport(credentials).get,credentials,targets,args.limit,
                       topic=args.topic, cohort=args.cohort, reference_role=args.reference_role)
        private_json(out,result)
        print('discovery_collected')
        return 0
    except Exception:
        if out is not None:
            try:
                private_json(out,{'status':'blocked','reason':'discovery_auth_input_or_request_failed_no_retry',
                                  'publish_queue_crm_writes':0})
            except Exception:
                pass  # Keep filesystem failures from exposing exception details.

        print('discovery_blocked_no_retry')
        return 1
    finally:
        signal.setitimer(signal.ITIMER_REAL,0)
        signal.signal(signal.SIGALRM,previous)


if __name__=='__main__': raise SystemExit(main())
