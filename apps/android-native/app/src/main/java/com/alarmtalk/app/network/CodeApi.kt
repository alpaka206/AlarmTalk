package com.alarmtalk.app.network

import com.google.gson.annotations.SerializedName
import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST

data class CodeRegisterRequest(
    val code: String,
)

/**
 * 통합 코드 등록(POST /api/code/register) 응답. 서버가 코드 종류를 판별해
 * type('invite'|'gift'|'group_invite'|'promo')을 돌려준다. 프로모/이용권 성공 시
 * plan 이 함께 오면 공유패스(커플/가족) 여부로 내비게이션을 분기한다.
 */
data class CodeRegisterResponse(
    val success: Boolean,
    val type: String? = null,
    val plan: BillingPlanSummary? = null,
)

interface CodeApi {
    @POST("code/register")
    suspend fun registerCode(
        @Header("Authorization") authorization: String,
        @Body request: CodeRegisterRequest,
    ): CodeRegisterResponse
}
