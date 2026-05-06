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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
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
import com.voicealarm.nativeapp.network.VoucherItem

@Composable
internal fun SubscriptionPanel(
    billingBusy: Boolean,
    subscriptionResponse: BillingSubscriptionResponse?,
    vouchers: List<VoucherItem>,
    onRefresh: () -> Unit,
    onRegisterCode: (String) -> Unit,
    onCheckoutPlan: (String, Boolean) -> Unit,
) {
    var checkoutTarget by remember { mutableStateOf<CheckoutSelection?>(null) }
    var shareTarget by remember { mutableStateOf<List<VoucherItem>>(emptyList()) }
    val currentPlan = subscriptionResponse?.plan
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val options = remember {
        listOf(
            SubscriptionPlanOption(
                key = "free",
                name = "무료",
                price = "",
                description = "",
                features = listOf("일반 알람만 사용 가능", "캐릭터"),
            ),
            SubscriptionPlanOption(
                key = "plus_personal",
                name = "개인",
                price = "월 4,900원",
                description = "AI 음성 알람과 캐릭터",
                features = listOf("AI 음성 프로필 2개", "TTS 알람"),
            ),
            SubscriptionPlanOption(
                key = "couple",
                name = "커플",
                price = "월 7,900원",
                description = "두 사람이 음성, 메시지 공유",
                features = listOf("음성 공유 가능", "메시지 전송 가능", "최대 2명"),
            ),
            SubscriptionPlanOption(
                key = "family",
                name = "가족",
                price = "월 9,900원",
                description = "가족이 음성, 메시지 공유",
                features = listOf("음성 공유 가능", "메시지 전송 가능", "최대 6명"),
            ),
        )
    }
    fun shareVoucher(voucher: VoucherItem) {
        val shareText = "Voice Alarm ${voucher.planName} 이용권 코드: ${voucher.code}"
        clipboard.setText(AnnotatedString(voucher.code))
        val sendIntent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, shareText)
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

    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            options.forEach { option ->
                val isCurrent = if (option.key == "free") {
                    currentPlan == null
                } else {
                    currentPlan?.key == option.key
                }
                val vouchersForPlan = vouchers.filter { voucher ->
                    voucher.status in listOf("issued", "active", "pending") &&
                        (voucher.planKey == option.key || voucher.planName.contains(option.name))
                }
                SubscriptionPlanCard(
                    option = option,
                    isCurrent = isCurrent,
                    busy = billingBusy,
                    vouchers = vouchersForPlan,
                    onPurchase = { checkoutTarget = CheckoutSelection(option = option, gift = false) },
                    onGift = { checkoutTarget = CheckoutSelection(option = option, gift = true) },
                    onShareVouchers = { selectedVouchers -> openVoucherShare(selectedVouchers) },
                )
            }
        }
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
                        "구매를 진행할까요? 구매 후 공유하기로 코드를 보낼 수 있어요."
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
    busy: Boolean,
    vouchers: List<VoucherItem>,
    onPurchase: () -> Unit,
    onGift: () -> Unit,
    onShareVouchers: (List<VoucherItem>) -> Unit,
) {
    Card(
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isCurrent) {
                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.45f)
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
                    AssistChip(onClick = {}, label = { Text("현재") })
                }
            }
            if (option.description.isNotBlank()) {
                MutedText(option.description)
            }
            option.features.forEach { feature ->
                MutedText("• $feature")
            }
            if (option.key != "free") {
                if (option.key == "plus_personal") {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Button(
                                onClick = onPurchase,
                                enabled = !busy && !isCurrent,
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(14.dp),
                            ) {
                                Text("구매")
                            }
                            OutlinedButton(
                                onClick = onGift,
                                enabled = !busy,
                                modifier = Modifier.weight(1f),
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
                } else {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Button(
                            onClick = onPurchase,
                            enabled = !busy && !isCurrent,
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(14.dp),
                        ) {
                            Text("구매")
                        }
                        if (vouchers.isNotEmpty()) {
                            OutlinedButton(
                                onClick = { onShareVouchers(vouchers) },
                                enabled = !busy,
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(14.dp),
                            ) {
                                Text("공유하기")
                            }
                        }
                    }
                }
            }
        }
    }
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
                    Text(
                        text = stageEmoji(character.stage),
                        style = MaterialTheme.typography.headlineMedium,
                    )
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
                .background(MaterialTheme.colorScheme.primary),
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
