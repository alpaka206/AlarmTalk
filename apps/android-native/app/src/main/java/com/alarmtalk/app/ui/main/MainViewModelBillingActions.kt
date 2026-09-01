package com.alarmtalk.app

import com.alarmtalk.app.data.DowngradeNoticeStore
import android.app.Application
import android.util.Log
import androidx.lifecycle.viewModelScope
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.network.apiError
import com.alarmtalk.app.network.apiErrorCode
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.CancelSubscriptionRequest
import com.alarmtalk.app.network.CodeRegisterRequest
import com.alarmtalk.app.network.GooglePlayConfirmRequest
import com.alarmtalk.app.network.VoucherItem
import com.alarmtalk.app.R
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch


/**
 * **스토어에 지금 유효한 구독을 묻고 등급을 갱신한다** — 「스토어가 권위다」를 앱에서 실제로
 * 지키는 자리(2026-08-31).
 *
 * 함께 `restorePurchases()` 를 돌려 **서버 화해까지** 시킨다. 예전에는 앱 시작 시
 * `resendUnconfirmedPurchases()` 만 돌았는데 그건 **미승인 건만** 고른다 — 자동갱신된 구독은
 * 이미 승인돼 있어 **영원히 걸리지 않았다.** 그래서 스토어는 갱신됐는데 서버는 옛 만료시각을
 * 들고 있는 상태가 스스로 낫지 않았다. `restorePurchases` 는 멱등하다(서버가
 * `/billing/google/confirm` 으로 검증해 `expires_at` 을 스토어 값으로 맞춘다).
 *
 * 실패해도 조용히 넘어간다 — 스토어를 못 읽은 것은 '무료' 가 아니라 '모름' 이고,
 * 판정기(`resolvePaidVoiceAccess`)가 서버 스냅샷으로 내려간다.
 */
internal suspend fun MainViewModel.refreshStoreEntitlement() {
    val userId = authSession?.user?.id ?: return
    runCatching {
        val hash = playBilling.accountHashFor(userId)
        // ⚠ **null 은 '구독 없음' 이 아니라 '못 물어봤다' 다**(2026-08-31 리뷰).
        // 오프라인·연결 실패에서 신호를 지우면, 서버 스냅샷이 갱신 전 만료시각을 들고 있는
        // **결제 중인 사용자가 곧바로 무료로 떨어진다.** 못 물어봤으면 **이전 값을 그대로 둔다** —
        // 그 값에는 기한이 붙어 있어 오래 살아남지도 않는다(`STORE_ENTITLEMENT_TTL_MILLIS`).
        storeRefreshGeneration++
        val generation = storeRefreshGeneration
        // ⚠ **아무것도 발행하지 못하면 세대를 되돌린다**(2026-09-01 리뷰). 세대는 '나중에
        // 시작한 조회가 이긴다' 를 위해 **시작할 때** 올리는데, 그 조회가 연결 실패로 빈손이면
        // 자기는 아무것도 못 쓰면서 **먼저 시작한 성공 결과만 무효로 만든다** — 그러면 그
        // 회차에는 아무도 발행하지 못해 확인 미완으로 남거나 옛 유료 캐시가 그대로 산다.
        // 그 뒤에 시작한 조회가 없을 때만 되돌린다.
        fun rollbackIfNewest() {
            if (storeRefreshGeneration == generation) storeRefreshGeneration--
        }
        val query = playBilling.queryActiveSubscriptions(hash) ?: run {
            rollbackIfNewest()
            return@runCatching
        }
        // ⚠ **임자를 알 수 없는 구독이 있으면 '확인했다' 고 하지 않는다**(2026-09-01 리뷰).
        // `obfuscatedAccountId` 를 붙이기 **전에** 산 구독에는 식별자가 없어 내 것으로도
        // 남의 것으로도 셀 수 없다. 그걸 그냥 걸러 내면 결과가 빈 목록 — "스토어가 없다고
        // 했다" 가 되어 확인 완료 표시를 세우고 캐시까지 지운다. RTDN 을 놓쳐 서버 기간이
        // 만료돼 있으면 그 길로 **되돌릴 수 없는 잠금**이 걸린다. 돈을 내고 있는 사용자에게.
        // 그래서 여기서는 아무것도 확정하지 않고, 복원만 보내 **서버가 붙여 판정하게** 한다.
        if (query.mine.isEmpty() && query.unattributed.isNotEmpty()) {
            android.util.Log.i(
                "MainViewModel",
                "Store has unattributed subscriptions; leaving entitlement undetermined",
            )
            runCatching { playBilling.restorePurchases() }
            rollbackIfNewest()
            return@runCatching
        }
        val purchases = query.mine
        val nextKey = purchases
            .flatMap { it.products }
            .mapNotNull { com.alarmtalk.app.billing.PlayBillingProducts.planKeyFor(it) }
            .maxByOrNull { key ->
                when (key) {
                    "family" -> 3
                    "couple" -> 2
                    "personal" -> 1
                    else -> 0
                }
            }
        val until = nextKey?.let { System.currentTimeMillis() + STORE_ENTITLEMENT_TTL_MILLIS }
        // ⚠ **조회 중 계정이 바뀌었으면 버린다**(2026-08-31 리뷰). 조회는 비동기라 A 가
        // 로그아웃하고 B 가 들어온 뒤에 A 의 결과가 도착할 수 있다 — 그대로 쓰면 무료 B 가
        // A 의 등급을 물려받아 편집기·목소리·저장 게이트를 전부 통과한다.
        if (authSession?.user?.id != userId) {
            android.util.Log.i("MainViewModel", "Dropping stale store entitlement: account changed")
            return@runCatching
        }
        // ⚠ **같은 계정 안에서도 밀려난 조회는 버린다**(2026-09-01 리뷰). 시작 경로와 탭 진입
        // 경로가 각각 이 함수를 던지므로 조회가 겹치는데, 계정 가드는 둘 다 통과시킨다 —
        // 먼저 시작한 쪽이 늦게 끝나면 그 사이 바뀐 Play 상태를 옛 결과로 덮는다.
        if (generation != storeRefreshGeneration) {
            android.util.Log.i("MainViewModel", "Dropping superseded store entitlement refresh")
            return@runCatching
        }
        // ⚠ **확인 완료 표시는 계정 가드를 통과한 뒤에만 세운다**(2026-08-31 리뷰).
        // 앞에서 세우면 A 의 결과를 버리면서도 **B 의 확인이 끝난 것으로 표시**되어,
        // B 의 서버 구독이 만료돼 있고 B 자신의 조회는 아직인 사이 되돌릴 수 없는 강등이 걸린다.
        storeEntitlementChecked = true
        storePlanKey = nextKey
        storeEntitlementUntilMillis = until
        // 울림 경로는 BillingClient 를 못 붙인다 — 캐시에 적어 둬야 그때도 스토어를 존중한다.
        accessSnapshotStore.updateStorePlanKey(userId, nextKey, until)
        if (purchases.isNotEmpty()) {
            // 서버가 아직 모를 수 있다 — 멱등이므로 매번 보내도 안전하다.
            runCatching { playBilling.restorePurchases() }
        }
    }.onFailure { error ->
        android.util.Log.w("MainViewModel", "Failed to refresh store entitlement", error)
    }
}

internal fun MainViewModel.refreshBilling() {
    refreshBillingData(showMessage = true)
    // 서버 조회와 **같이** 스토어에도 묻는다 — Play 에는 iOS `Transaction.updates` 같은 푸시가
    // 없으므로 전경 진입마다 도는 이 자리가 폴링 지점이다(iOS `resyncEntitlements` 대응).
    viewModelScope.launch { refreshStoreEntitlement() }
}

internal suspend fun MainViewModel.refreshShareCodeData(): List<VoucherItem> {
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_share_code_info)) ?: return vouchers
    if (billingBusy || socialBusy) return vouchers
    billingBusy = true
    socialBusy = true
    return try {
        coroutineScope {
            val subscription = async { api.getSubscription(authorization) }
            val freshVouchers = async { api.listVouchers(authorization).vouchers }
            val group = async {
                runCatching {
                    api.getFamilyGroup(authorization)
                }.onFailure { error ->
                    Log.w(TAG, "Failed to refresh family group before voucher share", error)
                }.getOrNull()
            }
            val updatedSubscription = subscription.await()
            val updatedVouchers = freshVouchers.await()
            val updatedGroup = group.await()
            subscriptionResponse = updatedSubscription
            saveSubscriptionSnapshot(updatedSubscription)
            vouchers = updatedVouchers
            updatedGroup?.let {
                familyGroup = it
                saveFamilyGroupSnapshot(it)
            }
            updatedVouchers
        }
    } catch (error: Throwable) {
        AlarmTalkLog.reportError("Failed to refresh share code data", error)
        message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_gb_share_code_info_load_failed))
        vouchers
    } finally {
        billingBusy = false
        socialBusy = false
    }
}

/**
 * **이전 구매 복원.** 스토어에 남아 있는 활성 구독을 서버로 다시 보내 이용권을 되찾는다.
 *
 * 왜 버튼이 필요한가: 결제는 스토어가 권위인데(`docs/spec/billing-lifecycle.md`), 우리
 * 서버에 그 기록이 없는 상태가 생길 수 있다 — 기기를 바꾸거나 다른 경로로 로그인한 경우다.
 * 그때 사용자가 할 수 있는 일이 '다시 결제' 뿐이면 **같은 구독을 두 번 사게 된다.**
 * 애플이 심사 지침(3.1.1)으로 이 버튼을 요구하는 이유이고, 플레이에도 같은 기능이 있다.
 *
 * 복원 결과는 [MainViewModel.confirmGooglePurchase] 가 처리한다(성공하면 이용권이 갱신되고
 * 그쪽이 안내를 낸다). 여기서는 **보낼 것이 없었을 때만** 따로 알려 준다 — 아무 일도 일어나지
 * 않는 것과 구분되지 않기 때문이다.
 */
internal fun MainViewModel.restorePurchases() {
    val app = getApplication<android.app.Application>()
    bearerOrMessage(app.getString(R.string.msg_gb_login_required_share_code_info)) ?: return
    if (billingBusy) return
    billingBusy = true
    message = app.getString(R.string.billing_restore_checking)
    viewModelScope.launch {
        val restored = runCatching { playBilling.restorePurchases(userInitiated = true) }
            .onFailure { error -> AlarmTalkLog.reportError("Failed to restore Play purchases", error) }
            .getOrDefault(0)
        // ⚠ **busy 는 이 함수가 소유한다**(2026-09-01 리뷰). 예전에는 보낸 게 있으면
        // `confirmGooglePurchase` 콜백이 풀어 줬는데, 정합화를 조용하게 만들면서 그 콜백이
        // 더는 풀지 않는다 — 사용자가 '이전 구매 복원' 을 누르면 결제 UI 가 **뷰모델이 다시
        // 만들어질 때까지 잠긴 채** 남았다. 확인 요청은 이미 다 보냈고 결과는 구독 재조회로
        // 화면에 드러나므로, 여기서 풀어 주는 것이 맞다.
        billingBusy = false
        // 보낸 게 있으면 문구는 그대로 두고 **확인 결과가 덮어쓴다**(성공이면 '이용권이
        // 적용됐어요', 실패면 그 사유) — 그래서 복원은 `UserRestore` 로 보낸다.
        if (restored == 0) message = app.getString(R.string.billing_restore_none)
    }
}

internal fun MainViewModel.preloadBilling() {
    if (authSession == null || billingRefreshing || billingBusy) return
    refreshBillingData(showMessage = false)
}

// read-only 새로고침은 billingRefreshing 만 올린다 — billingBusy 를 쓰면 패널 진입
// 직후 구매 버튼이 네트워크 호출이 끝날 때까지 비활성화되는 문제가 있었다.
private fun MainViewModel.refreshBillingData(showMessage: Boolean) {
    if (billingRefreshing || billingBusy) return
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_billing_info)) ?: return
    billingRefreshing = true
    viewModelScope.launch {
        try {
            runCatching {
                loadBillingSnapshot(authorization)
            }.onSuccess { snapshot ->
                applyBillingSnapshot(snapshot)
            }.onFailure { error ->
                AlarmTalkLog.reportError("Failed to load billing", error)
                if (showMessage) message = userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_gb_billing_info_load_failed))
            }
        } finally {
            billingRefreshing = false
        }
    }
}

private suspend fun MainViewModel.loadBillingSnapshot(
    authorization: String,
): BillingSnapshot =
    coroutineScope {
        val subscription = async { api.getSubscription(authorization) }
        val vouchers = async { api.listVouchers(authorization).vouchers }
        BillingSnapshot(
            subscription = subscription.await(),
            vouchers = vouchers.await(),
        )
    }

private fun MainViewModel.applyBillingSnapshot(snapshot: BillingSnapshot) {
    subscriptionResponse = snapshot.subscription
    saveSubscriptionSnapshot(snapshot.subscription)
    vouchers = snapshot.vouchers
}

/**
 * 변경 뒤 결제 상태 재조회.
 *
 * ⚠ **`expectedOwnerUserId` 를 넘겨라**(2026-09-01 리뷰). 이 함수 안에 **또 하나의 중단점**
 * 이 있다 — 호출부에서 계정을 확인했더라도 여기서 두 요청을 기다리는 사이 A→B 전환이
 * 일어날 수 있고, 그러면 `applyBillingSnapshot` 이 A 의 바우처를 전역에 발행하고
 * `saveSubscriptionSnapshot` 이 A 의 구독을 **지금 계정 B** 키로 저장한다.
 */
private suspend fun MainViewModel.refreshBillingAfterMutation(
    authorization: String,
    reason: String,
    expectedOwnerUserId: String?,
) {
    runCatching {
        loadBillingSnapshot(authorization)
    }.onSuccess { snapshot ->
        if (authSession?.user?.id != expectedOwnerUserId) {
            Log.i(TAG, "Dropping billing snapshot after $reason: account changed")
            return@onSuccess
        }
        applyBillingSnapshot(snapshot)
    }.onFailure { error ->
        Log.w(TAG, "Failed to refresh billing after $reason", error)
    }
}

private fun billingFailureMessage(context: android.content.Context, errorCode: String?, fallback: String): String =
    when (errorCode) {
        "SAME_PLAN" -> context.getString(R.string.msg2_billing_fail_same_plan)
        "NO_ACTIVE_SUBSCRIPTION" -> context.getString(R.string.msg2_billing_fail_no_active_subscription)
        "PLAN_NOT_FOUND" -> context.getString(R.string.msg2_billing_fail_plan_not_found)
        "PLAN_INACTIVE" -> context.getString(R.string.msg2_billing_fail_plan_inactive)
        "FREE_NOT_BILLABLE" -> context.getString(R.string.msg2_billing_fail_free_not_billable)
        "CHECKOUT_DISABLED" -> context.getString(R.string.msg2_billing_fail_checkout_disabled)
        "USER_NOT_FOUND" -> context.getString(R.string.msg2_billing_fail_user_not_found)
        else -> fallback
    }

private fun codeRegistrationFailureMessage(context: android.content.Context, errorCode: String?, fallback: String): String =
    when (errorCode) {
        "CODE_REQUIRED" -> context.getString(R.string.msg2_code_fail_code_required)
        "INVALID_FORMAT" -> context.getString(R.string.msg2_code_fail_invalid_format)
        "CODE_NOT_FOUND" -> context.getString(R.string.msg2_code_fail_code_not_found)
        "CODE_EXPIRED" -> context.getString(R.string.msg2_code_fail_code_expired)
        "CODE_ALREADY_USED" -> context.getString(R.string.msg2_code_fail_code_already_used)
        "CODE_ALREADY_REDEEMED_BY_YOU" -> context.getString(R.string.msg2_code_fail_code_already_redeemed_by_you)
        "SELF_ISSUED", "SELF_ACCEPT" -> context.getString(R.string.msg2_code_fail_self_issued)
        "GROUP_FULL" -> context.getString(R.string.msg2_code_fail_group_full)
        "INVALID_GIFT_PLAN", "INVALID_INVITE_PLAN" -> context.getString(R.string.msg2_code_fail_invalid_plan_type)
        "PLAN_NOT_FOUND" -> context.getString(R.string.msg2_code_fail_plan_not_found)
        "USER_NOT_FOUND" -> context.getString(R.string.msg2_code_fail_user_not_found)
        // 통합 엔드포인트가 가족그룹 초대/프로모 코드도 처리하므로 그쪽 에러 코드도 매핑한다.
        "CODE_REVOKED" -> context.getString(R.string.msg2_code_fail_code_revoked)
        "ALREADY_MEMBER" -> context.getString(R.string.msg2_code_fail_already_member)
        "CODE_INACTIVE" -> context.getString(R.string.msg2_promo_fail_code_inactive)
        "CODE_NOT_IN_WINDOW" -> context.getString(R.string.msg2_promo_fail_not_in_window)
        "CODE_EXHAUSTED" -> context.getString(R.string.msg2_promo_fail_code_exhausted)
        // 리딤 그룹(예: 웰컴 3종) — 같은 계열 코드를 이미 썼으면 다른 코드도 불가.
        "CODE_GROUP_ALREADY_REDEEMED" -> context.getString(R.string.msg2_promo_fail_group_already_redeemed)
        "OWNS_ACTIVE_GROUP" -> context.getString(R.string.msg2_promo_fail_owns_active_group)
        "ACTIVE_SUBSCRIPTION_EXISTS" -> context.getString(R.string.msg2_promo_fail_active_subscription)
        else -> fallback
    }

private fun com.alarmtalk.app.network.BillingPlanSummary?.isSharedPassPlan(): Boolean =
    this != null && (key in setOf("couple", "family") || planType in setOf("couple", "family"))

/**
 * 코드(바우처·초대·프로모) 등록.
 *
 * [onResult] 는 **결과를 기다려야 하는 호출부**만 넘긴다 — null 이면 성공, 문자열이면 실패 사유다.
 * 웰컴 프로모처럼 '계정당 1회' 로 소진되는 자리는 실패했는데 화면이 먼저 닫히면 사용자가 코드를
 * 고쳐 넣을 방법이 영영 없어진다(Codex #660). 그래서 실패 문구를 스낵바 대신 호출부로 돌려주고,
 * 호출부가 화면을 열어 둔 채 인라인으로 보여 준다(다이얼로그가 떠 있으면 스낵바는 그 뒤로 가린다).
 * 넘기지 않으면 지금처럼 스낵바로만 알린다.
 */
/**
 * 코드 등록(초대·선물·프로모 공용).
 *
 * @param navigateOnSuccess 성공 시 화면을 옮길지. **편집기 게이트에서 부를 때는 false**다 —
 *   true 로 두면 쿠폰을 넣는 순간 홈/구성원 탭으로 튕겨 **편집 중이던 알람이 통째로
 *   사라진다**(시각·반복·문구를 다시 입력해야 한다). 잠금이 풀리는 것은 구독 갱신
 *   (`refreshBillingAfterMutation`)이 하므로 화면을 옮기지 않아도 그 자리에서 이어서 쓴다.
 */
internal fun MainViewModel.registerCode(
    code: String,
    navigateOnSuccess: Boolean = true,
    onResult: ((String?) -> Unit)? = null,
) {
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_register_code))
        ?: run {
            // 조기 반환도 결과를 알린다 — 안 그러면 호출부는 로딩도 에러도 없이 멈춘 것처럼 보인다.
            onResult?.invoke(message)
            return
        }
    val trimmedCode = code.trim()
    if (trimmedCode.isBlank()) {
        message = getApplication<android.app.Application>().getString(R.string.msg_gb_code_input_required_period)
        onResult?.invoke(message)
        return
    }
    // 응답이 늦게 온 사이 계정이 바뀌면 그 계정 화면을 건드리지 않는다(이 PR 의 반복 지점).
    val ownerUserId = authSession?.user?.id
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            api.registerCode(authorization, CodeRegisterRequest(trimmedCode))
        }.onSuccess { response ->
            if (authSession?.user?.id != ownerUserId) return@onSuccess
            message = if (response.type == "promo") {
                getApplication<android.app.Application>().getString(R.string.msg_gb_promo_redeemed)
            } else {
                getApplication<android.app.Application>().getString(R.string.msg_gb_code_registered)
            }
            refreshBillingAfterMutation(authorization, "code registration", ownerUserId)
            refreshSocial()
            refreshAppSession()
            // 서버가 판별한 type 기준: 초대(그룹 합류)거나 커플/가족 플랜이면 공유패스 갱신.
            val joinedSharedPass = response.type == "invite" ||
                response.type == "group_invite" ||
                response.plan.isSharedPassPlan()
            if (navigateOnSuccess) {
                if (joinedSharedPass) {
                    navigateSharedPassTick++
                } else {
                    navigateHomeTick++
                }
            }
            onResult?.invoke(null)
        }.onFailure { error ->
            if (authSession?.user?.id != ownerUserId) return@onFailure
            // errorBody 는 한 번만 읽히므로 error_code 를 먼저 한 번만 추출해 재사용한다.
            val errorCode = apiErrorCode(error)
            AlarmTalkLog.reportError("Failed to register code", error)
            val failure = codeRegistrationFailureMessage(
                getApplication<android.app.Application>(),
                errorCode,
                userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_gb_code_register_failed)),
            )
            if (onResult != null) {
                onResult(failure)
            } else {
                message = failure
            }
        }
        billingBusy = false
    }
}

/**
 * 선물 이용권 **구매**를 시작한다(1회성 인앱 상품).
 *
 * ⚠ **결제 없이 코드를 만들지 않는다.** 무결제 발급 경로(`POST /billing/checkout`
 * gift:true)는 서버가 production 에서 항상 막는다 — 열면 누구나 무료로 유료 이용권을
 * 뽑을 수 있다. 여기서는 1회성 상품을 실제로 사고, 서버가 그 구매를 검증해 바우처를 만든다.
 *
 * ⚠ 구독 경로(`startPlayPurchase`)와 **섞지 말 것**: INAPP 에는 offerToken 이 없고,
 * 구독 교체 파라미터를 붙이면 Play 가 거절한다.
 */
internal fun MainViewModel.startGiftPurchase(activity: android.app.Activity) {
    val session = authSession
    if (session == null) {
        message = getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_purchase_plan)
        return
    }
    if (billingBusy) return
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            playBilling.launchOneTimePurchase(
                activity,
                com.alarmtalk.app.billing.PlayBillingProducts.PERSONAL_GIFT_1M,
                userId = session.user.id.takeIf { it.isNotBlank() },
            )
        }.onSuccess { launched ->
            if (!launched) {
                message = getApplication<android.app.Application>().getString(R.string.msg_gb_google_play_start_failed)
                billingBusy = false
            }
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to launch Play gift purchase", error)
            message = getApplication<android.app.Application>().getString(R.string.billing_gift_failed)
            billingBusy = false
        }
    }
}

/**
 * Google Play 구독 결제를 시작한다. 결제 시트 결과(성공/보류/취소)는
 * [MainViewModel.playBilling] 의 리스너로 비동기 전달되어 [confirmGooglePurchase] 로 이어진다.
 */
internal fun MainViewModel.startPlayPurchase(activity: android.app.Activity, productId: String) {
    val session = authSession
    if (session == null) {
        message = getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_purchase_plan)
        return
    }
    if (billingBusy) return
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            // userId(=서버 users.id)는 구매-계정 바인딩용. 비어 있으면(비정상 세션) 바인딩만 생략.
            playBilling.launchPurchase(activity, productId, userId = session.user.id.takeIf { it.isNotBlank() })
        }.onSuccess { launched ->
            if (!launched) {
                message = getApplication<android.app.Application>().getString(R.string.msg_gb_google_play_start_failed)
                billingBusy = false
            }
            // launched=true 면 busy 해제는 결제 결과 콜백(onPurchaseReady/Pending/Failed)에서 처리.
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to launch Play purchase productId=$productId", error)
            message = getApplication<android.app.Application>().getString(R.string.msg_gb_google_play_start_failed)
            billingBusy = false
        }
    }
}

/**
 * Play 구매 토큰을 백엔드(/billing/google/confirm)로 보내 검증·acknowledge·구독 반영을 요청한다.
 * 성공 시 기존 구독 로드 경로를 재사용해 구독 상태를 새로고침한다.
 */
/**
 * 이 확인이 **어디서 왔는가**. 셋이 각각 다른 것을 낸다(2026-09-01 리뷰).
 *
 * | | 결과 메시지 | 공유패스 이동 | `billingBusy` |
 * | --- | --- | --- | --- |
 * | [UserPurchase] | O | O | 이 함수가 소유 |
 * | [UserRestore] | O | X | **호출부가 소유** |
 * | [AutoReconcile] | X | X | 건드리지 않음 |
 *
 * ⚠ **셋을 하나로 합치지 말 것.** 전부 UI 를 내면 앱 시작·탭 진입마다 도는 정합화가
 * "이용권이 적용됐어요" 를 띄우고 커플/가족 사용자를 구성원 관리로 튕긴다. 반대로 전부
 * 조용하게 만들면 **사용자가 누른 복원의 결과를 말해 줄 사람이 없어진다** — 스토어에 구매가
 * 있어도 다른 계정 것이라 서버가 거절하면, 사용자는 "확인하고 있어요…" 만 보고 아무 일도
 * 안 일어난 줄 알고 다시 결제하려 든다.
 */
internal enum class PurchaseConfirmOrigin { UserPurchase, UserRestore, AutoReconcile }

internal fun MainViewModel.confirmGooglePurchase(
    purchaseToken: String,
    productId: String,
    origin: PurchaseConfirmOrigin = PurchaseConfirmOrigin.UserPurchase,
) {
    val showsResult = origin != PurchaseConfirmOrigin.AutoReconcile
    val ownsBusy = origin == PurchaseConfirmOrigin.UserPurchase
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_apply_plan)) ?: run {
        if (ownsBusy) billingBusy = false
        return
    }
    // ⚠ **시작한 계정을 잡아 둔다**(2026-09-01 리뷰). 이 확인은 비동기라 그 사이 A→B 계정
    // 전환이 일어날 수 있는데, 아래 `refreshBillingAfterMutation` 은 **A 의 토큰으로 받아
    // 전역 state 에 발행**하고 `saveSubscriptionSnapshot` 은 **지금 계정 B** 로 키를 잡는다 —
    // A 의 바우처·초대코드가 B 화면에 뜨고 A 의 구독이 B 의 접근 스냅샷에 박힌다.
    val ownerUserId = authSession?.user?.id
    viewModelScope.launch {
        if (ownsBusy) billingBusy = true
        runCatching {
            api.confirmGooglePurchase(
                authorization,
                GooglePlayConfirmRequest(
                    purchaseToken = purchaseToken,
                    productId = productId,
                    packageName = getApplication<Application>().packageName,
                ),
            )
        }.onSuccess { response ->
            // 응답이 늦게 온 사이 계정이 바뀌었으면 **아무것도 발행하지 않는다**(위 주석).
            if (authSession?.user?.id != ownerUserId) {
                android.util.Log.i("MainViewModel", "Dropping Play confirm result: account changed")
                return@onSuccess
            }
            if (response.success) {
                if (showsResult) {
                    message = getApplication<android.app.Application>().getString(R.string.msg_gb_plan_applied)
                }
                refreshBillingAfterMutation(authorization, "google play confirm", ownerUserId)
                refreshAppSession()
                refreshSocial()
                // 커플/가족을 구매하면 초대·구성원 관리로 보내 '내 알람 맞추기 허용'·방해금지 시간을
                // 바로 확인·설정하게 한다. 코드 등록 경로는 이미 동일하게 이동한다. 개인/plus 구매는 기존대로 유지.
                // **구매에서만 이동한다** — 복원·정합화는 산 적이 없는데 화면이 튄다.
                if (origin == PurchaseConfirmOrigin.UserPurchase &&
                    response.planKey in setOf("couple", "family")
                ) {
                    navigateSharedPassTick++
                }
            } else if (showsResult) {
                message = getApplication<android.app.Application>().getString(R.string.msg_gb_payment_confirm_failed_retry)
            }
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to confirm Play purchase productId=$productId", error)
            if (showsResult && authSession?.user?.id == ownerUserId) {
                message = billingFailureMessage(
                    getApplication<android.app.Application>(),
                    apiErrorCode(error),
                    userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_gb_payment_confirm_failed)),
                )
            }
        }
        if (ownsBusy) billingBusy = false
    }
}

internal fun MainViewModel.ensureFamilyShareCode() {
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_create_share_code)) ?: return
    val planLabel = when (subscriptionResponse?.plan?.key) {
        "couple" -> getApplication<android.app.Application>().getString(R.string.msg_gb_plan_label_couple)
        "family" -> getApplication<android.app.Application>().getString(R.string.msg_gb_plan_label_family)
        else -> getApplication<android.app.Application>().getString(R.string.msg_gb_plan_label_shared)
    }
    val ownerUserId = authSession?.user?.id
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            api.ensureFamilyShareCode(authorization).voucher
        }.onSuccess { voucher ->
            // ⚠ **시작한 계정을 잡아 두고 발행 전에 본다**(2026-09-01 리뷰). 인자 자리에서
            // `authSession?.user?.id` 를 읽으면 **응답이 온 뒤** 평가돼 B 가 잡히고, 가드가
            // B==B 로 통과해 버린다 — A 의 코드가 B 화면에 뜨고 A 의 결제 데이터가 B 키로 저장된다.
            if (authSession?.user?.id != ownerUserId) {
                Log.i(TAG, "Dropping share code result: account changed")
                return@onSuccess
            }
            vouchers = listOf(voucher) + vouchers.filterNot { it.id == voucher.id }
            message = getApplication<android.app.Application>().getString(R.string.msg_gb_share_code_ready, planLabel)
            refreshBillingAfterMutation(authorization, "family share code", ownerUserId)
            refreshSocial()
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to ensure family share code", error)
            message = billingFailureMessage(
                getApplication<android.app.Application>(),
                apiErrorCode(error),
                userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_gb_share_code_load_failed, planLabel)),
            )
        }
        billingBusy = false
    }
}

internal fun MainViewModel.regenerateFamilyShareCode() {
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_create_share_code)) ?: return
    val planLabel = when (subscriptionResponse?.plan?.key) {
        "couple" -> getApplication<android.app.Application>().getString(R.string.msg_gb_plan_label_couple)
        "family" -> getApplication<android.app.Application>().getString(R.string.msg_gb_plan_label_family)
        else -> getApplication<android.app.Application>().getString(R.string.msg_gb_plan_label_shared)
    }
    val ownerUserId = authSession?.user?.id
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            api.regenerateFamilyShareCode(authorization).voucher
        }.onSuccess { voucher ->
            // ⚠ **시작한 계정을 잡아 두고 발행 전에 본다**(2026-09-01 리뷰). 인자 자리에서
            // `authSession?.user?.id` 를 읽으면 **응답이 온 뒤** 평가돼 B 가 잡히고, 가드가
            // B==B 로 통과해 버린다 — A 의 코드가 B 화면에 뜨고 A 의 결제 데이터가 B 키로 저장된다.
            if (authSession?.user?.id != ownerUserId) {
                Log.i(TAG, "Dropping regenerated share code result: account changed")
                return@onSuccess
            }
            // 새 코드를 즉시 노출. 만료된 옛 코드는 아래 새로고침에서 서버 기준으로 정리된다.
            vouchers = listOf(voucher) + vouchers.filterNot { it.id == voucher.id }
            message = getApplication<android.app.Application>().getString(R.string.msg_gb_share_code_regenerated, planLabel)
            refreshBillingAfterMutation(authorization, "regenerate family share code", ownerUserId)
            refreshSocial()
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to regenerate family share code", error)
            message = billingFailureMessage(
                getApplication<android.app.Application>(),
                apiErrorCode(error),
                userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_gb_share_code_load_failed, planLabel)),
            )
        }
        billingBusy = false
    }
}

private fun com.alarmtalk.app.network.BillingPlan.isSharedPassPlan(): Boolean =
    key in setOf("couple", "family") || planType in setOf("couple", "family")

// 서버가 스토어 구독을 직접 해지하지 못해 사용자를 스토어 구독 관리로 보내야 하는 에러 코드.
// 502(PLAY_*) / 409(STORE_CANCEL_UNSUPPORTED) 모두 서버·앱 상태 무변경 → 안내 다이얼로그만 띄운다.
private val STORE_MANAGE_REQUIRED_CODES = setOf(
    "PLAY_CANCEL_FAILED",
    "PLAY_REVOKE_FAILED",
    "STORE_CANCEL_UNSUPPORTED",
)

internal fun MainViewModel.cancelSubscription(atPeriodEnd: Boolean) {
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_generic)) ?: return
    val mode = if (atPeriodEnd) "at_period_end" else "immediate"
    val ownerUserId = authSession?.user?.id
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            api.cancelSubscription(authorization, CancelSubscriptionRequest(mode = mode))
        }.onSuccess { _ ->
            // ⚠ **시작한 계정을 잡아 두고 발행 전에 본다**(2026-09-01 리뷰). 인자 자리에서
            // `authSession?.user?.id` 를 읽으면 **응답이 온 뒤** 평가돼 B 가 잡히고, 가드가
            // B==B 로 통과해 버린다 — A 의 코드가 B 화면에 뜨고 A 의 결제 데이터가 B 키로 저장된다.
            if (authSession?.user?.id != ownerUserId) {
                Log.i(TAG, "Dropping subscription cancellation result: account changed")
                return@onSuccess
            }
            // 정책 변경: 해지해도 만든 목소리는 삭제하지 않고 잠근다 — 다시 이용권을 등록하면
            // 그대로 다시 쓸 수 있다(보관 후 삭제 안내 문구 제거).
            message = if (atPeriodEnd) {
                getApplication<android.app.Application>().getString(R.string.msg_gb_subscription_cancel_at_period_end)
            } else {
                getApplication<android.app.Application>().getString(R.string.msg_gb_subscription_canceled_voice_locked)
            }
            refreshBillingAfterMutation(authorization, "subscription cancellation", ownerUserId)
            refreshAppSession()
            refreshSocial()
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to cancel subscription mode=$mode", error)
            // errorBody 는 한 번만 읽히므로 apiError 로 code·manage_url 을 함께 추출한다.
            val apiFailure = apiError(error)
            if (apiFailure.code in STORE_MANAGE_REQUIRED_CODES) {
                // 서버·앱 상태 모두 무변경 — 스낵바 대신 Google Play 직접 관리 안내 다이얼로그.
                billingPlayManageUrl = apiFailure.manageUrl
                    ?: playSubscriptionManageUrl(subscriptionResponse?.plan?.key)
            } else {
                message = billingFailureMessage(getApplication<android.app.Application>(), apiFailure.code, userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_gb_subscription_cancel_failed)))
            }
        }
        billingBusy = false
    }
}

// 정책 변경: 무료 전환 시 유료 목소리/알람 데이터를 삭제하지 않고, 기존 유료 목소리 알람을
// 사운드온리로 '잠근다'(preLockPlayMode 에 원래 모드 보관). 다시 유료가 되면 그대로 복원한다.
// 새 목소리 알람 생성·TTS 합성은 유료 게이트가 이미 막는다.
internal fun MainViewModel.applyFreePlanVoiceLock() {
    // 이 강등을 확정한 계정을 코루틴 **밖에서** 잡아 함께 넘긴다 — 그 사이 계정이 바뀌면
    // 저장소가 그만둔다(Codex #665 P1). 안에서 읽으면 넘기는 값이 '확정한 계정' 이 아니라
    // '지금 계정' 이 되어 가드의 전제가 깨진다.
    val lockOwner = authSession?.user?.id
    viewModelScope.launch {
        runCatching {
            repository.lockPaidAlarmTalks(expectedOwnerUserId = lockOwner)
        }.onSuccess { locked ->
            if (locked > 0) {
                // ⚠ **토스트로 알리지 않는다**(2026-08-11 변경). 강등은 알람이 조용히 바뀌는
                // 큰 사건인데 토스트는 놓치기 쉽고, 이 자리는 화면이 없을 수도 있다.
                // 대기표에 적어 두고 앱이 보여줄 수 있을 때 모달로 띄운다.
                DowngradeNoticeStore(getApplication())
                    .record(lockOwner, DowngradeNoticeStore.Cause.FREE_PLAN, locked)
            }
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to lock paid voice alarms on free plan", error)
        }
    }
}

/** 다시 유료가 되면 무료 동안 사운드온리로 잠갔던 목소리 알람을 원래 모드로 복원한다. */
internal fun MainViewModel.restorePaidVoiceAlarmsIfLocked() {
    // ⚠ **유료로 돌아오면 무료 강등 안내만 비운다**(iOS `applyFreePlanVoiceLockIfNeeded` 와
    // 같은 이유). ① 확인 안 한 무료 강등 안내가 남아 있으면 이미 유료가 된 사람에게
    // "무료로 바뀌었어요" 를 띄우게 된다. ② 비워 둬야 다음에 다시 무료가 됐을 때 깨끗이
    // 다시 뜬다.
    // ⚠ **원인을 가려서 지운다**(Codex #703 P2). 예전에는 통째로 비워서, 다른 기기가 적어 둔
    // `VOICE_REPLACED`(이용권으로 복원되지 않는 안내)까지 사용자가 보기도 전에 사라졌다.
    DowngradeNoticeStore(getApplication())
        .clear(authSession?.user?.id, DowngradeNoticeStore.Cause.FREE_PLAN)
    viewModelScope.launch {
        runCatching {
            repository.unlockPaidAlarmTalks()
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to restore locked paid voice alarms", error)
        }
    }
}
