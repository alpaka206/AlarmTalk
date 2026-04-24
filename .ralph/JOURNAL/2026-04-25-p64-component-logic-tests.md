# P64 — ProfileDropdown + PresetMessageSection 비즈니스 로직 테스트

## 선택한 항목
BACKLOG 고갈 → 자가 생성: 미테스트 컴포넌트 비즈니스 로직 커버리지 확장

## 선택 이유
BACKLOG 전체 완료. 코드 품질 스캔 결과 console.log/TODO/any/하드코딩 한국어 모두 0건으로 코드 클린. 미테스트 컴포넌트 중 ProfileDropdown (353줄)과 PresetMessageSection (302줄)이 가장 크고 비즈니스 로직이 풍부하여 선택.

## 접근
기존 screenInteraction.test.ts 패턴 따름 — 컴포넌트에서 비즈니스 로직 함수를 추출하여 순수 함수로 테스트. React 렌더링 불필요.

### ProfileDropdown 테스트 (30건)
- getPlanLabel: 플랜 라벨 매핑 + 미지 플랜 폴백 + t() 함수 활용 (6건)
- computeInitial: 아바타 이니셜 계산 — name/email/null/한국어/빈문자열 엣지케이스 (10건)
- toggleLanguage: ko↔en 전환 + 미지 언어 처리 (3건)
- getAuthMenuItems: 인증 상태별 메뉴 항목 포함/제외 (5건)
- shouldShowProfile: 인증+프로필 조합별 표시 여부 (5건)
- 미테스트 항목 (UI 의존): handleLogout/handleDeleteAccount Alert 호출 (렌더링 필요)

### PresetMessageSection 테스트 (28건)
- isGenerateDisabled: 생성 버튼 비활성화 조건 7가지 조합 (7건)
- pickRandomMessage: 카테고리별 랜덤 메시지 선택 + 미지 카테고리 null (4건)
- onCategoryChange: 카테고리 변경 시 텍스트 초기화 (3건)
- filterReadyVoicesForPreset: ready 상태 필터링 (4건)
- hasRecentPresets: 최근 프리셋 존재 여부 (3건)
- PRESET_CATEGORIES 무결성: 개수, 유니크 키, 이모지, i18n, 메시지키 패턴, 순서 (8건 — 일부 presets.test.ts와 겹치나 이 테스트는 PresetMessageSection 관점에서의 검증)

## 변경 파일
1. `test/profileDropdown.test.ts` 신규 (143줄, 30 tests)
2. `test/presetMessageSection.test.ts` 신규 (182줄, 28 tests)

## 검증
- typecheck: mobile 0 errors, backend 0 errors
- 테스트: mobile 597/597 통과 (기존 539 + P64 58), backend 672/672 통과

## 다음 루프 참고
- ProfileDropdown의 handleLogout/handleDeleteAccount는 Alert.alert 모킹 + React 렌더링이 필요하여 스킵
- 남은 미테스트 컴포넌트: CoupleView (179줄), MiniWaveformPlayer (176줄), LoginButtons (153줄) — 이들도 비즈니스 로직 추출 테스트 가능
- audio.ts 서비스 (170줄)는 expo-av/expo-file-system 의존성으로 모킹 복잡도 높음
