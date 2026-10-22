"""Bounded checks for cover rotation and safe photographic camera crops."""
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('renderer', Path(__file__).with_name('render-festival-content.py'))
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


class CoverMotionTests(unittest.TestCase):
    def test_rotation_uses_latest_manifest_and_preserves_same_output(self):
        with tempfile.TemporaryDirectory() as directory:
            original_root = renderer.ROOT
            renderer.ROOT = Path(directory)
            try:
                history = renderer.ROOT / 'output/design'
                selected = []
                for i in range(8):
                    out = history / str(i)
                    motion = renderer.select_cover_motion(str(i), out)
                    selected.append(motion)
                    out.mkdir(parents=True)
                    manifest = out / 'manifest.json'
                    manifest.write_text(json.dumps(dict(eventId=str(i), state='local-drafts-ready-for-review',
                        coverMotion='6 seconds; text fixed', coverMotionTemplate=motion)))
                    os.utime(manifest, ns=(i + 1, i + 1))
                    self.assertEqual(renderer.select_cover_motion(str(i), out), motion)
                self.assertEqual(selected[:4], ['slow-push', 'pull-back', 'diagonal-drift', 'side-pan'])
                self.assertEqual(selected[:4], selected[4:])
                self.assertTrue(all(a != b for a, b in zip(selected, selected[1:])))
                old = history / 'legacy'
                old.mkdir()
                (old / 'manifest.json').write_text(json.dumps(dict(eventId='old', coverMotion='old approved loop')))
                self.assertEqual(renderer.select_cover_motion('old', old), 'legacy-loop')
                (old / 'manifest.json').write_text(json.dumps(dict(eventId='unfinished',
                    state='rendering-local-drafts', coverMotion='incomplete', coverMotionTemplate='slow-push')))
                self.assertEqual(renderer.select_cover_motion('new', history / 'new'), 'slow-push')
            finally:
                renderer.ROOT = original_root

    def test_new_camera_crops_stay_inside_source_and_use_entire_path(self):
        for height in (1350, 1920):
            for motion in ['slow-push', 'pull-back', 'diagonal-drift', 'side-pan']:
                poses = []
                for frames in (180, 42):
                    graph = renderer.cover_motion_graph(height, motion, frames)
                    z, x, y = re.search(r"zoompan=z='([^']+)':x='([^']+)':y='([^']+)'", graph).groups()
                    path = []
                    for frame in (0, (frames - 1) / 2, frames - 1):
                        scope = dict(on=frame, iw=2160, ih=height * 2)
                        zoom = eval(z, {'__builtins__': {}}, scope)
                        scope['zoom'] = zoom
                        xpos, ypos = [eval(value, {'__builtins__': {}}, scope) for value in (x, y)]
                        self.assertTrue(1.02 - 1e-9 <= zoom <= 1.10 + 1e-9)
                        self.assertTrue(0 <= xpos <= scope['iw'] - scope['iw'] / zoom)
                        self.assertTrue(0 <= ypos <= scope['ih'] - scope['ih'] / zoom)
                        path.append((zoom, xpos / scope['iw'], ypos / scope['ih']))
                    poses.append(path)
                    self.assertIn('[bg][1:v]overlay=0:0:shortest=1', graph)
                    self.assertNotEqual(path[0], path[-1])
                self.assertEqual(poses[0], poses[1], '1.4s must cover the full 6s motion, not its opening frames')
        with self.assertRaises(ValueError):
            renderer.cover_motion_graph(1920, 'slow-push', 1)


class PhotoCountTests(unittest.TestCase):
    def test_six_to_ten_cards_keep_photo_order_and_fixed_last_introduction(self):
        from bs4 import BeautifulSoup
        from PIL import Image
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / 'assets').mkdir()
            photos = []
            for i in range(9):
                path = folder / f'{i}.png'
                Image.new('RGB', (1080, 1350), (i * 25, 10, 20)).save(path)
                photos.append(dict(file=str(path), title=f'Fixture {i}', creator='Test',
                    source_url=f'https://example.com/{i}', license='CC0',
                    license_url='https://creativecommons.org/publicdomain/zero/1.0/',
                    verified_at='2026-10-08', context='illustrative', alt=f'Photo {i}'))
            event = dict(event_id='COUNT', name='Count', city='VANCOUVER', year='2026',
                cover_title_lines=['COUNT'], title_ko='검증', period_lines=['10월 8일'],
                venue_lines=['검증 장소'], gling_headline_lines=['행사별 문구'],
                instagram_body='프로필 링크에서.', gling_title='검증', gling_body='검증',
                video_caption='프로필 링크에서.', hashtags=['#캐나다','#행사','#사진','#모임','#글링'],
                official_sources=[dict(url='https://example.com/event', verified_at='2026-10-08')])
            introductions = []
            for count in range(4, 9):
                event['photos'] = photos[:count]
                checked = renderer.validate_event(event, [])
                self.assertEqual(len(checked), count)
                for aspect in ['4:3', '9:16']:
                    records, _ = renderer.frames_document(event, checked, folder, aspect)
                    doc = BeautifulSoup((folder / 'frames.html').read_text(), 'html.parser')
                    cards = doc.select('figure')
                    self.assertEqual(len(cards), count + 2)
                    self.assertIsNotNone(cards[-2].select_one('.period-card'))
                    self.assertIsNotNone(cards[-1].select_one('.app-card'))
                    self.assertEqual(len(doc.select('.app-card')), 1)
                    self.assertEqual([card.select_one('.poster > img')['alt'] for card in cards[:count]],
                        [p['alt'] for p in photos[:count]])
                    self.assertEqual(len(records), count)
                    self.assertEqual(cards[-1].select_one('.page').get_text(), f'{count + 2:02d}/{count + 2:02d}')
                    intro = cards[-1].select_one('.app-card')
                    intro.select_one('.page').decompose()
                    introductions.append(intro.get_text(' ', strip=True))
                event.update(name='Other event', city='TORONTO', gling_headline_lines=['다른 문구'])
            self.assertEqual(len(set(introductions)), 1, '행사·도시·수량에 따라 소개 문구가 달라지지 않는다')
            event['photos'] = photos[:8]
            out = folder / 'rendered'
            renderer.render(event, out, renderer.validate_event(event, []), '4:3')
            manifest = json.loads((out / 'manifest.json').read_text())
            self.assertEqual(len(manifest['images']), 10)
            self.assertEqual(manifest['images'][-1]['file'], '10-gling.png')
            self.assertEqual(len(manifest['bounds']), 10)
            for image in manifest['images']:
                with Image.open(out / image['file']) as exported:
                    self.assertEqual(exported.size, (1080, 810))
            for count in [3, 9]:
                event['photos'] = photos[:count]
                with self.assertRaises(ValueError):
                    renderer.validate_event(event, [])


if __name__ == '__main__':
    unittest.main()
