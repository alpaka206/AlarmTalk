package com.voicealarm.nativeapp

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.voicealarm.nativeapp.data.AlarmEntity
import com.voicealarm.nativeapp.data.CharacterEventEntity
import com.voicealarm.nativeapp.data.CharacterEventStates
import com.voicealarm.nativeapp.network.BillingPlan
import com.voicealarm.nativeapp.network.BillingPlanSummary
import com.voicealarm.nativeapp.network.BillingSubscriptionResponse
import com.voicealarm.nativeapp.network.BillingSubscription
import com.voicealarm.nativeapp.network.CharacterResponse
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
import com.voicealarm.nativeapp.network.VoucherItem
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

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
) {
    var checkoutTarget by remember { mutableStateOf<CheckoutSelection?>(null) }
    var changeTarget by remember { mutableStateOf<SubscriptionPlanOption?>(null) }
    var showCancelDialog by remember { mutableStateOf(false) }
    var showLeaveDialog by remember { mutableStateOf(false) }
    var shareTarget by remember { mutableStateOf<List<VoucherItem>>(emptyList()) }
    val subscription = subscriptionResponse?.subscription
    val currentPlan = subscriptionResponse?.plan
    val nextPlan = subscriptionResponse?.nextPlan
    val hasActive = subscription != null && currentPlan != null
    val cancelScheduled = subscription?.cancelAtPeriodEnd == true
    val isSharedMember = familyGroup?.role == "member" && familyGroup.group != null
    val sharedGroupId = familyGroup?.group?.id
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
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
        if (vouchersForPlan.size == 1) {
            shareVoucher(vouchersForPlan.first())
        } else if (vouchersForPlan.isNotEmpty()) {
            shareTarget = vouchersForPlan
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
                val vouchersForPlan = vouchers.filter { voucher ->
                    voucher.status in listOf("issued", "active", "pending") &&
                        voucher.useCount < voucher.maxUses &&
                        voucher.planKey == option.key
                }
                SubscriptionPlanCard(
                    option = option,
                    isCurrent = isCurrent,
                    hasActiveSubscription = hasActive,
                    busy = billingBusy,
                    vouchers = vouchersForPlan,
                    onPurchase = { checkoutTarget = CheckoutSelection(option = option, gift = false) },
                    onGift = { checkoutTarget = CheckoutSelection(option = option, gift = true) },
                    onChange = { changeTarget = option },
                    onShareVouchers = { selectedVouchers -> openVoucherShare(selectedVouchers) },
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
    onShareVouchers: (List<VoucherItem>) -> Unit,
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
                    onClick = { onShareVouchers(vouchers) },
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

@Composable
internal fun CharacterBillingPanel(
    alarms: List<AlarmEntity>,
    characterEvents: List<CharacterEventEntity>,
    characterBusy: Boolean,
    characterResponse: CharacterResponse?,
    billingBusy: Boolean,
    subscriptionResponse: BillingSubscriptionResponse?,
    vouchers: List<VoucherItem>,
    onRefresh: () -> Unit,
    onSyncEvents: () -> Unit,
    onRegisterCode: (String) -> Unit,
) {
    val pendingCount = characterEvents.count { it.state == CharacterEventStates.PENDING }
    val failedCount = characterEvents.count { it.state == CharacterEventStates.FAILED }
    val recentEvents = characterEvents.take(3)
    val alarmsById = remember(alarms) { alarms.associateBy { it.id } }
    val hasUnreflectedEvents = pendingCount + failedCount > 0
    val busy = characterBusy || billingBusy

    OutlinedCard(
        shape = WakerCardShape,
        border = wakerCardBorder(),
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        text = "캐릭터 성장",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                    )
                }
                IconButton(
                    onClick = if (hasUnreflectedEvents) onSyncEvents else onRefresh,
                    enabled = !busy,
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Refresh,
                        contentDescription = if (hasUnreflectedEvents) "성장 반영" else "새로고침",
                    )
                }
            }

            if (characterResponse == null) {
                CharacterEmptyState(
                    busy = busy,
                    onRefresh = onRefresh,
                )
            } else {
                val character = characterResponse.character
                val progress = characterResponse.progress
                val stats = characterResponse.stats
                val progressRatio = progress.progressRatio.toFloat().coerceIn(0f, 1f)
                val levelSpan = progress.levelSpan.coerceAtLeast(1)
                val xpIntoLevel = progress.xpIntoLevel.coerceIn(0, levelSpan)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Surface(
                        modifier = Modifier.size(76.dp),
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.tertiaryContainer,
                        contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
                    ) {
                        Box(
                            modifier = Modifier.size(76.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = stageEmoji(character.stage),
                                style = MaterialTheme.typography.displaySmall,
                            )
                        }
                    }
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            text = "LV.${character.level} ${stageLabel(character.stage)}",
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            text = "연속 ${characterResponse.streak.current}일 · 최장 ${characterResponse.streak.longest}일",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = "XP",
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = "$xpIntoLevel/$levelSpan",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    CharacterXpBar(
                        progress = progressRatio,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(
                        text = "다음 레벨까지 ${progress.xpToNextLevel} XP",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        CharacterStatTile(
                            label = "성실함",
                            value = stats.diligence,
                            modifier = Modifier.weight(1f),
                        )
                        CharacterStatTile(
                            label = "꾸준함",
                            value = stats.consistency,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        CharacterStatTile(
                            label = "건강",
                            value = stats.health,
                            modifier = Modifier.weight(1f),
                        )
                        CharacterStatTile(
                            label = "애정도",
                            value = character.affection,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }

            if (hasUnreflectedEvents) {
                CharacterSyncStatus(
                    pendingCount = pendingCount,
                    failedCount = failedCount,
                )
            }

            if (recentEvents.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "최근 성장 기록",
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    recentEvents.forEach { event ->
                        CharacterEventRow(
                            event = event,
                            alarm = event.sourceAlarmId?.let(alarmsById::get),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CharacterEmptyState(
    busy: Boolean,
    onRefresh: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Surface(
            modifier = Modifier.size(72.dp),
            shape = CircleShape,
            color = MaterialTheme.colorScheme.tertiaryContainer,
            contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text(
                    text = stageEmoji("seed"),
                    style = MaterialTheme.typography.displaySmall,
                )
            }
        }
        MutedText("캐릭터 정보를 불러오는 중이에요.")
        IconButton(
            onClick = onRefresh,
            enabled = !busy,
        ) {
            Icon(
                imageVector = Icons.Outlined.Refresh,
                contentDescription = "새로고침",
            )
        }
    }
}

@Composable
private fun CharacterStatTile(
    label: String,
    value: Int,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.42f),
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = value.toString(),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
private fun CharacterSyncStatus(
    pendingCount: Int,
    failedCount: Int,
) {
    val needsCheck = failedCount > 0
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = if (needsCheck) {
            MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.68f)
        } else {
            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.68f)
        },
        contentColor = if (needsCheck) {
            MaterialTheme.colorScheme.onErrorContainer
        } else {
            MaterialTheme.colorScheme.onPrimaryContainer
        },
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = if (needsCheck) "반영 확인 필요" else "성장 반영 대기",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = "${pendingCount + failedCount}개",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
private fun CharacterEventRow(
    event: CharacterEventEntity,
    alarm: AlarmEntity?,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = characterEventTimeLabel(event, alarm),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
        )
        Text(
            text = characterEventXpLabel(event.event),
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.SemiBold,
            color = characterEventXpColor(event.event),
        )
    }
}

private fun characterEventTimeLabel(
    event: CharacterEventEntity,
    alarm: AlarmEntity?,
): String {
    if (alarm != null) {
        return "${event.localDate} ${alarm.hour.toString().padStart(2, '0')}:${alarm.minute.toString().padStart(2, '0')}"
    }
    return runCatching {
        val dateTime = Instant.ofEpochMilli(event.createdAtMillis).atZone(ZoneId.systemDefault())
        CharacterEventTimeFormatter.format(dateTime)
    }.getOrDefault(event.localDate)
}

private fun characterEventXpLabel(event: String): String = when (event) {
    "alarm_completed" -> "+5 XP"
    "alarm_snoozed", "alarm_dismissed" -> "-5 XP"
    else -> "+0 XP"
}

private fun passPlanName(planKey: String?, fallback: String?): String = when (planKey) {
    "free" -> "무료"
    "personal", "individual", "plus" -> "개인"
    "couple" -> "커플"
    "family" -> "가족"
    else -> fallback?.takeIf { it.isNotBlank() } ?: "이용권"
}

private fun formatPassDate(value: String?): String? =
    value?.let {
        runCatching {
            val dateTime = Instant.parse(it).atZone(ZoneId.systemDefault())
            PassDateFormatter.format(dateTime)
        }.getOrNull()
    }

private fun formatPassShortDate(value: String?): String? =
    value?.let {
        runCatching {
            val dateTime = Instant.parse(it).atZone(ZoneId.systemDefault())
            PassShortDateFormatter.format(dateTime)
        }.getOrNull()
    }

private fun Int.formatKrw(): String = "%,d".format(this)

@Composable
private fun characterEventXpColor(event: String): Color = when (event) {
    "alarm_completed" -> MaterialTheme.colorScheme.primary
    "alarm_snoozed", "alarm_dismissed" -> MaterialTheme.colorScheme.error
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}

private val CharacterEventTimeFormatter: DateTimeFormatter =
    DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")

private val PassDateFormatter: DateTimeFormatter =
    DateTimeFormatter.ofPattern("yyyy.MM.dd")

private val PassShortDateFormatter: DateTimeFormatter =
    DateTimeFormatter.ofPattern("M/d")

@Composable
internal fun CharacterXpBar(
    progress: Float,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(999.dp)
    Box(
        modifier = modifier
            .height(8.dp)
            .clip(shape)
            .background(MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth(progress.coerceIn(0f, 1f))
                .height(8.dp)
                .clip(shape)
                .background(MaterialTheme.colorScheme.tertiary),
        )
    }
}

@Composable
internal fun PanelHeader(
    title: String,
    actionLabel: String,
    enabled: Boolean,
    onAction: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
        )
        TextButton(onClick = onAction, enabled = enabled) {
            Text(actionLabel)
        }
    }
}

@Composable
internal fun CompactActionRow(
    title: String,
    subtitle: String,
    actionLabel: String,
    enabled: Boolean = true,
    onAction: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.Medium)
            MutedText(subtitle)
        }
        TextButton(onClick = onAction, enabled = enabled) {
            Text(actionLabel)
        }
    }
}

@Composable
internal fun MutedText(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}
