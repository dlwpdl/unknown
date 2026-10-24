#!/usr/bin/env python3
"""Generate with installed cwebp/Pillow; verify existing outputs with stdlib only."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / 'src/components/city-place-photo.tsx'
CATALOG = ROOT / 'src/lib/city-places.photos.json'
DIRECTORY = ROOT / 'assets/images/city-places-display'
MANIFEST = DIRECTORY / 'manifest.json'
BINDING = re.compile(r"'([0-9a-f]{64})': require\('([^']+)'\)")
POLICY = dict(encoder='cwebp', encoderVersion='1.4.0', format='webp', maxEdge=1920, quality=84,
              method=6, resize='preserve-aspect-no-upscale', crop=False, metadata='icc')


def digest(value):
    return hashlib.sha256(value).hexdigest()


def source_rows(value):
    if isinstance(value, dict):
        if 'imageSha256' in value:
            yield value
        for child in value.values():
            yield from source_rows(child)
    elif isinstance(value, list):
        for child in value:
            yield from source_rows(child)


def original_dimensions(data):
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return int.from_bytes(data[16:20], 'big'), int.from_bytes(data[20:24], 'big')
    assert data[:2] == b'\xff\xd8', 'Expected a verified JPEG or PNG original'
    pos = 2
    while pos < len(data):
        assert data[pos] == 255, 'Invalid JPEG marker'
        while data[pos] == 255:
            pos += 1
        marker = data[pos]
        pos += 1
        if marker in (0x01, *range(0xD0, 0xD9)):
            continue
        length = int.from_bytes(data[pos:pos + 2], 'big')
        assert length >= 2 and pos + length <= len(data), 'Invalid JPEG segment'
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            return int.from_bytes(data[pos + 5:pos + 7], 'big'), int.from_bytes(data[pos + 3:pos + 5], 'big')
        assert marker not in (0xDA, 0xD9), 'JPEG has no dimensions'
        pos += length
    raise AssertionError('JPEG has no dimensions')


def webp_info(data):
    assert data[:4] == b'RIFF' and data[8:12] == b'WEBP' and int.from_bytes(data[4:8], 'little') + 8 == len(data), 'Invalid WebP'
    pos, dimensions, icc, alpha = 12, None, None, False
    while pos + 8 <= len(data):
        kind, length = data[pos:pos + 4], int.from_bytes(data[pos + 4:pos + 8], 'little')
        chunk = data[pos + 8:pos + 8 + length]
        assert len(chunk) == length, 'Truncated WebP'
        if kind == b'VP8X':
            assert length == 10
            dimensions = (1 + int.from_bytes(chunk[4:7], 'little'), 1 + int.from_bytes(chunk[7:10], 'little'))
            alpha = bool(chunk[0] & 0x10)
        elif kind == b'VP8 ':
            assert chunk[3:6] == b'\x9d\x01\x2a'
            dimensions = (int.from_bytes(chunk[6:8], 'little') & 0x3FFF, int.from_bytes(chunk[8:10], 'little') & 0x3FFF)
        elif kind == b'ICCP':
            icc = digest(chunk)
        pos += 8 + length + length % 2
    assert dimensions and pos == len(data), 'Missing WebP dimensions'
    return dimensions, icc, alpha


def output_dimensions(width, height):
    scale = min(1, POLICY['maxEdge'] / max(width, height))
    return max(1, round(width * scale)), max(1, round(height * scale))


def metadata_by_hash():
    result = {}
    for row in source_rows(json.loads(CATALOG.read_text())):
        metadata = {key: row[key] for key in ('cityId', 'placeId', 'uri', 'sourceUrl', 'artist', 'license', 'licenseUrl')}
        result.setdefault(row['imageSha256'], []).append(metadata)
    return result


def generate():
    from PIL import Image  # Already installed; not needed by --check or CI.
    encoder = shutil.which('cwebp')
    assert encoder, 'An already-installed cwebp is required for --write'
    version = subprocess.run([encoder, '-version'], capture_output=True, text=True, check=True).stdout.splitlines()[0]
    assert version == POLICY['encoderVersion'], 'Review encoder version changes before regenerating'
    bindings = BINDING.findall(COMPONENT.read_text())
    assert len(bindings) == len(dict(bindings)) == 207
    previous = {row['original']['sha256']: row['original']['path'] for row in json.loads(MANIFEST.read_text())['images']} if MANIFEST.exists() else {}
    sources, metadata = [], metadata_by_hash()
    for sha, relative in bindings:
        path = ROOT / previous[sha] if sha in previous else (COMPONENT.parent / relative).resolve()
        assert path.is_relative_to(ROOT / 'assets/images/city-places') and path.is_file()
        data = path.read_bytes()
        assert digest(data) == sha and sha in metadata, f'Original source hash/provenance changed: {path.name}'
        with Image.open(path) as image:
            assert image.getexif().get(274, 1) == 1 and image.mode == 'RGB', f'Review orientation/alpha before processing {path.name}'
            original = dict(path=path.relative_to(ROOT).as_posix(), sha256=sha, bytes=len(data), width=image.width, height=image.height,
                            mode=image.mode, exifOrientation=1, iccSha256=digest(image.info['icc_profile']) if image.info.get('icc_profile') else None)
        sources.append((path, original))
    DIRECTORY.mkdir(exist_ok=True)
    images = []
    for path, original in sources:
        width, height = output_dimensions(original['width'], original['height'])
        output = DIRECTORY / (path.stem + '.webp')
        temporary = output.with_suffix('.tmp.webp')
        command = [encoder, '-quiet', '-q', str(POLICY['quality']), '-m', str(POLICY['method']), '-metadata', 'icc']
        if (width, height) != (original['width'], original['height']):
            command += ['-resize', str(width), str(height)]
        subprocess.run(command + [str(path), '-o', str(temporary)], capture_output=True, check=True)
        data = temporary.read_bytes()
        dimensions, icc, alpha = webp_info(data)
        assert dimensions == (width, height) and icc == original['iccSha256'] and not alpha, path.name
        temporary.replace(output)
        images.append(dict(original=original, display=dict(path=output.relative_to(ROOT).as_posix(), sha256=digest(data), bytes=len(data),
                          width=width, height=height, iccSha256=icc), sources=metadata[original['sha256']]))
    manifest = dict(schemaVersion=1, transform=POLICY, images=images)
    temporary = MANIFEST.with_suffix('.tmp.json')
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(MANIFEST)
    display_paths = {row['original']['sha256']: '../../' + row['display']['path'] for row in images}
    source = BINDING.sub(lambda match: f"'{match[1]}': require('{display_paths[match[1]]}')", COMPONENT.read_text())
    COMPONENT.write_text(source)


def check():
    manifest, metadata = json.loads(MANIFEST.read_text()), metadata_by_hash()
    assert manifest['schemaVersion'] == 1 and manifest['transform'] == POLICY
    bindings = dict(BINDING.findall(COMPONENT.read_text()))
    images = manifest['images']
    assert len(images) == len(bindings) == 207
    original_bytes = display_bytes = original_pixels = display_pixels = 0
    paths = set()
    for row in images:
        original, display = row['original'], row['display']
        path, output = ROOT / original['path'], ROOT / display['path']
        assert path.is_relative_to(ROOT / 'assets/images/city-places') and output.parent == DIRECTORY
        assert output.suffix == '.webp' and output not in paths
        paths.add(output)
        data, derived = path.read_bytes(), output.read_bytes()
        assert digest(data) == original['sha256'] and len(data) == original['bytes'], path.name
        assert original_dimensions(data) == (original['width'], original['height']), path.name
        assert original['mode'] == 'RGB' and original['exifOrientation'] == 1
        assert digest(derived) == display['sha256'] and len(derived) == display['bytes'], output.name
        dimensions, icc, alpha = webp_info(derived)
        assert dimensions == (display['width'], display['height']) == output_dimensions(original['width'], original['height'])
        assert icc == display['iccSha256'] == original['iccSha256'] and not alpha
        assert row['sources'] == metadata[original['sha256']], f'Source/license metadata changed: {path.name}'
        assert bindings[original['sha256']] == '../../' + display['path']
        original_bytes += len(data)
        display_bytes += len(derived)
        original_pixels += original['width'] * original['height']
        display_pixels += display['width'] * display['height']
    assert set(DIRECTORY.glob('*.webp')) == paths, 'Unexpected or missing display variant'
    for source in (ROOT / 'src').rglob('*'):
        if source.suffix in ('.ts', '.tsx', '.js', '.jsx'):
            assert not re.search(r"require\(['\"][^'\"]*assets/images/city-places/", source.read_text()), f'Original is still statically bundled: {source}'
    return dict(count=len(images), originalBytes=original_bytes, displayBytes=display_bytes, originalPixels=original_pixels,
                displayPixels=display_pixels, originalHashesUnchanged=True, noOriginalStaticRequires=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument('--write', action='store_true', help='Regenerate display assets and update existing static bindings')
    action.add_argument('--check', action='store_true', help='Verify provenance, dimensions, bytes and bundle bindings (default)')
    args = parser.parse_args()
    if args.write:
        generate()
    print(json.dumps(check(), indent=2))
