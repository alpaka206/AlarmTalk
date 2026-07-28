package com.alarmtalk.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.alarmtalk.app.R
import com.alarmtalk.app.WakerPanelShape
import com.alarmtalk.app.WakerPillShape

// VoiceProfileManagementPanel 에서 분리한 하위 컴포넌트/다이얼로그.
// 동작/디자인 변경 없음 — top-level private→internal 가시성만 조정.

@Composable
internal fun VoiceProgressMessage(text: String) {
    Surface(
        shape = WakerPillShape,
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.58f),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CircularProgressIndicator(
                modifier = Modifier.size(14.dp),
                strokeWidth = 2.dp,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            Text(
                text = text,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
        }
    }
}

/**
 * 등록이 끝난 목소리의 '이름 수정' 다이얼로그.
 *
 * 이름만 받는다. 관계·호칭 입력도 예전에는 여기 있었지만 실제로 저장된 적이 없다 — 클라가
 * 요청에 싣지 않았고, 서버도 등록 완료 후엔 페르소나 변경을 409(VOICE_PERSONA_LOCKED)로
 * 거부하며, 알람 클립은 등록 시점에 이미 전부 렌더돼 있다. 입력이 조용히 사라지는 필드였다.
 * 등록 플로우의 관계·호칭 입력은 그대로다(그때는 실제로 반영된다).
 */
@Composable
internal fun VoiceProfileEditDialog(
    title: String,
    description: String,
    name: String,
    nameError: Boolean,
    onNameChange: (String) -> Unit,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    VoiceFormDialog(
        title = title,
        description = description,
        onDismiss = onDismiss,
        onConfirm = onConfirm,
    ) {
        OutlinedTextField(
            value = name,
            onValueChange = onNameChange,
            label = { Text(stringResource(R.string.voicesr_voice_name_label)) },
            singleLine = true,
            isError = nameError,
            supportingText = {
                if (nameError) Text(stringResource(R.string.voicesr_required_field))
            },
            shape = WakerInputShape,
            colors = wakerOutlinedTextFieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
internal fun VoiceFormDialog(
    title: String,
    description: String,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
    content: @Composable () -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            shape = WakerDialogShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = wakerCardBorder(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            text = title,
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                        )
                        MutedText(description)
                    }
                    IconButton(
                        onClick = onDismiss,
                        modifier = Modifier.size(42.dp),
                    ) {
                        Icon(Icons.Outlined.Close, contentDescription = stringResource(R.string.voicesr_close))
                    }
                }
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    content()
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Button(
                        onClick = onConfirm,
                        modifier = Modifier.fillMaxWidth(),
                        shape = WakerButtonShape,
                    ) {
                        Text(stringResource(R.string.voicesr_save))
                    }
                }
            }
        }
    }
}

@Composable
internal fun VoiceProfileDeleteDialog(
    profileName: String,
    onDismiss: () -> Unit,
    onDelete: () -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            shape = WakerDialogShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = wakerCardBorder(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            text = stringResource(R.string.voicesr_delete_dialog_title),
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                        )
                        MutedText(stringResource(R.string.voicesr_delete_dialog_confirm, profileName))
                    }
                    IconButton(
                        onClick = onDismiss,
                        modifier = Modifier.size(42.dp),
                    ) {
                        Icon(Icons.Outlined.Close, contentDescription = stringResource(R.string.voicesr_close))
                    }
                }
                MutedText(stringResource(R.string.voicesr_delete_dialog_warning))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Button(
                        onClick = onDelete,
                        modifier = Modifier.fillMaxWidth(),
                        shape = WakerButtonShape,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.error,
                            contentColor = MaterialTheme.colorScheme.onError,
                        ),
                    ) {
                        Text(stringResource(R.string.voicesr_delete))
                    }
                }
            }
        }
    }
}

