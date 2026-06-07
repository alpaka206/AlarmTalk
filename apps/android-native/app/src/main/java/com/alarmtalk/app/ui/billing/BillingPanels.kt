package com.alarmtalk.app

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
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
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
    onCancelSubscription: (Boolean) -> Unit,
    onChangePlan: (String, Boolean) -> Unit,
    onLeaveFamilyGroup: (String) -> Unit,
    onRefreshShareCodeData: suspend () -> List<VoucherItem>,
) {
    var checkoutTarget by remember { mutableStateOf<CheckoutSelection?>(null) }
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
    val options = remember {
        listOf(
            SubscriptionPlanOption(
                key = "free",
                name = "무료",
                price = "0원",
                description = "기본 알람을 먼저 써볼 수 있어요.",
                features = listOf("일반 알람", "기본 캐릭터 성장"),
            ),
            SubscriptionPlanOption(
                key = "personal",
                name = "개인",
                price = "월 4,900원",
                description = "내가 좋아하는 목소리로 알람을 만들어요.",
                features = listOf("목소리", "음성 메시지", "개인 이용권 선물"),
            ),
            SubscriptionPlanOption(
                key = "couple",
                name = "커플",
                price = "월 7,900원",
                description = "둘이 서로의 목소리로 알람을 설정해요.",
                features = listOf("음성 공유", "메시지", "최대 2명"),
            ),
            SubscriptionPlanOption(
                key = "family",
                name = "가족",
                price = "월 9,900원",
                description = "가족이 함께 목소리 알람을 공유해요.",
                features = listOf("음성 공유", "메시지", "최대 6명"),
            ),
        )
    }
    fun shareVoucher(voucher: VoucherItem) {
        clipboard.setText(AnnotatedString(voucher.code))
        val sendIntent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, voucher.code)
        }
        context.startActivity(Intent.createChooser(sendIntent, "이용권 코드 공유"))
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
                text = "이용권 선택",
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
                    onPurchase = { testCodeTarget = option },
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
                    text = if (isSharedMember) "공유 이용권에서 나가기" else "이용권 해지",
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
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
            title = "공유 이용권에서 나가기",
            description = "나가면 무료 이용권으로 전환돼요. 다시 들어오려면 새 초대 코드가 필요해요.",
            onDismiss = { showLeaveDialog = false },
        ) {
            BillingDialogButton(
                label = "나가기",
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
            title = if (selection.gift) "${target.name} 이용권 선물하기" else "${target.name} 이용권 적용",
            description = if (selection.gift) {
                "받는 사람이 직접 등록할 수 있는 개인 이용권 코드를 만들어요. 내 이용권은 그대로 유지돼요."
            } else {
                "${target.name} 이용권으로 바로 적용할까요?"
            },
            onDismiss = { checkoutTarget = null },
        ) {
            BillingDialogButton(
                label = if (selection.gift) "선물하기" else "적용하기",
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
            title = "공유할 이용권 선택",
            description = "아직 등록되지 않은 코드를 골라 바로 공유할 수 있어요.",
            onDismiss = { shareTarget = emptyList() },
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                shareTarget.forEach { voucher ->
                    val issuedAtLabel = formatVoucherIssuedAt(voucher.issuedAt)
                    val subtitle = if (issuedAtLabel != null) {
                        "미등록 · 발급일 $issuedAtLabel"
                    } else {
                        "미등록"
                    }
                    CompactActionRow(
                        title = voucher.code,
                        subtitle = subtitle,
                        actionLabel = "공유",
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
        title = "${target.name} 테스트 코드 등록",
        description = "테스트 버전이므로 초대 코드를 등록해주세요.",
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
                label = "코드 등록",
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
            shape = WakerCardShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = wakerCardBorder(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            text = title,
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                        )
                        MutedText(description)
                    }
                    IconButton(
                        onClick = onDismiss,
                        modifier = Modifier.size(42.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Close,
                            contentDescription = "닫기",
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
    val planKey = currentPlan?.key ?: "free"
    val planName = passPlanName(planKey = planKey, fallback = currentPlan?.name)
    val expiresAt = formatPassDate(subscription?.expiresAt)
    val statusText = when {
        isSharedMember -> "공유 이용권에 참여 중이에요."
        cancelScheduled && nextPlan != null -> {
            val nextName = passPlanName(nextPlan.key, nextPlan.name)
            if (expiresAt != null) "$expiresAt 이후 $nextName 이용권으로 변경돼요." else "$nextName 이용권으로 변경 예정이에요."
        }
        cancelScheduled -> {
            if (expiresAt != null) "${expiresAt}까지 사용 후 종료돼요." else "현재 이용권이 종료 예정이에요."
        }
        hasActive && expiresAt != null -> "${expiresAt}까지 사용할 수 있어요."
        hasActive -> "사용 중인 이용권이에요."
        else -> "기본 알람은 무료로 사용할 수 있어요."
    }
    val priceText = currentPlan?.priceKrw?.takeIf { it > 0 }?.let { "월 ${it.formatKrw()}원" } ?: "0원"
    val capacityText = currentPlan?.maxMembers?.takeIf { it > 1 }?.let { "최대 ${it}명" } ?: "개인 사용"

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
                    text = "현재 이용권",
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
        shape = RoundedCornerShape(999.dp),
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
                        shape = RoundedCornerShape(999.dp),
                        color = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary,
                    ) {
                        Text(
                            text = "현재 이용권",
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
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
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
                        Text(if (hasActiveSubscription) "이용권 변경" else "선택하기")
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
                            Text("선물하기")
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
                    Text("개인 이용권 선물하기")
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
                    Text("이용권 코드 공유")
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
    val description = if (endDate != null) {
        "종료일인 ${endDate}까지 이용권을 유지하거나, 지금 바로 무료 이용권으로 전환할 수 있어요."
    } else {
        "해지 시점을 선택해 주세요. 목소리와 알람 기록은 보존되며, 다시 이용권을 적용하면 그대로 사용할 수 있어요."
    }
    val finalDescription = if (endDate != null) {
        "종료일인 ${endDate}까지 이용권을 유지하거나, 지금 바로 무료 이용권으로 전환할 수 있어요. 무료로 전환되면 만든 목소리, 관련 메시지, 목소리 알람이 삭제되고 일반 알람만 사용할 수 있어요."
    } else {
        "해지 시점을 선택해 주세요. 무료로 전환되면 만든 목소리, 관련 메시지, 목소리 알람이 삭제되고 일반 알람만 사용할 수 있어요."
    }
    BillingActionDialog(
        title = "이용권 해지",
        description = finalDescription,
        onDismiss = onDismiss,
    ) {
        BillingDialogButtonRow {
            BillingDialogButton(
                label = endDate?.let { "${it}에 해지" } ?: "종료일에 해지",
                primary = false,
                modifier = Modifier.weight(1f),
                onClick = { onConfirm(true) },
            )
            BillingDialogButton(
                label = "지금 해지하기",
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
        title = "${target.name} 이용권으로 변경",
        description = "즉시 변경하면 현재 이용권은 바로 종료되고 새 이용권이 적용돼요. 종료일 변경은 현재 기간이 끝난 뒤 적용돼요.",
        onDismiss = onDismiss,
    ) {
        BillingDialogButtonRow {
            BillingDialogButton(
                label = "종료일에 변경",
                primary = false,
                modifier = Modifier.weight(1f),
                onClick = { onConfirm(true) },
            )
            BillingDialogButton(
                label = "지금 변경",
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

