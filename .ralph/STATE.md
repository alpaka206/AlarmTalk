# 현재 상태

- 브랜치: develop_loop
- 마지막 루프: 2026-04-25 — P122-A Hardcoded 색상 디자인 토큰 마이그레이션 (Batch 1: 토큰 정의 + 스타일 파일 14개)
- 현재 Phase: **R0~R6 전체 완료 + P11~P122A 완료**
- 전체 typecheck 통과 (backend + mobile 0 errors)

## 완료된 리팩토링

- **P0~P10**: 전체 완료
- **R0~R5**: 전체 완료
- **R6**: 프로젝트 문서화 6건 (docs/R6-A~F.md)
- **P11~P121**: 전체 완료
- **P122-A**: 디자인 토큰 마이그레이션 Batch 1 — textOnPrimary/overlay 토큰 추가, 스타일 파일 14개 hardcoded 색상 교체 (41건)

## 알려진 이슈
- [blocked] Perso API 404
- [blocked] ElevenLabs 통합 테스트
- TTS 변환 미구현 (notes.audio_url 항상 null)
- eas.json submit: iOS ascAppId/appleTeamId placeholder 교체 필요
- eas.json submit: Android google-service-account.json 생성 필요
- Sentry DSN 미설정 (사용자가 Sentry 프로젝트 생성 후 설정 필요)
- react vs react-native-renderer 버전 불일치 (react 19.2.5 / renderer 19.1.0) — Animated 컴포넌트 테스트 시 mock 필수

## P122 잔여 작업
- Batch 2: 컴포넌트 파일 (src/components/*.tsx) hardcoded 색상 교체 (~12개 인스턴스)
- Batch 3: 화면 파일 (app/**/*.tsx) 인라인 hardcoded 색상 교체 (~23개 인스턴스)
- LoginButtons.tsx 브랜드 색상은 의도적 유지 (Google #4285F4, Apple #000000 등)

## 대형 라우트 파일 분할 현황 (전체 완료)
- family.ts 834줄 → 13줄 aggregator (P57)
- voice.ts 593줄 → 11줄 aggregator (P94)
- alarm.ts 502줄 → 11줄 aggregator (P95)
- character.ts 405줄 → 11줄 aggregator (P96)
- billing.ts 378줄 → 10줄 aggregator (P97)

## TypeScript 엄격 모드 현황
- Backend: `strict: true` + `noUncheckedIndexedAccess: true` ✅
- Mobile: `strict: true` + `noUncheckedIndexedAccess: true` ✅

## 테스트 커버리지 현황
- Backend: 1068 tests (57 files) — 모든 라우트 + 미들웨어 + 유틸리티 + 전체 split module 테스트 + voice-profile/voice-upload 전용 테스트
- Mobile: 1024 tests (58 files) — API core + 전체 API 서비스 모듈 + hooks + services (전체) + lib + 전체 컴포넌트 (14/14) + 화면 비즈니스 로직 + 오디오 캐시 관리
- 미테스트: lib/db.ts (최소 로직, re-export만)
- 유일한 `any` 사용: lib/logger.ts logRouteError (문서화된 정당한 예외)
- 모바일 소스 `as unknown as` 0건 (db-types.ts typedRow만 의도적 유지)
