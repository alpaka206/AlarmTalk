package com.alarmtalk.app.billing

import android.app.Activity
import android.content.Context
import android.util.Log
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.android.billingclient.api.queryProductDetails
import com.android.billingclient.api.queryPurchasesAsync
import kotlin.coroutines.resume
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.suspendCancellableCoroutine

/** Play Console 에 등록된 구독 상품 ID 모음. */
object PlayBillingProducts {
    const val PERSONAL_MONTHLY = "personal_monthly"
    const val PERSONAL_YEARLY = "personal_yearly"
    const val COUPLE_MONTHLY = "couple_monthly"
    const val COUPLE_YEARLY = "couple_yearly"
    const val FAMILY_MONTHLY = "family_monthly"
    const val FAMILY_YEARLY = "family_yearly"

    val all: List<String> = listOf(
        PERSONAL_MONTHLY,
        PERSONAL_YEARLY,
        COUPLE_MONTHLY,
        COUPLE_YEARLY,
        FAMILY_MONTHLY,
        FAMILY_YEARLY,
    )

    /** 이용권 plan key("personal"/"couple"/"family") + 결제 주기 → Play 상품 ID. */
    fun productIdFor(planKey: String, yearly: Boolean): String? {
        if (planKey !in setOf("personal", "couple", "family")) return null
        return if (yearly) "${planKey}_yearly" else "${planKey}_monthly"
    }
}

/**
 * Google Play Billing 연동 매니저.
 *
 * - BillingClient 연결/재연결, 구독 상품 조회, 결제 플로우 실행을 담당한다.
 * - 구매 완료(PURCHASED) 콜백을 받으면 [Listener.onPurchaseReady] 로 넘긴다.
 *   서버가 Play Developer API 로 검증·acknowledge 하므로 클라이언트는
 *   acknowledgePurchase 를 직접 호출하지 않는다.
 * - 앱 시작 시 [resendUnconfirmedPurchases] 로 아직 서버 검증(acknowledge)이
 *   끝나지 않은 구매를 다시 흘려보내 유실을 막는다.
 */
class PlayBillingManager(
    context: Context,
    private val listener: Listener,
) : PurchasesUpdatedListener {

    interface Listener {
        /** PURCHASED 상태 구매 도착. 백엔드 검증(/billing/google/confirm)은 호출자 책임. */
        fun onPurchaseReady(purchaseToken: String, productId: String)

        /** 결제 수단 승인 대기 등 보류(PENDING) 상태 구매. 승인되면 다시 onPurchaseReady 로 들어온다. */
        fun onPurchasePending(productId: String)

        /** 결제 실패/취소. [userMessage] 가 null 이면 사용자 취소(별도 안내 불필요). */
        fun onPurchaseFailed(userMessage: String?)
    }

    private val billingClient: BillingClient = BillingClient.newBuilder(context.applicationContext)
        .setListener(this)
        .enablePendingPurchases(
            PendingPurchasesParams.newBuilder().enableOneTimeProducts().build(),
        )
        .build()

    private val connectionMutex = Mutex()

    /** 연결을 보장한다. 이미 연결돼 있으면 즉시 true. */
    private suspend fun ensureConnected(): Boolean = connectionMutex.withLock {
        if (billingClient.isReady) return true
        suspendCancellableCoroutine { continuation ->
            billingClient.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(billingResult: BillingResult) {
                    if (continuation.isActive) {
                        continuation.resume(billingResult.responseCode == BillingClient.BillingResponseCode.OK)
                    }
                }

                override fun onBillingServiceDisconnected() {
                    // 다음 호출의 ensureConnected 에서 재연결을 시도한다.
                    Log.w(TAG, "Play billing service disconnected")
                }
            })
        }
    }

    /** 구독 상품 정보를 조회한다. 연결 실패 시 빈 목록. */
    suspend fun queryProductDetails(
        productIds: List<String> = PlayBillingProducts.all,
    ): List<ProductDetails> {
        if (!ensureConnected()) return emptyList()
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(
                productIds.map { productId ->
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(productId)
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build()
                },
            )
            .build()
        val result = billingClient.queryProductDetails(params)
        if (result.billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
            Log.w(
                TAG,
                "queryProductDetails failed code=${result.billingResult.responseCode} message=${result.billingResult.debugMessage}",
            )
            return emptyList()
        }
        return result.productDetailsList.orEmpty()
    }

    /**
     * 결제 시트를 띄운다. 결과(성공/보류/취소)는 [PurchasesUpdatedListener] 로 비동기 전달된다.
     *
     * @return 결제 플로우 실행에 성공했으면 true. false 면 시트 자체가 뜨지 않은 것.
     */
    suspend fun launchPurchase(activity: Activity, productId: String): Boolean {
        val productDetails = queryProductDetails(listOf(productId)).firstOrNull() ?: run {
            Log.w(TAG, "Play product not found productId=$productId")
            return false
        }
        val offerToken = productDetails.subscriptionOfferDetails?.firstOrNull()?.offerToken ?: run {
            Log.w(TAG, "Play subscription offer not found productId=$productId")
            return false
        }
        val flowParams = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(
                listOf(
                    BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(productDetails)
                        .setOfferToken(offerToken)
                        .build(),
                ),
            )
            .build()
        val result = billingClient.launchBillingFlow(activity, flowParams)
        if (result.responseCode != BillingClient.BillingResponseCode.OK) {
            Log.w(TAG, "launchBillingFlow failed code=${result.responseCode} message=${result.debugMessage}")
            return false
        }
        return true
    }

    /**
     * 앱 시작 시 호출: 결제는 됐지만 아직 서버 검증(acknowledge)이 끝나지 않은 구매를
     * 다시 [Listener.onPurchaseReady] 로 흘려 재전송한다. (결제 직후 앱 종료/네트워크 실패 대비)
     */
    suspend fun resendUnconfirmedPurchases() {
        if (!ensureConnected()) return
        val result = billingClient.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.SUBS)
                .build(),
        )
        if (result.billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
            Log.w(TAG, "queryPurchasesAsync failed code=${result.billingResult.responseCode}")
            return
        }
        result.purchasesList
            .filter { it.purchaseState == Purchase.PurchaseState.PURCHASED && !it.isAcknowledged }
            .forEach { purchase ->
                val productId = purchase.products.firstOrNull() ?: return@forEach
                Log.i(TAG, "Resending unconfirmed Play purchase productId=$productId")
                listener.onPurchaseReady(purchase.purchaseToken, productId)
            }
    }

    override fun onPurchasesUpdated(billingResult: BillingResult, purchases: List<Purchase>?) {
        when (billingResult.responseCode) {
            BillingClient.BillingResponseCode.OK -> {
                purchases.orEmpty().forEach { purchase ->
                    val productId = purchase.products.firstOrNull() ?: return@forEach
                    when (purchase.purchaseState) {
                        Purchase.PurchaseState.PURCHASED ->
                            listener.onPurchaseReady(purchase.purchaseToken, productId)

                        Purchase.PurchaseState.PENDING ->
                            listener.onPurchasePending(productId)

                        else ->
                            Log.w(TAG, "Ignoring purchase state=${purchase.purchaseState} productId=$productId")
                    }
                }
            }

            BillingClient.BillingResponseCode.USER_CANCELED ->
                listener.onPurchaseFailed(null)

            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED ->
                listener.onPurchaseFailed("이미 구독 중인 상품이에요. 잠시 후 구독 상태를 새로고침해 주세요.")

            else -> {
                Log.w(
                    TAG,
                    "Play purchase failed code=${billingResult.responseCode} message=${billingResult.debugMessage}",
                )
                listener.onPurchaseFailed("Google Play 결제에 실패했어요. 잠시 후 다시 시도해 주세요.")
            }
        }
    }

    /** 더 이상 사용하지 않을 때 연결을 정리한다. */
    fun release() {
        runCatching { billingClient.endConnection() }
    }
}
