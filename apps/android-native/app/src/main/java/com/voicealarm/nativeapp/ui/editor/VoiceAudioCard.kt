package com.voicealarm.nativeapp

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.voicealarm.nativeapp.data.AlarmAudioLimits
import com.voicealarm.nativeapp.data.AlarmPlayModes
import com.voicealarm.nativeapp.data.VibrationPatterns
import com.voicealarm.nativeapp.data.VoiceSources
import com.voicealarm.nativeapp.network.FamilyVoiceProfile
import com.voicealarm.nativeapp.network.VoiceProfile

@Composable
internal fun VoiceAudioCard(
    editor: AlarmEditorState,
    voiceProfiles: List<VoiceProfile>,
    familyVoices: List<FamilyVoiceProfile>,
    voiceProfileBusy: Boolean,
    audioMessage: String?,
    localInputMode: VoiceCaptureMode,
    isRecording: Boolean,
    recordingElapsedMillis: Long,
    recordingLevels: List<Float>,
    selectedFileDurationMillis: Long?,
    cropStartMillis: Long,
    cropEndMillis: Long,
    isCropPreviewActive: Boolean,
    isCachedAudioPreviewActive: Boolean,
    isPreviewPreparing: Boolean,
    onLocalInputModeChange: (VoiceCaptureMode) -> Unit,
    onPick: () -> Unit,
    onRecord: () -> Unit,
    onCropChange: (Long, Long) -> Unit,
    onPreviewCrop: () -> Unit,
    onPreviewAudio: () -> Unit,
    onOpenRandomPromptSettings: () -> Unit,
    onOpenVoiceTranslationSettings: () -> Unit,
    onClear: () -> Unit,
) {
    val visibleVoiceSource = if (editor.voiceSource == VoiceSources.SERVER_TTS) {
        VoiceSources.TTS_PROFILE
    } else {
        editor.voiceSource
    }

    LaunchedEffect(editor.voiceSource) {
        if (editor.voiceSource == VoiceSources.SERVER_TTS) {
            editor.voiceSource = VoiceSources.TTS_PROFILE
            editor.clearTtsMeta()
        }
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
            OptionChips(
                options = listOf(
                    VoiceSources.TTS_PROFILE to "알람 음성",
                    VoiceSources.LOCAL_AUDIO to "녹음/파일",
                ),
                selected = visibleVoiceSource,
                onSelect = {
                    editor.voiceSource = it
                    if (it == VoiceSources.TTS_PROFILE) {
                        editor.clearAudio()
                        editor.clearTtsMeta()
                    } else {
                        editor.clearTtsMeta()
                    }
                },
            )

            if (visibleVoiceSource == VoiceSources.TTS_PROFILE) {
                val readyProfiles = voiceProfiles.filter { it.status == null || it.status == "ready" }
                val readyFamilyVoices = familyVoices.filter {
                    (it.status == null || it.status == "ready") && it.isShared != false
                }
                val profileOptions = readyProfiles.map {
                    VoiceProfileOption(
                        id = it.id,
                        name = it.name,
                        detail = if (it.isShared == true) "내 알람 음성 · 공유 중" else "내 알람 음성",
                    )
                } +
                    readyFamilyVoices.map { profile ->
                        VoiceProfileOption(
                            id = profile.id,
                            name = profile.name,
                            detail = sharedVoiceDetail(profile),
                        )
                    }
                LaunchedEffect(visibleVoiceSource, voiceProfileBusy, profileOptions, editor.voiceProfileId) {
                    if (
                        visibleVoiceSource == VoiceSources.TTS_PROFILE &&
                        !voiceProfileBusy &&
                        profileOptions.isNotEmpty()
                    ) {
                        val selectedProfileAvailable = profileOptions.any { it.id == editor.voiceProfileId }
                        if (editor.voiceProfileId.isNullOrBlank() || !selectedProfileAvailable) {
                            editor.voiceProfileId = profileOptions.first().id
                            editor.clearTtsMeta()
                        }
                    }
                }
                val selectedProfileUnavailable = !voiceProfileBusy &&
                    !editor.voiceProfileId.isNullOrBlank() &&
                    profileOptions.none { it.id == editor.voiceProfileId }
                Text("알람에 들을 목소리", fontWeight = FontWeight.SemiBold)
                if (voiceProfileBusy) {
                    MutedText("알람 음성을 불러오는 중이에요.")
                } else if (voiceProfiles.isEmpty() && readyFamilyVoices.isEmpty()) {
                    MutedText("아직 사용할 목소리가 없어요.")
                } else if (profileOptions.isEmpty()) {
                    MutedText("준비 완료된 목소리가 아직 없어요.")
                } else {
                    VoiceProfileOptionList(
                        options = profileOptions,
                        selected = editor.voiceProfileId ?: "",
                        onSelect = {
                            editor.voiceProfileId = it
                            editor.clearTtsMeta()
                        },
                    )
                }
                if (selectedProfileUnavailable) {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(14.dp),
                        color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.58f),
                    ) {
                        Column(
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Text(
                                text = "삭제된 알람 음성",
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onErrorContainer,
                            )
                            Text(
                                text = "이미 저장된 음성은 그대로 울리지만, 문구를 바꾸려면 다른 알람 음성을 선택해 주세요.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onErrorContainer.copy(alpha = 0.78f),
                            )
                        }
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("랜덤 생성", fontWeight = FontWeight.SemiBold)
                    }
                    VoiceAlarmSwitch(
                        checked = editor.voiceRandomPrompt,
                        onCheckedChange = {
                            editor.voiceRandomPrompt = it
                            editor.clearTtsMeta()
                            if (it) {
                                editor.voiceText = ""
                                if (TtsLanguages.none { (language, _) -> language == editor.voiceLanguage }) {
                                    editor.voiceLanguage = "ko"
                                }
                            }
                        },
                    )
                }
                if (!editor.voiceRandomPrompt) {
                    ManualVoiceMessageField(
                        text = editor.voiceText,
                        translationEnabled = editor.voiceTranslationEnabled,
                        language = editor.voiceLanguage,
                        onTextChange = {
                            editor.voiceText = it.take(200)
                            editor.clearTtsMeta()
                        },
                        onTranslationEnabledChange = { enabled ->
                            editor.voiceTranslationEnabled = enabled
                            if (enabled && editor.voiceLanguage == "ko") {
                                editor.voiceLanguage = "en"
                            }
                            editor.clearTtsMeta()
                        },
                        onOpenTranslationSettings = onOpenVoiceTranslationSettings,
                    )
                } else {
                    RandomPromptSummaryRow(
                        category = editor.voiceCategory,
                        language = editor.voiceLanguage,
                        onClick = onOpenRandomPromptSettings,
                    )
                }
            } else {
                VoiceCaptureModeSelector(
                    selected = localInputMode,
                    enabled = !isRecording,
                    onSelect = onLocalInputModeChange,
                )
                if (localInputMode == VoiceCaptureMode.Record) {
                    VoiceRecordControls(
                        isRecording = isRecording,
                        elapsedMillis = recordingElapsedMillis,
                        maxDurationMillis = AlarmAudioLimits.MAX_DURATION_MILLIS,
                        levels = recordingLevels,
                        enabled = true,
                        notice = "최대 ${AlarmAudioLimits.MAX_DURATION_MILLIS / 1000}초",
                        onRecordClick = onRecord,
                    )
                } else {
                    VoiceFileControls(
                        durationMillis = selectedFileDurationMillis,
                        cropStartMillis = cropStartMillis,
                        cropEndMillis = cropEndMillis,
                        minDurationMillis = 1_000L,
                        maxDurationMillis = AlarmAudioLimits.MAX_DURATION_MILLIS,
                        enabled = !isRecording,
                        uploadLabel = "파일 업로드",
                        notice = "최대 ${AlarmAudioLimits.MAX_DURATION_MILLIS / 1000}초",
                        isPreviewActive = isCropPreviewActive,
                        isPreviewPreparing = isCropPreviewActive && isPreviewPreparing,
                        onPickFile = onPick,
                        onCropChange = onCropChange,
                        onPreviewCrop = onPreviewCrop,
                    )
                }
                if (editor.localAudioUri != null && !isRecording) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        OutlinedButton(
                            onClick = onPreviewAudio,
                            modifier = Modifier.weight(1f),
                        ) {
                            VoicePreviewButtonIcon(
                                active = isCachedAudioPreviewActive,
                                preparing = isCachedAudioPreviewActive && isPreviewPreparing,
                            )
                        }
                        OutlinedButton(
                            onClick = onClear,
                            modifier = Modifier.weight(1f),
                        ) {
                            Icon(Icons.Outlined.Delete, contentDescription = "지우기")
                        }
                    }
                }
                if (
                    editor.localAudioUri == null &&
                    selectedFileDurationMillis == null &&
                    !isRecording
                ) {
                    Text(
                        text = "녹음 또는 파일 업로드",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (editor.playMode == AlarmPlayModes.VOICE_ONLY) {
                VoiceRepeatSelector(
                    repeat = editor.voiceRepeat,
                    onRepeatChange = {
                        editor.voiceRepeat = it
                    },
                )
            }
            if (audioMessage != null) {
                Text(
                    text = audioMessage,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (isRecording) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            }
        }
}

private data class VoiceProfileOption(
    val id: String,
    val name: String,
    val detail: String,
)

@Composable
private fun VoiceProfileOptionList(
    options: List<VoiceProfileOption>,
    selected: String,
    onSelect: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { option ->
            VoiceProfileOptionRow(
                option = option,
                selected = selected == option.id,
                onClick = { onSelect(option.id) },
            )
        }
    }
}

@Composable
private fun VoiceProfileOptionRow(
    option: VoiceProfileOption,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = if (selected) {
            MaterialTheme.colorScheme.secondaryContainer
        } else {
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)
        },
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(
                    text = option.name,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = if (selected) {
                        MaterialTheme.colorScheme.onSecondaryContainer
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    },
                )
                Text(
                    text = option.detail,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (selected) {
                        MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.74f)
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            }
            Spacer(Modifier.width(12.dp))
            VoiceSelectionDot(selected = selected)
        }
    }
}

@Composable
private fun ManualVoiceMessageField(
    text: String,
    translationEnabled: Boolean,
    language: String,
    onTextChange: (String) -> Unit,
    onTranslationEnabledChange: (Boolean) -> Unit,
    onOpenTranslationSettings: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("직접 입력", fontWeight = FontWeight.SemiBold)
            Text(
                text = "${text.length}/200",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        OutlinedTextField(
            value = text,
            onValueChange = onTextChange,
            placeholder = { Text("알람에서 들을 음성 메시지") },
            minLines = 3,
            maxLines = 5,
            shape = VocaWakeInputShape,
            colors = vocaWakeOutlinedTextFieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
        ManualTranslationRow(
            enabled = translationEnabled,
            language = language,
            onEnabledChange = onTranslationEnabledChange,
            onOpenSettings = onOpenTranslationSettings,
        )
    }
}

@Composable
private fun ManualTranslationRow(
    enabled: Boolean,
    language: String,
    onEnabledChange: (Boolean) -> Unit,
    onOpenSettings: () -> Unit,
) {
    val languageLabel = voiceOptionLabel(TtsTranslationLanguages, language)
    Surface(
        onClick = {
            if (enabled) onOpenSettings()
        },
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text("번역", fontWeight = FontWeight.SemiBold)
                MutedText(if (enabled) languageLabel else "사용 안 함")
            }
            Spacer(Modifier.width(12.dp))
            if (enabled) {
                Text(
                    text = "변경",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.width(10.dp))
            }
            VoiceAlarmSwitch(
                checked = enabled,
                onCheckedChange = onEnabledChange,
            )
        }
    }
}

@Composable
private fun RandomPromptSummaryRow(
    category: String,
    language: String,
    onClick: () -> Unit,
) {
    val categoryLabel = voiceOptionLabel(TtsCategories, normalizedTtsCategory(category))
    val languageLabel = voiceOptionLabel(TtsLanguages, language)
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text("랜덤 문구 설정", fontWeight = FontWeight.SemiBold)
                MutedText("$categoryLabel · $languageLabel")
            }
            Spacer(Modifier.width(12.dp))
            Text(
                text = "변경",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun VoiceRepeatSelector(
    repeat: Boolean,
    onRepeatChange: (Boolean) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("목소리 반복", fontWeight = FontWeight.SemiBold)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            VoiceRepeatChoice(
                label = "한 번만",
                selected = !repeat,
                onClick = { onRepeatChange(false) },
                modifier = Modifier.weight(1f),
            )
            VoiceRepeatChoice(
                label = "반복",
                selected = repeat,
                onClick = { onRepeatChange(true) },
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun VoiceRepeatChoice(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        color = if (selected) {
            MaterialTheme.colorScheme.secondaryContainer
        } else {
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)
        },
    ) {
        Text(
            text = label,
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 11.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = if (selected) {
                MaterialTheme.colorScheme.onSecondaryContainer
            } else {
                MaterialTheme.colorScheme.onSurface
            },
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun VoiceSelectionDot(selected: Boolean) {
    Box(
        modifier = Modifier
            .size(18.dp)
            .background(
                color = if (selected) MaterialTheme.colorScheme.primary else Color.Transparent,
                shape = CircleShape,
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (selected) {
            Box(
                modifier = Modifier
                    .size(6.dp)
                    .background(MaterialTheme.colorScheme.onPrimary, CircleShape),
            )
        } else {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .background(MaterialTheme.colorScheme.outline, CircleShape),
            )
        }
    }
}

private fun voiceOptionLabel(options: List<Pair<String, String>>, value: String): String =
    options.firstOrNull { it.first == value }?.second ?: options.firstOrNull()?.second.orEmpty()

private fun sharedVoiceDetail(profile: FamilyVoiceProfile): String {
    val owner = profile.ownerName?.takeIf { it.isNotBlank() }
    return if (owner == null) {
        "공유 음성"
    } else {
        "공유 음성 · $owner"
    }
}
