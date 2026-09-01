# 정리 감사 — 안 쓰는 것 / 현황과 어긋나는 것 (2026-08-01)

> 6개 축(안드 문자열·DB 스키마·API 라우트·문서·shared 계약·법무↔코드)으로 전수 조사한 뒤,
> 각 주장을 레포 전체 재검색으로 확증한 결과다. **반박되어 빠진 항목은 이 목록에 없다.**
> 확증 과정에서 뒤집힌 두 가지는 아래 "삭제 금지" 로 따로 적어 둔다.

진행 표기: 각 항목 앞 `- [ ]` 를 처리하면서 채운다. 버킷별로 PR 을 나누는 것을 전제로 한다
(①=코드/스키마 삭제, ②=문서, ③=법무, ④=결정 대기).


> **2026-08-01 1차 처리분** — PR #660 에서 아래를 해소했다: 미사용 문자열 119키, 선물 결제 UI 체인,
> dead route(`_dev/clear-mine`), scheduler 죽은 주석·모킹, 매뉴얼 녹음 길이, `ci` 라벨 문서화,
> 음성 생체정보 철회 UI + 철회 시 삭제 사실 고지(처리방침·약관·동의 카피).
> **Open-Meteo 는 고지 대상 아님으로 종결**(식별자 없이 도시명·좌표만, 서버에서 호출 — ③ 버킷 참조).
> 그에 따라 **정책 버전 5 상향도 불필요**하다.
> **#89(인덱스 12종 정리 + 누락 인덱스 1개 추가)·#90(사장 컬럼 8개 DROP) 적용 완료** — DB 초기화 없이 제자리 마이그레이션.
> NOT NULL·무기본값이라 배포 창에서 500 이 나는 컬럼(generated_audio_assets.provider_voice_id/model_id/language,
> voice_uploads.size_bytes)과 진단·증빙용(push_tokens.platform, pending_external_deletions.last_error,
> store_transactions.raw_payload, retained_billing_records)은 **의도적으로 남겼다**.
> 동의 철회 **과삭제도 해소**했다(클론 파생만 삭제 — ③ 참조).

## 총평

6개 레인의 확증 결과를 중복 제거해 4버킷 49건으로 통합했다. ①은 코드/스키마에서 즉시 제거 가능한 죽은 것들(문자열 111키·gift 체인·dead route·미사용 응답 필드·#89 마이그레이션 묶음)이고, ②는 코드와 어긋난 문서/문구 13건(CI 라벨 미문서화, 30초→1분 녹음, 존재하지 않는 Gradle 태스크·탭·파일 경로)이다. ③은 법적 리스크 13건으로, 특히 "언제든 철회 가능"이라 고지하고도 민감 동의 철회 UI가 없다는 점, 철회 시 목소리가 영구 파기되는데 미고지인 점, 국외이전 거부 시 실제로는 가입 자체가 불가한데 "일부 기능 제한"이라 적은 점, 처리방침 국외이전 표에 Open-Meteo 누락·수탁사 익명 표기가 가장 시급하다. ④는 제품/법무 판단이 선행돼야 하는 10건(공유 목소리 호칭 기능 존폐, 그룹 소유권 양도 UI, alarm-talk.com 메일함 생존, en/ja 법무문서, raw_payload 보존)이다. 반박으로 확정된 두 가지는 반드시 지킬 것: family_alarm_quiet_days/start/end 3필드는 클라 폴백+테스트가 살아 있어 삭제 금지이고, checkoutPlan() 함수와 CheckoutVoucher 는 여전히 사용 중이라 죽은 건 UI 파라미터 체인과 gift 인자뿐이다.

## ① 지금 바로 지워도 되는 죽은 코드/스키마 (14건)

- [x] **미사용 문자열 111키(원 119키 중 gift 8키는 아래 별도 항목) — 에디터 9, 구세대 테마 다이얼로그 8, 홈 인사말 8, label_* enum 43, 권한 게이트 2, 스톡 클립 언어 3, 동의 토스트 2, 제거된 음성메시지 2, voice-data 즉시삭제 4 등**
  - 위치: `apps/android-native/app/src/main/res/values/strings.xml:44,49,58,66,76,77,120-122,135,139-142,192,195,196,206,209,217,254,269,282,314-321,324,325,367-374,377,403,472,473,476,490,512,524,533,617,621-623,666,670,677,702,726,745-786,824,922,929,930,934,962-964,993,1014 (+ values-en, values-ja 대응 키)`
  - 조치: 키 이름 기준으로 ko/en/ja 3로케일에서 함께 삭제. r3ed_stock_clip_lang_* 는 translatable 미지정이라 en:934-936 / ja:942-944 번역본도 같이 제거. label_sync_state_*·label_alarm_state_* 는 디버그 화면 재도입 시 재생성 가능하다는 근거를 커밋 메시지에 남길 것
  - 위험: strings.xml:379 hs_weather_preset_cities 는 <string-array> 이고 AlarmRandomPromptSettings.kt:410 에서 R.array 로 실사용 중이다(377행 바로 아래) — 라인 범위 삭제 금지, 반드시 키 이름 매칭으로 지울 것
  - 확신도: high

- [x] **이용권 '선물(gift)' 결제 UI 문구 8키 + 호출되지 않는 onCheckoutPlan 파라미터 체인**
  - 위치: `strings.xml:83,84,85,86,89,90,111,143; ui/billing/BillingPanels.kt:69; ui/alarms/AlarmListScreen.kt:102,343; ui/app/AlarmTalkApp.kt:1026; ui/main/MainViewModelBillingActions.kt:261,266,269`
  - 조치: 문자열 8키(3로케일) 삭제 + onCheckoutPlan 파라미터를 AlarmTalkApp→AlarmListScreen→BillingPanels 3단계에서 제거, checkoutPlan 의 gift 인자·CheckoutRequest(gift=…)·if(!gift) 분기 정리
  - 위험: checkoutPlan() 함수 자체는 삭제 금지 — MainViewModelBillingActions.kt:532(changePlan requiresCheckout)·549(NO_ACTIVE_SUBSCRIPTION 폴백)가 여전히 호출한다. GIFT- 코드 등록/공유 경로(BillingPanels.kt:143 RedeemCodeKind.Gift, ShareCode.kt:20, MainViewModelBillingActions.kt:292)는 살아 있으므로 유지
  - 확신도: high

- [x] **DELETE /api/voice/_dev/clear-mine — 호출자 0건인 74줄짜리 다중 테이블 원시 DELETE dead route**
  - 위치: `packages/backend/src/routes/voice-profile.ts:321-400`
  - 조치: JSDoc(321-326) 포함 통째로 제거
  - 위험: 대체수단으로 scripts/reset-test-data.ts 를 안내하지 말 것 — PROTECTED_TABLES 가 litestream 2개뿐(reset-test-data.ts:38-41)이라 수동 시딩한 dev 스톡 클립 144개까지 전부 지운다
  - 확신도: high

- [x] **존재하지 않는 lib/scheduler.ts 와 GET /tick 을 가리키는 죽은 주석·모킹**
  - 위치: `packages/backend/src/index.ts:245,355; routes/alarm-helpers.ts:263; routes/alarm-mutation.ts:844; lib/migrations.ts:1217; test/alarm-query.test.ts:12-14,51-53`
  - 조치: scheduler.ts 언급 문장·GET /tick 안내 문장·'list/tick/cron' 주석·vi.mock('../src/lib/scheduler') 블록·빈 섹션 헤더 제거. cron 주기 상수 설명은 index.ts 로 일원화
  - 위험: vi.mock 제거 후 alarm-query 테스트 1회 실행 확인
  - 확신도: high

- [ ] **PATCH /user/me 의 레거시 방해금지 3필드 입력 분기(약 70줄) — 유일 클라이언트인 안드로이드가 항상 windows 를 동봉해 도달 불가**
  - 위치: `packages/backend/src/routes/user.ts:122-192 (근거: MainViewModelAuthActions.kt:456-462)`
  - 조치: else 분기 삭제, hasQuietWindows=false 면 quiet 업데이트 없음으로 처리. 응답의 3필드는 건드리지 말 것(④ 항목 참조)
  - 위험: curl/QA 스크립트가 3필드만 PATCH 하고 있었다면 조용히 무시되고 NO_FIELDS_TO_UPDATE 가 될 수 있다 — dev 로그로 실호출 여부 1회 확인 권장
  - 확신도: high

- [ ] **packages/shared 의 z.infer export type 8개 미사용 + 파일 내부 전용 스키마 2개가 export**
  - 위치: `packages/shared/src/schemas/auth.ts:24,30,35,42,50,56,61 / voice.ts:24 (type), auth.ts:10,17 (PasswordSchema, EmailVerificationCodeSchema)`
  - 조치: export type 8줄 삭제, PasswordSchema·EmailVerificationCodeSchema 는 export 키워드만 제거(이름은 유지 — AuthScreen.kt:182·PasswordResetScreen.kt:62 주석이 이 이름으로 정책 출처를 가리킨다)
  - 확신도: high

- [ ] **클라가 한 번도 읽지 않는 API 응답 필드 묶음 — consents.required / voice/upload 6필드 / tts voice_name·cache_hit·provider·context / billing 8필드 / checkout_stub·plan_group**
  - 위치: `backend: routes/user.ts:453, routes/voice-upload.ts:186-196, routes/tts.ts:1294,1296,1504,1506,1668,1804,1834,1859,1863, routes/billing-query.ts:80-96, routes/billing-mutation.ts:334,337,907 / android: network/AuthApi.kt:184, VoiceProfileApi.kt:44-52, TtsApi.kt:40,41,68,89,99, BillingApi.kt:17,18,20,23,24,32,33,34,68`
  - 조치: 1단계로 안드로이드 data class 의 미사용 필드부터 제거(무해). 2단계로 서버 직렬화 축소 — voice/upload 는 {upload:{id}} 로, tts 는 SELECT 별칭 제거(JOIN 은 필터에 필요하니 유지)
  - 위험: 서버 축소는 테스트 동반 수정 필요: tts.test.ts:878,918,957,958 이 body.cache_hit/provider 로 캐시 동작을 검증하므로 관측 수단을 로그로 옮긴 뒤 지울 것. billing 계열 테스트가 필드를 단언하는지 확인. max_members·period_days·price_krw 는 서버 내부 로직에서 계속 쓰이니 '응답 필드'만 제거
  - 확신도: high

- [ ] **tts 캐시 조회가 ga.mime_type 을 SELECT 하지만 타입에도 반환값에도 없어 매 히트마다 읽고 버린다**
  - 위치: `packages/backend/src/routes/tts.ts:1885 (typedRow 1894-1901, 반환 1907-1915)`
  - 조치: SELECT 목록에서 `, ga.mime_type` 제거. 그러면 generated_audio_assets.mime_type 도 완전 INSERT 전용이 되어 아래 컬럼 DROP 후보로 승격(audio_format 으로 MIME 재구성 가능)
  - 확신도: high

- [x] **[#89 마이그레이션 A] 읽기 0건인 사장 컬럼 13개 DROP**
  - 위치: `packages/backend/src/lib/migrations.ts:136-137(message_library.is_favorite/received_at), :586,587,588,591,596,713,714(generated_audio_assets 7컬럼), :228-229(voice_uploads.size_bytes/duration_ms), :1205(promo_code_redemptions.subscription_id), :1240(voice_profile_change_ledger.voice_profile_id)`
  - 조치: 현재 최신 #88(migrations.ts:1844) 다음 #89 에 DROP COLUMN 추가. 동반 수정 필수 — scripts/db-inventory.ts:196-199 프로브 제거, INSERT 축소: routes/tts.ts:1430-1433, lib/stock-clips.ts:854-857, routes/voice-upload.ts:171-180, routes/voice-profile.ts:1504-1516, lib/promo-redemption.ts:296. idx_voice_profile_change_ledger_profile(migrations.ts:1251-1252) DROP 을 컬럼 DROP 앞에 배치
  - 위험: 마이그레이션 DROP 은 되돌리기 어렵다(테이블 재작성 없이 컬럼 복구 불가). voice_uploads.size_bytes 와 store 계열 NOT NULL 컬럼은 INSERT 를 같이 안 줄이면 배포 즉시 500. '어떤 모델/보이스로 만든 오디오인가' 사후 추적은 영구 상실(현재도 코드로는 안 본다). messages.delivery_tags_json 은 routes/tts.ts:1697·1804 에서 실제로 읽히는 별개 컬럼이니 혼동 금지
  - 확신도: high

- [x] **[#89 마이그레이션 B] UNIQUE 자동 인덱스 또는 상위 복합 인덱스와 완전 중복인 인덱스 9종**
  - 위치: `packages/backend/src/lib/migrations.ts:215, :295, :327, :761-762, :1210-1211, :356, :650-651, :168, :1861`
  - 조치: #89 에 DROP INDEX IF EXISTS 9줄 (idx_users_email / idx_plans_key / idx_voucher_codes_hash / idx_voice_profile_relationships_user / idx_promo_redemptions_code / idx_plan_group_members_group / idx_voucher_redemptions_voucher / idx_voice_profiles_user / idx_push_tokens_user)
  - 위험: idx_push_tokens_user 를 지우면 packages/backend/test/migrations.test.ts:425-441 이 sqlite_master 실재 여부를 arrayContaining 으로 단언하므로 CI 실패 — 테스트 동반 수정 필수. migrations.test.ts:101·118·133 은 SQL 문자열 toContain 이라 그대로 통과
  - 확신도: high

- [x] **[#89 마이그레이션 C] 쿼리 계획에 절대 들어가지 않는 인덱스 3종 — 선행 컬럼이 COALESCE 로 감싸이거나 술어가 아예 없음**
  - 위치: `packages/backend/src/lib/migrations.ts:1172-1173(idx_messages_stock), :784(idx_voice_profiles_is_draft), :1175(idx_alarms_bucket)`
  - 조치: 최소안은 3개 모두 DROP INDEX IF EXISTS(현재 대비 성능 손해 0). 근본안을 택하면 messages.is_preset 을 NOT NULL DEFAULT 0 으로 정규화(테이블 재작성 atomic:true)하고 COALESCE 11곳(lib/stock-clips.ts:412,597,803,838, lib/audio-retention.ts:302, routes/tts.ts:1637,1717,1721,1807, routes/alarm-mutation.ts:97, routes/voice-profile.ts:1864,1973)을 `is_preset = 1/0` 으로 교체 후 인덱스 유지. bucket_id 컬럼 자체는 응답에 실리므로 유지
  - 위험: idx_messages_stock 을 (voice_profile_id, category, language, variant) 로 재정의하는 중간안을 택하면 idx_messages_voice(migrations.ts:170)와 프리픽스가 겹쳐 그것도 함께 DROP 해야 중복이 안 남는다
  - 확신도: high

- [x] **[#89 마이그레이션 D] store_transactions.subscription_id 인덱스 부재 — 해지 경로가 풀스캔**
  - 위치: `인덱스 정의 packages/backend/src/lib/migrations.ts:1885-1888 / 술어 lib/billing-cancel.ts:631-634, routes/billing-mutation.ts:706-709`
  - 조치: #89 에 `CREATE INDEX IF NOT EXISTS idx_store_transactions_subscription ON store_transactions(subscription_id)` 추가(#80 과 동일 성격의 유실 보정)
  - 위험: 없음(순수 추가). 해지 실패는 계속 과금 경로라 조용히 느려지면 위험하므로 출시 전 반영 권장
  - 확신도: high

- [x] **idx_voice_profiles_lru 가 ORDER BY 선행항 표현식 때문에 안 걸린다(#75 도입 목적 미달성)**
  - ⚠ **이 체크는 2026-09-02 까지 거짓이었다.** `git log -L` 로 추적하니 체크를 바꾼 커밋
    (`24b1d507`, #89·#90)이 **ORDER BY 도 인덱스도 건드리지 않았다** — 대장이 하지 않은
    수정을 완료로 적고 있었다. 실제 처리는 마이그레이션 **#108**(인덱스 DROP)이다.
    ⚠ 이 문서의 다른 체크박스도 코드로 확인하고 믿을 것.
  - 위치: `packages/backend/src/lib/voice-slots.ts:85 / 인덱스 packages/backend/src/lib/migrations.ts:1544-1545`
  - 조치: `(last_used_at IS NULL) DESC,` 를 제거해 `ORDER BY last_used_at ASC, created_at ASC` 로 변경(SQLite ASC = NULLS FIRST 라 의미 동일 + 인덱스 적중). 이 수정을 안 할 거면 인덱스를 DROP
  - 위험: NULL 정렬 순서를 SQLite 기본 동작에 의존하게 된다 — 명시성을 원하면 `ORDER BY last_used_at ASC NULLS FIRST`(인덱스 여전히 적중)
  - 확신도: high

- [ ] **PUSH_PLATFORMS 의 'web' — 등록할 클라이언트가 없는 죽은 enum 값**
  - 위치: `packages/backend/src/routes/push.ts:8 (근거: network/PushApi.kt:10 platform="android" 하드코딩, apps/landing 참조 0건)`
  - 조치: PUSH_PLATFORMS 를 ['android'] 로 좁힌다. DB CHECK 는 테이블 재작성이 필요하니 다음 재작성 마이그레이션 때 처리
  - 위험: packages/backend/test/push-token-unique.test.ts:60,66 이 'web' 을 두 번째 플랫폼 값으로 쓴다 — 테스트 의도는 토큰 유니크성이라 'android' 로 치환 가능
  - 확신도: high

## ② 문구·문서 수정 (서비스 현황 불일치) (13건)

- [x] **PR 에서 CI 를 돌리려면 `ci` 라벨이 필수인데 어느 문서에도 없다 — 라벨 없으면 필수 체크가 exit 1 로 실패해 머지 불가**
  - 위치: `CLAUDE.md:23, AGENTS.md:36, docs/standards/README.md:97 (근거 .github/workflows/ci.yml:24-29,51-55,78-82,112-116)`
  - 조치: 세 문서 컨벤션 줄 뒤에 "PR 에 `ci` 라벨을 붙여야 CI 가 돈다. 라벨 뒤에 커밋을 더 올리면 라벨을 뗐다 다시 붙인다" 추가. ci.yml:21 의 '필수 8개' 괄호주석은 현재 잡 전개(lint1+typecheck3+test3=7)에 맞춰 정정하거나 '(2026-07-29 당시 8개)'로 시점 표기
  - 위험: 필수 체크 개수 7 은 잡 전개 기준 추론 — GitHub 브랜치 보호 설정 실물 확인 후 확정
  - 확신도: high

- [x] **매뉴얼 3개 언어가 '목소리 등록 = 30초 녹음'이라 안내하지만 정식 등록은 60초 이상 필수 (사용자가 실제로 등록 실패를 겪는다)**
  - 위치: `docs/manual/README.ko.md:34, README.md:34, README.ja.md:34, docs/qa/README.md:36-37 (근거 voice-profile.ts:42 MIN=60_000, :47 MAX=120_000, :46 draft 만 12_000)`
  - 조치: 매뉴얼 3종 :34 를 "1분 이상 2분 이하로 녹음(또는 그 길이의 오디오·영상 파일 선택)"으로 교체. QA TC-VOC-001/002 는 목소리 프로필(정식 60~120초, 프리뷰 12초 이상)과 알람 로컬 오디오(30초 트림)를 분리해 재작성
  - 위험: 30초는 AlarmAudioStore.kt:26 의 로컬 알람 오디오 상한이지 목소리 프로필과 무관 — 같은 파일 32행에 120_000L 도 있어 '30초=로컬 상한' 서술은 한쪽만 맞다
  - 확신도: high

- [ ] **docs/standards 가 존재하지 않는 Gradle 태스크를 표준 명령으로 안내(product flavor 때문에 생성되지 않음)**
  - 위치: `docs/standards/README.md:57,59`
  - 조치: :57 → `./gradlew :app:testDevDebugUnitTest`, :59 → `./gradlew :app:lintDevDebug`. :58 connectedAndroidTest 는 유효하니 유지
  - 확신도: high

- [ ] **QA 보안 테스트케이스의 레이트리밋·바디상한 수치가 코드와 다름(TC-SEC-002 는 그대로 돌리면 무조건 실패)**
  - 위치: `docs/qa/README.md:97,98 (코드 middleware/rateLimit.ts:24-25 = 60req/60s, bodyLimit.ts:3 = 25MB)`
  - 조치: 수치 하드코딩 대신 코드 참조로 변경 — "rateLimit.ts 의 MAX_REQUESTS 를 넘겨 1분 내 호출", "bodyLimit.ts 의 MAX_BODY_BYTES 를 넘는 content-length 전송". docs/standards/README.md:152-153 의 자체 규약(상한을 문서에 베끼지 말 것)과도 정합
  - 확신도: high

- [ ] **아키텍처 문서가 존재하지 않는 '지금 동기화' 탭을 절 제목으로 사용**
  - 위치: `docs/tech/README.md:95 (실제: AlarmTalkApp.kt:521 알람 탭 진입 LaunchedEffect + :510-511 60초 스로틀)`
  - 조치: 제목을 `### 서버 동기화 (알람 탭 진입 시 자동, 60초 스로틀)` 로 바꾸고 '수동 버튼은 없다' 한 줄 명시
  - 확신도: high

- [ ] **이번 브랜치가 추가한 error_code 2개가 레퍼런스 문서에 없다**
  - 위치: `docs/reference/error-codes.md:97-115 (코드: routes/user.ts:311 DOCUMENT_VERSION_REQUIRED 400, :321/:326 POLICY_VERSION_MISMATCH 409)`
  - 조치: 2-3 절에 두 행 추가. POLICY_VERSION_MISMATCH 는 409 단일(409/400 아님). 역방향 드리프트(문서에만 있는 코드)는 0건 확인됨
  - 확신도: high

- [ ] **backend README 의 init-db 예제가 시크릿 헤더 없이 안내 — 그대로 실행하면 404**
  - 위치: `packages/backend/README.md:39,42 (근거 src/index.ts:95-113 canRunInitDb)`
  - 조치: 예제를 `curl -X POST "http://localhost:8787/api/init-db" -H "x-init-db-secret: <secret>"` 로 바꾸고, 서브리퀘스트 캡 때문에 `?fromId=1&toId=10` 범위 실행이 필요하다는 점과 '워커에 INIT_DB_SECRET 이 없으면 404' 를 한 줄 추가
  - 확신도: high

- [ ] **backend README 의 API 개요가 '결제 스텁'이라 하고 마운트된 라우트 4개(/api/code, /api/push, /api/holiday, /admin)가 누락, 환경변수 표도 낡음**
  - 위치: `packages/backend/README.md:62, :52-64, :13-25 (실제 index.ts:197,206,222-229,233)`
  - 조치: :62 를 "구독(Google Play 인앱결제 confirm/RTDN) + 이용권 코드" 로 고치고 4행 추가. 환경변수 표는 나열 대신 src/types.ts 의 Env 인터페이스와 wrangler.toml 주석을 가리키게 축약
  - 확신도: high

- [ ] **packages/shared README 가 없는 파일(user.ts)·없는 심볼(UserSchema/UserPlan/VoiceProfileStatus)을 문서화하고 예제가 컴파일 불가하며 '스캐폴드만 있다'도 사실이 아님**
  - 위치: `packages/shared/README.md:15,16,34-38,40 (실제 트리: index.ts + schemas/auth.ts + schemas/voice.ts)`
  - 조치: 구조 트리를 auth.ts/voice.ts 로 정정, 예제를 RegisterRequestSchema.parse 또는 VoicePreviewTextUpdateSchema 로 교체, :40 '스캐폴드' 문장 삭제(CI 필수 체크 7개 중 2개가 shared 의 typecheck·test)
  - 확신도: high

- [ ] **landing README 에 '배포 (Vercel)' 절이 통째로 중복, 구조도가 삭제된 섹션 컴포넌트를 나열하고 TODO 도 무효**
  - 위치: `apps/landing/README.md:22-28 vs :39-45(중복), :37, :97, :99, :110`
  - 조치: :39-45 두 번째 사본 삭제. :97 quotes.tsx·:99 waitlist.tsx 행 삭제하고 실재하는 components/motion/* 행 추가, :110 waitlist TODO 삭제, :37 네임스페이스 예시에서 waitlist 제거
  - 확신도: high

- [ ] **결제 런북의 Billing Library 버전·파일 라인이 틀림(출시 직전 운영자가 그대로 따라가는 체크리스트)**
  - 위치: `GOOGLE_PLAY_BILLING_SETUP.md:15,16,75 (실제 app/build.gradle.kts:318 billing-ktx:8.0.0, packages/backend/wrangler.toml:62-66)`
  - 조치: :15 를 billing-ktx:8.0.0 + 라인 대신 심볼 기준 표기, :16 을 'Billing Library 8.x 내장', :75 를 wrangler.toml 의 'Billing —' 주석 블록 참조로 정정
  - 확신도: high

- [ ] **launch-tracking·LAUNCH_AUDIT 의 참조 경로 3개가 죽은 경로**
  - 위치: `docs/security/launch-tracking.ko.md:4,31; docs/security/LAUNCH_AUDIT.md:25`
  - 조치: 세 경로를 docs/security/... 로 정정(docs/qa/LAUNCH_AUDIT.md → docs/security/LAUNCH_AUDIT.md, docs/qa/archive/google-play-billing-audit-2026-07-08.md → docs/security/..., docs/tech/backend-findings.ko.md → docs/security/backend-findings.ko.md)
  - 확신도: high

- [ ] **consentMiddleware 의 면제 목록 JSDoc 이 실효 목록과 다르다(/auth·/health·/app/version·/holiday 는 app 레벨에 먼저 등록돼 api 체인에 안 들어온다)**
  - 위치: `packages/backend/src/middleware/consent.ts:8-15, :28-34 (마운트 index.ts:216 api.use, :235)`
  - 조치: JSDoc 을 실효 목록(/user/consents*, /user/me/deletion·DELETE /user/me, /push/*)으로 정정하고, :28-34 는 '라우트가 api 하위로 이동할 경우를 대비한 방어적 중복'임을 주석으로 명시
  - 위험: 삭제는 비권장 — GET /api 는 정규화로 p='/' 가 되어 :30 을 실제로 타고, authRoutes/holidayRoutes 가 매칭 못 하는 하위 경로는 api 체인으로 떨어져 :28·:34 도 실행된다. 지우면 향후 이동 시 회귀를 잡을 테스트가 없다
  - 확신도: medium

## ③ 법적·정책 리스크 (15건)

- [x] **문서·앱이 '언제든 동의 철회 가능'이라 고지하지만 앱에 음성 생체정보·국외이전 철회 UI가 없다(서버는 agreed=false 를 받아 처리한다)**
  - 위치: `ui/settings/ConsentHistoryScreen.kt:133-143,150-157 / strings.xml:1046(values-en:1018, values-ja:1026) / docs/legal/privacy-policy.ko.md:45,186, terms-of-service.ko.md:146, consent-and-permission-copy.ko.md:82 / 서버 routes/user.ts:353-371`
  - 조치: ConsentHistoryScreen 의 voice_biometric 행을 marketing 과 같은 ConsentToggleRow 로 교체(백엔드 변경 불필요 — 앱의 recordConsents 4곳 중 agreed 가 변수인 곳은 marketing 토글 하나뿐). 붙일 수 없으면 strings.xml:1046·consent-and-permission-copy:82 에서 '더보기에서 언제든 철회'를 빼고 이메일 창구만 남긴다(3로케일 동시)
  - 위험: 카피만 지우면 민감정보 동의의 철회 수단 미제공이 그대로 남아 법무 관점에선 미해결이다. 반대로 토글을 붙이면 한 번의 탭으로 deleteSensitiveVoiceDataForUser 가 돌아 등록 목소리·생성 음성이 복구 불가하게 삭제되므로 확인 다이얼로그가 선행 필수이며, 철회 시 기존 프로필 처리(즉시 잠금 vs 삭제) 정책 결정이 선행돼야 한다
  - 확신도: high

- [x] **민감 동의를 철회하면 서버의 목소리·원본·생성 음성이 영구 파기되고 알람이 sound-only 로 강등되는데, 처리방침·약관·앱 어디에도 고지가 없다**
  - 위치: `packages/backend/src/routes/user.ts:353-380, lib/paid-voice-cleanup.ts:280-330 / docs/legal/privacy-policy.ko.md:45,105, terms-of-service.ko.md:146, strings.xml:1046`
  - 조치: 처리방침 §1.3(:45)·§3 보유기간표(:105)·약관 제14조(:146)에 '동의 철회 시 서버의 음성 프로필·원본·생성 음성이 즉시 파기되며 복구할 수 없다'를 명시. strings.xml:1046 은 인과가 반대로 적혀 있으니 함께 수정, 철회 확인 다이얼로그에도 같은 문장
  - 위험: 법무 문서 수정은 되돌리기 어렵다(스토어 제출본·앱 에셋 동기화 필요) — 실제 동작을 그대로 적는 방향이라 내용 리스크는 없음
  - 확신도: high

- [ ] **국외이전 동의를 거부하면 '일부 기능 제한'이라 고지하지만 실제로는 가입 동의 화면을 통과할 수 없다**
  - 위치: `docs/legal/privacy-policy.ko.md:142 / lib/consent.ts:58-61, routes/user.ts:453 / ui/auth/ConsentScreen.kt:105-115,252`
  - 조치: 처리방침 §5 말미를 '거부 시 서비스 이용 불가(기본 목소리 알람도 국외 AI 처리를 거치기 때문)'로 고쳐 쓰고, 가입 화면 문구(strings.xml:14-15)에도 같은 결과를 노출
  - 위험: 미들웨어 하드 게이트는 GENERAL 3종만 본다(consent.ts:54-56) — '계정은 존재하나 공식 앱 UI로는 진입 불가'라는 층위 구분을 뭉개지 말 것. 고지를 정확히 하면 '필수 국외이전 동의' 설계 자체가 법무 검토 대상으로 부각된다
  - 확신도: high

- [ ] **국외이전 표가 수탁사를 익명('이메일 발송 제공자')으로 두고 이전 국가·수탁사 연락처를 특정하지 않아 법정 고지항목 미충족**
  - 위치: `docs/legal/privacy-policy.ko.md:129-138 (대조: marketing-consent.ko.md:38 은 이미 'Resend' 명시, 실제 호출 lib/email-verification.ts:53)`
  - 조치: 표에 실제 법인명(Resend, Inc. 등)·이전 국가·수탁사 개인정보 문의 창구 열을 채운다. Turso(:132)·ElevenLabs(:133)·Google(:135)·Sentry(:137) 행의 '제공자 인프라 운영 국가' 뭉뚱그림도 함께 해소
  - 위험: 개인정보보호법 제26조·제28조의8 제2항 요건 — 법무 검토 후 확정할 것
  - 확신도: high

- [x] ~~**위탁·국외이전 표에 Open-Meteo(날씨·대기질·지오코딩)가 빠져 있다**~~ → **고지 대상 아님으로 종결(2026-08-01)**
  - 판정 근거: Open-Meteo 로 나가는 것은 **도시명 / 도시 중심 좌표 / 날짜 / 타임존뿐이고 이용자 식별자가 없다**(`tts.ts:366-392` forecast, `:523` air-quality, `:586-590` geocoding — `name=<도시>` 만 실린다). 호출은 전부 **서버(Cloudflare Worker)에서** 나가므로 수신 측은 이용자 단말 IP 도 보지 못한다(안드로이드에서 open-meteo 를 직접 부르는 코드 0건).
  - 따라서 수신자가 개인을 알아볼 수 없어 **개인정보의 국외 이전(개인정보보호법 §28-8)·처리위탁(§26)에 해당하지 않는다.** 표에 행을 추가할 의무가 없고, 이 사유로 정책 버전을 올릴 필요도 없다.
  - 앱은 위치 권한을 요청하지 않고(AndroidManifest 에 LOCATION 없음) 좌표를 직접 보내지도 않는다 — 좌표는 도시명을 지오코딩한 **도시 중심값**이다. 처리방침 §1.4:53-57 이 이미 '사용자가 직접 선택·입력한 국가·도시' 를 수집 항목으로 고지하고 개인위치정보가 아님을 밝히고 있어 정합하다.
  - **다시 고지 대상이 되는 조건**(바뀌면 이 결론을 재검토): ① 단말 GPS·정밀 좌표를 쓰기 시작, ② 요청에 계정/기기 식별자를 함께 실음, ③ 앱이 Open-Meteo 를 직접 호출(이용자 IP 노출), ④ 응답을 개인 단위로 축적 저장.

- [ ] ~~(원 지적 원문 보존)~~ 위탁·국외이전 표에 Open-Meteo 추가 검토
  - 위치: `docs/legal/privacy-policy.ko.md:129-138 / 호출 routes/tts.ts:366, :523, :586-590(url.searchParams.set('name', city))`
  - 조치: §5 표에 Open-Meteo 행 추가(처리 항목: 이용자가 선택한 국가·도시명 또는 좌표 / 목적: 날씨·대기질 기반 알람 문구). 또는 도시명→좌표를 서버에서 캐싱해 외부 지오코딩 질의를 없앤다
  - 위험: 이전 국가를 '독일'로 특정한 원 주장은 코드로 확인 불가 — 표에 적기 전 Open-Meteo 운영 주체·서버 소재를 사업자 공시로 확인할 것
  - 확신도: high

- [ ] **처리방침의 '생성 음성' 보유기간이 실제 30일 자동 삭제 TTL과 다르다**
  - 위치: `docs/legal/privacy-policy.ko.md:105 / lib/audio-retention.ts:26(30일), :284-321, :246-282, :30(draft 1시간), index.ts:289-294`
  - 조치: §3 표를 3분류로 분리 — '음성 프로필·확정 목소리의 원본: 사용자 삭제 또는 탈퇴까지 / 미확정(draft·프로필 없는) 업로드 원본: 7일 / 생성 음성: 30일(활성 알람이 참조 중이면 보존)'
  - 위험: '원본 업로드 일괄 7일'로 고치면 그것도 허위 고지가 된다 — audio-retention.ts:246-263 이 확정 프로필 연결 업로드를 NOT EXISTS 로 명시 제외한다
  - 확신도: high

- [ ] **처리방침의 앱 권한 목록이 매니페스트와 양방향으로 어긋난다(없는 파일/미디어 권한을 요청한다고 적고, 실제 권한 4종은 누락)**
  - 위치: `docs/legal/privacy-policy.ko.md:160-168 특히 :166, docs/legal/consent-and-permission-copy.ko.md:105-114 / apps/android-native/app/src/main/AndroidManifest.xml:4-17`
  - 조치: §7 의 파일/미디어 항목을 '권한 없이 문서 선택기(SAF)로 사용자가 고른 파일만 읽음'으로 고치고, FOREGROUND_SERVICE_MEDIA_PLAYBACK·WAKE_LOCK·RECEIVE_BOOT_COMPLETED·ACCESS_NETWORK_STATE 를 목록에 추가. consent-and-permission-copy §4 의 존재하지 않는 '파일 선택 권한' 사전설명 카피도 삭제
  - 확신도: high

- [ ] **수집·저장하지 않는 항목(접속 IP·User-Agent·문의 첨부파일)을 자동 수집한다고 고지**
  - 위치: `docs/legal/privacy-policy.ko.md:75-76 / middleware/rateLimit.ts:42,115(인메모리 카운터 키로만 사용), middleware/sentry.ts:20-28, apps/landing/app/[locale]/contact/page.tsx:128(mailto 만)`
  - 조치: IP/UA 는 'Cloudflare 엣지 로그·Sentry 오류 리포트에 포함될 수 있음' 수준으로 좁혀 다시 쓰고, 문의 첨부는 '이용자가 이메일로 자발적으로 보낸 자료'로 한정하거나 삭제
  - 위험: '전혀 수집하지 않음'으로 지우면 반대 방향 오고지 — Cloudflare 는 이미 §5 에 보안 로그 수탁으로 올라 있다. 없애지 말고 정확히 좁힐 것
  - 확신도: medium

- [ ] **탈퇴 시 마케팅 수신동의·철회 기록까지 전량 삭제해 스스로 약속한 분리보관과 어긋난다**
  - 위치: `packages/backend/src/lib/account-deletion.ts:199-202 (결제만 :23-57 로 가명 보존) / docs/legal/marketing-consent.ko.md:27, compliance-notes.ko.md:15`
  - 조치: 실제 광고 발송을 시작하기 전까지는 marketing-consent.ko.md:27 문구를 현행 동작(탈퇴 시 전량 파기)에 맞춰 낮추는 쪽이 싸다. 발송을 시작한다면 marketing 유형만 (가명 user_id, 동의여부, 시각) 분리 테이블로 이관
  - 위험: 분리 테이블을 만들면 보관기간(1년)·자동 파기를 함께 넣지 않으면 파기 원칙과 충돌. 현시점 실제 발송 코드가 없어 위반 리스크는 낮다
  - 확신도: medium

- [ ] **약관이 환불·청약철회를 Google Play 정책에 '우선 적용'시켜 법정 청약철회권을 배제하는 것처럼 읽힌다**
  - 위치: `docs/legal/terms-of-service.ko.md:102 / 실제 동작 routes/billing-mutation.ts:662-671 → lib/play-subscriptions.ts:138-144(revocationContext.proratedRefund)`
  - 조치: '전자상거래법상 청약철회권은 그대로 보장되며, 인앱결제 특성상 환불 접수·처리는 Google Play 절차를 통해 진행된다' 취지로 재작성하고, 앱 내 즉시 해지 시 비례 환불이 발생한다는 점 반영
  - 위험: '백엔드에 자체 환불 경로 없음'은 사실이 아니다(immediate 해지가 Play API 비례 환불을 태운다). 약관규제법 제6조 무효 소지 판단과 제17조 제2항 제5호 고지 여부는 법무 검토 영역
  - 확신도: medium

- [ ] **같은 앱 안에서 voice_biometric 이 가입 화면은 '[선택]', 설정 화면은 '필수 동의 내용' 섹션으로 표시된다**
  - 위치: `ui/settings/ConsentHistoryScreen.kt:114,133-137 / strings.xml:20, 913-916 / 서버 lib/consent.ts:75, routes/user.ts:458`
  - 조치: voice_biometric 행을 consent_section_optional(strings.xml:914) 섹션(ConsentHistoryScreen.kt:147-159)으로 옮기고 라벨에 [선택] 표기를 맞춘다. overseas_transfer 는 REQUIRED_CONSENT_TYPES 이므로 필수 섹션 유지가 맞다
  - 위험: 없음(표시 분류만 변경, 기록/게이트 로직 무관). consent.ts:67-70 주석이 '이 동의를 가입 조건으로 요구하면 개인정보보호법 제22조제5항에 정면으로 걸린다'고 못 박고 있어 표기 일치는 법적 의미가 있다
  - 확신도: high

- [ ] **docs/legal/README.md 의 동의 시점 규약이 consent.ts·compliance-notes 와 정반대(가입 게이트에 국외이전을 넣지 말라고 지시)**
  - 위치: `docs/legal/README.md:39-42 / lib/consent.ts:36,58-61,69-75 / compliance-notes.ko.md:18-19,24-27 / consent-and-permission-copy.ko.md:16-18,26`
  - 조치: '가입 게이트 = 일반 필수 3종(terms/privacy/age14) + overseas_transfer, voice_biometric 은 같은 화면에 선택으로 노출하되 거절한 사람만 목소리 등록 화면 인라인 체크박스에서 재확인. 미들웨어 하드 게이트는 GENERAL 3종만, 음성·TTS 라우트만 SENSITIVE 를 별도 확인'으로 교체
  - 위험: 법무 폴더의 '고칠 때 지킬 것' 규약이라 방치하면 다음 작업자가 이 문서를 믿고 overseas_transfer 를 가입 게이트에서 빼고, 무료 플랜 기본 알람의 Vertex·ElevenLabs 국외 이전이 동의 없이 일어난다
  - 확신도: high

- [ ] **en/ja 플랜 가격 폴백 문자열이 실가격과 무관한 임의값(원화에서 0 하나 뗀 값)**
  - 위치: `values-en/strings.xml:97,103,112; values-ja/strings.xml:97,103,112 / 소비처 ui/billing/BillingPanels.kt:107,117,129 (실가격 migrations.ts:1141-1143 = 3900/6900/14900 KRW)`
  - 조치: 폴백에서 임의 통화 환산을 제거하고 원화 기준으로 통일하거나, planPrices 가 비면 가격줄 자체를 숨긴다
  - 위험: Play formattedPrice 미수신 시 스토어 표기와 다른 가격이 그대로 노출 — Play 정책·표시광고 이슈 가능
  - 확신도: high

- [ ] **POST /api/billing/test-codes(QA 전용 유료 바우처 발급기)에 production 하드게이트가 없다**
  - 위치: `packages/backend/src/routes/billing-mutation.ts:342-346 (대조군: isBillingStubEnabled :104, 사용처 :252-253, :803-804)`
  - 조치: 라우트 진입부에 `if (c.env.ENVIRONMENT === 'production') return c.json({...}, 404)` 추가. 라우트 자체는 dev QA 에서 쓰이므로 삭제 대상 아님
  - 위험: 현재는 TEST_CODE_ISSUER_EMAILS 미설정 시 fail-closed(전원 403)라 즉시 위험은 아니지만, prod 에 이 env 를 실수로 채우는 순간 1콜 최대 50장/365일 유료 바우처 발급이 열린다. LAUNCH_AUDIT 의 동일 지적이 미해결 상태
  - 확신도: high

- [ ] **retained_billing_records 의 retain_until 경과분을 파기하는 cron 이 없어 보존기간 초과 보관이 무기한 누적**
  - 위치: `packages/backend/src/lib/migrations.ts:825-840, lib/account-deletion.ts:42-54(유일 INSERT), src/index.ts:326-341(scheduled 는 deletion_purge_at 만 본다)`
  - 조치: index.ts 의 scheduled 에 retain_until <= now 인 행을 삭제하는 블록 추가
  - 위험: 테이블·컬럼은 절대 삭제 금지 — 전자상거래법 5년 보존 대상이고 test/compliance-verify.test.ts:324 가 retained_reason 을 읽는다. 인덱스 2개는 DROP 해도 무방하나 이득이 작다
  - 확신도: high

## ④ 확인 필요 (사용자 판단) (10건)

- [ ] **[삭제 금지 경고] family_alarm_quiet_days/start/end 3필드는 '죽은 미러'가 아니라 클라가 실제로 읽는 폴백이다**
  - 위치: `network/AuthSessionStore.kt:326-340, ui/editor/AlarmEditorScreenComponents.kt:121-142 / test AlarmEditorScreenTest.kt:27-50 / 서버 routes/user.ts:105,115, lib/family-alarm-settings.ts:119-131`
  - 조치: 응답 3필드를 지우려면 먼저 (a) windows 빈 배열 저장을 서버에서 금지하거나 최소 1창 강제, (b) 두 폴백 지점을 Kotlin 상수 기본값으로 대체, (c) AlarmEditorScreenTest 폴백 테스트 개정 — 이 정리 없이는 손대지 말 것
  - 위험: 높음 — 그냥 걷어내면 '방해금지 창 0개' 계정의 표시/차단 판정이 조용히 바뀌고 테스트가 깨진다. windows=[] 상태는 실제로 저장 가능하다
  - 확신도: high

- [ ] **PATCH /api/voice/:id/relationship 과 공유 목소리 viewer 호칭 기능이 end-to-end 로 죽어 있다(라우트·조인·응답 필드는 있는데 클라 호출·UI 가 없음)**
  - 위치: `routes/voice-profile.ts:1023-1137, :533-534,538-539,551-567 / routes/tts.ts:322-339,809,1001,1005 / network/VoiceProfileApi.kt:136(needs_viewer_info 선언만)`
  - 조치: 제품 결정 필요 — (a) 살리면 안드에 '가족 공유 목소리의 내 호칭 설정' UI + PATCH 호출 추가(진입점은 이미 내려온다). (b) 접으면 라우트 + needs_viewer_info 계산 + viewer_* 별칭 + tts.ts 조인·호출부 + VoiceProfileApi.kt:136 을 세트로 정리
  - 위험: 라우트만 지우면 voice_profile_relationships 가 영구 빈 테이블이 되고 tts 조인이 상수 결과인 반쪽 코드가 남는다. (b) 로 가면 voice.test.ts:377-421 두 테스트와 paid-voice-cleanup-fk.test.ts 가 영향받는다 — 제품 결정 없이 삭제 금지
  - 확신도: high

- [ ] **POST /family/groups/:groupId/transfer-ownership 이 백엔드·테스트 완비인데 클라이언트가 없어 그룹 소유자가 탈퇴할 방법이 없다**
  - 위치: `routes/family-group.ts:160-233, :139-147(OWNER_CANNOT_LEAVE 안내) / network/FamilyApi.kt:75-92 (호출 0건)`
  - 조치: 제품 결정 — 지원하면 FamilyApi 에 @POST 추가 + 가족 관리 화면에 '소유권 넘기기' 연결. 지원 안 하면 family-group.ts:142 카피에서 '권한을 양도하거나'를 빼고 라우트+테스트를 함께 제거
  - 위험: 라우트를 지우면 test/family-group.test.ts:307-470(약 12케이스)·test/family.test.ts:131-210 이 같이 죽는다. 방치하면 소유자가 안내대로 할 수 없는 상태로 출시된다('그룹 해체'는 구독 취소 경로에서만 일어난다)
  - 확신도: high

- [ ] **랜딩 계정삭제 페이지의 삭제요청 주소(privacy@alarm-talk.com)가 모든 법무 문서(gyuwon05@gmail.com)와 다르고, alarm-talk.com 메일함 수신 근거가 코드에 없다**
  - 위치: `apps/landing/app/[locale]/account-deletion/page.tsx:10,175-177,212 / docs/legal/privacy-policy.ko.md:12,226, marketing-consent.ko.md:87, store-disclosures.ko.md:10 / apps/landing/messages/{ko,en,ja}.json:185-206(support@/business@/hello@/press@)`
  - 조치: privacy@ 포함 5개 alarm-talk.com 메일함이 실제 수신되는지 먼저 확인. 안 되면 최소한 account-deletion 페이지만이라도 gyuwon05@gmail.com 으로 교체(Play 데이터 삭제 요건 직결). 살아 있다면 처리방침 §13·약관 제20조에 병기해 단일 출처를 맞춘다
  - 위험: 메일함 생존은 레포 밖 사실이라 코드로 확증 불가 — 이 페이지가 Play 의 Account deletion URL 로 제출된다
  - 확신도: high

- [ ] **앱은 en/ja 로케일을 전면 번역해 배포하는데 약관·처리방침 전문은 한국어 단독**
  - 위치: `docs/legal/*.ko.md 6개만 존재 / app/build.gradle.kts:88 copyLegalDocs 가 ko 2개만 포함 / apps/landing/lib/legal-docs.ts:6-9, app/[locale]/privacy/page.tsx:26,42`
  - 조치: 제품 결정 — 한국 단독 출시가 확정이면 values-en/values-ja 제공 범위와 랜딩 en/ja 라우트 노출 정책을 정리, 해외 이용을 허용하면 두 문서의 en/ja 판을 만들고 Gradle include·legal-docs.ts 를 로케일별로 분기
  - 위험: values-en/ja 는 앱 UI 전면 번역이라 지우면 제품 방향과 충돌 — 제품 결정 없이 손대지 말 것
  - 확신도: high

- [ ] **store_transactions.plan_key / raw_payload 가 INSERT 전용**
  - 위치: `packages/backend/src/lib/migrations.ts:1870,1873 / 쓰기 lib/store-billing.ts:205-206`
  - 조치: plan_key 는 삭제 가능(product_id + plans 조인으로 복원). raw_payload 는 유지 권장 — Play 구매검증/RTDN 원문은 결제 분쟁·전자상거래법 대응 증빙이라 '안 읽는 게 정상'인 컬럼이다. 삭제하려면 결제 담당 판단 필요
  - 위험: raw_payload 삭제 시 분쟁에서 스토어 응답 원문 재구성 불가(되돌릴 수 없음). plan_key 는 NOT NULL 이라 DROP 시 store-billing.ts INSERT 도 같이 줄여야 한다
  - 확신도: high

- [ ] **push_tokens.platform 컬럼 자체를 없앨지(웹 푸시 계획 유무)**
  - 위치: `packages/backend/src/lib/migrations.ts:1852 / routes/push.ts:30-34,55-60 (SELECT/WHERE 0회, 발송은 lib/fcm.ts:68 이 token 만 읽음)`
  - 조치: 웹 푸시 계획이 없으면 컬럼째 DROP 이 가장 깨끗. CHECK 만 'android' 로 좁히려면 #88 처럼 테이블 재작성이 또 필요해 실익 대비 비용이 크다
  - 위험: test/migrations.test.ts:413-422(platform 직접 INSERT)·:425-441(인덱스 단언) 동반 수정 필요. 나중에 웹/iOS 가 생기면 되살려야 한다 — 우선은 ①의 PUSH_PLATFORMS 축소만 하고 컬럼은 보류 권장
  - 확신도: medium

- [ ] **pending_external_deletions.last_error 삭제는 로깅 선행 조건부**
  - 위치: `packages/backend/src/lib/migrations.ts:860 / lib/audio-retention.ts:170-176(catch), :180-184(집계 로그)`
  - 조치: 지우기 전에 audio-retention.ts 의 catch 에 실패 원인 logStructured 를 먼저 넣을 것. users.deletion_requested_at(migrations.ts:819)은 탈퇴 신청 시각 = 처리 이력 증빙이므로 유지
  - 위험: 재검색 결과 현재 catch 는 에러를 로그로 남기지 않는다 — 지금 last_error 를 지우면 외부삭제 실패 원인이 아무 데도 안 남는다
  - 확신도: high

- [ ] **EmailVerificationResponse.expires_in_seconds 를 클라가 안 읽어 재전송 쿨다운·만료 카운트다운이 클라 상수로 돌고 있다**
  - 위치: `packages/backend/src/routes/auth.ts:188,299 / network/AuthApi.kt:82 (소비부 MainViewModelAuthActions.kt:69,195 는 debugCode 만)`
  - 조치: 만료 카운트다운 UI 계획이 있으면 남기고 클라 하드코딩 상수를 이 값으로 교체, 없으면 응답 필드 2곳과 AuthApi.kt:82 를 함께 삭제
  - 확신도: high

- [ ] **POST /api/admin/seed-stock-clips 를 가리키는 주석이 실제 운영 원칙(수동 시딩본·재시드 금지)과 정면으로 어긋난다**
  - 위치: `packages/backend/src/lib/migrations.ts:923,940,1049,1422 / lib/stock-clips.ts:26 / 라우트 index.ts:135-179`
  - 조치: 라우트는 유지(파괴적 재시드용 안전밸브)하되 주석 5곳에 '현재 확정 클립은 로컬 수동 시딩본이며 코드 프리셋과 desync — reset/전체 재시드 금지, 필요 시 ?voice=&category= 로 부분만'을 명시
  - 위험: desync 근거가 레포가 아니라 MEMORY 항목이라 사용자 확인 필요(레포 docs 에 이 경고가 없다). 주석을 그대로 두면 다음 사람이 reset 재시드를 돌려 확정 144클립을 덮어쓸 수 있다
  - 확신도: medium

## 결정이 필요한 질문

- [ ] 공유 목소리 'viewer 호칭' 기능을 살릴 것인가 접을 것인가? (살리면 안드 UI+PATCH 추가, 접으면 라우트·조인·응답 필드·테스트를 세트로 제거)
- [ ] 가족 그룹 '소유권 넘기기'를 이번 출시에 지원하는가? 지원 안 하면 현재 소유자는 탈퇴 자체가 불가하고 앱 안내문(‘권한을 양도하거나’)도 실행 불가 상태로 나간다.
- [ ] privacy@ / support@ / business@ / hello@ / press@alarm-talk.com 5개 메일함이 실제로 수신되는가? 안 되면 Play 계정삭제 URL 페이지의 주소부터 gyuwon05@gmail.com 으로 바꿔야 한다.
- [ ] 한국 단독 출시인가, 해외 이용도 허용인가? 후자면 약관·처리방침의 en/ja 판 제작이 필요하고, 전자면 앱 values-en/ja 와 랜딩 en/ja 라우트 노출 정책을 정리해야 한다.
- [ ] voice_biometric 철회 토글을 붙일 것인가? 붙인다면 철회 시 기존 음성 프로필을 즉시 삭제할지 잠금만 할지 정책을 먼저 정해야 한다(현재 서버는 즉시 영구 삭제).
- [ ] store_transactions.raw_payload 를 지워도 되는가? 결제 분쟁 대응 증빙이라 '안 읽는 게 정상'인 컬럼이라 결제 담당 판단이 필요하다.
- [ ] messages.is_preset 을 NOT NULL 정규화(테이블 재작성 + COALESCE 11곳 교체)까지 갈 것인가, 아니면 idx_messages_stock 을 그냥 DROP 하고 끝낼 것인가?
- [ ] dev 스톡 클립 144개가 코드 프리셋과 desync 라 admin seed reset 금지라는 MEMORY 내용이 지금도 유효한가? 유효하면 마이그레이션 주석 5곳에 경고를 박겠다.
- [ ] #89 마이그레이션(컬럼 13개 + 인덱스 12개 DROP)을 한 PR 로 묶을지, 컬럼/인덱스로 나눌지? prod DB 초기화 예정이라 하위호환은 불필요하지만 되돌리기는 어렵다.

