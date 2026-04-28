# P134 — OfflineBanner 테스트 실패 수정 + 테스트 mock 패턴 개선

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 8에 따라 빌드 복구 우선 — 모바일 테스트 1개 실패 발견 즉시 수정.

## 문제 원인
P122 (디자인 토큰 마이그레이션)에서 `OfflineBanner.tsx`의 텍스트 color가 하드코딩 `#FFFFFF` → `colors.textOnPrimary`로 변경됨.
그러나 `test/OfflineBanner.test.tsx`의 `useTheme` mock에 `textOnPrimary` 속성이 누락되어 `undefined`로 렌더링 → 색상 assertion 실패.

## 작업 내역

### 1. OfflineBanner.test.tsx 실패 수정
- `useTheme` mock에 `textOnPrimary: '#FFFFFF'` 추가 → 테스트 통과

### 2. 동일 패턴 잠재 버그 예방 (3개 파일)
다른 테스트 파일에서도 `useTheme` mock이 `ThemeColorScheme` 전체를 하드코딩하고 있어 동일 문제 재발 가능.
3개 파일을 `jest.requireActual('../src/constants/theme')`로 리팩토링:
- `test/OfflineBanner.test.tsx`
- `test/PeopleSkeletonCard.test.tsx`
- `test/QueryStateView.test.tsx`

**변경 전**: 17개 색상 속성을 각 파일마다 인라인 하드코딩
**변경 후**: `Colors.light` 실제 객체를 참조 — 새 속성 추가 시 자동 반영

### 3. README.md 테스트 수 보정
- `모바일: 1044 → 1060` (P129~P133에서 테스트 추가된 분량 반영)

## 변경 파일 (4개)
1. `apps/mobile/test/OfflineBanner.test.tsx` — mock 패턴 변경
2. `apps/mobile/test/PeopleSkeletonCard.test.tsx` — mock 패턴 변경
3. `apps/mobile/test/QueryStateView.test.tsx` — mock 패턴 변경
4. `README.md` — 테스트 수 보정

## 검증
- Mobile: 60 suites, 1060 tests 전체 통과
- Backend: 58 suites, 1093 tests 전체 통과
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- BACKLOG에 남은 미완료 항목은 모두 manual/blocked (렌더링 확인, wrangler deploy, Sentry DSN)
- Section 4에 따라 새 항목 선정 필요
- 코드 베이스 매우 성숙 — 잠재적 작업: Maestro E2E 추가 플로우, 의존성 업데이트 감사, 번들 크기 분석
