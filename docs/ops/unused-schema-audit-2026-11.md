# 안 쓰는 DB·코드 정리 (2026-11-09)

오너 지시: "안 쓰는 DB 나 코드도 있나 확인해 봐, 한번 싹 정리하고 가게 DDL 수준으로도" → "정리해도 되는 것들은 지워 봐".

감사는 후보 217개를 찾았고(서버 DB 칸 35·표 6·색인 4, 기기 DB 칸 18, 코드 82, 문구 25, 라우트 10, 에러 코드 5, 기타 32),
그중 29개를 두 갈래(정말 안 읽히는가 / 지워도 안전한가)로 따로 검증했다. 토큰이 많이 들어 나머지 검증은 멈췄다.

## 지운 것 — 마이그레이션 #149·#150

두 갈래 검증을 모두 통과하고, 코드 변경이 없거나 한두 줄인 것만 출시 전에 지운다.
운영·dev 의 실제 스키마를 읽어 메모리에 세운 뒤 돌려 보았다(운영 #133~#150, dev #149~#150 모두 통과).

| 대상 | 왜 안 쓰나 | 코드 |
| --- | --- | --- |
| 표 `weather_region_daily` | 공식 예보로 바꾼 #127 뒤로 읽고 쓰는 곳이 없다 | 없음 |
| `event_likes.updated_at` | 쓰기만 한다 | `routes/event.ts` |
| `tts_synthesis_usage.updated_at` | 쓰기만 한다 | `lib/tts-usage.ts` |
| `manual_tts_usage.updated_at` | 쓰기만 한다 | `lib/manual-tts-quota.ts` |
| `voice_profile_change_ledger.updated_at`·`created_at` | 쓰기만 한다 / 기본값뿐 | `routes/voice-profile.ts` |
| `retained_billing_records.amount_currency` | 늘 NULL | `lib/account-deletion.ts` |
| `voice_uploads.duration_ms` | 쓰기만 한다(길이는 R2 원본 메타에 남는다) | `routes/voice-profile.ts` |
| `voice_packs.updated_at` | 쓰기만 한다 | `lib/voice-packs.ts` |
| `stock_content_releases.released_at`·`plans.created_at`·`paid_voice_retention.created_at` | 기본값뿐, 읽는 곳 없음 | 없음 |
| 색인 `idx_generated_audio_assets_user` | #139 의 `idx_generated_audio_assets_logical` 이 같은 조회를 받는다 | 없음 |

회귀 테스트: `packages/backend/test/migration-149-drop-unused.test.ts`.

## 남긴 것 — 다음 회차(출시 뒤)

| 대상 | 남긴 이유 |
| --- | --- |
| `users.updated_at` | 쓰는 곳이 17곳이다. 출시 직전에 넣기엔 범위가 크다 |
| 표 `message_library` | 코드 9곳(읽기 1·INSERT 1·UPDATE 2·DELETE 5) |
| 표 `voice_draft_attempt_usage` | 목소리 등록 흐름의 코드를 함께 걷어야 한다 |
| `admin_push_jobs.finished_at`·`store_download_sync.last_success_at` | 바인딩 인자 순서가 바뀌는 쓰기라 회귀 테스트와 함께 낸다 |
| `plan_grants.granted_by`·`revoked_by` | 관리자 함수 시그니처와 테스트 4곳이 바뀐다 |
| `subscriptions.apple_*`(+ 색인 2)·`next_plan_id` | 운영 값 확인(결제 식별자 보존 대상인지)과 1.2.16 응답 호환 확인이 먼저다 |
| `weather_region_daily_official` 의 `weather_code`·`precip_*`·`dust_level` | 쓰기 SQL 을 함께 고쳐야 한다 |
| 색인 `idx_users_google_id` | 운영에 google_id 자동 고유 색인이 있는지 먼저 확인한다 |
| `POST /voice/clone` 의 `monthlyLedgerId` 갈래 | 코드만 지우는 정리 |
| `voice_uploads.size_bytes`·`generated_audio_assets.model_id` | 두 번의 릴리스로 나눠야 한다(먼저 널 허용으로 표 재작성) |
| 표 `promo_codes`·`promo_code_redemptions` | 오너 결정 필요 — `docs/spec/plan-gates.md` 의 "이력은 남긴다" |
| 기기 DB(Room) 칸 18개·두 앱 코드·문구 키 | 검증 전. 기기 DB 는 Room 버전을 올리는 마이그레이션이라 출시 뒤 |
