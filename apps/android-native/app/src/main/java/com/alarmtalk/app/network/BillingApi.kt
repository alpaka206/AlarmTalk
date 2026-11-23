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
    /** 결제 전 조회에서 구독과 같은 DB 스냅샷으로 받은 `users.plan` — 저장된 값 그대로다(계산값이 아니다). */
    @SerializedName("user_plan") val userPlan: String? = null,
)

data class BillingSubscription(
    val id: String,
    val status: String,
    @SerializedName("expires_at") val expiresAt: String,
    @SerializedName("cancel_at_period_end") val cancelAtPeriodEnd: Boolean = false,
    /**
     * 해지가 어느 스토어를 거쳐야 하는가 — `apple`·`google`, 스토어 결제가 아니면 null(서버 `storeCancelProviderOf`, 해지
     * 라우트와 같은 판정이다). `apple` 이면 서버도 앱도 그 구독을 끊을 수 없다 — 해지 버튼은 해지 시점을 묻지 않고 아이폰의
     * App Store 구독에서 해지하라고 말한다(2026-11-22 두 앱 통일 — iOS 는 같은 값으로 App Store 관리 시트를 연다).
     * 구버전 서버는 주지 않는다(null) — 예전처럼 해지를 보내고, 거절(`STORE_CANCEL_UNSUPPORTED`)되면 같은 안내를 띄운다.
     */
    @SerializedName("store_provider") val storeProvider: String? = null,
)

data class BillingPlan(
    val id: String,
    val key: String,
    val name: String,
    @SerializedName("plan_type") val planType: String,
)

data class BillingPlanSummary(
    val id: String,
    val key: String,
    val name: String,
    @SerializedName("plan_type") val planType: String,
)

/** Google Play 구매를 서버에 전달해 검증·acknowledge·구독 반영을 요청하는 페이로드. */
data class GooglePlayConfirmRequest(
    @SerializedName("purchase_token") val purchaseToken: String,
    @SerializedName("product_id") val productId: String,
    @SerializedName("package_name") val packageName: String,
)

data class GooglePlayConfirmResponse(
    val success: Boolean,
    val subscription: BillingSubscription? = null,
)

data class CancelSubscriptionRequest(
    val mode: String, // "immediate" | "at_period_end"
)

data class CancelSubscriptionResponse(
    val success: Boolean,
    val mode: String,
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

    /** Google Play 구매 토큰 서버 검증. 서버가 Play Developer API 로 검증·acknowledge 한다. */
    @POST("billing/google/confirm")
    suspend fun confirmGooglePurchase(
        @Header("Authorization") authorization: String,
        @Body request: GooglePlayConfirmRequest,
    ): GooglePlayConfirmResponse

    @POST("billing/cancel")
    suspend fun cancelSubscription(
        @Header("Authorization") authorization: String,
        @Body request: CancelSubscriptionRequest,
    ): CancelSubscriptionResponse

}
