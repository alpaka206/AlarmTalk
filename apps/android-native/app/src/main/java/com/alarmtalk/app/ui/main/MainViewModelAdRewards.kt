package com.alarmtalk.app

import com.alarmtalk.app.ads.AdRewardSessionClient
import com.alarmtalk.app.network.AdRewardSessionCloseRequest
import com.alarmtalk.app.network.AdRewardSessionCreateRequest
import com.alarmtalk.app.network.AdRewardSessionResponse
import com.alarmtalk.app.network.AlarmTalkApiClient

/**
 * 광고 시청 승인 세션을 서버에 묻는 창구(`docs/spec/ad-rewards.md` §3). 편집기의 '광고 보고 한 번 쓰기' 가
 * `RewardedAdFlow` 로 쓴다.
 *
 * 세션 토큰은 **부를 때마다** 읽는다 — 백그라운드 갱신(rolling refresh)으로 바뀐 토큰을 쓰게. 로그아웃 상태면 던진다
 * (편집기는 로그인 없이는 광고를 권하지 않는다 — 무료 판정이 서버 응답에서 온다).
 */
internal fun MainViewModel.adRewardSessionClient(): AdRewardSessionClient = object : AdRewardSessionClient {
    private fun bearer(): String =
        AlarmTalkApiClient.bearer(authSession?.token ?: throw IllegalStateException("signed out"))

    override suspend fun prepare(adUnit: String): AdRewardSessionResponse =
        api.createAdRewardSession(bearer(), AdRewardSessionCreateRequest(platform = "android", adUnit = adUnit))

    override suspend fun start(sessionId: String): AdRewardSessionResponse =
        api.startAdRewardSession(bearer(), sessionId)

    override suspend fun close(sessionId: String, outcome: String) {
        api.closeAdRewardSession(bearer(), sessionId, AdRewardSessionCloseRequest(outcome))
    }
}
