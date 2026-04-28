# P2: Character API 확장 — streak/stats/achievements 통합

## BACKLOG 항목
- P2 백엔드: API 확장 (GET /characters/me + POST /characters/xp)

## 접근

### CharacterRow 인터페이스 확장
- `current_streak`, `longest_streak`, `last_wakeup_date` 필드 추가
- `rowToCharacter()`에서 새 컬럼 매핑 (DB null → 기본값 0/null)

### GET /characters/me 응답 확장
- `serializeCharacter(row, stats, achievements)` 시그니처로 변경
- 응답에 `streak`, `stats`, `achievements` 3개 섹션 추가
- `loadStats(db, characterId)`: character_stats 테이블에서 능력치 조회
- `loadAchievements(db, characterId)`: streak_achievements 테이블에서 마일스톤 기록 조회
- 두 쿼리는 `Promise.all`로 병렬 실행

### POST /characters/xp 스트릭 통합
- `local_date` 파라미터 추가 (YYYY-MM-DD 형식, 미전송 시 서버 UTC 기준)
- `alarm_completed` 이벤트 시:
  1. `computeStreak()` 호출 → 스트릭 계산
  2. `characters` 테이블에 streak 3개 컬럼 업데이트
  3. 마일스톤 달성 시 → `streak_bonus_N` XP 이벤트 자동 발동 (중복 방지: streak_achievements 테이블 확인)
  4. `character_stats` 행 갱신 (diligence+1, consistency+1) — ensureStatsRow로 첫 행 자동 생성
- 멱등성 응답에도 stats/achievements 포함하도록 수정
- 응답에 `milestone_grants` 필드 추가 (마일스톤 보너스 발생 시)

### 헬퍼 함수
- `loadStats()`: character_stats 쿼리 → CharacterStats 반환
- `loadAchievements()`: streak_achievements 쿼리 → StreakAchievementRow[] 반환
- `ensureStatsRow()`: INSERT OR IGNORE로 첫 행 생성
- `StreakAchievementRow` 인터페이스 추가

## 변경 파일
1. `packages/backend/src/routes/character.ts` — API 확장 (유일한 변경 파일)

## 검증
- `npx tsc --noEmit` 통과 (backend + mobile 모두)

## 다음 루프 주의사항
- 프론트엔드 캐릭터 화면 강화가 다음 작업 (apps/mobile/app/character/index.tsx)
- API 응답 구조가 변경되었으므로 모바일 `CharacterResponse` 타입을 업데이트해야 함
- `streak.current`, `streak.longest`, `stats.diligence/health/consistency`, `achievements[]` 필드를 프론트에서 표시
