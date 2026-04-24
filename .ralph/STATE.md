# 현재 상태

- 브랜치: develop_loop
- 마지막 루프: 2026-04-24 — P27 Android 알림 채널 설정 (4채널 분리 + 쪽지 푸시)
- 현재 Phase: **R0~R6 전체 완료 + P11~P27 완료**
- 전체 typecheck 통과 (backend + mobile 0 errors)
- 전체 테스트 통과 (backend 647/647, mobile 286/286)

## 완료된 리팩토링

- **P0~P10**: 전체 완료
- **R0~R5**: 전체 완료
- **R6**: 프로젝트 문서화 6건 (docs/R6-A~F.md)
- **P11**: notes 라우트 21 tests + code 라우트 22 tests (신규 43건)
- **P12**: React Native 성능 최적화 (10 파일 — React.memo, FlatList perf props, useMemo/useCallback)
- **P13**: 쪽지 상세 화면 구현 (`app/note/[id].tsx` 신규 + compose 탭 네비게이션 연결)
- **P14**: Switch 컴포넌트 접근성 일괄 보강 (ProfileDropdown, alarms, settings — 5개 Switch에 a11y 속성 추가 + i18n 2키)
- **P15**: EAS 빌드/서브밋 설정 강화 + 스토어 메타데이터 (eas.json submit 프로필, app.json runtimeVersion/updates/versionCode, store/listing.json)
- **P16**: 모바일 유틸 테스트 커버리지 확장 Batch 2 (authFormValidation 14 + waveform 15 + presets 9 = 38 tests, 총 206/206)
- **P17**: useAppStore Zustand 스토어 테스트 (32 tests — 전체 액션 + AsyncStorage persist 검증, 총 238/238)
- **P18**: hooks 테스트 커버리지 확장 (useTheme 10 + useToast 8 + useNetworkStatus 6 + useAuth 24 = 48 tests, 총 286/286)
- **P19**: DB Row 타입 안전성 강화 (db-types.ts 유틸 + as unknown as 10건 제거 + as Record 9건 개선, 7 파일)
- **P20**: db-types 유틸 테스트 (typedRow 4 + getFormFile 6 = 10 tests, 총 606/606)
- **P21**: 미테스트 모듈 100% 커버리지 (stats 14 + elevenlabs 14 + perso 13 = 41 tests, 총 647/647)
- **P22**: Sentry 에러 모니터링 연동 (모바일 @sentry/react-native + 백엔드 toucan-js, DSN 미설정 시 no-op)
- **P23**: Sentry 타입 안전성 수정 (as never 제거, SentryClient 인터페이스, named import) + Maestro E2E 테스트 플로우 6개
- **P25**: README 현행화 (인증/탭/API/기능 전면 재작성) + packages/voice stale TODO 정리
- **P26**: 앱 아이콘 설정 — Expo 기본 아이콘 → 브랜디드 나무 아이콘 교체 (icon, adaptive, monochrome, splash, favicon) + generate-icons.mjs 스크립트
- **P27**: Android 알림 채널 4개 분리 (alarms MAX, notes HIGH, reminders DEFAULT, system LOW) + sendNotePush + 쪽지 전송 시 수신자 푸시

## 알려진 이슈
- [blocked] Perso API 404
- [blocked] ElevenLabs 통합 테스트
- TTS 변환 미구현 (notes.audio_url 항상 null)
- eas.json submit: iOS ascAppId/appleTeamId placeholder 교체 필요
- eas.json submit: Android google-service-account.json 생성 필요
- Sentry DSN 미설정 (사용자가 Sentry 프로젝트 생성 후 설정 필요)
