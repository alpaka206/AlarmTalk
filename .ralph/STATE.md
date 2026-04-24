# 현재 상태

- 브랜치: develop_loop
- 마지막 루프: 2026-04-24 — P37 도달 불가 음성 화면 네비게이션 연결
- 현재 Phase: **R0~R6 전체 완료 + P11~P37 완료**
- 전체 typecheck 통과 (backend + mobile 0 errors)
- 전체 테스트 통과 (backend 653/653, mobile 392/392)

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
- **P28**: 딥 링크 라우트 핸들링 — deepLink.ts 파서 + _layout.tsx 초기 URL/런타임 이벤트 리스너 + auth gating (13 딥 링크 패턴 지원)
- **P29**: expo-updates OTA 업데이트 — 앱 시작 시 EAS Update 체크 + Alert 기반 opt-in 업데이트 (i18n 4키)
- **P30**: deepLink + updates 테스트 커버리지 — deepLink 파서 23 tests + updates 서비스 7 tests (총 316/316)
- **P31**: 하드코딩 한국어 문자열 i18n 전환 — picker.tsx 20개 + alarms.tsx 3개 + character/index.tsx 3개 → t() 호출 (ko/en 25키 추가)
- **P32**: t() 폴백 문자열 패턴 정리 — 6파일 24건 폴백 제거 + 누락 i18n 키 14개 추가 (ko/en)
- **P33**: 백엔드 console.error → 구조화 로깅 — logRouteError 유틸 + 8파일 22건 마이그레이션 + Sentry 자동 캡처 (6 tests)
- **P34**: 접근성 자동화 검증 — a11y-audit.test.ts 30 tests (인터랙티브 요소 a11y, i18n 동기화, WCAG AA 색상 대비) + 5건 a11y 이슈 수정 (MiniWaveformPlayer, StateView, gift/received, settings TextInput)
- **P35**: React Query 캐시 전략 테스트 — queryCache.test.ts 36 tests (키 일관성, enabled 가드, 뮤테이션 무효화, 오프라인 캐시 통합) + 쿼리 키 불일치 버그 3건 수정 (userProfile, gifts-received)
- **P36**: 네비게이션 라우트 유효성 검증 — navigationRoutes.test.ts 10 tests (라우트 매핑, 도달성, 동적 파라미터, Stack.Screen 등록, deepLink 매핑) + unused import/var 2건 정리 (voice/record, NotificationBell)
- **P37**: 도달 불가 음성 화면 연결 — voices.tsx 음성 추가 메뉴에 diarize/picker 2옵션 추가 + i18n 8키 + navigationRoutes 테스트 allowedUnreachable 제거

## 알려진 이슈
- [blocked] Perso API 404
- [blocked] ElevenLabs 통합 테스트
- TTS 변환 미구현 (notes.audio_url 항상 null)
- eas.json submit: iOS ascAppId/appleTeamId placeholder 교체 필요
- eas.json submit: Android google-service-account.json 생성 필요
- Sentry DSN 미설정 (사용자가 Sentry 프로젝트 생성 후 설정 필요)
