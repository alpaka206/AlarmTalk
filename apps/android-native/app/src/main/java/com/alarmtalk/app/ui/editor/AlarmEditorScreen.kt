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
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
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
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmAudioLimits
import com.alarmtalk.app.data.AlarmAudioStore
import com.alarmtalk.app.data.AlarmDraft
import com.alarmtalk.app.data.AlarmEntity
import com.alarmtalk.app.data.AlarmPlayModes
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
import com.alarmtalk.app.network.apiErrorCode
import com.alarmtalk.app.network.ManualQuotaResponse
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal fun expectedCloneBucketVariantCount(category: String): Int? =
    when (category) {
        // 날씨 = 조건 8 + '인터넷 안 돼서 못 알아봤어요' 미해결 안내 1(마지막 클립이 안내). data 계층
        // 상수를 참조해 발사 폴백(bucketVariantIndex)과 단일 출처로 유지.
        "weather" -> com.alarmtalk.app.data.WEATHER_CLONE_CLIP_COUNT
        "fortune" -> 5
        "love" -> 3
        "medication" -> 3
        "greeting" -> 1
        else -> null
    }

private enum class AudioPreviewTarget {
    CachedAudio,
    StockClip,
}

// 세부 설정 pane 슬라이드용 emphasized 이징(타임휠 세틀과 같은 계열의 감속 곡선).
private val EditorPaneEasing = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)

@Composable
internal fun AlarmEditorScreen(
    contentPadding: PaddingValues,
    alarm: AlarmEntity?,
    authSession: AuthSession?,
    subscriptionResponse: BillingSubscriptionResponse?,
    familyGroup: FamilyGroupCurrentResponse?,
    familyAlarmMode: Boolean,
    initialFamilyRecipientId: String? = null,
    voiceProfiles: List<VoiceProfile>,
    familyVoices: List<FamilyVoiceProfile>,
    voiceProfileBusy: Boolean,
    stockClips: List<StockClip>,
    // 새 알람이 이어받을 '직전 선택' 세 축. 셋 다 계정별로 저장되고, 저장에 성공한 알람에서만
    // 기록된다(MainViewModel.rememberVoiceUsed / rememberMessageChoiceUsed).
    // 기존 알람을 열 때는 어느 것도 쓰지 않는다 — 열기만 해도 설정이 바뀌면 안 된다.
    lastUsedVoiceId: String? = null,
    lastMessageContext: String? = null,
    lastFreeBucket: String? = null,
    // 유료 안내 모달에서 바로 프로모션/선물 코드를 넣을 수 있게 한다.
    onRegisterCode: (String) -> Unit = {},
    redeemBusy: Boolean = false,
    onCancel: () -> Unit,
    onOpenBilling: () -> Unit,
    onCreateVoiceProfile: () -> Unit,
    onGenerateTts: suspend (TtsGenerateRequest) -> TtsGenerateResponse,
    onLoadManualQuota: (suspend () -> ManualQuotaResponse?)? = null,
    onDownloadStockAudio: suspend (String) -> TtsMessageAudioResponse,
    // 제한(날씨+약) 보이스를 편집기에서 고른 순간 그 보이스의 버킷 클립 전체를 백그라운드
    // 프리페치한다 — 기본 목소리 변경 시 프리페치(setDefaultVoice)와 같은 경로. 이미 캐시된
    // 클립은 건너뛰므로 반복 호출해도 재다운로드는 없다.
    onPrefetchRestrictedVoiceClips: (String) -> Unit = {},
    onUpdateDynamicPromptSettings: (DynamicPromptSettings) -> Unit,
    onSave: (AlarmDraft) -> Unit,
) {
    // 시스템 스톡 보이스 도입으로 무료 플랜도 음성 모드를 쓸 수 있다 (스톡 보이스 + 프리셋 문구).
    // 로그인하지 않은 경우만 음성 모드를 잠근다.
    val voicePlanLocked = authSession == null
    // 무료 플랜 제한 모드: 녹음/파일·직접 입력·동적(날씨/운세) 문구·번역은 유료 게이트.
    val freeVoiceTier = authSession != null && !hasPaidVoiceAccess(subscriptionResponse)
    // 무료 강등 시 본인 클론은 서버에 보존되지만 사용 불가 — 편집기에는 시스템 목소리만
    // 노출/선택 가능하게 목록을 걸러 쓴다(재유료 시 그대로 복귀). 보이스 선택지·저장 가능
    // 목록이 모두 이 걸러진 목록을 참조한다.
    val visibleVoiceProfiles = if (freeVoiceTier) {
        voiceProfiles.filter { it.isSystem == true }
    } else {
        voiceProfiles
    }
    val defaultPlayMode = if (voicePlanLocked) AlarmPlayModes.ALARM_ONLY else AlarmPlayModes.ALARM_VOICE
    // 새 알람은 마지막에 고른 문구 종류를 기본값으로 이어받는다(한 번도 고른 적 없으면 목록에
    // 노출하지 않는 '기본 인사말'=preset 으로 시작). '직접 입력'은 기억하지 않아 빈 직접입력으로
    // 시작하지 않는다.
    val defaultRandomContext = lastMessageContext ?: DefaultRandomPromptContext
    val editor = remember(alarm?.id) {
        AlarmEditorState.from(
            alarm,
            defaultPlayMode = defaultPlayMode,
            defaultRandomContext = defaultRandomContext,
        )
    }
    // 시스템(기본) 보이스가 선택되면 유료여도 문구를 무료 버킷과 동일하게 '날씨+약'으로 제한한다
    // (운세·사랑·직접 입력 숨김). 무료 tier 와 하나의 게이트로 묶어 렌더·상태강제·저장검증에 동일 주입.
    val isSystemVoiceSelected = isSystemVoiceId(editor.voiceProfileId) ||
        voiceProfiles.any { it.id == editor.voiceProfileId && it.isSystem == true }
    val restrictToWeatherMedication = freeVoiceTier || isSystemVoiceSelected
    val context = LocalContext.current
    val configuration = LocalConfiguration.current
    val appVoiceLanguage = remember(configuration) {
        val lang = configuration.locales.get(0)?.language
            ?: java.util.Locale.getDefault().language
        supportedAppVoiceLanguage(lang)
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
    val editorListState = rememberLazyListState()
    val recorder = remember(appContext) { AlarmVoiceRecorder(appContext, audioStore) }
    val scope = rememberCoroutineScope()
    var audioMessage by remember { mutableStateOf<String?>(null) }
    var isRecording by remember { mutableStateOf(false) }
    var isSaving by remember { mutableStateOf(false) }
    // 직접 입력 문구 선택기에 '(남은/총)' 을 보여주기 위한 이번 달 사용 현황(유료만 조회).
    var manualQuota by remember { mutableStateOf<ManualQuotaResponse?>(null) }
    LaunchedEffect(freeVoiceTier, onLoadManualQuota) {
        manualQuota = if (!freeVoiceTier && onLoadManualQuota != null) onLoadManualQuota() else null
    }
    // 진행 중인 TTS 생성 Job 을 추적해, 사용자가 도중에 시각을 변경하면 취소한다.
    var generationJob by remember { mutableStateOf<Job?>(null) }
    var recordingElapsedMillis by remember { mutableStateOf(0L) }
    // 실제 마이크 입력 진폭(0~1) — 녹음 카드의 미니 레벨 바가 소비한다.
    var recordingLevel by remember { mutableStateOf(0f) }
    var mediaPlayer by remember { mutableStateOf<MediaPlayer?>(null) }
    var previewTarget by remember { mutableStateOf<AudioPreviewTarget?>(null) }
    var previewPreparing by remember { mutableStateOf(false) }
    var previewStopJob by remember { mutableStateOf<Job?>(null) }
    var voicePlanGateOpen by remember { mutableStateOf(false) }
    // 목소리 선택 시트의 '들어보기' — 온보딩/목소리 탭과 같은 재생기를 그대로 쓴다
    // (기본 목소리는 내장 인사말이라 네트워크 없이도 즉시 난다).
    val voicePreview = rememberVoiceOnboardingPreviewController(
        onDownloadStockAudio = onDownloadStockAudio,
    )
    val familyRecipients = remember(familyGroup, authSession?.user?.id, authSession?.user?.email) {
        familyAlarmRecipients(familyGroup, authSession)
    }
    var selectedFamilyRecipientId by remember(familyAlarmMode, familyRecipients, initialFamilyRecipientId) {
        mutableStateOf(
            if (familyAlarmMode) {
                // 시트에서 사람을 미리 골라 들어온 경우 그 사람으로 연다. 유효하지 않으면 첫 멤버로 폴백.
                initialFamilyRecipientId?.takeIf { id -> familyRecipients.any { it.userId == id } }
                    ?: familyRecipients.firstOrNull()?.userId
            } else {
                null
            },
        )
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
                    AlarmTalkLog.reportError("Failed to start alarm audio preview", error)
                    stopPreview()
                }
            }
            player.setOnCompletionListener { completedPlayer ->
                if (mediaPlayer === completedPlayer) stopPreview() else completedPlayer.release()
            }
            player.setOnErrorListener { errorPlayer, what, extra ->
                AlarmTalkLog.reportError("Alarm audio preview error what=$what extra=$extra")
                if (mediaPlayer === errorPlayer) stopPreview() else errorPlayer.release()
                true
            }
            player.prepareAsync()
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to prepare alarm audio preview", error)
            stopPreview()
        }
    }

    fun playCachedAudio() {
        val audioUri = editor.localAudioUri ?: return
        startPreparedPreview(
            uri = Uri.parse(audioUri),
            target = AudioPreviewTarget.CachedAudio,
        )
    }

    // (보이스·버킷)의 클립 언어 선택: 앱 언어 클립이 있으면 앱 언어(시스템 스톡 3개국),
    // 없으면 그 보이스가 가진 유일한 언어 = 클론을 만들 때 고른 언어를 그대로 쓴다.
    // 일본어로 만든 클론은 한국어 기기(공유받은 쪽 포함)에서도 일본어 클립을 소비한다.
    fun bucketClipLanguageFor(category: String, profileId: String): String {
        val langs = stockClips.asSequence()
            .filter { it.voiceProfileId == profileId && it.category == category }
            .map { it.language ?: "ko" }
            .toSet()
        return if (appVoiceLanguage in langs) appVoiceLanguage else langs.firstOrNull() ?: appVoiceLanguage
    }

    // 오프라인 클론 버킷이 '완전한지' 판정. 날씨/운세는 서버가 조건/테마 '절대 인덱스'로 클립을 고르므로
    // variant 0..N-1 이 전부 캐시돼 있어야 인덱스가 안 엉킨다(부분 세트면 엉뚱한 조건 재생 → 라이브 유지).
    fun hasCompleteCloneBucket(category: String, profileId: String): Boolean {
        val clipLanguage = bucketClipLanguageFor(category, profileId)
        val variants = stockClips
            .filter {
                it.voiceProfileId == profileId &&
                    it.category == category &&
                    (it.language ?: "ko") == clipLanguage
            }
            .map { it.variant }
            .toSet()
        if (variants.isEmpty()) return false
        val fullCount = expectedCloneBucketVariantCount(category) ?: return false
        return variants == (0 until fullCount).toSet()
    }

    // 버킷 선택 코어: 해당 (보이스·버킷·앱 언어)의 N개 클립을 모두 로컬 캐시한 뒤(이미 있으면 재사용),
    // 대표(변형0) 클립을 단일 재생 폴백으로 박고 회전용 cacheKey 목록을 상태에 저장한다. 무료 시스템
    // 버킷과 유료 클론 버킷(사랑/약 등)이 저장/재생 계약이 동일하므로 이 코어를 공유한다.
    // 반환 true=바인딩 성공. 클립이 없거나 캐시 실패면 false(호출자가 라이브 폴백/에러 처리).
    suspend fun bindStockBucketClips(
        bucket: String,
        profileId: String,
        contextVariantIndex: Int? = null,
    ): Boolean {
        val clipLanguage = bucketClipLanguageFor(bucket, profileId)
        val clips = stockClips
            .filter { it.voiceProfileId == profileId && it.category == bucket && (it.language ?: "ko") == clipLanguage }
            .sortedBy { it.variant }
            // variant 중복 제거: 매칭 버킷은 절대 인덱스로 keys[i] 를 고르므로, 중복 variant 가 있으면
            // 뒤 인덱스가 밀려 엉뚱한 조건 클립이 재생된다(같은 variant 는 첫 행만).
            .distinctBy { it.variant }
        if (clips.isEmpty()) return false
        val keys = mutableListOf<String>()
        val texts = mutableListOf<String>()
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
            // 잠금화면이 발사 variant 의 문구를 보여줄 수 있도록 keys 와 같은 순서로 텍스트도 저장.
            texts.add(clip.text)
            cachedClips.add(cached)
        }
        val representative = cachedClips.firstOrNull() ?: return false
        val first = clips.first()
        editor.setBucketAudio(
            audio = representative,
            profileId = profileId,
            messageId = first.messageId,
            text = first.text,
            language = clipLanguage,
            bucket = bucket,
            clipKeys = keys,
            clipTexts = texts,
            contextVariantIndex = contextVariantIndex,
        )
        return true
    }

    fun selectBucket(bucket: String) {
        if (isSaving || previewPreparing) return
        val profileId = editor.voiceProfileId ?: return
        scope.launch {
            runCatching { bindStockBucketClips(bucket, profileId) }
                .onFailure { error ->
                    AlarmTalkLog.reportError("Failed to select free bucket in alarm editor bucket=$bucket", error)
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
                applyCachedAudio(audio)
            }.onFailure { error ->
                isRecording = false
                recordingElapsedMillis = 0L
                AlarmTalkLog.reportError("Failed to stop recording", error)
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
            recordingLevel = 0f
            // '녹음 중...' 상태 문구는 두지 않는다(경과 시간이 오른쪽에 표시됨).
            audioMessage = null
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to start recording", error)
            audioMessage = userFacingError(error, context.getString(R.string.editor_error_recording_start_failed))
        }
    }

    fun showVoicePlanGate() {
        audioMessage = null
        voicePlanGateOpen = true
    }

    // 알람음/목소리 두 토글 → 내부 저장(playMode + alarmSoundEnabled) 매핑.
    //  둘 다 켬 = 알람+목소리 / 목소리만 = 목소리만 / 알람음만 = 알람만 / 둘 다 끔 = 알람만+무음(진동/화면만)
    // 목소리를 켤 때 voiceSource 를 초기화하던 기존 PlayModeCard onSelect 동작을 보존한다.
    fun applyAlarmOutput(voice: Boolean, sound: Boolean) {
        val wasAlarmOnly = editor.playMode == AlarmPlayModes.ALARM_ONLY
        editor.playMode = when {
            voice && sound -> AlarmPlayModes.ALARM_VOICE
            voice && !sound -> AlarmPlayModes.VOICE_ONLY
            else -> AlarmPlayModes.ALARM_ONLY
        }
        editor.alarmSoundEnabled = sound
        if (voice && authSession == null) {
            editor.voiceSource = VoiceSources.LOCAL_AUDIO
            editor.clearTtsMeta()
        } else if (voice && wasAlarmOnly) {
            editor.voiceSource = VoiceSources.TTS_PROFILE
            editor.clearTtsMeta()
        }
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
            if (isFamilyAlarmLeadTooSoon(editor.hour, editor.minute, editor.repeatDaysMask, editor.holidayOff)) {
                // 그냥 막지 말고 "언제부터 되는지"를 구체 시각으로 알려 바로 고치게 한다.
                val earliestMillis = System.currentTimeMillis() + FAMILY_ALARM_MIN_LEAD_MILLIS
                val earliestLabel = android.text.format.DateFormat.getTimeFormat(context)
                    .format(java.util.Date(earliestMillis))
                val message = context.getString(
                    R.string.editor_error_family_alarm_lead_too_soon,
                    earliestLabel,
                )
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
            ?: visibleVoiceProfiles.firstOrNull { it.status == null || it.status == "ready" }?.id
        if (profileId.isNullOrBlank()) {
            audioMessage = context.getString(R.string.editor_error_select_voice)
            return
        }
        // 랜덤 문구를 클론(내/공유)으로 저장할 땐 '등록 때 고른 언어'로 생성·캐시한다 — 뷰어 앱
        // 언어와 무관(일본어로 만든 목소리는 한국어 기기에서도 일본어). 그 언어는 사전렌더 클립
        // 언어와 같으므로 매니페스트에서 읽는다(클립이 아직 없으면 기존 언어 유지).
        if (
            editor.voiceRandomPrompt &&
            !isSystemVoiceId(profileId) &&
            voiceProfiles.none { it.id == profileId && it.isSystem == true }
        ) {
            stockClips.firstOrNull { it.voiceProfileId == profileId }?.let {
                editor.voiceLanguage = it.language ?: "ko"
            }
        }
        val text = editor.ttsTextForSave()
        if (text.isBlank() && !editor.voiceRandomPrompt) {
            audioMessage = context.getString(R.string.editor_error_enter_message_or_random)
            return
        }
        if (
            editor.voiceRandomPrompt &&
            randomContextUsesWeather(editor.voiceRandomContext) &&
            editor.voiceWeatherCity.isBlank()
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
                // 기본(시스템) 목소리는 별도 호칭 없이 계정 닉네임으로 부른다.
                ?: authSession?.user?.name?.takeIf { isSelectedSystemVoice }?.trimmedOrNull()
        }
        val listenerTitleForSave = resolvedVoiceListenerTitle()
        val usableProfileIds = (
            visibleVoiceProfiles.filter { it.status == null || it.status == "ready" }.map { it.id } +
                familyVoices.filter {
                    (it.status == null || it.status == "ready") && it.isShared != false
                }.map { it.id }
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
            // 1) 유료 클론 오프라인 버킷 시도: 사전렌더 대상 컨텍스트(사랑/약/운세/날씨)이고 그 목소리의
            //    '완전한' 클립 세트가 캐시돼 있으면 라이브 생성 대신 오프라인 버킷으로 바인딩한다.
            //    날씨/운세는 서버 조건/테마 '절대 인덱스'로 고르므로 부분 세트면 인덱스가 엉킨다 →
            //    hasCompleteCloneBucket 으로 풀셋일 때만 바인딩(부분/실패면 아래 라이브로 폴백).
            // 가족 알람은 서버가 수신자별로 목소리를 생성(onGenerateTts targetUserId)해야 하고, 내 로컬
            // 사전렌더 클립은 수신자가 소유·캐시하지 못하므로 오프라인 버킷을 쓰면 수신자에게 무음이 된다.
            // → 가족 모드에서는 사전렌더 버킷을 쓰지 않고 아래 라이브 생성 경로로 간다.
            val cloneBucketCategory = clonePrerenderBucketCategoryFor(editor.voiceRandomContext)
            val requiresCloneBucket = !familyAlarmMode && editor.voiceRandomPrompt && cloneBucketCategory != null &&
                !isSystemVoiceId(profileId)
            val tryCloneBucket = requiresCloneBucket && hasCompleteCloneBucket(cloneBucketCategory, profileId)
            if (
                tryCloneBucket &&
                // 이미 resolve 된 contextVariantIndex 를 넘겨 재저장 시 null 로 덮어써지지 않게 한다(넘기지
                // 않으면 setBucketAudio 가 null 로 리셋 → 준비창 재해결 전까지 날씨 0=맑음 오재생).
                runCatching {
                    bindStockBucketClips(cloneBucketCategory!!, profileId, editor.contextVariantIndex)
                }.getOrDefault(false)
            ) {
                isSaving = false
                submitDraft(editor.toDraft())
                return@launch
            }
            // 2) 버킷 미대상/캐시 실패(사전렌더 미완성·클립 다운로드 실패 포함) → 기존 라이브 생성으로 폴백.
            //    이미 등록된 클론 목소리라도 준비창 cron 이 풀셋을 만들기 전이면 '준비 중'에서 멈추지 말고
            //    여기서 라이브로 저장한다(알람이 여러 cron 틱 동안 아예 저장 안 되는 것 방지). 라이브 생성은
            //    random 경로라 월간 등록·원장·수동 quota 를 건드리지 않으므로 등록 전 목소리 이슈 없음.
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
                AlarmTalkLog.reportError("Failed to generate TTS alarm audio", error)
                audioMessage = when (apiErrorCode(error)) {
                    "MANUAL_TTS_QUOTA_EXCEEDED" ->
                        context.getString(R.string.editor_error_manual_tts_quota)
                    else ->
                        userFacingError(error, context.getString(R.string.editor_error_voice_generation_failed))
                }
            }
            isSaving = false
            generationJob = null
        }
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
                recordingLevel = (recorder.maxAmplitude().toFloat() / 32767f).coerceIn(0f, 1f)
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
            audioMessage = context.getString(R.string.editor_error_voice_alarm_login_required)
        }
    }

    LaunchedEffect(appVoiceLanguage, editor.playMode, editor.voiceSource, editor.voiceRandomPrompt) {
        if (editor.playMode != AlarmPlayModes.ALARM_ONLY && editor.voiceSource != VoiceSources.LOCAL_AUDIO) {
            if (editor.voiceLanguage != appVoiceLanguage) {
                editor.voiceLanguage = appVoiceLanguage
                editor.clearTtsMeta()
            }
            val automaticTranslation = !editor.voiceRandomPrompt && appVoiceLanguage != "ko"
            if (editor.voiceTranslationEnabled != automaticTranslation) {
                editor.voiceTranslationEnabled = automaticTranslation
                if (!editor.voiceRandomPrompt) editor.clearTtsMeta()
            }
        }
    }

    // 제한 보이스 선택 시 버킷 클립 프리페치 — 편집 중 문구를 고르거나 저장할 때 11개를
    // 그 자리에서 받는 대신, 보이스를 고른 순간부터 백그라운드로 받아 둔다(캐시분 스킵).
    // stockClips 를 키에 포함: 매니페스트가 아직 안 온 상태로 진입하면 프리페치가 빈손으로
    // 끝나므로, 매니페스트 도착 시 재시도한다(Codex #607).
    LaunchedEffect(editor.voiceProfileId, restrictToWeatherMedication, stockClips) {
        val profileId = editor.voiceProfileId
        if (restrictToWeatherMedication && !profileId.isNullOrBlank() && stockClips.isNotEmpty()) {
            onPrefetchRestrictedVoiceClips(profileId)
        }
    }

    // 연결 상태를 키에 포함해, 오프라인으로 버킷을 못 받았다가 연결이 복구되면 자동 재시도한다.
    val isOnline by rememberIsOnline()
    LaunchedEffect(restrictToWeatherMedication, editor.playMode, editor.voiceProfileId, editor.voiceSource, stockClips, appVoiceLanguage, isOnline) {
        if (restrictToWeatherMedication && editor.playMode != AlarmPlayModes.ALARM_ONLY) {
            // 직접 녹음은 플랜·목소리 종류와 무관하게 허용된다(녹음본 로컬 재생일 뿐).
            // 아래 TTS 쪽 제한(버킷/문구 강제)은 소스가 TTS 일 때만 적용한다 — 녹음 알람에는
            // 문구 개념이 없다.
            if (editor.voiceSource != VoiceSources.LOCAL_AUDIO) {
                if (editor.voiceRandomPrompt) editor.voiceRandomPrompt = false
                if (editor.voiceTranslationEnabled) editor.voiceTranslationEnabled = false
                if (editor.voiceLanguage != appVoiceLanguage) editor.voiceLanguage = appVoiceLanguage
                // 기존 알람은 selectVoiceProfile 이 안 불려 직접 입력 문구·신선한 TTS 오디오가 그대로
                // 남는다 — 클립을 아직 못 받았어도(오프라인 등) 그 오디오로 저장이 통과하는 우회를
                // 막기 위해, 허용 버킷으로 해석된 상태가 아니면 잔재를 먼저 비운다(Codex #599).
                if (editor.hasRestrictedVoiceRemnants(FreeBucketOrder)) {
                    editor.clearRestrictedVoiceRemnants()
                }
                // 버킷 미선택(신규) 또는 보이스 변경 시, 사용 가능한 버킷 중 현재 선택(없으면 첫째)을 해석한다.
                val profileId = editor.voiceProfileId
                if (!profileId.isNullOrBlank()) {
                    val buckets = freeBucketsFor(stockClips, profileId, appVoiceLanguage)
                    // 새 알람은 마지막에 고른 테마를 이어받는다 — 이게 없으면 매번 FreeBucketOrder
                    // 첫 값(약)으로 돌아가, 날씨로 바꿔 저장해도 다음 알람이 다시 약이 된다.
                    // 기존 알람은 자기 값만 쓴다(열기만 해도 문구가 바뀌면 안 된다). 날씨는 도시가
                    // 있어야 조건 매칭이 되고 없으면 저장이 막히므로, 저장된 도시가 없으면 안 잇는다.
                    val remembered = lastFreeBucket?.takeIf {
                        alarm == null && it in buckets &&
                            (it != "weather" || savedWeatherConfigured || editor.voiceWeatherCity.isNotBlank())
                    }
                    val target = editor.selectedBucket?.takeIf { it in buckets }
                        ?: remembered
                        ?: buckets.firstOrNull()
                    if (target != null &&
                        (editor.selectedBucket != target || editor.bucketResolvedForProfileId != profileId)
                    ) {
                        selectBucket(target)
                    }
                }
            }
        }
    }

    val editorHorizontalPadding = 16.dp
    // 마지막 카드가 하단 고정 CTA divider 에 붙지 않도록 여유를 준다(구 12dp → 24dp).
    val editorBottomPadding = 24.dp
    var settingsDetailPanel by remember { mutableStateOf<String?>(null) }
    var randomPromptWasEnabledWhenOpened by remember { mutableStateOf(false) }
    // 무료 날씨 버킷 선택 시 도시 입력/확인 다이얼로그.
    var freeWeatherDialogOpen by remember { mutableStateOf(false) }

    val usableTtsProfileIds = (
        visibleVoiceProfiles.filter { it.status == null || it.status == "ready" }.map { it.id } +
            familyVoices.filter {
                (it.status == null || it.status == "ready") && it.isShared != false
            }.map { it.id }
        ).toSet()

    fun randomPromptSettingsComplete(): Boolean {
        if (!editor.voiceRandomPrompt) return false
        val context = normalizedRandomPromptContext(editor.voiceRandomContext)
        if (
            randomContextUsesWeather(context) &&
            editor.voiceWeatherCity.isBlank()
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
        // 녹음 모드 안내 문구는 두지 않는다(녹음 버튼 자체가 CTA). 미녹음 시 저장은 아래 recordingReady 로 막는다.
        editor.voiceSource == VoiceSources.LOCAL_AUDIO -> null
        else -> {
            val profileId = editor.voiceProfileId?.takeIf { it.isNotBlank() }
            val text = editor.ttsTextForSave()
            when {
                profileId == null -> stringResource(R.string.editor_save_blocked_select_voice)
                profileId !in usableTtsProfileIds && !editor.hasFreshTtsAudio(profileId, text) ->
                    stringResource(R.string.editor_save_blocked_voice_unusable)
                editor.voiceRandomPrompt && !randomPromptSettingsComplete() ->
                    stringResource(R.string.editor_save_blocked_random_prompt_incomplete)
                // 무료 날씨 버킷은 도시가 있어야 조건 매칭이 된다 — 없으면 저장을 막고 안내.
                restrictToWeatherMedication && editor.selectedBucket == "weather" &&
                    editor.voiceWeatherCity.isBlank() ->
                    stringResource(R.string.editor_error_weather_location_required)
                // 무료는 문구를 직접 입력하지 않는다(테마 클립 자동 회전) — 빈 문구는
                // 클립이 아직 준비되지 않은 상태이므로 '입력하라'는 안내 대신 준비 중 안내.
                // 오프라인이면 기다려도 안 되므로 연결 안내로 정직하게 분기한다.
                !editor.voiceRandomPrompt && editor.voiceText.trim().isBlank() ->
                    when {
                        !restrictToWeatherMedication -> stringResource(R.string.editor_save_blocked_enter_message_or_random)
                        !isOnline -> stringResource(R.string.editor_save_blocked_free_clips_offline)
                        else -> stringResource(R.string.editor_save_blocked_free_clips_loading)
                    }
                else -> null
            }
        }
    }
    // 녹음 모드에서 아직 녹음 파일이 없으면 안내 문구 없이 저장만 비활성화한다.
    val recordingReady = editor.playMode == AlarmPlayModes.ALARM_ONLY ||
        editor.voiceSource != VoiceSources.LOCAL_AUDIO ||
        !editor.localAudioUri.isNullOrBlank()
    val editorCanSave = editorSaveBlockedReason == null && recordingReady

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
        if (result.randomContext == ManualMessageContext) {
            // '직접 입력' 선택 → 랜덤 끄고, 다이얼로그에서 받은 문구를 그대로 쓴다.
            val nextText = result.manualText.take(200)
            // 문구를 실제로 바꾸지 않았으면 기존 오디오를 버리지 않는다. 프리필이 생기면서
            // '들어갔다 확인만 누르는' 흐름이 흔해졌는데, 매번 재합성하면 직접 입력 월 한도
            // (manual-tts-quota)가 아무 변경 없이 깎인다.
            val unchanged = !editor.voiceRandomPrompt &&
                !editor.isActiveBucketAlarm() &&
                nextText.trim() == editor.voiceText.trim()
            editor.voiceRandomPrompt = false
            editor.voiceText = nextText
            editor.voiceLanguage = appVoiceLanguage
            if (!unchanged) {
                editor.clearAudio()
                editor.clearTtsMeta()
            }
            settingsDetailPanel = null
            return
        }
        editor.voiceRandomPrompt = true
        editor.voiceRandomContext = normalizedRandomPromptContext(result.randomContext)
        // 여기서는 기억하지 않는다 — 문구를 눌러만 보고 알람을 저장하지 않은 것까지 다음 알람의
        // 기본값이 되면 안 된다. 기록은 저장 성공 시(rememberMessageChoiceUsed) 한 곳에서만 한다.
        editor.voiceLanguage = appVoiceLanguage
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

    LaunchedEffect(editor.playMode, editor.alarmSoundEnabled) {
        // 알람음이 꺼지면(목소리만 이거나 알람음 토글 off) 알람음 상세(볼륨·벨소리) 패널을 닫는다.
        val alarmSoundOn = editor.playMode != AlarmPlayModes.VOICE_ONLY && editor.alarmSoundEnabled
        if (!alarmSoundOn && settingsDetailPanel == "sound") {
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
            // 상단바(제목·뒤로가기·가이드)는 제거하고, 취소·저장을 하단에 모았다.
            // 시간 휠이 화면 맨 위에 오도록 상단 여백만 살짝 준다(상태바 인셋은 contentPadding에 포함).
            LazyColumn(
                state = editorListState,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                contentPadding = PaddingValues(top = 20.dp, bottom = editorBottomPadding),
                // 섹션 사이(20)를 섹션 내부 헤더→콘텐츠(10~12)보다 확실히 크게 벌려 그룹핑을 살린다.
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                item {
                    // 타임휠 히어로도 나머지 카드와 같은 24dp 거터에 정렬한다(단일 출처
                    // editorHorizontalPadding). 예전엔 내부 Surface만 8dp 인셋이라 좌우로
                    // 16dp씩 삐져나와 '붕 뜬' 인상을 줬다.
                    Box(modifier = Modifier.padding(horizontal = editorHorizontalPadding)) {
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
                }

                item {
                    Box(
                        modifier = Modifier.padding(horizontal = editorHorizontalPadding),
                    ) {
                        ScheduleDetailsCard(
                            hour = editor.hour,
                            minute = editor.minute,
                            repeatDaysMask = editor.repeatDaysMask,
                            holidayOff = editor.holidayOff,
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

                // 받을 사람 카드는 본문에서 제거했다. 수신자는 진입 전 '누구를 깨울까요?' 시트에서
                // 이미 고르므로, 편집기에선 하단 저장 버튼 위에 '○○에게 설정돼요'로만 짧게 알린다.

                item {
                    Box(modifier = Modifier.padding(horizontal = editorHorizontalPadding)) {
                        // 목소리 on/off 토글은 목소리 카드 안에 있다(별도 '재생 방식' 카드 없음).
                        // 끄면 playMode=ALARM_ONLY(목소리 미재생), 켜면 알람음 상태에 따라 ALARM_VOICE/VOICE_ONLY.
                        val alarmSoundOn = editor.playMode != AlarmPlayModes.VOICE_ONLY && editor.alarmSoundEnabled
                        VoiceAudioCard(
                            voiceEnabled = editor.playMode != AlarmPlayModes.ALARM_ONLY,
                            onVoiceEnabledChange = { on ->
                                if (voicePlanLocked) showVoicePlanGate()
                                else applyAlarmOutput(voice = on, sound = alarmSoundOn)
                            },
                            editor = editor,
                                voiceProfiles = visibleVoiceProfiles,
                                familyVoices = familyVoices,
                                // 선택 시트에는 내 목소리와 공유받은 목소리가 섞여 있는데, 공유분은
                                // visibleVoiceProfiles 에 없고 familyVoices 에만 있다. 여기서 내 목록만
                                // 뒤지면 공유 목소리 ▶ 가 조용히 아무것도 안 한다 — 미리듣기는 id 로
                                // 인사말 클립을 찾으므로 id 를 그대로 넘겨 둘 다 같은 경로를 타게 한다.
                                onPreviewVoice = { voiceId -> voicePreview.previewVoice(voiceId, stockClips) },
                                previewPlayingVoiceId = voicePreview.playingVoiceId,
                                previewPreparingVoiceId = voicePreview.preparingVoiceId,
                                voiceProfileBusy = voiceProfileBusy,
                                stockClips = stockClips,
                                lastUsedVoiceId = lastUsedVoiceId,
                                restrictToWeatherMedication = restrictToWeatherMedication,
                                audioMessage = audioMessage,
                                isRecording = isRecording,
                                recordingElapsedMillis = recordingElapsedMillis,
                                recordingLevel = recordingLevel,
                                isCachedAudioPreviewActive = previewTarget == AudioPreviewTarget.CachedAudio,
                                isPreviewPreparing = previewPreparing,
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
                                onPreviewAudio = { playCachedAudio() },
                                onDiscardRecording = {
                                    // 미리듣기가 재생 중이면 먼저 멈춘 뒤 녹음을 비운다(소리 잔존 방지).
                                    stopPreview()
                                    editor.clearAudio()
                                },
                                onCreateVoiceProfileClick = onCreateVoiceProfile,
                                onOpenRandomPromptSettings = ::openRandomPromptSettings,
                                onOpenFreeBucketSettings = { settingsDetailPanel = "free_bucket" },
                                onOpenVoiceOutputSettings = { settingsDetailPanel = "voice_output" },
                            )
                        }
                    }

                item {
                    Box(modifier = Modifier.padding(horizontal = editorHorizontalPadding)) {
                        val voiceOn = editor.playMode != AlarmPlayModes.ALARM_ONLY
                        val alarmSoundOn = editor.playMode != AlarmPlayModes.VOICE_ONLY && editor.alarmSoundEnabled
                        AlarmSettingsCard(
                            snoozeEnabled = editor.snoozeEnabled,
                            snoozeMinutes = editor.snoozeMinutes,
                            snoozeRepeatLimit = editor.snoozeRepeatLimit,
                            vibrationPattern = editor.vibrationPattern,
                            alarmVolumePercent = editor.alarmVolumePercent,
                            alarmSoundLabel = editor.alarmSoundLabel,
                            // 알람음 on/off 토글은 이 행에 함께 둔다. 행은 항상 노출.
                            alarmSoundEnabled = alarmSoundOn,
                            showAlarmSound = true,
                            // 목소리 크기는 무료·유료 모두 목소리 카드 안의 행에서 연다(UI 통일) —
                            // 세부설정의 '목소리' 행은 더 이상 쓰지 않는다.
                            showVoiceOutput = false,
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
                            onAlarmSoundEnabledChange = { on -> applyAlarmOutput(voice = voiceOn, sound = on) },
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
                    // 바 배경이 페이지 배경과 같아 경계가 없으면 스크롤 콘텐츠가 '잘린' 것처럼
                    // 보인다 — 다른 카드 구분선과 같은 풀 톤 헤어라인으로 바의 시작을 분명히 한다.
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
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
                            ),
                    ) {
                        EditorActionButtons(
                            isSaving = isSaving,
                            canSave = editorCanSave,
                            onSave = ::saveEditor,
                            onCancel = onCancel,
                            recipientName = if (familyAlarmMode) {
                                selectedFamilyRecipientValue?.name?.trimmedOrNull()
                                    ?: selectedFamilyRecipientValue?.email?.trimmedOrNull()
                            } else {
                                null
                            },
                        )
                    }
                }
            }
        }

        // 세부 설정 pane 은 하드컷 대신 우측에서 밀려 들어오고 우측으로 나간다(드릴인 서브페이지
        // 문법). 빠른 픽 성격의 바텀시트(테마·수신자·목소리)와 달리 이건 옵션이 여럿인 전체 페이지라
        // push 슬라이드가 맞다. exit 중에도 내용이 필요하므로 마지막 패널을 기억해 렌더한다.
        var lastDetailPanel by remember { mutableStateOf(settingsDetailPanel) }
        LaunchedEffect(settingsDetailPanel) {
            if (settingsDetailPanel != null) lastDetailPanel = settingsDetailPanel
        }
        AnimatedVisibility(
            visible = settingsDetailPanel != null,
            enter = slideInHorizontally(tween(280, easing = EditorPaneEasing)) { it } +
                fadeIn(tween(160)),
            exit = slideOutHorizontally(tween(220, easing = EditorPaneEasing)) { it } +
                fadeOut(tween(180)),
        ) {
        when (lastDetailPanel) {
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
                // 직접 입력 모드면 pane 에서 '직접 입력'이 선택돼 보이도록 manual 을 넘긴다.
                randomContext = if (editor.voiceRandomPrompt) editor.voiceRandomContext else ManualMessageContext,
                // 직접 입력으로 저장된 알람만 기존 문구를 프리필한다. 버킷 알람도 저장 시
                // voiceRandomPrompt=false + voiceText=클립문구가 되므로 버킷 여부를 함께 본다
                // (안 그러면 사용자가 쓴 적 없는 클립 문구가 '내가 입력한 문구'처럼 나온다).
                manualText = if (!editor.voiceRandomPrompt && !editor.isActiveBucketAlarm()) {
                    editor.voiceText
                } else {
                    ""
                },
                manualRemaining = manualQuota?.remaining,
                manualLimit = manualQuota?.limit,
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

            "free_bucket" -> FreeBucketSettingsPane(
                buckets = freeBucketsFor(stockClips, editor.voiceProfileId, appVoiceLanguage),
                selectedBucket = editor.selectedBucket,
                onSelectBucket = { bucket ->
                    if (bucket == "weather") {
                        // 날씨는 저장한 도시 기준으로 매칭되므로, 고르는 시점에 도시를
                        // 확인/수정하게 한다(이미 입력돼 있어도 다이얼로그에 채워서 보여줌).
                        freeWeatherDialogOpen = true
                    } else {
                        selectBucket(bucket)
                    }
                },
                onDismiss = { settingsDetailPanel = null },
                onManualLocked = { voicePlanGateOpen = true },
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
        }
    }

    if (freeWeatherDialogOpen) {
        WeatherLocationDialog(
            country = editor.voiceWeatherCountry,
            city = editor.voiceWeatherCity,
            onDismissWithoutSave = { freeWeatherDialogOpen = false },
            onConfirm = { country, city ->
                editor.voiceWeatherCountry = country
                editor.voiceWeatherCity = city
                freeWeatherDialogOpen = false
                selectBucket("weather")
            },
        )
    }

    if (voicePlanGateOpen) {
        PlanGateDialog(
            title = if (freeVoiceTier) {
                stringResource(R.string.r3dlg_plan_gate_title)
            } else {
                stringResource(R.string.editor_plan_gate_login_title)
            },
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
            onRedeemCode = onRegisterCode,
            redeemBusy = redeemBusy,
        )
    }
}


