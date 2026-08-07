package com.alarmtalk.app

import android.app.Application
import android.util.Log
import androidx.lifecycle.viewModelScope
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.network.apiError
import com.alarmtalk.app.network.apiErrorCode
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.CancelSubscriptionRequest
import com.alarmtalk.app.network.ChangePlanRequest
import com.alarmtalk.app.network.CheckoutRequest
import com.alarmtalk.app.network.CodeRegisterRequest
import com.alarmtalk.app.network.GooglePlayConfirmRequest
import com.alarmtalk.app.network.PromoRedeemRequest
import com.alarmtalk.app.network.VoucherItem
import com.alarmtalk.app.R
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch


internal fun MainViewModel.refreshBilling() {
    refreshBillingData(showMessage = true)
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

private suspend fun MainViewModel.refreshBillingAfterMutation(
    authorization: String,
    reason: String,
) {
    runCatching {
        loadBillingSnapshot(authorization)
    }.onSuccess { snapshot ->
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

private fun promoRedeemFailureMessage(context: android.content.Context, errorCode: String?, fallback: String): String =
    when (errorCode) {
        // 바우처도 프로모도 아닌 코드 → 기존 "등록할 수 없는 코드" 문구 재사용.
        "CODE_NOT_FOUND" -> context.getString(R.string.msg2_code_fail_code_not_found)
        "CODE_INACTIVE" -> context.getString(R.string.msg2_promo_fail_code_inactive)
        "CODE_NOT_IN_WINDOW" -> context.getString(R.string.msg2_promo_fail_not_in_window)
        "CODE_ALREADY_REDEEMED_BY_YOU" -> context.getString(R.string.msg2_code_fail_code_already_redeemed_by_you)
        "CODE_EXHAUSTED" -> context.getString(R.string.msg2_promo_fail_code_exhausted)
        // 리딤 그룹(예: 웰컴 3종) — 같은 계열 코드를 이미 썼으면 다른 코드도 불가.
        "CODE_GROUP_ALREADY_REDEEMED" -> context.getString(R.string.msg2_promo_fail_group_already_redeemed)
        "OWNS_ACTIVE_GROUP" -> context.getString(R.string.msg2_promo_fail_owns_active_group)
        "ACTIVE_SUBSCRIPTION_EXISTS" -> context.getString(R.string.msg2_promo_fail_active_subscription)
        "PROMO_REDEEM_FAILED" -> context.getString(R.string.msg2_promo_fail_generic)
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
internal fun MainViewModel.registerCode(code: String, onResult: ((String?) -> Unit)? = null) {
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
            refreshBillingAfterMutation(authorization, "code registration")
            refreshSocial()
            refreshAppSession()
            // 서버가 판별한 type 기준: 초대(그룹 합류)거나 커플/가족 플랜이면 공유패스 갱신.
            val joinedSharedPass = response.type == "invite" ||
                response.type == "group_invite" ||
                response.plan.isSharedPassPlan()
            if (joinedSharedPass) {
                navigateSharedPassTick++
            } else {
                navigateHomeTick++
            }
            onResult?.invoke(null)
        }.onFailure { error ->
            if (authSession?.user?.id != ownerUserId) return@onFailure
            // errorBody 는 한 번만 읽히므로 error_code 를 먼저 한 번만 추출해 재사용한다.
            val errorCode = apiErrorCode(error)
            if (errorCode == "CODE_NOT_FOUND" || errorCode == "INVALID_FORMAT") {
                // 바우처 코드가 아니면 공용 프로모 코드로 폴백 시도한다. 바우처는 hash 조회
                // '전에' 형식(INV-/GIFT-...)을 먼저 검사하므로, 자유 문자열 프로모
                // 코드는 CODE_NOT_FOUND 가 아니라 INVALID_FORMAT 으로 떨어진다(둘 다 폴백 대상).
                // 그 외 에러(이미 사용 등)는 그대로 노출하고 폴백하지 않는다.
                redeemPromoCode(authorization, trimmedCode, ownerUserId, onResult)
            } else {
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
        }
        billingBusy = false
    }
}

/**
 * 공용 프로모 코드 사용. [registerCode] 의 바우처 등록이 CODE_NOT_FOUND 로 실패했을 때만
 * 폴백 호출된다(같은 코루틴·billingBusy 유지). 성공 시 바우처 성공과 동일하게 서버 기준으로
 * 구독/플랜을 재조회하고 홈(또는 공유패스)으로 이동한다.
 */
private suspend fun MainViewModel.redeemPromoCode(
    authorization: String,
    code: String,
    ownerUserId: String?,
    onResult: ((String?) -> Unit)?,
) {
    runCatching {
        api.redeemPromoCode(authorization, PromoRedeemRequest(code))
    }.onSuccess { response ->
        if (authSession?.user?.id != ownerUserId) return@onSuccess
        message = getApplication<android.app.Application>().getString(R.string.msg_gb_promo_redeemed)
        refreshBillingAfterMutation(authorization, "promo redeem")
        refreshSocial()
        refreshAppSession()
        if (response.plan.isSharedPassPlan()) {
            navigateSharedPassTick++
        } else {
            navigateHomeTick++
        }
        onResult?.invoke(null)
    }.onFailure { error ->
        if (authSession?.user?.id != ownerUserId) return@onFailure
        AlarmTalkLog.reportError("Failed to redeem promo code", error)
        val failure = promoRedeemFailureMessage(
            getApplication<android.app.Application>(),
            apiErrorCode(error),
            userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_gb_promo_redeem_failed)),
        )
        if (onResult != null) {
            onResult(failure)
        } else {
            message = failure
        }
    }
}

// 이용권 '선물' 결제는 UI 가 없다(선물은 GIFT- 코드 등록/공유 경로로만 쓴다). 남아 있던
// gift 인자와 그 분기를 걷었다 — 두 호출부 모두 기본값(false)으로만 불렀다.
internal fun MainViewModel.checkoutPlan(planKey: String) {
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_change_plan)) ?: return
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            api.checkoutPlan(authorization, CheckoutRequest(planKey = planKey))
        }.onSuccess { response ->
            response.subscription?.let { subscription ->
                val updatedSubscription = BillingSubscriptionResponse(
                    subscription = subscription,
                    plan = response.plan,
                )
                subscriptionResponse = updatedSubscription
                saveSubscriptionSnapshot(updatedSubscription)
            }
            response.voucher?.let { voucher ->
                vouchers = listOf(
                    VoucherItem(
                        id = voucher.id,
                        code = voucher.code,
                        planKey = response.plan.key,
                        planName = response.plan.name,
                        planType = response.plan.planType,
                        status = "issued",
                        expiresAt = voucher.expiresAt,
                        maxUses = voucher.maxUses,
                        useCount = voucher.useCount,
                    ),
                ) + vouchers
            }
            message = getApplication<android.app.Application>()
                .getString(R.string.msg_gb_plan_applied_named, response.plan.name)
            refreshBillingAfterMutation(authorization, "checkout")
            refreshAppSession()
            refreshSocial()
            if (response.plan.isSharedPassPlan()) {
                navigateSharedPassTick++
            } else {
                navigateHomeTick++
            }
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to checkout plan key=$planKey", error)
            val fallback = getApplication<android.app.Application>().getString(R.string.msg_gb_plan_apply_failed)
            message = billingFailureMessage(getApplication<android.app.Application>(), apiErrorCode(error), userFacingError(error, fallback))
        }
        billingBusy = false
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
internal fun MainViewModel.confirmGooglePurchase(purchaseToken: String, productId: String) {
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_apply_plan)) ?: run {
        billingBusy = false
        return
    }
    viewModelScope.launch {
        billingBusy = true
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
            if (response.success) {
                message = getApplication<android.app.Application>().getString(R.string.msg_gb_plan_applied)
                refreshBillingAfterMutation(authorization, "google play confirm")
                refreshAppSession()
                refreshSocial()
                // 커플/가족을 구매하면 초대·구성원 관리로 보내 '내 알람 맞추기 허용'·방해금지 시간을
                // 바로 확인·설정하게 한다. 코드 등록 경로는 이미 동일하게 이동한다. 개인/plus 구매는 기존대로 유지.
                if (response.planKey in setOf("couple", "family")) {
                    navigateSharedPassTick++
                }
            } else {
                message = getApplication<android.app.Application>().getString(R.string.msg_gb_payment_confirm_failed_retry)
            }
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to confirm Play purchase productId=$productId", error)
            message = billingFailureMessage(
                getApplication<android.app.Application>(),
                apiErrorCode(error),
                userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_gb_payment_confirm_failed)),
            )
        }
        billingBusy = false
    }
}

internal fun MainViewModel.ensureFamilyShareCode() {
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_create_share_code)) ?: return
    val planLabel = when (subscriptionResponse?.plan?.key) {
        "couple" -> getApplication<android.app.Application>().getString(R.string.msg_gb_plan_label_couple)
        "family" -> getApplication<android.app.Application>().getString(R.string.msg_gb_plan_label_family)
        else -> getApplication<android.app.Application>().getString(R.string.msg_gb_plan_label_shared)
    }
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            api.ensureFamilyShareCode(authorization).voucher
        }.onSuccess { voucher ->
            vouchers = listOf(voucher) + vouchers.filterNot { it.id == voucher.id }
            message = getApplication<android.app.Application>().getString(R.string.msg_gb_share_code_ready, planLabel)
            refreshBillingAfterMutation(authorization, "family share code")
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
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            api.regenerateFamilyShareCode(authorization).voucher
        }.onSuccess { voucher ->
            // 새 코드를 즉시 노출. 만료된 옛 코드는 아래 새로고침에서 서버 기준으로 정리된다.
            vouchers = listOf(voucher) + vouchers.filterNot { it.id == voucher.id }
            message = getApplication<android.app.Application>().getString(R.string.msg_gb_share_code_regenerated, planLabel)
            refreshBillingAfterMutation(authorization, "regenerate family share code")
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
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            api.cancelSubscription(authorization, CancelSubscriptionRequest(mode = mode))
        }.onSuccess { _ ->
            // 정책 변경: 해지해도 만든 목소리는 삭제하지 않고 잠근다 — 다시 이용권을 등록하면
            // 그대로 다시 쓸 수 있다(보관 후 삭제 안내 문구 제거).
            message = if (atPeriodEnd) {
                getApplication<android.app.Application>().getString(R.string.msg_gb_subscription_cancel_at_period_end)
            } else {
                getApplication<android.app.Application>().getString(R.string.msg_gb_subscription_canceled_voice_locked)
            }
            refreshBillingAfterMutation(authorization, "subscription cancellation")
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
                message = getApplication<android.app.Application>().getString(R.string.msg_gb_free_plan_voice_alarms_locked)
            }
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to lock paid voice alarms on free plan", error)
        }
    }
}

/** 다시 유료가 되면 무료 동안 사운드온리로 잠갔던 목소리 알람을 원래 모드로 복원한다. */
internal fun MainViewModel.restorePaidVoiceAlarmsIfLocked() {
    viewModelScope.launch {
        runCatching {
            repository.unlockPaidAlarmTalks()
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to restore locked paid voice alarms", error)
        }
    }
}

internal fun MainViewModel.changePlan(planKey: String, atPeriodEnd: Boolean) {
    val authorization = bearerOrMessage(getApplication<android.app.Application>().getString(R.string.msg_gb_login_required_generic)) ?: return
    val mode = if (atPeriodEnd) "at_period_end" else "immediate"
    viewModelScope.launch {
        billingBusy = true
        runCatching {
            api.changePlan(authorization, ChangePlanRequest(planKey = planKey, mode = mode))
        }.onSuccess { response ->
            if (response.requiresCheckout && response.planKey != null) {
                // 즉시 변경: 기존 해지된 상태이므로 곧바로 새 결제 진행.
                billingBusy = false
                checkoutPlan(response.planKey)
                return@onSuccess
            }
            message = if (atPeriodEnd) {
                getApplication<android.app.Application>().getString(R.string.msg_gb_plan_change_scheduled)
            } else {
                getApplication<android.app.Application>().getString(R.string.msg_gb_plan_changed)
            }
            refreshBillingAfterMutation(authorization, "plan change")
            refreshAppSession()
            refreshSocial()
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to change plan key=$planKey mode=$mode", error)
            val errorCode = apiErrorCode(error)
            if (errorCode == "NO_ACTIVE_SUBSCRIPTION") {
                message = billingFailureMessage(getApplication<android.app.Application>(), errorCode, getApplication<android.app.Application>().getString(R.string.msg_gb_no_active_subscription_apply_new))
                billingBusy = false
                checkoutPlan(planKey)
                return@onFailure
            }
            if (errorCode == "SAME_PLAN") {
                message = getApplication<android.app.Application>().getString(R.string.msg_gb_same_plan_in_use)
                refreshBillingAfterMutation(authorization, "same plan check")
                return@onFailure
            }
            message = billingFailureMessage(getApplication<android.app.Application>(), errorCode, userFacingError(error, getApplication<android.app.Application>().getString(R.string.msg_gb_plan_change_failed)))
        }
        billingBusy = false
    }
}
