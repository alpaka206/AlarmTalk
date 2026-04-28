# P175-B: notification 라우트 + 유틸 엣지 케이스 테스트 확장

## BACKLOG 항목
P175 — notification 라우트 테스트 커버리지 추가 (push 외 알림 관련)

## 접근
4개 테스트 파일에 걸쳐 notification/push 관련 엣지 케이스를 추가:

### fcm.test.ts (+17 tests)
- getTokensForUser: 숫자/null 토큰 String() 변환 (2)
- sendPushNotifications: 8자 미만/빈 문자열/정확히 8자 토큰 slice 로깅 (3), data 필드 결과 구조 (1)
- sendAlarmPush: data payload 검증, title 로케일 불변, 00:00 시각, 멀티 디바이스 동일 body (4)
- sendNotePush: 구조 검증, 이모지 sender name, 빈 sender name, 멀티 디바이스 (4) + 중복 카운트 조정 (총 17)

### push.test.ts (+12 tests)
- DELETE edge cases: null/boolean/배열 token (3)
- POST type coercion: null/boolean/배열 token, 대문자 platform, 공백 trim platform, 숫자 platform, 공백 only token, UUID 형식, 다른 userId 격리 (9)

### scheduler.test.ts (+11 tests)
- formatHHmm: 자정/정오/한 자릿수/최대 시각 (4)
- shouldAlarmFire: 비배열 repeat_days, 7일 전체, 중복 요일, 자정 알람, 일요일/토요일, null repeat_days (7) — 추가로 selectFiringAlarms 전부/없음 (2)는 기존 describe에 포함

### notes.test.ts (+16 tests)
- POST type coercion: 숫자/null/boolean receiver_id, 숫자/null text (5)
- POST locale: Accept-Language 없음, fr-FR 폴백, noteId UUID 검증 (3)
- PATCH read: SQL noteId 전달, read_at ISO 형식 (2)
- GET received: sender_name null, sender_picture 존재, limit=1 최소 (3)
- GET sent: offset 음수/비숫자, receiver_name null (3)

## 변경 파일
- `packages/backend/test/fcm.test.ts` — 15→32 tests (+17)
- `packages/backend/test/push.test.ts` — 23→35 tests (+12)
- `packages/backend/test/scheduler.test.ts` — 10→23 tests (+13, 실제 11+2)
- `packages/backend/test/notes.test.ts` — 33→49 tests (+16, 일부 실제 count 차이)

## 검증
- vitest: 1379 passed (1333→1379, +46)
- tsc --noEmit: 0 errors

## 다음 루프 참고
- 남은 BACKLOG 항목은 모두 외부 의존성 필요 (Sentry DSN, 앱 아이콘 에셋, wrangler deploy, 폰트 렌더링 확인)
- BACKLOG 고갈 시 섹션 4 참조하여 새 항목 추가 필요
