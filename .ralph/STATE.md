# 현재 상태

- 브랜치: develop_loop
- 마지막 루프: 2026-04-25 — P140 (auth.ts + stats.ts 엣지 케이스 테스트 18개 추가)
- 현재 Phase: **R0~R6 전체 완료 + P11~P133 부분 완료**
- 전체 typecheck 통과 (backend + mobile 0 errors)

## 완료된 리팩토링

- **P0~P10**: 전체 완료
- **R0~R5**: 전체 완료
- **R6**: 프로젝트 문서화 6건 (docs/R6-A~F.md)
- **P11~P121**: 전체 완료
- **P122**: 디자인 토큰 마이그레이션 전체 완료
- **P123**: 접근성 누락 보완 완료
- **P124**: player/character 상수 분리 완료
- **P125**: 성능 프로파일링 — useCallback 최적화 (alarms, voices, library, home 화면)
- **P126**: 성능 프로파일링 Phase 2 — React.memo 컴포넌트 추출
- **P127**: 성능 프로파일링 Phase 3 — countdown 분리
- **P128**: 성능 프로파일링 Phase 4 — people useCallback
- **P129**: alarmCountdown.ts 단위 테스트 20개
- **P130**: App Store / Google Play 메타데이터 (store.config.json)
- **P131**: Maestro E2E 플로우 3개 추가 (message-tab, code-register, alarm-voice-toggle) + README 테스트 수 보정
- **P132**: Backend Integration Smoke Test (25 tests — health, public, auth, 15 protected routes, security headers, CORS, 404)
- **P133**: i18n Key Validation 테스트 14개 + `common.close` 누락 수정
- **P134**: OfflineBanner 테스트 실패 수정 + useTheme mock을 jest.requireActual 패턴으로 개선 (3파일) + README 테스트 수 보정
- **P135**: 미테스트 React.memo 컴포넌트 4개 단위 테스트 추가 (36 tests)
- **P136**: AlarmListItem 컴포넌트 단위 테스트 17개 추가
- **P137**: code.ts 라우트 엣지 케이스 테스트 6개 추가 (비문자열 코드, invite expired status, max_members 폴백, unknown plan_type, period_days 폴백)
- **P138**: Maestro E2E 플로우 2개 추가 (10-home-character, 11-alarm-edit-delete) + README 테스트 수 보정
- **P139**: friend.ts 라우트 엣지 케이스 테스트 8개 추가 (UUID 검증, 거절 후 재요청, 파라미터 폴백 등)
- **P140**: auth.ts 엣지 케이스 14개 + stats.ts 엣지 케이스 4개 추가 (이메일 정규화, DB 에러, null 폴백, 10개 제한 등)

## 알려진 이슈
- [blocked] Perso API 404
- [blocked] ElevenLabs 통합 테스트
- TTS 변환 미구현 (notes.audio_url 항상 null)
- eas.json submit: iOS ascAppId/appleTeamId placeholder 교체 필요
- eas.json submit: Android google-service-account.json 생성 필요
- Sentry DSN 미설정 (사용자가 Sentry 프로젝트 생성 후 설정 필요)
- react vs react-native-renderer 버전 불일치 (react 19.2.5 / renderer 19.1.0)
- store.config.json: review.phone placeholder 교체 필요
- store.config.json: privacy/support URL 실제 호스팅 필요

## 디자인 토큰 마이그레이션 잔여
- LoginButtons.tsx 브랜드 색상 — 의도적 유지
- ProfileDropdown.tsx shadowColor: '#000' — RN 표준 패턴, 의도적 유지

## TypeScript 엄격 모드 현황
- Backend: `strict: true` + `noUncheckedIndexedAccess: true` ✅
- Mobile: `strict: true` + `noUncheckedIndexedAccess: true` ✅

## 테스트 커버리지 현황
- Backend: 1125 tests (58 files)
- Mobile: 1113 tests (65 files)
- 유일한 `any` 사용: lib/logger.ts logRouteError (문서화된 정당한 예외)

## 성능 최적화 현황 (전체 완료)
- FlatList: 전체 화면 적용
- useCallback: alarms, voices, library, home, people 화면
- React.memo: AlarmListItem, LibraryListItem, VoiceProfileItem 등
- CountdownText / BannerCountdown: 독립 tick 컴포넌트
