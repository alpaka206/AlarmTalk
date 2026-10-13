package com.alarmtalk.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.FamilyGroupCurrentResponse

@Composable
internal fun FamilyConnectionPanel(
    socialBusy: Boolean,
    billingBusy: Boolean,
    familyGroup: FamilyGroupCurrentResponse?,
    subscriptionResponse: BillingSubscriptionResponse?,
    onLeaveFamilyGroup: (String) -> Unit,
    onRegisterCode: (String) -> Unit,
) {
    val currentGroup = familyGroup?.group
    val context = LocalContext.current
    val canManageShareCode = currentGroup != null &&
        familyGroup?.role == "owner" &&
        subscriptionResponse?.plan?.planType == "family"

    // 문장에 끼우는 이용권 이름은 **화면 언어의 이름**이다(`passPlanName` — iOS 는 `PlanTier.displayName(forPlanKey:)`).
    // 서버의 `plan.name` 은 한국어("개인")라, 그대로 끼우면 영어·일본어 화면이 "Your 개인 plan" 이 된다.
    val activePlan = subscriptionResponse?.plan?.takeIf { subscriptionResponse.subscription != null }
    val activePlanName = activePlan?.let { passPlanName(context, it.key, it.name) }
    val hasActivePlan = activePlanName != null
    var showCodeInputs by remember(hasActivePlan) { mutableStateOf(!hasActivePlan) }
    var pendingRegisterCode by remember { mutableStateOf<String?>(null) }
    var showLeaveDialog by remember { mutableStateOf(false) }

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
                        shape = WakerButtonShape,
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
                        shape = WakerButtonShape,
                    ) {
                        Text(stringResource(R.string.social_register_other_code))
                    }
                }
            } else {
                if (hasActivePlan) {
                    // 이 칸이 받는 것은 초대 코드 하나라 결과가 정해져 있다 — 플랜 이름 없이 그 결과를 말한다.
                    MutedText(stringResource(R.string.social_register_will_change_plan))
                }
                // 초대 코드 입력 — 커플·가족 이용권의 초대 코드(INV-) 하나만 받는다. 예전의 '통합 입력'
                // (초대·선물·프로모션 코드를 한 칸에서 받던 것)에서 프로모션은 2026-10-12, 선물은 2026-10-14 에
                // 빠졌다. ⚠ **선물 코드를 되살리지 말 것** — iOS 1.2.12 가 App Store 지침 3.1.1 로 두 번째
                // 반려됐다("선물 코드로 디지털 기능을 연다"). 할인·무료 이용은 스토어 오퍼 코드로 준다.
                Text(stringResource(R.string.social_code_input_label), fontWeight = FontWeight.SemiBold)
                MutedText(stringResource(R.string.social_code_input_hint))
                CodeRedeemField(
                    busy = socialBusy || billingBusy,
                    onSubmit = { pendingRegisterCode = it },
                )
            }
        }
    }

    // 확인형 모달은 로그아웃/탈퇴와 같은 iOS 알럿 + 제목-온리(문장이 곧 제목, 설명 없음).
    if (showLeaveDialog && currentGroup != null) {
        IosAlertDialog(
            title = stringResource(R.string.social_leave_dialog_message),
            message = null,
            onDismiss = { showLeaveDialog = false },
            actions = listOf(
                IosAlertAction(
                    label = stringResource(R.string.social_cancel_button),
                    onClick = { showLeaveDialog = false },
                ),
                IosAlertAction(
                    label = stringResource(R.string.social_leave_and_register_button),
                    emphasized = true,
                    destructive = true,
                    onClick = {
                        showLeaveDialog = false
                        showCodeInputs = true
                        onLeaveFamilyGroup(currentGroup.id)
                    },
                ),
            ),
        )
    }

    pendingRegisterCode?.let { code ->
        // 질문만 제목, 부가 설명은 작은 설명으로(탈퇴 알럿과 동일 구성). 이용권이 있는 사람에게는 어디로 옮겨 가는지와
        // Google Play 구독은 직접 해지해야 결제가 멈춘다는 것을 말한다 — 등록은 서버의 구독 행만 닫는다
        // (`social_register_dialog_message_active` 위 주석).
        IosAlertDialog(
            title = stringResource(R.string.social_register_dialog_message),
            message = if (hasActivePlan) {
                stringResource(R.string.social_register_dialog_message_active, activePlanName)
            } else {
                null
            },
            onDismiss = { pendingRegisterCode = null },
            actions = listOf(
                IosAlertAction(
                    label = stringResource(R.string.social_cancel_button),
                    onClick = { pendingRegisterCode = null },
                ),
                IosAlertAction(
                    label = stringResource(R.string.social_register_button),
                    emphasized = true,
                    onClick = {
                        onRegisterCode(code)
                        pendingRegisterCode = null
                    },
                ),
            ),
        )
    }

}
