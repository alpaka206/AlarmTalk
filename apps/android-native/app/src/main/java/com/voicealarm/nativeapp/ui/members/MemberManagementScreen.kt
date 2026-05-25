package com.voicealarm.nativeapp

import android.content.Intent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.PersonRemove
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.voicealarm.nativeapp.network.AuthSession
import com.voicealarm.nativeapp.network.BillingSubscriptionResponse
import com.voicealarm.nativeapp.network.FamilyAlarmQuietWindow
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
import com.voicealarm.nativeapp.network.FamilyGroupMember
import com.voicealarm.nativeapp.network.VoucherItem

@Composable
internal fun MemberManagementScreen(
    contentPadding: PaddingValues,
    familyGroup: FamilyGroupCurrentResponse?,
    subscriptionResponse: BillingSubscriptionResponse?,
    vouchers: List<VoucherItem>,
    authSession: AuthSession?,
    currentUserId: String?,
    socialBusy: Boolean,
    billingBusy: Boolean,
    onBack: () -> Unit,
    onRemoveFamilyMember: (String, String) -> Unit,
    onEnsureFamilyShareCode: () -> Unit,
    onChangeFamilyAlarmSettings: (Boolean, List<FamilyAlarmQuietWindow>) -> Unit,
) {
    val group = familyGroup?.group
    val isOwner = familyGroup?.role == "owner" && group != null
    val planLabel = when (subscriptionResponse?.plan?.key) {
        "couple" -> "커플"
        "family" -> "가족"
        else -> "공유"
    }
    val sortedMembers = familyGroup?.members.orEmpty()
        .sortedWith(compareByDescending<FamilyGroupMember> { it.role == "owner" }.thenBy { it.joinedAt })
    val isCapacityFull = group != null && sortedMembers.size >= group.maxMembers
    val activePlanKey = subscriptionResponse?.plan?.key
    val shareVoucher = remember(vouchers, activePlanKey) {
        vouchers.firstOrNull { voucher ->
            voucher.code.startsWith("INV-") &&
                voucher.planType == "family" &&
                (activePlanKey == null || voucher.planKey == activePlanKey) &&
                voucher.status !in listOf("expired", "revoked", "cancelled")
        }
    }

    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    fun shareCode(code: String) {
        clipboard.setText(AnnotatedString(code))
        val sendIntent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, code)
        }
        context.startActivity(Intent.createChooser(sendIntent, "코드 공유"))
    }

    var pendingRemoveMember by remember { mutableStateOf<FamilyGroupMember?>(null) }
    var showFamilyAlarmDialog by remember { mutableStateOf(false) }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) {
                    Icon(
                        Icons.AutoMirrored.Outlined.ArrowBack,
                        contentDescription = "뒤로",
                    )
                }
                Text(
                    text = "공유 이용권",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                )
            }
        }

        if (group == null) {
            item {
                Text(
                    text = "현재 함께 쓰는 이용권이 없어요.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            return@LazyColumn
        }

        item {
            Text(
                text = "$planLabel 이용권 · 현재 ${sortedMembers.size}/${group.maxMembers}명",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        if (authSession != null) {
            item {
                FamilyAlarmPermissionCard(
                    allowFamilyAlarms = authSession.user.allowFamilyAlarms,
                    quietWindows = authSession.user.familyAlarmQuietWindows,
                    onToggle = {
                        onChangeFamilyAlarmSettings(
                            it,
                            authSession.user.familyAlarmQuietWindows,
                        )
                    },
                    onEditQuietTime = { showFamilyAlarmDialog = true },
                )
            }
        }

        if (isOwner) {
            item {
                Text(
                    text = "공유 코드",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            if (shareVoucher == null) {
                item {
                    Text(
                        text = if (isCapacityFull) {
                            "정원이 가득 차서 더 이상 공유할 수 없어요."
                        } else {
                            "공유 코드가 아직 없어요. $planLabel 구성원을 초대할 초대 코드를 만들어 주세요."
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                item {
                    OutlinedButton(
                        onClick = onEnsureFamilyShareCode,
                        enabled = !billingBusy && !isCapacityFull,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(14.dp),
                    ) {
                        Text(if (isCapacityFull) "공유 불가" else "공유 코드 만들기")
                    }
                }
            } else {
                item {
                    val isFull = isCapacityFull || shareVoucher.useCount >= shareVoucher.maxUses
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        shape = RoundedCornerShape(14.dp),
                    ) {
                        Column(
                            modifier = Modifier.padding(14.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                text = shareVoucher.code,
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                text = if (isFull) {
                                    "${shareVoucher.useCount}/${shareVoucher.maxUses}명 사용 · 정원이 가득 차서 공유할 수 없어요"
                                } else {
                                    "${shareVoucher.useCount}/${shareVoucher.maxUses}명 사용"
                                },
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Button(
                                onClick = { shareCode(shareVoucher.code) },
                                enabled = !billingBusy && !isFull,
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(14.dp),
                            ) {
                                Text(if (isFull) "공유 불가" else "공유하기")
                            }
                        }
                    }
                }
            }
        }

        item {
            Text(
                text = "구성원",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }

        items(sortedMembers) { member ->
            MemberRow(
                member = member,
                isMe = member.userId == currentUserId,
                showRemove = isOwner && member.role != "owner" && member.userId != currentUserId,
                removeEnabled = !socialBusy,
                onRemove = { pendingRemoveMember = member },
            )
        }
    }

    pendingRemoveMember?.let { member ->
        AlertDialog(
            onDismissRequest = { pendingRemoveMember = null },
            title = {
                ModalDialogTitle(
                    title = "구성원 내보내기",
                    onDismiss = { pendingRemoveMember = null },
                )
            },
            text = {
                Text(
                    text = "이 구성원을 내보낼까요? 다시 초대하려면 새 초대 코드가 필요해요.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            },
            confirmButton = {
                val groupId = group?.id
                TextButton(
                    enabled = !socialBusy && groupId != null,
                    onClick = {
                        if (groupId != null) {
                            onRemoveFamilyMember(groupId, member.userId)
                        }
                        pendingRemoveMember = null
                    },
                ) {
                    Text(
                        text = "내보내기",
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            },
        )
    }

    if (showFamilyAlarmDialog && authSession != null) {
        FamilyAlarmQuietTimeDialog(
            initialWindows = authSession.user.familyAlarmQuietWindows,
            onDismiss = { showFamilyAlarmDialog = false },
            onConfirm = { windows ->
                showFamilyAlarmDialog = false
                onChangeFamilyAlarmSettings(true, windows)
            },
        )
    }
}

@Composable
private fun FamilyAlarmPermissionCard(
    allowFamilyAlarms: Boolean,
    quietWindows: List<FamilyAlarmQuietWindow>,
    onToggle: (Boolean) -> Unit,
    onEditQuietTime: () -> Unit,
) {
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        text = "상대 알람 허용",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                    )
                    Text(
                        text = "함께 쓰는 사람이 내 알람을 맞출 수 있게 해요.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                VoiceAlarmSwitch(
                    checked = allowFamilyAlarms,
                    onCheckedChange = onToggle,
                )
            }
            if (allowFamilyAlarms) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "알람 받지 않을 시간",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium,
                        )
                        Text(
                            text = quietScheduleLabel(quietWindows),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    TextButton(onClick = onEditQuietTime) {
                        Text("수정")
                    }
                }
            }
        }
    }
}

@Composable
private fun MemberRow(
    member: FamilyGroupMember,
    isMe: Boolean,
    showRemove: Boolean,
    removeEnabled: Boolean,
    onRemove: () -> Unit,
) {
    Card(
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isMe) {
                MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.5f)
            } else {
                MaterialTheme.colorScheme.surface
            },
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = member.name ?: member.email ?: "멤버",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                )
                if (member.email != null && member.name != null) {
                    Text(
                        text = member.email,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            val chipLabel = when {
                member.role == "owner" -> "관리자"
                isMe -> "나"
                else -> null
            }
            if (chipLabel != null) {
                AssistChip(
                    onClick = {},
                    enabled = false,
                    label = { Text(chipLabel) },
                    colors = AssistChipDefaults.assistChipColors(
                        disabledContainerColor = MaterialTheme.colorScheme.secondaryContainer,
                        disabledLabelColor = MaterialTheme.colorScheme.onSecondaryContainer,
                    ),
                )
            }
            if (showRemove) {
                IconButton(onClick = onRemove, enabled = removeEnabled) {
                    Icon(
                        imageVector = Icons.Outlined.PersonRemove,
                        contentDescription = "내보내기",
                        tint = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }
    }
}
