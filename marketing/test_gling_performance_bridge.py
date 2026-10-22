import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import gling_performance_bridge as b

GROWTH = Path('/Users/ash/Desktop/Git/RP/automation/growth_loop.py')


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.growth = b.load_growth(GROWTH)
        self.binding = dict(case_id='case', public_id='123', video_sha256='a'*64,
            video_sha256_actual='a'*64, video_sha256_matches=True,
            source_manifest_sha256='b'*64, source_manifest_sha256_actual='b'*64,
            source_manifest_sha256_matches=True, reference_url='https://www.instagram.com/reel/source/',
            publication_receipt='/saved/published.json', publication_receipt_sha256='c'*64,
            current_public_present=True, template_id='actual-template', template_version='saved-v1')
        self.row = dict(id='123', platform='instagram', account='gling.app', format='reel',
            published_at='2026-10-01T00:00:00Z', observed_at='2026-10-01T01:00:00Z',
            url='https://www.instagram.com/reel/public/', source='/saved/insights.json',
            metrics={'views':0, 'likes':None, 'watch_seconds':5},
            publication_binding={'public_id':'123', 'video_sha256':'a'*64})

    def test_growth_validation_preserves_early_and_null(self):
        result = b.feedback_operations([self.row], [self.binding], self.growth)
        self.assertEqual(len(result['joined']), 1)
        self.assertEqual(len(result['operations']), 2)
        library = {}
        for op in result['operations']:
            self.growth.update(library, op['operation'], op['payload'])
        observations = library['publications'][0]['observations']
        self.assertEqual(observations[0]['status'], 'not_yet_due')
        self.assertEqual(observations[1]['status'], 'not_yet_due')
        self.assertEqual(observations[2]['actual_elapsed_hours'], 1)
        self.assertEqual(observations[2]['metrics']['public_views']['value'], 0)
        self.assertIsNone(observations[2]['metrics']['likes']['value'])
        self.assertEqual(result['joined'][0]['observation_window'], 'early')

    def test_reject_crosschannel_hash_duplicate_and_prepublication(self):
        for change in ({'account':'bella'}, {'platform':'youtube'}, {'observed_at':'2026-09-30T00:00:00Z'},
                       {'publication_binding':{'public_id':'123','video_sha256':'d'*64}}):
            result = b.feedback_operations([{**self.row, **change}], [self.binding], self.growth)
            self.assertEqual(result['operations'], [])
            self.assertEqual(len(result['blocked']),1)
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            b.feedback_operations([self.row, self.row], [self.binding], self.growth)
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            b.feedback_operations([self.row], [self.binding, self.binding], self.growth)
        result = b.feedback_operations([self.row], [{**self.binding,'template_version':None}], self.growth)
        self.assertEqual(len(result['joined']), 1)
        self.assertEqual(result['operations'], [])
        self.assertIn('template', result['blocked'][0]['reason'])

    def test_merge_preserves_decisions_holds_and_revision_idempotence(self):
        observation = dict(reference_id='IG-source', source_id='source',
            source_url='https://www.instagram.com/reel/source/', observation_id='one')
        library = dict(references=[dict(reference_id='IG-source', source_url=observation['source_url'],
            hold=True, owner_selection={'approved':True})], latest_decisions=[{'old':True}], unknown=17)
        original = copy.deepcopy(library)
        b.merge_references(library, [observation])
        first = copy.deepcopy(library)
        b.merge_references(library, [observation])
        self.assertEqual(library, first)
        b.merge_references(library, [{**observation,'observation_id':'two'}])
        self.assertEqual(len(library['references'][0]['performance_observations']),2)
        self.assertEqual(library['latest_decisions'], original['latest_decisions'])
        self.assertTrue(library['references'][0]['hold'])
        self.assertEqual(library['unknown'],17)
        with self.assertRaises(ValueError):
            b.merge_references(library, [{**observation,'source_url':'https://www.instagram.com/reel/wrong/'}])

    def test_shortcode_alias_keeps_roles_and_existing_primary_url(self):
        old_url = 'https://www.instagram.com/p/source/'
        library = {'references':[{'reference_id':'IG-source','source_url':old_url,'hold':True},
            {'reference_id':'YT-foreign','source_url':'https://www.youtube.com/watch?v=foreign','hold':True}]}
        observation = dict(reference_id='IG-source',source_id='source',
            source_url='https://www.instagram.com/reel/source/',reference_role='structure_benchmark',
            observation_id='structure',assessment={'status':'performance_observed_insufficient_comparison'})
        b.merge_references(library,[observation])
        self.assertEqual(len(library['references']),2)
        self.assertEqual(library['references'][0]['source_url'],old_url)
        self.assertEqual(library['references'][0]['performance_observations'][0]['source_url'], observation['source_url'])
        venue = {**observation,'observation_id':'venue','reference_role':'venue_evidence'}
        proposed, handoff = b.prepare(library, {}, [observation,venue], {'operations':[]}, self.growth)
        self.assertEqual(len(proposed['references']),2)
        self.assertEqual(handoff['performance_reference_revisions'][0]['venue_evidence_ids'],['IG-source'])
        self.assertEqual(handoff['performance_reference_revisions'][0]['eligible_structure_candidate_ids'],[])
        self.assertEqual(handoff['performance_reference_revisions'][0]['insufficient_comparison_ids'],['IG-source'])
        with self.assertRaises(ValueError):
            b.merge_references(library,[{**observation,'reference_id':'IG-different'}])

    def test_cli_export_path_allows_future_review_child_only(self):
        argv = ['bridge']
        for name in ('library','handoff','growth-loop','performance','bindings'):
            argv.extend(['--'+name,'/read-only/input.json'])
        for bad in ('/tmp/foreign-export', str(b.REVIEWS)):
            with patch('sys.argv', argv+['--out-dir',bad]), patch('sys.stderr'):
                with self.assertRaises(SystemExit) as result: b.main()
            self.assertEqual(result.exception.code,2)
        future = b.REVIEWS/'future-g7-run/export'
        with patch('sys.argv',argv+['--out-dir',str(future),'--discovery',str(future/'references.json')]), patch('sys.stderr'):
            with self.assertRaises(SystemExit) as result: b.main()
        self.assertEqual(result.exception.code,2)
        with patch('sys.argv',argv+['--out-dir',str(future)]), \
             patch.object(b,'load_growth',side_effect=RuntimeError('passed-output-guard')):
            with self.assertRaisesRegex(RuntimeError,'passed-output-guard'): b.main()

    def test_explicit_apply_reloads_preserves_and_is_idempotent(self):
        with tempfile.TemporaryDirectory(dir=b.REVIEWS/'gling-reference-performance-audit-2026-10-18/implementation') as directory:
            library, handoff = Path(directory)/'library.json', Path(directory)/'handoff.json'
            library.write_text(json.dumps({'profile_id':'gling-cinematic-places','references':[], 'hold':True,
                                           'updated_at':'2000-01-01T00:00:00+00:00'}))
            handoff.write_text(json.dumps({'profile_id':'gling-cinematic-places','new_other_owner_key':42,
                                           'updated_at':'2000-01-01T00:00:00+00:00'}))
            observation = b.handson_record(Path('/Users/ash/Desktop/Git/unknown/output/reviews/handson-yvr-owner-photos-2026-10-17'))
            feedback = {'operations':[]}
            # A concurrent owner's update after preparation must be read back during apply.
            stale = b.prepare(json.loads(library.read_text()),json.loads(handoff.read_text()),[observation],feedback,self.growth)
            latest = json.loads(library.read_text()); latest['concurrent_unknown'] = 17
            library.write_text(json.dumps(latest))
            result = b.apply(library,handoff,[observation],feedback,self.growth)
            self.assertEqual(result['status'],'applied')
            self.assertEqual(json.loads(library.read_text())['concurrent_unknown'],17)
            self.assertEqual(json.loads(handoff.read_text())['new_other_owner_key'],42)
            for path in (library, handoff):
                self.assertNotEqual(json.loads(path.read_text())['updated_at'], '2000-01-01T00:00:00+00:00')
            self.assertNotEqual(json.loads(library.read_text()),stale[0])
            before = (library.read_bytes(),handoff.read_bytes())
            with Path(str(library)+'.lock').open('a') as lock:
                b.fcntl.flock(lock,b.fcntl.LOCK_EX | b.fcntl.LOCK_NB)
                with self.assertRaises(BlockingIOError): b.apply(library,handoff,[observation],feedback,self.growth)
            self.assertEqual((library.read_bytes(),handoff.read_bytes()),before)
            self.assertEqual(b.apply(library,handoff,[observation],feedback,self.growth)['changed_files'],[])
            self.assertEqual((library.read_bytes(),handoff.read_bytes()),before)
            observation = {**observation,'revision_id':'later'}
            original_writer = b.private_json
            calls = []
            def fail_second(path,value):
                calls.append(path)
                if len(calls) == 2: raise OSError('disk')
                return original_writer(path,value)
            with patch.object(b,'private_json',side_effect=fail_second):
                with self.assertRaises(OSError): b.apply(library,handoff,[observation],feedback,self.growth)
            self.assertEqual((library.read_bytes(),handoff.read_bytes()),before)
            with self.assertRaises(ValueError):
                b.apply(Path('/Users/ash/Desktop/Git/RP/research/video-growth-loop.json'),handoff,[observation],feedback,self.growth)

    def test_apply_restores_both_files_when_writer_fails_after_replacing_second(self):
        with tempfile.TemporaryDirectory(dir=b.REVIEWS/'gling-reference-performance-audit-2026-10-18/implementation') as directory:
            library, handoff = Path(directory)/'library.json', Path(directory)/'handoff.json'
            library.write_text(json.dumps({'profile_id':'gling-cinematic-places','references':[]}))
            handoff.write_text(json.dumps({'profile_id':'gling-cinematic-places','other_owner':42}))
            before = (library.read_bytes(), handoff.read_bytes())
            observation = b.handson_record(Path('/Users/ash/Desktop/Git/unknown/output/reviews/handson-yvr-owner-photos-2026-10-17'))
            original_writer = b.private_json

            def fail_after_replace(path, value):
                original_writer(path, value)
                if Path(path) == handoff:
                    raise OSError('failure after second atomic replace')

            with patch.object(b, 'private_json', side_effect=fail_after_replace):
                with self.assertRaises(OSError):
                    b.apply(library, handoff, [observation], {'operations':[]}, self.growth)
            self.assertEqual((library.read_bytes(), handoff.read_bytes()), before)

    def test_real_handson_chain_and_immutable_revision(self):
        root = Path('/Users/ash/Desktop/Git/unknown/output/reviews/handson-yvr-owner-photos-2026-10-17')
        observation = b.handson_record(root)
        self.assertEqual(observation['source_id'], 'C-1d28dJCKd')
        self.assertEqual(observation['views'], 162000)
        self.assertEqual(observation['views_precision'], 'rounded')
        self.assertEqual(observation['current_followers'], 37000)
        self.assertEqual(observation['production_binding']['public_id'], '17973910260155218')
        self.assertFalse(observation['analysis_binding']['benchmark_data_loaded'])
        self.assertEqual(observation['assessment']['status'], 'performance_observed_insufficient_comparison')
        self.assertGreater(len(observation['analysis_binding']['timecoded_observations']), 0)
        library, handoff = b.prepare({'references':[], 'hold':True}, {'intake_runs':[{'frozen':True}]},
                                    [observation], {'operations':[]}, self.growth)
        again = b.prepare(library, handoff, [observation], {'operations':[]}, self.growth)
        self.assertEqual((library, handoff), again)
        self.assertTrue(library['hold'])
        revised = {**observation, 'revision_id':'changed-analysis-input'}
        b.merge_references(library, [revised])
        self.assertEqual(len(library['references'][0]['performance_observations']), 2)
        # Existing receipt metadata remains bound to actual delivered bytes.
        original_digest = b.digest
        with patch.object(b, 'digest', side_effect=lambda path: '0'*64 if Path(path).name == 'reference-original.mp4' else original_digest(path)):
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                b.handson_record(root)

    def test_existing_atomic_writer_idempotence_preserve_and_failure(self):
        result = b.feedback_operations([self.row], [self.binding], self.growth)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'library.json'
            path.write_text(json.dumps({'unknown':42,'latest_decisions':[{'hold':True}]}))
            for op in result['operations']:
                self.growth.record(path, op['operation'], op['payload'])
            original = path.read_bytes()
            for op in result['operations']:
                self.growth.record(path, op['operation'], op['payload'])
            self.assertEqual(path.read_bytes(),original)
            payload = copy.deepcopy(result['operations'][1]['payload'])
            payload['observation_id'] = 'another'
            with patch.object(self.growth.os,'replace',side_effect=OSError('disk')):
                with self.assertRaises(OSError): self.growth.record(path,'observation',payload)
            self.assertEqual(path.read_bytes(),original)
            self.assertEqual(json.loads(original)['unknown'],42)
            self.assertEqual(list(Path(directory).glob('*.tmp')),[])


if __name__ == '__main__': unittest.main()
