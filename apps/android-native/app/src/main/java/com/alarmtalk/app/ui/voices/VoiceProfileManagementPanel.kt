package com.alarmtalk.app

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.alarmtalk.app.R
import com.alarmtalk.app.core.AlarmTalkLog
import com.alarmtalk.app.data.AlarmAudioStore
import com.alarmtalk.app.data.STOCK_GREETING_CATEGORY
import com.alarmtalk.app.data.AlarmVoiceRecorder
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.VoiceProfileAudioLimits
import com.alarmtalk.app.data.VoiceProfileCreationDraft
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.TtsGenerateRequest
import com.alarmtalk.app.network.TtsGenerateResponse
import com.alarmtalk.app.network.VoiceProfile
import com.alarmtalk.app.ui.guide.UsageGuideDialog
import com.alarmtalk.app.ui.guide.UsageGuideStep
import com.alarmtalk.app.ui.guide.UsageGuideStore
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val AndroidEdgeToEdgeNavigationExtraPadding = 24.dp

@Composable
private fun androidNavigationBarHeightPadding(): Dp {
    val context = LocalContext.current
    val density = LocalDensity.current
    val navigationBarHeightPx = remember(context) {
        val resourceId = context.resources.getIdentifier("navigation_bar_height", "dimen", "android")
        if (resourceId > 0) context.resources.getDimensionPixelSize(resourceId) else 0
    }
    return with(density) { navigationBarHeightPx.toDp() }
}

private fun voiceProfileDurationError(context: android.content.Context, durationMillis: Long?): String? = when {
    durationMillis == null -> context.getString(R.string.voices2_audio_duration_unknown)
    durationMillis < VoiceProfileAudioLimits.MIN_DURATION_MILLIS ->
        context.getString(R.string.voices2_record_at_least_one_minute)
    durationMillis > VoiceProfileAudioLimits.MAX_DURATION_MILLIS +
        VoiceProfileAudioLimits.MAX_DURATION_TOLERANCE_MILLIS ->
        context.getString(R.string.voices2_register_under_two_minutes)
    else -> null
}

private fun voiceProfileFileDurationError(context: android.content.Context, durationMillis: Long?): String? = when {
    durationMillis == null -> context.getString(R.string.voices2_audio_duration_unknown)
    durationMillis < VoiceProfileAudioLimits.MIN_DURATION_MILLIS ->
        context.getString(R.string.voices2_select_file_at_least_one_minute)
    else -> null
}

// 파일에서 잘라낸 구간 길이 검증 — 파일 흐름에서는 녹음 문구("~녹음해 주세요") 대신
// 구간 선택 문구로 안내한다.
private fun voiceProfileCropDurationError(context: android.content.Context, durationMillis: Long?): String? = when {
    durationMillis == null -> context.getString(R.string.voices2_audio_duration_unknown)
    durationMillis < VoiceProfileAudioLimits.MIN_DURATION_MILLIS ||
        durationMillis > VoiceProfileAudioLimits.MAX_DURATION_MILLIS +
        VoiceProfileAudioLimits.MAX_DURATION_TOLERANCE_MILLIS ->
        context.getString(R.string.voices_crop_duration_notice)
    else -> null
}

// 처음 목소리를 만드는 사용자를 위한 단계 가이드 (handoff 코치마크 카피 참고).
@Composable
private fun rememberVoiceCreateGuideSteps(): List<UsageGuideStep> = listOf(
    UsageGuideStep(
        title = stringResource(R.string.voices2_guide_record_title),
        body = stringResource(R.string.voices2_guide_record_body),
    ),
    UsageGuideStep(
        title = stringResource(R.string.voices2_guide_identity_title),
        body = stringResource(R.string.voices2_guide_identity_body),
    ),
    UsageGuideStep(
        title = stringResource(R.string.voices2_guide_register_title),
        body = stringResource(R.string.voices2_guide_register_body),
    ),
)

/**
 * 추천 대사 카드. [fillHeight] 가 true 면 호출부(스크롤 없는 Column)의 weight 와 짝을 이뤄
 * 남은 화면 높이만큼 펼치고 넘칠 때만 내부 스크롤, false(짧은 창 폴백)면 페이지가
 * 스크롤되므로 기존처럼 240dp 캡 + 내부 스크롤을 쓴다.
 */
@Composable
private fun VoiceRecordScriptCard(
    fillHeight: Boolean,
    modifier: Modifier = Modifier,
) {
    OutlinedCard(
        modifier = modifier,
        shape = WakerCardShape,
        border = wakerCardBorder(),
        colors = CardDefaults.outlinedCardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
        ),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = stringResource(R.string.voices_record_script_title),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            // 녹음하며 읽는 본문이라 항상 펼쳐 둔다(토글로 접으면 녹음 도중 다시 펼쳐야 한다).
            Text(
                text = stringResource(R.string.voices2_record_script),
                modifier = Modifier
                    .then(
                        if (fillHeight) {
                            Modifier.weight(1f, fill = false)
                        } else {
                            Modifier.heightIn(max = 240.dp)
                        },
                    )
                    .verticalScroll(rememberScrollState()),
                style = MaterialTheme.typography.bodyMedium,
                lineHeight = MaterialTheme.typography.bodyLarge.lineHeight,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

@Composable
internal fun VoiceProfileManagementPanel(
    voiceProfiles: List<VoiceProfile>,
    familyVoices: List<FamilyVoiceProfile>,
    voiceProfileBusy: Boolean,
    subscriptionResponse: BillingSubscriptionResponse?,
    familyGroup: FamilyGroupCurrentResponse?,
    authSession: AuthSession?,
    onCreateVoiceProfile: (String, CachedAlarmAudio, Boolean, String, String) -> Unit,
    onCreateVoiceProfiles: (List<VoiceProfileCreationDraft>) -> Unit,
    onGenerateTts: suspend (TtsGenerateRequest) -> TtsGenerateResponse,
    stockClips: List<com.alarmtalk.app.network.StockClip>,
    onDownloadStockAudio: suspend (String) -> com.alarmtalk.app.network.TtsMessageAudioResponse,
    onRenameVoiceProfile: (String, String, String, String) -> Unit,
    onShareVoiceProfile: (String, Boolean) -> Unit,
    onUpdateSharedVoiceInfo: (String, String, String) -> Unit,
    onDeleteVoiceProfile: (String) -> Unit,
    onOpenBilling: () -> Unit,
    defaultVoiceId: String? = null,
    onSetDefaultVoice: (String) -> Unit = {},
) {
    val context = LocalContext.current
    val appContext = context.applicationContext
    val audioStore = remember(appContext) { AlarmAudioStore(appContext) }
    val recorder = remember(appContext) { AlarmVoiceRecorder(appContext, audioStore) }
    val scope = rememberCoroutineScope()
    var profileName by remember { mutableStateOf("") }
    var relationshipSelection by remember { mutableStateOf(RelationshipSelection()) }
    var profileListenerTitle by remember { mutableStateOf("") }
    var shareVoice by remember { mutableStateOf(false) }
    var currentStep by remember { mutableStateOf(VoiceRegistrationStep.Source) }
    var selectedAudio by remember { mutableStateOf<CachedAlarmAudio?>(null) }
    var localMessage by remember { mutableStateOf<String?>(null) }
    var inputMode by remember { mutableStateOf(VoiceCaptureMode.Record) }
    var isRecording by remember { mutableStateOf(false) }
    var recordingElapsedMillis by remember { mutableStateOf(0L) }
    // 실제 마이크 입력 진폭(0~1) — 녹음 카드의 미니 레벨 바가 소비한다.
    var recordingLevel by remember { mutableStateOf(0f) }
    var selectedFileUri by remember { mutableStateOf<Uri?>(null) }
    var selectedFileDurationMillis by remember { mutableStateOf<Long?>(null) }
    var cropStartMillis by remember { mutableStateOf(0L) }
    var cropEndMillis by remember { mutableStateOf(VoiceProfileAudioLimits.MAX_DURATION_MILLIS) }
    var createPreparing by remember { mutableStateOf(false) }
    var createSubmitAttempted by remember { mutableStateOf(false) }
    var showCreateForm by remember { mutableStateOf(false) }
    val usageGuideStore = remember(appContext) { UsageGuideStore(appContext) }
    val voiceCreateGuideSteps = rememberVoiceCreateGuideSteps()
    var voiceGuideVisible by remember { mutableStateOf(false) }
    // 목소리 만들기를 처음 열 때 한 번만 자동 노출. 다이얼로그 도움말 버튼으로 다시 볼 수 있다.
    LaunchedEffect(showCreateForm) {
        if (showCreateForm && !usageGuideStore.hasSeen(UsageGuideStore.GUIDE_VOICE_CREATE)) {
            voiceGuideVisible = true
        }
    }
    var voicePlanGateOpen by remember { mutableStateOf(false) }
    var renameTarget by remember { mutableStateOf<VoiceProfile?>(null) }
    var renameName by remember { mutableStateOf("") }
    var renameRelationship by remember { mutableStateOf("") }
    var renameListenerTitle by remember { mutableStateOf("") }
    var renameSubmitAttempted by remember { mutableStateOf(false) }
    var sharedInfoTarget by remember { mutableStateOf<FamilyVoiceProfile?>(null) }
    var deleteTarget by remember { mutableStateOf<VoiceProfile?>(null) }
    var mediaPlayer by remember { mutableStateOf<MediaPlayer?>(null) }
    var filePreviewPreparing by remember { mutableStateOf(false) }
    var filePreviewPlaying by remember { mutableStateOf(false) }
    // 방금 녹음한 클립의 미리듣기 재생 상태 (녹음 완료 배지의 ▶ 버튼).
    var recordPreviewPlaying by remember { mutableStateOf(false) }
    // 기본 목소리 선택 시트 — 시트 안 탭 = 선택 + 인사말 미리듣기(닫기는 드래그/스크림).
    var defaultVoiceSheetOpen by remember { mutableStateOf(false) }
    // 지금 인사말 샘플을 재생 중인 기본 목소리 id (재생 아이콘 토글용).
    var playingGreetingVoiceId by remember { mutableStateOf<String?>(null) }
    var greetingPreviewRequestId by remember { mutableIntStateOf(0) }
    // 방금 등록한 목소리 확인(미리듣기·유지·삭제) 다이얼로그. 목소리는 한 달에 한 번만
    // 바꿀 수 있어, 등록 직후 어떤 목소리로 깨워줄지 들어보고 결정하게 한다.
    var confirmNewVoice by remember { mutableStateOf<VoiceProfile?>(null) }
    var confirmPreviewBusy by remember { mutableStateOf(false) }
    var confirmPreviewPlaying by remember { mutableStateOf(false) }
    // 미리듣기 생성 코루틴 — 다이얼로그를 닫으면 취소해 늦은 재생/오디오 유출을 막는다.
    var confirmPreviewJob by remember { mutableStateOf<Job?>(null) }
    // 등록 제출 후 새로 생긴 목소리를 감지하기 위한 스냅샷(제출 직전 목소리 id 집합).
    var awaitingRegisteredVoice by remember { mutableStateOf(false) }
    var idsBeforeRegister by remember { mutableStateOf<Set<String>>(emptySet()) }
    // 등록이 실제로 시작(voiceProfileBusy=true)된 것을 본 뒤에만 완료를 판정한다.
    // (arm 직후 busy 는 ViewModel 에서 비동기로 켜지므로, 그 사이 무관한 sync 로 오발되는 것 차단.)
    var sawRegisterBusy by remember { mutableStateOf(false) }
    // 시스템 스톡 보이스는 "내 목소리" 수 제한·관리 액션에서 제외한다.
    // 매 리컴포지션마다 재계산하지 않도록 voiceProfiles 가 바뀔 때만 다시 분류한다.
    val systemVoices = remember(voiceProfiles) { voiceProfiles.filter { it.isSystem == true } }
    val ownVoices = remember(voiceProfiles) { voiceProfiles.filter { it.isSystem != true } }
    val isLimitReached = ownVoices.size >= MAX_VOICE_PROFILES
    val canCreateVoice = hasPaidVoiceAccess(subscriptionResponse)
    val canOpenCreateForm = canCreateVoice && !isLimitReached
    val canShareVoice = canShareVoiceWithOthers(subscriptionResponse, familyGroup, authSession)
    val paidVoiceRequiredMessage = stringResource(R.string.voices_paid_required)

    fun stopMediaPreview(invalidateGreetingPreview: Boolean = true) {
        if (invalidateGreetingPreview) greetingPreviewRequestId += 1
        mediaPlayer?.release()
        mediaPlayer = null
        filePreviewPreparing = false
        filePreviewPlaying = false
        recordPreviewPlaying = false
        playingGreetingVoiceId = null
    }

    fun greetingClipFor(profile: VoiceProfile) = stockClips.firstOrNull {
        it.voiceProfileId == profile.id && it.category == STOCK_GREETING_CATEGORY
    } ?: stockClips.firstOrNull { it.voiceProfileId == profile.id }

    // greeting 클립을 캐시에서 찾고, 없으면 내려받아 캐시한다(탭 재생·시트 프리페치 공용).
    suspend fun ensureGreetingCached(clip: com.alarmtalk.app.network.StockClip): CachedAlarmAudio {
        val cacheKey = "greeting_${clip.messageId}"
        withContext(Dispatchers.IO) { audioStore.getCachedAudio(cacheKey) }?.let { return it }
        val response = onDownloadStockAudio(clip.messageId)
        return withContext(Dispatchers.IO) {
            // base64 디코딩도 메인 스레드가 아닌 IO 디스패처에서 수행한다.
            val bytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
            audioStore.cacheGeneratedAudio(
                bytes = bytes,
                format = response.audioFormat,
                rawAudioUri = response.audioUrl,
                displayName = cacheKey,
                cacheKey = cacheKey,
                messageId = clip.messageId,
            )
        }
    }

    // 기본 목소리 시트를 여는 순간 인사말 클립을 미리 받아 둔다 — 행 탭 시 지연 없이 재생되게.
    // 실패는 조용히 넘긴다(탭 시 재시도 경로가 그대로 있음).
    fun prefetchGreetingPreviews() {
        scope.launch {
            systemVoices.forEach { profile ->
                val clip = greetingClipFor(profile) ?: return@forEach
                runCatching { ensureGreetingCached(clip) }
            }
        }
    }

    // 기본 목소리 행을 누르면 그 목소리의 인사말 샘플(greeting 스톡 클립)을 들려준다.
    fun playGreeting(profile: VoiceProfile) {
        if (playingGreetingVoiceId == profile.id) {
            stopMediaPreview()
            return
        }
        val clip = greetingClipFor(profile)
        if (clip == null) {
            localMessage = context.getString(R.string.voices_greeting_preview_preparing)
            return
        }
        val requestId = greetingPreviewRequestId + 1
        greetingPreviewRequestId = requestId
        scope.launch {
            stopMediaPreview(invalidateGreetingPreview = false)
            playingGreetingVoiceId = profile.id
            runCatching {
                val cached = ensureGreetingCached(clip)
                val player = MediaPlayer.create(context, Uri.parse(cached.localAudioUri))
                    ?: error("Failed to create greeting preview player.")
                if (greetingPreviewRequestId != requestId) {
                    player.release()
                    return@runCatching
                }
                mediaPlayer = player.apply {
                    setOnCompletionListener {
                        it.release()
                        if (mediaPlayer === it) mediaPlayer = null
                        if (playingGreetingVoiceId == profile.id) playingGreetingVoiceId = null
                    }
                    start()
                }
            }.onFailure { error ->
                AlarmTalkLog.reportError("Failed to play greeting preview", error)
                if (greetingPreviewRequestId == requestId) {
                    if (playingGreetingVoiceId == profile.id) playingGreetingVoiceId = null
                    localMessage = userFacingError(error, context.getString(R.string.voices_preview_play_failed))
                }
            }
        }
    }

    // 방금 등록한 목소리로 기본 모닝콜(고정 프리셋)을 즉석 생성해 들려준다. 다시 누르면 정지.
    // random preset 이라 직접 입력 미터링을 소비하지 않고 서버 캐시로 재생성도 저렴하다.
    fun previewRegisteredVoice(voice: VoiceProfile) {
        if (confirmPreviewPlaying) {
            stopMediaPreview(invalidateGreetingPreview = false)
            confirmPreviewPlaying = false
            return
        }
        if (confirmPreviewBusy) return
        confirmPreviewJob = scope.launch {
            stopMediaPreview(invalidateGreetingPreview = false)
            confirmPreviewBusy = true
            runCatching {
                val response = onGenerateTts(
                    TtsGenerateRequest(
                        voiceProfileId = voice.id,
                        category = "morning",
                        language = "ko",
                        random = true,
                        randomContext = "preset",
                        listenerTitle = voice.listenerTitle,
                    ),
                )
                val cached = withContext(Dispatchers.IO) {
                    val bytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
                    audioStore.cacheGeneratedAudio(
                        bytes = bytes,
                        format = response.audioFormat,
                        rawAudioUri = response.audioUrl ?: response.audioObjectKey?.let { "r2://$it" },
                        displayName = "confirm_${voice.id}",
                        cacheKey = "confirm_${response.messageId}",
                        messageId = response.messageId,
                    )
                }
                val player = MediaPlayer.create(context, Uri.parse(cached.localAudioUri))
                    ?: error("Failed to create preview player.")
                mediaPlayer = player.apply {
                    setOnCompletionListener {
                        it.release()
                        if (mediaPlayer === it) {
                            mediaPlayer = null
                            confirmPreviewPlaying = false
                        }
                    }
                    start()
                }
                confirmPreviewPlaying = true
            }.onFailure { error ->
                AlarmTalkLog.reportError("Failed to preview registered voice", error)
                localMessage = userFacingError(error, context.getString(R.string.voices_preview_play_failed))
            }
            confirmPreviewBusy = false
        }
    }

    // 등록이 실제로 시작(busy=true)됐다가 끝(busy=false)나면 새로 생긴 내 목소리를 잡아 확인 창을 연다.
    LaunchedEffect(voiceProfileBusy, voiceProfiles) {
        if (!awaitingRegisteredVoice) return@LaunchedEffect
        if (voiceProfileBusy) {
            sawRegisterBusy = true
            return@LaunchedEffect
        }
        // busy 를 아직 한 번도 못 봤다 = 등록이 아직 시작 전(arm→busy 사이 async gap). 대기.
        if (!sawRegisterBusy) return@LaunchedEffect
        val newVoice = voiceProfiles.firstOrNull {
            it.isSystem != true &&
                !it.id.startsWith("local-pending-") &&
                it.id !in idsBeforeRegister &&
                (it.status == null || it.status == "ready")
        }
        awaitingRegisteredVoice = false
        sawRegisterBusy = false
        if (newVoice != null) confirmNewVoice = newVoice
    }

    fun applySelectedAudio(audio: CachedAlarmAudio) {
        stopMediaPreview()
        selectedAudio = audio
        localMessage = voiceProfileDurationError(context, audio.durationMillis)
    }

    fun prepareSelectedFile(uri: Uri) {
        stopMediaPreview()
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { audioStore.readDurationMillis(uri) }
                    ?: throw IllegalArgumentException(context.getString(R.string.voices_file_duration_unknown))
            }.onSuccess { durationMillis ->
                selectedAudio = null
                selectedFileUri = uri
                selectedFileDurationMillis = durationMillis
                cropStartMillis = 0L
                cropEndMillis = durationMillis.coerceAtMost(VoiceProfileAudioLimits.MAX_DURATION_MILLIS)
                localMessage = voiceProfileFileDurationError(context, durationMillis)
            }
                .onFailure { error ->
                    AlarmTalkLog.reportError("Failed to cache voice profile audio", error)
                    localMessage = userFacingError(error, context.getString(R.string.voices_selected_audio_unusable))
                }
        }
    }

    fun stopRecording() {
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { recorder.stop() }
            }.onSuccess { audio ->
                isRecording = false
                val duration = audio.durationMillis
                val error = voiceProfileDurationError(context, duration)
                if (error == null) {
                    applySelectedAudio(audio)
                } else {
                    // 짧아서 버려진 녹음은 타이머도 0으로 되돌린다 — 지난 시간이 남아 있으면
                    // 저장된 것처럼 보인다.
                    selectedAudio = null
                    recordingElapsedMillis = 0L
                    // 1분 미만 안내는 마이크 카드의 대기 문구("1분 이상 녹음해 주세요")와
                    // 중복이라 대사 밑에 또 띄우지 않는다. 길이 확인 실패 등 다른 원인만 알린다.
                    val tooShort = duration != null && duration < VoiceProfileAudioLimits.MIN_DURATION_MILLIS
                    localMessage = if (tooShort) null else error
                }
            }.onFailure { error ->
                isRecording = false
                AlarmTalkLog.reportError("Failed to stop voice profile recording", error)
                localMessage = userFacingError(error, context.getString(R.string.voices_recording_stop_failed))
            }
        }
    }

    fun startRecording() {
        // 미리듣기(방금 녹음 클립 등)가 재생 중이면 먼저 멈춘다 — 스피커 소리가
        // 새 녹음(클론 원본)에 섞여 들어가는 것을 막는다.
        stopMediaPreview()
        runCatching {
            recorder.start(maxDurationMillis = VoiceProfileAudioLimits.MAX_DURATION_MILLIS)
            recordingElapsedMillis = 0L
            recordingLevel = 0f
            isRecording = true
            localMessage = null
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to start voice profile recording", error)
            localMessage = userFacingError(error, context.getString(R.string.voices_recording_start_failed))
        }
    }

    fun closeCreateDialog() {
        if (recorder.isRecording) recorder.cancel()
        isRecording = false
        recordingElapsedMillis = 0L
        recordingLevel = 0f
        stopMediaPreview()
        selectedFileUri = null
        selectedFileDurationMillis = null
        cropStartMillis = 0L
        cropEndMillis = VoiceProfileAudioLimits.MAX_DURATION_MILLIS
        createPreparing = false
        createSubmitAttempted = false
        profileName = ""
        relationshipSelection = RelationshipSelection()
        profileListenerTitle = ""
        shareVoice = false
        currentStep = VoiceRegistrationStep.Source
        selectedAudio = null
        mediaPlayer?.release()
        mediaPlayer = null
        showCreateForm = false
        localMessage = null
    }

    val pickAudioLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) prepareSelectedFile(uri)
    }
    val recordPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            startRecording()
        } else {
            localMessage = context.getString(R.string.voices_mic_permission_required)
        }
    }

    LaunchedEffect(isRecording) {
        if (isRecording) {
            val startedAt = System.currentTimeMillis()
            while (isRecording) {
                recordingElapsedMillis = (System.currentTimeMillis() - startedAt)
                    .coerceAtMost(VoiceProfileAudioLimits.MAX_DURATION_MILLIS)
                recordingLevel = (recorder.maxAmplitude().toFloat() / 32767f).coerceIn(0f, 1f)
                if (recordingElapsedMillis >= VoiceProfileAudioLimits.MAX_DURATION_MILLIS) {
                    stopRecording()
                    break
                }
                delay(250)
            }
        }
    }

    LaunchedEffect(canShareVoice) {
        if (!canShareVoice) shareVoice = false
    }

    LaunchedEffect(canCreateVoice) {
        if (!canCreateVoice && showCreateForm) {
            closeCreateDialog()
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            if (recorder.isRecording) recorder.cancel()
            stopMediaPreview()
        }
    }

    suspend fun croppedFileAudio(): CachedAlarmAudio {
        val uri = selectedFileUri ?: throw IllegalStateException(context.getString(R.string.voices_select_file_first))
        val cropDurationMillis = (cropEndMillis - cropStartMillis)
            .coerceIn(1_000L, VoiceProfileAudioLimits.MAX_DURATION_MILLIS)
        return withContext(Dispatchers.IO) {
            audioStore.cacheFromUri(
                sourceUri = uri,
                maxDurationMillis = cropDurationMillis,
                startMillis = cropStartMillis,
            )
        }
    }

    // 공유받은 음성에 viewer 라벨을 막 입력했을 때 그 음성을 한 번 들려준다.
    // 같은 입력이면 백엔드 캐시 hit, 처음이면 새로 합성. 둘 다 MediaPlayer 로 재생.
    suspend fun playSharedVoicePreview(profileId: String) {
        runCatching {
            val response = onGenerateTts(
                TtsGenerateRequest(
                    voiceProfileId = profileId,
                    text = context.getString(R.string.r3data_voice_preview_prompt),
                    category = "custom",
                    language = "ko",
                    random = false,
                ),
            )
            val cached = withContext(Dispatchers.IO) {
                // base64 디코딩도 메인 스레드가 아닌 IO 디스패처에서 수행한다.
                val bytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
                audioStore.cacheGeneratedAudio(
                    bytes = bytes,
                    format = response.audioFormat,
                    rawAudioUri = null,
                    displayName = "shared_voice_preview_${profileId}",
                    cacheKey = "shared_preview_${profileId}",
                    messageId = response.messageId,
                )
            }
            stopMediaPreview()
            val player = MediaPlayer.create(context, Uri.parse(cached.localAudioUri))
                ?: return@runCatching
            mediaPlayer = player.apply {
                setOnCompletionListener {
                    it.release()
                    if (mediaPlayer === it) mediaPlayer = null
                }
                start()
            }
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to preview shared voice", error)
            localMessage = userFacingError(error, context.getString(R.string.voices_preview_play_failed))
        }
    }

    fun playFileCropPreview() {
        if (filePreviewPreparing) return
        if (filePreviewPlaying) {
            stopMediaPreview()
            return
        }
        scope.launch {
            filePreviewPreparing = true
            filePreviewPlaying = false
            runCatching {
                croppedFileAudio()
            }.onSuccess { audio ->
                mediaPlayer?.release()
                val player = MediaPlayer.create(context, Uri.parse(audio.localAudioUri))
                if (player == null) {
                    filePreviewPreparing = false
                    localMessage = context.getString(R.string.voices_preview_play_failed)
                    return@onSuccess
                }
                mediaPlayer = player.apply {
                    setOnCompletionListener {
                        it.release()
                        if (mediaPlayer === it) {
                            mediaPlayer = null
                            filePreviewPreparing = false
                            filePreviewPlaying = false
                        }
                    }
                    start()
                }
                filePreviewPreparing = false
                filePreviewPlaying = true
            }.onFailure { error ->
                AlarmTalkLog.reportError("Failed to play cropped voice preview", error)
                filePreviewPreparing = false
                filePreviewPlaying = false
                localMessage = userFacingError(error, context.getString(R.string.voices_preview_play_failed))
            }
        }
    }

    // 방금 녹음한 클립을 들어본다 (녹음 완료 배지의 ▶/⏸ 토글).
    fun playRecordedPreview() {
        if (recordPreviewPlaying) {
            stopMediaPreview()
            return
        }
        val audio = selectedAudio ?: return
        stopMediaPreview()
        runCatching {
            val player = MediaPlayer.create(context, Uri.parse(audio.localAudioUri))
                ?: error("Failed to create recorded preview player.")
            mediaPlayer = player.apply {
                setOnCompletionListener {
                    it.release()
                    // 이전 플레이어의 늦은 completion 이 새 재생 상태를 끄지 않도록 가드.
                    if (mediaPlayer === it) {
                        mediaPlayer = null
                        recordPreviewPlaying = false
                    }
                }
                start()
            }
            recordPreviewPlaying = true
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to play recorded voice preview", error)
            localMessage = userFacingError(error, context.getString(R.string.voices_preview_play_failed))
        }
    }

    // 실제 등록 요청 직전에 호출 — 현재 목소리 id 스냅샷을 찍고 확인창 감지를 켠다.
    // 등록이 끝나(voiceProfileBusy↓) 새 id 가 나타나면 확인창을 연다.
    fun armRegistrationConfirm() {
        idsBeforeRegister = voiceProfiles
            .filter { !it.id.startsWith("local-pending-") }
            .map { it.id }
            .toSet()
        sawRegisterBusy = false
        awaitingRegisteredVoice = true
    }

    fun submitCreateProfile(name: String) {
        createSubmitAttempted = true
        val trimmedName = name.trim()
        val trimmedRelationship = relationshipSelection.resolved
        val trimmedListener = profileListenerTitle.trim()
        if (trimmedName.isBlank()) {
            localMessage = null
            return
        }
        if (trimmedRelationship.isBlank()) {
            localMessage = null
            return
        }
        if (trimmedListener.isBlank()) {
            localMessage = null
            return
        }
        if (!canCreateVoice) {
            localMessage = paidVoiceRequiredMessage
            return
        }
        if (createPreparing) return
        if (inputMode == VoiceCaptureMode.Record) {
            val audio = selectedAudio ?: run {
                localMessage = context.getString(R.string.voices_prepare_recording_first)
                return
            }
            if (voiceProfileDurationError(context, audio.durationMillis) != null) return
            // 검증을 다 통과해 실제로 등록을 보낼 때만 확인창 감지를 무장한다(중단/검증실패 후
            // 스냅샷이 남아 엉뚱한 목소리에 확인창이 뜨는 것을 막는다).
            armRegistrationConfirm()
            onCreateVoiceProfile(
                trimmedName,
                audio,
                shareVoice,
                trimmedRelationship,
                trimmedListener,
            )
            closeCreateDialog()
            return
        }
        scope.launch {
            createPreparing = true
            localMessage = null
            runCatching {
                croppedFileAudio()
            }.onSuccess { audio ->
                val error = voiceProfileCropDurationError(context, audio.durationMillis)
                if (error != null) {
                    localMessage = error
                } else {
                    armRegistrationConfirm()
                    onCreateVoiceProfile(
                        trimmedName,
                        audio,
                        shareVoice,
                        trimmedRelationship,
                        trimmedListener,
                    )
                    closeCreateDialog()
                }
            }.onFailure { error ->
                AlarmTalkLog.reportError("Failed to prepare selected voice file", error)
                localMessage = userFacingError(error, context.getString(R.string.voices_prepare_selected_failed))
            }
            createPreparing = false
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(R.string.voices_my_voices_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Button(
                onClick = {
                    if (canOpenCreateForm) showCreateForm = true
                },
                enabled = canOpenCreateForm,
            ) {
                Text(stringResource(R.string.voices_add))
            }
        }

        if (localMessage != null && !showCreateForm && localMessage != paidVoiceRequiredMessage) {
            MutedText(localMessage.orEmpty())
        }

        if (ownVoices.isEmpty() && canCreateVoice) {
            MutedText(stringResource(R.string.voices_no_voices_yet))
        } else if (ownVoices.isNotEmpty()) {
            ownVoices.forEach { profile ->
                VoiceProfileRow(
                    profile = profile,
                    enabled = !voiceProfileBusy,
                    canShareVoice = canShareVoice,
                    onRename = {
                        renameTarget = profile
                        renameName = profile.name
                        renameRelationship = profile.relationshipLabel.orEmpty()
                        renameListenerTitle = profile.listenerTitle.orEmpty()
                        renameSubmitAttempted = false
                    },
                    onShareChange = { shared -> onShareVoiceProfile(profile.id, shared) },
                    onDelete = { deleteTarget = profile },
                )
            }
        }

        if (systemVoices.isNotEmpty()) {
            Row(
                // 토스식 [제목 … 값 + 셰브론] 행 — 탭하면 기본 목소리 선택 시트를 연다.
                // 눌림 리플(indication) 없이 조용히 동작.
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) {
                        // 이전 화면 흐름의 안내가 시트 안에 엉뚱하게 보이지 않게 비우고 연다.
                        localMessage = null
                        prefetchGreetingPreviews()
                        defaultVoiceSheetOpen = true
                    }
                    .padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(R.string.voices_default_voice_row_title),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        // 정해진 기본 목소리 이름이 값. 아직 없으면 '선택하기'로 행동을 유도한다.
                        text = systemVoices.firstOrNull { it.id == defaultVoiceId }?.name
                            ?: stringResource(R.string.voices_default_voice_choose),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Icon(
                        imageVector = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            // 기본(시스템) 목소리는 별도 호칭 없이 계정 닉네임으로 부른다
            // (AlarmEditorScreen.resolvedVoiceListenerTitle). 관계·호칭은 내/공유 목소리에만 있다.
        }

        if (canShareVoice && familyVoices.isNotEmpty()) {
            Text(
                text = stringResource(R.string.voices_shared_voices_title),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            familyVoices.forEach { profile ->
                SharedVoiceProfileRow(
                    profile = profile,
                    onEdit = { sharedInfoTarget = profile },
                )
            }
        }
    }

    if (voicePlanGateOpen) {
        PlanGateDialog(
            title = stringResource(R.string.voices_create_paid_title),
            message = stringResource(R.string.voices_create_paid_notice),
            onConfirm = {
                voicePlanGateOpen = false
                onOpenBilling()
            },
            onDismiss = { voicePlanGateOpen = false },
        )
    }

    // 시트가 열린 채 시스템 보이스 목록이 비면(세션 초기화·재로딩) 재생을 멈추고 시트를 정리한다.
    LaunchedEffect(systemVoices.isEmpty()) {
        if (systemVoices.isEmpty() && defaultVoiceSheetOpen) {
            stopMediaPreview()
            defaultVoiceSheetOpen = false
        }
    }

    if (defaultVoiceSheetOpen && systemVoices.isNotEmpty()) {
        // 다른 선택 시트와 달리 탭해도 닫지 않는다 — 탭 = 선택 + 인사말 미리듣기(재탭 시 정지)라
        // 여러 목소리를 이어 들어보며 고르는 흐름. 닫기는 드래그/스크림.
        WakerSelectionSheet(
            title = stringResource(R.string.voices_default_voice_row_title),
            onDismiss = {
                stopMediaPreview()
                defaultVoiceSheetOpen = false
            },
        ) { _ ->
            systemVoices.forEach { profile ->
                WakerSheetOptionRow(
                    title = profile.name,
                    selected = profile.id == defaultVoiceId,
                    onClick = {
                        onSetDefaultVoice(profile.id)
                        playGreeting(profile)
                    },
                    trailing = if (playingGreetingVoiceId == profile.id) {
                        { PlayingEqualizer() }
                    } else {
                        null
                    },
                )
            }
            // 미리듣기 준비중/실패 안내 — 패널 본문의 MutedText 는 시트 스크림에 가려지므로
            // 시트가 열려 있는 동안엔 여기서 보여준다(열 때 localMessage 를 비워 회귀 방지).
            if (localMessage != null) {
                MutedText(localMessage.orEmpty())
            }
        }
    }

    if (showCreateForm && !isLimitReached && canCreateVoice) {
        val useManualSystemInsets = Build.VERSION.SDK_INT >= 35
        val actionBottomPadding = 10.dp + if (useManualSystemInsets) {
            androidNavigationBarHeightPadding() + AndroidEdgeToEdgeNavigationExtraPadding
        } else {
            0.dp
        }
        val dialogSurfaceModifier = if (useManualSystemInsets) {
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
        } else {
            Modifier.fillMaxSize()
        }
        val resolvedProfileName = profileName.trim()
        val resolvedRelationship = relationshipSelection.resolved
        val resolvedListener = profileListenerTitle.trim()
        val nameRequiredError = createSubmitAttempted && resolvedProfileName.isBlank()
        val relationshipRequiredError = createSubmitAttempted && resolvedRelationship.isBlank()
        val listenerRequiredError = createSubmitAttempted && resolvedListener.isBlank()
        // 1분 미만이면 "다음" 으로 넘어가지 못하게 막는다. 녹음은 selectedAudio 길이,
        // 파일은 실제 업로드되는 crop 구간 길이로 판정(백엔드 MIN_UPLOAD_DURATION_MS 와 동일 기준).
        val canSubmitRecord = inputMode == VoiceCaptureMode.Record &&
            (selectedAudio?.durationMillis ?: 0L) >= VoiceProfileAudioLimits.MIN_DURATION_MILLIS
        val canSubmitSingleFile = inputMode == VoiceCaptureMode.File &&
            selectedFileUri != null &&
            (cropEndMillis - cropStartMillis) >= VoiceProfileAudioLimits.MIN_DURATION_MILLIS
        Dialog(
            onDismissRequest = {
                if (!voiceProfileBusy) closeCreateDialog()
            },
            properties = DialogProperties(
                usePlatformDefaultWidth = false,
                decorFitsSystemWindows = !useManualSystemInsets,
            ),
        ) {
            Surface(
                modifier = dialogSurfaceModifier,
                color = MaterialTheme.colorScheme.background,
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .imePadding(),
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp, vertical = 18.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = stringResource(R.string.voices_create_dialog_title),
                            modifier = Modifier.weight(1f),
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                        )
                        IconButton(
                            onClick = { voiceGuideVisible = true },
                            modifier = Modifier.size(42.dp),
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Outlined.HelpOutline,
                                contentDescription = stringResource(R.string.voices_usage_guide),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        IconButton(
                            onClick = ::closeCreateDialog,
                            enabled = !voiceProfileBusy,
                            modifier = Modifier.size(42.dp),
                        ) {
                            Icon(Icons.Outlined.Close, contentDescription = stringResource(R.string.voices_close))
                        }
                    }

                    // 녹음 모드(첫 스텝)는 대사 카드가 남은 화면 높이를 채우고 카드 안에서만
                    // 스크롤하므로 페이지 스크롤을 끈다. 파일 모드·다른 스텝은 콘텐츠가
                    // 길어질 수 있어 기존 페이지 스크롤을 유지한다.
                    // 분할 화면·팝업 뷰처럼 창이 짧으면 잔여 높이가 대사 카드를 못 담아
                    // 슬리버가 되므로, 그 경우도 페이지 스크롤 + 카드 높이 캡으로 폴백한다.
                    val scriptFillsRemainingHeight = currentStep == VoiceRegistrationStep.Source &&
                        inputMode == VoiceCaptureMode.Record &&
                        LocalConfiguration.current.screenHeightDp >= 560
                    val contentScrollState = rememberScrollState()
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .then(
                                if (scriptFillsRemainingHeight) {
                                    Modifier
                                } else {
                                    Modifier.verticalScroll(contentScrollState)
                                },
                            )
                            .padding(horizontal = 20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        when (currentStep) {
                            VoiceRegistrationStep.Source -> {
                                VoiceCaptureModeSelector(
                                    selected = inputMode,
                                    enabled = !isRecording && !createPreparing,
                                    onSelect = {
                                        if (inputMode != it) {
                                            stopMediaPreview()
                                            localMessage = null
                                        }
                                        inputMode = it
                                    },
                                )

                                if (inputMode == VoiceCaptureMode.Record) {
                                    // 녹음 카드를 위에 — 대사를 읽는 동안에도 시간/버튼이 보인다.
                                    VoiceRecordControls(
                                        isRecording = isRecording,
                                        elapsedMillis = recordingElapsedMillis,
                                        maxDurationMillis = VoiceProfileAudioLimits.MAX_DURATION_MILLIS,
                                        level = recordingLevel,
                                        enabled = !voiceProfileBusy && !createPreparing,
                                        // 마이크 버튼이 행동을 설명하므로 "눌러서 녹음 시작" 대신
                                        // 이 흐름의 핵심 제약(최소 1분)을 대기 상태 문구로 쓴다.
                                        idleStatusText = stringResource(R.string.voices_record_status_min_duration),
                                        onRecordClick = {
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
                                        recordedDurationMillis = selectedAudio?.durationMillis,
                                        isRecordedPreviewActive = recordPreviewPlaying,
                                        onPreviewRecording = ::playRecordedPreview,
                                    )
                                    // 남은 화면 높이를 대사 카드가 채운다(내용이 짧으면 그만큼만).
                                    // 짧은 창 폴백에선 페이지가 스크롤되므로 weight 대신 높이 캡.
                                    VoiceRecordScriptCard(
                                        fillHeight = scriptFillsRemainingHeight,
                                        modifier = if (scriptFillsRemainingHeight) {
                                            Modifier.weight(1f, fill = false)
                                        } else {
                                            Modifier
                                        },
                                    )
                                } else {
                                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                        VoiceFileControls(
                                            durationMillis = selectedFileDurationMillis,
                                            cropStartMillis = cropStartMillis,
                                            cropEndMillis = cropEndMillis,
                                            minDurationMillis = VoiceProfileAudioLimits.MIN_DURATION_MILLIS,
                                            maxDurationMillis = VoiceProfileAudioLimits.MAX_DURATION_MILLIS,
                                            enabled = !voiceProfileBusy && !isRecording && !createPreparing,
                                            uploadLabel = stringResource(R.string.voices_upload_file_or_video),
                                            notice = stringResource(R.string.voices_crop_duration_notice),
                                            noticeAfterUpload = true,
                                            uploadSubtitle = stringResource(R.string.voices_upload_zone_subtitle),
                                            isPreviewActive = filePreviewPlaying,
                                            isPreviewPreparing = filePreviewPreparing,
                                            onPickFile = { pickAudioLauncher.launch(arrayOf("audio/*", "video/*")) },
                                            onCropChange = { start, end ->
                                                if (start != cropStartMillis || end != cropEndMillis) {
                                                    stopMediaPreview()
                                                    cropStartMillis = start
                                                    cropEndMillis = end
                                                }
                                            },
                                            onPreviewCrop = { playFileCropPreview() },
                                        )
                                        // 여러 명이 섞인 오디오는 클론 품질이 떨어진다 — 파일을 고르면
                                        // 한 사람 목소리만 넣도록 안내한다.
                                        if (selectedFileDurationMillis != null) {
                                            MutedText(stringResource(R.string.voices_single_speaker_hint))
                                        }
                                    }
                                }
                            }

                            VoiceRegistrationStep.Details -> {
                                OutlinedTextField(
                                    value = profileName,
                                    onValueChange = { profileName = it.take(50) },
                                    label = { Text(stringResource(R.string.voices_name_label)) },
                                    placeholder = { Text(stringResource(R.string.voices_name_placeholder)) },
                                    singleLine = true,
                                    isError = nameRequiredError,
                                    supportingText = {
                                        if (nameRequiredError) Text(stringResource(R.string.voices_required_field))
                                    },
                                    shape = WakerInputShape,
                                    colors = wakerOutlinedTextFieldColors(),
                                    modifier = Modifier.fillMaxWidth(),
                                )
                                RelationshipDropdownField(
                                    selection = relationshipSelection,
                                    onSelectionChange = { relationshipSelection = it },
                                    isError = relationshipRequiredError,
                                )
                                OutlinedTextField(
                                    value = profileListenerTitle,
                                    onValueChange = { profileListenerTitle = it.take(30) },
                                    label = { Text(stringResource(R.string.voices_listener_title_label)) },
                                    placeholder = { Text(stringResource(R.string.voices_listener_title_placeholder)) },
                                    singleLine = true,
                                    isError = listenerRequiredError,
                                    supportingText = {
                                        if (listenerRequiredError) {
                                            Text(stringResource(R.string.voices_required_field))
                                        } else {
                                            Text(stringResource(R.string.voices_listener_title_hint))
                                        }
                                    },
                                    shape = WakerInputShape,
                                    colors = wakerOutlinedTextFieldColors(),
                                    modifier = Modifier.fillMaxWidth(),
                                )
                                // 공유 설정 — 토글 하나뿐이라 단독 단계를 없애고 세부 정보에 합쳤다.
                                Text(
                                    text = stringResource(R.string.voices_step_sharing),
                                    style = MaterialTheme.typography.titleSmall,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.padding(top = 4.dp),
                                )
                                ShareVoiceToggleCard(
                                    enabled = canShareVoice,
                                    checked = shareVoice && canShareVoice,
                                    title = stringResource(R.string.voices_sharing_shared_title),
                                    description = if (canShareVoice) {
                                        stringResource(R.string.voices_sharing_shared_desc_enabled)
                                    } else {
                                        stringResource(R.string.voices_sharing_shared_desc_disabled)
                                    },
                                    onCheckedChange = { shareVoice = it },
                                )
                            }
                        }

                        if (createPreparing) {
                            VoiceProgressMessage(stringResource(R.string.voices_preparing_audio))
                        }
                        if (localMessage != null) {
                            MutedText(localMessage.orEmpty())
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                    }

                    val canAdvanceFromSource = !voiceProfileBusy && !isRecording && !createPreparing &&
                        (canSubmitRecord || canSubmitSingleFile)
                    val identityComplete = profileName.trim().isNotBlank() &&
                        relationshipSelection.isComplete &&
                        profileListenerTitle.trim().isNotBlank()
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(
                                start = 16.dp,
                                top = 10.dp,
                                end = 16.dp,
                                bottom = actionBottomPadding,
                            ),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (currentStep != VoiceRegistrationStep.Source) {
                            OutlinedButton(
                                onClick = {
                                    currentStep = VoiceRegistrationStep.Source
                                    createSubmitAttempted = false
                                    localMessage = null
                                },
                                enabled = !voiceProfileBusy && !createPreparing,
                                modifier = Modifier.weight(1f),
                                shape = WakerButtonShape,
                                border = wakerCardBorder(),
                                colors = wakerOutlinedButtonColors(),
                            ) {
                                Icon(
                                    imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp),
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(stringResource(R.string.voices_previous))
                            }
                        }
                        when (currentStep) {
                            VoiceRegistrationStep.Source -> {
                                Button(
                                    onClick = {
                                        localMessage = null
                                        currentStep = VoiceRegistrationStep.Details
                                    },
                                    enabled = canAdvanceFromSource,
                                    modifier = Modifier.weight(1f),
                                    shape = WakerButtonShape,
                                ) {
                                    Text(
                                        if (createPreparing) {
                                            stringResource(R.string.voices_preparing)
                                        } else {
                                            stringResource(R.string.voices_next)
                                        },
                                    )
                                }
                            }

                            VoiceRegistrationStep.Details -> {
                                Button(
                                    onClick = {
                                        createSubmitAttempted = true
                                        if (identityComplete) {
                                            localMessage = null
                                            createSubmitAttempted = false
                                            submitCreateProfile(resolvedProfileName)
                                        }
                                    },
                                    enabled = !voiceProfileBusy && !isRecording && !createPreparing &&
                                        (canSubmitRecord || canSubmitSingleFile),
                                    modifier = Modifier.weight(1f),
                                    shape = WakerButtonShape,
                                ) {
                                    Text(
                                        if (createPreparing) {
                                            stringResource(R.string.voices_preparing)
                                        } else {
                                            stringResource(R.string.voices_register)
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (voiceGuideVisible) {
        UsageGuideDialog(
            steps = voiceCreateGuideSteps,
            onFinish = {
                usageGuideStore.markSeen(UsageGuideStore.GUIDE_VOICE_CREATE)
                voiceGuideVisible = false
            },
        )
    }

    // 등록 직후 확인 창 — 이 목소리로 아침을 깨워줄지 미리 듣고 유지/삭제를 고른다.
    confirmNewVoice?.let { voice ->
        fun closeConfirm() {
            // 생성 중인 미리듣기 코루틴을 취소해, 닫은 뒤(또는 삭제한 목소리로) 오디오가
            // 뒤늦게 재생되는 것을 막는다.
            confirmPreviewJob?.cancel()
            confirmPreviewJob = null
            stopMediaPreview(invalidateGreetingPreview = false)
            confirmPreviewBusy = false
            confirmPreviewPlaying = false
            confirmNewVoice = null
        }
        AlertDialog(
            onDismissRequest = { closeConfirm() },
            shape = WakerDialogShape,
            title = { Text(stringResource(R.string.voices_confirm_new_title, voice.name)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = stringResource(R.string.voices_confirm_new_body),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    OutlinedButton(
                        onClick = { previewRegisteredVoice(voice) },
                        enabled = !confirmPreviewBusy,
                        shape = WakerButtonShape,
                        colors = wakerOutlinedButtonColors(),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            when {
                                confirmPreviewBusy -> stringResource(R.string.voices_confirm_new_preview_loading)
                                confirmPreviewPlaying -> stringResource(R.string.voices_confirm_new_preview_stop)
                                else -> stringResource(R.string.voices_confirm_new_preview)
                            },
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { closeConfirm() }) {
                    Text(stringResource(R.string.voices_confirm_new_keep))
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        onDeleteVoiceProfile(voice.id)
                        closeConfirm()
                    },
                ) {
                    Text(
                        text = stringResource(R.string.voices_confirm_new_delete),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            },
        )
    }

    renameTarget?.let { profile ->
        val resolvedRenameName = renameName.trim()
        val resolvedRenameRelationship = renameRelationship.trim()
        val resolvedRenameListener = renameListenerTitle.trim()
        val renameNameError = renameSubmitAttempted && resolvedRenameName.isBlank()
        val renameRelationshipError = renameSubmitAttempted && resolvedRenameRelationship.isBlank()
        val renameListenerError = renameSubmitAttempted && resolvedRenameListener.isBlank()
        VoiceProfileEditDialog(
            title = stringResource(R.string.voices_edit_info_title),
            description = stringResource(R.string.voices_edit_info_desc),
            name = renameName,
            relationship = renameRelationship,
            listenerTitle = renameListenerTitle,
            nameError = renameNameError,
            relationshipError = renameRelationshipError,
            listenerError = renameListenerError,
            onNameChange = { renameName = it.take(50) },
            onRelationshipChange = { renameRelationship = it.take(30) },
            onListenerTitleChange = { renameListenerTitle = it.take(30) },
            onDismiss = { renameTarget = null },
            onConfirm = {
                renameSubmitAttempted = true
                if (
                    resolvedRenameName.isNotBlank() &&
                    resolvedRenameRelationship.isNotBlank() &&
                    resolvedRenameListener.isNotBlank()
                ) {
                    onRenameVoiceProfile(
                        profile.id,
                        resolvedRenameName,
                        resolvedRenameRelationship,
                        resolvedRenameListener,
                    )
                    renameTarget = null
                }
            },
        )
    }

    sharedInfoTarget?.let { profile ->
        SharedVoiceViewerInfoDialog(
            profileName = profile.name,
            sharedFromLabel = profile.ownerName?.takeIf { it.isNotBlank() }
                ?.let { stringResource(R.string.voices_shared_from_owner, it) }
                ?: stringResource(R.string.voices_shared_from_unknown),
            initialRelationship = profile.relationshipLabel.orEmpty(),
            initialListenerTitle = profile.listenerTitle.orEmpty(),
            onDismiss = { sharedInfoTarget = null },
            onConfirm = { relationship, listener ->
                onUpdateSharedVoiceInfo(profile.id, relationship, listener)
                sharedInfoTarget = null
                scope.launch { playSharedVoicePreview(profile.id) }
            },
        )
    }

    deleteTarget?.let { profile ->
        VoiceProfileDeleteDialog(
            profileName = profile.name,
            onDismiss = { deleteTarget = null },
            onDelete = {
                onDeleteVoiceProfile(profile.id)
                deleteTarget = null
            },
        )
    }
}

