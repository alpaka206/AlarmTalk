# P5: 다크모드 인프라 구축

## 작업 항목
BACKLOG P5 — 다크모드 전체 화면 검증 (1단계: 인프라)

## 문제
- `Colors.light`/`Colors.dark`가 `as const`로 정의되어 있었으나, 다크모드 기능이 완전히 미연결 상태
- Settings 화면의 darkMode 토글이 로컬 state로만 존재 (persist 안 됨, UI에 반영 안 됨)
- 40+ 개 파일에 `Colors.light.*` 직접 참조 — 다크모드에서 전혀 변하지 않음
- 하드코딩된 `#FFF`, `#FFFFFF` 등 40+ 곳

## 접근 방식
인프라를 먼저 구축하고, 화면별 마이그레이션은 후속 iteration에서 진행.

### 1. ThemeColorScheme 인터페이스 (`theme.ts`)
- `as const` 제거 → `ThemeColorScheme` 인터페이스로 변경
- light/dark 모두 동일 타입이므로 상호 교환 가능
- 기존 `Colors.light.primary` 등 모든 참조는 타입 호환 유지 (string으로 widened)

### 2. useAppStore에 darkMode 추가
- `darkMode: boolean` 상태 + `setDarkMode(enabled)` 액션
- AsyncStorage `dark_mode` 키로 persist
- `loadPersistedState`에서 복원

### 3. useTheme 훅 (`src/hooks/useTheme.ts`)
- `useAppStore(s => s.darkMode)`로 현재 모드 읽기
- `{ colors, isDark }` 반환
- `ThemeColors` 타입 re-export

### 4. 적용 화면 (이번 iteration)
- **root `_layout.tsx`**: Stack contentStyle backgroundColor → `colors.background`, StatusBar → `isDark ? 'light' : 'dark'`
- **tabs `_layout.tsx`**: tabBar backgroundColor/borderColor → `colors.surface`/`colors.border`
- **settings.tsx**: 전체 `createStyles(colors)` 패턴으로 재작성, SettingRow에 colors prop 전달, `#FFF` → `colors.surface`

## 변경 파일 (5개)
1. `apps/mobile/src/constants/theme.ts` — `ThemeColorScheme` 인터페이스 추가, `as const` 제거
2. `apps/mobile/src/stores/useAppStore.ts` — darkMode state + setDarkMode action + persist
3. `apps/mobile/src/hooks/useTheme.ts` — 신규, useTheme 훅
4. `apps/mobile/app/_layout.tsx` — useTheme 적용 (contentStyle, StatusBar)
5. `apps/mobile/app/(tabs)/_layout.tsx` — useTheme 적용 (tabBar 색상)
6. `apps/mobile/app/(tabs)/settings.tsx` — createStyles 패턴으로 전체 재작성

## 검증
- Mobile typecheck: ✅ 통과
- Backend typecheck: ✅ 통과

## 다음 루프
P5 다크모드 화면 마이그레이션 Batch 1: 5개 탭 화면(index, alarms, voices, people)에 `useTheme()` + `createStyles()` 패턴 적용. 
각 화면에서 `Colors.light.*` → `colors.*`, 하드코딩 `#FFF` → `colors.surface` 변환.
