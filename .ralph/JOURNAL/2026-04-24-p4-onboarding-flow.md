# P4: 온보딩 플로우 기획서 정렬

## 작업 항목
BACKLOG P4 — 온보딩 플로우 기획서 정렬

## 변경 파일 (3개)

### 1. `apps/mobile/app/onboarding.tsx` — 전면 개선
- **4페이지 추가**: 🌱 나무 캐릭터 소개 (씨앗→꽃나무 성장, 스트릭 소개)
- **캐릭터 자동 생성 연동**: 온보딩 완료 시 `queryClient.prefetchQuery`로 `/characters/me` 호출 → 백엔드 `loadOrCreateCharacter`가 자동 생성
- **SafeAreaView 적용**: `react-native-safe-area-context`의 SafeAreaView로 래핑 (iOS 노치 + Android 내비 대응)
- **접근성 강화**: skip/next 버튼에 `accessibilityRole="button"` + `accessibilityLabel` 추가, 터치 타겟 최소 44px 보장
- **하드코딩 컬러 제거**: 3개 페이지 배경색 `#FFF5F3`/`#FFF0ED`/`#FFEAE5` → `Colors.light.background`/`Colors.light.surfaceVariant` 토큰으로 대체
- **버튼 텍스트 색상**: `'#FFF'` → `Colors.light.surface` 토큰
- **fontFamily 명시**: skip 텍스트에 `FontFamily.medium`, description에 `FontFamily.regular` 추가

### 2. `apps/mobile/src/i18n/ko.json` — i18n 키 추가
- `onboarding.page4Title`: "매일 아침, 나만의 나무가 자라요"
- `onboarding.page4Desc`: 경험치 + 성장 + 스트릭 설명
- `page3Desc` 수정: 마지막 줄 "지금 바로 시작해볼까요?" 제거 (4페이지로 이동했으므로 중복)

### 3. `apps/mobile/src/i18n/en.json` — 동일 i18n 키 추가

## 접근 및 판단
- 캐릭터 자동 생성: 백엔드의 `loadOrCreateCharacter`가 GET /characters/me 시 자동 생성하므로, 온보딩 완료 시 prefetch만 하면 충분. 별도 POST 엔드포인트 불필요.
- 4페이지 추가 이유: 기획서의 핵심 차별점인 캐릭터/스트릭 시스템을 온보딩에서 미리 안내하여 리텐션 유도.
- handleSkip이 finishOnboarding으로 통합되어 캐릭터 prefetch가 skip 시에도 동작.

## 검증
- Mobile typecheck: ✅ 통과
- 종속성 확인: react-native-safe-area-context ~5.6.0 설치 확인

## 다음 루프
P4 알람 정확도 강화 또는 오프라인 캐싱 검증으로 진행.
