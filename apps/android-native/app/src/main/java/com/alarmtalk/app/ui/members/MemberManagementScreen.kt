package com.alarmtalk.app

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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R
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
        val sendIntent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, code)
        }
        context.startActivity(Intent.createChooser(sendIntent, context.getString(R.string.social_share_code_chooser_title)))
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

        item {
            Text(
                text = stringResource(
                    R.string.social_plan_member_count,
                    planLabel,
                    sortedMembers.size,
                    group.maxMembers,
                ),
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
                        shape = RoundedCornerShape(14.dp),
                    ) {
                        Text(if (isCapacityFull) stringResource(R.string.social_share_unavailable) else stringResource(R.string.social_create_share_code))
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
                            Button(
                                onClick = { shareCode(shareVoucher.code) },
                                enabled = !billingBusy && !isFull,
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(14.dp),
                            ) {
                                Text(if (isFull) stringResource(R.string.social_share_unavailable) else stringResource(R.string.social_share_button))
                            }
                        }
                    }
                }
            }
        }

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
        AlertDialog(
            onDismissRequest = { pendingRemoveMember = null },
            title = {
                ModalDialogTitle(
                    title = stringResource(R.string.social_remove_member_dialog_title),
                    onDismiss = { pendingRemoveMember = null },
                )
            },
            text = {
                Text(
                    text = stringResource(R.string.social_remove_member_dialog_message),
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
                        text = stringResource(R.string.social_remove_button),
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
                        text = stringResource(R.string.social_allow_partner_alarm),
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                    )
                    Text(
                        text = stringResource(R.string.social_allow_partner_alarm_desc),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
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
                            text = quietScheduleLabel(quietWindows),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    TextButton(onClick = onEditQuietTime) {
                        Text(stringResource(R.string.social_edit_button))
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
