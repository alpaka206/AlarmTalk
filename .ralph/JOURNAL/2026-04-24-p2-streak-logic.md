# P2: 스트릭 로직 + XP 규칙 + 능력치 함수 구현

## BACKLOG 항목
- P2 백엔드: 스트릭 로직 (streak.ts, xpRules.ts 확장, character.ts 능력치)

## 접근

### streak.ts (신규)
- `computeStreak(lastWakeupDate, todayDate, currentStreak)` → `{ newStreak, isNewDay, milestoneReached }`
- gap=0: 동일 날짜 재호출 → 변경 없음, milestoneReached=null
- gap=1: 연속 → streak+1, 7/30/90 도달 시 milestone 반환
- gap≥2: 리셋 → streak=1
- lastWakeupDate=null(첫 호출): streak=1
- `MILESTONE_BONUS_XP` 상수 export (7→100, 30→500, 90→2000)
- 날짜 비교는 `YYYY-MM-DD` 문자열 → UTC Date 변환 후 86400000ms 단위 차이 계산

### xpRules.ts (확장)
- `XpEvent` 유니온에 `streak_bonus_7 | streak_bonus_30 | streak_bonus_90` 추가
- XP_TABLE에 100/500/2000 매핑
- AFFECTION_TABLE에 0 매핑 (스트릭 보너스는 애정도 영향 없음)
- `CAP_EXEMPT` 맵 + `isCapExempt()` 함수 추가
- `computeGrant()`에서 cap exempt 이벤트는 applyDailyXpCap 우회 → 전액 지급

### character.ts (확장)
- `CharacterStats` 인터페이스: diligence, health, consistency
- `computeStats(alarmCompletions, routineCompletions, activeDays)`: 단순 floor + max(0, ...)

## 변경 파일
1. `packages/backend/src/lib/streak.ts` — 신규
2. `packages/backend/src/lib/xpRules.ts` — 3개 이벤트 + cap exempt 로직
3. `packages/backend/src/lib/character.ts` — CharacterStats + computeStats

## 검증
- `npx tsc --noEmit` 통과 (backend)
- 기존 테스트 없음 (xpRules.test.ts 미존재)

## 다음 루프 주의사항
- API 확장(character.ts routes)에서 computeStreak을 POST /characters/xp에 통합해야 함
- local_date 파라미터를 클라이언트가 전송하도록 API 설계 필요
- streak_achievements 테이블에 마일스톤 기록 INSERT 로직도 라우트에서 처리
- character_stats 갱신도 라우트에서 처리 (alarm_completed → diligence+1, consistency+1)
