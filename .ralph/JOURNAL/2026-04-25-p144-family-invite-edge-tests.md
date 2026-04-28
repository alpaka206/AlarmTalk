# P144 — family-invite.ts 엣지 케이스 테스트 10개 추가

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 "백엔드 테스트 커버리지 확장" 선택.
family-invite.ts가 가장 낮은 테스트 밀도(0.12 tests/line)를 보여 엣지 케이스 보강.

## 작업 내역

### POST /family/invites — 엣지 케이스 5건
- 비문자열 `plan_group_id` (숫자) → 빈 값 취급 → auto-resolve 동작 확인
- 공백만 있는 `plan_group_id` → 빈 값 취급 → auto-resolve 동작 확인
- `max_members: null` → 기본값 6으로 폴백, 5명이면 허용
- `max_members: null` + 슬롯 6 사용 → GROUP_FULL 반환
- `plan_group_id` 앞뒤 공백 trim 동작 확인

### POST /family/invites/:code/accept — 엣지 케이스 6건
- `expires_at`가 유효하지 않은 날짜 문자열 → `Number.isFinite(NaN)=false` → 만료 체크 건너뜀 → accept 허용
- `max_members: null` → 기본값 6 폴백, 5명이면 accept 허용
- `max_members: null` + 6명 → GROUP_FULL 반환
- 코드 파라미터 공백 trim 동작 확인
- INSERT/UPDATE SQL 호출 시 올바른 plan_group_id, user_id, role 전달 검증
- pending 상태이지만 expires_at 과거 → DB에 'expired' 상태 UPDATE 실행 확인

### POST /family/invites/:code/revoke — 엣지 케이스 2건
- 'expired' 상태 초대 revoke 시도 → NOT_PENDING 반환
- 코드 파라미터 공백 trim 동작 확인

## 변경 파일 (1개)
1. `packages/backend/test/family-invite.test.ts` — 33→43 tests (+10)

## 검증
- family-invite 테스트: 43/43 통과
- 전체 백엔드 테스트: 1185/1185 통과
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- family-invite.ts 밀도: 0.12→0.16 tests/line으로 개선
- 발견: `expires_at`가 유효하지 않은 문자열일 때 만료 검증이 건너뛰어지는 동작 확인 — 의도적 설계인지 확인 필요 (보안 이슈 가능성)
- 남은 낮은 밀도 라우트: gift.ts (0.14), family-group.ts (0.13)
