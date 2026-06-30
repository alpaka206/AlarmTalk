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
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmAudioLimits
import com.alarmtalk.app.data.AlarmAudioStore
import com.alarmtalk.app.data.AlarmDraft
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmPlayModes
import com.alarmtalk.app.data.AlarmTimeCalculator
import com.alarmtalk.app.data.AlarmVoiceRecorder
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.AlarmAppContainer
import com.alarmtalk.app.data.DynamicPromptPreferenceStore
import com.alarmtalk.app.data.DynamicPromptPreferences
import com.alarmtalk.app.data.HolidayCountryPreferenceStore
import com.alarmtalk.app.data.HolidayDate
import com.alarmtalk.app.data.isSystemVoiceId
import com.alarmtalk.app.data.toDynamicPromptSettings
import com.alarmtalk.app.data.VibrationPatterns
import com.alarmtalk.app.data.VoiceSources
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.DynamicPromptSettings
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyGroupMember
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.StockClip
import com.alarmtalk.app.network.TtsGenerateRequest
import com.alarmtalk.app.network.TtsGenerateResponse
import com.alarmtalk.app.network.TtsMessageAudioResponse
import com.alarmtalk.app.network.VoiceProfile
import com.alarmtalk.app.network.trimmedOrNull
import com.alarmtalk.app.ui.guide.CoachMarkOverlay
import com.alarmtalk.app.ui.guide.CoachMarkRegistry
import com.alarmtalk.app.ui.guide.CoachMarkStep
import com.alarmtalk.app.ui.guide.UsageGuideStore
import com.alarmtalk.app.ui.guide.coachMarkTarget
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private enum class AudioPreviewTarget {
    SelectedCrop,
    CachedAudio,
    SharedVoiceInfo,
    StockClip,
}

// 처음 알람을 만드는 사용자를 위한 위치 앵커형 코치마크 가이드.
// 각 단계가 실제 컨트롤에 스포트라이트를 비추므로 "어디서 하는지"가 함께 전달된다.
private const val GUIDE_TARGET_SCHEDULE = "alarm_editor_schedule"
private const val GUIDE_TARGET_PLAY_MODE = "alarm_editor_play_mode"
private const val GUIDE_TARGET_SAVE = "alarm_editor_save"

@Composable
private fun alarmEditorCoachSteps(playModeItemIndex: Int) = listOf(
    CoachMarkStep(
        targetKey = GUIDE_TARGET_SCHEDULE,
        title = stringResource(R.string.editor2_coach_schedule_title),
        body = stringResource(R.string.editor2_coach_schedule_body),
        lazyItemIndex = 1,
    ),
    CoachMarkStep(
        targetKey = GUIDE_TARGET_PLAY_MODE,
        title = stringResource(R.string.editor2_coach_play_mode_title),
        body = stringResource(R.string.editor2_coach_play_mode_body),
        lazyItemIndex = playModeItemIndex,
    ),
    CoachMarkStep(
        targetKey = GUIDE_TARGET_SAVE,
        title = stringResource(R.string.editor2_coach_save_title),
        body = stringResource(R.string.editor2_coach_save_body),
    ),
)

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
    stockClips: List<StockClip>,
    defaultVoiceId: String? = null,
    defaultListenerTitle: String? = null,
    onCancel: () -> Unit,
    onOpenBilling: () -> Unit,
    onCreateVoiceProfile: () -> Unit,
    onGenerateTts: suspend (TtsGenerateRequest) -> TtsGenerateResponse,
    onDownloadStockAudio: suspend (String) -> TtsMessageAudioResponse,
    onUpdateDynamicPromptSettings: (DynamicPromptSettings) -> Unit,
    onUpdateSharedVoiceInfo: (String, String, String, () -> Unit) -> Unit,
    onSave: (AlarmDraft) -> Unit,
) {
    // 시스템 스톡 보이스 도입으로 무료 플랜도 음성 모드를 쓸 수 있다 (스톡 보이스 + 프리셋 문구).
    // 로그인하지 않은 경우만 음성 모드를 잠근다.
    val voicePlanLocked = authSession == null
    // 무료 플랜 제한 모드: 녹음/파일·직접 입력·동적(날씨/운세) 문구·번역은 유료 게이트.
    val freeVoiceTier = authSession != null && !hasPaidVoiceAccess(subscriptionResponse)
    val defaultPlayMode = if (voicePlanLocked) AlarmPlayModes.ALARM_ONLY else AlarmPlayModes.ALARM_VOICE
    val editor = remember(alarm?.id) { AlarmEditorState.from(alarm, defaultPlayMode = defaultPlayMode) }
    val context = LocalContext.current
    // 무료 버킷 회전은 앱 로케일(ko/en/ja, 그 외 ko 폴백) 언어의 클립만 재생한다.
    val appBucketLanguage = remember(context) {
        val lang = context.resources.configuration.locales.get(0)?.language
            ?: java.util.Locale.getDefault().language
        when (lang) {
            "en" -> "en"
            "ja" -> "ja"
            else -> "ko"
        }
    }
    val appContext = context.applicationContext
    val audioStore = remember(appContext) { AlarmAudioStore(appContext) }
    val dynamicPromptPreferenceStore = remember(appContext) { DynamicPromptPreferenceStore(appContext) }
    var dynamicPromptPreferences by remember(appContext) {
        mutableStateOf(dynamicPromptPreferenceStore.read())
    }
    // 앱 전역 공휴일 달력 국가 + 그 국가의 다가오는 공휴일 목록(토글 아래 표시용).
    val holidayCountryStore = remember(appContext) { HolidayCountryPreferenceStore(appContext) }
    val alarmRepository = remember(appContext) { AlarmAppContainer.repository(appContext) }
    val initialHolidayCountry = remember(appContext) { holidayCountryStore.read() }
    val holidayCountryCode by holidayCountryStore.countryCode.collectAsState(initial = initialHolidayCountry)
    var upcomingHolidays by remember { mutableStateOf<List<HolidayDate>>(emptyList()) }
    LaunchedEffect(holidayCountryCode) {
        upcomingHolidays = runCatching {
            alarmRepository.upcomingHolidays(countryCode = holidayCountryCode)
        }.getOrDefault(emptyList())
    }
    val usageGuideStore = remember(appContext) { UsageGuideStore(appContext) }
    // 처음 새 알람을 만들 때 한 번만 자동 노출. 상단 도움말 버튼으로 다시 볼 수 있다.
    var usageGuideVisible by remember {
        mutableStateOf(
            alarm == null && !familyAlarmMode &&
                !usageGuideStore.hasSeen(UsageGuideStore.GUIDE_ALARM_EDITOR),
        )
    }
    val coachMarkRegistry = remember { CoachMarkRegistry() }
    val editorListState = rememberLazyListState()
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
                    ?: throw IllegalArgumentException(context.getString(R.string.editor_error_audio_duration_unreadable))
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
                    audioMessage = userFacingError(error, context.getString(R.string.editor_error_selected_audio_unusable))
                }
        }
    }

    suspend fun cacheSelectedCrop(): CachedAlarmAudio {
        val uri = selectedFileUri ?: throw IllegalStateException(context.getString(R.string.editor_error_select_file))
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
                        text = context.getString(R.string.editor_shared_voice_preview_prompt),
                        category = "custom",
                        language = "ko",
                        random = false,
                    ),
                )
                withContext(Dispatchers.IO) {
                    // base64 디코딩도 메인 스레드가 아닌 IO 디스패처에서 수행한다.
                    val audioBytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
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
                audioMessage = userFacingError(error, context.getString(R.string.editor_error_preview_failed))
            }
        }
    }

    // 무료 버킷 선택: 해당 (보이스·버킷·앱 언어)의 N개 클립을 모두 로컬 캐시한 뒤(이미 있으면 재사용),
    // 대표(변형0) 클립을 단일 재생 폴백으로 박고 회전용 cacheKey 목록을 상태에 저장한다.
    fun selectBucket(bucket: String) {
        if (isSaving || previewPreparing) return
        val profileId = editor.voiceProfileId ?: return
        val clips = stockClips
            .filter { it.voiceProfileId == profileId && it.category == bucket && (it.language ?: "ko") == appBucketLanguage }
            .sortedBy { it.variant }
        if (clips.isEmpty()) return
        scope.launch {
            runCatching {
                val keys = mutableListOf<String>()
                val cachedClips = ArrayList<CachedAlarmAudio>(clips.size)
                clips.forEach { clip ->
                    val cacheKey = "stock_${clip.messageId}"
                    val cached = audioStore.getCachedAudio(cacheKey) ?: run {
                        val response = onDownloadStockAudio(clip.messageId)
                        withContext(Dispatchers.IO) {
                            audioStore.cacheGeneratedAudio(
                                bytes = Base64.decode(response.audioBase64, Base64.DEFAULT),
                                format = response.audioFormat,
                                rawAudioUri = response.audioUrl,
                                displayName = cacheKey,
                                cacheKey = cacheKey,
                                messageId = clip.messageId,
                            )
                        }
                    }
                    keys.add(cached.cacheKey ?: cacheKey)
                    cachedClips.add(cached)
                }
                keys to cachedClips
            }.onSuccess { (keys, cachedClips) ->
                val representative = cachedClips.firstOrNull() ?: return@onSuccess
                val first = clips.first()
                editor.setBucketAudio(
                    audio = representative,
                    profileId = profileId,
                    messageId = first.messageId,
                    text = first.text,
                    language = appBucketLanguage,
                    bucket = bucket,
                    clipKeys = keys,
                )
            }.onFailure { error ->
                Log.e(TAG, "Failed to select free bucket in alarm editor bucket=$bucket", error)
                audioMessage = userFacingError(error, context.getString(R.string.editor_error_stock_clip_select_failed))
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
            audioMessage = context.getString(R.string.editor_error_select_recipient)
            return
        }
        showFamilyAlarmToast(context.getString(R.string.editor_family_alarm_set))
        onSave(
            draft.copy(
                targetUserId = recipient.userId,
                targetUserName = familyMemberLabel(context, recipient),
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
                audioMessage = userFacingError(error, context.getString(R.string.editor_error_recording_failed))
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
            audioMessage = context.getString(R.string.editor_recording_in_progress)
        }.onFailure { error ->
            Log.e(TAG, "Failed to start recording", error)
            audioMessage = userFacingError(error, context.getString(R.string.editor_error_recording_start_failed))
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
                audioMessage = context.getString(R.string.editor_error_select_recipient)
                return
            }
            val fireAtMillis = AlarmTimeCalculator.nextFireAtMillis(
                hour = editor.hour,
                minute = editor.minute,
                repeatDaysMask = editor.repeatDaysMask,
                holidayOff = editor.holidayOff,
            )
            if (fireAtMillis - System.currentTimeMillis() < FAMILY_ALARM_MIN_LEAD_MILLIS) {
                val message = context.getString(R.string.editor_error_family_alarm_lead_too_soon)
                audioMessage = message
                showFamilyAlarmToast(message)
                return
            }
            if (isFamilyAlarmTimeUnavailable(recipient, editor.hour, editor.minute, editor.repeatDaysMask)) {
                val message = context.getString(R.string.editor_error_family_alarm_time_unavailable)
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
                        audioMessage = userFacingError(error, context.getString(R.string.editor_error_crop_save_failed))
                    }
                    isSaving = false
                }
                return
            }
            if (editor.localAudioUri.isNullOrBlank()) {
                audioMessage = context.getString(R.string.editor_error_record_or_select_file)
                return
            }
            submitDraft(editor.toDraft())
            return
        }
        if (authSession == null) {
            audioMessage = context.getString(R.string.editor_error_voice_message_login_required)
            return
        }
        val profileId = editor.voiceProfileId
            ?: voiceProfiles.firstOrNull { it.status == null || it.status == "ready" }?.id
        if (profileId.isNullOrBlank()) {
            audioMessage = context.getString(R.string.editor_error_select_voice)
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
            audioMessage = context.getString(R.string.editor_error_enter_message_or_random)
            return
        }
        if (
            editor.voiceRandomPrompt &&
            randomContextUsesWeather(editor.voiceRandomContext) &&
            (editor.voiceWeatherCountry.isBlank() || editor.voiceWeatherCity.isBlank())
        ) {
            audioMessage = context.getString(R.string.editor_error_weather_location_required)
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
            audioMessage = context.getString(R.string.editor_error_fortune_info_required)
            return
        }
        fun resolvedVoiceListenerTitle(): String? {
            val isSelectedSystemVoice = isSystemVoiceId(profileId) ||
                voiceProfiles.any { it.id == profileId && it.isSystem == true }
            if (editor.hasSelectedStockClipAudio(profileId, text)) return null
            return editor.voiceListenerTitleOverride.trimmedOrNull()
                ?: resolveListenerTitle(
                    profileId = profileId,
                    voiceProfiles = voiceProfiles,
                    familyVoices = familyVoices,
                ).trimmedOrNull()
                ?: defaultListenerTitle?.takeIf { isSelectedSystemVoice }?.trimmedOrNull()
        }
        val listenerTitleForSave = resolvedVoiceListenerTitle()
        val usableProfileIds = (
            voiceProfiles.filter { it.status == null || it.status == "ready" }.map { it.id } +
                familyVoices.filter { (it.status == null || it.status == "ready") && it.isShared != false }.map { it.id }
            ).toSet()
        if (profileId !in usableProfileIds && !editor.hasFreshTtsAudio(profileId, text, listenerTitleForSave)) {
            audioMessage = context.getString(R.string.editor_error_deleted_voice_cannot_edit)
            return
        }
        if (editor.hasFreshTtsAudio(profileId, text, listenerTitleForSave)) {
            editor.voiceListenerTitleOverride = listenerTitleForSave.orEmpty()
            submitDraft(editor.toDraft())
            return
        }
        val localTtsCacheKey = AlarmAudioStore.ttsCacheKey(
            profileId = profileId,
            text = text,
            category = editor.activeVoiceCategory(),
            language = editor.activeVoiceLanguage(),
        )
        if (!editor.voiceRandomPrompt && listenerTitleForSave.isNullOrBlank()) {
            audioStore.getCachedAudio(localTtsCacheKey, rawAudioUri = editor.rawAudioUri)?.let { cached ->
                editor.setGeneratedTtsAudio(
                    audio = cached,
                    profileId = profileId,
                    text = text,
                    messageId = cached.messageId ?: editor.ttsMessageId ?: "",
                    rawAudioUri = cached.rawAudioUri,
                )
                audioMessage = context.getString(R.string.editor_existing_voice_cache_used)
                editor.voiceListenerTitleOverride = listenerTitleForSave.orEmpty()
                submitDraft(editor.toDraft())
                return
            }
        }

        // 이전에 진행 중이던 generation 이 남아 있다면 취소.
        generationJob?.cancel()
        generationJob = scope.launch {
            isSaving = true
            audioMessage = context.getString(R.string.editor_preparing_voice_alarm)
            showFamilyAlarmToast(context.getString(R.string.editor_preparing_voice_alarm))
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
                        listenerTitle = listenerTitleForSave,
                    ),
                )
                val rawAudioUri = response.audioUrl ?: response.audioObjectKey?.let { "r2://$it" }
                val cacheKey = AlarmAudioStore.ttsCacheKey(
                    profileId = profileId,
                    text = response.text,
                    category = editor.activeVoiceCategory(),
                    language = editor.activeVoiceLanguage(),
                    serverCacheKey = response.cacheKey,
                )
                val cachedAudio = withContext(Dispatchers.IO) {
                    // base64 디코딩도 메인 스레드가 아닌 IO 디스패처에서 수행한다.
                    val audioBytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
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
                    listenerTitle = listenerTitleForSave,
                )
                editor.voiceListenerTitleOverride = listenerTitleForSave.orEmpty()
                audioMessage = context.getString(R.string.editor_generated_voice_saved_local)
                submitDraft(editor.toDraft())
            }.onFailure { error ->
                Log.e(TAG, "Failed to generate TTS alarm audio", error)
                audioMessage = userFacingError(error, context.getString(R.string.editor_error_voice_generation_failed))
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
            audioMessage = context.getString(R.string.editor_error_mic_permission_required)
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
            audioMessage = context.getString(R.string.editor_error_voice_alarm_login_required)
        }
    }

    // 무료 플랜: 음성 모드는 시스템 스톡 보이스 + 버킷(기상/약) 회전으로 고정.
    // 개별 문구 선택·직접 입력·동적(날씨/운세) 문구·번역·랜덤 생성은 모두 유료 게이트.
    // 버킷 회전은 랜덤 생성과 무관하므로 voiceRandomPrompt=false 로 두고, 앱 로케일 언어를 쓴다.
    LaunchedEffect(freeVoiceTier, editor.playMode, editor.voiceProfileId, stockClips, appBucketLanguage) {
        if (freeVoiceTier && editor.playMode != AlarmPlayModes.ALARM_ONLY) {
            if (editor.voiceSource != VoiceSources.TTS_PROFILE) {
                editor.voiceSource = VoiceSources.TTS_PROFILE
                editor.clearAudio()
                editor.clearTtsMeta()
                editor.selectedBucket = null
            }
            if (editor.voiceRandomPrompt) editor.voiceRandomPrompt = false
            if (editor.voiceTranslationEnabled) editor.voiceTranslationEnabled = false
            if (editor.voiceLanguage != appBucketLanguage) editor.voiceLanguage = appBucketLanguage
            // 버킷 미선택(신규) 또는 보이스 변경 시, 사용 가능한 버킷 중 현재 선택(없으면 첫째)을 해석한다.
            val profileId = editor.voiceProfileId
            if (!profileId.isNullOrBlank()) {
                val buckets = freeBucketsFor(stockClips, profileId, appBucketLanguage)
                val target = editor.selectedBucket?.takeIf { it in buckets } ?: buckets.firstOrNull()
                if (target != null &&
                    (editor.selectedBucket != target || editor.bucketResolvedForProfileId != profileId)
                ) {
                    selectBucket(target)
                }
            }
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

    // 저장이 막힌 이유 — 비활성 버튼만으로는 무엇이 빠졌는지 알 수 없어
    // 저장 버튼 위에 사유를 함께 보여준다. null 이면 저장 가능.
    val editorSaveBlockedReason: String? = when {
        editor.playMode == AlarmPlayModes.ALARM_ONLY -> null
        editor.voiceSource == VoiceSources.LOCAL_AUDIO ->
            if (selectedFileUri != null || !editor.localAudioUri.isNullOrBlank()) {
                null
            } else {
                stringResource(R.string.editor_save_blocked_record_or_select_file)
            }
        else -> {
            val profileId = editor.voiceProfileId?.takeIf { it.isNotBlank() }
            val text = editor.ttsTextForSave()
            when {
                profileId == null -> stringResource(R.string.editor_save_blocked_select_voice)
                profileId !in usableTtsProfileIds && !editor.hasFreshTtsAudio(profileId, text) ->
                    stringResource(R.string.editor_save_blocked_voice_unusable)
                editor.voiceRandomPrompt && !randomPromptSettingsComplete() ->
                    stringResource(R.string.editor_save_blocked_random_prompt_incomplete)
                !editor.voiceRandomPrompt && editor.voiceText.trim().isBlank() ->
                    stringResource(R.string.editor_save_blocked_enter_message_or_random)
                else -> null
            }
        }
    }
    val editorCanSave = editorSaveBlockedReason == null

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
                audioMessage = context.getString(R.string.editor_voice_generation_canceled_time_changed)
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
                onShowGuide = { usageGuideVisible = true },
            )
            LazyColumn(
                state = editorListState,
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
                    Box(
                        modifier = Modifier
                            .padding(horizontal = editorHorizontalPadding)
                            .coachMarkTarget(coachMarkRegistry, GUIDE_TARGET_SCHEDULE),
                    ) {
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
                            holidayCountryCode = holidayCountryCode,
                            upcomingHolidays = upcomingHolidays,
                            onHolidayColdCache = {
                                // 비-KR 캐시가 비었을 때 한 번 서버 동기화 후 목록을 다시 읽는다.
                                scope.launch {
                                    alarmRepository.ensureHolidaysSynced(holidayCountryCode)
                                    upcomingHolidays = runCatching {
                                        alarmRepository.upcomingHolidays(countryCode = holidayCountryCode)
                                    }.getOrDefault(emptyList())
                                }
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
                    Box(
                        modifier = Modifier
                            .padding(horizontal = editorHorizontalPadding)
                            .coachMarkTarget(coachMarkRegistry, GUIDE_TARGET_PLAY_MODE),
                    ) {
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
                                stockClips = stockClips,
                                defaultVoiceId = defaultVoiceId,
                                onSelectBucket = { bucket -> selectBucket(bucket) },
                                freeVoiceTier = freeVoiceTier,
                                onLockedFeature = ::showVoicePlanGate,
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
                                    audioMessage = context.getString(R.string.editor_voice_audio_cleared)
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
                            showVoiceOutput = editor.playMode != AlarmPlayModes.ALARM_ONLY,
                            voiceVolumePercent = editor.voiceVolumePercent,
                            voiceRepeat = editor.voiceRepeat,
                            voiceRepeatActive = editor.playMode == AlarmPlayModes.VOICE_ONLY,
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
                            onOpenVoiceOutputSettings = { settingsDetailPanel = "voice_output" },
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
                    if (editorSaveBlockedReason != null) {
                        Text(
                            text = editorSaveBlockedReason,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(start = 16.dp, end = 16.dp, top = 8.dp),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Box(
                        modifier = Modifier
                            .padding(
                                start = 16.dp,
                                end = 16.dp,
                                top = 10.dp,
                                bottom = 10.dp,
                            )
                            .coachMarkTarget(coachMarkRegistry, GUIDE_TARGET_SAVE),
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
                            putExtra(RingtoneManager.EXTRA_RINGTONE_TITLE, context.getString(R.string.editor_ringtone_picker_title))
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

            "voice_output" -> VoiceOutputSettingsPane(
                volumePercent = editor.voiceVolumePercent,
                onVolumeChange = { editor.voiceVolumePercent = it },
                showRepeat = editor.playMode == AlarmPlayModes.VOICE_ONLY,
                repeat = editor.voiceRepeat,
                onRepeatChange = { editor.voiceRepeat = it },
                onDismiss = { settingsDetailPanel = null },
            )
        }

        if (usageGuideVisible) {
            CoachMarkOverlay(
                steps = alarmEditorCoachSteps(
                    playModeItemIndex = if (familyAlarmMode) 3 else 2,
                ),
                registry = coachMarkRegistry,
                listState = editorListState,
                onFinish = {
                    usageGuideStore.markSeen(UsageGuideStore.GUIDE_ALARM_EDITOR)
                    usageGuideVisible = false
                },
            )
        }
    }

    sharedVoiceInfoTarget?.let { profile ->
        SharedVoiceInfoRequiredDialog(
            profileName = profile.name,
            sharedFromLabel = profile.ownerName?.takeIf { it.isNotBlank() }
                ?.let { stringResource(R.string.editor_shared_voice_from_owner, it) }
                ?: stringResource(R.string.editor_shared_voice_from_default),
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
                    editor.selectVoiceProfile(profile.id)
                    stopPreview()
                    sharedVoiceInfoTarget = null
                }
            },
        )
    }

    if (voicePlanGateOpen) {
        PlanGateDialog(
            message = if (freeVoiceTier) {
                stringResource(R.string.editor_plan_gate_paid_features)
            } else {
                stringResource(R.string.editor_plan_gate_login_required)
            },
            onConfirm = {
                voicePlanGateOpen = false
                onOpenBilling()
            },
            onDismiss = { voicePlanGateOpen = false },
        )
    }
}


