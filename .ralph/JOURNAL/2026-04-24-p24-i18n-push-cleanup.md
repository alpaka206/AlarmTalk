# P24: i18n 누락 키 수정 + 로그아웃 시 푸시 토큰 해제

**날짜**: 2026-04-24
**BACKLOG 항목**: P24 (자가 생성 — 코드 품질 감사에서 발견된 이슈 수정)

## 발견 경위

BACKLOG 고갈 후 자동 코드 감사 수행. 두 가지 실질적 이슈 발견:
1. en.json에서 `messageDetail` 키 5개 누락 (ko.json에만 존재)
2. `unregisterPushToken()` API 함수가 정의만 되고 실제 호출되지 않음

## 변경 사항

### 1. i18n 키 동기화 (en.json)

| 키 | 값 |
|---|---|
| `messageDetail.title` | "Message Detail" |
| `messageDetail.voice` | "Voice Profile" |
| `messageDetail.category` | "Category" |
| `messageDetail.createdAt` | "Created At" |
| `messageDetail.setAsAlarm` | "Set as Alarm" |

### 2. 로그아웃 시 푸시 토큰 서버 해제

- `src/services/notifications.ts`: `unregisterPushTokenFromServer()` 함수 추가 — `getExpoPushTokenAsync`로 현재 토큰 조회 후 `DELETE /push/token` 호출
- `src/stores/useAppStore.ts`: `clearAuth()` 시작부에 `unregisterPushTokenFromServer()` 호출 추가
- `test/useAppStore.test.ts`: notifications 모듈 mock 추가

### 설계 결정

- 푸시 토큰 해제를 store의 `clearAuth`에 넣은 이유: 모든 로그아웃 경로(ProfileDropdown, settings, 계정삭제)가 `clearAuth`를 호출하므로 단일 지점에서 처리하는 것이 가장 안전.
- `unregisterPushTokenFromServer`는 best-effort: try-catch로 감싸서 실패해도 로그아웃을 막지 않음.

## 변경 파일

| 파일 | 변경 |
|------|------|
| `apps/mobile/src/i18n/en.json` | `messageDetail` 5키 추가 |
| `apps/mobile/src/services/notifications.ts` | `unregisterPushTokenFromServer()` + `unregisterPushToken` import 추가 |
| `apps/mobile/src/stores/useAppStore.ts` | `clearAuth`에 push token 해제 호출 추가 |
| `apps/mobile/test/useAppStore.test.ts` | notifications 모듈 mock 추가 |

## 검증

- ko.json ↔ en.json 키 동기화 검증: All keys match
- mobile `npx tsc --noEmit` — 0 errors
- backend `npx tsc --noEmit` — 0 errors
- mobile tests: 286/286 통과
- backend tests: 647/647 통과

## 다음 루프

코드 품질 감사 결과 추가 개선 가능 영역 탐색. packages/voice의 stale TODO 정리, 또는 README 현행화 등 고려.
