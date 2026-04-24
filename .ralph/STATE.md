# 현재 상태

- 브랜치: develop_loop
- 마지막 루프: 2026-04-25 — 모바일 컴포넌트 테스트 추가 (OfflineBanner, QueryStateView, PeopleSkeletonCard)
- 현재 Phase: **R0~R6 전체 완료 + P11~P107 완료**
- 전체 typecheck 통과 (backend + mobile 0 errors)
- 전체 테스트 통과 (backend 872/872, mobile 801/801)

## 완료된 리팩토링

- **P0~P10**: 전체 완료
- **R0~R5**: 전체 완료
- **R6**: 프로젝트 문서화 6건 (docs/R6-A~F.md)
- **P11~P106**: 전체 완료
- **P107**: 모바일 컴포넌트 테스트 19건 추가 — @testing-library/react-native 도입, OfflineBanner(4), QueryStateView(8), PeopleSkeletonCard(7)

## 알려진 이슈
- [blocked] Perso API 404
- [blocked] ElevenLabs 통합 테스트
- TTS 변환 미구현 (notes.audio_url 항상 null)
- eas.json submit: iOS ascAppId/appleTeamId placeholder 교체 필요
- eas.json submit: Android google-service-account.json 생성 필요
- Sentry DSN 미설정 (사용자가 Sentry 프로젝트 생성 후 설정 필요)
- react vs react-native-renderer 버전 불일치 (react 19.2.5 / renderer 19.1.0) — Animated 컴포넌트 테스트 시 mock 필수

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
- Backend: 872 tests (49 files) — 모든 라우트 + 미들웨어 + 유틸리티
- Mobile: 801 tests (50 files) — API core + 전체 API 서비스 모듈 + hooks + services + lib + 컴포넌트 3개
- 미테스트: lib/db.ts (최소 로직), LoginButtons (auth 의존성 모킹 복잡)
- 유일한 `any` 사용: lib/logger.ts logRouteError (문서화된 정당한 예외)
