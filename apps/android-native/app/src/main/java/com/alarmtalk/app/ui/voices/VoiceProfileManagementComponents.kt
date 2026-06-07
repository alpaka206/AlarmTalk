package com.alarmtalk.app

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.alarmtalk.app.core.VoiceAlarmLog.TAG
import com.alarmtalk.app.data.AlarmAudioStore
import com.alarmtalk.app.data.AlarmVoiceRecorder
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.VoiceProfileAudioLimits
import com.alarmtalk.app.data.VoiceProfileCreationDraft
import com.alarmtalk.app.network.apiErrorCode
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.TtsGenerateRequest
import com.alarmtalk.app.network.TtsGenerateResponse
import com.alarmtalk.app.network.VoiceProfile
import com.alarmtalk.app.network.VoiceSpeakerSegment
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

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

@Composable
internal fun FileSpeakerModeSelector(
    selected: FileSpeakerMode,
    enabled: Boolean,
    onSelect: (FileSpeakerMode) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("파일 속 목소리", fontWeight = FontWeight.SemiBold)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FileSpeakerModeButton(
                label = "1명",
                selected = selected == FileSpeakerMode.Single,
                enabled = enabled,
                onClick = { onSelect(FileSpeakerMode.Single) },
                modifier = Modifier.weight(1f),
            )
            FileSpeakerModeButton(
                label = "2명 이상",
                selected = selected == FileSpeakerMode.Multiple,
                enabled = enabled,
                onClick = { onSelect(FileSpeakerMode.Multiple) },
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
internal fun FileSpeakerModeButton(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    if (selected) {
        Button(
            onClick = onClick,
            enabled = enabled,
            modifier = modifier,
            shape = RoundedCornerShape(999.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.secondary,
                contentColor = MaterialTheme.colorScheme.onSecondary,
            ),
        ) {
            Text(label)
        }
    } else {
        OutlinedButton(
            onClick = onClick,
            enabled = enabled,
            modifier = modifier,
            shape = RoundedCornerShape(999.dp),
        ) {
            Text(label)
        }
    }
}

@Composable
internal fun RecordingLevelBars(
    levels: List<Float>,
    active: Boolean,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        levels.forEachIndexed { index, level ->
            val resolvedLevel = if (active) level else 0.1f + (index % 4) * 0.04f
            Box(
                modifier = Modifier
                    .width(4.dp)
                    .height((10 + resolvedLevel * 34).dp)
                    .background(
                        if (active) {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.outlineVariant
                        },
                        RoundedCornerShape(999.dp),
                    ),
            )
        }
    }
}

internal enum class FileSpeakerMode {
    Single,
    Multiple,
}

internal enum class VoiceRegistrationStep {
    Source,
    Identity,
    Sharing,
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun RelationshipDropdownField(
    selection: RelationshipSelection,
    onSelectionChange: (RelationshipSelection) -> Unit,
    isError: Boolean,
) {
    var expanded by remember { mutableStateOf(false) }
    val presetLabel = selection.preset?.label.orEmpty()
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ExposedDropdownMenuBox(
            expanded = expanded,
            onExpandedChange = { expanded = !expanded },
            modifier = Modifier.fillMaxWidth(),
        ) {
            OutlinedTextField(
                value = presetLabel,
                onValueChange = {},
                readOnly = true,
                label = { Text("나와의 관계 (필수)") },
                placeholder = { Text("관계를 선택해 주세요") },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                isError = isError && !selection.isComplete,
                supportingText = {
                    if (isError && !selection.isComplete) Text("꼭 입력해 주세요.")
                },
                shape = WakerInputShape,
                colors = wakerOutlinedTextFieldColors(),
                modifier = Modifier
                    .fillMaxWidth()
                    .menuAnchor(),
            )
            ExposedDropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false },
            ) {
                val relationshipOptions = listOf(RelationshipPreset.Custom) +
                    RelationshipPreset.entries.filterNot { it == RelationshipPreset.Custom }
                relationshipOptions.forEach { preset ->
                    DropdownMenuItem(
                        text = { Text(preset.label) },
                        onClick = {
                            expanded = false
                            onSelectionChange(
                                if (preset == RelationshipPreset.Custom) {
                                    selection.copy(preset = preset)
                                } else {
                                    RelationshipSelection(preset = preset, customLabel = "")
                                },
                            )
                        },
                    )
                }
            }
        }
        if (selection.preset == RelationshipPreset.Custom) {
            OutlinedTextField(
                value = selection.customLabel,
                onValueChange = {
                    onSelectionChange(selection.copy(customLabel = it.take(30)))
                },
                label = { Text("관계 직접 입력") },
                placeholder = { Text("예: 손녀, 연인, 동료") },
                singleLine = true,
                isError = isError && !selection.isComplete,
                supportingText = {
                    if (isError && !selection.isComplete) Text("꼭 입력해 주세요.")
                },
                shape = WakerInputShape,
                colors = wakerOutlinedTextFieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
internal fun ListenerTitlePreview(
    listenerTitle: String,
    relationshipLabel: String,
) {
    if (listenerTitle.isBlank()) return
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = WakerCardShape,
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = "이 목소리는 이렇게 불러줘요",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            Text(
                text = "\"$listenerTitle, 일어날 시간이에요\"",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            if (relationshipLabel.isNotBlank()) {
                MutedText("관계 · $relationshipLabel")
            }
        }
    }
}

@Composable
internal fun SharingOptionCard(
    enabled: Boolean,
    title: String,
    description: String,
    isChosen: Boolean,
    onClick: () -> Unit,
) {
    val containerColor = if (isChosen) {
        MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f)
    } else {
        MaterialTheme.colorScheme.surface
    }
    OutlinedCard(
        shape = WakerCardShape,
        border = wakerCardBorder(if (enabled) 1f else 0.4f),
        colors = CardDefaults.outlinedCardColors(containerColor = containerColor),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RadioButton(
                selected = isChosen,
                onClick = onClick,
                enabled = enabled,
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.SemiBold)
                MutedText(description)
            }
        }
    }
}

internal enum class RelationshipPreset(val label: String) {
    Mom("엄마"),
    Dad("아빠"),
    Grandma("할머니"),
    Grandpa("할아버지"),
    Son("아들"),
    Daughter("딸"),
    Granddaughter("손녀"),
    Grandson("손주"),
    Sibling("형제·자매"),
    Boyfriend("남자친구"),
    Girlfriend("여자친구"),
    Husband("남편"),
    Wife("아내"),
    Friend("친구"),
    Celebrity("연예인"),
    Custom("직접 입력"),
}

internal data class RelationshipSelection(
    val preset: RelationshipPreset? = null,
    val customLabel: String = "",
) {
    val resolved: String
        get() = when (preset) {
            null -> ""
            RelationshipPreset.Custom -> customLabel.trim()
            else -> preset.label
        }

    val isComplete: Boolean
        get() = resolved.isNotBlank()
}

internal fun parseRelationshipLabel(raw: String?): RelationshipSelection {
    val trimmed = raw?.trim().orEmpty()
    if (trimmed.isEmpty()) return RelationshipSelection()
    val match = RelationshipPreset.entries.firstOrNull {
        it != RelationshipPreset.Custom && it.label == trimmed
    }
    return if (match != null) {
        RelationshipSelection(preset = match)
    } else {
        RelationshipSelection(preset = RelationshipPreset.Custom, customLabel = trimmed)
    }
}

internal enum class SpeakerDraftStatus {
    Cloning,
    Synthesizing,
    Ready,
    Failed,
}

internal data class SpeakerDraftState(
    val profileId: String? = null,
    val previewUri: String? = null,
    val status: SpeakerDraftStatus = SpeakerDraftStatus.Cloning,
    val errorMessage: String? = null,
)

internal fun draftStatusLabel(status: SpeakerDraftStatus, errorMessage: String?): String = when (status) {
    SpeakerDraftStatus.Cloning -> "목소리를 만드는 중"
    SpeakerDraftStatus.Synthesizing -> "미리듣기를 만드는 중"
    SpeakerDraftStatus.Ready -> "준비 완료"
    SpeakerDraftStatus.Failed -> errorMessage ?: "미리듣기를 준비하지 못했어요"
}

@Composable
internal fun SpeakerDraftRow(
    speaker: VoiceSpeakerSegment,
    index: Int,
    state: SpeakerDraftState,
    isPlaying: Boolean,
    promotingBusy: Boolean,
    onTogglePlay: () -> Unit,
    onSelect: () -> Unit,
) {
    val ready = state.status == SpeakerDraftStatus.Ready && state.previewUri != null
    OutlinedCard {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "목소리 ${index + 1}",
                    fontWeight = FontWeight.SemiBold,
                )
                MutedText(draftStatusLabel(state.status, state.errorMessage))
            }
            IconButton(
                onClick = onTogglePlay,
                enabled = ready,
            ) {
                Icon(
                    imageVector = if (isPlaying) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
                    contentDescription = if (isPlaying) "일시정지" else "미리듣기",
                )
            }
            Button(
                onClick = onSelect,
                enabled = ready && !promotingBusy,
                shape = RoundedCornerShape(999.dp),
            ) {
                Text("선택")
            }
        }
    }
}

@Composable
internal fun VoiceProfileRow(
    profile: VoiceProfile,
    enabled: Boolean,
    canShareVoice: Boolean,
    onRename: () -> Unit,
    onShareChange: (Boolean) -> Unit,
    onDelete: () -> Unit,
) {
    val isProcessing = profile.status == "processing"
    val isDeleting = profile.status == "deleting"
    val rowEnabled = enabled && !isProcessing && !isDeleting
    var menuExpanded by remember { mutableStateOf(false) }
    val isShared = profile.isShared == true
    OutlinedCard(
        shape = WakerCardShape,
        border = wakerCardBorder(),
        colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier
                        .size(42.dp)
                        .background(
                            if (isDeleting) {
                                MaterialTheme.colorScheme.surfaceVariant
                            } else {
                                MaterialTheme.colorScheme.secondaryContainer
                            },
                            CircleShape,
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Mic,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSecondaryContainer,
                    )
                }
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = profile.name,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                        if (canShareVoice && isShared && !isProcessing && !isDeleting) {
                            VoiceSharedBadge()
                        }
                    }
                }
                when {
                    isProcessing -> VoiceProgressMessage("생성 중")
                    isDeleting -> VoiceProgressMessage("삭제 중")
                    else -> {
                        Box {
                            IconButton(
                                onClick = { menuExpanded = true },
                                enabled = rowEnabled,
                            ) {
                                Icon(Icons.Outlined.MoreVert, contentDescription = "더보기")
                            }
                            DropdownMenu(
                                expanded = menuExpanded,
                                onDismissRequest = { menuExpanded = false },
                            ) {
                                DropdownMenuItem(
                                    text = { Text("정보 수정") },
                                    leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null) },
                                    onClick = {
                                        menuExpanded = false
                                        onRename()
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text("삭제") },
                                    leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null) },
                                    onClick = {
                                        menuExpanded = false
                                        onDelete()
                                    },
                                )
                            }
                        }
                    }
                }
            }

            if (!isProcessing && !isDeleting) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.42f),
                    border = wakerCardBorder(if (canShareVoice) 0.72f else 0.36f),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(3.dp),
                        ) {
                            Text(
                                text = "목소리 공유",
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                        VoiceAlarmSwitch(
                            checked = isShared,
                            onCheckedChange = onShareChange,
                            enabled = rowEnabled && canShareVoice,
                        )
                    }
                }
            }
        }
    }
}

@Composable
internal fun VoiceSharedBadge() {
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.65f),
    ) {
        Text(
            text = "공유 중",
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onPrimaryContainer,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

@Composable
internal fun SharedVoiceProfileRow(
    profile: FamilyVoiceProfile,
    onEdit: () -> Unit,
) {
    val needsViewerInfo = profile.requiresViewerInfo()
    OutlinedCard(
        shape = WakerCardShape,
        border = wakerCardBorder(),
        colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier
                        .size(42.dp)
                        .background(MaterialTheme.colorScheme.secondaryContainer, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Mic,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSecondaryContainer,
                    )
                }
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Text(profile.name, fontWeight = FontWeight.SemiBold)
                    val ownerText = profile.ownerName?.takeIf { it.isNotBlank() }
                        ?.let { "${it}님에게 공유받은 목소리" } ?: "공유받은 목소리"
                    MutedText(ownerText)
                }
                IconButton(onClick = onEdit) {
                    Icon(Icons.Outlined.Edit, contentDescription = "내 정보 수정")
                }
            }
            if (needsViewerInfo) {
                OutlinedButton(
                    onClick = onEdit,
                    modifier = Modifier.fillMaxWidth(),
                    shape = WakerButtonShape,
                    border = wakerCardBorder(),
                    colors = wakerOutlinedButtonColors(),
                ) {
                    Text("이 목소리가 나를 어떻게 부를지 설정")
                }
            }
        }
    }
}

