# Architecture Decision Records

프로젝트의 주요 기술 결정을 기록한다. 형식은 가벼운 ADR.

## ADR-001 · 모노레포 구조: 기존 구조 유지

- 상태: Accepted · 2026-04-17
- 맥락
  - TASK.md는 `apps/web`, `apps/mobile`, `apps/backend`, `packages/shared` 를 권장한다.
  - 현재 저장소는 `apps/mobile`, `packages/backend`, `packages/web` 로 이미 상당한 코드가 작성되어 있다.
  - TASK.md §10: "기존 코드가 이미 다른 스택이면 기존 스택 유지하고 monorepo 재편은 Phase 1 이슈로 따로 제안만."
- 결정
  - 기존 경로(`apps/mobile`, `packages/backend`, `packages/web`) 를 유지한다.
  - 구조 재편은 하지 않고 공용 패키지(`packages/shared`, `packages/voice`, `packages/ui`) 만 필요한 시점에 추가한다.
- 근거
  - 이미 CI, 배포, 테스트 경로, README, ARCHITECTURE.md 가 모두 현재 경로에 고정되어 있어 재편 비용이 크다.
  - 루프가 목표로 하는 기능 추가(이용권·가족 플랜·게이미피케이션 등) 에는 구조 재편이 필수적이지 않다.
- 후속 작업
  - 공용 타입 모듈이 필요해지면 `packages/shared` 를 추가한다 (TASK.md Phase 1 #3 수준의 zod 스키마 포함).
  - 음성 어댑터는 `packages/voice` 로 추출한다 (Phase 3 #12).

## ADR-002 · 백엔드 런타임: Cloudflare Workers + Hono 유지

- 상태: Accepted · 2026-04-17
- 맥락
  - TASK.md는 Fastify + Prisma + zod 를 추천한다.
  - 현재는 Cloudflare Workers + Hono + @libsql/client (Turso) 구성이며 배포 파이프라인까지 작동 중이다.
- 결정
  - 기존 스택(Workers + Hono + Turso) 유지.
  - Prisma 대신 Turso/LibSQL 의 `db.execute` 를 계속 사용한다.
- 근거
  - Workers 런타임은 Node.js 전제의 Fastify/Prisma 를 그대로 올릴 수 없고, 재구성 시 현재 머지된 모든 라우트·테스트를 재작성해야 한다.
  - 기존 테스트 러너가 이미 vitest 로 구성되어 있어 신규 테스트 추가 비용이 낮다.
- 리스크 / 후속
  - 스키마 마이그레이션은 ADR-006에서 정비. 번호 기반 마이그레이션 러너 도입.

## ADR-003 · 모바일 스택: React Native + Expo 유지

- 상태: Accepted · 2026-04-17
- 결정
  - 기존 Expo 프로젝트(SDK 54, expo-router) 를 유지한다.
  - 새 화면은 expo-router 규약(`app/**/*.tsx`) 을 따른다.
- 근거
  - 이미 onboarding, 알람, 친구, 선물, 음성, 더빙 등 주요 플로우가 expo-router 로 구현되어 있다.
  - TypeScript 공유가 가능해 `packages/shared` 도입 시 그대로 재사용할 수 있다.

## ADR-004 · 웹 스택: 삭제

- 상태: **Superseded** · 2026-04-24 (원래 Accepted 2026-04-17)
- 결정
  - ~~Next.js 로 이전하지 않고 Vite 기반 SPA 를 유지한다.~~
  - **P0 Phase 1-A에서 `packages/web` 전체 삭제.** 모바일 퍼스트 전략으로 웹 대시보드 불필요 판단.
- 근거
  - 기획서 정렬: 웹은 보조 채널이었으나 실사용 시나리오가 없음.
  - 유지보수 비용 제거: CI 매트릭스, 의존성, CORS 설정 등 웹 관련 인프라 일괄 정리.

## ADR-006 · DB 마이그레이션: 번호 기반 마이그레이션 러너 (ORM 미도입)

- 상태: Accepted · 2026-04-21
- 맥락
  - TASK.md #7은 "SQLite(개발) + Prisma 권장"이지만, 현재 Cloudflare Workers + Turso 환경에서 Prisma는 런타임 호환성 문제가 있다.
  - 기존 db.ts에는 CREATE TABLE IF NOT EXISTS + ALTER TABLE try-catch 패턴으로 마이그레이션이 인라인되어 있다.
  - 테이블 8개, 인덱스 18개가 이미 구동 중.
- 결정
  - ORM(Prisma/Drizzle)을 도입하��� 않고, 번호 기반 마이그레이션 러너를 자체 구현한다.
  - `_migrations` 메타 테이블에 실행 완료된 마이그레이션 ID를 기록한다.
  - 각 마이그레이션은 `migrations.ts`에 순번·이름·SQL 배열로 정의한다.
- 근거
  - Workers 런타임에서 Prisma CLI(generate/migrate)가 직접 실행 불가.
  - Drizzle은 가능하나 현재 코드 전부 raw SQL이므로 전환 비용 대비 이득이 작다.
  - 번호 기반 러너는 ~50줄로 구현 가능하고 디버깅이 직관적이다.
- 후��
  - Phase 10에서 Drizzle 도입을 재평가할 수 있다.

## ADR-005 · 외부 AI·결제·푸시는 Mock 어댑터로 대체

- 상태: Accepted · 2026-04-17
- 결정
  - Perso.ai, ElevenLabs, 결제 PG, FCM/APNs 는 Ralph 루프 동안 실호출하지 않는다.
  - 각 어댑터는 mock 응답을 반환하고, 교체 지점마다 `// TODO: real {perso.ai|elevenlabs|pg|fcm} integration` 주석을 남긴다.
- 근거
  - TASK.md §"절대 금지 사항" 과 직접 대응. 크레딧·과금·사용자 데이터 리스크를 방지한다.
- 후속
  - 실호출 복귀 시 `grep -R "TODO: real"` 으로 교체 지점을 찾아 일괄 연결한다.

---

## ADR-007 · 탭 구조: 4탭 + 프로필 드롭다운

- 상태: Accepted · 2026-04-24 (R0)
- 맥락
  - 기존 8탭(홈/음성/알람/친구/가족/캐릭터/라이브러리/설정) → 5탭(P0) → 최종 4탭(R0).
  - 사용자 피드백: 탭이 너무 많아 혼란. 핵심 기능만 노출하고 나머지는 스택 화면으로.
- 결정
  - 하단 탭 4개 고정: **홈** / **음성** / **알람** / **메시지작성**
  - 설정·사람들·코드등록은 우측 상단 **ProfileDropdown** 컴포넌트에서 접근.
  - 캐릭터·라이브러리는 홈 화면 위젯에서 진입하는 스택 화면.
- 근거
  - 핵심 사용 플로우(음성 등록 → 알람 설정 → 메시지 주고받기)만 탭에 배치.
  - 설정류는 빈도가 낮으므로 드롭다운이 적절.

## ADR-008 · 인증: JWT 자체 발급 (이메일/비밀번호 + bcrypt)

- 상태: Accepted · 2026-04-17
- 맥락
  - Google OAuth / Apple Sign-In은 네이티브 SDK 설정이 복잡하고 무인 루프에서 테스트 불가.
- 결정
  - 이메일/비밀번호 기반 인증 + bcrypt 해싱 + JWT 토큰 (access 1h + refresh 30d).
  - Google/Apple OAuth는 LoginButtons에 UI만 배치, 실제 연동은 배포 후 진행.
- 근거
  - Workers 환경에서 bcrypt (bcryptjs WASM) 동작 확인됨.
  - 테스트에서 인증 플로우를 완전히 제어 가능.

## ADR-009 · 음성 프로필: 사용자당 최대 2개 제한

- 상태: Accepted · 2026-04-24 (R1)
- 결정
  - `voice_profiles` 테이블에서 `user_id` 기준 COUNT ≤ 2 제한.
  - 백엔드 POST /clone에서 서버 사이드 검증 + 프론트엔드 UI 비활성화 이중 체크.
- 근거
  - TTS 비용 관리: 음성 프로필이 많을수록 캐싱 미스 증가.
  - UX 단순화: "내 음성" vs "상대방 음성" 2개면 대부분의 사용 시나리오 커버.
  - 가족 플랜 멤버의 음성은 읽기 전용으로 추가 표시 (별도 제한 없음).

## ADR-010 · i18n: TFunction 주입 패턴

- 상태: Accepted · 2026-04-25 (P31~P46)
- 맥락
  - 초기에 한국어 하드코딩 문자열이 lib/유틸 함수 곳곳에 산재.
  - 리팩토링 없이는 영어 지원 불가.
- 결정
  - UI 컴포넌트: `useTranslation()` 훅 직접 사용.
  - lib/유틸 함수: `(t: TFunction)` 파라미터 주입, 반환값은 i18n 키 문자열.
  - 번역 원본: `src/i18n/ko.json` (한국어) + `src/i18n/en.json` (영어), 항상 동기화.
- 근거
  - lib 함수에서 훅 사용 불가 → DI 패턴이 유일한 선택.
  - 키 반환 패턴(예: `reasonKey` 대신 `reason`)은 컴포넌트에서 `t(key)` 호출로 실제 번역 적용.

## ADR-011 · 스타일 공유: createXxxStyles(colors) 패턴

- 상태: Accepted · 2026-04-25 (P48)
- 맥락
  - alarm/create.tsx(1146줄)와 alarm/edit.tsx(795줄)에서 스타일 정의가 70%+ 중복.
  - 다크모드 지원을 위해 `ThemeColors`를 주입받는 팩토리 함수 패턴 이미 사용 중.
- 결정
  - 2개 이상 화면이 동일한 스타일을 사용하면 `src/styles/xxxStyles.ts`로 추출.
  - 화면 고유 스타일은 해당 파일 내 `createLocalStyles(colors)`로 유지.
  - 추출된 스타일의 타입은 `ReturnType<typeof createXxxStyles>`로 자동 추론.
- 근거
  - StyleSheet.create의 결과를 공유하면 메모리 효율 + 일관성 확보.
  - 기존 다크모드 패턴(colors 주입)과 자연스럽게 호환.

## ADR-012 · 모니터링: Sentry (DSN 미설정 시 no-op)

- 상태: Accepted · 2026-04-24 (P22)
- 결정
  - 모바일: `@sentry/react-native` + Expo 플러그인. DSN 미설정 시 초기화 스킵.
  - 백엔드: `toucan-js` Hono 미들웨어. `SENTRY_DSN` 미설정 시 미들웨어 바이패스.
  - ErrorBoundary에서 `captureException` 자동 호출.
  - 백엔드 `logRouteError` 유틸에서 구조화 로깅 + Sentry 자동 캡처.
- 근거
  - 개발/무인 루프 중에는 DSN 없이 동작해야 하므로 graceful degradation 필수.
  - 배포 후 Sentry 프로젝트 생성 + DSN 설정만으로 즉시 활성화.
