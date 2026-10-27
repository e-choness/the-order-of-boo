# Builds marketing images (store covers, banners, social card, wallpapers, icons)
# from the rendered key art + transparent logo. Run after capture-screenshots.mjs title,living.
from PIL import Image, ImageDraw, ImageFilter
import math, pathlib
K = str(pathlib.Path(__file__).resolve().parent.parent)
art = Image.open(f'{K}/art/keyart-clean.jpg').convert('RGB')
fire = Image.open(f'{K}/art/fireplace-clean.jpg').convert('RGB')
logo = Image.open(f'{K}/logo/logo-transparent.png').convert('RGBA')
# drop the near-invisible haze the browser leaves around the text, then trim
logo.putalpha(logo.split()[3].point(lambda a: 0 if a < 24 else a))
logo = logo.crop(logo.getbbox())
NIGHT = (13, 9, 20)


def cover(img, w, h, focus=(0.5, 0.5)):
    r = max(w / img.width, h / img.height)
    im = img.resize((int(img.width * r) + 1, int(img.height * r) + 1), Image.LANCZOS)
    x = int((im.width - w) * focus[0]); y = int((im.height - h) * focus[1])
    return im.crop((x, y, x + w, y + h))


def vignette(im, strength=0.55, side='left'):
    w, h = im.size
    g = Image.new('L', (w, h), 0); d = ImageDraw.Draw(g)
    for x in range(w):
        t = x / w if side == 'left' else 1 - x / w
        d.line([(x, 0), (x, h)], fill=int(255 * strength * max(0, 1 - t * 1.6)))
    return Image.composite(Image.new('RGB', (w, h), NIGHT), im, g)


def place_logo(im, height_frac, pos=('left', 0.07), y_frac=0.5):
    w, h = im.size
    lh = int(h * height_frac); lw = int(logo.width * lh / logo.height)
    if lw > w * 0.9: lw = int(w * 0.9); lh = int(logo.height * lw / logo.width)
    lg = logo.resize((lw, lh), Image.LANCZOS)
    x = int(w * pos[1]) if pos[0] == 'left' else (w - lw) // 2
    y = int((h - lh) * y_frac)
    # soft candle-glow behind the letters, on a padded canvas so the blur isn't clipped into a box
    pad = max(8, lh // 6)
    mask = Image.new('L', (lw + pad * 2, lh + pad * 2), 0); mask.paste(lg.split()[3].point(lambda a: int(a * 0.45)), (pad, pad))
    glow = Image.new('RGBA', mask.size, (255, 120, 30, 0)); glow.putalpha(mask.filter(ImageFilter.GaussianBlur(max(3, lh // 18))))
    base = im.convert('RGBA'); base.alpha_composite(glow, (max(0, x - pad), max(0, y - pad)), (max(0, pad - x), max(0, pad - y))); base.alpha_composite(lg, (x, y))
    return base.convert('RGB')


out = {
    'art/itch-cover-630x500.png': place_logo(vignette(cover(art, 630, 500, (0.55, 0.5)), 0.7), 0.5, ('center', 0), 0.42),
    'art/github-social-1280x640.png': place_logo(vignette(cover(art, 1280, 640), 0.75), 0.62, ('left', 0.06), 0.5),
    'art/banner-1920x480.png': place_logo(vignette(cover(art, 1920, 480, (0.5, 0.55)), 0.8), 0.8, ('left', 0.06), 0.5),
    'art/capsule-460x215.png': place_logo(vignette(cover(art, 460, 215), 0.75), 0.82, ('left', 0.05), 0.5),
    'art/wallpaper-1920x1080.png': place_logo(vignette(art, 0.65), 0.42, ('left', 0.06), 0.22),
    'art/wallpaper-fireplace-1920x1080.png': place_logo(vignette(fire, 0.0), 0.3, ('center', 0), 0.06),
}
for k, v in out.items(): v.save(f'{K}/{k}', optimize=True)


def icon(sz):
    """A grinning jack-o'-lantern wearing a little bedsheet-ghost hood, on a violet night sky."""
    S = sz * 4  # supersample
    im = Image.new('RGB', (S, S), NIGHT); d = ImageDraw.Draw(im)
    for y in range(S):
        t = y / S
        d.line([(0, y), (S, y)], fill=(int(40 + 30 * t), int(18 + 10 * t), int(70 - 30 * t)))
    d.ellipse([S * 0.62, S * 0.06, S * 0.92, S * 0.36], fill=(255, 217, 160))  # moon
    # pumpkin
    cx, cy, rx, ry = S / 2, S * 0.62, S * 0.36, S * 0.28
    for i, (dx, sh) in enumerate([(-0.55, 0.82), (0.55, 0.82), (-0.25, 0.95), (0.25, 0.95), (0, 1.0)]):
        col = (232, 99, 28) if i == 4 else (210, 85, 22)
        d.ellipse([cx + dx * rx - rx * 0.55, cy - ry * sh, cx + dx * rx + rx * 0.55, cy + ry * sh], fill=col)
    d.rectangle([cx - S * 0.025, cy - ry - S * 0.08, cx + S * 0.025, cy - ry + S * 0.02], fill=(90, 74, 34))
    glow = (255, 214, 110)
    for sx in (-1, 1):
        ex = cx + sx * rx * 0.38
        d.polygon([(ex - S * 0.06, cy - S * 0.02), (ex + S * 0.06, cy - S * 0.02), (ex, cy - S * 0.12)], fill=glow)
    pts = [(cx - rx * 0.6, cy + S * 0.06)]
    for k in range(7):
        pts.append((cx - rx * 0.6 + (k + 0.5) * rx * 1.2 / 7, cy + S * (0.1 if k % 2 == 0 else 0.06)))
    pts += [(cx + rx * 0.6, cy + S * 0.06), (cx + rx * 0.4, cy + S * 0.16), (cx - rx * 0.4, cy + S * 0.16)]
    d.polygon(pts, fill=glow)
    # tiny ghost peeking over the top
    gx, gy = S * 0.3, S * 0.3
    d.ellipse([gx - S * 0.11, gy - S * 0.12, gx + S * 0.11, gy + S * 0.1], fill=(246, 242, 238))
    d.rectangle([gx - S * 0.11, gy, gx + S * 0.11, gy + S * 0.14], fill=(246, 242, 238))
    for k in range(3):
        d.ellipse([gx - S * 0.11 + k * S * 0.074, gy + S * 0.1, gx - S * 0.11 + (k + 1) * S * 0.074, gy + S * 0.17], fill=(246, 242, 238))
    for sx in (-1, 1): d.ellipse([gx + sx * S * 0.04 - S * 0.018, gy - S * 0.04, gx + sx * S * 0.04 + S * 0.018, gy + S * 0.0], fill=(20, 16, 24))
    return im.resize((sz, sz), Image.LANCZOS)


for s in (512, 256, 128, 64):
    icon(s).save(f'{K}/logo/icon-{s}.png', optimize=True)
bg = Image.new('RGBA', (logo.width + 120, logo.height + 100), NIGHT + (255,)); bg.alpha_composite(logo, (60, 50)); bg.convert('RGB').save(f'{K}/logo/logo-on-night.png')
logo.save(f'{K}/logo/logo-transparent.png')
# game-page icons and the social preview shipped with the build
pub = pathlib.Path(K).parent / 'public'
icon(64).save(pub / 'favicon.png'); icon(256).save(pub / 'icon-256.png')
out['art/github-social-1280x640.png'].save(pub / 'og-image.png', optimize=True)
print('composed', list(out))
