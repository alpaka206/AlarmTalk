package com.alarmtalk.app

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R
import com.alarmtalk.app.WakerChipShape
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.VoucherItem

@Composable
internal fun FamilyConnectionPanel(
    socialBusy: Boolean,
    billingBusy: Boolean,
    familyGroup: FamilyGroupCurrentResponse?,
    subscriptionResponse: BillingSubscriptionResponse?,
    vouchers: List<VoucherItem>,
    onLeaveFamilyGroup: (String) -> Unit,
    onRegisterCode: (String) -> Unit,
    onEnsureFamilyShareCode: () -> Unit,
) {
    val currentGroup = familyGroup?.group
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val activePlanKey = subscriptionResponse?.plan?.key
    val sharedPlanLabel = when (activePlanKey) {
        "couple" -> stringResource(R.string.social_plan_label_couple)
        "family" -> stringResource(R.string.social_plan_label_family)
        else -> stringResource(R.string.social_plan_label_shared)
    }
    val familyShareCodes = remember(vouchers, activePlanKey) {
        vouchers.filter { voucher ->
            voucher.code.startsWith("INV-") &&
                voucher.planType == "family" &&
                (activePlanKey == null || voucher.planKey == activePlanKey) &&
                voucher.status !in listOf("expired", "revoked", "cancelled")
        }
    }
    val canManageShareCode = currentGroup != null &&
        familyGroup?.role == "owner" &&
        subscriptionResponse?.plan?.planType == "family"

    val activePlanName = subscriptionResponse?.plan?.takeIf { subscriptionResponse.subscription != null }?.name
    val hasActivePlan = activePlanName != null
    var showCodeInputs by remember(hasActivePlan) { mutableStateOf(!hasActivePlan) }
    var pendingRegisterCode by remember { mutableStateOf<String?>(null) }
    var showLeaveDialog by remember { mutableStateOf(false) }

    fun shareCode(code: String) {
        clipboard.setText(AnnotatedString(code))
        val sendIntent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, code)
        }
        context.startActivity(Intent.createChooser(sendIntent, context.getString(R.string.social_share_code_chooser_title)))
    }

    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val isSharedMember = currentGroup != null && familyGroup?.role == "member"

            if (canManageShareCode) {
                MutedText(stringResource(R.string.social_managing_shared_plan))
                return@Column
            }

            if (hasActivePlan && !showCodeInputs) {
                MutedText(stringResource(R.string.social_active_plan_in_use, activePlanName))
                if (isSharedMember) {
                    OutlinedButton(
                        onClick = { showLeaveDialog = true },
                        enabled = !socialBusy,
                        modifier = Modifier.fillMaxWidth(),
                        shape = WakerChipShape,
                    ) {
                        Text(
                            text = stringResource(R.string.social_leave_and_register_new_code),
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                } else {
                    OutlinedButton(
                        onClick = { showCodeInputs = true },
                        enabled = !socialBusy,
                        modifier = Modifier.fillMaxWidth(),
                        shape = WakerChipShape,
                    ) {
                        Text(stringResource(R.string.social_register_other_code))
                    }
                }
            } else {
                if (hasActivePlan) {
                    MutedText(stringResource(R.string.social_register_will_change_plan, activePlanName))
                }
                // 통합 입력: 초대·이용권 선물·프로모션 코드를 한 필드로 받고 서버가 판별한다.
                Text(stringResource(R.string.social_code_input_label), fontWeight = FontWeight.SemiBold)
                MutedText(stringResource(R.string.social_code_input_hint))
                CodeRedeemField(
                    busy = socialBusy || billingBusy,
                    onSubmit = { pendingRegisterCode = it },
                )
            }
        }
    }

    if (showLeaveDialog && currentGroup != null) {
        AlertDialog(
            onDismissRequest = { showLeaveDialog = false },
            title = {
                ModalDialogTitle(
                    title = stringResource(R.string.social_leave_dialog_title),
                    onDismiss = { showLeaveDialog = false },
                )
            },
            text = {
                MutedText(stringResource(R.string.social_leave_dialog_message))
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showLeaveDialog = false
                        showCodeInputs = true
                        onLeaveFamilyGroup(currentGroup.id)
                    },
                ) {
                    Text(
                        text = stringResource(R.string.social_leave_and_register_button),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            },
        )
    }

    pendingRegisterCode?.let { code ->
        AlertDialog(
            onDismissRequest = { pendingRegisterCode = null },
            title = {
                ModalDialogTitle(
                    title = stringResource(R.string.social_register_dialog_title),
                    onDismiss = { pendingRegisterCode = null },
                )
            },
            text = {
                MutedText(
                    if (hasActivePlan) {
                        stringResource(R.string.social_register_dialog_message_active, activePlanName)
                    } else {
                        stringResource(R.string.social_register_dialog_message)
                    },
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        onRegisterCode(code)
                        pendingRegisterCode = null
                    },
                ) {
                    Text(stringResource(R.string.social_register_button))
                }
            },
        )
    }

}
