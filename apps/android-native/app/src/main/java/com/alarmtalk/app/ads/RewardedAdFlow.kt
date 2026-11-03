package com.alarmtalk.app.ads

import com.alarmtalk.app.network.AdRewardSessionResponse

/** 광고를 불러온 결과 — 못 불러왔으면 왜인지(서버 세션에 그대로 알린다). [A] 는 SDK 의 광고 객체다(테스트는 가짜). */
internal sealed interface AdLoadResult<out A> {
    data class Loaded<A>(val ad: A) : AdLoadResult<A>

    /** 재고 없음. */
    data object NoFill : AdLoadResult<Nothing>

    /** 네트워크·내부 오류 등. */
    data object Failed : AdLoadResult<Nothing>

    /** 규정 지역에서 동의를 받지 못했다 — 광고를 요청하지 않았다. */
    data object ConsentUnavailable : AdLoadResult<Nothing>
}

/** 서버의 시청 승인 세션(`network/AdRewardApi.kt`). 실패는 던진다(HTTP 오류는 `error_code` 를 싣는다). */
internal interface AdRewardSessionClient {
    suspend fun prepare(adUnit: String): AdRewardSessionResponse
    suspend fun start(sessionId: String): AdRewardSessionResponse
    suspend fun close(sessionId: String, outcome: String)
}

/** 광고 한 번을 본 결과 — 편집기가 무엇을 말할지 고른다. */
internal sealed interface RewardedWatchResult {
    /** 끝까지 봤다(SDK 의 보상 신호). 서버 확인(SSV)을 기다린다 — 앱은 적립하지 않는다. */
    data object Earned : RewardedWatchResult

    /** 보상 신호 없이 닫혔다. 실패로 말하지 않는다(사용자가 닫은 것이다). */
    data object Dismissed : RewardedWatchResult

    /** 서버가 세션 발급·시작을 거절했다 — [code] 로 문구를 고른다(이번 달 상한·다른 기기·꺼짐·만료). */
    data class Refused(val code: String?) : RewardedWatchResult

    /** 볼 수 있는 광고가 없다. */
    data object NoFill : RewardedWatchResult

    /** 불러오기·표시 실패·동의 불가. */
    data object Unavailable : RewardedWatchResult
}

/**
 * **광고 한 번의 순서**(`docs/spec/ad-rewards.md` §3 「흐름」): 세션 발급 → 광고 불러오기(SSV 옵션에 계정 PK·승인 id) →
 * **표시 직전** 시작 승인 → 표시 → 어떻게 끝났는지 알림. iOS `RewardedAdFlow.watch` 와 같은 순서다.
 *
 * - 못 불러오면 시작 승인을 받지 않고 `close` 로 알린다 — 서버가 예약을 푼다(재고 없음·로딩 실패·동의 불가).
 * - 시작 승인이 거절되면(10분 만료·그 사이 스위치 꺼짐·플러스) 띄우지 않는다.
 * - `close` 는 **최선**이다 — 실패해도 결과는 그대로다. 서버는 15분 뒤 잠금을 스스로 풀고, 늦은 SSV 도 받는다.
 */
internal class RewardedAdFlow<A>(
    private val client: AdRewardSessionClient,
    private val adUnit: String,
    private val load: suspend (ssvUserId: String, ssvCustomData: String) -> AdLoadResult<A>,
    private val show: suspend (A) -> RewardedAdOutcome,
    private val errorCode: (Throwable) -> String?,
) {
    suspend fun watch(): RewardedWatchResult {
        val prepared = try {
            client.prepare(adUnit)
        } catch (error: Throwable) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            return RewardedWatchResult.Refused(errorCode(error))
        }
        val sessionId = prepared.session.id
        val ssv = prepared.ssv
        if (sessionId.isBlank() || ssv == null || ssv.userId.isBlank() || ssv.customData.isBlank()) {
            if (sessionId.isNotBlank()) closeQuietly(sessionId, "cancelled")
            return RewardedWatchResult.Unavailable
        }
        val ad = when (val loaded = load(ssv.userId, ssv.customData)) {
            is AdLoadResult.Loaded -> loaded.ad
            AdLoadResult.NoFill -> {
                closeQuietly(sessionId, "no_fill")
                return RewardedWatchResult.NoFill
            }
            AdLoadResult.Failed -> {
                closeQuietly(sessionId, "load_failed")
                return RewardedWatchResult.Unavailable
            }
            AdLoadResult.ConsentUnavailable -> {
                closeQuietly(sessionId, "cancelled")
                return RewardedWatchResult.Unavailable
            }
        }
        try {
            client.start(sessionId)
        } catch (error: Throwable) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            // 띄우지 않는다. 거절(만료·자격 변경)이면 서버가 이미 풀었지만, 연결이 끊겼거나 5xx 면 시작이 들어갔는지
            // 모른다 — 남겨 두면 10~15분 잠기고, 시작이 들어갔다면 결과 불명으로 월 자리까지 잡는다. 닫아서 푼다(코덱스 #959).
            closeQuietly(sessionId, "show_failed")
            return RewardedWatchResult.Refused(errorCode(error))
        }
        val outcome = show(ad)
        closeQuietly(
            sessionId,
            when (outcome) {
                RewardedAdOutcome.EARNED -> "earned"
                RewardedAdOutcome.DISMISSED -> "dismissed"
                RewardedAdOutcome.SHOW_FAILED -> "show_failed"
            },
        )
        return when (outcome) {
            RewardedAdOutcome.EARNED -> RewardedWatchResult.Earned
            RewardedAdOutcome.DISMISSED -> RewardedWatchResult.Dismissed
            RewardedAdOutcome.SHOW_FAILED -> RewardedWatchResult.Unavailable
        }
    }

    private suspend fun closeQuietly(sessionId: String, outcome: String) {
        try {
            client.close(sessionId, outcome)
        } catch (error: Throwable) {
            if (error is kotlinx.coroutines.CancellationException) throw error
        }
    }
}
