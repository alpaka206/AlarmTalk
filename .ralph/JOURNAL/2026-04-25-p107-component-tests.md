# P107 — 모바일 컴포넌트 테스트 추가 (OfflineBanner, QueryStateView, PeopleSkeletonCard)

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 "테스트 커버리지 확장" 선택.
STATE.md에 명시된 미테스트 컴포넌트 4개 중 3개에 대한 렌더링 테스트 작성.

## 작업 내역

### 0. 테스트 인프라
- `@testing-library/react-native` 설치 (devDependency)
- 기존 `react-test-renderer@19.1.0` (jest-expo 번들)과 `react@19.2.5` 간 버전 불일치 발견
  - `Animated.View` 렌더링 시 native renderer 진입하면서 충돌
  - 해결: Animated.loop/sequence/timing을 jest.spyOn으로 stub 처리

### 1. OfflineBanner.test.tsx (4 tests)
- 온라인일 때 null 렌더 확인
- 오프라인일 때 배너 텍스트 표시 확인
- 경고 색상(#FF9500) 포함 확인
- 연결 상태 변경 시 재렌더 반응 확인

### 2. QueryStateView.test.tsx (8 tests)
- 기본 에러 제목 + 이모지 표시
- message prop 유무에 따른 부제목 표시/미표시
- onRetry prop 유무에 따른 재시도 버튼 표시/미표시
- 재시도 버튼 탭 시 콜백 호출
- message + onRetry 조합 표시
- 접근성 라벨 설정 확인

### 3. PeopleSkeletonCard.test.tsx (7 tests)
- 기본값 3개 행 렌더
- count prop으로 행 수 지정 (5개, 1개, 0개)
- pulse 애니메이션 루프 시작 확인
- 각 행의 플레이스홀더 자식 구조 검증
- React.memo 래핑 확인 ($$typeof === Symbol.for('react.memo'))

### 미테스트 (향후 작업)
- LoginButtons — auth service 의존성 깊음 (useGoogleAuth, signInWithApple 등 모킹 복잡). 별도 iteration 권장.

## 변경 파일 (4개)

### 신규 (3개)
1. `apps/mobile/test/OfflineBanner.test.tsx` — 4 tests
2. `apps/mobile/test/QueryStateView.test.tsx` — 8 tests
3. `apps/mobile/test/PeopleSkeletonCard.test.tsx` — 7 tests

### 수정 (1개)
4. `apps/mobile/package.json` — `@testing-library/react-native` devDependency 추가

## 검증
- 신규 테스트: 19/19 통과
- 전체 모바일 테스트: 801/801 통과 (782 + 19)
- 전체 백엔드 테스트: 872/872 통과 (변경 없음)
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- 미테스트 컴포넌트: LoginButtons만 남음 (auth 의존성 모킹 필요)
- lib/db.ts는 최소 로직 (exports만) → 테스트 가치 낮음
- @testing-library/react-native 인프라 설치 완료 → 향후 컴포넌트 테스트 작성 용이
- react vs react-native-renderer 버전 불일치 주의 (Animated 사용 컴포넌트 테스트 시 mock 필수)
