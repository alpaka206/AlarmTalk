# P117 — character-mutation + character-query 통합 테스트

## 선택한 항목
BACKLOG P117: character-mutation.ts와 character-query.ts 분할 모듈에 대한 직접 import 테스트 작성.

## 배경
기존 `character.test.ts`가 aggregator를 통해 33개 테스트로 주요 시나리오를 커버.
P117은 분할된 모듈을 직접 import하여 DB 쿼리 구조 검증 + 응답 매핑 정확성 + edge case 보강.

## 작업 내역

### 1. character-mutation.test.ts (26 tests)
**DB 쿼리 구조 검증:**
- resolveUserPk SQL 바인딩 (google_id)
- UPDATE characters 10개 인자 순서
- INSERT character_xp_logs 7개 인자 + client_nonce null/non-null
- ensureStatsRow INSERT OR IGNORE SQL
- UPDATE character_stats diligence/consistency 증가
- milestone check SELECT (character_id + milestone)
- milestone INSERT streak_achievements 값 정확성
- milestone xp_log — SQL에 NULL 인라인, event=streak_bonus_*

**이벤트별 XP/affection 검증:**
- family_alarm_received: 10xp, 3 affection
- event 타입이 숫자/빈문자열 → UNSUPPORTED_EVENT

**스트릭 비즈니스 로직:**
- non-alarm event → stats 업데이트 없음 검증
- alarm_completed isNewDay=true → ensureStatsRow + UPDATE stats
- alarm_completed same day → stats 업데이트 스킵
- longest_streak 자동 갱신 (newStreak > longest)
- longest_streak 유지 (newStreak <= longest)
- first wakeup (null) → streak=1

**마일스톤:**
- 30일 마일스톤: 500 XP 보너스
- 90일 마일스톤: 2000 XP 보너스
- 미달성 시 milestone_grants undefined

**Nonce 중복:**
- dup path → stats/achievements 포함 응답
- dup path → capped=1 → boolean 변환

**기타:**
- level/stage XP 기반 재계산
- progress 정확한 계산
- local_date valid 포맷 전달
- daily_xp_reset_at === today → base 유지
- capped 플래그 xp_log 저장값

### 2. character-query.test.ts (14 tests)
**DB 흐름 검증:**
- resolveUserPk SQL + 바인딩
- 사용자 미존재 → 404 + 에러 메시지
- 캐릭터 미존재 → 자동 생성 (3 DB 호출)
- 캐릭터 존재 → 4회 DB 호출

**loadStats/loadAchievements:**
- loadStats SQL + character_id 바인딩 + 응답 매핑
- stats 없으면 기본값 {0,0,0}
- loadAchievements ORDER BY milestone + 다수 achievement
- achievements 빈 배열

**응답 구조:**
- level/stage XP 기반 재계산 (DB 저장값 무시)
- progress 계산 (xp=0/mid-level)
- streak 필드 매핑
- bloom 단계 캐릭터 (전체 필드 통합 검증)
- character 응답 필드 (id, name, xp, affection)

## 변경 파일 (2개, 모두 신규)
1. `packages/backend/test/character-mutation.test.ts`
2. `packages/backend/test/character-query.test.ts`

## 검증
- 신규 테스트: 40/40 통과
- 전체 테스트: 980/980 통과 (940 → 980, +40)
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- BACKLOG에 voice-profile.test.ts, voice-upload.test.ts 남아있음
- character 도메인 테스트 완전 커버: helpers(13) + aggregator(33) + mutation(26) + query(14) = 86 tests
