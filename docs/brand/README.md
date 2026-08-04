# 브랜드 원본

여기 있는 두 장이 **원본**이고, 앱·랜딩의 아이콘/OG 이미지는 전부 여기서 파생한다.
로고를 바꾸면 이 파일을 갈아 끼우고 아래 명령을 다시 돌린다.

| 파일 | 크기 | 파생물 |
| --- | --- | --- |
| `app-icon-master.png` | 2048×2048 | 안드로이드 런처 아이콘 15종, 랜딩 `app/icon.png`·`public/brand-icon.png` |
| `og-master.png` | 3104×1312 | 랜딩 `app/[locale]/opengraph-image.png` (1200×630) |

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

# 적응형 foreground(108dp 기준). 원본이 full-bleed 라 캔버스를 꽉 채운다 —
# 마스크가 모양을 잘라 주므로 안전 영역 밖이 잘려도 배경색이라 문제 없다.
for d, px in {'mdpi':108,'hdpi':162,'xhdpi':216,'xxhdpi':324,'xxxhdpi':432}.items():
    SQ.resize((px, px), Image.LANCZOS).save(f'{RES}/mipmap-{d}/ic_launcher_foreground.png')

SQ.resize((512, 512), Image.LANCZOS).save('apps/landing/app/icon.png')
SQ.resize((256, 256), Image.LANCZOS).save('apps/landing/public/brand-icon.png')

# OG 1200x630 — 원본(2.37:1)을 cover 로 맞추고 가운데를 자른다.
w = Image.open('docs/brand/og-master.png').convert('RGB')
tw, th = 1200, 630
scale = max(tw / w.width, th / w.height)
nw, nh = round(w.width * scale), round(w.height * scale)
img = w.resize((nw, nh), Image.LANCZOS)
left, top = (nw - tw) // 2, (nh - th) // 2
img.crop((left, top, left + tw, top + th)).save('apps/landing/app/[locale]/opengraph-image.png', optimize=True)
PY
```

**적응형 아이콘 배경색**은 `values/colors.xml` 의 `ic_launcher_background` 다. 로고 파랑
(`#0448E6`)과 맞춰 둔다 — 기기가 아이콘을 확대·시차 이동시킬 때 가장자리가 드러난다.

`.webp` 로 바꾸지 않은 이유: 런처 아이콘은 몇 KB 수준이라 이득이 없고, PNG 가 모든
안드로이드 버전과 Next.js 정적 아이콘 규약에서 그대로 통한다.
