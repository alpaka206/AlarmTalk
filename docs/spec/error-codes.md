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

**기능을 지우면 그 기능만 내던 코드는 목록에서 지운다** — 이름을 바꾸는 것이 아니라 옛 앱이 그 코드를 다시 받지
않게 될 뿐이다. 목록에 남겨 두면 "목록에 있는데 아무 데서도 안 쓰는 코드" 검사(아래 §5)가 막는다. 2026-10-20
커플·가족 이용권을 지우며 그룹·초대 코드·가족 알람·목소리 업로드 갈래의 코드를 지웠고(`GROUP_FULL`·
`OWNER_CANNOT_LEAVE`·`FAMILY_ALARM_*`·`TARGETED_ALARM_IMMUTABLE`·`ALARM_SCHEMA_UPGRADING`·`CODE_EXPIRED`·
`CODE_ALREADY_USED`·`CODE_ALREADY_REDEEMED_BY_YOU` 등 — [plan-gates.md](plan-gates.md) 「커플·가족 이용권 — 폐지」),
옛 앱 호환 응답이 내던 `CODE_NOT_FOUND` 는 2026-10-26 그 라우트와 함께 지웠고(강제 업데이트 뒤), `NOT_CONNECTED` 는 남겼다.

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
  - **예외 하나 — `VOICE_CLONE_NO_SPEECH`**(목소리 등록 녹음에 말소리가 거의 없다, 400, 2026-10-11). 보통은 그
    사람의 녹음이라 다시 녹음하면 풀린다 — 사용자가 고칠 수 있는 400 이다. 그런데 판정이 전사(ElevenLabs Scribe)의
    글자 수라, **갑자기 늘면** 전사가 빈 글을 돌려주는 고장이고 그동안 **모든 등록이 막힌다**(전사가 아예 실패하거나
    답에 글이 없으면 막지 않고 통과시키지만, 빈 글은 '말소리 없음' 과 구별되지 않는다). 그 고장은 우리만 고칠 수 있어
    경보로 올린다. 묶음 키가 코드라(구현 지도) 한 이슈에 쌓인다 — 볼 것은 건수가 아니라 **건수의 변화**다. 이 코드를
    모르는 옛 iOS(1.2.10)는 녹음을 남겨 `등록` 을 누를 때마다 같은 소리를 다시 보내므로, 출시 뒤의 건수에는
    그 되풀이가 섞인다(아래 §4). 규칙은 [voice-and-message.md](voice-and-message.md) §4-1 「말소리가 없으면 등록하지
    않는다」.
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
| **Google 로그인이 사용자 행동으로 끝남**(12501 취소·12502 진행 중·16 `CANCELED`) | 뒤로가기·버튼 연타·계정 선택 창 닫기(16 은 `resultCode=0` 으로 돌아온다 — 2026-10-16 ANDROID-1G)다. 화면이 상태별 문구를 이미 보여준다(2026-09-22 ANDROID-P — 16 은 12501 과 같은 '취소' 문구). 네트워크(7)는 일시적 실패와 같다 | 로그 + 브레드크럼(`user`). **10(설정 오류)·12500(실패)은 그대로 이슈** — 우리가 고칠 것이 있다 |
| **녹음을 시작하자마자 멈춤**(2026-10-26, 안드로이드) — 원인 사슬에 `RecordingStoppedTooSoonException`(시작 뒤 1초 안의 `MediaRecorder.stop()` 실패)이 있을 때만 | 기기의 녹음기는 첫 프레임을 쓰기 전에 멈추면 `RuntimeException: stop failed.` 를 던진다(A32 계측 테스트로 재현, Sentry ANDROID-1P). 사용자의 동작이고 화면이 "녹음이 너무 짧아요" 로 이미 말한다 | 로그 + 브레드크럼(`user`). **1초 뒤의 같은 실패는 표시가 없어 그대로 이슈**다 |
| **사용자가 고칠 예상된 거절**(2026-10-11) — 상태가 **4xx** 이고 `error_code` 가 **목록에 있을 때만**: 인증 코드가 틀림·만료(`AUTH_EMAIL_CODE_INVALID`·`AUTH_EMAIL_CODE_EXPIRED`), 이미 쓰는 이메일·소셜로 가입한 이메일(`AUTH_EMAIL_TAKEN`·`AUTH_EMAIL_SOCIAL`). 옛 앱의 코드 칸이 받던 '코드 없음'(`CODE_NOT_FOUND`)은 2026-10-26 그 라우트와 함께 빠졌다(초대 코드 갈래 셋은 2026-10-20, 프로모 코드 갈래 셋은 2026-10-12 — `plan-gates.md` 「커플·가족 이용권 — 폐지」) | 사용자가 친 값의 문제이고 화면이 코드로 고른 문장으로 이유를 이미 말한다 — 우리가 고칠 코드가 없다(2026-10-09~10 Sentry 조사에서 미룬 항목) | 로그 + 브레드크럼(`refusal`). **`AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED`·`VOICE_MONTHLY_CHANGE_LIMIT_REACHED` 는 목록에 없다 — 그대로 이슈**다. 1.2.10 의 두 묶음(같은 코드 다섯 번 제출, 낡은 등록 횟수)은 그 둘이 이슈로 올라와 드러났다. 같은 코드라도 5xx 면 이슈다. 목록은 앱마다 **한 곳**이다(구현 지도) |
| **우리 서버가 아닌 곳이 낸 504** — 상태 504 이고 응답에 `error_code` 가 **없을 때만**(2026-10-15) | 우리 워커는 504 를 내지 않고 모든 4xx/5xx 에 코드를 싣는다. 코드 없는 504 는 기기와 우리 사이의 프록시·게이트웨이가 시간을 넘긴 것이다 — 2026-10-11~14 `HTTP_504` 23건(ANDROID-11 외)은 전부 Play 사전 출시 로봇이었고 같은 시각 서버 `api_error` 기록에 5xx 가 없었다 | 로그 + 브레드크럼(`transient`). **502·503 은 그대로 이슈**다 — Cloudflare 가 워커 자체의 실패로 내는 자리다. 코드가 실린 5xx 도 이슈다 |
| **탈퇴 유예 계정의 403**(`ACCOUNT_PENDING_DELETION`, 2026-10-15) — 상태 **403** 이고 그 코드일 때만 | 다시 로그인하면 서버가 탈퇴를 철회하고 신청은 모든 기기의 세션을 끊는다([session-and-auth.md](session-and-auth.md) 「탈퇴 유예 — 다시 로그인하면 철회」). 그러니 이 403 은 끝난 세션이다 — 고칠 결함이 아니다. 예전에는 계정 응답보다 먼저 떠난 호출이 로그인마다 이슈를 열었다(2026-10-12~13 Play 사전 출시 로봇, ANDROID-15~1B) | 로그 + 브레드크럼(`account`). 앱은 **그 기기의 계정을 떠난다**(알람까지 끄는 명시적 로그아웃 — 자동 만료가 아니다). 전경이든 안드로이드 워커든 같다(`endWorkerSession` → `leaveAccountAfterPendingDeletion`). 같은 코드라도 5xx 면 이슈다. 이웃한 `CONSENT_STATE_UNAVAILABLE` 은 그대로 이슈다 |
| **동의 필요 403**(`CONSENT_REQUIRED`, 2026-10-20) — 상태 **403** 이고 그 코드일 때만 | 서버의 동의 미들웨어가 데이터 라우트를 막은 것이고, 응답 쪽 한 곳(안드로이드 `AlarmTalkApiClient` 의 인터셉터, iOS `AlarmTalkAPI` 의 `consentRequiredNotification`)이 이미 동의 화면으로 보낸다 — 401 과 같은 모양이다. 재동의 기준(`CONSENT_MIN_POLICY_VERSION`)을 올리면 대상자가 앱을 열 때 그 답보다 먼저 떠난 호출이 한 건씩 이슈를 열었다(2026-10-20 처리방침 3→5 재동의 뒤 한 사람이 다섯 개 — ANDROID-1D·1E·1F·1M·1N) | 로그 + 브레드크럼(`consent`). 동의 화면이 안 뜨는 결함은 앱 이슈가 아니라 서버의 `api_error` 기록(같은 계정의 403 이 그치지 않는다)으로 본다. 같은 코드라도 5xx 면 이슈고, `CONSENT_STATE_UNAVAILABLE`·코드 없는 403 은 그대로 이슈다. 워커는 따로 '동의 대기' 로 접는다(아래) |

- **예상된 거절 목록의 원본은 shared 하나다**(`packages/shared/src/schemas/error-codes.ts` 의
  `CLIENT_EXPECTED_REFUSAL_CODES`, 2026-10-11). 낮추는 조건은 셋이 **모두** 맞을 때다 — 상태 400~499 · 응답에
  `error_code` 가 있다 · 그 코드가 목록에 있다 → 이슈 대신 브레드크럼(category `refusal`), 두 앱 같다. 두 앱은
  TypeScript 를 가져다 쓸 수 없어 같은 값을 손으로 두고(안드로이드 `EXPECTED_REFUSAL_CODES`, iOS
  `expectedRefusalCodes`), 셋이 같은지는 CI lint(`scripts/check-expected-refusal-codes.py`)가 본다 — 목록을 바꾸면
  shared 부터 고치고 두 앱을 맞춘다.
  - ⚠ `AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED`·`VOICE_MONTHLY_CHANGE_LIMIT_REACHED` 는 **넣지 않는다**(시끄럽게 둔다).
    사용자가 친 값의 결과처럼 보이지만, 거기 닿았다는 것은 **화면이 사용자에게 시도를 다 태우게 뒀다**는 뜻이다 —
    고칠 것은 화면이다.
  - 경보 목록(`ALERTING_ERROR_CODES`)과 겹치지 않는다 — 그쪽은 '우리가 고칠 것', 이쪽은 '사용자가 고칠 것' 이라 한
    코드가 둘 다일 수 없다(회귀 `packages/shared/test/error-codes.test.ts`).
- ⚠ **`IOException` 전체가 아니다.** 파일 없음·디스크 가득참은 결함일 수 있어 그대로 올린다.
  iOS 도 `.badServerResponse`·`.cannotParseResponse` 는 뺀다.
- ⚠ **HTTP 4xx 를 여기서 낮추지 않는다.** 그 4xx 가 무엇을 뜻하는지는 문맥을 아는 호출부가
  코드를 보는 자리에서 결정한다 — 로그인 직후 동의 전 `403 CONSENT_REQUIRED` 는 재시도 대상이
  아니라 **동의를 마쳐야 풀리는 상태**라, 백그라운드 워커는 성공으로 끝내고 다음 전경
  진입·주기가 다시 끌어온다(`sync/SyncWorkerFailure.kt`, iOS 는 `RemoteAlarmSyncViewModel`).
  정확히 그 코드만이다 — `CONSENT_STATE_UNAVAILABLE` 은 파손이다. (탈퇴 유예 403 `ACCOUNT_PENDING_DELETION` 은
  2026-10-15 부터 따로 낮추고, 앱은 전경에서 그 기기의 계정을 떠난다 — 위 표. 동의 필요 403 의 **보고**도 2026-10-20 부터
  브레드크럼이다 — 위 표. 워커의 결말(동의 대기)은 그와 별개로 호출부가 정한다.)
  (보고 함수도 이제 코드를 **읽는다** — 묶으려는 것이 첫째다. 아래 「앱의 묶음 키」. 코드로 낮추는 4xx 는 위 표의
  **예상된 거절 목록**·**탈퇴 유예 403**·**동의 필요 403** 셋뿐이다 — 그 밖의 4xx 는 지금도 여기서 낮추지 않는다.)
- ⚠ **상태코드로 낮추는 4xx 는 401 하나이고, 그것도 본문이 아니라 상태코드로 가른다.** (5xx 는 **코드 없는 504**
  하나다 — 위 표. 우리 워커는 504 를 내지 않는다.) 401 은 코드를 볼
  필요가 없다: `TOKEN_REVOKED` 든 만료든 결말이 하나(세션 정리)다. `HttpException.code()` 만 본다.
  - 2026-10-11 전에는 이유가 하나 더 있었다 — 안드로이드의 `apiError`·`apiErrorCode` 가
    `errorBody` 를 **소진**해, 먼저 읽은 쪽이 나중에 읽는 쪽의 몫을 빼앗았다(결제 경로는 보고
    **전에**, 목소리 경로는 보고 **뒤에** 코드를 읽고 있어 줄 순서가 곧 동작이었다). 이제 **코드를
    읽어도 본문은 소진되지 않는다** — 몇 번을, 어떤 순서로 읽어도 같은 답이다. 그래도 401 판정은
    상태코드 하나다. 순서 걱정이 사라졌다고 본문을 열 이유가 생긴 것은 아니다.
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
  - ⚠ **이 판정은 코드를 본다.** 401 은 상태코드로 가르지만 여기는 코드를 봐야 하므로,
    **404 일 때만** `apiError`·`serverErrorCode` 를 부른다. (예전에는 읽는 순서까지 지켜야 했다 —
    먼저 읽으면 코드를 볼 자리가 빈 본문을 받았다. 이제 읽어도 본문이 남는다 — 아래 「앱의 묶음 키」.)
- **브레드크럼이지 침묵이 아니다.** 다음 진짜 이벤트에 맥락으로 붙는다. "왜 그때 sync 가
  안 됐나" 는 브레드크럼에 있고, 이슈 목록에는 고칠 수 있는 것만 남는다.

### 앱의 묶음 키 — API 실패는 **코드와 호출 자리**로 묶는다 (2026-10-11)

위 표를 지나 **이슈로 올라가는** 실패 가운데, 원인 사슬에 HTTP 응답이 있는 것(안드로이드
`HttpException`, iOS `APIError.server`)은 Sentry 의 기본 묶음(스택)을 쓰지 않고 지문을 직접 준다.

| 응답 | 지문(fingerprint) |
| --- | --- |
| `error_code` 가 있다 | `["api_error", "<error_code>", "<logKey>"]` |
| 코드 없는 **4xx** | `["api_error", "HTTP_<status>", "<logKey>"]` |
| 코드 없는 **5xx** | `["api_error", "HTTP_<status>"]` |

- **`logKey`** 는 `reportError` 에 넘긴 로그 메시지에서 ` key=value` 토큰(공백 뒤 `이름=값`)을 뺀 것이다 —
  **어디서 부른 실패인가**만 남긴다.
  - `Failed to promote voice draft id=9264e503-…` → `Failed to promote voice draft`
  - `Failed to update voice profile sharing id=x shared=true` → `Failed to update voice profile sharing`
  - iOS 의 `알람 push 실패(create): status=403 code=X` 에서도 `status=`·`code=` 가 빠진다.
  - ⚠ 메시지를 그대로 지문에 넣지 말 것 — 목소리 id·상대 id 마다 이슈가 하나씩 생긴다.
- **태그**: `api.status`, `api.error_code`(있을 때), `log.key`. 지문이 묶고, 태그가 찾는다.
- **올리는 예외는 읽을 수 있는 포장이다**(안드로이드). `network/ReportedApiFailure` — 메시지
  `[<error_code 또는 HTTP_<status>>] <logKey> (HTTP <status>)`, 원래 예외는 `cause` 로 남는다. R8 이
  `retrofit2.HttpException` 을 `b5.o` 같은 이름으로 바꿔 이슈 제목을 읽을 수 없었다 — 포장은 `network`
  패키지에 있어 이름이 그대로 남는다(그 패키지는 통째로 keep 이다). iOS 는 난독화가 없어 `APIError` 를
  그대로 올린다.
- **HTTP 가 아닌 오류**는 기본 묶음 그대로다. `log.key` 태그만 얻는다.
- ⚠ **이 규칙으로 브레드크럼으로 내려가는 것은 하나도 없다.** 낮추는 범위는 위 표 그대로다(취소·일시적
  네트워크·401·예상된 거절 목록·탈퇴 유예 403·코드 없는 504…). 여기서 바뀌는 것은 올라간 이벤트가 **어느 이슈에 붙는가**뿐이다 — 목록
  밖의 4xx 거절도 5xx 도 전처럼 이슈다. 이 규칙을 만들 때는 예상된 거절(틀린 인증 코드 등)을 낮추지 않았고,
  뒤에 **목록으로만** 낮췄다(위 표, 2026-10-11) — 1.2.10 의 두 묶음(같은 코드 다섯 번 제출, 낡은 등록 횟수)을
  드러낸 `AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED`·`VOICE_MONTHLY_CHANGE_LIMIT_REACHED` 는 그래서 목록에 없다.
- **왜 코드 없는 5xx 는 호출 자리를 빼는가.** 우리 워커는 코드 없는 4xx/5xx 를 내지 않는다
  (`test/error-codes.test.ts` 의 ④). 코드 없는 5xx 는 워커 **앞단**(게이트웨이·프록시)이 낸 것이라, 어느
  화면이 불렀는지는 원인을 가르지 않는다. 1.2.8 부터 Play 사전 출시 로봇이 모든 호출에서 504 를 받았는데
  로그 메시지가 일곱 가지였다 — 호출 자리를 넣으면 회차마다 이슈가 일곱 개다. (2026-10-15 부터 코드 없는 **504** 는
  아예 브레드크럼이다 — 위 표. 이 지문 규칙은 502·503 같은 나머지 코드 없는 5xx 에 남는다.) 코드 없는 **4xx** 는
  호출 자리를 남긴다(주소·라우팅이 틀린 자리를 가리킨다).
- **코드를 읽어도 본문이 소진되지 않아야** 이 지문이 성립한다. 보고 함수가 코드를 읽는데 그 읽기가
  본문을 비우면, 지문이 **호출부의 줄 순서**에 따라 달라지고(위 「낮추는 예외는 401 하나」) 뒤에 읽는
  호출부는 문구를 잃는다. 안드로이드 `apiError` 는 버퍼된 오류 본문을 **엿본다**(peek). iOS 는
  `APIError.server` 가 코드를 값으로 들고 있어 처음부터 그 문제가 없다.
- **왜 필요했나.** Retrofit 은 모든 비-2xx 를 **같은 콜백 프레임**에서 던진다 — 스택이 하나라 엔드포인트가
  달라도 한 이슈였고, R8 이 그 콜백의 이름을 바꿀 때마다 새 잡동사니 이슈가 열렸다(ANDROID-B → K → Q).
  1.2.10 의 Q 에는 이메일 인증 거절·목소리 월 한도 429·사전 출시 로봇의 504 가 한데 섞여 있었다
  (42건 중 26건이 로봇). 백엔드 경보의 묶음 키가 에러 코드인 것과 같은 이유이고(구현 지도), 앱은 거기에
  호출 자리를 더한다 — 앱에는 라우트별 스택이 없다.
- ⚠ **두 앱의 키는 같은 모양이어야 한다.** 한쪽만 고치면 같은 실패가 프로젝트마다 다르게 묶인다. iOS 의
  보고 호출부는 알람 push·사용 기록 전송 둘이었다가, 2026-10-11 에 인증 코드 다섯 갈래(코드 요청 둘 · 인증
  확인 · 가입 · 재설정 확정 — `AuthViewModel` 의 `reportFailure`)가 더해졌다 — iOS 도 이제 조용하지 않다.
  그 다섯은 안드로이드 `ui/main/MainViewModelAuthActions.kt` 의 보고와 **같은 글자**다. 그 글자가 `logKey`
  (지문의 셋째 마디)이자 `log.key` 태그라, 한 글자만 달라도 같은 거절(시도 상한 뒤의 429 등)이 두
  프로젝트에서 다른 이름으로 묶인다. 호출부는 거르지 않는다 — 브레드크럼으로 내리는 판정은 보고 함수
  한 곳이다(위 표). 또 Sentry 는 Swift 오류를 도메인·코드로 묶으므로 `APIError.server` 는 상태·코드가
  달라도 한 이슈가 되기 쉽다 — 401 700건이 ALARMTALK-IOS-2 하나에 쌓였던 것과 같은 성질이다(401 이 아닌
  실패가 실제로 거기 붙는지는 확인하지 못했다).

## 4. 앱은 **코드로** 문구를 고른다

층이 셋이고, 위에서부터 이긴다:

1. **화면별 문구** — 그 화면에서만 다르게 말해야 하는 것(목소리 등록 중의
   `VOICE_FEATURE_REQUIRES_PAID_PLAN`).
2. **공용 표** — `ApiErrorMessages.kt` / `APIErrorMessages.swift`. 아무도 안 맡은 코드를 받는다.
3. **폴백** — 화면이 준 번역된 기본 문장. 서버 문장은 언어와 무관하게 두 앱 모두 표시하지 않는다.

일반 오류 헬퍼는 글에 한글이 있는지가 아니라 **사용자에게 보여줄 문구로 만든 출처**인지 본다.
Android는 `UserFacingException`(원인 예외 안의 것도 포함), iOS는 `AppUserFacingError`의
`userFacingDescription`만 언어와 무관하게 표시한다. iOS의 URL 오류는 `NSURLErrorDomain`에
`NSLocalizedDescriptionKey`가 실제로 채워진 경우만, StoreKit 구매 오류는 시스템의 현지화된
`Product.PurchaseError.errorDescription`을 쓴다. StoreKit 네트워크 오류는 앱의 네트워크 문구로,
나머지 시스템·개발자 오류는 화면 폴백으로 바꾼다. 취소 여부는 문구 판정보다 먼저 확인한다.

⚠ **공용 표는 '아무 데서나' 가 아니라 정해진 자리에서 불린다.** 일반 오류 헬퍼
(`userFacingError` / `userFacingErrorMessage`)는 코드를 보지 않는다 — 표를 부르는 자리는
**로그인 · TTS 생성 · 목소리 등록 · 목소리 승격 · 이메일 인증 확인 · 가입 · 비밀번호 재설정 확정**
일곱이고, 두 앱이 같은 일곱이다. 여기를 늘릴 때는 **양쪽을 같이** 늘린다(한쪽만 늘리면 같은 실패가 두 앱에서
다르게 읽힌다). (가족 알람 보내기·이용권 나가기 두 자리는 2026-10-20 그 기능과 함께 지웠다.)

⚠ **코드를 확인하는 세 자리 — 이메일 인증 확인 · 가입 · 비밀번호 재설정 확정 — 은 2026-10-11 에 더했다.**
셋 다 서버가 같은 판정(`checkEmailVerificationCode`)으로 인증 코드를 본다
([session-and-auth.md](session-and-auth.md) 「이메일 인증 코드」).
- 그전에는 두 앱 모두 이 자리의 실패를 **한 문장**으로 말했다. 인증 확인은 400 이든 429 든 네트워크
  실패든 "인증 코드가 맞지 않아요" 였고, 가입·재설정은 "…에 실패했어요" 였다. 표에는 세 코드의 문장이
  이미 있었는데 **부르는 자리가 없었다.** 2026-10-09 에 시도 상한(429)에 닿은 신규 가입자는 그 429 에도
  "맞지 않아요" 를 들었다 — 상한 뒤에는 맞는 코드를 넣어도 같은 답인데, 다시 받으라는 말은 어디에도 없었다.
- ⚠ **"인증 코드가 맞지 않아요" 는 `AUTH_EMAIL_CODE_INVALID` 일 때만 말한다.** 만료
  (`AUTH_EMAIL_CODE_EXPIRED`)·시도 상한(`AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED`)은 **다시 받으라**고 말하고,
  그 밖의 코드는 표의 문장(`RATE_LIMITED` 등)을, 표에 없거나 코드가 없으면(5xx·읽지 못한 응답) 그 화면의
  중립 폴백을 쓴다. 연결 실패는 안드로이드는 같은 폴백이고, iOS 는 위 문단의 `NSURLErrorDomain` 설명일 수
  있다(자리별 표는 [session-and-auth.md](session-and-auth.md) 「문장은 코드(error_code)로 고른다」) —
  '맞지 않아요' 를 폴백으로 두지 않는다. 맞는 코드를 든 사람에게 틀렸다고 말하게 된다.
- 문장만 바꾸고 끝내지 않는다 — 문장이 시키는 일(다시 확인·다시 받기)을 화면이 할 수 있어야 한다.
  그 화면 규칙은 위 스펙 문서에 있다.

⚠ **모든 코드에 문구를 둘 필요는 없다.** `INVALID_JSON` 처럼 사용자가 할 수 있는 게 없는
것은 비워 두고 폴백에 맡긴다 — 억지로 채우면 알아들을 수 없는 말만 늘어난다.

**`VOICE_CLONE_NO_SPEECH`(2026-10-11) 는 두 공용 표에 같은 문장으로 있다**(ko·en·ja — 문장은
[voice-and-message.md](voice-and-message.md) §4-1 「말소리가 없으면 등록하지 않는다」). 닿는 자리는 위 일곱 중
**목소리 등록** 하나다. 등록 창(화면 층)은 이 코드의 문장을 바꾸지 않고 **띄울 자리와 다음 단계**만 정한다 — 음원
준비로 돌아가 녹음을 버리고 그 단계에 문장을 띄운다. 스토어의 1.2.10 은 이 코드를 몰라 각자의 폴백 문장이고,
두 앱이 다르게 끝난다(그 절이 받아들인 차이다). **iOS** 는 세부 정보 단계에 `목소리를 처리하지 못했어요. 잠시 후 다시
시도해 주세요.` 를 띄우고 녹음을 그대로 둔다 — `등록` 을 누를 때마다 같은 소리를 다시 보내 같은 거절을 받고, 그때마다
전사 한 번과 경보 사건 하나가 생긴다(§3). **안드로이드** 는 '만드는 중' 으로 넘어갈 때 이미 녹음을 놓아, 세부 정보
단계로 돌아오면 `등록` 이 꺼져 있고 `목소리를 만들지 못했어요`(`msg_voice_create_failed`)는 등록 창 뒤의 스낵바라 안
보일 수 있다 — 같은 소리를 다시 보낼 수는 없고, 이유를 모른 채 음원 준비로 돌아가 다시 녹음해야 한다.

⚠ **두 앱의 표는 같은 코드를 같은 뜻으로 말해야 한다.** 한쪽에만 코드를 더하면 같은
실패가 두 앱에서 다르게 읽힌다. 실제로 iOS 는 `VOICE_LIMIT_REACHED`(=등록 슬롯이 찼다)를
"이번 달 목소리 생성 한도를 모두 사용했어요" 로 말하고 있었고, **회귀 테스트가 그 틀린
문구를 지키고 있었다**(2026-09-07 정정).

⚠ **맞추는 범위는 '위 일곱 자리에 닿을 수 있는 코드' 다 — 목록 전체가 아니다.** 표를 부르지
않는 경로의 코드는 표에 있어도 아무도 읽지 않으므로, 한쪽에만 있다고 반대편에 베껴 넣지
않는다. 지금 그런 것이 둘 있다: `AUTH_EMAIL_TAKEN`·`AUTH_EMAIL_SOCIAL`
(`network/ApiErrorMessages.kt`)은 이미 가입된 주소의 409(`routes/auth.ts`)다. 정상 흐름에서 그 409 를
받는 자리는 **인증 코드 요청**(`POST /auth/email-code`)이고, 거기는 표를 부르는 자리가 아니다 —
두 앱 모두 **화면이 직접** 가른다: 안드로이드 `duplicateEmailMessage`
(`ui/main/MainViewModelAuthActions.kt`), iOS `AuthViewModel.requestEmailVerification` 의
`userFacingErrorMessage` 폴백.
- **가입(`POST /auth/register`)은 2026-10-11 부터 표를 부른다**(위 문단). 거기서 이 409 는 코드를 받은
  뒤 같은 주소로 다른 가입이 먼저 끝난 경쟁에서만 온다. 안드로이드는 그때도 `duplicateEmailMessage`
  (화면 층)가 표보다 **먼저** 받아 로그인 화면으로 넘긴다 — 층 순서 그대로다. iOS 는 표에 그 두 줄이
  없어 가입 화면의 폴백으로 떨어진다.
- **iOS 표에 이 둘을 더하는 일은 이번 변경에 넣지 않았다.** 더하면 가입의 그 드문 409 문장만 달라지고
  코드 요청 경로는 그대로다 — 표만 같아 보이고 실제 차이는 남는다. 맞추려면 두 경로를 함께, 아래의
  화면 전환까지 정한다.
- 특히 `AUTH_EMAIL_TAKEN` 은 문구만이 아니라 **로그인 화면 전환**(`authRedirectToLogin`)을
  겸한다. 표는 문자열 하나만 돌려주므로 구조적으로 그 일을 할 수 없다.
- 안드로이드 표의 그 두 줄은 화면 층이 늘 먼저 받아 지금도 **닿지 않는 자리**다. 지우려면 가입·코드
  요청 경로가 정말로 표까지 내려오지 않는지 먼저 확인하고, 이 문단도 함께 고친다.

## 5. 코드를 새로 만들 때

1. `packages/shared/src/schemas/error-codes.ts` 의 도메인 묶음에 알파벳 순으로 넣는다.
2. 백엔드에서 내보낸다 — `jsonError(c, status, code, message)` 또는 `errorBody(code, message)`.
   리터럴로 `error_code: 'FOO'` 를 새로 쓰지 말 것.
3. 사용자에게 보여 줄 말이 따로 있으면 **두 앱의 표에 같이** 넣는다.
4. 눈에 띄어야 하면 `ALERTING_ERROR_CODES` 에 넣는다(기준: 사용자가 막혔고, **우리가**
   손쓸 수 있는가).
5. 사용자가 친 값의 거절이고 화면이 코드로 고른 문장으로 이유를 말하면 `CLIENT_EXPECTED_REFUSAL_CODES` 에
   넣고 두 앱의 상수도 같은 값으로 맞춘다(§3 「앱도 같다」 — 4와 겹칠 수 없다).

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
| Turso 게이트웨이 일시 실패는 **읽기만** 다시 시도(5xx·전송 실패, 150·450ms, 최대 3회) | — | — | `lib/turso-retry.ts` 의 `isTransientTursoGatewayError`·`withTransientReadRetry`, `lib/db.ts` 의 `getDB` 가 두른다(HTTP·cron 공통); 읽기 트랜잭션은 `lib/transactions.ts` 의 `withReadTransaction` 이 통째로 다시 시도 · `test/turso-retry.test.ts`·`test/transactions.test.ts`. 2026-09-22 전에는 cron 만, 그것도 520 만 — 525(BACKEND-3)는 한 번도 재시도되지 않아 인증 조회가 그대로 503 `ACCOUNT_STATUS_UNVERIFIED` 였다 |
| 쓰기 재시도의 **좁은 예외** — 호출부가 **원자적 쓰기 batch 하나**(`db.batch(문장들, 'write')` — 한 번의 왕복이고 전부 아니면 전무다. 문장이 하나뿐인 쓰기는 그 자체로 그렇다)를 다시 보낼 수 있다. 조건은 둘 다: ① **모든 문장이 멱등**(같은 인자로 두 번 실행해도 결과가 같다) ② 다시 도는 클로저 안에 **DB 밖의 일이 없다**(외부 API 호출·푸시 발송·R2 쓰기 — 다시 돌면 그 일도 두 번 일어난다). 재시도마다 warn 한 줄 | — | — | **지금은 `routes/push.ts` 뿐이다** — `/register`(`pushRegisterStatements` 가 만든 `DELETE 다른 소유자` + `UPSERT` 를 `db.batch(…, 'write')` 로, `retryTransientTurso` 안에서)·`/unregister`(호출자 행의 `DELETE` 하나를 `retryTransientTurso` 안에서) · `lib/turso-retry.ts` 의 `retryTransientTurso` 가 재시도마다 `logStructured('warn', { at: 'turso.retry', … })`(읽기 재시도도 같은 함수를 지나 같이 찍힌다) · `test/push.test.ts`·`test/push-token-unique.test.ts`·`test/turso-retry.test.ts`. 2026-09-28·10-07 에 `/push/register` 의 대화형 쓰기 트랜잭션이 게이트웨이 525·520 을 받아 그대로 500 이었다(BACKEND-E — 스택의 줄 위치로는 둘 다 첫 왕복이다). 안드로이드는 프로세스가 뜰 때마다 다시 등록한다 — iOS 는 2026-10-11 전에는 바인딩이 없거나 바뀌었다고 볼 때만 올려, 실패한 한 번이 다음 올리기까지 푸시를 끊을 수 있었다(지금은 실행마다 한 번, 확인될 때까지 전경 복귀마다 — [session-and-auth.md](session-and-auth.md) 「푸시 등록 — 스스로 낫고, 설정 오류로 지우지 않는다」). 재시도가 줄이는 것은 그 틈이 생기는 횟수다. batch 는 왕복이 하나라 재시도가 안전하고 싸다(열어 둔 스트림이 남지 않는다). ⚠ **일반 규칙으로 넓히지 말 것** — `withWriteTransaction`·`getDB` 프록시는 쓰기를 재시도하지 않는다(탈퇴의 COMMIT 전 롤백 확인 재시도는 아래 별도 행)(대화형 트랜잭션은 왕복이 여럿이라 어디까지 적용됐는지 모른 채 다시 보내게 되고, 멱등이 아닌 쓰기는 두 번 적용된다). 새 자리를 더하려면 두 조건을 그 자리의 주석에 적고 이 칸에 더한다 |
| 경보의 **묶음 키는 에러 코드**(경로 아님) | — | — | `middleware/errorCode.ts` 의 `setFingerprint(['api_error', code])` · `test/error-code-middleware.test.ts`. Sentry 는 기본으로 스택으로 묶어 같은 미들웨어가 낸 예외는 코드가 달라도 한 이슈가 됐다(BACKEND-8 에 두 코드가 섞임, 2026-09-22) |
| 라우트의 4xx 거절은 경보가 아님 | — | — | `routes/auth.ts` 의 `/google`·`/apple` catch · `test/auth-apple-route.test.ts` |
| 중복 보고 방지 표시 | — | — | `lib/logger.ts` 의 `logRouteError` |
| 앱의 이슈/브레드크럼 판정 | `core/AlarmTalkLog.kt` 의 `isExpectedTransientFailure`(HTTP/2 리셋 포함)·`isGoogleSignInUserAction` · `TransientFailureClassificationTest` | `AlarmTalkLog.swift` 의 `isExpectedTransientFailure` · `TransientFailureClassificationTests` | — |
| 401 은 이슈가 아니라 브레드크럼 | `core/AlarmTalkLog.kt` 의 `isHandledAuthFailure` · `TransientFailureClassificationTest` | `AlarmTalkLog.swift` 의 `isHandledAuthFailure` · `AlarmTalkTests/TransientFailureClassificationTests` | — |
| 사용자가 친 값의 예상된 거절은 이슈가 아니라 브레드크럼(§3 — 상태 400~499 · `error_code` 있음 · 목록에 있음 → category `refusal` · 목록 원본은 shared 하나 · 시도를 다 태운 두 코드는 그대로 이슈 · 경보 목록과 겹치지 않는다) | `core/AlarmTalkLog.kt` 의 `EXPECTED_REFUSAL_CODES`(shared 와 같은 값 — 검사는 `app/src/main` 에서 이름으로 찾는다)·`isExpectedRefusal` → `breadcrumbCategoryFor` 의 `refusal` · 회귀 `TransientFailureClassificationTest`·`ApiFailureReportingTest` | `AlarmTalkLog.swift` 의 `expectedRefusalCodes`(shared 와 같은 값)·`isExpectedRefusal(_:)`(원인 사슬의 첫 `APIError.server` — 묶음 키와 같은 방법으로 읽는다) → `handledFailureCategory` 의 `refusal` · 회귀 `AlarmTalkTests/TransientFailureClassificationTests`(`test_예상된_거절_목록은_정해진_다섯_개다`·`test_사용자가_고칠_예상된_거절은_브레드크럼이다`(감싸인 응답 포함)·`test_시도_상한_월_한도_5xx_코드_없는_거절은_그대로_이슈다`)·`AlarmTalkTests/EmailCodeErrorMessageTests` 의 `test_올린_실패의_갈래와_묶음_키는_보고_함수가_정한다`(호출부는 그대로 올리고 보고 함수가 낮춘다) | 원본 `packages/shared/src/schemas/error-codes.ts` 의 `CLIENT_EXPECTED_REFUSAL_CODES` · 회귀 `packages/shared/test/error-codes.test.ts`(다섯 개 그대로 · 전부 실재 · 경보 목록과 겹치지 않음 · `AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED`·`VOICE_MONTHLY_CHANGE_LIMIT_REACHED` 는 없음) · CI lint `scripts/check-expected-refusal-codes.py`(`--self-test` 포함 — 셋이 같은 값 · 앱마다 선언 하나 · 안드로이드 `setOf(`·iOS `Set<String>` · 문자열 리터럴만 · 중복 없음) |
| 탈퇴 유예 403 은 브레드크럼(`account`, 상태 403 + 코드) · 앱은 그 기기의 계정을 떠난다(알람까지 끈다 — 전경·워커 모두) | `core/AlarmTalkLog.kt` 의 `isAccountPendingDeletion` → `breadcrumbCategoryFor` · `ui/main/MainViewModelAuthActions.kt` 의 `checkAccountStatus` → `leaveAccountForPendingDeletion` · 어느 요청이든 `network/AlarmTalkApiClient.kt` 의 인터셉터 → `UnauthorizedHandler.onAccountPendingDeletion` → 같은 떠나기 · `sync/SyncWorkerFailure.kt` 의 `syncWorkerOutcome`(→ `SESSION_EXPIRED`) → `endWorkerSession` → `leaveAccountAfterPendingDeletion` · 회귀 `TransientFailureClassificationTest`·`sync/WorkerTokenRollTest` | `AlarmTalkLog.swift` 의 `isAccountPendingDeletion` → `handledFailureCategory` · `AuthViewModel.refreshUser` → `leaveAccountForPendingDeletion` · 회귀 `AuthViewModelTests`(`test_refreshUser_signsOut_whenStatusPending`·`test_refreshUser_leavesAccount_whenSessionWasCutByDeletionElsewhere`)·`TransientFailureClassificationTests` | `middleware/auth.ts`(폐기 검사보다 먼저)·`routes/auth.ts` 의 `/me`(끊긴 토큰도 403) · 철회는 `lib/account-deletion.ts` 의 `cancelPendingDeletionOnSignIn` · 회귀 `test/auth-pending-deletion.test.ts`·`test/sign-in-cancels-deletion.test.ts` |
| 동의 필요 403 은 브레드크럼(`consent`, 상태 403 + 코드) · 동의 화면은 응답 쪽 한 곳이 연다 | `core/AlarmTalkLog.kt` 의 `isConsentRequired` → `breadcrumbCategoryFor` · 회귀 `TransientFailureClassificationTest` 의 `consentRequiredBecomesConsentBreadcrumbOnlyAs403` | `AlarmTalkLog.swift` 의 `isConsentRequired` → `handledFailureCategory` · 회귀 `AlarmTalkTests/TransientFailureClassificationTests` 의 `test_동의_필요_403은_consent_브레드크럼이다` | `middleware/consent.ts` 가 403 `CONSENT_REQUIRED` 를 낸다 · 모든 4xx 는 `middleware/errorCode.ts` 가 `api_error` 로 남긴다 |
| 코드 없는 504 는 일시 실패(`transient`) · 502·503·코드 있는 5xx 는 이슈 | `core/AlarmTalkLog.kt` 의 `isForeignGatewayTimeout` · 회귀 `TransientFailureClassificationTest` 의 `codelessGatewayTimeoutIsTransientButOur5xxStayIssues` | `AlarmTalkLog.swift` 의 `isForeignGatewayTimeout` · 회귀 `test_코드_없는_504는_일시_실패다` | 우리 워커는 504 를 내지 않는다(`test/error-codes.test.ts` ④ — 모든 4xx/5xx 에 코드) |
| 낮추는 **범위**(그 밖의 4xx·5xx 는 그대로 이슈) | `core/AlarmTalkLog.kt` 의 `breadcrumbCategoryFor` · `TransientFailureClassificationTest` 의 `onlyUnauthorizedAndTransientBecomeBreadcrumbs` | `AlarmTalkLog.swift` 의 `handledFailureCategory` · `AlarmTalkTests/TransientFailureClassificationTests` 의 `test_401_외의_상태코드는_그대로_이슈다` | — |
| 앱의 **묶음 키**(§3 — `[api_error, 코드 또는 HTTP_상태, logKey]` · 코드 없는 5xx 는 `logKey` 없음 · 태그 `api.status`·`api.error_code`·`log.key` · 낮추는 것 없음) | `core/AlarmTalkLog.kt` 의 `logKeyOf`·`apiFailureFingerprint` ← `reportError`(이슈 갈래에서 `apiFailureOf` 로 상태·코드를 읽어 지문·태그를 달고 `network/ReportedApiFailure` 로 감싸 올린다. HTTP 가 아니면 `log.key` 태그만) · 회귀 `ApiFailureReportingTest`(Robolectric — id 만 다른 메시지는 같은 지문 · 코드가 다르면 다른 지문 · 코드 없는 504 는 `[api_error, HTTP_504]` · 코드 없는 404 는 `logKey` 유지 · HTTP 가 아니면 지문 없음 · 포장의 메시지·`cause`·패키지). ⚠ 지문이 실제 이벤트에 실리는지는 유닛 테스트가 못 본다 — dev 빌드 이벤트 한 건으로 확인한다 | `AlarmTalkLog.swift` 의 `logKey(of:)`·`apiFailureFingerprint(for:message:)` ← `reportError`(원인 사슬에 `APIError.server` 가 있으면 지문·태그, 없으면 `log.key` 태그만. 포장 없음 — 컨텍스트 키 `log_message` 는 그대로) ← 호출부 `RemoteAlarmPushSync`(알람 push)·`UsageEventUploader.flush`(사용 기록 전송)·`AuthViewModel` 의 `reportFailure`(2026-10-11 — `requestEmailVerification`·`verifyEmailCode`·`performRegisterWithEmail`·`requestPasswordReset`·`confirmPasswordReset`, 메시지는 안드로이드 `ui/main/MainViewModelAuthActions.kt` 와 같은 글자) · 회귀 `AlarmTalkTests/TransientFailureClassificationTests` 의 `test_API_실패의_묶음_키` · `AlarmTalkTests/EmailCodeErrorMessageTests` 의 `test_인증_코드_다섯_갈래의_실패는_정해진_글자로_한_번씩_올린다`(성공은 올리지 않는다 · 실패마다 한 번 · 안드로이드와 같은 글자 · 받은 오류를 그대로)·`test_올린_실패의_갈래와_묶음_키는_보고_함수가_정한다`(호출부는 거르지 않는다 — 시도 상한의 거절은 `[api_error, 코드, 호출 자리]` 이슈 · 코드 없는 5xx 는 `[api_error, HTTP_503]` · 시간 초과·401 은 브레드크럼 · 틀린 숫자(`AUTH_EMAIL_CODE_INVALID`)는 `refusal`) | 짝: `middleware/errorCode.ts` 의 `setFingerprint(['api_error', code])`(위 행) |
| 코드 읽기는 **본문을 소진하지 않는다**(순서·횟수와 무관하게 같은 답) | `network/ApiErrors.kt` 의 `apiError`(버퍼된 오류 본문을 엿본다)·`apiFailureOf`(원인 사슬에서 상태 + 코드 — `ApiFailure`) · 회귀 `TransientFailureClassificationTest` 의 `apiErrorCanBeReadTwice`·`apiFailureIsIndependentOfCallOrder`(기존 `breadcrumbClassificationDoesNotConsumeTheErrorBody`·`unauthorizedClassificationDoesNotConsumeTheErrorBody` 는 그대로 초록) | — (`APIError.server(status, _, code)` 가 코드를 값으로 든다) | — |
| 탈퇴 신청의 쓰기 재시도 | — | — | `routes/user.ts` → `withRetryableWriteTransaction`: 트랜잭션 열기 실패 또는 COMMIT 전 실패이고 롤백 성공/트랜잭션 닫힘이 확인된 경우에 기존 Turso 백오프로 재실행. 콜백은 DB 작업만 수행하고 푸시는 성공 뒤 발송. COMMIT·롤백 실패는 재실행하지 않음. 일반 `withWriteTransaction`은 그대로 재시도 없음 · `test/transactions.test.ts` |
| 동의 전 403 은 재시도가 아님 | `sync/SyncWorkerFailure.kt` 의 `syncWorkerOutcome` | `RemoteAlarmSyncViewModel` 의 `runFullSync` catch | `middleware/consent.ts` |
| 401 은 재시도가 아니라 세션 종료 | `sync/SyncWorkerFailure.kt` 의 `endSessionAfterWorkerUnauthorized`(**세대+토큰** 검사) · `TransientFailureClassificationTest` | `AlarmTalkAPI.handleUnauthorized` → `AuthViewModel.handleUnauthorized`(**토큰** 대조 후 `signOut`) — API 계층이라 백그라운드도 같다 | — |
| 401 이면 **그 회차를 끊는다**(남은 후보를 같은 죽은 토큰으로 밀지 않는다) | 워커가 `SESSION_EXPIRED` 에서 `Result.success()` 로 끝낸다(`sync/SyncWorkerFailure.kt`) | `RemoteAlarmPushSync` 의 후보 루프 `break` · `AlarmTalkTests/UnauthorizedSessionHandlingTests` 의 `PushSyncUnauthorizedCycleTests` | — |
| 파기된 계정의 404 는 401 과 **같은 갈래**(코드 없는 404 는 **세션 유지**) | `ui/main/MainViewModelAuthActions.kt` 의 `isDestroyedAccountFailure` → `MainViewModel.handleUnauthorized` · `DestroyedAccountSessionTest` | `AuthViewModel.refreshUserApplyingToken` 의 `status == 404 && errorCode == "AUTH_USER_NOT_FOUND"` · `AlarmTalkTests/UnauthorizedSessionHandlingTests` 의 `SessionHealthCheckDestroyedAccountTests` | `routes/auth.ts` 의 `GET /auth/me`(그 밖의 라우트는 `middleware/auth.ts` 가 401) |
| 응답에서 코드 꺼내기 | `network/ApiErrors.kt` 의 `apiErrorCode`(본문을 소진하지 않는다 — 위 행) | `APIError.serverErrorCode` | — |
| 코드 → 문구(공용) | `network/ApiErrorMessages.kt` | `APIErrorMessages.swift` | — |
| 일반 오류 문구의 출처 | `ui/util/PlatformAndLabelUtils.kt`의 `UserFacingException`·`userFacingError` | `UserFacingError.swift`의 `AppUserFacingError`·`userFacingErrorMessage`, `AudioUserFacingError`도 위임 | 서버 문장은 앱에서 직접 표시하지 않음 |
| 코드 → 문구(목소리 화면) | `ui/main/MainViewModelVoiceActions.kt` | `VoiceStudioViewModel+ErrorMapping.swift` | — |
| 말소리 없음 `VOICE_CLONE_NO_SPEECH` — 공용 표의 같은 문장(ko·en·ja) · 사용자가 고칠 수 있는 400 이지만 경보(§3 — 늘면 전사 고장) | `network/ApiErrorMessages.kt` 의 `VOICE_CLONE_NO_SPEECH` → `msg_voice_clone_no_speech`(`res/values{,-en,-ja}/strings.xml`) ← `ui/main/MainViewModelVoiceActions.kt` 의 등록 실패 갈래(화면 층은 자리만 정한다 — `RegistrationFailureSurface.ReRecord`, [voice-and-message.md](voice-and-message.md) 구현 지도) · 회귀 `VoiceRegistrationFailureWiringTest`(`theNoSpeechSentenceIsOneTableEntryInThreeLanguages`·`theNoSpeechSentenceSaysTheSameThingAsTheIosCatalog`) | `APIErrorMessages.swift` 의 `VOICE_CLONE_NO_SPEECH`(`Localizable.xcstrings` en·ja) ← `VoiceStudioViewModel+ErrorMapping.swift` 의 `localizedVoiceMessage(forCode:)`(기본 갈래가 공용 표) · 폴백 목록 `knownErrorCodes` · 회귀 `AlarmTalkTests/VoiceLocalizationTests` 의 `noSpeechRejectionCopy` | `routes/voice-profile.ts` 의 `POST /clone` → `checkCloneSpeech` → `jsonError(c, 400, 'VOICE_CLONE_NO_SPEECH', …)` · 경보 `ALERTING_ERROR_CODES`(`packages/shared/src/schemas/error-codes.ts`) ← `middleware/errorCode.ts` · 회귀 `test/error-codes.test.ts`(경보 목록에 있다)·`test/voice-clone-speech-gate.test.ts`(몸통) |
| 아침 소식 코드(`BRIEFING_*`) — HTTP 오류 다섯 + 본문 `errors[].code` 로만 나가는 원천 실패 다섯(`GET /briefing/today` 는 일부 실패에도 200 — [morning-briefing.md](morning-briefing.md) §5) | — (앱 화면 없음) | — (앱 화면 없음) | `routes/briefing.ts` 의 `jsonError` · 원천 실패 → 코드는 `lib/briefing/source-error.ts` 의 `briefingSourceErrorCode` · 회귀 `test/briefing-route.test.ts` |
| 코드 → 문구(로그인 화면) | `ui/main/MainViewModelAuthActions.kt` 의 login 갈래 | `AuthViewModel.loginErrorMessage` | — |
| 코드 → 문구(이메일 인증 확인·가입·비밀번호 재설정 확정 — '맞지 않아요' 는 `AUTH_EMAIL_CODE_INVALID` 일 때만) | `ui/main/MainViewModelAuthActions.kt` 의 `emailCodeFailureMessage(context, error, fallback)`(표 → 화면 폴백) ← `confirmEmailVerification`(폴백 `api_error_server`)·`register`(`duplicateEmailMessage` 다음, 폴백 `msg_register_failed`)·`confirmPasswordReset`(폴백 `msg_password_reset_failed`) · 회귀 `EmailCodeFailureMessageTest`(Robolectric, ko·en·ja) | `AuthViewModel.emailCodeErrorMessage(for:fallback:)`(`loginErrorMessage(for:)` 의 형제 — `nonisolated static`) ← `verifyEmailCode`·`performRegisterWithEmail`·`confirmPasswordReset` · 회귀 `AlarmTalkTests/EmailCodeErrorMessageTests` | `routes/auth.ts` 의 `checkEmailVerificationCode`(`/email-code/verify`·`/register`·`/password-reset/confirm` 공용) — 규칙은 [session-and-auth.md](session-and-auth.md) 「이메일 인증 코드」 |
