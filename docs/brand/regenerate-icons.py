#!/usr/bin/env python3
"""브랜드 원본(`docs/brand/*.png`)에서 앱·랜딩 아이콘과 OG 이미지를 다시 만든다.

실행(저장소 루트에서):
    python3 docs/brand/regenerate-icons.py                  # 저장소 파생물 전부
    python3 docs/brand/regenerate-icons.py --play out.png   # + Play 스토어 등록정보 아이콘(512)

iOS 앱 아이콘(AppIcon 3종)은 **만들지 않는다** — 바꾸면 앱 릴리스가 따라와야 해서 이 스크립트가
조용히 건드리면 안 된다. 무엇에서 파생했는지는 `docs/brand/README.md` 에 적어 두었다.
필요 패키지: Pillow.
"""
import argparse
import pathlib

from PIL import Image, ImageChops, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parents[2]
BRAND = ROOT / 'docs/brand'
RES = ROOT / 'apps/android-native/app/src/main/res'
LANDING = ROOT / 'apps/landing'

LEGACY = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
ADAPTIVE = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}


def ramp(channel_min, lo, hi):
    """채널 최소값 = '흰 정도'. lo 이하는 투명, hi 이상은 불투명, 사이는 선형."""
    return channel_min.point(lambda v: 0 if v <= lo else (255 if v >= hi else int((v - lo) * 255 / (hi - lo))))


def centered(src, px):
    """src 의 긴 변을 캔버스의 54% 로 맞춰 가운데에 놓는다(적응형 108dp 중 54dp)."""
    canvas = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    t = round(px * 54 / 108)
    w, h = src.size
    sc = t / max(w, h)
    nw, nh = round(w * sc), round(h * sc)
    c = src.resize((nw, nh), Image.LANCZOS)
    canvas.paste(c, ((px - nw) // 2, (px - nh) // 2), c)
    return canvas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--play', type=pathlib.Path, help='Play 등록정보 아이콘(512×512 PNG)을 쓸 경로. 저장소에 넣지 않는다.')
    args = ap.parse_args()

    sq = Image.open(BRAND / 'app-icon-master.png').convert('RGBA')

    # 1) 풀블리드 정사각 아이콘 — 원본을 그대로 줄인다.
    for d, px in LEGACY.items():
        img = sq.resize((px, px), Image.LANCZOS)
        img.save(RES / f'mipmap-{d}/ic_launcher.png')
        mask = Image.new('L', (px * 4, px * 4), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, px * 4 - 1, px * 4 - 1), fill=255)
        rnd = img.copy()
        rnd.putalpha(mask.resize((px, px), Image.LANCZOS))
        rnd.save(RES / f'mipmap-{d}/ic_launcher_round.png')
    # 알림 큰 아이콘(SocialNotificationFactory.setLargeIcon) — 정사각 그대로.
    sq.resize((240, 240), Image.LANCZOS).save(RES / 'drawable-nodpi/ic_brand_logo.png')
    sq.resize((512, 512), Image.LANCZOS).save(LANDING / 'app/icon.png')
    sq.resize((256, 256), Image.LANCZOS).save(LANDING / 'public/brand-icon.png')
    if args.play:
        # Play 규격: 512×512, 32비트 PNG, 1MB 이하. 모서리·그림자는 Play 가 씌운다.
        sq.resize((512, 512), Image.LANCZOS).save(args.play, optimize=True)

    # 2) 적응형 전경 — **원본을 그대로 넣으면 안 된다.** 108dp 중 가운데 72dp 만 보이는
    #    규칙에 걸려 시계 본체가 잘린다. 배경(#0560E9)은 background 레이어가 맡고, 여기에는
    #    시계만 넣는다. 시계 안 파형은 배경이 비쳐 보이던 것이라 투명해지고, background
    #    레이어의 같은 파랑이 그대로 채운다.
    r, g, b, _ = sq.split()
    mn = ImageChops.darker(ImageChops.darker(r, g), b)
    a = ramp(mn, 70, 150)
    clock = sq.copy()
    clock.putalpha(a)
    clock = clock.crop(a.point(lambda v: 255 if v > 8 else 0).getbbox())
    for d, px in ADAPTIVE.items():
        centered(clock, px).save(RES / f'mipmap-{d}/ic_launcher_foreground.png')

    # 3) 테마 아이콘(Android 13+) — 시스템이 알파만 보고 단색으로 칠한다. 컬러용보다 단단한
    #    임계값으로 잘라야 그림자가 안 번진다.
    am = ramp(mn, 120, 175)
    sil = Image.new('RGBA', sq.size, (0, 0, 0, 0))
    sil.putalpha(am)
    sil = sil.crop(am.point(lambda v: 255 if v > 8 else 0).getbbox())
    for d, px in ADAPTIVE.items():
        centered(sil, px).save(RES / f'mipmap-{d}/ic_launcher_monochrome.png')

    # 4) OG 1200×630 — 원본(2.37:1)을 cover 로 맞추고 가운데를 자른다.
    w = Image.open(BRAND / 'og-master.png').convert('RGB')
    tw, th = 1200, 630
    scale = max(tw / w.width, th / w.height)
    nw, nh = round(w.width * scale), round(w.height * scale)
    img = w.resize((nw, nh), Image.LANCZOS)
    left, top = (nw - tw) // 2, (nh - th) // 2
    img.crop((left, top, left + tw, top + th)).save(LANDING / 'app/opengraph-image.png', optimize=True)


if __name__ == '__main__':
    main()
