package com.alarmtalk.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.core.VoiceAlarmLog.TAG
import com.alarmtalk.app.data.AlarmAudioLimits
import com.alarmtalk.app.data.AlarmAudioStore
import com.alarmtalk.app.data.AlarmDraft
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.AlarmTimeCalculator
import com.alarmtalk.app.data.AlarmVoiceRecorder
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.DynamicPromptPreferenceStore
import com.alarmtalk.app.data.DynamicPromptPreferences
import com.alarmtalk.app.data.toDynamicPromptSettings
import com.alarmtalk.app.data.VibrationPatterns
import com.alarmtalk.app.data.VoiceSources
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.DynamicPromptSettings
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyGroupMember
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.TtsGenerateRequest
import com.alarmtalk.app.network.TtsGenerateResponse
import com.alarmtalk.app.network.VoiceProfile
import com.alarmtalk.app.network.trimmedOrNull
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private enum class AudioPreviewTarget {
    SelectedCrop,
    CachedAudio,
    SharedVoiceInfo,
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
    onCreateVoiceProfile: () -> Unit,
    onGenerateTts: suspend (TtsGenerateRequest) -> TtsGenerateResponse,
    onUpdateDynamicPromptSettings: (DynamicPromptSettings) -> Unit,
    onUpdateSharedVoiceInfo: (String, String, String, () -> Unit) -> Unit,
    onSave: (AlarmDraft) -> Unit,
) {
    val voicePlanLocked = !hasPaidVoiceAccess(subscriptionResponse)
    val defaultPlayMode = if (voicePlanLocked) AlarmPlayModes.ALARM_ONLY else AlarmPlayModes.ALARM_VOICE
    val editor = remember(alarm?.id) { AlarmEditorState.from(alarm, defaultPlayMode = defaultPlayMode) }
    val context = LocalContext.current
    val appContext = context.applicationContext
    val audioStore = remember(appContext) { AlarmAudioStore(appContext) }
    val dynamicPromptPreferenceStore = remember(appContext) { DynamicPromptPreferenceStore(appContext) }
    var dynamicPromptPreferences by remember(appContext) {
        mutableStateOf(dynamicPromptPreferenceStore.read())
    }
    val recorder = remember(appContext) { AlarmVoiceRecorder(appContext, audioStore) }
    val scope = rememberCoroutineScope()
    var audioMessage by remember { mutableStateOf<String?>(null) }
    var isRecording by remember { mutableStateOf(false) }
    var isSaving by remember { mutableStateOf(false) }
    // 진행 중인 TTS 생성 Job 을 추적해, 사용자가 도중에 시각을 변경하면 취소한다.
    var generationJob by remember { mutableStateOf<Job?>(null) }
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
    var sharedVoiceInfoTarget by remember { mutableStateOf<FamilyVoiceProfile?>(null) }
    val familyRecipients = remember(familyGroup, authSession?.user?.id, authSession?.user?.email) {
        familyAlarmRecipients(familyGroup, authSession)
    }
    var selectedFamilyRecipientId by remember(familyAlarmMode, familyRecipients) {
        mutableStateOf(if (familyAlarmMode) familyRecipients.firstOrNull()?.userId else null)
    }
    val selectedFamilyRecipientValue = familyRecipients.firstOrNull { it.userId == selectedFamilyRecipientId }
    val activeDynamicPromptPreferences = if (familyAlarmMode) {
        selectedFamilyRecipientValue?.dynamicPromptSettings?.toPromptPreferences() ?: DynamicPromptPreferences()
    } else {
        dynamicPromptPreferences
    }
    val savedWeatherConfigured = if (familyAlarmMode) {
        selectedFamilyRecipientValue?.dynamicPromptSettingsState?.weatherReady == true
    } else {
        activeDynamicPromptPreferences.weatherCountry.isNotBlank() &&
            activeDynamicPromptPreferences.weatherCity.isNotBlank()
    }
    val savedFortuneConfigured = if (familyAlarmMode) {
        selectedFamilyRecipientValue?.dynamicPromptSettingsState?.fortuneReady == true
    } else {
        activeDynamicPromptPreferences.fortuneGender.isNotBlank() &&
            activeDynamicPromptPreferences.fortuneBirthDate.isNotBlank() &&
            activeDynamicPromptPreferences.fortuneBirthTime.isNotBlank()
    }
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

    LaunchedEffect(
        familyAlarmMode,
        selectedFamilyRecipientValue?.userId,
        activeDynamicPromptPreferences,
    ) {
        if (familyAlarmMode) {
            editor.voiceWeatherCountry = activeDynamicPromptPreferences.weatherCountry
            editor.voiceWeatherCity = activeDynamicPromptPreferences.weatherCity
            editor.voiceFortuneGender = activeDynamicPromptPreferences.fortuneGender
            editor.voiceFortuneBirthDate = activeDynamicPromptPreferences.fortuneBirthDate
            editor.voiceFortuneBirthTime = activeDynamicPromptPreferences.fortuneBirthTime
            editor.clearTtsMeta()
            editor.clearAudio()
            return@LaunchedEffect
        }
        if (editor.voiceWeatherCountry.isBlank()) {
            editor.voiceWeatherCountry = activeDynamicPromptPreferences.weatherCountry
        }
        if (editor.voiceWeatherCity.isBlank()) {
            editor.voiceWeatherCity = activeDynamicPromptPreferences.weatherCity
        }
        if (editor.voiceFortuneGender.isBlank()) {
            editor.voiceFortuneGender = activeDynamicPromptPreferences.fortuneGender
        }
        if (editor.voiceFortuneBirthDate.isBlank()) {
            editor.voiceFortuneBirthDate = activeDynamicPromptPreferences.fortuneBirthDate
        }
        if (editor.voiceFortuneBirthTime.isBlank()) {
            editor.voiceFortuneBirthTime = activeDynamicPromptPreferences.fortuneBirthTime
        }
    }

    fun selectedFamilyRecipient(): FamilyGroupMember? =
        selectedFamilyRecipientValue

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
                        val previewVolume = editor.voiceVolumePercent.coerceIn(0, 100) / 100f
                        preparedPlayer.setVolume(previewVolume, previewVolume)
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

    fun playSharedVoiceInfoPreview(profileId: String) {
        if (previewPreparing) return
        scope.launch {
            stopPreview()
            previewTarget = AudioPreviewTarget.SharedVoiceInfo
            previewPreparing = true
            runCatching {
                val response = onGenerateTts(
                    TtsGenerateRequest(
                        voiceProfileId = profileId,
                        text = "이 목소리로 깨워드릴까요?",
                        category = "custom",
                        language = "ko",
                        random = false,
                    ),
                )
                val audioBytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
                withContext(Dispatchers.IO) {
                    audioStore.cacheGeneratedAudio(
                        bytes = audioBytes,
                        format = response.audioFormat,
                        rawAudioUri = response.audioUrl,
                        displayName = "shared_voice_preview_$profileId",
                        cacheKey = "shared_voice_preview_$profileId",
                        messageId = response.messageId,
                    )
                }
            }.onSuccess { cached ->
                startPreparedPreview(
                    uri = Uri.parse(cached.localAudioUri),
                    target = AudioPreviewTarget.SharedVoiceInfo,
                )
            }.onFailure { error ->
                Log.e(TAG, "Failed to preview shared voice in alarm editor", error)
                stopPreview()
                audioMessage = userFacingError(error, "미리듣기를 재생하지 못했어요.")
            }
        }
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
        showFamilyAlarmToast("상대 알람을 설정했어요.")
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
                val message = "상대 알람은 지금부터 30분 뒤부터 설정할 수 있어요."
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
            audioMessage = "사용할 목소리를 선택해 주세요."
            return
        }
        val selectedSharedProfile = familyVoices.firstOrNull {
            it.id == profileId && it.requiresViewerInfo()
        }
        if (selectedSharedProfile != null) {
            stopPreview()
            audioMessage = null
            sharedVoiceInfoTarget = selectedSharedProfile
            return
        }
        val text = editor.ttsTextForSave()
        if (text.isBlank() && !editor.voiceRandomPrompt) {
            audioMessage = "음성 메시지를 입력하거나 랜덤 문구를 사용해 주세요."
            return
        }
        if (
            editor.voiceRandomPrompt &&
            randomContextUsesWeather(editor.voiceRandomContext) &&
            (editor.voiceWeatherCountry.isBlank() || editor.voiceWeatherCity.isBlank())
        ) {
            audioMessage = "날씨가 들어간 문구는 나라와 도시를 입력해 주세요."
            return
        }
        if (
            editor.voiceRandomPrompt &&
            normalizedRandomPromptContext(editor.voiceRandomContext) == "wake_fortune" &&
            (
                editor.voiceFortuneGender.isBlank() ||
                    editor.voiceFortuneBirthDate.isBlank() ||
                    editor.voiceFortuneBirthTime.isBlank()
                )
        ) {
            audioMessage = "운세가 들어간 문구는 성별, 생년월일, 태어난 시간을 입력해 주세요."
            return
        }
        val usableProfileIds = (
            voiceProfiles.filter { it.status == null || it.status == "ready" }.map { it.id } +
                familyVoices.filter { (it.status == null || it.status == "ready") && it.isShared != false }.map { it.id }
            ).toSet()
        if (profileId !in usableProfileIds && !editor.hasFreshTtsAudio(profileId, text)) {
            audioMessage = "삭제된 목소리라 문구를 수정할 수 없어요. 다른 목소리를 선택해 주세요."
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
        if (!editor.voiceRandomPrompt) {
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
        }

        // 이전에 진행 중이던 generation 이 남아 있다면 취소.
        generationJob?.cancel()
        generationJob = scope.launch {
            isSaving = true
            audioMessage = "목소리 알람을 준비하는 중이에요."
            showFamilyAlarmToast("목소리 알람을 준비하는 중이에요.")
            runCatching {
                val response = onGenerateTts(
                    TtsGenerateRequest(
                        voiceProfileId = profileId,
                        text = text,
                        category = editor.activeVoiceCategory(),
                        language = editor.activeVoiceLanguage(),
                        translate = editor.shouldTranslateVoiceText(),
                        random = editor.voiceRandomPrompt,
                        randomContext = if (editor.voiceRandomPrompt) {
                            normalizedRandomPromptContext(editor.voiceRandomContext)
                        } else {
                            null
                        },
                        alarmHour = editor.hour,
                        alarmMinute = editor.minute,
                        weatherCountry = editor.voiceWeatherCountry.takeIf {
                            editor.voiceRandomPrompt &&
                                randomContextUsesWeather(editor.voiceRandomContext) &&
                                editor.voiceWeatherCountry.isNotBlank()
                        }?.trimmedOrNull(),
                        weatherCity = editor.voiceWeatherCity.takeIf {
                            editor.voiceRandomPrompt &&
                                randomContextUsesWeather(editor.voiceRandomContext) &&
                                editor.voiceWeatherCity.isNotBlank()
                        }?.trimmedOrNull(),
                        fortuneGender = editor.voiceFortuneGender.takeIf {
                            editor.voiceRandomPrompt &&
                                normalizedRandomPromptContext(editor.voiceRandomContext) == "wake_fortune" &&
                                editor.voiceFortuneGender.isNotBlank()
                        }?.trimmedOrNull(),
                        fortuneBirthDate = editor.voiceFortuneBirthDate.takeIf {
                            editor.voiceRandomPrompt &&
                                normalizedRandomPromptContext(editor.voiceRandomContext) == "wake_fortune" &&
                                editor.voiceFortuneBirthDate.isNotBlank()
                        }?.trimmedOrNull(),
                        fortuneBirthTime = editor.voiceFortuneBirthTime.takeIf {
                            editor.voiceRandomPrompt &&
                                normalizedRandomPromptContext(editor.voiceRandomContext) == "wake_fortune" &&
                                editor.voiceFortuneBirthTime.isNotBlank()
                        }?.trimmedOrNull(),
                        targetUserId = selectedFamilyRecipientId.takeIf { familyAlarmMode }?.trimmedOrNull(),
                        listenerTitle = resolveListenerTitle(
                            profileId = profileId,
                            voiceProfiles = voiceProfiles,
                            familyVoices = familyVoices,
                        ).trimmedOrNull(),
                    ),
                )
                val audioBytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
                val rawAudioUri = response.audioUrl ?: response.audioObjectKey?.let { "r2://$it" }
                val cacheKey = AlarmAudioStore.ttsCacheKey(
                    profileId = profileId,
                    text = response.text,
                    category = editor.activeVoiceCategory(),
                    language = editor.activeVoiceLanguage(),
                    serverCacheKey = response.cacheKey,
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
            generationJob = null
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
            audioMessage = "무료 이용권에서는 일반 알람만 만들 수 있어요."
        }
    }

    val editorHorizontalPadding = 24.dp
    val editorBottomPadding = 12.dp
    var settingsDetailPanel by remember { mutableStateOf<String?>(null) }
    var randomPromptWasEnabledWhenOpened by remember { mutableStateOf(false) }

    val usableTtsProfileIds = (
        voiceProfiles.filter { it.status == null || it.status == "ready" }.map { it.id } +
            familyVoices.filter { (it.status == null || it.status == "ready") && it.isShared != false }.map { it.id }
        ).toSet()

    fun randomPromptSettingsComplete(): Boolean {
        if (!editor.voiceRandomPrompt) return false
        val context = normalizedRandomPromptContext(editor.voiceRandomContext)
        if (
            randomContextUsesWeather(context) &&
            (editor.voiceWeatherCountry.isBlank() || editor.voiceWeatherCity.isBlank())
        ) {
            return false
        }
        if (
            context == "wake_fortune" &&
            (
                editor.voiceFortuneGender.isBlank() ||
                    editor.voiceFortuneBirthDate.isBlank() ||
                    editor.voiceFortuneBirthTime.isBlank()
                )
        ) {
            return false
        }
        return true
    }

    fun canSaveTtsAlarm(): Boolean {
        val profileId = editor.voiceProfileId?.takeIf { it.isNotBlank() } ?: return false
        val text = editor.ttsTextForSave()
        val profileAvailable = profileId in usableTtsProfileIds || editor.hasFreshTtsAudio(profileId, text)
        if (!profileAvailable) return false
        return if (editor.voiceRandomPrompt) {
            randomPromptSettingsComplete()
        } else {
            editor.voiceText.trim().isNotBlank()
        }
    }

    val editorCanSave = when {
        editor.playMode == AlarmPlayModes.ALARM_ONLY -> true
        editor.voiceSource == VoiceSources.LOCAL_AUDIO -> selectedFileUri != null || !editor.localAudioUri.isNullOrBlank()
        else -> canSaveTtsAlarm()
    }

    fun openRandomPromptSettings() {
        randomPromptWasEnabledWhenOpened = editor.voiceRandomPrompt
        settingsDetailPanel = "random_prompt"
    }

    fun dismissRandomPromptSettingsWithoutSave() {
        if (!randomPromptWasEnabledWhenOpened) {
            editor.voiceRandomPrompt = false
        }
        settingsDetailPanel = null
    }

    fun applyRandomPromptSettings(result: RandomPromptSettingsResult) {
        editor.voiceRandomPrompt = true
        editor.voiceRandomContext = normalizedRandomPromptContext(result.randomContext)
        editor.voiceLanguage = result.voiceLanguage
        editor.voiceText = ""
        editor.voiceWeatherCountry = result.weatherCountry
        editor.voiceWeatherCity = result.weatherCity
        editor.voiceFortuneGender = result.fortuneGender
        editor.voiceFortuneBirthDate = result.fortuneBirthDate
        editor.voiceFortuneBirthTime = result.fortuneBirthTime
        editor.clearAudio()
        editor.clearTtsMeta()
        var shouldSyncOwnDynamicPromptSettings = false
        if (
            !familyAlarmMode &&
            randomContextUsesWeather(result.randomContext) &&
            result.weatherCountry.isNotBlank() &&
            result.weatherCity.isNotBlank()
        ) {
            dynamicPromptPreferenceStore.saveWeatherLocation(result.weatherCountry, result.weatherCity)
            dynamicPromptPreferences = dynamicPromptPreferenceStore.read()
            shouldSyncOwnDynamicPromptSettings = true
        }
        if (
            !familyAlarmMode &&
            normalizedRandomPromptContext(result.randomContext) == "wake_fortune" &&
            result.fortuneGender.isNotBlank() &&
            result.fortuneBirthDate.isNotBlank() &&
            result.fortuneBirthTime.isNotBlank()
        ) {
            dynamicPromptPreferenceStore.saveFortuneInfo(
                gender = result.fortuneGender,
                birthDate = result.fortuneBirthDate,
                birthTime = result.fortuneBirthTime,
            )
            dynamicPromptPreferences = dynamicPromptPreferenceStore.read()
            shouldSyncOwnDynamicPromptSettings = true
        }
        if (shouldSyncOwnDynamicPromptSettings) {
            onUpdateDynamicPromptSettings(dynamicPromptPreferences.toDynamicPromptSettings())
        }
        settingsDetailPanel = null
    }

    BackHandler(enabled = settingsDetailPanel != null) {
        if (settingsDetailPanel == "random_prompt") {
            dismissRandomPromptSettingsWithoutSave()
            return@BackHandler
        }
        settingsDetailPanel = null
    }

    LaunchedEffect(editor.playMode, editor.voiceRandomPrompt) {
        if (editor.playMode == AlarmPlayModes.VOICE_ONLY && settingsDetailPanel == "sound") {
            settingsDetailPanel = null
        }
        if (
            (editor.voiceRandomPrompt || !editor.voiceTranslationEnabled) &&
            settingsDetailPanel == "voice_translation"
        ) {
            settingsDetailPanel = null
        }
    }

    // 랜덤 문구는 알람 시각이 프롬프트 컨텍스트로 들어가므로,
    // 시각이 바뀌면 기존 캐시 TTS 를 무효화해 저장 시 재생성하게 한다.
    // 또한 진행 중인 generation 코루틴이 있으면 결과가 stale 한 시각으로 저장되지 않도록 취소한다.
    var observedInitialTime by remember { mutableStateOf(false) }
    LaunchedEffect(editor.hour, editor.minute) {
        if (!observedInitialTime) {
            observedInitialTime = true
            return@LaunchedEffect
        }
        if (editor.voiceRandomPrompt && !editor.ttsMessageId.isNullOrBlank()) {
            editor.clearTtsMeta()
            editor.clearAudio()
        }
        generationJob?.let { current ->
            if (current.isActive) {
                current.cancel()
                isSaving = false
                audioMessage = "알람 시각이 바뀌어 음성 생성을 중단했어요."
            }
            generationJob = null
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
                                onCreateVoiceProfileClick = onCreateVoiceProfile,
                                onSharedVoiceInfoRequired = { profile ->
                                    stopPreview()
                                    sharedVoiceInfoTarget = profile
                                },
                                onOpenRandomPromptSettings = ::openRandomPromptSettings,
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
                            canSave = editorCanSave,
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
                voiceLanguage = editor.voiceLanguage,
                randomContext = editor.voiceRandomContext,
                weatherCountry = editor.voiceWeatherCountry,
                weatherCity = editor.voiceWeatherCity,
                savedWeatherCountry = activeDynamicPromptPreferences.weatherCountry,
                savedWeatherCity = activeDynamicPromptPreferences.weatherCity,
                savedWeatherConfigured = savedWeatherConfigured,
                savedFortuneGender = activeDynamicPromptPreferences.fortuneGender,
                savedFortuneBirthDate = activeDynamicPromptPreferences.fortuneBirthDate,
                savedFortuneBirthTime = activeDynamicPromptPreferences.fortuneBirthTime,
                savedFortuneConfigured = savedFortuneConfigured,
                usingTargetDynamicPromptSettings = familyAlarmMode,
                fortuneGender = editor.voiceFortuneGender,
                fortuneBirthDate = editor.voiceFortuneBirthDate,
                fortuneBirthTime = editor.voiceFortuneBirthTime,
                onDismissWithoutSave = ::dismissRandomPromptSettingsWithoutSave,
                onSaveSettings = ::applyRandomPromptSettings,
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

    sharedVoiceInfoTarget?.let { profile ->
        SharedVoiceInfoRequiredDialog(
            profileName = profile.name,
            sharedFromLabel = profile.ownerName?.takeIf { it.isNotBlank() }
                ?.let { "${it}님에게 공유받은 목소리" } ?: "공유받은 목소리",
            initialRelationship = profile.relationshipLabel.orEmpty(),
            initialListenerTitle = profile.listenerTitle.orEmpty(),
            saving = voiceProfileBusy,
            previewing = previewTarget == AudioPreviewTarget.SharedVoiceInfo &&
                (previewPreparing || mediaPlayer != null),
            onDismiss = {
                if (!voiceProfileBusy) {
                    stopPreview()
                    sharedVoiceInfoTarget = null
                }
            },
            onPreview = { playSharedVoiceInfoPreview(profile.id) },
            onConfirm = { relationship, listener ->
                onUpdateSharedVoiceInfo(profile.id, relationship, listener) {
                    editor.voiceProfileId = profile.id
                    editor.clearTtsMeta()
                    stopPreview()
                    sharedVoiceInfoTarget = null
                }
            },
        )
    }

    if (voicePlanGateOpen) {
        PlanGateDialog(
            message = "유료 이용권에서 사용할 수 있어요.",
            onConfirm = {
                voicePlanGateOpen = false
                onOpenBilling()
            },
            onDismiss = { voicePlanGateOpen = false },
        )
    }
}


