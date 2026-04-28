# P108 — LoginButtons 컴포넌트 렌더링 테스트 (18 tests)

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 "테스트 커버리지 확장" 선택.
STATE.md에 명시된 마지막 미테스트 컴포넌트 LoginButtons에 대한 전체 렌더링 테스트 작성.

## 작업 내역

### 0. 기술적 도전
LoginButtons는 auth 의존성이 깊어 P107에서 "별도 iteration 권장"으로 미뤄진 컴포넌트:
- `useGoogleAuth` (expo-auth-session 기반 훅)
- `signInWithApple` (expo-apple-authentication)
- `useAppStore` (zustand)
- `Alert.alert` (RN)
- `TouchableOpacity` (Animated 사용 → react/renderer 버전 불일치 이슈)

### 1. Animated 버전 불일치 해결
- `TouchableOpacity`의 내부 opacity 애니메이션이 `ReactNativeRenderer`를 로드하며 react 19.2.5 vs renderer 19.1.0 충돌 발생
- 해결: `Animated.timing` + `Animated.loop`을 jest.spyOn으로 stub 처리 (PeopleSkeletonCard 패턴 재사용)

### 2. render() inside act() 이슈
- `@testing-library/react-native` + React 19에서 `render()` 내부가 이미 act() 래핑됨
- `await act(async () => { render(...) })` → "Can't access .root on unmounted test renderer" 에러
- 해결: useEffect 기반 테스트(response 시나리오)는 `render()` + `waitFor()` 패턴으로 변경
- fireEvent.press 기반 테스트는 `render()` 후 `await act(async () => { fireEvent.press() })` 유지

### 3. LoginButtons.test.tsx (18 tests)
**렌더링 (4):**
- Google 버튼 렌더 확인
- Apple 인증 불가 시 Apple 버튼 미표시
- Apple 인증 가능 시 Apple 버튼 표시
- request null 시 Google 버튼 비활성화

**Google 로그인 (7):**
- promptAsync 호출 확인
- promptAsync 실패 → Alert
- 성공 응답 → saveAuthToken + setAuth
- id_token 없는 성공 → Alert
- 에러 응답 → 에러 메시지 Alert
- 에러 응답 message 없음 → unknownError Alert
- dismiss 응답 → Alert 미호출

**Apple 로그인 (3):**
- 성공 → saveAuthToken + setAuth
- null 반환 (취소) → 무작업
- 실패 → Alert

**Edge cases (2):**
- saveAuthToken 실패 → saveFailed Alert
- decodeIdToken null → setAuth 미호출

**접근성 (2):**
- Google 버튼 accessibilityRole="button"
- Apple 버튼 accessibilityRole="button"

## 변경 파일 (1개)

### 신규 (1개)
1. `apps/mobile/test/LoginButtons.test.tsx` — 18 tests

## 검증
- 신규 테스트: 18/18 통과
- 전체 모바일 테스트: 819/819 통과 (801 + 18)
- 전체 백엔드 테스트: 변경 없음 (872)
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- LoginButtons는 마지막 미테스트 컴포넌트였음 → 모든 src/components/ 파일에 대한 테스트 완비
- lib/db.ts만 미테스트 (최소 로직, re-export만 → 테스트 가치 낮음)
- Animated 관련 테스트 패턴 정립: `jest.spyOn(Animated, 'timing')` + `waitFor` (act 이중 래핑 금지)
