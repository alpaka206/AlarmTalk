# 에러 코드

> 서버가 실패를 **기계가 읽는 이름**으로 말하고, 앱이 그 이름으로 사람이 읽는 말을 고른다.
> 2026-09-07 정리.

## 1. 모든 에러 응답은 코드를 갖는다

```json
{ "error": "이번 달 직접 입력 문구 만들기 횟수를 모두 사용했어요.", "error_code": "MANUAL_TTS_QUOTA_EXCEEDED" }
```

- `error` 는 **마지막 안전망**이다. 앱이 그 코드를 모를 때만 그대로 보여 준다.
- `error_code` 가 **계약**이다. 앱은 이 값으로 분기하고 문구를 고른다.

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

## 4. 앱은 **코드로** 문구를 고른다

층이 셋이고, 위에서부터 이긴다:

1. **화면별 문구** — 그 화면에서만 다르게 말해야 하는 것(목소리 등록 중의
   `VOICE_FEATURE_REQUIRES_PAID_PLAN`).
2. **공용 표** — `ApiErrorMessages.kt` / `APIErrorMessages.swift`. 아무도 안 맡은 코드를 받는다.
3. **폴백** — 서버 문장(한국어면) 또는 화면이 준 기본 문장.

⚠ **모든 코드에 문구를 둘 필요는 없다.** `INVALID_JSON` 처럼 사용자가 할 수 있는 게 없는
것은 비워 두고 폴백에 맡긴다 — 억지로 채우면 알아들을 수 없는 말만 늘어난다.

⚠ **두 앱의 표는 같은 코드를 같은 뜻으로 말해야 한다.** 한쪽에만 코드를 더하면 같은
실패가 두 앱에서 다르게 읽힌다. 실제로 iOS 는 `VOICE_LIMIT_REACHED`(=등록 슬롯이 찼다)를
"이번 달 목소리 생성 한도를 모두 사용했어요" 로 말하고 있었고, **회귀 테스트가 그 틀린
문구를 지키고 있었다**(2026-09-07 정정).

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
| 기록·경보 | — | — | `middleware/errorCode.ts` |
| 중복 보고 방지 표시 | — | — | `lib/logger.ts` 의 `logRouteError` |
| 응답에서 코드 꺼내기 | `network/ApiErrors.kt` 의 `apiErrorCode` | `APIError.serverErrorCode` | — |
| 코드 → 문구(공용) | `network/ApiErrorMessages.kt` | `APIErrorMessages.swift` | — |
| 코드 → 문구(목소리 화면) | `ui/main/MainViewModelVoiceActions.kt` | `VoiceStudioViewModel+ErrorMapping.swift` | — |
