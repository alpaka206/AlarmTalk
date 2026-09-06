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
import androidx.compose.foundation.layout.height as androidxHeight
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
import com.alarmtalk.app.clearFocusOnOutsideTap
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.alarmtalk.app.R
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmAudioLimits
import com.alarmtalk.app.data.toPromptPreferences
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

private enum class AudioPreviewTarget {
    CachedAudio,
    StockClip,
}

// 세부 설정 pane 슬라이드용 emphasized 이징(타임휠 세틀과 같은 계열의 감속 곡선).
private val EditorPaneEasing = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)


/**
 * 저장이 막힌 사유. **버튼을 죽이는 대신 알럿으로 말하기 위한** 값이다
 * (`AlarmEditorScreen.editorSaveBlockReason` 주석 참조).
 */
internal enum class SaveBlockReason {
    RECORDING_MISSING,
    VOICE_MISSING,
    VOICE_UNAVAILABLE,

    /**
     * 교체 정리가 끝나지 않은 목소리. **잠깐이고 곧 풀린다** — 그래서 '쓸 수 없다' 와
     * 문구를 나눈다(사용자가 목소리를 잃은 줄 알고 다시 만들지 않도록).
     */
    VOICE_SETTLING,
    WEATHER_LOCATION_MISSING,
    FORTUNE_INFO_MISSING,
    MESSAGE_PREPARING,
}

@Composable
internal fun AlarmEditorScreen(
    contentPadding: PaddingValues,
    alarm: AlarmEntity?,
    authSession: AuthSession?,
    subscriptionResponse: BillingSubscriptionResponse?,
    familyGroup: FamilyGroupCurrentResponse?,
    /**
     * 스토어가 **지금** 유효하다고 확인해 준 상태인가(기한까지 반영된 값).
     * ⚠ 원시 `storePlanKey` 를 넘기지 말 것 — 기한이 지난 키를 그대로 믿게 된다.
     */
    storeEntitledNow: Boolean,
    familyAlarmMode: Boolean,
    initialFamilyRecipientId: String? = null,
    voiceProfiles: List<VoiceProfile>,
    familyVoices: List<FamilyVoiceProfile>,
    /** 교체 정리가 끝나지 않아 아직 고를 수 없는 목소리들(흐리게 그리고 못 고르게 한다). */
    settlingVoiceProfileIds: Set<String> = emptySet(),
    /** 그 목소리를 눌렀을 때 이유를 알린다. */
    onVoiceUnavailable: (String) -> Unit = {},
    voiceProfileBusy: Boolean,
    voiceProfileLoadFinished: Boolean,
    stockClips: List<StockClip>,
    /** 카테고리별 완전한 세트 크기(서버 제공). null 이면 완전성을 판정할 수 없어 라이브로 간다. */
    expectedVariants: com.alarmtalk.app.network.ExpectedVariantCounts? = null,
    /** 목소리별 준비도(생성+다운로드). 준비 화면이 그린다. */
    clipReadiness: List<com.alarmtalk.app.data.ClipReadiness.VoiceProgress> = emptyList(),
    /** 서버 생성이 실패한 목소리를 다시 큐에 올린다. */
    onRetryClipRenders: () -> Unit = {},
    /** 공유받은 목소리인데 소유자 쪽 생성이 아직인 것(진행률에 넣지 않고 다른 문구로 말한다). */
    clipReadinessAwaitingOwner: Set<String> = emptySet(),
    /** 관문이 막은 목소리를 준비 대상에 넣어 다시 세라고 알린다. */
    onPrepareClipsFor: (String) -> Unit = {},
    // 새 알람이 이어받을 '직전 선택' 세 축. 셋 다 계정별로 저장되고, 저장에 성공한 알람에서만
    // 기록된다(MainViewModel.rememberVoiceUsed / rememberMessageChoiceUsed).
    // 기존 알람을 열 때는 어느 것도 쓰지 않는다 — 열기만 해도 설정이 바뀌면 안 된다.
    lastUsedVoiceId: String? = null,
    lastMessageContext: String? = null,
    lastFreeBucket: String? = null,
    // 마지막에 쓴 직접 입력 문구. 차 있으면 마지막 선택이 직접 입력이었다는 뜻이다.
    lastManualText: String? = null,
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
    /**
     * 알람 권한이 빠져 있으면 저장을 시작하기 전에 이걸 부르고 멈춘다.
     * **음성 생성보다 먼저** 확인해야 한다 — 생성은 서버 호출이고 월 한도를 깎는데,
     * 그러고 나서 권한 때문에 알람이 안 만들어지면 사용자는 쿼터만 잃는다.
     */
    onMissingAlarmPermission: () -> Unit = {},
    /**
     * 뷰모델에서 알람 생성·수정이 진행 중인지. [onSave] 는 값을 돌려주지 않는 비동기 호출이라
     * 편집기 혼자서는 저장이 끝났는지 알 수 없다 — 이 값이 없으면 음성 생성 없는 빠른 경로에서
     * 저장 버튼이 살아 있어 두 번 저장되고, 완료 콜백이 백스택을 두 번 팝해 검은 화면이 된다.
     */
    saving: Boolean = false,
    onSave: (AlarmDraft) -> Unit,
) {
    // 시스템 스톡 보이스 도입으로 무료 플랜도 음성 모드를 쓸 수 있다 (스톡 보이스 + 프리셋 문구).
    // 로그인하지 않은 경우만 음성 모드를 잠근다.
    val voicePlanLocked = authSession == null
    // 무료 플랜 제한 모드: 녹음/파일·직접 입력·동적(날씨/운세) 문구·번역은 유료 게이트.
    //
    // ⚠ **구독 응답이 오기 전에는 서버 `users.plan` 을 본다.** `hasPaidVoiceAccess` 는
    // 응답이 없으면 false 라, 그것만 보면 편집기를 여는 순간 유료 사용자가 잠깐 무료로
    // 판정된다 — 내 클론이 목록에서 사라지고 문구가 테마로 잠긴 채 보인다.
    // 같은 폴백을 이미 알람 잠금 판정(`AlarmTalkApp` 의 `planIsFree`)이 쓰고 있다.
    // 2026-08-31: 손으로 쓴 폴백을 **유일 판정기**로 옮겼다(`resolvePaidVoiceAccess`).
    // 표시·저장 게이트라 **모르면 잠그지 않는다** — 잘못 잠그면 산 기능을 못 쓰고,
    // 잘못 열어 두면 다음 동기화에서 정리된다.
    val freeVoiceTier = authSession != null &&
        !resolvePaidVoiceAccess(
            subscriptionResponse = subscriptionResponse,
            familyGroup = familyGroup,
            userPlan = authSession.user.plan,
            storeEntitled = storeEntitledNow,
            nowMillis = System.currentTimeMillis(),
        ).isEntitledOptimistic()
    // 무료 강등 시 본인 클론은 서버에 보존되지만 사용 불가 — 편집기에는 시스템 목소리만
    // 노출/선택 가능하게 목록을 걸러 쓴다(재유료 시 그대로 복귀). 보이스 선택지·저장 가능
    // 목록이 모두 이 걸러진 목록을 참조한다.
    val visibleVoiceProfiles = if (freeVoiceTier) {
        voiceProfiles.filter { it.isSystem == true }
    } else {
        voiceProfiles
    }
    val defaultPlayMode = if (voicePlanLocked) AlarmPlayModes.ALARM_ONLY else AlarmPlayModes.VOICE_ONLY
    // 새 알람은 마지막에 고른 문구 종류를 기본값으로 이어받는다(한 번도 고른 적 없으면 목록에
    // 노출하지 않는 '기본 인사말'=preset 으로 시작).
    // **직접 입력도 문구까지 기억한다**(2026-08-06 변경). 종류만 이어받으면 빈 직접입력으로
    // 열려 저장이 막히는데, 문구를 함께 이어받으면 글자가 같아 AlarmAudioStore 입력 캐시에
    // 걸려 서버 호출도 한도 차감도 없이 저장된다 — '기억하지 않는다' 의 근거가 사라졌다.
    val defaultRandomContext = lastMessageContext ?: DefaultRandomPromptContext
    val editor = remember(alarm?.id) {
        AlarmEditorState.from(
            alarm,
            defaultPlayMode = defaultPlayMode,
            defaultRandomContext = defaultRandomContext,
            defaultManualText = lastManualText,
        )
    }
    // 이 목소리가 **미리 구워 둔 스톡 클립**으로 우는가(무료 플랜이거나 기본 목소리).
    //
    // ⚠ 예전 이름은 `restrictToWeatherMedication` 이었고, 이름 그대로 문구 목록을 날씨·약으로
    //   잘랐다. 그건 등급 정책이 아니라 **기본 목소리에 운세·사랑 클립이 없다**는 사정이었다 —
    //   2026-09-02 에 그 클립을 채우고 목록을 하나로 합쳤다(`docs/spec/voice-and-message.md`).
    //   지금 이 값이 가르는 것은 **오디오를 어떻게 얻는가** 하나다: 스톡 클립을 내려받아
    //   바로 붙일지, 클론 사전렌더 버킷을 저장 시점에 붙일지.
    //   등급으로 갈리는 것은 **직접 입력 잠금 하나뿐**이다(`freeVoiceTier`).
    val isSystemVoiceSelected = isSystemVoiceId(editor.voiceProfileId) ||
        voiceProfiles.any { it.id == editor.voiceProfileId && it.isSystem == true }
    val usesStockClips = freeVoiceTier || isSystemVoiceSelected
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
    // 계정별 값이다 — 계정이 바뀌면 다시 읽는다(앞 사람의 사주를 물려받지 않게).
    val promptOwnerUserId = authSession?.user?.id
    var dynamicPromptPreferences by remember(appContext, promptOwnerUserId) {
        mutableStateOf(dynamicPromptPreferenceStore.read(promptOwnerUserId))
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
    // ⚠ **가족 알람 저장이 막힌 이유는 알럿으로 말한다**(2026-08-24).
    // 예전에는 `audioMessage` 에 넣었는데, 그 문구를 그리는 곳이 `VoiceAudioCard` 안이라
    // **재생 방식이 '알람' 이면 카드째 숨겨져 아무것도 안 보였다** — 사용자에겐 "저장 버튼이
    // 안 눌린다" 로 나타난다(실기기 재현). 목소리 모드여도 카드는 화면 중간이고 저장 버튼은
    // 하단 고정이라, 아래로 스크롤해 저장하면 역시 화면 밖이다.
    // 이건 안내가 아니라 **차단**이라(시각을 고쳐야 진행된다) 사라지는 스낵바도 맞지 않는다.
    // iOS 는 처음부터 `validationAlert` 알럿이었다 — 양쪽을 같은 동작으로 맞춘다.
    var familyBlockAlert by remember { mutableStateOf<Pair<String, String>?>(null) }
    var isRecording by remember { mutableStateOf(false) }
    // 음성 생성 구간(편집기 안에서 도는 부분). 저장 전체는 아래 [busy] 로 본다.
    var generating by remember { mutableStateOf(false) }
    // 저장 관련 UI 는 예외 없이 이걸 본다: 생성 중이거나, 뷰모델이 아직 저장 중이거나.
    // 둘 중 하나만 보면 반드시 구멍이 생긴다 — 생성만 보면 빠른 경로에서 버튼이 안 잠기고,
    // 뷰모델만 보면 생성하는 몇십 초 동안 버튼이 살아 있다.
    val busy = generating || saving
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

    /** 아직 못 받은 목소리를 골랐을 때 띄우는 준비 화면. */
    // ⚠ **어느 목소리 때문에 열렸는지 기억한다.** 예전에는 Boolean 이라 관문이 넘긴 id 를
    // 버렸고, 공유받은 목소리가 준비 대상에서 빠져 "준비됐어요 100%" 만 보였다 —
    // 돌아가면 관문이 또 막아 **빠져나갈 수 없는 고리**였다(2026-08-18).
    var preparationVoiceId by remember { mutableStateOf<String?>(null) }
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
    /**
     * 가족 알람이고 수신자가 **자기 설정을 이미 갖고 있는가**.
     *
     * 이때 이 화면의 지역·사주 칸은 비어 있는 게 정상이다 — 서버가 남의 설정 값을 숨기고
     * 준비 여부만 내려주기 때문이다(`family-group.ts` 의 `dynamic_prompt_settings` 는
     * 본인일 때만 실값). 그러니 비었다고 저장을 막으면 안 된다. 생성은 서버가 하고,
     * 서버는 `target_user_id` 로 **수신자 본인의 설정**을 읽어 채운다
     * (`tts.ts` 의 `loadTargetDynamicPromptSettings` → `firstNonBlankText(요청값, 수신자값)`).
     * 요청에 값이 있으면 그게 이기므로, 수신자 설정이 없을 때 내가 임시로 채워 넣는 흐름도
     * 그대로 동작한다.
     */
    val targetProvidesWeather = familyAlarmMode && savedWeatherConfigured
    val savedFortuneConfigured = if (familyAlarmMode) {
        selectedFamilyRecipientValue?.dynamicPromptSettingsState?.fortuneReady == true
    } else {
        activeDynamicPromptPreferences.fortuneGender.isNotBlank() &&
            activeDynamicPromptPreferences.fortuneBirthDate.isNotBlank() &&
            activeDynamicPromptPreferences.fortuneBirthTime.isNotBlank()
    }
    /** [targetProvidesWeather] 의 사주 짝. */
    val targetProvidesFortune = familyAlarmMode && savedFortuneConfigured
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
        // ⚠ **울림과 같은 스트림으로 낸다(USAGE_ALARM).** 기본값(USAGE_MEDIA)으로 두면
        // 미리듣기는 미디어 볼륨, 실제 알람은 알람 볼륨으로 나가 **같은 설정인데 크기가 다르게**
        // 들린다. 그러면 목소리 크기 설정을 미리듣기로 검증할 수 없다 — 크게 들어보고 저장했는데
        // 알람은 작은 상황이 생긴다. 조건은 RingingService.createVoicePlayer 와 같게 유지할 것.
        runCatching {
            player.setAudioAttributes(
                android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_ALARM)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
        }
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

    // ⚠ **클립 판정은 여기 없다** — 전부 `ClipPreparationGate.kt` 의 [ClipGate] 에 있다.
    // 컴포저블 밖에 둬야 테스트에서 부를 수 있고, 판정식이 한 벌뿐임이 파일 경계로 못 박힌다.
    // 여기서 본문을 다시 펼쳐 쓰지 말 것. 관문(`needsClipPreparation`)을 부르는 자리는 **셋**이다.
    val clipGate = ClipGate(
        stockClips = stockClips,
        expectedVariants = expectedVariants,
        appVoiceLanguage = appVoiceLanguage,
    )

    /**
     * 준비 페이지를 연다. [needsClipPreparation] 이 true 인 **모든** 자리는 이걸 부른다 —
     * 막기만 하고 보내지 않으면 사용자가 할 수 있는 일이 없다.
     *
     * `onPrepareClipsFor` 는 그 목소리를 진행률 계산 대상에 넣는다. 공유받은 목소리는 내
     * 목록에 없어서, 안 넣으면 준비 페이지가 "준비됐어요 100%" 를 보여 주고 돌아가면 관문이
     * 또 막는 **빠져나갈 수 없는 고리**가 된다(`refreshClipReadiness` 의 selectedVoiceProfileId).
     */
    fun openClipPreparation(profileId: String) {
        preparationVoiceId = profileId
        onPrepareClipsFor(profileId)
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
        val clipLanguage = clipGate.bucketClipLanguageFor(bucket, profileId)
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
            val cached = audioStore.getCachedAudio(cacheKey, clip.audioUrl) ?: run {
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
        if (busy || previewPreparing) return
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
        // ⚠ **여기서 성공을 말하지 않는다.** onSave 는 비동기라 서버 응답을 보기 전인데,
        // 예전에는 Toast 로 '상대 알람을 설정했어요' 를 먼저 띄웠다 — 실패하면 그 뒤에
        // '상대 알람 설정에 실패했어요' 가 이어져 **정면으로 모순되는 두 문장**이 연달아
        // 떴다. 성공 확인은 서버 응답 뒤 뷰모델의 스낵바 한 번으로 충분하고, 그쪽은
        // 수신자 이름까지 말해 준다.
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
            voice -> AlarmPlayModes.VOICE_ONLY
            else -> AlarmPlayModes.ALARM_ONLY
        }
        // ⚠ **'목소리만' 에서는 alarmSoundEnabled 를 끄지 않는다.**
        // 톤을 안 트는 것은 playMode 가 이미 표현한다(표시도 파생값이라 화면은 그대로다).
        // 여기서 0 으로 박으면, 나중에 유료 만료·목소리 삭제로 그 알람이 강등됐을 때
        // 톤 폴백까지 함께 막혀 **소리가 하나도 안 나는 알람**이 된다 — 폴백이 가장 필요한
        // 바로 그 상황에서만 꺼진다. 그 값은 '알람음을 쓸 때의 설정' 으로만 둔다.
        if (sound) {
            editor.alarmSoundEnabled = true
        } else if (!voice) {
            editor.alarmSoundEnabled = false
        }
        if (voice && authSession == null) {
            editor.voiceSource = VoiceSources.LOCAL_AUDIO
            editor.clearTtsMeta()
        } else if (voice && wasAlarmOnly) {
            editor.voiceSource = VoiceSources.TTS_PROFILE
            editor.clearTtsMeta()
        }
    }

    fun saveEditor() {
        if (busy) return
        // **권한이 가장 먼저다.** 아래 어느 갈래든 결국 알람을 만들거나 고치는데, 음성 생성은
        // 그 전에 일어나는 유료 호출이다. 결국 못 만들 거면 생성부터 하지 않는다.
        // 알람 권한 셋은 전부 필수다(CLAUDE.md 「알람 권한 3종은 필수」).
        if (!PermissionSnapshot.read(context).alarmReady) {
            onMissingAlarmPermission()
            return
        }
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
                val earliestMillis = earliestSelectableFamilyAlarmMillis()
                val earliestLabel = android.text.format.DateFormat.getTimeFormat(context)
                    .format(java.util.Date(earliestMillis))
                val message = context.getString(
                    R.string.editor_error_family_alarm_lead_too_soon,
                    earliestLabel,
                )
                familyBlockAlert = context.getString(R.string.editor_error_family_alarm_lead_title) to message
                return
            }
            if (isFamilyAlarmTimeUnavailable(recipient, editor.hour, editor.minute, editor.repeatDaysMask)) {
                familyBlockAlert = context.getString(R.string.editor_error_family_alarm_unavailable_title) to
                    context.getString(R.string.editor_error_family_alarm_time_unavailable)
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
        // 수신자가 자기 설정을 갖고 있으면 이 칸들은 비어 있는 게 정상이다(서버가 값을 숨긴다).
        // 서버가 target_user_id 로 채우므로 막지 않는다 — targetProvidesWeather 주석 참고.
        if (
            editor.voiceRandomPrompt &&
            randomContextUsesWeather(editor.voiceRandomContext) &&
            editor.voiceWeatherCity.isBlank() &&
            !targetProvidesWeather
        ) {
            audioMessage = context.getString(R.string.editor_error_weather_location_required)
            return
        }
        if (
            editor.voiceRandomPrompt &&
            normalizedRandomPromptContext(editor.voiceRandomContext) == "wake_fortune" &&
            !targetProvidesFortune &&
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
        // ⚠ **관문 3/3 — 저장 직전.** 판정은 `needsClipPreparation` 한 곳에만 있다.
        //
        // 위 둘이 막았어야 하는 상태지만 창이 남는다: 목소리를 고른 뒤 매니페스트가 갱신되는
        // 경우, 그리고 문구 종류를 바꾸고 저장까지 오는 경우가 그렇다. 그래서 여기는
        // **fail-closed** 다 — 통과시키면 라이브 생성을 걷어낸 뒤에는 울릴 오디오가 없는
        // 알람이 저장된다.
        //
        // ⚠ **자리가 중요하다 — 바로 위 `hasFreshTtsAudio` 조기 submit 뒤여야 한다.** 그 앞에
        // 두면 **이미 오디오가 붙어 있는 알람의 시각만 고치는 재저장**까지 준비 페이지로 튀긴다.
        // 생성할 것도 바인딩할 것도 없는데 클립을 기다리게 하는 셈이고, 매니페스트가 잠깐 비면
        // 멀쩡한 알람을 고칠 길이 사라진다. 이 줄 아래로는 전부 오디오를 만드는 경로다.
        //
        // 막되 **버튼을 죽이지 않는다**(`editorSaveBlocked` 에 넣지 않은 이유). 여기까지 온
        // 사람은 저장하려던 사람이고, 말 없이 비활성화된 버튼보다 준비 페이지가 낫다.
        if (clipGate.needsClipPreparation(
                profileId = profileId,
                randomPrompt = editor.voiceRandomPrompt,
                randomContext = editor.voiceRandomContext,
            )
        ) {
            openClipPreparation(profileId)
            return
        }
        // 문구가 글자까지 똑같으면 서버를 부르지 않고 전에 만든 오디오를 그대로 쓴다.
        // (대기 없음 + 직접 입력 월 한도 안 깎임 + 오프라인에서도 저장됨.)
        //
        // 랜덤 문구는 매번 문장이 달라지는 게 기능이라 제외한다. 가족 알람도 제외 — 서버가
        // 수신자별로 만들어야 하고, 내 로컬 캐시는 수신자가 갖고 있지 않아 무음이 된다.
        val reuseUserId = authSession?.user?.id?.takeIf { it.isNotBlank() }
        val ttsInputKey = if (!familyAlarmMode && !editor.voiceRandomPrompt && reuseUserId != null) {
            AlarmAudioStore.ttsInputKey(
                userId = reuseUserId,
                profileId = profileId,
                text = text,
                category = editor.activeVoiceCategory(),
                language = editor.activeVoiceLanguage(),
                listenerTitle = listenerTitleForSave,
            )
        } else {
            null
        }
        ttsInputKey
            ?.let { audioStore.resolveTtsInput(it) }
            ?.let { alias -> audioStore.getCachedAudio(alias.cacheKey, rawAudioUri = editor.rawAudioUri)?.to(alias) }
            ?.let { (cached, alias) ->
                editor.setGeneratedTtsAudio(
                    audio = cached,
                    profileId = profileId,
                    // 입력 원문이 아니라 **그 오디오와 짝이 되는 서버 표시 문구**를 쓴다.
                    // 번역이 켜지면 둘이 달라지는데, 원문을 쓰면 잠금화면 문구와 실제 음성이
                    // 어긋난다(Codex #660).
                    text = alias.displayText,
                    messageId = cached.messageId ?: editor.ttsMessageId ?: "",
                    rawAudioUri = cached.rawAudioUri,
                    listenerTitle = listenerTitleForSave,
                )
                audioMessage = context.getString(R.string.editor_existing_voice_cache_used)
                editor.voiceListenerTitleOverride = listenerTitleForSave.orEmpty()
                submitDraft(editor.toDraft())
                return
            }

        // 이전에 진행 중이던 generation 이 남아 있다면 취소.
        generationJob?.cancel()
        generationJob = scope.launch {
            generating = true
            // 1) **문구 종류를 골랐으면 반드시 사전렌더 클립으로 묶는다.**
            //
            // ⚠ **여기서 라이브 생성으로 폴백하지 말 것**(2026-08-18 변경). 예전에는 버킷이
            // 미완성이거나 다운로드가 실패하면 아래 라이브 생성으로 떨어졌는데, 알람 음성은
            // 이제 **프리셋 + 직접 입력 둘뿐**이다(docs/qa/dev-test-handoff.md 5절).
            // 폴백을 남겨 두면 그 경로로 저장된 알람이 **매일 같은 한 문장**을 반복한다 —
            // 서버가 다시 지어 줄 일이 없기 때문이다.
            //
            // 못 묶으면 **준비 페이지로 보낸다**(관문과 같은 처리). 저장이 늦어지는 대신
            // 되돌릴 수 없는 잘못된 행이 남지 않는다.
            //
            // 예전 제외 갈래 둘을 **없앴다**:
            //  - `!familyAlarmMode`: 가족 알람도 이제 `bucket_id` 를 실어 보낸다(`f7385200`).
            //    받는 사람이 그 테마의 자기 클립을 묶으므로 수신자 무음 문제가 사라졌고,
            //    날씨 조건도 **받는 사람 기준**으로 고른다(docs/spec/family-alarm.md 4절).
            //  - `!isSystemVoiceId`: 기본 목소리도 같은 테마 클립을 갖는다. 제외해 둘 이유가
            //    라이브 폴백뿐이었는데 그게 없어졌다.
            // ⚠ **고른 버킷이 있으면 그것이 곧 카테고리다.** 컨텍스트에서 유도하면, 목소리
            // 재선택 등으로 컨텍스트가 기본값(`preset`)으로 밀린 순간 `preset → greeting`
            // 매핑이 걸려 **미리듣기 샘플 버킷**이 알람에 붙는다. greeting 은 목소리 창의
            // '들어보기' 전용이라 알람으로는 성립하지 않고, 서버가 `POST /alarm` 을 400 으로
            // 거절한다 — 로컬에만 남는 알람이 된다(2026-08-31 실기기: bucketId=greeting,
            // 문구 "안녕하세요! 만나서 정말 반가워요.").
            val cloneBucketCategory = editor.selectedBucket
                ?: clonePrerenderBucketCategoryFor(editor.voiceRandomContext)
            // ⚠ **`voiceRandomPrompt` 하나로 가르지 말 것**(2026-08-31 실기기 재현).
            // `setBucketAudio` 는 버킷을 붙이면서 **항상 그 값을 끈다.** 그래서 이 조건만 보면,
            // 바인딩이 한 번이라도 풀린 버킷 알람은 **여기로 돌아올 길이 없고** 아래 '직접
            // 입력' 갈래로 떨어져 유료 전용 라이브 TTS 를 부른다 — 무료 사용자는 기본 목소리로
            // 날씨를 고르고 저장만 눌렀는데 "유료 이용권에서 사용할 수 있어요" 를 본다
            // (`generateTtsAudio` 의 check 가 네트워크 전에 던진다).
            //
            // 바인딩을 푸는 길은 여럿이다: 이미 고른 목소리를 시트에서 **다시 누르기**
            // (동일 id 가드가 없어 `clearAudio()`+`clearTtsMeta()`), 재생 방식 왕복, 클립
            // 언어 ≠ 앱 언어. 어느 쪽이든 `voiceText`(클립 문구)와 `selectedBucket` 은 남는다.
            //
            // 그래서 판정은 **사용자가 고른 것이 테마인가**(`selectedBucket`)로 본다.
            // `hasBucketMessageChoice()`/`isActiveBucketAlarm()` 은 쓸 수 없다 — 둘 다
            // `audioCacheKey` 가 살아 있어야 true 라, 바인딩이 풀린 바로 그 상태에서 false 다.
            // (직접 입력을 고르면 `selectedBucket` 은 확실히 null 이 된다 — 문구 화면 두 곳.)
            val bucketMessageChosen = editor.hasMessageKindChoice()
            if (bucketMessageChosen && cloneBucketCategory != null) {
                // 이미 resolve 된 contextVariantIndex 를 넘겨 재저장 시 null 로 덮어써지지 않게 한다(넘기지
                // 않으면 setBucketAudio 가 null 로 리셋 → 준비창 재해결 전까지 날씨 0=맑음 오재생).
                val bound = runCatching {
                    bindStockBucketClips(cloneBucketCategory, profileId, editor.contextVariantIndex)
                }.getOrDefault(false)
                generating = false
                if (bound) {
                    submitDraft(editor.toDraft())
                } else {
                    openClipPreparation(profileId)
                }
                return@launch
            }
            // 2) 여기까지 왔다 = **직접 입력**이다(랜덤이 아니거나 버킷으로 안 매핑되는 종류).
            //    그 문구를 서버에 합성시킨다 — 이 갈래는 월 한도를 차감하는 유료 경로다.
            // 진행 안내는 저장 버튼의 스피너(EditorActionButtons)가 맡는다 — 방금 누른
            // 자리에서 도는 게 화면 위쪽 카드에 뜬 '준비하는 중이에요' 한 줄보다 직관적이고,
            // 이 자리에 안내를 넣으면 실패했을 때 그 자리에 들어올 에러 문구를 밀어낸다.
            runCatching {
                val response = onGenerateTts(
                    TtsGenerateRequest(
                        voiceProfileId = profileId,
                        text = text,
                        category = editor.activeVoiceCategory(),
                        language = editor.activeVoiceLanguage(),
                        translate = false,
                        // ⚠ **`random` 은 언제나 false 다**(2026-08-18). 이 자리에 도달하는 건
                        // 직접 입력뿐이라, 서버가 문장을 '지어내는' 갈래는 앱에서 사라졌다.
                        // 되살리지 말 것 — 되살리면 그 알람은 매일 같은 한 문장을 반복한다
                        // (서버가 다시 지어 줄 주기적 경로가 없다).
                        //
                        // ⚠ 같이 사라진 것: `randomContext`·`alarmHour`/`alarmMinute`·
                        // `weather*`·`fortune*`. 그 값들은 **행에는 그대로 남는다** — 사전렌더
                        // variant 를 고르는 데(`/tts/prerender-variant`) 쓰이기 때문이다.
                        // 다만 `/tts/generate` 로는 다시 보내지 말 것.
                        random = false,
                        randomContext = null,
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
                // 다음에 같은 문구를 넣으면 이 파일을 바로 찾을 수 있게 화살표를 남긴다.
                // 서버 표시 문구(response.text)도 함께 — 번역이 켜지면 입력 원문과 다르다.
                ttsInputKey?.let { inputKey ->
                    audioStore.linkTtsInput(inputKey, cacheKey, response.text)
                    // **표시 문구로도 화살표를 남긴다.** 알람에 저장되는 건 입력 원문이 아니라
                    // 서버 표시 문구이고(setGeneratedTtsAudio — 잠금화면 문구와 음성을 맞추려고),
                    // '마지막에 쓴 직접 입력 문구' 로 기억되는 것도 그 값이다. 번역이 켜진
                    // 기기(앱 언어 ≠ ko)에서는 둘이 달라서, 입력 원문 키만 남기면 다음 새 알람이
                    // 표시 문구로 열려 캐시를 빗나간다 — 재생성도 없고 한도도 안 깎인다던 약속이
                    // 조용히 깨진다(Codex #685). 같은 값이면 굳이 두 번 쓰지 않는다.
                    val displayTextKey = AlarmAudioStore.ttsInputKey(
                        userId = reuseUserId!!,
                        profileId = profileId,
                        text = response.text,
                        category = editor.activeVoiceCategory(),
                        language = editor.activeVoiceLanguage(),
                        listenerTitle = listenerTitleForSave,
                    )
                    if (displayTextKey != inputKey) {
                        audioStore.linkTtsInput(displayTextKey, cacheKey, response.text)
                    }
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
            generating = false
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
        }
    }

    // 제한 보이스 선택 시 버킷 클립 프리페치 — 편집 중 문구를 고르거나 저장할 때 11개를
    // 그 자리에서 받는 대신, 보이스를 고른 순간부터 백그라운드로 받아 둔다(캐시분 스킵).
    // stockClips 를 키에 포함: 매니페스트가 아직 안 온 상태로 진입하면 프리페치가 빈손으로
    // 끝나므로, 매니페스트 도착 시 재시도한다(Codex #607).
    LaunchedEffect(editor.voiceProfileId, usesStockClips, stockClips) {
        val profileId = editor.voiceProfileId
        if (usesStockClips && !profileId.isNullOrBlank() && stockClips.isNotEmpty()) {
            onPrefetchRestrictedVoiceClips(profileId)
        }
    }

    // 연결 상태를 키에 포함해, 오프라인으로 버킷을 못 받았다가 연결이 복구되면 자동 재시도한다.
    val isOnline by rememberIsOnline()
    // ⚠ **문구 pane 이 돌려준 값에는 종류가 안 바뀐 경우도 있다**(2026-09-06 실기기 재현).
    //   `applyRandomPromptSettings` 는 버킷·문구·오디오를 **비우고** 다시 붙이는 일을 아래
    //   효과에 맡기는데, 아래 키는 전부 그때 그대로일 수 있다 — 같은 종류를 다시 확인하고
    //   나오거나(들어갔다 뒤로만 눌러도 그렇다) 도시만 채워 넣은 경우다. 그러면 효과가 다시
    //   돌지 않아 편집기가 "문구를 준비하고 있어요" 에 갇힌다. 그래서 **비운 쪽이 직접**
    //   이 값을 올려 재바인딩을 부른다 — 키에 값 하나를 더 얹는 것보다 인과가 분명하다.
    var stockClipRebindTick by remember { mutableStateOf(0) }
    // ⚠ **`editor.voiceRandomContext` 가 키에 있어야 한다**(2026-09-02). 문구 목록을 하나로
    //   합친 뒤로 스톡 클립 목소리도 다섯 종류를 고를 수 있는데, 고른 종류가 키에 없으면
    //   이 효과가 다시 돌지 않아 **방금 고른 운세가 붙지 않는다.**
    LaunchedEffect(usesStockClips, editor.playMode, editor.voiceProfileId, editor.voiceSource, stockClips, appVoiceLanguage, isOnline, editor.voiceRandomContext, stockClipRebindTick) {
        if (usesStockClips && editor.playMode != AlarmPlayModes.ALARM_ONLY) {
            // 직접 녹음은 플랜·목소리 종류와 무관하게 허용된다(녹음본 로컬 재생일 뿐).
            // 아래 TTS 쪽 제한(버킷/문구 강제)은 소스가 TTS 일 때만 적용한다 — 녹음 알람에는
            // 문구 개념이 없다.
            if (editor.voiceSource != VoiceSources.LOCAL_AUDIO) {
                // ⚠ **직접 입력을 고른 유료 사용자는 건드리지 않는다.**
                // 아래 잔재 정리는 직접 입력 문구를 잔재로 보고 지우므로, 그냥 두면 유료
                // 사용자가 방금 친 문구가 매니페스트 도착·온오프라인 전환만으로 **조용히
                // 사라진다.** 직접 입력이 잠기지 않은 등급(= 유료)이 실제로 직접 입력을
                // 고른 상태면 이 강제를 통째로 건너뛴다. 잠긴 등급(무료)에서는 그대로 돈다.
                val manualChosen = editor.hasTypedManualText()
                if (!freeVoiceTier && manualChosen) return@LaunchedEffect
                if (editor.voiceRandomPrompt) editor.voiceRandomPrompt = false
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
                    val buckets = freeBucketsFor(stockClips, profileId, appVoiceLanguage, expectedVariants)
                    // 새 알람은 마지막에 고른 테마를 이어받는다 — 이게 없으면 매번 FreeBucketOrder
                    // 첫 값(약)으로 돌아가, 날씨로 바꿔 저장해도 다음 알람이 다시 약이 된다.
                    // 기존 알람은 자기 값만 쓴다(열기만 해도 문구가 바뀌면 안 된다). 날씨는 도시가
                    // 있어야 조건 매칭이 되고 없으면 저장이 막히므로, 저장된 도시가 없으면 안 잇는다.
                    val remembered = lastFreeBucket?.takeIf {
                        alarm == null && it in buckets &&
                            (it != "weather" || savedWeatherConfigured || editor.voiceWeatherCity.isNotBlank())
                    }
                    // ⚠ **사용자가 방금 고른 종류가 가장 먼저다**(2026-09-02). 문구 pane 이
                    //   `voiceRandomContext` 를 세우고 버킷은 비워 두므로(클론과 같은 규약),
                    //   여기서 그 종류를 버킷으로 옮겨 붙이지 않으면 고른 것과 다른 버킷이
                    //   붙는다 — '운세' 를 골랐는데 마지막에 쓰던 '약' 이 붙는 식이다.
                    val chosen = clonePrerenderBucketCategoryFor(editor.voiceRandomContext)
                        ?.takeIf { it in buckets }
                    val target = chosen
                        ?: editor.selectedBucket?.takeIf { it in buckets }
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

    // ⚠ **정리 중인 목소리는 '고를 수 있는 것' 에서 뺀다**(Codex #703 P1). 선택 시트의 탭만
    // 막아서는 부족하다 — 그 목소리가 **직전에 쓴 것**이거나 **이미 선택돼 있으면** 새 편집기가
    // 자동으로 그것을 고르고 저장까지 통과해, 뒤이은 정리가 그 새 알람을 되돌릴 수 없이 벗긴다.
    // 시트에는 그대로 보이되(흐리게) 자동 선택·저장 판정에서만 제외한다.
    fun VoiceProfile.selectableNow() =
        (status == null || status == "ready") && id !in settlingVoiceProfileIds
    val usableTtsProfileIds = (
        visibleVoiceProfiles.filter { it.selectableNow() }.map { it.id } +
            familyVoices.filter {
                (it.status == null || it.status == "ready") &&
                    it.isShared != false &&
                    it.id !in settlingVoiceProfileIds
            }.map { it.id }
        ).toSet()

    val readyOwnVoiceIds = visibleVoiceProfiles.filter {
        it.selectableNow() && it.isSystem != true
    }.map { it.id }
    val readyFamilyVoiceIds = familyVoices.filter {
        (it.status == null || it.status == "ready") &&
            it.isShared != false &&
            it.id !in settlingVoiceProfileIds
    }.map { it.id }
    val readySystemVoiceIds = visibleVoiceProfiles.filter {
        it.selectableNow() && it.isSystem == true
    }.map { it.id }

    // 목소리 카드는 LazyColumn 아래쪽에 있어 작은 화면에서는 아직 구성되지 않을 수 있다.
    // 기본 선택은 저장 판정과 같은 화면 스코프에서 끝내야 스크롤 위치가 상태를 바꾸지 않는다.
    LaunchedEffect(
        editor.playMode,
        editor.voiceSource,
        editor.voiceProfileId,
        lastUsedVoiceId,
        readyOwnVoiceIds,
        readyFamilyVoiceIds,
        readySystemVoiceIds,
        voiceProfileLoadFinished,
    ) {
        if (editor.playMode != AlarmPlayModes.ALARM_ONLY &&
            editor.voiceSource != VoiceSources.LOCAL_AUDIO &&
            editor.voiceProfileId.isNullOrBlank()
        ) {
            preferredInitialVoiceProfileId(
                lastUsedVoiceId = lastUsedVoiceId,
                ownVoiceIds = readyOwnVoiceIds,
                familyVoiceIds = readyFamilyVoiceIds,
                systemVoiceIds = readySystemVoiceIds,
                profileLoadFinished = voiceProfileLoadFinished,
            )?.let(editor::selectVoiceProfile)
        }
    }

    /**
     * 날씨 문구에 필요한 **지역이 확보돼 있는가** — 두 곳(`randomPromptSettingsComplete`,
     * `editorSaveBlocked` 의 무료 버킷 갈래)이 **반드시 이 함수 하나를 본다.**
     *
     * ⚠ 예전에는 판정식이 두 벌이었고 한쪽에만 `targetProvidesWeather` 탈출구가 있었다.
     * 그래서 **수신자가 날씨를 설정해 뒀는데도**(`weather_ready=true`) 기본 목소리를 고르면
     * 저장이 영구히 막혔다(2026-08-24 실기기). 가족 알람에서 지역 칸이 비어 있는 것은
     * **정상**이다 — 서버가 프라이버시 때문에 남의 값을 숨기고 준비 여부만 내려준다.
     */
    fun weatherLocationReady(): Boolean =
        editor.voiceWeatherCity.isNotBlank() || targetProvidesWeather

    /** [weatherLocationReady] 의 사주 짝 — 판정은 여기 한 곳이다. */
    fun fortuneInfoReady(): Boolean =
        targetProvidesFortune || (
            editor.voiceFortuneGender.isNotBlank() &&
                editor.voiceFortuneBirthDate.isNotBlank() &&
                editor.voiceFortuneBirthTime.isNotBlank()
            )

    fun randomPromptSettingsComplete(): Boolean {
        if (!editor.voiceRandomPrompt) return false
        val context = normalizedRandomPromptContext(editor.voiceRandomContext)
        if (randomContextUsesWeather(context) && !weatherLocationReady()) {
            return false
        }
        if (context == "wake_fortune" && !fortuneInfoReady()) {
            return false
        }
        return true
    }

    // 저장이 막혔는가. ⚠ **사유 문구는 두지 않는다**(2026-08-18 변경. 그전에는 하단 바에
    // 한 줄씩 떴다). 이유를 말하는 자리는 **그 값이 사는 곳**이다:
    //  - 목소리 → 목소리 카드의 `NoUsableVoiceProfileCallout`("아직 사용할 목소리가 없어요."
    //    + [목소리 만들기])와 '삭제된 목소리' 배너. 둘 다 해결 액션까지 갖고 있다.
    //  - 문구 → 문구 요약 행(`MessageModeSummaryRow`)과 문구 화면의 상세 행.
    //
    // 바에 사유를 또 쓰면 같은 순간 **두 문장이 서로 다른 얘기를 했다** — 배너는 "저장된
    // 목소리는 그대로 울리지만", 바는 "쓸 수 없어요" 였다. 그리고 목소리 자동선택·클립
    // 캐시히트처럼 한두 프레임짜리 과도기에 문구가 연달아 갈아치워져, 재생 방식을 목소리로
    // 바꾸는 순간 "없던 문구가 주루룩 뜬다" 로 읽혔다(2026-08-18 사용자 보고).
    //
    // 미완성 상태 자체도 이제 만들어지지 않는다 — 문구 화면이 값 없는 종류를 선택시키지
    // 않는다(`AlarmRandomPromptSettings` 의 `contextBeforeDialog`, 무료 pane 의 '먼저 묻고
    // 확인해야 선택'). 남은 갈래는 과도기뿐이고 그건 안내할 것이 없다.
    //
    /**
     * 저장이 막힌 **이유**. 없으면 저장 가능하다.
     *
     * ⚠ **버튼을 죽이지 않는다**(2026-08-24 변경. 그전에는 사유 없이 비활성화만 했다).
     * 사유를 그 값이 사는 자리에만 두자던 앞선 설계는 실기기에서 무너졌다 — 재생 방식이
     * '알람' 이면 목소리 카드가 통째로 숨겨지고, 목소리 모드여도 카드는 화면 중간인데
     * 저장 버튼은 하단 고정이라 **아래로 스크롤해 저장을 누르면 사유가 화면 밖**이다.
     * 사용자에게는 "버튼이 죽었다 = 고장" 으로 보인다(2026-08-24 보고).
     *
     * 그래서 **누르게 두고, 왜 안 되는지 알럿으로 말한다** — 가족 알람 차단 알럿과 같은
     * 껍데기(`IosAlertDialog`)를 쓴다.
     */
    val editorSaveBlockReason: SaveBlockReason? = when {
        editor.playMode == AlarmPlayModes.ALARM_ONLY -> null
        editor.voiceSource == VoiceSources.LOCAL_AUDIO ->
            if (editor.localAudioUri.isNullOrBlank()) SaveBlockReason.RECORDING_MISSING else null
        else -> {
            val profileId = editor.voiceProfileId?.takeIf { it.isNotBlank() }
            val text = editor.ttsTextForSave()
            when {
                profileId == null -> SaveBlockReason.VOICE_MISSING
                // 정리 중은 '쓸 수 없다' 와 다르다 — 곧 풀리므로 그렇게 말한다.
                profileId in settlingVoiceProfileIds -> SaveBlockReason.VOICE_SETTLING
                profileId !in usableTtsProfileIds && !editor.hasFreshTtsAudio(profileId, text) ->
                    SaveBlockReason.VOICE_UNAVAILABLE
                editor.voiceRandomPrompt && !randomPromptSettingsComplete() ->
                    if (randomContextUsesWeather(normalizedRandomPromptContext(editor.voiceRandomContext))) {
                        SaveBlockReason.WEATHER_LOCATION_MISSING
                    } else {
                        SaveBlockReason.FORTUNE_INFO_MISSING
                    }
                // 스톡 클립 버킷은 `voiceRandomPrompt = false` 로 저장되므로 위
                // `randomPromptSettingsComplete()` 갈래에 걸리지 않는다 — 조건으로 클립을
                // 고르는 두 버킷은 여기서 따로 본다.
                // 판정은 언제나 `weatherLocationReady()`·`fortuneInfoReady()` 한 곳뿐이다 —
                // 여기에 조건을 다시 쓰지 말 것.
                usesStockClips && editor.selectedBucket == "weather" &&
                    !weatherLocationReady() -> SaveBlockReason.WEATHER_LOCATION_MISSING
                // ⚠ **운세도 같이 막는다**(2026-09-02). 문구 목록을 합치면서 기본 목소리도
                //   운세를 고를 수 있게 됐는데, 사주가 없으면 클라가 테마 인덱스를 못 골라
                //   **매번 같은 클립**이 나간다. 날씨만 막고 두면 그 조용한 오작동이 남는다.
                usesStockClips && editor.selectedBucket == "fortune" &&
                    !fortuneInfoReady() -> SaveBlockReason.FORTUNE_INFO_MISSING
                // 빈 문구는 클립이 아직 안 붙은 과도기다.
                !editor.voiceRandomPrompt && editor.voiceText.trim().isBlank() ->
                    SaveBlockReason.MESSAGE_PREPARING
                else -> null
            }
        }
    }

    fun openRandomPromptSettings() {
        settingsDetailPanel = "random_prompt"
    }

    fun applyRandomPromptSettings(result: RandomPromptSettingsResult) {
        if (result.randomContext == ManualMessageContext) {
            // '직접 입력' 선택 → 랜덤 끄고, 다이얼로그에서 받은 문구를 그대로 쓴다.
            val nextText = result.manualText.take(200)
            // 문구를 실제로 바꾸지 않았으면 기존 오디오를 버리지 않는다. 프리필이 생기면서
            // '들어갔다 확인만 누르는' 흐름이 흔해졌는데, 매번 재합성하면 직접 입력 월 한도
            // (manual-tts-quota)가 아무 변경 없이 깎인다.
            val unchanged = editor.isManualForSave() && nextText.trim() == editor.voiceText.trim()
            editor.voiceRandomPrompt = false
            editor.voiceText = nextText
            editor.voiceLanguage = appVoiceLanguage
            // ⚠ **종류를 바꾸면 옛 버킷을 반드시 지운다**(2026-08-31). 저장 갈래가
            // `selectedBucket` 을 '사용자가 고른 종류' 의 근거로 삼기 때문에, 남겨 두면
            // 직접 입력을 골라도 버킷 갈래로 들어가 **방금 친 문구를 버린다.**
            editor.selectedBucket = null
            if (!unchanged) {
                editor.clearAudio()
                editor.clearTtsMeta()
            }
            settingsDetailPanel = null
            return
        }
        // 고른 것이 하나도 안 바뀌었으면 **아무것도 건드리지 않는다.** 직접 입력 갈래의
        // `unchanged` 가드와 같은 이유다 — 들여다보고 그냥 뒤로 나오는 흐름이 흔한데,
        // 그때마다 붙어 있던 클립과 오디오를 버리면 다시 붙을 때까지 요약 행이 '준비 중'
        // 으로 돌아가고, 관문 판정도 한 번 더 돈다.
        val nextRandomContext = normalizedRandomPromptContext(result.randomContext)
        val randomChoiceUnchanged = !editor.isManualForDisplay() &&
            normalizedRandomPromptContext(editor.voiceRandomContext) == nextRandomContext &&
            editor.voiceWeatherCountry.trim() == result.weatherCountry &&
            editor.voiceWeatherCity.trim() == result.weatherCity &&
            editor.voiceFortuneGender.trim() == result.fortuneGender &&
            editor.voiceFortuneBirthDate.trim() == result.fortuneBirthDate &&
            editor.voiceFortuneBirthTime.trim() == result.fortuneBirthTime
        if (randomChoiceUnchanged) {
            settingsDetailPanel = null
            return
        }
        // ⚠ **관문 2/3 — 문구 종류 선택.** 판정은 `needsClipPreparation` 한 곳에만 있다.
        //
        // 같은 목소리라도 **종류마다 버킷 category 가 다르다**(`clonePrerenderBucketCategoryFor`).
        // 서버 사전렌더는 category 단위로 끝나므로 '사랑' 은 준비됐는데 '약' 은 아직인 상태가
        // 정상적으로 존재한다 — 특히 방금 공유받은 목소리가 그렇다. 목소리를 고를 때(관문 1)
        // 통과한 것이 **그 뒤 고른 종류까지 보장하지는 않는다.**
        //
        // 여기서 안 막으면 저장에서 막히는데, 사유 문구를 없앤 뒤로 그건 **말 없이 비활성화된
        // 저장 버튼**이다. 그래서 종류는 **바꾸지 않고**(고르기 전 그대로 둔다) 준비 페이지로
        // 보낸다 — 목소리 관문이 목소리를 되돌리는 것과 같은 규칙이다.
        val profileIdForClipGate = editor.voiceProfileId?.takeIf { it.isNotBlank() }
        if (profileIdForClipGate != null &&
            clipGate.needsClipPreparation(
                profileId = profileIdForClipGate,
                randomPrompt = true,
                randomContext = result.randomContext,
            )
        ) {
            settingsDetailPanel = null
            openClipPreparation(profileIdForClipGate)
            return
        }
        editor.voiceRandomPrompt = true
        editor.voiceRandomContext = nextRandomContext
        // ⚠ 위와 같은 이유 — 옛 버킷이 남으면 **새로 고른 종류 대신 옛 종류가 다시 붙는다.**
        // 새 종류의 버킷은 저장 시 `clonePrerenderBucketCategoryFor(새 컨텍스트)` 로 붙는다.
        editor.selectedBucket = null
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
            dynamicPromptPreferenceStore.saveWeatherLocation(promptOwnerUserId, result.weatherCountry, result.weatherCity)
            dynamicPromptPreferences = dynamicPromptPreferenceStore.read(promptOwnerUserId)
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
                promptOwnerUserId,
                gender = result.fortuneGender,
                birthDate = result.fortuneBirthDate,
                birthTime = result.fortuneBirthTime,
            )
            dynamicPromptPreferences = dynamicPromptPreferenceStore.read(promptOwnerUserId)
            shouldSyncOwnDynamicPromptSettings = true
        }
        if (shouldSyncOwnDynamicPromptSettings) {
            onUpdateDynamicPromptSettings(dynamicPromptPreferences.toDynamicPromptSettings())
        }
        // 방금 비운 버킷을 다시 붙이라고 스톡 클립 효과를 깨운다(위 `stockClipRebindTick` 주석).
        stockClipRebindTick++
        settingsDetailPanel = null
    }

    // 문구 pane 은 **자기 BackHandler 로** 뒤로가기를 받아 값을 반영하고 닫는다
    // (`AlarmRandomPromptSettings` — 안쪽에서 더 늦게 등록되므로 그쪽이 먼저 잡는다).
    // 여기서 또 가로채 '반영 없이 닫기' 를 하면 순서가 뒤집히는 날 값이 조용히 사라진다.
    BackHandler(enabled = settingsDetailPanel != null) {
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
                generating = false
                audioMessage = context.getString(R.string.editor_voice_generation_canceled_time_changed)
            }
            generationJob = null
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            // ⚠ **입력창 밖을 누르면 입력이 끝난다**(2026-08-27 지시).
            // 스크롤 컨테이너가 탭을 소비하므로 **뒤에 깐 레이어로는 닿지 않는다** —
            // 부모에 걸어 Final 패스에서 '아무도 소비하지 않은 탭' 만 받는다
            // (`clearFocusOnOutsideTap` 주석).
            .clearFocusOnOutsideTap()
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
                    // ⚠ Column 이다 — Box 로 두면 재생 방식 카드와 목소리 카드가 **겹친다**.
                    androidx.compose.foundation.layout.Column(
                        modifier = Modifier.padding(horizontal = editorHorizontalPadding),
                    ) {
                        val alarmSoundOn = editor.playMode != AlarmPlayModes.VOICE_ONLY && editor.alarmSoundEnabled
                        // ⚠ **재생 방식은 2택 세그먼트로 고른다** — 목소리 / 알람.
                        // `PlayModeCard` 는 있는데 아무도 부르지 않아 **화면에 안 나오고**
                        // 있었다(목소리 카드 안 스위치가 대신하고 있었다). 그러면 iOS 와
                        // 다른 화면이 되고, 무엇보다 '둘 중 하나' 라는 결정이 스위치의
                        // 켜짐/꺼짐으로 흐려진다. 실기기 대조로 잡았다.
                        PlayModeCard(
                            selected = editor.playMode,
                            onSelect = { mode ->
                                if (mode != AlarmPlayModes.ALARM_ONLY && voicePlanLocked) showVoicePlanGate()
                                else applyAlarmOutput(
                                    voice = mode != AlarmPlayModes.ALARM_ONLY,
                                    sound = mode == AlarmPlayModes.ALARM_ONLY,
                                )
                            },
                            voiceLocked = voicePlanLocked,
                            onLockedVoiceClick = { showVoicePlanGate() },
                        )
                        // ⚠ **고른 쪽 박스만 그린다.** '알람' 이면 목소리 카드가 통째로 없고,
                        // '목소리' 면 세부설정의 알람음 행이 없다(`showAlarmSound`). 둘 중
                        // 하나라고 해 놓고 안 고른 쪽 설정을 계속 보여 주면, 만질 수는 있는데
                        // 울릴 때 아무 영향이 없는 컨트롤이 남는다.
                        // 사라질 때도 0.28초 동안은 **아직 컴포즈에 남아 있다**(줄어드는 중).
                        // 그 사이 이 카드 안의 `LaunchedEffect` 는 목소리 선택 상태에만
                        // 묶여 있어 재생 방식이 바뀌어도 다시 돌지 않는다 — 새 효과를 넣을 땐
                        // `playMode` 를 키로 삼지 말 것.
                        androidx.compose.animation.AnimatedVisibility(
                            visible = editor.playMode != AlarmPlayModes.ALARM_ONLY,
                            enter = playModeEnter(),
                            exit = playModeExit(),
                        ) {
                        androidx.compose.foundation.layout.Column {
                        androidx.compose.foundation.layout.Spacer(
                            Modifier.androidxHeight(12.dp),
                        )
                        VoiceAudioCard(
                            // ⚠ **아직 못 받은 목소리는 고를 수 없다** — 관문 **1/3**.
                            // 판정은 `needsClipPreparation` 한 곳에만 있다(거기 주석 참조).
                            // 여기는 "**고른 목소리**를 지금 기준으로 본다" 는 자리다.
                            onNeedsClipPreparation = { profileId ->
                                clipGate.needsClipPreparation(
                                    profileId = profileId,
                                    randomPrompt = editor.voiceRandomPrompt,
                                    randomContext = editor.voiceRandomContext,
                                )
                            },
                            onOpenClipPreparation = { profileId -> openClipPreparation(profileId) },
                            voiceEnabled = true,
                            onVoiceEnabledChange = { on ->
                                if (voicePlanLocked) showVoicePlanGate()
                                else applyAlarmOutput(voice = on, sound = alarmSoundOn)
                            },
                            editor = editor,
                                voiceProfiles = visibleVoiceProfiles,
                                familyVoices = familyVoices,
                                settlingVoiceProfileIds = settlingVoiceProfileIds,
                                onVoiceUnavailable = onVoiceUnavailable,
                                // 선택 시트에는 내 목소리와 공유받은 목소리가 섞여 있는데, 공유분은
                                // visibleVoiceProfiles 에 없고 familyVoices 에만 있다. 여기서 내 목록만
                                // 뒤지면 공유 목소리 ▶ 가 조용히 아무것도 안 한다 — 미리듣기는 id 로
                                // 인사말 클립을 찾으므로 id 를 그대로 넘겨 둘 다 같은 경로를 타게 한다.
                                onPreviewVoice = { voiceId -> voicePreview.previewVoice(voiceId, stockClips) },
                                previewPlayingVoiceId = voicePreview.playingVoiceId,
                                previewPreparingVoiceId = voicePreview.preparingVoiceId,
                                voiceProfileBusy = voiceProfileBusy,
                                voiceProfileLoadFinished = voiceProfileLoadFinished,
                                stockClips = stockClips,
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
                                usesStockClips = usesStockClips,
                                onOpenRandomPromptSettings = ::openRandomPromptSettings,
                                onOpenVoiceOutputSettings = { settingsDetailPanel = "voice_output" },
                            )
                        }
                        }
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
                            alarmSoundEnabled = alarmSoundOn,
                            // 목소리 모드에서는 알람음 행 자체를 숨긴다(위 주석 참조).
                            showAlarmSound = editor.playMode == AlarmPlayModes.ALARM_ONLY,
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
                    // ⚠ **여기에 상태 문구를 다시 넣지 말 것**(위 `editorSaveBlocked` 주석).
                    // 이 슬롯은 사유 한 줄이 계속 갈아치워지는 자리였고, 그 사유들은 전부
                    // 값이 사는 자리(목소리 카드·문구 행)가 더 정확히 말한다.
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
                            isSaving = busy,
                            // ⚠ **항상 활성화다.** 막힘은 누른 뒤 알럿으로 말한다.
                            canSave = true,
                            // ⚠ **사유 판정은 여기서 한다.** `saveEditor` 안이 아니다 —
                            // 그 함수는 `editorSaveBlockReason` 보다 **먼저** 선언돼 있어
                            // 지역 val 을 볼 수 없다(코틀린 지역 선언 순서).
                            onSave = {
                                val reason = editorSaveBlockReason
                                if (reason == null) {
                                    saveEditor()
                                } else {
                                    val titleRes = when (reason) {
                                        SaveBlockReason.RECORDING_MISSING -> R.string.editor_block_recording_title
                                        SaveBlockReason.VOICE_MISSING,
                                        SaveBlockReason.VOICE_UNAVAILABLE -> R.string.editor_block_voice_title
                                        SaveBlockReason.VOICE_SETTLING -> R.string.editor_block_voice_settling_title
                                        SaveBlockReason.WEATHER_LOCATION_MISSING -> R.string.editor_block_weather_title
                                        SaveBlockReason.FORTUNE_INFO_MISSING -> R.string.editor_block_fortune_title
                                        SaveBlockReason.MESSAGE_PREPARING -> R.string.editor_block_preparing_title
                                    }
                                    val messageRes = when (reason) {
                                        SaveBlockReason.RECORDING_MISSING -> R.string.editor_block_recording_message
                                        SaveBlockReason.VOICE_MISSING -> R.string.editor_block_voice_message
                                        SaveBlockReason.VOICE_UNAVAILABLE -> R.string.editor_block_voice_unavailable_message
                                        SaveBlockReason.VOICE_SETTLING -> R.string.msg_voice_replacement_settling
                                        SaveBlockReason.WEATHER_LOCATION_MISSING ->
                                            if (familyAlarmMode) R.string.editor_block_weather_family_message
                                            else R.string.editor_block_weather_message
                                        SaveBlockReason.FORTUNE_INFO_MISSING ->
                                            if (familyAlarmMode) R.string.editor_block_fortune_family_message
                                            else R.string.editor_block_fortune_message
                                        SaveBlockReason.MESSAGE_PREPARING -> R.string.editor_block_preparing_message
                                    }
                                    familyBlockAlert = context.getString(titleRes) to context.getString(messageRes)
                                }
                            },
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
                // 버킷 여부를 함께 봐야 한다 — 버킷 알람도 voiceRandomPrompt=false 로 저장되므로
                // (아래 manualText 와 같은 이유) 이것만으로 판별하면 '사랑'으로 저장한 알람을
                // 다시 열었을 때 pane 이 '직접 입력'에 체크된 채 열린다.
                // 표시 판정 — 재생 방식과 무관(`hasBucketMessageChoice` 주석).
                randomContext = if (!editor.isManualForDisplay()) {
                    editor.voiceRandomContext
                } else {
                    ManualMessageContext
                },
                // 직접 입력으로 저장된 알람만 기존 문구를 프리필한다. 버킷 알람도 저장 시
                // voiceRandomPrompt=false + voiceText=클립문구가 되므로 버킷 여부를 함께 본다
                // (안 그러면 사용자가 쓴 적 없는 클립 문구가 '내가 입력한 문구'처럼 나온다).
                manualText = if (editor.isManualForDisplay()) {
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
                // ⚠ **목록을 자르는 것은 '클립이 있는가' 하나다** — 등급이 아니다.
                //   등록(클론) 목소리는 다섯 종류가 모두 사전렌더되므로 전부 나오고,
                //   기본 목소리는 서버에 구워 둔 카테고리만 나온다. 시딩이 끝나면 앱을
                //   고치지 않아도 나타난다(`freeBucketsFor` 가 매니페스트와 교차한다).
                availableContexts = if (usesStockClips) {
                    freeBucketsFor(stockClips, editor.voiceProfileId, appVoiceLanguage, expectedVariants)
                        .mapNotNull { randomPromptContextForBucket(it) }
                } else {
                    EditorMessageContexts.map { it.first }
                },
                // ⚠ 잠그는 기준은 **무료 플랜뿐**이다 — 기본 목소리는 이유가 되지 않는다.
                manualLocked = freeVoiceTier,
                onManualLocked = { voicePlanGateOpen = true },
                onSaveSettings = ::applyRandomPromptSettings,
            )

            "voice_output" -> VoiceOutputSettingsPane(
                volumePercent = editor.voiceVolumePercent,
                onVolumeChange = {
                    editor.voiceVolumePercent = it
                    // 듣고 있는 중이면 그 자리에서 크기만 바꾼다(다시 틀지 않는다).
                    voicePreview.updateAlarmVolume(it)
                },
                onVolumeSettled = {
                    editor.voiceProfileId?.takeIf { it.isNotBlank() }?.let { profileId ->
                        voicePreview.ensureAlarmVolumePreview(
                            voiceProfileId = profileId,
                            stockClips = stockClips,
                            volumePercent = editor.voiceVolumePercent,
                        )
                    }
                },
                // 목소리를 아직 안 골랐으면 들려줄 것이 없다 — 그때는 행을 그리지 않는다
                // (아래 `previewVoiceId != null`). 알람음만 쓰는 모드에서는 이 화면 자체가
                // 없으므로 여기서 더 가르지 않는다.
                onPreview = {
                    editor.voiceProfileId?.takeIf { it.isNotBlank() }?.let { profileId ->
                        voicePreview.previewVoice(
                            voiceProfileId = profileId,
                            stockClips = stockClips,
                            // 울릴 때와 같은 스트림·같은 게인으로 — 그래야 여기서 맞춘 크기가
                            // 실제 알람의 크기다(`previewVoice` 의 alarmVolumePercent 주석).
                            alarmVolumePercent = editor.voiceVolumePercent,
                        )
                    }
                },
                previewPlaying = voicePreview.playingVoiceId != null &&
                    voicePreview.playingVoiceId == editor.voiceProfileId,
                previewPreparing = voicePreview.preparingVoiceId != null &&
                    voicePreview.preparingVoiceId == editor.voiceProfileId,
                showPreview = !editor.voiceProfileId.isNullOrBlank(),
                onDismiss = { settingsDetailPanel = null },
            )
        }
        }
    }

    // ⚠ **어떤 조건 블록 안에도 두지 말 것.** 처음에 `if (voicePlanGateOpen)` 안에 넣었다가
    // 알럿이 영영 안 떴다(실기기 확인) — 저장 차단은 플랜 게이트와 아무 상관이 없다.
    familyBlockAlert?.let { (alertTitle, alertMessage) ->
        IosAlertDialog(
            title = alertTitle,
            message = alertMessage,
            actions = listOf(
                IosAlertAction(
                    label = stringResource(R.string.auth_confirm),
                    emphasized = true,
                    onClick = { familyBlockAlert = null },
                ),
            ),
            onDismiss = { familyBlockAlert = null },
        )
    }

    if (voicePlanGateOpen) {
        // ⚠ **상태는 셋인데 분기는 둘이었다 — 그래서 유료 사용자가 '로그인이 필요해요' 를
        // 봤다**(2026-08-07 사용자 문의로 확인). `freeVoiceTier` 는 `로그인함 && !유료` 라,
        // 그 `else` 에는 비로그인뿐 아니라 **로그인한 유료 사용자**도 들어간다.
        //
        // 유료가 이 게이트에 닿는 길은 실재한다 — `showVoicePlanGate()` 는 등급을 보지
        // 않는다. 이용권을 이미 가진 사람에게 로그인을 요구하고 이용권을 팔려 든 셈이었다.
        // (2026-09-02 부터 잠긴 '직접 입력' 은 **무료에게만** 뜬다 — 그전에는 기본 목소리를
        // 고른 유료 사용자에게도 떠서 이 사고의 주된 경로였다.)
        //
        // 이제 셋으로 가른다. **각 상태에 맞는 액션만 붙인다** — 쿠폰·이용권 버튼은
        // '이용권이 없어서' 막힌 경우에만 뜻이 있다.
        val gateReason = when {
            authSession == null -> VoiceGateReason.LOGIN_REQUIRED
            freeVoiceTier -> VoiceGateReason.PLAN_REQUIRED
            // 로그인 + 유료인데 막혔다 = 목소리 종류의 문제다(플랜 문제가 아니다).
            else -> VoiceGateReason.SYSTEM_VOICE_LIMIT
        }
        PlanGateDialog(
            title = stringResource(
                when (gateReason) {
                    VoiceGateReason.LOGIN_REQUIRED -> R.string.editor_plan_gate_login_title
                    VoiceGateReason.PLAN_REQUIRED -> R.string.r3dlg_plan_gate_title
                    VoiceGateReason.SYSTEM_VOICE_LIMIT -> R.string.editor_plan_gate_system_voice_title
                },
            ),
            message = stringResource(
                when (gateReason) {
                    VoiceGateReason.LOGIN_REQUIRED -> R.string.editor_plan_gate_login_required
                    VoiceGateReason.PLAN_REQUIRED -> R.string.plan_gate_paid_message
                    VoiceGateReason.SYSTEM_VOICE_LIMIT -> R.string.editor_plan_gate_system_voice_message
                },
            ),
            confirmLabel = stringResource(
                when (gateReason) {
                    VoiceGateReason.SYSTEM_VOICE_LIMIT -> R.string.editor_plan_gate_system_voice_confirm
                    else -> R.string.r3dlg_plan_gate_confirm
                },
            ),
            onConfirm = {
                voicePlanGateOpen = false
                // 유료인데 막힌 사람에게 결제 화면을 열면 살 게 없다 — 목소리 등록으로 보낸다.
                if (gateReason == VoiceGateReason.SYSTEM_VOICE_LIMIT) {
                    onCreateVoiceProfile()
                } else {
                    onOpenBilling()
                }
            },
            onDismiss = { voicePlanGateOpen = false },
            // ⚠ 쿠폰 입력은 **이용권이 없을 때만** 붙인다. 비로그인에게 붙이면 등록할 계정이
            // 없고, 이미 유료인 사람에게 붙이면 넣어 봐야 아무 일도 일어나지 않는다.
            onRedeemCode = if (gateReason == VoiceGateReason.PLAN_REQUIRED) onRegisterCode else null,
            redeemBusy = redeemBusy,
        )
    }

    // 아직 못 받은 목소리를 골랐을 때 — 준비 화면을 띄운다.
    // ⚠ 알람 만들기를 막지 않는다. 닫으면 그대로 편집을 이어갈 수 있고, 고른 목소리는
    // 적용되지 않은 채였으므로 예전 목소리가 유지된다.
    preparationVoiceId?.let { targetVoiceId ->
        androidx.compose.ui.window.Dialog(onDismissRequest = { preparationVoiceId = null }) {
            androidx.compose.material3.Surface(
                shape = WakerDialogShape,
                color = MaterialTheme.colorScheme.surface,
            ) {
                com.alarmtalk.app.ui.voices.ClipPreparationScreen(
                    voices = clipReadiness,
                    awaitingOwner = targetVoiceId in clipReadinessAwaitingOwner,
                    onRetry = onRetryClipRenders,
                    onDismiss = { preparationVoiceId = null },
                    modifier = Modifier.padding(vertical = 32.dp),
                )
            }
        }
    }
}

/**
 * 목소리 게이트가 뜬 **이유**. 예전에는 이 셋을 불리언 하나(`freeVoiceTier`)로 갈라서,
 * 로그인한 유료 사용자가 '로그인이 필요해요' 를 보는 사고가 났다.
 */
private enum class VoiceGateReason {
    /** 세션이 없다. 쿠폰을 등록할 계정도 없다. */
    LOGIN_REQUIRED,

    /** 로그인했지만 이용권이 없다. 여기서만 쿠폰 입력이 뜻을 갖는다. */
    PLAN_REQUIRED,

    /**
     * 로그인 + 유료인데 막혔다.
     *
     * ⚠ **지금은 도달 불가능하다**(2026-09-02). 문구 목록을 하나로 합치면서 잠긴
     * '직접 입력' 이 무료에게만 뜨게 됐고, 편집기에서 게이트를 여는 나머지 입력은
     * 전부 `authSession == null` 조건이다.
     *
     * **그래도 지우지 않는다.** `when` 의 `else` 는 무엇이든 되어야 하는데, '로그인했고
     * 유료인데 게이트가 열렸다' 는 버그 상태에 **이용권을 팔면 안 된다** — 그게 애초에
     * 세 갈래로 가른 이유다(2026-08-07 사용자 문의). 버그일 때 가장 덜 해로운 안내가
     * 이것이다. 도달 불가를 이유로 `PLAN_REQUIRED` 에 합치면 옛 사고가 그대로 돌아온다.
     * 상세: `docs/spec/plan-gates.md`.
     */
    SYSTEM_VOICE_LIMIT,
}
