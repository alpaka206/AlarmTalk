package com.voicealarm.nativeapp.network

import com.google.gson.annotations.SerializedName
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST

data class BillingSubscriptionResponse(
    val subscription: BillingSubscription?,
    val plan: BillingPlan?,
)

data class BillingSubscription(
    val id: String,
    @SerializedName("plan_id") val planId: String,
    @SerializedName("plan_group_id") val planGroupId: String? = null,
    val status: String,
    @SerializedName("starts_at") val startsAt: String,
    @SerializedName("expires_at") val expiresAt: String,
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
    @SerializedName("expires_at") val expiresAt: String,
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
}
