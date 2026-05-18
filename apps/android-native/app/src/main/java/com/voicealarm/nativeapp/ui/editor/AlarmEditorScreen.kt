package com.voicealarm.nativeapp

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Base64
import android.util.Log
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import com.voicealarm.nativeapp.network.BillingSubscriptionResponse
import com.voicealarm.nativeapp.network.FamilyAlarmQuietWindow
import com.voicealarm.nativeapp.network.FamilyGroupCurrentResponse
import com.voicealarm.nativeapp.network.FamilyGroupMember
import com.voicealarm.nativeapp.network.FamilyVoiceProfile
import com.voicealarm.nativeapp.network.TtsGenerateRequest
import com.voicealarm.nativeapp.network.TtsGenerateResponse
import com.voicealarm.nativeapp.network.VoiceProfile
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private enum class AudioPreviewTarget {
    SelectedCrop,
    CachedAudio,
}

@Composable
internal fun AlarmEditorScreen(
    contentPadding: PaddingValues,
    alarm: AlarmEntity?,
    authSession: AuthSession?,
    subscriptionResponse: BillingSubscriptionResponse?,
    familyGroup: FamilyGroupCurrentResponse?,
    familyAlarmMode: Boolean,
    voiceProfiles: List<VoiceProfile>,
    familyVoices: List<FamilyVoiceProfile>,
    voiceProfileBusy: Boolean,
    onCancel: () -> Unit,
    onOpenBilling: () -> Unit,
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
    var previewTarget by remember { mutableStateOf<AudioPreviewTarget?>(null) }
    var previewPreparing by remember { mutableStateOf(false) }
    var previewStopJob by remember { mutableStateOf<Job?>(null) }
    var voicePlanGateOpen by remember { mutableStateOf(false) }
    val familyRecipients = remember(familyGroup, authSession?.user?.id, authSession?.user?.email) {
        familyAlarmRecipients(familyGroup, authSession)
    }
    var selectedFamilyRecipientId by remember(familyAlarmMode, familyRecipients) {
        mutableStateOf(if (familyAlarmMode) familyRecipients.firstOrNull()?.userId else null)
    }
    val voicePlanLocked = !hasPaidVoiceAccess(subscriptionResponse)
    val ringtonePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode != Activity.RESULT_OK) return@rememberLauncherForActivityResult
        val pickedUri = result.data?.getParcelableExtra<Uri>(RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
        if (pickedUri == null) {
            editor.alarmSoundUri = null
            editor.alarmSoundLabel = null
            editor.alarmVolumePercent = 0
            return@rememberLauncherForActivityResult
        }
        if (isDefaultAlarmSoundUri(pickedUri)) {
            editor.alarmSoundUri = null
            editor.alarmSoundLabel = null
        } else {
            editor.alarmSoundUri = pickedUri.toString()
            editor.alarmSoundLabel = ringtoneTitle(context, pickedUri)
        }
        if (editor.alarmVolumePercent == 0) editor.alarmVolumePercent = 100
    }

    fun selectedFamilyRecipient(): FamilyGroupMember? =
        familyRecipients.firstOrNull { it.userId == selectedFamilyRecipientId }

    fun applyCachedAudio(audio: CachedAlarmAudio) {
        editor.setCachedAudio(audio)
        audioMessage = null
    }

    // 가족/상대방 알람 등록 흐름의 안내는 카드와 텍스트로만 노출한다.
    // 토스트로 숨겨진 알림만 의존하지 않고 모든 모드에서 동일하게 확인할 수 있게 한다.
    fun showFamilyAlarmToast(message: String) {
        if (!familyAlarmMode) return
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
    }

    fun stopPreview() {
        previewStopJob?.cancel()
        previewStopJob = null
        mediaPlayer?.release()
        mediaPlayer = null
        previewTarget = null
        previewPreparing = false
    }

    fun startPreparedPreview(
        uri: Uri,
        target: AudioPreviewTarget,
        startMillis: Long = 0L,
        stopAfterMillis: Long? = null,
    ) {
        if (previewTarget == target && mediaPlayer != null) {
            stopPreview()
            return
        }
        stopPreview()
        previewTarget = target
        previewPreparing = true

        val player = MediaPlayer()
        mediaPlayer = player
        runCatching {
            player.setDataSource(context, uri)
            player.setOnPreparedListener { preparedPlayer ->
                if (mediaPlayer !== preparedPlayer) {
                    preparedPlayer.release()
                    return@setOnPreparedListener
                }
                runCatching {
                    fun scheduleAutoStop() {
                        val duration = stopAfterMillis ?: return
                        previewStopJob?.cancel()
                        previewStopJob = scope.launch {
                            delay(duration.coerceAtLeast(1L))
                            if (mediaPlayer === preparedPlayer) stopPreview()
                        }
                    }

                    fun startFromPreparedPosition() {
                        if (mediaPlayer !== preparedPlayer) return
                        previewPreparing = false
                        preparedPlayer.start()
                        scheduleAutoStop()
                    }

                    if (startMillis > 0L) {
                        preparedPlayer.setOnSeekCompleteListener { seekedPlayer ->
                            seekedPlayer.setOnSeekCompleteListener(null)
                            if (mediaPlayer === seekedPlayer) {
                                startFromPreparedPosition()
                            }
                        }
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            preparedPlayer.seekTo(startMillis, MediaPlayer.SEEK_CLOSEST)
                        } else {
                            preparedPlayer.seekTo(startMillis.coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
                        }
                    } else {
                        startFromPreparedPosition()
                    }
                }.onFailure { error ->
                    Log.e(TAG, "Failed to start alarm audio preview", error)
                    stopPreview()
                }
            }
            player.setOnCompletionListener { completedPlayer ->
                if (mediaPlayer === completedPlayer) stopPreview() else completedPlayer.release()
            }
            player.setOnErrorListener { errorPlayer, what, extra ->
                Log.e(TAG, "Alarm audio preview error what=$what extra=$extra")
                if (mediaPlayer === errorPlayer) stopPreview() else errorPlayer.release()
                true
            }
            player.prepareAsync()
        }.onFailure { error ->
            Log.e(TAG, "Failed to prepare alarm audio preview", error)
            stopPreview()
        }
    }

    fun prepareSelectedAudio(uri: Uri) {
        stopPreview()
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
                    audioMessage = userFacingError(error, "선택한 오디오를 사용할 수 없어요.")
                }
        }
    }

    suspend fun cacheSelectedCrop(): CachedAlarmAudio {
        val uri = selectedFileUri ?: throw IllegalStateException("파일을 선택해 주세요.")
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
        val uri = selectedFileUri ?: return
        val previewDurationMillis = (cropEndMillis - cropStartMillis)
            .coerceIn(1_000L, AlarmAudioLimits.MAX_DURATION_MILLIS)
        startPreparedPreview(
            uri = uri,
            target = AudioPreviewTarget.SelectedCrop,
            startMillis = cropStartMillis,
            stopAfterMillis = previewDurationMillis,
        )
    }

    fun playCachedAudio() {
        val audioUri = editor.localAudioUri ?: return
        startPreparedPreview(
            uri = Uri.parse(audioUri),
            target = AudioPreviewTarget.CachedAudio,
        )
    }

    fun submitDraft(draft: AlarmDraft) {
        if (!familyAlarmMode) {
            onSave(draft)
            return
        }
        val recipient = selectedFamilyRecipient()
        if (recipient == null) {
            audioMessage = "알람을 받을 사람을 선택해 주세요."
            return
        }
        showFamilyAlarmToast("상대방 알람을 등록했어요.")
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
                audioMessage = userFacingError(error, "녹음에 실패했어요.")
            }
        }
    }

    fun startRecording() {
        stopPreview()
        runCatching {
            recorder.start(maxDurationMillis = AlarmAudioLimits.MAX_DURATION_MILLIS)
            isRecording = true
            recordingElapsedMillis = 0L
            recordingLevels = List(18) { 0.08f }
            audioMessage = "녹음 중..."
        }.onFailure { error ->
            Log.e(TAG, "Failed to start recording", error)
            audioMessage = userFacingError(error, "녹음을 시작할 수 없어요.")
        }
    }

    fun showVoicePlanGate() {
        audioMessage = null
        voicePlanGateOpen = true
    }

    fun saveEditor() {
        if (isSaving) return
        if (voicePlanLocked && editor.playMode != AlarmPlayModes.ALARM_ONLY) {
            showVoicePlanGate()
            return
        }
        if (familyAlarmMode) {
            val recipient = selectedFamilyRecipient()
            if (recipient == null) {
                audioMessage = "알람을 받을 사람을 선택해 주세요."
                return
            }
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
            if (isFamilyAlarmTimeUnavailable(recipient, editor.hour, editor.minute, editor.repeatDaysMask)) {
                val message = "상대가 받을 수 없는 시간이에요."
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
                        audioMessage = userFacingError(error, "선택한 구간을 저장하지 못했어요.")
                    }
                    isSaving = false
                }
                return
            }
            if (editor.localAudioUri.isNullOrBlank()) {
                audioMessage = "녹음하거나 파일을 선택해 주세요."
                return
            }
            submitDraft(editor.toDraft())
            return
        }
        if (authSession == null) {
            audioMessage = "음성 메시지는 로그인 후 사용할 수 있어요."
            return
        }
        val profileId = editor.voiceProfileId
            ?: voiceProfiles.firstOrNull { it.status == null || it.status == "ready" }?.id
        if (profileId.isNullOrBlank()) {
            audioMessage = "사용할 알람 음성을 선택해 주세요."
            return
        }
        val text = editor.ttsTextForSave()
        if (text.isBlank() && !editor.voiceRandomPrompt) {
            audioMessage = "음성 메시지를 입력하거나 문구 추천을 켜 주세요."
            return
        }
        val usableProfileIds = (
            voiceProfiles.filter { it.status == null || it.status == "ready" }.map { it.id } +
                familyVoices.filter { (it.status == null || it.status == "ready") && it.isShared != false }.map { it.id }
            ).toSet()
        if (profileId !in usableProfileIds && !editor.hasFreshTtsAudio(profileId, text)) {
            audioMessage = "삭제된 알람 음성이라 문구를 수정할 수 없어요. 다른 알람 음성을 선택해 주세요."
            return
        }
        if (editor.hasFreshTtsAudio(profileId, text)) {
            submitDraft(editor.toDraft())
            return
        }
        val localTtsCacheKey = AlarmAudioStore.ttsCacheKey(
            profileId = profileId,
            text = text,
            category = editor.activeVoiceCategory(),
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
            audioMessage = "기존 음성 캐시를 사용했어요."
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
                        category = editor.activeVoiceCategory(),
                        language = editor.activeVoiceLanguage(),
                        translate = editor.shouldTranslateVoiceText(),
                        random = editor.voiceRandomPrompt,
                    ),
                )
                val audioBytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
                val rawAudioUri = response.audioUrl ?: response.audioObjectKey?.let { "r2://$it" }
                val cacheKey = AlarmAudioStore.ttsCacheKey(
                    profileId = profileId,
                    text = response.text,
                    category = editor.activeVoiceCategory(),
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
                audioMessage = "생성한 음성을 로컬에 저장했어요."
            submitDraft(editor.toDraft())
            }.onFailure { error ->
                Log.e(TAG, "Failed to generate TTS alarm audio", error)
                audioMessage = userFacingError(error, "음성 생성에 실패했어요.")
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
            audioMessage = "마이크 권한이 필요해요."
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
            stopPreview()
        }
    }

    LaunchedEffect(voicePlanLocked) {
        if (voicePlanLocked && editor.playMode != AlarmPlayModes.ALARM_ONLY) {
            stopPreview()
            editor.playMode = AlarmPlayModes.ALARM_ONLY
            editor.clearAudio()
            selectedFileUri = null
            selectedFileDurationMillis = null
            audioMessage = "무료 이용권에서는 일반 알람을 사용할 수 있어요."
        }
    }

    val editorHorizontalPadding = 24.dp
    val editorBottomPadding = 12.dp
    var settingsDetailPanel by remember { mutableStateOf<String?>(null) }

    BackHandler(enabled = settingsDetailPanel != null) {
        settingsDetailPanel = null
    }

    LaunchedEffect(editor.playMode, editor.voiceRandomPrompt) {
        if (editor.playMode == AlarmPlayModes.VOICE_ONLY && settingsDetailPanel == "sound") {
            settingsDetailPanel = null
        }
        if (!editor.voiceRandomPrompt && settingsDetailPanel == "random_prompt") {
            settingsDetailPanel = null
        }
        if (
            (editor.voiceRandomPrompt || !editor.voiceTranslationEnabled) &&
            settingsDetailPanel == "voice_translation"
        ) {
            settingsDetailPanel = null
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding),
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
        ) {
            AlarmEditorTopBar(
                isEditing = alarm != null,
                familyAlarmMode = familyAlarmMode,
                onCancel = onCancel,
            )
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                contentPadding = PaddingValues(top = 8.dp, bottom = editorBottomPadding),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                item {
                    AlarmTimePickerCard(
                        hour = editor.hour,
                        minute = editor.minute,
                        onTimeChange = { selectedHour, selectedMinute ->
                            editor.hour = selectedHour
                            editor.minute = selectedMinute
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                item {
                    Box(modifier = Modifier.padding(horizontal = editorHorizontalPadding)) {
                        ScheduleDetailsCard(
                            hour = editor.hour,
                            minute = editor.minute,
                            repeatDaysMask = editor.repeatDaysMask,
                            holidayOff = editor.holidayOff,
                            label = editor.label,
                            onLabelChange = { editor.label = it },
                            onToggleDay = { dayIndex ->
                                val nextMask = editor.repeatDaysMask xor (1 shl dayIndex)
                                editor.repeatDaysMask = nextMask
                                if (nextMask == 0) editor.holidayOff = false
                            },
                            onHolidayOffChange = { enabled ->
                                if (editor.repeatDaysMask != 0) editor.holidayOff = enabled
                            },
                        )
                    }
                }

                if (familyAlarmMode) {
                    item {
                        Box(modifier = Modifier.padding(horizontal = editorHorizontalPadding)) {
                            FamilyAlarmTargetCard(
                                recipients = familyRecipients,
                                selectedRecipientId = selectedFamilyRecipientId,
                                hour = editor.hour,
                                minute = editor.minute,
                                repeatDaysMask = editor.repeatDaysMask,
                                holidayOff = editor.holidayOff,
                                onSelectRecipient = { selectedFamilyRecipientId = it },
                            )
                        }
                    }
                }

                item {
                    Box(modifier = Modifier.padding(horizontal = editorHorizontalPadding)) {
                        PlayModeCard(
                            selected = editor.playMode,
                            voiceLocked = voicePlanLocked,
                            onLockedVoiceClick = ::showVoicePlanGate,
                            onSelect = { selectedMode ->
                                if (voicePlanLocked && selectedMode != AlarmPlayModes.ALARM_ONLY) {
                                    showVoicePlanGate()
                                    return@PlayModeCard
                                }
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
                        Box(modifier = Modifier.padding(horizontal = editorHorizontalPadding)) {
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
                                isCropPreviewActive = previewTarget == AudioPreviewTarget.SelectedCrop,
                                isCachedAudioPreviewActive = previewTarget == AudioPreviewTarget.CachedAudio,
                                isPreviewPreparing = previewPreparing,
                                onLocalInputModeChange = { mode ->
                                    if (!isRecording && mode != localInputMode) {
                                        stopPreview()
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
                                    stopPreview()
                                    cropStartMillis = start
                                    cropEndMillis = end
                                    editor.clearAudio()
                                },
                                onPreviewCrop = { playSelectedCrop() },
                                onPreviewAudio = { playCachedAudio() },
                                onOpenRandomPromptSettings = { settingsDetailPanel = "random_prompt" },
                                onOpenVoiceTranslationSettings = { settingsDetailPanel = "voice_translation" },
                                onClear = {
                                    stopPreview()
                                    editor.clearAudio()
                                    selectedFileUri = null
                                    selectedFileDurationMillis = null
                                    audioMessage = "음성 오디오를 지웠어요."
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
                            showAlarmSound = editor.playMode != AlarmPlayModes.VOICE_ONLY,
                            onSnoozeEnabledChange = { editor.snoozeEnabled = it },
                            onSnoozeMinutesChange = { editor.snoozeMinutes = it },
                            onSnoozeRepeatLimitChange = { editor.snoozeRepeatLimit = it },
                            onVibrationEnabledChange = {
                                editor.vibrationPattern = if (it) VibrationPatterns.DEFAULT else VibrationPatterns.NONE
                            },
                            onVibrationSelect = { editor.vibrationPattern = it },
                            onAlarmVolumeChange = { editor.alarmVolumePercent = it },
                            onOpenSnoozeSettings = { settingsDetailPanel = "snooze" },
                            onOpenVibrationSettings = { settingsDetailPanel = "vibration" },
                            onOpenAlarmSoundSettings = { settingsDetailPanel = "sound" },
                        )
                    }
                }
            }

            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.background,
                tonalElevation = 0.dp,
                shadowElevation = 0.dp,
            ) {
                Column {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f))
                    Box(
                        modifier = Modifier.padding(
                            start = 16.dp,
                            end = 16.dp,
                            top = 10.dp,
                            bottom = 10.dp,
                        ),
                    ) {
                        EditorActionButtons(
                            isEditing = alarm != null,
                            isSaving = isSaving,
                            onSave = ::saveEditor,
                        )
                    }
                }
            }
        }

        when (settingsDetailPanel) {
            "snooze" -> SnoozeSettingsPane(
                snoozeEnabled = editor.snoozeEnabled,
                snoozeMinutes = editor.snoozeMinutes,
                snoozeRepeatLimit = editor.snoozeRepeatLimit,
                onDismiss = { settingsDetailPanel = null },
                onSnoozeEnabledChange = { editor.snoozeEnabled = it },
                onSnoozeMinutesChange = { editor.snoozeMinutes = it },
                onSnoozeRepeatLimitChange = { editor.snoozeRepeatLimit = it },
            )

            "vibration" -> VibrationSettingsPane(
                vibrationPattern = editor.vibrationPattern,
                onDismiss = { settingsDetailPanel = null },
                onVibrationEnabledChange = {
                    editor.vibrationPattern = if (it) VibrationPatterns.DEFAULT else VibrationPatterns.NONE
                },
                onVibrationSelect = { editor.vibrationPattern = it },
            )

            "sound" -> AlarmSoundSettingsPane(
                alarmVolumePercent = editor.alarmVolumePercent,
                alarmSoundLabel = editor.alarmSoundLabel,
                onDismiss = { settingsDetailPanel = null },
                onAlarmVolumeChange = { editor.alarmVolumePercent = it },
                onPickAlarmSound = {
                    ringtonePickerLauncher.launch(
                        Intent(RingtoneManager.ACTION_RINGTONE_PICKER).apply {
                            putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_ALARM)
                            putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
                            putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, true)
                            putExtra(RingtoneManager.EXTRA_RINGTONE_TITLE, "알람음 선택")
                            val current = editor.alarmSoundUri?.let(Uri::parse)
                                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                            putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, current)
                        },
                    )
                },
            )

            "random_prompt" -> RandomPromptSettingsPane(
                voiceCategory = editor.voiceCategory,
                voiceLanguage = editor.voiceLanguage,
                onDismiss = { settingsDetailPanel = null },
                onCategoryChange = {
                    editor.voiceCategory = it
                    editor.voiceText = ""
                    editor.clearTtsMeta()
                },
                onLanguageChange = {
                    editor.voiceLanguage = it
                    editor.voiceText = ""
                    editor.clearTtsMeta()
                },
            )

            "voice_translation" -> VoiceTranslationSettingsPane(
                voiceLanguage = editor.voiceLanguage,
                onDismiss = { settingsDetailPanel = null },
                onLanguageChange = {
                    editor.voiceLanguage = it
                    editor.clearTtsMeta()
                },
            )
        }
    }

    if (voicePlanGateOpen) {
        PlanGateDialog(
            message = "유료 요금제를 사용해야 목소리 알람을 만들 수 있어요.",
            onConfirm = {
                voicePlanGateOpen = false
                onOpenBilling()
            },
            onDismiss = { voicePlanGateOpen = false },
        )
    }
}


@Composable
private fun AlarmEditorTopBar(
    isEditing: Boolean,
    familyAlarmMode: Boolean,
    onCancel: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 8.dp, top = 4.dp, end = 20.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onCancel) {
            Icon(
                imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                contentDescription = "닫기",
            )
        }
        Spacer(Modifier.width(8.dp))
        Text(
            text = when {
                familyAlarmMode -> "함께 울릴 알람"
                isEditing -> "알람 수정"
                else -> "새 알람"
            },
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
        )
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
    hour: Int,
    minute: Int,
    repeatDaysMask: Int,
    holidayOff: Boolean,
    onSelectRecipient: (String) -> Unit,
) {
    var recipientDialogOpen by remember { mutableStateOf(false) }
    val selectedRecipient = recipients.firstOrNull { it.userId == selectedRecipientId }
        ?: recipients.firstOrNull()
    val leadTooSoon = isFamilyAlarmLeadTooSoon(hour, minute, repeatDaysMask, holidayOff)
    val quietUnavailable = selectedRecipient?.let {
        isFamilyAlarmTimeUnavailable(it, hour, minute, repeatDaysMask)
    } ?: false

    if (recipientDialogOpen) {
        AlertDialog(
            onDismissRequest = { recipientDialogOpen = false },
            title = { Text("받는 사람 선택") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    recipients.forEach { recipient ->
                        RecipientPickerRow(
                            recipient = recipient,
                            selected = recipient.userId == selectedRecipient?.userId,
                            onClick = {
                                onSelectRecipient(recipient.userId)
                                recipientDialogOpen = false
                            },
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { recipientDialogOpen = false }) {
                    Text("닫기")
                }
            },
        )
    }

    Card(
        shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("받는 사람", fontWeight = FontWeight.SemiBold)
                if (recipients.size > 1) {
                    TextButton(onClick = { recipientDialogOpen = true }) {
                        Text("변경")
                    }
                }
            }
            if (recipients.isEmpty()) {
                MutedText("상대가 알람 설정을 허용하면 여기에 표시돼요.")
            } else {
                RecipientSummaryRow(
                    recipient = requireNotNull(selectedRecipient),
                    clickable = recipients.size > 1,
                    onClick = { recipientDialogOpen = true },
                )

                FamilyAlarmTargetStatus(
                    leadTooSoon = leadTooSoon,
                    quietUnavailable = quietUnavailable,
                    quietLabel = familyAlarmQuietScheduleLabel(selectedRecipient),
                )

                if (recipients.size == 1) {
                    MutedText("수신자는 한 명이고 바로 그 사람에게 설정돼요.")
                }
            }
        }
    }
}

@Composable
private fun RecipientSummaryRow(
    recipient: FamilyGroupMember,
    clickable: Boolean,
    onClick: () -> Unit,
) {
    val content: @Composable () -> Unit = {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(
                    text = familyMemberLabel(recipient),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                recipient.email?.takeIf { it.isNotBlank() }?.let { email ->
                    MutedText(email)
                }
            }
            if (clickable) {
                Spacer(Modifier.width(12.dp))
                Text(
                    text = ">",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }

    if (clickable) {
        Surface(
            onClick = onClick,
            modifier = Modifier.fillMaxWidth(),
            shape = androidx.compose.foundation.shape.RoundedCornerShape(14.dp),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.52f),
        ) {
            content()
        }
    } else {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = androidx.compose.foundation.shape.RoundedCornerShape(14.dp),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.52f),
        ) {
            content()
        }
    }
}

@Composable
private fun RecipientPickerRow(
    recipient: FamilyGroupMember,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
        color = if (selected) {
            MaterialTheme.colorScheme.secondaryContainer
        } else {
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)
        },
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(familyMemberLabel(recipient), fontWeight = FontWeight.SemiBold)
                MutedText("설정 불가: ${familyAlarmQuietScheduleLabel(recipient)}")
            }
            if (selected) {
                Text(
                    text = "선택됨",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

@Composable
private fun FamilyAlarmTargetStatus(
    leadTooSoon: Boolean,
    quietUnavailable: Boolean,
    quietLabel: String,
) {
    val blocked = leadTooSoon || quietUnavailable
    val statusText = when {
        leadTooSoon -> "30분 뒤부터 설정할 수 있어요."
        quietUnavailable -> "이 시간은 상대가 받을 수 없는 시간이에요."
        else -> "설정 가능"
    }
    Surface(
        shape = androidx.compose.foundation.shape.RoundedCornerShape(999.dp),
        color = if (blocked) {
            MaterialTheme.colorScheme.errorContainer
        } else {
            MaterialTheme.colorScheme.primaryContainer
        },
        contentColor = if (blocked) {
            MaterialTheme.colorScheme.onErrorContainer
        } else {
            MaterialTheme.colorScheme.onPrimaryContainer
        },
    ) {
        Text(
            text = statusText,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
        )
    }
    MutedText("설정 불가: $quietLabel")
}

private const val FAMILY_ALARM_MIN_LEAD_MILLIS = 30 * 60 * 1_000L

private fun ringtoneTitle(context: Context, uri: Uri): String =
    runCatching {
        RingtoneManager.getRingtone(context, uri)?.getTitle(context)
    }.getOrNull()?.takeIf { it.isNotBlank() } ?: "선택한 알람"

private fun isDefaultAlarmSoundUri(uri: Uri): Boolean {
    val uriText = uri.toString()
    return listOf(
        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
        Settings.System.DEFAULT_ALARM_ALERT_URI,
    ).any { defaultUri -> defaultUri != null && uriText == defaultUri.toString() }
}

internal fun familyMemberLabel(member: FamilyGroupMember): String =
    member.name?.takeIf { it.isNotBlank() }
        ?: member.email?.takeIf { it.isNotBlank() }
        ?: "멤버"

internal fun familyAlarmQuietScheduleLabel(member: FamilyGroupMember): String {
    val windows = familyAlarmQuietWindows(member)
    return windows.joinToString(" · ") { window ->
        "${quietDaysLabelForFamily(window.days)} ${window.start}-${window.end}"
    }
}

internal fun isFamilyAlarmLeadTooSoon(
    hour: Int,
    minute: Int,
    repeatDaysMask: Int,
    holidayOff: Boolean,
    nowMillis: Long = System.currentTimeMillis(),
): Boolean {
    val fireAtMillis = AlarmTimeCalculator.nextFireAtMillis(
        hour = hour,
        minute = minute,
        repeatDaysMask = repeatDaysMask,
        holidayOff = holidayOff,
        nowMillis = nowMillis,
    )
    return fireAtMillis - nowMillis < FAMILY_ALARM_MIN_LEAD_MILLIS
}

internal fun isFamilyAlarmTimeUnavailable(
    member: FamilyGroupMember,
    hour: Int,
    minute: Int,
    repeatDaysMask: Int,
    nowMillis: Long = System.currentTimeMillis(),
): Boolean {
    val dayIndices = familyAlarmTargetDayIndices(hour, minute, repeatDaysMask, nowMillis)
    return familyAlarmQuietWindows(member).any { window ->
        dayIndices.any { dayIndex -> window.blocks(dayIndex, hour, minute) }
    }
}

private fun familyAlarmQuietWindows(member: FamilyGroupMember): List<FamilyAlarmQuietWindow> {
    val fallback = FamilyAlarmQuietWindow(
        days = safeQuietDays(runCatching { member.familyAlarmQuietDays }.getOrNull()),
        start = safeQuietTime(runCatching { member.familyAlarmQuietStart }.getOrNull(), "09:00"),
        end = safeQuietTime(runCatching { member.familyAlarmQuietEnd }.getOrNull(), "18:30"),
    )
    return runCatching { member.familyAlarmQuietWindows }.getOrNull()
        ?.mapNotNull { window ->
            val start = safeQuietTime(runCatching { window.start }.getOrNull(), "")
            val end = safeQuietTime(runCatching { window.end }.getOrNull(), "")
            if (start.isBlank() || end.isBlank()) {
                null
            } else {
                FamilyAlarmQuietWindow(
                    days = safeQuietDays(runCatching { window.days }.getOrNull()),
                    start = start,
                    end = end,
                )
            }
        }
        ?.takeIf { it.isNotEmpty() }
        ?: listOf(fallback)
}

private fun familyAlarmTargetDayIndices(
    hour: Int,
    minute: Int,
    repeatDaysMask: Int,
    nowMillis: Long,
): List<Int> {
    if (repeatDaysMask != 0) {
        return (0..6).filter { dayIndex -> repeatDaysMask and (1 shl dayIndex) != 0 }
    }
    val nextFireDate = Instant.ofEpochMilli(
        AlarmTimeCalculator.nextFireAtMillis(
            hour = hour,
            minute = minute,
            repeatDaysMask = 0,
            nowMillis = nowMillis,
        ),
    ).atZone(ZoneId.systemDefault()).toLocalDate()
    return listOf(nextFireDate.dayOfWeek.value % 7)
}

private fun FamilyAlarmQuietWindow.blocks(dayIndex: Int, hour: Int, minute: Int): Boolean {
    if (dayIndex !in safeQuietDays(days)) return false
    val startTime = parseQuietTime(start) ?: return false
    val endTime = parseQuietTime(end) ?: return false
    val target = LocalTime.of(hour, minute)
    return if (startTime <= endTime) {
        !target.isBefore(startTime) && target.isBefore(endTime)
    } else {
        !target.isBefore(startTime) || target.isBefore(endTime)
    }
}

private fun parseQuietTime(value: String): LocalTime? =
    runCatching { LocalTime.parse(value) }.getOrNull()

private fun safeQuietDays(days: List<Int>?): List<Int> =
    days
        ?.filter { it in 0..6 }
        ?.distinct()
        ?.sorted()
        ?.takeIf { it.isNotEmpty() }
        ?: listOf(1, 2, 3, 4, 5)

private fun safeQuietTime(value: String?, fallback: String): String =
    value?.takeIf { it.isNotBlank() } ?: fallback

private fun quietDaysLabelForFamily(days: List<Int>): String {
    val sorted = days.distinct().sorted()
    return when (sorted) {
        emptyList<Int>() -> "없음"
        listOf(1, 2, 3, 4, 5) -> "평일"
        listOf(0, 6) -> "주말"
        listOf(0, 1, 2, 3, 4, 5, 6) -> "매일"
        else -> sorted.joinToString(",") { listOf("일", "월", "화", "수", "목", "금", "토")[it] }
    }
}
