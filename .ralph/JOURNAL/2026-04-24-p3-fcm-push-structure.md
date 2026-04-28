# P3: FCM 푸시 구조 세팅

## 작업 항목
BACKLOG P3 — FCM 푸시 구조 세팅

## 접근
전체 FCM 파이프라인을 구조만 구축 (실제 FCM 전송은 console.warn 로그로 대체).

### 백엔드
1. 마이그레이션 14: `push_tokens` 테이블 (user_id, token, platform, unique 제약)
2. `src/lib/fcm.ts` — getTokensForUser, sendPushNotifications(mock), sendAlarmPush
3. `src/routes/push.ts` — POST /push/token (upsert), DELETE /push/token
4. `src/index.ts` — scheduled() 핸들러에서 firing 알람 → sendAlarmPush 호출

### 모바일
1. `src/services/api.ts` — registerPushToken, unregisterPushToken 함수 추가
2. `src/services/notifications.ts` — registerPushTokenWithServer() (Expo Push Token → 서버 등록)
3. `app/_layout.tsx` — 알림 권한 획득 후 push token 자동 등록

## 변경 파일
- `packages/backend/src/lib/migrations.ts` — 마이그레이션 14 추가
- `packages/backend/src/lib/fcm.ts` (신규) — FCM 클라이언트 (mock)
- `packages/backend/src/routes/push.ts` (신규) — push token 등록/삭제 API
- `packages/backend/src/index.ts` — scheduled handler FCM 통합 + push 라우트 등록
- `apps/mobile/src/services/api.ts` — registerPushToken, unregisterPushToken
- `apps/mobile/src/services/notifications.ts` — registerPushTokenWithServer
- `apps/mobile/app/_layout.tsx` — push token 등록 호출

## 설계 결정
- FCM HTTP v1 API 실 호출 코드 작성 대신 console.warn 로그로 대체 (비용/설정 미완료)
- push_tokens 테이블에 UNIQUE(user_id, token) — 동일 디바이스 중복 등록 방지, upsert 처리
- Expo Push Token 사용 (EAS projectId 기반) — 추후 FCM/APNs 네이티브 토큰으로 전환 가능

## 검증
- Backend typecheck: ✅ 통과
- Mobile typecheck: ✅ 통과
