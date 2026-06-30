package com.alarmtalk.app

import androidx.annotation.StringRes
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R
import com.alarmtalk.app.WakerPanelShape
import com.alarmtalk.app.WakerPillShape
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
        Text(stringResource(R.string.voicesr_file_speaker_section_title), fontWeight = FontWeight.SemiBold)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FileSpeakerModeButton(
                label = stringResource(R.string.voicesr_file_speaker_single),
                selected = selected == FileSpeakerMode.Single,
                enabled = enabled,
                onClick = { onSelect(FileSpeakerMode.Single) },
                modifier = Modifier.weight(1f),
            )
            FileSpeakerModeButton(
                label = stringResource(R.string.voicesr_file_speaker_multiple),
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
            shape = WakerPillShape,
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
            shape = WakerPillShape,
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
                        WakerPillShape,
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
    val presetLabel = selection.preset?.let { stringResource(it.labelRes) }.orEmpty()
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
                label = { Text(stringResource(R.string.voicesr_relationship_label_required)) },
                placeholder = { Text(stringResource(R.string.voicesr_relationship_placeholder)) },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                isError = isError && !selection.isComplete,
                supportingText = {
                    if (isError && !selection.isComplete) Text(stringResource(R.string.voicesr_required_field))
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
                        text = { Text(stringResource(preset.labelRes)) },
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
                label = { Text(stringResource(R.string.voicesr_relationship_custom_label)) },
                placeholder = { Text(stringResource(R.string.voicesr_relationship_custom_placeholder)) },
                singleLine = true,
                isError = isError && !selection.isComplete,
                supportingText = {
                    if (isError && !selection.isComplete) Text(stringResource(R.string.voicesr_required_field))
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
                text = stringResource(R.string.voicesr_listener_preview_heading),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            Text(
                text = stringResource(R.string.voicesr_listener_preview_quote, listenerTitle),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            if (relationshipLabel.isNotBlank()) {
                MutedText(stringResource(R.string.voicesr_listener_preview_relationship, relationshipLabel))
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

// label 은 백엔드에 저장되고 parseRelationshipLabel 로 다시 preset 으로 복원되는
// 정규(canonical) 값이라 로케일과 무관하게 고정한다. labelRes 는 드롭다운 표시용 번역 리소스.
internal enum class RelationshipPreset(val label: String, @StringRes val labelRes: Int) {
    Mom("엄마", R.string.voices2_relationship_mom),
    Dad("아빠", R.string.voices2_relationship_dad),
    Grandma("할머니", R.string.voices2_relationship_grandma),
    Grandpa("할아버지", R.string.voices2_relationship_grandpa),
    Son("아들", R.string.voices2_relationship_son),
    Daughter("딸", R.string.voices2_relationship_daughter),
    Granddaughter("손녀", R.string.voices2_relationship_granddaughter),
    Grandson("손주", R.string.voices2_relationship_grandson),
    Sibling("형제·자매", R.string.voices2_relationship_sibling),
    Boyfriend("남자친구", R.string.voices2_relationship_boyfriend),
    Girlfriend("여자친구", R.string.voices2_relationship_girlfriend),
    Husband("남편", R.string.voices2_relationship_husband),
    Wife("아내", R.string.voices2_relationship_wife),
    Friend("친구", R.string.voices2_relationship_friend),
    Celebrity("연예인", R.string.voices2_relationship_celebrity),
    Custom("직접 입력", R.string.voices2_relationship_custom),
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

internal fun draftStatusLabel(
    context: android.content.Context,
    status: SpeakerDraftStatus,
    errorMessage: String?,
): String = when (status) {
    SpeakerDraftStatus.Cloning -> context.getString(R.string.voices2_draft_status_cloning)
    SpeakerDraftStatus.Synthesizing -> context.getString(R.string.voices2_draft_status_synthesizing)
    SpeakerDraftStatus.Ready -> context.getString(R.string.voices2_draft_status_ready)
    SpeakerDraftStatus.Failed ->
        errorMessage ?: context.getString(R.string.voices2_draft_status_failed)
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
    val context = LocalContext.current
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
                    text = stringResource(R.string.voicesr_speaker_draft_index, index + 1),
                    fontWeight = FontWeight.SemiBold,
                )
                MutedText(draftStatusLabel(context, state.status, state.errorMessage))
            }
            IconButton(
                onClick = onTogglePlay,
                enabled = ready,
            ) {
                Icon(
                    imageVector = if (isPlaying) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
                    contentDescription = if (isPlaying) stringResource(R.string.voicesr_pause) else stringResource(R.string.voicesr_preview),
                )
            }
            Button(
                onClick = onSelect,
                enabled = ready && !promotingBusy,
                shape = WakerPillShape,
            ) {
                Text(stringResource(R.string.voicesr_select))
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
                    isProcessing -> VoiceProgressMessage(stringResource(R.string.voicesr_status_creating))
                    isDeleting -> VoiceProgressMessage(stringResource(R.string.voicesr_status_deleting))
                    else -> {
                        Box {
                            IconButton(
                                onClick = { menuExpanded = true },
                                enabled = rowEnabled,
                            ) {
                                Icon(Icons.Outlined.MoreVert, contentDescription = stringResource(R.string.voicesr_more))
                            }
                            DropdownMenu(
                                expanded = menuExpanded,
                                onDismissRequest = { menuExpanded = false },
                            ) {
                                DropdownMenuItem(
                                    text = { Text(stringResource(R.string.voicesr_edit_info)) },
                                    leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null) },
                                    onClick = {
                                        menuExpanded = false
                                        onRename()
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text(stringResource(R.string.voicesr_delete)) },
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
                    shape = WakerPanelShape,
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
                                text = stringResource(R.string.voicesr_share_voice),
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
        shape = WakerPillShape,
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.65f),
    ) {
        Text(
            text = stringResource(R.string.voicesr_sharing_badge),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onPrimaryContainer,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

/** 시스템 제공(스톡) 보이스 행 — 수정/삭제/공유 액션 없이 정보만 보여준다. */
@Composable
internal fun SystemVoiceProfileRow(
    profile: VoiceProfile,
    playing: Boolean,
    onPlay: () -> Unit,
    selected: Boolean = false,
    onSelect: () -> Unit = {},
) {
    // 카드 본문 탭 = 기본 목소리로 선택, ▶ 버튼 = 인사말 미리듣기. 선택된 건 강조 + 라디오 체크.
    OutlinedCard(
        onClick = onSelect,
        shape = WakerCardShape,
        border = wakerCardBorder(),
        colors = CardDefaults.outlinedCardColors(
            containerColor = if (selected) {
                MaterialTheme.colorScheme.secondaryContainer
            } else {
                MaterialTheme.colorScheme.surface
            },
        ),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
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
            Text(
                text = profile.name,
                fontWeight = FontWeight.SemiBold,
                color = if (selected) {
                    MaterialTheme.colorScheme.onSecondaryContainer
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = onPlay) {
                Icon(
                    imageVector = if (playing) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
                    contentDescription = if (playing) stringResource(R.string.voicesr_stop) else stringResource(R.string.voicesr_listen),
                    tint = MaterialTheme.colorScheme.primary,
                )
            }
            RadioButton(selected = selected, onClick = onSelect)
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
                        ?.let { stringResource(R.string.voicesr_shared_from_owner, it) }
                        ?: stringResource(R.string.voicesr_shared_voice)
                    MutedText(ownerText)
                }
                IconButton(onClick = onEdit) {
                    Icon(Icons.Outlined.Edit, contentDescription = stringResource(R.string.voicesr_edit_my_info))
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
                    Text(stringResource(R.string.voicesr_set_how_voice_calls_me))
                }
            }
        }
    }
}

