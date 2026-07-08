package com.alarmtalk.app

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
import com.alarmtalk.app.data.VoiceProfilePromotionDraft
import com.alarmtalk.app.network.apiErrorCode
import com.alarmtalk.app.network.AuthSession
import com.alarmtalk.app.network.BillingSubscriptionResponse
import com.alarmtalk.app.network.FamilyGroupCurrentResponse
import com.alarmtalk.app.network.FamilyVoiceProfile
import com.alarmtalk.app.network.TtsGenerateRequest
import com.alarmtalk.app.network.TtsGenerateResponse
import com.alarmtalk.app.network.VoiceProfile
import com.alarmtalk.app.network.VoiceSpeakerSegment
import com.alarmtalk.app.ui.guide.UsageGuideDialog
import com.alarmtalk.app.ui.guide.UsageGuideStep
import com.alarmtalk.app.ui.guide.UsageGuideStore
import android.util.Base64
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private fun voiceProfilePlaceholder(context: android.content.Context): String =
    context.getString(R.string.voices2_default_profile_name)

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

// 목소리 성별 선택 칩(남성/여성/중립). 일본어 1인칭·말투 자연성을 위해 생성 시 함께 전송한다.
@Composable
private fun VoiceGenderSelector(
    selected: String,
    onSelect: (String) -> Unit,
) {
    val options = listOf(
        "male" to stringResource(R.string.voices_voice_gender_male),
        "female" to stringResource(R.string.voices_voice_gender_female),
        "neutral" to stringResource(R.string.voices_voice_gender_neutral),
    )
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = stringResource(R.string.voices_voice_gender_label),
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEach { (value, label) ->
                Surface(
                    onClick = { onSelect(value) },
                    modifier = Modifier.weight(1f),
                    shape = WakerChipShape,
                    color = if (selected == value) {
                        MaterialTheme.colorScheme.secondaryContainer
                    } else {
                        MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)
                    },
                ) {
                    Text(
                        text = label,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 11.dp),
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center,
                        color = if (selected == value) {
                            MaterialTheme.colorScheme.onSecondaryContainer
                        } else {
                            MaterialTheme.colorScheme.onSurface
                        },
                    )
                }
            }
        }
    }
}

// 일본어 정중체(です·ます) 토글. 켜면 speech_formality='polite', 끄면 'auto' 로 전송.
@Composable
private fun JapanesePoliteToggle(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = WakerChipShape,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(
                    text = stringResource(R.string.voices_speech_formality_label),
                    fontWeight = FontWeight.SemiBold,
                )
                MutedText(stringResource(R.string.voices_speech_formality_hint))
            }
            Spacer(Modifier.width(12.dp))
            AlarmTalkSwitch(
                checked = checked,
                onCheckedChange = onCheckedChange,
            )
        }
    }
}

@Composable
internal fun VoiceLoginRequiredCard() {
    OutlinedCard {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = stringResource(R.string.voices_login_required_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            MutedText(stringResource(R.string.voices_login_required_body))
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
    onCreateVoiceProfile: (String, CachedAlarmAudio, Boolean, String, String, String, String) -> Unit,
    onCreateVoiceProfiles: (List<VoiceProfileCreationDraft>) -> Unit,
    onSeparateVoiceSpeakers: suspend (CachedAlarmAudio) -> List<VoiceSpeakerSegment>,
    onCloneSpeakerDraft: suspend (String, CachedAlarmAudio) -> VoiceProfile,
    onPromoteDraftVoice: suspend (String, VoiceProfilePromotionDraft) -> Unit,
    onDeleteDraftVoice: (String) -> Unit,
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
    // 목소리 성별('male'|'female'|'neutral')과 일본어 정중체(speech_formality 'polite'|'auto') 선택.
    var voiceGender by remember { mutableStateOf("neutral") }
    var japanesePolite by remember { mutableStateOf(false) }
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
    var detectedSpeakers by remember { mutableStateOf<List<VoiceSpeakerSegment>>(emptyList()) }
    var speakerDraftStates by remember { mutableStateOf<Map<String, SpeakerDraftState>>(emptyMap()) }
    var selectedSpeakerDraftId by remember { mutableStateOf<String?>(null) }
    // 진행 중인 prepareSpeakerDraft 코루틴을 화자 id 별로 추적해
    // 선택/정리 시 다른 draft 작업이 cleanup 과 동시에 진행되지 않도록 한다.
    val speakerDraftJobs = remember { mutableMapOf<String, Job>() }
    var activePlayingSpeakerId by remember { mutableStateOf<String?>(null) }
    var separatingBusy by remember { mutableStateOf(false) }
    var promotingBusy by remember { mutableStateOf(false) }
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
                detectedSpeakers = emptyList()
                speakerDraftStates = emptyMap()
                selectedSpeakerDraftId = null
                activePlayingSpeakerId = null
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

    fun cleanupDraftsAsync(draftIds: Collection<String>) {
        if (draftIds.isEmpty()) return
        // onDeleteDraftVoice 는 viewModelScope 에서 fire-and-forget 로 삭제하므로(패널 수명과
        // 무관), 패널이 사라져도 미선택 draft 삭제가 끝까지 진행된다.
        draftIds.forEach { draftId -> onDeleteDraftVoice(draftId) }
    }

    /**
     * 진행 중인 화자 draft 준비 Job 들을 취소하고, 인자로 받은 화자 id 는 제외한다.
     * select 시점에 다른 draft 의 clone/synthesize 가 promote 와 동시에 진행되는 race 를 막는다.
     */
    fun cancelOtherSpeakerDraftJobs(keepSpeakerId: String?) {
        val toCancel = speakerDraftJobs.entries
            .filter { (id, _) -> id != keepSpeakerId }
            .toList()
        toCancel.forEach { (id, job) ->
            runCatching { job.cancel() }
            speakerDraftJobs.remove(id)
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
        detectedSpeakers = emptyList()
        // 다이얼로그 닫힐 때 현재 화면에 남은 draft 가 있으면 모두 삭제 (선택되지 않은 채 닫힘)
        // 진행 중인 prepare Job 도 취소해 닫힌 뒤 server 호출이 이어지지 않게 한다.
        cancelOtherSpeakerDraftJobs(keepSpeakerId = null)
        cleanupDraftsAsync(speakerDraftStates.values.mapNotNull { it.profileId })
        speakerDraftStates = emptyMap()
        selectedSpeakerDraftId = null
        activePlayingSpeakerId = null
        separatingBusy = false
        promotingBusy = false
        createPreparing = false
        createSubmitAttempted = false
        profileName = ""
        relationshipSelection = RelationshipSelection()
        profileListenerTitle = ""
        voiceGender = "neutral"
        japanesePolite = false
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
            // 패널이 사라질 때(탭 이탈 등) 선택되지 않은 채 남은 draft 는 서버에서도 삭제한다.
            // 단, 등록(promote) 진행 중에는 곧 승격될 보이스를 지우지 않도록 건드리지 않는다.
            if (!promotingBusy) {
                cancelOtherSpeakerDraftJobs(keepSpeakerId = null)
                cleanupDraftsAsync(speakerDraftStates.values.mapNotNull { it.profileId })
            }
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

    // 화자 draft 상태는 '그 화자가 아직 유효 대상일 때'만 갱신한다 — select/reset 이 맵을 이미
    // 단일 항목으로 줄였는데 취소·실패한 형제 job 이 뒤늦게 재개해 자기 항목을 되살리는 것을 막는다.
    fun updateSpeakerDraftIfPresent(speakerId: String, transform: (SpeakerDraftState) -> SpeakerDraftState) {
        val current = speakerDraftStates[speakerId] ?: return
        speakerDraftStates = speakerDraftStates.toMutableMap().also { it[speakerId] = transform(current) }
    }

    suspend fun prepareSpeakerDraft(
        speaker: VoiceSpeakerSegment,
        baseName: String,
        croppedUri: Uri,
    ) {
        // 이 화자의 발화 구간만(diarize 대상인 크롭 클립 기준 0시작) 이어붙여, 그 화자
        // 목소리만으로 클론 소스를 만든다 — 구간 사이의 다른 화자/침묵은 버린다.
        val segments = speaker.segments.orEmpty()
            .map { it.startMs to it.endMs }
            .filter { (start, end) -> end > start }
        // 서버에 실제로 만든 draft id — 취소되면 이 draft 를 스스로 삭제해 고아를 남기지 않는다.
        var createdProfileId: String? = null
        try {
            val audio = withContext(Dispatchers.IO) {
                audioStore.cacheFromUriSegments(
                    sourceUri = croppedUri,
                    segments = segments,
                    maxDurationMillis = VoiceProfileAudioLimits.MAX_DURATION_MILLIS,
                )
            }
            val draftName = baseName.ifBlank { voiceProfilePlaceholder(context) }
            val profile = onCloneSpeakerDraft(draftName, audio)
            createdProfileId = profile.id
            updateSpeakerDraftIfPresent(speaker.id) {
                it.copy(profileId = profile.id, status = SpeakerDraftStatus.Synthesizing)
            }
            val ttsResponse = onGenerateTts(
                TtsGenerateRequest(
                    voiceProfileId = profile.id,
                    text = context.getString(R.string.r3data_voice_preview_prompt),
                    category = "custom",
                    language = "ko",
                    random = false,
                ),
            )
            val cached = withContext(Dispatchers.IO) {
                // base64 디코딩도 메인 스레드가 아닌 IO 디스패처에서 수행한다.
                val audioBytes = Base64.decode(ttsResponse.audioBase64, Base64.DEFAULT)
                audioStore.cacheGeneratedAudio(
                    bytes = audioBytes,
                    format = ttsResponse.audioFormat,
                    rawAudioUri = null,
                    displayName = "speaker_preview_${profile.id}",
                    cacheKey = "draft_preview_${profile.id}",
                    messageId = ttsResponse.messageId,
                )
            }
            updateSpeakerDraftIfPresent(speaker.id) {
                it.copy(
                    profileId = profile.id,
                    previewUri = cached.localAudioUri,
                    status = SpeakerDraftStatus.Ready,
                )
            }
        } catch (cancel: CancellationException) {
            // 취소(다른 화자 선택/리셋/닫기)는 '실패'로 기록하지 않는다. 다만 이미 서버 draft 를
            // 만든 뒤라면 그 draft 를 스스로 삭제해 추적 불가 고아로 남지 않게 한다(삭제는
            // viewModelScope 라 취소와 무관하게 끝까지 진행). 그 뒤 취소를 그대로 전파한다.
            createdProfileId?.let { onDeleteDraftVoice(it) }
            throw cancel
        } catch (error: Throwable) {
            AlarmTalkLog.reportError("Failed to prepare speaker draft id=${speaker.id}", error)
            updateSpeakerDraftIfPresent(speaker.id) {
                it.copy(
                    status = SpeakerDraftStatus.Failed,
                    errorMessage = context.getString(R.string.voices_speaker_preview_prepare_failed),
                )
            }
        }
    }

    fun separateSpeakers() {
        if (!canCreateVoice) {
            localMessage = paidVoiceRequiredMessage
            return
        }
        if (selectedFileUri == null) return
        val cropDuration = cropEndMillis - cropStartMillis
        if (cropDuration < VoiceProfileAudioLimits.MIN_DURATION_MILLIS) {
            localMessage = context.getString(R.string.voices_separate_segment_too_short_hint)
            return
        }
        if (cropDuration > VoiceProfileAudioLimits.MAX_DURATION_MILLIS) {
            localMessage = context.getString(R.string.voices_separate_segment_too_long_hint)
            return
        }
        scope.launch {
            separatingBusy = true
            localMessage = null
            detectedSpeakers = emptyList()
            // 기존에 만들어둔 draft 가 있으면 먼저 정리.
            cleanupDraftsAsync(speakerDraftStates.values.mapNotNull { it.profileId })
            speakerDraftStates = emptyMap()
            selectedSpeakerDraftId = null
            activePlayingSpeakerId = null
            runCatching {
                val cropped = croppedFileAudio()
                cropped to onSeparateVoiceSpeakers(cropped)
            }.onSuccess { (cropped, speakers) ->
                // 화자 세그먼트는 업로드된 '크롭 클립' 기준(0시작)이므로, 잘라 붙일 때도 원본이
                // 아니라 그 크롭 클립에서 잘라야 좌표가 정확히 맞는다(스냅 드리프트 없음).
                val croppedUri = Uri.parse(cropped.localAudioUri)
                val visible = speakers.filter { !it.segments.isNullOrEmpty() }.take(3)
                detectedSpeakers = visible
                speakerDraftStates = visible.associate { s ->
                    s.id to SpeakerDraftState(status = SpeakerDraftStatus.Cloning)
                }
                localMessage = if (visible.isEmpty()) context.getString(R.string.voices_no_speakers_found) else null
                val baseName = profileName.trim()
                // 기존 추적 중인 Job 이 있다면 새 separate 가 일어났으므로 모두 취소.
                cancelOtherSpeakerDraftJobs(keepSpeakerId = null)
                visible.forEach { speaker ->
                    val job = scope.launch {
                        try {
                            prepareSpeakerDraft(speaker, baseName, croppedUri)
                        } finally {
                            // 자신이 등록한 Job 만 정리.
                            if (speakerDraftJobs[speaker.id] === coroutineContext[Job]) {
                                speakerDraftJobs.remove(speaker.id)
                            }
                        }
                    }
                    speakerDraftJobs[speaker.id] = job
                }
            }.onFailure { error ->
                AlarmTalkLog.reportError("Failed to separate speakers", error)
                val code = apiErrorCode(error)
                localMessage = when (code) {
                    "AUDIO_DURATION_TOO_SHORT" -> context.getString(R.string.voices_separate_segment_too_short)
                    "AUDIO_DURATION_TOO_LONG" -> context.getString(R.string.voices_separate_segment_too_long)
                    "AUDIO_FILE_EMPTY" -> context.getString(R.string.voices_audio_file_empty)
                    "INVALID_DURATION" -> context.getString(R.string.voices_invalid_duration)
                    "INVALID_AUDIO_MIME_TYPE" -> context.getString(R.string.voices_unsupported_audio_format)
                    "VOICE_FEATURE_REQUIRES_PAID_PLAN" -> context.getString(R.string.voices_separate_requires_paid)
                    else -> context.getString(R.string.voices_separate_failed)
                }
            }
            separatingBusy = false
        }
    }

    fun resetSpeakers() {
        // cleanup 보다 먼저 진행 중인 draft Job 을 취소해 cleanup 과 동시 진행을 막는다.
        cancelOtherSpeakerDraftJobs(keepSpeakerId = null)
        cleanupDraftsAsync(speakerDraftStates.values.mapNotNull { it.profileId })
        detectedSpeakers = emptyList()
        speakerDraftStates = emptyMap()
        selectedSpeakerDraftId = null
        activePlayingSpeakerId = null
        stopMediaPreview()
        localMessage = null
    }

    fun playSpeakerDraftPreview(speaker: VoiceSpeakerSegment) {
        val state = speakerDraftStates[speaker.id] ?: return
        val previewUri = state.previewUri ?: return
        // 이미 같은 화자가 재생 중이면 정지
        if (activePlayingSpeakerId == speaker.id) {
            stopMediaPreview()
            activePlayingSpeakerId = null
            return
        }
        stopMediaPreview()
        runCatching {
            val player = MediaPlayer.create(context, Uri.parse(previewUri)) ?: return@runCatching
            mediaPlayer = player.apply {
                setOnCompletionListener {
                    it.release()
                    if (mediaPlayer === it) mediaPlayer = null
                    activePlayingSpeakerId = null
                }
                start()
            }
            activePlayingSpeakerId = speaker.id
        }.onFailure { error ->
            AlarmTalkLog.reportError("Failed to play speaker draft preview", error)
            localMessage = userFacingError(error, context.getString(R.string.voices_preview_play_failed))
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

    fun selectSpeakerDraft(speaker: VoiceSpeakerSegment) {
        val state = speakerDraftStates[speaker.id] ?: return
        val selectedDraftId = state.profileId ?: return
        if (state.status != SpeakerDraftStatus.Ready) return
        cancelOtherSpeakerDraftJobs(keepSpeakerId = speaker.id)
        stopMediaPreview()
        activePlayingSpeakerId = null
        val otherDraftIds = speakerDraftStates
            .filterKeys { it != speaker.id }
            .values
            .mapNotNull { it.profileId }
        cleanupDraftsAsync(otherDraftIds)
        speakerDraftStates = mapOf(speaker.id to state)
        detectedSpeakers = listOf(speaker)
        selectedSpeakerDraftId = selectedDraftId
        localMessage = null
        createSubmitAttempted = false
        currentStep = VoiceRegistrationStep.Identity
    }

    fun promoteSelectedSpeakerDraft(
        selectedDraftId: String,
        metadata: VoiceProfilePromotionDraft,
    ) {
        scope.launch {
            promotingBusy = true
            localMessage = null
            runCatching {
                onPromoteDraftVoice(selectedDraftId, metadata)
            }.onSuccess {
                speakerDraftStates = emptyMap()
                detectedSpeakers = emptyList()
                selectedSpeakerDraftId = null
                closeCreateDialog()
                localMessage = context.getString(R.string.voices_registered_success)
            }.onFailure { error ->
                AlarmTalkLog.reportError("Failed to promote draft voice id=$selectedDraftId", error)
                localMessage = userFacingError(error, context.getString(R.string.voices_register_failed))
            }
            promotingBusy = false
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
            onCreateVoiceProfile(
                trimmedName,
                audio,
                shareVoice,
                trimmedRelationship,
                trimmedListener,
                voiceGender,
                if (japanesePolite) "polite" else "auto",
            )
            closeCreateDialog()
            return
        }
        val selectedDraftId = selectedSpeakerDraftId
        if (selectedDraftId != null) {
            promoteSelectedSpeakerDraft(
                selectedDraftId = selectedDraftId,
                metadata = VoiceProfilePromotionDraft(
                    name = trimmedName,
                    shared = shareVoice,
                    relationshipLabel = trimmedRelationship,
                    listenerTitle = trimmedListener,
                    voiceGender = voiceGender,
                    speechFormality = if (japanesePolite) "polite" else "auto",
                ),
            )
            return
        }
        // 목소리 나누기를 실행한 상태에서는 나눈 목소리 중 하나를 선택해 등록한다.
        if (detectedSpeakers.isNotEmpty()) {
            localMessage = context.getString(R.string.voices_select_separated_voice)
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
                    onCreateVoiceProfile(
                        trimmedName,
                        audio,
                        shareVoice,
                        trimmedRelationship,
                        trimmedListener,
                        voiceGender,
                        if (japanesePolite) "polite" else "auto",
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
        val hasSeparatedSpeakers = detectedSpeakers.isNotEmpty()
        val fileInputLocked = separatingBusy || hasSeparatedSpeakers
        // 1분 미만이면 "다음" 으로 넘어가지 못하게 막는다. 녹음은 selectedAudio 길이,
        // 파일은 실제 업로드되는 crop 구간 길이로 판정(백엔드 MIN_UPLOAD_DURATION_MS 와 동일 기준).
        val canSubmitRecord = inputMode == VoiceCaptureMode.Record &&
            (selectedAudio?.durationMillis ?: 0L) >= VoiceProfileAudioLimits.MIN_DURATION_MILLIS
        val canSubmitSingleFile = inputMode == VoiceCaptureMode.File &&
            selectedFileUri != null &&
            !hasSeparatedSpeakers && !separatingBusy &&
            (cropEndMillis - cropStartMillis) >= VoiceProfileAudioLimits.MIN_DURATION_MILLIS
        val canSubmitSeparatedDraft = inputMode == VoiceCaptureMode.File &&
            selectedSpeakerDraftId != null
        Dialog(
            onDismissRequest = {
                if (!voiceProfileBusy && !separatingBusy) closeCreateDialog()
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
                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Text(
                                text = stringResource(R.string.voices_create_dialog_title),
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.Bold,
                            )
                            val stepTitle = when (currentStep) {
                                VoiceRegistrationStep.Source -> stringResource(R.string.voices_step_source)
                                VoiceRegistrationStep.Identity -> stringResource(R.string.voices_step_identity)
                                VoiceRegistrationStep.Sharing -> stringResource(R.string.voices_step_sharing)
                            }
                            val stepPosition =
                                "${currentStep.ordinal + 1} / ${VoiceRegistrationStep.entries.size}"
                            // 세그먼트 진행 표시만 노출 — 단계 이름·위치는 스크린리더로만 전달한다.
                            Row(
                                modifier = Modifier.semantics {
                                    contentDescription = "$stepTitle · $stepPosition"
                                },
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                VoiceRegistrationStep.entries.forEach { step ->
                                    Box(
                                        modifier = Modifier
                                            .width(16.dp)
                                            .height(4.dp)
                                            .background(
                                                color = if (step.ordinal <= currentStep.ordinal) {
                                                    MaterialTheme.colorScheme.primary
                                                } else {
                                                    MaterialTheme.colorScheme.outlineVariant
                                                },
                                                shape = WakerPillShape,
                                            ),
                                    )
                                }
                            }
                        }
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
                            enabled = !voiceProfileBusy && !separatingBusy,
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
                                            enabled = !voiceProfileBusy && !isRecording && !createPreparing && !fileInputLocked,
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
                                                    resetSpeakers()
                                                }
                                            },
                                            onPreviewCrop = { playFileCropPreview() },
                                        )
                                        // 화자 수를 미리 고르게 하지 않는다 — 기본은 선택 구간을
                                        // 그대로 등록(한 사람 목소리일 때 결과가 가장 좋음)하고,
                                        // 여러 명이 섞인 파일만 목소리 나누기를 거쳐 한 명을 고른다.
                                        if (selectedFileDurationMillis != null && !hasSeparatedSpeakers) {
                                            MixedVoicesSeparateRow(
                                                busy = separatingBusy,
                                                enabled = !voiceProfileBusy && !promotingBusy && !createPreparing,
                                                onSeparate = { separateSpeakers() },
                                            )
                                        }
                                        if (hasSeparatedSpeakers) {
                                            detectedSpeakers.forEachIndexed { index, speaker ->
                                                val draftState = speakerDraftStates[speaker.id] ?: SpeakerDraftState()
                                                SpeakerDraftRow(
                                                    speaker = speaker,
                                                    index = index,
                                                    state = draftState,
                                                    isPlaying = activePlayingSpeakerId == speaker.id,
                                                    promotingBusy = promotingBusy,
                                                    onTogglePlay = { playSpeakerDraftPreview(speaker) },
                                                    onSelect = { selectSpeakerDraft(speaker) },
                                                )
                                            }
                                            OutlinedButton(
                                                onClick = { resetSpeakers() },
                                                enabled = !promotingBusy && !createPreparing,
                                                modifier = Modifier.fillMaxWidth(),
                                                shape = WakerButtonShape,
                                                border = wakerCardBorder(),
                                                colors = wakerOutlinedButtonColors(),
                                            ) {
                                                Text(stringResource(R.string.voices_reset))
                                            }
                                        }
                                    }
                                }
                            }

                            VoiceRegistrationStep.Identity -> {
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
                                ListenerTitlePreview(
                                    listenerTitle = profileListenerTitle.trim(),
                                    relationshipLabel = relationshipSelection.resolved,
                                )
                                VoiceGenderSelector(
                                    selected = voiceGender,
                                    onSelect = { voiceGender = it },
                                )
                                JapanesePoliteToggle(
                                    checked = japanesePolite,
                                    onCheckedChange = { japanesePolite = it },
                                )
                            }

                            VoiceRegistrationStep.Sharing -> {
                                SharingOptionCard(
                                    enabled = true,
                                    title = stringResource(R.string.voices_sharing_private_title),
                                    description = stringResource(R.string.voices_sharing_private_desc),
                                    onClick = { shareVoice = false },
                                    isChosen = !shareVoice,
                                )
                                SharingOptionCard(
                                    enabled = canShareVoice,
                                    title = stringResource(R.string.voices_sharing_shared_title),
                                    description = if (canShareVoice) {
                                        stringResource(R.string.voices_sharing_shared_desc_enabled)
                                    } else {
                                        stringResource(R.string.voices_sharing_shared_desc_disabled)
                                    },
                                    onClick = { if (canShareVoice) shareVoice = true },
                                    isChosen = shareVoice && canShareVoice,
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
                        !promotingBusy && (canSubmitRecord || canSubmitSingleFile || canSubmitSeparatedDraft)
                    val identityComplete = profileName.trim().isNotBlank() &&
                        relationshipSelection.isComplete &&
                        profileListenerTitle.trim().isNotBlank()
                    // 화자 분리 결과가 떠 있으면 각 draft 행의 '선택'이 다음 단계로 넘겨주므로
                    // 하단 '다음' 버튼은 중복 — 이 경우 액션바를 숨긴다(이 단계엔 이전 버튼도 없음).
                    val hideSourceActionBar =
                        currentStep == VoiceRegistrationStep.Source && hasSeparatedSpeakers
                    if (!hideSourceActionBar) {
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
                                        currentStep = when (currentStep) {
                                            VoiceRegistrationStep.Sharing -> VoiceRegistrationStep.Identity
                                            VoiceRegistrationStep.Identity -> VoiceRegistrationStep.Source
                                            VoiceRegistrationStep.Source -> VoiceRegistrationStep.Source
                                        }
                                        createSubmitAttempted = false
                                        localMessage = null
                                    },
                                    enabled = !voiceProfileBusy && !createPreparing && !promotingBusy,
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
                                            currentStep = VoiceRegistrationStep.Identity
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

                                VoiceRegistrationStep.Identity -> {
                                    Button(
                                        onClick = {
                                            createSubmitAttempted = true
                                            if (identityComplete) {
                                                localMessage = null
                                                createSubmitAttempted = false
                                                currentStep = VoiceRegistrationStep.Sharing
                                            }
                                        },
                                        enabled = !voiceProfileBusy && !createPreparing && !promotingBusy,
                                        modifier = Modifier.weight(1f),
                                        shape = WakerButtonShape,
                                    ) {
                                        Text(stringResource(R.string.voices_next))
                                    }
                                }

                                VoiceRegistrationStep.Sharing -> {
                                    Button(
                                        onClick = { submitCreateProfile(resolvedProfileName) },
                                        enabled = !voiceProfileBusy && !isRecording && !createPreparing &&
                                            !promotingBusy &&
                                            (canSubmitRecord || canSubmitSingleFile || canSubmitSeparatedDraft),
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

