package com.voicealarm.nativeapp

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import com.voicealarm.nativeapp.data.CharacterEventEntity
import com.voicealarm.nativeapp.network.BillingSubscriptionResponse
import com.voicealarm.nativeapp.network.CharacterResponse
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
import com.voicealarm.nativeapp.network.VoucherItem

@Composable
internal fun SubscriptionPanel(
    billingBusy: Boolean,
    subscriptionResponse: BillingSubscriptionResponse?,
    familyGroup: FamilyGroupCurrentResponse?,
    vouchers: List<VoucherItem>,
    onRefresh: () -> Unit,
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
                price = "",
                description = "",
                features = listOf("일반 알람", "캐릭터"),
            ),
            SubscriptionPlanOption(
                key = "personal",
                name = "개인",
                price = "월 4,900원",
                description = "",
                features = listOf("음성 프로필", "음성 메시지"),
            ),
            SubscriptionPlanOption(
                key = "couple",
                name = "커플",
                price = "월 7,900원",
                description = "",
                features = listOf("음성 공유", "메시지", "2명"),
            ),
            SubscriptionPlanOption(
                key = "family",
                name = "가족",
                price = "월 9,900원",
                description = "",
                features = listOf("음성 공유", "메시지", "6명"),
            ),
        )
    }
    fun shareVoucher(voucher: VoucherItem) {
        clipboard.setText(AnnotatedString(voucher.code))
        val sendIntent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, voucher.code)
        }
        context.startActivity(Intent.createChooser(sendIntent, "코드 공유"))
    }
    fun openVoucherShare(vouchersForPlan: List<VoucherItem>) {
        if (vouchersForPlan.size == 1) {
            shareVoucher(vouchersForPlan.first())
        } else if (vouchersForPlan.isNotEmpty()) {
            shareTarget = vouchersForPlan
        }
    }

    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (hasActive && cancelScheduled) {
                MutedText(
                    if (nextPlan != null) {
                        "다음 결제일에 ‘${nextPlan.name}’ 플랜으로 변경됩니다."
                    } else {
                        "다음 결제일까지 사용 후 자동 해지됩니다."
                    },
                )
            }
            options.forEach { option ->
                val isCurrent = if (option.key == "free") {
                    currentPlan == null
                } else {
                    currentPlan?.key == option.key
                }
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
            if (hasActive) {
                OutlinedButton(
                    onClick = {
                        if (isSharedMember) showLeaveDialog = true else showCancelDialog = true
                    },
                    enabled = !billingBusy,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Text(
                        text = if (isSharedMember) "플랜에서 나가기" else "해지하기",
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }
    }

    if (showCancelDialog) {
        CancelSubscriptionDialog(
            onDismiss = { showCancelDialog = false },
            onConfirm = { atPeriodEnd ->
                showCancelDialog = false
                onCancelSubscription(atPeriodEnd)
            },
        )
    }

    if (showLeaveDialog && sharedGroupId != null) {
        AlertDialog(
            onDismissRequest = { showLeaveDialog = false },
            title = { Text("플랜에서 나가기") },
            text = {
                MutedText("정말 플랜에서 나가시겠어요? 다시 들어오려면 새 초대 코드가 필요해요.")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showLeaveDialog = false
                        onLeaveFamilyGroup(sharedGroupId)
                    },
                ) {
                    Text(
                        text = "나가기",
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { showLeaveDialog = false }) {
                    Text("취소")
                }
            },
        )
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
        AlertDialog(
            onDismissRequest = { checkoutTarget = null },
            title = { Text(if (selection.gift) "${target.name} 플랜 선물하기" else "${target.name} 플랜 구매") },
            text = {
                Text(
                    if (selection.gift) {
                        "내 구독을 변경하지 않고 다른 사람이 등록할 수 있는 이용권 코드를 만들어요."
                    } else {
                        "구매를 진행할까요?"
                    },
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        checkoutTarget = null
                        onCheckoutPlan(target.key, selection.gift)
                    },
                ) {
                    Text(if (selection.gift) "결제" else "구매")
                }
            },
            dismissButton = {
                TextButton(onClick = { checkoutTarget = null }) {
                    Text("취소")
                }
            },
        )
    }

    if (shareTarget.isNotEmpty()) {
        AlertDialog(
            onDismissRequest = { shareTarget = emptyList() },
            title = { Text("공유할 코드 선택") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    shareTarget.forEach { voucher ->
                        val issuedAtLabel = formatVoucherIssuedAt(voucher.issuedAt)
                        val subtitle = if (issuedAtLabel != null) {
                            "미등록 · 결제일 $issuedAtLabel"
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
            },
            confirmButton = {
                TextButton(onClick = { shareTarget = emptyList() }) {
                    Text("닫기")
                }
            },
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
    Card(
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isCurrent) {
                MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.58f)
            } else {
                MaterialTheme.colorScheme.surface
            },
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text(option.name, fontWeight = FontWeight.SemiBold)
                    if (option.price.isNotBlank()) {
                        Text(
                            option.price,
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
                if (isCurrent) {
                    AssistChip(
                        onClick = {},
                        label = { Text("현재") },
                        colors = AssistChipDefaults.assistChipColors(
                            containerColor = MaterialTheme.colorScheme.secondary,
                            labelColor = MaterialTheme.colorScheme.onSecondary,
                        ),
                    )
                }
            }
            if (option.description.isNotBlank()) {
                MutedText(option.description)
            }
            option.features.forEach { feature ->
                MutedText("• $feature")
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
                        shape = RoundedCornerShape(14.dp),
                    ) {
                        Text(if (hasActiveSubscription) "변경" else "구매")
                    }
                    if (option.key == "personal") {
                        OutlinedButton(
                            onClick = onGift,
                            enabled = !busy,
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(14.dp),
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
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Text("선물하기")
                }
            }
            if (vouchers.isNotEmpty()) {
                OutlinedButton(
                    onClick = { onShareVouchers(vouchers) },
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Text("공유하기")
                }
            }
        }
    }
}

@Composable
private fun CancelSubscriptionDialog(
    onDismiss: () -> Unit,
    onConfirm: (atPeriodEnd: Boolean) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("구독 해지") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                MutedText("해지 시점을 선택해 주세요. 음성 프로필은 보존되며, 다시 결제하면 그대로 사용할 수 있어요.")
            }
        },
        confirmButton = {
            Column(horizontalAlignment = Alignment.End) {
                TextButton(onClick = { onConfirm(true) }) {
                    Text("다음 결제일까지 사용하고 해지")
                }
                TextButton(onClick = { onConfirm(false) }) {
                    Text(
                        text = "지금 해지하기",
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("닫기") }
        },
    )
}

@Composable
private fun ChangePlanDialog(
    target: SubscriptionPlanOption,
    onDismiss: () -> Unit,
    onConfirm: (atPeriodEnd: Boolean) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("${target.name} 플랜으로 변경") },
        text = {
            MutedText("변경 시점을 선택해 주세요. 즉시 변경하면 기존 구독은 바로 해지되고 새 결제가 진행돼요.")
        },
        confirmButton = {
            Column(horizontalAlignment = Alignment.End) {
                TextButton(onClick = { onConfirm(true) }) {
                    Text("다음 결제일에 변경")
                }
                TextButton(onClick = { onConfirm(false) }) {
                    Text("지금 바로 변경")
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("닫기") }
        },
    )
}

private data class CheckoutSelection(
    val option: SubscriptionPlanOption,
    val gift: Boolean,
)

@Composable
internal fun CharacterBillingPanel(
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
    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = "성장",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )

            if (characterResponse == null) {
                MutedText("캐릭터 정보를 아직 불러오지 않았어요.")
            } else {
                val character = characterResponse.character
                val progress = characterResponse.progress
                val progressRatio = progress.progressRatio.toFloat().coerceIn(0f, 1f)
                val levelSpan = progress.levelSpan.coerceAtLeast(1)
                val xpIntoLevel = progress.xpIntoLevel.coerceIn(0, levelSpan)
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Surface(
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.tertiaryContainer,
                        contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
                    ) {
                        Box(
                            modifier = Modifier.size(42.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = stageEmoji(character.stage),
                                style = MaterialTheme.typography.titleLarge,
                            )
                        }
                    }
                    Text(
                        text = "LV.${character.level}",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
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
                    MutedText("다음 레벨까지 ${progress.xpToNextLevel} XP")
                }
                MutedText(
                    "연속 ${characterResponse.streak.current}일 - 최장 ${characterResponse.streak.longest}일",
                )
            }
        }
    }
}

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
