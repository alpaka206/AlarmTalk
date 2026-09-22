# 에러 코드

> 서버가 실패를 **기계가 읽는 이름**으로 말하고, 앱이 그 이름으로 사람이 읽는 말을 고른다.
> 2026-09-07 정리.

## 1. 모든 에러 응답은 코드를 갖는다

```json
{ "error": "이번 달 직접 입력 문구 만들기 횟수를 모두 사용했어요.", "error_code": "MANUAL_TTS_QUOTA_EXCEEDED" }
```

- `error` 는 **마지막 안전망**이다. 앱이 그 코드를 모를 때만 그대로 보여 준다.
- `error_code` 가 **계약**이다. 앱은 이 값으로 분기하고 문구를 고른다.

요청 본문은 헤더 유무와 무관하게 실제 바이트 수로 최대 25 MiB 를 제한한다.
`Content-Length`가 이미 초과하면 본문을 읽지 않고 `413 REQUEST_BODY_TOO_LARGE`로 거절한다.
그 외에는 **하위 코드가 본문을 읽을 때만** 바이트를 세고 초과 청크를 전달하지 않는다.
인증·권한·라우팅에서 거절한 요청을 크기 검사를 위해 미리 읽거나 끝까지 비우지 않는다.
제한 미들웨어는 전체 본문의 청크 목록·사본을 보관하지 않으며, 응답 후 남은 입력은 취소한다.
취소 완료를 기다리느라 거절 응답을 늦추지 않는다.

본문 소비 중 초과해도 최종 응답은 같은 413 코드다. JSON/multipart 파서나 라우트의 catch가
이를 400/500으로 바꾸지 못하며, 서버 장애로 중복 경보를 보내지 않는다. 본문이 필요한
라우트는 파싱을 성공적으로 끝낸 뒤에만 저장·외부 호출을 진행한다. 본문을 읽지 않는
라우트에는 크기 확인만을 위한 강제 읽기를 추가하지 않는다.
프로필 수정은 JSON 객체만 허용하며 null·배열·원시값은 `400 INVALID_REQUEST` 다.

⚠ **목록은 `packages/shared/src/schemas/error-codes.ts` 하나다.** 예전에는 라우트마다
문자열 리터럴로만 있어서 같은 뜻에 코드가 둘씩 생겼고(`NO_UPDATE_FIELDS` vs
`NO_FIELDS_TO_UPDATE`, `INVALID_JSON` vs `JSON_BODY_REQUIRED`), **오타를 내도 컴파일이
통과**했다 — 그 코드로 분기하던 앱만 조용히 폴백으로 떨어졌다.

## 2. 코드는 **바꾸지 않는다**

⚠ 스토어에 나간 앱이 그 문자열로 분기하고 있다. 이름을 고치면 **구버전 앱의 그 분기가
통째로 죽는다.** 바꿔야 하면:

1. 새 코드를 **추가**한다.
2. 옛 코드를 한동안 **함께** 내려보낸다.
3. 강제 업데이트로 구버전이 사라진 회차에서 옛 코드를 지운다.

## 3. 기록은 전부, 경보는 골라서

| | 어디서 | 무엇을 |
| --- | --- | --- |
| **기록** | `middleware/errorCode.ts` | 나가는 **모든** 4xx/5xx 한 줄 (`at: "api_error"`, code·status·path·uid) |
| **경보** | 같은 곳 | `ALERTING_ERROR_CODES` 에 있는 4xx + 모든 5xx |

- 기록이 **응답 쪽**에 있는 이유: 라우트가 `c.json` 을 직접 쓰든, `jsonError` 를 쓰든,
  다른 미들웨어(rateLimit·bodyLimit)가 내든 **다 걸려야** 하기 때문이다. 라우트마다 로그를
  손으로 심으면 새 라우트가 빠지고, 빠진 줄도 모른다.
- ⚠ **의도한 4xx 는 예전에 아무 흔적도 남지 않았다.** `logRouteError` 는 던져진 예외에만
  붙어 있었다 — "한도 초과로 막았다" 같은 **판단**은 응답만 나가고 로그가 없어서,
  "이번 달 몇 명이 한도에 막혔나" 에 답할 수가 없었다(= 한도를 조정할 근거가 없었다).
- ⚠ **오타·형식 오류를 경보로 보내지 않는다.** 사용자가 고칠 수 있는 실패까지 Sentry 로
  보내면 진짜 사고가 그 사이에 묻힌다.
- ⚠ **같은 사고를 두 번 올리지 않는다.** 라우트가 `logRouteError` 로 이미 보고했으면
  (그쪽이 스택까지 갖고 있다) 컨텍스트에 `errorReported` 표시가 남고, 미들웨어는 건너뛴다.
- ⚠ **라우트는 상태를 정한 뒤에 보고한다.** `catch` 첫 줄에서 `logRouteError` 를 부르면
  401 로 나갈 거절(클라가 보낸 토큰이 틀린 것)까지 스택째 Sentry 에 올라간다 — 로그인
  라우트가 실제로 그랬다(2026-09-14 BACKEND-7). 5xx 갈래에서만 부르고, 4xx 갈래는
  거절 사유를 `logStructured('warn', …)` 로 남긴다(나가는 4xx 한 줄은 어차피 미들웨어가
  적는다).

### 앱도 같다 — 잡은 것을 전부 올리지 않는다

앱의 `reportError` 는 하나뿐이고(`core/AlarmTalkLog.kt` / `AlarmTalkLog.swift`) 호출부는
140곳이 넘는다. 그 함수가 "잡은 건 전부 이슈" 였을 때 2026-09-14 1.2.6 출시 직후 미해결
11건 중 **8건이 고칠 코드가 없는 실패**였고, 실제 크래시(빌링) 한 건이 그 아래 깔렸다.
그래서 판정을 **호출부가 아니라 그 함수 한 곳**에 둔다(`isExpectedTransientFailure`) —
호출부마다 고르면 새 호출부가 빠지고, 빠진 줄도 모른다.

| 이슈로 올리지 않는 것 | 왜 | 대신 |
| --- | --- | --- |
| 코루틴·태스크 **취소** | 오류가 아니라 흐름 제어. 워커가 `REPLACE` 로 대체될 때마다 난다 | 로그 + 브레드크럼 |
| **일시적 네트워크 실패**(DNS·시간초과·연결 거부·TLS) | 기기 네트워크 사정. 원인 사슬 어디에 있든 같다 | 로그 + 브레드크럼, 워커는 재시도 |
| FCM 의 재시도 가능 코드(`SERVICE_NOT_AVAILABLE`·`INTERNAL_SERVER_ERROR`) | Firebase 문서가 재시도하라는 구글 쪽 장애 | 위와 같다 |
| **중앙 401 처리기가 이미 끊은 세션의 401** | 토큰 만료·폐기는 세션 정리와 "다시 로그인해 주세요" 로 **이미 사용자에게 닿은 사실**이다. 그 위에 이슈까지 쌓으면 한 번의 만료가 재시도 횟수만큼 올라간다 | 로그 + 브레드크럼(category `auth`), 워커는 **재시도하지 않고** 세션을 끊는다 |
| **HTTP/2 스트림·연결 리셋**(`stream was reset: CANCEL`, GOAWAY) | 엣지·프록시가 스트림을 끊은 것 — 일시적 네트워크 실패와 같은 부류인데 `IOException` 의 다른 하위 타입이라 빠져 있었다(2026-09-22 ANDROID-N) | 로그 + 브레드크럼(`transient`), 워커는 재시도 |
| **Google 로그인이 사용자 행동으로 끝남**(12501 취소·12502 진행 중) | 뒤로가기·버튼 연타다. 화면이 상태별 문구를 이미 보여준다(2026-09-22 ANDROID-P). 네트워크(7)는 일시적 실패와 같다 | 로그 + 브레드크럼(`user`). **10(설정 오류)·12500(실패)은 그대로 이슈** — 우리가 고칠 것이 있다 |

- ⚠ **`IOException` 전체가 아니다.** 파일 없음·디스크 가득참은 결함일 수 있어 그대로 올린다.
  iOS 도 `.badServerResponse`·`.cannotParseResponse` 는 뺀다.
- ⚠ **HTTP 4xx 는 여기서 가르지 않는다.** `errorBody` 는 한 번만 읽히므로 호출부가 코드를
  보는 자리에서 결정한다 — 로그인 직후 동의 전 `403 CONSENT_REQUIRED` 는 재시도 대상이
  아니라 **동의를 마쳐야 풀리는 상태**라, 백그라운드 워커는 성공으로 끝내고 다음 전경
  진입·주기가 다시 끌어온다(`sync/SyncWorkerFailure.kt`, iOS 는 `RemoteAlarmSyncViewModel`).
  정확히 그 코드만이다 — `CONSENT_STATE_UNAVAILABLE`·`ACCOUNT_PENDING_DELETION` 은 파손이다.
- ⚠ **예외는 401 하나이고, 그것도 본문이 아니라 상태코드로 가른다.** `apiError`·`apiErrorCode`
  를 부르면 `errorBody` 를 소진해 **호출부가 읽을 몫을 빼앗는다** — `HttpException.code()` 만
  본다. 401 은 코드를 볼 필요도 없다: `TOKEN_REVOKED` 든 만료든 결말이 하나(세션 정리)다.
- ⚠ **401 을 낮추는 것이 침묵이 아닌 이유.** 우리 쪽 결함(인증 헤더 누락 등)이 401 로
  나타나도 그 경로는 세션을 끊고 재로그인 화면을 띄운다 — 사용자에게 **더 크게** 보인다.
- ⚠ **백그라운드 워커는 401 에서 재시도하지 않는다.** 같은 토큰을 다시 보내 봐야 또 거절
  당한다 — 폐기된 토큰으로 **영원히 재시도**하며 회차마다 이슈를 한 건씩 올렸다(ANDROID-M).
  안드로이드의 판정은 `sync/SyncWorkerFailure.kt` 의 `syncWorkerOutcome` 한 곳이고,
  **서버를 부르는 워커는 예외 없이 이 함수를 거친다** — `RemoteAlarmSyncWorker`·
  `UsageEventUploadWorker`·`DynamicVoiceRefreshWorker`·`StockClipPrefetchWorker`·
  `PlanChangeSyncWorker`·`VoiceAccessSyncWorker` 여섯이다.
  - **의도된 예외는 `AlarmScheduleIntegrityWorker` 하나다.** 그 워커는 서버를 부르지 않는다 —
    하는 일이 `AlarmRepository.reschedulePendingAlarms` 호출 하나뿐이라 토큰을 쓰지 않고,
    그래서 `NetworkType.CONNECTED` 제약도 **일부러** 없다(알람이 울리는 일이 네트워크에
    묶여선 안 된다 — 비행기 모드로 자는 사람의 알람이 안 울리면 안 된다). 401 을 받을 길이
    없으니 세션 판정을 붙일 자리가 아니고, 붙이면 오히려 없는 계약을 흉내 내게 된다.
  - **새 워커가 빠지는 것은 사람이 못 막는다.** 판정을 한 곳에 모아도 다음 워커가 그 함수를
    안 부르면 그만이고, 그때 증상은 테스트 실패가 아니라 **몇 달 뒤의 Sentry 그래프**다.
    그래서 CI lint 가 `sync/` 의 `CoroutineWorker` 를 훑어 `syncWorkerOutcome` 을 거치는지
    본다(위 `check-*.py` 들과 같은 종류의 그물이다).
  - ⚠ **안쪽에서 삼킨 401 은 그 그물에 안 걸린다**(코덱스 #788). `StockClipPrefetchWorker` 는
    클립별 `runCatching` 으로 형제 요청을 살리는데, 거기서 401 을 `isPermanent` 로만 보면 영구
    실패로 세어져 배치가 `failure` 로 **조용히** 끝난다 — 바깥의 `syncWorkerOutcome` 을 지나지
    않아 세션을 못 끊고, 그 워커의 API 클라이언트에는 401 핸들러가 없어 죽은 세션이 다른
    요청이 우연히 401 을 볼 때까지 살아 있었다. 안쪽 격리는 `classifyClipFailure` 로 401 을
    **세지 않고 기억했다가** 배치 뒤 되던져, 끝내는 자리를 바깥 한 곳으로 유지한다
    (회귀 `StockClipFailureClassificationTest`). 새 워커가 요청을 격리할 때 같은 모양을 쓴다.
- ⚠ **끊을 때는 세대와 토큰을 둘 다 본다.** 세대만 보면 rolling refresh 를 못 가른다 —
  `GET /auth/me` 가 같은 세션 안에서 토큰을 갈아 끼우므로, 옛 토큰의 뒤늦은 401 이 세대
  검사를 통과해 **방금 갱신한 멀쩡한 세션을 지운다**(`endSessionAfterWorkerUnauthorized`).
- ⚠ **파기된 계정은 `GET /auth/me` 에서만 404 로 온다.** 다른 라우트는 인증 미들웨어가
  401 로 돌려주지만(`middleware/auth.ts`), 이 라우트는 토큰의 sub 에 해당하는 사용자 행이
  없으면 404 `AUTH_USER_NOT_FOUND` 를 낸다(`routes/auth.ts`). 그래서 **세션 건강검진만**
  그 갈래를 놓치고, 놓치면 죽은 세션이 그대로 남아 이후 모든 요청이 401 을 쏟는 동안
  사용자에게는 아무 안내도 가지 않는다(2026-09-21 Sentry ALARMTALK-IOS-2). **양 앱 모두
  이 404 를 401 과 같은 종착점으로 보낸다.** 서버를 401 로 바꾸는 쪽은 하지 않는다 —
  이미 나간 계약이다(§2).
  - ⚠ **404 전부가 아니라 그 코드일 때만이다.** 베이스 URL 오설정·라우팅 실패도 404 라,
    상태코드만 보고 끊으면 **설정 실수 한 번이 전체 로그아웃**이 된다. 코드가 없거나 다른
    404 는 세션을 유지하고 평소의 실패 문구로 끝낸다.
  - ⚠ **이 판정만 본문을 연다.** 401 은 상태코드로 가르는데(`errorBody` 를 아껴야 한다)
    여기는 코드를 봐야 하므로, **404 일 때만** `apiError`·`serverErrorCode` 를 부른다.
    순서가 뒤집히면 코드를 볼 자리가 빈 본문을 받는다.
- **브레드크럼이지 침묵이 아니다.** 다음 진짜 이벤트에 맥락으로 붙는다. "왜 그때 sync 가
  안 됐나" 는 브레드크럼에 있고, 이슈 목록에는 고칠 수 있는 것만 남는다.

## 4. 앱은 **코드로** 문구를 고른다

층이 셋이고, 위에서부터 이긴다:

1. **화면별 문구** — 그 화면에서만 다르게 말해야 하는 것(목소리 등록 중의
   `VOICE_FEATURE_REQUIRES_PAID_PLAN`).
2. **공용 표** — `ApiErrorMessages.kt` / `APIErrorMessages.swift`. 아무도 안 맡은 코드를 받는다.
3. **폴백** — 서버 문장(한국어면) 또는 화면이 준 기본 문장.

⚠ **공용 표는 '아무 데서나' 가 아니라 정해진 자리에서 불린다.** 일반 오류 헬퍼
(`userFacingError` / `userFacingErrorMessage`)는 코드를 보지 않는다 — 표를 부르는 자리는
**로그인 · TTS 생성 · 목소리 등록 · 목소리 승격** 넷이고, 두 앱이 같은 넷이다. 여기를
늘릴 때는 **양쪽을 같이** 늘린다(한쪽만 늘리면 같은 실패가 두 앱에서 다르게 읽힌다).

⚠ **모든 코드에 문구를 둘 필요는 없다.** `INVALID_JSON` 처럼 사용자가 할 수 있는 게 없는
것은 비워 두고 폴백에 맡긴다 — 억지로 채우면 알아들을 수 없는 말만 늘어난다.

⚠ **두 앱의 표는 같은 코드를 같은 뜻으로 말해야 한다.** 한쪽에만 코드를 더하면 같은
실패가 두 앱에서 다르게 읽힌다. 실제로 iOS 는 `VOICE_LIMIT_REACHED`(=등록 슬롯이 찼다)를
"이번 달 목소리 생성 한도를 모두 사용했어요" 로 말하고 있었고, **회귀 테스트가 그 틀린
문구를 지키고 있었다**(2026-09-07 정정).

⚠ **맞추는 범위는 '위 네 자리에 닿을 수 있는 코드' 다 — 목록 전체가 아니다.** 표를 부르지
않는 경로의 코드는 표에 있어도 아무도 읽지 않으므로, 한쪽에만 있다고 반대편에 베껴 넣지
않는다. 지금 그런 것이 둘 있다: `AUTH_EMAIL_TAKEN`·`AUTH_EMAIL_SOCIAL`
(`network/ApiErrorMessages.kt`)은 **가입** 경로의 409(`routes/auth.ts`)인데, 표를 부르는 네
자리에 가입이 없다. 두 앱 모두 가입 실패는 **화면이 직접** 가른다 — 안드로이드
`duplicateEmailMessage`(`ui/main/MainViewModelAuthActions.kt`), iOS
`AuthViewModel.requestEmailVerification` 의 `userFacingErrorMessage` 폴백.
- **그래서 iOS 표에 이 둘을 더해도 아무 화면도 달라지지 않는다** — 더하지 말 것. 표만
  같아 보이게 만들고 실제 차이는 그대로 남는다.
- 특히 `AUTH_EMAIL_TAKEN` 은 문구만이 아니라 **로그인 화면 전환**(`authRedirectToLogin`)을
  겸한다. 표는 문자열 하나만 돌려주므로 구조적으로 그 일을 할 수 없다.
- 안드로이드 표의 그 두 줄은 지금 **닿지 않는 자리**다. 지우려면 가입 경로가 정말로 표를
  거치지 않는지 먼저 확인하고, 이 문단도 함께 고친다.

## 5. 코드를 새로 만들 때

1. `packages/shared/src/schemas/error-codes.ts` 의 도메인 묶음에 알파벳 순으로 넣는다.
2. 백엔드에서 내보낸다 — `jsonError(c, status, code, message)` 또는 `errorBody(code, message)`.
   리터럴로 `error_code: 'FOO'` 를 새로 쓰지 말 것.
3. 사용자에게 보여 줄 말이 따로 있으면 **두 앱의 표에 같이** 넣는다.
4. 눈에 띄어야 하면 `ALERTING_ERROR_CODES` 에 넣는다(기준: 사용자가 막혔고, **우리가**
   손쓸 수 있는가).

회귀 방지: `packages/backend/test/error-codes.test.ts` 가 ① 목록의 중복, ② 소스가 내보내는
리터럴이 전부 목록에 있는지, ③ 목록에 있는데 안 쓰는 코드, ④ **코드 없는 4xx/5xx 응답**을
막는다. `test/error-code-middleware.test.ts` 는 기록·경보·본문 보존을 지킨다.

## 구현 지도

| 규칙 | Android | iOS | 백엔드 |
| --- | --- | --- | --- |
| 코드 목록 | — | — | `packages/shared/src/schemas/error-codes.ts` |
| 코드 붙여 응답 | — | — | `lib/api-error.ts` 의 `jsonError`·`errorBody` |
| 본문 크기 제한·소비 시점 | — | — | `middleware/bodyLimit.ts` · `test/bodyLimit.test.ts` |
| 본문 초과의 서버 장애 오인 방지 | — | — | `lib/logger.ts`의 요청별 초과 표시 확인; 최종 413은 `middleware/errorCode.ts`에서 기록 |
| 기록·경보 | — | — | `middleware/errorCode.ts` |
| Turso 게이트웨이 일시 실패는 **읽기만** 다시 시도(5xx·전송 실패, 150·450ms, 최대 3회) | — | — | `lib/turso-retry.ts` 의 `isTransientTursoGatewayError`·`withTransientReadRetry`, `lib/db.ts` 의 `getDB` 가 두른다(HTTP·cron 공통) · `test/turso-retry.test.ts`. 2026-09-22 전에는 cron 만, 그것도 520 만 — 525(BACKEND-3)는 한 번도 재시도되지 않아 인증 조회가 그대로 503 `ACCOUNT_STATUS_UNVERIFIED` 였다 |
| 경보의 **묶음 키는 에러 코드**(경로 아님) | — | — | `middleware/errorCode.ts` 의 `setFingerprint(['api_error', code])` · `test/error-code-middleware.test.ts`. Sentry 는 기본으로 스택으로 묶어 같은 미들웨어가 낸 예외는 코드가 달라도 한 이슈가 됐다(BACKEND-8 에 두 코드가 섞임, 2026-09-22) |
| 라우트의 4xx 거절은 경보가 아님 | — | — | `routes/auth.ts` 의 `/google`·`/apple` catch · `test/auth-apple-route.test.ts` |
| 중복 보고 방지 표시 | — | — | `lib/logger.ts` 의 `logRouteError` |
| 앱의 이슈/브레드크럼 판정 | `core/AlarmTalkLog.kt` 의 `isExpectedTransientFailure`(HTTP/2 리셋 포함)·`isGoogleSignInUserAction` · `TransientFailureClassificationTest` | `AlarmTalkLog.swift` 의 `isExpectedTransientFailure` · `TransientFailureClassificationTests` | — |
| 401 은 이슈가 아니라 브레드크럼 | `core/AlarmTalkLog.kt` 의 `isHandledAuthFailure` · `TransientFailureClassificationTest` | `AlarmTalkLog.swift` 의 `isHandledAuthFailure` · `AlarmTalkTests/TransientFailureClassificationTests` | — |
| 낮추는 **범위**(그 밖의 4xx·5xx 는 그대로 이슈) | `core/AlarmTalkLog.kt` 의 `breadcrumbCategoryFor` · `TransientFailureClassificationTest` 의 `onlyUnauthorizedAndTransientBecomeBreadcrumbs` | `AlarmTalkLog.swift` 의 `handledFailureCategory` · `AlarmTalkTests/TransientFailureClassificationTests` 의 `test_401_외의_상태코드는_그대로_이슈다` | — |
| 동의 전 403 은 재시도가 아님 | `sync/SyncWorkerFailure.kt` 의 `syncWorkerOutcome` | `RemoteAlarmSyncViewModel` 의 `runFullSync` catch | `middleware/consent.ts` |
| 401 은 재시도가 아니라 세션 종료 | `sync/SyncWorkerFailure.kt` 의 `endSessionAfterWorkerUnauthorized`(**세대+토큰** 검사) · `TransientFailureClassificationTest` | `AlarmTalkAPI.handleUnauthorized` → `AuthViewModel.handleUnauthorized`(**토큰** 대조 후 `signOut`) — API 계층이라 백그라운드도 같다 | — |
| 401 이면 **그 회차를 끊는다**(남은 후보를 같은 죽은 토큰으로 밀지 않는다) | 워커가 `SESSION_EXPIRED` 에서 `Result.success()` 로 끝낸다(`sync/SyncWorkerFailure.kt`) | `RemoteAlarmPushSync` 의 후보 루프 `break` · `AlarmTalkTests/UnauthorizedSessionHandlingTests` 의 `PushSyncUnauthorizedCycleTests` | — |
| 파기된 계정의 404 는 401 과 **같은 갈래**(코드 없는 404 는 **세션 유지**) | `ui/main/MainViewModelAuthActions.kt` 의 `isDestroyedAccountFailure` → `MainViewModel.handleUnauthorized` · `DestroyedAccountSessionTest` | `AuthViewModel.refreshUserApplyingToken` 의 `status == 404 && errorCode == "AUTH_USER_NOT_FOUND"` · `AlarmTalkTests/UnauthorizedSessionHandlingTests` 의 `SessionHealthCheckDestroyedAccountTests` | `routes/auth.ts` 의 `GET /auth/me`(그 밖의 라우트는 `middleware/auth.ts` 가 401) |
| 응답에서 코드 꺼내기 | `network/ApiErrors.kt` 의 `apiErrorCode` | `APIError.serverErrorCode` | — |
| 코드 → 문구(공용) | `network/ApiErrorMessages.kt` | `APIErrorMessages.swift` | — |
| 코드 → 문구(목소리 화면) | `ui/main/MainViewModelVoiceActions.kt` | `VoiceStudioViewModel+ErrorMapping.swift` | — |
| 코드 → 문구(로그인 화면) | `ui/main/MainViewModelAuthActions.kt` 의 login 갈래 | `AuthViewModel.loginErrorMessage` | — |
