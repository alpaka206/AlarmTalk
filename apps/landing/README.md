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

## 배포 (Vercel)

프로덕션은 Vercel에 배포되어 있습니다.

- **리디렉션은 `vercel.json`이 담당합니다.** `output: "export"`에서는 `next.config.ts`의 `redirects()`가 동작하지 않고, `public/_redirects`(Netlify/Cloudflare Pages 형식)는 Vercel이 무시합니다. `_redirects`는 다른 정적 호스트로 옮길 때를 대비한 백업입니다.
- 로케일 프리픽스 없는 경로(`/privacy`, `/terms`, `/account-deletion`, `/company`, `/contact`)는 `/ko/...`로 308 리디렉션됩니다. 스토어 심사(Google Play 개인정보처리방침 URL 등)에 `https://alarm-talk.com/privacy` 같은 짧은 URL을 제출해도 동작해야 하기 때문입니다.
- **도메인 설정**: 코드의 canonical/sitemap/robots는 모두 `https://alarm-talk.com`(non-www, `lib/site.ts`의 `SITE_URL`)을 기준으로 합니다. Vercel 대시보드의 Domains 설정에서 반드시 `alarm-talk.com`을 primary로 두고 `www.alarm-talk.com`을 308로 apex에 리디렉션해야 합니다. 반대로 설정하면 canonical URL이 리디렉션을 가리키게 되어 Search Console에서 색인 문제가 발생합니다.

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
