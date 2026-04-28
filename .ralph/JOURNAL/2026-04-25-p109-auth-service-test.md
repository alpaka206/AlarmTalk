# P109 — auth.ts 서비스 테스트 (22 tests)

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 "테스트 커버리지 확장" 선택.
`apps/mobile/src/services/auth.ts`가 유일하게 테스트 파일 없는 서비스 모듈로 식별됨.

## 작업 내역

### 0. 기술적 도전
auth.ts는 expo-auth-session, expo-web-browser, expo-apple-authentication 등 네이티브 모듈 의존성이 깊음.
Jest 환경에서 `ExpoWebBrowser` 네이티브 모듈 미존재 에러 발생 → expo-web-browser + expo-auth-session mock 추가로 해결.

### 1. auth.test.ts (22 tests)

**decodeIdToken (6):**
- 유효한 JWT 전체 필드 디코딩
- sub만 있는 JWT (나머지 undefined)
- base64url 인코딩 문자 처리
- 3파트 아닌 토큰 → null (2파트, 1파트, 빈 문자열)
- 유효하지 않은 base64 → null
- JSON 아닌 페이로드 → null

**saveAuthToken (2):**
- Google 프로바이더 저장 확인
- Apple 프로바이더 저장 확인

**getAuthToken (2):**
- 저장된 토큰 반환
- 미설정 시 null 반환

**getAuthProvider (2):**
- 저장된 프로바이더 반환
- 미설정 시 null 반환

**signOut (1):**
- auth_token, auth_provider, user_id 3개 키 모두 삭제 확인

**isAppleAuthAvailable (2):**
- iOS → true
- Android → false

**signInWithApple (7):**
- 성공 → idToken + user(id, email, name) 반환
- fullName null → name null
- familyName null → givenName만 (trim)
- identityToken 없음 → null
- ERR_REQUEST_CANCELED → null (취소)
- 기타 에러 → throw
- Android → null

## 변경 파일 (1개)

### 신규 (1개)
1. `apps/mobile/test/auth.test.ts` — 22 tests

## 검증
- 신규 테스트: 22/22 통과
- 전체 모바일 테스트: 841/841 통과 (819 + 22)
- 전체 백엔드 테스트: 변경 없음 (872)
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- 모든 services/ 파일에 대한 테스트 완비 (auth.ts가 마지막 미테스트 서비스)
- 유일한 미테스트: lib/db.ts (최소 로직, re-export만)
- 백엔드 split-route 파일(alarm-mutation, billing-query 등)은 parent aggregator를 통해 이미 커버됨
