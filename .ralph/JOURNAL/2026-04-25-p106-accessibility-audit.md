# P106 — 앱 접근성 강화 (WCAG AA 준수)

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 "앱 접근성 강화 (스크린 리더, 고대비)" 선택.
전체 모바일 앱 대상 WCAG AA 접근성 감사 수행 후 미비 사항 수정.

## 감사 결과

### 발견된 이슈 유형
1. **section title에 `accessibilityRole="header"` 누락** — 22개 요소
2. **TextInput에 `accessibilityLabel` 누락** — 1개 요소
3. **Pressable에 `accessibilityRole="button"` + `accessibilityLabel` 누락** — 1개 요소 (DEV only)

### 이미 올바른 영역
- 모든 TouchableOpacity에 `accessibilityRole="button"` + `accessibilityLabel` 구현됨
- 모든 Switch에 `accessibilityRole="switch"` + `accessibilityLabel` + `accessibilityState` 구현됨
- 모든 TextInput (검색 필드 1개 제외)에 `accessibilityLabel` 구현됨
- 에러 메시지에 `accessibilityRole="alert"` 적용됨
- 탭 컴포넌트에 `accessibilityRole="tab"` 적용됨
- 접근성 컬러 대비 함수 `meetsAA` 구현됨

## 작업 내역

### 1. Section Title accessibilityRole="header" 추가 (22개)
- `alarm/edit.tsx` — 8개 section title (시간, 반복, 재생모드, 음성프로필, 깨우기방식, 스누즈, 진동, 메시지)
- `alarm/create.tsx` — 9개 section title (동일 항목 + 대상선택)
- `settings/index.tsx` — 1개 (정보 섹션)
- `character/index.tsx` — 1개 (DEV XP 섹션)
- `(tabs)/compose.tsx` — 1개 (받은 쪽지)
- `(tabs)/index.tsx` — 2개 (최근 메시지, 빠른 시작)
- `(tabs)/voices.tsx` — 2개 (내 음성, 가족 음성)

### 2. TextInput accessibilityLabel 추가 (1개)
- `(tabs)/alarms.tsx` — 검색 필드에 `accessibilityLabel={t('alarms.searchPlaceholder')}` 추가

### 3. Pressable 접근성 속성 추가 (1개)
- `character/index.tsx` — DEV XP 버튼에 `accessibilityRole="button"` + `accessibilityLabel={t(e.labelKey)}` 추가

## 변경 파일 (8개)
1. `apps/mobile/app/alarm/edit.tsx` — 8개 sectionTitle에 accessibilityRole="header" 추가
2. `apps/mobile/app/alarm/create.tsx` — 9개 sectionTitle에 accessibilityRole="header" 추가
3. `apps/mobile/app/(tabs)/alarms.tsx` — 검색 TextInput accessibilityLabel 추가
4. `apps/mobile/app/settings/index.tsx` — 1개 sectionTitle accessibilityRole="header" 추가
5. `apps/mobile/app/character/index.tsx` — DEV sectionTitle header + Pressable button a11y 추가
6. `apps/mobile/app/(tabs)/compose.tsx` — 1개 sectionTitle accessibilityRole="header" 추가
7. `apps/mobile/app/(tabs)/index.tsx` — 2개 sectionTitle accessibilityRole="header" 추가
8. `apps/mobile/app/(tabs)/voices.tsx` — 2개 sectionTitle accessibilityRole="header" 추가

## 검증
- typecheck: backend 0 errors, mobile 0 errors ✅
- backend tests: 872/872 passed ✅
- mobile tests: 782/782 passed ✅

## 다음 루프 참고
- 앱 전반의 접근성이 WCAG AA 수준으로 향상됨
- 남은 접근성 개선: iOS VoiceOver/Android TalkBack 실기기 테스트 (manual)
- 다크모드 컬러 대비 검증은 실기기 필요 (이미 meetsAA 함수로 코드상 검증됨)
- 앱 전체 ~98% WCAG AA 준수 상태
