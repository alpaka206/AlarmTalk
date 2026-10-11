package com.alarmtalk.app.network

/**
 * Sentry 에 올리는 **읽을 수 있는 포장** — 원인 사슬에 HTTP 응답이 있는 실패를 이걸로 감싸 올린다
 * (`AlarmTalkLog.reportError`, 규칙은 `docs/spec/error-codes.md` §3 「앱의 묶음 키」).
 *
 * 메시지는 `[<error_code 또는 HTTP_<status>>] <logKey> (HTTP <status>)` 이고 원래 예외는 [cause] 로
 * 남는다. 이슈 제목이 "어느 코드가, 어디서" 로 읽힌다 — 예전 제목은 R8 이 바꾼 `b5.o` 같은 이름
 * (`retrofit2.HttpException`)과 `HTTP 429` 뿐이라 무엇이 실패했는지 제목으로는 알 수 없었다.
 *
 * ⚠ **이 클래스는 `network` 패키지에 둔다.** 그 패키지는 통째로 keep 이라(`proguard-rules.pro`)
 * 릴리스 빌드에서도 이름이 그대로 남는다. 다른 패키지로 옮기면 포장의 이름도 난독화된다.
 *
 * ⚠ 던지는 예외가 아니다 — 보고에만 쓴다. 호출부가 잡는 것은 언제나 원래 예외다.
 *
 * @param logKey 로그 메시지에서 값 토큰을 뺀 것(`AlarmTalkLog.logKeyOf`) — 어디서 부른 실패인가.
 */
class ReportedApiFailure(
    val failure: ApiFailure,
    val logKey: String,
    cause: Throwable,
) : RuntimeException("[${failure.code ?: "HTTP_${failure.status}"}] $logKey (HTTP ${failure.status})", cause)
