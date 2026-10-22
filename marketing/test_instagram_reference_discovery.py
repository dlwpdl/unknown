import io
import json
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

import instagram_reference_discovery as d


class DiscoveryTests(unittest.TestCase):
    def credentials(self):
        return dict(d.BINDINGS, access_token='secret-test', facebook_user_id='123',
                    expires_at=(d.now_utc()+timedelta(hours=1)).isoformat(),
                    verified_at=(d.now_utc()-timedelta(minutes=1)).isoformat(),
                    verification_report='/private/root-owned-verification.json')

    def test_credentials_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'credential.json'
            with self.assertRaises(d.MetaError): d.load_credentials(path)
            path.write_text(json.dumps(self.credentials())); path.chmod(0o600)
            self.assertEqual(d.load_credentials(path)['facebook_user_id'], '123')
            path.chmod(0o644)
            with self.assertRaises(d.MetaError): d.load_credentials(path)
            path.chmod(0o600)
            link=Path(directory)/'link'; link.symlink_to(path)
            with self.assertRaises(d.MetaError): d.load_credentials(link)
            with patch.object(d.os, 'getuid', return_value=-1):
                with self.assertRaises(d.MetaError): d.load_credentials(path)
            for change in ({'expires_at':None}, {'expires_at':d.now_utc().isoformat()},
                           {'meta_app_id':'wrong'}, {'expected_facebook_page_id':'wrong'},
                           {'facebook_user_id':''}, {'verified_at':None}, {'verification_report':''}):
                path.write_text(json.dumps(dict(self.credentials(), **change)))
                with self.subTest(change=change), self.assertRaises(d.MetaError): d.load_credentials(path)
            folder=Path(directory)/'folder'; folder.mkdir(mode=0o600)
            with self.assertRaises(d.MetaError): d.load_credentials(folder)

    def test_handles_and_limits(self):
        self.assertEqual(d.handles(['Foo', 'foo', 'bar.baz']), ['foo','bar.baz'])
        for bad in ([], ['a','b','c','d'], ['@foo'], ['a){id}'], ['https://instagram.com/a'], ['a..b'], ['a.']):
            with self.subTest(bad=bad), self.assertRaises(d.MetaError): d.handles(bad)

    def test_filter_rank_zero_null_invalid_dedupe(self):
        def row(n, **kw):
            return dict(id=str(n), media_product_type='REELS', media_type='VIDEO',
                        permalink=f'https://www.instagram.com/reel/code{n}/',
                        timestamp='2026-10-01T00:00:00Z', **kw)
        rows=[row(1,view_count=0),row(2),row(3,view_count=100),row(3,view_count=999),
              row(4,view_count=-1),row(5,view_count=True),row(6,like_count='2'),
              dict(row(7), media_product_type='FEED'),dict(row(8),permalink='https://evil.test/reel/a/'),
              dict(row(9),permalink='https://www.instagram.com/reel/a/?access_token=secret')]
        accepted, quarantine=d.filter_media('foo', rows, set(), 'secret')
        self.assertEqual([r['id'] for r in accepted],['3','1','2'])
        self.assertEqual(accepted[1]['view_count'],0)
        self.assertIsNone(accepted[2]['view_count'])
        self.assertEqual(len(quarantine),6)

    def test_auth_before_discovery_no_paging(self):
        calls=[]
        def request(path, params=None):
            calls.append((path,params))
            if path=='me': return {'id':'123'}
            if path=='me/permissions': return {'data':[{'permission':p,'status':'granted'} for p in d.PERMISSIONS]}
            if path==d.BINDINGS['expected_facebook_page_id']:
                return {'id':path,'instagram_business_account':{'id':d.BINDINGS['expected_instagram_user_id'],'username':'gling.app'}}
            return {'business_discovery':{'username':'foo','followers_count':0,'media_count':0,'media':{'data':[], 'paging':{'next':'https://evil.test/?access_token=secret'}}}}
        result=d.collect(request, self.credentials(), ['foo'], 25)
        self.assertEqual(len(calls),4)
        self.assertEqual(result['status'],'collected')
        self.assertIn('media.limit(25)',calls[-1][1]['fields'])
        self.assertEqual(result['publish_queue_crm_writes'],0)
        for failed in ('me','me/permissions',d.BINDINGS['expected_facebook_page_id']):
            calls.clear()
            def bad(path, params=None):
                return {} if path==failed else request(path,params)
            with self.subTest(failed=failed), self.assertRaises(d.MetaError): d.collect(bad,self.credentials(),['foo'],10)
            self.assertFalse(any(p==d.BINDINGS['expected_instagram_user_id'] for p,_ in calls))

    def test_collect_attaches_observed_assessment_without_guessing_fields(self):
        row = dict(id='1234', media_product_type='REELS', media_type='VIDEO',
                   permalink='https://www.instagram.com/reel/exact_source/',
                   timestamp='2026-10-01T00:00:00Z', view_count=0, like_count=42)
        def get(path, params=None):
            if path == 'me': return {'id':'123'}
            if path == 'me/permissions': return {'data':[{'permission':p,'status':'granted'} for p in d.PERMISSIONS]}
            if path == d.BINDINGS['expected_facebook_page_id']:
                return {'id':path, 'instagram_business_account':{'id':d.BINDINGS['expected_instagram_user_id'],'username':'gling.app'}}
            self.assertIn(d.FIELDS, params['fields'])
            return {'business_discovery':{'username':'foo','followers_count':25,'media':{'data':[row]}}}
        result = d.collect(get, self.credentials(), ['foo'], 1, topic='dining',
                           cohort='reviewed-20261018', reference_role='structure_benchmark')
        observation = result['references'][0]['performance_observation']
        self.assertEqual(observation['source_id'], '1234')
        self.assertEqual(observation['views'], 0)
        self.assertEqual(observation['current_followers'], 25)
        self.assertEqual(observation['observed_at'], result['observed_at'])
        self.assertEqual(observation['assessment']['status'], 'performance_observed_insufficient_comparison')
        self.assertEqual(observation['reference_role'], 'structure_benchmark')
        self.assertEqual(observation['topic'], 'dining')
        self.assertEqual(observation['cohort'], 'reviewed-20261018')

    def test_cli_context_reaches_real_collector_assessment(self):
        def get(path, params=None):
            if path == 'me': return {'id':'123'}
            if path == 'me/permissions': return {'data':[{'permission':p,'status':'granted'} for p in d.PERMISSIONS]}
            if path == d.BINDINGS['expected_facebook_page_id']:
                return {'id':path, 'instagram_business_account':{'id':d.BINDINGS['expected_instagram_user_id'],'username':'gling.app'}}
            self.assertNotIn('local-dining', params['fields'])
            return {'business_discovery':{'username':'foo','followers_count':25,'media':{'data':[
                dict(id=str(n),media_product_type='REELS',media_type='VIDEO',
                     permalink=f'https://www.instagram.com/reel/code{n}/',
                     timestamp='2026-10-01T00:00:00Z',view_count=n*100) for n in (1,2)]}}}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'result.json'
            with patch.object(d,'output_path',return_value=path), \
                 patch.object(d,'load_credentials',return_value=self.credentials()), \
                 patch.object(d,'DiscoveryTransport') as transport, \
                 patch('sys.argv',['collector','--handle','foo','--limit','2','--out',str(path),
                      '--topic','local-dining','--cohort','reviewed-today','--reference-role','structure_benchmark']), \
                 patch('builtins.print'):
                transport.return_value.get.side_effect = get
                self.assertEqual(d.main(),0)
            rows = json.loads(path.read_text())['references']
            self.assertEqual(rows[0]['performance_observation']['cohort'],'reviewed-today')
            self.assertEqual(rows[0]['performance_observation']['assessment']['comparable_ids'],['1'])
            self.assertTrue(rows[0]['performance_observation']['assessment']['relative_sample_leader'])
            self.assertEqual(rows[1]['performance_observation']['assessment']['dominator_ids'],['2'])

    def test_mocked_http_uses_bearer_get_and_budget(self):
        client=d.DiscoveryTransport(self.credentials())
        requests=[]
        def opened(request, timeout):
            requests.append(request)
            self.assertLessEqual(timeout,20)
            return io.BytesIO(b'{"id":"123"}')
        with patch.object(client.client.opener,'open',side_effect=opened):
            self.assertEqual(client.get('me',{'fields':'id'}),{'id':'123'})
            client.deadline=0
            with self.assertRaises(d.MetaError): client.get('me')
        self.assertEqual(len(requests),1)
        self.assertEqual(requests[0].get_method(),'GET')
        self.assertTrue(requests[0].full_url.startswith('https://graph.facebook.com/v25.0/me?'))
        self.assertNotIn('secret-test',requests[0].full_url)
        self.assertEqual(requests[0].get_header('Authorization'),'Bearer secret-test')

    def test_cli_blocked_without_real_credentials_and_no_secret_error(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'result.json'
            with patch.object(d,'output_path',return_value=path), \
                    patch.object(d,'load_credentials',side_effect=RuntimeError('secret-test')), \
                    patch.object(d,'DiscoveryTransport') as transport, \
                    patch('sys.argv',['collector','--handle','foo','--out',str(path)]), \
                    patch('builtins.print') as printed:
                self.assertEqual(d.main(),1)
            transport.assert_not_called()
            self.assertEqual(json.loads(path.read_text())['status'],'blocked')
            self.assertNotIn('secret-test',path.read_text())
            printed.assert_called_once_with('discovery_blocked_no_retry')
            self.assertEqual(path.stat().st_mode & 0o777,0o600)

    def test_output_bounds(self):
        for path in ('/tmp/no.json',str(d.REVIEWS/'../escape.json')):
            with self.assertRaises(d.MetaError): d.output_path(path)

    def test_transport_get_only_and_sanitized(self):
        client=d.DiscoveryTransport(self.credentials())
        with self.assertRaises(d.MetaError): client.get('me?access_token=secret')
        with patch.object(client.client, '_request', side_effect=RuntimeError('secret-test')):
            with self.assertRaisesRegex(d.MetaError,'discovery_request_failed') as caught: client.get('me')
            self.assertNotIn('secret-test',str(caught.exception))


class QualificationTests(unittest.TestCase):
    def observation(self, ident='a', **changes):
        row = dict(id=ident, permalink=f'https://www.instagram.com/reel/{ident}/',
                   timestamp='2026-10-01T00:00:00Z', view_count=100, platform='instagram',
                   media_product_type='REELS', topic='dining', views_precision='exact')
        row.update(changes)
        return d.normalize_observation(row, '2026-10-03T00:00:00Z', 10,
                                       '/saved/receipt.json', cohort='same-reviewed-dining-sample')

    def test_null_zero_and_likes_are_distinct(self):
        missing = self.observation(view_count=None, like_count=999)
        zero = self.observation(view_count=0)
        self.assertIsNone(missing['views'])
        self.assertEqual(d.qualify_observations([missing])[0]['assessment']['status'], 'performance_unknown')
        self.assertEqual(zero['views'], 0)
        self.assertEqual(zero['views_per_current_follower'], 0)
        self.assertEqual(d.qualify_observations([zero])[0]['assessment']['status'], 'performance_observed_insufficient_comparison')

    def test_dominance_uses_age_scale_and_separates_roles(self):
        a, b, other_role = self.observation('a'), self.observation('b'), self.observation('c')
        b.update(age_hours=24, current_followers=5)
        other_role.update(reference_role='structure_benchmark', views=1000000)
        rows = d.qualify_observations([a, b, other_role])
        self.assertEqual(rows[0]['assessment']['dominator_ids'], ['b'])
        self.assertFalse(rows[0]['assessment']['relative_sample_leader'])
        self.assertTrue(rows[1]['assessment']['relative_sample_leader'])
        self.assertEqual(rows[2]['assessment']['comparable_ids'], [])
        same_source_other_role = {**a, 'reference_role':'structure_benchmark'}
        self.assertEqual(len(d.qualify_observations([a,same_source_other_role])),2)
        self.assertIsNone(rows[2]['assessment']['relative_sample_leader'])
        # Same views with older age but smaller account is not dominated in either direction.
        b.update(age_hours=72)
        rows = d.qualify_observations([a, b])
        self.assertTrue(all(r['assessment']['relative_sample_leader'] for r in rows))
        b.update(views_precision='rounded')
        self.assertTrue(d.qualify_observations([a, b])[0]['assessment']['dominance_is_approximate'])

    def test_dates_followers_and_rounded_precision(self):
        for timestamp in ('bad', None, '2026-10-04T00:00:00Z'):
            row = self.observation(timestamp=timestamp)
            self.assertIsNone(row['age_hours'])
            self.assertIn('publication_age_unknown', row['missing'])
        row = d.normalize_observation(dict(id='a', permalink='https://www.instagram.com/reel/a/',
            timestamp='2026-10-01T00:00:00Z', view_count=162000, views_precision='rounded',
            views_display='16.2만'), '2026-10-03T00:00:00Z', None, '/saved/a.json')
        self.assertEqual(row['views_display'], '16.2만')
        self.assertEqual(row['views_precision'], 'rounded')
        self.assertIsNone(row['views_per_current_follower'])
        for followers in (None, 0):
            row = d.normalize_observation(dict(id='a', permalink='https://www.instagram.com/reel/a/',
                view_count=0), '2026-10-03T00:00:00Z', followers, '/saved/a.json')
            self.assertIsNone(row['views_per_current_follower'])

    def test_comparison_ties_incomparable_and_no_global_pass(self):
        a, b = self.observation('a'), self.observation('b')
        other = self.observation('c', topic='wildlife', view_count=1000000)
        rows = d.qualify_observations([a, b, other])
        self.assertEqual(rows[0]['assessment']['comparable_ids'], ['b'])
        self.assertEqual(rows[0]['assessment']['tied_ids'], ['b'])
        self.assertEqual(rows[0]['assessment']['sample_view_rank'], 1)
        self.assertEqual(rows[2]['assessment']['status'], 'performance_observed_insufficient_comparison')
        self.assertFalse(rows[0]['assessment']['causal_or_global_success'])
        self.assertEqual(rows[0]['reference_role'], 'venue_evidence')
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            d.qualify_observations([a, a])
        self.assertEqual(d.qualify_observations([self.observation('d', view_count=200), a])[1]['assessment']['sample_view_rank'], 2)


if __name__=='__main__': unittest.main()
