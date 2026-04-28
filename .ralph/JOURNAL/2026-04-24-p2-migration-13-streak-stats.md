# P2: Migration 13 — character-streak-stats

## BACKLOG 항목
P2 백엔드 DB 스키마 (마이그레이션 13)

## 접근
STATE.md의 "다음 루프 지시"를 따라 P2 첫 단계 진행.
기존 migration 12 패턴(ALTER TABLE + CREATE TABLE)을 그대로 답습.

### 변경 내용
`packages/backend/src/lib/migrations.ts` — migration 13 추가:
1. `characters` 테이블에 3개 컬럼 추가:
   - `current_streak INTEGER NOT NULL DEFAULT 0`
   - `longest_streak INTEGER NOT NULL DEFAULT 0`
   - `last_wakeup_date TEXT` (YYYY-MM-DD, nullable)
2. `character_stats` 테이블 신규:
   - `character_id` (UNIQUE, FK → characters)
   - `diligence`, `health`, `consistency` (모두 INTEGER, 기본 0)
   - 나무 메타포: 뿌리깊이=diligence, 줄기튼튼함=health, 잎무성함=consistency
3. `streak_achievements` 테이블 신규:
   - `character_id` (FK → characters)
   - `milestone` (7/30/90)
   - `bonus_xp` (100/500/2000)
   - (character_id, milestone) UNIQUE — 중복 달성 방지

### 대안 고려
- `last_wakeup_date`를 NOT NULL + DEFAULT ''로 할지 고민 → nullable이 더 명확 (아직 기상한 적 없음을 구분)
- `character_stats`를 characters에 직접 컬럼으로 추가할지 → 별도 테이블이 확장성 있음 (추후 능력치 추가 시 마이그레이션 불필요)
- `streak_achievements`에 `achieved_at`만 두고 `bonus_xp`는 코드에서 계산할지 → 기록 시점의 보너스 값을 보존하는 것이 감사(audit)에 유리

## 검증
- `cd packages/backend && npx tsc --noEmit` → 통과
- `cd apps/mobile && npx tsc --noEmit` → 통과

## 다음 루프 주의사항
- 다음 단계: `packages/backend/src/lib/streak.ts` 신규 — `computeStreak()` 함수 구현
- `computeStreak(lastWakeupDate, todayDate, currentStreak)` → `{ newStreak, milestoneReached }`
- CharacterRow 인터페이스에 streak 필드 추가 필요 (routes/character.ts:14)
- xpRules.ts에 streak_bonus_7/30/90 이벤트 추가 필요 (일일캡 면제)
