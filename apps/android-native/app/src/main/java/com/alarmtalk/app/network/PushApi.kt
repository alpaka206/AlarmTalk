package com.alarmtalk.app.network

import com.google.gson.annotations.SerializedName
import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST

data class PushTokenRegisterRequest(
    @SerializedName("token") val token: String,
    @SerializedName("platform") val platform: String = "android",
)

data class PushTokenRegisterResponse(
    @SerializedName("success") val success: Boolean = false,
)

interface PushApi {
    // FCM 등록 토큰을 서버에 저장(가족 알람 push 대상). 로그인·앱 시작·토큰 회전 시 호출.
    @POST("push/register")
    suspend fun registerPushToken(
        @Header("Authorization") authorization: String,
        @Body body: PushTokenRegisterRequest,
    ): PushTokenRegisterResponse
}
