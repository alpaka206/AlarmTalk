# P137 — code.ts 라우트 엣지 케이스 테스트 추가

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 "백엔드 테스트 커버리지 확장" 선택.
기존 code.test.ts (22 tests)에 누락된 엣지 케이스 6개 추가.

## 추가한 테스트 케이스

### code.test.ts (+6 tests → 28 total)
1. **code가 숫자 등 비문자열이면 400 CODE_REQUIRED** — `typeof body.code === 'string'` 분기 검증
2. **상태가 expired인 초대 코드 409** — invite path의 `status === 'expired'` 분기 (기존에는 날짜 기반 만료만 테스트됨)
3. **max_members null 시 기본값 6 적용 — 5명이면 가입 허용** — `Number(...) || 6` 폴백 검증
4. **max_members null + 6명이면 정원 초과** — 폴백 기본값 경계 검증
5. **알 수 없는 plan_type → user plan "free"로 업데이트** — `planTypeToUserPlan` 기본 분기
6. **period_days 누락 시 기본값 30일 적용** — `Number(plan.period_days) || 30` 폴백 검증

## 사전 조사
- 모든 백엔드 라우트 파일(30개)에 대응하는 테스트 파일이 이미 존재함을 확인
- 모든 모바일 hook/service 파일에도 테스트 존재
- 탐색 에이전트의 "미테스트" 보고가 부정확했음 (파일명 매칭 방식의 한계)

## 변경 파일 (1개, 수정)
1. `packages/backend/test/code.test.ts` — 6 tests 추가 (22 → 28)

## 검증
- code.test.ts: 28/28 통과
- 전체 backend: 1099/1099 통과 (1093 → 1099, +6)
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- 모든 라우트+서비스 파일에 테스트 존재. 테스트 커버리지 확장은 기존 테스트 파일의 엣지 케이스 보강으로 진행해야 함
- 가장 비즈니스 로직이 밀도 높은 미보강 대상: friend.test.ts, family-group.test.ts, tts.test.ts
