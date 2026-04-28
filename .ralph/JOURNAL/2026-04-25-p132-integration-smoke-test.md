# P132 — Backend Integration Smoke Test

## 선택한 항목
Section 4 규칙 적용: 개별 라우트 테스트는 완벽하나 전체 앱 라우팅 와이어링을 검증하는 통합 스모크 테스트가 부재 → 추가

## 작업 내역

### integration-smoke.test.ts (25 tests)
전체 앱(index.ts)을 import하여 실제 라우트 마운팅, 미들웨어 체인, 보안 헤더, CORS를 검증.

#### Health & Public Routes (4 tests)
- GET / → 200 + DB ok
- GET / → DB 실패 시 degraded 상태
- GET /api/tts/presets → 200 프리셋 목록 (인증 불필요)
- POST /api/init-db → 200

#### Auth Routes (2 tests)
- POST /api/auth/register → 이메일 누락 시 400
- POST /api/auth/login → 잘못된 이메일 시 401

#### Protected Routes — 인증 없이 401 (15 tests)
15개 보호된 엔드포인트 모두 인증 없이 요청 시 AUTH_MISSING 코드와 함께 401 반환 확인:
voice, tts, alarm, user, library, friend, gift, stats, dub, billing, family, characters, push, code, notes

#### Security & CORS (4 tests)
- 보안 헤더 (X-Content-Type-Options, X-Frame-Options) 포함 확인
- CORS 허용 origin (localhost:8081) 응답 확인
- /api 외부 404 확인
- /api 내부 미인증 시 401 (auth 우선 실행) 확인

## 변경 파일 (1개)
1. `packages/backend/test/integration-smoke.test.ts` (신규)

## 검증
- 25/25 테스트 통과
- 전체 백엔드 테스트 스위트: 1093/1093 통과 (58 파일)
- typecheck: 0 errors

## 다음 루프 참고
- 백엔드 테스트 수 1068 → 1093 (+25)
- 이 테스트는 라우트 추가/삭제 시 와이어링 누락을 즉시 감지
