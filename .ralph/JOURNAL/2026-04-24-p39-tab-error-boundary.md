# P39: ErrorBoundary 화면별 세분화 (탭별 독립 에러 격리)

**날짜**: 2026-04-24
**BACKLOG 항목**: 자가 생성 풀 — ErrorBoundary 화면별 세분화

## 접근

기존: `ErrorBoundary`가 루트 `_layout.tsx`에서 전체 앱을 감싸고 있음. 한 탭에서 에러 발생 시 전체 앱이 에러 화면으로 교체됨.

변경: `withErrorBoundary` HOC를 추가하여 4개 탭 화면 각각을 독립적으로 ErrorBoundary로 감쌈. 한 탭에서 에러가 발생해도 다른 탭은 정상 작동하며, 사용자는 탭바를 통해 다른 탭으로 이동 가능.

루트 레벨 ErrorBoundary는 최후의 catch-all로 유지.

## 변경 파일

| 파일 | 변경 |
|------|------|
| `src/components/ErrorBoundary.tsx` | `withErrorBoundary` HOC 추가 (displayName 포함) |
| `app/(tabs)/index.tsx` | `export default withErrorBoundary(HomeScreen)` |
| `app/(tabs)/voices.tsx` | `export default withErrorBoundary(VoicesScreen)` |
| `app/(tabs)/alarms.tsx` | `export default withErrorBoundary(AlarmsScreen)` |
| `app/(tabs)/compose.tsx` | `export default withErrorBoundary(ComposeScreen)` |
| `test/errorBoundary.test.ts` | `withErrorBoundary` HOC 테스트 3건 추가 |

## 검증

- backend `npx tsc --noEmit` — 0 errors
- mobile `npx tsc --noEmit` — 0 errors
- backend tests: 653/653 passed
- mobile tests: 395/395 passed (기존 392 + 신규 3)

## 다음 루프

자가 생성 풀에서 다음 항목 선택. 후보:
- 백엔드 API 응답 시간 벤치마크 테스트
- 모바일 번들 사이즈 모니터링
- 모바일 화면 컴포넌트 인터랙션 테스트
