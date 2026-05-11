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
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
    onLocalInputModeChange: (VoiceCaptureMode) -> Unit,
    onPick: () -> Unit,
    onRecord: () -> Unit,
    onCropChange: (Long, Long) -> Unit,
    onPreviewCrop: () -> Unit,
    onPreviewAudio: () -> Unit,
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

    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            OptionChips(
                options = listOf(
                    VoiceSources.TTS_PROFILE to "음성 프로필",
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
                val profileOptions = readyProfiles.map { it.id to it.name } +
                    readyFamilyVoices.map { profile ->
                        profile.id to sharedVoiceLabel(profile)
                    }
                LaunchedEffect(visibleVoiceSource, profileOptions) {
                    if (
                        visibleVoiceSource == VoiceSources.TTS_PROFILE &&
                        editor.voiceProfileId.isNullOrBlank() &&
                        profileOptions.isNotEmpty()
                    ) {
                        editor.voiceProfileId = profileOptions.first().first
                    }
                }
                Text("음성 프로필", fontWeight = FontWeight.SemiBold)
                if (voiceProfileBusy) {
                    MutedText("음성 프로필을 불러오는 중이에요.")
                } else if (voiceProfiles.isEmpty() && readyFamilyVoices.isEmpty()) {
                    MutedText("사용 가능한 음성이 없어요.")
                } else if (profileOptions.isEmpty()) {
                    MutedText("준비 완료된 음성 프로필이 아직 없어요.")
                } else {
                    ChipGrid(
                        options = profileOptions,
                        selected = editor.voiceProfileId ?: "",
                        onSelect = {
                            editor.voiceProfileId = it
                            editor.clearTtsMeta()
                        },
                        selectedContainerColor = MaterialTheme.colorScheme.secondaryContainer,
                        selectedLabelColor = MaterialTheme.colorScheme.onSecondaryContainer,
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("랜덤 문구", fontWeight = FontWeight.SemiBold)
                        MutedText("문구를 추천해요")
                    }
                    VoiceAlarmSwitch(
                        checked = editor.voiceRandomPrompt,
                        onCheckedChange = {
                            editor.voiceRandomPrompt = it
                            editor.clearTtsMeta()
                            if (it) editor.voiceText = ""
                        },
                    )
                }
                if (!editor.voiceRandomPrompt) {
                    OutlinedTextField(
                        value = editor.voiceText,
                        onValueChange = {
                            editor.voiceText = it.take(200)
                            editor.clearTtsMeta()
                        },
                        label = { Text("음성 메시지") },
                        placeholder = { Text("알람에서 들을 음성 메시지") },
                        minLines = 2,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (editor.voiceRandomPrompt) {
                    Text("카테고리", fontWeight = FontWeight.SemiBold)
                    ChipGrid(
                        options = TtsCategories,
                        selected = editor.voiceCategory,
                        onSelect = {
                            editor.voiceCategory = it
                            editor.clearTtsMeta()
                            editor.voiceText = ""
                        },
                        selectedContainerColor = MaterialTheme.colorScheme.secondaryContainer,
                        selectedLabelColor = MaterialTheme.colorScheme.onSecondaryContainer,
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("번역", fontWeight = FontWeight.SemiBold)
                        MutedText(if (editor.voiceTranslationEnabled) "번역 후 생성" else "원문으로 생성")
                    }
                    VoiceAlarmSwitch(
                        checked = editor.voiceTranslationEnabled,
                        onCheckedChange = {
                            editor.voiceTranslationEnabled = it
                            if (!it) editor.voiceLanguage = "ko"
                            else if (editor.voiceLanguage == "ko") editor.voiceLanguage = "en"
                            editor.clearTtsMeta()
                            if (editor.voiceRandomPrompt) editor.voiceText = ""
                        },
                    )
                }
                if (editor.voiceTranslationEnabled) {
                    ChipGrid(
                        options = TtsLanguages,
                        selected = editor.voiceLanguage,
                        onSelect = {
                            editor.voiceLanguage = it
                            editor.clearTtsMeta()
                            if (editor.voiceRandomPrompt) editor.voiceText = ""
                        },
                        selectedContainerColor = MaterialTheme.colorScheme.secondaryContainer,
                        selectedLabelColor = MaterialTheme.colorScheme.onSecondaryContainer,
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
                        onPickFile = onPick,
                        onCropChange = onCropChange,
                        onPreviewCrop = onPreviewCrop,
                    )
                }
                if (editor.localAudioUri != null) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        OutlinedButton(onClick = onPreviewAudio, modifier = Modifier.weight(1f)) {
                            Text("들어보기")
                        }
                        OutlinedButton(onClick = onClear, modifier = Modifier.weight(1f)) {
                            Text("지우기")
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
}

private fun sharedVoiceLabel(profile: FamilyVoiceProfile): String {
    val owner = profile.ownerName?.takeIf { it.isNotBlank() }
    return if (owner == null) {
        "${profile.name} · 공유"
    } else {
        "${profile.name} · $owner"
    }
}
