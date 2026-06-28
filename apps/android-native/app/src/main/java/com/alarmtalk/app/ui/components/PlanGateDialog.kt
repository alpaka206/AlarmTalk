package com.alarmtalk.app

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource

/**
 * 유료 기능 게이트 다이얼로그. iOS 시스템 알럿 스타일(`IosAlertDialog`)로 표시한다.
 *
 * 콘텐츠는 한 줄(message)을 굵은 제목으로 보여주고 별도 설명/헤드라인은 두지 않는다
 * (Figma Alert 의 Title=True·Description=False 변형). 닫기(보조) + 이용권 보기(강조)
 * 두 텍스트 액션.
 */
@Composable
internal fun PlanGateDialog(
    message: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    @Suppress("UNUSED_PARAMETER")
    title: String = stringResource(R.string.r3dlg_plan_gate_title),
    confirmLabel: String = stringResource(R.string.r3dlg_plan_gate_confirm),
) {
    IosAlertDialog(
        title = message,
        message = null,
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
