package com.alarmtalk.app.network

import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST

data class CodeRegisterRequest(
    val code: String,
)

/**
 * 코드 등록(POST /api/code/register) 응답. 받는 코드는 커플·가족 이용권의 초대 코드(INV-)뿐이고
 * 지금 서버는 type 'voucher' 로 답한다('invite'·'group_invite' 는 옛 서버 값이다). plan 이 함께 오면
 * 공유패스(커플/가족) 여부로 내비게이션을 분기한다.
 *
 * 프로모 코드는 2026-10-12 에, 선물 코드(GIFT-)는 2026-10-14 에 없앴다(App Store 지침 3.1.1 — 두 번째
 * 반려가 "선물 코드로 디지털 기능을 연다" 였다). 서버는 INV- 형식이 아니면 조회 없이 `CODE_NOT_FOUND` 다.
 * ⚠ 선물 코드를 되살리지 말 것 — 할인·무료 이용은 스토어 오퍼 코드로 준다.
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
