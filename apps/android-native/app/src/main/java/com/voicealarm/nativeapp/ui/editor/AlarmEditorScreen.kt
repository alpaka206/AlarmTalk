package com.voicealarm.nativeapp

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.util.Base64
import android.util.Log
import android.widget.Toast
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
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import com.voicealarm.nativeapp.data.AlarmTimeCalculator
import com.voicealarm.nativeapp.data.AlarmVoiceRecorder
import com.voicealarm.nativeapp.data.CachedAlarmAudio
import com.voicealarm.nativeapp.data.VibrationPatterns
import com.voicealarm.nativeapp.data.VoiceSources
import com.voicealarm.nativeapp.network.AuthSession
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
import com.voicealarm.nativeapp.network.FamilyGroupMember
import com.voicealarm.nativeapp.network.FamilyVoiceProfile
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
    familyGroup: FamilyGroupCurrentResponse?,
    familyAlarmMode: Boolean,
    voiceProfiles: List<VoiceProfile>,
    familyVoices: List<FamilyVoiceProfile>,
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
    var localInputMode by remember { mutableStateOf(VoiceCaptureMode.Record) }
    var recordingElapsedMillis by remember { mutableStateOf(0L) }
    var recordingLevels by remember { mutableStateOf(List(18) { 0.08f }) }
    var selectedFileUri by remember { mutableStateOf<Uri?>(null) }
    var selectedFileDurationMillis by remember { mutableStateOf<Long?>(null) }
    var cropStartMillis by remember { mutableStateOf(0L) }
    var cropEndMillis by remember { mutableStateOf(AlarmAudioLimits.MAX_DURATION_MILLIS) }
    var mediaPlayer by remember { mutableStateOf<MediaPlayer?>(null) }
    val familyRecipients = remember(familyGroup, authSession?.user?.id, authSession?.user?.email) {
        familyAlarmRecipients(familyGroup, authSession)
    }
    var selectedFamilyRecipientId by remember(familyAlarmMode, familyRecipients) {
        mutableStateOf(if (familyAlarmMode) familyRecipients.firstOrNull()?.userId else null)
    }
    val ringtonePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode != Activity.RESULT_OK) return@rememberLauncherForActivityResult
        val pickedUri = result.data?.getParcelableExtra<Uri>(RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
        if (pickedUri == null) {
            editor.alarmSoundUri = null
            editor.alarmSoundLabel = "무음"
            editor.alarmVolumePercent = 0
            return@rememberLauncherForActivityResult
        }
        editor.alarmSoundUri = pickedUri.toString()
        editor.alarmSoundLabel = ringtoneTitle(context, pickedUri)
        if (editor.alarmVolumePercent == 0) editor.alarmVolumePercent = 100
    }

    fun selectedFamilyRecipient(): FamilyGroupMember? =
        familyRecipients.firstOrNull { it.userId == selectedFamilyRecipientId }

    fun applyCachedAudio(audio: CachedAlarmAudio) {
        editor.setCachedAudio(audio)
        audioMessage = null
    }

    // 가족(상대방) 알람 등록 흐름의 핵심 안내는 카드 안 텍스트만으론 놓치기 쉬워
    // 토스트로도 함께 띄운다. 알람만/음성만/둘다 모드 전부 동일.
    fun showFamilyAlarmToast(message: String) {
        if (!familyAlarmMode) return
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
    }

    fun prepareSelectedAudio(uri: Uri) {
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { audioStore.readDurationMillis(uri) }
                    ?: throw IllegalArgumentException("오디오 길이를 확인할 수 없는 파일은 사용할 수 없어요.")
            }.onSuccess { durationMillis ->
                selectedFileUri = uri
                selectedFileDurationMillis = durationMillis
                cropStartMillis = 0L
                cropEndMillis = durationMillis.coerceAtMost(AlarmAudioLimits.MAX_DURATION_MILLIS)
                editor.clearAudio()
                audioMessage = null
            }
                .onFailure { error ->
                    Log.e(TAG, "Failed to cache selected audio", error)
                    audioMessage = userFacingError(error, "선택한 오디오를 사용할 수 없어요")
                }
        }
    }

    suspend fun cacheSelectedCrop(): CachedAlarmAudio {
        val uri = selectedFileUri ?: throw IllegalStateException("파일을 선택해 주세요")
        val cropDurationMillis = (cropEndMillis - cropStartMillis).coerceIn(1_000L, AlarmAudioLimits.MAX_DURATION_MILLIS)
        return withContext(Dispatchers.IO) {
            audioStore.cacheFromUri(
                sourceUri = uri,
                maxDurationMillis = cropDurationMillis,
                startMillis = cropStartMillis,
            )
        }
    }

    fun playSelectedCrop() {
        scope.launch {
            runCatching {
                cacheSelectedCrop()
            }.onSuccess { audio ->
                mediaPlayer?.release()
                mediaPlayer = MediaPlayer.create(context, Uri.parse(audio.localAudioUri))?.apply {
                    setOnCompletionListener {
                        it.release()
                        if (mediaPlayer === it) mediaPlayer = null
                    }
                    start()
                }
            }.onFailure { error ->
                Log.e(TAG, "Failed to play cropped alarm audio", error)
                audioMessage = userFacingError(error, "선택한 구간을 재생하지 못했어요")
            }
        }
    }

    fun playCachedAudio() {
        val audioUri = editor.localAudioUri ?: return
        runCatching {
            mediaPlayer?.release()
            val player = MediaPlayer.create(context, Uri.parse(audioUri))
                ?: throw IllegalStateException("음성을 재생할 수 없어요")
            mediaPlayer = player.apply {
                setOnCompletionListener {
                    it.release()
                    if (mediaPlayer === it) mediaPlayer = null
                }
                start()
            }
        }.onFailure { error ->
            Log.e(TAG, "Failed to play cached alarm audio", error)
            audioMessage = userFacingError(error, "음성을 재생하지 못했어요")
        }
    }

    fun submitDraft(draft: AlarmDraft) {
        if (!familyAlarmMode) {
            onSave(draft)
            return
        }
        val recipient = selectedFamilyRecipient()
        if (recipient == null) {
            audioMessage = "알람을 받을 사람을 선택해 주세요"
            return
        }
        showFamilyAlarmToast("상대방 알람을 등록했어요")
        onSave(
            draft.copy(
                targetUserId = recipient.userId,
                targetUserName = familyMemberLabel(recipient),
            ),
        )
    }

    fun stopRecording() {
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { recorder.stop() }
            }.onSuccess { audio ->
                isRecording = false
                recordingElapsedMillis = audio.durationMillis ?: recordingElapsedMillis
                selectedFileUri = null
                selectedFileDurationMillis = null
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
            recorder.start(maxDurationMillis = AlarmAudioLimits.MAX_DURATION_MILLIS)
            isRecording = true
            recordingElapsedMillis = 0L
            recordingLevels = List(18) { 0.08f }
            audioMessage = "녹음 중..."
        }.onFailure { error ->
            Log.e(TAG, "Failed to start recording", error)
            audioMessage = userFacingError(error, "녹음을 시작할 수 없어요")
        }
    }

    fun saveEditor() {
        if (isSaving) return
        if (familyAlarmMode) {
            val fireAtMillis = AlarmTimeCalculator.nextFireAtMillis(
                hour = editor.hour,
                minute = editor.minute,
                repeatDaysMask = editor.repeatDaysMask,
                holidayOff = editor.holidayOff,
            )
            if (fireAtMillis - System.currentTimeMillis() < FAMILY_ALARM_MIN_LEAD_MILLIS) {
                val message = "상대방 알람은 최소 30분 이후로 설정해 주세요."
                audioMessage = message
                showFamilyAlarmToast(message)
                return
            }
        }
        if (editor.playMode == AlarmPlayModes.ALARM_ONLY) {
            editor.clearAudio()
            submitDraft(editor.toDraft())
            return
        }
        if (editor.voiceSource == VoiceSources.LOCAL_AUDIO) {
            if (selectedFileUri != null) {
                scope.launch {
                    isSaving = true
                    runCatching {
                        cacheSelectedCrop()
                    }.onSuccess { audio ->
                        applyCachedAudio(audio)
                        submitDraft(editor.toDraft())
                    }.onFailure { error ->
                        Log.e(TAG, "Failed to cache cropped local alarm audio", error)
                        audioMessage = userFacingError(error, "선택한 구간을 저장하지 못했어요")
                    }
                    isSaving = false
                }
                return
            }
            if (editor.localAudioUri.isNullOrBlank()) {
                audioMessage = "녹음하거나 파일을 선택해 주세요"
                return
            }
            submitDraft(editor.toDraft())
            return
        }
        if (authSession == null) {
            audioMessage = "음성 메시지는 로그인 후 사용할 수 있어요"
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
            audioMessage = "음성 메시지를 입력하거나 문구 추천을 켜 주세요"
            return
        }
        if (editor.hasFreshTtsAudio(profileId, text)) {
            submitDraft(editor.toDraft())
            return
        }
        val localTtsCacheKey = AlarmAudioStore.ttsCacheKey(
            profileId = profileId,
            text = text,
            category = editor.voiceCategory,
            language = editor.activeVoiceLanguage(),
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
            submitDraft(editor.toDraft())
            return
        }

        scope.launch {
            isSaving = true
            audioMessage = "음성을 생성해서 저장하는 중..."
            showFamilyAlarmToast("음성을 생성하는 중...")
            runCatching {
                val response = onGenerateTts(
                    TtsGenerateRequest(
                        voiceProfileId = profileId,
                        text = text,
                        category = editor.voiceCategory,
                        language = editor.activeVoiceLanguage(),
                        translate = editor.voiceTranslationEnabled,
                    ),
                )
                val audioBytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
                val rawAudioUri = response.audioUrl ?: response.audioObjectKey?.let { "r2://$it" }
                val cacheKey = AlarmAudioStore.ttsCacheKey(
                    profileId = profileId,
                    text = response.text,
                    category = editor.voiceCategory,
                    language = editor.activeVoiceLanguage(),
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
                submitDraft(editor.toDraft())
            }.onFailure { error ->
                Log.e(TAG, "Failed to generate TTS alarm audio", error)
                audioMessage = userFacingError(error, "음성 생성에 실패했어요")
            }
            isSaving = false
        }
    }

    val pickAudioLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) prepareSelectedAudio(uri)
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
            val startedAt = System.currentTimeMillis()
            while (isRecording) {
                recordingElapsedMillis = (System.currentTimeMillis() - startedAt)
                    .coerceAtMost(AlarmAudioLimits.MAX_DURATION_MILLIS)
                val level = (recorder.maxAmplitude().toFloat() / 32767f).coerceIn(0.06f, 1f)
                recordingLevels = recordingLevels.drop(1) + level
                if (recordingElapsedMillis >= AlarmAudioLimits.MAX_DURATION_MILLIS) {
                    stopRecording()
                    break
                }
                delay(250)
            }
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            if (recorder.isRecording) recorder.cancel()
            mediaPlayer?.release()
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

        if (familyAlarmMode) {
            item {
                Box(modifier = Modifier.padding(horizontal = editorHorizontalPadding)) {
                    FamilyAlarmTargetCard(
                        recipients = familyRecipients,
                        selectedRecipientId = selectedFamilyRecipientId,
                        onSelectRecipient = { selectedFamilyRecipientId = it },
                    )
                }
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
                        familyVoices = familyVoices,
                        voiceProfileBusy = voiceProfileBusy,
                        audioMessage = audioMessage,
                        localInputMode = localInputMode,
                        isRecording = isRecording,
                        recordingElapsedMillis = recordingElapsedMillis,
                        recordingLevels = recordingLevels,
                        selectedFileDurationMillis = selectedFileDurationMillis,
                        cropStartMillis = cropStartMillis,
                        cropEndMillis = cropEndMillis,
                        onLocalInputModeChange = { mode ->
                            if (!isRecording && mode != localInputMode) {
                                mediaPlayer?.release()
                                mediaPlayer = null
                                if (mode == VoiceCaptureMode.File) {
                                    editor.clearAudio()
                                } else {
                                    selectedFileUri = null
                                    selectedFileDurationMillis = null
                                    cropStartMillis = 0L
                                    cropEndMillis = AlarmAudioLimits.MAX_DURATION_MILLIS
                                }
                                audioMessage = null
                                localInputMode = mode
                            }
                        },
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
                        onCropChange = { start, end ->
                            cropStartMillis = start
                            cropEndMillis = end
                            editor.clearAudio()
                        },
                        onPreviewCrop = { playSelectedCrop() },
                        onPreviewAudio = { playCachedAudio() },
                        onClear = {
                            editor.clearAudio()
                            selectedFileUri = null
                            selectedFileDurationMillis = null
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
                    snoozeRepeatLimit = editor.snoozeRepeatLimit,
                    vibrationPattern = editor.vibrationPattern,
                    alarmVolumePercent = editor.alarmVolumePercent,
                    alarmSoundLabel = editor.alarmSoundLabel,
                    onSnoozeEnabledChange = { editor.snoozeEnabled = it },
                    onSnoozeMinutesChange = { editor.snoozeMinutes = it },
                    onSnoozeRepeatLimitChange = { editor.snoozeRepeatLimit = it },
                    onVibrationEnabledChange = {
                        editor.vibrationPattern = if (it) VibrationPatterns.DEFAULT else VibrationPatterns.NONE
                    },
                    onVibrationSelect = { editor.vibrationPattern = it },
                    onAlarmVolumeChange = { editor.alarmVolumePercent = it },
                    onPickAlarmSound = {
                        ringtonePickerLauncher.launch(
                            Intent(RingtoneManager.ACTION_RINGTONE_PICKER).apply {
                                putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_ALARM)
                                putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
                                putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, true)
                                putExtra(RingtoneManager.EXTRA_RINGTONE_TITLE, "알람 소리 선택")
                                val current = editor.alarmSoundUri?.let(Uri::parse)
                                    ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                                putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, current)
                            },
                        )
                    },
                    onUseDefaultAlarmSound = {
                        editor.alarmSoundUri = null
                        editor.alarmSoundLabel = null
                        if (editor.alarmVolumePercent == 0) editor.alarmVolumePercent = 100
                    },
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

@Composable
internal fun FamilyAlarmTargetCard(
    recipients: List<FamilyGroupMember>,
    selectedRecipientId: String?,
    onSelectRecipient: (String) -> Unit,
) {
    Card(
        shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("받는 사람", fontWeight = FontWeight.SemiBold)
            if (recipients.isEmpty()) {
                MutedText("상대가 알람 설정을 허용하면 여기에 표시돼요.")
            } else {
                ChipGrid(
                    options = recipients.map { it.userId to familyMemberLabel(it) },
                    selected = selectedRecipientId.orEmpty(),
                    onSelect = onSelectRecipient,
                    selectedContainerColor = MaterialTheme.colorScheme.secondaryContainer,
                    selectedLabelColor = MaterialTheme.colorScheme.onSecondaryContainer,
                )
                MutedText("30분 뒤부터 설정할 수 있어요.")
                recipients.firstOrNull { it.userId == selectedRecipientId }?.let { recipient ->
                    MutedText("설정 불가: ${familyAlarmQuietScheduleLabel(recipient)}")
                }
            }
        }
    }
}

private const val FAMILY_ALARM_MIN_LEAD_MILLIS = 30 * 60 * 1_000L

private fun ringtoneTitle(context: Context, uri: Uri): String =
    runCatching {
        RingtoneManager.getRingtone(context, uri)?.getTitle(context)
    }.getOrNull()?.takeIf { it.isNotBlank() } ?: "선택한 알람음"

internal fun familyMemberLabel(member: FamilyGroupMember): String =
    member.name?.takeIf { it.isNotBlank() }
        ?: member.email?.takeIf { it.isNotBlank() }
        ?: "멤버"

private fun familyAlarmQuietScheduleLabel(member: FamilyGroupMember): String {
    val windows = member.familyAlarmQuietWindows.takeIf { it.isNotEmpty() }
        ?: listOf(
            com.voicealarm.nativeapp.network.FamilyAlarmQuietWindow(
                days = member.familyAlarmQuietDays,
                start = member.familyAlarmQuietStart,
                end = member.familyAlarmQuietEnd,
            ),
        )
    return windows.joinToString(" · ") { window ->
        "${quietDaysLabelForFamily(window.days)} ${window.start}-${window.end}"
    }
}

private fun quietDaysLabelForFamily(days: List<Int>): String {
    val sorted = days.distinct().sorted()
    return when (sorted) {
        emptyList<Int>() -> "없음"
        listOf(1, 2, 3, 4, 5) -> "월-금"
        listOf(0, 6) -> "주말"
        listOf(0, 1, 2, 3, 4, 5, 6) -> "매일"
        else -> sorted.joinToString(",") { listOf("일", "월", "화", "수", "목", "금", "토")[it] }
    }
}
