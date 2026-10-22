import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from photo_story import check_photo_story, sha256


class PhotoStoryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.scenes = []
        for i in range(7):
            path = self.root / f'photo{i}.png'
            Image.new('RGB', (20, 30), (i * 30, 0, 0)).save(path)
            start = 0 if i == 0 else 1 + (i - 1) * 3
            self.scenes.append(dict(actual_start=start, actual_end=start + (1 if i == 0 else 3),
                                    source=dict(path=path.name, sha256=sha256(path),
                                                original_path=path.name, original_sha256=sha256(path))))
        self.video = self.root / 'private-review.mp4'
        self.video.write_bytes(b'exact-video-fixture')

    def save(self):
        html = ''.join(f'<section id="scene-{i}" data-start="{s["actual_start"]}" '
                       f'data-duration="{s["actual_end"] - s["actual_start"]}">'
                       f'<img class="body-photo" src="{s["source"]["path"]}"></section>'
                       for i, s in enumerate(self.scenes))
        (self.root / 'index.html').write_text(html)
        (self.root / 'actual-directed-scenes.json').write_text(json.dumps(dict(scenes=self.scenes)))
        (self.root / 'caption-timings.json').write_text(json.dumps(dict(
            first_hook_end_seconds=1, cues=[dict(start=0, end=1, ko='One hook?')])))
        (self.root / 'source-manifest.json').write_text(json.dumps(dict(fps=30, source_files=[
            dict(path=n, sha256=sha256(self.root / n))
            for n in ['index.html', 'actual-directed-scenes.json', 'caption-timings.json'] +
            sorted({s['source']['path'] for s in self.scenes})])))
        return check_photo_story(self.root)

    def review(self):
        self.save()
        rows = []
        for i, s in enumerate(self.scenes):
            rows.append(dict(scene_id=f'scene-{i}', original_sha256=s['source']['original_sha256'],
                             shot_scale='wide' if i < 2 else 'medium' if i == 2 else 'close',
                             frame_path=str(self.root / s['source']['path']),
                             frame_sha256=s['source']['sha256'], seconds=s['actual_start'] + .1))
        boundary = [dict(rows[0], seconds=29/30), dict(rows[1], seconds=1)]
        return dict(reviewer='fixture', reviewed_at='2026-10-19T09:00:00Z', space_curation=True,
                    source_manifest_sha256=sha256(self.root / 'source-manifest.json'),
                    video_sha256=sha256(self.video), hook_end_seconds=1, one_brief_hook_phrase=True,
                    hook_text='One hook?', encoded_first_different_photo_seconds=1,
                    genuinely_distinct_originals_reviewed=True, scenes=rows, transition_frames=boundary)

    def test_missing_review_is_not_pass(self):
        result = self.save()
        self.assertTrue(result['source_checks_passed'])
        self.assertFalse(result['passed'])

    def test_exact_four_seconds_is_allowed_but_next_frame_is_rejected(self):
        self.scenes[-1]['actual_end'] = self.scenes[-1]['actual_start'] + 4
        self.assertTrue(self.save()['source_checks_passed'])
        self.scenes[-1]['actual_end'] += 1 / 30
        self.assertIn('same_photo_contiguous_over_4_seconds', self.save()['errors'])

    def test_cover_over_four_seconds_is_rejected(self):
        self.scenes[0]['actual_end'] = 4 + 1 / 30
        self.assertIn('same_photo_contiguous_over_4_seconds', self.save()['errors'])

    def test_adjacent_crops_cannot_reset_original_photo_timer(self):
        repeated = json.loads(json.dumps(self.scenes[-1]))
        repeated['actual_start'] = self.scenes[-1]['actual_end']
        repeated['actual_end'] = repeated['actual_start'] + 3
        self.scenes.append(repeated)
        result = self.save()
        self.assertEqual(result['distinct_body_originals_excluding_cover'], 6)
        self.assertIn('same_photo_contiguous_over_4_seconds', result['errors'])

    def test_cover_does_not_count_toward_five(self):
        self.scenes = self.scenes[:5]
        self.assertIn('fewer_than_5_distinct_body_originals', self.save()['errors'])

    def test_reencoded_crops_of_same_original_count_once(self):
        for s in self.scenes[1:]:
            s['source'].update(original_path='photo1.png', original_sha256=self.scenes[1]['source']['sha256'])
        self.assertEqual(self.save()['distinct_body_originals'], 1)

    def test_first_body_same_as_cover_fails_even_if_other_photos_suffice(self):
        self.scenes[1]['source'] = self.scenes[0]['source'].copy()
        self.assertIn('first_body_reuses_cover_original', self.save()['errors'])

    def test_complete_review_passes_and_wrong_cut_or_missing_context_fails(self):
        review = self.review()
        self.assertTrue(check_photo_story(self.root, review=review)['passed'])
        review['encoded_first_different_photo_seconds'] = 4
        self.assertIn('encoded_first_cut_not_at_hook_end', check_photo_story(self.root, review=review)['errors'])
        review = self.review()
        for row in review['scenes']:
            row['shot_scale'] = 'close'
        self.assertIn('space_curation_requires_first_body_wide', check_photo_story(self.root, review=review)['errors'])

    def test_changed_review_binding_and_missing_source_never_pass(self):
        review = self.review()
        review['video_sha256'] = 'stale'
        self.assertFalse(check_photo_story(self.root, review=review)['passed'])
        (self.root / 'photo2.png').unlink()
        self.assertFalse(check_photo_story(self.root, review=review)['passed'])

    def test_cover_reused_later_does_not_inflate_body_minimum(self):
        self.scenes = self.scenes[:6]
        self.scenes[-1]['source'] = self.scenes[0]['source'].copy()
        result = self.save()
        self.assertEqual(result['distinct_body_originals'], 5)
        self.assertEqual(result['distinct_body_originals_excluding_cover'], 4)
        self.assertFalse(result['source_checks_passed'])

    def test_missing_encoded_boundary_pair_is_not_pass(self):
        review = self.review()
        review.pop('transition_frames')
        self.assertIn('missing_encoded_boundary_frame_pair', check_photo_story(self.root, review=review)['errors'])

    def test_incomplete_source_evidence_has_unknown_count(self):
        self.save()
        (self.root / 'photo2.png').unlink()
        result = check_photo_story(self.root)
        self.assertIsNone(result['distinct_body_originals'])
        self.assertFalse(result['passed'])

    def test_hook_review_must_match_actual_caption_timing(self):
        review = self.review()
        path = self.root / 'caption-timings.json'
        path.write_text(json.dumps(dict(first_hook_end_seconds=.5, cues=[dict(start=0, end=.5, ko='Different hook')])))
        manifest = json.loads((self.root / 'source-manifest.json').read_text())
        for f in manifest['source_files']:
            if f['path'] == path.name:
                f['sha256'] = sha256(path)
        (self.root / 'source-manifest.json').write_text(json.dumps(manifest))
        review['source_manifest_sha256'] = sha256(self.root / 'source-manifest.json')
        self.assertIn('hook_review_not_bound_to_caption_timing', check_photo_story(self.root, review=review)['errors'])

    def test_three_caption_phrases_cannot_be_labelled_one_cover_hook(self):
        review = self.review()
        path = self.root / 'caption-timings.json'
        path.write_text(json.dumps(dict(first_hook_end_seconds=1, cues=[
            dict(start=0, end=.3, ko='One hook?'), dict(start=.3, end=.6, ko='Second phrase'),
            dict(start=.6, end=1, ko='Third phrase')])))
        manifest = json.loads((self.root / 'source-manifest.json').read_text())
        for f in manifest['source_files']:
            if f['path'] == path.name:
                f['sha256'] = sha256(path)
        (self.root / 'source-manifest.json').write_text(json.dumps(manifest))
        review['source_manifest_sha256'] = sha256(self.root / 'source-manifest.json')
        self.assertIn('hook_review_not_bound_to_caption_timing', check_photo_story(self.root, review=review)['errors'])

    def test_current_G9_motions_and_crop_bindings_without_section_ids(self):
        self.save()
        path = self.root / 'index.html'
        import re
        path.write_text(re.sub(r' id="[^"]+"', '', path.read_text()))
        directed = dict(motions=[[s['actual_start'], s['actual_end'] - s['actual_start'], f'camera-{i}']
                                 for i, s in enumerate(self.scenes)])
        (self.root / 'actual-directed-scenes.json').write_text(json.dumps(directed))
        bindings = dict(sources=[dict(path=str(self.root / s['source']['path']),
                                      sha256=s['source']['sha256'],
                                      crop=str(self.root / s['source']['path']),
                                      crop_sha256=s['source']['sha256']) for s in self.scenes])
        (self.root / 'actual-photo-bindings.json').write_text(json.dumps(bindings))
        names = ['index.html', 'actual-directed-scenes.json', 'actual-photo-bindings.json', 'caption-timings.json']
        names += [s['source']['path'] for s in self.scenes]
        (self.root / 'hyperframes.json').write_text(json.dumps(dict(fps=30)))
        names.append('hyperframes.json')
        (self.root / 'source-manifest.json').write_text(json.dumps(dict(source_files=[
            dict(path=n, sha256=sha256(self.root / n)) for n in names])))
        result = check_photo_story(self.root)
        self.assertTrue(result['source_checks_passed'], result['errors'])


if __name__ == '__main__':
    unittest.main()
