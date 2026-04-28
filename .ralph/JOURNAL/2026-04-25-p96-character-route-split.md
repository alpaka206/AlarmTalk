# P96 — character.ts 라우트 분할

## 선택한 항목
BACKLOG 잔여 항목 모두 blocked/manual. Section 4에 따라 "코드 품질 개선" 선택.
`character.ts` (405줄)이 STATE.md에서 명시된 분할 대상. P94(voice.ts)/P95(alarm.ts) 패턴 적용.

## 접근

### character.ts 분할 (405줄 → 11줄 aggregator)
- **character-helpers.ts** (168줄): 타입 정의(CharacterRow, StreakAchievementRow) + 유틸리티 함수 9개 (resolveUserPk, rowToCharacter, loadOrCreateCharacter, buildProgress, serializeCharacter, loadStats, loadAchievements, ensureStatsRow, todayString)
- **character-query.ts** (30줄): GET /characters/me — 읽기 전용 엔드포인트
- **character-mutation.ts** (215줄): POST /characters/xp — XP 지급 + 스트릭 + 마일스톤 처리
- **character.ts** (11줄): Hono.route() 마운트 + loadOrCreateCharacter 재내보내기

### 설계 결정
- helpers를 별도 파일로 분리한 이유: resolveUserPk, loadOrCreateCharacter, serializeCharacter, loadStats, loadAchievements 등이 query와 mutation 양쪽에서 공유됨
- loadOrCreateCharacter를 character.ts에서 re-export: 테스트 파일 3개에서 `../src/routes/character` 경로로 import하므로 기존 import 경로 유지

## 변경 파일 (4개)

### 신규 (3개)
1. `packages/backend/src/routes/character-helpers.ts` — 타입 + 유틸리티 함수 (168줄)
2. `packages/backend/src/routes/character-query.ts` — 읽기 엔드포인트 (30줄)
3. `packages/backend/src/routes/character-mutation.ts` — 쓰기 엔드포인트 (215줄)

### 수정 (1개)
4. `packages/backend/src/routes/character.ts` — 405줄 → 11줄 thin aggregator

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 테스트: backend 780/780 통과 (기존 테스트 변경 없이 통과 — import 경로 동일)

## 다음 루프 참고
- 남은 대형 파일: billing.ts (378줄) — 같은 패턴으로 분할 가능
