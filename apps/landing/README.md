# AlarmTalk Landing

AlarmTalk(알람톡) 마케팅 랜딩 페이지. Next.js 16 (App Router) + TypeScript + Tailwind v4 정적 빌드, `next-intl` 다국어(ko/en/ja).

## 개발

```bash
cd apps/landing
npm install
npm run dev          # http://localhost:3100
npm run typecheck    # tsc --noEmit
```

## 빌드

```bash
npm run build        # next build(정적 export → out/) + scripts/postbuild-lang.mjs
```

`next.config.ts`의 `output: "export"`로 완전 정적 사이트가 생성됩니다(이미지 비최적화, `trailingSlash`). Cloudflare Pages, Vercel, S3 등 어디든 배포 가능합니다. 모노레포에서 Turbopack이 워크스페이스 루트를 추론하지 못하므로 `outputFileTracingRoot`/`turbopack.root`를 명시합니다.

`postbuild-lang.mjs` 는 export 된 정적 HTML 의 `<html lang>` 을 로케일에 맞게 다시 쓴다 — `globals.css` 의 `html:lang(ja) body { word-break: normal }` 이 그 값에 걸려 있다.

## 배포 (Vercel)

프로덕션은 Vercel에 배포되어 있습니다.

- **리디렉션은 `vercel.json`이 담당합니다.** `output: "export"`에서는 `next.config.ts`의 `redirects()`가 동작하지 않고, `public/_redirects`(Netlify/Cloudflare Pages 형식)는 Vercel이 무시합니다. `_redirects`는 다른 정적 호스트로 옮길 때를 대비한 백업입니다.
- **접두사 없는 경로가 정식 주소다.** 기본 로케일 ko 는 접두사를 쓰지 않으므로(`localePrefix: "as-needed"`), `vercel.json`은 `/privacy`, `/terms`, `/account-deletion`, `/company`, `/contact`, `/cheer`(그리고 `/ko` 자체)를 빌드 산출물인 `/ko/...`로 **rewrite** 하고, 반대로 `/ko/<page>`로 들어온 요청은 접두사 없는 정식 주소로 **308 리디렉트**합니다. 스토어 심사(Google Play 개인정보처리방침 URL 등)에 `https://alarm-talk.com/privacy` 같은 짧은 URL을 제출해도 동작해야 하기 때문입니다.
- **도메인 설정**: 코드의 canonical/sitemap/robots는 모두 `https://alarm-talk.com`(non-www, `lib/site.ts`의 `SITE_URL`)을 기준으로 합니다. Vercel 대시보드의 Domains 설정에서 반드시 `alarm-talk.com`을 primary로 두고 `www.alarm-talk.com`을 308로 apex에 리디렉션해야 합니다. 반대로 설정하면 canonical URL이 리디렉션을 가리키게 되어 Search Console에서 색인 문제가 발생합니다.

## 다국어 (i18n)

`next-intl` 기반. 기본 로케일 `ko`는 접두사 없이(`/`, `/company/` …), `en`·`ja`만 `/en`·`/ja` 접두사를 씁니다(`localePrefix: "as-needed"`). 정적 export 라 미들웨어가 없으므로 공개 URL → 산출물(`/ko/*`) 매핑은 `vercel.json`이 담당합니다.

- `i18n/routing.ts` — 지원 로케일(`ko`, `en`, `ja`)과 기본 로케일 정의
- `i18n/request.ts` — 요청 로케일 해석 + 해당 `messages/<locale>.json` 로드
- `i18n/navigation.ts` — 로케일 인식 `Link`/`usePathname` 내비게이션 헬퍼
- `messages/{ko,en,ja}.json` — 네임스페이스별 카피(meta/hero/pricing/faq 등)

## 디자인 토큰

흰 바닥의 라이트 단일 테마입니다(`app/globals.css`의 `@theme` 블록). 깊이는 그림자가 아니라 여백과 얕은 배경 단차로 만듭니다. 어두운 블록(`--color-ink*`)과 반경 토큰만 앱에서 그대로 가져옵니다 — 색은 `AlarmTalkTheme.kt`의 다크 스킴, 반경은 `WakerDesign.kt`의 `Waker*Shape`가 유일 출처이고 여기서 새 값을 짓지 않습니다. 폰트는 Pretendard Variable.

| 역할 | 변수 | 값 |
| --- | --- | --- |
| 배경 | `--color-bg` | `#ffffff` |
| 교대 섹션 | `--color-bg-alt` | `#f9fafb` |
| 카드 | `--color-surface` | `#ffffff` |
| 카드 raised | `--color-raised` | `#f2f4f6` |
| 보더 | `--color-line` | `#e5e8eb` |
| 제목 | `--color-text` | `#191f28` |
| 본문 | `--color-text-body` | `#4e5968` |
| 보조 텍스트 | `--color-text-muted` | `#6b7684` |
| 액센트 | `--color-accent` | `#175fb0` |
| 어두운 바닥용 액센트 | `--color-accent-on-dark` | `#a6d2ff` |
| 어두운 블록(앱 스크린샷 바닥) | `--color-ink` | `#090d16` |
| 서브 액센트 | `--color-mint` | `#5e9b7d` |

## 구조

```
app/
  layout.tsx              루트 shell (정적 export 호환을 위한 최소 래퍼)
  page.tsx                루트 `/` = 한국어 홈 본문(리다이렉트 껍데기를 두지 말 것)
  manifest.ts             /manifest.webmanifest
  globals.css             Tailwind v4 + 디자인 토큰(@theme)
  robots.ts               /robots.txt
  sitemap.ts              /sitemap.xml (로케일별 URL)
  icon.png                파비콘(512, docs/brand/app-icon-master.png 에서 생성)
  opengraph-image.png     OG 이미지(1200x630). 로케일별로 다르지 않아 로케일 밖에 둔다 —
                          [locale]/ 아래의 동적 생성 라우트는 output: export 와 맞지
                          않아(generateStaticParams 요구) 정적 파일로 바꿨다.
  opengraph-image.alt.txt OG 이미지 대체 텍스트
  [locale]/
    layout.tsx            메타데이터·viewport·폰트·html lang
    page.tsx              홈: 섹션 조립 + JSON-LD(SoftwareApplication, FAQPage)
    privacy/page.tsx      개인정보처리방침 (docs/legal 마크다운 렌더)
    terms/page.tsx        이용약관 (docs/legal 마크다운 렌더)
    company/page.tsx      회사 소개
    contact/page.tsx      문의
    account-deletion/page.tsx  계정 삭제 안내(스토어 정책 요구)
    cheer/page.tsx        응원 페이지
components/
  site-header.tsx         상단 헤더 + 모바일 메뉴 + 로케일 전환
  mobile-menu.tsx         모바일 내비게이션
  locale-switcher.tsx     ko/en/ja 전환
  html-lang-sync.tsx      클라이언트에서 <html lang> 동기화
  brand-mark.tsx          로고 SVG
  phone-preview.tsx       Hero 폰 목업 (앱 LandingScreen 톤 재현)
  home-content.tsx        홈 섹션 조립
  store-badges.tsx        스토어 배지 2종(Google Play + App Store, APP_STORE_LIVE 스위치)
  voice-preview.tsx       목소리 미리듣기
  ui-crop.tsx             앱 스크린샷 크롭
  ui-crop-stack.tsx       크롭 스택 레이아웃
  cheer/                  응원 페이지 스튜디오·재생·목소리 목록
  legal-markdown.tsx      법무 마크다운 → HTML 렌더러
  motion/                 reveal·reveal-group·scroll-drift·cycling-word 와 reduced-motion 대응
  sections/
    hero.tsx              히어로
    whose-voice.tsx       누구 목소리로 깨우고 싶나요
    feature-section.tsx   기능 섹션 공통 레이아웃(좌우 반전 지원)
    product-scroll.tsx    제품 화면 소개
    scenarios.tsx         사용 시나리오
    pricing.tsx           요금제
    declare.tsx           제품 선언
    faq.tsx               자주 묻는 질문
    final-cta.tsx         마지막 스토어 CTA
    site-footer.tsx       푸터
i18n/                     next-intl 라우팅/요청/내비게이션 설정
lib/
  site.ts                 사이트 상수(SITE_URL, SITE_NAME, 스토어 링크, 조직 정보)
  legal-docs.ts           docs/legal 의 정책 마크다운 로더
messages/                 ko/en/ja 카피
```

출시 URL·스토어 링크·법무 문구의 운영 체크는 루트 문서와 `docs/legal/`에서 관리한다.
