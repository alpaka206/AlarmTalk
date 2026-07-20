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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
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
    // planKey → Play 실제 표시가격(formattedPrice). 비어 있으면 문자열 리소스로 폴백.
    planPrices: Map<String, String>,
    onCheckoutPlan: (String, Boolean) -> Unit,
    onPurchasePlay: (Activity, String) -> Unit,
    onCancelSubscription: (Boolean) -> Unit,
    onChangePlan: (String, Boolean) -> Unit,
    onLeaveFamilyGroup: (String) -> Unit,
    onRefreshShareCodeData: suspend () -> List<VoucherItem>,
) {
    var purchaseTarget by remember { mutableStateOf<SubscriptionPlanOption?>(null) }
    var changeTarget by remember { mutableStateOf<SubscriptionPlanOption?>(null) }
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
            price = planPrices["personal"] ?: stringResource(R.string.billing_plan_personal_price),
            description = "",
            features = listOf(
                stringResource(R.string.billing_plan_personal_feature_voice),
                stringResource(R.string.billing_plan_personal_feature_daily_prompt),
            ),
        ),
        SubscriptionPlanOption(
            key = "couple",
            name = stringResource(R.string.billing_plan_couple_name),
            price = planPrices["couple"] ?: stringResource(R.string.billing_plan_couple_price),
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
            price = planPrices["family"] ?: stringResource(R.string.billing_plan_family_price),
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
        val sendIntent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, voucher.code)
        }
        context.startActivity(
            Intent.createChooser(sendIntent, context.getString(R.string.billing_voucher_share_chooser_title)),
        )
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
                    onChange = { changeTarget = option },
                    onShareVouchers = { refreshAndOpenVoucherShare(option.key) },
                )
            }
        }

        // 코드 등록(선물 이용권·프로모션·초대)은 '전체' 탭 통합 입력에서만 받는다 — 이용권 화면 중복 제거.

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
        // 앱 내 해지가 막혀도 항상 열리는 대체 경로 — Google Play 구독 관리 바로가기.
        // (클라는 결제 수단을 모르므로 활성 구독 소유자 전원에게 노출한다.)
        if (hasActive && !isSharedMember) {
            TextButton(
                onClick = {
                    runCatching {
                        context.startActivity(
                            Intent(Intent.ACTION_VIEW, Uri.parse(playSubscriptionManageUrl(currentPlan?.key))),
                        )
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                shape = WakerButtonShape,
            ) {
                Text(
                    text = stringResource(R.string.billing_manage_on_google_play),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        // 정책 변경: 무료 전환 시 유료 음성 데이터를 삭제하지 않고 보존·잠금하므로
        // '지금 삭제' 파괴적 액션은 제거했다(다시 이용권을 등록하면 그대로 복구된다).
    }

    purchaseTarget?.let { option ->
        PlayPurchaseDialog(
            target = option,
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
        BillingActionDialog(
            title = stringResource(R.string.billing_leave_shared_pass),
            description = stringResource(R.string.billing_leave_shared_pass_description),
            onDismiss = { showLeaveDialog = false },
        ) {
            BillingDialogButton(
                label = stringResource(R.string.billing_leave_button),
                primary = true,
                destructive = true,
                onClick = {
                    showLeaveDialog = false
                    onLeaveFamilyGroup(sharedGroupId)
                },
            )
        }
    }

    changeTarget?.let { option ->
        ChangePlanDialog(
            target = option,
            onDismiss = { changeTarget = null },
            onConfirm = { atPeriodEnd ->
                changeTarget = null
                onChangePlan(option.key, atPeriodEnd)
            },
        )
    }

    if (shareTarget.isNotEmpty()) {
        BillingActionDialog(
            title = stringResource(R.string.billing_share_voucher_select_title),
            description = stringResource(R.string.billing_share_voucher_select_description),
            onDismiss = { shareTarget = emptyList() },
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
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
    busy: Boolean,
    onDismiss: () -> Unit,
    onPurchase: () -> Unit,
) {
    BillingActionDialog(
        title = stringResource(R.string.billing_play_purchase_title, target.name),
        description = stringResource(R.string.billing_play_purchase_description, target.name, target.price),
        onDismiss = onDismiss,
    ) {
        BillingDialogButton(
            label = stringResource(R.string.billing_monthly_subscription),
            primary = true,
            onClick = { if (!busy) onPurchase() },
        )
    }
}

/** Compose Context 에서 결제 시트 호출에 필요한 Activity 를 찾는다. */
private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

@Composable
private fun BillingActionDialog(
    title: String,
    description: String,
    onDismiss: () -> Unit,
    content: @Composable () -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            shape = WakerDialogShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = wakerCardBorder(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(22.dp),
            ) {
                // 설명은 마침표(". ") 단위로 줄바꿈해 한 문장씩 읽기 쉽게 보여준다.
                val formattedDescription = remember(description) {
                    description.replace(". ", ".\n")
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text(
                            text = title,
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            text = formattedDescription,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            lineHeight = 20.sp,
                        )
                    }
                    IconButton(
                        onClick = onDismiss,
                        modifier = Modifier.size(42.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Close,
                            contentDescription = stringResource(R.string.billing_close),
                        )
                    }
                }
                content()
            }
        }
    }
}

@Composable
private fun BillingDialogButton(
    label: String,
    primary: Boolean,
    modifier: Modifier = Modifier.fillMaxWidth(),
    destructive: Boolean = false,
    onClick: () -> Unit,
) {
    if (primary) {
        Button(
            onClick = onClick,
            modifier = modifier,
            shape = WakerButtonShape,
            colors = if (destructive) {
                ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.error,
                    contentColor = MaterialTheme.colorScheme.onError,
                )
            } else {
                ButtonDefaults.buttonColors()
            },
        ) {
            Text(label)
        }
    } else {
        OutlinedButton(
            onClick = onClick,
            modifier = modifier,
            shape = WakerButtonShape,
            border = wakerCardBorder(),
            colors = wakerOutlinedButtonColors(),
        ) {
            Text(label)
        }
    }
}

@Composable
private fun BillingDialogButtonRow(content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        content()
    }
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
    onChange: () -> Unit,
    onShareVouchers: () -> Unit,
    // 현재 플랜 카드에만 붙는 만료/전환 상태 한 줄 (예: "7월 20일까지 이용할 수 있어요").
    currentStatusText: String? = null,
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
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        text = option.name,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                    if (option.price.isNotBlank()) {
                        Text(
                            text = option.price,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
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
            // 이용권 변경(/billing/change-plan)은 스텁 결제 전용이라 dev 에서만 노출한다.
            // 운영 Play 결제에서는 CHECKOUT_DISABLED 로 항상 실패하므로, Play 구독 교체
            // (업/다운그레이드) 플로우가 붙기 전까지 변경 버튼을 숨긴다.
            val changePlanSupported = BuildConfig.FLAVOR == "dev"
            if (option.key != "free" && !isCurrent && (!hasActiveSubscription || changePlanSupported)) {
                Button(
                    onClick = if (hasActiveSubscription) onChange else onPurchase,
                    enabled = !busy,
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
            if (vouchers.isNotEmpty()) {
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
    if (confirmImmediate) {
        BillingActionDialog(
            title = stringResource(R.string.billing_cancel_immediate_title),
            description = stringResource(R.string.billing_cancel_immediate_description),
            onDismiss = onDismiss,
        ) {
            BillingDialogButton(
                label = stringResource(R.string.billing_cancel_now),
                primary = true,
                destructive = true,
                onClick = { onConfirm(false) },
            )
        }
        return
    }
    val finalDescription = if (endDate != null) {
        stringResource(R.string.billing_cancel_description_with_date, endDate)
    } else {
        stringResource(R.string.billing_cancel_description_no_date)
    }
    BillingActionDialog(
        title = stringResource(R.string.billing_cancel_dialog_title),
        description = finalDescription,
        onDismiss = onDismiss,
    ) {
        BillingDialogButtonRow {
            BillingDialogButton(
                label = endDate?.let { stringResource(R.string.billing_cancel_at_date, it) }
                    ?: stringResource(R.string.billing_cancel_at_end_date),
                primary = false,
                modifier = Modifier.weight(1f),
                onClick = { onConfirm(true) },
            )
            BillingDialogButton(
                label = stringResource(R.string.billing_cancel_now),
                primary = true,
                destructive = true,
                modifier = Modifier.weight(1f),
                onClick = { confirmImmediate = true },
            )
        }
    }
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
    BillingActionDialog(
        title = stringResource(R.string.billing_play_manage_title),
        description = stringResource(R.string.billing_play_manage_description),
        onDismiss = onDismiss,
    ) {
        BillingDialogButton(
            label = stringResource(R.string.billing_play_manage_open),
            primary = true,
            onClick = {
                onDismiss()
                runCatching {
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(manageUrl)))
                }
            },
        )
    }
}

@Composable
private fun ChangePlanDialog(
    target: SubscriptionPlanOption,
    onDismiss: () -> Unit,
    onConfirm: (atPeriodEnd: Boolean) -> Unit,
) {
    BillingActionDialog(
        title = stringResource(R.string.billing_change_plan_title, target.name),
        description = stringResource(R.string.billing_change_plan_description),
        onDismiss = onDismiss,
    ) {
        BillingDialogButtonRow {
            BillingDialogButton(
                label = stringResource(R.string.billing_change_at_end_date),
                primary = false,
                modifier = Modifier.weight(1f),
                onClick = { onConfirm(true) },
            )
            BillingDialogButton(
                label = stringResource(R.string.billing_change_now),
                primary = true,
                modifier = Modifier.weight(1f),
                onClick = { onConfirm(false) },
            )
        }
    }
}


