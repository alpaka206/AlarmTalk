package com.alarmtalk.app.network

import com.google.gson.annotations.SerializedName
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Query
import retrofit2.http.Header
import retrofit2.http.POST

data class BillingSubscriptionResponse(
    val subscription: BillingSubscription?,
    val plan: BillingPlan?,
    @SerializedName("next_plan") val nextPlan: BillingPlanSummary? = null,
    /**
     * 지금 이 계정의 **갱신을 쥔 스토어 전부** — `["apple"]`, `["google"]`, 둘 다, 또는 빈 배열.
     *
     * ⚠ **[subscription] 으로 대신하지 말 것**(코덱스 #730 4차). 보류(`ON_HOLD`/`PAUSED`)는
     * 구독 행을 살려 두고 `users.plan` 만 회수하는데, 그 행은 `expires_at` 이 지나 응답에서
     * 빠진다 — 그런데 결제가 복구되면 스토어는 다시 청구한다. 그래서 신호가 **최상위**에 있고
     * 만료로 거르지 않는다.
     *
     * 구버전 서버는 이 필드를 주지 않는다(null) — 그때는 막지 않는다(예전 동작).
     */
    @SerializedName("store_renewal_providers") val storeRenewalProviders: List<String>? = null,
    /** 결제 전 조회에서 구독과 같은 DB 스냅샷으로 받은 users.plan. */
    @SerializedName("user_plan") val userPlan: String? = null,
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



interface BillingApi {
    /**
     * @param refreshStore `"1"` 이면 서버가 **애플에 직접 물어** 갱신 상태를 최신화한 뒤
     *   답한다. ⚠ **결제 직전에만 켠다** — 애플 서버 호출이 붙어서, 앱 시작 갱신이나
     *   워커가 켜면 애플이 느릴 때 **DB 에 이미 있는 답까지 같이 늦어진다.**
     */
    @GET("billing/subscription")
    suspend fun getSubscription(
        @Header("Authorization") authorization: String,
        @Query("refresh_store") refreshStore: String? = null,
    ): BillingSubscriptionResponse

    @GET("billing/vouchers")
    suspend fun listVouchers(@Header("Authorization") authorization: String): VoucherListResponse

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

}
