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

    /**
     * 선물용 **1회성 인앱 상품**.
     *
     * ⚠ **구독이 아니다.** 자동 갱신 구독은 남에게 줄 수 없어(Play 가 구매자 계정에 묶는다)
     * 선물은 1회성 상품을 팔고 그 대금으로 서버가 **바우처 코드**를 만든다.
     * 그래서 조회·구매 모두 `ProductType.INAPP` 을 써야 한다 — SUBS 로 조회하면 안 나온다.
     */
    const val PERSONAL_GIFT_1M = "personal_gift_1m"

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

    /** 위의 역 — Play 상품 ID → plan key. 스토어가 준 구매를 등급으로 옮길 때 쓴다. */
    fun planKeyFor(productId: String): String? = when (productId) {
        PERSONAL_MONTHLY -> "personal"
        COUPLE_MONTHLY -> "couple"
        FAMILY_MONTHLY -> "family"
        else -> null
    }

    /**
     * 등급 순서. **업그레이드인지 다운그레이드인지 판정하는 유일 근거**다.
     *
     * ⚠ **가격으로 판정하지 말 것.** 가격은 스토어가 정하고 지역·프로모션마다 달라서,
     * 같은 전환이 나라에 따라 업그레이드였다 다운그레이드였다 한다. 등급은 우리 제품
     * 정의이므로 여기 박아 둔다(백엔드 `plans.price_krw` 의 순서와 같다:
     * free 0 < personal 3900 < couple 6900 < family 14900).
     *
     * ⚠ 새 플랜을 추가하면 **여기도 함께** 넣는다. 빠지면 그 플랜으로/에서 가는 전환이
     * 전부 다운그레이드로 처리된다(아래 `rank` 가 -1 을 돌려주므로).
     */
    private val RANK: Map<String, Int> = mapOf(
        PERSONAL_MONTHLY to 1,
        COUPLE_MONTHLY to 2,
        FAMILY_MONTHLY to 3,
    )

    fun rank(productId: String): Int = RANK[productId] ?: -1

    /**
     * 지금 구독(`from`)에서 `to` 로 가는 것이 **상위 등급으로 가는 것인가.**
     * 모르는 상품이 끼면 안전하게 **다운그레이드로 본다**(즉시 과금하지 않는 쪽).
     */
    fun isUpgrade(from: String, to: String): Boolean {
        val a = rank(from)
        val b = rank(to)
        if (a < 0 || b < 0) return false
        return b > a
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

        /**
         * **사용자가 방금 산 것이 아닌** 기존 구매의 정합화(restore). 검증 경로는 같지만
         * 성공 UI 를 내지 않는다.
         *
         * [userInitiated] 가 참이면 **사용자가 '이전 구매 복원' 을 눌러서** 온 것이다 —
         * 결과(성공/실패)를 반드시 화면에 말해야 한다. 거짓이면 앱 시작·탭 진입마다 도는
         * 자동 정합화라 아무 말도 하지 않는다.
         *
         * ⚠ **[onPurchaseReady] 로 합치지 말 것**(2026-09-01 리뷰). 그 핸들러는
         * "이용권이 적용됐어요" 를 띄우고 커플/가족이면 구성원 관리로 **이동**시킨다.
         * 정합화는 앱 시작·탭 진입마다 도는데 그걸 그대로 태우면, 이미 가족 플랜을 쓰는
         * 사람이 **앱을 켤 때마다 구성원 관리로 튕긴다.**
         */
        fun onPurchaseRestored(
            purchaseToken: String,
            productId: String,
            userInitiated: Boolean,
            /** 복원을 **시작한** 계정. 조회 중 전환됐을 수 있어 호출부가 잡아 넘긴다. */
            ownerUserId: String?,
        )

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
     * 1회성(INAPP) 상품 결제 시트를 띄운다 — 선물 전용.
     *
     * ⚠ 구독 경로와 **섞지 말 것**: INAPP 에는 offerToken 이 없고, 구독 교체
     * (`setSubscriptionUpdateParams`)를 붙이면 Play 가 거절한다.
     */
    suspend fun launchOneTimePurchase(
        activity: Activity,
        productId: String,
        userId: String? = null,
    ): Boolean {
        if (!ensureConnected()) return false
        val details = productDetailsCache[productId] ?: run {
            val fetched = billingClient.queryProductDetails(
                QueryProductDetailsParams.newBuilder()
                    .setProductList(
                        listOf(
                            QueryProductDetailsParams.Product.newBuilder()
                                .setProductId(productId)
                                .setProductType(BillingClient.ProductType.INAPP)
                                .build(),
                        ),
                    )
                    .build(),
            ).productDetailsList?.firstOrNull()
            if (fetched != null) productDetailsCache[productId] = fetched
            fetched
        } ?: run {
            Log.w(TAG, "Play one-time product not found productId=$productId")
            return false
        }
        val builder = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(
                listOf(
                    BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(details)
                        .build(),
                ),
            )
        userId?.takeIf { it.isNotBlank() }?.let { builder.setObfuscatedAccountId(sha256Hex(it)) }
        val result = billingClient.launchBillingFlow(activity, builder.build())
        if (result.responseCode != BillingClient.BillingResponseCode.OK) {
            Log.w(TAG, "launchBillingFlow(one-time) failed code=${result.responseCode}")
            return false
        }
        return true
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
            // ⚠ **교체 모드를 하나로 고정하지 말 것.** 예전에는 항상
            // `WITH_TIME_PRORATION`(즉시 전환 + 비례정산)이었는데, 그건 **업그레이드용**이다.
            // 다운그레이드에 걸면 사용자가 더 싼 플랜으로 내려가면서 **즉시** 바뀌고
            // 남은 기간이 새 플랜 기준으로 환산된다 — 사용자는 "이번 달은 원래 플랜을
            // 쓰다가 다음 달부터 바뀐다" 를 기대한다(2026-08-11 설계).
            //
            // - 업그레이드: `WITH_TIME_PRORATION` — 즉시 쓰게 해 주고 남은 기간을 환산
            // - 다운그레이드: `DEFERRED` — **다음 갱신일에** 바뀐다. 지금은 과금하지 않고
            //   현재 플랜을 기간 끝까지 그대로 쓴다.
            //
            // ⚠ `DEFERRED` 는 **지금 결제가 일어나지 않는다** — 그래서 구매 리스너로
            // 새 purchase 가 즉시 오지 않는다. 화면이 "바로 바뀐다" 고 말하면 안 된다
            // (호출부가 예약 안내를 띄운다).
            val fromProductId = existing.products.firstOrNull().orEmpty()
            val mode = if (PlayBillingProducts.isUpgrade(fromProductId, productId)) {
                BillingFlowParams.SubscriptionUpdateParams.ReplacementMode.WITH_TIME_PRORATION
            } else {
                BillingFlowParams.SubscriptionUpdateParams.ReplacementMode.DEFERRED
            }
            Log.i(TAG, "subscription replace from=$fromProductId to=$productId mode=$mode")
            flowParamsBuilder.setSubscriptionUpdateParams(
                BillingFlowParams.SubscriptionUpdateParams.newBuilder()
                    .setOldPurchaseToken(existing.purchaseToken)
                    .setSubscriptionReplacementMode(mode)
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
    private suspend fun findActiveSubscriptionToReplace(productId: String, accountHash: String?): Purchase? =
        queryActiveSubscriptions(accountHash)
            // 교체 후보는 **내 것만**이다. 임자를 알 수 없는 레거시 구매를 교체하면 남의
            // 구독을 취소·비례정산시킬 수 있다(위 주석).
            ?.mine
            .orEmpty()
            .filter { productId !in it.products }
            .maxByOrNull { it.purchaseTime }

    /**
     * **이 계정의 살아 있는 구독 구매** — 스토어가 답하는 권위 신호.
     *
     * iOS `Transaction.currentEntitlements` 의 Play 대응물이다. 예전에는 이 조회가
     * `findActiveSubscriptionToReplace`(교체 대상 찾기) 안에만 있어 **등급 판정에 쓰이지
     * 못했다** — 그래서 앱이 보는 구독 상태가 100% 서버 응답이었고, 스토어가 자동갱신했는데
     * 서버 반영이 늦으면 **돈을 내는 사용자가 잠겼다**(2026-08-31).
     *
     * ⚠ **계정 대조를 반드시 함께 한다.** 같은 구글 계정에 **다른 AlarmTalk 계정**으로 결제된
     * 구독이 있을 수 있는데, 그걸 세면 공용 폰에서 남의 구독이 이 계정의 등급을 올린다.
     * 비로그인(accountHash == null)은 아예 못 묻는다(`null`).
     * 식별자가 없는 레거시 구매는 **세지도, 버리지도 않고** [ActiveSubscriptionQuery.unattributed]
     * 로 따로 준다 — 버리면 빈 목록이 되어 "스토어가 없다고 했다" 로 읽히기 때문이다.
     *
     * ⚠ **반환값 `null` 과 빈 리스트는 뜻이 다르다**(2026-08-31 리뷰).
     * `null` = **못 물어봤다**(연결 실패·응답 오류·비로그인), `emptyList` = **스토어가 없다고
     * 답했다**. 둘을 같게 다루면 오프라인 한 번에 결제 중인 사용자의 신호가 지워진다.
     */
    suspend fun queryActiveSubscriptions(accountHash: String?): ActiveSubscriptionQuery? {
        if (accountHash == null) return null
        if (!ensureConnected()) return null
        val result = billingClient.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.SUBS)
                .build(),
        )
        if (result.billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
            Log.w(TAG, "queryPurchasesAsync failed code=${result.billingResult.responseCode}")
            return null
        }
        val purchased = result.purchasesList.filter { it.purchaseState == Purchase.PurchaseState.PURCHASED }
        return ActiveSubscriptionQuery(
            mine = purchased.filter { it.accountIdentifiers?.obfuscatedAccountId == accountHash },
            unattributed = purchased.filter { it.accountIdentifiers?.obfuscatedAccountId == null },
        )
    }

    /**
     * 스토어가 답한 활성 구독 — **내 것**과 **임자를 알 수 없는 것**을 나눠 준다.
     *
     * ⚠ **둘을 합치지도, 뒤엣것을 버리지도 말 것**(2026-09-01 리뷰). `obfuscatedAccountId`
     * 를 붙이기 **전에** 산 구독에는 식별자가 없다. 그걸 그냥 걸러 내면 결과가 빈 목록,
     * 즉 "스토어가 없다고 했다" 가 되어 **확인 완료로 표시하고 캐시까지 지운다** — RTDN 을
     * 놓쳐 서버 기간이 만료돼 있으면 그 길로 되돌릴 수 없는 잠금이 걸린다. 반대로 내 것으로
     * 세면 같은 기기의 다른 계정이 남의 구독을 물려받는다.
     * 그래서 '모른다' 로 남기고 [Listener] 복원으로 서버에 붙여 판정을 서버에 맡긴다.
     */
    data class ActiveSubscriptionQuery(
        val mine: List<Purchase>,
        val unattributed: List<Purchase>,
    )

    /** 계정 식별자 해시 — 호출부가 같은 계약으로 만들 수 있게 연다(서버와 공유하는 SHA-256 hex). */
    fun accountHashFor(userId: String?): String? =
        userId?.takeIf { it.isNotBlank() }?.let { sha256Hex(it) }

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
        // ⚠ **구독(SUBS)만 보지 말 것**(2026-08-18 Codex #697 P1). 선물은 1회성 상품
        // (INAPP)이라 여기에 안 잡히면 **재시도할 경로가 아예 없다** — 1회성 구매에는
        // RTDN 도 오지 않는다. 서버가 바우처를 발급한 뒤 `:consume` 이 일시적으로 실패하면
        // 그 구매는 미확인인 채 남고, Play 는 3일 뒤 자동 환불하는데 바우처는 그대로
        // 쓸 수 있다(돈은 돌려주고 이용권은 나간 상태). 다시 보내면 서버의 중복 갈래가
        // 소비를 재시도한다.
        var resent = 0
        for (type in listOf(BillingClient.ProductType.SUBS, BillingClient.ProductType.INAPP)) {
            val result = billingClient.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder().setProductType(type).build(),
            )
            if (result.billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
                Log.w(TAG, "queryPurchasesAsync($type) failed code=${result.billingResult.responseCode}")
                continue
            }
            result.purchasesList
                .filter { it.purchaseState == Purchase.PurchaseState.PURCHASED && !it.isAcknowledged }
                .forEach { purchase ->
                    val productId = purchase.products.firstOrNull() ?: return@forEach
                    Log.i(TAG, "Resending unconfirmed Play purchase type=$type productId=$productId")
                    listener.onPurchaseReady(purchase.purchaseToken, productId)
                    resent++
                }
        }
        return resent
    }

    /**
     * **이전 구매 복원** — 스토어에 남아 있는 활성 구독을 서버로 다시 보낸다.
     *
     * [resendUnconfirmedPurchases] 와 딱 하나 다르다: **acknowledge 여부를 보지 않는다.**
     * 그 함수는 '결제 직후 앱이 죽어 서버 검증을 못 한 건' 을 위한 것이라 미확인 건만
     * 고르는데, 복원이 필요한 상황은 대개 반대다 — 스토어에는 정상 구독(acknowledge 됨)이
     * 있는데 **우리 서버에 그 기록이 없는** 경우(계정 갈아타기·서버 쪽 유실·재설치 후 다른
     * 경로로 로그인)라, 미확인만 보내면 복원 버튼이 늘 "복원할 구매가 없어요" 를 낸다.
     *
     * 서버가 같은 토큰을 여러 번 받아도 안전하다(멱등) — 검증 후 같은 구독으로 수렴한다.
     *
     * @return 서버로 보낸 구매 수. 0 이면 스토어에 활성 구독이 없다.
     */
    suspend fun restorePurchases(userInitiated: Boolean = false, ownerUserId: String? = null): Int {
        if (!ensureConnected()) return 0
        val result = billingClient.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.SUBS)
                .build(),
        )
        if (result.billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
            Log.w(TAG, "restorePurchases query failed code=${result.billingResult.responseCode}")
            return 0
        }
        var sent = 0
        result.purchasesList
            .filter { it.purchaseState == Purchase.PurchaseState.PURCHASED }
            .forEach { purchase ->
                val productId = purchase.products.firstOrNull() ?: return@forEach
                Log.i(TAG, "Restoring Play purchase productId=$productId")
                listener.onPurchaseRestored(purchase.purchaseToken, productId, userInitiated, ownerUserId)
                sent++
            }
        return sent
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
