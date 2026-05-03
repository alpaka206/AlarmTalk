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
import com.voicealarm.nativeapp.network.VoiceProfile

@Composable
internal fun VoiceAudioCard(
    editor: AlarmEditorState,
    voiceProfiles: List<VoiceProfile>,
    voiceProfileBusy: Boolean,
    audioMessage: String?,
    isRecording: Boolean,
    onPick: () -> Unit,
    onRecord: () -> Unit,
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
                Text(
                    text = "서버에서 음성을 만들고, 알람 전에 기기에 저장합니다.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                val readyProfiles = voiceProfiles.filter { it.status == null || it.status == "ready" }
                LaunchedEffect(visibleVoiceSource, readyProfiles) {
                    if (
                        visibleVoiceSource == VoiceSources.TTS_PROFILE &&
                        editor.voiceProfileId.isNullOrBlank() &&
                        readyProfiles.isNotEmpty()
                    ) {
                        editor.voiceProfileId = readyProfiles.first().id
                    }
                }
                Text("음성 프로필", fontWeight = FontWeight.SemiBold)
                if (voiceProfileBusy) {
                    MutedText("음성 프로필을 불러오는 중이에요.")
                } else if (voiceProfiles.isEmpty()) {
                    MutedText("사용 가능한 음성 프로필이 없어요. 프로필을 만들면 자동으로 표시됩니다.")
                } else if (readyProfiles.isEmpty()) {
                    MutedText("준비 완료된 음성 프로필이 아직 없어요.")
                } else {
                    ChipGrid(
                        options = readyProfiles.map { it.id to it.name },
                        selected = editor.voiceProfileId ?: "",
                        onSelect = {
                            editor.voiceProfileId = it
                            editor.clearTtsMeta()
                        },
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("랜덤 문구", fontWeight = FontWeight.SemiBold)
                        MutedText("카테고리와 언어에 맞는 문구를 자동으로 넣어요")
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
                        label = { Text("읽어줄 문구") },
                        minLines = 2,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                Text("카테고리", fontWeight = FontWeight.SemiBold)
                ChipGrid(
                    options = TtsCategories,
                    selected = editor.voiceCategory,
                    onSelect = {
                        editor.voiceCategory = it
                        editor.clearTtsMeta()
                        if (editor.voiceRandomPrompt) editor.voiceText = ""
                    },
                )
                Text("언어", fontWeight = FontWeight.SemiBold)
                ChipGrid(
                    options = TtsLanguages,
                    selected = editor.voiceLanguage,
                    onSelect = {
                        editor.voiceLanguage = it
                        editor.clearTtsMeta()
                        if (editor.voiceRandomPrompt) editor.voiceText = ""
                    },
                )
                if (editor.localAudioUri != null) {
                    MutedText("저장된 음성: ${audioFileLabel(editor.localAudioUri ?: "")}")
                }
            } else {
                Text(
                    text = editor.localAudioUri?.let(::audioFileLabel) ?: "선택된 음성 오디오가 없어요",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedButton(
                        onClick = onPick,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("파일 선택")
                    }
                    Button(
                        onClick = onRecord,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(if (isRecording) "녹음 종료" else "녹음")
                    }
                }
                if (editor.localAudioUri != null) {
                    OutlinedButton(onClick = onClear, modifier = Modifier.fillMaxWidth()) {
                        Text("음성 지우기")
                    }
                }
                Text(
                    text = "최대 ${AlarmAudioLimits.MAX_DURATION_MILLIS / 1000}초까지 사용할 수 있고, 긴 파일은 30초로 자릅니다.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
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
}
