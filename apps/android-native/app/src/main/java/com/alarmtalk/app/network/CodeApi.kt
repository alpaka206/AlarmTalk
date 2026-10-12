package com.alarmtalk.app.network

import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST

data class CodeRegisterRequest(
    val code: String,
)

/**
 * 코드 등록(POST /api/code/register) 응답. 받는 코드는 선물·초대 이용권(GIFT-/INV-)뿐이고
 * 지금 서버는 둘 다 type 'voucher' 로 답한다('invite'·'group_invite' 는 옛 서버 값이다). 프로모 코드는
 * 2026-10-12 에 없앴다. plan 이 함께 오면 공유패스(커플/가족) 여부로 내비게이션을 분기한다.
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
