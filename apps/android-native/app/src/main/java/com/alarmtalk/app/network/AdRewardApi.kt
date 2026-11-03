package com.alarmtalk.app.network

import com.google.gson.annotations.SerializedName
import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path

/**
 * 광고 시청 승인 세션(`docs/spec/ad-rewards.md` §3). 광고를 띄우기 전에 서버가 승인 id 를 주고 이번 달 자리 하나를 잡는다.
 *
 * ⚠ **이 요청들은 보상을 주지 않는다.** 적립은 AdMob 서버가 우리 서버로 보내는 서명된 확인(SSV)으로만 한다 — 앱이
 * `earned` 를 보내는 것은 서버가 기다릴 상태를 정하게 할 뿐이다. iOS `AlarmTalkAPI.createAdRewardSession` 과 짝이다.
 */
data class AdRewardSessionCreateRequest(
    val platform: String = "android",
    @SerializedName("ad_unit") val adUnit: String,
)

data class AdRewardSessionCloseRequest(val outcome: String)

data class AdRewardSession(
    val id: String = "",
    val status: String = "",
    val granted: Boolean = false,
)

/** 광고의 `ServerSideVerificationOptions` 에 그대로 싣는 두 값. */
data class AdRewardSsvOptions(
    /** 계정 PK — 로그인 식별자(구글 sub)와 다를 수 있어 서버가 준다. */
    @SerializedName("user_id") val userId: String = "",
    /** 승인 id. 서버는 콜백의 이 값으로 세션을 찾아 승인 하나에 보상 한 번만 적립한다. */
    @SerializedName("custom_data") val customData: String = "",
)

data class AdRewardSessionResponse(
    val session: AdRewardSession = AdRewardSession(),
    val ssv: AdRewardSsvOptions? = null,
)

interface AdRewardApi {
    @POST("ad-rewards/sessions")
    suspend fun createAdRewardSession(
        @Header("Authorization") authorization: String,
        @Body body: AdRewardSessionCreateRequest,
    ): AdRewardSessionResponse

    @POST("ad-rewards/sessions/{id}/start")
    suspend fun startAdRewardSession(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
    ): AdRewardSessionResponse

    @POST("ad-rewards/sessions/{id}/close")
    suspend fun closeAdRewardSession(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
        @Body body: AdRewardSessionCloseRequest,
    ): AdRewardSessionResponse
}
