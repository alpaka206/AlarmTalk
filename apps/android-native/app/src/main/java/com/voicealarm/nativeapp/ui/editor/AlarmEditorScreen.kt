package com.voicealarm.nativeapp

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.util.Base64
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.voicealarm.nativeapp.core.VoiceAlarmLog.TAG
import com.voicealarm.nativeapp.data.AlarmAudioLimits
import com.voicealarm.nativeapp.data.AlarmAudioStore
import com.voicealarm.nativeapp.data.AlarmDraft
import com.voicealarm.nativeapp.data.AlarmEntity
import com.voicealarm.nativeapp.data.AlarmPlayModes
import com.voicealarm.nativeapp.data.AlarmVoiceRecorder
import com.voicealarm.nativeapp.data.CachedAlarmAudio
import com.voicealarm.nativeapp.data.VibrationPatterns
import com.voicealarm.nativeapp.data.VoiceSources
import com.voicealarm.nativeapp.network.AuthSession
import com.voicealarm.nativeapp.network.TtsGenerateRequest
import com.voicealarm.nativeapp.network.TtsGenerateResponse
import com.voicealarm.nativeapp.network.VoiceProfile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun AlarmEditorScreen(
    contentPadding: PaddingValues,
    alarm: AlarmEntity?,
    authSession: AuthSession?,
    voiceProfiles: List<VoiceProfile>,
    voiceProfileBusy: Boolean,
    onCancel: () -> Unit,
    onGenerateTts: suspend (TtsGenerateRequest) -> TtsGenerateResponse,
    onSave: (AlarmDraft) -> Unit,
) {
    val editor = remember(alarm?.id) { AlarmEditorState.from(alarm) }
    val context = LocalContext.current
    val appContext = context.applicationContext
    val audioStore = remember(appContext) { AlarmAudioStore(appContext) }
    val recorder = remember(appContext) { AlarmVoiceRecorder(appContext, audioStore) }
    val scope = rememberCoroutineScope()
    var audioMessage by remember { mutableStateOf<String?>(null) }
    var isRecording by remember { mutableStateOf(false) }
    var isSaving by remember { mutableStateOf(false) }

    fun applyCachedAudio(audio: CachedAlarmAudio) {
        editor.setCachedAudio(audio)
        val seconds = audio.durationMillis?.let { " (${it / 1000}s)" } ?: ""
        audioMessage = "음성 오디오가 준비됐어요$seconds"
    }

    fun cacheSelectedAudio(uri: Uri) {
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { audioStore.cacheFromUri(uri) }
            }.onSuccess(::applyCachedAudio)
                .onFailure { error ->
                    Log.e(TAG, "Failed to cache selected audio", error)
                    audioMessage = userFacingError(error, "선택한 오디오를 사용할 수 없어요")
                }
        }
    }

    fun stopRecording() {
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { recorder.stop() }
            }.onSuccess { audio ->
                isRecording = false
                applyCachedAudio(audio)
            }.onFailure { error ->
                isRecording = false
                Log.e(TAG, "Failed to stop recording", error)
                audioMessage = userFacingError(error, "녹음에 실패했어요")
            }
        }
    }

    fun startRecording() {
        runCatching {
            recorder.start()
            isRecording = true
            audioMessage = "녹음 중..."
        }.onFailure { error ->
            Log.e(TAG, "Failed to start recording", error)
            audioMessage = userFacingError(error, "녹음을 시작할 수 없어요")
        }
    }

    fun saveEditor() {
        if (isSaving) return
        if (editor.playMode == AlarmPlayModes.ALARM_ONLY) {
            editor.clearAudio()
            onSave(editor.toDraft())
            return
        }
        if (editor.voiceSource == VoiceSources.LOCAL_AUDIO) {
            if (editor.localAudioUri.isNullOrBlank()) {
                audioMessage = "음성 오디오를 녹음하거나 파일로 선택해 주세요"
                return
            }
            onSave(editor.toDraft())
            return
        }
        if (authSession == null) {
            audioMessage = "AI 음성 알람은 로그인 후 사용할 수 있어요"
            return
        }
        val profileId = editor.voiceProfileId
            ?: voiceProfiles.firstOrNull { it.status == null || it.status == "ready" }?.id
        if (profileId.isNullOrBlank()) {
            audioMessage = "사용할 음성 프로필을 선택해 주세요"
            return
        }
        val text = editor.ttsTextForSave()
        if (text.isBlank()) {
            audioMessage = "읽어줄 문구를 입력하거나 랜덤 문구를 켜 주세요"
            return
        }
        if (editor.hasFreshTtsAudio(profileId, text)) {
            onSave(editor.toDraft())
            return
        }
        val localTtsCacheKey = AlarmAudioStore.ttsCacheKey(
            profileId = profileId,
            text = text,
            category = editor.voiceCategory,
            language = editor.voiceLanguage,
        )
        audioStore.getCachedAudio(localTtsCacheKey, rawAudioUri = editor.rawAudioUri)?.let { cached ->
            editor.setGeneratedTtsAudio(
                audio = cached,
                profileId = profileId,
                text = text,
                messageId = cached.messageId ?: editor.ttsMessageId ?: "",
                rawAudioUri = cached.rawAudioUri,
            )
            audioMessage = "기존 음성 캐시를 사용했어요"
            onSave(editor.toDraft())
            return
        }

        scope.launch {
            isSaving = true
            audioMessage = "음성을 생성해서 저장하는 중..."
            runCatching {
                val response = onGenerateTts(
                    TtsGenerateRequest(
                        voiceProfileId = profileId,
                        text = text,
                        category = editor.voiceCategory,
                        language = editor.voiceLanguage,
                    ),
                )
                val audioBytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
                val rawAudioUri = response.audioUrl ?: response.audioObjectKey?.let { "r2://$it" }
                val cacheKey = AlarmAudioStore.ttsCacheKey(
                    profileId = profileId,
                    text = response.text,
                    category = editor.voiceCategory,
                    language = editor.voiceLanguage,
                )
                val cachedAudio = withContext(Dispatchers.IO) {
                    audioStore.cacheGeneratedAudio(
                        bytes = audioBytes,
                        format = response.audioFormat,
                        rawAudioUri = rawAudioUri,
                        cacheKey = cacheKey,
                        messageId = response.messageId,
                    )
                }
                editor.setGeneratedTtsAudio(
                    audio = cachedAudio,
                    profileId = profileId,
                    text = response.text,
                    messageId = response.messageId,
                    rawAudioUri = rawAudioUri,
                )
                audioMessage = "생성한 음성을 로컬에 저장했어요"
                onSave(editor.toDraft())
            }.onFailure { error ->
                Log.e(TAG, "Failed to generate TTS alarm audio", error)
                audioMessage = userFacingError(error, "음성 생성에 실패했어요")
            }
            isSaving = false
        }
    }

    val pickAudioLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) cacheSelectedAudio(uri)
    }
    val recordPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            startRecording()
        } else {
            audioMessage = "마이크 권한이 필요해요"
        }
    }

    LaunchedEffect(isRecording) {
        if (isRecording) {
            delay(AlarmAudioLimits.MAX_DURATION_MILLIS)
            if (isRecording) stopRecording()
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            if (recorder.isRecording) recorder.cancel()
        }
    }

    val editorHorizontalPadding = 24.dp

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding),
        contentPadding = PaddingValues(bottom = 36.dp),
        verticalArrangement = Arrangement.spacedBy(22.dp),
    ) {
        item {
            AlarmTimePickerCard(
                hour = editor.hour,
                minute = editor.minute,
                onTimeChange = { selectedHour, selectedMinute ->
                    editor.hour = selectedHour
                    editor.minute = selectedMinute
                },
                modifier = Modifier.fillParentMaxWidth(),
            )
        }

        item {
            Box(modifier = Modifier.padding(horizontal = editorHorizontalPadding)) {
                OutlinedTextField(
                    value = editor.label,
                    onValueChange = { editor.label = it },
                    placeholder = { Text("알람 이름") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        item {
            Column(
                modifier = Modifier.padding(horizontal = editorHorizontalPadding),
            ) {
                RepeatSelector(
                    repeatDaysMask = editor.repeatDaysMask,
                    holidayOff = editor.holidayOff,
                    onToggleDay = { dayIndex ->
                        editor.repeatDaysMask = editor.repeatDaysMask xor (1 shl dayIndex)
                    },
                    onHolidayOffChange = { editor.holidayOff = it },
                )
            }
        }

        item {
            Box(modifier = Modifier.padding(horizontal = editorHorizontalPadding)) {
                PlayModeSelector(
                    selected = editor.playMode,
                    onSelect = { selectedMode ->
                        val wasAlarmOnly = editor.playMode == AlarmPlayModes.ALARM_ONLY
                        editor.playMode = selectedMode
                        if (selectedMode != AlarmPlayModes.ALARM_ONLY && authSession == null) {
                            editor.voiceSource = VoiceSources.LOCAL_AUDIO
                            editor.clearTtsMeta()
                        } else if (selectedMode != AlarmPlayModes.ALARM_ONLY && wasAlarmOnly) {
                            editor.voiceSource = VoiceSources.TTS_PROFILE
                            editor.clearTtsMeta()
                        }
                    },
                )
            }
        }

        if (editor.playMode != AlarmPlayModes.ALARM_ONLY) {
            item {
                Column(
                    modifier = Modifier.padding(horizontal = editorHorizontalPadding),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    EditorSectionTitle("음성")
                    VoiceAudioCard(
                        editor = editor,
                        voiceProfiles = voiceProfiles,
                        voiceProfileBusy = voiceProfileBusy,
                        audioMessage = audioMessage,
                        isRecording = isRecording,
                        onPick = { pickAudioLauncher.launch("audio/*") },
                        onRecord = {
                            if (isRecording) {
                                stopRecording()
                            } else if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
                                PackageManager.PERMISSION_GRANTED
                            ) {
                                startRecording()
                            } else {
                                recordPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                            }
                        },
                        onClear = {
                            editor.clearAudio()
                            audioMessage = "음성 오디오를 지웠어요"
                        },
                    )
                }
            }
        }

        item {
            Box(modifier = Modifier.padding(horizontal = editorHorizontalPadding)) {
                AlarmSettingsCard(
                    snoozeEnabled = editor.snoozeEnabled,
                    snoozeMinutes = editor.snoozeMinutes,
                    vibrationPattern = editor.vibrationPattern,
                    onSnoozeEnabledChange = { editor.snoozeEnabled = it },
                    onSnoozeMinutesChange = { editor.snoozeMinutes = it },
                    onVibrationEnabledChange = {
                        editor.vibrationPattern = if (it) VibrationPatterns.DEFAULT else VibrationPatterns.NONE
                    },
                    onVibrationSelect = { editor.vibrationPattern = it },
                )
            }
        }

        item {
            Box(modifier = Modifier.padding(horizontal = editorHorizontalPadding)) {
                EditorActionButtons(
                    isEditing = alarm != null,
                    isSaving = isSaving,
                    onCancel = onCancel,
                    onSave = ::saveEditor,
                )
            }
        }
    }
}

@Composable
internal fun EditorSectionTitle(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleLarge,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onBackground,
    )
}
