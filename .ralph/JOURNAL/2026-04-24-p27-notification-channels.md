# P27: Android 알림 채널 설정

**날짜**: 2026-04-24
**BACKLOG 항목**: 자가 생성 풀 — 알림 채널 설정 (Android notification channels)

## 접근

기존에 단일 `alarms` 채널만 존재. Android 8.0+ 에서 사용자가 알림 유형별로 설정을 커스터마이즈할 수 있도록 4개 채널로 분리.

## 채널 구성

| 채널 ID | 이름 | Importance | 용도 |
|---------|------|-----------|------|
| `alarms` | 알람 | MAX | 알람 트리거 — bypassDnd, 잠금화면 표시, LED |
| `notes` | 쪽지 | HIGH | 가족/커플 음성 쪽지 수신 |
| `reminders` | 리마인더 | DEFAULT | 스트릭, 캐릭터 성장 알림 |
| `system` | 시스템 | LOW | 친구 요청, 앱 업데이트 등 |

## 변경 파일

| 파일 | 변경 |
|------|------|
| `apps/mobile/src/services/notifications.ts` | 4채널 설정 + `NotificationChannel` 상수 export + channelId 참조를 상수로 변경 |
| `packages/backend/src/lib/fcm.ts` | `sendNotePush` 함수 추가 (쪽지 수신 시 푸시 알림) + sendAlarmPush에 channelId 데이터 추가 |
| `packages/backend/src/routes/notes.ts` | POST 쪽지 생성 시 수신자에게 푸시 알림 발송 (sendNotePush + waitUntil) |
| `packages/backend/test/notes.test.ts` | fcm mock 추가 + sender name 쿼리 mock 결과 추가 |
| `apps/mobile/src/i18n/ko.json` | settings.channel* 8키 추가 (채널명+설명 4쌍) |
| `apps/mobile/src/i18n/en.json` | 동일 8키 추가 |

## 설계 결정

- **alarms 채널**: `bypassDnd: true` + `lockscreenVisibility: PUBLIC` — 알람 앱의 핵심, DND 모드에서도 반드시 울려야 함
- **notes 채널**: HIGH importance — 쪽지는 즉시 알아야 하지만 강제 깨움은 아님
- **reminders 채널**: DEFAULT — 스트릭 알림은 유용하지만 긴급하지 않음
- **system 채널**: LOW — 사용자가 알림 설정에서 끌 수 있어야 함
- **waitUntil 방어**: Hono 테스트 모드에서 `c.executionCtx` 접근 시 throw → try-catch로 방어. Workers 환경에서는 정상 동작.
- **sendNotePush**: 쪽지 생성 시 수신자에게 비동기 푸시 발송. 응답 지연 없이 waitUntil으로 백그라운드 처리.

## 검증

- backend `npx tsc --noEmit` — 0 errors
- mobile `npx tsc --noEmit` — 0 errors
- backend tests — 647/647 passed
- mobile tests — 286/286 passed

## 다음 루프

자가 생성 풀 남은 항목:
- 딥 링크 라우트 핸들링 (voicealarm:// scheme)
- expo-updates OTA 업데이트 체크 로직
