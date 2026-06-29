package com.alarmtalk.app

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource

/**
 * 유료 기능 게이트 다이얼로그. iOS 시스템 알럿 스타일(`IosAlertDialog`)로 표시한다.
 *
 * 호출자가 넘긴 title 과 message 를 각각 알럿 제목/본문으로 유지하고,
 * 닫기(보조) + 이용권 보기(강조) 두 텍스트 액션을 제공한다.
 */
@Composable
internal fun PlanGateDialog(
    message: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    title: String = stringResource(R.string.r3dlg_plan_gate_title),
    confirmLabel: String = stringResource(R.string.r3dlg_plan_gate_confirm),
) {
    IosAlertDialog(
        title = title,
        message = message,
        onDismiss = onDismiss,
        modifier = modifier,
        actions = listOf(
            IosAlertAction(
                label = stringResource(R.string.r3dlg_modal_dialog_close),
                onClick = onDismiss,
            ),
            IosAlertAction(
                label = confirmLabel,
                emphasized = true,
                onClick = onConfirm,
            ),
        ),
    )
}
