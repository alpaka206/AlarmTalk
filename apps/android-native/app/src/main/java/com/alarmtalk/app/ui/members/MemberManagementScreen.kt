package com.alarmtalk.app

import android.content.Intent
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.PersonRemove
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R
import com.alarmtalk.app.WakerButtonShape
import com.alarmtalk.app.WakerPanelShape
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.FamilyAlarmQuietWindow
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyGroupMember
import com.alarmtalk.app.network.VoucherItem

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
    onRegenerateFamilyShareCode: () -> Unit,
    onChangeFamilyAlarmSettings: (Boolean, List<FamilyAlarmQuietWindow>) -> Unit,
) {
    val group = familyGroup?.group
    val isOwner = familyGroup?.role == "owner" && group != null
    val planLabel = when (subscriptionResponse?.plan?.key) {
        "couple" -> stringResource(R.string.social_plan_label_couple)
        "family" -> stringResource(R.string.social_plan_label_family)
        else -> stringResource(R.string.social_plan_label_shared)
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
        context.shareRedeemCode(code, RedeemCodeKind.Invite)
    }

    var pendingRemoveMember by remember { mutableStateOf<FamilyGroupMember?>(null) }
    var showFamilyAlarmDialog by remember { mutableStateOf(false) }
    var showRegenerateConfirm by remember { mutableStateOf(false) }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            // 탭·설정과 같은 그라데이션 배경 + 좌우 20dp·간격 16dp 공통 규격.
            .background(homeGradientBrush())
            .padding(contentPadding),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) {
                    Icon(
                        Icons.AutoMirrored.Outlined.KeyboardArrowLeft,
                        contentDescription = stringResource(R.string.social_back_cd),
                    )
                }
                Text(
                    text = stringResource(R.string.social_shared_plan_title),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                )
            }
        }

        if (group == null) {
            item {
                Text(
                    text = stringResource(R.string.social_no_shared_plan),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            return@LazyColumn
        }

        // 1) 공유 코드 (owner 전용) — 최상단
        if (isOwner) {
            item {
                Text(
                    text = stringResource(R.string.social_share_code_section_title),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            if (shareVoucher == null) {
                item {
                    Text(
                        text = if (isCapacityFull) {
                            stringResource(R.string.social_capacity_full_no_share)
                        } else {
                            stringResource(R.string.social_no_share_code_yet, planLabel)
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
                        shape = WakerButtonShape,
                    ) {
                        Text(if (isCapacityFull) stringResource(R.string.social_share_unavailable) else stringResource(R.string.social_create_share_code))
                    }
                }
            } else {
                item {
                    val isFull = isCapacityFull || shareVoucher.useCount >= shareVoucher.maxUses
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        shape = WakerPanelShape,
                    ) {
                        Column(
                            modifier = Modifier.padding(14.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            // 코드(좌) + 사용 현황(우상단)
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.Top,
                            ) {
                                Text(
                                    text = shareVoucher.code,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Text(
                                    text = if (isFull) {
                                        stringResource(
                                            R.string.social_voucher_usage_full,
                                            shareVoucher.useCount,
                                            shareVoucher.maxUses,
                                        )
                                    } else {
                                        stringResource(
                                            R.string.social_voucher_usage,
                                            shareVoucher.useCount,
                                            shareVoucher.maxUses,
                                        )
                                    },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            // 공유하기 + 재발급 — 한 줄에 나란히
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Button(
                                    onClick = { shareCode(shareVoucher.code) },
                                    enabled = !billingBusy && !isFull,
                                    modifier = Modifier.weight(1f),
                                    shape = WakerButtonShape,
                                ) {
                                    Text(if (isFull) stringResource(R.string.social_share_unavailable) else stringResource(R.string.social_share_button))
                                }
                                OutlinedButton(
                                    onClick = { showRegenerateConfirm = true },
                                    enabled = !billingBusy,
                                    modifier = Modifier.weight(1f),
                                    shape = WakerButtonShape,
                                ) {
                                    Text(stringResource(R.string.social_regenerate_share_code))
                                }
                            }
                        }
                    }
                }
            }
        }

        // 2) 상대 알람 허용 — 공유 코드와 구성원 사이
        if (authSession != null) {
            item {
                FamilyAlarmPermissionCard(
                    title = if (activePlanKey == "couple") {
                        stringResource(R.string.social_allow_partner_alarm_couple)
                    } else {
                        stringResource(R.string.social_allow_partner_alarm)
                    },
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

        // 3) 구성원
        item {
            Text(
                text = stringResource(R.string.social_members_section_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }

        items(sortedMembers, key = { it.userId }) { member ->
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
        val groupId = group?.id
        // 확인형 모달은 전부 공용 알럿으로 통일한다(M3 AlertDialog 를 쓰던 마지막 두 곳).
        IosAlertDialog(
            title = stringResource(R.string.social_remove_member_dialog_title),
            message = stringResource(R.string.social_remove_member_dialog_message),
            onDismiss = { pendingRemoveMember = null },
            actions = listOf(
                IosAlertAction(
                    label = stringResource(R.string.social_cancel_button),
                    onClick = { pendingRemoveMember = null },
                ),
                IosAlertAction(
                    label = stringResource(R.string.social_remove_button),
                    destructive = true,
                    // 모달이 열린 채 배경 동기화가 돌면(socialBusy) 눌러도 아무 일이 없다.
                    // 멀쩡해 보이는 버튼이 반응만 안 하면 고장과 구분되지 않는다(Codex #671 P2).
                    enabled = !socialBusy && groupId != null,
                    onClick = {
                        if (groupId != null) {
                            onRemoveFamilyMember(groupId, member.userId)
                            pendingRemoveMember = null
                        }
                    },
                ),
            ),
        )
    }

    if (showRegenerateConfirm) {
        IosAlertDialog(
            title = stringResource(R.string.social_regenerate_share_code_dialog_title),
            message = stringResource(R.string.social_regenerate_share_code_dialog_message),
            onDismiss = { showRegenerateConfirm = false },
            actions = listOf(
                IosAlertAction(
                    label = stringResource(R.string.social_cancel_button),
                    onClick = { showRegenerateConfirm = false },
                ),
                IosAlertAction(
                    label = stringResource(R.string.social_regenerate_share_code),
                    destructive = true,
                    enabled = !billingBusy,
                    onClick = {
                        showRegenerateConfirm = false
                        onRegenerateFamilyShareCode()
                    },
                ),
            ),
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
    title: String,
    allowFamilyAlarms: Boolean,
    quietWindows: List<FamilyAlarmQuietWindow>,
    onToggle: (Boolean) -> Unit,
    onEditQuietTime: () -> Unit,
) {
    val context = LocalContext.current
    Card(
        shape = WakerPanelShape,
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
                        text = title,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                    )
                }
                AlarmTalkSwitch(
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
                            text = stringResource(R.string.social_quiet_time_label),
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium,
                        )
                        Text(
                            text = quietScheduleLabel(context, quietWindows),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    IconButton(onClick = onEditQuietTime) {
                        Icon(
                            imageVector = Icons.Outlined.Edit,
                            contentDescription = stringResource(R.string.social_edit_button),
                        )
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
        shape = WakerPanelShape,
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
                    text = member.name ?: member.email ?: stringResource(R.string.social_member_fallback),
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
                member.role == "owner" -> stringResource(R.string.social_role_owner)
                isMe -> stringResource(R.string.social_role_me)
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
                        contentDescription = stringResource(R.string.social_remove_button),
                        tint = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }
    }
}
