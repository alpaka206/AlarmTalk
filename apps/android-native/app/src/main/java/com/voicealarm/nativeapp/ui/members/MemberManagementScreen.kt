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
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import com.voicealarm.nativeapp.network.BillingSubscriptionResponse
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
import com.voicealarm.nativeapp.network.FamilyGroupMember
import com.voicealarm.nativeapp.network.VoucherItem

@Composable
internal fun MemberManagementScreen(
    contentPadding: PaddingValues,
    familyGroup: FamilyGroupCurrentResponse?,
    subscriptionResponse: BillingSubscriptionResponse?,
    vouchers: List<VoucherItem>,
    currentUserId: String?,
    socialBusy: Boolean,
    billingBusy: Boolean,
    onBack: () -> Unit,
    onRemoveFamilyMember: (String, String) -> Unit,
    onEnsureFamilyShareCode: () -> Unit,
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
                    text = "$planLabel 멤버/공유 코드 관리",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                )
            }
        }

        if (group == null) {
            item {
                Text(
                    text = "참여 중인 공유 플랜이 없어요.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            return@LazyColumn
        }

        item {
            Text(
                text = "현재 ${sortedMembers.size}/${group.maxMembers}명",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
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
                        text = "공유 코드가 아직 없어요. $planLabel 구성원을 초대할 INV 코드를 만들어 주세요.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                item {
                    OutlinedButton(
                        onClick = onEnsureFamilyShareCode,
                        enabled = !billingBusy,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(14.dp),
                    ) {
                        Text("공유 코드 만들기")
                    }
                }
            } else {
                item {
                    val isFull = shareVoucher.useCount >= shareVoucher.maxUses
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
                                    "${shareVoucher.useCount}/${shareVoucher.maxUses}명 사용 · 정원이 가득 찼어요"
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
                                Text(if (isFull) "정원 가득" else "공유하기")
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
            title = { Text("멤버 내보내기") },
            text = {
                Text(
                    text = "${member.name ?: member.email ?: "이 멤버"}을(를) 정말 내보낼까요? 다시 들어오려면 새 초대 코드가 필요해요.",
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
            dismissButton = {
                TextButton(onClick = { pendingRemoveMember = null }) {
                    Text("취소")
                }
            },
        )
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
                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.35f)
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
