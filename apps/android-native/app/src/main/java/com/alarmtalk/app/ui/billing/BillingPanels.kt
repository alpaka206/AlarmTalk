package com.alarmtalk.app

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
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
    onRegisterCode: (String) -> Unit,
    onCheckoutPlan: (String, Boolean) -> Unit,
    onPurchasePlay: (Activity, String) -> Unit,
    onCancelSubscription: (Boolean) -> Unit,
    onChangePlan: (String, Boolean) -> Unit,
    onLeaveFamilyGroup: (String) -> Unit,
    onRefreshShareCodeData: suspend () -> List<VoucherItem>,
) {
    var checkoutTarget by remember { mutableStateOf<CheckoutSelection?>(null) }
    var purchaseTarget by remember { mutableStateOf<SubscriptionPlanOption?>(null) }
    var changeTarget by remember { mutableStateOf<SubscriptionPlanOption?>(null) }
    var testCodeTarget by remember { mutableStateOf<SubscriptionPlanOption?>(null) }
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
        SubscriptionPlanOption(
            key = "free",
            name = stringResource(R.string.billing_plan_free_name),
            price = stringResource(R.string.billing_plan_free_price),
            description = stringResource(R.string.billing_plan_free_description),
            features = listOf(
                stringResource(R.string.billing_plan_free_feature_basic_alarm),
            ),
        ),
        SubscriptionPlanOption(
            key = "personal",
            name = stringResource(R.string.billing_plan_personal_name),
            price = stringResource(R.string.billing_plan_personal_price),
            description = stringResource(R.string.billing_plan_personal_description),
            features = listOf(
                stringResource(R.string.billing_plan_personal_feature_voice),
                stringResource(R.string.billing_plan_personal_feature_voice_message),
                stringResource(R.string.billing_plan_personal_feature_gift),
            ),
        ),
        SubscriptionPlanOption(
            key = "couple",
            name = stringResource(R.string.billing_plan_couple_name),
            price = stringResource(R.string.billing_plan_couple_price),
            description = stringResource(R.string.billing_plan_couple_description),
            features = listOf(
                stringResource(R.string.billing_plan_couple_feature_voice_share),
                stringResource(R.string.billing_plan_couple_feature_message),
                stringResource(R.string.billing_plan_couple_feature_max_two),
            ),
        ),
        SubscriptionPlanOption(
            key = "family",
            name = stringResource(R.string.billing_plan_family_name),
            price = stringResource(R.string.billing_plan_family_price),
            description = stringResource(R.string.billing_plan_family_description),
            features = listOf(
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
        CurrentPassSummaryCard(
            subscription = subscription,
            currentPlan = currentPlan,
            nextPlan = nextPlan,
            hasActive = hasActive,
            cancelScheduled = cancelScheduled,
            isSharedMember = isSharedMember,
        )

        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                text = stringResource(R.string.billing_plan_select_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
            options.forEach { option ->
                val currentKey = currentPlan?.key ?: "free"
                val isCurrent = currentKey == option.key
                val vouchersForPlan = shareableVouchersForPlan(vouchers, option.key)
                SubscriptionPlanCard(
                    option = option,
                    isCurrent = isCurrent,
                    hasActiveSubscription = hasActive,
                    busy = billingBusy || shareBusy,
                    vouchers = vouchersForPlan,
                    onPurchase = { purchaseTarget = option },
                    onGift = { testCodeTarget = option },
                    onChange = { testCodeTarget = option },
                    onShareVouchers = { refreshAndOpenVoucherShare(option.key) },
                )
            }
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
            // 디버그/개발 빌드에서는 기존 스텁(테스트 초대 코드 등록) 경로도 유지한다.
            onUseTestCode = if (BuildConfig.DEBUG) {
                {
                    purchaseTarget = null
                    testCodeTarget = option
                }
            } else {
                null
            },
        )
    }

    testCodeTarget?.let { option ->
        TestInviteCodeDialog(
            target = option,
            busy = billingBusy,
            onDismiss = { testCodeTarget = null },
            onRegisterCode = { code ->
                testCodeTarget = null
                onRegisterCode(code)
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

    checkoutTarget?.let { selection ->
        val target = selection.option
        BillingActionDialog(
            title = if (selection.gift) {
                stringResource(R.string.billing_checkout_gift_title, target.name)
            } else {
                stringResource(R.string.billing_checkout_apply_title, target.name)
            },
            description = if (selection.gift) {
                stringResource(R.string.billing_checkout_gift_description)
            } else {
                stringResource(R.string.billing_checkout_apply_description, target.name)
            },
            onDismiss = { checkoutTarget = null },
        ) {
            BillingDialogButton(
                label = if (selection.gift) {
                    stringResource(R.string.billing_gift_button)
                } else {
                    stringResource(R.string.billing_apply_button)
                },
                primary = true,
                onClick = {
                    checkoutTarget = null
                    onCheckoutPlan(target.key, selection.gift)
                },
            )
        }
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
 * [onUseTestCode] 가 null 이 아니면(디버그 빌드) 기존 테스트 코드 스텁 경로 버튼도 노출한다.
 */
@Composable
private fun PlayPurchaseDialog(
    target: SubscriptionPlanOption,
    busy: Boolean,
    onDismiss: () -> Unit,
    onPurchase: () -> Unit,
    onUseTestCode: (() -> Unit)?,
) {
    BillingActionDialog(
        title = stringResource(R.string.billing_play_purchase_title, target.name),
        description = stringResource(R.string.billing_play_purchase_description),
        onDismiss = onDismiss,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            BillingDialogButton(
                label = stringResource(R.string.billing_monthly_subscription),
                primary = true,
                onClick = { if (!busy) onPurchase() },
            )
            if (onUseTestCode != null) {
                BillingDialogButton(
                    label = stringResource(R.string.billing_register_test_code_dev),
                    primary = false,
                    onClick = onUseTestCode,
                )
            }
        }
    }
}

/** Compose Context 에서 결제 시트 호출에 필요한 Activity 를 찾는다. */
private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

@Composable
private fun TestInviteCodeDialog(
    target: SubscriptionPlanOption,
    busy: Boolean,
    onDismiss: () -> Unit,
    onRegisterCode: (String) -> Unit,
) {
    var code by remember(target.key) { mutableStateOf("") }
    val prefix = if (target.key == "personal") "GIFT" else "INV"
    val maxCodeLength = if (prefix == "GIFT") 19 else 18

    BillingActionDialog(
        title = stringResource(R.string.billing_test_invite_code_title, target.name),
        description = stringResource(R.string.billing_test_invite_code_description),
        onDismiss = onDismiss,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(
                value = code,
                onValueChange = { value ->
                    code = value
                        .uppercase()
                        .filter { it.isLetterOrDigit() || it == '-' }
                        .take(maxCodeLength)
                },
                placeholder = { Text("$prefix-XXXX-XXXX-XXXX") },
                singleLine = true,
                enabled = !busy,
                shape = WakerInputShape,
                colors = wakerOutlinedTextFieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )
            BillingDialogButton(
                label = stringResource(R.string.billing_register_code_button),
                primary = true,
                onClick = {
                    val trimmed = code.trim()
                    if (trimmed.isNotBlank()) {
                        onRegisterCode(trimmed)
                    }
                },
            )
        }
    }
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
private fun CurrentPassSummaryCard(
    subscription: BillingSubscription?,
    currentPlan: BillingPlan?,
    nextPlan: BillingPlanSummary?,
    hasActive: Boolean,
    cancelScheduled: Boolean,
    isSharedMember: Boolean,
) {
    val context = LocalContext.current
    val planKey = currentPlan?.key ?: "free"
    val planName = passPlanName(context, planKey = planKey, fallback = currentPlan?.name)
    val expiresAt = formatPassDate(subscription?.expiresAt)
    val statusText = when {
        isSharedMember -> stringResource(R.string.billing_status_shared_member)
        cancelScheduled && nextPlan != null -> {
            val nextName = passPlanName(context, nextPlan.key, nextPlan.name)
            if (expiresAt != null) {
                stringResource(R.string.billing_status_change_to_next_after_date, expiresAt, nextName)
            } else {
                stringResource(R.string.billing_status_change_to_next_scheduled, nextName)
            }
        }
        cancelScheduled -> {
            if (expiresAt != null) {
                stringResource(R.string.billing_status_end_after_date, expiresAt)
            } else {
                stringResource(R.string.billing_status_end_scheduled)
            }
        }
        hasActive && expiresAt != null -> stringResource(R.string.billing_status_available_until, expiresAt)
        hasActive -> stringResource(R.string.billing_status_in_use)
        else -> stringResource(R.string.billing_status_free_basic)
    }
    val priceText = currentPlan?.priceKrw?.takeIf { it > 0 }
        ?.let { stringResource(R.string.billing_price_monthly, it.formatKrw()) }
        ?: stringResource(R.string.billing_price_zero)
    val capacityText = currentPlan?.maxMembers?.takeIf { it > 1 }
        ?.let { stringResource(R.string.billing_capacity_max_members, it) }
        ?: stringResource(R.string.billing_capacity_personal)

    OutlinedCard(
        shape = WakerCardShape,
        border = wakerCardBorder(),
        colors = CardDefaults.outlinedCardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.36f),
        ),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = stringResource(R.string.billing_current_pass_label),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
                Text(
                    text = planName,
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PassSummaryChip(priceText)
                PassSummaryChip(capacityText)
            }

            Text(
                text = statusText,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.78f),
            )
        }
    }
}

@Composable
private fun PassSummaryChip(label: String) {
    Surface(
        shape = WakerPillShape,
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.7f),
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.7f)),
    ) {
        Text(
            text = label,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
        )
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
    onGift: () -> Unit,
    onChange: () -> Unit,
    onShareVouchers: () -> Unit,
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
            if (option.key != "free" && !isCurrent) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Button(
                        onClick = if (hasActiveSubscription) onChange else onPurchase,
                        enabled = !busy,
                        modifier = Modifier.weight(1f),
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
                    if (option.key == "personal") {
                        OutlinedButton(
                            onClick = onGift,
                            enabled = !busy,
                            modifier = Modifier.weight(1f),
                            shape = WakerButtonShape,
                            border = wakerCardBorder(),
                            colors = wakerOutlinedButtonColors(),
                        ) {
                            Text(stringResource(R.string.billing_gift_button))
                        }
                    }
                }
            }
            if (option.key == "personal" && isCurrent) {
                OutlinedButton(
                    onClick = onGift,
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth(),
                    shape = WakerButtonShape,
                    border = wakerCardBorder(),
                    colors = wakerOutlinedButtonColors(),
                ) {
                    Text(stringResource(R.string.billing_gift_personal_pass))
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

@Composable
private fun CancelSubscriptionDialog(
    subscription: BillingSubscription?,
    onDismiss: () -> Unit,
    onConfirm: (atPeriodEnd: Boolean) -> Unit,
) {
    val endDate = formatPassShortDate(subscription?.expiresAt)
    val finalDescription = if (endDate != null) {
        stringResource(R.string.billing_cancel_description_with_date, endDate)
    } else {
        stringResource(R.string.billing_cancel_description_no_date)
    }
    BillingActionDialog(
        title = stringResource(R.string.billing_cancel_pass),
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
                onClick = { onConfirm(false) },
            )
        }
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

private data class CheckoutSelection(
    val option: SubscriptionPlanOption,
    val gift: Boolean,
)

