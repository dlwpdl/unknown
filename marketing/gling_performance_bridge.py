"""Offline Gling bridge: prepare library/handoff copies and existing growth_loop payloads.

Default is prepare only; --apply requires explicit Gling paths and existing writer locks.
No network action. Growth payloads also support growth_loop.py --library EXPLICIT_Gling_PATH.
"""
import argparse
import copy
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile

from instagram_reference_discovery import REVIEWS, normalize_observation, qualify_observations
from meta_api import now_utc, private_json


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def reference_identity(url):
    match = re.fullmatch(r'https://(?:www\.)?instagram\.com/(?:reel|p)/([A-Za-z0-9_-]+)/(?:\?[^#]*)?', url or '')
    return 'IG-' + match[1] if match else None


def load_growth(path):
    spec = importlib.util.spec_from_file_location('gling_existing_growth_loop', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def merge_references(library, observations):
    """Append immutable evidence revisions; leave existing selections, holds and fields intact."""
    references = library.setdefault('references', [])
    for observation in observations:
        identity = reference_identity(observation['source_url'])
        if identity is None or identity != observation['reference_id']:
            raise ValueError('Reference source ID/URL mismatch')
        matches = [r for r in references if r.get('reference_id') == observation['reference_id']
                   or reference_identity(r.get('source_url')) == identity]
        if len(matches) > 1:
            raise ValueError('Duplicate reference identity')
        if matches:
            reference = matches[0]
            if reference['reference_id'] != identity or reference_identity(reference['source_url']) != identity:
                raise ValueError('Reference source ID/URL mismatch')
        else:
            reference = {k: observation[k] for k in ('reference_id', 'source_url', 'reference_role')}
            references.append(reference)
        revisions = reference.setdefault('performance_observations', [])
        identity = observation.get('revision_id', observation['observation_id'])
        old = next((r for r in revisions if r.get('revision_id', r['observation_id']) == identity), None)
        if old is not None and old != observation:
            raise ValueError('Immutable reference observation conflict')
        if old is None:
            revisions.append(copy.deepcopy(observation))


def feedback_operations(rows, bindings, growth):
    """Join exact G10 IDs and uploaded hashes; never substitute received/transcoded hashes."""
    def index(values, key):
        result = {}
        for value in values:
            ident = value.get(key)
            if not ident:
                continue
            if ident in result:
                raise ValueError('Duplicate ' + key)
            result[ident] = value
        return result
    observations, publications = index(rows, 'id'), index(bindings, 'public_id')
    result = dict(joined=[], blocked=[], unbound_observation_ids=sorted(set(observations)-set(publications)), operations=[])
    sandbox = {}
    for binding in bindings:
        ident = binding.get('public_id')
        row = observations.get(ident)
        try:
            if not ident or row is None:
                raise ValueError('no_matching_public_observation')
            if row.get('platform') != 'instagram' or row.get('account') != 'gling.app' or row.get('format') != 'reel' or binding.get('account', 'gling.app') != 'gling.app' or binding.get('channel_id', 'gling.app') != 'gling.app':
                raise ValueError('other_channel_or_format')
            if binding.get('current_public_present') is not True:
                raise ValueError('public_presence_unverified')
            for key in ('video_sha256', 'source_manifest_sha256'):
                if not re.fullmatch('[a-f0-9]{64}', binding.get(key) or '') or binding.get(key+'_matches') is not True or binding.get(key+'_actual') != binding[key]:
                    raise ValueError('binding_hash_mismatch_' + key)
            saved = row.get('publication_binding') or {}
            if saved.get('public_id') != ident or saved.get('video_sha256') != binding['video_sha256']:
                raise ValueError('observation_id_or_master_hash_mismatch')
            if not binding.get('publication_receipt') or not re.fullmatch('[a-f0-9]{64}', binding.get('publication_receipt_sha256') or ''):
                raise ValueError('publication_receipt_missing')
            elapsed = (growth.timestamp(row['observed_at']) - growth.timestamp(row['published_at'])).total_seconds()/3600
            if elapsed < 0:
                raise ValueError('observation_precedes_publication')
            if reference_identity(binding.get('reference_url')) is None:
                raise ValueError('reference_source_identity_missing')
            capture_hash = hashlib.sha256(json.dumps(row, sort_keys=True).encode()).hexdigest()
            joined = dict(public_id=ident, capture_sha256=capture_hash,
                candidate_observation_id=ident+'-snapshot-'+capture_hash, case_id=binding['case_id'], reference_url=binding.get('reference_url'),
                video_sha256=binding['video_sha256'], source_manifest_sha256=binding['source_manifest_sha256'],
                observed_at=row['observed_at'], published_at=row['published_at'], actual_elapsed_hours=elapsed,
                metrics=copy.deepcopy(row.get('metrics')), source=row.get('source'),
                reference_id=reference_identity(binding['reference_url']),
                observation_window='early' if elapsed < 48 else '48h_or_later' if elapsed < 168 else '7d_or_later',
                target_48h_observation=None, target_7d_observation=None,
                note='Arbitrary cumulative snapshot; does not fill exact target-age slots.')
            result['joined'].append(joined)
            if not binding.get('template_id') or not binding.get('template_version'):
                raise ValueError('exact_historical_template_id_or_version_missing')
            publication = dict(publication_id=ident, platform='instagram', video_id=ident, channel_id='gling.app',
                format='reels', file_sha256=binding['video_sha256'], source_manifest_sha256=binding['source_manifest_sha256'],
                timestamp_anchor=row['published_at'], template_id=binding['template_id'], template_version=binding['template_version'],
                receipt=binding['publication_receipt'], receipt_sha256=binding['publication_receipt_sha256'],
                url=row['url'], reference_url=binding.get('reference_url'), project_id=binding['case_id'])
            metrics = {}
            for old, new in {'views':'public_views','likes':'likes','reach':'reach','shares':'shares',
                             'comments':'comments','saves':'saves','watch_seconds':'watch_time_seconds',
                             'average_watch_seconds':'average_view_duration','follows':'followers_gained'}.items():
                if old not in row.get('metrics', {}):
                    continue
                metrics[new] = dict(value=row['metrics'][old], source={'path':row['source']})
                if row['metrics'][old] is None:
                    metrics[new]['reason'] = row.get('missing_metric_reason', {}).get(old) or 'not_returned_in_saved_G10_capture'
            observation = dict(publication_id=ident, observation_id=ident+'-snapshot-'+capture_hash,
                platform='instagram', channel_id='gling.app', video_id=ident, file_sha256=binding['video_sha256'],
                observed_at=row['observed_at'], metrics=metrics, source={'path':row['source']},
                unavailable_reason='Saved G10 capture; unreturned metrics remain null',
                observation_window=joined['observation_window'], original_observation_interval=row.get('observation_interval'))
            growth.update(sandbox, 'publication', publication)
            growth.update(sandbox, 'observation', observation)
            result['operations'].extend([dict(operation='publication', payload=publication), dict(operation='observation', payload=observation)])
        except (ValueError, KeyError, TypeError) as error:
            result['blocked'].append(dict(case_id=binding.get('case_id'), public_id=ident, reason=str(error)))
    return result


def handson_record(root):
    """Read the actual accepted source→MCP script→encoded review→release receipts."""
    root = Path(root)
    project = root/'revisions/tubebench-compare-b'
    paths = dict(analysis=project/'reference-analysis/analysis.json', prepare=project/'tubebench-prepare-input.json',
        prepare_result=project/'tubebench-prepare-script.json', script=project/'tubebench-save-script.json',
        encoded_review=project/'bilingual-v3-uppercase-cover/final-reference-application-review.json',
        release=root/'publishing/final-release-review.json', publication=root/'publishing/instagram-publication-result.json')
    data = {key:read(path) for key,path in paths.items()}
    source, release, publication = data['analysis'], data['release'], data['publication']
    context, _ = json.JSONDecoder().raw_decode(data['prepare']['analysis_context'])
    if context['source_url'] != source['source_url'] or context['actual_analysis_inputs'] != source['actual_analysis_inputs']:
        raise ValueError('MCP source/analysis binding mismatch')
    if data['prepare_result']['benchmark_data_loaded'] is not False:
        raise ValueError('Unexpected benchmark DB claim')
    if digest(project/'reference-analysis/reference-original.mp4') != source['actual_analysis_inputs']['source_mp4_sha256']:
        raise ValueError('Reference video hash mismatch')
    if data['encoded_review']['reference'] != source['source_url'] or release['owner_approved_original_master_sha256'] != data['encoded_review']['actual_new_render_sha256']:
        raise ValueError('Encoded application/release mismatch')
    if release['accepted'] is not True or publication['public_id'] != publication['public_readback']['id']:
        raise ValueError('Accepted publication evidence missing')
    shortcode = source['source_url'].rstrip('/').split('/')[-1]
    row = dict(id=shortcode, permalink=source['source_url'], timestamp=source['published_at_utc'],
        account_handle=source['creator'], view_count=source['views']['approximate_count'],
        views_precision='rounded', views_display=source['views']['native_display'],
        followers_precision='rounded', followers_display=source['creator_followers']['native_display'],
        topic='local-dining-firsthand')
    observation = qualify_observations([normalize_observation(row, source['observed_at_utc'],
        source['creator_followers']['approximate_count'], str(paths['analysis']), reference_role='structure_benchmark')])[0]
    paths['saved_script'] = Path(data['script']['json_path'])
    if read(paths['saved_script'])['script_id'] != data['script']['script_id']:
        raise ValueError('Saved script identity mismatch')
    paths['quality'] = Path(release['quality_receipt'])
    quality = read(paths['quality'])
    if digest(paths['quality']) != release['quality_sha256'] or quality['delivery_sha256'] != release['video_sha256'] or quality['master_sha256'] != release['owner_approved_original_master_sha256'] or quality['unchanged_source_manifest_sha256'] != release['source_manifest_sha256']:
        raise ValueError('Final release master/manifest binding mismatch')
    if digest(quality['delivery']) != release['video_sha256'] or digest(quality['master']) != quality['master_sha256']:
        raise ValueError('Final delivered video hash mismatch')
    observation['analysis_binding'] = dict(media_sha256=source['actual_analysis_inputs']['source_mp4_sha256'],
        timecoded_observations=source['timecoded_observations'], selected_reason=source['selection'],
        script_id=data['script']['script_id'], benchmark_data_loaded=False)
    observation['production_binding'] = dict(public_id=publication['public_id'],
        public_url=publication['public_readback']['permalink'], video_sha256=release['video_sha256'],
        source_manifest_sha256=release['source_manifest_sha256'],
        owner_approved_original_master_sha256=release['owner_approved_original_master_sha256'],
        acceptance_basis=release['acceptance_basis'], publication_timestamp=publication['public_readback']['timestamp'])
    observation['chain_receipts'] = {key:dict(path=str(path),sha256=digest(path)) for key,path in paths.items()}
    observation['revision_id'] = hashlib.sha256(json.dumps(observation,sort_keys=True).encode()).hexdigest()
    return observation


def prepare(library, handoff, references, feedback, growth):
    proposed, next_handoff = copy.deepcopy(library), copy.deepcopy(handoff)
    merge_references(proposed, references)
    for operation in feedback['operations']:
        growth.update(proposed, operation['operation'], operation['payload'])
    revision = dict(reference_ids=sorted({r['reference_id'] for r in references}),
        observation_ids=sorted({r['observation_id'] for r in references}),
        reference_revision_ids=sorted({r.get('revision_id', r['observation_id']) for r in references}))
    revision.update(venue_evidence_ids=sorted({r['reference_id'] for r in references if r['reference_role'] == 'venue_evidence'}),
        eligible_structure_candidate_ids=sorted({r['reference_id'] for r in references
            if r['reference_role'] == 'structure_benchmark' and r['assessment'].get('relative_sample_leader') is True}),
        insufficient_comparison_ids=sorted({r['reference_id'] for r in references
            if r['assessment']['status'] != 'performance_relative_observation'}),
        manually_selected_structure_ids=sorted({r['reference_id'] for r in references
            if r['reference_role'] == 'structure_benchmark' and r.get('analysis_binding', {}).get('selected_reason')}))
    revisions = next_handoff.setdefault('performance_reference_revisions', [])
    revision['revision_id'] = hashlib.sha256(json.dumps(revision, sort_keys=True).encode()).hexdigest()
    if revision not in revisions:
        revisions.append(revision)
    return proposed, next_handoff


def apply(library_path, handoff_path, references, feedback, growth):
    """Re-read under the existing two writer locks; atomically merge, never copy snapshots."""
    library_path, handoff_path = Path(library_path), Path(handoff_path)
    paths = [library_path, handoff_path]
    canonical = [Path('/Users/ash/Desktop/Git/Orca/workspace/tubebench/stickleback/data/gling-reference-library.json'),
                 Path('/Users/ash/Desktop/Git/unknown/mobile/marketing/gling-reference-handoff.json')]
    real_targets = [p.resolve() for p in paths] == canonical
    if paths[0].resolve() == paths[1].resolve() or not (real_targets or all(p.resolve().is_relative_to(REVIEWS.resolve()) for p in paths)):
        raise ValueError('Only explicit Gling canonical paths or Gling review fixtures may be applied')
    locks = [Path(str(p)+'.lock') for p in paths]
    if any(p.is_symlink() or not p.is_file() for p in paths) or any(p.is_symlink() for p in locks):
        raise ValueError('Apply requires regular files and existing lock convention without symlinks')
    with locks[0].open('a') as library_lock, locks[1].open('a') as handoff_lock:
        fcntl.flock(library_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(handoff_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        original = {p:p.read_bytes() for p in paths}
        latest = [json.loads(original[p]) for p in paths]
        if any(v.get('profile_id') != 'gling-cinematic-places' or v.get('channel_id', 'gling.app') != 'gling.app' for v in latest):
            raise ValueError('Apply requires the Gling profile/channel')
        updated = prepare(*latest, references, feedback, growth)
        apply_id = hashlib.sha256(json.dumps([references, feedback['operations']], sort_keys=True).encode()).hexdigest()
        evidence = dict(apply_id=apply_id, applied=True, reference_revision_ids=sorted({r.get('revision_id', r['observation_id']) for r in references}))
        applies = updated[1].setdefault('performance_reference_applies', [])
        prior = next((entry for entry in applies if entry['apply_id'] == apply_id), None)
        if prior is not None and prior != evidence:
            raise ValueError('Immutable apply evidence conflict')
        if prior is None:
            applies.append(evidence)
        changed = []
        try:
            for path, before, after in zip(paths, latest, updated):
                if before == after:
                    continue
                after['updated_at'] = now_utc().isoformat()
                if path.read_bytes() != original[path]:
                    raise RuntimeError('Target changed outside writer lock; reconcile deliberately')
                changed.append(path)
                private_json(path, after)
        except Exception:
            # Restore exact bytes if the second file fails; both files still use atomic replace.
            for path in reversed(changed):
                fd, temporary = tempfile.mkstemp(dir=path.parent)
                try:
                    with os.fdopen(fd, 'wb') as stream:
                        stream.write(original[path]); stream.flush(); os.fsync(stream.fileno())
                    os.replace(temporary, path)
                finally:
                    if Path(temporary).exists(): Path(temporary).unlink()
            raise
        return dict(status='applied', apply_id=apply_id, changed_files=[str(p) for p in changed],
            canonical_targets=real_targets,
            input_sha256={str(p):hashlib.sha256(original[p]).hexdigest() for p in paths},
            output_sha256={str(p):digest(p) for p in paths})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('library','handoff','growth-loop','performance','bindings','out-dir'):
        parser.add_argument('--'+name, type=Path, required=True)
    parser.add_argument('--handson-dir', type=Path)
    parser.add_argument('--discovery', type=Path)
    parser.add_argument('--apply', action='store_true', help='Explicit merge under Gling library.lock then handoff.lock; default prepares only')
    args = parser.parse_args()
    out = args.out_dir.resolve()
    if not out.is_relative_to(REVIEWS.resolve()) or out == REVIEWS.resolve() or args.out_dir.is_symlink():
        parser.error('Outputs must be in a Gling reviews subdirectory')
    inputs = {name:getattr(args,name) for name in ('library','handoff','growth_loop','performance','bindings')}
    for name in ('discovery', 'handson_dir'):
        if getattr(args, name):
            inputs[name] = getattr(args, name)
    if any(path.resolve().is_relative_to(out) for path in inputs.values()):
        parser.error('Inputs cannot be overwritten by exports')
    snapshots = {name:path.read_bytes() for name,path in inputs.items() if path.is_file()}
    growth = load_growth(args.growth_loop)
    references = [handson_record(args.handson_dir)] if args.handson_dir else []
    if args.discovery:
        inputs['discovery'] = args.discovery
        saved = json.loads(snapshots['discovery'])
        for row in saved['references']:
            references.append(row.get('performance_observation') or normalize_observation(row,
                saved['observed_at'], next((a.get('followers_count') for a in saved.get('accounts', [])
                    if a.get('username') == row.get('account_handle')), None), str(args.discovery)))
    performance = json.loads(snapshots['performance'])
    feedback = feedback_operations(performance['instagram_observations'], json.loads(snapshots['bindings']), growth)
    references = qualify_observations(references)
    proposed, handoff = prepare(json.loads(snapshots['library']), json.loads(snapshots['handoff']), references, feedback, growth)
    summary = dict(status='prepared_offline_only', canonical_writes=0, network_calls=0,
        inputs={name:dict(path=str(inputs[name]),sha256=hashlib.sha256(data).hexdigest()) for name,data in snapshots.items()},
        g10_generated_at=performance.get('generated_at'), observations=len(performance['instagram_observations']),
        bindings=len(json.loads(snapshots['bindings'])), normalized_references=len(references),
        joined=feedback['joined'], blocked=feedback['blocked'], unbound_observation_ids=feedback['unbound_observation_ids'],
        operations=len(feedback['operations']),
        structure_publications_not_in_G10=[r['production_binding']['public_id'] for r in references
            if r.get('production_binding') and r['production_binding']['public_id'] not in {o['id'] for o in performance['instagram_observations']}],
        no_causal_or_end_to_end_claim=True)
    for name, value in [('references',references), ('growth-operations',feedback['operations']),
                        ('proposed-library',proposed), ('proposed-handoff',handoff), ('summary',summary)]:
        private_json(out/(name+'.json'), value)
    for index, operation in enumerate(feedback['operations']):
        private_json(out/(str(index).zfill(3)+'-'+operation['operation']+'.json'),operation['payload'])
    if args.apply:
        receipt = apply(args.library, args.handoff, references, feedback, growth)
        private_json(out/'apply-receipt.json', receipt)
        summary.update(status='applied', apply=receipt, target_writes=len(receipt['changed_files']),
                       canonical_writes=len(receipt['changed_files']) if receipt['canonical_targets'] else 0)
        private_json(out/'summary.json', summary)
    print(json.dumps({key:summary[key] for key in ('status','observations','bindings','normalized_references','operations')}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
