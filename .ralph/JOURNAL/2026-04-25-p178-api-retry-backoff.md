# P178: API 요청 재시도 + 지수 백오프 구현

## BACKLOG 항목
BACKLOG 고갈 → section 4에서 "성능/안정성 강화" 후보 생성

## 배경
모바일 API core (`services/api/core.ts`)에 재시도 로직이 전혀 없었음. 네트워크 불안정이나 서버 일시 장애(5xx) 시 단일 실패로 사용자에게 에러가 노출됨. 모바일 앱 특성상 네트워크 전환(WiFi→셀룰러), 터널/엘리베이터 등 일시적 연결 불안정이 빈번하므로 자동 재시도가 필수.

## 접근
- GET 요청: 기본 2회 재시도 (총 3회 시도) — 멱등성 보장
- POST/PATCH/DELETE: 기본 재시도 없음 — 중복 생성/변경 위험
- `retry` 옵션으로 per-request 오버라이드 가능 (예: 멱등한 POST에 retry 활성화)
- 5xx 에러 + 네트워크 에러(fetch throw): 재시도 대상
- 4xx 에러(401, 422 등): 재시도 안 함 — 클라이언트 오류는 반복해도 결과 동일
- 지수 백오프 + 지터: `base * 2^attempt * (0.5 + random*0.5)` — 1차 ~1초, 2차 ~2초

### 대안 검토
- react-query/tanstack-query 도입: 장기적으로 더 나은 해결책이지만 현재 상태 관리 구조(useAppStore)와 충돌 범위가 커서 이번 iteration에서는 core 레벨 재시도만 추가
- 지수 백오프 없이 고정 딜레이: thundering herd 문제 — 지터 필수

## 수정 파일 (2개)
1. `apps/mobile/src/services/api/core.ts` — retry loop, retryDelay, isRetryable, sleep 함수 추가
2. `apps/mobile/test/apiCore.test.ts` — 재시도 관련 테스트 11개 추가 (22→33)

## 테스트 추가 (11개)
- GET 5xx 자동 재시도
- GET 네트워크 에러 재시도
- GET 최대 3회 시도 후 실패
- 4xx 에러 재시도 안 함
- 401 에러 재시도 안 함
- POST/PATCH/DELETE 기본 재시도 안 함 (각 1개)
- retry=0으로 GET 재시도 비활성화
- retry 옵션으로 POST 재시도 활성화
- 지수 백오프 딜레이 범위 검증

## 검증
- Mobile tsc --noEmit: 0 errors
- Backend tsc --noEmit: 0 errors
- Mobile jest: 2006 passed (1995→2006, +11)

## 다음 루프 참고
- 현재 재시도는 core 레벨에서만 동작. 화면 레벨에서의 "재시도" 버튼 UX는 이미 ErrorView 컴포넌트로 구현되어 있음
- react-query 도입은 별도 대형 작업으로 분리해야 함
