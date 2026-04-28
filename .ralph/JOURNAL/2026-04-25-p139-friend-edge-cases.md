# P139 — friend.ts 라우트 엣지 케이스 테스트 추가

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 "백엔드 테스트 커버리지 확장" 선택.
P137 저널에서 "가장 비즈니스 로직이 밀도 높은 미보강 대상: friend.test.ts" 참조.

## 추가한 테스트 케이스

### friend.test.ts (+8 tests → 32 total, 기존 23+1=24에서 +8)

1. **거절된 관계가 있어도 새 요청 가능** — status가 'rejected'이면 accepted/pending 분기에 걸리지 않아 INSERT 허용됨 (line 42-50)
2. **역방향 friendship이 이미 pending이면 409** — SQL이 양방향(user_a↔user_b) 모두 체크하는지 검증 (line 36-40)
3. **target_email과 target_name이 응답에 포함** — 201 응답의 friendship 객체 필드 완전성 검증 (line 58-66)
4. **PATCH /:id/accept — 유효하지 않은 UUID 형식이면 400** — UUID_RE 검증 분기 (line 165-167)
5. **DELETE /:id — 유효하지 않은 UUID 형식이면 400** — UUID_RE 검증 분기 (line 205-207)
6. **GET /list — 비숫자 limit이면 기본값 20** — parseInt 폴백 검증 (line 83)
7. **GET /list — 음수 offset이면 0으로 클램핑** — Math.max 검증 (line 84)
8. **GET /list — total이 null이면 0 처리** — Number(null ?? 0) 검증 (line 117)

## 변경 파일 (1개, 수정)
1. `packages/backend/test/friend.test.ts` — 8 tests 추가 (24 → 32)

## 검증
- friend.test.ts: 32/32 통과
- 전체 backend: 1107/1107 통과 (1099 → 1107, +8)
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- P137에서 언급한 나머지 미보강 대상: family-group.test.ts, tts.test.ts
- family-group.ts는 초대코드 생성/가입/탈퇴 등 복잡한 분기가 많아 엣지 케이스 보강 가치 높음
