# 브랜드 원본

여기 있는 두 장이 **원본**이고, 앱·랜딩의 아이콘/OG 이미지는 전부 여기서 파생한다.
로고를 바꾸면 이 파일을 갈아 끼우고 아래 명령을 다시 돌린다.

| 파일 | 크기 | 파생물 |
| --- | --- | --- |
| `app-icon-master.png` | 2048×2048 | 안드로이드 런처 아이콘 15종, 랜딩 `app/icon.png`·`public/brand-icon.png` |
| `og-master.png` | 3104×1312 | 랜딩 `app/opengraph-image.png` (1200×630) |

## 다시 만들기

```bash
python - <<'PY'
from PIL import Image, ImageDraw

SQ = Image.open('docs/brand/app-icon-master.png').convert('RGBA')
RES = 'apps/android-native/app/src/main/res'

# 레거시 런처(48dp 기준) + 원형
for d, px in {'mdpi':48,'hdpi':72,'xhdpi':96,'xxhdpi':144,'xxxhdpi':192}.items():
    img = SQ.resize((px, px), Image.LANCZOS)
    img.save(f'{RES}/mipmap-{d}/ic_launcher.png')
    mask = Image.new('L', (px*4, px*4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, px*4-1, px*4-1), fill=255)
    rnd = img.copy(); rnd.putalpha(mask.resize((px, px), Image.LANCZOS))
    rnd.save(f'{RES}/mipmap-{d}/ic_launcher_round.png')

# 적응형 foreground — **원본을 그대로 넣으면 안 된다.**
# 원본은 이미 완성된 풀블리드 아이콘(파란 배경 + 시계가 76%)이라 그대로 넣으면
# 108dp 중 가운데 72dp 만 보이는 규칙에 걸려 시계 본체가 통째로 잘리고 파형만 남는다.
# 배경(파랑)은 background 레이어가 맡고, foreground 에는 **시계만** 넣는다.
# 파란 배경에서 시계를 뽑는다: 배경은 R 이 낮고 흰 시계는 R·G·B 가 모두 높다 →
# 채널 최소값이 곧 '흰 정도'. 시계 안 파형은 배경이 비쳐 보이던 것이라 투명해지고,
# background 레이어의 같은 파랑이 그대로 채운다.
from PIL import ImageChops
r, g, b = SQ.convert('RGB').split()
mn = ImageChops.darker(ImageChops.darker(r, g), b)
a = mn.point(lambda v: 0 if v <= 70 else (255 if v >= 150 else int((v - 70) * 255 / 80)))
clock = SQ.convert('RGBA'); clock.putalpha(a)
clock = clock.crop(a.point(lambda v: 255 if v > 8 else 0).getbbox())

# 시계 bbox 를 108dp 캔버스의 54% 로. 근거: 마스크 안에서 실제 보이는 건 가운데 72dp,
# 원형 마스크 반지름은 36 이고, 종 끝이 bbox 반대각선의 92% 지점(중심에서 0.65*S)이라
# S=54 면 35.1 < 36 으로 **어떤 마스크에서도 안 잘린다**. 58 은 원형에서 종이 가장자리에
# 닿고, 50 은 눈에 띄게 작다.
for d, px in {'mdpi':108,'hdpi':162,'xhdpi':216,'xxhdpi':324,'xxxhdpi':432}.items():
    canvas = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    t = round(px * 54 / 108)
    w, h = clock.size
    sc = t / max(w, h)
    nw, nh = round(w * sc), round(h * sc)
    c = clock.resize((nw, nh), Image.LANCZOS)
    canvas.paste(c, ((px - nw) // 2, (px - nh) // 2), c)
    canvas.save(f'{RES}/mipmap-{d}/ic_launcher_foreground.png')

SQ.resize((512, 512), Image.LANCZOS).save('apps/landing/app/icon.png')
SQ.resize((256, 256), Image.LANCZOS).save('apps/landing/public/brand-icon.png')

# OG 1200x630 — 원본(2.37:1)을 cover 로 맞추고 가운데를 자른다.
w = Image.open('docs/brand/og-master.png').convert('RGB')
tw, th = 1200, 630
scale = max(tw / w.width, th / w.height)
nw, nh = round(w.width * scale), round(w.height * scale)
img = w.resize((nw, nh), Image.LANCZOS)
left, top = (nw - tw) // 2, (nh - th) // 2
img.crop((left, top, left + tw, top + th)).save('apps/landing/app/opengraph-image.png', optimize=True)
PY
```

OG 이미지를 `[locale]/` 밖에 두는 이유: 이미지는 로케일별로 다르지 않고, `[locale]/`
아래에 두면 `output: export` 가 그 라우트에도 `generateStaticParams()` 를 요구해
빌드가 깨진다(동적 생성 라우트를 정적 파일로 바꾼 것도 같은 이유).

**적응형 아이콘 배경색**은 `values/colors.xml` 의 `ic_launcher_background` = `#0560E9` 다.
원본 배경(그라데이션)의 평균색이라 시계 안 파형 색과 이어진다 — 여기가 어긋나면 파형만
다른 파랑으로 떠 보인다. 기기가 아이콘을 확대·시차 이동시킬 때도 이 색이 가장자리에 드러난다.

레거시 `ic_launcher.png`·`ic_launcher_round.png` 는 풀블리드 원본 그대로 둔다 — minSdk 26
이라 모든 기기가 적응형을 쓰고, 이 PNG 들은 마스크·확대가 적용되지 않는 폴백이다.

`.webp` 로 바꾸지 않은 이유: 런처 아이콘은 몇 KB 수준이라 이득이 없고, PNG 가 모든
안드로이드 버전과 Next.js 정적 아이콘 규약에서 그대로 통한다.
