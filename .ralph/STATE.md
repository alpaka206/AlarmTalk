# 현재 상태

- 브랜치: develop_loop
- 마지막 루프: 2026-04-25 — P129 (alarmCountdown.ts 단위 테스트)
- 현재 Phase: **R0~R6 전체 완료 + P11~P129 부분 완료**
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

## 알려진 이슈
- [blocked] Perso API 404
- [blocked] ElevenLabs 통합 테스트
- TTS 변환 미구현 (notes.audio_url 항상 null)
- eas.json submit: iOS ascAppId/appleTeamId placeholder 교체 필요
- eas.json submit: Android google-service-account.json 생성 필요
- Sentry DSN 미설정 (사용자가 Sentry 프로젝트 생성 후 설정 필요)
- react vs react-native-renderer 버전 불일치 (react 19.2.5 / renderer 19.1.0)

## 디자인 토큰 마이그레이션 잔여
- LoginButtons.tsx 브랜드 색상 — 의도적 유지
- ProfileDropdown.tsx shadowColor: '#000' — RN 표준 패턴, 의도적 유지

## TypeScript 엄격 모드 현황
- Backend: `strict: true` + `noUncheckedIndexedAccess: true` ✅
- Mobile: `strict: true` + `noUncheckedIndexedAccess: true` ✅

## 테스트 커버리지 현황
- Backend: 1068 tests (57 files)
- Mobile: 1044 tests (59 files) — +20 alarmCountdown 테스트 추가
- 유일한 `any` 사용: lib/logger.ts logRouteError (문서화된 정당한 예외)

## 성능 최적화 현황 (전체 완료)
- FlatList: 전체 화면 적용
- useCallback: alarms, voices, library, home, people 화면
- React.memo: AlarmListItem, LibraryListItem, VoiceProfileItem 등
- CountdownText / BannerCountdown: 독립 tick 컴포넌트
