# P164 — Billing + TTS 모바일 API 클라이언트 추가

## 선택한 항목
BACKLOG: "GET /billing/subscription + POST /billing/checkout 모바일 연동" + "DELETE /tts/messages/:id 모바일 연동"

## 판단
두 항목 모두 API 클라이언트 함수 추가만 필요 (UI 연동은 별도). 한 iteration에 묶어서 진행.

## 작업 내역

### 1. Billing API 함수 추가 (billing.ts)
- `Subscription` 인터페이스 — 구독 정보 타입
- `SubscriptionPlan` 인터페이스 — 플랜 정보 타입 (key, name, plan_type, period_days, max_members, price_krw)
- `getSubscription()` — GET /billing/subscription → `{ subscription, plan }`
- `CheckoutResult` 인터페이스 — 결제 결과 (subscription + plan + plan_group + voucher)
- `checkout(planKey)` — POST /billing/checkout → CheckoutResult

### 2. TTS 메시지 삭제 함수 추가 (voice.ts)
- `deleteTtsMessage(id, force?)` — DELETE /tts/messages/:id
- force=true 시 알람에서 사용 중인 메시지도 강제 삭제
- 반환: `{ ok, alarms_affected }`

### 3. Barrel Export 업데이트 (index.ts)
- 함수: getSubscription, checkout, deleteTtsMessage
- 타입: SubscriptionPlan, Subscription, CheckoutResult

## 변경 파일 (3개)
1. `apps/mobile/src/services/api/billing.ts` — getSubscription + checkout 추가
2. `apps/mobile/src/services/api/voice.ts` — deleteTtsMessage 추가
3. `apps/mobile/src/services/api/index.ts` — export 추가

## 검증
- Mobile typecheck: 0 errors ✅

### 4. apiUser.test.ts 수정 (P163 관련)
- getUserProfile 테스트: mock 응답을 `{ user: {...}, stats: {...} }` 구조로 변경 + unwrap 검증
- `updateUserSettings` 테스트 1개 추가
- 테스트 수: 12 → 13 (전체: 1937 → 1938)

## 다음 루프 참고
- getSubscription/checkout UI 연동은 미구현 — 구독 관리 화면 구축 시 사용
- deleteTtsMessage UI 연동은 미구현 — 라이브러리 화면에 삭제 기능 추가 시 사용
- checkout은 현재 백엔드에서 stub (실 PG 연동 없음)
