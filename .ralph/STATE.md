# 현재 상태

- 브랜치: develop_loop
- 마지막 루프: 2026-04-25 — P121 접근성(A11y) 개선 (Toast/OfflineBanner/PeopleSkeletonCard/FamilyMemberRow + 탭 화면 header 역할)
- 현재 Phase: **R0~R6 전체 완료 + P11~P121 완료**
- 전체 typecheck 통과 (backend + mobile 0 errors)
- 전체 테스트 통과 (backend 1068/1068, mobile 1024/1024)

## 완료된 리팩토링

- **P0~P10**: 전체 완료
- **R0~R5**: 전체 완료
- **R6**: 프로젝트 문서화 6건 (docs/R6-A~F.md)
- **P11~P112**: 전체 완료
- **P113**: App Store / Google Play 스토어 등록 메타데이터 준비
- **P114~P118**: 테스트 커버리지 확장 (backend split modules + voice 전용 테스트)
- **P119**: 오디오 캐시 관리 — getCachedAudioFiles, cleanupAudioCache(200MB LRU), clearAudioCache + 앱 시작 시 자동 정리
- **P121**: 접근성(A11y) 개선 — Toast/OfflineBanner/PeopleSkeletonCard에 a11y role/label 추가, 탭 화면 header 역할, FamilyMemberRow 라벨 추가

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
- Backend: 1068 tests (57 files) — 모든 라우트 + 미들웨어 + 유틸리티 + 전체 split module 테스트 + voice-profile/voice-upload 전용 테스트
- Mobile: 1024 tests (58 files) — API core + 전체 API 서비스 모듈 + hooks + services (전체) + lib + 전체 컴포넌트 (14/14) + 화면 비즈니스 로직 + 오디오 캐시 관리
- 미테스트: lib/db.ts (최소 로직, re-export만)
- 유일한 `any` 사용: lib/logger.ts logRouteError (문서화된 정당한 예외)
- 모바일 소스 `as unknown as` 0건 (db-types.ts typedRow만 의도적 유지)
