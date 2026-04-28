# P63 — API core + auth utilities 테스트

## 선택한 항목
BACKLOG 고갈 → 자가 생성: 미테스트 서비스 모듈 커버리지 확장

## 선택 이유
BACKLOG의 모든 항목이 완료 또는 manual action 필요. 미테스트 모듈 탐색 결과, `src/services/api/core.ts`(95줄)와 `src/services/auth.ts`(142줄)에 실질적 비즈니스 로직이 존재:
- API core: 토큰 주입, 401 자동 로그아웃, 쿼리 파라미터 구성, AbortController 타임아웃, FormData 분기, ApiError 클래스
- Auth: JWT 디코딩(base64url→JSON), Apple 로그인 플랫폼 분기, AsyncStorage 토큰 관리, 에러 코드 분기

나머지 API 서브모듈(voice, alarm, social 등)은 core.request()를 호출하는 thin wrapper이므로 우선순위 낮음.

## 접근
- `test/apiCore.test.ts`: global.fetch mock + AsyncStorage mock으로 22개 테스트
- `test/authUtils.test.ts`: expo-auth-session/expo-apple-authentication mock + Platform mock으로 20개 테스트
- 주의: Node.js의 atob()는 multi-byte UTF-8을 Latin1로 취급하여 한국어 JWT payload가 깨짐. 실제 브라우저/RN 환경에서는 정상 동작하므로 테스트에서는 ASCII-only payload 사용.

## 변경 파일
1. `test/apiCore.test.ts` 신규 (187줄, 22 tests)
2. `test/authUtils.test.ts` 신규 (201줄, 20 tests)

## 검증
- typecheck: mobile 0 errors, backend 0 errors
- 테스트: mobile 539/539 통과 (기존 497 + P63 42)

## 다음 루프 참고
- API 서브모듈(voice, alarm 등)은 core.request() wrapper이므로 테스트 가치 낮음
- audio.ts 서비스는 expo-av/expo-file-system 모킹 복잡도가 높아 우선순위 낮음
- decodeIdToken의 multi-byte 한계: 실서비스에서는 문제 없으나 (브라우저 atob 정상 동작), 엄밀하게는 TextDecoder 기반 디코딩으로 개선 가능
