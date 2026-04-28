# P5: 다크모드 화면 마이그레이션 Batch 2

## 작업 항목
BACKLOG P5 — 다크모드 Batch 2: 스택 화면 4개 (character, library, alarm/create, alarm/edit)

## 접근 방식
Batch 1에서 확립한 `createStyles(colors: ThemeColors)` 패턴을 4개 스택 화면에 동시 적용.
4개 파일을 병렬 에이전트로 동시 작업하여 한 iteration에 완료.

### 변환 패턴 (Batch 1과 동일)
1. `Colors` import 제거, `useTheme` + `ThemeColors` import 추가
2. 컴포넌트 내부에 `const { colors } = useTheme()` + `useMemo(() => createStyles(colors), [colors])`
3. 하단 `const styles = StyleSheet.create(...)` → `function createStyles(colors: ThemeColors) { return StyleSheet.create(...); }`
4. 모든 `Colors.light.X` → `colors.X` 치환
5. 하드코딩 `#FFF` — 프라이머리 위 흰색 텍스트는 유지
6. `useMemo`가 없는 파일은 react import에 추가

### 특이사항
- `character/index.tsx`: StatBar, MilestoneBadge 서브컴포넌트를 CharacterScreen 내부로 이동 (dynStyles 클로저 접근)
- `character/index.tsx`: `#8B5E3C` (나무 뿌리 브라운) 하드코딩 유지 (의미적 색상)
- `library/index.tsx`: `useMemo` import 추가
- `alarm/create.tsx`: `useMemo` import 추가, ~90개 styles 참조 변환
- `alarm/edit.tsx`: `useMemo` import 추가, 로딩 ActivityIndicator의 Colors.light.primary → colors.primary

## 변경 파일 (4개)
1. `apps/mobile/app/character/index.tsx` — 캐릭터 화면 다크모드 적용 (~30개 색상 참조 변환)
2. `apps/mobile/app/library/index.tsx` — 라이브러리 화면 다크모드 적용 (~25개 색상 참조 변환)
3. `apps/mobile/app/alarm/create.tsx` — 알람 생성 화면 다크모드 적용 (~45개 색상 참조 변환)
4. `apps/mobile/app/alarm/edit.tsx` — 알람 편집 화면 다크모드 적용 (~35개 색상 참조 변환)

## 검증
- Mobile typecheck: ✅ 통과
- Backend typecheck: ✅ 통과
- `Colors.light` 참조 카운트: 4개 파일 모두 0개 (grep 확인)

## 다음 루프
P5 다크모드 Batch 3: 컴포넌트 (Toast, OfflineBanner, ErrorBoundary, LoginButtons 등)에 동일 패턴 적용.
