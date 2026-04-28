# P5: 다크모드 화면 마이그레이션 Batch 1

## 작업 항목
BACKLOG P5 — 다크모드 Batch 1: 탭 화면 4개 (index, alarms, voices, people)

## 접근 방식
settings.tsx에서 확립한 `createStyles(colors: ThemeColors)` 패턴을 4개 탭 화면에 일괄 적용.
4개 파일을 병렬로 동시 작업하여 한 iteration에 완료.

### 변환 패턴
1. `Colors` import 제거, `useTheme` + `ThemeColors` import 추가
2. 컴포넌트 내부에 `const { colors } = useTheme()` + `useMemo(() => createStyles(colors), [colors])`
3. 하단 `const styles = StyleSheet.create(...)` → `function createStyles(colors: ThemeColors) { return StyleSheet.create(...); }`
4. 모든 `Colors.light.X` → `colors.X` 치환
5. 하드코딩 `#FFF`/`#FFFFFF` — 프라이머리 배경 위 흰색 텍스트는 유지, 배경/서피스용은 `colors.surface`로 변환
6. 하드코딩 에러색 `#f87171` → `colors.error`, 성공색 `#22c55e` → `colors.success`

### 특이사항
- `index.tsx`: TrendBadge 컴포넌트에 `colors` prop 추가 (독립 함수 → 테마 의존)
- `alarms.tsx`: Switch thumbColor `#f4f3f4` → `colors.surfaceVariant`
- `voices.tsx`: getStatusBadge 함수 내 Colors.light 참조도 colors로 전환
- `people.tsx`: 27개 Colors.light 참조 전부 치환

## 변경 파일 (4개)
1. `apps/mobile/app/(tabs)/index.tsx` — 홈 탭 다크모드 적용 (~37개 색상 참조 변환)
2. `apps/mobile/app/(tabs)/alarms.tsx` — 알람 탭 다크모드 적용 (~26개 색상 참조 변환)
3. `apps/mobile/app/(tabs)/voices.tsx` — 음성 탭 다크모드 적용 (~20개 색상 참조 변환)
4. `apps/mobile/app/(tabs)/people.tsx` — 내 사람들 탭 다크모드 적용 (~27개 색상 참조 변환)

## 검증
- Mobile typecheck: ✅ 통과
- Backend typecheck: ✅ 통과
- `Colors.light` 참조 카운트: 4개 파일 모두 0개 (grep 확인)

## 다음 루프
P5 다크모드 Batch 2: 스택 화면 (character/index.tsx, library/index.tsx, alarm/create.tsx, alarm/edit.tsx 등)에 동일 패턴 적용.
