# P103 — Auth 미들웨어 단위 테스트 24건 추가

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 "백엔드 테스트 커버리지 확장" 선택.
보안 핵심 코드인 auth 미들웨어(`src/middleware/auth.ts`)가 유일하게 전용 테스트 없음을 발견 → 테스트 작성.

## 판단 기록
- 기존 `test/auth.test.ts`는 auth 라우트(`src/routes/auth.ts`) 테스트이며, 미들웨어(`src/middleware/auth.ts`)의 토큰 검증 로직은 별도 테스트가 없었음
- alarm-mutation, billing-mutation 등은 aggregator 테스트(alarm.test.ts, billing.test.ts)에서 이미 간접 커버됨 → 신규 테스트 불필요
- auth 미들웨어는 모든 보호 라우트의 게이트키퍼이므로 테스트 우선순위가 가장 높다고 판단

## 작업 내역

### auth-middleware.test.ts (24 tests)

**Authorization header 검증 (5건)**
- Authorization 헤더 누락 → AUTH_MISSING
- Bearer 스킴 아님 → AUTH_INVALID_SCHEME
- Bearer 뒤 공백만 (헤더 trim) → AUTH_INVALID_SCHEME
- 토큰 3파트 아님 → AUTH_MALFORMED_TOKEN
- 토큰 2파트만 → AUTH_MALFORMED_TOKEN

**App JWT 경로 (6건)**
- 유효한 앱 JWT → context에 사용자 정보 설정
- 서명 검증 실패 → AUTH_VERIFICATION_FAILED
- 만료 → AUTH_TOKEN_EXPIRED
- audience 불일치 → AUTH_AUDIENCE_MISMATCH
- issuer 불일치 → AUTH_INVALID_ISSUER
- name 없는 JWT → userName="" 정상 처리

**Google 토큰 경로 (5건)**
- 유효한 Google 토큰 → userId/email/name/picture 설정
- Google API 에러 → 401
- audience 불일치 → AUTH_AUDIENCE_MISMATCH
- 만료 → AUTH_TOKEN_EXPIRED
- fetch 네트워크 에러 → 401

**Apple 토큰 경로 (3건)**
- 유효한 Apple 토큰 → userId/email 설정, name/picture 빈 문자열
- 만료 → AUTH_TOKEN_EXPIRED
- email 없는 Apple 토큰 → userEmail="" 정상 처리

**토큰 발급자 분기 (3건)**
- 알 수 없는 issuer → Google 경로 (fetch 호출)
- voice-alarm issuer → 앱 JWT 경로 (verifyAppJwt 호출)
- appleid.apple.com issuer → Apple 경로 (fetch 미호출)

**base64url 엣지 케이스 (2건)**
- 패딩 없는 base64url 정상 디코딩
- payload JSON 파싱 실패 → 401

## 모킹 전략
- `verifyAppJwt`: vi.mock으로 모듈 모킹 (앱 JWT 검증)
- `fetch`: globalThis.fetch 교체 (Google 토큰 검증)
- Apple 토큰: 외부 호출 없이 JWT payload 디코딩만 수행 → 모킹 불필요

## 변경 파일 (1개, 신규)
1. `packages/backend/test/auth-middleware.test.ts`

## 검증
- 신규 테스트: 24/24 통과
- 전체 테스트: 872/872 통과 (848 → 872, +24)
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- auth 미들웨어 테스트 완료로 보안 핵심 경로 커버리지 확보
- 남은 미테스트 영역: `lib/db.ts` (최소 로직, getDB 싱글톤 패턴만 — 낮은 우선순위)
- 다음 후보: 모바일 테스트 확장, 문서화 정비, 성능 최적화
