package com.alarmtalk.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.alarmtalk.app.WakerButtonShape
import com.alarmtalk.app.WakerDialogShape
import com.alarmtalk.app.wakerCardBorder

/**
 * 같은 시각에 이미 알람이 있을 때 띄우는 확인 다이얼로그.
 *
 * "한 시각에는 알람 하나" 정책에 따라, 사용자가 기존 알람을 교체할지 직접
 * 선택하게 한다(자동 삭제하지 않음). [onConfirm] 은 기존 알람을 지우고 새
 * 알람으로 교체한다.
 */
@Composable
internal fun DuplicateAlarmDialog(
    timeLabel: String,
    existingLabel: String?,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val scheme = MaterialTheme.colorScheme
    val existing = existingLabel?.takeIf { it.isNotBlank() }
    val message = if (existing != null) {
        stringResource(R.string.r3dlg_duplicate_alarm_message_named, timeLabel, existing)
    } else {
        stringResource(R.string.r3dlg_duplicate_alarm_message, timeLabel)
    }
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .widthIn(max = 380.dp),
            shape = WakerDialogShape,
            color = scheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = wakerCardBorder(),
        ) {
            Column(
                modifier = Modifier.padding(22.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                ModalDialogTitle(
                    title = stringResource(R.string.r3dlg_duplicate_alarm_title),
                    onDismiss = onDismiss,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                    color = scheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(20.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = onConfirm,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                        shape = WakerButtonShape,
                    ) {
                        Text(stringResource(R.string.r3dlg_duplicate_alarm_replace), maxLines = 1)
                    }
                    TextButton(
                        onClick = onDismiss,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(stringResource(R.string.r3dlg_duplicate_alarm_cancel), maxLines = 1)
                    }
                }
            }
        }
    }
}
