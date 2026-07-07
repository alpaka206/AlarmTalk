package com.alarmtalk.app

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource

/**
 * 같은 시각에 이미 알람이 있을 때 띄우는 교체 확인 알럿.
 *
 * "한 시각에는 알람 하나" 정책에 따라, 기존 알람을 교체할지 사용자가 직접 고른다
 * (자동 삭제하지 않음). 앱의 모든 확인/알럿 모달과 동일하게 [IosAlertDialog] 로 통일한다
 * (제목=결론, 본문=행동, 좌=취소·우=강조). [onConfirm] 은 기존 알람을 지우고 새 알람으로 교체.
 */
@Composable
internal fun DuplicateAlarmDialog(
    timeLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    IosAlertDialog(
        title = stringResource(R.string.r3dlg_duplicate_alarm_title),
        message = stringResource(R.string.r3dlg_duplicate_alarm_message, timeLabel),
        onDismiss = onDismiss,
        actions = listOf(
            IosAlertAction(
                label = stringResource(R.string.r3dlg_duplicate_alarm_cancel),
                onClick = onDismiss,
            ),
            IosAlertAction(
                label = stringResource(R.string.r3dlg_duplicate_alarm_replace),
                emphasized = true,
                onClick = onConfirm,
            ),
        ),
    )
}
