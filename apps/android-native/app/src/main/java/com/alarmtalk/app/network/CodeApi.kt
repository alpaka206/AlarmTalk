package com.alarmtalk.app.network

import com.google.gson.annotations.SerializedName
import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST

data class CodeRegisterRequest(
    val code: String,
)

data class CodeRegisterResponse(
    val success: Boolean,
    val type: String? = null,
)

data class PromoRedeemRequest(
    val code: String,
)

/**
 * 공용 프로모 코드 사용(POST /api/billing/promo/redeem) 응답.
 *
 * 성공 시 서버가 새 구독/플랜과 사용된 프로모 정보를 함께 돌려준다. 구독 상태는 성공 후
 * 서버 기준으로 재조회(refreshBillingAfterMutation)하므로, 클라에서는 성공 여부와 플랜
 * 종류(홈/공유패스 내비게이션 분기)만 사용한다. subscription/promo 필드는 계약 보존용.
 */
data class PromoRedeemResponse(
    val success: Boolean,
    val type: String? = null,
    val subscription: BillingSubscription? = null,
    val plan: BillingPlanSummary? = null,
    val promo: PromoRedeemInfo? = null,
)

data class PromoRedeemInfo(
    val id: String,
    val code: String,
    @SerializedName("duration_days") val durationDays: Int? = null,
)

interface CodeApi {
    @POST("code/register")
    suspend fun registerCode(
        @Header("Authorization") authorization: String,
        @Body request: CodeRegisterRequest,
    ): CodeRegisterResponse

    /** 공용 프로모 코드 사용. 발급자가 있는 바우처(개인/초대)와 달리 누구나 쓰는 공용 코드다. */
    @POST("billing/promo/redeem")
    suspend fun redeemPromoCode(
        @Header("Authorization") authorization: String,
        @Body request: PromoRedeemRequest,
    ): PromoRedeemResponse
}
