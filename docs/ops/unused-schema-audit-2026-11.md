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

## 2차 — 2026-11-23 (마이그레이션 #152·#153)

오너 지시: "ddl 수준으로 안쓰는 코드, 테이블도 점검해보고 ponytail로 과구현 이런것도 점검해보고 수정해봐".

**방법**: 마이그레이션 #1~#151 을 메모리 DB 에 전부 돌려 최종 스키마(표 44·칸 416·색인 63)를 세우고, 서버 코드(`src`·`scripts`,
마이그레이션 파일 제외)의 SQL 문장을 읽기(SELECT·WHERE·ON·ORDER BY·RETURNING)와 쓰기(INSERT 칸 목록·UPDATE SET·upsert 의
`excluded.칸`)로 나눠 칸마다 셌다. `SELECT *` 로만 읽히는 칸은 TS 에서 이름으로 쓰는지 따로 찾았다.

### 지운 것

| 대상 | 왜 | 코드 |
| --- | --- | --- |
| `users.updated_at` | 쓰기만 18곳 | `UPDATE users` 문장 18개에서 뺐다 |
| `push_tokens.updated_at` | 쓰기만 | `routes/push.ts` (#71 재현 테스트는 그 칸을 잠시 되살려 돈다) |
| 표 `voice_draft_attempt_usage` | 초안 시도를 세기만 했다(막지 않고, 두 앱 모두 그 수를 읽지 않는다) | `routes/voice-profile.ts` 의 집계·환불, 탈퇴 파기의 DELETE(표보다 먼저 걷어야 파기가 안 깨진다). `GET /voice/draft-quota` 는 옛 iOS(2026-09-29 전) 디코딩 호환으로 `limit/used/remaining` 을 0 으로 싣는다 |
| `message_library.in_use`·`in_use_updated_at`·`last_used_at` | 사용 기록이 갱신만 하고 읽는 곳이 없다. 같은 사실은 `usage_events` 에 남는다 | `routes/events.ts` — 그 갱신 때문에만 있던 중복 조회도 걷었다. 스펙 `usage-events.md` §5 |
| `weather_region_daily_official.dust_level` | 먼지 원천을 쓰지 않아 늘 NULL | `lib/weather-region-daily.ts` |
| `store_download_sync.last_success_at` | 관리자 화면이 읽지 않는다 | `lib/admin/store-downloads.ts` |
| `store_report_instances.ingested_at` | 중복 거르기는 `instance_id`, 정리는 `processing_date` | 같은 파일 |
| `subscriptions.apple_transaction_id`·`apple_original_transaction_id`·`apple_product_id` + 색인 2 (#153) | 쓰지도 읽지도 않는다. #96 이 되살렸지만 애플 결제는 `store_transactions` 에 적는다. 이 칸을 쓴 코드는 2026-05-19~20 하루뿐이었고 그 뒤 #82 가 dev·prod 전부 NULL 을 확인했다 — 운영 값도 NULL 이다 | 없음(`SELECT s.*` 한 곳은 응답으로 나가지 않는다) |

회귀 테스트: `packages/backend/test/migration-152-drop-write-only.test.ts`.

### 일부러 남긴 것 — 쓰기만 하지만 목적이 있다

| 대상 | 이유 |
| --- | --- |
| `apple_server_notifications` 의 종류·환경·결과·오류 칸 | 운영 조사용 수신 기록이고 90일 뒤 크론이 지운다 |
| `usage_events` 의 2판 칸 | 사용 기록 분석용 — 앱과의 계약(`docs/spec/usage-events.md`) |
| `retained_billing_records` 전부(색인 2 포함) | 법정 보관 기록, `retain_until` 이 지나면 크론이 지운다 |
| `weather_region_daily_official` 의 `weather_code`·`precip_prob`·`precip_sum` | `variant_index` 를 고른 근거 — 잘못 고른 날을 조사할 때 보고, 원천 파싱 테스트가 이 칸으로 본다 |
| `pending_external_deletions.last_error` | 외부 삭제 재시도 큐의 조사용 |
| `voice_packs`·`voice_pack_events`·`voice_pack_clips` 의 권리 칸 | 그때는 추가 음성팩(외부 권리 대기) 몫이라 남겼다 — 3차에서 기능째 지웠다(아래) |
| `_migrations.applied_at` | 마이그레이션 장부 |

### 1차에서 남긴 것의 지금 상태

| 대상 | 상태 |
| --- | --- |
| `users.updated_at`·`store_download_sync.last_success_at`·`subscriptions.apple_*`·`dust_level` | **지웠다**(위) |
| 표 `message_library` | 표는 쓴다(저장 문구·목소리 삭제 정리). 쓰기만 하던 칸 셋만 지웠다 |
| 표 `voice_draft_attempt_usage` | **지웠다**(위) — 두 앱(출시본 포함)이 그 수를 읽지 않는 것을 확인했다 |
| `admin_push_jobs.finished_at`·`plan_grants.granted_by`·`revoked_by`·`subscriptions.next_plan_id` | 남김 — 지금은 읽는 곳이 있다(관리자 화면·구독 응답) |
| 색인 `idx_users_google_id` | 남김 — 새 DB 에서는 `google_id` 의 UNIQUE 자동 색인과 겹치지만, 운영 DB 에도 자동 색인이 있는지 읽어 보기 전에는 지우지 않는다(없으면 중복 가입을 막는 장치가 사라진다) |
| `voice_uploads.size_bytes`·`generated_audio_assets.model_id`·`store_report_instances.report` | 남김 — 기본값 없는 NOT NULL 이라 배포 → 마이그레이션 창에 쓰기가 실패한다. 두 번에 나눠 지운다 |
| 표 `promo_codes`·`promo_code_redemptions` | 남김 — 스펙 "이력은 남긴다"(받은 사람의 구독 근거). 오너 결정 |

### 기기 저장소

| 대상 | 상태 |
| --- | --- |
| iOS 알람 JSON(`LocalAlarmRecord`)의 `snoozeCount`·`defaultAlarmSoundId`, AlarmKit 메타데이터의 `localAlarmID`·`voiceCacheKey`, 공휴일 캐시의 `name`·`localDate`·`source`·`updatedAtMillis`·`regionCode`, 키체인 세션의 `AuthUser.name` | **지웠다** — 디코더가 정해 둔 키만 `decodeIfPresent` 로 읽어 옛 데이터의 남은 키는 무시된다. 예약 지문(`scheduledSoundFingerprint`)은 이 값을 쓰지 않아 재예약도 없다 |
| 안드로이드 Room(v31) — `alarms` 의 `targetDate`·`targetTimezone`·`remoteAlarmId`·`lastSyncedAtMillis`·`syncState`·`origin`·`snoozeEnabled`·`snoozeRepeatLimit`·`snoozeCount`·`defaultAlarmSoundId`·`dynamicVoicePreparedForFireAtMillis`, `holiday_dates` 의 `localDate`·`source`·`updatedAtMillis` | 남김 — minSdk 26 이라 `DROP COLUMN` 을 못 써서 `alarms` 표를 새로 만들어 옮기는 31→32 마이그레이션이 필요하다. 잘못되면 앱이 켜질 때 죽거나 알람이 사라지므로 실기기 확인과 함께 출시 뒤에 한다. `voiceRepeat` 는 CLAUDE.md 「계속 true 로 왕복시킨다」라 남긴다 |
| iOS 알람 JSON 의 `syncState`·`remoteAlarmId`·`lastSyncedAtMillis`·`snoozeEnabled`·`snoozeRepeatLimit`·`voiceRepeat` | 남김 — 스펙이 디스크 형식 유지·재예약 지문을 이유로 남긴다(`alarm-lifecycle.md`, `alarm-ringing.md`) |

## 2차 — 코드(ponytail, 2026-11-23)

죽은 코드만 지웠다 — 어디서도 실행되지 않거나 테스트만 부르던 것. 살아 있는 코드의 모양을 바꾸는 정리와 제품 판단이 필요한 것은 남겼다.

| 영역 | 지운 것 | 크기 |
| --- | --- | --- |
| 서버 | 막혀 있던 라이브 랜덤 TTS 갈래와 Gemini 동적 문구 생성기(400 `RANDOM_TTS_RETIRED` 와 그 코드는 옛 앱 계약이라 남김), 대체된 커밋 뒤 알림 2개와 그것만 쓰던 FCM 발송 묶음, `packages/voice` 의 `VoiceProvider`·`MockVoiceProvider`, 서버 알람 사본 잔재(`normalizeAlarmRow` 등), 쓰는 곳 없는 shared 타입, 날씨 보조 함수 2개, 옛 Expo CORS 출처·`PUT`, 랜딩 번역 키 하나 | 소스 약 −1,340·테스트 약 −880줄 |
| 안드로이드 | 안 부르는 DAO 쿼리 3개, `ModalDialogTitle`, 늘 고정값인 매개변수와 그 갈래(직접 입력 잠금·`SnoozeLockedRow`·울림 시계 `ampm` 등), 테스트 전용 함수 4개, 안 읽는 응답 DTO 칸, 안 쓰는 문자열(지역 대표 도시 25개 × 3언어 — 생성기에서 뺐다), `AlarmSyncStates.FAILED` | 순 약 −420줄 |
| iOS | 아무도 시작하지 않던 클립 받기 Live Activity, 쓰기만 하던 상태 7개와 그것만 채우던 로직, 테스트 전용 API, `AuthOutlinedButton`·`sectionSurface`, 닉네임 잔재, 직접 입력 잠금 갈래, 안 쓰는 번역 키 46개(앱 44·위젯 2) | 앱 순 약 −456줄, 카탈로그 −769줄 |

함께 고친 것: CLAUDE.md 「Compose 콜백에 지역 함수 참조를 넘기지 않는다」를 어기던 6곳(`AlarmRandomPromptSettings` 의 `saveResolvedSettings`
2곳, `AlarmTalkApp` 의 `navigateToTab` 2곳, `VoiceProfileManagementPanel` 의 `closeCreateDialog`, `AlarmEditorScreen` 의
`applyRandomPromptSettings`) — 콤포지션 지역 값을 캡처하는 자리만 람다로 감쌌다.

### 남긴 것 — 출시 뒤

- **살아 있는 코드의 모양을 바꾸는 정리**(동작은 같아야 하지만 결제·로그인·알람 경로라 따로 낸다): 서버의 손으로 쓴 base64·hex·PEM 변환
  약 30벌을 표준 `Uint8Array.toBase64`/`fromBase64`/`toHex` 로, ES256 JWT 서명 4벌·서비스계정 JWT 2벌을 하나로, `hono/cookie`,
  제공자 하나뿐인 attempts 배열, 언제나 빈 `downgradedAlarms` 배관 · 안드로이드 워커 실패 처리 5벌, 원인 사슬 순회 7벌, 세션 저장 3벌,
  12시간제 시각 계산 · iOS 서버 시각 파서 5벌, 등급 순서 두 벌, 정적 테마 `AlarmTalkTheme`, 다음 울림 계산의 두 루프.
- **의존성**: 서버 `@types/bcryptjs`, 안드로이드 `ui-tooling`·`espresso-core`·`lifecycle-runtime-ktx` — 보안 의존성 브랜치에서 함께 낸다.
- **판단이 필요한 것**: (추가 음성팩 기능 전체와 끝난 개인 플랜의 종료 처리는 오너가 정해 3차에서 지웠다), dev 결제 스텁 `POST /billing/checkout`, 광고 알림 갈래, `#Preview` 블록(iOS 약 500줄),
  VAD 꽂는 자리, `UsageEvents.VOICE_CREATED`·`VOICE_DELETED` 자리.
- iOS `AudioPreviewPlayer.isPreparing` 는 이제 늘 false 다(올리는 코드가 원래 없었다) — 목소리 시트의 준비 스피너 갈래를 살릴지 지울지 정한다.

## 3차 — 2026-11-23 (#154, 오너 결정)

오너 결정: "무료 체험하기 한달 한번 할 수 있는거 빼고는 없애도 돼", 추가 음성팩은 "지운다. … 목소리 추가는 무료 1달 체험권이나
그런걸로만 가능하게 해야함". 플러스를 무료로 얻는 길은 스토어의 1개월 무료 체험 하나이고, 목소리 등록도 플러스(체험 포함)에서만 된다.

| 지운 기능 | 서버·shared | 안드로이드 | iOS |
| --- | --- | --- | --- |
| 기간 한정 개인 플랜(2026-10-31 종료) — 읽을 때 계산·종료 전환·끝 + 3일 삭제의 1분 전용 크론·종료 안내·오프라인 끝 판정 | `lib/personal-promo.ts`·`personal-promo-end.ts`, shared `PERSONAL_PROMO` 계열, 응답의 `personal_promo`, `wrangler.toml` 의 `* * * * *`, 워커 키 `PERSONAL_PROMO_STARTS_AT`·`_ENDS_AT` | `PersonalPromo.kt`·`PersonalPromoLedger.kt`·`PersonalPromoJsonAdapter.kt`·`OpenModalRegistry.kt`(+ `scripts/check-open-modal-tracking.py`·CI 단계), 문자열 5개 × 3언어 | `PersonalPromo.swift`·`PersonalPromoNotice.swift`, 종료 알럿, `-UIPreviewPersonalPromo` |
| 관리자 기간 지급(운영에 나간 적 없음) | `lib/plan-grants.ts`·`plan-grant-sql.ts`·`admin/grant-pages.ts`, 응답의 `plan_grant`, 5분 크론의 뒷정리, 표 `plan_grants` | 지급 끝 오프라인 판정(`PlanGrantExpiryTest`) | `decodePlanGrant`·`limitedPlan` |
| 추가 음성팩(팩 0개, 스토어에 실린 적 없음) | `lib/voice-packs.ts`·`routes/voice-packs.ts`·`admin/voice-pack-pages.ts`·`scripts/import-voice-pack.ts`, 에러 코드 5개, 사용 기록 `pack_selected`·`pack_id`, 표 셋 | 팩 저장소·API·목소리 탭 섹션·편집기 갈래, 문자열 25개 × 3언어 | 팩 저장소·섹션·편집기 갈래, 카탈로그 키 25개(프로모 포함) |

- **크기**(2차 + 3차를 합친 작업 트리, HEAD 9581b8e66 대비): 서버·shared·voice 소스 −5,438·+409줄(69파일), 안드로이드 앱
  −4,022·+370줄(70파일), iOS 앱 −4,477·+510줄(66파일, 카탈로그 −1,205줄 포함), 테스트 −8,900·+697줄(101파일). 테스트 수는
  백엔드 2516 → 2412, 안드로이드 1154 → 1070, iOS 1249 → 1170(Swift Testing 57 → 58) — 지운 기능의 테스트가 빠지고 옮기거나 새로
  쓴 회귀(유료 게이트 실제 DB·#154·은퇴 사용 기록·순번 가드·옛 팩 알람의 미나 대체)가 더해졌다.
- **마이그레이션 #154** `drop-retired-plan-grants-and-voice-packs`: `DROP TABLE IF EXISTS plan_grants`·`voice_pack_events`·
  `voice_pack_clips`·`voice_packs`, `ALTER TABLE usage_events DROP COLUMN pack_id`. 회귀 테스트 `migration-154-drop-retired.test.ts`.
- **남긴 것**: 표 `promo_codes`·`promo_code_redemptions`(처리방침이 그 기록을 적고 계약 기록 5년 보관 대상일 수 있다 — 오너 확인
  전에는 지우지 않는다), 일반 plan 답의 순번 가드(안드로이드 `AccountRequestLedger`, iOS `AuthViewModel` 의 표·순번 —
  `billing-lifecycle.md` 「plan 답의 순번 가드」), 강등 안내 키 `RootView.promoGateKey`(이름만 옛것).
- **옛 기록·옛 데이터**: 서버는 옛 개발 빌드가 보낸 `pack_selected`·`pack_id` 를 받고 버린다(배치는 200). 옛 앱 1.2.16 은
  `personal_promo` 가 없으면 없는 것으로 읽는다(안드로이드 Gson null, iOS `decodeIfPresent`). 기기에 남은 옛 세션 키·팩 파일은
  읽지 않는다(팩 파일은 캐시 청소가 지운다). 팩 목소리 알람(내부 시험 기기만)은 목소리를 잃은 알람과 같은 길로 미나가 된다.
- **법무 8판**(아직 main 전이라 제자리): 처리방침의 음성팩 사용 기록·회사 지급 기간 항목, 약관 제4조·제10조·제13조·제15조의
  음성팩·회사 지급 문장을 뺐다(`docs/legal/README.md` 「버전 8」).
- ⚠ **main 릴리스 직전 운영 DB 확인**: 보관 행 없이 목소리를 든 원시 무료 계정이 0 인지(`docs/qa/v1-3-handoff.md` §2 의 1).
  종료 전환을 다시 돌릴 크론이 이제 없다. Sentry 에는 종료 작업 경보가 없었다(2026-11-23 확인).
- 운영 워커의 `PERSONAL_PROMO_STARTS_AT`(prod·dev)·`PERSONAL_PROMO_ENDS_AT`(dev)은 코드가 읽지 않는다 — 치울 거면
  `wrangler secret delete … --env <dev|production>`.

