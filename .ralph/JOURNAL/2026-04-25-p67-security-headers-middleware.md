# P67 — Security Response Headers Middleware

## 선택한 항목
BACKLOG 고갈 → 자가 생성: 백엔드 보안 헤더 미들웨어 추가

## 선택 이유
BACKLOG 전체 완료. 보안 감사 결과, rate limiting/bcrypt/Zod validation/parameterized SQL/CORS는 모두 구현되어 있으나 OWASP 권장 보안 응답 헤더가 누락되어 있었음. Cloudflare Workers는 기본 보안 헤더를 자동 추가하지 않으므로 명시적 설정 필요.

## 접근
기존 middleware 패턴(bodyLimit, rateLimit 등)을 따라 securityHeadersMiddleware 구현. `await next()` 후 응답에 헤더를 추가하는 방식으로 모든 라우트에 일괄 적용.

### 추가된 9개 보안 헤더
1. **X-Content-Type-Options: nosniff** — MIME 타입 스니핑 차단
2. **X-Frame-Options: DENY** — clickjacking 방지
3. **Referrer-Policy: strict-origin-when-cross-origin** — referrer 정보 누출 최소화
4. **X-DNS-Prefetch-Control: off** — DNS 프리페치 비활성화
5. **X-Download-Options: noopen** — IE 다운로드 자동 실행 방지
6. **X-Permitted-Cross-Domain-Policies: none** — Flash/PDF 크로스 도메인 정책 차단
7. **Permissions-Policy: camera=(), microphone=(), geolocation=()** — 브라우저 기능 비활성화
8. **Strict-Transport-Security: max-age=63072000; includeSubDomains** — HTTPS 강제 (2년)
9. **Content-Security-Policy: default-src 'none'; frame-ancestors 'none'** — 리소스 로드 차단

### 대안 검토
- hono/secure-headers 내장 미들웨어: 존재하지만 커스텀 설정이 더 명시적이고 Permissions-Policy 등을 세밀하게 제어 가능
- Cloudflare 페이지 룰: Workers에서는 적용 불가

## 변경 파일
1. `packages/backend/src/middleware/securityHeaders.ts` 신규 (16줄)
2. `packages/backend/src/middleware/securityHeaders.test.ts` 신규 (12 tests)
3. `packages/backend/src/index.ts` — import + middleware 등록 (sentryMiddleware 앞에 배치)

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 테스트: backend 684/684 통과 (기존 672 + P67 12), mobile 625/625 (변경 없음)

## 다음 루프 참고
- 보안 헤더는 모든 응답에 적용됨 (GET/POST/OPTIONS 포함)
- API-only 서비스이므로 CSP `default-src 'none'`이 적절. 웹 프론트엔드 서빙 시에는 script-src/style-src 등 완화 필요
- Permissions-Policy에서 camera/microphone을 차단했는데, 이는 API 서버이므로 문제 없음. 모바일 앱은 네이티브 권한 사용.
