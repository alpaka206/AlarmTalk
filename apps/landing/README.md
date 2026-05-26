# AlarmTalk Landing

AlarmTalk(알람톡) 마케팅 랜딩 페이지. Next.js 15 (App Router) + TypeScript + Tailwind v4 정적 빌드.

## 개발

```bash
cd apps/landing
npm install
npm run dev          # http://localhost:3100
```

## 빌드

```bash
npm run build        # 정적 사이트를 out/ 디렉토리로 export
```

`next.config.ts`의 `output: "export"`로 정적 사이트가 생성됩니다. Cloudflare Pages, Vercel, S3 등 어디든 배포 가능합니다.

## 디자인 토큰

`apps/android-native`의 `LandingScreen.kt`와 동기화된 다크 톤입니다 (`app/globals.css`의 `@theme` 블록). 앱과 랜딩의 첫 진입 톤을 일치시키기 위해 색·타이포·곡률을 같은 값으로 유지합니다.

| 역할 | 변수 | 값 |
| --- | --- | --- |
| 배경 | `--color-bg-base` | `#090A0F` |
| 카드 | `--color-bg-surface` | `#14161E` |
| 카드 raised | `--color-bg-raised` | `#191C25` |
| 보더 | `--color-line` | `#2D313D` |
| 메인 텍스트 | `--color-text` | `#F7F7FA` |
| 보조 텍스트 | `--color-text-muted` | `#A8AEBA` |
| 액센트 | `--color-accent` | `#A8D4FF` |
| 액센트 위 텍스트 | `--color-accent-fg` | `#08243C` |
| 서브 액센트 | `--color-mint` | `#C7E5D6` |

폰트는 Pretendard Variable.

## 구조

```
app/
  layout.tsx            메타데이터·viewport·html shell
  page.tsx              섹션 조립
  globals.css           Tailwind v4 + 디자인 토큰
  sitemap.ts            /sitemap.xml
  robots.ts             /robots.txt
  opengraph-image.tsx   OG 이미지 빌드 시 정적 생성
components/
  brand-mark.tsx        로고 SVG
  phone-preview.tsx     Hero 폰 목업 (앱 LandingScreen 톤 재현)
  site-header.tsx
  sections/
    hero.tsx
    pain-hook.tsx
    three-voices.tsx
    how-it-works.tsx
    showcase.tsx
    faq.tsx
    waitlist.tsx        mock 제출 (백엔드 미연동)
    site-footer.tsx
```

## TODO

- 대기자 폼을 Cloudflare Workers 엔드포인트와 연결
- 다국어(en/ja) 라우팅
- 실제 도메인 연결 후 OG·sitemap의 SITE_URL 갱신
- 정책 문구의 운영자/수탁사/시행일 정보를 출시 전 최종 확정
