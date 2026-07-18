package com.alarmtalk.app.billing

import android.app.Activity
import android.content.Context
import android.util.Log
import com.alarmtalk.app.R
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
import java.security.MessageDigest
import java.util.Locale
import kotlin.coroutines.resume
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout

/** Play Console 에 등록된 구독 상품 ID 모음 (월간만 판매). */
object PlayBillingProducts {
    const val PERSONAL_MONTHLY = "personal_monthly"
    const val COUPLE_MONTHLY = "couple_monthly"
    const val FAMILY_MONTHLY = "family_monthly"

    val all: List<String> = listOf(
        PERSONAL_MONTHLY,
        COUPLE_MONTHLY,
        FAMILY_MONTHLY,
    )

    /** 이용권 plan key("personal"/"couple"/"family") → Play 상품 ID. */
    fun productIdFor(planKey: String): String? {
        if (planKey !in setOf("personal", "couple", "family")) return null
        return "${planKey}_monthly"
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

    private val appContext: Context = context.applicationContext

    private val billingClient: BillingClient = BillingClient.newBuilder(context.applicationContext)
        .setListener(this)
        .enablePendingPurchases(
            PendingPurchasesParams.newBuilder().enableOneTimeProducts().build(),
        )
        .build()

    private val connectionMutex = Mutex()

    /** ITEM_ALREADY_OWNED 복구처럼 콜백(비-suspend)에서 suspend 조회를 돌릴 때 쓰는 스코프. */
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    /** 앱 시작 시 미리 받아두는 상품 정보 — 구매 시트가 추가 네트워크 없이 바로 뜨게 한다. */
    private val productDetailsCache = mutableMapOf<String, ProductDetails>()

    /** 연결을 보장한다. 이미 연결돼 있으면 즉시 true. */
    private suspend fun ensureConnected(): Boolean = connectionMutex.withLock {
        if (billingClient.isReady) return true
        // 콜백이 전혀 오지 않는 극단 케이스에도 mutex 가 영구 점유되지 않도록 타임아웃으로 감싼다.
        try {
            withTimeout(CONNECT_TIMEOUT_MS) {
                suspendCancellableCoroutine { continuation ->
                    billingClient.startConnection(object : BillingClientStateListener {
                        override fun onBillingSetupFinished(billingResult: BillingResult) {
                            if (continuation.isActive) {
                                continuation.resume(billingResult.responseCode == BillingClient.BillingResponseCode.OK)
                            }
                        }

                        override fun onBillingServiceDisconnected() {
                            // 핸드셰이크 완료 전 서비스가 끊기면 continuation 을 재개해 mutex 를 풀어준다.
                            // (재개 안 됐을 때만; isActive 가드가 onBillingSetupFinished 후속 도착 시 이중 resume 을 막는다.)
                            // 다음 호출의 ensureConnected 에서 startConnection 을 재시도한다.
                            if (continuation.isActive) {
                                continuation.resume(false)
                            }
                            Log.w(TAG, "Play billing service disconnected")
                        }
                    })
                }
            }
        } catch (e: TimeoutCancellationException) {
            Log.w(TAG, "Play billing connect timed out")
            false
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
        return result.productDetailsList.orEmpty().also { list ->
            list.forEach { productDetailsCache[it.productId] = it }
        }
    }

    /** 앱 시작 시 호출: 연결 + 전체 구독 상품 정보를 캐시에 적재한다. 실패해도 무해. */
    suspend fun preloadProducts() {
        queryProductDetails()
    }

    /**
     * planKey 의 Play 실제 표시가격(ProductDetails.formattedPrice). 결제 국가/통화가 반영된
     * 권위 가격이다. 미로딩/미조회면 null → UI 는 문자열 리소스로 폴백한다.
     * (하드코딩 가격은 청구 통화·금액과 어긋나 Play 정책 위반 소지 → 실가격 표기 필수)
     *
     * 표시가는 '기본 구독가' = 무한 반복(INFINITE_RECURRING) 페이즈의 가격이다. 첫 페이즈를 쓰면
     * Play Console 에 무료체험/인트로 오퍼를 추가하는 순간 표시가가 '₩0/인트로가'로 깨진다 —
     * 어떤 오퍼든 페이즈 목록의 마지막은 기본 구독가로 끝나므로 무한 반복 페이즈(폴백: 마지막)를 쓴다.
     */
    fun formattedPriceForPlan(planKey: String): String? {
        val productId = PlayBillingProducts.productIdFor(planKey) ?: return null
        val phases = productDetailsCache[productId]
            ?.subscriptionOfferDetails?.firstOrNull()
            ?.pricingPhases?.pricingPhaseList
            ?: return null
        val basePhase = phases.lastOrNull {
            it.recurrenceMode == ProductDetails.RecurrenceMode.INFINITE_RECURRING
        } ?: phases.lastOrNull()
        return basePhase?.formattedPrice
    }

    /**
     * 결제 시트를 띄운다. 결과(성공/보류/취소)는 [PurchasesUpdatedListener] 로 비동기 전달된다.
     *
     * @param userId 로그인 세션 사용자 id(서버 users.id 와 동일한 값). 구매를 앱 계정에
     *   바인딩하기 위해 SHA-256 hex 로 obfuscatedAccountId 에 실린다. null/공백이면 생략
     *   (레거시 허용 — 서버도 부재 시 허용).
     * @return 결제 플로우 실행에 성공했으면 true. false 면 시트 자체가 뜨지 않은 것.
     */
    suspend fun launchPurchase(activity: Activity, productId: String, userId: String? = null): Boolean {
        val productDetails = productDetailsCache[productId]
            ?: queryProductDetails(listOf(productId)).firstOrNull()
            ?: run {
                Log.w(TAG, "Play product not found productId=$productId")
                return false
            }
        // Play 는 이 사용자가 '자격 있는' 오퍼만 돌려준다. 여러 개면(기본가 + 무료체험/인트로 오퍼)
        // 첫 페이즈 가격이 가장 싼 오퍼를 고른다 — 체험이 있으면 체험으로 시작하는 게 사용자에게 유리.
        // firstOrNull 은 임의 선택이라 체험이 있어도 기본가부터 청구될 수 있다.
        val offerToken = productDetails.subscriptionOfferDetails
            ?.minByOrNull { offer ->
                offer.pricingPhases.pricingPhaseList.firstOrNull()?.priceAmountMicros ?: Long.MAX_VALUE
            }
            ?.offerToken ?: run {
            Log.w(TAG, "Play subscription offer not found productId=$productId")
            return false
        }
        val flowParamsBuilder = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(
                listOf(
                    BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(productDetails)
                        .setOfferToken(offerToken)
                        .build(),
                ),
            )
        // 구매-계정 바인딩(서버와 공유하는 계약: SHA-256 hex 소문자 64자, 입력은 로그인 사용자 id).
        // 서버가 confirm/RTDN 검증 시 어느 계정의 구매인지 대조할 수 있게 한다.
        val accountHash = userId?.takeIf { it.isNotBlank() }?.let { sha256Hex(it) }
        if (accountHash != null) {
            flowParamsBuilder.setObfuscatedAccountId(accountHash)
        }
        // 다른 상품으로의 '전환' 구매면 기존 활성 구독을 교체 모드로 잇는다 — 교체 없이 사면
        // Play 구독이 나란히 2개 생겨 이중 결제가 된다. 같은 상품 재구매/기존 구매 없음이면 현행대로.
        // accountHash 가 없으면(비로그인 등) 교체 대상 계정 대조가 불가능하므로 교체 없이 신규 구매.
        findActiveSubscriptionToReplace(productId, accountHash)?.let { existing ->
            flowParamsBuilder.setSubscriptionUpdateParams(
                BillingFlowParams.SubscriptionUpdateParams.newBuilder()
                    .setOldPurchaseToken(existing.purchaseToken)
                    .setSubscriptionReplacementMode(
                        BillingFlowParams.SubscriptionUpdateParams.ReplacementMode.WITH_TIME_PRORATION,
                    )
                    .build(),
            )
        }
        val result = billingClient.launchBillingFlow(activity, flowParamsBuilder.build())
        if (result.responseCode != BillingClient.BillingResponseCode.OK) {
            Log.w(TAG, "launchBillingFlow failed code=${result.responseCode} message=${result.debugMessage}")
            return false
        }
        return true
    }

    /**
     * [productId] 로 전환할 때 교체 대상이 되는 기존 활성(PURCHASED) 구독 구매.
     * 같은 상품이거나 활성 구독이 없으면 null(교체 아님). 여러 개면(과거 이중 구독 잔재) 최신 구매.
     * 조회 실패 시에도 null — 결제 자체를 막지 않고 현행(신규 구매) 플로우로 진행한다.
     *
     * [accountHash](sha256Hex(userId))가 일치하는 구매만 교체 후보로 삼는다. 같은 기기·같은
     * Google 계정에 **다른 AlarmTalk 계정**으로 결제된 구독이 있을 수 있는데, 그것을 교체하면
     * 남의 구독을 취소/비례정산시키게 된다. 구매에 식별자가 없거나(레거시) 불일치하면, 또는
     * accountHash 가 null 이면(비로그인) 소유 확인이 불가능하므로 교체 없이 신규 구매로 진행한다.
     */
    private suspend fun findActiveSubscriptionToReplace(productId: String, accountHash: String?): Purchase? {
        if (accountHash == null) return null
        if (!ensureConnected()) return null
        val result = billingClient.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.SUBS)
                .build(),
        )
        if (result.billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
            Log.w(TAG, "queryPurchasesAsync before purchase failed code=${result.billingResult.responseCode}")
            return null
        }
        return result.purchasesList
            .filter {
                it.purchaseState == Purchase.PurchaseState.PURCHASED &&
                    productId !in it.products &&
                    it.accountIdentifiers?.obfuscatedAccountId == accountHash
            }
            .maxByOrNull { it.purchaseTime }
    }

    /** 계정 바인딩 계약(서버와 공유): SHA-256 hex 소문자 64자. */
    private fun sha256Hex(value: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(Locale.ROOT, it) }

    /**
     * 앱 시작 시 호출: 결제는 됐지만 아직 서버 검증(acknowledge)이 끝나지 않은 구매를
     * 다시 [Listener.onPurchaseReady] 로 흘려 재전송한다. (결제 직후 앱 종료/네트워크 실패 대비)
     *
     * @return 재전송한 미확인 구매 수. 0 이면 재전송할 대상이 없었던 것.
     */
    suspend fun resendUnconfirmedPurchases(): Int {
        if (!ensureConnected()) return 0
        val result = billingClient.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.SUBS)
                .build(),
        )
        if (result.billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
            Log.w(TAG, "queryPurchasesAsync failed code=${result.billingResult.responseCode}")
            return 0
        }
        var resent = 0
        result.purchasesList
            .filter { it.purchaseState == Purchase.PurchaseState.PURCHASED && !it.isAcknowledged }
            .forEach { purchase ->
                val productId = purchase.products.firstOrNull() ?: return@forEach
                Log.i(TAG, "Resending unconfirmed Play purchase productId=$productId")
                listener.onPurchaseReady(purchase.purchaseToken, productId)
                resent++
            }
        return resent
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
                // confirm 실패로 미acknowledge 로 남은 구매가 있으면 재전송해 세션 내 복구를 시도하고,
                // 재전송할 대상이 없을 때만 기존 '이미 구독 중' 안내를 노출한다.
                scope.launch {
                    if (resendUnconfirmedPurchases() == 0) {
                        listener.onPurchaseFailed(appContext.getString(R.string.r3misc_billing_already_owned))
                    }
                }

            else -> {
                Log.w(
                    TAG,
                    "Play purchase failed code=${billingResult.responseCode} message=${billingResult.debugMessage}",
                )
                listener.onPurchaseFailed(appContext.getString(R.string.r3misc_billing_purchase_failed))
            }
        }
    }

    /** 더 이상 사용하지 않을 때 연결을 정리한다. */
    fun release() {
        scope.cancel()
        runCatching { billingClient.endConnection() }
    }

    companion object {
        /** startConnection 콜백이 전혀 오지 않는 극단 케이스 방어용 연결 타임아웃(ms). */
        private const val CONNECT_TIMEOUT_MS = 10_000L
    }
}
