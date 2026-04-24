# P73 — family-alarm.ts 라우트 테스트

## 선택한 항목
BACKLOG 고갈 프로토콜에 따라 코드베이스 감사. 발견:
- `family-alarm.ts` 라우트: 2개 엔드포인트 (POST /alarms, POST /alarms/voice) 테스트 커버리지 0%
- 복잡한 검증 체인 (수신자 존재, 같은 그룹, 알람 허용, 음성 프로필 소유 등) 미검증 상태

## 선택 이유
전체 라우트 중 유일하게 테스트가 없는 라우트. 가족 알람은 핵심 기능(다른 사람에게 알람 보내기)이므로 검증이 필수적.

## 접근
기존 테스트 패턴 (createMockDB + fakeAuthMiddleware + jsonReq) 활용하여 전 경로 커버.

### POST /alarms (TTS) — 20 tests
- 검증 오류: recipient_user_id 누락, wake_at 형식, message_text 빈/초과/경계값
- 인증/권한: 발신자 미존재, 자기 자신, 그룹 불일치, 수신자 미존재, 알람 비허용
- 음성 프로필: 지정+미소유, 미지정+프로필 없음
- 정상 경로: 자동 프로필 선택, 지정 프로필, repeat_days 정규화, malformed JSON

### POST /alarms/voice (음성 업로드) — 20 tests
- 검증 오류: recipient/wake_at/upload_id 누락, label 초과, dub_target_language 무효
- 인증/권한: 동일 패턴 (발신자/자기자신/그룹/수신자/허용)
- 업로드: 미존재, 소유자 불일치, 수신자 음성 프로필 없음
- 정상 경로: dub 없이, 기본 라벨, 커스텀 라벨, dub 생성, repeat_days, 4개 언어 순회, null dub, 경계값 label

## 변경 파일 (1개)
1. `packages/backend/test/family-alarm.test.ts` — 신규 (40 tests)

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 테스트: backend 724/724 통과 (+40 신규)

## 다음 루프 참고
- 모든 백엔드 라우트 파일이 이제 전용 테스트를 가짐
- BACKLOG 고갈 상태 유지 — 다음 루프에서 새 항목 탐색 필요
