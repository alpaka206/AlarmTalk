# 기술 참조

AlarmTalk의 시스템 구조와 API 개요.

**스키마·엔드포인트 시그니처의 유일한 출처는 코드다.** 이 문서는 코드를 열기 전에 알아야 할 구조와, 코드만 봐서는 안 보이는 정책만 담는다. 표를 늘리지 말고 코드를 가리켜라.

| 알고 싶은 것 | 볼 곳 |
|---|---|
| 테이블·컬럼·마이그레이션 | `packages/backend/src/lib/migrations.ts` |
| 엔드포인트 요청/응답 | `packages/backend/src/routes/` + `packages/backend/test/` |
| 공용 요청 스키마 | `packages/shared/src/schemas/` |
| 에러 코드 | [reference/error-codes.md](../reference/error-codes.md) |
| 환경·시크릿·배포 절차 | [ops/environments.md](../ops/environments.md) |
| Worker 시크릿 전체 목록 | `packages/backend/src/types.ts` 의 `Env` 인터페이스 |

## 1. 시스템 구조

```
┌─────────────────────────────────────────────────────────┐
│                        CLIENTS                          │
│      Android (Kotlin/Compose)          Landing (web)    │
└─────────────┬──────────────────────────────┬────────────┘
              │ HTTPS                        │
              ▼                              ▼
┌─────────────────────────────────────────────────────────┐
│           Cloudflare Workers — voice-alarm-api          │
│  securityHeaders → sentry → logger → ipRateLimit →      │
│  bodyLimit → cors → (/api/*: auth → consent →           │
│  rateLimit → cache)                                     │
│                                                         │
│  Routes: /auth /user /voice /tts /alarm /family /code   │
│          /billing /push /holiday /admin                 │
│  Cron:   */5 * * * *                                    │
└──────────┬─────────────────┬────────────────┬───────────┘
           ▼                 ▼                ▼
   ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
   │ Turso libSQL │  │ Cloudflare R2│  │ 외부 API         │
   │ 도메인 테이블 │  │ voice + tts  │  │ ElevenLabs       │
   └──────────────┘  └──────────────┘  │ Google JWKS      │
                                       │ Vertex / Resend  │
                                       │ FCM / Sentry     │
                                       └──────────────────┘
```

### 레이어 경계 — Android (`apps/android-native`)

| 레이어 | 패키지 | 책임 |
|---|---|---|
| UI | `ui/*` | Compose 화면·컴포넌트·테마 |
| 도메인(알람) | `alarm/*`, `ringing/*` | AlarmReceiver, Scheduler, RingingService, RingingActivity |
| 데이터 | `data/*` | Room, DAO, 리포지토리, 오디오 스토어, 동기화 서비스 |
| 네트워크 | `network/*` | Retrofit API 클라이언트, 세션 스토어 |
| 동기화 | `sync/*` | WorkManager 워커 |
| 코어 | `core/*` | 로깅, 환경 |

### 레이어 경계 — 백엔드 (`packages/backend`)

| 레이어 | 경로 | 책임 |
|---|---|---|
| 진입 | `src/index.ts` | Hono 앱, 미들웨어 체인, cron |
| 라우트 | `src/routes/*` | HTTP 엔드포인트 |
| 미들웨어 | `src/middleware/*` | 인증, 레이트리밋, 로깅, 보안 헤더, 동의 게이트 |
| 라이브러리 | `src/lib/*` | 순수 함수, DB 어댑터, 외부 프로바이더 |

### 워크스페이스 패키지

- `packages/shared` — 백엔드·클라 공용 타입과 zod 스키마
- `packages/voice` — 보이스 프로바이더·스토리지 인터페이스와 어댑터

### 알람 울림 경로 (오프라인 설계)

```
알람 저장
  └─ AlarmRepository.save() → Room
  └─ AlarmScheduler.schedule() → AlarmManager.setAlarmClock(...)

발사 시각
  └─ OS 가 AlarmReceiver.onReceive() 호출
       └─ startForegroundService(RingingService)

RingingService
  ├─ AlarmAudioStore.loadCachedAudio(alarmId)
  ├─ MediaPlayer.start() (loop)
  ├─ Vibrator.vibrate(pattern, repeat)
  └─ RingingNotificationFactory.create(highImportance, fullScreenIntent)

RingingActivity
  ├─ showWhenLocked / turnScreenOn
  ├─ 해제 → 서비스 종료, "alarm_completed" 큐잉
  └─ 스누즈 → schedule(now + Δ), "alarm_snoozed" 큐잉
```

**이 경로에는 네트워크 호출이 하나도 없다.** 출시 전 QA 는 `adb shell cmd connectivity airplane-mode enable` 로 이를 검증한다. 이 원칙을 깨는 변경은 리뷰에서 반려한다.

### 수동 서버 동기화 ("지금 동기화" 탭)

```
WorkManager.enqueueOneTimeWork(RemoteAlarmSyncWorker)
  └─ AlarmSyncService.pushDirty()          → POST/PATCH/DELETE /api/alarm
  └─ RemoteAlarmPullSyncService.pull()     → GET /api/alarm → reconcile → Room
```

### 외부 서비스

| 서비스 | 역할 | 결합 방식 |
|---|---|---|
| Cloudflare Workers | API + cron | HTTP, ScheduledEvent |
| Turso libSQL | 주 DB | libSQL HTTP 클라이언트 |
| Cloudflare R2 | 오브젝트 스토어(voice / TTS) | Workers 바인딩 `VOICE_BUCKET` |
| ElevenLabs | 보이스 클론 + TTS | HTTPS REST |
| Google Vertex (Gemini) | 동적 문구 생성·번역 | HTTPS REST, 서비스 계정 |
| Firebase FCM (HTTP v1) | data-only 동기화 트리거 푸시(가족 알람 생성 시) | HTTPS REST, 서비스 계정 OAuth |
| Resend | 이메일 인증 코드 발송 | HTTPS REST |
| Google JWKS | ID 토큰 검증 | HTTPS |
| Sentry | 에러 수집 | toucan-js(서버) + Android SDK(DSN 있을 때만) |

### 장애 도메인

| 장애 | 알람 울림 영향 | 그 외 영향 |
|---|---|---|
| Workers 다운 | 없음 | 로그인·동기화·TTS 생성 중단 |
| Turso 다운 | 없음 | API 500, 동기화 중단 |
| R2 다운 | 없음(대부분 로컬 캐시 히트) | 캐시 미스 시 TTS 생성 실패 |
| 보이스 프로바이더 다운 | 없음 | 신규 TTS 생성 실패 |
| 단말 Room 손상 | 부분 유실 가능 | 서버 동기화로 복구 |

### 배포·환경 (요약)

절차 전체는 [ops/environments.md](../ops/environments.md) 를 본다. 여기엔 코드에 박힌 결합만 적는다.

- R2 바인딩: dev `VOICE_BUCKET → voice-alarm-voices`, prod `VOICE_BUCKET → voice-alarm-voices-prod`.
- Turso 는 환경별로 분리한다. dev 워커 `voice-alarm-api-dev`, prod 워커 `voice-alarm-api` 가 각각 다른 `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` 을 쓴다.
- 로컬 값은 ignore 되는 `packages/backend/.dev.vars.{dev,prod}` 에 두고 `npm run secrets:sync:{dev,prod} --workspace=backend` 로 반영한다.
- CI 가 `develop` → dev, `main` → prod 로 배포하고 마이그레이션까지 돌린다.
- Cron 은 dev/prod 모두 `*/5 * * * *`.

## 2. 데이터베이스

Turso(libSQL / SQLite). 스키마는 `packages/backend/src/lib/migrations.ts` 의 순서 배열이 유일 출처이고, 적용 여부는 `_migrations` 원장이 관리한다. **테이블 목록·DDL 을 이 문서에 복사하지 마라** — 과거에 그렇게 했다가 통째로 썩었다.

적용:

```bash
# 전체 적용
curl -X POST https://<host>/api/init-db -H "x-init-db-secret: <secret>"

# 범위 적용 (Workers 무료 플랜 subrequest 한도 회피)
curl -X POST "https://<host>/api/init-db?fromId=1&toId=10" -H "x-init-db-secret: <secret>"
```

`init-db` 는 파괴적 DDL 과 유료 합성을 수행하므로 **모든 환경에서** `x-init-db-secret` 헤더를 요구한다. 워커에 `INIT_DB_SECRET` 이 없으면 무조건 404 로 거부한다(비교는 상수시간). dev/prod 시크릿이 GitHub `INIT_DB_SECRET_DEV`/`INIT_DB_SECRET_PROD` 와 어긋나면 CI 마이그레이션이 404 로 실패한다.

### 코드를 훑어서는 안 보이는 제약

- `voice_profiles`: 유저당 공식(official) 보이스 최대 1개(`MAX_VOICE_PROFILES`, `routes/voice-profile.ts`), 활성 초안(draft) 최대 1개. 라우트 레이어에서 COUNT 로 강제한다. 공식 보이스가 있으면 초안 생성 자체를 거부한다(승격 시 슬롯이 넘치므로). 보이스를 교체하려면 공식 보이스를 먼저 지워야 한다.
- `plan_group_invites.code`: UNIQUE, TTL 10분. 만료는 배치가 아니라 읽을 때 lazy 로 `expired` 전이시킨다.
- 롤백 위험 흐름(구독, 바우처 사용, 소유권 이전)은 `lib/transactions.ts` 의 BEGIN/COMMIT 을 쓴다.
- DEV / PROD 는 서로 다른 Turso DB 와 시크릿을 본다. prod 직접 수정은 PR·머지를 거치고 `wrangler scheduled` 실행 시각과 겹치지 않게 한다.

## 3. HTTP API

- Base URL(prod): `https://api.alarm-talk.com/api`
- 인증: `Authorization: Bearer <JWT | google_id_token>`
- 에러 코드와 응답 형태: [reference/error-codes.md](../reference/error-codes.md)

### 라우트 그룹

| 프리픽스 | 책임 |
|---|---|
| `/auth` | 가입 / 로그인 / me / 이메일 인증 코드 |
| `/user` | 프로필, 플랜, 검색, 계정 삭제 |
| `/voice` | 보이스 프로필, 업로드, 사전렌더 |
| `/tts` | TTS 생성 |
| `/alarm` | 알람 CRUD |
| `/family` | 가족 그룹, 초대, 가족 알람 |
| `/billing` | 구독·바우처. `/billing/google/rtdn` 은 유저 인증 없는 공개 RTDN 웹훅(쿼리 토큰으로 보호) |
| `/code` | 통합 코드 등록(`INV-`/`GIFT-` 이용권 / 프로모 자동 판별) |
| `/push` | FCM 토큰 등록·해제 |
| `/holiday` | 공휴일 조회(인증 없음, 공개 캐시) |
| `/admin` | 관리 콘솔 — `/api` 가 아니라 `/admin` 에 마운트, `ADMIN_SECRET` HTTP Basic |

인증 없이 열려 있는 것은 `GET /`·`GET /health`(DB 연결 확인)와 `POST /api/init-db`(시크릿 헤더 게이트), 그리고 `/api/auth/*`·`/api/holiday`·RTDN 웹훅뿐이다. 나머지 `/api/*` 는 전부 `authMiddleware` 뒤에 있다.

> `/library` 라우터와 `GET /api/tts/presets` 는 클라이언트가 호출하지 않아 제거됐다. 보관함 테이블(`message_library`)은 남아 있지만 읽는 API 는 없다.

### 시그니처가 아니라 정책인 것들

라우트 파일을 읽어도 "왜 이렇게 막혀 있는지"는 안 보이므로 여기 적는다.

**`POST /voice/clone` (multipart)** — 공식 보이스를 바로 만들 수 없다. 클라는 ① 비공개 초안 1개 생성 → ② 결정적 프리뷰 요청 → ③ 로컬 재생을 끝낸 뒤에만 서버가 발급한 재생 토큰을 `POST /voice/:id/preview-played` 로 보고 → ④ `PATCH /voice/:id` + `is_draft=false` 로 승격, 순서를 지켜야 한다. 초안의 프로바이더 등록은 KST 월 3회·활성 초안 1개로 제한되고, 승격은 KST 월 1회다. 공식 보이스를 지워도 그 달 승격 횟수는 환불되지 않는다. 초안은 공유·알람 연결·일반 TTS 에 쓸 수 없다.

**`POST /code/register`** — 형식으로 자동 판별한다. `INV-`/`GIFT-XXXX-XXXX-XXXX` 는 바우처 사용(구독 insert + 플랜 갱신)이고, 발급자 구독이 딸린 코드는 그 발급자의 플랜 그룹에 멤버로 합류시키며, 단독 코드는 사용자를 새 그룹의 소유자로 만든다(결제한 것과 동일). 그 외 문자열은 프로모 코드(대소문자 무시)로 본다.

**`POST /billing/test-codes`** — Google Play 결제가 연결되기 전까지 쓰는 내부 클로즈드 테스트용. `TEST_CODE_ISSUER_EMAILS` 에 적힌 이메일만 발급할 수 있고, 미설정이면 아무도 못 한다(fail-closed, 하드코딩 기본값 없음). `personal` 은 `GIFT-`, `couple`/`family` 는 `INV-` 형식이며 모두 1회용이고, 공유 그룹 코드는 처음 등록한 사람이 소유자가 된다.

### 크론

`*/5 * * * *` 의 `scheduled` 핸들러는 외부 오디오 삭제 정합, 만료된 이메일 코드 정리, 구독 만료·다운그레이드, 계정 파기(30일 유예), 그리고 명시적으로 승인된 보이스 사전렌더 작업을 돌린다.

프리뷰를 마친 비공개 초안을 keep 하면 소유자 스코프의 사전렌더 잡이 1개 생긴다. 매니페스트는 앱 언어 1개에 대해 `greeting` 1 + `weather` 9 + `fortune` 5 + `love` 3 + `medication` 3 = **21클립**으로 고정이다(`CLONE_CLIP_SEEDS`, `lib/stock-clips.ts`). `weather` 9개 중 앞 8개는 `CLONE_WEATHER_CONDITIONS`(인덱스 0–7)이고, 마지막 1개는 **항상** "날씨 미해결" 폴백이다 — 준비창에서 날씨를 못 받아온 클라가 무음이나 엉뚱한 조건 대신 이걸 튼다(클라 규약: 마지막 클립 = `size - 1`). `resolvePrerenderWeatherIndex` 는 0–7 만 반환하므로 인덱스 8 은 폴백 전용이다. 워커는 정확한 claim 토큰으로만 이 유한 매니페스트를 이어받고, 합성 전과 게시 전에 보이스 소유권·상태·민감 동의를 다시 확인한다. 스스로 유저를 찾아 나서거나 매니페스트 밖 카테고리를 추가하지 않는다.

> **원칙**: 알람 **울림은 온디바이스**(`AlarmManager`)이며 네트워크에 의존하지 않는다. **서버 푸시는 동기화 트리거 전용** — 가족 알람 *생성* 시 수신자에게 data-only FCM 신호(`sendFamilyAlarmPush`)를 1회 보내 앱이 즉시 pull → 로컬 스케줄하게 할 뿐, 발사 시각에는 어떤 푸시도 보내지 않는다(로컬 링과 중복 알림 방지 — `src/index.ts` scheduled 주석 참고).

### 엔드포인트를 고칠 때

1. `packages/backend/src/routes/` 의 라우트를 고친다.
2. `packages/backend/test/` 의 Vitest 계약 테스트를 추가·갱신한다.
3. `apps/android-native/app/.../network/` 의 대응 `*Api.kt` 를 맞춘다.
4. 정책이 바뀌었다면(시그니처가 아니라 규칙) 이 문서의 해당 문단만 고친다.

출시 전이라 prod DB 는 초기화 예정이고, 하위호환 유지 의무는 없다. 브레이킹 변경은 클라와 같은 PR 에서 맞춰 넣으면 된다.
