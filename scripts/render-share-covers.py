"""Render the 1200x630 link-preview covers in public/share-covers/.

Run locally (python3 scripts/render-share-covers.py); the PNGs are committed, CI never runs this.
Korean text uses Pretendard from ~/Library/Fonts (not in the repo); any Korean-capable font path works via GLING_COVER_FONT_DIR.
"""
import os
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'share-covers')
FONTS = os.environ.get('GLING_COVER_FONT_DIR', os.path.expanduser('~/Library/Fonts'))
W, H = 1200, 630
NIGHT, MILK, SOFT, IRIS, SIGNAL = '#0B0B12', '#F6F3F0', '#B7B4C3', '#CBB9FF', '#F4CA78'

# name: (eyebrow, headline lines, sub, right-side art or None)
COVERS = {
    'home': ('캐나다 한인 커뮤니티', ['동네 이야기와 모임,', '글링에서 만나요'], '밴쿠버 · 토론토 · 몬트리올', None),
    'post': ('글링 이야기', ['우리 동네 한인들이', '나누는 이야기'], '밴쿠버 · 토론토 · 몬트리올', None),
    'vancouver': ('VANCOUVER', ['밴쿠버'], '한인 동네 이야기와 모임', None),
    'toronto': ('TORONTO', ['토론토'], '한인 동네 이야기와 모임', None),
    'montreal': ('MONTRÉAL', ['몬트리올'], '한인 동네 이야기와 모임', None),
    'business': ('글링 비즈니스', ['한인 손님에게', '우리 가게를 알리세요'], '밴쿠버 · 토론토 · 몬트리올 한인 커뮤니티', None),
    'meetup': ('글링 모임', ['같이 할 사람,', '여기서 만나요'], '파티 · 운동 · 취미 · 여행', 'meetup-art'),
    'festival': ('글링 페스티벌', ['축제와 공연,', '같이 갈 사람 찾기'], '함께 가면 더 즐거우니까', 'festival-art'),
}


def font(weight, size):
    return ImageFont.truetype(os.path.join(FONTS, f'Pretendard-{weight}.otf'), size)


def glow(base, center, radius, color, alpha):
    layer = Image.new('RGBA', base.size, (0, 0, 0, 0))
    x, y = center
    ImageDraw.Draw(layer).ellipse((x - radius, y - radius, x + radius, y + radius), fill=(*Image.new('RGB', (1, 1), color).getpixel((0, 0)), alpha))
    base.alpha_composite(layer.filter(ImageFilter.GaussianBlur(radius * 0.55)))


def render(name, eyebrow, lines, sub, art):
    image = Image.new('RGBA', (W, H), NIGHT)
    glow(image, (1010, 120), 330, IRIS, 70)
    glow(image, (1120, 560), 200, SIGNAL, 26)
    if art:
        # The existing 3D meetup/festival objects sit on a flat night background; key that background out.
        source = Image.open(os.path.join(ROOT, 'assets', 'share-cover-art', f'{art}.png')).convert('RGB')
        source = source.crop((150, 150, 874, 874)).resize((470, 470), Image.LANCZOS)
        background = Image.new('RGB', source.size, source.getpixel((4, 4)))
        alpha = ImageChops.difference(source, background).convert('L').point(lambda v: min(255, v * 8))
        source.putalpha(alpha.filter(ImageFilter.GaussianBlur(0.8)))
        image.alpha_composite(source, (690, 80))
    wordmark = Image.open(os.path.join(ROOT, 'assets', 'brand', 'gling-night-wordmark.png')).convert('RGBA')
    wordmark = wordmark.resize((168, 70), Image.LANCZOS)
    image.alpha_composite(wordmark, (80, 64))
    draw = ImageDraw.Draw(image)
    draw.text((84, 214), eyebrow, font=font('SemiBold', 30), fill=IRIS)
    size = 132 if len(lines) == 1 else 76
    headline = font('Bold', size)
    y = 262
    for line in lines:
        draw.text((80, y), line, font=headline, fill=MILK)
        y += int(size * 1.22)
    draw.ellipse((84, y + 26, 98, y + 40), fill=SIGNAL)
    draw.text((112, y + 14), sub, font=font('Medium', 32), fill=SOFT)
    path = os.path.join(OUT, f'{name}.png')
    # Median-cut dithers the glows smoothly; one k-means pass restores the small signal-yellow dots it would grey out.
    image.convert('RGB').quantize(256, method=Image.Quantize.MEDIANCUT, kmeans=1).save(path, optimize=True)
    return path


if __name__ == '__main__':
    for name, spec in COVERS.items():
        path = render(name, *spec)
        print(path, os.path.getsize(path))
