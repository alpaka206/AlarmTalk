package com.alarmtalk.app

import com.alarmtalk.app.ads.AdLoadResult
import com.alarmtalk.app.ads.AdRewardSessionClient
import com.alarmtalk.app.ads.RewardedAdFlow
import com.alarmtalk.app.ads.RewardedAdOutcome
import com.alarmtalk.app.ads.RewardedWatchResult
import com.alarmtalk.app.network.AdRewardSession
import com.alarmtalk.app.network.AdRewardSessionResponse
import com.alarmtalk.app.network.AdRewardSsvOptions
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 광고 한 번의 순서(`docs/spec/ad-rewards.md` §3 「흐름」) — 세션 발급 → 불러오기 → **표시 직전** 시작 승인 → 표시 → 끝 알림.
 * 서버와 SDK 는 가짜다. 지키는 것: 못 불러오면 시작 승인을 받지 않고 끝을 알린다, 시작이 거절되면 띄우지 않는다, SSV 옵션은
 * 서버가 준 값 그대로다, 끝 알림이 실패해도 결과는 그대로다.
 */
class RewardedAdFlowTest {
    private class FakeClient(
        var prepareError: Throwable? = null,
        var startError: Throwable? = null,
        var closeError: Throwable? = null,
    ) : AdRewardSessionClient {
        val calls = mutableListOf<String>()
        override suspend fun prepare(adUnit: String): AdRewardSessionResponse {
            calls += "prepare:$adUnit"
            prepareError?.let { throw it }
            return AdRewardSessionResponse(
                session = AdRewardSession(id = "s-1", status = "prepared"),
                ssv = AdRewardSsvOptions(userId = "pk-1", customData = "s-1"),
            )
        }
        override suspend fun start(sessionId: String): AdRewardSessionResponse {
            calls += "start:$sessionId"
            startError?.let { throw it }
            return AdRewardSessionResponse(session = AdRewardSession(id = sessionId, status = "started"))
        }
        override suspend fun close(sessionId: String, outcome: String) {
            calls += "close:$outcome"
            closeError?.let { throw it }
        }
    }

    private class Refusal(val code: String) : RuntimeException(code)

    private fun flow(
        client: FakeClient,
        load: AdLoadResult<String> = AdLoadResult.Loaded("ad"),
        outcome: RewardedAdOutcome = RewardedAdOutcome.EARNED,
        events: MutableList<String> = client.calls,
    ) = RewardedAdFlow(
        client = client,
        adUnit = "ca-app-pub-1/123",
        load = { userId, customData ->
            events += "load:$userId:$customData"
            load
        },
        show = { ad ->
            events += "show:$ad"
            outcome
        },
        errorCode = { (it as? Refusal)?.code },
    )

    @Test
    fun `끝까지 보면 발급·불러오기·시작·표시·earned 순서다 — SSV 옵션은 서버 값 그대로`() = runTest {
        val client = FakeClient()
        assertEquals(RewardedWatchResult.Earned, flow(client).watch())
        assertEquals(
            listOf("prepare:ca-app-pub-1/123", "load:pk-1:s-1", "start:s-1", "show:ad", "close:earned"),
            client.calls,
        )
    }

    @Test
    fun `재고 없음이면 시작 승인 없이 no_fill 로 알린다`() = runTest {
        val client = FakeClient()
        assertEquals(RewardedWatchResult.NoFill, flow(client, load = AdLoadResult.NoFill).watch())
        assertEquals(listOf("prepare:ca-app-pub-1/123", "load:pk-1:s-1", "close:no_fill"), client.calls)
    }

    @Test
    fun `로딩 실패·동의 불가도 시작 승인 없이 끝을 알린다`() = runTest {
        val failed = FakeClient()
        assertEquals(RewardedWatchResult.Unavailable, flow(failed, load = AdLoadResult.Failed).watch())
        assertEquals("close:load_failed", failed.calls.last())
        val consent = FakeClient()
        assertEquals(RewardedWatchResult.Unavailable, flow(consent, load = AdLoadResult.ConsentUnavailable).watch())
        assertEquals("close:cancelled", consent.calls.last())
    }

    @Test
    fun `중도에 닫으면 dismissed 로 알리고 실패로 말하지 않는다`() = runTest {
        val client = FakeClient()
        assertEquals(RewardedWatchResult.Dismissed, flow(client, outcome = RewardedAdOutcome.DISMISSED).watch())
        assertEquals("close:dismissed", client.calls.last())
    }

    @Test
    fun `발급이 거절되면(다른 기기·이번 달 상한) 광고를 불러오지 않는다`() = runTest {
        val client = FakeClient(prepareError = Refusal("AD_REWARD_SESSION_OPEN"))
        assertEquals(RewardedWatchResult.Refused("AD_REWARD_SESSION_OPEN"), flow(client).watch())
        assertEquals(listOf("prepare:ca-app-pub-1/123"), client.calls)
    }

    @Test
    fun `시작 승인이 거절되면 띄우지 않는다`() = runTest {
        val client = FakeClient(startError = Refusal("AD_REWARD_SESSION_INVALID"))
        assertEquals(RewardedWatchResult.Refused("AD_REWARD_SESSION_INVALID"), flow(client).watch())
        assertEquals(false, client.calls.any { it.startsWith("show") })
        // 시작이 들어갔는지 모르는 실패(연결 끊김·5xx)도 있다 — 닫아서 잠금과 월 자리를 푼다(코덱스 #959).
        assertEquals("close:show_failed", client.calls.last())
    }

    @Test
    fun `끝 알림이 실패해도 결과는 그대로다 — 서버는 늦은 확인 콜백을 받는다`() = runTest {
        val client = FakeClient(closeError = RuntimeException("offline"))
        assertEquals(RewardedWatchResult.Earned, flow(client).watch())
    }
}
