package com.alarmtalk.app.network

import com.google.gson.annotations.SerializedName
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST

data class BillingSubscriptionResponse(
    val subscription: BillingSubscription?,
    val plan: BillingPlan?,
    @SerializedName("next_plan") val nextPlan: BillingPlanSummary? = null,
)

data class BillingSubscription(
    val id: String,
    @SerializedName("plan_id") val planId: String,
    @SerializedName("plan_group_id") val planGroupId: String? = null,
    val status: String,
    @SerializedName("starts_at") val startsAt: String,
    @SerializedName("expires_at") val expiresAt: String,
    @SerializedName("cancel_at_period_end") val cancelAtPeriodEnd: Boolean = false,
    @SerializedName("canceled_at") val canceledAt: String? = null,
    @SerializedName("next_plan_id") val nextPlanId: String? = null,
)

data class BillingPlan(
    val id: String,
    val key: String,
    val name: String,
    @SerializedName("plan_type") val planType: String,
    @SerializedName("period_days") val periodDays: Int,
    @SerializedName("max_members") val maxMembers: Int,
    @SerializedName("price_krw") val priceKrw: Int,
)

data class BillingPlanSummary(
    val id: String,
    val key: String,
    val name: String,
    @SerializedName("plan_type") val planType: String,
)

data class VoucherListResponse(
    val vouchers: List<VoucherItem>,
)

data class VoucherItem(
    val id: String,
    val code: String,
    @SerializedName("plan_key") val planKey: String? = null,
    @SerializedName("plan_name") val planName: String,
    @SerializedName("plan_type") val planType: String,
    val status: String,
    @SerializedName("issued_at") val issuedAt: String? = null,
    @SerializedName("expires_at") val expiresAt: String,
    @SerializedName("max_uses") val maxUses: Int = 1,
    @SerializedName("use_count") val useCount: Int = 0,
)

data class CheckoutRequest(
    @SerializedName("plan_key") val planKey: String,
    val gift: Boolean = false,
)

data class CheckoutResponse(
    val success: Boolean,
    @SerializedName("checkout_stub") val checkoutStub: Boolean = false,
    val subscription: BillingSubscription?,
    val plan: BillingPlan,
    val voucher: CheckoutVoucher? = null,
)

data class CheckoutVoucher(
    val id: String,
    val code: String,
    @SerializedName("expires_at") val expiresAt: String,
    @SerializedName("max_uses") val maxUses: Int = 1,
    @SerializedName("use_count") val useCount: Int = 0,
)

data class EnsureFamilyShareCodeResponse(
    val success: Boolean,
    val voucher: VoucherItem,
)

/** Google Play 구매를 서버에 전달해 검증·acknowledge·구독 반영을 요청하는 페이로드. */
data class GooglePlayConfirmRequest(
    @SerializedName("purchase_token") val purchaseToken: String,
    @SerializedName("product_id") val productId: String,
    @SerializedName("package_name") val packageName: String,
)

data class GooglePlayConfirmResponse(
    val success: Boolean,
    @SerializedName("plan_key") val planKey: String? = null,
    val subscription: BillingSubscription? = null,
)

data class CancelSubscriptionRequest(
    val mode: String, // "immediate" | "at_period_end"
)

data class CancelSubscriptionResponse(
    val success: Boolean,
    val mode: String,
    @SerializedName("subscription_id") val subscriptionId: String? = null,
    // immediate 해지 성공 시에만 내려온다 — 유료 음성 데이터 30일 보관 만료 시점(ISO).
    @SerializedName("voice_retention_until") val voiceRetentionUntil: String? = null,
)

data class VoiceDataDeleteNowResponse(
    val success: Boolean = false,
)

data class ChangePlanRequest(
    @SerializedName("plan_key") val planKey: String,
    val mode: String, // "immediate" | "at_period_end"
)

data class ChangePlanResponse(
    val success: Boolean,
    val mode: String,
    @SerializedName("subscription_id") val subscriptionId: String? = null,
    @SerializedName("requires_checkout") val requiresCheckout: Boolean = false,
    @SerializedName("plan_key") val planKey: String? = null,
    @SerializedName("next_plan_key") val nextPlanKey: String? = null,
)

interface BillingApi {
    @GET("billing/subscription")
    suspend fun getSubscription(@Header("Authorization") authorization: String): BillingSubscriptionResponse

    @GET("billing/vouchers")
    suspend fun listVouchers(@Header("Authorization") authorization: String): VoucherListResponse

    @POST("billing/checkout")
    suspend fun checkoutPlan(
        @Header("Authorization") authorization: String,
        @Body request: CheckoutRequest,
    ): CheckoutResponse

    /** Google Play 구매 토큰 서버 검증. 서버가 Play Developer API 로 검증·acknowledge 한다. */
    @POST("billing/google/confirm")
    suspend fun confirmGooglePurchase(
        @Header("Authorization") authorization: String,
        @Body request: GooglePlayConfirmRequest,
    ): GooglePlayConfirmResponse

    @POST("billing/vouchers/family-share")
    suspend fun ensureFamilyShareCode(
        @Header("Authorization") authorization: String,
    ): EnsureFamilyShareCodeResponse

    /** 기존 공유 코드를 무효화하고 새 코드를 발급한다(유출 의심 시 재발급). */
    @POST("billing/vouchers/family-share/regenerate")
    suspend fun regenerateFamilyShareCode(
        @Header("Authorization") authorization: String,
    ): EnsureFamilyShareCodeResponse

    @POST("billing/cancel")
    suspend fun cancelSubscription(
        @Header("Authorization") authorization: String,
        @Body request: CancelSubscriptionRequest,
    ): CancelSubscriptionResponse

    /** 보관 중인 유료 음성 데이터 즉시 삭제. 활성 유료 구독이 있으면 409 SUBSCRIPTION_STILL_ACTIVE. */
    @POST("billing/voice-data/delete-now")
    suspend fun deleteVoiceDataNow(
        @Header("Authorization") authorization: String,
    ): VoiceDataDeleteNowResponse

    @POST("billing/change-plan")
    suspend fun changePlan(
        @Header("Authorization") authorization: String,
        @Body request: ChangePlanRequest,
    ): ChangePlanResponse
}
