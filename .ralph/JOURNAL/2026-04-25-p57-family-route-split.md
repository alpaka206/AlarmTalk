# P57 — 백엔드 family.ts 라우트 분할 (834→13줄 aggregator)

## 선택한 항목
자가 생성: backend family.ts 834줄 → 3개 모듈 + 공유 헬퍼 분할

## 접근
family.ts는 3개의 독립 도메인으로 구성:
1. **초대 관리** (POST/GET/accept/revoke invites) → `family-invite.ts` (266줄)
2. **그룹 관리** (current/leave/transfer/remove-member) → `family-group.ts` (205줄)
3. **가족 알람** (text alarm + voice alarm) → `family-alarm.ts` (292줄)

공유 로직:
- `resolveUserPk` — 모든 라우트에서 사용, `lib/family-helpers.ts`로 추출
- `assertSameGroup` — alarm 라우트 2곳에서 중복된 "같은 그룹인지 확인" 로직을 헬퍼로 추출

Hono `.route('/', subRouter)` 패턴으로 마운트하여 기존 URL 패턴 완전 보존.

## 대안 검토
- 단일 파일 유지 + region 분리 → 600줄 넘으면 IDE 탐색이 어렵고 책임 혼재
- 라우트별 완전 독립 (별도 Hono 앱 + index.ts 등록) → 기존 테스트가 `/family/*` prefix로 등록되어 있어 불필요한 변경

## 변경 파일
1. `routes/family.ts` — 834→13줄 (thin aggregator)
2. `routes/family-invite.ts` 신규 — 266줄 (초대 CRUD)
3. `routes/family-group.ts` 신규 — 205줄 (그룹 관리)
4. `routes/family-alarm.ts` 신규 — 292줄 (가족 알람)
5. `lib/family-helpers.ts` 신규 — 35줄 (resolveUserPk + assertSameGroup)

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 테스트: backend 672/672, mobile 466/466
- URL 패턴 변경 없음 (기존 테스트 전체 통과로 검증)

## 다음 루프 참고
- voice.ts (589줄), alarm.ts (536줄) 도 분할 후보이나 500줄대는 허용 범위
- api.ts (모바일, 771줄) 분할도 고려 가능
