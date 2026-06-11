package com.alarmtalk.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CardDefaults
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
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.VoiceProfile
import com.alarmtalk.app.network.VoiceSpeakerSegment

// VoiceProfileManagement 행/필드/드래프트 하위 컴포넌트.

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
                        AlarmTalkSwitch(
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

/** 시스템 제공(스톡) 보이스 행 — 수정/삭제/공유 액션 없이 정보만 보여준다. */
@Composable
internal fun SystemVoiceProfileRow(profile: VoiceProfile) {
    OutlinedCard(
        shape = WakerCardShape,
        border = wakerCardBorder(),
        colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(42.dp)
                    .background(MaterialTheme.colorScheme.primaryContainer, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Outlined.Mic,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(profile.name, fontWeight = FontWeight.SemiBold)
                MutedText("기본 제공 목소리 · 모든 이용권에서 사용 가능")
            }
        }
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

