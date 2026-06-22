# 랜딩 재디자인 "Quiet Frequency" — 크래프트된 프롬프트 모음

스크롤 구동 모션 라이브러리(animmasterlib / reactbits / Aceternity / Magic UI / Motion Primitives / Framer Motion)를 참고해, 기존 "Claude paper" 브랜드에 맞춰 재사용한 프롬프트 9종. 실제 구현(`apps/landing`)을 이 프롬프트들이 구동했다. 새 컴포넌트를 추가하거나 다른 프로젝트에 이식할 때 그대로 재사용 가능.

공통 제약(모든 프롬프트에 적용): Next.js 16 App Router · React 19 · Tailwind v4 · next-intl(ko/en/ja) · 정적 export(`output:'export'`, 클라이언트 모션만) · SEO/JSON-LD/hreflang 무손상 · `prefers-reduced-motion` 폴백 필수 · 새 i18n 키 금지(기존 키 재사용) · transform/opacity/clip-path/filter만 애니메이트 · 브랜드 액센트는 `var(--color-accent)`(블루 #175FB0, 네이티브 앱과 통일) 단일 채도색.

> 참고: 브랜드 색은 **블루(#175FB0)** 로 통일됨. 아래 프롬프트 본문의 코랄(#d97757/#ec8c6c) 하드코딩 언급은 작성 당시 값으로, 현재 구현은 토큰 `var(--color-accent)`(=블루)을 따른다.

---

## 1. 모션 프리미티브 라이브러리
**참고:** Motion Primitives (motion-primitives.com) + Framer Motion (`motion/react`)

> `apps/landing/components/motion/` 폴더에 재사용 모션 프리미티브 세트를 만들어줘. Motion Primitives의 in-view reveal/stagger 패턴을 참고하되, 의존성은 `motion/react`(Framer Motion)만 쓴다. 파일: `reveal.tsx`(`<Reveal>`), `reveal-group.tsx`(`<RevealGroup>`+`<RevealItem>`), `count-up.tsx`(`<CountUp>`), `magnetic.tsx`(`<Magnetic>`), `use-prefers-reduced-motion.ts`. 모두 `'use client'`. `<Reveal>` props `{ as?, variant?: 'rise'|'focus'|'wipe', delay?, trigger?: 'view'|'mount' }`: whileInView + viewport `{ once:true, margin:'0px 0px -12% 0px' }`. rise={opacity:[0,1],y:[16,0]} 0.6s; focus={opacity:[0,1],y:[20,0],filter:['blur(1.2px)','blur(0px)'],scale:[1.005,1]} 0.7s; wipe={opacity:[0,1],clipPath:['inset(0 100% 0 0)','inset(0 0 0 0)']} 0.8s origin-left. 모든 ease는 `var(--ease-paper)`=cubic-bezier(0.16,1,0.3,1)에 대응하는 `[0.16,1,0.3,1]`. 제약: (1) LCP 보호 — 정적 HTML은 콘텐츠가 DOM에 존재(SEO), 위쪽은 `trigger='mount'`로 마운트 시 진입. (2) reduced-motion — `useReducedMotion()`을 **mounted 게이트**로 감싸 SSR/첫 클라이언트 렌더는 false(서버와 일치), 마운트 후에만 실제 값 적용. reduced면 자식을 즉시 최종 상태로. (3) transform/opacity/clip-path/filter만 → CLS 0. (4) 색은 토큰만. `<Magnetic>`: 포인터 추적 ≤6px + spring(150,15) 복귀; `matchMedia('(pointer: coarse)')` 또는 reduced-motion이면 정적 버튼으로 no-op. 모든 hook은 early-return 전에 호출. `<RevealItem>`은 `<RevealGroup>`의 정적 프로퍼티가 아니라 **독립 named export**로 — compound 프로퍼티는 RSC 서버→클라이언트 경계에서 stripping되어 서버 컴포넌트에서 undefined가 된다. trilingual i18n 유지(텍스트는 서버 부모가 렌더, 얇은 client leaf로 통과).

## 2. LivingWaveform — 시그니처 호흡/재생 파형
**참고:** Aceternity UI(오디오 파형 모션) → Framer Motion 재구현

> `apps/landing/components/motion/living-waveform.tsx`(`'use client'`)를 만들어줘. Aceternity류 '살아있는 오디오 파형' 느낌을 참고하되 canvas 금지 — 순수 div bar + Framer(정적 export·저사양 안드로이드 페인트 비용 최소화). props `{ bars: number[], mode:'breathe'|'playOnce', color?, restColor?, amplitude?=0.12, playedTo?, barWidth?, gapPx?, minPx?, spanPx?, align?, ... }`. breathe: 각 bar가 scaleY를 무한 사인 루프로 ±amplitude 진동, phase=i*(2π/n), period 4s, 좌→우 traveling wave. playOnce: 마운트/in-view 시 좌→우로 솟고(stagger 12ms/bar), playedTo 인덱스까지 active 컬러가 쓸고 지나간 뒤 정지. 적용: (1) phone-preview의 40-bar → breathe, (2) feature-visuals VoiceVisual 48-bar(played=i<32) → playOnce, playedTo=32, active=`var(--color-accent)`/rest=`var(--color-line)`. 기본 color는 `var(--color-accent)`. reduced-motion이면 루프/스윕 끄고 정적 bar 높이 그대로(빈 화면 금지 — 이게 폴백). playOnce bar엔 `data-reveal` 부여(noscript/reduced CSS가 풀어줌). aria-hidden.

## 3. Hero 진입 + Scroll 힌트
**참고:** Magic UI(스태거 히어로) + Framer Motion

> `apps/landing/components/sections/hero.tsx`를 서버 컴포넌트로 두되 `<RevealGroup trigger="mount">`/`<RevealItem>`로 Magic UI풍 스태거 진입 적용(라이브러리 추가 없이). 기존 2-컬럼 DOM·next-intl 키 변경 금지. 순서(70ms 스태거): badge → h1(text-accent 2번째 줄 포함, **기존 `<br/>`에서만** 줄바꿈 — 음절 분해 금지, KO/JA keep-all) → description → CTA row → StoreBadges → scrollHint. PhonePreview는 `<Reveal variant="focus" trigger="mount" delay={0.42}>` + 기존 glow로 '전원 켜짐'. primary CTA는 `<Magnetic>`. ctaNote 아래 'Scroll' 힌트: 기존 `t('scrollHint')`(ko/en/ja 모두 'Scroll') + `.animate-bob`(CSS). 위쪽이라 `trigger='mount'`로 마운트 즉시 진입(IO 대기 X). trilingual i18n 유지.

## 4. Header 스크롤 상태 + 코랄 voice-spine
**참고:** reactbits.dev(스크롤 진행/sticky 헤더) + Framer Motion `useScroll`

> `apps/landing/components/site-header.tsx`에 reactbits류 스크롤 진행 헤더를 입혀줘(`'use client'`, JSON-LD·hreflang·정적 export 무손상). `useScrollProgress`(단일 `useScroll` 구독). scrollY>24px부터 헤더 배경 surface/85% + backdrop-blur를 '스크롤 연동'으로(클래스 토글 아님). 하단에 코랄 voice-spine: 1px 코랄 바, scaleX=페이지 진행도(0→1), origin-left, aria-hidden — 페이지 관통 연결선이며 Waitlist에서 파형으로 종결. 헤더 `sticky top-0`, 높이 고정(CLS 0). primary CTA는 `<Magnetic>`. nav 텍스트는 기존 next-intl 키.

## 5. Trust 카운트업 지표
**참고:** Magic UI NumberTicker + Framer Motion

> `apps/landing/components/sections/trust.tsx`(서버 컴포넌트 유지)에서 지표를 `<CountUp>`으로. 로케일 metric 문자열("60초"/"60s"/"60秒"/"TTS"/"0")을 **숫자+접미사로 파싱**해 i18n 유지. '60': number 0→60 ~900ms; '0': odometer(9→0 짧게 굴러 안착); 'TTS': text 모드(blur+opacity 세틀, **letter-spacing 금지** — reflow). 숫자는 고정폭 inline-block(min-width=자릿수 ch, tabular-nums) → 자릿수 변해도 CLS 0. 헤딩 `<Reveal>`, 타일 `<RevealGroup>`(80ms), 헤딩 밑 coral 1px wipe 언더라인. reduced-motion이면 최종값 즉시.

## 6. Feature 비주얼 — 재생 파형 + 자막 wipe
**참고:** Motion Primitives(in-view reveal) + Framer Motion

> `feature-section.tsx`/`feature-visuals.tsx`에 in-view 1회성 reveal(핀 고정 없이 '제품이 스스로 시연'). 기존 3개 교차 레이아웃·DOM·reading order·next-intl 유지(SEO). 텍스트 컬럼(eyebrow/h2/description/bullets)은 `<RevealGroup>`(80ms). visual은 `<Reveal variant="focus">`. VoiceVisual: 48-bar → `<LivingWaveform mode="playOnce" playedTo={32}>`(녹음 재생 스윕). SharedVisual: 3개 프로필 row를 내부 `<RevealGroup>`(y14,70ms) deal-in. LanguageVisual: EN 문장 `<Reveal variant="wipe">`(좌→우 transcript) 뒤 KR 원문 fade, mint 아이콘은 조용히. 전부 1회성 intersection. reduced-motion이면 최종 상태(=오늘 화면).

## 7. Scenarios / Quotes / FAQ / Footer 차분한 reveal
**참고:** Motion Primitives(stagger) + Framer Motion; FAQ는 네이티브 `<details>` 유지

> 네 섹션을 차분한 reveal만 추가(쇼스토퍼 금지). scenarios: 헤딩 `<Reveal>`, 2×2 카드 `<RevealGroup>`(80ms, flat), hover에서만 tag divider가 coral 좌→우 wipe(CSS group-hover). quotes: 헤딩 `<Reveal>`, 카드 `<RevealGroup>`, 상단 `.hairline`은 enter 시 wipe(Quote 글리프엔 **중첩 Reveal 금지** — 이중 옵저버, 그룹 entrance에 함께 타게). faq: 네이티브 `<details>`/`<summary>` 그대로(no-JS·FAQPage JSON-LD 의존), `<RevealGroup>`(60ms), 답변은 `group-open:animate-fadeup`(CSS, JS 불필요). footer: 컬럼 `<RevealGroup>`(60ms) fade-up. 전부 reduced-motion이면 즉시 최종 상태, 색은 토큰만, trilingual i18n 유지.

## 8. Waitlist 성공 비트 + spine 종결
**참고:** reactbits.dev(성공 마이크로 인터랙션) + Framer Motion(이미 client)

> `apps/landing/components/sections/waitlist.tsx`(이미 `'use client'`)에 마무리 모션. 폼 로직·next-intl 키 유지. 카드 `<Reveal variant="focus">`. 기존 blur blob 2개는 `.animate-drift`/`.animate-drift-slow`(CSS ~12–16s 사인). headline 앞에 짧은 coral `<LivingWaveform mode="playOnce">`(spine 종착점). submit 버튼 `<Magnetic>`. SUCCESS BEAT(유일한 축하): 성공 시 Check 아이콘 spring pop(scale0→1, stiffness300) + 입력 영역 soft MINT(`--color-mint`) 틴트 플래시(mint=안전/신뢰, coral 아님). reduced-motion/pointer:coarse면 전부 no-op·즉시 최종 상태.

## 9. 전역 토큰 + reduced-motion 미디어쿼리 (직접 작성)
**참고:** `globals.css` — 라이브러리 아님

> `apps/landing/app/globals.css` 수정. (1) `@theme`에 `--ease-paper: cubic-bezier(0.16,1,0.3,1)` 추가, 모든 JS 모션 config가 이와 일치. (2) 경량 CSS 장식 키프레임 `.animate-bob`(scroll 힌트), `.animate-drift`(blob). (3) 파일 하단에 `@media (prefers-reduced-motion: reduce)` 블록: `*`의 animation/transition을 ~0으로, **그리고 `[data-reveal]{opacity:1!important;transform:none!important;filter:none!important;clip-path:none!important}`** — JS 하이드레이션 타이밍과 무관하게 CSS만으로 최종 가시 상태 복원(JS `usePrefersReducedMotion()` 게이트와 이중 안전망). (4) 폰트 remote `@import`는 `@import "tailwindcss"` **앞**으로(Tailwind 인라인 후 순서 경고 방지). 팔레트·폰트·radii·shadow 토큰은 변경 금지. 루트 layout에 `<noscript>`로 `[data-reveal]` 강제 표시(no-JS 안전망).

---

### 검증 체크리스트 (구현 후)
- `tsc --noEmit` · `next build`(output:export) 통과, 26페이지 프리렌더
- 빌드 산출물에서 헤드라인 텍스트·JSON-LD·hreflang 존재(SEO)
- 빌드 CSS에 `[data-reveal]{opacity:1!important}` reduced-motion 규칙 존재
- 서버 컴포넌트가 client hook을 호출하지 않음(client 컴포넌트 렌더는 OK)
- 어드버서리얼 멀티 리뷰(RSC 경계 / 성능·a11y·reduced-motion / 브랜드·i18n)
