"""Read-only photo-story gate for new G9/G8 revisions; never edits publication state.

Usage: python3 marketing/photo_story.py PROJECT [--video FILE] [--review G8.json]
Stdout is a receipt; exit 0 means this photo-story check passed, 3 means hold.
Original hashes establish provenance identity, not visual distinctness; G8 must
inspect encoded frames and supply the bound review described in the report.
"""
import argparse
import hashlib
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import sys

from PIL import Image


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


class PhotoTimeline(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.sections, self.current = [], None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'section' and 'data-start' in a:
            self.current = dict(scene_id=a.get('id', 'photo-section-' + str(len(self.sections))), start=float(a['data-start']),
                                end=float(a['data-start']) + float(a['data-duration']), photos=[])
            self.sections.append(self.current)
        if tag == 'img' and self.current is not None and set(a.get('class', '').split()) & {'photo', 'body-photo'}:
            self.current['photos'].append(a['src'])

    def handle_endtag(self, tag):
        if tag == 'section':
            self.current = None


def check_photo_story(project, video=None, review=None):
    project = Path(project).resolve()
    errors, warnings, rows = [], [], []
    result = dict(policy_id='OWNER_PHOTO_STORY_MIN5_20261019', passed=False,
                  source_checks_passed=False, errors=errors, warnings=warnings,
                  project=str(project), scenes=rows, distinct_body_originals=None,
                  encoded_verification='missing', publication_authorized=False)
    try:
        manifest_path = project / 'source-manifest.json'
        result['source_manifest_sha256'] = sha256(manifest_path)
        manifest = json.loads(manifest_path.read_text())
        files = {f['path']: f['sha256'] for f in manifest['source_files']}
        for name in ['index.html', 'actual-directed-scenes.json', 'caption-timings.json']:
            if files.get(name) != sha256(project / name):
                errors.append('manifest_binding_mismatch:' + name)
        if 'fps' in manifest:
            fps = float(manifest['fps'])
        else:
            name = 'hyperframes.json'
            if files.get(name) != sha256(project / name):
                errors.append('manifest_binding_mismatch:' + name)
            fps = float(json.loads((project / name).read_text())['fps'])
        if not math.isfinite(fps) or fps <= 0:
            raise ValueError('invalid_fps')
        tolerance = 1 / fps + 1e-6
        directing = json.loads((project / 'actual-directed-scenes.json').read_text())
        captions = json.loads((project / 'caption-timings.json').read_text())
        directed = directing.get('scenes')
        if directed is None:
            name = 'actual-photo-bindings.json'
            if files.get(name) != sha256(project / name):
                errors.append('manifest_binding_mismatch:' + name)
            bindings = json.loads((project / name).read_text())['sources']
        timeline = PhotoTimeline((project / 'index.html').read_text()).sections
        for section in timeline:
            if not section['photos']:
                continue
            if len(section['photos']) != 1:
                raise ValueError('ambiguous_photo_layer:' + section['scene_id'])
            src = project / section['photos'][0]
            if directed is None:
                motions = [m for m in directing['motions'] if abs(float(m[0]) - section['start']) < 1e-5
                           and abs(float(m[0]) + float(m[1]) - section['end']) < 1e-5]
                matches = [b for b in bindings if b['crop_sha256'] == sha256(src)]
                if len(motions) != 1:
                    raise ValueError('missing_or_ambiguous_motion_binding:' + section['scene_id'])
                if len(matches) != 1:
                    raise ValueError('missing_or_ambiguous_original_binding_for_photo:' + section['scene_id'])
                binding = matches[0]
                source = dict(path=binding['crop'], sha256=binding['crop_sha256'],
                              original_path=binding.get('original_path', binding['path']),
                              original_sha256=binding.get('original_sha256', binding['sha256']))
            else:
                matches = [s for s in directed if abs(float(s['actual_start']) - section['start']) < 1e-5
                           and abs(float(s['actual_end']) - section['end']) < 1e-5]
                if len(matches) != 1:
                    raise ValueError('missing_or_ambiguous_directed_scene:' + section['scene_id'])
                scene = matches[0]
                source = scene['source']
            if isinstance(source, str):
                bound = project / source
                original = Path(scene['source_path'])
                expected, original_sha = scene['display_sha256'], scene['source_sha256']
            else:
                bound = Path(source['path'])
                original = Path(source['original_path'])
                expected, original_sha = source['sha256'], source['original_sha256']
            if not bound.is_absolute():
                bound = project / bound
            if not original.is_absolute():
                original = project / original
            actual = sha256(src)
            if actual != expected or sha256(bound) != actual or sha256(original) != original_sha:
                errors.append('source_binding_mismatch:' + section['scene_id'])
            if files.get(section['photos'][0]) != actual:
                errors.append('photo_not_bound_in_manifest:' + section['scene_id'])
            with Image.open(src) as image:
                dimensions = list(image.size)
            with Image.open(original) as image:
                original_dimensions = list(image.size)
            rows.append(dict(scene_id=section['scene_id'], start=section['start'], end=section['end'],
                             photo=section['photos'][0], sha256=actual, original_sha256=original_sha,
                             original_path=str(original), dimensions=dimensions,
                             original_dimensions=original_dimensions))
        if len(rows) < 2 or abs(rows[0]['start']) > 1e-5:
            raise ValueError('missing_cover_or_body')
        # Same rendered bytes cannot become different originals by changing metadata.
        identities = {}
        for row in rows:
            identities.setdefault(row['sha256'], set()).add(row['original_sha256'])
        if any(len(group) > 1 for group in identities.values()):
            errors.append('conflicting_original_identity_for_same_photo')
        body = rows[1:]
        count = len({r['original_sha256'] for r in body})
        result['distinct_body_originals'] = count
        eligible = len({r['original_sha256'] for r in body} - {rows[0]['original_sha256']})
        result['distinct_body_originals_excluding_cover'] = eligible
        if eligible < 5:
            errors.append('fewer_than_5_distinct_body_originals')
        elif eligible < 6:
            warnings.append('5_body_originals_meet_minimum_6_preferred')
        if rows[0]['original_sha256'] == body[0]['original_sha256']:
            errors.append('first_body_reuses_cover_original')
        for before, after in zip(rows, rows[1:]):
            if abs(before['end'] - after['start']) > 1e-5:
                errors.append('photo_timeline_gap_or_overlap:' + after['scene_id'])
        holds = []
        for row in rows:
            if (holds and row['original_sha256'] == holds[-1]['original_sha256']
                    and abs(row['start'] - holds[-1]['end']) < 1e-5):
                holds[-1]['end'] = row['end']
            else:
                holds.append({k: row[k] for k in ('original_sha256', 'start', 'end')})
        result['max_contiguous_same_original_seconds'] = max(r['end'] - r['start'] for r in holds)
        if result['max_contiguous_same_original_seconds'] > 4 + 1e-6:
            errors.append('same_photo_contiguous_over_4_seconds')
        for row in body:
            if not 3 - tolerance <= row['end'] - row['start'] <= 4 + 1e-6:
                errors.append('body_photo_outside_3_to_4_seconds:' + row['scene_id'])
        result['source_checks_passed'] = not errors
        if not review:
            errors.append('missing_bound_G8_encoded_and_visual_review')
        else:
            video = Path(video) if video else project / 'private-review.mp4'
            result['video_sha256'] = sha256(video)
            for field in ['source_manifest_sha256', 'video_sha256']:
                if review.get(field) != result[field]:
                    errors.append('review_binding_mismatch:' + field)
            if not review.get('reviewer') or not review.get('reviewed_at'):
                errors.append('missing_reviewer_and_time')
            if review.get('genuinely_distinct_originals_reviewed') is not True:
                errors.append('missing_visual_distinctness_review')
            if review.get('one_brief_hook_phrase') is not True or not review.get('hook_text'):
                errors.append('missing_one_brief_hook_phrase_review')
            hook = float(review['hook_end_seconds'])
            cut = float(review['encoded_first_different_photo_seconds'])
            first_caption = captions['cues'][0]
            caption_hook_end = float(captions.get('first_hook_end_seconds', first_caption['end']))
            caption_hook_text = first_caption.get('ko', first_caption.get('semantic_unit', first_caption.get('text', '')))
            if (abs(hook - caption_hook_end) > tolerance
                    or abs(caption_hook_end - float(first_caption['end'])) > tolerance
                    or any(float(c['start']) < hook - tolerance for c in captions['cues'][1:])
                    or ' '.join(review['hook_text'].split()) != ' '.join(caption_hook_text.split())):
                errors.append('hook_review_not_bound_to_caption_timing')
            if not all(math.isfinite(n) and n > 0 for n in [hook, cut]):
                raise ValueError('invalid_hook_or_cut_seconds')
            if abs(cut - hook) > tolerance or abs(body[0]['start'] - cut) > tolerance:
                errors.append('encoded_first_cut_not_at_hook_end')
            if abs(rows[0]['end'] - hook) > tolerance:
                errors.append('cover_section_not_at_hook_end')
            boundary = review.get('transition_frames', [])
            if len(boundary) != 2:
                errors.append('missing_encoded_boundary_frame_pair')
            else:
                for i, r in enumerate(boundary):
                    expected = rows[0] if i == 0 else body[0]
                    seconds = float(r['seconds'])
                    if (not math.isfinite(seconds) or abs(seconds - cut) > tolerance
                            or (i == 0 and seconds >= cut) or (i == 1 and seconds < cut)
                            or r.get('original_sha256') != expected['original_sha256']
                            or sha256(r['frame_path']) != r['frame_sha256']):
                        errors.append('encoded_boundary_frame_mismatch')
            reviewed = review.get('scenes', [])
            for row in rows:
                matches = [r for r in reviewed if r.get('scene_id') == row['scene_id']]
                if len(matches) != 1:
                    errors.append('missing_encoded_scene_review:' + row['scene_id'])
                    continue
                r = matches[0]
                if (r.get('original_sha256') != row['original_sha256']
                        or not row['start'] <= float(r['seconds']) < row['end']
                        or sha256(r['frame_path']) != r['frame_sha256']):
                    errors.append('encoded_scene_binding_mismatch:' + row['scene_id'])
                if r.get('shot_scale') not in ['wide', 'medium', 'close']:
                    errors.append('missing_reviewed_shot_scale:' + row['scene_id'])
            if not isinstance(review.get('space_curation'), bool):
                errors.append('missing_space_curation_classification')
            scales = {r['scene_id']: r.get('shot_scale') for r in reviewed}
            if review.get('space_curation') is True and scales.get(body[0]['scene_id']) != 'wide':
                errors.append('space_curation_requires_first_body_wide')
            body_scales = [scales.get(r['scene_id']) for r in body]
            if not ('wide' in body_scales and 'medium' in body_scales and 'close' in body_scales
                    and body_scales.index('wide') < body_scales.index('medium') < body_scales.index('close')):
                errors.append('missing_wide_medium_close_progression')
            result['encoded_verification'] = ('reviewed_frames_bound_to_exact_master'
                                              if not errors else 'partial_or_invalid')
        result['passed'] = not errors
    except (OSError, ValueError, KeyError, TypeError, IndexError, AttributeError) as error:
        errors.append('missing_or_invalid_evidence:' + str(error))
    result['status'] = 'passed' if result['passed'] else 'hold'
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('project', type=Path)
    parser.add_argument('--video', type=Path)
    parser.add_argument('--review', type=Path)
    args = parser.parse_args()
    try:
        review = json.loads(args.review.read_text()) if args.review else None
        result = check_photo_story(args.project, args.video, review)
    except (OSError, ValueError) as error:
        result = dict(passed=False, status='hold', errors=[str(error)])
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result['passed'] else 3)
