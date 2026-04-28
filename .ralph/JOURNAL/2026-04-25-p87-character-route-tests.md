# P87 — character.ts API 라우트 테스트 24건 추가

## 선택한 항목
BACKLOG 고갈 → 테스트 커버리지 감사 수행: character.ts (405줄, 2개 엔드포인트)가 11개 순수 유틸 함수 테스트만 보유, API 라우트 테스트 0건으로 가장 심각한 커버리지 갭 발견.

## 접근

### 문제 분석
1. `GET /characters/me` — 라우트 테스트 0건 (사용자 미존재, 자동 생성, 기존 캐릭터+stats+achievements, progress 계산 미검증)
2. `POST /characters/xp` — 라우트 테스트 0건 (이벤트 검증, XP 지급, 일일 캡, 날짜 리셋, client_nonce 멱등성, 스트릭 연산, 마일스톤 보너스, 능력치 업데이트 미검증)

### 구현
**GET /characters/me (4건)**:
- 사용자 미존재 → 404 + USER_NOT_FOUND error_code
- 캐릭터 없으면 자동 생성 (seed, level 1, streak 0)
- 기존 캐릭터 + stats + achievements 풀 응답 검증
- progress 필드 연산 정확성 (xp_into_level, xp_to_next_level, level_span, progress_ratio)

**POST /characters/xp (20건)**:
- 지원하지 않는 event → 400 + UNSUPPORTED_EVENT
- event 누락 → 400
- 사용자 미존재 → 404 + USER_NOT_FOUND
- alarm_completed 기본 지급 (30xp, 2 affection)
- alarm_snoozed (5xp, 0 affection)
- friend_invited (50xp, 5 affection)
- 일일 캡 (190→200, capped=true, partial grant)
- 일일 캡 만료 (200+, 0 지급)
- 날짜 변경 시 daily_xp 리셋 후 재산정
- client_nonce 중복 → duplicated=true
- client_nonce 공백만 → 무시하고 새 지급
- 연속 기상 스트릭 증가 (5→6)
- 2일+ gap → 스트릭 1 리셋
- 같은 날 중복 alarm_completed → 스트릭 유지
- 7일 마일스톤 보너스 (+100xp, milestone_grants 배열)
- 이미 달성한 마일스톤 중복 방지
- alarm_dismissed (0xp, 0 affection, 스트릭 불변)
- 잘못된 local_date 형식 → 서버 today 폴백
- body JSON 파싱 실패 → UNSUPPORTED_EVENT
- streak_bonus 이벤트 일일 캡 면제

### 주의사항
- `todayString()`은 UTC 기준이므로, KST 새벽에는 UTC 날짜가 전날이 될 수 있음. 테스트에서 "same day" 비교 시 `new Date().toISOString().split('T')[0]`으로 동적 계산하거나, `local_date`를 명시적으로 전달해야 안정적.
- mock DB result 순서는 alarm_completed 여부 + streakUpdated 여부에 따라 ensureStatsRow/UPDATE stats 호출이 조건적이므로 주의 필요.

## 변경 파일 (1개)
1. `packages/backend/test/character.test.ts` — API 라우트 테스트 24건 추가 (11→35)

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 테스트: backend 857/857 (833→857, +24), mobile 662/662 (변동 없음)
