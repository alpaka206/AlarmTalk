package com.voicealarm.nativeapp

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.graphics.Color
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
    onCheckoutPlan: (String) -> Unit,
) {
    var code by remember { mutableStateOf("") }
    var checkoutTarget by remember { mutableStateOf<SubscriptionPlanOption?>(null) }
    val currentPlan = subscriptionResponse?.plan
    val options = remember {
        listOf(
            SubscriptionPlanOption(
                key = "free",
                name = "무료",
                price = "무료",
                description = "일반 알람",
                features = listOf("로컬 일반 알람", "스누즈", "반복 요일"),
            ),
            SubscriptionPlanOption(
                key = "plus_personal",
                name = "개인",
                price = "월 4,900원",
                description = "AI 음성 알람과 캐릭터",
                features = listOf("AI 음성 프로필 2개", "TTS 알람", "캐릭터/스트릭"),
            ),
            SubscriptionPlanOption(
                key = "family",
                name = "커플/가족",
                price = "월 9,900원",
                description = "연결된 사람과 음성을 공유",
                features = listOf("초대 코드", "공유 음성", "메시지", "최대 6명"),
            ),
        )
    }

    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            PanelHeader(
                title = "구독",
                actionLabel = if (billingBusy) "불러오는 중" else "새로고침",
                enabled = !billingBusy,
                onAction = onRefresh,
            )

            Text("현재 플랜", fontWeight = FontWeight.SemiBold)
            if (currentPlan == null) {
                MutedText("무료 플랜 또는 활성 구독 없음")
            } else {
                MutedText("${currentPlan.name} - ${planTypeLabel(currentPlan.planType)} - 최대 ${currentPlan.maxMembers}명")
            }

            options.forEach { option ->
                val isCurrent = if (option.key == "free") {
                    currentPlan == null
                } else {
                    currentPlan?.key == option.key
                }
                SubscriptionPlanCard(
                    option = option,
                    isCurrent = isCurrent,
                    busy = billingBusy,
                    onCheckout = { checkoutTarget = option },
                )
            }

            HorizontalDivider()

            Text("이용권 코드 등록", fontWeight = FontWeight.SemiBold)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    value = code,
                    onValueChange = { code = it.uppercase().take(18) },
                    label = { Text("VA-XXXX-XXXX-XXXX") },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                Button(
                    onClick = {
                        onRegisterCode(code)
                        code = ""
                    },
                    enabled = code.isNotBlank() && !billingBusy,
                ) {
                    Text("등록")
                }
            }

            Text("발급된 이용권", fontWeight = FontWeight.SemiBold)
            if (vouchers.isEmpty()) {
                MutedText("발급된 이용권이 없어요.")
            } else {
                vouchers.take(6).forEach { voucher ->
                    MutedText("${voucher.code} - ${voucher.planName} - ${voucherStatusLabel(voucher.status)}")
                }
            }
        }
    }

    checkoutTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { checkoutTarget = null },
            title = { Text("${target.name} 플랜 변경") },
            text = {
                Text("선택한 플랜으로 변경할까요? 적용 후 선물용 이용권 코드가 발급됩니다.")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        checkoutTarget = null
                        onCheckoutPlan(target.key)
                    },
                ) {
                    Text("적용")
                }
            },
            dismissButton = {
                TextButton(onClick = { checkoutTarget = null }) {
                    Text("취소")
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
    onCheckout: () -> Unit,
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
                    Text(
                        option.price,
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                if (isCurrent) {
                    AssistChip(onClick = {}, label = { Text("현재") })
                }
            }
            MutedText(option.description)
            option.features.forEach { feature ->
                MutedText("• $feature")
            }
            if (!isCurrent && option.key != "free") {
                Button(
                    onClick = onCheckout,
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Text("${option.name} 적용")
                }
            }
        }
    }
}

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
    val pendingEvents = characterEvents.count { it.state != "synced" }

    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            PanelHeader(
                title = "성장",
                actionLabel = if (characterBusy || billingBusy) "불러오는 중" else "새로고침",
                enabled = !characterBusy && !billingBusy,
                onAction = onRefresh,
            )

            if (characterResponse == null) {
                MutedText("캐릭터 정보를 아직 불러오지 않았어요.")
            } else {
                val character = characterResponse.character
                Text(
                    text = "${stageEmoji(character.stage)} ${character.name}",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                MutedText(
                    "레벨 ${character.level} - ${stageLabel(character.stage)} - XP ${character.xp} - 애정도 ${character.affection}",
                )
                MutedText(
                    "연속 ${characterResponse.streak.current}일 - 최장 ${characterResponse.streak.longest}일",
                )
                MutedText(
                    "진행도 ${characterResponse.progress.xpIntoLevel}/${characterResponse.progress.levelSpan}",
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(
                    onClick = onSyncEvents,
                    enabled = pendingEvents > 0 && !characterBusy,
                    modifier = Modifier.weight(1f),
                ) {
                    Text("XP 동기화")
                }
                OutlinedButton(
                    onClick = onRefresh,
                    enabled = !characterBusy && !billingBusy,
                    modifier = Modifier.weight(1f),
                ) {
                    Text("대기 ${pendingEvents}개")
                }
            }
            MutedText("구독과 이용권 코드는 홈 오른쪽 위 프로필 메뉴의 구독/이용권에서 관리해요.")
        }
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
