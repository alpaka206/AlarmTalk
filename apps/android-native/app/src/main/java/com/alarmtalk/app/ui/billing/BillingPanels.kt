package com.alarmtalk.app

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.CardGiftcard
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.alarmtalk.app.R
import com.alarmtalk.app.WakerPillShape
import com.alarmtalk.app.billing.PlayBillingProducts
import com.alarmtalk.app.network.BillingPlan
import com.alarmtalk.app.network.BillingPlanSummary
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.BillingSubscription
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.VoucherItem
import kotlinx.coroutines.launch

@Composable
internal fun SubscriptionPanel(
    billingBusy: Boolean,
    subscriptionResponse: BillingSubscriptionResponse?,
    familyGroup: FamilyGroupCurrentResponse?,
    vouchers: List<VoucherItem>,
    /// planKey → **Play 가 준 표시가격**(`formattedPrice`, 지역 통화·세금 포함).
    ///
    /// ⚠ **없으면 빈 문자열로 둔다 — 앱에 박아 둔 숫자로 폴백하지 말 것.** 가격의 권위는
    /// 스토어다. 예전에는 `strings.xml` 의 `billing_plan_*_price`(월 3,900원 …)로
    /// 폴백했는데, Play 에서 가격을 바꾸거나 프로모션을 걸면 **앱이 틀린 가격을 자신
    /// 있게 보여줬다.** 지역·통화가 다른 사용자에게는 애초에 맞은 적도 없다.
    /// 모르면 숫자를 안 보여주는 게 맞다(카드는 :589 에서 빈 값을 알아서 숨긴다).
    planPrices: Map<String, String>,
    onPurchasePlay: (Activity, String) -> Unit,
    onGiftPersonal: (Activity) -> Unit,
    onCancelSubscription: (Boolean) -> Unit,
    onLeaveFamilyGroup: (String) -> Unit,
    onRefreshShareCodeData: suspend () -> List<VoucherItem>,
    onRestorePurchases: () -> Unit,
) {
    var purchaseTarget by remember { mutableStateOf<SubscriptionPlanOption?>(null) }
    var showCancelDialog by remember { mutableStateOf(false) }
    var showLeaveDialog by remember { mutableStateOf(false) }
    var shareTarget by remember { mutableStateOf<List<VoucherItem>>(emptyList()) }
    var shareBusy by remember { mutableStateOf(false) }
    val subscription = subscriptionResponse?.subscription
    val currentPlan = subscriptionResponse?.plan
    val nextPlan = subscriptionResponse?.nextPlan
    val hasActive = subscription != null && currentPlan != null
    val cancelScheduled = subscription?.cancelAtPeriodEnd == true
    val isSharedMember = familyGroup?.role == "member" && familyGroup.group != null
    val sharedGroupId = familyGroup?.group?.id
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    val options = listOf(
        // 감성 설명문 없이 핵심 혜택만 짧게 — 목소리 개수·인원처럼 판단에 필요한 사실 위주로 적는다.
        SubscriptionPlanOption(
            key = "free",
            name = stringResource(R.string.billing_plan_free_name),
            price = stringResource(R.string.billing_plan_free_price),
            description = "",
            features = listOf(
                stringResource(R.string.billing_plan_free_feature_basic_alarm),
                stringResource(R.string.billing_plan_free_feature_stock_voice),
            ),
        ),
        SubscriptionPlanOption(
            key = "personal",
            name = stringResource(R.string.billing_plan_personal_name),
            price = planPriceLabel(planPrices, "personal"),
            description = "",
            features = listOf(
                stringResource(R.string.billing_plan_personal_feature_voice),
                stringResource(R.string.billing_plan_personal_feature_daily_prompt),
            ),
        ),
        SubscriptionPlanOption(
            key = "couple",
            name = stringResource(R.string.billing_plan_couple_name),
            price = planPriceLabel(planPrices, "couple"),
            description = "",
            features = listOf(
                stringResource(R.string.billing_plan_feature_includes_personal),
                stringResource(R.string.billing_plan_couple_feature_voice_share),
                stringResource(R.string.billing_plan_couple_feature_message),
                stringResource(R.string.billing_plan_couple_feature_max_two),
            ),
        ),
        SubscriptionPlanOption(
            key = "family",
            name = stringResource(R.string.billing_plan_family_name),
            price = planPriceLabel(planPrices, "family"),
            description = "",
            features = listOf(
                stringResource(R.string.billing_plan_feature_includes_personal),
                stringResource(R.string.billing_plan_family_feature_voice_share),
                stringResource(R.string.billing_plan_family_feature_message),
                stringResource(R.string.billing_plan_family_feature_max_six),
            ),
        ),
    )
    fun shareVoucher(voucher: VoucherItem) {
        clipboard.setText(AnnotatedString(voucher.code))
        // INV- 는 가족·커플 합류, GIFT- 는 개인 이용권 선물 — 받는 사람이 할 일이 다르다.
        val kind = if (voucher.code.startsWith("GIFT-", ignoreCase = true)) {
            RedeemCodeKind.Gift
        } else {
            RedeemCodeKind.Invite
        }
        context.shareRedeemCode(voucher.code, kind)
    }
    fun openVoucherShare(vouchersForPlan: List<VoucherItem>) {
        if (vouchersForPlan.isNotEmpty()) {
            shareTarget = vouchersForPlan
        }
    }
    fun refreshAndOpenVoucherShare(planKey: String) {
        if (shareBusy) return
        scope.launch {
            shareBusy = true
            try {
                val refreshedVouchers = runCatching {
                    onRefreshShareCodeData()
                }.getOrElse {
                    vouchers
                }
                openVoucherShare(shareableVouchersForPlan(refreshedVouchers, planKey))
            } finally {
                shareBusy = false
            }
        }
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // 별도 '현재 이용권' 요약 카드 대신, 플랜 리스트의 현재 플랜 카드에 만료일 상태를 인라인으로 보여준다.
        val statusContext = LocalContext.current
        val currentExpiresAt = formatPass(subscription?.expiresAt, PassDateFormatter)
        val sharedMemberExpiresAt = formatPass(familyGroup?.group?.expiresAt, PassDateFormatter)
        val currentStatusText = when {
            isSharedMember && sharedMemberExpiresAt != null ->
                stringResource(R.string.billing_status_shared_member_until, sharedMemberExpiresAt)
            isSharedMember -> stringResource(R.string.billing_status_shared_member)
            cancelScheduled && nextPlan != null -> {
                val nextName = passPlanName(statusContext, nextPlan.key, nextPlan.name)
                if (currentExpiresAt != null) {
                    stringResource(R.string.billing_status_change_to_next_after_date, currentExpiresAt, nextName)
                } else {
                    stringResource(R.string.billing_status_change_to_next_scheduled, nextName)
                }
            }
            cancelScheduled -> {
                if (currentExpiresAt != null) {
                    stringResource(R.string.billing_status_end_after_date, currentExpiresAt)
                } else {
                    stringResource(R.string.billing_status_end_scheduled)
                }
            }
            hasActive && currentExpiresAt != null -> stringResource(R.string.billing_status_available_until, currentExpiresAt)
            hasActive -> stringResource(R.string.billing_status_in_use)
            else -> null
        }

        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            options.forEach { option ->
                val currentKey = currentPlan?.key ?: "free"
                val isCurrent = currentKey == option.key
                val vouchersForPlan = shareableVouchersForPlan(vouchers, option.key)
                SubscriptionPlanCard(
                    option = option,
                    isCurrent = isCurrent,
                    currentStatusText = currentStatusText.takeIf { isCurrent },
                    hasActiveSubscription = hasActive,
                    busy = billingBusy || shareBusy,
                    vouchers = vouchersForPlan,
                    onPurchase = { purchaseTarget = option },
                    onShareVouchers = { refreshAndOpenVoucherShare(option.key) },
                    extraAction = if (option.key == "personal") {
                        @Composable { ->
                            // ⚠ **`wakerCardBorder()` 로 되돌리지 말 것.** 그 테두리는
                            // 카드 위에서 거의 안 보인다 — 현재 이용권 카드는 배경이
                            // `primaryContainer` 라 옅은 회색 선이 묻힌다(2026-08-11 지적
                            // "현재 이용권이 개인일 때 좀 안 보인다"). 강조색 테두리 + 옅은
                            // 채움으로 두 배경(현재 카드/일반 카드) 모두에서 읽히게 한다.
                            //
                            // ⚠ 채워진 버튼으로 만들지는 말 것 — 결제 버튼과 무게가 같아져
                            // 어느 것이 주 액션인지 흐려진다. 선물은 부가 액션이다.
                            OutlinedButton(
                                onClick = {
                                    val activity = context.findActivity()
                                    if (!billingBusy && activity != null) onGiftPersonal(activity)
                                },
                                enabled = !billingBusy,
                                modifier = Modifier.fillMaxWidth(),
                                shape = WakerButtonShape,
                                border = BorderStroke(
                                    1.dp,
                                    MaterialTheme.colorScheme.primary.copy(alpha = 0.55f),
                                ),
                                colors = ButtonDefaults.outlinedButtonColors(
                                    containerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.08f),
                                    contentColor = MaterialTheme.colorScheme.primary,
                                ),
                            ) {
                                // iOS 는 `Label(..., systemImage: "gift")` 로 아이콘을
                                // 달고 있었다 — 안드로이드만 글자뿐이라 눈에 덜 걸렸다.
                                Icon(
                                    imageVector = Icons.Outlined.CardGiftcard,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp),
                                )
                                Spacer(modifier = Modifier.width(ButtonDefaults.IconSpacing))
                                Text(stringResource(R.string.billing_gift_personal_action))
                            }
                        }
                    } else {
                        null
                    },
                )
            }
        }

        // 선물하기 — 개인 이용권 1개월을 **결제해서** 코드로 만든다.
        // ⚠ 무결제 발급이 아니다(서버가 production 에서 막는다). 1회성 인앱 상품을 산다.
        // ⚠ **'개인 이용권 선물하기' 를 별도 섹션으로 되돌리지 말 것**(2026-08-11 요청).
        // 이제 **개인 플랜 카드 안**, 결제 버튼 바로 아래에 있다 — 무엇을 선물하는지가
        // 카드 제목으로 자명해진다. 아이폰이 그렇게 돼 있다.

        // 코드 등록(선물 이용권·프로모션·초대)은 '전체' 탭 통합 입력에서만 받는다 — 이용권 화면 중복 제거.

        // **이전 구매 복원 — 항상 보인다.** 이용권이 있든 없든 필요하다: 기기를 바꾸거나
        // 다른 경로로 로그인해 서버에 결제 기록이 없을 때, 여기가 없으면 사용자가 할 수 있는
        // 일이 '다시 결제' 뿐이라 **같은 구독을 두 번 사게 된다**(플레이스토어에도 같은 기능이
        // 있고, 애플은 심사 지침 3.1.1 로 요구한다).
        // ⚠ 폭은 다른 액션과 같은 `fillMaxWidth` 다 — 글자 폭에 맞춘 작은 버튼으로 두면
        // 결제 버튼들 사이에서 눌러야 할 것으로 보이지 않는다(2026-08-17 지시).
        //
        // ⚠ **해지·나가기보다 위다**(2026-08-24 지시). 되돌릴 수 있는 액션(복원)을 위에,
        // 되돌릴 수 없는 액션(해지·나가기)을 맨 아래에 둔다 — 실수로 누를 확률이 낮아지고,
        // 목록의 마지막이 가장 무거운 액션이라는 순서가 다른 화면과도 맞는다.
        OutlinedButton(
            onClick = onRestorePurchases,
            enabled = !billingBusy,
            modifier = Modifier.fillMaxWidth(),
            shape = WakerButtonShape,
            border = wakerCardBorder(),
            colors = wakerOutlinedButtonColors(),
        ) {
            // ⚠ **글리프는 머티리얼을 쓴다**(CLAUDE.md 「글리프와 글자 크기 동작은 각 OS 것을
            // 쓴다」). iOS 는 SF 심볼 `arrow.clockwise.circle` 인데, 통일하는 것은 **뜻과
            // 자리**(어떤 액션에 어떤 아이콘을 쓰는가)이지 그림 자체가 아니다.
            Icon(
                imageVector = Icons.Outlined.Refresh,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(stringResource(R.string.billing_restore_purchases))
        }
        if (hasActive) {
            OutlinedButton(
                onClick = {
                    if (isSharedMember) showLeaveDialog = true else showCancelDialog = true
                },
                enabled = !billingBusy,
                modifier = Modifier.fillMaxWidth(),
                shape = WakerButtonShape,
                border = wakerCardBorder(),
                colors = wakerOutlinedButtonColors(),
            ) {
                // 해지와 나가기는 **같은 글리프**를 쓴다(2026-08-24 지시). 둘 다 '이 이용권에서
                // 빠져나간다' 는 같은 뜻이고, 한 자리에서 갈리는 if/else 라 아이콘까지 다르면
                // 같은 버튼이 상태에 따라 다른 것으로 보인다.
                Icon(
                    imageVector = Icons.AutoMirrored.Outlined.Logout,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.error,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = if (isSharedMember) {
                        stringResource(R.string.billing_leave_shared_pass)
                    } else {
                        stringResource(R.string.billing_cancel_pass)
                    },
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
        // 상시 'Google Play 구독 관리' 링크는 제거 — 쿠폰/서버 부여 이용권 사용자에겐 Play 구독이
        // 없어 빈 화면만 열리는 혼란이 있었다. 스토어 해지가 필요한 경우(PLAY_CANCEL_FAILED 등)는
        // 해지 실패 다이얼로그가 manage URL 로 안내하는 폴백 경로가 그대로 남아 있다.
        // 정책 변경: 무료 전환 시 유료 음성 데이터를 삭제하지 않고 보존·잠금하므로
        // '지금 삭제' 파괴적 액션은 제거했다(다시 이용권을 등록하면 그대로 복구된다).
    }

    purchaseTarget?.let { option ->
        PlayPurchaseDialog(
            target = option,
            // 이미 이용권이 있으면 이건 '시작' 이 아니라 '전환' 이다.
            currentPlanKey = currentPlan?.key.takeIf { hasActive },
            busy = billingBusy,
            onDismiss = { purchaseTarget = null },
            onPurchase = {
                val productId = PlayBillingProducts.productIdFor(option.key)
                purchaseTarget = null
                val activity = context.findActivity()
                if (productId != null && activity != null) {
                    onPurchasePlay(activity, productId)
                }
            },
        )
    }

    if (showCancelDialog) {
        CancelSubscriptionDialog(
            subscription = subscription,
            onDismiss = { showCancelDialog = false },
            onConfirm = { atPeriodEnd ->
                showCancelDialog = false
                onCancelSubscription(atPeriodEnd)
            },
        )
    }

    if (showLeaveDialog && sharedGroupId != null) {
        IosAlertDialog(
            title = stringResource(R.string.billing_leave_shared_pass),
            message = stringResource(R.string.billing_leave_shared_pass_description),
            onDismiss = { showLeaveDialog = false },
            actions = listOf(
                IosAlertAction(
                    label = stringResource(R.string.social_cancel_button),
                    onClick = { showLeaveDialog = false },
                ),
                IosAlertAction(
                    label = stringResource(R.string.billing_leave_button),
                    destructive = true,
                    onClick = {
                        showLeaveDialog = false
                        onLeaveFamilyGroup(sharedGroupId)
                    },
                ),
            ),
        )
    }


    if (shareTarget.isNotEmpty()) {
        // ⚠ **이건 알럿이 아니라 목록이다** — 바우처 중 하나를 고르는 화면이라
        // 선택 시트가 맞다(CLAUDE.md 「모달 세 형태」). 예전에는 결제 전용 사설
        // 껍데기를 써서 같은 '고르기' 인데 공휴일·목소리 고르기와 다르게 보였다.
        WakerSelectionSheet(
            title = stringResource(R.string.billing_share_voucher_select_title),
            subtitle = stringResource(R.string.billing_share_voucher_select_description),
            onDismiss = { shareTarget = emptyList() },
        ) { _ ->
            Column(
                modifier = Modifier.padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                shareTarget.forEach { voucher ->
                    val issuedAtLabel = formatVoucherIssuedAt(voucher.issuedAt)
                    val subtitle = if (issuedAtLabel != null) {
                        stringResource(R.string.billing_voucher_unregistered_with_date, issuedAtLabel)
                    } else {
                        stringResource(R.string.billing_voucher_unregistered)
                    }
                    CompactActionRow(
                        title = voucher.code,
                        subtitle = subtitle,
                        actionLabel = stringResource(R.string.billing_share_button),
                        enabled = true,
                        onAction = {
                            shareTarget = emptyList()
                            shareVoucher(voucher)
                        },
                    )
                }
            }
        }
    }
}

/**
 * Google Play 구독 결제 시작 다이얼로그 (월간 구독만 판매).
 * 제목=결론("시작할까요?"), 본문=가격·해지 안내 규칙을 따른다.
 */
@Composable
private fun PlayPurchaseDialog(
    target: SubscriptionPlanOption,
    /** 지금 쓰고 있는 유료 플랜 key. null 이면 신규 구매다. */
    currentPlanKey: String?,
    busy: Boolean,
    onDismiss: () -> Unit,
    onPurchase: () -> Unit,
) {
    // ⚠ **전환을 '시작' 이라고 말하지 말 것.** 카드 버튼은 '이용권 변경' 인데 모달은
    // "…이용권을 시작할까요?" 였다(2026-08-11 실기기 확인). 게다가 **언제 바뀌는지**를
    // 한마디도 안 했다 — 다운그레이드는 지금 과금되지 않고 다음 갱신일에 바뀌는데,
    // 그걸 모르면 누르고 나서 "아무 일도 안 일어난다" 로 읽는다.
    // 시점은 Play 가 정하므로 우리가 **고르게 하지는 않되, 알려는 준다**.
    val isChange = currentPlanKey != null && currentPlanKey != target.key
    val upgrade = isChange && PlayBillingProducts.isUpgrade(
        PlayBillingProducts.productIdFor(currentPlanKey!!) ?: "",
        PlayBillingProducts.productIdFor(target.key) ?: "",
    )
    // 정원이 줄면 사람이 빠진다 — 누르기 전에 말해야 되돌릴 기회가 있다.
    val losesSeats = isChange && !upgrade && planSeats(target.key) < planSeats(currentPlanKey!!)

    IosAlertDialog(
        title = if (isChange) {
            stringResource(R.string.billing_play_change_title, target.name)
        } else {
            stringResource(R.string.billing_play_purchase_title, target.name)
        },
        // ⚠ 가격은 스토어가 권위라 **없을 수도 있다**(Play 조회 실패·미출시 상품).
        // 그때 가격 자리에 빈 문자열을 끼우면 "개인 이용권은 이에요." 가 된다 —
        // 숫자를 모를 땐 가격을 말하지 않는 문장을 쓴다. 실제 금액은 Play 결제
        // 시트가 어차피 다시 보여준다.
        message = when {
            isChange -> buildString {
                append(
                    stringResource(
                        if (upgrade) R.string.billing_play_change_upgrade
                        else R.string.billing_play_change_downgrade,
                        target.name,
                    ),
                )
                if (losesSeats) {
                    append(" ")
                    append(stringResource(R.string.billing_play_change_seats_warning))
                }
            }
            target.price.isBlank() ->
                stringResource(R.string.billing_play_purchase_description_no_price, target.name)
            else ->
                stringResource(R.string.billing_play_purchase_description, target.name, target.price)
        },
        onDismiss = onDismiss,
        actions = listOf(
            IosAlertAction(
                label = stringResource(R.string.social_cancel_button),
                onClick = onDismiss,
            ),
            IosAlertAction(
                label = stringResource(R.string.billing_monthly_subscription),
                emphasized = true,
                // 결제 요청이 도는 동안 잠근다 — 두 번 눌러 같은 결제가 두 번 열리면 안 된다.
                enabled = !busy,
                onClick = onPurchase,
            ),
        ),
    )
}

/**
 * 그 플랜이 **함께 쓸 수 있는 인원**. 백엔드 `plans.max_members` 와 같은 값이다.
 * 정원이 줄어드는 전환인지 판단하는 데만 쓴다.
 */
private fun planSeats(planKey: String): Int = when (planKey) {
    "family" -> 5
    "couple" -> 2
    else -> 1
}

/** Compose Context 에서 결제 시트 호출에 필요한 Activity 를 찾는다. */
private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

@Composable
private fun PlanFeatureRow(text: String) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(6.dp)
                .background(MaterialTheme.colorScheme.primary, CircleShape),
        )
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
internal fun SubscriptionPlanCard(
    option: SubscriptionPlanOption,
    isCurrent: Boolean,
    hasActiveSubscription: Boolean,
    busy: Boolean,
    vouchers: List<VoucherItem>,
    onPurchase: () -> Unit,
    onShareVouchers: () -> Unit,
    // 현재 플랜 카드에만 붙는 만료/전환 상태 한 줄 (예: "7월 20일까지 이용할 수 있어요").
    currentStatusText: String? = null,
    /**
     * 카드 안 결제 버튼 **아래**에 붙는 부가 액션(개인 이용권 선물하기).
     *
     * ⚠ **화면 아래 별도 섹션으로 되돌리지 말 것**(2026-08-11 요청). 선물은 '개인 이용권'
     * 을 주는 일이라 그 카드 안에 있어야 무엇을 선물하는지가 자명하다 — 아래로 떼어 놓으면
     * 어느 플랜을 선물하는지 제목을 읽어야 알 수 있었다. 아이폰이 그렇게 돼 있다.
     */
    extraAction: (@Composable ColumnScope.() -> Unit)? = null,
) {
    OutlinedCard(
        shape = WakerCardShape,
        border = BorderStroke(
            width = 1.dp,
            color = if (isCurrent) {
                MaterialTheme.colorScheme.primary.copy(alpha = 0.48f)
            } else {
                MaterialTheme.colorScheme.outlineVariant
            },
        ),
        colors = CardDefaults.outlinedCardColors(
            containerColor = if (isCurrent) {
                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.44f)
            } else {
                MaterialTheme.colorScheme.surface
            },
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // ⚠ **이름과 요금을 한 덩어리로 묶지 말 것**(2026-08-17 지시 "아이폰처럼").
                // 예전에는 둘을 간격 4의 안쪽 Column 에 넣어 거의 붙어 있었는데, iOS 는
                // 요금이 카드 VStack 의 형제라 **다른 줄들과 같은 12** 를 받는다.
                // 그래서 같은 카드가 안드로이드에서만 위쪽이 빽빽해 보였다.
                Text(
                    text = option.name,
                    // iOS `.headline` = 17 semibold. `titleMedium`(16 Bold)이 아니다.
                    style = MaterialTheme.typography.titleMedium.copy(fontSize = 17.sp),
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                if (isCurrent) {
                    Surface(
                        shape = WakerPillShape,
                        color = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary,
                    ) {
                        Text(
                            text = stringResource(R.string.billing_current_pass_label),
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }
            if (option.price.isNotBlank()) {
                Text(
                    text = option.price,
                    // iOS `.subheadline.weight(.semibold)` = 15 semibold.
                    style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp),
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            if (isCurrent && currentStatusText != null) {
                Text(
                    text = currentStatusText,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            if (option.description.isNotBlank()) {
                MutedText(option.description)
            }
            Column(
                modifier = Modifier.padding(bottom = 6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                option.features.forEach { feature ->
                    PlanFeatureRow(feature)
                }
            }
            // ⚠ **`BuildConfig.FLAVOR == "dev"` 게이트를 되살리지 말 것**(2026-08-11 제거).
            // 그 게이트는 서버 주도 `/billing/change-plan`(스텁 결제 전용, 운영에서 항상 409)
            // 때문에 있었다. 이제 전환은 **Play 결제 시트**가 처리하므로 운영에서도 동작한다 —
            // 활성 구독이 있든 없든 같은 `onPurchase` 로 보낸다.
            //
            // 시점은 Play 가 정한다: 업그레이드는 즉시+비례정산, 다운그레이드는 다음 갱신일
            // (`PlayBillingManager` 가 방향을 보고 교체 모드를 고른다). 그래서 우리가
            // '지금/종료일' 을 묻는 모달을 두지 않는다 — `docs/spec/billing-lifecycle.md`.
            if (option.key != "free" && !isCurrent) {
                Button(
                    onClick = onPurchase,
                    enabled = !busy,
                    colors = wakerButtonColors(),
                    modifier = Modifier.fillMaxWidth(),
                    shape = WakerButtonShape,
                ) {
                    Text(
                        if (hasActiveSubscription) {
                            stringResource(R.string.billing_change_pass)
                        } else {
                            stringResource(R.string.billing_select_button)
                        },
                    )
                }
            }
            // 결제 버튼 **바로 아래** 부가 액션(개인 이용권 선물하기 등).
            extraAction?.invoke(this)

            // 코드 공유는 '현재 이용권' 카드에서만 — 해지/강등 후 옛 코드가 남아 있어도
            // (서버가 만료 처리하지만 우회 데이터 방어) 무료 사용자에게 공유 버튼이 뜨지 않게.
            if (isCurrent && vouchers.isNotEmpty()) {
                OutlinedButton(
                    onClick = onShareVouchers,
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth(),
                    shape = WakerButtonShape,
                    border = wakerCardBorder(),
                    colors = wakerOutlinedButtonColors(),
                ) {
                    Text(stringResource(R.string.billing_share_voucher_code))
                }
            }
        }
    }
}

private fun shareableVouchersForPlan(
    vouchers: List<VoucherItem>,
    planKey: String,
): List<VoucherItem> =
    vouchers.filter { voucher ->
        voucher.status in listOf("issued", "active", "pending") &&
            voucher.useCount < voucher.maxUses &&
            voucher.planKey == planKey
    }

/**
 * 해지 2단계 플로우: (1) 해지 시점 선택 → (2) 즉시 해지는 비례 환불·음성 30일 보관을
 * 한 번 더 확인하고 나서야 실행한다(파괴적 액션 재확인).
 */
@Composable
private fun CancelSubscriptionDialog(
    subscription: BillingSubscription?,
    onDismiss: () -> Unit,
    onConfirm: (atPeriodEnd: Boolean) -> Unit,
) {
    var confirmImmediate by remember { mutableStateOf(false) }
    val endDate = formatPass(subscription?.expiresAt, PassShortDateFormatter)
    // 로그아웃 확인과 같은 iOS 알럿 스타일(IosAlertDialog)로 통일 — 확인형 모달은 전부 이 계열.
    if (confirmImmediate) {
        IosAlertDialog(
            title = stringResource(R.string.billing_cancel_immediate_title),
            message = stringResource(R.string.billing_cancel_immediate_description),
            onDismiss = onDismiss,
            actions = listOf(
                IosAlertAction(
                    label = stringResource(R.string.social_cancel_button),
                    onClick = onDismiss,
                ),
                IosAlertAction(
                    label = stringResource(R.string.billing_cancel_now),
                    emphasized = true,
                    destructive = true,
                    onClick = { onConfirm(false) },
                ),
            ),
        )
        return
    }
    val finalDescription = if (endDate != null) {
        stringResource(R.string.billing_cancel_description_with_date, endDate)
    } else {
        stringResource(R.string.billing_cancel_description_no_date)
    }
    IosAlertDialog(
        title = stringResource(R.string.billing_cancel_dialog_title),
        message = finalDescription,
        onDismiss = onDismiss,
        actions = listOf(
            IosAlertAction(
                label = endDate?.let { stringResource(R.string.billing_cancel_at_date, it) }
                    ?: stringResource(R.string.billing_cancel_at_end_date),
                onClick = { onConfirm(true) },
            ),
            IosAlertAction(
                label = stringResource(R.string.billing_cancel_now),
                destructive = true,
                onClick = { confirmImmediate = true },
            ),
            IosAlertAction(
                label = stringResource(R.string.social_cancel_button),
                onClick = onDismiss,
            ),
        ),
    )
}

/**
 * 서버가 스토어 구독을 직접 해지하지 못했을 때(PLAY_CANCEL_FAILED 등)의 안내.
 * 앱·서버 상태는 무변경이므로 여기서는 Google Play 구독 관리로 보내기만 한다.
 */
@Composable
internal fun PlayStoreManageDialog(
    manageUrl: String,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    IosAlertDialog(
        title = stringResource(R.string.billing_play_manage_title),
        message = stringResource(R.string.billing_play_manage_description),
        onDismiss = onDismiss,
        actions = listOf(
            IosAlertAction(
                label = stringResource(R.string.social_cancel_button),
                onClick = onDismiss,
            ),
            IosAlertAction(
                label = stringResource(R.string.billing_play_manage_open),
                emphasized = true,
                onClick = {
                    onDismiss()
                    runCatching {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(manageUrl)))
                    }
                },
            ),
        ),
    )
}


/**
 * 스토어에서 가격을 못 받았을 때 쓰는 **폴백 가격**.
 *
 * ⚠ **스토어 가격이 언제나 이긴다.** 이건 "값이 아예 없어서 빈칸으로 보이는" 것을 막는
 * 안전망일 뿐이다(2026-08-11 결정). 스토어가 값을 주면 그걸 쓴다 — 지역 통화·세금·
 * 프로모션이 반영된 값이라 그쪽이 정확하다.
 *
 * ⚠ **숫자의 출처는 백엔드 `plans.price_krw` 다**(`packages/backend/src/lib/migrations.ts`
 * 의 personal 3900 / couple 6900 / family 14900). 거기를 바꾸면 여기도 바꾼다 —
 * 서버는 **현재 플랜 하나**만 내려주기 때문에 목록 화면에서는 이 표가 필요하다.
 *
 * ⚠ 한국 밖 사용자에게는 이 값이 틀릴 수 있다. 그래서 폴백이고, 실제 결제 금액은
 * 스토어 결제 시트가 다시 보여준다.
 */
private val FallbackPlanPriceKrw = mapOf(
    "personal" to 3900,
    "couple" to 6900,
    "family" to 14900,
)

/** 스토어 가격이 있으면 그걸, 없으면 폴백을 "월 3,900원" 꼴로 준다. */
private fun planPriceLabel(planPrices: Map<String, String>, key: String): String {
    planPrices[key]?.takeIf { it.isNotBlank() }?.let { return it }
    val krw = FallbackPlanPriceKrw[key] ?: return ""
    return "월 %,d원".format(krw)
}

