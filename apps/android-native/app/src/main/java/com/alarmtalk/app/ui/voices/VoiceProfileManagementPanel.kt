package com.alarmtalk.app

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Badge
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material.icons.outlined.Mic
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.alarmtalk.app.core.AlarmTalkLog.TAG
import com.alarmtalk.app.data.AlarmAudioStore
import com.alarmtalk.app.data.STOCK_GREETING_CATEGORY
import com.alarmtalk.app.data.AlarmVoiceRecorder
import com.alarmtalk.app.data.CachedAlarmAudio
import com.alarmtalk.app.data.VoiceProfileAudioLimits
import com.alarmtalk.app.data.VoiceProfileCreationDraft
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private fun speakerDurationLabel(speaker: VoiceSpeakerSegment): String =
    audioTimeLabel((speaker.endMs - speaker.startMs).coerceAtLeast(0L))

private fun voiceProfilePlaceholder(): String = "목소리"

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

private fun voiceProfileDurationError(durationMillis: Long?): String? = when {
    durationMillis == null -> "오디오 길이를 확인할 수 없어요."
    durationMillis < VoiceProfileAudioLimits.MIN_DURATION_MILLIS -> "1분 이상 녹음해 주세요."
    durationMillis > VoiceProfileAudioLimits.MAX_DURATION_MILLIS +
        VoiceProfileAudioLimits.MAX_DURATION_TOLERANCE_MILLIS -> "2분 이하 음성으로 등록할 수 있어요."
    else -> null
}

private fun voiceProfileFileDurationError(durationMillis: Long?): String? = when {
    durationMillis == null -> "오디오 길이를 확인할 수 없어요."
    durationMillis < VoiceProfileAudioLimits.MIN_DURATION_MILLIS -> "1분 이상 파일을 선택해 주세요."
    else -> null
}

// 처음 목소리를 만드는 사용자를 위한 단계 가이드 (handoff 코치마크 카피 참고).
private val voiceCreateGuideSteps = listOf(
    UsageGuideStep(
        icon = Icons.Outlined.Mic,
        title = "조용한 곳에서 녹음해요",
        body = "1분 이상 2분 이하로 평소 목소리처럼 또박또박 읽어 주세요. 가지고 있는 음성 파일이나 영상으로도 만들 수 있어요.",
    ),
    UsageGuideStep(
        icon = Icons.Outlined.Badge,
        title = "누구의 목소리인지 알려줘요",
        body = "이름·관계와 '나를 부를 호칭'을 입력하면, 랜덤 문구에서 그 호칭으로 다정하게 불러줘요.",
    ),
    UsageGuideStep(
        icon = Icons.Outlined.AutoAwesome,
        title = "등록을 누르면 완성",
        body = "학습이 끝난 목소리는 알람 만들기의 재생 방식에서 골라 쓸 수 있어요.",
    ),
)

// 보이스 클로닝용 추천 낭독 스크립트(약 1분 분량). 인사·일상·숫자·감정·긴 문장을
// 고루 담아 다양한 발음이 들어가도록 구성했고, 알람톡 서비스의 따뜻한 톤을 자연스럽게 녹였다.
private const val VOICE_RECORD_SCRIPT =
    "안녕하세요. 지금 제 목소리로 알람톡에서 쓸 알람을 만들고 있어요. " +
        "매일 아침, 좋아하는 사람의 목소리로 깨어날 수 있다니 생각만 해도 따뜻하네요. " +
        "오늘은 날씨가 맑고 바람도 살랑살랑 불어서 산책하기 참 좋은 날이에요. " +
        "이 목소리로 가족이나 친구의 아침을 다정하게 챙겨줄 수도 있겠죠. " +
        "숫자도 한번 세어 볼게요. 하나, 둘, 셋, 넷, 다섯, 여섯, 일곱, 여덟, 아홉, 열. " +
        "기쁜 날엔 환하게 웃고, 힘든 날엔 \"오늘도 정말 수고했어\" 하고 스스로를 다독여 주는 것도 잊지 말아야겠죠. " +
        "이제 조금 긴 문장을 읽어 볼게요. 매일 같은 시간에 일어나 창문을 열고 맑은 공기를 들이마시며 " +
        "하루를 차분히 시작하면, 마음까지 한결 가벼워지는 기분이 들어요. " +
        "끝까지 또렷하게 읽어 주셔서 고맙습니다."

@Composable
private fun VoiceRecordScriptCard() {
    var expanded by remember { mutableStateOf(false) }
    OutlinedCard(
        shape = WakerCardShape,
        border = wakerCardBorder(),
        colors = CardDefaults.outlinedCardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
        ),
    ) {
        Column {
            Surface(
                onClick = { expanded = !expanded },
                color = Color.Transparent,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "추천 대사 보기",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                    Icon(
                        imageVector = if (expanded) {
                            Icons.Outlined.KeyboardArrowUp
                        } else {
                            Icons.Outlined.KeyboardArrowDown
                        },
                        contentDescription = if (expanded) "접기" else "펼치기",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (expanded) {
                Text(
                    text = VOICE_RECORD_SCRIPT,
                    modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    lineHeight = MaterialTheme.typography.bodyLarge.lineHeight,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
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
                text = "로그인이 필요해요",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            MutedText("로그인 후 목소리를 만들 수 있어요.")
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
    onSeparateVoiceSpeakers: suspend (CachedAlarmAudio) -> List<VoiceSpeakerSegment>,
    onCloneSpeakerDraft: suspend (String, CachedAlarmAudio) -> VoiceProfile,
    onPromoteDraftVoice: suspend (String) -> Unit,
    onDeleteDraftVoice: suspend (String) -> Unit,
    onGenerateTts: suspend (TtsGenerateRequest) -> TtsGenerateResponse,
    stockClips: List<com.alarmtalk.app.network.StockClip>,
    onDownloadStockAudio: suspend (String) -> com.alarmtalk.app.network.TtsMessageAudioResponse,
    onRenameVoiceProfile: (String, String, String, String) -> Unit,
    onShareVoiceProfile: (String, Boolean) -> Unit,
    onUpdateSharedVoiceInfo: (String, String, String) -> Unit,
    onDeleteVoiceProfile: (String) -> Unit,
    onOpenBilling: () -> Unit,
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
    var fileSpeakerMode by remember { mutableStateOf(FileSpeakerMode.Single) }
    var isRecording by remember { mutableStateOf(false) }
    var recordingElapsedMillis by remember { mutableStateOf(0L) }
    var recordingLevels by remember { mutableStateOf(List(18) { 0.08f }) }
    var selectedFileUri by remember { mutableStateOf<Uri?>(null) }
    var selectedFileDurationMillis by remember { mutableStateOf<Long?>(null) }
    var cropStartMillis by remember { mutableStateOf(0L) }
    var cropEndMillis by remember { mutableStateOf(VoiceProfileAudioLimits.MAX_DURATION_MILLIS) }
    var detectedSpeakers by remember { mutableStateOf<List<VoiceSpeakerSegment>>(emptyList()) }
    var speakerDraftStates by remember { mutableStateOf<Map<String, SpeakerDraftState>>(emptyMap()) }
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
    // 기본 제공 목소리는 정보성이라 평소엔 접어두고 헤더만 보여준다.
    var systemVoicesExpanded by remember { mutableStateOf(false) }
    // 지금 인사말 샘플을 재생 중인 기본 목소리 id (재생 아이콘 토글용).
    var playingGreetingVoiceId by remember { mutableStateOf<String?>(null) }
    // 시스템 스톡 보이스는 "내 목소리" 수 제한·관리 액션에서 제외한다.
    val systemVoices = voiceProfiles.filter { it.isSystem == true }
    val ownVoices = voiceProfiles.filter { it.isSystem != true }
    val isLimitReached = ownVoices.size >= MAX_VOICE_PROFILES
    val canCreateVoice = hasPaidVoiceAccess(subscriptionResponse)
    val canShareVoice = canShareVoiceWithOthers(subscriptionResponse, familyGroup, authSession)
    val paidVoiceRequiredMessage = "유료 이용권에서 사용할 수 있어요."

    fun stopMediaPreview() {
        mediaPlayer?.release()
        mediaPlayer = null
        filePreviewPreparing = false
        filePreviewPlaying = false
        playingGreetingVoiceId = null
    }

    // 기본 목소리 행을 누르면 그 목소리의 인사말 샘플(greeting 스톡 클립)을 들려준다.
    fun playGreeting(profile: VoiceProfile) {
        if (playingGreetingVoiceId == profile.id) {
            stopMediaPreview()
            return
        }
        val clip = stockClips.firstOrNull {
            it.voiceProfileId == profile.id && it.category == STOCK_GREETING_CATEGORY
        } ?: stockClips.firstOrNull { it.voiceProfileId == profile.id }
        if (clip == null) {
            localMessage = "이 목소리의 미리듣기를 준비 중이에요."
            return
        }
        scope.launch {
            stopMediaPreview()
            playingGreetingVoiceId = profile.id
            runCatching {
                val response = onDownloadStockAudio(clip.messageId)
                val bytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
                val cached = withContext(Dispatchers.IO) {
                    audioStore.cacheGeneratedAudio(
                        bytes = bytes,
                        format = response.audioFormat,
                        rawAudioUri = response.audioUrl,
                        displayName = "greeting_${clip.messageId}",
                        cacheKey = "greeting_${clip.messageId}",
                        messageId = clip.messageId,
                    )
                }
                val player = MediaPlayer.create(context, Uri.parse(cached.localAudioUri))
                    ?: return@runCatching
                mediaPlayer = player.apply {
                    setOnCompletionListener {
                        it.release()
                        if (mediaPlayer === it) mediaPlayer = null
                        if (playingGreetingVoiceId == profile.id) playingGreetingVoiceId = null
                    }
                    start()
                }
            }.onFailure { error ->
                Log.e(TAG, "Failed to play greeting preview", error)
                if (playingGreetingVoiceId == profile.id) playingGreetingVoiceId = null
                localMessage = userFacingError(error, "미리듣기를 재생하지 못했어요.")
            }
        }
    }

    fun applySelectedAudio(audio: CachedAlarmAudio) {
        stopMediaPreview()
        selectedAudio = audio
        localMessage = voiceProfileDurationError(audio.durationMillis)
    }

    fun prepareSelectedFile(uri: Uri) {
        stopMediaPreview()
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { audioStore.readDurationMillis(uri) }
                    ?: throw IllegalArgumentException("오디오 길이를 확인할 수 없는 파일은 사용할 수 없어요.")
            }.onSuccess { durationMillis ->
                selectedAudio = null
                selectedFileUri = uri
                selectedFileDurationMillis = durationMillis
                cropStartMillis = 0L
                cropEndMillis = durationMillis.coerceAtMost(VoiceProfileAudioLimits.MAX_DURATION_MILLIS)
                detectedSpeakers = emptyList()
                speakerDraftStates = emptyMap()
                activePlayingSpeakerId = null
                localMessage = voiceProfileFileDurationError(durationMillis)
            }
                .onFailure { error ->
                    Log.e(TAG, "Failed to cache voice profile audio", error)
                    localMessage = userFacingError(error, "선택한 오디오를 사용할 수 없어요.")
                }
        }
    }

    fun stopRecording() {
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) { recorder.stop() }
            }.onSuccess { audio ->
                isRecording = false
                val error = voiceProfileDurationError(audio.durationMillis)
                if (error == null) {
                    applySelectedAudio(audio)
                } else {
                    selectedAudio = null
                    localMessage = error
                }
            }.onFailure { error ->
                isRecording = false
                Log.e(TAG, "Failed to stop voice profile recording", error)
                localMessage = userFacingError(error, "녹음에 실패했어요.")
            }
        }
    }

    fun startRecording() {
        runCatching {
            recorder.start(maxDurationMillis = VoiceProfileAudioLimits.MAX_DURATION_MILLIS)
            recordingElapsedMillis = 0L
            recordingLevels = List(18) { 0.08f }
            isRecording = true
            localMessage = null
        }.onFailure { error ->
            Log.e(TAG, "Failed to start voice profile recording", error)
            localMessage = userFacingError(error, "녹음을 시작할 수 없어요.")
        }
    }

    fun cleanupDraftsAsync(draftIds: Collection<String>) {
        if (draftIds.isEmpty()) return
        // viewModelScope 가 아닌 dialog scope 라 다이얼로그가 사라져도 작업이 끝까지 가도록
        // application context coroutine 으로 분리하지는 않는다. 짧은 시간 내에 완료된다고 가정.
        draftIds.forEach { draftId ->
            scope.launch {
                runCatching { onDeleteDraftVoice(draftId) }
            }
        }
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
        recordingLevels = List(18) { 0.08f }
        stopMediaPreview()
        selectedFileUri = null
        selectedFileDurationMillis = null
        cropStartMillis = 0L
        cropEndMillis = VoiceProfileAudioLimits.MAX_DURATION_MILLIS
        fileSpeakerMode = FileSpeakerMode.Single
        detectedSpeakers = emptyList()
        // 다이얼로그 닫힐 때 현재 화면에 남은 draft 가 있으면 모두 삭제 (선택되지 않은 채 닫힘)
        // 진행 중인 prepare Job 도 취소해 닫힌 뒤 server 호출이 이어지지 않게 한다.
        cancelOtherSpeakerDraftJobs(keepSpeakerId = null)
        cleanupDraftsAsync(speakerDraftStates.values.mapNotNull { it.profileId })
        speakerDraftStates = emptyMap()
        activePlayingSpeakerId = null
        separatingBusy = false
        promotingBusy = false
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
            localMessage = "마이크 권한이 필요해요."
        }
    }

    LaunchedEffect(isRecording) {
        if (isRecording) {
            val startedAt = System.currentTimeMillis()
            while (isRecording) {
                recordingElapsedMillis = (System.currentTimeMillis() - startedAt)
                    .coerceAtMost(VoiceProfileAudioLimits.MAX_DURATION_MILLIS)
                val level = (recorder.maxAmplitude().toFloat() / 32767f).coerceIn(0.06f, 1f)
                recordingLevels = (recordingLevels.drop(1) + level)
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
        val uri = selectedFileUri ?: throw IllegalStateException("파일을 선택해 주세요.")
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

    suspend fun prepareSpeakerDraft(
        speaker: VoiceSpeakerSegment,
        baseName: String,
        uri: Uri,
    ) {
        val duration = (speaker.endMs - speaker.startMs)
            .coerceIn(
                VoiceProfileAudioLimits.MIN_DURATION_MILLIS,
                VoiceProfileAudioLimits.MAX_DURATION_MILLIS,
            )
        runCatching {
            val audio = withContext(Dispatchers.IO) {
                audioStore.cacheFromUri(
                    sourceUri = uri,
                    maxDurationMillis = duration,
                    startMillis = cropStartMillis + speaker.startMs,
                )
            }
            val draftName = baseName.ifBlank { voiceProfilePlaceholder() }
            val profile = onCloneSpeakerDraft(draftName, audio)
            speakerDraftStates = speakerDraftStates.toMutableMap().also {
                it[speaker.id] = (it[speaker.id] ?: SpeakerDraftState()).copy(
                    profileId = profile.id,
                    status = SpeakerDraftStatus.Synthesizing,
                )
            }
            val ttsResponse = onGenerateTts(
                TtsGenerateRequest(
                    voiceProfileId = profile.id,
                    text = "이 목소리로 깨워드릴까요?",
                    category = "custom",
                    language = "ko",
                    random = false,
                ),
            )
            val audioBytes = Base64.decode(ttsResponse.audioBase64, Base64.DEFAULT)
            val cached = withContext(Dispatchers.IO) {
                audioStore.cacheGeneratedAudio(
                    bytes = audioBytes,
                    format = ttsResponse.audioFormat,
                    rawAudioUri = null,
                    displayName = "speaker_preview_${profile.id}",
                    cacheKey = "draft_preview_${profile.id}",
                    messageId = ttsResponse.messageId,
                )
            }
            speakerDraftStates = speakerDraftStates.toMutableMap().also {
                it[speaker.id] = (it[speaker.id] ?: SpeakerDraftState()).copy(
                    profileId = profile.id,
                    previewUri = cached.localAudioUri,
                    status = SpeakerDraftStatus.Ready,
                )
            }
        }.onFailure { error ->
            Log.e(TAG, "Failed to prepare speaker draft id=${speaker.id}", error)
            speakerDraftStates = speakerDraftStates.toMutableMap().also {
                it[speaker.id] = (it[speaker.id] ?: SpeakerDraftState()).copy(
                    status = SpeakerDraftStatus.Failed,
                    errorMessage = "미리듣기를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.",
                )
            }
        }
    }

    fun separateSpeakers() {
        if (!canCreateVoice) {
            localMessage = paidVoiceRequiredMessage
            return
        }
        val uri = selectedFileUri ?: return
        val cropDuration = cropEndMillis - cropStartMillis
        if (cropDuration < VoiceProfileAudioLimits.MIN_DURATION_MILLIS) {
            localMessage = "나눌 구간은 1분 이상이어야 해요. 자르기 범위를 늘려 주세요."
            return
        }
        if (cropDuration > VoiceProfileAudioLimits.MAX_DURATION_MILLIS) {
            localMessage = "나눌 구간은 2분 이하여야 해요. 자르기 범위를 줄여 주세요."
            return
        }
        scope.launch {
            separatingBusy = true
            localMessage = null
            detectedSpeakers = emptyList()
            // 기존에 만들어둔 draft 가 있으면 먼저 정리.
            cleanupDraftsAsync(speakerDraftStates.values.mapNotNull { it.profileId })
            speakerDraftStates = emptyMap()
            activePlayingSpeakerId = null
            runCatching {
                val audio = croppedFileAudio()
                onSeparateVoiceSpeakers(audio)
            }.onSuccess { speakers ->
                val visible = speakers.filter { it.endMs > it.startMs }.take(3)
                detectedSpeakers = visible
                speakerDraftStates = visible.associate { s ->
                    s.id to SpeakerDraftState(status = SpeakerDraftStatus.Cloning)
                }
                localMessage = if (visible.isEmpty()) "나눌 목소리를 찾지 못했어요." else null
                val baseName = profileName.trim()
                // 기존 추적 중인 Job 이 있다면 새 separate 가 일어났으므로 모두 취소.
                cancelOtherSpeakerDraftJobs(keepSpeakerId = null)
                visible.forEach { speaker ->
                    val job = scope.launch {
                        try {
                            prepareSpeakerDraft(speaker, baseName, uri)
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
                Log.e(TAG, "Failed to separate speakers", error)
                val code = apiErrorCode(error)
                localMessage = when (code) {
                    "AUDIO_DURATION_TOO_SHORT" -> "나눌 구간은 1분 이상이어야 해요."
                    "AUDIO_DURATION_TOO_LONG" -> "나눌 구간은 2분 이하여야 해요."
                    "AUDIO_FILE_EMPTY" -> "선택한 음성 파일이 비어 있어요."
                    "INVALID_DURATION" -> "음성 길이를 확인하지 못했어요. 파일을 다시 선택해 주세요."
                    "INVALID_AUDIO_MIME_TYPE" -> "지원하지 않는 오디오 형식이에요."
                    "VOICE_FEATURE_REQUIRES_PAID_PLAN" -> "유료 이용권에서 목소리 나누기를 사용할 수 있어요."
                    else -> "목소리를 나누지 못했어요. 다른 구간을 선택하거나 잠시 후 다시 시도해 주세요."
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
        activePlayingSpeakerId = null
        stopMediaPreview()
        localMessage = null
    }

    fun setFileSpeakerMode(mode: FileSpeakerMode) {
        if (fileSpeakerMode == mode) return
        fileSpeakerMode = mode
        resetSpeakers()
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
            Log.e(TAG, "Failed to play speaker draft preview", error)
            localMessage = userFacingError(error, "미리듣기를 재생하지 못했어요.")
        }
    }

    // 공유받은 음성에 viewer 라벨을 막 입력했을 때 그 음성을 한 번 들려준다.
    // 같은 입력이면 백엔드 캐시 hit, 처음이면 새로 합성. 둘 다 MediaPlayer 로 재생.
    suspend fun playSharedVoicePreview(profileId: String) {
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
            val bytes = Base64.decode(response.audioBase64, Base64.DEFAULT)
            val cached = withContext(Dispatchers.IO) {
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
            Log.e(TAG, "Failed to preview shared voice", error)
            localMessage = userFacingError(error, "미리듣기를 재생하지 못했어요.")
        }
    }

    fun selectSpeakerDraft(speaker: VoiceSpeakerSegment) {
        val state = speakerDraftStates[speaker.id] ?: return
        val selectedDraftId = state.profileId ?: return
        // 아직 ready 가 아닌 draft 는 promote 대상이 아니다.
        // (prepareSpeakerDraft 가 진행 중에 사용자가 빠르게 탭하는 경우 가드)
        if (state.status != SpeakerDraftStatus.Ready) return
        // 선택한 화자를 제외한 다른 draft 의 prepare Job 을 cancel 해 cleanup 과 동시에 진행되지 않게 한다.
        cancelOtherSpeakerDraftJobs(keepSpeakerId = speaker.id)
        scope.launch {
            promotingBusy = true
            stopMediaPreview()
            activePlayingSpeakerId = null
            runCatching {
                onPromoteDraftVoice(selectedDraftId)
                speakerDraftStates
                    .filterKeys { it != speaker.id }
                    .values
                    .mapNotNull { it.profileId }
                    .forEach { otherId ->
                        runCatching { onDeleteDraftVoice(otherId) }
                    }
            }.onSuccess {
                // draft 정리 완료. 다이얼로그 닫을 때 잔여 draft 가 또 cleanupDrafts 로 가지 않도록
                // state 비우기.
                speakerDraftStates = emptyMap()
                detectedSpeakers = emptyList()
                closeCreateDialog()
                localMessage = "목소리로 등록했어요"
            }.onFailure { error ->
                Log.e(TAG, "Failed to promote draft voice id=$selectedDraftId", error)
                localMessage = userFacingError(error, "목소리로 등록하지 못했어요.")
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
                    localMessage = "미리듣기를 재생하지 못했어요."
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
                Log.e(TAG, "Failed to play cropped voice preview", error)
                filePreviewPreparing = false
                filePreviewPlaying = false
                localMessage = userFacingError(error, "미리듣기를 재생하지 못했어요.")
            }
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
                localMessage = "녹음한 음성을 먼저 준비해 주세요."
                return
            }
            if (voiceProfileDurationError(audio.durationMillis) != null) return
            onCreateVoiceProfile(trimmedName, audio, shareVoice, trimmedRelationship, trimmedListener)
            closeCreateDialog()
            return
        }
        if (fileSpeakerMode == FileSpeakerMode.Multiple) {
            localMessage = "나눈 목소리 중 사용할 목소리를 선택해 주세요."
            return
        }
        scope.launch {
            createPreparing = true
            localMessage = null
            runCatching {
                croppedFileAudio()
            }.onSuccess { audio ->
                val error = voiceProfileDurationError(audio.durationMillis)
                if (error != null) {
                    localMessage = error
                } else {
                    onCreateVoiceProfile(trimmedName, audio, shareVoice, trimmedRelationship, trimmedListener)
                    closeCreateDialog()
                }
            }.onFailure { error ->
                Log.e(TAG, "Failed to prepare selected voice file", error)
                localMessage = userFacingError(error, "선택한 음성을 준비하지 못했어요.")
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
                text = "내 목소리",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Button(
                onClick = {
                    if (canCreateVoice) {
                        showCreateForm = true
                    } else {
                        localMessage = null
                        voicePlanGateOpen = true
                    }
                },
                enabled = !voiceProfileBusy && (!canCreateVoice || !isLimitReached),
            ) {
                if (canCreateVoice) {
                    Text("추가")
                } else {
                    Text("잠금")
                }
            }
        }

        if (!canCreateVoice) {
            MutedText("내 목소리 만들기는 유료 이용권에서 사용할 수 있어요. 아래 기본 목소리는 무료로 쓸 수 있어요.")
        }
        if (localMessage != null && !showCreateForm && localMessage != paidVoiceRequiredMessage) {
            MutedText(localMessage.orEmpty())
        }

        if (ownVoices.isEmpty() && canCreateVoice) {
            MutedText("아직 만든 목소리가 없어요.")
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
            Surface(
                onClick = { systemVoicesExpanded = !systemVoicesExpanded },
                color = Color.Transparent,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "기본 목소리 ${systemVoices.size}종",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Icon(
                        imageVector = if (systemVoicesExpanded) {
                            Icons.Outlined.KeyboardArrowUp
                        } else {
                            Icons.Outlined.KeyboardArrowDown
                        },
                        contentDescription = if (systemVoicesExpanded) "접기" else "펼치기",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (systemVoicesExpanded) {
                systemVoices.forEach { profile ->
                    SystemVoiceProfileRow(
                        profile = profile,
                        playing = playingGreetingVoiceId == profile.id,
                        onPlay = { playGreeting(profile) },
                    )
                }
            }
        }

        if (canShareVoice && familyVoices.isNotEmpty()) {
            Text(
                text = "공유받은 목소리",
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
            message = paidVoiceRequiredMessage,
            onConfirm = {
                voicePlanGateOpen = false
                onOpenBilling()
            },
            onDismiss = { voicePlanGateOpen = false },
        )
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
        // 짧으면 stopRecording/prepareSelectedFile 가 안내 메시지를 이미 띄운다.
        val canSubmitRecord = inputMode == VoiceCaptureMode.Record &&
            (selectedAudio?.durationMillis ?: 0L) >= VoiceProfileAudioLimits.MIN_DURATION_MILLIS
        val canSubmitSingleFile = inputMode == VoiceCaptureMode.File &&
            fileSpeakerMode == FileSpeakerMode.Single &&
            selectedFileUri != null &&
            (cropEndMillis - cropStartMillis) >= VoiceProfileAudioLimits.MIN_DURATION_MILLIS
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
                                text = "목소리 만들기",
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.Bold,
                            )
                            val stepIndex = currentStep.ordinal + 1
                            val stepTitle = when (currentStep) {
                                VoiceRegistrationStep.Source -> "음성 준비"
                                VoiceRegistrationStep.Identity -> "누구의 목소리인가요"
                                VoiceRegistrationStep.Sharing -> "공유 설정"
                            }
                            MutedText("$stepIndex / 3 · $stepTitle")
                        }
                        IconButton(
                            onClick = { voiceGuideVisible = true },
                            modifier = Modifier.size(42.dp),
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Outlined.HelpOutline,
                                contentDescription = "사용 가이드",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        IconButton(
                            onClick = ::closeCreateDialog,
                            enabled = !voiceProfileBusy && !separatingBusy,
                            modifier = Modifier.size(42.dp),
                        ) {
                            Icon(Icons.Outlined.Close, contentDescription = "닫기")
                        }
                    }

                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .verticalScroll(rememberScrollState())
                            .padding(horizontal = 20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        when (currentStep) {
                            VoiceRegistrationStep.Source -> {
                                VoiceCaptureModeSelector(
                                    selected = inputMode,
                                    enabled = !isRecording && !createPreparing,
                                    onSelect = {
                                        if (inputMode != it) stopMediaPreview()
                                        inputMode = it
                                    },
                                )

                                if (inputMode == VoiceCaptureMode.Record) {
                                    VoiceRecordScriptCard()
                                    VoiceRecordControls(
                                        isRecording = isRecording,
                                        elapsedMillis = recordingElapsedMillis,
                                        maxDurationMillis = VoiceProfileAudioLimits.MAX_DURATION_MILLIS,
                                        levels = recordingLevels,
                                        enabled = !voiceProfileBusy && !createPreparing,
                                        notice = "1분 이상 2분 이하로 녹음해 주세요.",
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
                                    )
                                } else {
                                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                        MutedText(
                                            "한 사람의 목소리만 담긴 파일을 추천해요. 여러 명의 목소리가 섞여 있으면 " +
                                                "'여러 명'을 골라 화자를 나눈 뒤 한 명을 선택할 수 있어요.",
                                        )
                                        FileSpeakerModeSelector(
                                            selected = fileSpeakerMode,
                                            enabled = !voiceProfileBusy && !isRecording && !createPreparing && !fileInputLocked,
                                            onSelect = ::setFileSpeakerMode,
                                        )
                                        VoiceFileControls(
                                            durationMillis = selectedFileDurationMillis,
                                            cropStartMillis = cropStartMillis,
                                            cropEndMillis = cropEndMillis,
                                            minDurationMillis = VoiceProfileAudioLimits.MIN_DURATION_MILLIS,
                                            maxDurationMillis = VoiceProfileAudioLimits.MAX_DURATION_MILLIS,
                                            enabled = !voiceProfileBusy && !isRecording && !createPreparing && !fileInputLocked,
                                            uploadLabel = "파일 또는 영상 업로드",
                                            notice = "1분 이상 2분 이하 구간을 선택해 주세요.",
                                            noticeAfterUpload = true,
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
                                        if (fileSpeakerMode == FileSpeakerMode.Multiple) {
                                            selectedFileDurationMillis?.let {
                                                Row(
                                                    modifier = Modifier.fillMaxWidth(),
                                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                                ) {
                                                    Button(
                                                        onClick = { separateSpeakers() },
                                                        enabled = !separatingBusy && !promotingBusy && !createPreparing && !hasSeparatedSpeakers,
                                                        modifier = Modifier.weight(1f),
                                                        shape = WakerButtonShape,
                                                    ) {
                                                        Text(
                                                            when {
                                                                separatingBusy -> "분리 중"
                                                                hasSeparatedSpeakers -> "분리 완료"
                                                                else -> "목소리 나누기"
                                                            },
                                                        )
                                                    }
                                                    OutlinedButton(
                                                        onClick = { resetSpeakers() },
                                                        enabled = hasSeparatedSpeakers && !promotingBusy && !createPreparing,
                                                        modifier = Modifier.weight(1f),
                                                        shape = WakerButtonShape,
                                                        border = wakerCardBorder(),
                                                        colors = wakerOutlinedButtonColors(),
                                                    ) {
                                                        Text("초기화")
                                                    }
                                                }
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
                                            }
                                            MutedText("목소리를 선택하면 바로 등록돼요. 이름, 관계, 호칭은 등록한 뒤 수정할 수 있어요.")
                                        }
                                    }
                                }
                            }

                            VoiceRegistrationStep.Identity -> {
                                OutlinedTextField(
                                    value = profileName,
                                    onValueChange = { profileName = it.take(50) },
                                    label = { Text("목소리 이름 (필수)") },
                                    placeholder = { Text("예: 엄마 목소리") },
                                    singleLine = true,
                                    isError = nameRequiredError,
                                    supportingText = {
                                        if (nameRequiredError) Text("꼭 입력해 주세요.")
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
                                    label = { Text("이 목소리가 나를 부를 이름 (필수)") },
                                    placeholder = { Text("예: 민지야, 여보, 우리 손주") },
                                    singleLine = true,
                                    isError = listenerRequiredError,
                                    supportingText = {
                                        if (listenerRequiredError) {
                                            Text("꼭 입력해 주세요.")
                                        } else {
                                            Text("랜덤 문구에서 이 이름으로 나를 불러요.")
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
                            }

                            VoiceRegistrationStep.Sharing -> {
                                SharingOptionCard(
                                    enabled = true,
                                    title = "나만 사용",
                                    description = "이 목소리는 나만 사용할 수 있어요.",
                                    onClick = { shareVoice = false },
                                    isChosen = !shareVoice,
                                )
                                SharingOptionCard(
                                    enabled = canShareVoice,
                                    title = "가족·연인과 공유",
                                    description = if (canShareVoice) {
                                        "등록 후 목록에서 공유 코드를 만들어 전달할 수 있어요."
                                    } else {
                                        "공유는 커플/가족 이용권에서 사용할 수 있어요."
                                    },
                                    onClick = { if (canShareVoice) shareVoice = true },
                                    isChosen = shareVoice && canShareVoice,
                                )
                            }
                        }

                        if (createPreparing) {
                            VoiceProgressMessage("음성을 준비하고 있어요.")
                        }
                        if (localMessage != null) {
                            MutedText(localMessage.orEmpty())
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                    }

                    val canAdvanceFromSource = !voiceProfileBusy && !isRecording && !createPreparing &&
                        !promotingBusy && (canSubmitRecord || canSubmitSingleFile)
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
                                Text("이전")
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
                                    Text(if (createPreparing) "준비 중" else "다음")
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
                                    Text("다음")
                                }
                            }

                            VoiceRegistrationStep.Sharing -> {
                                Button(
                                    onClick = { submitCreateProfile(resolvedProfileName) },
                                    enabled = !voiceProfileBusy && !isRecording && !createPreparing &&
                                        !promotingBusy && (canSubmitRecord || canSubmitSingleFile),
                                    modifier = Modifier.weight(1f),
                                    shape = WakerButtonShape,
                                ) {
                                    Text(if (createPreparing) "준비 중" else "등록")
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
            title = "정보 수정",
            description = "알람에서 보일 이름과 이 목소리가 나를 부르는 방식을 정해요.",
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
                ?.let { "${it}님에게 공유받은 목소리" } ?: "공유받은 목소리",
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

