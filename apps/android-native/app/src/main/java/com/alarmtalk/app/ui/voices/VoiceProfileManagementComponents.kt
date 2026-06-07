package com.alarmtalk.app

import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Mic
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

// VoiceProfileManagementPanel 에서 분리한 하위 컴포넌트/다이얼로그.
// 동작/디자인 변경 없음 — top-level private→internal 가시성만 조정.

@Composable
internal fun VoiceProgressMessage(text: String) {
    Surface(
        shape = RoundedCornerShape(999.dp),
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

@Composable
internal fun VoiceProfileEditDialog(
    title: String,
    description: String,
    name: String,
    relationship: String,
    listenerTitle: String,
    nameError: Boolean,
    relationshipError: Boolean,
    listenerError: Boolean,
    onNameChange: (String) -> Unit,
    onRelationshipChange: (String) -> Unit,
    onListenerTitleChange: (String) -> Unit,
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
            label = { Text("목소리 이름") },
            singleLine = true,
            isError = nameError,
            supportingText = {
                if (nameError) Text("꼭 입력해 주세요.")
            },
            shape = WakerInputShape,
            colors = wakerOutlinedTextFieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = relationship,
            onValueChange = onRelationshipChange,
            label = { Text("나와의 관계") },
            placeholder = { Text("예: 손녀, 엄마, 연인") },
            singleLine = true,
            isError = relationshipError,
            supportingText = {
                if (relationshipError) Text("꼭 입력해 주세요.")
            },
            shape = WakerInputShape,
            colors = wakerOutlinedTextFieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = listenerTitle,
            onValueChange = onListenerTitleChange,
            label = { Text("이 목소리가 나를 부를 이름") },
            placeholder = { Text("예: 민지야, 여보") },
            singleLine = true,
            isError = listenerError,
            supportingText = {
                if (listenerError) Text("꼭 입력해 주세요.")
            },
            shape = WakerInputShape,
            colors = wakerOutlinedTextFieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
internal fun SharedVoiceViewerInfoDialog(
    profileName: String,
    sharedFromLabel: String,
    initialRelationship: String,
    initialListenerTitle: String,
    onDismiss: () -> Unit,
    onConfirm: (String, String) -> Unit,
) {
    var draftRelationship by remember(initialRelationship) { mutableStateOf(initialRelationship) }
    var draftListener by remember(initialListenerTitle) { mutableStateOf(initialListenerTitle) }
    var submitted by remember { mutableStateOf(false) }
    val relationshipError = submitted && draftRelationship.isBlank()
    val listenerError = submitted && draftListener.isBlank()

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .widthIn(max = 460.dp),
            shape = WakerCardShape,
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            shadowElevation = 18.dp,
            border = wakerCardBorder(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 620.dp)
                    .verticalScroll(rememberScrollState())
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(
                            text = "공유받은 목소리 설정",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            text = "알람에서 이 목소리가 나를 어떻게 부를지 정해요.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    IconButton(
                        onClick = onDismiss,
                        modifier = Modifier.size(42.dp),
                    ) {
                        Icon(Icons.Outlined.Close, contentDescription = "닫기")
                    }
                }
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(18.dp),
                    color = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.45f),
                    border = wakerCardBorder(),
                ) {
                    Row(
                        modifier = Modifier.padding(14.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            modifier = Modifier
                                .size(42.dp)
                                .background(MaterialTheme.colorScheme.surface, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Mic,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSecondaryContainer,
                            )
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(
                                text = profileName,
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onSecondaryContainer,
                            )
                            Text(
                                text = sharedFromLabel,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.76f),
                            )
                        }
                    }
                }
                OutlinedTextField(
                    value = draftRelationship,
                    onValueChange = { draftRelationship = it.take(30) },
                    label = { Text("나와의 관계") },
                    placeholder = { Text("예: 손주, 자식, 형제") },
                    singleLine = true,
                    isError = relationshipError,
                    supportingText = {
                        if (relationshipError) Text("꼭 입력해 주세요.")
                    },
                    shape = WakerInputShape,
                    colors = wakerOutlinedTextFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = draftListener,
                    onValueChange = { draftListener = it.take(30) },
                    label = { Text("이 목소리가 나를 부를 이름") },
                    placeholder = { Text("예: 지호야, 여보") },
                    singleLine = true,
                    isError = listenerError,
                    supportingText = {
                        if (listenerError) Text("꼭 입력해 주세요.")
                    },
                    shape = WakerInputShape,
                    colors = wakerOutlinedTextFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = {
                        submitted = true
                        if (draftRelationship.isNotBlank() && draftListener.isNotBlank()) {
                            onConfirm(draftRelationship.trim(), draftListener.trim())
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = WakerButtonShape,
                ) {
                    Text("저장")
                }
            }
        }
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
            shape = WakerCardShape,
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
                        Icon(Icons.Outlined.Close, contentDescription = "닫기")
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
                        Text("저장")
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
            shape = WakerCardShape,
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
                            text = "목소리 삭제",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                        )
                        MutedText("'$profileName' 목소리를 삭제할까요?")
                    }
                    IconButton(
                        onClick = onDismiss,
                        modifier = Modifier.size(42.dp),
                    ) {
                        Icon(Icons.Outlined.Close, contentDescription = "닫기")
                    }
                }
                MutedText("이 목소리를 쓰는 메시지는 텍스트만 남고, 알람은 기본 알람음으로 바뀌어요. 저장된 음원 파일도 함께 삭제돼요.")
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
                        Text("삭제")
                    }
                }
            }
        }
    }
}

