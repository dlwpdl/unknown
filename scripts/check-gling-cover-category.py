"""Check the shared cover palette and new/edited HyperFrames covers; no network or writes."""
import colorsys
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def check_palette(palette):
    if not palette or any(not re.fullmatch(r'#[0-9A-F]{6}', c) for c in palette.values()):
        raise ValueError('Each category needs one explicit canonical RGB color')
    if len(set(palette.values())) != len(palette):
        raise ValueError('Different categories cannot share a line color')
    if [name for name, color in palette.items() if color == '#CBB9FF'] != ['페스티벌']:
        raise ValueError('Purple is exclusively for 페스티벌')
    if {'이벤트', '카페'} <= palette.keys():
        hues = [colorsys.rgb_to_hsv(*(int(palette[name][i:i+2], 16) / 255 for i in (1, 3, 5)))[0]
                for name in ('이벤트', '카페')]
        distance = abs(hues[0] - hues[1])
        if min(distance, 1 - distance) < 1 / 3:
            raise ValueError('Event and cafe need contrasting cool/warm line hues')


def check_cover(source, palette):
    # Static covers use one category variable or one literal category-rule color.
    # Nested/dynamic covers still require an HTML/CSS parser.
    labels = re.findall(r'<[^>]+class=["\'][^"\']*\bcategory\b[^"\']*["\'][^>]*>(.*?)</', source, re.S)
    colors = re.findall(r'--category-point\s*:\s*(#[0-9a-fA-F]{6})', source)
    colors += re.findall(r'\.category:{1,2}before\s*\{[^{}]*\bbackground(?:-color)?\s*:\s*(#[0-9a-fA-F]{6})\s*(?=;|})', source)
    if len(labels) != 1 or len(colors) != 1:
        raise ValueError('Cover needs exactly one category label and one explicit line color')
    label = html.unescape(labels[0]).strip()
    if label not in palette or colors[0].upper() != palette[label]:
        raise ValueError('Unknown category or line color does not match the shared palette: ' + label)
    return label


def self_check():
    palette = {'페스티벌': '#CBB9FF', '전시': '#E7A5C0'}
    check_palette(palette)
    check_palette({**palette, '이벤트': '#5F7CF3', '카페': '#D7BD92'})
    assert check_cover('<div style="--category-point:#E7A5C0"><div class="category">전시</div></div>', palette) == '전시'
    literal = '<style>.category:before{content:"";width:119px;height:18px;background:#e7a5c0}</style><p class="category">전시</p>'
    assert check_cover(literal, palette) == '전시'
    invalid = [lambda: check_palette({'페스티벌': '#CBB9FF', '전시': '#CBB9FF'}),
               lambda: check_palette({**palette, '이벤트': '#E9C15E', '카페': '#D7BD92'}),
               lambda: check_cover('<div style="--category-point:#CBB9FF"><div class="category">전시</div></div>', palette),
               lambda: check_cover('<div style="--category-point:#CBB9FF"><div class="category">행사</div></div>', palette)]
    invalid += [lambda: check_cover(literal.replace('#e7a5c0', '#cbb9ff'), palette),
                lambda: check_cover(literal.replace('전시', '행사'), palette),
                lambda: check_cover(literal.replace('</style>', '.category:before{background:#cbb9ff}</style>'), palette),
                lambda: check_cover(literal.replace('<style>', '<style>:root{--category-point:#E7A5C0}'), palette)]
    for operation in invalid:
        try:
            operation()
        except ValueError:
            continue
        raise AssertionError('Invalid category/color must fail closed')


if __name__ == '__main__':
    self_check()
    palette = json.loads((ROOT / 'marketing/festival-template.json').read_text())['current_production']['category_point_colors']
    check_palette(palette)
    for name in sys.argv[1:]:
        path = Path(name)
        print('PASS:', check_cover(path.read_text(), palette), path)
    print('PASS: distinct category colors; purple only for 페스티벌')
